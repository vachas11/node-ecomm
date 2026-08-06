import axios, { AxiosResponse } from 'axios';
import { Request, Response, NextFunction } from 'express';
import { getService } from '../config/services';
import config from '../config';
import logger from '../../../../shared/logger';
import CircuitBreaker from '../lib/CircuitBreaker';
import RetryStrategy from '../lib/RetryStrategy';
import BulkheadIsolator from '../lib/BulkheadIsolator';
import connectionPool from '../lib/ConnectionPool';
import * as metrics from '../lib/Metrics';

interface AuthenticatedRequest extends Request {
  id?: string;
  user?: { userId: number; email: string; role: string };
}

type PathRewrite = string | ((path: string) => string);

interface ProxyOptions {
  timeout?: number;
  fallback?: (req: Request) => { status: number; data: any; headers?: Record<string, string> };
}

const circuitBreakers = new Map<string, CircuitBreaker>();
const retryStrategies = new Map<string, RetryStrategy>();
const bulkheads = new Map<string, BulkheadIsolator>();

function getCircuitBreaker(serviceName: string): CircuitBreaker {
  if (!circuitBreakers.has(serviceName)) {
    const cbConfig = config.resilience.circuitBreaker;
    const breaker = new CircuitBreaker(serviceName, {
      failureThreshold: cbConfig.failureThreshold,
      successThreshold: cbConfig.successThreshold,
      timeout: cbConfig.timeout,
      resetTimeout: cbConfig.resetTimeout,
      volumeThreshold: cbConfig.volumeThreshold
    });

    breaker.on('open', (data: any) => logger.error('Circuit breaker OPEN', data));
    breaker.on('halfOpen', (data: any) => logger.warn('Circuit breaker HALF_OPEN - testing recovery', data));
    breaker.on('close', (data: any) => logger.info('Circuit breaker CLOSED - service recovered', data));

    circuitBreakers.set(serviceName, breaker);
  }
  return circuitBreakers.get(serviceName)!;
}

function getRetryStrategy(serviceName: string): RetryStrategy {
  if (!retryStrategies.has(serviceName)) {
    const retryConfig = config.resilience.retry;
    retryStrategies.set(serviceName, new RetryStrategy({
      maxRetries: retryConfig.maxRetries,
      initialDelay: retryConfig.initialDelay,
      maxDelay: retryConfig.maxDelay,
      backoffFactor: retryConfig.backoffFactor,
      jitter: retryConfig.jitter
    }));
  }
  return retryStrategies.get(serviceName)!;
}

function getBulkhead(serviceName: string): BulkheadIsolator {
  if (!bulkheads.has(serviceName)) {
    const bulkheadConfig = config.resilience.bulkhead[serviceName] || config.resilience.bulkhead.user;
    bulkheads.set(serviceName, new BulkheadIsolator(serviceName, {
      maxConcurrent: bulkheadConfig.maxConcurrent,
      maxQueueDepth: bulkheadConfig.maxQueueDepth
    }));
  }
  return bulkheads.get(serviceName)!;
}

const proxyAdvanced = (serviceName: string, pathRewrite?: PathRewrite, options: ProxyOptions = {}) => {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const startTime = Date.now();
    const requestId = req.id || req.headers['x-request-id'] as string || 'unknown';

    try {
      const service = getService(serviceName);
      const circuitBreaker = getCircuitBreaker(serviceName);
      const retryStrategy = getRetryStrategy(serviceName);
      const bulkhead = getBulkhead(serviceName);

      let targetPath = req.path;
      if (pathRewrite) {
        targetPath = typeof pathRewrite === 'function' ? pathRewrite(req.path) : pathRewrite;
      }

      const targetUrl = `${service.url}${targetPath}`;

      logger.debug('Proxying request', { requestId, method: req.method, originalPath: req.path, targetUrl, service: serviceName });

      const headers: Record<string, string> = {
        ...req.headers as Record<string, string>,
        'x-forwarded-for': req.ip || '',
        'x-forwarded-host': req.hostname,
        'x-forwarded-proto': req.protocol,
        'x-gateway': 'true',
        'x-request-id': requestId
      };

      if (req.user) {
        headers['x-user-id'] = String(req.user.userId);
        headers['x-user-email'] = req.user.email;
        headers['x-user-role'] = req.user.role;
      }

      delete headers.host;

      const httpAgent = connectionPool.getAgent(serviceName, service.url);
      const requestSize = req.headers['content-length'] ? parseInt(req.headers['content-length'] as string) : 0;

      const response = await bulkhead.execute(async () => {
        const bulkheadState = bulkhead.getState();
        metrics.recordBulkheadMetrics(serviceName, bulkheadState.activeCount, bulkheadState.queueDepth, bulkheadState.maxConcurrent);

        return await circuitBreaker.execute(
          async () => {
            metrics.recordCircuitBreakerState(serviceName, circuitBreaker.getState());

            return await retryStrategy.execute(async (attemptNumber) => {
              metrics.recordRetryAttempt(serviceName, req.method, req.path, attemptNumber);

              const axiosResponse = await axios({
                method: req.method as any,
                url: targetUrl,
                data: req.body,
                params: req.query,
                headers,
                httpAgent,
                httpsAgent: httpAgent,
                timeout: options.timeout || 5000,
                validateStatus: () => true
              });

              if (axiosResponse.status >= 500) {
                metrics.recordCircuitBreakerFailure(serviceName);
                const error = new Error(`Service returned ${axiosResponse.status}`) as Error & { response: AxiosResponse };
                error.response = axiosResponse;
                throw error;
              }

              metrics.recordCircuitBreakerSuccess(serviceName);
              if (attemptNumber > 1) metrics.recordRetrySuccess(serviceName, req.method, req.path);

              return axiosResponse;
            }, { requestId, service: serviceName, method: req.method, path: req.path });
          },
          options.fallback ? () => Promise.resolve(options.fallback!(req) as any) : null
        );
      }, { requestId, service: serviceName });

      const totalDuration = Date.now() - startTime;
      const responseSize = response.data ? JSON.stringify(response.data).length : 0;

      metrics.recordHttpRequest(serviceName, req.method, req.path, response.status, totalDuration, requestSize, responseSize);

      logger.info('Request completed', { requestId, service: serviceName, method: req.method, path: req.path, status: response.status, durationMs: totalDuration });

      const excludeHeaders = ['transfer-encoding', 'connection', 'keep-alive'];
      Object.keys(response.headers || {}).forEach(header => {
        if (!excludeHeaders.includes(header.toLowerCase())) {
          res.set(header, response.headers[header] as string);
        }
      });

      res.set('X-Gateway-Time', totalDuration.toString());
      res.set('X-Service-Name', serviceName);
      res.status(response.status).json(response.data);
    } catch (error: any) {
      const totalDuration = Date.now() - startTime;
      const statusCode = error.statusCode || (error.code === 'CIRCUIT_OPEN' ? 503 : error.code === 'BULKHEAD_FULL' ? 503 : error.code === 'ECONNREFUSED' ? 503 : error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED' ? 504 : 500);

      metrics.recordHttpRequest(serviceName, req.method, req.path, statusCode, totalDuration, req.headers['content-length'] ? parseInt(req.headers['content-length'] as string) : 0, 0);

      if (error.code === 'CIRCUIT_OPEN') {
        metrics.recordCircuitBreakerRejection(serviceName);
        logger.warn('Circuit breaker open', { requestId, service: serviceName, durationMs: totalDuration });
        res.status(503).json({ success: false, error: { message: `${serviceName} service is temporarily unavailable`, code: 'SERVICE_UNAVAILABLE', statusCode: 503, requestId } });
        return;
      }

      if (error.code === 'BULKHEAD_FULL') {
        metrics.recordBulkheadRejection(serviceName);
        logger.warn('Bulkhead full', { requestId, service: serviceName, activeCount: error.activeCount, queueDepth: error.queueDepth });
        res.status(503).json({ success: false, error: { message: `${serviceName} service is overloaded`, code: 'SERVICE_OVERLOADED', statusCode: 503, requestId } });
        return;
      }

      if (error.code === 'ECONNREFUSED') {
        logger.error('Service connection refused', { requestId, service: serviceName, durationMs: totalDuration });
        res.status(503).json({ success: false, error: { message: 'Service temporarily unavailable', code: 'CONNECTION_REFUSED', statusCode: 503, service: serviceName, requestId } });
        return;
      }

      if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
        logger.error('Service timeout', { requestId, service: serviceName, durationMs: totalDuration });
        res.status(504).json({ success: false, error: { message: 'Service request timeout', code: 'GATEWAY_TIMEOUT', statusCode: 504, service: serviceName, requestId } });
        return;
      }

      logger.error('Gateway proxy error', { requestId, service: serviceName, error: error.message, stack: error.stack, durationMs: totalDuration });
      res.status(500).json({ success: false, error: { message: 'Gateway error', code: 'GATEWAY_ERROR', statusCode: 500, requestId } });
    }
  };
};

export function getResilienceHealth() {
  const health: { circuitBreakers: Record<string, any>; bulkheads: Record<string, any>; connectionPools: any } = {
    circuitBreakers: {},
    bulkheads: {},
    connectionPools: connectionPool.getHealth()
  };

  for (const [service, breaker] of circuitBreakers.entries()) {
    health.circuitBreakers[service] = breaker.getStats();
  }

  for (const [service, bulkhead] of bulkheads.entries()) {
    health.bulkheads[service] = bulkhead.getState();
  }

  return health;
}

export function resetCircuitBreakers(): void {
  for (const breaker of circuitBreakers.values()) {
    breaker.reset();
  }
  logger.info('All circuit breakers manually reset');
}

export default proxyAdvanced;
