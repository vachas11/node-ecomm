import promClient, { Registry, Counter, Histogram, Gauge } from 'prom-client';

const register = new Registry();

promClient.collectDefaultMetrics({
  register,
  prefix: 'gateway_'
});

const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['service', 'method', 'path', 'status_code'] as const,
  registers: [register]
});

const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['service', 'method', 'path'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register]
});

const httpRequestSize = new Histogram({
  name: 'http_request_size_bytes',
  help: 'Size of HTTP requests in bytes',
  labelNames: ['service', 'method', 'path'] as const,
  buckets: [100, 1000, 5000, 10000, 50000, 100000, 500000, 1000000],
  registers: [register]
});

const httpResponseSize = new Histogram({
  name: 'http_response_size_bytes',
  help: 'Size of HTTP responses in bytes',
  labelNames: ['service', 'method', 'path'] as const,
  buckets: [100, 1000, 5000, 10000, 50000, 100000, 500000, 1000000],
  registers: [register]
});

const circuitBreakerState = new Gauge({
  name: 'circuit_breaker_state',
  help: 'Circuit breaker state (0=closed, 1=half_open, 2=open)',
  labelNames: ['service'] as const,
  registers: [register]
});

const circuitBreakerFailures = new Counter({
  name: 'circuit_breaker_failures_total',
  help: 'Total number of circuit breaker failures',
  labelNames: ['service'] as const,
  registers: [register]
});

const circuitBreakerSuccesses = new Counter({
  name: 'circuit_breaker_successes_total',
  help: 'Total number of circuit breaker successes',
  labelNames: ['service'] as const,
  registers: [register]
});

const circuitBreakerRejections = new Counter({
  name: 'circuit_breaker_rejections_total',
  help: 'Total number of requests rejected by circuit breaker',
  labelNames: ['service'] as const,
  registers: [register]
});

const bulkheadActiveRequests = new Gauge({
  name: 'bulkhead_active_requests',
  help: 'Number of currently active requests in bulkhead',
  labelNames: ['service'] as const,
  registers: [register]
});

const bulkheadQueueDepth = new Gauge({
  name: 'bulkhead_queue_depth',
  help: 'Number of requests currently queued in bulkhead',
  labelNames: ['service'] as const,
  registers: [register]
});

const bulkheadRejections = new Counter({
  name: 'bulkhead_rejections_total',
  help: 'Total number of requests rejected by bulkhead',
  labelNames: ['service'] as const,
  registers: [register]
});

const bulkheadCapacity = new Gauge({
  name: 'bulkhead_capacity',
  help: 'Maximum concurrent requests allowed in bulkhead',
  labelNames: ['service'] as const,
  registers: [register]
});

const bulkheadUtilization = new Gauge({
  name: 'bulkhead_utilization_percent',
  help: 'Percentage of bulkhead capacity in use',
  labelNames: ['service'] as const,
  registers: [register]
});

const retryAttempts = new Counter({
  name: 'retry_attempts_total',
  help: 'Total number of retry attempts',
  labelNames: ['service', 'method', 'path', 'attempt'] as const,
  registers: [register]
});

const retrySuccesses = new Counter({
  name: 'retry_successes_total',
  help: 'Total number of successful retries',
  labelNames: ['service', 'method', 'path'] as const,
  registers: [register]
});

const retryExhaustion = new Counter({
  name: 'retry_exhaustion_total',
  help: 'Total number of requests that exhausted all retries',
  labelNames: ['service', 'method', 'path'] as const,
  registers: [register]
});

const connectionPoolActive = new Gauge({
  name: 'connection_pool_active',
  help: 'Number of active connections in pool',
  labelNames: ['service'] as const,
  registers: [register]
});

const connectionPoolIdle = new Gauge({
  name: 'connection_pool_idle',
  help: 'Number of idle connections in pool',
  labelNames: ['service'] as const,
  registers: [register]
});

const connectionPoolSize = new Gauge({
  name: 'connection_pool_size',
  help: 'Total size of connection pool',
  labelNames: ['service'] as const,
  registers: [register]
});

const serviceHealth = new Gauge({
  name: 'service_health_status',
  help: 'Health status of backend services (0=unhealthy, 1=healthy)',
  labelNames: ['service'] as const,
  registers: [register]
});

const serviceHealthCheckDuration = new Histogram({
  name: 'service_health_check_duration_seconds',
  help: 'Duration of service health checks in seconds',
  labelNames: ['service'] as const,
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [register]
});

const gatewayUptime = new Gauge({
  name: 'gateway_uptime_seconds',
  help: 'Gateway uptime in seconds',
  registers: [register]
});

setInterval(() => gatewayUptime.set(process.uptime()), 10000);

export function normalizePath(path: string): string {
  return path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d+/g, '/:id')
    .replace(/\/[a-zA-Z0-9]{20,}/g, '/:id');
}

export function recordHttpRequest(service: string, method: string, path: string, statusCode: number, durationMs: number, requestSize?: number, responseSize?: number): void {
  const normalizedPath = normalizePath(path);
  httpRequestsTotal.inc({ service, method, path: normalizedPath, status_code: statusCode.toString() });
  httpRequestDuration.observe({ service, method, path: normalizedPath }, durationMs / 1000);
  if (requestSize) httpRequestSize.observe({ service, method, path: normalizedPath }, requestSize);
  if (responseSize) httpResponseSize.observe({ service, method, path: normalizedPath }, responseSize);
}

export function recordCircuitBreakerState(service: string, state: string): void {
  const stateValue = state === 'CLOSED' ? 0 : state === 'HALF_OPEN' ? 1 : 2;
  circuitBreakerState.set({ service }, stateValue);
}

export function recordCircuitBreakerFailure(service: string): void {
  circuitBreakerFailures.inc({ service });
}

export function recordCircuitBreakerSuccess(service: string): void {
  circuitBreakerSuccesses.inc({ service });
}

export function recordCircuitBreakerRejection(service: string): void {
  circuitBreakerRejections.inc({ service });
}

export function recordBulkheadMetrics(service: string, activeCount: number, queueDepth: number, maxConcurrent: number): void {
  bulkheadActiveRequests.set({ service }, activeCount);
  bulkheadQueueDepth.set({ service }, queueDepth);
  bulkheadCapacity.set({ service }, maxConcurrent);
  bulkheadUtilization.set({ service }, maxConcurrent > 0 ? (activeCount / maxConcurrent) * 100 : 0);
}

export function recordBulkheadRejection(service: string): void {
  bulkheadRejections.inc({ service });
}

export function recordRetryAttempt(service: string, method: string, path: string, attemptNumber: number): void {
  retryAttempts.inc({ service, method, path: normalizePath(path), attempt: attemptNumber.toString() });
}

export function recordRetrySuccess(service: string, method: string, path: string): void {
  retrySuccesses.inc({ service, method, path: normalizePath(path) });
}

export function recordRetryExhaustion(service: string, method: string, path: string): void {
  retryExhaustion.inc({ service, method, path: normalizePath(path) });
}

export function recordConnectionPoolMetrics(service: string, active: number, idle: number, total: number): void {
  connectionPoolActive.set({ service }, active);
  connectionPoolIdle.set({ service }, idle);
  connectionPoolSize.set({ service }, total);
}

export function recordServiceHealth(service: string, isHealthy: boolean, durationMs?: number): void {
  serviceHealth.set({ service }, isHealthy ? 1 : 0);
  if (durationMs !== undefined) serviceHealthCheckDuration.observe({ service }, durationMs / 1000);
}

export { register };
