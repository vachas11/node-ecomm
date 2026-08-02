require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const logger = require('../../../shared/logger');
const { errorHandler } = require('../../../shared/errors');
const redisClient = require('../../../shared/redis');
const { apiRateLimiter } = require('../../../shared/auth/rateLimiter');
const routes = require('./routes');
const { getAllServices, getService } = require('./config/services');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID']
}));

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request ID middleware (for tracing)
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || uuidv4();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();

  // Log on response finish
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.path}`, {
      requestId: req.id,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      userId: req.user?.userId
    });
  });

  next();
});

// Global rate limiting
app.use(apiRateLimiter);

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Check Redis connection
    const redisHealthy = await redisClient.ping();

    // Check backend services health
    const serviceChecks = await Promise.allSettled(
      getAllServices().map(async (service) => {
        try {
          const healthUrl = `${service.url}${service.healthCheck}`;
          const response = await axios.get(healthUrl, { timeout: 5000 });
          return {
            name: service.name,
            status: response.status === 200 ? 'healthy' : 'unhealthy',
            url: service.url
          };
        } catch (error) {
          return {
            name: service.name,
            status: 'unhealthy',
            url: service.url,
            error: error.message
          };
        }
      })
    );

    const services = serviceChecks.map(result =>
      result.status === 'fulfilled' ? result.value : result.reason
    );

    const allServicesHealthy = services.every(s => s.status === 'healthy');

    res.status(allServicesHealthy ? 200 : 503).json({
      status: allServicesHealthy ? 'healthy' : 'degraded',
      service: 'api-gateway',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      redis: {
        status: redisHealthy ? 'connected' : 'disconnected'
      },
      services
    });
  } catch (error) {
    logger.error('Health check failed:', { error: error.message });
    res.status(503).json({
      status: 'unhealthy',
      service: 'api-gateway',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// API routes
app.use('/api', routes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'API Gateway',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/health',
      auth: '/api/auth/*',
      products: '/api/products/*',
      orders: '/api/orders/*'
    }
  });
});

// Global error handler
app.use(errorHandler);

// Graceful shutdown
const gracefulShutdown = async (signal) => {
  logger.info(`${signal} received, shutting down gracefully...`);

  // Stop accepting new connections
  server.close(async () => {
    logger.info('HTTP server closed');

    // Close Redis connection
    await redisClient.disconnect();

    logger.info('All connections closed');
    process.exit(0);
  });

  // Force shutdown after 30 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
};

// Start server
let server;
const startServer = async () => {
  try {
    // Initialize Redis
    await redisClient.connect();
    logger.info('Redis connected');

    // Start HTTP server
    server = app.listen(PORT, () => {
      logger.info(`API Gateway running on port ${PORT}`, {
        environment: process.env.NODE_ENV,
        nodeVersion: process.version,
        services: getAllServices().map(s => s.name)
      });
    });

    // Handle shutdown signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    logger.error('Failed to start API Gateway:', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
};

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', {
    error: error.message,
    stack: error.stack
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', { reason, promise });
  process.exit(1);
});

startServer();

module.exports = app; // For testing
