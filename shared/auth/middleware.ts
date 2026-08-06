import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, verifyServiceToken, decodeTokenUnsafe } from './jwt';
import { isBlacklisted } from './blacklist';
import { UnauthorizedError, ForbiddenError } from '../errors';
import logger from '../logger';

interface AuthenticatedRequest extends Request {
  user?: { userId: number; email: string; role: string; jti: string };
  token?: string;
  service?: { serviceId: string; permissions: string[]; jti: string };
}

interface AuthOptions {
  checkBlacklist?: boolean;
}

const extractToken = (req: Request): string => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError('No token provided');
  }
  return authHeader.substring(7);
};

export const authenticate = (options: AuthOptions = {}) => {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = extractToken(req);
      const decoded = verifyAccessToken(token);

      if (options.checkBlacklist !== false) {
        const blacklisted = await isBlacklisted(decoded.jti);
        if (blacklisted) throw new UnauthorizedError('Token has been revoked');
      }

      req.user = { userId: decoded.userId, email: decoded.email, role: decoded.role, jti: decoded.jti };
      req.token = token;

      logger.debug('User authenticated', { userId: decoded.userId, email: decoded.email, jti: decoded.jti });
      next();
    } catch (error) {
      next(error);
    }
  };
};

export const authorize = (...allowedRoles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    try {
      if (!req.user) throw new UnauthorizedError('User not authenticated');
      if (!allowedRoles.includes(req.user.role)) {
        throw new ForbiddenError(`Access denied. Required roles: ${allowedRoles.join(', ')}`);
      }

      logger.debug('User authorized', { userId: req.user.userId, role: req.user.role, allowedRoles });
      next();
    } catch (error) {
      next(error);
    }
  };
};

export const optionalAuth = (options: AuthOptions = {}) => {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;

      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const decoded = verifyAccessToken(token);

        if (options.checkBlacklist !== false) {
          const blacklisted = await isBlacklisted(decoded.jti);
          if (!blacklisted) {
            req.user = { userId: decoded.userId, email: decoded.email, role: decoded.role, jti: decoded.jti };
            req.token = token;
          }
        } else {
          req.user = { userId: decoded.userId, email: decoded.email, role: decoded.role, jti: decoded.jti };
          req.token = token;
        }
      }

      next();
    } catch (error: any) {
      if (error instanceof UnauthorizedError) {
        logger.warn('Invalid token in optional auth', { ip: req.ip, path: req.path, error: error.message });
      }
      next();
    }
  };
};

export const authenticateService = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const token = extractToken(req);
    const decoded = verifyServiceToken(token);

    req.service = { serviceId: decoded.serviceId, permissions: decoded.permissions || [], jti: decoded.jti };

    logger.debug('Service authenticated', { serviceId: decoded.serviceId, permissions: decoded.permissions });
    next();
  } catch (error) {
    next(error);
  }
};

export const authorizeService = (...requiredPermissions: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    try {
      if (!req.service) throw new UnauthorizedError('Service not authenticated');

      const { serviceId, permissions } = req.service;
      const hasPermission = requiredPermissions.some(required => permissions.includes(required));

      if (!hasPermission) {
        throw new ForbiddenError(`Service '${serviceId}' lacks required permissions: ${requiredPermissions.join(', ')}`);
      }

      logger.debug('Service authorized', { serviceId, requiredPermissions, grantedPermissions: permissions });
      next();
    } catch (error) {
      next(error);
    }
  };
};

export const checkBlacklist = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const token = extractToken(req);
    const decoded = decodeTokenUnsafe(token);

    if (!decoded || !decoded.jti) throw new UnauthorizedError('Invalid token format');

    const blacklisted = await isBlacklisted(decoded.jti as string);
    if (blacklisted) throw new UnauthorizedError('Token has been revoked');

    next();
  } catch (error) {
    next(error);
  }
};

export { extractToken };
