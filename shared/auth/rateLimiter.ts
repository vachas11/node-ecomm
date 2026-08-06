import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { Request, Response, NextFunction } from 'express';
import redisClient from '../redis';
import logger from '../logger';

interface AuthenticatedRequest extends Request {
  user?: { userId: number };
  rateLimit?: { remaining: number; total: number };
}

interface RateLimiterOptions {
  windowMs?: number;
  max?: number;
  message?: string;
  standardHeaders?: boolean;
  legacyHeaders?: boolean;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  keyGenerator?: (req: Request) => string;
  handler?: (req: Request, res: Response) => void;
  skip?: (req: Request) => boolean;
}

export const createRateLimiter = (options: RateLimiterOptions = {}) => {
  const {
    windowMs = 15 * 60 * 1000,
    max = 100,
    message = 'Too many requests, please try again later',
    standardHeaders = true,
    legacyHeaders = false,
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
    keyGenerator = (req: Request) => req.ip || 'unknown',
    handler,
    skip
  } = options;

  const limiterConfig: any = {
    windowMs,
    max,
    message: { success: false, error: { message, statusCode: 429 } },
    standardHeaders,
    legacyHeaders,
    skipSuccessfulRequests,
    skipFailedRequests,
    keyGenerator,
    handler: handler || ((req: Request, res: Response) => {
      logger.warn('Rate limit exceeded', { ip: req.ip, path: req.path, method: req.method, userAgent: req.headers['user-agent'] });
      res.status(429).json({ success: false, error: { message, statusCode: 429, retryAfter: Math.ceil(windowMs / 1000) } });
    }),
    skip
  };

  try {
    if (redisClient.isConnected && redisClient.client) {
      limiterConfig.store = new RedisStore({
        // @ts-ignore - Type mismatch but works at runtime
        sendCommand: (...args: any[]) => redisClient.client!.sendCommand(args),
        prefix: 'ratelimit:'
      });
      logger.info('Rate limiter using Redis store');
    } else {
      logger.warn('Rate limiter using in-memory store (Redis not connected)');
    }
  } catch (error: any) {
    logger.error('Failed to initialize Redis store for rate limiter', { error: error.message });
    logger.warn('Falling back to in-memory rate limit store');
  }

  return rateLimit(limiterConfig);
};

export const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts, please try again after 15 minutes',
  skipSuccessfulRequests: true,
  keyGenerator: (req: Request) => {
    const email = (req.body as any)?.email || 'unknown';
    return `${req.ip}:${email}`;
  }
});

export const registerRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: 'Too many accounts created from this IP, please try again after an hour',
  skipSuccessfulRequests: false,
  keyGenerator: (req: Request) => req.ip || 'unknown'
});

export const refreshRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Too many token refresh attempts, please login again',
  skipSuccessfulRequests: false,
  keyGenerator: (req: AuthenticatedRequest) => String((req as AuthenticatedRequest).user?.userId || req.ip)
});

export const passwordChangeRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Too many password change attempts, please try again later',
  keyGenerator: (req: AuthenticatedRequest) => String((req as AuthenticatedRequest).user?.userId || req.ip)
});

export const apiRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests, please slow down',
  keyGenerator: (req: AuthenticatedRequest) => String((req as AuthenticatedRequest).user?.userId || req.ip)
});

export const strictRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: 'Too many requests to sensitive endpoint',
  keyGenerator: (req: AuthenticatedRequest) => String((req as AuthenticatedRequest).user?.userId || req.ip)
});

interface AccountRateLimiterOptions {
  windowMs?: number;
  max?: number;
  accountLockDuration?: number;
}

export const accountRateLimiter = (options: AccountRateLimiterOptions = {}) => {
  const { windowMs = 15 * 60 * 1000, max = 5, accountLockDuration = 60 * 60 * 1000 } = options;

  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const identifier = (req.body as any)?.email || req.ip;
      const key = `account_limit:${identifier}`;
      const lockKey = `account_locked:${identifier}`;

      const isLocked = await redisClient.exists(lockKey);
      if (isLocked) {
        res.status(429).json({ success: false, error: { message: 'Account temporarily locked due to too many failed attempts', statusCode: 429, locked: true } });
        return;
      }

      const attempts = await redisClient.incr(key);
      if (attempts === 1) {
        await redisClient.expire(key, Math.ceil(windowMs / 1000));
      }

      if (attempts && attempts > max) {
        await redisClient.client?.setEx(lockKey, Math.ceil(accountLockDuration / 1000), '1');
        logger.warn('Account locked due to rate limit', { identifier, attempts, lockDuration: accountLockDuration / 1000 });
        res.status(429).json({ success: false, error: { message: `Account locked for ${accountLockDuration / 60000} minutes due to too many attempts`, statusCode: 429, locked: true } });
        return;
      }

      req.rateLimit = { remaining: max - (attempts || 0), total: max };
      next();
    } catch (error: any) {
      logger.error('Account rate limiter error', { error: error.message });
      next();
    }
  };
};
