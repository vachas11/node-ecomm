/**
 * Retry Strategy with Exponential Backoff
 *
 * Handles transient failures by retrying requests with exponential backoff and jitter.
 *
 * Production features:
 * - Exponential backoff (prevents thundering herd)
 * - Jitter (spreads retries across time)
 * - Configurable retry conditions
 * - Per-error-type retry logic
 * - Max retry limits
 */

const logger = require('../../../../../shared/logger');

class RetryStrategy {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 3;
    this.initialDelay = options.initialDelay || 100; // ms
    this.maxDelay = options.maxDelay || 2000; // ms
    this.backoffFactor = options.backoffFactor || 2;
    this.jitter = options.jitter !== undefined ? options.jitter : true;

    // Errors that should NOT be retried
    this.nonRetriableErrors = new Set([
      'ENOTFOUND', // DNS resolution failed
      'INVALID_TOKEN',
      'CIRCUIT_OPEN'
    ]);

    // HTTP status codes that should NOT be retried (client errors)
    this.nonRetriableStatusCodes = new Set([
      400, // Bad Request
      401, // Unauthorized
      403, // Forbidden
      404, // Not Found
      405, // Method Not Allowed
      422  // Unprocessable Entity
    ]);
  }

  /**
   * Execute function with retry logic
   */
  async execute(fn, context = {}) {
    let lastError;
    let attempt = 0;

    while (attempt < this.maxRetries) {
      try {
        const result = await fn(attempt);

        // Success - log if retried
        if (attempt > 0) {
          logger.info(`Request succeeded after ${attempt} retries`, context);
        }

        return result;

      } catch (error) {
        lastError = error;
        attempt++;

        // Check if error is retriable
        if (!this._shouldRetry(error, attempt)) {
          logger.debug(`Error not retriable`, {
            ...context,
            error: error.message,
            code: error.code,
            statusCode: error.response?.status,
            attempt
          });
          throw error;
        }

        // Max retries reached
        if (attempt >= this.maxRetries) {
          logger.warn(`Max retries reached`, {
            ...context,
            attempts: attempt,
            error: error.message
          });
          break;
        }

        // Calculate delay
        const delay = this._calculateDelay(attempt);

        logger.warn(`Request failed, retrying`, {
          ...context,
          attempt,
          maxRetries: this.maxRetries,
          delayMs: delay,
          error: error.message,
          code: error.code
        });

        // Wait before retry
        await this._sleep(delay);
      }
    }

    // All retries failed
    throw lastError;
  }

  /**
   * Determine if error should be retried
   */
  _shouldRetry(error, attempt) {
    // Don't retry if max attempts reached
    if (attempt >= this.maxRetries) {
      return false;
    }

    // Check error code
    if (error.code && this.nonRetriableErrors.has(error.code)) {
      return false;
    }

    // Check HTTP status code
    if (error.response?.status) {
      const status = error.response.status;

      // Don't retry 4xx errors (client errors)
      if (this.nonRetriableStatusCodes.has(status)) {
        return false;
      }

      // Retry 5xx (server errors) and 429 (rate limit)
      if (status >= 500 || status === 429) {
        return true;
      }
    }

    // Retry network errors
    const retriableNetworkErrors = [
      'ECONNREFUSED',
      'ECONNRESET',
      'ETIMEDOUT',
      'ECONNABORTED',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'EAI_AGAIN'
    ];

    if (error.code && retriableNetworkErrors.includes(error.code)) {
      return true;
    }

    // Default: don't retry unknown errors
    return false;
  }

  /**
   * Calculate delay with exponential backoff and jitter
   */
  _calculateDelay(attempt) {
    // Exponential backoff: initialDelay * (backoffFactor ^ attempt)
    let delay = this.initialDelay * Math.pow(this.backoffFactor, attempt - 1);

    // Cap at max delay
    delay = Math.min(delay, this.maxDelay);

    // Add jitter (randomize ±25% to prevent thundering herd)
    if (this.jitter) {
      const jitterAmount = delay * 0.25;
      const jitterOffset = (Math.random() * jitterAmount * 2) - jitterAmount;
      delay = delay + jitterOffset;
    }

    return Math.floor(delay);
  }

  /**
   * Sleep for specified milliseconds
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Add custom non-retriable error
   */
  addNonRetriableError(errorCode) {
    this.nonRetriableErrors.add(errorCode);
  }

  /**
   * Add custom non-retriable status code
   */
  addNonRetriableStatus(statusCode) {
    this.nonRetriableStatusCodes.add(statusCode);
  }
}

module.exports = RetryStrategy;
