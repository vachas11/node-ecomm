# HANDS-ON TESTING GUIDE - PART 2

**Advanced testing: Performance, Load Testing, and Real-World Scenarios**

---

# PART 6: Connection Pool Testing

## Exercise 13: Verify Connection Pool Benefits

**Goal:** Measure performance difference between pooled and non-pooled connections

**Setup:** Create test script to make 100 requests

**File: `test-connection-pool.js`**

```javascript
const axios = require('axios');

async function testWithPool() {
  const start = Date.now();
  
  const promises = [];
  for (let i = 0; i < 100; i++) {
    promises.push(
      axios.get('http://localhost:3000/health')
        .catch(err => ({ error: err.message }))
    );
  }
  
  await Promise.all(promises);
  
  const duration = Date.now() - start;
  console.log(`100 requests with pool: ${duration}ms`);
  console.log(`Average per request: ${(duration / 100).toFixed(2)}ms`);
  
  return duration;
}

async function main() {
  console.log('Testing connection pool performance...\n');
  
  // Warm up
  await axios.get('http://localhost:3000/health');
  
  // Test 1: With connection pool
  const withPool = await testWithPool();
  
  console.log('\n✅ Connection pool reuses sockets!');
  console.log('Without pool would take ~15-20 seconds (new connection per request)');
  console.log('With pool should take ~3-5 seconds (reused connections)');
}

main();
```

**Run test:**

```bash
node test-connection-pool.js
```

**Expected Output:**

```
Testing connection pool performance...

100 requests with pool: 3421ms
Average per request: 34.21ms

✅ Connection pool reuses sockets!
Without pool would take ~15-20 seconds (new connection per request)
With pool should take ~3-5 seconds (reused connections)
```

**What Happened:**

1. Connection pool has keepAlive: true ✅
2. Sockets remain open between requests ✅
3. Skip TCP handshake (saves ~50-100ms) ✅
4. Skip TLS negotiation (saves ~100-150ms) ✅
5. Reuse sockets = 70% faster ✅

**Verify pool statistics:**

```bash
curl http://localhost:3000/gateway/health
```

**Expected:**

```json
{
  "status": "healthy",
  "services": {
    "user-service": {
      "status": "healthy",
      "stats": {
        "totalConnections": 10,
        "activeConnections": 0,
        "idleConnections": 10,
        "pendingRequests": 0
      }
    }
  }
}
```

**Key metrics explained:**

- **totalConnections**: Total sockets created (10)
- **activeConnections**: Currently in use (0)
- **idleConnections**: Waiting for reuse (10)
- **pendingRequests**: Queued requests (0)

**Without connection pool:**

- Every request = new socket
- 100 requests = 100 new connections
- TCP handshake × 100 = ~5-10 seconds wasted
- TLS negotiation × 100 = ~10-15 seconds wasted
- Total: ~18-20 seconds

**With connection pool:**

- First 10 requests = 10 new connections
- Remaining 90 requests = reuse those 10
- Only 10 TCP handshakes
- Only 10 TLS negotiations
- Total: ~3-5 seconds

**Performance improvement: 75%!** 🚀

---

## Exercise 14: Test Connection Pool Limits

**Goal:** See what happens when maxSockets is reached

**Setup:** Configure pool with maxSockets: 5

**Test:**

```bash
# Make 20 concurrent requests (pool max = 5)
# 5 will execute immediately
# 15 will queue

curl -X GET http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer $ACCESS_TOKEN" &
curl -X GET http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer $ACCESS_TOKEN" &
curl -X GET http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer $ACCESS_TOKEN" &
# ... repeat 20 times

# Check queue depth
curl http://localhost:3000/gateway/health
```

**Expected:**

```json
{
  "services": {
    "user-service": {
      "stats": {
        "totalConnections": 5,
        "activeConnections": 5,
        "idleConnections": 0,
        "pendingRequests": 15
      }
    }
  }
}
```

**What Happened:**

- First 5 requests used all sockets ✅
- Remaining 15 requests queued ✅
- As sockets free up, queue drains ✅
- Total connections never exceeds maxSockets ✅

---

# PART 7: Retry Strategy Testing

## Exercise 15: Test Exponential Backoff

**Goal:** Observe retry delays with exponential backoff

**Setup:** Make User Service respond slowly (simulate intermittent failure)

**Modify User Service temporarily:**

```javascript
// services/user-service/src/controllers/auth.controller.js
exports.getProfile = async (req, res, next) => {
  // Simulate intermittent failure (50% chance)
  if (Math.random() < 0.5) {
    await new Promise(resolve => setTimeout(resolve, 5000)); // 5s delay
    throw new Error('Simulated failure');
  }
  
  // Normal response
  const user = await db.query('SELECT * FROM users WHERE user_id = $1', [req.user.userId]);
  res.json({ success: true, data: { user: user.rows[0] } });
};
```

**Test:**

```bash
# Login first to get fresh token
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Password123"
  }'

# Save token
$ACCESS_TOKEN = "<token-from-login>"

# Make request that will trigger retries
curl http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -w "\nTotal time: %{time_total}s\n"
```

**Check Gateway logs:**

```
[INFO] Request to user-service (attempt 1/3)
[ERROR] Request failed: Simulated failure
[INFO] Retrying in 100ms...
[INFO] Request to user-service (attempt 2/3)
[ERROR] Request failed: Simulated failure
[INFO] Retrying in 200ms...
[INFO] Request to user-service (attempt 3/3)
[SUCCESS] Request succeeded
[INFO] Request duration: 342ms
```

**Exponential backoff timing:**

- Attempt 1: 0ms (immediate)
- Attempt 2: 100ms ± 25ms jitter
- Attempt 3: 200ms ± 50ms jitter
- Attempt 4: 400ms ± 100ms jitter
- Attempt 5: 800ms ± 200ms jitter

**Formula:**

```javascript
const baseDelay = 100; // ms
const attempt = 2; // 0-indexed
const delay = baseDelay * Math.pow(2, attempt); // 100 * 2^2 = 400ms

// Add jitter (25% of delay)
const jitter = delay * 0.25 * Math.random();
const finalDelay = delay + jitter;
```

**Why jitter?**

Without jitter:
- 100 clients fail at same time
- All retry after exactly 100ms
- All hit service at same time again
- Thundering herd problem! 💥

With jitter:
- Client 1 retries at 75ms
- Client 2 retries at 112ms
- Client 3 retries at 98ms
- Requests spread out ✅
- No thundering herd! 🎉

**Revert User Service to normal after test!**

---

## Exercise 16: Test Non-Retriable Errors

**Goal:** Verify 4xx errors don't retry (only 5xx retry)

**Test 1: 400 Bad Request (should NOT retry)**

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "WrongPassword"
  }'
```

**Expected:**

```json
{
  "success": false,
  "error": {
    "message": "Invalid email or password",
    "code": "VALIDATION_ERROR"
  }
}
```

**Check logs:**

```
[INFO] Request to user-service (attempt 1/1)
[ERROR] Request failed with status 400
[INFO] Non-retriable error, not retrying
```

**No retries!** 400 = client error = fix your request, don't retry ✅

**Test 2: 503 Service Unavailable (should retry)**

```bash
# Stop User Service
# Make request
curl http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

**Check logs:**

```
[INFO] Request to user-service (attempt 1/3)
[ERROR] Request failed with ECONNREFUSED
[INFO] Retrying in 100ms...
[INFO] Request to user-service (attempt 2/3)
[ERROR] Request failed with ECONNREFUSED
[INFO] Retrying in 200ms...
[INFO] Request to user-service (attempt 3/3)
[ERROR] Request failed with ECONNREFUSED
[ERROR] Max retries exceeded
```

**Retries 3 times!** 503 = server error = might be temporary ✅

**Retriable errors:**

- 500 Internal Server Error
- 502 Bad Gateway
- 503 Service Unavailable
- 504 Gateway Timeout
- ECONNREFUSED (connection refused)
- ETIMEDOUT (timeout)
- ECONNRESET (connection reset)

**Non-retriable errors:**

- 400 Bad Request (client error)
- 401 Unauthorized (client error)
- 403 Forbidden (client error)
- 404 Not Found (client error)
- 409 Conflict (client error)
- 422 Unprocessable Entity (client error)

---

# PART 8: Bulkhead Isolation Testing

## Exercise 17: Test Service Isolation

**Goal:** Verify slow User Service doesn't block other services

**Setup:**

1. Add Product Service mock endpoint to Gateway
2. Make User Service respond slowly
3. Verify Product Service remains fast

**Modify User Service temporarily:**

```javascript
// services/user-service/src/controllers/auth.controller.js
exports.getProfile = async (req, res, next) => {
  // Simulate slow response (10 seconds)
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  const user = await db.query('SELECT * FROM users WHERE user_id = $1', [req.user.userId]);
  res.json({ success: true, data: { user: user.rows[0] } });
};
```

**Test:**

```bash
# Terminal 1: Make 10 concurrent requests to User Service
for i in {1..10}; do
  curl http://localhost:3000/api/auth/profile \
    -H "Authorization: Bearer $ACCESS_TOKEN" &
done

# Terminal 2: Immediately check health endpoint (uses different bulkhead)
curl http://localhost:3000/health
# Expected: Returns in <100ms (not blocked!)

# Terminal 3: Check bulkhead stats
curl http://localhost:3000/gateway/health
```

**Expected response:**

```json
{
  "bulkheads": {
    "user-service": {
      "activeRequests": 10,
      "queuedRequests": 0,
      "maxConcurrency": 30,
      "queueDepth": 50,
      "stats": {
        "totalExecuted": 10,
        "totalRejected": 0,
        "avgDuration": 8523
      }
    },
    "health": {
      "activeRequests": 0,
      "queuedRequests": 0,
      "maxConcurrency": 10,
      "stats": {
        "totalExecuted": 1,
        "avgDuration": 42
      }
    }
  }
}
```

**What Happened:**

- User Service has 10 active requests (slow) ✅
- Health endpoint uses separate bulkhead ✅
- Health endpoint not blocked ✅
- Isolation working! ✅

**Without bulkhead isolation:**

```
All 10 slow requests occupy thread pool
↓
Health endpoint queues behind them
↓
Health check times out
↓
Load balancer marks instance unhealthy
↓
No traffic routed to this instance
↓
Service effectively down! 💥
```

**With bulkhead isolation:**

```
User Service requests occupy user-service bulkhead
↓
Health endpoint uses separate bulkhead
↓
Health endpoint responds immediately
↓
Load balancer marks instance healthy
↓
Service remains available! ✅
```

**Revert User Service to normal after test!**

---

## Exercise 18: Test Bulkhead Queue

**Goal:** See requests queue when concurrency limit reached

**Setup:** Configure user-service bulkhead with maxConcurrency: 3

**Test:**

```bash
# Make 10 concurrent requests (max concurrency = 3)
for i in {1..10}; do
  echo "Request $i"
  curl http://localhost:3000/api/auth/profile \
    -H "Authorization: Bearer $ACCESS_TOKEN" &
done

# Check queue
curl http://localhost:3000/gateway/health
```

**Expected:**

```json
{
  "bulkheads": {
    "user-service": {
      "activeRequests": 3,
      "queuedRequests": 7,
      "maxConcurrency": 3,
      "queueDepth": 50
    }
  }
}
```

**What Happened:**

- First 3 requests execute immediately ✅
- Remaining 7 requests queue ✅
- As requests complete, queue drains ✅
- No requests rejected (queue not full) ✅

---

# PART 9: Performance Measurements

## Exercise 19: Measure Response Times

**Goal:** Collect baseline performance metrics

**Setup:** Use Apache Bench (ab) for load testing

**Install Apache Bench:**

```bash
# Windows (Chocolatey)
choco install apache-httpd

# Or use Node.js alternative
npm install -g autocannon
```

**Test 1: Health Endpoint**

```bash
# 1000 requests, 10 concurrent
ab -n 1000 -c 10 http://localhost:3000/health
```

**Expected output:**

```
Concurrency Level:      10
Time taken for tests:   2.345 seconds
Complete requests:      1000
Failed requests:        0
Total transferred:      450000 bytes
Requests per second:    426.44 [#/sec] (mean)
Time per request:       23.45 [ms] (mean)
Time per request:       2.345 [ms] (mean, across all concurrent requests)

Percentage of requests served within a certain time (ms)
  50%     20
  66%     23
  75%     25
  80%     27
  90%     32
  95%     38
  98%     45
  99%     52
 100%     95 (longest request)
```

**Key metrics:**

- **P50 (median)**: 20ms - half of requests faster than this
- **P95**: 38ms - 95% of requests faster than this
- **P99**: 52ms - 99% of requests faster than this
- **Max**: 95ms - slowest request

**Test 2: Authenticated Endpoint**

```bash
# First, get token
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Password123"}' \
  | jq -r '.data.accessToken')

# Load test with authentication
ab -n 1000 -c 10 \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/auth/profile
```

**Expected output:**

```
Requests per second:    156.25 [#/sec] (mean)
Time per request:       64.00 [ms] (mean)

Percentage of requests served within a certain time (ms)
  50%     58
  66%     62
  75%     65
  80%     68
  90%     75
  95%     82
  98%     95
  99%     108
 100%     150
```

**Why slower than health endpoint?**

```
Request flow:
1. Extract JWT (5ms)
2. Verify JWT signature (10ms)
3. Check Redis blacklist (2ms)
4. Forward to User Service (5ms)
5. User Service query database (30ms)
6. Return response (5ms)

Total: ~57ms (P50)
vs health: ~20ms (P50)
```

**Test 3: Using autocannon (better for concurrent testing)**

```bash
# Install
npm install -g autocannon

# Test health endpoint
autocannon -c 10 -d 5 http://localhost:3000/health

# Output:
# Running 5s test @ http://localhost:3000/health
# 10 connections
# 
# ┌─────────┬────────┬─────────┬─────────┬─────────┬───────────┬──────────┬─────────┐
# │ Stat    │ 2.5%   │ 50%     │ 97.5%   │ 99%     │ Avg       │ Stdev    │ Max     │
# ├─────────┼────────┼─────────┼─────────┼─────────┼───────────┼──────────┼─────────┤
# │ Latency │ 18 ms  │ 22 ms   │ 35 ms   │ 42 ms   │ 23.45 ms  │ 5.67 ms  │ 95 ms   │
# └─────────┴────────┴─────────┴─────────┴─────────┴───────────┴──────────┴─────────┘
# ┌───────────┬─────────┬─────────┬─────────┬─────────┬──────────┬─────────┬─────────┐
# │ Stat      │ 1%      │ 2.5%    │ 50%     │ 97.5%   │ Avg      │ Stdev   │ Min     │
# ├───────────┼─────────┼─────────┼─────────┼─────────┼──────────┼─────────┼─────────┤
# │ Req/Sec   │ 380     │ 380     │ 430     │ 450     │ 425.6    │ 21.34   │ 380     │
# └───────────┴─────────┴─────────┴─────────┴─────────┴──────────┴─────────┴─────────┘
# 
# 2.1k requests in 5.02s, 945 kB read
```

**Production targets:**

- **P50**: < 50ms
- **P95**: < 200ms
- **P99**: < 500ms
- **Error rate**: < 0.1%
- **Throughput**: 500+ req/sec per instance

---

## Exercise 20: Database Connection Pool Performance

**Goal:** Measure impact of database pooling

**Test query performance:**

```javascript
// test-db-pool.js
const { Pool } = require('pg');

async function testWithPool() {
  const pool = new Pool({
    host: 'localhost',
    database: 'ecommerce_users',
    user: 'postgres',
    password: 'your_password',
    max: 20, // pool size
    min: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
  });

  const start = Date.now();
  
  const promises = [];
  for (let i = 0; i < 100; i++) {
    promises.push(
      pool.query('SELECT COUNT(*) FROM users')
    );
  }
  
  await Promise.all(promises);
  
  const duration = Date.now() - start;
  console.log(`100 queries with pool: ${duration}ms`);
  console.log(`Average: ${(duration / 100).toFixed(2)}ms per query`);
  
  await pool.end();
  return duration;
}

async function testWithoutPool() {
  const { Client } = require('pg');
  
  const start = Date.now();
  
  for (let i = 0; i < 100; i++) {
    const client = new Client({
      host: 'localhost',
      database: 'ecommerce_users',
      user: 'postgres',
      password: 'your_password'
    });
    
    await client.connect();
    await client.query('SELECT COUNT(*) FROM users');
    await client.end();
  }
  
  const duration = Date.now() - start;
  console.log(`100 queries without pool: ${duration}ms`);
  console.log(`Average: ${(duration / 100).toFixed(2)}ms per query`);
  
  return duration;
}

async function main() {
  console.log('Testing database connection pool...\n');
  
  const withPool = await testWithPool();
  console.log('');
  const withoutPool = await testWithoutPool();
  
  console.log('\n=== RESULTS ===');
  console.log(`With pool: ${withPool}ms`);
  console.log(`Without pool: ${withoutPool}ms`);
  console.log(`Improvement: ${((withoutPool - withPool) / withoutPool * 100).toFixed(1)}%`);
}

main();
```

**Run:**

```bash
node test-db-pool.js
```

**Expected output:**

```
Testing database connection pool...

100 queries with pool: 847ms
Average: 8.47ms per query

100 queries without pool: 12384ms
Average: 123.84ms per query

=== RESULTS ===
With pool: 847ms
Without pool: 12384ms
Improvement: 93.2%
```

**Why such huge improvement?**

**Without pool:**
- Open connection: ~80ms
- Execute query: ~10ms
- Close connection: ~20ms
- Total: ~110ms per query
- 100 queries × 110ms = ~11,000ms

**With pool:**
- First 20 queries: Open connection + execute (~90ms)
- Remaining 80 queries: Reuse connection (~10ms)
- Total: (20 × 90ms) + (80 × 10ms) = 2,600ms

**But parallel execution with pool:**
- All 100 queries execute concurrently (20 at a time)
- Total time ≈ 5 batches × 10ms = ~50ms
- Plus initial connection overhead = ~850ms

**Pool makes 93% improvement!** 🚀

---

# PART 10: Load Testing & Stress Testing

## Exercise 21: Find Breaking Point

**Goal:** Determine maximum throughput before failure

**Test strategy:**

```bash
# Start with low load
autocannon -c 10 -d 10 http://localhost:3000/health
# Note: Throughput, P99 latency, error rate

# Double the load
autocannon -c 20 -d 10 http://localhost:3000/health

# Keep doubling until errors occur
autocannon -c 40 -d 10 http://localhost:3000/health
autocannon -c 80 -d 10 http://localhost:3000/health
autocannon -c 160 -d 10 http://localhost:3000/health
```

**Expected results:**

| Connections | Throughput | P99 Latency | Error Rate |
|-------------|------------|-------------|------------|
| 10          | 425 req/s  | 42ms        | 0%         |
| 20          | 780 req/s  | 58ms        | 0%         |
| 40          | 1,340 req/s| 85ms        | 0%         |
| 80          | 2,100 req/s| 145ms       | 0%         |
| 160         | 2,580 req/s| 890ms       | 0.2%       |
| 320         | 2,650 req/s| 2,500ms     | 5.8%       |

**Breaking point: ~160 connections**

At 320 connections:
- Latency spikes to 2.5 seconds (timeout)
- Error rate increases (timeouts, connection refused)
- Throughput plateaus (saturated)
- System under stress 💥

**What's the bottleneck?**

```bash
# Check system resources
# Windows:
Get-Process -Name node | Select-Object CPU, WS

# Linux/Mac:
top -p $(pgrep node)
```

**Common bottlenecks:**

1. **CPU**: 100% usage → need more cores
2. **Memory**: High usage → memory leak or need more RAM
3. **Database connections**: Pool exhausted → increase pool size
4. **Network**: Bandwidth saturated → scale horizontally
5. **Event loop lag**: Blocked by long operations → optimize code

---

## Exercise 22: Sustained Load Test

**Goal:** Verify system stability under sustained load

**Test:**

```bash
# Run for 5 minutes at 80% of breaking point
# Breaking point = 160 connections
# 80% = 128 connections

autocannon -c 128 -d 300 http://localhost:3000/health

# Monitor during test:
# 1. Check logs for errors
# 2. Monitor memory usage (should be stable)
# 3. Check response times (should be consistent)
# 4. Verify no memory leaks
```

**Expected:**

```
Running 300s test @ http://localhost:3000/health
128 connections

Stat      Avg      Stdev    Max
Latency   75 ms    12 ms    250 ms
Req/Sec   1,680    34       1,750

2,520,000 requests in 300s, 1.13 GB read
```

**What to look for:**

✅ **Stable latency**: P99 doesn't increase over time
✅ **Stable memory**: No continuous growth (memory leak)
✅ **Stable throughput**: Consistent req/sec
✅ **No errors**: 0% error rate
✅ **No crashes**: Service stays up entire test

❌ **Red flags:**
- Latency increases over time
- Memory grows continuously
- Error rate increases
- Service crashes
- CPU usage increases

---

## Exercise 23: Spike Test

**Goal:** Verify system handles sudden traffic spikes

**Test:**

```bash
# Normal load (10 connections) for 30 seconds
autocannon -c 10 -d 30 http://localhost:3000/health

# Spike (200 connections) for 10 seconds
autocannon -c 200 -d 10 http://localhost:3000/health

# Back to normal (10 connections) for 30 seconds
autocannon -c 10 -d 30 http://localhost:3000/health
```

**Expected behavior:**

1. **Before spike**: Normal performance (P99 ~40ms)
2. **During spike**: Increased latency (P99 ~500ms), possible errors
3. **After spike**: System recovers (P99 back to ~40ms)

**Recovery time:**

- ✅ **Good**: Recovers in < 10 seconds
- ⚠️ **Concerning**: Takes 30-60 seconds to recover
- ❌ **Bad**: Doesn't recover (remains slow/errors)

**Circuit breaker during spike:**

```bash
# Check circuit breaker state during spike
watch -n 1 'curl -s http://localhost:3000/gateway/health | jq ".circuitBreakers"'

# Expected:
# Normal: CLOSED (healthy)
# During spike: OPEN (protecting backend)
# After recovery: CLOSED (healthy again)
```

---

# PART 11: Failure Scenarios & Chaos Testing

## Exercise 24: Database Connection Loss

**Goal:** Test behavior when database goes down

**Test:**

```bash
# Stop PostgreSQL
Stop-Service postgresql-x64-14

# Make request
curl http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

**Expected response (503 Service Unavailable):**

```json
{
  "success": false,
  "error": {
    "message": "Database connection failed",
    "code": "SERVICE_UNAVAILABLE",
    "requestId": "..."
  }
}
```

**Check logs:**

```
[ERROR] Database query failed: connection refused
[ERROR] Failed to get user profile
[INFO] Health check failed: database not connected
```

**Health endpoint:**

```bash
curl http://localhost:3000/health
```

**Expected (503 Unhealthy):**

```json
{
  "status": "degraded",
  "checks": {
    "database": {
      "status": "disconnected",
      "error": "connection refused"
    }
  }
}
```

**Restart database:**

```bash
Start-Service postgresql-x64-14

# Wait 5 seconds for reconnection

# Test again
curl http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer $ACCESS_TOKEN"

# Expected: Success! Auto-reconnection works ✅
```

---

## Exercise 25: Redis Connection Loss

**Goal:** Test graceful degradation when Redis fails

**Test:**

```bash
# Stop Redis
Stop-Service redis

# Make request
curl http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

**Expected behavior:**

Option 1: **Fail closed** (security-first)
```json
{
  "success": false,
  "error": {
    "message": "Token blacklist unavailable",
    "code": "SERVICE_UNAVAILABLE"
  }
}
```

Option 2: **Fail open** (availability-first, skip blacklist check)
```json
{
  "success": true,
  "data": {
    "user": { ... }
  }
}
```

**Which is better?**

Depends on context:

**Fail closed (recommended for auth):**
- ✅ Security maintained
- ❌ Availability reduced
- Use when: Security > Availability

**Fail open:**
- ✅ Availability maintained
- ❌ Security reduced (can't check blacklist)
- Use when: Availability > Security

**For rate limiting:**

Always fail open:
```javascript
try {
  await checkRateLimit(req.ip);
} catch (err) {
  // Redis down, allow request (don't block legitimate users)
  logger.warn('Rate limiter unavailable, allowing request');
  next();
}
```

**Restart Redis:**

```bash
Start-Service redis

# Wait 5 seconds

# Test again
curl http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer $ACCESS_TOKEN"

# Expected: Success! ✅
```

---

## Exercise 26: Network Partition

**Goal:** Simulate network issues between Gateway and User Service

**Test:**

```bash
# Block port 3001 (User Service) using Windows Firewall
New-NetFirewallRule -DisplayName "Block User Service" -Direction Outbound -LocalPort 3001 -Protocol TCP -Action Block

# Make request
curl http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

**Expected:**

- Retry attempts (3 retries with exponential backoff)
- Circuit breaker opens after 5 failures
- 503 Service Unavailable response

**Check logs:**

```
[INFO] Request to user-service (attempt 1/3)
[ERROR] Connection refused
[INFO] Retrying in 100ms...
[INFO] Request to user-service (attempt 2/3)
[ERROR] Connection refused
[INFO] Retrying in 200ms...
[INFO] Request to user-service (attempt 3/3)
[ERROR] Connection refused
[ERROR] Max retries exceeded
[WARN] Circuit breaker OPEN for user-service
```

**Remove firewall rule:**

```bash
Remove-NetFirewallRule -DisplayName "Block User Service"

# Wait 30 seconds for circuit breaker reset

# Test again
curl http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer $ACCESS_TOKEN"

# Expected: Success! ✅
```

---

# PART 12: Security Testing

## Exercise 27: SQL Injection Attempt

**Goal:** Verify input validation prevents SQL injection

**Test:**

```bash
# Attempt SQL injection in email field
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com OR 1=1--",
    "password": "anything"
  }'
```

**Expected (400 Bad Request):**

```json
{
  "success": false,
  "error": {
    "message": "Invalid email format",
    "code": "VALIDATION_ERROR"
  }
}
```

**Why it failed:**

```javascript
// Validation middleware catches it
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
if (!emailRegex.test(email)) {
  throw new ValidationError('Invalid email format');
}

// SQL injection attempt: "admin@example.com OR 1=1--"
// Doesn't match email regex
// Rejected before reaching database! ✅
```

**Even if validation bypassed:**

```javascript
// Parameterized query prevents injection
const result = await db.query(
  'SELECT * FROM users WHERE email = $1', // Placeholder
  [email] // Value escaped automatically
);

// PostgreSQL treats entire string as single value
// "admin@example.com OR 1=1--" is literal string, not SQL code
// Safe! ✅
```

---

## Exercise 28: XSS Attack Prevention

**Goal:** Verify XSS attacks are blocked

**Test:**

```bash
# Register user with XSS payload in name
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "xss@example.com",
    "password": "Password123",
    "firstName": "<script>alert(\"XSS\")</script>",
    "lastName": "Test"
  }'
```

**Expected:**

Either:
1. **Validation rejects** (if firstName has character restrictions)
2. **Data stored but sanitized** (escaped before rendering)

**Check database:**

```bash
psql -U postgres -d ecommerce_users -c "SELECT first_name FROM users WHERE email = 'xss@example.com';"
```

**If stored:**

```
first_name
-------------------------
<script>alert("XSS")</script>
```

**When rendered to HTML:**

```javascript
// BAD (vulnerable):
res.send(`<h1>Welcome ${user.firstName}</h1>`);
// Output: <h1>Welcome <script>alert("XSS")</script></h1>
// XSS executes! 💥

// GOOD (safe):
// Using React/Vue (auto-escapes):
<h1>Welcome {user.firstName}</h1>
// Output: <h1>Welcome &lt;script&gt;alert("XSS")&lt;/script&gt;</h1>
// XSS prevented! ✅

// Using template engine with auto-escape:
res.render('profile', { firstName: user.firstName });
// Auto-escapes: &lt;script&gt;...
// XSS prevented! ✅
```

**Security headers (Helmet) also help:**

```
Content-Security-Policy: default-src 'self'
X-XSS-Protection: 1; mode=block
```

---

## Exercise 29: JWT Tampering

**Goal:** Verify tampered tokens are rejected

**Test:**

```bash
# Get valid token
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Password123"}' \
  | jq -r '.data.accessToken')

echo "Valid token: $TOKEN"

# JWT structure: header.payload.signature
# Split by '.'
PARTS=(${TOKEN//./ })
HEADER=${PARTS[0]}
PAYLOAD=${PARTS[1]}
SIGNATURE=${PARTS[2]}

# Decode payload (Base64)
# Modify userId (1 → 2)
# Re-encode
# Keep original signature (tampered!)

# Make request with tampered token
curl http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer $HEADER.$MODIFIED_PAYLOAD.$SIGNATURE"
```

**Expected (401 Unauthorized):**

```json
{
  "success": false,
  "error": {
    "message": "Invalid token signature",
    "code": "INVALID_TOKEN"
  }
}
```

**Why it failed:**

```javascript
// JWT verification
const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });

// Verification steps:
// 1. Split token into header, payload, signature
// 2. Re-calculate signature from header + payload using public key
// 3. Compare calculated signature with provided signature
// 4. If signatures don't match → INVALID TOKEN

// Tampered payload → different signature
// Original signature doesn't match
// Rejected! ✅
```

**Success!** Cannot forge JWT without private key! 🎉

---

# PART 13: Monitoring & Observability

## Exercise 30: Log Analysis

**Goal:** Learn to analyze logs for debugging

**Scenario:** User reports "sometimes login works, sometimes doesn't"

**Step 1: Filter logs by user**

```bash
# View logs
cat logs/combined.log | grep "test@example.com"
```

**Example output:**

```json
{"level":"info","timestamp":"2026-08-03T10:15:23.456Z","message":"Login attempt","email":"test@example.com","ip":"127.0.0.1","requestId":"a1b2c3"}
{"level":"info","timestamp":"2026-08-03T10:15:23.678Z","message":"Login successful","userId":1,"duration":234,"requestId":"a1b2c3"}

{"level":"info","timestamp":"2026-08-03T10:16:45.123Z","message":"Login attempt","email":"test@example.com","ip":"127.0.0.1","requestId":"d4e5f6"}
{"level":"error","timestamp":"2026-08-03T10:16:47.890Z","message":"Login failed","error":"Too many attempts","requestId":"d4e5f6"}
```

**Analysis:**

- First login: Success (234ms)
- Second login: Failed (rate limited)
- Diagnosis: User is making too many login attempts!

**Step 2: Trace request by ID**

```bash
# Get all logs for request a1b2c3
cat logs/combined.log | grep "a1b2c3"
```

**Output:**

```json
{"requestId":"a1b2c3","message":"Request received","method":"POST","url":"/api/auth/login"}
{"requestId":"a1b2c3","message":"Rate limit check passed","ip":"127.0.0.1","remaining":4}
{"requestId":"a1b2c3","message":"Validation passed","email":"test@example.com"}
{"requestId":"a1b2c3","message":"Forwarding to user-service","service":"user-service"}
{"requestId":"a1b2c3","message":"User service response","status":200,"duration":210}
{"requestId":"a1b2c3","message":"Response sent","status":200,"duration":234}
```

**Full request lifecycle traced!** ✅

---

**HANDS-ON-TESTING-GUIDE Part 2 Complete!** 🎉🎉

**What you learned to test:**
- ✅ Connection pool performance (75% faster)
- ✅ Exponential backoff retry (with jitter)
- ✅ Bulkhead isolation (service independence)
- ✅ Performance measurements (P50, P95, P99)
- ✅ Database pooling (93% improvement)
- ✅ Load testing (find breaking point)
- ✅ Failure scenarios (DB down, Redis down, network partition)
- ✅ Security testing (SQL injection, XSS, JWT tampering)
- ✅ Log analysis (request tracing, debugging)

**MODULE-6 COMPLETE!** You now know how to **TEST EVERYTHING** hands-on! 🧪

**Progress: 6 of 10 modules done (60%)!** 🎯

**Remaining modules:**
- MODULE-7: Request Flow Complete (end-to-end tracing)
- MODULE-8: Production vs Tutorial (50+ comparisons)
- MODULE-9: Interview Questions Complete (100+ Q&A)
- MODULE-10: Performance Metrics (benchmarks and monitoring)

Your hands-on testing skills are now **production-level**! Ready to continue? 🚀
