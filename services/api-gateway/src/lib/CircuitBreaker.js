/**
 * Circuit Breaker Pattern Implementation
 *
 * Prevents cascade failures by failing fast when a service is down.
 * Three states: CLOSED (normal), OPEN (failing), HALF_OPEN (testing recovery)
 *
 * Production-grade features:
 * - Per-service circuit breakers
 * - Configurable thresholds and timeouts
 * - Fallback responses
 * - Health monitoring
 * - Event emission for observability
 */

const EventEmitter = require('events');
const logger = require('../../../../../shared/logger');

class CircuitBreaker extends EventEmitter {
  constructor(serviceName, options = {}) {
    super();

    this.serviceName = serviceName;
    this.state = 'CLOSED'; // CLOSED | OPEN | HALF_OPEN

    // Configuration
    this.failureThreshold = options.failureThreshold || 5; // failures before opening
    this.successThreshold = options.successThreshold || 2; // successes to close from half-open
    this.timeout = options.timeout || 3000; // request timeout (ms)
    this.resetTimeout = options.resetTimeout || 30000; // time before trying half-open (ms)
    this.volumeThreshold = options.volumeThreshold || 10; // min requests before calculating

    // State tracking
    this.failures = 0;
    this.successes = 0;
    this.requestCount = 0;
    this.nextAttempt = Date.now();
    this.lastFailureTime = null;

    // Metrics (rolling window)
    this.stats = {
      totalRequests: 0,
      totalFailures: 0,
      totalSuccesses: 0,
      totalTimeouts: 0,
      totalRejections: 0,
      lastError: null
    };
  }

  /**
   * Execute a function through the circuit breaker
   */
  async execute(fn, fallback = null) {
    this.stats.totalRequests++;
    this.requestCount++;

    // If circuit is OPEN, fail fast
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        this.stats.totalRejections++;

        const error = new Error(`Circuit breaker OPEN for ${this.serviceName}`);
        error.code = 'CIRCUIT_OPEN';

        // Use fallback if provided
        if (fallback && typeof fallback === 'function') {
          logger.warn(`Circuit breaker OPEN, using fallback`, {
            service: this.serviceName,
            nextAttempt: new Date(this.nextAttempt).toISOString()
          });
          return await fallback();
        }

        throw error;
      }

      // Timeout expired, try HALF_OPEN
      this.state = 'HALF_OPEN';
      this.successes = 0;
      this.emit('halfOpen', { service: this.serviceName });
      logger.info(`Circuit breaker HALF_OPEN for ${this.serviceName}`);
    }

    try {
      // Execute with timeout
      const result = await this._executeWithTimeout(fn, this.timeout);

      // Request succeeded
      this._onSuccess();

      return result;

    } catch (error) {
      // Request failed
      this._onFailure(error);

      // Use fallback if provided
      if (fallback && typeof fallback === 'function') {
        logger.warn(`Request failed, using fallback`, {
          service: this.serviceName,
          error: error.message
        });
        return await fallback();
      }

      throw error;
    }
  }

  /**
   * Execute function with timeout
   */
  _executeWithTimeout(fn, timeout) {
    return Promise.race([
      fn(),
      new Promise((_, reject) => {
        setTimeout(() => {
          const error = new Error('Request timeout');
          error.code = 'ETIMEDOUT';
          reject(error);
        }, timeout);
      })
    ]);
  }

  /**
   * Handle successful request
   */
  _onSuccess() {
    this.failures = 0;
    this.stats.totalSuccesses++;

    if (this.state === 'HALF_OPEN') {
      this.successes++;

      // Enough successes to close circuit
      if (this.successes >= this.successThreshold) {
        this._close();
      }
    }
  }

  /**
   * Handle failed request
   */
  _onFailure(error) {
    this.failures++;
    this.stats.totalFailures++;
    this.stats.lastError = error.message;
    this.lastFailureTime = Date.now();

    if (error.code === 'ETIMEDOUT') {
      this.stats.totalTimeouts++;
    }

    logger.warn(`Circuit breaker request failed`, {
      service: this.serviceName,
      state: this.state,
      failures: this.failures,
      error: error.message
    });

    // If HALF_OPEN, fail immediately back to OPEN
    if (this.state === 'HALF_OPEN') {
      this._open();
      return;
    }

    // If enough volume and failures, open circuit
    if (this.requestCount >= this.volumeThreshold &&
        this.failures >= this.failureThreshold) {
      this._open();
    }
  }

  /**
   * Open the circuit (start failing fast)
   */
  _open() {
    this.state = 'OPEN';
    this.nextAttempt = Date.now() + this.resetTimeout;

    this.emit('open', {
      service: this.serviceName,
      failures: this.failures,
      lastError: this.stats.lastError,
      nextAttempt: new Date(this.nextAttempt).toISOString()
    });

    logger.error(`Circuit breaker OPEN for ${this.serviceName}`, {
      failures: this.failures,
      totalRequests: this.requestCount,
      nextAttempt: new Date(this.nextAttempt).toISOString()
    });
  }

  /**
   * Close the circuit (back to normal)
   */
  _close() {
    const previousState = this.state;
    this.state = 'CLOSED';
    this.failures = 0;
    this.successes = 0;
    this.requestCount = 0;

    this.emit('close', {
      service: this.serviceName,
      previousState
    });

    logger.info(`Circuit breaker CLOSED for ${this.serviceName} - service recovered`);
  }

  /**
   * Get current state and stats
   */
  getStats() {
    return {
      service: this.serviceName,
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      requestCount: this.requestCount,
      nextAttempt: this.state === 'OPEN' ? new Date(this.nextAttempt).toISOString() : null,
      stats: { ...this.stats }
    };
  }

  /**
   * Manually reset circuit breaker
   */
  reset() {
    this.state = 'CLOSED';
    this.failures = 0;
    this.successes = 0;
    this.requestCount = 0;

    logger.info(`Circuit breaker manually reset for ${this.serviceName}`);
  }
}

module.exports = CircuitBreaker;
