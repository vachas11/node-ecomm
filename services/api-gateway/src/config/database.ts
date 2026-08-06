import DatabasePool from '../../../../shared/database';
import logger from '../../../../shared/logger';

const db = new DatabasePool({
  database: process.env.DB_NAME || 'gateway_db',
  host: process.env.DB_HOST,
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : undefined,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

export const initDatabase = async (): Promise<void> => {
  try {
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

export { db };
