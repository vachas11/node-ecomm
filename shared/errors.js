// Custom error classes for consistent error handling across services

class AppError extends Error {
  constructor(message, statusCode, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.timestamp = new Date().toISOString();
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message = 'Validation failed', details = []) {
    super(message, 400);
    this.name = 'ValidationError';
    this.details = details;
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized access') {
    super(message, 401);
    this.name = 'UnauthorizedError';
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Access forbidden') {
    super(message, 403);
    this.name = 'ForbiddenError';
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404);
    this.name = 'NotFoundError';
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource conflict') {
    super(message, 409);
    this.name = 'ConflictError';
  }
}

class DatabaseError extends AppError {
  constructor(message = 'Database operation failed', originalError = null) {
    super(message, 500, false);
    this.name = 'DatabaseError';
    this.originalError = originalError;
  }
}

class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable') {
    super(message, 503, false);
    this.name = 'ServiceUnavailableError';
  }
}

// Global error handler middleware
const errorHandler = (err, req, res, next) => {
  const logger = require('./logger');

  // Default to 500 server error
  err.statusCode = err.statusCode || 500;
  err.message = err.message || 'Internal Server Error';

  // Log error
  if (err.statusCode >= 500) {
    logger.error('Server Error:', {
      message: err.message,
      stack: err.stack,
      url: req.originalUrl,
      method: req.method,
      ip: req.ip
    });
  } else {
    logger.warn('Client Error:', {
      message: err.message,
      url: req.originalUrl,
      method: req.method,
      statusCode: err.statusCode
    });
  }

  // Development: Send full error details
  if (process.env.NODE_ENV === 'development') {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        message: err.message,
        statusCode: err.statusCode,
        stack: err.stack,
        details: err.details || null
      }
    });
  }

  // Production: Send sanitized error
  const response = {
    success: false,
    error: {
      message: err.isOperational ? err.message : 'Something went wrong',
      statusCode: err.statusCode
    }
  };

  if (err.details) {
    response.error.details = err.details;
  }

  res.status(err.statusCode).json(response);
};

// Async handler wrapper to avoid try-catch in every route
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  DatabaseError,
  ServiceUnavailableError,
  errorHandler,
  asyncHandler
};
