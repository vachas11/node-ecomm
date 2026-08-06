import logger from '../../../../shared/logger';

interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffFactor?: number;
  jitter?: boolean;
}

interface RetryContext {
  [key: string]: any;
}

export class RetryStrategy {
  private maxRetries: number;
  private initialDelay: number;
  private maxDelay: number;
  private backoffFactor: number;
  private jitter: boolean;
  private nonRetriableErrors: Set<string>;
  private nonRetriableStatusCodes: Set<number>;

  constructor(options: RetryOptions = {}) {
    this.maxRetries = options.maxRetries || 3;
    this.initialDelay = options.initialDelay || 100;
    this.maxDelay = options.maxDelay || 2000;
    this.backoffFactor = options.backoffFactor || 2;
    this.jitter = options.jitter !== undefined ? options.jitter : true;

    this.nonRetriableErrors = new Set(['ENOTFOUND', 'INVALID_TOKEN', 'CIRCUIT_OPEN']);
    this.nonRetriableStatusCodes = new Set([400, 401, 403, 404, 405, 422]);
  }

  async execute<T>(fn: (attempt: number) => Promise<T>, context: RetryContext = {}): Promise<T> {
    let lastError: Error | null = null;
    let attempt = 0;

    while (attempt < this.maxRetries) {
      try {
        const result = await fn(attempt);

        if (attempt > 0) {
          logger.info(`Request succeeded after ${attempt} retries`, context);
        }

        return result;
      } catch (error: any) {
        lastError = error;
        attempt++;

        if (!this._shouldRetry(error, attempt)) {
          logger.debug('Error not retriable', {
            ...context,
            error: error.message,
            code: error.code,
            statusCode: error.response?.status,
            attempt
          });
          throw error;
        }

        if (attempt >= this.maxRetries) {
          logger.warn('Max retries reached', { ...context, attempts: attempt, error: error.message });
          break;
        }

        const delay = this._calculateDelay(attempt);

        logger.warn('Request failed, retrying', {
          ...context,
          attempt,
          maxRetries: this.maxRetries,
          delayMs: delay,
          error: error.message,
          code: error.code
        });

        await this._sleep(delay);
      }
    }

    throw lastError;
  }

  private _shouldRetry(error: Error & { code?: string; response?: { status: number } }, attempt: number): boolean {
    if (attempt >= this.maxRetries) return false;
    if (error.code && this.nonRetriableErrors.has(error.code)) return false;

    if (error.response?.status) {
      const status = error.response.status;
      if (this.nonRetriableStatusCodes.has(status)) return false;
      if (status >= 500 || status === 429) return true;
    }

    const retriableNetworkErrors = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN'];
    if (error.code && retriableNetworkErrors.includes(error.code)) return true;

    return false;
  }

  private _calculateDelay(attempt: number): number {
    let delay = this.initialDelay * Math.pow(this.backoffFactor, attempt - 1);
    delay = Math.min(delay, this.maxDelay);

    if (this.jitter) {
      const jitterAmount = delay * 0.25;
      const jitterOffset = (Math.random() * jitterAmount * 2) - jitterAmount;
      delay = delay + jitterOffset;
    }

    return Math.floor(delay);
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  addNonRetriableError(errorCode: string): void {
    this.nonRetriableErrors.add(errorCode);
  }

  addNonRetriableStatus(statusCode: number): void {
    this.nonRetriableStatusCodes.add(statusCode);
  }
}

export default RetryStrategy;
