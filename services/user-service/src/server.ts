import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import logger from '../../../shared/logger';
import { errorHandler } from '../../../shared/errors';
import { db, prisma, initDatabase, closeDatabases } from './config/database';
import redisClient from '../../../shared/redis';
import authRoutes from './routes/auth.routes';
import internalRoutes from './routes/internal.routes';
import * as metrics from './lib/metrics';

const app = express();
const PORT = process.env.PORT || 3001;

app.get('/metrics', async (req: Request, res: Response) => {
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
app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const requestSize = req.get('content-length') || '0';

  res.on('finish', () => {
    const duration = Date.now() - start;
    const responseSize = res.get('content-length') || '0';

    logger.info(`${req.method} ${req.path}`, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      statusCode: res.statusCode,
      duration: `${duration}ms`
    });

    metrics.recordHttpRequest(
      req.method,
      req.path,
      res.statusCode,
      duration,
      parseInt(requestSize, 10),
      parseInt(responseSize, 10)
    );
  });

  next();
});

app.get('/health', async (req: Request, res: Response) => {
  try {
    await db.query('SELECT 1');
    const dbStats = db.getStats();

    metrics.recordDbPoolMetrics(
      dbStats.totalConnections - dbStats.idleConnections,
      dbStats.idleConnections,
      dbStats.waitingConnections
    );

    const redisHealthy = await redisClient.ping();

    res.json({
      status: 'healthy',
      service: 'user-service',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: { status: 'connected', pool: dbStats },
      redis: { status: redisHealthy ? 'connected' : 'disconnected' }
    });
  } catch (error: any) {
    logger.error('Health check failed:', { error: error.message });
    res.status(503).json({
      status: 'unhealthy',
      service: 'user-service',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/internal', internalRoutes);

app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: { message: 'Route not found', path: req.path }
  });
});

app.use(errorHandler);

let server: ReturnType<typeof app.listen>;

const gracefulShutdown = async (signal: string): Promise<void> => {
  logger.info(`${signal} received, shutting down gracefully...`);

  server.close(async () => {
    logger.info('HTTP server closed');
    await closeDatabases(); // Disconnects both Prisma and DatabasePool
    await redisClient.disconnect();
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
      logger.info(`User Service running on port ${PORT}`, {
        environment: process.env.NODE_ENV,
        nodeVersion: process.version
      });
    });

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (error: any) {
    logger.error('Failed to start server:', { error: error.message, stack: error.stack });
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
