const { Pool } = require('pg');
const logger = require('./logger');

// PostgreSQL connection pool configuration
// Each microservice will create its own pool with different DB
class DatabasePool {
  constructor(config) {
    this.pool = new Pool({
      host: config.host || process.env.DB_HOST || 'localhost',
      port: config.port || process.env.DB_PORT || 5432,
      database: config.database,
      user: config.user || process.env.DB_USER,
      password: config.password || process.env.DB_PASSWORD,

      // Connection pool settings for scalability
      max: parseInt(process.env.DB_POOL_MAX) || 20, // Maximum connections
      min: parseInt(process.env.DB_POOL_MIN) || 5,  // Minimum idle connections
      idleTimeoutMillis: 30000, // Close idle connections after 30s
      connectionTimeoutMillis: 5000, // Wait max 5s for connection

      // For production: enable SSL
      ...(process.env.NODE_ENV === 'production' && {
        ssl: {
          rejectUnauthorized: false // For AWS RDS
        }
      })
    });

    // Connection event handlers
    this.pool.on('connect', (client) => {
      logger.info(`New client connected to ${config.database}`, {
        totalCount: this.pool.totalCount,
        idleCount: this.pool.idleCount,
        waitingCount: this.pool.waitingCount
      });
    });

    this.pool.on('error', (err, client) => {
      logger.error('Unexpected error on idle client', { error: err.message });
    });

    this.pool.on('remove', () => {
      logger.info(`Client removed from pool ${config.database}`, {
        totalCount: this.pool.totalCount,
        idleCount: this.pool.idleCount
      });
    });
  }

  // Execute query with automatic connection management
  async query(text, params) {
    const start = Date.now();
    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;

      logger.debug('Query executed', {
        query: text.substring(0, 100), // Log first 100 chars
        duration: `${duration}ms`,
        rows: result.rowCount
      });

      return result;
    } catch (error) {
      logger.error('Database query error', {
        query: text.substring(0, 100),
        error: error.message
      });
      throw error;
    }
  }

  // Transaction support
  async transaction(callback) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Transaction rolled back', { error: error.message });
      throw error;
    } finally {
      client.release();
    }
  }

  // Get pool statistics (for health checks)
  getStats() {
    return {
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount
    };
  }

  // Graceful shutdown
  async close() {
    logger.info('Closing database pool...');
    await this.pool.end();
    logger.info('Database pool closed');
  }
}

module.exports = DatabasePool;
