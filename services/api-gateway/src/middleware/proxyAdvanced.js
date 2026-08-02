/**
 * Production-Grade HTTP Proxy Middleware
 *
 * Integrates:
 * - Circuit breaker (fail fast when service is down)
 * - Retry with exponential backoff (handle transient failures)
 * - Connection pooling (reuse TCP connections)
 * - Bulkhead isolation (prevent resource exhaustion)
 * - Request timeout (per-service configuration)
 * - Fallback responses
 *
 * This is what you'd see at Netflix, Amazon, Google, etc.
 */

const axios = require('axios');
const { getService } = require('../config/services');
const logger = require('../../../../../shared/logger');
const CircuitBreaker = require('../lib/CircuitBreaker');
const RetryStrategy = require('../lib/RetryStrategy');
const BulkheadIsolator = require('../lib/BulkheadIsolator');
const connectionPool = require('../lib/ConnectionPool');

// Circuit breaker instances per service
const circuitBreakers = new Map();

// Retry strategy instances per service
const retryStrategies = new Map();

// Bulkhead isolators per service
const bulkheads = new Map();

/**
 * Get or create circuit breaker for a service
 */
function getCircuitBreaker(serviceName) {
  if (!circuitBreakers.has(serviceName)) {
    const breaker = new CircuitBreaker(serviceName, {
      failureThreshold: 5,      // Open after 5 failures
      successThreshold: 2,       // Close after 2 successes in half-open
      timeout: 5000,             // 5 second request timeout
      resetTimeout: 30000,       // Try half-open after 30s
      volumeThreshold: 10        // Min 10 requests before calculating
    });

    // Monitor circuit breaker events
    breaker.on('open', (data) => {
      logger.error(`🚨 Circuit breaker OPEN`, data);

      // TODO: Send alert to PagerDuty/Slack
      // alerting.trigger({
      //   severity: 'critical',
      //   service: data.service,
      //   message: 'Circuit breaker opened - service degraded'
      // });
    });

    breaker.on('halfOpen', (data) => {
      logger.warn(`⚠️  Circuit breaker HALF_OPEN - testing recovery`, data);
    });

    breaker.on('close', (data) => {
      logger.info(`✅ Circuit breaker CLOSED - service recovered`, data);
    });

    circuitBreakers.set(serviceName, breaker);
  }

  return circuitBreakers.get(serviceName);
}

/**
 * Get or create retry strategy for a service
 */
function getRetryStrategy(serviceName) {
  if (!retryStrategies.has(serviceName)) {
    const retry = new RetryStrategy({
      maxRetries: 3,
      initialDelay: 100,
      maxDelay: 2000,
      backoffFactor: 2,
      jitter: true
    });

    retryStrategies.set(serviceName, retry);
  }

  return retryStrategies.get(serviceName);
}

/**
 * Get or create bulkhead isolator for a service
 */
function getBulkhead(serviceName) {
  if (!bulkheads.has(serviceName)) {
    // Different limits per service type
    const limits = {
      user: 50,      // User service: 50 concurrent
      product: 100,  // Product service: 100 concurrent (read-heavy)
      order: 30      // Order service: 30 concurrent (write-heavy, slower)
    };

    const bulkhead = new BulkheadIsolator(serviceName, {
      maxConcurrent: limits[serviceName] || 50,
      maxQueueDepth: 100
    });

    bulkheads.set(serviceName, bulkhead);
  }

  return bulkheads.get(serviceName);
}

/**
 * Production-grade proxy middleware
 */
const proxyAdvanced = (serviceName, pathRewrite, options = {}) => {
  return async (req, res, next) => {
    const startTime = Date.now();
    const requestId = req.id || req.headers['x-request-id'] || 'unknown';

    try {
      // Get service configuration
      const service = getService(serviceName);

      // Get resilience components
      const circuitBreaker = getCircuitBreaker(serviceName);
      const retryStrategy = getRetryStrategy(serviceName);
      const bulkhead = getBulkhead(serviceName);

      // Build target URL
      let targetPath = req.path;
      if (pathRewrite) {
        if (typeof pathRewrite === 'function') {
          targetPath = pathRewrite(req.path);
        } else if (typeof pathRewrite === 'string') {
          targetPath = pathRewrite;
        }
      }

      const targetUrl = `${service.url}${targetPath}`;

      logger.debug('Proxying request', {
        requestId,
        method: req.method,
        originalPath: req.path,
        targetUrl,
        service: serviceName
      });

      // Prepare headers
      const headers = {
        ...req.headers,
        'x-forwarded-for': req.ip,
        'x-forwarded-host': req.hostname,
        'x-forwarded-proto': req.protocol,
        'x-gateway': 'true',
        'x-request-id': requestId
      };

      // Attach user context if authenticated
      if (req.user) {
        headers['x-user-id'] = req.user.userId;
        headers['x-user-email'] = req.user.email;
        headers['x-user-role'] = req.user.role;
      }

      // Remove host header to avoid conflicts
      delete headers.host;

      // Get HTTP agent from connection pool
      const httpAgent = connectionPool.getAgent(serviceName, service.url);

      // Execute with bulkhead isolation
      const response = await bulkhead.execute(async () => {
        // Execute with circuit breaker + retry
        return await circuitBreaker.execute(
          async () => {
            // Retry strategy wraps the actual request
            return await retryStrategy.execute(
              async (attemptNumber) => {
                const attemptStartTime = Date.now();

                try {
                  const axiosResponse = await axios({
                    method: req.method,
                    url: targetUrl,
                    data: req.body,
                    params: req.query,
                    headers,
                    httpAgent,
                    httpsAgent: httpAgent,
                    timeout: options.timeout || 5000, // 5s default
                    validateStatus: () => true // Accept all status codes
                  });

                  const attemptDuration = Date.now() - attemptStartTime;

                  // Log slow requests
                  if (attemptDuration > 1000) {
                    logger.warn('Slow service response', {
                      requestId,
                      service: serviceName,
                      durationMs: attemptDuration,
                      status: axiosResponse.status
                    });
                  }

                  // Throw error for 5xx status codes (will trigger retry)
                  if (axiosResponse.status >= 500) {
                    const error = new Error(`Service returned ${axiosResponse.status}`);
                    error.response = axiosResponse;
                    throw error;
                  }

                  return axiosResponse;

                } catch (error) {
                  const attemptDuration = Date.now() - attemptStartTime;

                  logger.debug('Request attempt failed', {
                    requestId,
                    service: serviceName,
                    attempt: attemptNumber,
                    durationMs: attemptDuration,
                    error: error.message,
                    code: error.code
                  });

                  throw error;
                }
              },
              { requestId, service: serviceName, method: req.method, path: req.path }
            );
          },
          // Fallback function (optional)
          options.fallback ? () => options.fallback(req) : null
        );
      }, { requestId, service: serviceName });

      const totalDuration = Date.now() - startTime;

      // Log request completion
      logger.info('Request completed', {
        requestId,
        service: serviceName,
        method: req.method,
        path: req.path,
        status: response.status,
        durationMs: totalDuration
      });

      // Forward response headers (except some)
      const excludeHeaders = ['transfer-encoding', 'connection', 'keep-alive'];
      Object.keys(response.headers || {}).forEach(header => {
        if (!excludeHeaders.includes(header.toLowerCase())) {
          res.set(header, response.headers[header]);
        }
      });

      // Add custom headers
      res.set('X-Gateway-Time', totalDuration.toString());
      res.set('X-Service-Name', serviceName);

      // Return response
      res.status(response.status).json(response.data);

    } catch (error) {
      const totalDuration = Date.now() - startTime;

      // Handle different error types
      if (error.code === 'CIRCUIT_OPEN') {
        logger.warn('Circuit breaker open', {
          requestId,
          service: serviceName,
          durationMs: totalDuration
        });

        return res.status(503).json({
          success: false,
          error: {
            message: `${serviceName} service is temporarily unavailable`,
            code: 'SERVICE_UNAVAILABLE',
            statusCode: 503,
            requestId
          }
        });
      }

      if (error.code === 'BULKHEAD_FULL') {
        logger.warn('Bulkhead full', {
          requestId,
          service: serviceName,
          activeCount: error.activeCount,
          queueDepth: error.queueDepth
        });

        return res.status(503).json({
          success: false,
          error: {
            message: `${serviceName} service is overloaded`,
            code: 'SERVICE_OVERLOADED',
            statusCode: 503,
            requestId
          }
        });
      }

      if (error.code === 'ECONNREFUSED') {
        logger.error('Service connection refused', {
          requestId,
          service: serviceName,
          durationMs: totalDuration
        });

        return res.status(503).json({
          success: false,
          error: {
            message: 'Service temporarily unavailable',
            code: 'CONNECTION_REFUSED',
            statusCode: 503,
            service: serviceName,
            requestId
          }
        });
      }

      if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
        logger.error('Service timeout', {
          requestId,
          service: serviceName,
          durationMs: totalDuration
        });

        return res.status(504).json({
          success: false,
          error: {
            message: 'Service request timeout',
            code: 'GATEWAY_TIMEOUT',
            statusCode: 504,
            service: serviceName,
            requestId
          }
        });
      }

      // Log unexpected errors
      logger.error('Gateway proxy error', {
        requestId,
        service: serviceName,
        error: error.message,
        stack: error.stack,
        durationMs: totalDuration
      });

      res.status(500).json({
        success: false,
        error: {
          message: 'Gateway error',
          code: 'GATEWAY_ERROR',
          statusCode: 500,
          requestId
        }
      });
    }
  };
};

/**
 * Get health status of all resilience components
 */
function getResilienceHealth() {
  const health = {
    circuitBreakers: {},
    bulkheads: {},
    connectionPools: connectionPool.getHealth()
  };

  // Circuit breaker stats
  for (const [service, breaker] of circuitBreakers.entries()) {
    health.circuitBreakers[service] = breaker.getStats();
  }

  // Bulkhead stats
  for (const [service, bulkhead] of bulkheads.entries()) {
    health.bulkheads[service] = bulkhead.getState();
  }

  return health;
}

/**
 * Reset all circuit breakers (manual recovery)
 */
function resetCircuitBreakers() {
  for (const breaker of circuitBreakers.values()) {
    breaker.reset();
  }
  logger.info('All circuit breakers manually reset');
}

module.exports = proxyAdvanced;
module.exports.getResilienceHealth = getResilienceHealth;
module.exports.resetCircuitBreakers = resetCircuitBreakers;
