# MODULE-5: SHARED UTILITIES DEEP DIVE

**The invisible infrastructure that powers everything!**

---

## What Are Shared Utilities?

```
Shared utilities = Foundation layer used by ALL services

Think of it as:
├─ Logger: Eyes (see what's happening)
├─ Errors: Language (communicate problems consistently)
├─ Redis: Short-term memory (cache, rate limits, blacklist)
└─ Database helpers: Long-term memory (transactions, queries)

Without these:
├─ Every service implements its own logger (inconsistent logs)
├─ Every service handles errors differently (chaos)
├─ Every service creates Redis connections (memory leak)
└─ Every service writes query helpers (code duplication)

With shared utilities:
├─ One logger, used everywhere (consistent logs)
├─ One error system, used everywhere (consistent responses)
├─ One Redis client, shared across services (efficient)
└─ One set of DB helpers, reused (DRY principle)

Result: Consistency + Maintainability + Efficiency ✅
```

**File Structure:**

```
shared/
├── logger.js                 # Winston logging configuration
├── redis.js                  # Redis client singleton
├── errors/
│   ├── index.js             # Custom error classes + handler
│   └── errorHandler.js      # Express error middleware
└── auth/
    ├── jwt.js               # JWT utilities (already covered in MODULE-3)
    ├── middleware.js        # Auth middleware (already covered in MODULE-3)
    ├── blacklist.js         # Token blacklist (already covered in MODULE-3)
    └── rateLimiter.js       # Rate limiting (already covered in MODULE-3)
```

---

# PART 1: Logger (Winston)

**File:** `shared/logger.js`

## Why Not console.log()?

```javascript
// ❌ Tutorial approach (console.log)
console.log('User logged in');
console.log('Error:', error);
console.log('Payment processed for user 123');

// Problems:
// 1. No timestamps → Can't tell WHEN things happened
// 2. No log levels → Can't filter errors from info
// 3. No structure → Can't search/query logs
// 4. No context → Can't trace requests across services
// 5. No persistence → Logs lost on server restart
// 6. No production support → Can't send to CloudWatch/DataDog
// 7. Goes to stdout → Mixed with other output

// ✅ Production approach (Winston)
logger.info('User logged in', {
  userId: 123,
  email: 'user@test.com',
  timestamp: '2026-08-03T10:15:30.123Z',
  requestId: '550e8400-e29b-41d4-a716-446655440000',
  service: 'user-service'
});

logger.error('Payment failed', {
  userId: 123,
  orderId: 456,
  error: error.message,
  stack: error.stack,
  requestId: '550e8400-...',
  timestamp: '2026-08-03T10:15:35.789Z'
});

// Benefits:
// ✅ Timestamps (know when)
// ✅ Log levels (filter by severity)
// ✅ Structured (JSON format, queryable)
// ✅ Context (requestId, userId, etc.)
// ✅ Persistent (saved to files)
// ✅ Production-ready (send to monitoring tools)
// ✅ Separate streams (stdout, files, CloudWatch)
```

---

## Complete Logger Implementation

```javascript
const winston = require('winston');
const path = require('path');

// Define log levels (RFC 5424)
const levels = {
  error: 0,   // Critical errors (crashes, data loss)
  warn: 1,    // Warning (degraded performance, deprecated API)
  info: 2,    // Informational (user logged in, order created)
  http: 3,    // HTTP requests
  debug: 4    // Debug information (detailed data, variables)
};

// Define log colors (for console)
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'blue'
};

winston.addColors(colors);

// Custom format for console (human-readable)
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf((info) => {
    const { timestamp, level, message, ...meta } = info;
    
    let log = `${timestamp} [${level}] ${message}`;
    
    // Add metadata if present
    if (Object.keys(meta).length > 0) {
      log += `\n${JSON.stringify(meta, null, 2)}`;
    }
    
    return log;
  })
);

// JSON format for files and production (machine-readable)
const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),  // Include stack traces
  winston.format.json()
);

// Create transports (where logs go)
const transports = [];

// 1. Console transport (development)
if (process.env.NODE_ENV !== 'production') {
  transports.push(
    new winston.transports.Console({
      format: consoleFormat,
      level: process.env.LOG_LEVEL || 'debug'
    })
  );
}

// 2. File transport (all logs)
transports.push(
  new winston.transports.File({
    filename: path.join(__dirname, '../logs/combined.log'),
    format: jsonFormat,
    level: 'info',
    maxsize: 10 * 1024 * 1024,  // 10MB
    maxFiles: 5,                 // Keep 5 files (50MB total)
    tailable: true               // New logs in newest file
  })
);

// 3. File transport (errors only)
transports.push(
  new winston.transports.File({
    filename: path.join(__dirname, '../logs/error.log'),
    format: jsonFormat,
    level: 'error',
    maxsize: 10 * 1024 * 1024,  // 10MB
    maxFiles: 5
  })
);

// 4. CloudWatch transport (production only)
if (process.env.NODE_ENV === 'production' && process.env.CLOUDWATCH_LOG_GROUP) {
  const CloudWatchTransport = require('winston-cloudwatch');
  
  transports.push(
    new CloudWatchTransport({
      logGroupName: process.env.CLOUDWATCH_LOG_GROUP,
      logStreamName: `${process.env.SERVICE_NAME || 'app'}-${new Date().toISOString().split('T')[0]}`,
      awsRegion: process.env.AWS_REGION || 'us-east-1',
      jsonMessage: true,
      level: 'info'
    })
  );
}

// Create logger instance
const logger = winston.createLogger({
  levels,
  transports,
  
  // Don't exit on error
  exitOnError: false,
  
  // Default metadata (added to all logs)
  defaultMeta: {
    service: process.env.SERVICE_NAME || 'app',
    environment: process.env.NODE_ENV || 'development',
    hostname: require('os').hostname(),
    pid: process.pid
  }
});

// Stream for Morgan (HTTP request logging)
logger.stream = {
  write: (message) => {
    logger.http(message.trim());
  }
};

module.exports = logger;
```

---

## Log Levels Explained

```javascript
const levels = {
  error: 0,   // Highest priority
  warn: 1,
  info: 2,
  http: 3,
  debug: 4    // Lowest priority
};

// How it works:
// If LOG_LEVEL=info:
//   error logs: ✅ Shown (0 <= 2)
//   warn logs:  ✅ Shown (1 <= 2)
//   info logs:  ✅ Shown (2 <= 2)
//   http logs:  ❌ Hidden (3 > 2)
//   debug logs: ❌ Hidden (4 > 2)

// If LOG_LEVEL=debug:
//   All logs shown ✅
```

**When to Use Each Level:**

```javascript
// ERROR: Something broke, needs immediate attention
logger.error('Database connection failed', {
  error: error.message,
  stack: error.stack,
  connectionString: '***'  // Don't log passwords!
});

// WARN: Something's not right, but system still works
logger.warn('Redis cache miss rate high', {
  missRate: 0.85,
  threshold: 0.5,
  recommendation: 'Consider increasing cache TTL'
});

// INFO: Important business events
logger.info('Order created', {
  orderId: 12345,
  userId: 67890,
  total: 99.99,
  items: 3
});

// HTTP: Request/response logging
logger.http('GET /api/users', {
  method: 'GET',
  path: '/api/users',
  statusCode: 200,
  duration: '45ms',
  ip: '192.168.1.1'
});

// DEBUG: Detailed debugging information
logger.debug('Cache lookup', {
  key: 'user:123',
  hit: true,
  ttl: 300
});
```

---

## Log Rotation (Why maxsize/maxFiles?)

```javascript
maxsize: 10 * 1024 * 1024,  // 10MB per file
maxFiles: 5                  // Keep 5 files

// Without rotation:
combined.log keeps growing forever
    ↓
After 1 month: 1GB
After 1 year: 12GB
After 5 years: 60GB
    ↓
Disk full! 💀
Server crashes!

// With rotation:
combined.log (current)      10MB
combined.log.1 (yesterday)  10MB
combined.log.2 (2 days ago) 10MB
combined.log.3 (3 days ago) 10MB
combined.log.4 (4 days ago) 10MB
    ↓
Total: 50MB (manageable)
    ↓
Oldest file deleted when new file created
```

**Production Best Practice:**

```javascript
// Don't rely on file rotation alone!
// Send logs to centralized system:

// Option 1: CloudWatch Logs (AWS)
// - Unlimited storage
// - Query with CloudWatch Insights
// - Alerts and dashboards
// - Retention policy (e.g., 30 days)

// Option 2: DataDog (APM platform)
// - Real-time monitoring
// - Advanced querying
// - Alerting
// - Trace correlation

// Option 3: Elasticsearch + Kibana (ELK Stack)
// - Self-hosted
// - Powerful search
// - Visualization
// - Free but requires infrastructure

// Files are backup/local development
// CloudWatch/DataDog is production source of truth
```

---

## Structured Logging (Why JSON?)

```javascript
// ❌ Unstructured (hard to query)
console.log('User 123 logged in from 192.168.1.1 at 10:15:30');

// How do you find:
// - All logs for user 123? (grep "user 123"? "User 123"?)
// - All logs from 192.168.1.1? (grep IP? What if also in other field?)
// - All logs between 10:00 and 11:00? (impossible!)

// ✅ Structured (easy to query)
logger.info('User logged in', {
  userId: 123,
  ip: '192.168.1.1',
  timestamp: '2026-08-03T10:15:30.123Z',
  userAgent: 'Mozilla/5.0...'
});

// CloudWatch Insights queries:
// All logs for user 123:
fields @timestamp, @message
| filter userId = 123

// All logs from IP:
fields @timestamp, @message
| filter ip = "192.168.1.1"

// All logs between 10:00 and 11:00:
fields @timestamp, @message
| filter @timestamp >= "2026-08-03T10:00:00" and @timestamp < "2026-08-03T11:00:00"

// Error rate by service:
fields @timestamp
| filter level = "error"
| stats count() by service

// P95 latency by endpoint:
fields @timestamp, duration
| filter level = "http"
| stats percentile(duration, 95) by path
```

---

## Security: Never Log Sensitive Data!

```javascript
// ❌ BAD (logs sensitive data)
logger.info('User logged in', {
  userId: 123,
  email: 'user@test.com',
  password: 'MyPassword123',  // 💀 PASSWORD IN LOGS!
  creditCard: '4111-1111-1111-1111',  // 💀 CREDIT CARD IN LOGS!
  ssn: '123-45-6789'  // 💀 SSN IN LOGS!
});

// If logs leaked:
// - Attacker has passwords
// - GDPR violation (€20M fine)
// - PCI DSS violation (lose ability to process cards)
// - Identity theft

// ✅ GOOD (redacts sensitive data)
logger.info('User logged in', {
  userId: 123,
  email: 'user@test.com',
  // No password logged!
  // No credit card logged!
  // No SSN logged!
});

// If payment info needed for debugging:
logger.info('Payment processed', {
  userId: 123,
  orderId: 456,
  cardLast4: '1111',  // Only last 4 digits
  cardBrand: 'Visa',
  amount: 99.99
});

// Sensitive data to NEVER log:
// - Passwords (plaintext or hashed)
// - Credit card numbers (full PAN)
// - CVV codes
// - SSN / national IDs
// - Private keys
// - API secrets
// - Session tokens (log jti/token ID instead)
// - Full database connection strings (mask password)
```

---

## Using Logger in Code

```javascript
const logger = require('../shared/logger');

// Basic usage
logger.info('Server started');
logger.error('Database error', { error: err.message });

// With request context
app.use((req, res, next) => {
  // Attach logger to request with context
  req.logger = logger.child({
    requestId: req.id,
    userId: req.user?.userId,
    ip: req.ip
  });
  
  next();
});

// In route handlers
app.get('/api/users/:id', async (req, res) => {
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

// Benefits of req.logger.child():
// All logs from this request automatically include:
// - requestId
// - userId
// - ip
// Can trace entire request flow!
```

---

# PART 2: Error Handling

**File:** `shared/errors/index.js`

## Why Custom Error Classes?

```javascript
// ❌ Without custom errors (inconsistent)
if (!user) {
  throw new Error('User not found');  // Generic Error
}

if (!email) {
  throw new Error('Email required');  // Same class, different meaning
}

if (password.length < 8) {
  throw new Error('Password too short');  // Same class, different meaning
}

// Problem: All are Error class
// Can't distinguish validation error from database error from auth error
// Can't map to appropriate HTTP status code

// ✅ With custom errors (consistent)
if (!user) {
  throw new NotFoundError('User not found');  // 404
}

if (!email) {
  throw new ValidationError('Email required');  // 400
}

if (password.length < 8) {
  throw new ValidationError('Password too short');  // 400
}

// Benefits:
// ✅ Error type indicates meaning
// ✅ Automatic HTTP status code mapping
// ✅ Consistent error responses
// ✅ Easy to catch specific errors
```

---

## Complete Error Classes

```javascript
/**
 * Base error class
 * All custom errors extend this
 */
class BaseError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;  // vs programming errors (bugs)
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 400 Bad Request
 * Invalid input data
 */
class ValidationError extends BaseError {
  constructor(message, code = 'VALIDATION_ERROR') {
    super(message, 400, code);
  }
}

/**
 * 401 Unauthorized
 * Not authenticated
 */
class UnauthorizedError extends BaseError {
  constructor(message = 'Authentication required', code = 'UNAUTHORIZED') {
    super(message, 401, code);
  }
}

/**
 * 403 Forbidden
 * Authenticated but not authorized
 */
class ForbiddenError extends BaseError {
  constructor(message = 'Access denied', code = 'FORBIDDEN') {
    super(message, 403, code);
  }
}

/**
 * 404 Not Found
 * Resource doesn't exist
 */
class NotFoundError extends BaseError {
  constructor(message = 'Resource not found', code = 'NOT_FOUND') {
    super(message, 404, code);
  }
}

/**
 * 409 Conflict
 * Resource already exists
 */
class ConflictError extends BaseError {
  constructor(message = 'Resource already exists', code = 'CONFLICT') {
    super(message, 409, code);
  }
}

/**
 * 429 Too Many Requests
 * Rate limit exceeded
 */
class RateLimitError extends BaseError {
  constructor(message = 'Too many requests', code = 'RATE_LIMIT_EXCEEDED') {
    super(message, 429, code);
  }
}

/**
 * 500 Internal Server Error
 * Unexpected server error
 */
class InternalError extends BaseError {
  constructor(message = 'Internal server error', code = 'INTERNAL_ERROR') {
    super(message, 500, code);
  }
}

/**
 * 503 Service Unavailable
 * Service temporarily down
 */
class ServiceUnavailableError extends BaseError {
  constructor(message = 'Service temporarily unavailable', code = 'SERVICE_UNAVAILABLE') {
    super(message, 503, code);
  }
}

module.exports = {
  BaseError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  InternalError,
  ServiceUnavailableError
};
```

---

## Error Handler Middleware

**File:** `shared/errors/errorHandler.js`

```javascript
const logger = require('../logger');

/**
 * Global error handler
 * Catches all errors and formats consistent response
 */
function errorHandler(err, req, res, next) {
  // Log error with context
  logger.error('Request error', {
    requestId: req.id,
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    userId: req.user?.userId,
    ip: req.ip,
    userAgent: req.get('user-agent')
  });
  
  // Determine status code
  const statusCode = err.statusCode || 500;
  
  // Determine error code
  const errorCode = err.code || 'INTERNAL_ERROR';
  
  // Sanitize error message for production
  let message = err.message;
  
  if (statusCode === 500 && process.env.NODE_ENV === 'production') {
    // Don't expose internal errors to client
    message = 'Internal server error';
  }
  
  // Build error response
  const errorResponse = {
    success: false,
    error: {
      message,
      code: errorCode,
      requestId: req.id
    }
  };
  
  // Include stack trace in development
  if (process.env.NODE_ENV === 'development') {
    errorResponse.error.stack = err.stack;
  }
  
  // Send response
  res.status(statusCode).json(errorResponse);
}

/**
 * 404 handler (no route matched)
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: {
      message: 'Endpoint not found',
      code: 'NOT_FOUND',
      path: req.path,
      requestId: req.id
    }
  });
}

module.exports = {
  errorHandler,
  notFoundHandler
};
```

---

## Error Handler Flow

```javascript
// Request comes in
POST /api/auth/register
Body: { email: "invalid-email", password: "short" }
    ↓
Validation middleware:
if (!emailRegex.test(email)) {
  throw new ValidationError('Invalid email format');
}
    ↓
Error thrown!
    ↓
Express catches error
Calls errorHandler(err, req, res, next)
    ↓
errorHandler:
1. Log error with full context ✅
2. Determine status code: 400 (from ValidationError)
3. Determine error code: 'VALIDATION_ERROR'
4. Sanitize message (no change, not 500)
5. Build response:
   {
     success: false,
     error: {
       message: 'Invalid email format',
       code: 'VALIDATION_ERROR',
       requestId: '550e8400-...'
     }
   }
6. Send 400 response ✅
    ↓
Client receives consistent error format ✅
```

---

## Operational vs Programming Errors

```javascript
// OPERATIONAL ERRORS (expected, handle gracefully):
class ValidationError extends BaseError {
  isOperational: true  // Expected error
}

// Examples:
// - Invalid user input (validation error)
// - User not found (not found error)
// - Duplicate email (conflict error)
// - Database connection timeout (service unavailable)
// - Rate limit exceeded (too many requests)

// Handle: Catch, log, return appropriate response

// PROGRAMMING ERRORS (bugs, crash):
// - ReferenceError: undefined variable
// - TypeError: calling function on undefined
// - Syntax errors
// - Infinite loop
// - Memory leak

// Handle: Crash, restart, fix bug

// In error handler:
function errorHandler(err, req, res, next) {
  if (err.isOperational) {
    // Expected error, handle gracefully
    res.status(err.statusCode).json({
      success: false,
      error: { message: err.message, code: err.code }
    });
  } else {
    // Programming error (bug)
    logger.error('Programming error (bug):', {
      error: err.message,
      stack: err.stack
    });
    
    // Return generic error (don't expose bug details)
    res.status(500).json({
      success: false,
      error: {
        message: 'Internal server error',
        code: 'INTERNAL_ERROR'
      }
    });
    
    // In production: Crash and let process manager restart
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }
}
```

---

## Using Errors in Code

```javascript
const {
  ValidationError,
  NotFoundError,
  ConflictError,
  UnauthorizedError
} = require('../shared/errors');

// In controllers:
async function register(req, res, next) {
  try {
    const { email, password } = req.body;
    
    // Validation error (400)
    if (!email) {
      throw new ValidationError('Email is required');
    }
    
    // Check existing user
    const existing = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    
    // Conflict error (409)
    if (existing.rows.length > 0) {
      throw new ConflictError('Email already registered');
    }
    
    // Create user
    const user = await db.query('INSERT INTO users ...');
    
    res.status(201).json({ success: true, data: { user } });
    
  } catch (error) {
    next(error);  // Pass to error handler
  }
}

// In middleware:
function authenticate(req, res, next) {
  const token = extractToken(req);
  
  // Unauthorized error (401)
  if (!token) {
    throw new UnauthorizedError('Authentication required', 'NO_TOKEN');
  }
  
  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    throw new UnauthorizedError('Invalid token', 'INVALID_TOKEN');
  }
}

// Error handler catches all:
app.use(errorHandler);
```

---

# PART 3: Redis Client

**File:** `shared/redis.js`

## Why Singleton Pattern?

```javascript
// ❌ WITHOUT singleton (bad)
// File 1:
const redis = require('redis');
const client1 = redis.createClient();

// File 2:
const redis = require('redis');
const client2 = redis.createClient();

// File 3:
const redis = require('redis');
const client3 = redis.createClient();

// Result: 3 separate connections!
// - Wastes memory
// - Wastes connections (Redis has max_clients limit)
// - Each connection has overhead

// ✅ WITH singleton (good)
// File 1:
const redisClient = require('../shared/redis');

// File 2:
const redisClient = require('../shared/redis');

// File 3:
const redisClient = require('../shared/redis');

// Result: Same connection reused!
// - One connection
// - Shared across entire application
// - Efficient ✅
```

---

## Complete Redis Client

```javascript
const redis = require('redis');
const logger = require('./logger');

// Create Redis client (singleton)
const redisClient = redis.createClient({
  socket: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    
    // Reconnection strategy
    reconnectStrategy: (retries) => {
      // Exponential backoff: 100ms, 200ms, 400ms, 800ms, ...
      const delay = Math.min(retries * 100, 3000);
      
      logger.info('Redis reconnecting', {
        attempt: retries,
        delay: `${delay}ms`
      });
      
      // Stop after 10 retries
      if (retries > 10) {
        logger.error('Redis max retries exceeded');
        return new Error('Redis max retries exceeded');
      }
      
      return delay;
    },
    
    // Connection timeout
    connectTimeout: 10000  // 10 seconds
  },
  
  // Password (if Redis AUTH enabled)
  password: process.env.REDIS_PASSWORD,
  
  // Database index (0-15)
  database: process.env.REDIS_DB || 0,
  
  // Retry strategy for commands
  commandsTimeout: 5000  // Fail command after 5 seconds
});

// Connection event handlers
redisClient.on('connect', () => {
  logger.info('Redis connecting');
});

redisClient.on('ready', () => {
  logger.info('Redis ready');
});

redisClient.on('error', (err) => {
  logger.error('Redis error', {
    error: err.message,
    stack: err.stack
  });
});

redisClient.on('reconnecting', () => {
  logger.warn('Redis reconnecting');
});

redisClient.on('end', () => {
  logger.info('Redis connection closed');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing Redis connection');
  await redisClient.disconnect();
});

module.exports = redisClient;
```

---

## Redis Connection States

```javascript
// State machine:
DISCONNECTED → CONNECTING → READY → DISCONNECTED
                    ↓           ↓
                  ERROR    RECONNECTING

// DISCONNECTED: No connection
// CONNECTING: Attempting connection
// READY: Connected and ready for commands
// ERROR: Connection error occurred
// RECONNECTING: Attempting to reconnect
```

**Reconnection Strategy:**

```javascript
reconnectStrategy: (retries) => {
  const delay = Math.min(retries * 100, 3000);
  if (retries > 10) return new Error('Max retries');
  return delay;
}

// Timeline:
Retry 1: 100ms delay
Retry 2: 200ms delay
Retry 3: 300ms delay
...
Retry 10: 1000ms delay
Retry 11: Gives up ❌

// Why exponential backoff?
// Fixed delay (e.g., always 1 second):
// - Hammer Redis with reconnection attempts
// - Doesn't give Redis time to recover

// Exponential backoff:
// - Start fast (100ms) - if temporary issue, reconnect quickly
// - Slow down gradually - if persistent issue, don't hammer
// - Give up eventually - if Redis dead, fail fast
```

---

## Common Redis Operations

```javascript
const redisClient = require('../shared/redis');

// Connect (call once on startup)
await redisClient.connect();

// SET (store value)
await redisClient.set('key', 'value');

// SET with TTL (expires after N seconds)
await redisClient.setEx('key', 60, 'value');  // Expires in 60 seconds

// GET (retrieve value)
const value = await redisClient.get('key');

// DELETE (remove key)
await redisClient.del('key');

// EXISTS (check if key exists)
const exists = await redisClient.exists('key');  // 1 if exists, 0 if not

// INCR (increment number)
await redisClient.incr('counter');  // Atomic increment

// EXPIRE (set TTL on existing key)
await redisClient.expire('key', 60);

// TTL (check time until expiry)
const ttl = await redisClient.ttl('key');  // Seconds, -1 if no TTL, -2 if not exists

// PING (check connection)
const pong = await redisClient.ping();  // Returns 'PONG'

// Disconnect (call on shutdown)
await redisClient.disconnect();
```

---

## Redis Use Cases in Our App

```javascript
// 1. Token Blacklist
await redisClient.setEx(`blacklist:${jti}`, expiresIn, 'revoked');
const isBlacklisted = await redisClient.get(`blacklist:${jti}`);

// 2. Rate Limiting
await redisClient.incr(`ratelimit:${ip}`);
await redisClient.expire(`ratelimit:${ip}`, 900);  // 15 minutes

// 3. Session Storage (alternative to database)
await redisClient.setEx(`session:${sessionId}`, 3600, JSON.stringify(sessionData));
const session = JSON.parse(await redisClient.get(`session:${sessionId}`));

// 4. Caching (reduce database load)
// Try cache first
let user = await redisClient.get(`user:${userId}`);
if (user) {
  return JSON.parse(user);
}

// Cache miss - query database
user = await db.query('SELECT * FROM users WHERE id = $1', [userId]);

// Store in cache (5 minutes)
await redisClient.setEx(`user:${userId}`, 300, JSON.stringify(user));

return user;

// 5. Pub/Sub (real-time events)
// Publisher:
await redisClient.publish('orders', JSON.stringify({ orderId: 123, event: 'created' }));

// Subscriber:
const subscriber = redisClient.duplicate();
await subscriber.connect();
await subscriber.subscribe('orders', (message) => {
  const order = JSON.parse(message);
  console.log('New order:', order);
});
```

---

## Redis Performance

```javascript
// Speed comparison:
Database query: 10-50ms
Redis query: 1-2ms

// Example: User profile endpoint
// Without cache:
GET /api/users/123
    ↓
Query database: 15ms
    ↓
Total: 15ms

// With cache:
GET /api/users/123
    ↓
Query Redis: 1ms (cache hit)
    ↓
Total: 1ms

// 15x faster! ✅

// Cache invalidation:
// When user updates profile:
await db.query('UPDATE users SET first_name = $1 WHERE id = $2', [firstName, userId]);
await redisClient.del(`user:${userId}`);  // Invalidate cache

// Next request:
// Cache miss → Query database → Store in cache
// Subsequent requests: Cache hit ✅
```

---

**MODULE-5 Part 1 Complete!**

You now understand:
✅ **Logger** - Winston configuration, log levels, structured logging, security
✅ **Errors** - Custom error classes, error handler middleware, operational vs programming errors
✅ **Redis** - Singleton pattern, reconnection strategy, common operations, use cases

**Next: Part 2 will cover:**
- Interview Q&A for each utility
- Tutorial vs Production comparisons
- Testing strategies
- Best practices and gotchas

Ready for Part 2? 🚀
