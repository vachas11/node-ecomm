# 📚 Complete Modules Guide - Production Node.js E-Commerce

This document explains **EVERY custom module** you've built, how they work, and why they're production-grade.

---

## 🗂️ Module Structure

```
node-ecomm/
├── shared/                          ← Shared across ALL services
│   ├── logger.js                    ← Winston structured logging
│   ├── errors.js                    ← Custom error classes + handler
│   ├── database.js                  ← PostgreSQL connection pool
│   ├── redis.js                     ← Redis client singleton
│   └── auth/
│       ├── jwt.js                   ← JWT generation/verification
│       ├── middleware.js            ← Authentication middleware
│       ├── blacklist.js             ← Token revocation
│       └── rateLimiter.js           ← Rate limiting presets
│
└── services/
    ├── user-service/
    │   └── src/
    │       ├── controllers/         ← Business logic
    │       ├── routes/              ← API endpoints
    │       └── utils/               ← Service-specific utils
    │
    └── api-gateway/
        └── src/
            ├── lib/                 ← Resilience patterns
            │   ├── CircuitBreaker.js
            │   ├── RetryStrategy.js
            │   ├── ConnectionPool.js
            │   └── BulkheadIsolator.js
            └── middleware/          ← Gateway middleware
```

---

## 📦 SHARED MODULES

These modules are **shared across all microservices** to ensure consistency.

---

### 1. **logger.js** - Structured Logging with Winston

**Location:** `shared/logger.js`

#### **What it does:**
Provides centralized logging for all services with structured JSON format.

#### **Key Features:**
```javascript
const logger = require('../shared/logger');

// Log levels: error, warn, info, debug
logger.info('User logged in', {
  userId: 123,
  email: 'user@example.com',
  ip: '192.168.1.1'
});

logger.error('Database connection failed', {
  error: err.message,
  stack: err.stack
});
```

#### **Production Features:**

| Feature | Purpose |
|---------|---------|
| **JSON format** | Machine-readable for CloudWatch, ELK |
| **Timestamps** | `YYYY-MM-DD HH:mm:ss` |
| **Service name** | Auto-included (from `SERVICE_NAME` env) |
| **Log rotation** | Max 5 files, 5MB each |
| **Console in dev** | Colorized, human-readable |
| **File in prod** | `error.log` and `combined.log` |
| **CloudWatch ready** | Just add transport |

#### **Why production-grade:**
```javascript
// ❌ Tutorial way
console.log('User logged in');
// No timestamp, no context, no searchability

// ✅ Production way
logger.info('User logged in', { userId: 123 });
// Output: {"timestamp":"2026-08-04 10:15:30","level":"info","message":"User logged in","service":"user-service","userId":123}
```

#### **Interview Answer:**
> "I use Winston for structured logging in JSON format. Each log includes timestamp, service name, and contextual metadata like userId or requestId. Logs are written to rotating files and sent to CloudWatch for centralized monitoring. This enables queries like 'show all errors for userId 123' or 'find slow requests > 1s'. Structured logging is essential for debugging distributed systems."

---

### 2. **errors.js** - Custom Error Classes

**Location:** `shared/errors.js`

#### **What it does:**
Typed error classes for consistent error handling across all services.

#### **Error Classes:**
```javascript
const {
  ValidationError,      // 400 - Bad input
  UnauthorizedError,    // 401 - No/invalid token
  ForbiddenError,       // 403 - No permission
  NotFoundError,        // 404 - Resource not found
  ConflictError,        // 409 - Duplicate resource
  DatabaseError,        // 500 - DB operation failed
  errorHandler,         // Global error handler middleware
  asyncHandler          // Async wrapper
} = require('../shared/errors');
```

#### **Usage in Routes:**
```javascript
// Without asyncHandler (verbose)
app.get('/users/:id', async (req, res, next) => {
  try {
    const user = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    if (!user) throw new NotFoundError('User not found');
    res.json(user);
  } catch (error) {
    next(error);
  }
});

// With asyncHandler (clean)
app.get('/users/:id', asyncHandler(async (req, res) => {
  const user = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  if (!user) throw new NotFoundError('User not found');
  res.json(user);
}));
```

#### **Error Response Format:**
```json
{
  "success": false,
  "error": {
    "message": "User not found",
    "statusCode": 404
  }
}
```

#### **Why production-grade:**
- **Typed errors** - Easy to catch specific errors
- **Stack traces** - Auto-captured
- **Operational flag** - Distinguish client vs server errors
- **Dev vs Prod** - Full details in dev, sanitized in prod
- **asyncHandler** - No try-catch hell

#### **Interview Answer:**
> "I use custom error classes that extend Error with statusCode and isOperational flags. This separates client errors (4xx) from server errors (5xx). In production, I send sanitized error messages to hide internal details, but in development I include stack traces for debugging. The asyncHandler wrapper eliminates try-catch boilerplate in every route."

---

### 3. **database.js** - PostgreSQL Connection Pool

**Location:** `shared/database.js`

#### **What it does:**
Manages PostgreSQL connections efficiently with connection pooling.

#### **Key Features:**
```javascript
const DatabasePool = require('../shared/database');

// Create pool for each service
const db = new DatabasePool({
  database: 'user_db',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

// Execute query
const result = await db.query(
  'SELECT * FROM users WHERE email = $1',
  ['user@example.com']
);

// Transaction support
await db.transaction(async (client) => {
  await client.query('UPDATE users SET balance = balance - 100 WHERE id = $1', [userId]);
  await client.query('INSERT INTO transactions (user_id, amount) VALUES ($1, $2)', [userId, 100]);
});

// Health check
const stats = db.getStats();
// { total: 20, idle: 15, waiting: 0 }
```

#### **Connection Pool Settings:**
```javascript
{
  max: 20,                    // Maximum 20 connections
  min: 5,                     // Keep 5 idle ready
  idleTimeoutMillis: 30000,   // Close idle after 30s
  connectionTimeoutMillis: 5000 // Wait max 5s for connection
}
```

#### **Why Connection Pooling:**

**WITHOUT Pool:**
```
Request 1: Open DB connection (50ms)
Request 2: Open DB connection (50ms)
Request 3: Open DB connection (50ms)
...
Request 100: Open DB connection (50ms)

Total: 5000ms wasted on connections!
```

**WITH Pool:**
```
Request 1: Open connection (50ms) → Keep in pool
Requests 2-100: Reuse connections (0ms)

Total: 50ms for 100 requests!
```

#### **Interview Answer:**
> "I use connection pooling to reuse database connections efficiently. Each service maintains a pool of 20 max connections with 5 kept idle and ready. This eliminates the 50ms overhead of establishing new connections for every request. The pool also handles connection health checks and auto-reconnects. For production, I enable SSL for AWS RDS connections."

---

### 4. **redis.js** - Redis Client Singleton

**Location:** `shared/redis.js`

#### **What it does:**
Provides a singleton Redis client for caching and rate limiting.

#### **Key Features:**
```javascript
const redisClient = require('../shared/redis');

// Connect (do this once on startup)
await redisClient.connect();

// Cache wrapper (auto JSON serialization)
await redisClient.set('user:123', { name: 'John' }, 3600); // TTL 1 hour
const user = await redisClient.get('user:123');

// Pattern deletion
await redisClient.delPattern('user:*'); // Delete all user keys

// Rate limiting primitives
const count = await redisClient.incr('login:192.168.1.1');
await redisClient.expire('login:192.168.1.1', 900); // 15 minutes

// Health check
const alive = await redisClient.ping(); // true/false
```

#### **Why Redis:**
```javascript
// WITHOUT Redis (database query every time)
app.get('/users/:id', async (req, res) => {
  const user = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  // Query takes 50ms
  res.json(user);
});

// WITH Redis (cache hit = 5ms)
app.get('/users/:id', async (req, res) => {
  const cached = await redisClient.get(`user:${req.params.id}`);
  if (cached) return res.json(cached); // 5ms!

  const user = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  await redisClient.set(`user:${req.params.id}`, user, 3600);
  res.json(user);
});
```

#### **Production Features:**
- **Singleton pattern** - One client per service
- **Auto-reconnect** - Exponential backoff
- **AWS ElastiCache ready** - TLS support
- **Graceful degradation** - Returns null on error
- **Connection pooling** - Handles concurrent requests

#### **Interview Answer:**
> "I use Redis as an in-memory cache to reduce database load. Hot data like user profiles are cached with TTL, cutting query time from 50ms to 5ms. Redis also powers our rate limiting - we track request counts per IP with automatic expiry. The singleton pattern ensures one connection per service, and it fails gracefully if Redis is down."

---

## 🔐 SHARED AUTH MODULES

---

### 5. **auth/jwt.js** - JWT Token Management

**Location:** `shared/auth/jwt.js`

#### **What it does:**
Handles JWT generation and verification for **three token types**: access, refresh, and service.

#### **Token Types:**

```javascript
const { generateTokenPair, verifyAccessToken } = require('../shared/auth/jwt');

// 1. ACCESS TOKEN (15 minutes)
const accessToken = generateAccessToken({
  userId: 123,
  email: 'user@example.com',
  role: 'user'
});
// Payload: { userId, email, role, jti, tokenType: 'access', exp }

// 2. REFRESH TOKEN (7 days)
const refreshToken = generateRefreshToken({ userId: 123 });
// Payload: { userId, jti, tokenType: 'refresh', exp }

// 3. SERVICE TOKEN (1 hour, for internal APIs)
const serviceToken = generateServiceToken('order-service', {
  permissions: ['read:users', 'write:orders']
});
// Payload: { serviceId, permissions, jti, tokenType: 'service', exp }
```

#### **Why Short Access Tokens:**
```
OWASP Recommendation: 15-minute access tokens
Reason: If token is stolen, it's only valid for 15 minutes

User Journey:
├─ Login → Get 15min access + 7day refresh
├─ Access token used for 15 minutes
├─ After 15min → Use refresh to get NEW access token
└─ Refresh token rotates on each use (security)
```

#### **Security Features:**
```javascript
// JWT ID (jti) for revocation
{
  jti: '550e8400-e29b-41d4-a716-446655440000', // Unique ID
  tokenType: 'access', // Prevent token type confusion
  iat: 1691077230 // Issued at timestamp
}

// Secret validation on startup
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters long');
}
```

#### **Interview Answer:**
> "I use short-lived access tokens (15 minutes) per OWASP recommendations, paired with long-lived refresh tokens (7 days). Each token includes a jti (JWT ID) for revocation tracking - when a user logs out, we blacklist the jti in Redis. I use separate secrets for access and refresh tokens, and validate secret strength on startup. Service tokens authenticate internal APIs with permission-based authorization."

---

### 6. **auth/middleware.js** - Authentication Middleware

**Location:** `shared/auth/middleware.js`

#### **What it does:**
Provides middleware for authentication and authorization.

#### **Middleware Functions:**

```javascript
const { authenticate, authorize, authenticateService } = require('../shared/auth/middleware');

// 1. AUTHENTICATE (verify JWT)
app.get('/profile', authenticate(), (req, res) => {
  // req.user = { userId, email, role, jti }
  res.json(req.user);
});

// 2. AUTHORIZE (check roles)
app.delete('/users/:id',
  authenticate(),
  authorize('admin', 'moderator'), // Only admin/moderator
  (req, res) => {
    // Delete user
  }
);

// 3. OPTIONAL AUTH (doesn't fail if no token)
app.get('/products', optionalAuth(), (req, res) => {
  if (req.user) {
    // Show personalized products
  } else {
    // Show public products
  }
});

// 4. SERVICE AUTH (internal APIs)
app.get('/api/internal/users/:id',
  authenticateService,
  authorizeService('read:users'),
  (req, res) => {
    // req.service = { serviceId, permissions }
  }
);
```

#### **Flow:**
```
Request → authenticate() → Check blacklist → Verify JWT → Attach user to req → Next
```

#### **Interview Answer:**
> "I use middleware for authentication and authorization. The authenticate middleware extracts and verifies the JWT from the Authorization header, checks if it's blacklisted in Redis, then attaches user info to the request object. The authorize middleware checks if the user's role matches required roles. For internal APIs, I use separate service authentication with permission-based authorization."

---

### 7. **auth/blacklist.js** - Token Revocation

**Location:** `shared/auth/blacklist.js`

#### **What it does:**
Manages token blacklist in Redis for logout functionality.

#### **How it works:**
```javascript
const { addToBlacklist, isBlacklisted } = require('../shared/auth/blacklist');

// Logout: Add token to blacklist
const jti = 'token-jti-here';
const ttl = 900; // 15 minutes (remaining token lifetime)
await addToBlacklist(jti, ttl);

// Check if blacklisted (in authenticate middleware)
const blacklisted = await isBlacklisted(jti);
if (blacklisted) {
  throw new UnauthorizedError('Token has been revoked');
}
```

#### **Why TTL = Token Lifetime:**
```javascript
Token expires in 15 minutes
→ Blacklist it for 15 minutes
→ After 15 minutes, Redis auto-deletes (token already expired anyway)
→ No cleanup job needed!
```

#### **Redis Keys:**
```
blacklist:550e8400-e29b-41d4-a716-446655440000 → "1" (TTL: 900s)
```

#### **Interview Answer:**
> "I implement token revocation using Redis. When a user logs out, I blacklist the token's jti (JWT ID) with a TTL matching the token's remaining lifetime. The authenticate middleware checks the blacklist before allowing requests. After the TTL expires, Redis auto-deletes the entry since the token is expired anyway. This enables logout without making JWT stateful."

---

### 8. **auth/rateLimiter.js** - Rate Limiting

**Location:** `shared/auth/rateLimiter.js`

#### **What it does:**
Provides rate limiting presets to prevent abuse.

#### **Presets:**

```javascript
const {
  loginRateLimiter,      // 5 attempts per 15 min
  registerRateLimiter,   // 3 accounts per hour
  refreshRateLimiter,    // 10 refreshes per hour
  apiRateLimiter,        // 100 requests per 15 min
  strictRateLimiter      // 3 requests per 15 min
} = require('../shared/auth/rateLimiter');

// Apply to routes
app.post('/api/auth/login', loginRateLimiter, loginHandler);
app.post('/api/auth/register', registerRateLimiter, registerHandler);
app.post('/api/auth/refresh', refreshRateLimiter, refreshHandler);

// Custom rate limiter
const customLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: 'Too many requests',
  keyGenerator: (req) => req.user?.userId || req.ip
});
```

#### **Response when exceeded:**
```json
{
  "success": false,
  "error": {
    "message": "Too many login attempts, please try again after 15 minutes",
    "statusCode": 429,
    "retryAfter": 900
  }
}
```

#### **Redis-backed:**
```
Uses Redis for distributed rate limiting
→ Works across multiple gateway instances
→ Falls back to in-memory if Redis down
```

#### **Interview Answer:**
> "I use Redis-backed rate limiting to prevent brute force attacks. Login endpoints are limited to 5 attempts per 15 minutes per IP+email combination. Registration is limited to 3 accounts per hour per IP. The rate limiter uses Redis so limits work across multiple gateway instances. If Redis is unavailable, it falls back to in-memory store. Failed login attempts don't count toward the limit to prevent lockout of legitimate users."

---

## ⚡ API GATEWAY RESILIENCE MODULES

---

### 9. **CircuitBreaker.js** - Fail Fast Pattern

**Location:** `services/api-gateway/src/lib/CircuitBreaker.js`

#### **What it does:**
Prevents cascade failures by failing fast when a service is down.

#### **Three States:**
```
CLOSED (Normal Operation)
├─ All requests go through
├─ Track failures
└─ If failures ≥ 5 → OPEN

OPEN (Service Down)
├─ Fail immediately (no 30s timeout!)
├─ After 30s → HALF_OPEN

HALF_OPEN (Testing Recovery)
├─ Allow 1 request
├─ If succeeds → CLOSED
└─ If fails → OPEN
```

#### **Usage:**
```javascript
const CircuitBreaker = require('./lib/CircuitBreaker');

const breaker = new CircuitBreaker('user-service', {
  failureThreshold: 5,      // Open after 5 failures
  successThreshold: 2,      // Close after 2 successes
  timeout: 3000,            // 3s request timeout
  resetTimeout: 30000       // Try recovery after 30s
});

// Execute with fallback
const result = await breaker.execute(
  async () => {
    return await axios.post('/api/login', data);
  },
  async () => {
    // Fallback response
    return { error: 'Service temporarily unavailable' };
  }
);
```

#### **Interview Answer:**
> "I implement the Circuit Breaker pattern to prevent cascade failures. When a service fails 5 times, the breaker opens and fails requests immediately instead of waiting for timeouts. This prevents thread exhaustion in the gateway. After 30 seconds, it enters half-open state to test if the service recovered. This is how Netflix handles service degradation - it's essential for resilient microservices."

---

### 10. **RetryStrategy.js** - Exponential Backoff

**Location:** `services/api-gateway/src/lib/RetryStrategy.js`

#### **What it does:**
Handles transient failures with smart retry logic.

#### **Retry Timeline:**
```
Attempt 1: Immediate
Attempt 2: Wait 100ms ± 25ms (jitter)
Attempt 3: Wait 200ms ± 50ms
Attempt 4: Wait 400ms ± 100ms

Total: ~700ms (not 30 seconds!)
```

#### **Usage:**
```javascript
const RetryStrategy = require('./lib/RetryStrategy');

const retry = new RetryStrategy({
  maxRetries: 3,
  initialDelay: 100,
  maxDelay: 2000,
  backoffFactor: 2,
  jitter: true
});

const result = await retry.execute(async (attemptNumber) => {
  return await axios.post('/api/login', data);
}, { service: 'user-service' });
```

#### **Smart Retry Logic:**
```javascript
// DON'T retry client errors (4xx)
400, 401, 403, 404 → Immediate fail

// RETRY server errors (5xx)
500, 502, 503 → Retry with backoff

// RETRY network errors
ECONNREFUSED, ETIMEDOUT → Retry

// DON'T retry
CIRCUIT_OPEN, ENOTFOUND → Immediate fail
```

#### **Why Jitter:**
```
WITHOUT JITTER:
Service fails → 1000 requests retry at SAME time
→ Thundering herd → Service crashes again

WITH JITTER:
Service fails → 1000 requests spread over 75-125ms
→ Gradual recovery → Service handles load
```

#### **Interview Answer:**
> "I use exponential backoff with jitter to handle transient failures. Each retry doubles the delay up to a maximum, and jitter adds ±25% randomness to prevent the thundering herd problem. I only retry server errors (5xx) and network errors, not client errors (4xx) since those won't succeed on retry. This recovers from brief network blips without overwhelming the backend."

---

## 📊 Module Usage Summary

```javascript
// EXAMPLE: Complete request flow using all modules

// 1. Logging
logger.info('Request received', { requestId, userId });

// 2. Rate limiting
app.post('/api/login', loginRateLimiter, ...);

// 3. Authentication
app.get('/profile', authenticate(), ...);

// 4. Authorization
app.delete('/user', authenticate(), authorize('admin'), ...);

// 5. Database with connection pool
const user = await db.query('SELECT * FROM users WHERE id = $1', [id]);

// 6. Redis caching
const cached = await redisClient.get(`user:${id}`);

// 7. Circuit breaker
await breaker.execute(() => axios.post('/api/order', data));

// 8. Retry strategy
await retry.execute(() => axios.post('/api/payment', data));

// 9. Error handling
throw new NotFoundError('User not found');

// 10. Blacklist check
const revoked = await isBlacklisted(jti);
```

---

## 🎯 Reading Order Recommendation

1. **Start with basics:**
   - [logger.js](../shared/logger.js) - Understand structured logging
   - [errors.js](../shared/errors.js) - Custom error classes
   
2. **Database and caching:**
   - [database.js](../shared/database.js) - Connection pooling
   - [redis.js](../shared/redis.js) - Redis client
   
3. **Authentication flow:**
   - [auth/jwt.js](../shared/auth/jwt.js) - Token generation
   - [auth/middleware.js](../shared/auth/middleware.js) - Auth middleware
   - [auth/blacklist.js](../shared/auth/blacklist.js) - Token revocation
   - [auth/rateLimiter.js](../shared/auth/rateLimiter.js) - Rate limiting
   
4. **Resilience patterns (ADVANCED):**
   - [CircuitBreaker.js](../services/api-gateway/src/lib/CircuitBreaker.js)
   - [RetryStrategy.js](../services/api-gateway/src/lib/RetryStrategy.js)
   - [ConnectionPool.js](../services/api-gateway/src/lib/ConnectionPool.js)
   - [BulkheadIsolator.js](../services/api-gateway/src/lib/BulkheadIsolator.js)

---

## 🎤 Interview Preparation

### Key Talking Points

**"Walk me through your auth system"**
→ Point to: jwt.js, middleware.js, blacklist.js

**"How do you handle database connections?"**
→ Point to: database.js (connection pooling)

**"How do you prevent brute force attacks?"**
→ Point to: rateLimiter.js (Redis-backed rate limiting)

**"How do you handle service failures?"**
→ Point to: CircuitBreaker.js, RetryStrategy.js

**"How do you debug issues in production?"**
→ Point to: logger.js (structured logging with requestId)

**"How do you cache data?"**
→ Point to: redis.js (cache wrapper with TTL)

---

## 📚 Next Steps

- **Practice:** Use each module in a real request flow
- **Test:** Write unit tests for each module
- **Deploy:** See how they work in production
- **Monitor:** Check CloudWatch logs and Redis metrics

**You now have production-grade modules that separate you from junior developers!**
