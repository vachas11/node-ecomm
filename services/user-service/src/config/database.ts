import { PrismaClient } from '../generated/prisma-client';
import DatabasePool from '../../../../shared/database';
import logger from '../../../../shared/logger';

// Legacy DatabasePool (kept for complex queries)
const db = new DatabasePool({
  database: process.env.DB_NAME || 'user_db',
  host: process.env.DB_HOST,
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : undefined,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// New Prisma Client
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
  datasources: {
    db: {
      url:
        process.env.DATABASE_URL ||
        `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`,
    },
  },
});

export const initDatabase = async (): Promise<void> => {
  try {
    // Connect Prisma
    await prisma.$connect();
    logger.info('Prisma client connected');

    // Test DatabasePool connection
    await db.query('SELECT 1');
    logger.info('DatabasePool connected');

    await db.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`);

    logger.info('User service database tables initialized');
  } catch (error: any) {
    logger.error('Database initialization failed:', { error: error.message });
    throw error;
  }
};

export const closeDatabases = async (): Promise<void> => {
  await prisma.$disconnect();
  await db.close();
  logger.info('Database connections closed');
};

export { db, prisma };
