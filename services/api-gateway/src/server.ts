import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import logger from '../../../shared/logger';
import { errorHandler } from '../../../shared/errors';
import redisClient from '../../../shared/redis';
import { apiRateLimiter } from '../../../shared/auth/rateLimiter';
import routes from './routes';
import authRoutes from './routes/auth.routes';
import { getAllServices } from './config/services';
import { initDatabase, db, closeDatabases } from './config/database';
import * as metrics from './lib/Metrics';

interface RequestWithId extends Request {
  id: string;
}

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/metrics', async (_req: Request, res: Response) => {
  try {
    res.set('Content-Type', metrics.register.contentType);
    const metricsOutput = await metrics.register.metrics();
    res.end(metricsOutput);
  } catch (err: any) {
    logger.error('Failed to generate metrics', { error: err.message });
    res.status(500).end(err.toString());
  }
});

app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = (req.headers['x-request-id'] as string) || uuidv4();
  (req as RequestWithId).id = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
});

app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const requestId = (req as RequestWithId).id;

  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.path}`, {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
  });

  next();
});

app.use(apiRateLimiter);

app.get('/health', async (_req: Request, res: Response) => {
  try {
    const redisHealthy = await redisClient.ping();

    const serviceChecks = await Promise.allSettled(
      getAllServices().map(async (service) => {
        try {
          const healthUrl = `${service.url}${service.healthCheck}`;
          const response = await axios.get(healthUrl, { timeout: 5000 });
          return { name: service.name, status: response.status === 200 ? 'healthy' : 'unhealthy', url: service.url };
        } catch (error: any) {
          return { name: service.name, status: 'unhealthy', url: service.url, error: error.message };
        }
      })
    );

    const services = serviceChecks.map((result) =>
      result.status === 'fulfilled' ? result.value : (result as PromiseRejectedResult).reason
    );

    const allServicesHealthy = services.every((s: any) => s.status === 'healthy');

    res.status(allServicesHealthy ? 200 : 503).json({
      status: allServicesHealthy ? 'healthy' : 'degraded',
      service: 'api-gateway',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      redis: { status: redisHealthy ? 'connected' : 'disconnected' },
      services
    });
  } catch (error: any) {
    logger.error('Health check failed:', { error: error.message });
    res.status(503).json({
      status: 'unhealthy',
      service: 'api-gateway',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api', routes);

app.get('/', (_req: Request, res: Response) => {
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

app.use(errorHandler);

let server: ReturnType<typeof app.listen>;

const gracefulShutdown = async (signal: string): Promise<void> => {
  logger.info(`${signal} received, shutting down gracefully...`);

  server.close(async () => {
    logger.info('HTTP server closed');
    await redisClient.disconnect();
    await closeDatabases(); // Disconnects both Prisma and DatabasePool
    logger.info('All connections closed');
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
};

const startServer = async (): Promise<void> => {
  try {
    await initDatabase();
    logger.info('Database initialized');

    await redisClient.connect();
    logger.info('Redis connected');

    server = app.listen(PORT, () => {
      logger.info(`API Gateway running on port ${PORT}`, {
        environment: process.env.NODE_ENV,
        nodeVersion: process.version,
        services: getAllServices().map((s) => s.name)
      });
    });

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (error: any) {
    logger.error('Failed to start API Gateway:', { error: error.message, stack: error.stack });
    process.exit(1);
  }
};

process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught Exception:', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason: any) => {
  logger.error('Unhandled Rejection:', { reason });
  process.exit(1);
});

startServer();

export default app;
