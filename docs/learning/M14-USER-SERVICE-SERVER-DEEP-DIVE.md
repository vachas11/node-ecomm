# M14: User Service Server Deep Dive

**File:** `services/user-service/src/server.ts` (159 lines)  
**Level:** Microservice Architecture  
**Prerequisites:** M01 (Logger), M02 (Errors), M04 (Redis), M09 (API Gateway)  
**Time to Master:** 2-3 hours

---

## 📖 SECTION 1: THEORY - Microservice Architecture

### 1.1 What is a Microservice?

**Microservice** = Small, independent service that does one thing well.

**Real-World Analogy:**

Think of a **restaurant**:

**Monolith (Traditional Restaurant):**
```
┌────────────────────────────────────────┐
│        One Big Kitchen                 │
│                                        │
│  • Take orders                         │
│  • Cook food                           │
│  • Wash dishes                         │
│  • Manage inventory                    │
│  • Handle payments                     │
│                                        │
│  All chefs do everything               │
└────────────────────────────────────────┘

Problem:
- One slow chef slows everyone ❌
- Hard to scale (hire more generalists)
- Can't specialize
```

**Microservices (Modern Restaurant):**
```
┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐
│  Order    │  │  Kitchen  │  │  Dishes   │  │  Payment  │
│  Service  │  │  Service  │  │  Service  │  │  Service  │
│           │  │           │  │           │  │           │
│  Take     │  │  Cook     │  │  Wash     │  │  Process  │
│  orders   │  │  food     │  │  dishes   │  │  payments │
└───────────┘  └───────────┘  └───────────┘  └───────────┘

Benefits:
- Independent scaling ✅
- Specialized teams ✅
- Isolated failures ✅
- Deploy independently ✅
```

### 1.2 User Service Responsibilities

**User Service** = Manages user accounts, authentication, and profiles.

**Responsibilities:**

**1. User Registration**
```typescript
POST /api/auth/register
{
  "email": "user@example.com",
  "password": "secret123",
  "name": "John Doe"
}

// User Service:
// - Validates input
// - Hashes password
// - Creates user in database
// - Returns success
```

**2. User Login**
```typescript
POST /api/auth/login
{
  "email": "user@example.com",
  "password": "secret123"
}

// User Service:
// - Verifies credentials
// - Generates JWT tokens
// - Returns access + refresh tokens
```

**3. Token Refresh**
```typescript
POST /api/auth/refresh
{
  "refreshToken": "eyJhbGc..."
}

// User Service:
// - Validates refresh token
// - Generates new access token
// - Returns new token
```

**4. User Profile**
```typescript
GET /api/internal/users/:id

// User Service:
// - Fetches user by ID
// - Returns user data
// - Used by other services
```

**NOT Responsible For:**

```typescript
// ❌ Order management → Order Service
// ❌ Product catalog → Product Service
// ❌ Payment processing → Payment Service
// ❌ Shipping → Shipping Service

// ✅ Only user-related operations
```

### 1.3 Microservice Communication Patterns

**1. Synchronous (HTTP/REST)**

```
API Gateway ──HTTP──> User Service
                      (waits for response)
             <──JSON──
```

**Use for:**
- Real-time data (user profile)
- Quick operations (authentication)
- Request-response pattern

**2. Asynchronous (Message Queue)**

```
Order Service ──publish──> RabbitMQ ──consume──> User Service
                          (doesn't wait)
```

**Use for:**
- Background tasks (send email)
- Event notifications (user registered)
- Non-blocking operations

**3. Internal API (Service-to-Service)**

```
Order Service ──HTTP──> User Service (internal)
                       GET /api/internal/users/:id
```

**Use for:**
- Service-to-service communication
- Not exposed to public internet
- Trusted internal network

### 1.4 User Service Architecture

**Our system:**

```
┌─────────────────────────────────────────────────┐
│                  API Gateway                     │
│                   (Port 3000)                    │
└────────────────┬────────────────────────────────┘
                 │
                 │ HTTP
                 ↓
┌─────────────────────────────────────────────────┐
│               User Service                       │
│                (Port 3001)                       │
│                                                  │
│  ┌──────────────────────────────────────────┐  │
│  │           Routes                          │  │
│  │  /api/auth/*      (public)               │  │
│  │  /api/internal/*  (internal)             │  │
│  └──────────────────────────────────────────┘  │
│                                                  │
│  ┌──────────────────────────────────────────┐  │
│  │         Controllers                       │  │
│  │  authController                           │  │
│  │  internalController                       │  │
│  └──────────────────────────────────────────┘  │
│                                                  │
│  ┌──────────────────────────────────────────┐  │
│  │          Services                         │  │
│  │  userService                              │  │
│  └──────────────────────────────────────────┘  │
│                                                  │
│  ┌──────────────────────────────────────────┐  │
│  │        Repositories                       │  │
│  │  userRepository                           │  │
│  └──────────────────────────────────────────┘  │
└────────────┬─────────────────┬──────────────────┘
             │                 │
             ↓                 ↓
      ┌─────────────┐   ┌────────────┐
      │  PostgreSQL │   │   Redis    │
      │  Database   │   │   Cache    │
      └─────────────┘   └────────────┘
```

### 1.5 Service Isolation Benefits

**1. Independent Deployment**

```typescript
// Deploy User Service v2.0
// Without affecting:
// - Order Service (still running v1.5)
// - Product Service (still running v1.3)
// - API Gateway (still running v1.0)

// Monolith:
// Deploy entire application ❌
// Everything must be compatible
```

**2. Independent Scaling**

```typescript
// User Service: 1000 req/s → Scale to 5 instances
// Order Service: 100 req/s → Keep 1 instance
// Product Service: 500 req/s → Scale to 2 instances

// Monolith:
// Scale entire application ❌
// Wastes resources on underutilized parts
```

**3. Fault Isolation**

```typescript
// User Service crashes
// ✅ Order Service still works
// ✅ Product Service still works
// ❌ Only authentication affected

// Monolith:
// One crash → Everything down ❌
```

**4. Technology Freedom**

```typescript
// User Service: Node.js + PostgreSQL
// Order Service: Go + MongoDB
// Product Service: Python + Elasticsearch

// Monolith:
// Must use same tech stack ❌
```

---

## 🔍 SECTION 2: LINE-BY-LINE CODE ANALYSIS

### 2.1 Imports (Lines 1-11)

```typescript
import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import logger from '../../../shared/logger';
import { errorHandler } from '../../../shared/errors';
import { db, initDatabase } from './config/database';
import redisClient from '../../../shared/redis';
import authRoutes from './routes/auth.routes';
import internalRoutes from './routes/internal.routes';
import * as metrics from './lib/metrics';
```

**Similar to API Gateway** (M09), but different routes:

```typescript
// API Gateway routes:
import routes from './routes';           // General proxy routes
import authRoutes from './routes/auth.routes';  // Auth proxy

// User Service routes:
import authRoutes from './routes/auth.routes';       // Actual auth logic
import internalRoutes from './routes/internal.routes'; // Internal API
```

**Key difference:**

```typescript
// API Gateway: Routes requests to services
// User Service: Handles actual business logic
```

### 2.2 App Initialization (Lines 13-14)

```typescript
const app = express();
const PORT = process.env.PORT || 3001;
```

**Port 3001** (different from API Gateway port 3000):

```
API Gateway:   localhost:3000  (public, external clients)
User Service:  localhost:3001  (internal, behind gateway)
Product Svc:   localhost:3003  (internal)
Order Svc:     localhost:3004  (internal)
```

### 2.3 Metrics Endpoint (Lines 16-25)

**Same as API Gateway** - exposes Prometheus metrics.

```typescript
app.get('/metrics', async (req: Request, res: Response) => {
  try {
    res.set('Content-Type', metrics.register.contentType);
    const metricsOutput = await metrics.register.metrics();
    res.end(metricsOutput);
  } catch (err: any) {
    logger.error('Failed to generate metrics', { error: err.message });
    res.status(500).end(err.toString());
  }
});
```

**Metrics tracked:**

```typescript
// From metrics.ts:
// - HTTP request duration
// - HTTP request count
// - HTTP request size
// - HTTP response size
// - Database pool metrics
// - Active connections
// - Idle connections
// - Waiting connections
```

### 2.4 Middleware Setup (Lines 27-30)

```typescript
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
```

**Same as API Gateway:**
- Security headers (helmet)
- CORS
- Body parsing

**Why CORS in User Service?**

```typescript
// Scenario: Direct access to User Service
// (bypassing API Gateway in development)

// Frontend dev server: http://localhost:8080
// User Service: http://localhost:3001

// Without CORS:
fetch('http://localhost:3001/api/auth/login', ...)
// ❌ CORS error

// With CORS:
fetch('http://localhost:3001/api/auth/login', ...)
// ✅ Works in development
```

### 2.5 Logging Middleware (Lines 32-58)

```typescript
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const requestSize = req.get('content-length') || '0';

  res.on('finish', () => {
    const duration = Date.now() - start;
    const responseSize = res.get('content-length') || '0';

    logger.info(`${req.method} ${req.path}`, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      statusCode: res.statusCode,
      duration: `${duration}ms`
    });

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

**Purpose:** Log all requests and record metrics.

**Compared to API Gateway:**

```typescript
// API Gateway: Includes requestId
logger.info(`${req.method} ${req.path}`, {
  requestId,        // ← Added by gateway
  method: req.method,
  path: req.path,
  // ...
});

// User Service: No requestId
logger.info(`${req.method} ${req.path}`, {
  ip: req.ip,
  userAgent: req.get('user-agent'),
  // ...
});

// Why?
// - Gateway generates requestId
// - Services receive it in X-Request-ID header
// - Services could extract and log it
```

**Metrics recording:**

```typescript
metrics.recordHttpRequest(
  req.method,       // 'POST'
  req.path,         // '/api/auth/login'
  res.statusCode,   // 200
  duration,         // 45 (ms)
  requestSize,      // 156 (bytes)
  responseSize      // 842 (bytes)
);
```

**Prometheus metrics:**

```
http_request_duration_seconds{method="POST",path="/api/auth/login",status="200"} 0.045
http_requests_total{method="POST",path="/api/auth/login",status="200"} 1523
http_request_size_bytes{method="POST",path="/api/auth/login"} 156
http_response_size_bytes{method="POST",path="/api/auth/login"} 842
```

### 2.6 Health Check (Lines 60-90)

```typescript
app.get('/health', async (req: Request, res: Response) => {
  try {
    await db.query('SELECT 1');
    const dbStats = db.getStats();

    metrics.recordDbPoolMetrics(
      dbStats.totalConnections - dbStats.idleConnections,
      dbStats.idleConnections,
      dbStats.waitingConnections
    );

    const redisHealthy = await redisClient.ping();

    res.json({
      status: 'healthy',
      service: 'user-service',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: { status: 'connected', pool: dbStats },
      redis: { status: redisHealthy ? 'connected' : 'disconnected' }
    });
  } catch (error: any) {
    logger.error('Health check failed:', { error: error.message });
    res.status(503).json({
      status: 'unhealthy',
      service: 'user-service',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});
```

**Purpose:** Health check for User Service dependencies.

**Compared to API Gateway:**

```typescript
// API Gateway:
// - Checks Redis
// - Checks backend services (product, order, user)

// User Service:
// - Checks database (PostgreSQL)
// - Checks Redis
// - Does NOT check other services
```

#### Line 62: Database Health Check

```typescript
await db.query('SELECT 1');
```

**Simple query:**

```sql
SELECT 1
```

**Why this query?**

```typescript
// Checks:
// ✅ Database connection alive
// ✅ Can execute queries
// ✅ Fast (~1ms)

// vs
SELECT COUNT(*) FROM users
// ❌ Slow on large tables
// ❌ Depends on data
```

#### Lines 63-69: Database Pool Metrics

```typescript
const dbStats = db.getStats();

metrics.recordDbPoolMetrics(
  dbStats.totalConnections - dbStats.idleConnections,  // Active
  dbStats.idleConnections,                             // Idle
  dbStats.waitingConnections                           // Waiting
);
```

**Database pool stats:**

```typescript
// Example:
dbStats = {
  totalConnections: 20,    // Total pool size
  idleConnections: 15,     // Available connections
  waitingConnections: 0    // Queued requests
}

// Active connections:
active = 20 - 15 = 5

// Recorded to Prometheus:
db_pool_active_connections 5
db_pool_idle_connections 15
db_pool_waiting_connections 0
```

**Health interpretation:**

```typescript
// Healthy:
active: 5, idle: 15, waiting: 0
// → Good capacity available ✅

// Saturated:
active: 20, idle: 0, waiting: 10
// → All connections in use ⚠️
// → Requests queuing
// → Need to scale pool or service

// Underutilized:
active: 2, idle: 18, waiting: 0
// → Over-provisioned pool
// → Can reduce pool size
```

#### Line 71: Redis Health Check

```typescript
const redisHealthy = await redisClient.ping();
```

**Same as API Gateway** - PING command.

#### Lines 73-80: Healthy Response

```typescript
res.json({
  status: 'healthy',
  service: 'user-service',
  timestamp: new Date().toISOString(),
  uptime: process.uptime(),
  database: { status: 'connected', pool: dbStats },
  redis: { status: redisHealthy ? 'connected' : 'disconnected' }
});
```

**Example response:**

```json
{
  "status": "healthy",
  "service": "user-service",
  "timestamp": "2024-01-05T10:30:00.000Z",
  "uptime": 123456.789,
  "database": {
    "status": "connected",
    "pool": {
      "totalConnections": 20,
      "idleConnections": 15,
      "waitingConnections": 0
    }
  },
  "redis": {
    "status": "connected"
  }
}
```

**Load balancer usage:**

```typescript
// Load balancer checks health every 10s:
GET http://user-service-1:3001/health
GET http://user-service-2:3001/health
GET http://user-service-3:3001/health

// If 503 response:
// → Remove instance from pool
// → Route traffic to healthy instances

// If 200 response:
// → Keep in pool
```

### 2.7 Route Mounting (Lines 92-93)

```typescript
app.use('/api/auth', authRoutes);
app.use('/api/internal', internalRoutes);
```

**Two route groups:**

**1. Public auth routes (`/api/auth/*`):**

```typescript
POST /api/auth/register      // User registration
POST /api/auth/login         // User login
POST /api/auth/logout        // User logout
POST /api/auth/refresh       // Refresh access token
POST /api/auth/change-password  // Change password
```

**Accessed via API Gateway:**

```
Client → API Gateway → User Service /api/auth/login
```

**2. Internal routes (`/api/internal/*`):**

```typescript
GET /api/internal/users/:id           // Get user by ID
GET /api/internal/users/email/:email  // Get user by email
```

**Accessed by other services:**

```
Order Service → User Service /api/internal/users/:id
(Direct, no gateway)
```

**Why separate?**

```typescript
// Public routes:
// - Exposed to internet
// - Rate limited
// - Authentication optional

// Internal routes:
// - Not exposed to internet
// - Trusted service-to-service
// - No rate limiting
// - May have different authentication
```

### 2.8 404 Handler (Lines 95-100)

```typescript
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: { message: 'Route not found', path: req.path }
  });
});
```

**Purpose:** Handle unknown routes.

**Example:**

```typescript
GET /api/unknown

// Response:
{
  "success": false,
  "error": {
    "message": "Route not found",
    "path": "/api/unknown"
  }
}
```

**Why before errorHandler?**

```typescript
// Middleware order:
app.use('/api/auth', authRoutes);
app.use('/api/internal', internalRoutes);
app.use((req, res) => { /* 404 */ });   // ← Must be after routes
app.use(errorHandler);                   // ← Must be last
```

### 2.9 Error Handler (Line 102)

```typescript
app.use(errorHandler);
```

**From M02** - centralized error handling.

**Catches:**

```typescript
// Route throws error:
app.post('/api/auth/register', async (req, res) => {
  if (!req.body.email) {
    throw new BadRequestError('Email required');  // ← Caught
  }
});

// errorHandler formats response:
{
  "error": "Email required",
  "statusCode": 400
}
```

### 2.10 Graceful Shutdown (Lines 104-121)

**Same as API Gateway** - clean shutdown on SIGTERM/SIGINT.

```typescript
const gracefulShutdown = async (signal: string): Promise<void> => {
  logger.info(`${signal} received, shutting down gracefully...`);

  server.close(async () => {
    logger.info('HTTP server closed');
    await db.close();
    await redisClient.disconnect();
    logger.info('All connections closed');
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
};
```

**Shutdown order:**

```
1. Receive SIGTERM
2. Stop accepting new requests (server.close)
3. Wait for in-flight requests (up to 30s)
4. Close database connections
5. Close Redis connections
6. Exit process
```

**Why this order?**

```typescript
// 1. Stop new requests first
server.close()
// New requests: Connection refused
// In-flight requests: Complete normally

// 2. Close database after requests finish
await db.close()
// Ensures no requests lose database mid-execution

// 3. Close Redis after database
await redisClient.disconnect()
// Ensures cache invalidation completes
```

### 2.11 Start Server (Lines 123-144)

```typescript
const startServer = async (): Promise<void> => {
  try {
    await initDatabase();
    logger.info('Database initialized');

    await redisClient.connect();
    logger.info('Redis connected');

    server = app.listen(PORT, () => {
      logger.info(`User Service running on port ${PORT}`, {
        environment: process.env.NODE_ENV,
        nodeVersion: process.version
      });
    });

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (error: any) {
    logger.error('Failed to start server:', { error: error.message, stack: error.stack });
    process.exit(1);
  }
};
```

**Initialization sequence:**

```
1. Initialize database pool
2. Connect to Redis
3. Start HTTP server
4. Register signal handlers
```

**Why this order?**

```typescript
// Database first:
await initDatabase()
// Routes need database for queries

// Redis second:
await redisClient.connect()
// Routes need Redis for caching/rate limiting

// HTTP server last:
server = app.listen(PORT)
// Only accept requests when dependencies ready ✅
```

**Failure handling:**

```typescript
try {
  await initDatabase();
} catch (error) {
  // Database connection failed
  logger.error('Failed to start server');
  process.exit(1);  // ← Exit immediately
}

// Don't start server with broken dependencies ✅
```

### 2.12 Global Error Handlers (Lines 146-154)

**Same as API Gateway** - catch uncaught exceptions and unhandled rejections.

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

---

## 🎯 SECTION 3: USER SERVICE VS API GATEWAY

### 3.1 Key Differences

| Aspect | API Gateway | User Service |
|--------|-------------|--------------|
| **Port** | 3000 | 3001 |
| **Purpose** | Route requests | Handle business logic |
| **Routes** | Proxy to services | Actual endpoints |
| **Database** | None | PostgreSQL |
| **Auth** | Verify tokens | Generate tokens |
| **Health Check** | Check services | Check database |
| **Request ID** | Generate | Receive |

### 3.2 Request Flow

**Full flow:**

```
1. Client → API Gateway (port 3000)
   POST /api/auth/login

2. API Gateway → User Service (port 3001)
   POST /api/auth/login
   X-Request-ID: abc123

3. User Service:
   → Verify credentials (database)
   → Generate JWT tokens
   → Return tokens

4. User Service → API Gateway
   { accessToken: '...', refreshToken: '...' }

5. API Gateway → Client
   { accessToken: '...', refreshToken: '...' }
```

**Why two services?**

```typescript
// API Gateway benefits:
// - Single entry point
// - Centralized auth verification
// - Rate limiting
// - Request routing

// User Service benefits:
// - Focused on user domain
// - Independent deployment
// - Independent scaling
// - Database isolation
```

### 3.3 Internal Service Communication

**Scenario: Order Service needs user info**

```typescript
// Order Service (port 3004):
async function createOrder(userId: number) {
  // Direct call to User Service (bypasses gateway)
  const user = await axios.get(
    `http://user-service:3001/api/internal/users/${userId}`
  );
  
  // Create order with user info
  const order = await db.query(
    'INSERT INTO orders (user_id, email) VALUES ($1, $2)',
    [userId, user.email]
  );
  
  return order;
}
```

**Why bypass gateway?**

```typescript
// Option 1: Through gateway
Order Service → API Gateway → User Service
// ❌ Extra hop (latency)
// ❌ Gateway overhead

// Option 2: Direct (our choice)
Order Service → User Service
// ✅ Faster
// ✅ Less overhead
// ✅ Trusted internal network
```

---

## 🎓 SECTION 4: PRODUCTION CONSIDERATIONS

### 4.1 Service Discovery

**Problem: Hard-coded URLs**

```typescript
// Current:
const userServiceUrl = 'http://localhost:3001';

// Production problem:
// - Multiple User Service instances
// - Dynamic IPs (Kubernetes pods)
// - Instances come and go
```

**Solution: Service Discovery**

```typescript
// Kubernetes DNS:
const userServiceUrl = 'http://user-service:3001';
// Resolves to healthy instances automatically

// Consul:
const services = await consul.health.service('user-service');
const url = services[0].Service.Address;

// Load balancer:
const userServiceUrl = 'http://user-service-lb:3001';
// Load balancer routes to healthy instances
```

### 4.2 Health Check Best Practices

**Current implementation:**

```typescript
await db.query('SELECT 1');  // ✅ Good
const redisHealthy = await redisClient.ping();  // ✅ Good
```

**Enhanced:**

```typescript
app.get('/health', async (req, res) => {
  // Check database with timeout
  const dbHealthy = await Promise.race([
    db.query('SELECT 1'),
    timeout(2000)
  ]);
  
  // Check Redis with timeout
  const redisHealthy = await Promise.race([
    redisClient.ping(),
    timeout(2000)
  ]);
  
  // Check critical table exists
  const schemaHealthy = await db.query(
    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users')"
  );
  
  // All checks passed?
  const healthy = dbHealthy && redisHealthy && schemaHealthy;
  
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'degraded',
    checks: {
      database: dbHealthy ? 'up' : 'down',
      redis: redisHealthy ? 'up' : 'down',
      schema: schemaHealthy ? 'up' : 'down'
    }
  });
});
```

### 4.3 Metrics and Monitoring

**Key metrics to track:**

```typescript
// Request metrics:
// - Request rate (req/s)
// - Error rate (%)
// - Latency (p50, p95, p99)

// Database metrics:
// - Query duration
// - Connection pool utilization
// - Slow queries (>100ms)

// Business metrics:
// - User registrations (count)
// - Login attempts (count)
// - Failed logins (count)

// Resource metrics:
// - CPU usage (%)
// - Memory usage (MB)
// - Disk I/O
```

**Alerting thresholds:**

```typescript
// Critical alerts:
// - Error rate > 5%
// - p99 latency > 1s
// - Database pool exhausted
// - Memory usage > 90%

// Warning alerts:
// - Error rate > 1%
// - p99 latency > 500ms
// - Database pool > 80% utilized
// - Memory usage > 75%
```

---

**🎉 M14: USER SERVICE SERVER DEEP DIVE COMPLETE!**

You've mastered:
- ✅ Microservice architecture principles
- ✅ Service responsibilities and boundaries
- ✅ User Service vs API Gateway differences
- ✅ Database health checks and pool monitoring
- ✅ Request logging with metrics
- ✅ Public vs internal route separation
- ✅ Service-to-service communication
- ✅ Graceful shutdown for microservices
- ✅ Production service discovery patterns
- ✅ Enhanced health check strategies

**Next:** Continue with remaining modules (M15-M27) covering repositories, services, controllers, end-to-end flows, and interview preparation.

**Progress: 14 out of 27 modules completed! (52% done - more than halfway!)**
