import client, { Registry, Histogram, Counter, Gauge } from 'prom-client';
import logger from '../../../../shared/logger';

const register = new Registry();

client.collectDefaultMetrics({
  register,
  prefix: 'user_service_'
});

const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'path', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register]
});

const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'path', 'status_code'] as const,
  registers: [register]
});

const httpRequestSize = new Histogram({
  name: 'http_request_size_bytes',
  help: 'HTTP request size in bytes',
  labelNames: ['method', 'path'] as const,
  buckets: [100, 1000, 5000, 10000, 50000, 100000, 500000, 1000000],
  registers: [register]
});

const httpResponseSize = new Histogram({
  name: 'http_response_size_bytes',
  help: 'HTTP response size in bytes',
  labelNames: ['method', 'path', 'status_code'] as const,
  buckets: [100, 1000, 5000, 10000, 50000, 100000, 500000, 1000000],
  registers: [register]
});

const dbQueryDuration = new Histogram({
  name: 'db_query_duration_seconds',
  help: 'Database query duration in seconds',
  labelNames: ['operation', 'table'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [register]
});

const dbQueriesTotal = new Counter({
  name: 'db_queries_total',
  help: 'Total database queries',
  labelNames: ['operation', 'table', 'status'] as const,
  registers: [register]
});

const dbPoolActive = new Gauge({
  name: 'db_pool_active_connections',
  help: 'Active database connections',
  registers: [register]
});

const dbPoolIdle = new Gauge({
  name: 'db_pool_idle_connections',
  help: 'Idle database connections',
  registers: [register]
});

const dbPoolWaiting = new Gauge({
  name: 'db_pool_waiting_connections',
  help: 'Waiting database connections',
  registers: [register]
});

const serviceUptime = new Gauge({
  name: 'user_service_uptime_seconds',
  help: 'User service uptime in seconds',
  registers: [register]
});

const startTime = Date.now();
setInterval(() => {
  serviceUptime.set((Date.now() - startTime) / 1000);
}, 10000);

export function normalizePath(path: string): string {
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/\d+/g, '/:id')
    .replace(/\/[0-9a-f]{24}/gi, '/:id');
}

export function recordHttpRequest(
  method: string,
  path: string,
  statusCode: number,
  durationMs: number,
  requestSize = 0,
  responseSize = 0
): void {
  try {
    const normalizedPath = normalizePath(path);

    httpRequestsTotal.inc({ method, path: normalizedPath, status_code: statusCode });
    httpRequestDuration.observe({ method, path: normalizedPath, status_code: statusCode }, durationMs / 1000);

    if (requestSize > 0) {
      httpRequestSize.observe({ method, path: normalizedPath }, requestSize);
    }

    if (responseSize > 0) {
      httpResponseSize.observe({ method, path: normalizedPath, status_code: statusCode }, responseSize);
    }
  } catch (err: any) {
    logger.error('Failed to record HTTP metrics', { error: err.message, method, path });
  }
}

export function recordDbQuery(operation: string, table: string, durationMs: number, status = 'success'): void {
  try {
    dbQueriesTotal.inc({ operation, table, status });
    dbQueryDuration.observe({ operation, table }, durationMs / 1000);
  } catch (err: any) {
    logger.error('Failed to record DB metrics', { error: err.message, operation, table });
  }
}

export function recordDbPoolMetrics(active: number, idle: number, waiting: number): void {
  try {
    dbPoolActive.set(active);
    dbPoolIdle.set(idle);
    dbPoolWaiting.set(waiting);
  } catch (err: any) {
    logger.error('Failed to record DB pool metrics', { error: err.message });
  }
}

export { register };
