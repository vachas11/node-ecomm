const redis = require('redis');
const logger = require('./logger');

// Redis client singleton for caching and rate limiting
class RedisClient {
  constructor() {
    this.client = null;
    this.isConnected = false;
  }

  async connect() {
    if (this.isConnected) {
      return this.client;
    }

    try {
      this.client = redis.createClient({
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD || undefined,

        // AWS ElastiCache configuration
        ...(process.env.NODE_ENV === 'production' && {
          tls: process.env.REDIS_TLS === 'true' ? {} : undefined
        }),

        // Retry strategy
        retry_strategy: (options) => {
          if (options.error && options.error.code === 'ECONNREFUSED') {
            logger.error('Redis connection refused');
            return new Error('Redis server refused connection');
          }
          if (options.total_retry_time > 1000 * 60 * 60) {
            logger.error('Redis retry time exhausted');
            return new Error('Retry time exhausted');
          }
          if (options.attempt > 10) {
            return undefined; // Stop retrying
          }
          // Exponential backoff
          return Math.min(options.attempt * 100, 3000);
        }
      });

      // Event handlers
      this.client.on('connect', () => {
        logger.info('Redis client connecting...');
      });

      this.client.on('ready', () => {
        this.isConnected = true;
        logger.info('Redis client connected and ready');
      });

      this.client.on('error', (err) => {
        logger.error('Redis client error:', { error: err.message });
        this.isConnected = false;
      });

      this.client.on('end', () => {
        logger.warn('Redis client connection closed');
        this.isConnected = false;
      });

      await this.client.connect();
      return this.client;

    } catch (error) {
      logger.error('Failed to connect to Redis:', { error: error.message });
      throw error;
    }
  }

  // Cache wrapper with automatic JSON serialization
  async get(key) {
    try {
      const data = await this.client.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.error('Redis GET error:', { key, error: error.message });
      return null; // Fail gracefully
    }
  }

  async set(key, value, expiryInSeconds = 3600) {
    try {
      const serialized = JSON.stringify(value);
      await this.client.setEx(key, expiryInSeconds, serialized);
      logger.debug('Cache set:', { key, ttl: expiryInSeconds });
      return true;
    } catch (error) {
      logger.error('Redis SET error:', { key, error: error.message });
      return false;
    }
  }

  async del(key) {
    try {
      await this.client.del(key);
      logger.debug('Cache deleted:', { key });
      return true;
    } catch (error) {
      logger.error('Redis DEL error:', { key, error: error.message });
      return false;
    }
  }

  // Pattern-based deletion (e.g., 'user:*')
  async delPattern(pattern) {
    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(keys);
        logger.debug('Cache pattern deleted:', { pattern, count: keys.length });
      }
      return keys.length;
    } catch (error) {
      logger.error('Redis DEL pattern error:', { pattern, error: error.message });
      return 0;
    }
  }

  // Check if key exists
  async exists(key) {
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      logger.error('Redis EXISTS error:', { key, error: error.message });
      return false;
    }
  }

  // Increment counter (useful for rate limiting)
  async incr(key) {
    try {
      return await this.client.incr(key);
    } catch (error) {
      logger.error('Redis INCR error:', { key, error: error.message });
      return null;
    }
  }

  // Set expiry on existing key
  async expire(key, seconds) {
    try {
      await this.client.expire(key, seconds);
      return true;
    } catch (error) {
      logger.error('Redis EXPIRE error:', { key, error: error.message });
      return false;
    }
  }

  // Health check
  async ping() {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      logger.error('Redis PING error:', { error: error.message });
      return false;
    }
  }

  // Graceful shutdown
  async disconnect() {
    if (this.client && this.isConnected) {
      await this.client.quit();
      logger.info('Redis client disconnected');
    }
  }
}

// Export singleton instance
module.exports = new RedisClient();
