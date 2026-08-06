# MODULE-5: SHARED UTILITIES DEEP DIVE (Part 2)

**This is Part 2 - continuation of MODULE-5-SHARED-UTILITIES-DEEP-DIVE.md**

---

# PART 4: Interview Questions & Answers

## Logger Interview Questions

### Q1: "Why use Winston instead of console.log?"

**Perfect Answer:**

"console.log has 7 critical problems in production:

**1. No timestamps** - Can't tell when events occurred or order them across services

**2. No log levels** - Can't filter errors from info, everything mixed together

**3. No structure** - Plain text can't be queried. 'Show me all errors for user 123' is impossible.

**4. No context** - Missing requestId, userId, service name - can't trace requests across microservices

**5. No persistence** - Logs go to stdout, lost on restart unless piped to file manually

**6. No production integrations** - Can't send to CloudWatch, DataDog, Elasticsearch

**7. Blocks event loop** - console.log is synchronous, high-volume logging slows requests

**Winston provides:**

- Timestamps (RFC3339 format)
- Log levels (error/warn/info/http/debug) 
- Structured JSON output (queryable)
- Metadata (requestId, userId, etc.)
- Multiple transports (console, file, CloudWatch)
- Async logging (doesn't block)
- Log rotation (prevents disk full)

**Example query only possible with structured logs:**

```
// CloudWatch Insights:
fields @timestamp, @message, duration
| filter statusCode >= 500
| stats count() by path
| sort count desc
```

This shows which endpoints have most errors - impossible with console.log."

---

### Q2: "How do you handle sensitive data in logs?"

**Perfect Answer:**

"I follow a whitelist approach - explicitly log what's safe, never log sensitive fields.

**Never log:**
- Passwords (plaintext or hashed)
- Credit card numbers (full PAN)
- CVV codes
- SSN / national IDs
- Private keys / API secrets
- Session tokens (log jti/ID instead)
- Database connection strings with passwords

**Safe to log:**
- User ID (non-sensitive identifier)
- Email (for debugging, but consider GDPR)
- Request ID (correlation)
- Timestamps
- HTTP status codes
- Response times
- Card last 4 digits (if needed)

**Implementation:**

```javascript
// Bad:
logger.info('User logged in', req.body);  // Logs entire body including password!

// Good:
logger.info('User logged in', {
  userId: user.id,
  email: user.email,  // Only safe fields
  ip: req.ip
});

// For payment:
logger.info('Payment processed', {
  orderId: 123,
  cardLast4: '1111',  // Not full number
  cardBrand: 'Visa',
  amount: 99.99
});
```

**Compliance:**

- GDPR: Logs with personal data require same protection as database
- PCI DSS: Full card numbers in logs = immediate audit failure
- SOC 2: Audit logs for who accessed sensitive data

**Auto-redaction library:**

```javascript
const redact = require('redact-secrets');

logger.info('Request', redact({
  password: 'secret123',
  apiKey: 'sk_test_abc123'
}));

// Output: { password: '[REDACTED]', apiKey: '[REDACTED]' }
```

If logs leaked, redacted data prevents account takeover."

---

### Q3: "Explain your log level strategy"

**Perfect Answer:**

"I use 5 levels based on RFC 5424, each with specific purpose:

**ERROR (0 - highest priority):**
- System failures requiring immediate action
- Database connection failed
- Payment processing failed
- Unhandled exceptions
- Trigger: PagerDuty alert, wake up on-call engineer

**WARN (1):**
- Degraded performance but system functional
- High cache miss rate (>80%)
- Slow query detected (>1s)
- Deprecated API used
- Trigger: Email to team, investigate during business hours

**INFO (2):**
- Important business events
- User logged in
- Order created
- Payment successful
- Trigger: None, for audit trail

**HTTP (3):**
- Request/response logging
- Every API call: method, path, status, duration, IP
- Trigger: None, for performance analysis

**DEBUG (4 - lowest priority):**
- Detailed debugging information
- Cache hits/misses
- Query parameters
- Internal state
- Trigger: None, only enable during debugging

**Environment configuration:**

```javascript
// Development: LOG_LEVEL=debug (see everything)
// Staging: LOG_LEVEL=info (business events + errors)
// Production: LOG_LEVEL=info (same as staging)
// Debug production issue: LOG_LEVEL=debug (temporarily)
```

**Cost optimization:**

CloudWatch charges per GB ingested. Debug logs are verbose:
- Info level: ~10GB/day = $5/day
- Debug level: ~100GB/day = $50/day

Only enable debug when actively troubleshooting.

**Query example:**

```
// Show only errors:
fields @timestamp, @message
| filter level = "error"

// Show slow requests:
fields @timestamp, path, duration
| filter level = "http" and duration > 1000
```

Level hierarchy means LOG_LEVEL=info shows info + warn + error, hides http + debug."

---

### Q4: "How do you correlate logs across microservices?"

**Perfect Answer:**

"I use distributed tracing with request IDs propagated via headers:

**Flow:**

```
1. Client makes request
   └─ No X-Request-ID header

2. API Gateway generates UUID
   ├─ requestId = uuidv4()
   ├─ Attaches to req.id
   └─ Sets response header: X-Request-ID

3. Gateway logs request
   logger.info('Request received', { requestId })

4. Gateway forwards to User Service
   Headers: { 'X-Request-ID': requestId }

5. User Service extracts header
   req.id = req.headers['x-request-id']

6. User Service logs with same ID
   logger.info('Query user', { requestId })

7. User Service queries database
   logger.debug('DB query', { requestId, query, duration })

8. All logs share requestId!
```

**CloudWatch Insights query:**

```
// Trace single request across all services:
fields @timestamp, service, @message
| filter requestId = "550e8400-e29b-41d4-a716-446655440000"
| sort @timestamp asc

// Result:
10:15:30.123 [api-gateway] Request received GET /api/users/123
10:15:30.145 [user-service] Query user database
10:15:30.156 [user-service] User found
10:15:30.160 [api-gateway] Response sent 200 37ms
```

**Implementation:**

```javascript
// API Gateway:
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || uuidv4();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// All services:
app.use((req, res, next) => {
  req.logger = logger.child({ requestId: req.id });
  next();
});

// Usage:
req.logger.info('Processing payment');  // Automatically includes requestId
```

**For production at scale:**

- OpenTelemetry: Automatic instrumentation, span IDs, parent-child relationships
- Jaeger/Zipkin: Visualize request flow across services
- DataDog APM: Traces + metrics + logs correlated

But request ID header is 80% of the value with 10% of the complexity."

---

## Error Handling Interview Questions

### Q5: "Explain the difference between operational and programming errors"

**Perfect Answer:**

"Operational and programming errors require completely different handling:

**OPERATIONAL ERRORS (expected, handle gracefully):**

- Definition: External failures beyond code's control
- Examples:
  - User submits invalid email (ValidationError)
  - Database connection timeout (ServiceUnavailableError)  
  - Rate limit exceeded (RateLimitError)
  - User not found (NotFoundError)
  - Network request fails (timeout, DNS failure)
- Characteristics:
  - Expected to happen
  - Can be anticipated and handled
  - Application can recover
  - Don't indicate bugs
- Handling:
  - Catch the error
  - Log with context
  - Return appropriate HTTP status
  - Continue serving requests
- Code:
```javascript
try {
  const user = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  if (!user) throw new NotFoundError('User not found');  // Operational
} catch (error) {
  if (error.isOperational) {
    return res.status(error.statusCode).json({ error: error.message });
  }
  throw error;  // Re-throw if programming error
}
```

**PROGRAMMING ERRORS (bugs, crash):**

- Definition: Bugs in code logic
- Examples:
  - ReferenceError: accessing undefined variable
  - TypeError: calling method on null
  - SyntaxError: invalid code
  - Infinite loop
  - Memory leak
  - Logic error (wrong calculation)
- Characteristics:
  - Unexpected, shouldn't happen
  - Indicate bugs in code
  - Application in unknown state
  - Can't safely recover
- Handling:
  - Log full details
  - Return 500 to client
  - Crash and restart (clean slate)
  - Fix the bug
- Code:
```javascript
function calculateTotal(items) {
  let total = 0;
  for (const item of items) {
    total += item.price;  // If items is undefined: TypeError (programming error)
  }
  return total;
}
```

**Why crash on programming errors?**

After a programming error, application state is unknown:
- Variables might have wrong values
- Connections might be corrupted
- Memory might be leaked

Continuing could cause:
- Data corruption
- Cascading failures
- Security vulnerabilities

Better to crash, restart fresh via process manager (PM2, Kubernetes).

**Detection:**

```javascript
if (error.isOperational) {
  // Operational: handle gracefully
  logger.warn('Operational error', { error: error.message });
  res.status(error.statusCode).json({ error: error.message });
} else {
  // Programming error: crash
  logger.error('Programming error (BUG!)', { error, stack: error.stack });
  res.status(500).json({ error: 'Internal server error' });
  process.exit(1);  // Let PM2/Kubernetes restart
}
```

All my custom errors have `isOperational: true`. Standard errors (TypeError, ReferenceError) don't have it, so detected as programming errors."

---

### Q6: "How do you test error handling?"

**Perfect Answer:**

"I test at three levels:

**1. Unit tests (each error type):**

```javascript
describe('ValidationError', () => {
  test('creates error with correct properties', () => {
    const error = new ValidationError('Invalid email');
    
    expect(error.message).toBe('Invalid email');
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.isOperational).toBe(true);
    expect(error.name).toBe('ValidationError');
    expect(error.stack).toBeDefined();
  });
  
  test('can be caught by instanceof', () => {
    try {
      throw new ValidationError('Test');
    } catch (error) {
      expect(error instanceof ValidationError).toBe(true);
      expect(error instanceof BaseError).toBe(true);
      expect(error instanceof Error).toBe(true);
    }
  });
});
```

**2. Integration tests (error handler middleware):**

```javascript
describe('errorHandler', () => {
  test('handles ValidationError correctly', async () => {
    app.get('/test', (req, res) => {
      throw new ValidationError('Test error');
    });
    
    const res = await request(app).get('/test');
    
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      error: {
        message: 'Test error',
        code: 'VALIDATION_ERROR',
        requestId: expect.any(String)
      }
    });
  });
  
  test('sanitizes 500 errors in production', async () => {
    process.env.NODE_ENV = 'production';
    
    app.get('/test', (req, res) => {
      throw new Error('Internal database details');  // Programming error
    });
    
    const res = await request(app).get('/test');
    
    expect(res.status).toBe(500);
    expect(res.body.error.message).toBe('Internal server error');  // Sanitized!
    expect(res.body.error.message).not.toContain('database');  // Details hidden
  });
  
  test('includes stack in development', async () => {
    process.env.NODE_ENV = 'development';
    
    app.get('/test', (req, res) => {
      throw new Error('Test error');
    });
    
    const res = await request(app).get('/test');
    
    expect(res.body.error.stack).toBeDefined();
  });
});
```

**3. E2E tests (full request flow):**

```javascript
describe('full error flow', () => {
  test('register with duplicate email returns 409', async () => {
    // Create user
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'test@test.com', password: 'Password123' });
    
    // Try to create again (duplicate)
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'test@test.com', password: 'Password123' });
    
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.message).toContain('already registered');
  });
  
  test('invalid token returns 401', async () => {
    const res = await request(app)
      .get('/api/auth/profile')
      .set('Authorization', 'Bearer invalid-token');
    
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });
});
```

**Error scenarios to test:**

- Each custom error type (400, 401, 403, 404, 409, 429, 500, 503)
- Async errors (unhandled promise rejections)
- Sync errors (throw in route handler)
- Database errors (connection timeout)
- Network errors (external API down)
- Rate limit errors
- Authentication errors
- Authorization errors

**Test coverage goal:** 100% of error paths. If error thrown but not tested, might return wrong status code or leak details in production."

---

## Redis Interview Questions

### Q7: "Why use Redis instead of in-memory cache?"

**Perfect Answer:**

"In-memory cache breaks in distributed systems:

**Problem with in-memory:**

```javascript
// In-memory cache (wrong)
const cache = new Map();

// Gateway Instance 1:
cache.set('user:123', userData);
GET /api/users/123 → Cache hit ✅

// Gateway Instance 2:
GET /api/users/123 → Cache miss ❌ (different memory space)
```

With 3 gateway instances:
- Each has separate memory
- User's requests load-balanced across instances
- 66% cache miss rate!

**With Redis:**

```javascript
// Redis cache (correct)
const redisClient = require('./redis');

// Gateway Instance 1:
await redisClient.set('user:123', JSON.stringify(userData));

// Gateway Instance 2:
const data = await redisClient.get('user:123');  // Cache hit ✅
```

All instances share Redis:
- Single source of truth
- Consistent cache hits
- 90%+ hit rate

**Other benefits of Redis:**

**1. Persistence:**
- In-memory: Lost on restart
- Redis: Persists to disk (RDB/AOF)

**2. Atomic operations:**
- In-memory: Race conditions with concurrent access
- Redis: INCR, DECR are atomic

**3. TTL:**
- In-memory: Manual cleanup with setInterval
- Redis: Automatic expiry

**4. Advanced data structures:**
- In-memory: Objects, Maps, Sets
- Redis: Strings, Hashes, Lists, Sets, Sorted Sets, Bitmaps, HyperLogLog

**5. Pub/Sub:**
- In-memory: N/A
- Redis: Built-in message broker

**When in-memory is OK:**

- Single-server application (no horizontal scaling)
- Cache local to request (request-scoped cache)
- Development environment

**When Redis is required:**

- Multiple instances (production always has 2+ for HA)
- Shared state (rate limiting, session storage)
- Need persistence (can't lose cache on restart)
- Need atomic operations (counters, locks)

**Performance:**

```
In-memory Map.get(): ~0.01ms
Redis get(): ~1-2ms

Trade-off: 100x slower, but shared across instances = worth it.
```

For ultimate performance: Local cache (1 min TTL) + Redis (backing store). Best of both worlds."

---

### Q8: "Explain Redis persistence and when to use RDB vs AOF"

**Perfect Answer:**

"Redis has two persistence mechanisms:

**RDB (Redis Database Backup):**

- How it works: Point-in-time snapshots
- Frequency: Every N seconds if M keys changed
- File: dump.rdb
- Example config:
```
save 900 1     # Save if 1 key changed in 15 min
save 300 10    # Save if 10 keys changed in 5 min  
save 60 10000  # Save if 10000 keys changed in 1 min
```

**Pros:**
- Compact single file
- Fast restarts (binary format)
- Good for backups
- Minimal performance impact

**Cons:**
- Data loss possible (last snapshot → crash)
- Save operation forks process (memory spike)
- Not real-time

**AOF (Append Only File):**

- How it works: Log of every write operation
- Frequency: Every second, or every write
- File: appendonly.aof
- Example config:
```
appendfsync always      # Fsync after every write (slowest, safest)
appendfsync everysec    # Fsync every second (good balance)
appendfsync no          # Let OS decide (fastest, riskiest)
```

**Pros:**
- Minimal data loss (1 second max with everysec)
- Real-time durability with always
- Replayable log (human-readable)

**Cons:**
- Larger file size
- Slower restarts (replay log)
- Needs periodic rewrite (compact log)

**Recommendation for our use case:**

```javascript
// Rate limiting, token blacklist, session cache:
// Use: RDB only

// Reasoning:
// 1. Short-lived data (TTL seconds to hours)
// 2. If lost, not critical (rate limit resets, tokens re-issued)
// 3. Performance > durability

// Configuration:
save 900 1
save 300 10
save 60 10000
appendonly no  // AOF disabled
```

**For critical data (e.g., job queue):**

```javascript
// Use: Both RDB + AOF

// Reasoning:
// 1. Can't lose jobs
// 2. Need durability guarantees
// 3. Worth performance cost

// Configuration:
save 900 1
appendonly yes
appendfsync everysec
```

**Our setup:**

Redis is cache, not primary database:
- Rate limits: Stored in Redis, losing them is OK
- Token blacklist: Stored in Redis, worst case revoked token accepted until TTL expires (15 min)
- User data: Stored in PostgreSQL (primary), Redis just caches it

Therefore: **RDB only**, lightweight backups, prioritize performance.

**Testing durability:**

```bash
# Write data
redis-cli SET test "value"

# Force save
redis-cli BGSAVE

# Kill Redis
redis-cli SHUTDOWN NOSAVE  # Simulate crash

# Restart Redis
redis-server

# Check data
redis-cli GET test  # Should return "value" (from last snapshot)
```

If RDB disabled, data lost. If RDB enabled, data restored from dump.rdb."

---

### Q9: "How do you handle Redis downtime?"

**Perfect Answer:**

"Redis downtime requires different strategies based on use case:

**Strategy 1: Fail open (maintain availability):**

```javascript
// For: Token blacklist, cache

async function isBlacklisted(jti) {
  try {
    const result = await redisClient.get(`blacklist:${jti}`);
    return result !== null;
  } catch (error) {
    logger.error('Redis error', { error });
    return false;  // Fail open: assume not blacklisted
  }
}

// Trade-off:
// - System remains available ✅
// - Revoked tokens temporarily accepted ❌
// - Acceptable for short-lived tokens (15 min)
```

**Strategy 2: Fail closed (maintain security):**

```javascript
// For: Rate limiting (if required for security)

async function checkRateLimit(key) {
  try {
    const count = await redisClient.incr(key);
    return count <= RATE_LIMIT;
  } catch (error) {
    logger.error('Redis error', { error });
    return false;  // Fail closed: assume rate limited
  }
}

// Trade-off:
// - Prevents abuse ✅  
// - System becomes unavailable ❌
// - Only if rate limiting critical for security
```

**Strategy 3: Fallback to alternative:**

```javascript
// For: Cache

async function getUser(userId) {
  try {
    // Try Redis cache first
    const cached = await redisClient.get(`user:${userId}`);
    if (cached) return JSON.parse(cached);
  } catch (error) {
    logger.warn('Redis cache unavailable, falling back to database', { error });
  }
  
  // Fallback: Query database directly
  const user = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
  
  // Try to repopulate cache (but don't fail if can't)
  try {
    await redisClient.setEx(`user:${userId}`, 300, JSON.stringify(user));
  } catch (error) {
    // Ignore cache write failure
  }
  
  return user;
}

// Trade-off:
// - Graceful degradation ✅
// - Slower (database query) but functional
// - Best for caching use case
```

**Strategy 4: Circuit breaker:**

```javascript
const redisCircuitBreaker = new CircuitBreaker('redis', {
  failureThreshold: 5,
  timeout: 1000,
  resetTimeout: 30000
});

async function getFromCache(key) {
  return redisCircuitBreaker.execute(
    async () => {
      return await redisClient.get(key);
    },
    async () => {
      // Fallback: return null (cache miss)
      return null;
    }
  );
}

// After 5 failures → Circuit OPEN
// Stop hitting Redis for 30 seconds
// Let Redis recover
```

**High Availability setup:**

```javascript
// Production: Redis Cluster or Sentinel

// Redis Sentinel (automatic failover):
const redisClient = redis.createClient({
  sentinels: [
    { host: 'sentinel1', port: 26379 },
    { host: 'sentinel2', port: 26379 },
    { host: 'sentinel3', port: 26379 }
  ],
  name: 'mymaster'
});

// If master fails:
// 1. Sentinels detect failure (~5 seconds)
// 2. Elect new master from replicas
// 3. Redirect client connections
// 4. Total downtime: <10 seconds ✅

// Redis Cluster (horizontal scaling):
const redisCluster = new Redis.Cluster([
  { host: 'node1', port: 6379 },
  { host: 'node2', port: 6379 },
  { host: 'node3', port: 6379 }
]);

// Data sharded across nodes
// If one node fails, others continue
// High availability + scalability
```

**Monitoring:**

```javascript
// Alert on Redis errors
redisClient.on('error', (error) => {
  logger.error('Redis error - ALERT', { error });
  // Send PagerDuty alert
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await redisClient.ping();
    res.json({ redis: 'connected' });
  } catch (error) {
    res.status(503).json({ redis: 'disconnected' });
  }
});

// CloudWatch metrics
// - Redis connection errors (alert if > 0)
// - Redis command duration (alert if > 100ms)
// - Cache hit rate (alert if < 80%)
```

My strategy: Fail open for cache/blacklist (availability), circuit breaker to protect Redis from load, Sentinel for HA in production."

---

# PART 5: Tutorial vs Production Comparison

## Logging

### Tutorial Approach:

```javascript
// Tutorial logging
console.log('Server started on port 3000');
console.log('User logged in');
console.log('Error:', error);

app.get('/users/:id', async (req, res) => {
  console.log('Fetching user', req.params.id);
  const user = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  console.log('User found:', user);
  res.json(user);
});

// Problems:
// ❌ No timestamps
// ❌ No log levels (can't filter)
// ❌ No structure (can't query)
// ❌ No context (no requestId, userId)
// ❌ Lost on restart
// ❌ Can't send to monitoring
// ❌ Blocks event loop (synchronous)
```

### Production Approach:

```javascript
// Production logging
const logger = require('./shared/logger');

// Startup
logger.info('Server started', {
  port: 3000,
  environment: process.env.NODE_ENV,
  nodeVersion: process.version
});

// Request logging middleware
app.use((req, res, next) => {
  req.logger = logger.child({
    requestId: req.id,
    userId: req.user?.userId,
    ip: req.ip
  });
  next();
});

app.get('/users/:id', async (req, res) => {
  req.logger.info('Fetching user', { userId: req.params.id });
  
  try {
    const user = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    req.logger.info('User fetched successfully', { userId: req.params.id });
    res.json(user);
  } catch (error) {
    req.logger.error('Failed to fetch user', {
      userId: req.params.id,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Benefits:
// ✅ Timestamps (when)
// ✅ Log levels (filter by severity)
// ✅ Structured JSON (queryable)
// ✅ Context (requestId, userId)
// ✅ Persisted to files
// ✅ Sent to CloudWatch
// ✅ Async (doesn't block)
```

---

## Error Handling

### Tutorial Approach:

```javascript
// Tutorial error handling
app.get('/users/:id', async (req, res) => {
  const user = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  
  if (!user) {
    return res.status(404).send('User not found');  // Plain text
  }
  
  res.json(user);
});

app.post('/register', async (req, res) => {
  if (!req.body.email) {
    return res.status(400).send('Email required');  // Inconsistent format
  }
  
  try {
    const user = await createUser(req.body);
    res.json(user);
  } catch (error) {
    console.log(error);
    res.status(500).send('Something went wrong');  // Generic message
  }
});

// Problems:
// ❌ Inconsistent response formats (plain text vs JSON)
// ❌ No error codes
// ❌ No request ID
// ❌ Mixed status code handling
// ❌ Errors logged but not structured
// ❌ Stack traces exposed in development
```

### Production Approach:

```javascript
// Production error handling
const {
  ValidationError,
  NotFoundError
} = require('./shared/errors');

app.get('/users/:id', async (req, res, next) => {
  try {
    const user = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    
    if (!user) {
      throw new NotFoundError('User not found');
    }
    
    res.json({ success: true, data: { user } });
  } catch (error) {
    next(error);  // Pass to error handler
  }
});

app.post('/register', async (req, res, next) => {
  try {
    if (!req.body.email) {
      throw new ValidationError('Email required');
    }
    
    const user = await createUser(req.body);
    res.status(201).json({ success: true, data: { user } });
  } catch (error) {
    next(error);
  }
});

// Global error handler
app.use((err, req, res, next) => {
  req.logger.error('Request error', {
    error: err.message,
    stack: err.stack,
    code: err.code
  });
  
  res.status(err.statusCode || 500).json({
    success: false,
    error: {
      message: err.statusCode === 500 ? 'Internal server error' : err.message,
      code: err.code || 'INTERNAL_ERROR',
      requestId: req.id
    }
  });
});

// Benefits:
// ✅ Consistent JSON responses
// ✅ Error codes (VALIDATION_ERROR, NOT_FOUND)
// ✅ Request ID included
// ✅ Automatic status code mapping
// ✅ Structured error logging
// ✅ Stack traces only in development
// ✅ Centralized error handling
```

---

## Redis

### Tutorial Approach:

```javascript
// Tutorial Redis usage (problems)
const redis = require('redis');

// Multiple connections (wasteful)
// File 1:
const client1 = redis.createClient();
client1.connect();

// File 2:
const client2 = redis.createClient();
client2.connect();

// No error handling
client1.on('error', (err) => {
  console.log('Redis error', err);  // Just console.log
});

// No reconnection strategy
// If Redis down: app crashes

// Synchronous operations (blocks)
const value = client1.get('key');  // ❌ Missing await

// No graceful shutdown
// On SIGTERM: connections left open

// Problems:
// ❌ Multiple connections (memory waste)
// ❌ Poor error handling
// ❌ No reconnection
// ❌ Synchronous code
// ❌ No graceful shutdown
```

### Production Approach:

```javascript
// Production Redis usage
const redis = require('redis');
const logger = require('./logger');

// Singleton connection (shared)
const redisClient = redis.createClient({
  socket: {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    
    // Reconnection strategy
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        logger.error('Redis max retries exceeded');
        return new Error('Max retries');
      }
      const delay = Math.min(retries * 100, 3000);
      logger.info('Redis reconnecting', { attempt: retries, delay });
      return delay;
    }
  },
  password: process.env.REDIS_PASSWORD
});

// Comprehensive error handling
redisClient.on('error', (err) => {
  logger.error('Redis error', {
    error: err.message,
    stack: err.stack
  });
});

redisClient.on('ready', () => {
  logger.info('Redis ready');
});

// Async operations
const getValue = async (key) => {
  try {
    return await redisClient.get(key);
  } catch (error) {
    logger.error('Redis get failed', { key, error });
    throw error;
  }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Closing Redis connection');
  await redisClient.disconnect();
  process.exit(0);
});

// Benefits:
// ✅ Single connection (efficient)
// ✅ Structured error logging
// ✅ Automatic reconnection
// ✅ Async/await
// ✅ Graceful shutdown
```

---

# PART 6: Best Practices & Gotchas

## Logger Best Practices

**DO:**

```javascript
// ✅ Use child loggers for context
app.use((req, res, next) => {
  req.logger = logger.child({ requestId: req.id });
  next();
});

// ✅ Log at appropriate level
logger.error('Database connection failed');  // Requires action
logger.warn('Cache miss rate high');         // Should investigate
logger.info('User logged in');               // Business event

// ✅ Include context
logger.info('Payment processed', {
  orderId: 123,
  userId: 456,
  amount: 99.99
});

// ✅ Use structured data
logger.info('Query executed', {
  query: 'SELECT ...',
  duration: 45,
  rows: 10
});
```

**DON'T:**

```javascript
// ❌ Don't log in loops (floods logs)
for (const user of users) {
  logger.info('Processing user', { userId: user.id });  // 10000 logs!
}
// Instead: Log summary
logger.info('Processing users', { count: users.length });

// ❌ Don't log sensitive data
logger.info('User logged in', {
  password: user.password  // ❌ Never log passwords!
});

// ❌ Don't use string concatenation
logger.info('User ' + userId + ' logged in');  // Hard to query
// Instead: Use structured data
logger.info('User logged in', { userId });

// ❌ Don't log everything at debug level
logger.debug('Function called');
logger.debug('Variable value', { x: 123 });
logger.debug('Loop iteration', { i });
// Results in 100GB/day logs, expensive
```

---

## Error Handling Best Practices

**DO:**

```javascript
// ✅ Use custom error classes
throw new ValidationError('Email required');

// ✅ Always pass error to next()
app.get('/users', async (req, res, next) => {
  try {
    const users = await getUsers();
    res.json(users);
  } catch (error) {
    next(error);  // Let error handler handle it
  }
});

// ✅ Include error context
logger.error('Payment failed', {
  orderId: 123,
  userId: 456,
  error: error.message,
  stack: error.stack
});

// ✅ Sanitize errors in production
if (statusCode === 500 && process.env.NODE_ENV === 'production') {
  message = 'Internal server error';  // Don't leak details
}
```

**DON'T:**

```javascript
// ❌ Don't swallow errors
try {
  await doSomething();
} catch (error) {
  // Silent failure - no one knows error occurred!
}

// ❌ Don't return 200 for errors
if (error) {
  return res.json({ error: 'Failed' });  // ❌ Status 200!
}
// Instead:
if (error) {
  return res.status(500).json({ error: 'Failed' });  // ✅
}

// ❌ Don't use generic errors
throw new Error('Failed');  // What failed? Why? How to handle?
// Instead: Be specific
throw new ValidationError('Email format invalid');

// ❌ Don't expose stack traces in production
res.status(500).json({
  error: error.message,
  stack: error.stack  // ❌ Leaks internal implementation
});
```

---

## Redis Best Practices

**DO:**

```javascript
// ✅ Use TTL for all keys
await redisClient.setEx('key', 300, 'value');  // Expires in 5 min

// ✅ Handle Redis errors gracefully
try {
  const value = await redisClient.get('key');
} catch (error) {
  logger.error('Redis error', { error });
  // Fall back to database or return default
}

// ✅ Use connection pooling (automatic with redis library)

// ✅ Namespace your keys
const key = `user:${userId}:profile`;  // Clear hierarchy

// ✅ Monitor Redis metrics
const memUsed = await redisClient.info('memory');
logger.info('Redis memory usage', { memUsed });
```

**DON'T:**

```javascript
// ❌ Don't create multiple connections
const client1 = redis.createClient();
const client2 = redis.createClient();  // Wasteful!
// Instead: Share one connection (singleton)

// ❌ Don't store large values
await redisClient.set('key', largeObject);  // 10MB object
// Redis is in-memory, limited capacity
// Store in database, cache metadata in Redis

// ❌ Don't forget TTL
await redisClient.set('key', 'value');  // No expiry = memory leak
// Instead: Always set expiry
await redisClient.setEx('key', 3600, 'value');

// ❌ Don't use blocking commands
const value = redisClient.blPop('queue', 0);  // Blocks indefinitely!
// Instead: Use timeout
const value = redisClient.blPop('queue', 5);  // 5 second timeout
```

---

**MODULE-5 COMPLETE!** 🎉🎉

You now have **COMPLETE** understanding of shared utilities:

**Part 1:**
✅ Winston Logger (why, how, configuration, log levels, rotation, structured logging, security)
✅ Custom Errors (8 error classes, error handler, operational vs programming)
✅ Redis Client (singleton, reconnection, operations, use cases, performance)

**Part 2:**
✅ 9 interview questions with perfect answers
✅ Tutorial vs Production comparisons (logging, errors, Redis)
✅ Best practices & gotchas for each utility
✅ Testing strategies (unit, integration, E2E)

**Key Takeaways:**

- **Logger**: console.log → Winston = 7 production benefits
- **Errors**: throw Error → Custom classes = type safety + consistency
- **Redis**: Multiple connections → Singleton = efficiency + shared state

**You're now 50% through the complete curriculum!**

**Progress:**
- ✅ MODULE-1: API Gateway (complete)
- ✅ MODULE-2: Resilience Patterns (complete)
- ✅ MODULE-3: Authentication (complete)
- ✅ MODULE-4: User Service (complete)
- ✅ MODULE-5: Shared Utilities (complete!)

**Remaining:**
- ⏳ MODULE-6: Hands-On Testing Guide
- ⏳ MODULE-7: Request Flow Complete
- ⏳ MODULE-8: Production vs Tutorial
- ⏳ MODULE-9: Interview Questions Complete
- ⏳ MODULE-10: Performance Metrics

Your knowledge is getting **seriously deep** now! Ready to continue? 🚀
