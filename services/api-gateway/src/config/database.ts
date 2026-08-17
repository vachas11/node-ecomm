import { PrismaClient } from '../generated/prisma-client';
import DatabasePool from '../../../../shared/database';
import logger from '../../../../shared/logger';

// Legacy DatabasePool (kept for complex queries)
const db = new DatabasePool({
  database: process.env.DB_NAME || 'gateway_db',
  host: process.env.DB_HOST,
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : undefined,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// New Prisma Client
const prisma = new PrismaClient({
  log:
    process.env.NODE_ENV === 'development'
      ? ['query', 'info', 'warn', 'error', 'event', { level: 'query', emit: 'event' }]
      : ['error'],
  datasources: {
    db: {
      url:
        process.env.DATABASE_URL ||
        `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`,
    },
  },
});

prisma.$on('query', (e) => {
  console.log(`Query: ${e.query}`);
  console.log(`Duration: ${e.duration}ms`);

  if (e.duration > 100) {
    logger.warn('Slow query detected', {
      query: e.query,
      duration: e.duration,
    });
  }
});

export const initDatabase = async (): Promise<void> => {
  try {
    // Connect Prisma
    await prisma.$connect();
    logger.info('Prisma client connected');

    // Keep existing CREATE TABLE for backward compatibility
    await db.query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        token_hash VARCHAR(255) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await db.query(
      `CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);`
    );
    await db.query(
      `CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);`
    );
    await db.query(
      `CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);`
    );

    logger.info('API Gateway database tables initialized');
  } catch (error: any) {
    logger.error('API Gateway database initialization failed:', { error: error.message });
    throw error;
  }
};

export const closeDatabases = async (): Promise<void> => {
  await prisma.$disconnect();
  await db.close();
  logger.info('Database connections closed');
};

export { db, prisma };
