const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const redisClient = require('../redis');
const logger = require('../logger');

/**
 * Rate Limiting Middleware Factory
 *
 * Uses Redis for distributed rate limiting across multiple instances.
 * Falls back to in-memory store if Redis is unavailable.
 */

// Create custom rate limiter with Redis store
const createRateLimiter = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes default
    max = 100, // 100 requests per window default
    message = 'Too many requests, please try again later',
    standardHeaders = true,
    legacyHeaders = false,
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
    keyGenerator = (req) => req.ip, // Default: rate limit by IP
    handler = undefined,
    skip = undefined
  } = options;

  const limiterConfig = {
    windowMs,
    max,
    message: {
      success: false,
      error: {
        message,
        statusCode: 429
      }
    },
    standardHeaders,
    legacyHeaders,
    skipSuccessfulRequests,
    skipFailedRequests,
    keyGenerator,
    handler: handler || ((req, res) => {
      logger.warn('Rate limit exceeded', {
        ip: req.ip,
        path: req.path,
        method: req.method,
        userAgent: req.headers['user-agent']
      });

      res.status(429).json({
        success: false,
        error: {
          message,
          statusCode: 429,
          retryAfter: Math.ceil(windowMs / 1000)
        }
      });
    }),
    skip
  };

  // Try to use Redis store, fall back to memory store
  try {
    if (redisClient.isConnected) {
      limiterConfig.store = new RedisStore({
        client: redisClient.client,
        prefix: 'ratelimit:',
        sendCommand: (...args) => redisClient.client.sendCommand(args)
      });
      logger.info('Rate limiter using Redis store');
    } else {
      logger.warn('Rate limiter using in-memory store (Redis not connected)');
    }
  } catch (error) {
    logger.error('Failed to initialize Redis store for rate limiter', {
      error: error.message
    });
    logger.warn('Falling back to in-memory rate limit store');
  }

  return rateLimit(limiterConfig);
};

// Preset: Login rate limiter
// 5 attempts per 15 minutes per IP
const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: 'Too many login attempts, please try again after 15 minutes',
  skipSuccessfulRequests: true, // Only count failed login attempts
  keyGenerator: (req) => {
    // Rate limit by IP + email to prevent targeted attacks
    const email = req.body?.email || 'unknown';
    return `${req.ip}:${email}`;
  }
});

// Preset: Register rate limiter
// 3 accounts per hour per IP
const registerRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  message: 'Too many accounts created from this IP, please try again after an hour',
  skipSuccessfulRequests: false, // Count all registration attempts
  keyGenerator: (req) => req.ip
});

// Preset: Refresh token rate limiter
// 10 refreshes per hour per user
const refreshRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: 'Too many token refresh attempts, please login again',
  skipSuccessfulRequests: false,
  keyGenerator: (req) => {
    // Rate limit by IP (before authentication) or userId (after authentication)
    return req.user?.userId || req.ip;
  }
});

// Preset: Password change rate limiter
// 5 attempts per hour per user
const passwordChangeRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: 'Too many password change attempts, please try again later',
  keyGenerator: (req) => {
    return req.user?.userId || req.ip;
  }
});

// Preset: General API rate limiter
// 100 requests per 15 minutes per IP
const apiRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: 'Too many requests, please slow down',
  keyGenerator: (req) => {
    // Rate limit authenticated users by userId, others by IP
    return req.user?.userId || req.ip;
  }
});

// Preset: Strict rate limiter for sensitive endpoints
// 3 requests per 15 minutes
const strictRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3,
  message: 'Too many requests to sensitive endpoint',
  keyGenerator: (req) => {
    return req.user?.userId || req.ip;
  }
});

// Account-specific rate limiting with Redis
const accountRateLimiter = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000,
    max = 5,
    accountLockDuration = 60 * 60 * 1000 // 1 hour lock
  } = options;

  return async (req, res, next) => {
    try {
      const identifier = req.body?.email || req.ip;
      const key = `account_limit:${identifier}`;
      const lockKey = `account_locked:${identifier}`;

      // Check if account is locked
      const isLocked = await redisClient.exists(lockKey);
      if (isLocked) {
        return res.status(429).json({
          success: false,
          error: {
            message: 'Account temporarily locked due to too many failed attempts',
            statusCode: 429,
            locked: true
          }
        });
      }

      // Increment attempt counter
      const attempts = await redisClient.incr(key);

      // Set expiry on first attempt
      if (attempts === 1) {
        await redisClient.expire(key, Math.ceil(windowMs / 1000));
      }

      // Lock account if max attempts exceeded
      if (attempts > max) {
        await redisClient.client.setEx(
          lockKey,
          Math.ceil(accountLockDuration / 1000),
          '1'
        );

        logger.warn('Account locked due to rate limit', {
          identifier,
          attempts,
          lockDuration: accountLockDuration / 1000
        });

        return res.status(429).json({
          success: false,
          error: {
            message: `Account locked for ${accountLockDuration / 60000} minutes due to too many attempts`,
            statusCode: 429,
            locked: true
          }
        });
      }

      // Attach remaining attempts to request
      req.rateLimit = {
        remaining: max - attempts,
        total: max
      };

      next();
    } catch (error) {
      logger.error('Account rate limiter error', {
        error: error.message
      });
      // Fail open - allow request if Redis fails
      next();
    }
  };
};

module.exports = {
  createRateLimiter,
  loginRateLimiter,
  registerRateLimiter,
  refreshRateLimiter,
  passwordChangeRateLimiter,
  apiRateLimiter,
  strictRateLimiter,
  accountRateLimiter
};
