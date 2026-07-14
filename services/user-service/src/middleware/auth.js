const { verifyAccessToken } = require('../utils/jwt');
const { UnauthorizedError, ForbiddenError } = require('../../../../shared/errors');
const logger = require('../../../../shared/logger');

// Authentication middleware - verifies JWT token
const authenticate = (req, res, next) => {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('No token provided');
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify and decode token
    const decoded = verifyAccessToken(token);

    // Attach user info to request object
    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role
    };

    logger.debug('User authenticated', { userId: decoded.userId, email: decoded.email });
    next();
  } catch (error) {
    next(error);
  }
};

// Authorization middleware - checks user roles
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        throw new UnauthorizedError('User not authenticated');
      }

      if (!allowedRoles.includes(req.user.role)) {
        throw new ForbiddenError(`Access denied. Required roles: ${allowedRoles.join(', ')}`);
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
const optionalAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = verifyAccessToken(token);
      req.user = {
        userId: decoded.userId,
        email: decoded.email,
        role: decoded.role
      };
    }

    next();
  } catch (error) {
    // Don't fail, just continue without user info
    next();
  }
};

module.exports = {
  authenticate,
  authorize,
  optionalAuth
};
