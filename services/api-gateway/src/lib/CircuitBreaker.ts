import { EventEmitter } from 'events';
import logger from '../../../../shared/logger';

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerOptions {
  failureThreshold?: number;
  successThreshold?: number;
  timeout?: number;
  resetTimeout?: number;
  volumeThreshold?: number;
}

interface CircuitBreakerStats {
  totalRequests: number;
  totalFailures: number;
  totalSuccesses: number;
  totalTimeouts: number;
  totalRejections: number;
  lastError: string | null;
}

export class CircuitBreaker extends EventEmitter {
  private serviceName: string;
  private state: CircuitState = 'CLOSED';
  private failureThreshold: number;
  private successThreshold: number;
  private timeout: number;
  private resetTimeout: number;
  private volumeThreshold: number;
  private failures = 0;
  private successes = 0;
  private requestCount = 0;
  private nextAttempt = Date.now();
  private stats: CircuitBreakerStats = {
    totalRequests: 0,
    totalFailures: 0,
    totalSuccesses: 0,
    totalTimeouts: 0,
    totalRejections: 0,
    lastError: null
  };

  constructor(serviceName: string, options: CircuitBreakerOptions = {}) {
    super();
    this.serviceName = serviceName;
    this.failureThreshold = options.failureThreshold || 5;
    this.successThreshold = options.successThreshold || 2;
    this.timeout = options.timeout || 3000;
    this.resetTimeout = options.resetTimeout || 30000;
    this.volumeThreshold = options.volumeThreshold || 10;
  }

  async execute<T>(fn: () => Promise<T>, fallback?: (() => Promise<T>) | null): Promise<T> {
    this.stats.totalRequests++;
    this.requestCount++;

    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        this.stats.totalRejections++;
        const error = new Error(`Circuit breaker OPEN for ${this.serviceName}`) as Error & { code: string };
        error.code = 'CIRCUIT_OPEN';

        if (fallback) {
          logger.warn('Circuit breaker OPEN, using fallback', {
            service: this.serviceName,
            nextAttempt: new Date(this.nextAttempt).toISOString()
          });
          return await fallback();
        }
        throw error;
      }

      this.state = 'HALF_OPEN';
      this.successes = 0;
      this.emit('halfOpen', { service: this.serviceName });
      logger.info(`Circuit breaker HALF_OPEN for ${this.serviceName}`);
    }

    try {
      const result = await this._executeWithTimeout(fn, this.timeout);
      this._onSuccess();
      return result;
    } catch (error: any) {
      this._onFailure(error);
      if (fallback) {
        logger.warn('Request failed, using fallback', { service: this.serviceName, error: error.message });
        return await fallback();
      }
      throw error;
    }
  }

  private _executeWithTimeout<T>(fn: () => Promise<T>, timeout: number): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          const error = new Error('Request timeout') as Error & { code: string };
          error.code = 'ETIMEDOUT';
          reject(error);
        }, timeout);
      })
    ]);
  }

  private _onSuccess(): void {
    this.failures = 0;
    this.stats.totalSuccesses++;

    if (this.state === 'HALF_OPEN') {
      this.successes++;
      if (this.successes >= this.successThreshold) {
        this._close();
      }
    }
  }

  private _onFailure(error: Error & { code?: string }): void {
    this.failures++;
    this.stats.totalFailures++;
    this.stats.lastError = error.message;

    if (error.code === 'ETIMEDOUT') {
      this.stats.totalTimeouts++;
    }

    logger.warn('Circuit breaker request failed', {
      service: this.serviceName,
      state: this.state,
      failures: this.failures,
      error: error.message
    });

    if (this.state === 'HALF_OPEN') {
      this._open();
      return;
    }

    if (this.requestCount >= this.volumeThreshold && this.failures >= this.failureThreshold) {
      this._open();
    }
  }

  private _open(): void {
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

  private _close(): void {
    const previousState = this.state;
    this.state = 'CLOSED';
    this.failures = 0;
    this.successes = 0;
    this.requestCount = 0;

    this.emit('close', { service: this.serviceName, previousState });
    logger.info(`Circuit breaker CLOSED for ${this.serviceName} - service recovered`);
  }

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

  getState(): CircuitState {
    return this.state;
  }

  reset(): void {
    this.state = 'CLOSED';
    this.failures = 0;
    this.successes = 0;
    this.requestCount = 0;
    logger.info(`Circuit breaker manually reset for ${this.serviceName}`);
  }
}

export default CircuitBreaker;
