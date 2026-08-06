import logger from '../../../../shared/logger';

interface BulkheadOptions {
  maxConcurrent?: number;
  maxQueueDepth?: number;
}

interface QueueItem<T> {
  fn: () => Promise<T>;
  context: Record<string, any>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  enqueuedAt: number;
}

interface BulkheadStats {
  totalRequests: number;
  totalRejected: number;
  totalCompleted: number;
  maxQueueDepth: number;
  maxActiveCount: number;
}

export class BulkheadIsolator {
  private serviceName: string;
  private maxConcurrent: number;
  private maxQueueDepth: number;
  private activeCount = 0;
  private queue: QueueItem<any>[] = [];
  private stats: BulkheadStats = {
    totalRequests: 0,
    totalRejected: 0,
    totalCompleted: 0,
    maxQueueDepth: 0,
    maxActiveCount: 0
  };

  constructor(serviceName: string, options: BulkheadOptions = {}) {
    this.serviceName = serviceName;
    this.maxConcurrent = options.maxConcurrent || 50;
    this.maxQueueDepth = options.maxQueueDepth || 100;
  }

  async execute<T>(fn: () => Promise<T>, context: Record<string, any> = {}): Promise<T> {
    this.stats.totalRequests++;

    if (this.activeCount >= this.maxConcurrent && this.queue.length >= this.maxQueueDepth) {
      this.stats.totalRejected++;

      logger.warn(`Bulkhead queue full for ${this.serviceName}`, {
        service: this.serviceName,
        activeCount: this.activeCount,
        queueDepth: this.queue.length,
        maxConcurrent: this.maxConcurrent,
        maxQueueDepth: this.maxQueueDepth
      });

      const error = new Error(`Service ${this.serviceName} is overloaded`) as Error & {
        code: string;
        statusCode: number;
        queueDepth: number;
        activeCount: number;
      };
      error.code = 'BULKHEAD_FULL';
      error.statusCode = 503;
      error.queueDepth = this.queue.length;
      error.activeCount = this.activeCount;
      throw error;
    }

    if (this.activeCount < this.maxConcurrent) {
      return await this._executeImmediate(fn);
    }

    return await this._enqueue(fn, context);
  }

  private async _executeImmediate<T>(fn: () => Promise<T>): Promise<T> {
    this.activeCount++;
    this._updateStats();

    try {
      const result = await fn();
      this.stats.totalCompleted++;
      return result;
    } finally {
      this.activeCount--;
      this._processQueue();
    }
  }

  private _enqueue<T>(fn: () => Promise<T>, context: Record<string, any>): Promise<T> {
    return new Promise((resolve, reject) => {
      const queueItem: QueueItem<T> = {
        fn,
        context,
        resolve,
        reject,
        enqueuedAt: Date.now()
      };

      this.queue.push(queueItem);
      this._updateStats();

      logger.debug(`Request queued for ${this.serviceName}`, {
        service: this.serviceName,
        queueDepth: this.queue.length,
        activeCount: this.activeCount
      });
    });
  }

  private _processQueue(): void {
    if (this.queue.length === 0 || this.activeCount >= this.maxConcurrent) return;

    const item = this.queue.shift()!;
    const waitTime = Date.now() - item.enqueuedAt;

    logger.debug(`Processing queued request for ${this.serviceName}`, {
      service: this.serviceName,
      waitTimeMs: waitTime,
      remainingQueue: this.queue.length
    });

    this.activeCount++;
    this._updateStats();

    item.fn()
      .then(result => {
        item.resolve(result);
        this.stats.totalCompleted++;
      })
      .catch(error => item.reject(error))
      .finally(() => {
        this.activeCount--;
        this._processQueue();
      });
  }

  private _updateStats(): void {
    if (this.queue.length > this.stats.maxQueueDepth) {
      this.stats.maxQueueDepth = this.queue.length;
    }
    if (this.activeCount > this.stats.maxActiveCount) {
      this.stats.maxActiveCount = this.activeCount;
    }
  }

  getState() {
    return {
      service: this.serviceName,
      activeCount: this.activeCount,
      queueDepth: this.queue.length,
      maxConcurrent: this.maxConcurrent,
      maxQueueDepth: this.maxQueueDepth,
      utilization: (this.activeCount / this.maxConcurrent * 100).toFixed(2) + '%',
      stats: { ...this.stats }
    };
  }

  getMetrics() {
    return {
      service: this.serviceName,
      gauge: {
        activeCount: this.activeCount,
        queueDepth: this.queue.length,
        utilizationPercent: (this.activeCount / this.maxConcurrent * 100)
      },
      counter: {
        totalRequests: this.stats.totalRequests,
        totalRejected: this.stats.totalRejected,
        totalCompleted: this.stats.totalCompleted
      },
      max: {
        maxQueueDepth: this.stats.maxQueueDepth,
        maxActiveCount: this.stats.maxActiveCount
      }
    };
  }

  resetStats(): void {
    this.stats = {
      totalRequests: 0,
      totalRejected: 0,
      totalCompleted: 0,
      maxQueueDepth: 0,
      maxActiveCount: 0
    };
  }
}

export default BulkheadIsolator;
