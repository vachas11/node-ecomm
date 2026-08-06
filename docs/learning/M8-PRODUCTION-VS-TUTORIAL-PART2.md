# PRODUCTION VS TUTORIAL - PART 2

**Error Handling, Configuration, Logging, Database, Performance, and Testing**

---

# CATEGORY 2: Error Handling

## 11. Global Error Handler

### ❌ Tutorial Approach

```javascript
app.post('/api/users', async (req, res) => {
  try {
    const user = await createUser(req.body);
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const order = await createOrder(req.body);
    res.json({ order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Every route has duplicate try/catch!
```

**Problems:**
- Duplicated error handling
- Inconsistent error format
- Missing error logging
- Can't distinguish error types
- Hard to maintain

### ✅ Production Approach

```javascript
// Custom error classes
class BaseError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
  }
}

class ValidationError extends BaseError {
  constructor(message) {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

class NotFoundError extends BaseError {
  constructor(message) {
    super(message, 404, 'NOT_FOUND');
  }
}

// Controllers throw errors (no try/catch needed!)
app.post('/api/users', async (req, res) => {
  const user = await createUser(req.body);  // Throws on error
  res.json({ user });
});

// Global error handler (single place!)
app.use((err, req, res, next) => {
  // Log error
  logger.error('Request failed', {
    error: err.message,
    stack: err.stack,
    requestId: req.id,
    url: req.originalUrl,
    method: req.method
  });
  
  // Operational errors (expected)
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        message: err.message,
        code: err.code,
        requestId: req.id
      }
    });
  }
  
  // Programming errors (bugs)
  res.status(500).json({
    success: false,
    error: {
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
      requestId: req.id
    }
  });
});
```

**Benefits:**
- Single error handler
- Consistent error format
- Automatic logging
- Error type distinction
- Easy to maintain

### 🎯 Why It Matters

**Interview question:**
> "What's the difference between operational and programming errors?"

**Perfect answer:**
> "Operational errors are expected failures we handle gracefully - invalid input, network timeout, database unavailable. Programming errors are bugs - accessing undefined property, wrong argument type. Operational errors: log and return user-friendly message. Programming errors: log, alert team, restart process. Never expose programming error details to users - security risk."

---

## 12. Async Error Handling

### ❌ Tutorial Approach

```javascript
// Async errors not caught!
app.get('/users', async (req, res) => {
  const users = await db.query('SELECT * FROM users');
  res.json({ users });
  // If query fails, error is UNHANDLED!
  // Server crashes
});
```

**What happens:**
```bash
$ node server.js
Server running on port 3000

UnhandledPromiseRejectionWarning: Error: Connection refused
    at Database.query (/app/db.js:42:15)
(node:1234) UnhandledPromiseRejectionWarning: Unhandled promise rejection.
This error originated either by throwing inside of an async function without
a catch block, or by rejecting a promise which was not handled with .catch().

# Server keeps running but is in unstable state
# Future requests may behave unexpectedly
# In Node 16+: Process exits
```

### ✅ Production Approach

**Option 1: express-async-errors (automatic)**
```javascript
require('express-async-errors');  // Import at top of file

app.get('/users', async (req, res) => {
  const users = await db.query('SELECT * FROM users');
  res.json({ users });
  // Errors automatically caught and sent to error handler!
});
```

**Option 2: Wrap async handlers**
```javascript
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

app.get('/users', asyncHandler(async (req, res) => {
  const users = await db.query('SELECT * FROM users');
  res.json({ users });
}));
```

**Option 3: Try/catch with next()**
```javascript
app.get('/users', async (req, res, next) => {
  try {
    const users = await db.query('SELECT * FROM users');
    res.json({ users });
  } catch (err) {
    next(err);  // Pass to error handler
  }
});
```

**Also: Catch unhandled rejections**
```javascript
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection', {
    reason,
    promise
  });
  
  // Graceful shutdown
  server.close(() => {
    process.exit(1);
  });
});
```

---

## 13. Error Logging

### ❌ Tutorial Approach

```javascript
try {
  await someOperation();
} catch (err) {
  console.log('Error:', err);  // ❌ Lost when process exits
  // ❌ Not queryable
  // ❌ No context
  // ❌ No alerting
}
```

### ✅ Production Approach

```javascript
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'user-service' },
  transports: [
    // File transport
    new winston.transports.File({
      filename: 'error.log',
      level: 'error',
      maxsize: 10 * 1024 * 1024,  // 10MB
      maxFiles: 5
    }),
    
    // CloudWatch transport (production)
    new WinstonCloudWatch({
      logGroupName: '/app/user-service',
      logStreamName: process.env.HOSTNAME,
      awsRegion: 'us-east-1'
    }),
    
    // Sentry transport (error tracking)
    new Sentry.Transports.Winston({
      sentry: {
        dsn: process.env.SENTRY_DSN
      },
      level: 'error'
    })
  ]
});

// Usage
try {
  await someOperation();
} catch (err) {
  logger.error('Operation failed', {
    error: err.message,
    stack: err.stack,
    userId: req.user?.userId,
    requestId: req.id,
    metadata: {
      operation: 'someOperation',
      params: { ... }
    }
  });
  throw err;
}
```

**Benefits:**
- Logs persisted to files
- Searchable in CloudWatch
- Error tracking in Sentry
- Rich context (user, request)
- Automatic alerting

---

## 14. Graceful Degradation

### ❌ Tutorial Approach

```javascript
// Redis required - fail if unavailable
const redis = require('redis').createClient();

redis.on('error', (err) => {
  console.log('Redis error:', err);
  process.exit(1);  // ❌ Entire service down!
});

// Check blacklist
const isBlacklisted = await redis.get(`blacklist:${token}`);
if (isBlacklisted) {
  throw new UnauthorizedError('Token revoked');
}
```

### ✅ Production Approach

```javascript
// Fail open for non-critical features
async function checkBlacklist(token) {
  try {
    const isBlacklisted = await redis.get(`blacklist:${token}`);
    return isBlacklisted === 'true';
  } catch (err) {
    // Redis down, log but don't fail
    logger.warn('Blacklist check failed, allowing request', {
      error: err.message,
      token: token.substring(0, 10) + '...'
    });
    
    // Alert team
    alerting.notify('Redis unavailable', {
      service: 'user-service',
      severity: 'warning'
    });
    
    // Fail open (availability > security for this check)
    return false;
  }
}

// Usage
const isBlacklisted = await checkBlacklist(token);
if (isBlacklisted) {
  throw new UnauthorizedError('Token revoked');
}
// If Redis down, allow request (user can still access system)
```

**When to fail closed vs fail open:**

**Fail closed (security-critical):**
- Payment processing
- Admin access
- Data deletion
- Security controls

**Fail open (availability-critical):**
- Rate limiting
- Analytics
- Caching
- Non-critical features

---

## 15. Circuit Breaker for External Services

### ❌ Tutorial Approach

```javascript
// Call external API directly
app.post('/api/send-email', async (req, res) => {
  try {
    await axios.post('https://email-service.com/send', {
      to: req.body.email,
      subject: 'Welcome',
      body: 'Hello!'
    }, { timeout: 30000 });
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send email' });
  }
});

// Problems:
// - Every request waits 30 seconds if service down
// - 100 concurrent requests = 100 hanging connections
// - Gateway times out waiting for User Service
// - Cascade failure!
```

### ✅ Production Approach

```javascript
const CircuitBreaker = require('opossum');

// Create circuit breaker
const emailBreaker = new CircuitBreaker(async (email, subject, body) => {
  return await axios.post('https://email-service.com/send', {
    to: email,
    subject,
    body
  }, { timeout: 5000 });  // Short timeout
}, {
  timeout: 5000,           // Operation timeout
  errorThresholdPercentage: 50,  // Open after 50% failures
  resetTimeout: 30000,     // Try again after 30 seconds
  volumeThreshold: 5       // Need 5 requests before opening
});

// Fallback
emailBreaker.fallback((email) => {
  // Queue email for later
  emailQueue.add({ email, subject, body });
  return { queued: true };
});

// Events
emailBreaker.on('open', () => {
  logger.warn('Email circuit breaker opened');
  alerting.notify('Email service down');
});

emailBreaker.on('halfOpen', () => {
  logger.info('Email circuit breaker testing recovery');
});

emailBreaker.on('close', () => {
  logger.info('Email circuit breaker closed');
});

// Usage
app.post('/api/send-email', async (req, res) => {
  try {
    const result = await emailBreaker.fire(
      req.body.email,
      'Welcome',
      'Hello!'
    );
    
    if (result.queued) {
      res.json({
        success: true,
        message: 'Email queued for sending'
      });
    } else {
      res.json({
        success: true,
        message: 'Email sent'
      });
    }
  } catch (err) {
    res.status(503).json({
      success: false,
      error: 'Email service temporarily unavailable'
    });
  }
});
```

**Benefits:**
- Fail fast when service down (5ms vs 30s)
- Automatic recovery testing
- Fallback strategy (queue)
- Monitoring and alerting
- Prevents cascade failures

---

## 16. Retry Strategy

### ❌ Tutorial Approach

```javascript
// Single attempt, fail immediately
try {
  await externalAPI.call();
} catch (err) {
  throw err;  // ❌ No retry
}
```

### ✅ Production Approach

```javascript
const retry = require('async-retry');

async function callExternalAPI() {
  return await retry(
    async (bail) => {
      try {
        return await externalAPI.call();
      } catch (err) {
        // Don't retry client errors (4xx)
        if (err.response?.status >= 400 && err.response?.status < 500) {
          bail(err);  // Stop retrying
          return;
        }
        
        // Retry server errors (5xx) and network errors
        throw err;
      }
    },
    {
      retries: 3,           // Try 3 times
      minTimeout: 100,      // Start with 100ms
      maxTimeout: 2000,     // Max 2 seconds
      factor: 2,            // Exponential: 100ms, 200ms, 400ms
      randomize: true,      // Add jitter (prevent thundering herd)
      onRetry: (err, attempt) => {
        logger.warn('API call failed, retrying', {
          error: err.message,
          attempt,
          maxAttempts: 3
        });
      }
    }
  );
}
```

**Retry timeline:**
```
Attempt 1: 0ms (immediate)
├─ Fails
Attempt 2: 100ms ± jitter (50-150ms)
├─ Fails  
Attempt 3: 200ms ± jitter (100-300ms)
├─ Fails
Attempt 4: 400ms ± jitter (200-600ms)
└─ Final attempt

Total: ~700ms vs 30s timeout
```

---

## 17. Timeout Configuration

### ❌ Tutorial Approach

```javascript
// No timeouts!
const result = await axios.get('https://slow-api.com/data');
// Hangs forever if API is slow
```

### ✅ Production Approach

```javascript
// Different timeouts for different operations
const timeouts = {
  database: 5000,      // 5 seconds (should be fast)
  cache: 1000,         // 1 second (should be very fast)
  externalAPI: 10000,  // 10 seconds (can be slow)
  internalAPI: 5000    // 5 seconds (should be fast)
};

// Database query with timeout
const result = await Promise.race([
  db.query('SELECT * FROM users'),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Query timeout')), timeouts.database)
  )
]);

// HTTP request with timeout
const response = await axios.get('https://api.example.com/data', {
  timeout: timeouts.externalAPI,
  signal: AbortSignal.timeout(timeouts.externalAPI)  // Also abort underlying socket
});

// Custom async operation with timeout
async function withTimeout(promise, ms, operation) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`${operation} timeout after ${ms}ms`)), ms)
  );
  
  return Promise.race([promise, timeout]);
}

// Usage
await withTimeout(
  processLargeFile(file),
  60000,  // 1 minute
  'File processing'
);
```

---

## 18. Health Checks

### ❌ Tutorial Approach

```javascript
// No health check
// Or simple health check:
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
  // ❌ Doesn't check dependencies!
});
```

### ✅ Production Approach

```javascript
app.get('/health', async (req, res) => {
  const checks = {
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    
    // Check database
    database: await (async () => {
      try {
        await db.query('SELECT 1');
        return { status: 'connected' };
      } catch (err) {
        return { status: 'disconnected', error: err.message };
      }
    })(),
    
    // Check Redis
    redis: await (async () => {
      try {
        await redis.ping();
        return { status: 'connected' };
      } catch (err) {
        return { status: 'disconnected', error: err.message };
      }
    })(),
    
    // Check external services
    services: await Promise.allSettled([
      checkService('email-service', 'https://email.api.com/health'),
      checkService('payment-service', 'https://payment.api.com/health')
    ]).then(results => results.map((r, i) => ({
      name: ['email-service', 'payment-service'][i],
      status: r.status === 'fulfilled' ? 'healthy' : 'unhealthy',
      error: r.reason?.message
    })))
  };
  
  // Determine overall status
  const isHealthy = 
    checks.database.status === 'connected' &&
    checks.redis.status === 'connected';
  
  const statusCode = isHealthy ? 200 : 503;
  
  res.status(statusCode).json({
    status: isHealthy ? 'healthy' : 'degraded',
    checks
  });
});

async function checkService(name, url) {
  const response = await axios.get(url, { timeout: 2000 });
  if (response.status !== 200) {
    throw new Error(`${name} returned ${response.status}`);
  }
  return response.data;
}
```

**Benefits:**
- Load balancer knows when instance unhealthy
- Kubernetes can restart unhealthy pods
- Monitoring can alert on degraded state
- Debugging easier (see what's failing)

---

# CATEGORY 3: Configuration

## 19. Environment Configuration

### ❌ Tutorial Approach

```javascript
// Hardcoded configuration
const config = {
  port: 3000,
  dbHost: 'localhost',
  dbName: 'myapp',
  nodeEnv: 'development',
  logLevel: 'debug'
};

// Same config for all environments!
```

### ✅ Production Approach

```javascript
require('dotenv').config();

const config = {
  // Server
  port: parseInt(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // Database
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    name: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true',
    pool: {
      min: parseInt(process.env.DB_POOL_MIN) || 5,
      max: parseInt(process.env.DB_POOL_MAX) || 20
    }
  },
  
  // Redis
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD,
    tls: process.env.REDIS_TLS === 'true'
  },
  
  // JWT
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d'
  },
  
  // Logging
  logging: {
    level: process.env.LOG_LEVEL || (config.nodeEnv === 'production' ? 'info' : 'debug'),
    cloudwatch: process.env.CLOUDWATCH_ENABLED === 'true'
  }
};

// Validation
const requiredVars = [
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET'
];

const missing = requiredVars.filter(v => !process.env[v]);
if (missing.length > 0) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

// Secret validation
if (config.jwt.accessSecret.length < 32) {
  throw new Error('JWT_ACCESS_SECRET must be at least 32 characters');
}

module.exports = config;
```

**Different .env files per environment:**
```bash
# .env.development
NODE_ENV=development
PORT=3000
DB_HOST=localhost
DB_NAME=myapp_dev
LOG_LEVEL=debug

# .env.staging
NODE_ENV=staging
PORT=3000
DB_HOST=staging-db.internal
DB_NAME=myapp_staging
LOG_LEVEL=info

# .env.production
NODE_ENV=production
PORT=3000
DB_HOST=prod-db.internal
DB_NAME=myapp_prod
LOG_LEVEL=warn
CLOUDWATCH_ENABLED=true
```

---

## 20. Feature Flags

### ❌ Tutorial Approach

```javascript
// Deploy new feature to all users at once
app.post('/api/orders', async (req, res) => {
  // New payment flow (risky!)
  await newPaymentProcessor(req.body);
  res.json({ success: true });
});
```

### ✅ Production Approach

```javascript
const featureFlags = {
  newPaymentProcessor: process.env.FEATURE_NEW_PAYMENT === 'true',
  experimentalCache: process.env.FEATURE_EXPERIMENTAL_CACHE === 'true'
};

// Or use LaunchDarkly/GrowthBook
const ld = require('launchdarkly-node-server-sdk');
const ldClient = ld.init(process.env.LAUNCHDARKLY_SDK_KEY);

app.post('/api/orders', async (req, res) => {
  // Check feature flag
  const useNewPayment = await ldClient.variation(
    'new-payment-processor',
    { key: req.user.userId },
    false  // Default to false
  );
  
  if (useNewPayment) {
    await newPaymentProcessor(req.body);
  } else {
    await oldPaymentProcessor(req.body);
  }
  
  res.json({ success: true });
});
```

**Benefits:**
- Gradual rollout (1% → 10% → 50% → 100%)
- A/B testing
- Quick rollback (toggle flag, no deploy)
- User targeting (beta users, premium users)
- Kill switch for broken features

---

## 21. Multi-environment Configuration

### ❌ Tutorial Approach

```javascript
if (process.env.NODE_ENV === 'production') {
  // Production config
} else {
  // Development config
}

// Scattered throughout codebase!
```

### ✅ Production Approach

```javascript
// config/index.js
const environments = {
  development: require('./development'),
  staging: require('./staging'),
  production: require('./production')
};

const env = process.env.NODE_ENV || 'development';
const config = environments[env];

module.exports = config;

// config/development.js
module.exports = {
  database: {
    host: 'localhost',
    logging: true  // SQL query logging
  },
  logging: {
    level: 'debug'
  },
  cache: {
    ttl: 60  // 1 minute (for testing)
  }
};

// config/production.js
module.exports = {
  database: {
    host: process.env.DB_HOST,
    logging: false  // No SQL logging
  },
  logging: {
    level: 'warn',  // Only warnings/errors
    cloudwatch: true
  },
  cache: {
    ttl: 3600  // 1 hour
  }
};
```

---

## 22. Configuration Schema Validation

### ❌ Tutorial Approach

```javascript
// No validation
const port = process.env.PORT;
const maxConnections = process.env.MAX_CONNECTIONS;

// Runtime error if PORT is not a number!
app.listen(port);  // NaN
```

### ✅ Production Approach

```javascript
const Joi = require('joi');

const configSchema = Joi.object({
  port: Joi.number().port().required(),
  nodeEnv: Joi.string().valid('development', 'staging', 'production').required(),
  
  database: Joi.object({
    host: Joi.string().hostname().required(),
    port: Joi.number().port().required(),
    name: Joi.string().required(),
    user: Joi.string().required(),
    password: Joi.string().min(8).required()
  }).required(),
  
  jwt: Joi.object({
    accessSecret: Joi.string().min(32).required(),
    refreshSecret: Joi.string().min(32).required(),
    accessExpiry: Joi.string().pattern(/^\d+[mhd]$/).required(),
    refreshExpiry: Joi.string().pattern(/^\d+[mhd]$/).required()
  }).required()
});

// Validate at startup
const { error, value } = configSchema.validate(config, {
  abortEarly: false
});

if (error) {
  console.error('Configuration validation failed:');
  error.details.forEach(err => {
    console.error(`  - ${err.path.join('.')}: ${err.message}`);
  });
  process.exit(1);
}

module.exports = value;
```

---

## 23. Centralized Configuration Management

### ❌ Tutorial Approach

```javascript
// Environment variables scattered in code
const dbHost = process.env.DB_HOST;
const dbPort = process.env.DB_PORT;
// ... everywhere in codebase
```

### ✅ Production Approach

**AWS Systems Manager Parameter Store:**
```javascript
const AWS = require('aws-sdk');
const ssm = new AWS.SSM();

async function loadConfig() {
  const params = await ssm.getParametersByPath({
    Path: '/myapp/production',
    Recursive: true,
    WithDecryption: true
  }).promise();
  
  return params.Parameters.reduce((config, param) => {
    const key = param.Name.replace('/myapp/production/', '');
    config[key] = param.Value;
    return config;
  }, {});
}

// Cache config
let configCache = null;

async function getConfig() {
  if (!configCache) {
    configCache = await loadConfig();
  }
  return configCache;
}
```

**Benefits:**
- Centralized secret management
- Encrypted at rest
- Access control (IAM)
- Audit trail (who accessed what)
- Version history
- No secrets in code/env files

---

## 24. Configuration Hot Reload

### ❌ Tutorial Approach

```javascript
// Config loaded once at startup
const config = require('./config');

// Change requires restart!
```

### ✅ Production Approach

```javascript
class ConfigManager {
  constructor() {
    this.config = {};
    this.watchers = [];
  }
  
  async load() {
    this.config = await loadConfigFromStore();
  }
  
  get(key) {
    return this.config[key];
  }
  
  watch(key, callback) {
    this.watchers.push({ key, callback });
  }
  
  async reload() {
    const newConfig = await loadConfigFromStore();
    
    // Check what changed
    Object.keys(newConfig).forEach(key => {
      if (newConfig[key] !== this.config[key]) {
        // Notify watchers
        this.watchers
          .filter(w => w.key === key)
          .forEach(w => w.callback(newConfig[key]));
      }
    });
    
    this.config = newConfig;
  }
}

const configManager = new ConfigManager();

// Reload every 5 minutes
setInterval(() => configManager.reload(), 5 * 60 * 1000);

// Watch for feature flag changes
configManager.watch('featureNewUI', (value) => {
  logger.info('Feature flag changed', { featureNewUI: value });
});
```

---

# CATEGORY 4: Logging & Monitoring

## 25. Structured Logging

### ❌ Tutorial Approach

```javascript
console.log('User login');
console.log('User:', user.email);
console.log('IP:', req.ip);
console.log('Time:', new Date());

// Problems:
// - Not machine-readable
// - Hard to search
// - No correlation
// - No log levels
```

### ✅ Production Approach

```javascript
const logger = require('./logger');

logger.info('User login', {
  userId: user.id,
  email: user.email,
  ip: req.ip,
  userAgent: req.get('user-agent'),
  requestId: req.id,
  timestamp: new Date().toISOString()
});

// Output (JSON):
{
  "level": "info",
  "message": "User login",
  "userId": 123,
  "email": "john@example.com",
  "ip": "192.168.1.1",
  "userAgent": "Mozilla/5.0...",
  "requestId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "timestamp": "2026-08-03T10:30:00.123Z",
  "service": "user-service",
  "environment": "production",
  "hostname": "server-01"
}
```

**Benefits:**
- Machine-readable (JSON)
- Searchable (CloudWatch Insights)
- Correlated (requestId)
- Rich context
- Automatic metadata (service, environment)

**CloudWatch Insights query:**
```sql
fields @timestamp, userId, ip
| filter message = "User login"
| filter userId = 123
| sort @timestamp desc
| limit 100
```

---

## 26. Request ID Propagation

### ❌ Tutorial Approach

```javascript
// No request ID
app.post('/api/orders', async (req, res) => {
  logger.info('Creating order');
  await createOrder(req.body);
  logger.info('Order created');
});

// Logs:
// Creating order
// Creating order
// Order created
// Creating order
// Order created
// Order created

// Which logs belong to which request? 🤷
```

### ✅ Production Approach

```javascript
const { v4: uuidv4 } = require('uuid');

// Assign request ID
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || uuidv4();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// Child logger with request context
app.use((req, res, next) => {
  req.logger = logger.child({ requestId: req.id });
  next();
});

// Use child logger
app.post('/api/orders', async (req, res) => {
  req.logger.info('Creating order', { userId: req.user.id });
  
  const order = await createOrder(req.body);
  
  req.logger.info('Order created', { orderId: order.id });
  
  res.json({ order });
});

// Logs:
{
  "level": "info",
  "message": "Creating order",
  "requestId": "a1b2c3d4",
  "userId": 123
}
{
  "level": "info",
  "message": "Order created",
  "requestId": "a1b2c3d4",
  "orderId": 456
}

// Now we can trace: requestId = "a1b2c3d4"
```

**Propagate across services:**
```javascript
// Gateway → User Service
axios.post('http://user-service/api/users', data, {
  headers: {
    'X-Request-ID': req.id  // Forward request ID
  }
});

// User Service receives:
// X-Request-ID: a1b2c3d4
// Uses same ID for logging
// Entire request traced across services!
```

---

## 27. Performance Logging

### ❌ Tutorial Approach

```javascript
app.get('/api/users', async (req, res) => {
  const users = await db.query('SELECT * FROM users');
  res.json({ users });
  // No performance metrics
});
```

### ✅ Production Approach

```javascript
app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    
    logger.http('Request completed', {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration,
      requestId: req.id,
      userId: req.user?.id,
      ip: req.ip
    });
    
    // Alert on slow requests
    if (duration > 1000) {
      logger.warn('Slow request detected', {
        method: req.method,
        url: req.originalUrl,
        duration,
        requestId: req.id
      });
    }
  });
  
  next();
});
```

**Metrics to CloudWatch:**
```javascript
const cloudwatch = new AWS.CloudWatch();

async function publishMetric(name, value, unit = 'Milliseconds') {
  await cloudwatch.putMetricData({
    Namespace: 'MyApp/UserService',
    MetricData: [{
      MetricName: name,
      Value: value,
      Unit: unit,
      Timestamp: new Date(),
      Dimensions: [
        { Name: 'Environment', Value: process.env.NODE_ENV },
        { Name: 'Service', Value: 'user-service' }
      ]
    }]
  }).promise();
}

// Publish request duration
res.on('finish', () => {
  publishMetric('RequestDuration', duration);
  publishMetric('RequestCount', 1, 'Count');
  
  if (res.statusCode >= 500) {
    publishMetric('ServerErrors', 1, 'Count');
  }
});
```

---

**PRODUCTION-VS-TUTORIAL Part 2 - Section 1 Complete!** 🎉

**Covered so far (27/50):**
- ✅ Security (10 comparisons)
- ✅ Error Handling (8 comparisons)
- ✅ Configuration (6 comparisons)
- ✅ Logging & Monitoring (3 comparisons)

**Each with:**
- ❌ Tutorial approach (simple but wrong)
- ✅ Production approach (complex but correct)
- 🎯 Real-world examples
- 💰 Cost of mistakes

**Ready for the rest?** (Database, Authentication, Performance, Testing - 23 more!) 🚀
