# M09: API Gateway Deep Dive - Part 2

**Continuation of M09 Part 1**  
**Covers:** Health checks, route mounting, error handling, graceful shutdown  

---

## 🔍 SECTION 3: HEALTH CHECKS AND MONITORING

### 3.1 Health Check Endpoint (Lines 75-114)

```typescript
app.get('/health', async (_req: Request, res: Response) => {
  try {
    const redisHealthy = await redisClient.ping();

    const serviceChecks = await Promise.allSettled(
      getAllServices().map(async (service) => {
        try {
          const healthUrl = `${service.url}${service.healthCheck}`;
          const response = await axios.get(healthUrl, { timeout: 5000 });
          return { name: service.name, status: response.status === 200 ? 'healthy' : 'unhealthy', url: service.url };
        } catch (error: any) {
          return { name: service.name, status: 'unhealthy', url: service.url, error: error.message };
        }
      })
    );

    const services = serviceChecks.map((result) =>
      result.status === 'fulfilled' ? result.value : (result as PromiseRejectedResult).reason
    );

    const allServicesHealthy = services.every((s: any) => s.status === 'healthy');

    res.status(allServicesHealthy ? 200 : 503).json({
      status: allServicesHealthy ? 'healthy' : 'degraded',
      service: 'api-gateway',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      redis: { status: redisHealthy ? 'connected' : 'disconnected' },
      services
    });
  } catch (error: any) {
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

**Purpose:** Monitor health of API Gateway and all backend services.

**Why health checks?**

```typescript
// Load balancer checks health every 10 seconds:
GET https://api-gateway-1.example.com/health
GET https://api-gateway-2.example.com/health

// If 503 response (unhealthy):
// → Load balancer removes from pool
// → Traffic routed to healthy instances only ✅
```

#### Line 77: Check Redis

```typescript
const redisHealthy = await redisClient.ping();
```

**`ping()` from M04:**

```typescript
async ping(): Promise<boolean> {
  try {
    const result = await this.client?.ping();
    return result === 'PONG';
  } catch (error) {
    return false;
  }
}
```

**Redis PING command:**

```redis
> PING
PONG

# If Redis down:
> PING
Error: Connection refused
```

#### Lines 79-89: Check Backend Services

```typescript
const serviceChecks = await Promise.allSettled(
  getAllServices().map(async (service) => {
    try {
      const healthUrl = `${service.url}${service.healthCheck}`;
      const response = await axios.get(healthUrl, { timeout: 5000 });
      return { name: service.name, status: response.status === 200 ? 'healthy' : 'unhealthy', url: service.url };
    } catch (error: any) {
      return { name: service.name, status: 'unhealthy', url: service.url, error: error.message };
    }
  })
);
```

**`getAllServices()` from config/services.ts:**

```typescript
interface Service {
  name: string;
  url: string;
  healthCheck: string;
}

export const getAllServices = (): Service[] => [
  {
    name: 'user-service',
    url: 'http://localhost:3001',
    healthCheck: '/health'
  },
  {
    name: 'product-service',
    url: 'http://localhost:3003',
    healthCheck: '/health'
  },
  {
    name: 'order-service',
    url: 'http://localhost:3004',
    healthCheck: '/health'
  }
];
```

**Promise.allSettled vs Promise.all:**

```typescript
// Promise.all (fails fast)
try {
  await Promise.all([
    checkService1(),  // Success
    checkService2(),  // Fails ← Entire Promise.all rejects
    checkService3()   // Never executed
  ]);
} catch (error) {
  // Lost information about service1 and service3 ❌
}

// Promise.allSettled (continues on failure)
const results = await Promise.allSettled([
  checkService1(),  // Success → { status: 'fulfilled', value: {...} }
  checkService2(),  // Fails → { status: 'rejected', reason: Error }
  checkService3()   // Success → { status: 'fulfilled', value: {...} }
]);
// All services checked, even if some fail ✅
```

**Why allSettled?**

```typescript
// Want to know status of ALL services:
{
  services: [
    { name: 'user-service', status: 'healthy' },
    { name: 'product-service', status: 'unhealthy' },  ← Still reported
    { name: 'order-service', status: 'healthy' }
  ]
}

// Not just: "Something failed" ❌
```

**Line 82: Build Health URL**

```typescript
const healthUrl = `${service.url}${service.healthCheck}`;
```

**Example:**

```typescript
service.url = 'http://localhost:3001'
service.healthCheck = '/health'
healthUrl = 'http://localhost:3001/health'
```

**Line 83: Check Service Health**

```typescript
const response = await axios.get(healthUrl, { timeout: 5000 });
```

**`timeout: 5000`** = 5 second timeout.

**Why timeout?**

```typescript
// Without timeout:
await axios.get(healthUrl);  // Hangs forever if service down ❌

// With timeout:
await axios.get(healthUrl, { timeout: 5000 });
// After 5s: throws timeout error ✅
// Can mark service as unhealthy
```

**Response format:**

```typescript
// Service responds with 200 OK
{
  status: 'healthy',
  database: 'connected',
  uptime: 123456
}

// We only care about status code (200 = healthy)
```

#### Lines 91-93: Process Results

```typescript
const services = serviceChecks.map((result) =>
  result.status === 'fulfilled' ? result.value : (result as PromiseRejectedResult).reason
);
```

**Convert Promise results to values:**

```typescript
// Input (Promise.allSettled results):
[
  { status: 'fulfilled', value: { name: 'user-service', status: 'healthy' } },
  { status: 'rejected', reason: Error('Connection refused') },
  { status: 'fulfilled', value: { name: 'order-service', status: 'healthy' } }
]

// Output (extracted values):
[
  { name: 'user-service', status: 'healthy' },
  Error('Connection refused'),
  { name: 'order-service', status: 'healthy' }
]
```

#### Line 95: Check Overall Health

```typescript
const allServicesHealthy = services.every((s: any) => s.status === 'healthy');
```

**`Array.every()`** = Returns true if ALL items pass test.

```typescript
[
  { name: 'user-service', status: 'healthy' },
  { name: 'product-service', status: 'healthy' },
  { name: 'order-service', status: 'healthy' }
].every(s => s.status === 'healthy')  // true ✅

[
  { name: 'user-service', status: 'healthy' },
  { name: 'product-service', status: 'unhealthy' },  ← One unhealthy
  { name: 'order-service', status: 'healthy' }
].every(s => s.status === 'healthy')  // false ❌
```

#### Lines 97-104: Return Response

```typescript
res.status(allServicesHealthy ? 200 : 503).json({
  status: allServicesHealthy ? 'healthy' : 'degraded',
  service: 'api-gateway',
  timestamp: new Date().toISOString(),
  uptime: process.uptime(),
  redis: { status: redisHealthy ? 'connected' : 'disconnected' },
  services
});
```

**Status codes:**

- **200 OK** = All services healthy
- **503 Service Unavailable** = Some services unhealthy

**Why 503 not 500?**

```typescript
// 500 Internal Server Error
// Server crashed, code error
res.status(500).json({ error: 'Unhandled exception' });

// 503 Service Unavailable
// Server running, but dependencies down
res.status(503).json({ status: 'degraded', services: [...] });
```

**Load balancer behavior:**

```typescript
// 200 response:
// → Keep in pool ✅

// 503 response:
// → Remove from pool ✅
// → Retry in 10 seconds

// 500 response:
// → Might keep in pool (ambiguous) ⚠️
```

**Example response (healthy):**

```json
{
  "status": "healthy",
  "service": "api-gateway",
  "timestamp": "2023-01-15T10:30:00.000Z",
  "uptime": 123456.789,
  "redis": {
    "status": "connected"
  },
  "services": [
    {
      "name": "user-service",
      "status": "healthy",
      "url": "http://localhost:3001"
    },
    {
      "name": "product-service",
      "status": "healthy",
      "url": "http://localhost:3003"
    },
    {
      "name": "order-service",
      "status": "healthy",
      "url": "http://localhost:3004"
    }
  ]
}
```

**Example response (degraded):**

```json
{
  "status": "degraded",
  "service": "api-gateway",
  "timestamp": "2023-01-15T10:30:00.000Z",
  "uptime": 123456.789,
  "redis": {
    "status": "connected"
  },
  "services": [
    {
      "name": "user-service",
      "status": "healthy",
      "url": "http://localhost:3001"
    },
    {
      "name": "product-service",
      "status": "unhealthy",
      "url": "http://localhost:3003",
      "error": "connect ECONNREFUSED 127.0.0.1:3003"
    },
    {
      "name": "order-service",
      "status": "healthy",
      "url": "http://localhost:3004"
    }
  ]
}
```

**`process.uptime()`:**

```typescript
process.uptime()  // 123456.789 (seconds since process started)

// Convert to human-readable:
const uptimeSeconds = process.uptime();
const days = Math.floor(uptimeSeconds / 86400);
const hours = Math.floor((uptimeSeconds % 86400) / 3600);
const minutes = Math.floor((uptimeSeconds % 3600) / 60);

console.log(`${days}d ${hours}h ${minutes}m`);  // "1d 10h 17m"
```

#### Lines 105-113: Error Handling

```typescript
} catch (error: any) {
  logger.error('Health check failed:', { error: error.message });
  res.status(503).json({
    status: 'unhealthy',
    service: 'api-gateway',
    timestamp: new Date().toISOString(),
    error: error.message
  });
}
```

**When does this catch block run?**

```typescript
// Redis ping throws
await redisClient.ping();  // throws

// getAllServices() throws
const services = getAllServices();  // throws

// Unexpected error
const services = serviceChecks.map(...);  // throws
```

**Response:**

```json
{
  "status": "unhealthy",
  "service": "api-gateway",
  "timestamp": "2023-01-15T10:30:00.000Z",
  "error": "Cannot read property 'map' of undefined"
}
```

### 3.2 Health Check Best Practices

**1. Fast response time**

```typescript
// ❌ BAD: Deep health check (slow)
app.get('/health', async (req, res) => {
  await db.query('SELECT COUNT(*) FROM users');  // 1s
  await db.query('SELECT COUNT(*) FROM products');  // 1s
  await db.query('SELECT COUNT(*) FROM orders');  // 1s
  // Total: 3+ seconds ❌
});

// ✅ GOOD: Shallow health check (fast)
app.get('/health', async (req, res) => {
  await redisClient.ping();  // 1ms
  // Total: <100ms ✅
});
```

**2. Timeout on dependency checks**

```typescript
// ❌ BAD: No timeout
await axios.get(healthUrl);  // Hangs forever

// ✅ GOOD: 5 second timeout
await axios.get(healthUrl, { timeout: 5000 });
```

**3. Don't cache health status**

```typescript
// ❌ BAD: Cached status
let healthStatus = 'healthy';
setInterval(async () => {
  healthStatus = await checkHealth();
}, 60000);  // Check every minute

app.get('/health', (req, res) => {
  res.json({ status: healthStatus });  // Stale status ❌
});

// ✅ GOOD: Real-time status
app.get('/health', async (req, res) => {
  const status = await checkHealth();  // Fresh check ✅
  res.json({ status });
});
```

**4. Include details in response**

```typescript
// ❌ BAD: No details
{ "status": "unhealthy" }
// What's wrong? Can't tell ❌

// ✅ GOOD: With details
{
  "status": "degraded",
  "redis": "connected",
  "services": [
    { "name": "product-service", "status": "unhealthy", "error": "..." }
  ]
}
// Clear what's wrong ✅
```

---

## 🛣️ SECTION 4: ROUTE MOUNTING

### 4.1 Auth Routes (Line 116)

```typescript
app.use('/api/auth', authRoutes);
```

**Mounts auth routes at `/api/auth` prefix.**

**authRoutes from routes/auth.routes.ts:**

```typescript
import { Router } from 'express';
const router = Router();

router.post('/register', registerHandler);
router.post('/login', loginHandler);
router.post('/logout', authenticate(), logoutHandler);
router.post('/refresh', refreshTokenHandler);

export default router;
```

**Resulting endpoints:**

```typescript
POST /api/auth/register   → registerHandler
POST /api/auth/login      → loginHandler
POST /api/auth/logout     → logoutHandler
POST /api/auth/refresh    → refreshTokenHandler
```

**How mounting works:**

```typescript
// Without mounting:
app.post('/api/auth/register', registerHandler);
app.post('/api/auth/login', loginHandler);
app.post('/api/auth/logout', logoutHandler);
app.post('/api/auth/refresh', refreshTokenHandler);
// Repetitive ❌

// With mounting:
// In routes/auth.routes.ts:
router.post('/register', registerHandler);  // No prefix
router.post('/login', loginHandler);

// In server.ts:
app.use('/api/auth', authRoutes);  // Add prefix
// Clean separation ✅
```

### 4.2 API Routes (Line 117)

```typescript
app.use('/api', routes);
```

**Mounts main routes at `/api` prefix.**

**routes from routes/index.ts:**

```typescript
import { Router } from 'express';
import productRoutes from './products.routes';
import orderRoutes from './orders.routes';

const router = Router();

router.use('/products', productRoutes);
router.use('/orders', orderRoutes);

export default router;
```

**Nested mounting:**

```typescript
// Level 1: server.ts
app.use('/api', routes);

// Level 2: routes/index.ts
router.use('/products', productRoutes);

// Level 3: routes/products.routes.ts
router.get('/', getAllProducts);
router.get('/:id', getProductById);

// Final endpoints:
GET /api/products       → getAllProducts
GET /api/products/:id   → getProductById
```

**Full endpoint structure:**

```
/api/auth/register      (POST)
/api/auth/login         (POST)
/api/auth/logout        (POST)
/api/auth/refresh       (POST)

/api/products           (GET, POST)
/api/products/:id       (GET, PUT, DELETE)

/api/orders             (GET, POST)
/api/orders/:id         (GET, PUT, DELETE)
```

**Why this structure?**

```typescript
// Clear hierarchy:
/api              ← API namespace
  /auth           ← Authentication
  /products       ← Products resource
  /orders         ← Orders resource

// Easy to add new resources:
app.use('/api/users', userRoutes);
app.use('/api/payments', paymentRoutes);
```

### 4.3 Root Endpoint (Lines 119-131)

```typescript
app.get('/', (_req: Request, res: Response) => {
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

**Purpose:** API documentation / welcome page.

**Response:**

```json
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

**Use cases:**

```bash
# Quick check if API running
curl http://localhost:3000/
# → Shows available endpoints

# Browser navigation
# Visit http://localhost:3000
# → See API info (instead of 404)
```

---

## ⚠️ SECTION 5: ERROR HANDLING

### 5.1 Error Handler Middleware (Line 133)

```typescript
app.use(errorHandler);
```

**errorHandler from M02 (shared/errors/index.ts):**

```typescript
export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Log error
  logger.error('Request error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });

  // Send error response
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.message,
      statusCode: err.statusCode
    });
  } else {
    res.status(500).json({
      error: 'Internal server error',
      statusCode: 500
    });
  }
};
```

**Why last middleware?**

```typescript
// Middleware order:
app.use(helmet());        // 1
app.use(cors());          // 2
app.use(logging);         // 3
app.use('/api', routes);  // 4 ← Error thrown here
app.use(errorHandler);    // 5 ← Catches error

// Error handler must be LAST
// Otherwise won't catch errors from routes
```

**Error flow:**

```typescript
// Route throws error:
app.get('/api/products/:id', async (req, res) => {
  const product = await db.query('SELECT ...');
  if (!product) {
    throw new NotFoundError('Product not found');  // ← Thrown
  }
});

// Express catches error:
// 1. Skips remaining middleware
// 2. Jumps to error handler
// 3. Error handler responds

// Without error handler:
// 4. Express sends generic error ❌
// 5. No logging ❌
```

### 5.2 Express Error Handling Patterns

**Pattern 1: Synchronous route (throws)**

```typescript
app.get('/sync', (req, res) => {
  throw new Error('Sync error');  // ← Caught by Express ✅
});
```

**Pattern 2: Async route (throws)**

```typescript
app.get('/async', async (req, res) => {
  throw new Error('Async error');  // ← Caught by Express ✅
});
// Express wraps async handlers automatically (Express 5+)
```

**Pattern 3: Async route (rejected promise)**

```typescript
app.get('/promise', (req, res) => {
  Promise.reject(new Error('Promise error'));  // ❌ NOT caught!
  // Must use await or .catch()
});

// Fix 1: await
app.get('/promise', async (req, res) => {
  await Promise.reject(new Error('Promise error'));  // ✅ Caught
});

// Fix 2: .catch()
app.get('/promise', (req, res, next) => {
  someAsyncFunction()
    .catch(next);  // ✅ Pass to error handler
});
```

**Pattern 4: Callback errors**

```typescript
app.get('/callback', (req, res, next) => {
  fs.readFile('/file.txt', (err, data) => {
    if (err) {
      return next(err);  // ✅ Pass to error handler
    }
    res.send(data);
  });
});
```

---

## 🛑 SECTION 6: GRACEFUL SHUTDOWN

### 6.1 Server Variable (Line 135)

```typescript
let server: ReturnType<typeof app.listen>;
```

**Purpose:** Store server instance for shutdown.

**Why needed?**

```typescript
// Without server variable:
app.listen(3000);  // ❌ Can't close later

// With server variable:
const server = app.listen(3000);  // ✅ Can close
server.close();  // Stops accepting new connections
```

**`ReturnType<typeof app.listen>`:**

```typescript
// app.listen returns http.Server
const server = app.listen(3000);
// server type: http.Server

// Instead of:
let server: http.Server;  // ❌ Must import http

// Use:
let server: ReturnType<typeof app.listen>;  // ✅ No import needed
```

### 6.2 Graceful Shutdown Function (Lines 137-152)

```typescript
const gracefulShutdown = async (signal: string): Promise<void> => {
  logger.info(`${signal} received, shutting down gracefully...`);

  server.close(async () => {
    logger.info('HTTP server closed');
    await redisClient.disconnect();
    await db.close();
    logger.info('All connections closed');
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
};
```

**Purpose:** Safely shut down server when process receives termination signal.

**What are termination signals?**

```bash
# SIGTERM (graceful shutdown)
kill 12345
docker stop container
kubectl delete pod

# SIGINT (Ctrl+C)
# User presses Ctrl+C in terminal
```

**Why graceful shutdown?**

```typescript
// Without graceful shutdown:
process.on('SIGTERM', () => {
  process.exit(0);  // ❌ Immediate exit
});

// Problems:
// 1. In-flight requests cut off
// 2. Database connections not closed
// 3. Redis connections not closed
// 4. Response lost

// With graceful shutdown:
// 1. Stop accepting new requests ✅
// 2. Finish in-flight requests ✅
// 3. Close all connections ✅
// 4. Clean exit ✅
```

#### Line 140: Close HTTP Server

```typescript
server.close(async () => {
  // Callback runs when all connections closed
});
```

**What `server.close()` does:**

```typescript
// 1. Stop accepting new connections
//    New requests → Connection refused

// 2. Wait for existing connections to finish
//    In-flight requests complete normally

// 3. Invoke callback when done
```

**Example timeline:**

```
T+0s: SIGTERM received
      server.close() called
      → Stop accepting new requests
      
      In-flight requests:
      - Request A: Processing... (3s remaining)
      - Request B: Processing... (1s remaining)

T+1s: Request B completes
      → 1 request remaining

T+3s: Request A completes
      → 0 requests remaining
      → Callback invoked

T+3s: Close Redis
      Close Database
      Exit process
```

#### Lines 142-145: Close Dependencies

```typescript
logger.info('HTTP server closed');
await redisClient.disconnect();
await db.close();
logger.info('All connections closed');
```

**Close order matters:**

```typescript
// ✅ CORRECT: HTTP first, then dependencies
server.close(() => {
  await redisClient.disconnect();  // After HTTP
  await db.close();                // After HTTP
});

// ❌ WRONG: Dependencies first
await redisClient.disconnect();  // Before HTTP ❌
await db.close();                // Before HTTP ❌
server.close(() => {});

// Problem: In-flight requests try to use closed connections
```

**Why order matters:**

```typescript
// Request processing:
app.get('/api/products', async (req, res) => {
  const products = await db.query('SELECT ...');  // Uses database
  const cached = await redisClient.get('...');    // Uses Redis
  res.json(products);
});

// If database closed while request processing:
const products = await db.query('SELECT ...');
// → Error: Connection closed ❌
```

#### Line 146: Exit Process

```typescript
process.exit(0);
```

**Exit codes:**

```typescript
process.exit(0);  // Success (clean shutdown)
process.exit(1);  // Error (forced shutdown)
```

**Why exit codes matter:**

```bash
# Kubernetes / Docker checks exit code:

# Exit 0 (clean):
# → Don't restart pod
# → Normal termination ✅

# Exit 1 (error):
# → Restart pod
# → Investigate logs ⚠️
```

#### Lines 148-151: Forced Shutdown Timeout

```typescript
setTimeout(() => {
  logger.error('Forced shutdown after timeout');
  process.exit(1);
}, 30000);
```

**Purpose:** Don't wait forever for graceful shutdown.

**Why needed?**

```typescript
// Scenario: Long-running request
app.get('/api/export', async (req, res) => {
  // Export 1 million records (10 minutes)
  const data = await exportAllData();
  res.json(data);
});

// SIGTERM received at 5 minutes:
// server.close() called
// Waiting for request to finish... (5 min remaining)
// ← Server stuck for 5 more minutes ❌

// With timeout:
// Wait 30 seconds max
// If not done → force exit ✅
```

**30 second timeout:**

```typescript
// Reasonable values:
// - 10s: Short, but might cut off legitimate requests
// - 30s: Good balance ✅
// - 60s: Too long for production deploys
```

**Flow with timeout:**

```
T+0s:  SIGTERM received
       Start graceful shutdown
       Start 30s timeout timer

T+0s-30s: Wait for requests to finish

T+30s: Timeout expires
       Force shutdown
       process.exit(1)
```

### 6.3 Start Server Function (Lines 154-176)

```typescript
const startServer = async (): Promise<void> => {
  try {
    await initDatabase();
    logger.info('Database initialized');

    await redisClient.connect();
    logger.info('Redis connected');

    server = app.listen(PORT, () => {
      logger.info(`API Gateway running on port ${PORT}`, {
        environment: process.env.NODE_ENV,
        nodeVersion: process.version,
        services: getAllServices().map((s) => s.name)
      });
    });

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (error: any) {
    logger.error('Failed to start API Gateway:', { error: error.message, stack: error.stack });
    process.exit(1);
  }
};
```

**Purpose:** Initialize dependencies and start server.

#### Lines 156-160: Initialize Dependencies

```typescript
await initDatabase();
logger.info('Database initialized');

await redisClient.connect();
logger.info('Redis connected');
```

**Initialization order:**

```typescript
// 1. Database first
await initDatabase();
// Why? Routes need database

// 2. Redis second
await redisClient.connect();
// Why? Rate limiting needs Redis

// 3. Server last
server = app.listen(PORT);
// Why? Don't accept requests until dependencies ready
```

**What if dependency fails?**

```typescript
// Throws error → Caught by catch block → Exit process
try {
  await initDatabase();  // ← Fails
} catch (error) {
  logger.error('Failed to start API Gateway');
  process.exit(1);  // ← Exit immediately ✅
}

// Don't start server with broken dependencies ❌
```

#### Lines 162-168: Start HTTP Server

```typescript
server = app.listen(PORT, () => {
  logger.info(`API Gateway running on port ${PORT}`, {
    environment: process.env.NODE_ENV,
    nodeVersion: process.version,
    services: getAllServices().map((s) => s.name)
  });
});
```

**Callback executes when server starts listening.**

**Log output:**

```json
{
  "level": "info",
  "message": "API Gateway running on port 3000",
  "environment": "production",
  "nodeVersion": "v20.10.0",
  "services": ["user-service", "product-service", "order-service"],
  "timestamp": "2023-01-15T10:30:00.000Z"
}
```

**Why log environment and node version?**

```typescript
// Debugging:
// "Is this dev or prod server?"
"environment": "production"  // ← Prod server

// "What Node version running?"
"nodeVersion": "v20.10.0"  // ← Node 20

// "Which services available?"
"services": ["user-service", "product-service"]  // ← 2 services
```

#### Lines 170-171: Register Signal Handlers

```typescript
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
```

**Listen for termination signals:**

```typescript
// SIGTERM (graceful termination)
kill 12345
docker stop container
→ gracefulShutdown('SIGTERM')

// SIGINT (interrupt, Ctrl+C)
# User presses Ctrl+C
→ gracefulShutdown('SIGINT')
```

**Why both signals?**

```typescript
// SIGTERM: Production (Docker, K8s)
process.on('SIGTERM', ...)

// SIGINT: Development (Ctrl+C)
process.on('SIGINT', ...)

// Both trigger same graceful shutdown
```

#### Lines 172-175: Error Handling

```typescript
} catch (error: any) {
  logger.error('Failed to start API Gateway:', { error: error.message, stack: error.stack });
  process.exit(1);
}
```

**When does this catch errors?**

```typescript
// Database connection fails
await initDatabase();  // throws

// Redis connection fails
await redisClient.connect();  // throws

// Port already in use
app.listen(3000);  // throws
```

**Exit with code 1:**

```typescript
process.exit(1);  // Error exit

// Tells orchestrator:
// - Don't retry immediately
// - Log failure
// - Alert on-call engineer
```

### 6.4 Global Error Handlers (Lines 178-186)

```typescript
process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught Exception:', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason: any) => {
  logger.error('Unhandled Rejection:', { reason });
  process.exit(1);
});
```

**Purpose:** Catch unexpected errors.

#### Uncaught Exception

```typescript
process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught Exception:', { error: error.message, stack: error.stack });
  process.exit(1);
});
```

**When triggered?**

```typescript
// Synchronous code throws
throw new Error('Unexpected error');  // ← Not caught by try/catch

// Example:
setTimeout(() => {
  throw new Error('Timer error');  // ← Uncaught
}, 1000);

// Without handler:
// Server crashes with no log ❌

// With handler:
// Logs error, then exits ✅
```

**Why exit(1)?**

```typescript
// Uncaught exception = broken state
// Can't trust anything anymore
// Best to restart process ✅
```

#### Unhandled Rejection

```typescript
process.on('unhandledRejection', (reason: any) => {
  logger.error('Unhandled Rejection:', { reason });
  process.exit(1);
});
```

**When triggered?**

```typescript
// Promise rejected, no .catch()
Promise.reject(new Error('Promise error'));  // ← Unhandled

// Example:
async function badFunction() {
  throw new Error('Async error');
}

badFunction();  // ← Called without await or .catch()

// Without handler:
// Silent failure (Node.js warning only) ⚠️

// With handler:
// Logs error, then exits ✅
```

**Common mistake:**

```typescript
// ❌ BAD: Forget await
app.get('/api/products', (req, res) => {
  getProducts();  // ← No await!
  res.json({ message: 'Products fetched' });
});

async function getProducts() {
  throw new Error('Database error');  // ← Unhandled rejection
}

// ✅ GOOD: Use await
app.get('/api/products', async (req, res) => {
  await getProducts();  // ← Caught by Express
  res.json({ message: 'Products fetched' });
});
```

### 6.5 Start Application (Line 188)

```typescript
startServer();
```

**Calls async function without await.**

**Why no await?**

```typescript
// Top-level code (not in async function)
// Can't use await here:
await startServer();  // ❌ SyntaxError

// Options:

// 1. Call without await (our approach)
startServer();  // ✅ Errors caught by process.on()

// 2. IIFE (Immediately Invoked Function Expression)
(async () => {
  await startServer();
})();

// 3. Top-level await (Node 14.8+, with ES modules)
await startServer();  // Only with "type": "module" in package.json
```

### 6.6 Export App (Line 190)

```typescript
export default app;
```

**Purpose:** Export for testing.

**Use case:**

```typescript
// In test file:
import app from './server';
import request from 'supertest';

describe('API Gateway', () => {
  it('should return health status', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('healthy');
  });
});
```

---

## 🎯 SECTION 7: COMPLETE REQUEST FLOW

### 7.1 Successful Request

```
1. Client sends request
   GET /api/products/123
   Authorization: Bearer eyJhbGc...

2. Helmet middleware
   → Adds security headers

3. CORS middleware
   → Adds CORS headers
   → Checks origin

4. Body parser
   → Parses JSON body (if present)

5. Request ID middleware
   → Generates UUID: a3f8b9c2...
   → Adds to request
   → Adds to response header

6. Logging middleware (start)
   → Records start time
   → Registers 'finish' listener

7. Rate limiter
   → Checks Redis: 45/100 requests
   → Allows request ✅

8. Route matching
   → Matches: /api/products/:id
   → Extracts params: { id: '123' }

9. Route handler
   → Validates auth token
   → Queries database
   → Returns product data

10. Response sent
    HTTP/1.1 200 OK
    X-Request-ID: a3f8b9c2...
    Content-Type: application/json
    
    { "id": 123, "name": "Laptop", ... }

11. Logging middleware (finish)
    → Calculates duration: 45ms
    → Logs request details
```

### 7.2 Failed Request (Rate Limit)

```
1. Client sends request
   GET /api/products

2. Helmet, CORS, Body parser
   → Pass through

3. Request ID
   → Add ID: b4g9c0d3...

4. Logging (start)
   → Record start time

5. Rate limiter
   → Checks Redis: 101/100 requests
   → Limit exceeded! ❌
   → Throws error

6. Error handler
   → Catches rate limit error
   → Returns 429 response

7. Response sent
   HTTP/1.1 429 Too Many Requests
   X-RateLimit-Limit: 100
   X-RateLimit-Remaining: 0
   
   { "error": "Too many requests" }

8. Logging (finish)
   → Logs: statusCode: 429, duration: 2ms
```

### 7.3 Failed Request (500 Error)

```
1. Client sends request
   GET /api/products/123

2-7. All middleware passes

8. Route handler
   → Queries database
   → Database connection lost! ❌
   → Throws error

9. Error handler
   → Catches error
   → Logs error + stack trace
   → Returns 500 response

10. Response sent
    HTTP/1.1 500 Internal Server Error
    X-Request-ID: c5h0d4e3...
    
    { "error": "Internal server error" }

11. Logging (finish)
    → Logs: statusCode: 500, duration: 120ms
```

---

## 🎓 SECTION 8: MAANG INTERVIEW QUESTIONS

### Q1: How would you implement API versioning in the gateway?

**Answer:**

**Approach 1: URL Path Versioning**

```typescript
// Version in path
app.use('/api/v1', routesV1);
app.use('/api/v2', routesV2);

// Endpoints:
// GET /api/v1/products
// GET /api/v2/products

// Pros: Clear, cacheable
// Cons: Clutters URLs
```

**Approach 2: Header Versioning**

```typescript
app.use('/api', (req, res, next) => {
  const version = req.headers['api-version'] || 'v1';
  
  if (version === 'v2') {
    return routesV2(req, res, next);
  }
  return routesV1(req, res, next);
});

// Request:
// GET /api/products
// API-Version: v2

// Pros: Clean URLs
// Cons: Not cacheable, harder to test
```

**Approach 3: Query Parameter**

```typescript
app.use('/api', (req, res, next) => {
  const version = req.query.version || 'v1';
  
  if (version === 'v2') {
    return routesV2(req, res, next);
  }
  return routesV1(req, res, next);
});

// Request:
// GET /api/products?version=v2

// Pros: Easy to test
// Cons: Query pollution
```

**Recommendation: URL path versioning** for clarity and cacheability.

### Q2: How would you implement request retries with exponential backoff?

**Answer:**

```typescript
async function proxyWithRetry(serviceUrl: string, retries = 3) {
  let lastError: Error;
  
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.get(serviceUrl, {
        timeout: 5000
      });
      return response.data;  // Success ✅
      
    } catch (error: any) {
      lastError = error;
      
      // Don't retry 4xx errors (client errors)
      if (error.response?.status >= 400 && error.response?.status < 500) {
        throw error;
      }
      
      // Last attempt? Don't wait
      if (i === retries - 1) {
        break;
      }
      
      // Exponential backoff: 100ms, 200ms, 400ms
      const delayMs = 100 * Math.pow(2, i);
      
      logger.warn('Retry attempt', {
        attempt: i + 1,
        maxRetries: retries,
        delayMs,
        error: error.message
      });
      
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  throw lastError;  // All retries failed
}

// Usage:
app.get('/api/products', async (req, res) => {
  try {
    const products = await proxyWithRetry('http://product-service/products');
    res.json(products);
  } catch (error) {
    res.status(503).json({ error: 'Service unavailable' });
  }
});
```

### Q3: How would you implement circuit breaker pattern?

**Answer:**

```typescript
class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  
  constructor(
    private threshold = 5,        // Open after 5 failures
    private timeout = 60000,      // Try again after 60s
    private successThreshold = 2  // Close after 2 successes
  ) {}
  
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Circuit open? Reject immediately
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime >= this.timeout) {
        this.state = 'HALF_OPEN';
        logger.info('Circuit breaker: HALF_OPEN');
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }
    
    try {
      const result = await fn();
      this.onSuccess();
      return result;
      
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  private onSuccess() {
    this.failures = 0;
    
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      logger.info('Circuit breaker: CLOSED');
    }
  }
  
  private onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.failures >= this.threshold) {
      this.state = 'OPEN';
      logger.error('Circuit breaker: OPEN');
    }
  }
}

// Usage:
const productServiceBreaker = new CircuitBreaker();

app.get('/api/products', async (req, res) => {
  try {
    const products = await productServiceBreaker.execute(() =>
      axios.get('http://product-service/products')
    );
    res.json(products);
  } catch (error: any) {
    if (error.message === 'Circuit breaker is OPEN') {
      return res.status(503).json({ 
        error: 'Product service temporarily unavailable' 
      });
    }
    throw error;
  }
});
```

### Q4: How would you implement request deduplication?

**Answer:**

```typescript
// Prevent duplicate requests with same idempotency key
const pendingRequests = new Map<string, Promise<any>>();

async function deduplicateRequest<T>(
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  // Request already in progress?
  if (pendingRequests.has(key)) {
    logger.info('Duplicate request detected, waiting for original', { key });
    return pendingRequests.get(key)!;
  }
  
  // Execute new request
  const promise = fn();
  pendingRequests.set(key, promise);
  
  try {
    const result = await promise;
    return result;
  } finally {
    // Clean up after completion
    pendingRequests.delete(key);
  }
}

// Middleware
app.use(async (req: Request, res: Response, next: NextFunction) => {
  const idempotencyKey = req.headers['idempotency-key'] as string;
  
  if (!idempotencyKey || req.method === 'GET') {
    return next();
  }
  
  try {
    const result = await deduplicateRequest(idempotencyKey, async () => {
      // Capture response in promise
      return new Promise((resolve, reject) => {
        const originalJson = res.json.bind(res);
        res.json = (data: any) => {
          resolve(data);
          return originalJson(data);
        };
        next();
      });
    });
    
    // Return cached result
    if (result) {
      res.json(result);
    }
  } catch (error) {
    next(error);
  }
});

// Client usage:
// POST /api/orders
// Idempotency-Key: abc123
// (Duplicate requests with same key wait for original)
```

---

## 🎉 M09: API GATEWAY DEEP DIVE COMPLETE!

You've mastered:
- ✅ API Gateway architecture and responsibilities
- ✅ Express middleware chain and execution flow
- ✅ Security headers with Helmet
- ✅ CORS configuration and preflight requests
- ✅ Request ID generation and distributed tracing
- ✅ Request/response logging with timing
- ✅ Health checks for gateway and backend services
- ✅ Route mounting and organization
- ✅ Error handling and propagation
- ✅ Graceful shutdown with connection draining
- ✅ Signal handling (SIGTERM, SIGINT)
- ✅ Global error handlers (uncaught exceptions, unhandled rejections)
- ✅ Advanced patterns (circuit breaker, retries, deduplication)

**Next module:** M10-CIRCUIT-BREAKER-DEEP-DIVE (resiliency patterns, failure detection, state management)

**Progress: 9 out of 27 modules completed! (33% done)**
