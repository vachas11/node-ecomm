const redisClient = require('../redis');
const logger = require('../logger');

/**
 * Token Blacklist Management using Redis
 *
 * Tokens are blacklisted by their JTI (JWT ID) claim.
 * TTL is set to match the token's remaining lifetime.
 * Redis auto-expires blacklisted tokens, no cleanup job needed.
 */

// Add token to blacklist
const addToBlacklist = async (jti, ttlSeconds) => {
  try {
    if (!jti) {
      throw new Error('JTI is required for blacklisting');
    }

    if (!ttlSeconds || ttlSeconds <= 0) {
      logger.warn('Invalid TTL for blacklist, using default 15 minutes', { jti });
      ttlSeconds = 900; // 15 minutes default
    }

    const key = `blacklist:${jti}`;
    await redisClient.client.setEx(key, ttlSeconds, '1');

    logger.info('Token added to blacklist', {
      jti: jti.substring(0, 8) + '...', // Log partial JTI for privacy
      ttl: ttlSeconds
    });

    return true;
  } catch (error) {
    logger.error('Failed to add token to blacklist', {
      jti: jti?.substring(0, 8) + '...',
      error: error.message
    });
    // Don't throw - graceful degradation
    // In production, you might want to throw to prevent logout if Redis is down
    return false;
  }
};

// Check if token is blacklisted
const isBlacklisted = async (jti) => {
  try {
    if (!jti) {
      return false;
    }

    const key = `blacklist:${jti}`;
    const exists = await redisClient.exists(key);

    if (exists) {
      logger.debug('Blacklisted token detected', {
        jti: jti.substring(0, 8) + '...'
      });
    }

    return exists;
  } catch (error) {
    logger.error('Failed to check token blacklist', {
      jti: jti?.substring(0, 8) + '...',
      error: error.message
    });
    // Fail open - if Redis is down, allow the request
    // In production, you might want to fail closed (return true) for security
    return false;
  }
};

// Remove token from blacklist (rarely used - Redis TTL handles expiry)
const removeFromBlacklist = async (jti) => {
  try {
    if (!jti) {
      return false;
    }

    const key = `blacklist:${jti}`;
    await redisClient.del(key);

    logger.info('Token removed from blacklist', {
      jti: jti.substring(0, 8) + '...'
    });

    return true;
  } catch (error) {
    logger.error('Failed to remove token from blacklist', {
      jti: jti?.substring(0, 8) + '...',
      error: error.message
    });
    return false;
  }
};

// Clear all tokens for a specific user (logout all devices)
const clearUserTokens = async (userId) => {
  try {
    if (!userId) {
      throw new Error('User ID is required');
    }

    // Pattern match all user tokens
    const pattern = `user:${userId}:token:*`;
    const count = await redisClient.delPattern(pattern);

    logger.info('All user tokens cleared', {
      userId,
      count
    });

    return count;
  } catch (error) {
    logger.error('Failed to clear user tokens', {
      userId,
      error: error.message
    });
    return 0;
  }
};

// Add multiple tokens to blacklist (bulk operation)
const addBulkToBlacklist = async (tokens) => {
  try {
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return 0;
    }

    let successCount = 0;

    for (const { jti, ttl } of tokens) {
      const success = await addToBlacklist(jti, ttl);
      if (success) successCount++;
    }

    logger.info('Bulk blacklist operation completed', {
      total: tokens.length,
      successful: successCount
    });

    return successCount;
  } catch (error) {
    logger.error('Bulk blacklist operation failed', {
      error: error.message
    });
    return 0;
  }
};

// Get blacklist statistics (for monitoring)
const getBlacklistStats = async () => {
  try {
    const pattern = 'blacklist:*';
    const keys = await redisClient.client.keys(pattern);

    return {
      totalBlacklisted: keys.length,
      pattern
    };
  } catch (error) {
    logger.error('Failed to get blacklist stats', {
      error: error.message
    });
    return {
      totalBlacklisted: 0,
      error: error.message
    };
  }
};

module.exports = {
  addToBlacklist,
  isBlacklisted,
  removeFromBlacklist,
  clearUserTokens,
  addBulkToBlacklist,
  getBlacklistStats
};
