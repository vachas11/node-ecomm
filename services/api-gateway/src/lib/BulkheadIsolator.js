/**
 * Bulkhead Isolation Pattern
 *
 * Prevents one slow/failing service from consuming all resources.
 * Limits concurrent requests per service with queue management.
 *
 * Production benefits:
 * - Prevents resource exhaustion
 * - Isolates service failures
 * - Maintains gateway responsiveness
 * - Queue depth monitoring
 */

const logger = require('../../../../../shared/logger');

class BulkheadIsolator {
  constructor(serviceName, options = {}) {
    this.serviceName = serviceName;
    this.maxConcurrent = options.maxConcurrent || 50;
    this.maxQueueDepth = options.maxQueueDepth || 100;

    // State
    this.activeCount = 0;
    this.queue = [];
    this.rejectedCount = 0;

    // Stats
    this.stats = {
      totalRequests: 0,
      totalRejected: 0,
      totalCompleted: 0,
      maxQueueDepth: 0,
      maxActiveCount: 0
    };
  }

  /**
   * Execute function with bulkhead isolation
   */
  async execute(fn, context = {}) {
    this.stats.totalRequests++;

    // Check if queue is full
    if (this.activeCount >= this.maxConcurrent &&
        this.queue.length >= this.maxQueueDepth) {
      this.stats.totalRejected++;
      this.rejectedCount++;

      logger.warn(`Bulkhead queue full for ${this.serviceName}`, {
        service: this.serviceName,
        activeCount: this.activeCount,
        queueDepth: this.queue.length,
        maxConcurrent: this.maxConcurrent,
        maxQueueDepth: this.maxQueueDepth
      });

      const error = new Error(`Service ${this.serviceName} is overloaded`);
      error.code = 'BULKHEAD_FULL';
      error.statusCode = 503;
      error.queueDepth = this.queue.length;
      error.activeCount = this.activeCount;
      throw error;
    }

    // If under limit, execute immediately
    if (this.activeCount < this.maxConcurrent) {
      return await this._executeImmediate(fn, context);
    }

    // Queue the request
    return await this._enqueue(fn, context);
  }

  /**
   * Execute function immediately (no queue)
   */
  async _executeImmediate(fn, context) {
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

  /**
   * Add request to queue
   */
  _enqueue(fn, context) {
    return new Promise((resolve, reject) => {
      const queueItem = {
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

  /**
   * Process next item in queue
   */
  _processQueue() {
    if (this.queue.length === 0 || this.activeCount >= this.maxConcurrent) {
      return;
    }

    const item = this.queue.shift();
    const waitTime = Date.now() - item.enqueuedAt;

    logger.debug(`Processing queued request for ${this.serviceName}`, {
      service: this.serviceName,
      waitTimeMs: waitTime,
      remainingQueue: this.queue.length
    });

    this.activeCount++;
    this._updateStats();

    // Execute the queued function
    item.fn()
      .then(result => {
        item.resolve(result);
        this.stats.totalCompleted++;
      })
      .catch(error => {
        item.reject(error);
      })
      .finally(() => {
        this.activeCount--;
        this._processQueue();
      });
  }

  /**
   * Update statistics
   */
  _updateStats() {
    if (this.queue.length > this.stats.maxQueueDepth) {
      this.stats.maxQueueDepth = this.queue.length;
    }

    if (this.activeCount > this.stats.maxActiveCount) {
      this.stats.maxActiveCount = this.activeCount;
    }
  }

  /**
   * Get current state
   */
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

  /**
   * Get metrics for monitoring
   */
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

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalRequests: 0,
      totalRejected: 0,
      totalCompleted: 0,
      maxQueueDepth: 0,
      maxActiveCount: 0
    };
    this.rejectedCount = 0;
  }
}

module.exports = BulkheadIsolator;
