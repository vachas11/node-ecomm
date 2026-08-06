# MODULE 11: Production-Grade Observability & Monitoring with Prometheus & Grafana

## 🎯 Interview Strategy: Lead/Staff Engineer Level

**What This Module Proves:**
- You can design and implement enterprise-grade observability systems
- Deep understanding of metrics, monitoring, and alerting patterns
- Production operational experience with Prometheus ecosystem
- Ability to build resilience patterns with observability built-in
- Strategic thinking about SLOs, SLIs, and incident response

**Interview Impact:**
- Lead engineers MUST understand production observability
- Staff+ roles involve defining monitoring standards across teams
- Distinguishes you from developers who "just add logs"
- Shows operational maturity and production thinking

---

## 📚 Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Prometheus Deep Dive](#2-prometheus-deep-dive)
3. [Metrics Instrumentation](#3-metrics-instrumentation)
4. [Grafana Dashboards](#4-grafana-dashboards)
5. [Alerting Strategy](#5-alerting-strategy)
6. [Cardinality Management](#6-cardinality-management)
7. [Interview Questions](#7-interview-questions)
8. [Production War Stories](#8-production-war-stories)
9. [Scaling & Optimization](#9-scaling--optimization)

---

## 1. Architecture Overview

### 1.1 The Monitoring Stack

```
┌─────────────────────────────────────────────────────────────┐
│                    USER / ON-CALL ENGINEER                   │
└───────────┬─────────────────────────────────┬───────────────┘
            │                                 │
    ┌───────▼────────┐              ┌────────▼─────────┐
    │    Grafana     │◄─────────────┤  Alertmanager    │
    │  Dashboards    │  Queries     │  (Routes alerts) │
    │  (Port 3001)   │              │  (Port 9093)     │
    └───────┬────────┘              └────────▲─────────┘
            │                                │
            │ PromQL Queries                 │ Alert Rules
            │                                │
    ┌───────▼────────────────────────────────┴─────────┐
    │              Prometheus Server                    │
    │         (Scrapes + Stores + Evaluates)           │
    │              (Port 9090)                          │
    └──┬────────┬────────┬────────┬─────────────────┬──┘
       │        │        │        │                 │
       │ Scrape │ Scrape │ Scrape │ Scrape         │ Scrape
       │ /metrics endpoints every 15s               │
       │        │        │        │                 │
┌──────▼──┐ ┌──▼───┐ ┌──▼────┐ ┌──▼─────┐    ┌────▼───┐
│  API    │ │ User │ │Product│ │ Order  │    │  ...   │
│ Gateway │ │Service│ │Service│ │Service │    │(Future)│
│  :3000  │ │ :3001│ │ :3002 │ │ :3003  │    │        │
└─────────┘ └──────┘ └───────┘ └────────┘    └────────┘
```

**Key Design Decisions:**

1. **Pull-based Scraping** (not push)
   - Prometheus pulls metrics from services
   - Services don't need to know about Prometheus
   - Service discovery handles dynamic scaling

2. **Service-Level Metrics** (not centralized)
   - Each service exposes its own `/metrics` endpoint
   - Each service owns what it exposes
   - Scales horizontally with service instances

3. **Time-Series Database**
   - Prometheus stores metrics in TSDB
   - 30-day retention (configurable)
   - Fast queries with PromQL

---

## 2. Prometheus Deep Dive

### 2.1 Core Concepts

#### Metric Types

**1. Counter** - Monotonically increasing value
```javascript
// Use for: request counts, error counts, bytes sent
const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'path', 'status_code']
});

httpRequestsTotal.inc({ method: 'GET', path: '/users', status_code: 200 });
```

**Interview Question:** *"Why can't we use Counter for active connections?"*
- Counter only goes up, never decreases
- Active connections go up AND down
- Use Gauge instead

**2. Gauge** - Value that can go up or down
```javascript
// Use for: memory usage, active connections, queue depth
const activeConnections = new client.Gauge({
  name: 'active_connections',
  help: 'Currently active connections'
});

activeConnections.inc();  // Connection opened
activeConnections.dec();  // Connection closed
```

**3. Histogram** - Samples observations (request durations, sizes)
```javascript
// Use for: latency, response sizes
const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'path'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
});

httpDuration.observe({ method: 'GET', path: '/users' }, 0.156);
```

**Why these buckets?**
- 5ms to 10s covers typical web request range
- Exponential distribution: more granularity at low latencies
- Enables percentile calculation: P50, P95, P99

**Interview Deep Dive:** *"How does Prometheus calculate P95 from histogram buckets?"*

```promql
histogram_quantile(0.95, 
  sum(rate(http_request_duration_seconds_bucket[5m])) by (le)
)
```

1. Prometheus counts requests in each bucket
2. `le` = "less than or equal" label (bucket boundary)
3. `histogram_quantile()` interpolates between buckets
4. Returns: "95% of requests completed in X seconds or less"

**Trade-off:** Accuracy vs Memory
- More buckets = more accurate percentiles
- More buckets = more memory per metric
- We chose 11 buckets (reasonable for most use cases)

**4. Summary** - Similar to histogram, but calculates quantiles on client
```javascript
// We DON'T use Summary (histogram is preferred)
// Why? Summary can't be aggregated across instances
```

**Interview Question:** *"Histogram vs Summary - when to use which?"*

| Histogram | Summary |
|-----------|---------|
| ✅ Aggregatable across instances | ❌ Not aggregatable |
| ✅ Flexible quantiles at query time | ❌ Fixed quantiles at instrumentation |
| ✅ Works with service discovery | ❌ Breaks with autoscaling |
| ⚠️ Approximation (bucket interpolation) | ✅ Exact quantiles |
| **Use for:** Microservices, autoscaling | **Use for:** Single instance apps |

**Our Choice:** Histogram (because we're building scalable microservices)

---

### 2.2 Prometheus Configuration

#### File: `prometheus.yml`

```yaml
global:
  scrape_interval: 15s      # How often to scrape targets
  evaluation_interval: 15s   # How often to evaluate alert rules
  external_labels:
    cluster: 'development'   # Labels added to all metrics
    environment: 'local'

# Alert routing
alerting:
  alertmanagers:
    - static_configs:
        - targets: ['alertmanager:9093']

# Alert rule files
rule_files:
  - "alerts.yml"

# What to scrape
scrape_configs:
  - job_name: 'api-gateway'
    metrics_path: '/metrics'
    static_configs:
      - targets: ['host.docker.internal:3000']
        labels:
          service: 'api-gateway'
          app: 'node-ecomm'
```

**Key Configuration Decisions:**

**1. Scrape Interval: 15s**

**Interview Question:** *"Why 15s? Why not 1s or 1m?"*

- **1s**: Too frequent
  - Overwhelms services with scrape requests
  - Generates massive data volume
  - Most changes aren't visible at 1s granularity
  - Cost: 4x storage vs 15s

- **15s**: Sweet spot
  - Fast enough to detect issues (incident within 30-60s)
  - Low overhead (4 scrapes/minute)
  - Industry standard (Google SRE uses 10-30s)

- **60s**: Too slow
  - 2-3 minute delay to detect issues
  - Misses short-lived spikes
  - Acceptable for batch jobs, not user-facing services

**Production tuning:**
- Development: 15s (fast feedback)
- Staging: 30s (balance)
- Production critical: 10s (faster detection)
- Production non-critical: 30-60s (cost optimization)

**2. host.docker.internal**

**Interview Question:** *"Why not localhost?"*

```
Docker Container (Prometheus)
    ↓
    Tries to scrape localhost:3000
    ↓
    Connects to... itself! (Container's localhost)
    ↓
    FAILS - Service is on HOST machine

Solution:
    host.docker.internal → Docker's gateway to host
    ✅ Container can reach host services
```

**Production Alternative:** Service Discovery
```yaml
# Kubernetes service discovery
- job_name: 'kubernetes-pods'
  kubernetes_sd_configs:
    - role: pod
  relabel_configs:
    - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
      action: keep
      regex: true
```

---

### 2.3 PromQL - The Query Language

**Basic Queries:**

```promql
# 1. Instant vector - current value
http_requests_total

# 2. Range vector - values over time
http_requests_total[5m]

# 3. Rate - requests per second
rate(http_requests_total[5m])

# 4. Sum - aggregate across labels
sum(rate(http_requests_total[5m])) by (method, path)
```

**Interview Challenge:** *"Calculate error rate as percentage"*

```promql
# Error rate = (5xx errors) / (total requests) * 100
sum(rate(http_requests_total{status_code=~"5.."}[5m]))
/
sum(rate(http_requests_total[5m]))
* 100
```

**Advanced Queries:**

**P95 Latency:**
```promql
histogram_quantile(0.95,
  sum(rate(http_request_duration_seconds_bucket[5m])) by (le)
)
```

**Top 5 Slowest Endpoints:**
```promql
topk(5,
  histogram_quantile(0.99,
    sum(rate(http_request_duration_seconds_bucket[5m])) by (path, le)
  )
)
```

**Requests per Second by Service:**
```promql
sum(rate(http_requests_total[1m])) by (service)
```

**Interview Red Flag:** *"I calculate percentiles from Counter metrics"*
- ❌ Counters don't have distribution information
- ❌ Can't calculate P95 from total count
- ✅ Use Histogram for latency percentiles

---

## 3. Metrics Instrumentation

### 3.1 API Gateway Metrics

**File:** `services/api-gateway/src/lib/Metrics.js`

Our implementation tracks **10 dimensions:**

1. **HTTP Requests** (RED Pattern)
   - **R**ate: `http_requests_total` (Counter)
   - **E**rrors: Status code labels on requests
   - **D**uration: `http_request_duration_seconds` (Histogram)

2. **Circuit Breaker**
   - State: `circuit_breaker_state` (Gauge: 0=closed, 1=half_open, 2=open)
   - Failures: `circuit_breaker_failures_total` (Counter)
   - Rejections: `circuit_breaker_rejections_total` (Counter)

3. **Bulkhead Isolation**
   - Active requests: `bulkhead_active_requests` (Gauge)
   - Queue depth: `bulkhead_queue_depth` (Gauge)
   - Utilization %: `bulkhead_utilization_percent` (Gauge)

4. **Retry Strategy**
   - Attempts: `retry_attempts_total` (Counter) - labeled by attempt number
   - Exhaustion: `retry_exhaustion_total` (Counter)

5. **Connection Pools**
   - Active connections: `connection_pool_active` (Gauge)
   - Idle connections: `connection_pool_idle` (Gauge)

6. **Service Health**
   - Health status: `service_health_status` (Gauge: 0=unhealthy, 1=healthy)
   - Check duration: `service_health_check_duration_seconds` (Histogram)

7. **System Metrics** (automatic)
   - CPU usage: `process_cpu_user_seconds_total`
   - Memory: `process_resident_memory_bytes`
   - Event loop lag: `nodejs_eventloop_lag_seconds`
   - Garbage collection: `nodejs_gc_duration_seconds`

**Code Example:**

```javascript
// Recording HTTP metrics
function recordHttpRequest(method, path, statusCode, durationMs) {
  const normalizedPath = normalizePath(path);  // /users/123 → /users/:id

  httpRequestsTotal.inc({
    method,
    path: normalizedPath,
    status_code: statusCode
  });

  httpRequestDuration.observe(
    { method, path: normalizedPath, status_code: statusCode },
    durationMs / 1000  // Convert to seconds
  );
}
```

**Interview Question:** *"Why normalize paths before recording metrics?"*

**Problem: Cardinality Explosion**
```
Without normalization:
/users/1 → metric
/users/2 → metric
/users/3 → metric
... (millions of user IDs)
→ Millions of unique metric series
→ Prometheus runs out of memory

With normalization:
/users/:id → single metric
→ One metric series for all user endpoints
→ Memory stays constant
```

---

### 3.2 User Service Metrics

**File:** `services/user-service/src/lib/metrics.js`

Additional metrics for database-heavy service:

```javascript
// Database query metrics
const dbQueryDuration = new client.Histogram({
  name: 'db_query_duration_seconds',
  help: 'Database query duration',
  labelNames: ['operation', 'table'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1]
});

// Database connection pool
const dbPoolActive = new client.Gauge({
  name: 'db_pool_active_connections',
  help: 'Active database connections'
});
```

**Why different buckets for DB queries?**
- DB queries are faster than HTTP requests (no network roundtrip to user)
- Range: 1ms to 1s (vs HTTP: 5ms to 10s)
- More granularity at low end (0.001, 0.005, 0.01)

**Interview Deep Dive:** *"How do you instrument database queries?"*

```javascript
// Wrapper approach
async function queryWithMetrics(operation, table, queryFn) {
  const start = Date.now();
  let status = 'success';

  try {
    const result = await queryFn();
    return result;
  } catch (err) {
    status = 'error';
    throw err;
  } finally {
    const duration = Date.now() - start;
    
    dbQueriesTotal.inc({ operation, table, status });
    dbQueryDuration.observe({ operation, table }, duration / 1000);
  }
}

// Usage
const users = await queryWithMetrics('SELECT', 'users', 
  () => db.query('SELECT * FROM users WHERE id = $1', [userId])
);
```

---

### 3.3 Middleware Integration

**File:** `services/user-service/src/server.js`

```javascript
app.use((req, res, next) => {
  const start = Date.now();
  const requestSize = req.get('content-length') || 0;

  res.on('finish', () => {
    const duration = Date.now() - start;
    const responseSize = res.get('content-length') || 0;

    metrics.recordHttpRequest(
      req.method,
      req.path,
      res.statusCode,
      duration,
      parseInt(requestSize, 10),
      parseInt(responseSize, 10)
    );
  });

  next();
});
```

**Interview Question:** *"Why use res.on('finish') instead of recording after next()?"*

```javascript
// ❌ WRONG - Records before response sent
app.use((req, res, next) => {
  const start = Date.now();
  next();
  const duration = Date.now() - start;  // Always ~0ms!
  recordMetrics(duration);  // Wrong duration
});

// ✅ RIGHT - Records after response sent
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;  // Actual duration
    recordMetrics(duration);
  });
  next();
});
```

**Why?**
- Express is asynchronous
- `next()` returns immediately
- Actual work happens later (DB queries, API calls)
- `res.on('finish')` fires when response fully sent to client

---

## 4. Grafana Dashboards

### 4.1 Dashboard Structure

**File:** `grafana/dashboards/api-gateway.json`

**Our Dashboard Has 9 Panels:**

1. **Request Rate (QPS)** - Line chart
   ```promql
   sum(rate(http_requests_total{service="api-gateway"}[1m])) by (method, path)
   ```

2. **Error Rate (%)** - Gauge
   ```promql
   sum(rate(http_requests_total{service="api-gateway",status_code=~"5.."}[5m]))
   / 
   sum(rate(http_requests_total{service="api-gateway"}[5m])) 
   * 100
   ```

3. **Response Time Percentiles** - Line chart
   ```promql
   histogram_quantile(0.50, ...) # P50
   histogram_quantile(0.95, ...) # P95
   histogram_quantile(0.99, ...) # P99
   ```

4. **Circuit Breaker States** - Stat panel
   - Color-coded: Green (0=closed), Yellow (1=half_open), Red (2=open)

5. **Bulkhead Utilization** - Line chart
   - Threshold markers at 70% (warning) and 85% (critical)

6. **Retry Rate** - Line chart
   - Shows retry attempts by service

7. **Memory Usage** - Gauge
   - Threshold at 400MB (warning), 500MB (critical)

8. **Event Loop Lag** - Gauge
   - Threshold at 50ms (warning), 100ms (critical)

9. **Gateway Uptime** - Stat panel

**Interview Question:** *"How do you choose what to put on a dashboard?"*

**The Golden Signals Framework (Google SRE):**

1. **Latency** - How long requests take
   - Panel: Response Time Percentiles (P50, P95, P99)
   - Why P95/P99? "Most users" vs "worst users"

2. **Traffic** - How much demand on the system
   - Panel: Request Rate (QPS)
   - Segmented by endpoint

3. **Errors** - Rate of failed requests
   - Panel: Error Rate (%)
   - Threshold: >1% triggers alert

4. **Saturation** - How "full" the service is
   - Panel: Bulkhead Utilization
   - Panel: Memory Usage
   - Panel: Event Loop Lag

**Additional Context:**
- Circuit Breaker States (resilience pattern health)
- Retry Rate (transient failure indicator)

---

### 4.2 Dashboard Auto-Provisioning

**File:** `grafana/provisioning/datasources/prometheus.yml`

```yaml
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    access: proxy           # Grafana proxies queries (not browser)
    url: http://prometheus:9090
    isDefault: true
    editable: false         # Prevent accidental deletion
```

**File:** `grafana/provisioning/dashboards/dashboards.yml`

```yaml
apiVersion: 1
providers:
  - name: 'Node E-commerce Dashboards'
    orgId: 1
    folder: ''
    type: file
    disableDeletion: false
    updateIntervalSeconds: 10  # Hot reload dashboards
    allowUiUpdates: true       # Allow manual edits
    options:
      path: /var/lib/grafana/dashboards
```

**Interview Question:** *"Why use provisioning instead of manual dashboard creation?"*

**Manual Dashboard Creation:**
- ❌ Lost when Grafana container restarts
- ❌ Not version controlled
- ❌ Can't reproduce in other environments
- ❌ Manual setup for each environment

**Provisioned Dashboards:**
- ✅ Stored in Git
- ✅ Auto-created on Grafana startup
- ✅ Same across dev/staging/prod
- ✅ Can be code-reviewed

**Production Tip:** Use Grafana API for templated dashboards
```bash
# Generate dashboard JSON programmatically
cat dashboard-template.json | \
  sed "s/{{SERVICE}}/$SERVICE_NAME/g" | \
  curl -X POST http://grafana:3000/api/dashboards/db \
    -H "Content-Type: application/json" \
    -d @-
```

---

## 5. Alerting Strategy

### 5.1 Alert Rules

**File:** `alerts.yml`

We defined **14 production-grade alerts**. Let's deep-dive into key ones:

#### Alert 1: High Error Rate (SLO Breach)

```yaml
- alert: HighErrorRate
  expr: |
    (
      sum by (service, method, path) (rate(http_requests_total{status_code=~"5.."}[5m]))
      /
      sum by (service, method, path) (rate(http_requests_total[5m]))
    ) > 0.01
  for: 5m
  labels:
    severity: critical
    team: backend
    slo: availability
  annotations:
    summary: "High error rate on {{ $labels.service }}:{{ $labels.method }} {{ $labels.path }}"
    description: "Error rate is {{ $value | humanizePercentage }} (threshold: 1%)"
    runbook: "https://wiki.company.com/runbooks/high-error-rate"
```

**Interview Deep Dive:** *"Walk me through this alert rule"*

1. **Expression Breakdown:**
   ```promql
   # Numerator: 5xx errors per second
   sum by (service, method, path) (rate(http_requests_total{status_code=~"5.."}[5m]))
   
   # Denominator: total requests per second
   sum by (service, method, path) (rate(http_requests_total[5m]))
   
   # Division: error rate as decimal (0.01 = 1%)
   > 0.01
   ```

2. **Why `rate()` instead of raw counter?**
   - Counter value increases forever
   - `rate()` calculates per-second rate over 5m window
   - Smooths out spikes (5m average)

3. **Why `sum by (service, method, path)`?**
   - Without `by`: One alert for entire system (too coarse)
   - With `by`: Separate alert per endpoint (precise)
   - Example: `/api/users GET` has high errors, but `/api/health` is fine

4. **Why `for: 5m`?**
   - Prevents flapping (brief spikes ignored)
   - Must be sustained for 5 minutes
   - Balance: Fast detection vs noise reduction

5. **Why `severity: critical`?**
   - Error rate >1% means SLO breach
   - Users are experiencing failures
   - Pages on-call engineer immediately

**Interview Question:** *"How did you choose 1% threshold?"*

**SLO-Driven Alerting:**
```
Service Level Objective (SLO): 99.9% availability
→ Acceptable error rate: 0.1%
→ Alert threshold: 1% (10x buffer)
→ If sustained for 5m: SLO at risk

Math:
- 99.9% availability = 99.9% requests succeed
- 0.1% can fail
- Alert at 1% = "10x worse than SLO"
- Gives time to fix before SLO breach
```

**Production Tuning:**
- Critical services: 0.5% threshold
- Non-critical services: 5% threshold
- Batch jobs: 10% threshold (more tolerance)

---

#### Alert 2: High P95 Latency

```yaml
- alert: HighP95Latency
  expr: |
    histogram_quantile(0.95, 
      sum by (service, method, path, le) (
        rate(http_request_duration_seconds_bucket[5m])
      )
    ) > 1
  for: 5m
  labels:
    severity: warning
    slo: latency
```

**Interview Question:** *"Why alert on P95 and not average latency?"*

**Average Hides Problems:**
```
Scenario: 100 requests
- 95 requests: 100ms (fast)
- 5 requests: 10s (slow - timeout)

Average: (95 * 0.1) + (5 * 10) / 100 = 0.595s
Looks fine! But 5% of users are timing out.

P95: 100ms (95th percentile is still fast)
→ Doesn't catch the problem

P99: 10s (99th percentile shows the slow requests)
→ Catches the problem!
```

**Why We Alert on Both P95 and P99:**
- P95 (warning): Degraded experience for top 5% of users
- P99 (critical): Severe degradation for top 1% of users

**Real-World Example:**
```
Before optimization:
- P50: 150ms (most users fine)
- P95: 800ms (some users notice)
- P99: 5s (worst users suffer)

After optimization:
- P50: 120ms
- P95: 300ms ✅ Alert cleared
- P99: 1.5s ✅ Under critical threshold
```

---

#### Alert 3: Circuit Breaker Open

```yaml
- alert: CircuitBreakerOpen
  expr: circuit_breaker_state == 2  # 2 = OPEN
  for: 1m
  labels:
    severity: critical
  annotations:
    summary: "Circuit breaker OPEN for {{ $labels.service }}"
    description: "{{ $labels.service }} circuit breaker has been open for 1 minute"
```

**Interview Question:** *"Why is circuit breaker open a critical alert?"*

**Cascade Failure Prevention:**
```
Without Circuit Breaker:
User Service DOWN
    ↓
API Gateway keeps trying (30s timeout)
    ↓
Gateway threads blocked waiting
    ↓
Gateway runs out of threads
    ↓
Gateway ALSO goes down
    ↓
Entire system down

With Circuit Breaker:
User Service DOWN
    ↓
Circuit breaker opens (after 5 failures)
    ↓
Gateway immediately returns 503
    ↓
No threads blocked
    ↓
Gateway stays healthy
    ↓
Alert fires: "User Service circuit open"
    ↓
On-call fixes User Service
```

**Alert Severity: Critical** because:
1. Service is effectively down (no requests reaching it)
2. Users are seeing 503 errors
3. Manual intervention required

**Why `for: 1m`?**
- Circuit breaker opens/closes quickly during recovery
- 1m filters out transient opens
- If still open after 1m, real problem

---

### 5.2 Alertmanager Configuration

**File:** `alertmanager.yml`

```yaml
route:
  group_by: ['alertname', 'service']
  group_wait: 10s        # Wait 10s for more alerts in group
  group_interval: 10s    # Send update every 10s
  repeat_interval: 12h   # Don't repeat for 12h
  receiver: 'default'
  routes:
    - match:
        severity: critical
      receiver: 'critical'
      continue: true     # Also send to default

receivers:
  - name: 'critical'
    # pagerduty_configs:  (commented for local dev)
    #   - service_key: '<key>'
    webhook_configs:
      - url: 'http://localhost:3000/api/alerts/webhook'

inhibit_rules:
  - source_match:
      severity: 'critical'
    target_match:
      severity: 'warning'
    equal: ['service', 'alertname']
```

**Interview Deep Dive:** *"Explain alert grouping and inhibition"*

**1. Alert Grouping:**
```
Problem: 10 microservices × 5 alerts = 50 simultaneous alerts
→ On-call gets 50 pages in 1 second
→ Overwhelmed, can't prioritize

Solution: group_by: ['alertname', 'service']
→ Groups alerts by type and service
→ One notification: "HighErrorRate on user-service (5 endpoints affected)"
→ Actionable single page
```

**2. Inhibit Rules:**
```
Scenario:
- CircuitBreakerOpen (critical) fires for user-service
- HighRetryRate (warning) also fires for user-service

Problem: Two alerts for same root cause

Solution: Inhibit rule
- If critical alert for service exists
- Suppress warning alerts for same service
- Only page for critical issue

Result: One page instead of two
```

**Interview Question:** *"How do you prevent alert fatigue?"*

**Alert Fatigue Prevention:**

1. **Group related alerts**
   - `group_by: ['alertname', 'service']`
   - Batch similar alerts together

2. **Tune thresholds**
   - Start conservative (fewer false positives)
   - Gradually tighten based on real incidents

3. **Use `for` duration**
   - Ignore brief spikes
   - Alert only on sustained issues

4. **Severity levels**
   - Critical: Pages on-call (immediate action required)
   - Warning: Slack notification (awareness)
   - Info: Dashboard annotation (context)

5. **Runbooks**
   - Every alert has `runbook` annotation
   - Link to step-by-step fix instructions
   - Reduces cognitive load during incident

6. **Rate limiting**
   - `repeat_interval: 12h`
   - Don't re-page for same issue

7. **On-call rotation**
   - Share the burden
   - Prevents burnout

**Anti-Patterns:**
- ❌ Alert on everything → Noise
- ❌ No `for` duration → Flapping
- ❌ No runbooks → Confusion during incident
- ❌ Same severity for all alerts → Can't prioritize

---

## 6. Cardinality Management

### 6.1 The Cardinality Problem

**Interview Question:** *"What's the biggest mistake people make with Prometheus metrics?"*

**Answer: Cardinality Explosion**

```javascript
// ❌ BAD - High cardinality label
httpRequests.inc({
  method: 'GET',
  path: '/users/12345',        // User ID in path!
  userId: '12345',             // User ID in label!
  sessionId: 'abc-def-ghi'     // Session ID in label!
});

// Result:
// - 1 million users → 1 million unique user IDs
// - 10 million sessions → 10 million unique session IDs
// - 1M × 10M = 10 trillion possible label combinations!
// - Prometheus stores each combination as separate time series
// - Prometheus runs out of memory and crashes
```

**Cardinality Formula:**
```
Total time series = 
  (unique values of label1) × 
  (unique values of label2) × 
  (unique values of label3) × 
  ...
```

**Example:**
```javascript
// Labels:
// - service: 4 values (gateway, user, product, order)
// - method: 4 values (GET, POST, PUT, DELETE)
// - path: 20 values (normalized endpoints)
// - status_code: 10 values (200, 201, 400, 401, 403, 404, 500, 502, 503, 504)

Total series = 4 × 4 × 20 × 10 = 3,200 time series
✅ Manageable
```

**Bad Example:**
```javascript
// Labels:
// - service: 4 values
// - method: 4 values
// - path: 1,000,000 values (user IDs not normalized!)
// - status_code: 10 values

Total series = 4 × 4 × 1,000,000 × 10 = 160 million time series
❌ Prometheus OOM (out of memory)
```

---

### 6.2 Path Normalization

**File:** `services/api-gateway/src/lib/Metrics.js`

```javascript
/**
 * Normalize path to prevent cardinality explosion
 * Replaces UUIDs and numeric IDs with :id placeholder
 */
function normalizePath(path) {
  return path
    // UUID: abc-123-def-456 → :id
    .replace(
      /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      '/:id'
    )
    // Numeric ID: /users/12345 → /users/:id
    .replace(/\/\d+/g, '/:id')
    // MongoDB ObjectId: /users/507f1f77bcf86cd799439011 → /users/:id
    .replace(/\/[0-9a-f]{24}/gi, '/:id');
}

// Before normalization:
// /users/1 /users/2 /users/3 ... (millions)

// After normalization:
// /users/:id (one metric)
```

**Interview Question:** *"How do you debug issues with specific user IDs if you normalize them?"*

**Answer: Correlation, not raw metrics**

```javascript
// Metrics: Normalized paths (low cardinality)
metrics.recordHttpRequest('GET', '/users/:id', 200, 150);

// Logs: Full details (structured)
logger.info('GET /users/12345', {
  userId: '12345',
  statusCode: 200,
  duration: '150ms',
  traceId: 'abc-123'  // For distributed tracing
});

// Debugging flow:
// 1. Prometheus: "P99 latency high on /users/:id"
// 2. Grafana: See spike at 3:15 PM
// 3. Logs: Query logs between 3:14-3:16 PM for /users/*
// 4. Find: "GET /users/12345 - 5000ms - traceId: abc-123"
// 5. Distributed tracing: Follow traceId across services
// 6. Root cause: Slow DB query for user 12345
```

**Three Pillars of Observability:**
1. **Metrics** (Prometheus): High-level patterns (cardinality controlled)
2. **Logs** (ELK/Splunk): Detailed events (full context)
3. **Traces** (Jaeger/Zipkin): Request flow across services

---

### 6.3 Label Best Practices

**Good Labels (Low Cardinality):**
```javascript
// ✅ Service name (4-10 unique values)
{ service: 'api-gateway' }

// ✅ HTTP method (4 unique values)
{ method: 'GET' }

// ✅ Normalized path (20-50 unique values)
{ path: '/users/:id' }

// ✅ Status code group (5-10 unique values)
{ status_code: '200' }

// ✅ Environment (3-5 unique values)
{ environment: 'production' }

// ✅ Cluster/Region (5-20 unique values)
{ cluster: 'us-west-2' }
```

**Bad Labels (High Cardinality):**
```javascript
// ❌ User ID (millions)
{ userId: '12345' }

// ❌ Session ID (tens of millions)
{ sessionId: 'abc-def-ghi' }

// ❌ Request ID (every request unique!)
{ requestId: 'uuid-uuid-uuid' }

// ❌ IP address (thousands)
{ ip: '192.168.1.1' }

// ❌ Email (millions)
{ email: 'user@example.com' }

// ❌ Timestamp (every second unique!)
{ timestamp: '2024-01-15T10:30:45Z' }
```

**Interview Red Flag:** *"I add `requestId` as a metric label for debugging"*
- Every request has unique ID
- Infinite cardinality
- Prometheus will crash

**Correct Approach:**
```javascript
// Metrics: Aggregate patterns
metrics.recordRequest({ service, method, path, status });

// Logs: Individual request details
logger.info({ requestId, userId, path, duration });
```

---

## 7. Interview Questions

### 7.1 Junior Level (2-3 YOE)

**Q1: What are the 4 Prometheus metric types?**

**Answer:**
1. **Counter** - Monotonically increasing (requests, errors)
2. **Gauge** - Can go up or down (memory, connections)
3. **Histogram** - Distribution of values (latency, sizes)
4. **Summary** - Like histogram, but quantiles calculated on client

**Q2: How do you expose metrics from a Node.js service?**

```javascript
const client = require('prom-client');
const express = require('express');

const app = express();
const register = new client.Registry();

// Collect default metrics
client.collectDefaultMetrics({ register });

// Expose /metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```

---

### 7.2 Mid Level (4-6 YOE)

**Q3: How does Prometheus calculate P95 latency from histogram buckets?**

**Answer:**
1. Histogram counts requests in buckets (le = "less than or equal")
2. PromQL `histogram_quantile()` finds bucket containing 95th percentile
3. Linear interpolation between buckets
4. Returns: "95% of requests completed in X seconds or less"

**Example:**
```
Buckets:
- le="0.1": 800 requests
- le="0.5": 950 requests  ← 95th percentile is between 0.1 and 0.5
- le="1.0": 980 requests

Interpolation:
95th percentile = 950 out of 1000 requests
Position in bucket = (950 - 800) / (950 - 800) = 100%
P95 = 0.1 + (0.5 - 0.1) * 100% = 0.5 seconds
```

**Q4: Why not use average latency for alerts?**

**Answer:**
- Average hides outliers
- Example: 95% requests 100ms, 5% requests 10s
- Average = 595ms (looks fine)
- But 5% of users timing out!
- Use P95/P99 to catch tail latency

---

### 7.3 Senior Level (7-10 YOE)

**Q5: You're seeing high memory usage in Prometheus. What do you check?**

**Answer - Systematic Debugging:**

1. **Check cardinality:**
   ```promql
   # Count unique time series per metric
   count({__name__=~".+"}) by (__name__)
   
   # Top 10 metrics by cardinality
   topk(10, count({__name__=~".+"}) by (__name__))
   ```

2. **Check label cardinality:**
   ```promql
   # Unique values per label
   count(count({__name__="http_requests_total"}) by (path))
   ```

3. **Find culprit:**
   - If `path` label has 1M unique values
   - Path normalization failing
   - User IDs leaking into path label

4. **Fix:**
   - Improve `normalizePath()` function
   - Drop high-cardinality labels
   - Use relabel_configs in Prometheus

5. **Prevent:**
   - Add cardinality monitoring
   - Alert on metric count > threshold
   - Code review checklist for new metrics

**Q6: Design a monitoring strategy for a new microservice**

**Answer - Structured Approach:**

1. **Identify Critical User Journeys**
   - Example: Login, Checkout, Search
   - These define SLOs

2. **Define SLOs**
   ```
   Availability SLO: 99.9% (43m downtime/month)
   Latency SLO: P95 < 500ms
   ```

3. **Instrument Golden Signals**
   - Latency: P50, P95, P99 (histogram)
   - Traffic: Requests/sec (counter)
   - Errors: Error rate % (derived from counter)
   - Saturation: CPU, memory, connections (gauge)

4. **Add Business Metrics**
   - User signups/hour
   - Orders/minute
   - Revenue/hour

5. **Create Dashboards**
   - Service Overview (Golden Signals)
   - Business Metrics
   - System Health (memory, CPU, GC)

6. **Define Alerts**
   - Critical: SLO breach (page on-call)
   - Warning: SLO at risk (Slack notification)
   - Info: Interesting events (dashboard annotation)

7. **Test Alert Flow**
   - Trigger each alert in staging
   - Verify routing to correct channels
   - Measure time-to-page

---

### 7.4 Lead/Staff Level (10+ YOE)

**Q7: You're oncall and get paged: "HighErrorRate on user-service". Walk me through your incident response.**

**Answer - Incident Command:**

**1. Acknowledge & Assess (0-2 min)**
```bash
# Acknowledge page immediately
# Check dashboard - what's the scope?

# Grafana: user-service error rate dashboard
# Severity: 5% error rate (5x threshold)
# Scope: All pods, started 5 minutes ago
# Impact: ~500 errors/minute = ~30,000 users affected
```

**2. Triage & Mitigate (2-10 min)**
```bash
# Quick mitigation options:
# 1. Rollback recent deployment?
kubectl rollout history deployment/user-service
# Deployed 7 minutes ago - LIKELY CULPRIT

# 2. Immediate mitigation: Rollback
kubectl rollout undo deployment/user-service

# 3. Monitor recovery
watch "curl http://grafana/api/datasources/proxy/1/api/v1/query?query=error_rate"
# Error rate dropping... 4%... 2%... 0.5%
# Recovery confirmed after 3 minutes
```

**3. Root Cause Analysis (10-60 min)**
```bash
# Check logs from bad deployment
kubectl logs -l app=user-service --since=10m | grep ERROR

# Found: "Database connection pool exhausted"
# New code: N+1 query problem
# Each user request triggers 10 DB queries (was 1)
```

**4. Permanent Fix (1-24 hours)**
```javascript
// Before (N+1 query):
for (const order of orders) {
  const user = await db.query('SELECT * FROM users WHERE id = $1', [order.userId]);
  // 1000 orders = 1000 queries
}

// After (JOIN):
const ordersWithUsers = await db.query(`
  SELECT orders.*, users.name 
  FROM orders 
  JOIN users ON orders.user_id = users.id
`);
// 1000 orders = 1 query
```

**5. Postmortem (24-48 hours after incident)**
```markdown
## Incident Postmortem: user-service HighErrorRate

**Date:** 2024-01-15
**Duration:** 8 minutes (5min detection + 3min mitigation)
**Severity:** Critical (30K users affected)

**Timeline:**
- 14:45: New deployment
- 14:50: Alert fired
- 14:52: Rollback initiated
- 14:55: Service recovered

**Root Cause:**
N+1 query problem in new order listing endpoint

**Action Items:**
1. [P0] Add DB query count metric
2. [P0] Alert on high query rate
3. [P1] Staging load test for all deploys
4. [P1] Add code review checklist: "Check for N+1 queries"
5. [P2] Add automatic rollback on high error rate
```

**Q8: Your Prometheus server is hitting storage limits. How do you scale?**

**Answer - Multi-tier Strategy:**

**Tier 1: Optimize Current Setup**
```yaml
# 1. Reduce retention
storage.tsdb.retention.time: 15d  # Was 30d

# 2. Drop unused metrics
metric_relabel_configs:
  - source_labels: [__name__]
    regex: 'go_.*|process_.*'  # Drop Go runtime metrics
    action: drop

# 3. Increase scrape interval for non-critical
scrape_configs:
  - job_name: 'batch-jobs'
    scrape_interval: 60s  # Was 15s
```

**Tier 2: Federation (Multi-Prometheus)**
```
┌─────────────────────┐
│  Global Prometheus  │  (Long retention, aggregate data)
│   (Retention: 90d)  │
└──────────┬──────────┘
           │ Federate (5m interval)
           │
    ┌──────┴──────┬──────────┬────────┐
    │             │          │        │
┌───▼───┐    ┌───▼───┐  ┌───▼───┐  ┌─▼────┐
│ Prom  │    │ Prom  │  │ Prom  │  │ Prom │
│Cluster│    │Cluster│  │Cluster│  │Cluster│
│ US-W  │    │ US-E  │  │  EU   │  │ ASIA │
│(15d)  │    │(15d)  │  │(15d)  │  │(15d) │
└───────┘    └───────┘  └───────┘  └──────┘
```

**Tier 3: Long-term Storage (Thanos/Cortex)**
```
Prometheus (15d local)
    ↓
Thanos Sidecar (ships blocks to S3)
    ↓
S3 (infinite retention, $0.023/GB)
    ↓
Thanos Query (unified query interface)
    ↓
Grafana (queries Thanos for historical, Prometheus for recent)
```

**Cost Comparison:**
```
Option 1: Single Prometheus, 90d retention
- Memory: 128GB RAM
- Disk: 2TB SSD
- Cost: $5000/month (AWS)

Option 2: Federation + Thanos
- 4× Prometheus: 16GB RAM each
- Thanos: 8GB RAM
- S3: 500GB
- Cost: $1200/month (75% savings!)
```

---

## 8. Production War Stories

### 8.1 War Story: The Cardinality Bomb

**Context:** E-commerce startup, Black Friday traffic

**Incident:**
```
11:45 PM: Deploy new feature "User Activity Tracking"
11:46 PM: Prometheus memory usage: 8GB → 64GB in 1 minute
11:47 PM: Prometheus OOM crash
11:47 PM: All monitoring down during Black Friday peak
```

**Root Cause:**
```javascript
// Bad code deployed:
activityMetric.inc({
  userId: user.id,           // 10M users
  sessionId: session.id,     // 50M sessions
  pageUrl: req.url,          // 10K URLs
  timestamp: Date.now()      // Infinite!
});

// Cardinality: 10M × 50M × 10K × ∞ = Explosion
```

**Fix:**
```javascript
// Removed high-cardinality labels
activityMetric.inc({
  page: normalizePath(req.url)  // 50 unique pages
});

// Moved userId to logs, not metrics
logger.info('User activity', { userId, sessionId, url });
```

**Lesson:**
- Always review metrics for cardinality
- Load test metrics under production-like cardinality
- Add cardinality monitoring alerts

---

### 8.2 War Story: Alert Fatigue Paralysis

**Context:** Fintech company, over-alerting

**Problem:**
```
Engineers getting 50+ alerts per day
→ Started ignoring alerts
→ Missed critical production outage
→ $2M revenue loss
```

**Analysis:**
```bash
# Alert breakdown:
- 80% false positives (brief spikes, self-recovered)
- 15% warning-level (no action needed)
- 5% actual critical issues (lost in noise)
```

**Solution - Alert Pyramid:**
```
         /\
        /  \ Critical (Page oncall)
       /____\ 2 per week
      /      \
     / Warning\ (Slack)
    /__________\ 10 per week
   /            \
  /     Info     \ (Dashboard annotation)
 /________________\ 100 per week
```

**New Alert Rules:**
```yaml
# Before: Alert immediately
- alert: HighCPU
  expr: cpu > 70%
  for: 0s              # ❌ Immediate alert

# After: Sustained high CPU
- alert: HighCPU
  expr: cpu > 80%      # ✅ Higher threshold
  for: 10m             # ✅ Sustained duration
```

**Result:**
- Alerts reduced by 90%
- Zero missed critical incidents in 6 months
- On-call satisfaction score: 2.5 → 8.5/10

---

## 9. Scaling & Optimization

### 9.1 Prometheus Performance Tuning

**Memory Optimization:**
```yaml
# Reduce retention
storage.tsdb.retention.time: 15d
storage.tsdb.retention.size: 50GB

# Sample less frequently
global:
  scrape_interval: 30s      # Was 15s

# Reduce label cardinality
metric_relabel_configs:
  - source_labels: [instance]
    regex: '10\..*'          # Internal IPs
    action: drop             # Don't need instance label for internal services
```

**Disk Optimization:**
```yaml
# Use SSD for Prometheus data directory
# IOPS matter more than capacity

# Enable compression
storage.tsdb.wal-compression: true

# Block chunking
storage.tsdb.max-block-duration: 2h
storage.tsdb.min-block-duration: 2h
```

---

### 9.2 Query Optimization

**Slow Query:**
```promql
# ❌ BAD - Queries all time series, then filters
sum(rate(http_requests_total[5m])) by (service)
```

**Fast Query:**
```promql
# ✅ GOOD - Filter first, then aggregate
sum(rate(http_requests_total{service="user-service"}[5m]))
```

**Why?**
- Prometheus stores metrics in chunks
- Filtering early reduces data scanned
- Order matters: filter > aggregate > functions

---

### 9.3 Grafana Dashboard Optimization

**Problem: Slow dashboard (30s load time)**

**Fix:**
```json
{
  "refresh": "30s",           // Don't auto-refresh too fast
  "time": {
    "from": "now-1h",         // Limit time range
    "to": "now"
  },
  "panels": [
    {
      "interval": "30s",      // Don't query every second
      "maxDataPoints": 1000   // Limit data points returned
    }
  ]
}
```

---

## 10. Summary & Key Takeaways

### For Lead-Level Interviews:

**1. You built production-grade observability**
- Not just "added some metrics"
- Complete monitoring stack with alerts
- Thought through cardinality, SLOs, incident response

**2. You understand trade-offs**
- Histogram vs Summary
- Scrape interval vs storage cost
- Alert sensitivity vs noise

**3. You've seen (or prevented) production failures**
- Cardinality explosions
- Alert fatigue
- Metric-driven debugging

**4. You can design monitoring strategy**
- Golden Signals framework
- SLO-driven alerting
- Multi-tier storage

**5. You think operationally**
- On-call experience
- Incident response
- Postmortems

---

## Interview Closing Statement

*"I implemented a production-grade observability stack with Prometheus and Grafana for our microservices platform. This included comprehensive metrics instrumentation across 10+ dimensions, cardinality management to prevent memory issues, SLO-driven alerting with 14 alert rules, and auto-provisioned Grafana dashboards. 

The system follows Google's Golden Signals framework and implements defense-in-depth with circuit breakers, bulkheads, and retry strategies - all instrumented for visibility. I designed the alerting strategy to prevent alert fatigue while catching critical issues within 60 seconds.

This level of observability is critical for operating distributed systems at scale - it's the difference between blindly guessing during incidents and having data-driven confidence in your debugging and architectural decisions."*

---

## Files Reference

- `prometheus.yml` - Prometheus server configuration
- `alerts.yml` - 14 production alert rules
- `alertmanager.yml` - Alert routing and notification
- `docker-compose.monitoring.yml` - Complete monitoring stack
- `services/api-gateway/src/lib/Metrics.js` - 390-line metrics library
- `services/user-service/src/lib/metrics.js` - User service metrics
- `grafana/provisioning/datasources/prometheus.yml` - Auto-configured datasource
- `grafana/dashboards/api-gateway.json` - 9-panel dashboard
- `PROMETHEUS-TESTING.md` - Testing and verification guide

---

**Module Complete** ✅

You now have interview-grade knowledge of:
- Prometheus architecture and metric types
- Grafana dashboard design
- Production alerting strategy
- Cardinality management
- Incident response
- Scaling observability systems

**Next Steps:**
1. Practice explaining each component
2. Run the monitoring stack and generate traffic
3. Review alert rules and understand each threshold
4. Prepare war stories from your implementation experience
