import { Pool, PoolClient } from 'pg';
import logger from './logger';

interface DatabaseConfig {
  host?: string;
  port?: number;
  database: string;
  user?: string;
  password?: string;
}

interface DatabaseStats {
  totalConnections: number;
  idleConnections: number;
  waitingConnections: number;
}

// Custom QueryResult to avoid pg's strict QueryResultRow constraint
interface QueryResult<T> {
  rows: T[];
  rowCount: number | null;
  command: string;
  fields: { name: string; dataTypeID: number }[];
}

class DatabasePool {
  private pool: Pool;

  constructor(config: DatabaseConfig) {
    this.pool = new Pool({
      host: config.host || process.env.DB_HOST || 'localhost',
      port: config.port || parseInt(process.env.DB_PORT || '5432', 10),
      database: config.database,
      user: config.user || process.env.DB_USER,
      password: config.password || process.env.DB_PASSWORD,
      max: parseInt(process.env.DB_POOL_MAX || '20', 10),
      min: parseInt(process.env.DB_POOL_MIN || '5', 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ...(process.env.NODE_ENV === 'production' && {
        ssl: { rejectUnauthorized: false }
      })
    });

    this.pool.on('connect', () => {
      logger.info(`New client connected to ${config.database}`, {
        totalCount: this.pool.totalCount,
        idleCount: this.pool.idleCount,
        waitingCount: this.pool.waitingCount
      });
    });

    this.pool.on('error', (err: Error) => {
      logger.error('Unexpected error on idle client', { error: err.message });
    });

    this.pool.on('remove', () => {
      logger.info(`Client removed from pool ${config.database}`, {
        totalCount: this.pool.totalCount,
        idleCount: this.pool.idleCount
      });
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
    const start = Date.now();
    try {
      const result = await this.pool.query(text, params) as unknown as QueryResult<T>;
      const duration = Date.now() - start;

      logger.debug('Query executed', {
        query: text.substring(0, 100),
        duration: `${duration}ms`,
        rows: result.rowCount
      });

      return result;
    } catch (error: any) {
      logger.error('Database query error', {
        query: text.substring(0, 100),
        error: error.message
      });
      throw error;
    }
  }

  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error: any) {
      await client.query('ROLLBACK');
      logger.error('Transaction rolled back', { error: error.message });
      throw error;
    } finally {
      client.release();
    }
  }

  getStats(): DatabaseStats {
    return {
      totalConnections: this.pool.totalCount,
      idleConnections: this.pool.idleCount,
      waitingConnections: this.pool.waitingCount
    };
  }

  async close(): Promise<void> {
    logger.info('Closing database pool...');
    await this.pool.end();
    logger.info('Database pool closed');
  }
}

export default DatabasePool;
