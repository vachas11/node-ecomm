# MODULE-1 Continuation: Lines 62-209

**This continues from DEEP-DIVE-ENTRY-POINT.md**

---

### **Line 62: Global Rate Limiting**

```javascript
app.use(apiRateLimiter);
```

**What this does:**
Applies rate limiting to ALL routes globally.

**What is Rate Limiting?**

Rate limiting prevents abuse by limiting how many requests a user can make in a time window.

**Without Rate Limiting:**

```javascript
// Attacker script:
for (let i = 0; i < 1000000; i++) {
  fetch('http://api.example.com/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'admin@test.com', password: 'guess' + i })
  });
}

// Server receives 1 million requests
// Database gets hammered
// Server crashes ❌
```

**With Rate Limiting:**

```javascript
// First 100 requests in 15 minutes: ✅ Allowed
// Request 101: ❌ 429 Too Many Requests

// Response:
{
  "error": "Too many requests, please try again later",
  "retryAfter": 900  // seconds
}

// Headers:
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 2026-07-30T10:30:00Z
```

**How it Works (Token Bucket Algorithm):**

```javascript
// Imagine a bucket with 100 tokens
// Each request costs 1 token
// Bucket refills at fixed rate

Minute 0: Bucket has 100 tokens
Request 1: -1 token → 99 remaining ✅
Request 2: -1 token → 98 remaining ✅
...
Request 100: -1 token → 0 remaining ✅
Request 101: NO TOKENS ❌ → 429 response

// After 15 minutes: Bucket refills to 100
```

**Why Redis-Backed?**

```javascript
// ❌ In-memory rate limiting (bad for multiple servers)
const counts = {};  // Lost when server restarts!

Server 1: counts['user@test.com'] = 50
Server 2: counts['user@test.com'] = 50
// Total: 100 requests allowed (should be 50!)

// ✅ Redis-backed (works across multiple servers)
Redis: SET ratelimit:user@test.com 50 EX 900

Server 1: Redis GET → 50
Server 2: Redis GET → 50
// Both see same count ✅
```

**Production Configuration:**

```javascript
const apiRateLimiter = rateLimit({
  store: new RedisStore({ client: redis }),
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 100,                   // 100 requests per window
  message: {
    success: false,
    error: {
      message: 'Too many requests from this IP, please try again later',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: 900
    }
  },
  standardHeaders: true,  // Return rate limit info in headers
  legacyHeaders: false,   // Disable X-RateLimit-* headers (use standard)
  
  // Skip rate limit for internal services
  skip: (req) => {
    return req.headers['x-internal-service'] === 'true';
  },
  
  // Different limits per endpoint
  keyGenerator: (req) => {
    // Rate limit by IP + endpoint
    return `${req.ip}:${req.path}`;
  }
});
```

**Interview Question:**
> **Q:** "How do you prevent brute force attacks?"
>
> **A:** "I implement rate limiting using the token bucket algorithm backed by Redis. For login endpoints, I limit to 5 attempts per 15 minutes per IP. For API endpoints, 100 requests per 15 minutes. Redis allows this to work across multiple gateway instances. I return 429 status with Retry-After header. For sophisticated attacks, I'd add IP reputation checking, CAPTCHA after N failures, and account lockout after repeated failures."

---

### **Lines 65-117: Health Check Endpoint** ⭐⭐⭐

```javascript
app.get('/health', async (req, res) => {
  try {
    // Check Redis connection
    const redisHealthy = await redisClient.ping();

    // Check backend services health
    const serviceChecks = await Promise.allSettled(
      getAllServices().map(async (service) => {
        try {
          const healthUrl = `${service.url}${service.healthCheck}`;
          const response = await axios.get(healthUrl, { timeout: 5000 });
          return {
            name: service.name,
            status: response.status === 200 ? 'healthy' : 'unhealthy',
            url: service.url
          };
        } catch (error) {
          return {
            name: service.name,
            status: 'unhealthy',
            url: service.url,
            error: error.message
          };
        }
      })
    );

    const services = serviceChecks.map(result =>
      result.status === 'fulfilled' ? result.value : result.reason
    );

    const allServicesHealthy = services.every(s => s.status === 'healthy');

    res.status(allServicesHealthy ? 200 : 503).json({
      status: allServicesHealthy ? 'healthy' : 'degraded',
      service: 'api-gateway',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      redis: {
        status: redisHealthy ? 'connected' : 'disconnected'
      },
      services
    });
  } catch (error) {
    logger.error('Health check failed:', { error: error.message });
    res.status(503).json({
      status: 'unhealthy',
      service: 'api-gateway',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});
```

**THIS IS CRITICAL FOR PRODUCTION! 🚨**

**Why Health Checks Matter:**

```
AWS Load Balancer:
├─ Sends GET /health every 30 seconds
├─ If returns 200: Route traffic to this instance ✅
├─ If returns 503: Stop routing traffic ❌
└─ If fails 3 times: Remove instance from pool

Without health check:
├─ Load balancer sends traffic to dead instance
├─ All requests fail with 503
└─ Users see errors ❌

With health check:
├─ Gateway detects Redis is down
├─ Returns 503 "degraded"
├─ Load balancer stops routing traffic
└─ Users hit healthy instances ✅
```

**Code Breakdown:**

**Part 1: Check Redis**

```javascript
const redisHealthy = await redisClient.ping();
// Sends PING command to Redis
// Returns true if Redis responds with PONG
// Returns false if Redis is down/unreachable
```

**Part 2: Check Backend Services (Promise.allSettled)**

```javascript
// Why Promise.allSettled and NOT Promise.all?

// ❌ Promise.all (bad):
await Promise.all([
  checkUserService(),   // fails ❌
  checkProductService(), // never executed!
  checkOrderService()    // never executed!
]);
// If one fails, ALL fail immediately

// ✅ Promise.allSettled (good):
await Promise.allSettled([
  checkUserService(),   // fails ❌
  checkProductService(), // still executes ✅
  checkOrderService()    // still executes ✅
]);
// Waits for ALL to complete, even if some fail
```

**Part 3: Service Health Check**

```javascript
const healthUrl = `${service.url}${service.healthCheck}`;
// Example: http://localhost:3001/health

const response = await axios.get(healthUrl, { timeout: 5000 });
// 5-second timeout (don't wait forever)

return {
  name: service.name,
  status: response.status === 200 ? 'healthy' : 'unhealthy',
  url: service.url
};
```

**Part 4: Aggregate Status**

```javascript
const allServicesHealthy = services.every(s => s.status === 'healthy');

// If ALL services healthy: 200 OK
// If ANY service unhealthy: 503 Service Unavailable

// Why 503 not 500?
// 503 = Temporary issue, retry later
// 500 = Server error, something's broken in code
```

**Health Check Response Examples:**

**Scenario 1: Everything Healthy**

```http
GET /health
Response: 200 OK

{
  "status": "healthy",
  "service": "api-gateway",
  "timestamp": "2026-07-30T10:15:30.123Z",
  "uptime": 3600.5,  // seconds
  "redis": {
    "status": "connected"
  },
  "services": [
    { "name": "user-service", "status": "healthy", "url": "http://localhost:3001" },
    { "name": "product-service", "status": "healthy", "url": "http://localhost:3002" },
    { "name": "order-service", "status": "healthy", "url": "http://localhost:3003" }
  ]
}
```

**Scenario 2: Redis Down**

```http
GET /health
Response: 503 Service Unavailable

{
  "status": "degraded",
  "service": "api-gateway",
  "timestamp": "2026-07-30T10:15:30.123Z",
  "uptime": 3600.5,
  "redis": {
    "status": "disconnected"  // ← Problem!
  },
  "services": [
    { "name": "user-service", "status": "healthy", "url": "http://localhost:3001" },
    { "name": "product-service", "status": "healthy", "url": "http://localhost:3002" },
    { "name": "order-service", "status": "healthy", "url": "http://localhost:3003" }
  ]
}
```

**Scenario 3: User Service Down**

```http
GET /health
Response: 503 Service Unavailable

{
  "status": "degraded",
  "service": "api-gateway",
  "timestamp": "2026-07-30T10:15:30.123Z",
  "uptime": 3600.5,
  "redis": {
    "status": "connected"
  },
  "services": [
    { "name": "user-service", "status": "unhealthy", "url": "http://localhost:3001", "error": "ECONNREFUSED" },  // ← Problem!
    { "name": "product-service", "status": "healthy", "url": "http://localhost:3002" },
    { "name": "order-service", "status": "healthy", "url": "http://localhost:3003" }
  ]
}
```

**Kubernetes Health Checks:**

```yaml
# deployment.yaml
livenessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 30
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3
  # If fails 3 times, restart container

readinessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 5
  # If fails, remove from service (don't restart)
```

**Liveness vs Readiness:**

```
Liveness Probe (Is the app alive?):
├─ Checks if app is running
├─ If fails: Restart container
└─ Use for: Deadlocks, infinite loops

Readiness Probe (Is the app ready to serve traffic?):
├─ Checks if app can handle requests
├─ If fails: Remove from load balancer (don't restart)
└─ Use for: Dependencies down (DB, Redis, other services)
```

**Production Monitoring:**

```javascript
// CloudWatch Alarm
Alarm: HealthCheckFailure
Metric: HTTPCode_Target_5XX_Count
Threshold: > 10 in 5 minutes
Action: Send SNS notification → PagerDuty → Wake up on-call engineer
```

**Interview Question:**
> **Q:** "How do load balancers know which instances are healthy?"
>
> **A:** "Load balancers send periodic health check requests to a designated endpoint, typically GET /health. The endpoint checks critical dependencies - database connectivity, Redis, downstream services. If everything is healthy, it returns 200. If any dependency is degraded, it returns 503. The load balancer monitors this - if an instance fails N consecutive checks (usually 3), it's removed from the pool and traffic is routed only to healthy instances. This prevents cascading failures and provides automatic recovery."

---

### **Lines 120-135: Route Registration**

```javascript
// API routes
app.use('/api', routes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'API Gateway',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/health',
      auth: '/api/auth/*',
      products: '/api/products/*',
      orders: '/api/orders/*'
    }
  });
});
```

**What `app.use('/api', routes)` does:**

```javascript
// All routes in 'routes' file are prefixed with /api

// In routes/index.js:
router.post('/auth/login', ...)  // This becomes /api/auth/login
router.get('/products', ...)     // This becomes /api/products

// Why prefix with /api?
// 1. Versioning: Can add /api/v2 later
// 2. Separation: /api for API, / for docs/website
// 3. Convention: Standard REST API practice
```

**Root Endpoint (Service Discovery):**

```http
GET http://localhost:3000/

Response: 200 OK
{
  "service": "API Gateway",
  "version": "1.0.0",
  "status": "running",
  "endpoints": {
    "health": "/health",
    "auth": "/api/auth/*",
    "products": "/api/products/*",
    "orders": "/api/orders/*"
  }
}
```

**Why this is useful:**
- Developers can discover available endpoints
- Automated tools can introspect API
- Shows service is running
- Returns version for debugging

**Production Alternative (OpenAPI/Swagger):**

```javascript
app.get('/', (req, res) => {
  res.json({
    service: 'API Gateway',
    version: '2.0.0',
    swagger: '/api/docs',  // OpenAPI spec
    healthCheck: '/health'
  });
});

// Swagger UI at /api/docs
// Shows all endpoints, parameters, examples
```

---

### **Line 138: Global Error Handler** ⭐

```javascript
app.use(errorHandler);
```

**THIS MUST BE LAST MIDDLEWARE!**

**Why Order Matters:**

```javascript
// ✅ CORRECT ORDER:
app.use(helmet());           // 1. Security
app.use(cors());             // 2. CORS
app.use(express.json());     // 3. Body parsing
app.use(authenticate());     // 4. Auth
app.use('/api', routes);     // 5. Routes
app.use(errorHandler);       // 6. Error handler (LAST!)

// ❌ WRONG ORDER:
app.use(errorHandler);       // Error handler FIRST
app.use('/api', routes);     // Routes never execute!
// Errors in routes won't be caught
```

**What Error Handler Does:**

```javascript
// Without error handler:
app.get('/users/:id', async (req, res) => {
  const user = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  // If query fails:
  // ❌ Unhandled promise rejection
  // ❌ Server crashes
  // ❌ No response to client (hangs)
});

// With error handler:
app.get('/users/:id', async (req, res, next) => {
  try {
    const user = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    res.json(user);
  } catch (error) {
    next(error);  // Pass to error handler
  }
});

// Error handler catches it:
app.use((err, req, res, next) => {
  logger.error('Request failed', {
    requestId: req.id,
    error: err.message,
    stack: err.stack
  });
  
  res.status(err.statusCode || 500).json({
    success: false,
    error: {
      message: err.message,
      code: err.code || 'INTERNAL_ERROR',
      requestId: req.id
    }
  });
});
```

**Production Error Handler:**

```javascript
const errorHandler = (err, req, res, next) => {
  // Log error with full context
  logger.error('Request failed', {
    requestId: req.id,
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    userId: req.user?.userId,
    ip: req.ip
  });
  
  // Never expose stack trace in production
  const isDev = process.env.NODE_ENV === 'development';
  
  // Map error to HTTP status
  let statusCode = err.statusCode || 500;
  let errorCode = err.code || 'INTERNAL_ERROR';
  let message = err.message;
  
  // Sanitize errors for client
  if (statusCode === 500) {
    message = 'Internal server error';  // Don't leak internal details
  }
  
  res.status(statusCode).json({
    success: false,
    error: {
      message,
      code: errorCode,
      requestId: req.id,
      ...(isDev && { stack: err.stack })  // Stack only in dev
    }
  });
};
```

**Interview Question:**
> **Q:** "How do you handle errors in Express?"
>
> **A:** "I use a centralized error handler middleware placed after all routes. Route handlers pass errors to it via next(error). The handler logs the full error with request context, maps the error to an appropriate HTTP status code, and returns a consistent JSON error response. Critically, I never expose stack traces or internal details in production - these could reveal sensitive information to attackers. The error handler ensures no unhandled errors crash the server and all errors are logged for debugging."

---

## CONTINUES IN NEXT MESSAGE (Running out of space!)

This covers lines 1-138. Next section covers:
- Lines 141-160: Graceful Shutdown
- Lines 163-190: Server Startup
- Lines 193-206: Global Error Handlers
