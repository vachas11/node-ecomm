# 🎓 Deep Dive: Production Node.js Entry Point

This document explains **EVERY LINE** of the API Gateway server, comparing tutorial code vs production code.

---

## 🎯 Quick Revision Materials

Looking to review without reading full explanations? Check out the **Revision Modules**:

- **[📋 Interview Questions](revision/REVISION-INTERVIEW-QUESTIONS.md)** - 100 questions organized by category (no answers)
- **[💻 Coding Exercises](revision/REVISION-CODING-EXERCISES.md)** - 11 hands-on exercises (no solutions)
- **[🧪 Testing Exercises](revision/REVISION-TESTING-EXERCISES.md)** - 30 system tests (no expected outputs)
- **[📖 Revision Guide](revision/README.md)** - How to use the revision materials

**Use these for:**

- Self-testing before checking answers
- Pre-interview preparation (scan 100 questions in 30-60 minutes)
- Daily practice drills
- Identifying knowledge gaps

---

## 📂 File: `services/api-gateway/src/server.js`

This is the **ENTRY POINT** of the API Gateway. When you run `npm start`, Node.js executes this file.

---

## Line-by-Line Breakdown

### **Line 1: Environment Variables**

```javascript
require('dotenv').config();
```

**What it does:**

- Loads `.env` file into `process.env`
- Must be FIRST line (before any other imports)

**Tutorial vs Production:**

```javascript
// ❌ Tutorial way
const JWT_SECRET = 'my-secret-key'; // Hardcoded - TERRIBLE!

// ✅ Production way
require('dotenv').config();
const JWT_SECRET = process.env.JWT_SECRET; // From .env file
```

**Why production way is better:**

- Secrets NEVER in code (Git would expose them!)
- Different secrets per environment (dev/staging/prod)
- Easy to rotate secrets (change .env, restart server)

**Example `.env` file:**

```bash
PORT=3000
JWT_SECRET=super-long-random-secret-at-least-32-chars
REDIS_HOST=localhost
USER_SERVICE_URL=http://localhost:3001
```

**Interview Question:**

> **Q:** "How do you manage secrets in production?"
>
> **A:** "I use environment variables loaded via dotenv in development, and AWS Secrets Manager in production. Secrets are never committed to Git. Each environment (dev/staging/prod) has its own secrets. I rotate secrets regularly and use separate signing keys for different purposes (JWT access vs refresh)."

---

### **Lines 2-12: Imports**

```javascript
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const logger = require('../../../shared/logger');
const { errorHandler } = require('../../../shared/errors');
const redisClient = require('../../../shared/redis');
const { apiRateLimiter } = require('../../../shared/auth/rateLimiter');
const routes = require('./routes');
const { getAllServices, getService } = require('./config/services');
const axios = require('axios');
```

**Why each import matters:**

| Import            | Purpose               | Production Reason                                                |
| ----------------- | --------------------- | ---------------------------------------------------------------- |
| `express`         | Web framework         | Industry standard, battle-tested at scale                        |
| `helmet`          | Security headers      | Prevents XSS, clickjacking, MIME sniffing attacks                |
| `cors`            | Cross-origin requests | Allows frontend (react.com) to call API (api.react.com)          |
| `uuid`            | Unique IDs            | Track requests across distributed services (distributed tracing) |
| `logger`          | Structured logging    | Better than console.log - includes timestamps, levels, metadata  |
| `errorHandler`    | Centralized errors    | Consistent error format, hide internal details from clients      |
| `redisClient`     | In-memory cache       | Token blacklist, rate limiting, session storage                  |
| `apiRateLimiter`  | Rate limiting         | Prevent DDoS, brute force attacks                                |
| `routes`          | Route handlers        | Organize endpoints (auth routes, product routes, etc.)           |
| `services config` | Service registry      | Map service names to URLs for proxying                           |
| `axios`           | HTTP client           | Make requests to backend services                                |

**Tutorial vs Production:**

```javascript
// ❌ Tutorial
const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('Hello'));
app.listen(3000);
// That's it! No security, no logging, no error handling

// ✅ Production
const express = require('express');
const helmet = require('helmet'); // Security
const logger = require('./logger'); // Logging
const errorHandler = require('./errors'); // Error handling
const rateLimit = require('./rateLimit'); // Rate limiting

const app = express();
app.use(helmet()); // Add security headers
app.use(logger); // Log every request
app.use(rateLimit); // Prevent abuse
// ... routes ...
app.use(errorHandler); // Handle errors gracefully
```

---

### **Lines 14-15: Express App Initialization**

```javascript
const app = express();
const PORT = process.env.PORT || 3000;
```

**What happens:**

1. `express()` creates the application instance
2. `PORT` comes from environment (AWS will set this dynamically)

**Why `process.env.PORT || 3000`:**

```javascript
// Development: .env has PORT=3000
// Production: AWS ECS sets PORT=8080 dynamically
// Fallback: 3000 if not set (local development)
```

**Interview Insight:**

> In AWS ECS, the container port is dynamically assigned. Your app MUST read `process.env.PORT` or it won't receive traffic. Hardcoding `3000` breaks in production.

---

### **Line 18: Security Middleware (Helmet)**

```javascript
app.use(helmet());
```

**What Helmet does:**
Sets HTTP headers to protect against common attacks.

**Before Helmet:**

```http
HTTP/1.1 200 OK
Content-Type: application/json
```

**After Helmet:**

```http
HTTP/1.1 200 OK
Content-Type: application/json
X-Content-Type-Options: nosniff           ← Prevent MIME sniffing
X-Frame-Options: DENY                     ← Prevent clickjacking
X-XSS-Protection: 1; mode=block           ← XSS protection
Strict-Transport-Security: max-age=15552000 ← Force HTTPS
Content-Security-Policy: default-src 'self' ← Prevent XSS
```

**Real Attack Prevented:**

```javascript
// Without Helmet:
// Attacker uploads file named "harmless.jpg"
// Browser interprets as JavaScript and executes!

// With Helmet (X-Content-Type-Options: nosniff):
// Browser respects Content-Type, won't execute image as JS
```

**Interview Question:**

> **Q:** "What security headers do you set?"
> e
> **A:** "I use Helmet.js which sets 15+ security headers. Key ones: X-Content-Type-Options prevents MIME sniffing, X-Frame-Options prevents clickjacking, Content-Security-Policy prevents XSS by restricting script sources, and Strict-Transport-Security forces HTTPS. These are OWASP Top 10 defenses."

---

### **Lines 21-26: CORS Configuration**

```javascript
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  })
);
```

**What is CORS?**

Cross-Origin Resource Sharing - security feature that blocks JavaScript from one domain accessing another domain.

**The Problem:**

```javascript
// Frontend: https://myapp.com (port 443)
// Backend:  https://api.myapp.com (different subdomain!)

// Browser blocks this by default:
fetch('https://api.myapp.com/users');
// ❌ Error: CORS policy: No 'Access-Control-Allow-Origin' header
```

**The Solution:**

```javascript
app.use(
  cors({
    origin: 'https://myapp.com', // Only allow requests from this domain
    credentials: true, // Allow cookies/auth headers
  })
);

// Backend response now includes:
// Access-Control-Allow-Origin: https://myapp.com
// ✅ Browser allows the request
```

**Production Configuration Breakdown:**

```javascript
origin: process.env.CORS_ORIGIN || '*';
// Production: 'https://myapp.com' (only your frontend)
// Development: '*' (allow all, for testing)

credentials: true;
// Allows cookies and Authorization header
// Required for JWT authentication

methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'];
// Which HTTP methods to allow
// OPTIONS is for preflight requests

allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'];
// Which headers frontend can send
// Authorization: For JWT tokens
// X-Request-ID: For distributed tracing
```

**Interview Question:**

> **Q:** "Why is CORS needed?"
>
> **A:** "CORS is a browser security feature that prevents malicious sites from stealing data. Without CORS, evil.com could make requests to mybank.com using your cookies and steal your data. CORS ensures only trusted origins can access the API. In production, I set origin to the specific frontend domain, enable credentials for auth cookies, and whitelist only necessary headers and methods."

---

### **Lines 29-30: Body Parsers**

```javascript
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
```

**What they do:**

```javascript
// Without body parser:
app.post('/users', (req, res) => {
  console.log(req.body); // undefined ❌
});

// With body parser:
app.post('/users', (req, res) => {
  console.log(req.body); // { name: "John", email: "john@test.com" } ✅
});
```

**Two parsers needed:**

1. **express.json()** - Parses JSON requests

```javascript
// Handles:
fetch('/api/users', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'John' }),
});
```

2. **express.urlencoded()** - Parses form submissions

```javascript
// Handles:
<form method="POST" action="/api/users">
  <input name="name" value="John">
  <input name="email" value="john@test.com">
</form>
```

**Why `limit: '10mb'`:**

```javascript
// Default is 100kb - too small!

// Without limit:
// User uploads 5MB profile picture
// ❌ Error: PayloadTooLargeError

// With limit: '10mb':
// ✅ Accepts up to 10MB
// But still protects against 100GB attack
```

**Why `extended: true`:**

```javascript
// extended: false (simple objects only)
user[name]=John&user[email]=test@test.com
→ req.body = { 'user[name]': 'John', 'user[email]': 'test@test.com' }

// extended: true (nested objects)
user[name]=John&user[email]=test@test.com
→ req.body = { user: { name: 'John', email: 'test@test.com' } }
```

**Interview Question:**

> **Q:** "Why do you need body parsers?"
>
> **A:** "HTTP request bodies come as raw bytes. Body parsers convert them to JavaScript objects. express.json() handles JSON payloads (most modern APIs), while express.urlencoded() handles form submissions (HTML forms). I set a 10MB limit as a security measure - it allows reasonable file uploads but prevents memory exhaustion from gigabyte-sized attack payloads."

---

### **Lines 33-37: Request ID Middleware**

```javascript
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || uuidv4();
  res.setHeader('X-Request-ID', req.id);
  next();
});
```

**THIS IS PRODUCTION GOLD! 🌟**

**The Problem:**

```
User reports: "My order failed!"
You check logs:
  [INFO] Order created
  [ERROR] Payment failed
  [INFO] Order created
  [ERROR] Database timeout
  [INFO] Order created

Which order is the user's?! You don't know! 😱
```

**The Solution:**

```javascript
// Each request gets unique ID
const requestId = uuidv4(); // "550e8400-e29b-41d4-a716-446655440000"

// Attach to request
req.id = requestId;

// Include in all logs for this request
logger.info('Processing payment', { requestId: req.id });
// [INFO] requestId=550e8400 Processing payment

logger.error('Payment failed', { requestId: req.id });
// [ERROR] requestId=550e8400 Payment failed

// Now you can grep logs by requestId!
```

**Distributed Tracing:**

```
Client Request (generates ID: 550e8400)
    ↓
API Gateway (receives 550e8400)
    ↓
User Service (forwards 550e8400)
    ↓
Order Service (forwards 550e8400)
    ↓
Payment Service (forwards 550e8400)

// All logs across ALL services have same requestId!
// You can trace entire request flow!
```

**Code breakdown:**

```javascript
req.headers['x-request-id'] || uuidv4();
// If client sent X-Request-ID header, use it
// Otherwise generate new UUID

res.setHeader('X-Request-ID', req.id);
// Send ID back to client in response
// Client can reference this ID when reporting issues!

next();
// Pass control to next middleware
// Without this, request hangs forever!
```

**Interview Question:**

> **Q:** "How do you debug issues in microservices?"
>
> **A:** "I use request IDs for distributed tracing. Each request gets a unique UUID that's propagated across all services via X-Request-ID header. Every log entry includes this ID. When a user reports an issue, I can grep all service logs by that request ID and see the entire flow - which service it hit, how long each took, where it failed. This is essential for debugging distributed systems. In production, I'd use OpenTelemetry for automatic tracing."

---

### **Lines 40-59: Request Logging Middleware**

```javascript
app.use((req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.path}`, {
      requestId: req.id,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      userId: req.user?.userId,
    });
  });

  next();
});
```

**What this does:**
Logs EVERY request with timing and metadata.

**Why not just `console.log()`?**

```javascript
// ❌ Tutorial way
app.get('/users', (req, res) => {
  console.log('User request received');
  // When did it finish?
  // How long did it take?
  // What was the response status?
  // Who made the request?
  // All unknown!
});

// ✅ Production way
// Automatic logging of ALL requests:
// [INFO] GET /api/users requestId=550e8400 status=200 duration=45ms ip=192.168.1.1 userId=123
```

**Code Breakdown:**

```javascript
const start = Date.now();
// Capture start time (milliseconds since 1970)

res.on('finish', () => {
  // 'finish' event fires AFTER response is sent
  // Now we know: status code, duration
});

const duration = Date.now() - start;
// Calculate how long request took

logger.info(`${req.method} ${req.path}`, { ... })
// Structured logging with metadata
```

**Why `res.on('finish')` not immediate logging?**

```javascript
// If we log immediately:
app.use((req, res, next) => {
  logger.info('Request received'); // Don't know result yet!
  next();
});

app.get('/users', async (req, res) => {
  const users = await db.query('SELECT * FROM users');
  res.json(users); // Response happens LATER
});

// Log shows "Request received" but:
// - Did query succeed? Unknown!
// - What status code? Unknown!
// - How long did it take? Unknown!

// With res.on('finish'):
// Log fires AFTER response, includes all info
```

**Production Log Output:**

```json
{
  "level": "info",
  "timestamp": "2026-07-30T10:15:30.123Z",
  "message": "GET /api/users",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "method": "GET",
  "path": "/api/users",
  "statusCode": 200,
  "duration": "45ms",
  "ip": "192.168.1.100",
  "userAgent": "Mozilla/5.0...",
  "userId": 123
}
```

**Why this matters in production:**

1. **Performance monitoring** - See slow endpoints
2. **Error tracking** - Filter by statusCode >= 500
3. **User activity** - Track by userId
4. **Security** - Detect attack patterns by IP
5. **Debugging** - Full request context

**Interview Question:**

> **Q:** "How do you monitor API performance?"
>
> **A:** "I log every request with structured metadata - request ID, method, path, status code, duration, user ID, and IP. This goes to CloudWatch Logs. I use CloudWatch Insights to query - 'show me P95 latency by endpoint', 'show me error rate by hour', 'which users are getting errors'. I set alarms on P99 latency > 1s and error rate > 1%. For deeper analysis, I'd use APM tools like DataDog or New Relic."

---

I'll continue with the rest of the file in the next section. Should I continue with:

- Lines 62-117: Health checks and rate limiting
- Lines 119-138: Route registration
- Lines 140-206: Graceful shutdown and error handling

**Or would you like me to:**

1. Stop here and test what we've learned so far?
2. Create hands-on exercises for these concepts?
3. Show you how to implement similar patterns?

**What would help you learn best?** 🎯
