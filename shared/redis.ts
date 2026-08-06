import { createClient, RedisClientType } from 'redis';
import logger from './logger';

class RedisClient {
  public client: RedisClientType | null = null;
  public isConnected = false;

  async connect(): Promise<RedisClientType> {
    if (this.isConnected && this.client) {
      return this.client;
    }

    try {
      this.client = createClient({
        url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`,
        password: process.env.REDIS_PASSWORD || undefined,
        ...(process.env.NODE_ENV === 'production' && process.env.REDIS_TLS === 'true' && { socket: { tls: true } })
      });

      this.client.on('connect', () => logger.info('Redis client connecting...'));
      this.client.on('ready', () => { this.isConnected = true; logger.info('Redis client connected and ready'); });
      this.client.on('error', (err: Error) => { logger.error('Redis client error:', { error: err.message }); this.isConnected = false; });
      this.client.on('end', () => { logger.warn('Redis client connection closed'); this.isConnected = false; });

      await this.client.connect();
      return this.client;
    } catch (error: any) {
      logger.error('Failed to connect to Redis:', { error: error.message });
      throw error;
    }
  }

  async get<T = any>(key: string): Promise<T | null> {
    try {
      const data = await this.client?.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error: any) {
      logger.error('Redis GET error:', { key, error: error.message });
      return null;
    }
  }

  async set(key: string, value: any, expiryInSeconds = 3600): Promise<boolean> {
    try {
      const serialized = JSON.stringify(value);
      await this.client?.setEx(key, expiryInSeconds, serialized);
      logger.debug('Cache set:', { key, ttl: expiryInSeconds });
      return true;
    } catch (error: any) {
      logger.error('Redis SET error:', { key, error: error.message });
      return false;
    }
  }

  async del(key: string): Promise<boolean> {
    try {
      await this.client?.del(key);
      logger.debug('Cache deleted:', { key });
      return true;
    } catch (error: any) {
      logger.error('Redis DEL error:', { key, error: error.message });
      return false;
    }
  }

  async delPattern(pattern: string): Promise<number> {
    try {
      const keys = await this.client?.keys(pattern);
      if (keys && keys.length > 0) {
        await this.client?.del(keys);
        logger.debug('Cache pattern deleted:', { pattern, count: keys.length });
        return keys.length;
      }
      return 0;
    } catch (error: any) {
      logger.error('Redis DEL pattern error:', { pattern, error: error.message });
      return 0;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.client?.exists(key);
      return result === 1;
    } catch (error: any) {
      logger.error('Redis EXISTS error:', { key, error: error.message });
      return false;
    }
  }

  async incr(key: string): Promise<number | null> {
    try {
      return await this.client?.incr(key) || null;
    } catch (error: any) {
      logger.error('Redis INCR error:', { key, error: error.message });
      return null;
    }
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    try {
      await this.client?.expire(key, seconds);
      return true;
    } catch (error: any) {
      logger.error('Redis EXPIRE error:', { key, error: error.message });
      return false;
    }
  }

  async ping(): Promise<boolean> {
    try {
      const result = await this.client?.ping();
      return result === 'PONG';
    } catch (error: any) {
      logger.error('Redis PING error:', { error: error.message });
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client && this.isConnected) {
      await this.client.quit();
      logger.info('Redis client disconnected');
    }
  }
}

export default new RedisClient();
