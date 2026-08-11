# M09: API Gateway Deep Dive - Part 1

**File:** `services/api-gateway/src/server.ts` (191 lines)  
**Level:** Architecture  
**Prerequisites:** M01 (Logger), M02 (Error Handling), M04 (Redis), M07 (Rate Limiting)  
**Time to Master:** 3-4 hours

---

## 📖 SECTION 1: THEORY - API Gateway Fundamentals

### 1.1 What is an API Gateway?

**API Gateway** = Single entry point for all client requests that routes traffic to appropriate backend services.

**Real-World Analogy:**

Think of a **hotel reception desk**:

**Without API Gateway (Direct Access):**
```
Client → Kitchen (for food)
Client → Housekeeping (for cleaning)
Client → Maintenance (for repairs)
Client → Security (for access)
```

**Problems:**
- Client needs to know every department ❌
- Each department handles its own security ❌
- No central logging ❌
- Hard to rate limit ❌

**With API Gateway (Reception Desk):**
```
Client → Reception Desk → Kitchen
Client → Reception Desk → Housekeeping
Client → Reception Desk → Maintenance
Client → Reception Desk → Security
```

**Benefits:**
- Client talks to one place ✅
- Centralized security ✅
- Central logging ✅
- Easy rate limiting ✅

### 1.2 API Gateway Responsibilities

**1. Request Routing**

```typescript
// Client makes single request
GET /api/products/123

// Gateway determines which service to call
if (path.startsWith('/api/products')) {
  proxy → Product Service (port 3001)
}
if (path.startsWith('/api/orders')) {
  proxy → Order Service (port 3002)
}
```

**2. Authentication & Authorization**

```typescript
// Gateway checks auth ONCE
app.use('/api', authenticate());

// Backend services trust gateway
// No need to duplicate auth logic in every service ✅
```

**3. Rate Limiting**

```typescript
// Gateway limits ALL requests centrally
app.use(rateLimiter);

// Protects ALL backend services
// Single point of defense ✅
```

**4. Request/Response Transformation**

```typescript
// Add request ID
req.headers['X-Request-ID'] = uuidv4();

// Add CORS headers
res.setHeader('Access-Control-Allow-Origin', '*');

// Transform response format
res.json({ data: serviceResponse, meta: { requestId } });
```

**5. Logging & Monitoring**

```typescript
// Log ALL requests in one place
logger.info('Request', { method, path, duration, statusCode });

// Easier to monitor than N services
```

**6. Error Handling**

```typescript
// Standardize error responses
app.use(errorHandler);

// All services return consistent format
{ error: 'Resource not found', statusCode: 404 }
```

### 1.3 Microservices Architecture

**Our System:**

```
┌─────────────────────────────────────────────────────────┐
│                      CLIENT                              │
│                    (Web/Mobile)                          │
└────────────────┬────────────────────────────────────────┘
                 │
                 │ HTTPS
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│                   API GATEWAY                            │
│                   (Port 3000)                            │
│                                                          │
│  • Authentication         • Rate Limiting                │
│  • Request Routing        • Logging                      │
│  • CORS                   • Health Checks                │
└──────┬──────────┬─────────┬──────────┬──────────────────┘
       │          │         │          │
       │          │         │          │
   ┌───▼───┐  ┌──▼──┐  ┌───▼───┐  ┌───▼────┐
   │ User  │  │Auth │  │Product│  │ Order  │
   │Service│  │Svc  │  │Service│  │Service │
   │:3001  │  │:3002│  │:3003  │  │:3004   │
   └───┬───┘  └──┬──┘  └───┬───┘  └───┬────┘
       │         │          │          │
       │         │          │          │
       └─────────┴──────────┴──────────┘
                 │
                 ▼
         ┌───────────────┐
         │   PostgreSQL  │
         │   Database    │
         └───────────────┘
```

**Request Flow Example:**

```typescript
// 1. Client requests product
GET https://api.example.com/api/products/123
Authorization: Bearer eyJhbGc...

// 2. API Gateway receives request
// - Adds request ID
// - Logs request
// - Checks rate limit
// - Verifies JWT token
// - Routes to Product Service

// 3. Product Service (port 3003)
GET http://localhost:3003/products/123

// 4. Product Service queries database
SELECT * FROM products WHERE id = 123

// 5. Product Service returns data
{ id: 123, name: 'Laptop', price: 999 }

// 6. Gateway returns to client
{ id: 123, name: 'Laptop', price: 999 }
```

### 1.4 Express Middleware Chain

**Middleware** = Functions that process requests before they reach route handlers.

**Execution Order:**

```typescript
app.use(helmet());              // 1. Security headers
app.use(cors());                // 2. CORS headers
app.use(express.json());        // 3. Parse JSON body
app.use(requestIdMiddleware);   // 4. Add request ID
app.use(loggingMiddleware);     // 5. Log request
app.use(apiRateLimiter);        // 6. Rate limiting
app.use('/api/auth', authRoutes);  // 7. Auth routes
app.use('/api', routes);        // 8. Other routes
app.use(errorHandler);          // 9. Error handling
```

**Visual Flow:**

```
Request
  ↓
helmet() → Set security headers
  ↓
cors() → Set CORS headers
  ↓
express.json() → Parse body
  ↓
requestId → Add X-Request-ID
  ↓
logging → Log start
  ↓
rateLimiter → Check rate limit
  ↓
routes → Handle request
  ↓
logging → Log finish
  ↓
errorHandler → Catch errors
  ↓
Response
```

**Key Concept: Middleware is a chain**

```typescript
// Each middleware calls next()
function middleware1(req, res, next) {
  // Do something
  next();  // Pass to next middleware
}

function middleware2(req, res, next) {
  // Do something
  next();  // Pass to next middleware
}

// If next() not called:
function blockingMiddleware(req, res, next) {
  res.json({ error: 'Blocked' });
  // No next() → request stops here
}
```

### 1.5 Environment Configuration

**Environment Variables Used:**

```bash
# Server
PORT=3000
NODE_ENV=production

# CORS
CORS_ORIGIN=https://example.com

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/ecommerce

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=15m

# Services
USER_SERVICE_URL=http://localhost:3001
PRODUCT_SERVICE_URL=http://localhost:3003
ORDER_SERVICE_URL=http://localhost:3004
```

**Why environment variables?**

```typescript
// ❌ BAD: Hard-coded
const PORT = 3000;
const CORS_ORIGIN = 'https://example.com';
// Can't change without redeploying

// ✅ GOOD: Environment variables
const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
// Can change via environment
```

**Different environments:**

```bash
# Development
PORT=3000
NODE_ENV=development
CORS_ORIGIN=*
DATABASE_URL=postgresql://localhost:5432/ecommerce_dev

# Staging
PORT=3000
NODE_ENV=staging
CORS_ORIGIN=https://staging.example.com
DATABASE_URL=postgresql://staging-db:5432/ecommerce_staging

# Production
PORT=80
NODE_ENV=production
CORS_ORIGIN=https://example.com
DATABASE_URL=postgresql://prod-db:5432/ecommerce_prod
```

---

## 🔍 SECTION 2: LINE-BY-LINE CODE ANALYSIS

### 2.1 Imports (Lines 1-15)

```typescript
import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import logger from '../../../shared/logger';
import { errorHandler } from '../../../shared/errors';
import redisClient from '../../../shared/redis';
import { apiRateLimiter } from '../../../shared/auth/rateLimiter';
import routes from './routes';
import authRoutes from './routes/auth.routes';
import { getAllServices } from './config/services';
import { initDatabase, db } from './config/database';
import * as metrics from './lib/Metrics';
```

#### Line 1: dotenv

```typescript
import 'dotenv/config';
```

**Purpose:** Load environment variables from `.env` file into `process.env`.

**How it works:**

```typescript
// Before import
console.log(process.env.PORT);  // undefined

// .env file:
// PORT=3000
// DATABASE_URL=postgresql://...

// After import
console.log(process.env.PORT);  // '3000'
console.log(process.env.DATABASE_URL);  // 'postgresql://...'
```

**Why `/config` import?**

```typescript
// Standard way (requires manual call):
import dotenv from 'dotenv';
dotenv.config();  // Must call this

// Auto-execute way (no manual call):
import 'dotenv/config';  // Executes config() on import
```

**⚠️ Must be first import:**

```typescript
// ✅ CORRECT: dotenv first
import 'dotenv/config';
import { DATABASE_URL } from './config';  // Can use env vars

// ❌ WRONG: dotenv after usage
import { DATABASE_URL } from './config';  // undefined!
import 'dotenv/config';  // Too late
```

#### Lines 2-6: Core Dependencies

```typescript
import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
```

**Line 2: Express**

```typescript
import express, { Request, Response, NextFunction } from 'express';
```

**express** = Web framework  
**Request** = Type for request object  
**Response** = Type for response object  
**NextFunction** = Type for `next()` function

```typescript
// Usage:
const app = express();

function middleware(req: Request, res: Response, next: NextFunction) {
  // req: HTTP request
  // res: HTTP response
  // next: Pass to next middleware
}
```

**Line 3: Helmet**

```typescript
import helmet from 'helmet';
```

**helmet** = Security middleware that sets HTTP headers.

**What it does:**

```http
# Without helmet:
HTTP/1.1 200 OK
Content-Type: application/json

# With helmet:
HTTP/1.1 200 OK
Content-Type: application/json
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: max-age=15552000
Content-Security-Policy: default-src 'self'
```

**Security benefits:**

```typescript
// Prevents:
// - Clickjacking (X-Frame-Options)
// - MIME sniffing (X-Content-Type-Options)
// - XSS attacks (X-XSS-Protection)
// - Downgrade attacks (Strict-Transport-Security)
```

**Line 4: CORS**

```typescript
import cors from 'cors';
```

**cors** = Cross-Origin Resource Sharing middleware.

**Problem without CORS:**

```javascript
// Frontend at https://example.com
fetch('https://api.example.com/api/products')
// ❌ CORS error: Blocked by browser
```

**Solution with CORS:**

```typescript
app.use(cors({
  origin: 'https://example.com'
}));

// Browser allows request ✅
```

**Line 5: UUID**

```typescript
import { v4 as uuidv4 } from 'uuid';
```

**uuidv4** = Generate random unique IDs (version 4).

**What is UUID v4?**

```typescript
uuidv4()  // 'a3f8b9c2-d1e4-f7a8-b5c9-d2e6f3a7b1c4'
uuidv4()  // 'b4g9c0d3-e2f5-a8b1-c6d9-e3f7g4a8b2c5'
uuidv4()  // 'c5h0d4e3-f3g6-b9c2-d7e0-f4g8h5a9b3c6'

// Format: 8-4-4-4-12 hexadecimal characters
// Example: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

**Why use UUIDs?**

```typescript
// Request tracking
const requestId = uuidv4();
logger.info('Request started', { requestId });
// ... later
logger.info('Request finished', { requestId });
// Can correlate logs by ID

// Globally unique (no coordination needed)
// Collision probability: ~0.00000000006% (negligible)
```

**Line 6: Axios**

```typescript
import axios from 'axios';
```

**axios** = HTTP client for making requests.

**Usage:**

```typescript
// Make HTTP request to backend service
const response = await axios.get('http://localhost:3003/products/123');

// vs native fetch:
const response = await fetch('http://localhost:3003/products/123');
const data = await response.json();  // Extra step

// Axios auto-parses JSON ✅
```

#### Lines 7-10: Shared Modules

```typescript
import logger from '../../../shared/logger';
import { errorHandler } from '../../../shared/errors';
import redisClient from '../../../shared/redis';
import { apiRateLimiter } from '../../../shared/auth/rateLimiter';
```

**Line 7:** Winston logger from M01  
**Line 8:** Error handling middleware from M02  
**Line 9:** Redis client from M04  
**Line 10:** Rate limiter from M07

**Path structure:**

```
services/api-gateway/src/server.ts
                           ↓ ../../../shared/
shared/logger/index.ts
shared/errors/index.ts
shared/redis/index.ts
shared/auth/rateLimiter.ts
```

#### Lines 11-15: Local Modules

```typescript
import routes from './routes';
import authRoutes from './routes/auth.routes';
import { getAllServices } from './config/services';
import { initDatabase, db } from './config/database';
import * as metrics from './lib/Metrics';
```

**Line 11:** Main routes (products, orders)  
**Line 12:** Auth routes (login, register)  
**Line 13:** Service registry (list of backend services)  
**Line 14:** Database connection  
**Line 15:** Prometheus metrics

### 2.2 TypeScript Interface (Lines 17-19)

```typescript
interface RequestWithId extends Request {
  id: string;
}
```

**Purpose:** Extend Express Request type to include request ID.

**Why extend?**

```typescript
// Standard Express Request doesn't have 'id'
function handler(req: Request, res: Response) {
  console.log(req.id);  // ❌ TypeScript error: Property 'id' does not exist
}

// Our extended type has 'id'
function handler(req: RequestWithId, res: Response) {
  console.log(req.id);  // ✅ TypeScript happy
}
```

**Type-safe access:**

```typescript
// Middleware adds ID
app.use((req: Request, res: Response, next: NextFunction) => {
  (req as RequestWithId).id = uuidv4();
  next();
});

// Route handler uses ID
app.get('/test', (req: Request, res: Response) => {
  const requestId = (req as RequestWithId).id;
  logger.info('Test route', { requestId });
});
```

### 2.3 App Initialization (Lines 21-22)

```typescript
const app = express();
const PORT = process.env.PORT || 3000;
```

**Line 21:** Create Express application instance.

```typescript
const app = express();
// app = Express application
// Can now call:
// - app.use() for middleware
// - app.get() for GET routes
// - app.post() for POST routes
// - app.listen() to start server
```

**Line 22:** Get port from environment or default to 3000.

```typescript
const PORT = process.env.PORT || 3000;
```

**How `||` works:**

```typescript
// If PORT set:
process.env.PORT = '8080';
const PORT = process.env.PORT || 3000;  // PORT = '8080'

// If PORT not set:
process.env.PORT = undefined;
const PORT = process.env.PORT || 3000;  // PORT = 3000
```

**⚠️ String vs Number:**

```typescript
process.env.PORT = '8080';  // String, not number!

// Most places work fine:
app.listen(PORT, ...)  // Express converts to number

// But be careful:
PORT + 1  // '80801' not 8081 ❌

// Convert to number if needed:
const PORT = Number(process.env.PORT) || 3000;
```

### 2.4 Metrics Endpoint (Lines 24-33)

```typescript
app.get('/metrics', async (_req: Request, res: Response) => {
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

**Purpose:** Expose Prometheus metrics for monitoring.

**What are Prometheus metrics?**

```
# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",path="/api/products"} 1523

# HELP http_request_duration_seconds HTTP request duration
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{le="0.1"} 523
http_request_duration_seconds_bucket{le="0.5"} 1234
```

**Why expose `/metrics`?**

```typescript
// Prometheus server scrapes this endpoint every 15 seconds
GET http://localhost:3000/metrics

// Collects metrics:
// - Request count
// - Request duration
// - Error rate
// - Memory usage
// - CPU usage

// Displays in Grafana dashboard
```

#### Line 26: Set Content Type

```typescript
res.set('Content-Type', metrics.register.contentType);
```

**`metrics.register.contentType`** = `'text/plain; version=0.0.4; charset=utf-8'`

**Why this specific content type?**

```http
Content-Type: text/plain; version=0.0.4; charset=utf-8
              ↑           ↑              ↑
              plain text  Prometheus     UTF-8 encoding
                         format version
```

**Prometheus expects this format.**

#### Line 27: Get Metrics

```typescript
const metricsOutput = await metrics.register.metrics();
```

**Returns string with all metrics:**

```typescript
// Example output:
`# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",path="/api/products"} 1523
http_requests_total{method="POST",path="/api/orders"} 742

# HELP process_cpu_user_seconds_total User CPU time
# TYPE process_cpu_user_seconds_total counter
process_cpu_user_seconds_total 12.45`
```

#### Line 28: Return Metrics

```typescript
res.end(metricsOutput);
```

**Why `res.end()` not `res.json()`?**

```typescript
// Metrics are plain text, not JSON
res.end(metricsOutput);  // ✅ Correct

// vs
res.json(metricsOutput);  // ❌ Would wrap in quotes
```

### 2.5 Security Middleware (Line 35)

```typescript
app.use(helmet());
```

**helmet()** = Security headers middleware.

**Sets multiple headers:**

```typescript
// helmet() is equivalent to:
app.use(helmet.contentSecurityPolicy());
app.use(helmet.dnsPrefetchControl());
app.use(helmet.frameguard());
app.use(helmet.hidePoweredBy());
app.use(helmet.hsts());
app.use(helmet.ieNoOpen());
app.use(helmet.noSniff());
app.use(helmet.xssFilter());
```

**Headers added:**

```http
Content-Security-Policy: default-src 'self'
X-DNS-Prefetch-Control: off
X-Frame-Options: SAMEORIGIN
X-Powered-By: (removed)
Strict-Transport-Security: max-age=15552000; includeSubDomains
X-Download-Options: noopen
X-Content-Type-Options: nosniff
X-XSS-Protection: 1; mode=block
```

**Security benefits:**

**1. X-Frame-Options: SAMEORIGIN**

```html
<!-- Attacker's site -->
<iframe src="https://your-api.com">
<!-- ❌ Blocked by X-Frame-Options -->
<!-- Prevents clickjacking attacks -->
```

**2. X-Content-Type-Options: nosniff**

```html
<!-- Attacker uploads image.jpg containing JS code -->
<script src="/uploads/image.jpg"></script>
<!-- ❌ Blocked by nosniff -->
<!-- Prevents MIME-type confusion attacks -->
```

**3. Strict-Transport-Security**

```http
# Forces HTTPS for 180 days
Strict-Transport-Security: max-age=15552000

# User types: http://your-api.com
# Browser auto-upgrades to: https://your-api.com ✅
```

**4. Content-Security-Policy**

```http
Content-Security-Policy: default-src 'self'

<!-- ❌ Blocked: External script -->
<script src="https://evil.com/malicious.js"></script>

<!-- ✅ Allowed: Same-origin script -->
<script src="/js/app.js"></script>
```

### 2.6 CORS Middleware (Lines 36-41)

```typescript
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID']
}));
```

**Purpose:** Enable Cross-Origin Resource Sharing.

#### Line 37: origin

```typescript
origin: process.env.CORS_ORIGIN || '*',
```

**What is origin?**

```
https://example.com:443/path?query=value
└───────┬────────────┘
      Origin
```

**Origin = Protocol + Domain + Port**

```typescript
// Same origin:
https://example.com/page1
https://example.com/page2

// Different origin (subdomain):
https://api.example.com
https://www.example.com

// Different origin (protocol):
http://example.com
https://example.com

// Different origin (port):
https://example.com:3000
https://example.com:3001
```

**CORS origin options:**

```typescript
// 1. Allow all (development only!)
origin: '*'
// Any website can call your API

// 2. Allow specific origin (production)
origin: 'https://example.com'
// Only example.com can call your API

// 3. Allow multiple origins
origin: ['https://example.com', 'https://app.example.com']

// 4. Dynamic origin (function)
origin: (origin, callback) => {
  const whitelist = ['https://example.com', 'https://app.example.com'];
  if (whitelist.includes(origin)) {
    callback(null, true);  // Allow
  } else {
    callback(new Error('Not allowed by CORS'));  // Deny
  }
}
```

**Why `'*'` is dangerous in production:**

```typescript
// With origin: '*'
// Evil.com can call your API:
fetch('https://your-api.com/api/users/me', {
  credentials: 'include'  // Sends cookies
})
.then(res => res.json())
.then(data => {
  // Evil.com now has user data! ❌
  sendToAttacker(data);
});
```

#### Line 38: credentials

```typescript
credentials: true,
```

**Allows cookies and auth headers in cross-origin requests.**

**Without credentials:**

```javascript
// Frontend code:
fetch('https://api.example.com/api/users/me', {
  credentials: 'include',  // Send cookies
  headers: { 'Authorization': 'Bearer token' }
});

// ❌ CORS error: credentials not allowed
```

**With credentials:**

```typescript
cors({ credentials: true })

// ✅ Cookies and Authorization header sent
```

**⚠️ Security note:**

```typescript
// Can't combine credentials with wildcard origin
cors({
  origin: '*',
  credentials: true  // ❌ Error: Not allowed
});

// Must specify origin
cors({
  origin: 'https://example.com',
  credentials: true  // ✅ Allowed
});
```

#### Line 39: methods

```typescript
methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
```

**Allowed HTTP methods.**

**Sets header:**

```http
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, PATCH, OPTIONS
```

**Why OPTIONS?**

```typescript
// Browsers send OPTIONS request first (preflight)
OPTIONS /api/products
Access-Control-Request-Method: POST

// Server responds:
200 OK
Access-Control-Allow-Methods: POST, GET, PUT

// Then browser sends actual request:
POST /api/products
{ name: 'Laptop' }
```

**Preflight request example:**

```http
# Browser sends preflight
OPTIONS /api/products HTTP/1.1
Origin: https://example.com
Access-Control-Request-Method: POST
Access-Control-Request-Headers: Content-Type, Authorization

# Server responds
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://example.com
Access-Control-Allow-Methods: GET, POST, PUT, DELETE
Access-Control-Allow-Headers: Content-Type, Authorization
Access-Control-Max-Age: 86400

# Browser caches preflight for 24 hours
# Then sends actual request
POST /api/products HTTP/1.1
Content-Type: application/json
```

#### Line 40: allowedHeaders

```typescript
allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID']
```

**Allowed request headers.**

**Sets header:**

```http
Access-Control-Allow-Headers: Content-Type, Authorization, X-Request-ID
```

**Why needed?**

```javascript
// Frontend sends custom header
fetch('/api/products', {
  headers: {
    'Content-Type': 'application/json',  // Standard header
    'Authorization': 'Bearer token',      // Custom header (needs CORS)
    'X-Request-ID': 'abc123'             // Custom header (needs CORS)
  }
});

// Without allowedHeaders:
// ❌ CORS error: X-Request-ID not allowed

// With allowedHeaders:
// ✅ Request succeeds
```

### 2.7 Body Parser Middleware (Lines 43-44)

```typescript
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
```

**Purpose:** Parse request body into usable format.

#### Line 43: JSON Parser

```typescript
app.use(express.json({ limit: '10mb' }));
```

**Parses JSON request bodies.**

**Without middleware:**

```typescript
app.post('/api/products', (req, res) => {
  console.log(req.body);  // undefined ❌
});

// POST /api/products
// Content-Type: application/json
// { "name": "Laptop", "price": 999 }
```

**With middleware:**

```typescript
app.use(express.json());

app.post('/api/products', (req, res) => {
  console.log(req.body);  // { name: 'Laptop', price: 999 } ✅
});
```

**`limit: '10mb'`:**

```typescript
// Rejects requests larger than 10MB
POST /api/products
Content-Length: 12000000  (12MB)
{ ... huge payload ... }

// Response:
413 Payload Too Large
```

**Why limit?**

```typescript
// Prevent DoS attack:
POST /api/products
Content-Type: application/json
{ "data": "a".repeat(1000000000) }  // 1GB of 'a' characters

// Without limit:
// Server runs out of memory ❌

// With limit: '10mb'
// Request rejected immediately ✅
```

#### Line 44: URL-Encoded Parser

```typescript
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
```

**Parses form data.**

**Use case:**

```html
<!-- HTML form -->
<form method="POST" action="/api/products">
  <input name="name" value="Laptop">
  <input name="price" value="999">
  <button type="submit">Submit</button>
</form>
```

**Request:**

```http
POST /api/products
Content-Type: application/x-www-form-urlencoded

name=Laptop&price=999
```

**Parsed result:**

```typescript
req.body = {
  name: 'Laptop',
  price: '999'
}
```

**`extended: true`:**

```typescript
// extended: false (simple parsing)
name=John&age=30
// Parsed as: { name: 'John', age: '30' }

// extended: true (rich objects)
user[name]=John&user[age]=30
// Parsed as: { user: { name: 'John', age: '30' } }

// Arrays:
colors[]=red&colors[]=blue
// Parsed as: { colors: ['red', 'blue'] }
```

### 2.8 Request ID Middleware (Lines 46-51)

```typescript
app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = (req.headers['x-request-id'] as string) || uuidv4();
  (req as RequestWithId).id = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
});
```

**Purpose:** Add unique ID to every request for tracing.

#### Line 47: Get or Generate ID

```typescript
const requestId = (req.headers['x-request-id'] as string) || uuidv4();
```

**Two sources for request ID:**

**1. Client provides ID:**

```http
GET /api/products
X-Request-ID: abc123
```

```typescript
// Use client's ID
requestId = 'abc123'
```

**2. No ID provided:**

```http
GET /api/products
(no X-Request-ID header)
```

```typescript
// Generate new UUID
requestId = 'a3f8b9c2-d1e4-f7a8-b5c9-d2e6f3a7b1c4'
```

**Why allow client ID?**

```typescript
// Distributed tracing across multiple services:

// 1. Client generates ID
const requestId = uuidv4();

// 2. Calls API Gateway
GET /api/orders
X-Request-ID: abc123

// 3. Gateway forwards to Order Service
GET http://order-service/orders
X-Request-ID: abc123

// 4. Order Service calls Product Service
GET http://product-service/products/123
X-Request-ID: abc123

// All logs have same ID:
// Gateway: [abc123] Processing order request
// Order Service: [abc123] Creating order
// Product Service: [abc123] Checking stock
// Can trace entire request flow! ✅
```

#### Line 48: Store in Request

```typescript
(req as RequestWithId).id = requestId;
```

**Add ID to request object.**

```typescript
// Now accessible in all route handlers:
app.get('/api/products', (req: Request, res: Response) => {
  const id = (req as RequestWithId).id;
  logger.info('Get products', { requestId: id });
});
```

#### Line 49: Return in Response

```typescript
res.setHeader('X-Request-ID', requestId);
```

**Sends ID back to client.**

```http
HTTP/1.1 200 OK
X-Request-ID: a3f8b9c2-d1e4-f7a8-b5c9-d2e6f3a7b1c4
Content-Type: application/json

{ ... }
```

**Why return ID?**

```typescript
// Client can use for support requests:
try {
  const response = await fetch('/api/products');
  const requestId = response.headers.get('X-Request-ID');
  // ... error occurs
} catch (error) {
  // Report to support: "Request ID: abc123 failed"
  reportError({ requestId, error });
}

// Support can search logs:
// grep "abc123" logs/*.log
// Finds exact request that failed ✅
```

#### Line 50: Next Middleware

```typescript
next();
```

**Pass to next middleware in chain.**

```typescript
// Without next():
app.use((req, res, next) => {
  // Do something
  // No next() → request hangs ❌
});

// With next():
app.use((req, res, next) => {
  // Do something
  next();  // Continue to next middleware ✅
});
```

### 2.9 Logging Middleware (Lines 53-71)

```typescript
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const requestId = (req as RequestWithId).id;

  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.path}`, {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
  });

  next();
});
```

**Purpose:** Log all requests with timing and metadata.

#### Line 54: Start Timer

```typescript
const start = Date.now();
```

**Capture request start time.**

```typescript
Date.now()  // 1704470400000 (milliseconds since 1970)

// Later:
const end = Date.now();  // 1704470400235
const duration = end - start;  // 235ms
```

#### Line 57: Listen for Response Finish

```typescript
res.on('finish', () => {
  // Code here runs AFTER response sent
});
```

**Event-driven logging:**

```typescript
// Request flow:
1. Middleware runs
2. Route handler runs
3. Response sent
4. 'finish' event fires ← Log here
```

**Why log after response?**

```typescript
// Can log status code and duration:
res.on('finish', () => {
  console.log(res.statusCode);  // 200, 404, 500, etc.
  console.log(Date.now() - start);  // Actual response time
});

// If logged before response:
logger.info('Request');  // Don't know status code yet ❌
```

#### Lines 59-67: Log Entry

```typescript
logger.info(`${req.method} ${req.path}`, {
  requestId,
  method: req.method,
  path: req.path,
  statusCode: res.statusCode,
  duration: `${duration}ms`,
  ip: req.ip,
  userAgent: req.get('user-agent')
});
```

**Example log output:**

```json
{
  "level": "info",
  "message": "GET /api/products",
  "requestId": "a3f8b9c2-d1e4-f7a8-b5c9",
  "method": "GET",
  "path": "/api/products",
  "statusCode": 200,
  "duration": "235ms",
  "ip": "192.168.1.1",
  "userAgent": "Mozilla/5.0...",
  "timestamp": "2023-01-15T10:30:00.000Z"
}
```

**Fields explanation:**

```typescript
// requestId: Track across services
"requestId": "a3f8b9c2..."

// method: HTTP method
"method": "GET"

// path: URL path (not full URL)
"path": "/api/products"  // ✅
"path": "http://localhost:3000/api/products"  // ❌

// statusCode: HTTP response code
"statusCode": 200  // Success
"statusCode": 404  // Not found
"statusCode": 500  // Error

// duration: Response time
"duration": "235ms"

// ip: Client IP address
"ip": "192.168.1.1"

// userAgent: Client browser/app
"userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)..."
```

**Querying logs:**

```bash
# Find slow requests
grep '"duration":"[5-9][0-9][0-9]ms"' logs.json

# Find 500 errors
grep '"statusCode":500' logs.json

# Find requests from specific IP
grep '"ip":"192.168.1.1"' logs.json

# Find requests for specific ID
grep '"requestId":"a3f8b9c2"' logs.json
```

### 2.10 Rate Limiter (Line 73)

```typescript
app.use(apiRateLimiter);
```

**apiRateLimiter** from M07: 100 requests per 15 minutes.

**Configured in shared/auth/rateLimiter.ts:**

```typescript
export const apiRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 100,                   // 100 requests
  message: 'Too many requests from this IP',
  standardHeaders: true,
  legacyHeaders: false
});
```

**Applies to ALL routes:**

```typescript
// Before routes
app.use(apiRateLimiter);  // ← Global rate limit

// All these routes rate-limited:
app.use('/api/auth', authRoutes);
app.use('/api', routes);
```

**Response when exceeded:**

```http
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1704471000
Content-Type: application/json

{
  "error": "Too many requests from this IP",
  "retryAfter": 900
}
```

---

**🎓 END OF PART 1**

You've mastered:
- ✅ API Gateway fundamentals and architecture
- ✅ Microservices request routing
- ✅ Express middleware chain and execution order
- ✅ Security with Helmet
- ✅ CORS configuration and preflight requests
- ✅ Request ID generation and distributed tracing
- ✅ Request/response logging
- ✅ Rate limiting at the gateway level

**Next: M09 Part 2** will cover health checks, route mounting, error handling, and graceful shutdown.
