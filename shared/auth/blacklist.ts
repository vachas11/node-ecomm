import redisClient from '../redis';
import logger from '../logger';

export const addToBlacklist = async (jti: string, ttlSeconds: number): Promise<boolean> => {
  try {
    if (!jti) throw new Error('JTI is required for blacklisting');

    if (!ttlSeconds || ttlSeconds <= 0) {
      logger.warn('Invalid TTL for blacklist, using default 15 minutes', { jti });
      ttlSeconds = 900;
    }

    const key = `blacklist:${jti}`;
    await redisClient.client?.setEx(key, ttlSeconds, '1');

    logger.info('Token added to blacklist', { jti: jti.substring(0, 8) + '...', ttl: ttlSeconds });
    return true;
  } catch (error: any) {
    logger.error('Failed to add token to blacklist', { jti: jti?.substring(0, 8) + '...', error: error.message });
    return false;
  }
};

export const isBlacklisted = async (jti: string): Promise<boolean> => {
  try {
    if (!jti) return false;

    const key = `blacklist:${jti}`;
    const exists = await redisClient.exists(key);

    if (exists) {
      logger.debug('Blacklisted token detected', { jti: jti.substring(0, 8) + '...' });
    }

    return exists;
  } catch (error: any) {
    logger.error('Failed to check token blacklist', { jti: jti?.substring(0, 8) + '...', error: error.message });
    return false;
  }
};

export const removeFromBlacklist = async (jti: string): Promise<boolean> => {
  try {
    if (!jti) return false;

    const key = `blacklist:${jti}`;
    await redisClient.del(key);

    logger.info('Token removed from blacklist', { jti: jti.substring(0, 8) + '...' });
    return true;
  } catch (error: any) {
    logger.error('Failed to remove token from blacklist', { jti: jti?.substring(0, 8) + '...', error: error.message });
    return false;
  }
};

export const clearUserTokens = async (userId: number): Promise<number> => {
  try {
    if (!userId) throw new Error('User ID is required');

    const pattern = `user:${userId}:token:*`;
    const count = await redisClient.delPattern(pattern);

    logger.info('All user tokens cleared', { userId, count });
    return count;
  } catch (error: any) {
    logger.error('Failed to clear user tokens', { userId, error: error.message });
    return 0;
  }
};

export const addBulkToBlacklist = async (tokens: Array<{ jti: string; ttl: number }>): Promise<number> => {
  try {
    if (!Array.isArray(tokens) || tokens.length === 0) return 0;

    let successCount = 0;
    for (const { jti, ttl } of tokens) {
      const success = await addToBlacklist(jti, ttl);
      if (success) successCount++;
    }

    logger.info('Bulk blacklist operation completed', { total: tokens.length, successful: successCount });
    return successCount;
  } catch (error: any) {
    logger.error('Bulk blacklist operation failed', { error: error.message });
    return 0;
  }
};

export const getBlacklistStats = async (): Promise<{ totalBlacklisted: number; pattern: string; error?: string }> => {
  try {
    const pattern = 'blacklist:*';
    const keys = await redisClient.client?.keys(pattern);
    return { totalBlacklisted: keys?.length || 0, pattern };
  } catch (error: any) {
    logger.error('Failed to get blacklist stats', { error: error.message });
    return { totalBlacklisted: 0, pattern: 'blacklist:*', error: error.message };
  }
};
