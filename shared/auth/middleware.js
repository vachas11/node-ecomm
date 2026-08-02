const { verifyAccessToken, verifyServiceToken, decodeTokenUnsafe } = require('./jwt');
const { isBlacklisted } = require('./blacklist');
const { UnauthorizedError, ForbiddenError } = require('../errors');
const logger = require('../logger');

// Extract token from Authorization header
const extractToken = (req) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError('No token provided');
  }

  return authHeader.substring(7); // Remove 'Bearer ' prefix
};

// Authentication middleware - verifies JWT token
const authenticate = (options = {}) => {
  return async (req, res, next) => {
    try {
      const token = extractToken(req);

      // Verify and decode token
      const decoded = verifyAccessToken(token);

      // Check if token is blacklisted (for logout support)
      if (options.checkBlacklist !== false) {
        const blacklisted = await isBlacklisted(decoded.jti);
        if (blacklisted) {
          throw new UnauthorizedError('Token has been revoked');
        }
      }

      // Attach user info to request object
      req.user = {
        userId: decoded.userId,
        email: decoded.email,
        role: decoded.role,
        jti: decoded.jti
      };

      // Attach raw token for logout operations
      req.token = token;

      logger.debug('User authenticated', {
        userId: decoded.userId,
        email: decoded.email,
        jti: decoded.jti
      });

      next();
    } catch (error) {
      next(error);
    }
  };
};

// Authorization middleware - checks user roles
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        throw new UnauthorizedError('User not authenticated');
      }

      if (!allowedRoles.includes(req.user.role)) {
        throw new ForbiddenError(
          `Access denied. Required roles: ${allowedRoles.join(', ')}`
        );
      }

      logger.debug('User authorized', {
        userId: req.user.userId,
        role: req.user.role,
        allowedRoles
      });

      next();
    } catch (error) {
      next(error);
    }
  };
};

// Optional authentication - doesn't fail if no token
const optionalAuth = (options = {}) => {
  return async (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;

      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const decoded = verifyAccessToken(token);

        // Check blacklist if enabled
        if (options.checkBlacklist !== false) {
          const blacklisted = await isBlacklisted(decoded.jti);
          if (!blacklisted) {
            req.user = {
              userId: decoded.userId,
              email: decoded.email,
              role: decoded.role,
              jti: decoded.jti
            };
            req.token = token;
          }
        } else {
          req.user = {
            userId: decoded.userId,
            email: decoded.email,
            role: decoded.role,
            jti: decoded.jti
          };
          req.token = token;
        }
      }

      next();
    } catch (error) {
      // Silently ignore errors for optional auth
      // But log invalid token attempts for security monitoring
      if (error instanceof UnauthorizedError) {
        logger.warn('Invalid token in optional auth', {
          ip: req.ip,
          path: req.path,
          error: error.message
        });
      }
      next();
    }
  };
};

// Service-to-service authentication middleware
const authenticateService = async (req, res, next) => {
  try {
    const token = extractToken(req);

    // Verify service token
    const decoded = verifyServiceToken(token);

    // Attach service info to request
    req.service = {
      serviceId: decoded.serviceId,
      permissions: decoded.permissions || [],
      jti: decoded.jti
    };

    logger.debug('Service authenticated', {
      serviceId: decoded.serviceId,
      permissions: decoded.permissions
    });

    next();
  } catch (error) {
    next(error);
  }
};

// Authorize service with specific permissions
const authorizeService = (...requiredPermissions) => {
  return (req, res, next) => {
    try {
      if (!req.service) {
        throw new UnauthorizedError('Service not authenticated');
      }

      const { serviceId, permissions } = req.service;

      // Check if service has any of the required permissions
      const hasPermission = requiredPermissions.some(
        required => permissions.includes(required)
      );

      if (!hasPermission) {
        throw new ForbiddenError(
          `Service '${serviceId}' lacks required permissions: ${requiredPermissions.join(', ')}`
        );
      }

      logger.debug('Service authorized', {
        serviceId,
        requiredPermissions,
        grantedPermissions: permissions
      });

      next();
    } catch (error) {
      next(error);
    }
  };
};

// Middleware to check if token is blacklisted (standalone use)
const checkBlacklist = async (req, res, next) => {
  try {
    const token = extractToken(req);
    const decoded = decodeTokenUnsafe(token);

    if (!decoded || !decoded.jti) {
      throw new UnauthorizedError('Invalid token format');
    }

    const blacklisted = await isBlacklisted(decoded.jti);
    if (blacklisted) {
      throw new UnauthorizedError('Token has been revoked');
    }

    next();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  authenticate,
  authorize,
  optionalAuth,
  authenticateService,
  authorizeService,
  checkBlacklist,
  extractToken
};
