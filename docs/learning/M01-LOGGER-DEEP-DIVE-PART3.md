# M01: Logger Deep Dive - PART 3

**Real-World Scenarios & Hands-On Exercises**

---

## ⚡ SECTION 6: REAL-WORLD SCENARIOS

### Scenario 1: Debugging a Production Outage

**Situation:**
It's 3 AM. You get paged: "Payment service is down. 500 errors on all payment requests."

**With proper logging:**

```bash
# Step 1: Check error.log for recent errors
tail -50 /var/log/app/error.log

# Output:
{"timestamp":"2026-08-07 03:14:23","level":"error","message":"Payment processing failed","service":"payment-service","error":"Connection timeout","stack":"Error: Connection timeout\n    at PaymentGateway.charge (gateway.ts:45)\n    ..."}

# Step 2: Check combined.log for context around that time
grep "03:14" /var/log/app/combined.log | tail -100

# Output:
{"timestamp":"2026-08-07 03:14:20","level":"info","message":"Processing payment","orderId":12345}
{"timestamp":"2026-08-07 03:14:21","level":"warn","message":"Slow response from payment gateway","latency":5000}
{"timestamp":"2026-08-07 03:14:22","level":"warn","message":"Retrying payment","attempt":2}
{"timestamp":"2026-08-07 03:14:23","level":"error","message":"Payment processing failed","error":"Connection timeout"}

# Step 3: Check if it's affecting all requests
grep '"level":"error"' /var/log/app/error.log | grep "03:" | wc -l
# Output: 234 errors in the last hour

# Conclusion: Payment gateway is down (external service issue)
# Action: Enable circuit breaker to stop hammering the gateway
```

**Time to diagnose:** 5 minutes

**Without proper logging:**

```bash
# Check logs...
tail -50 /var/log/app/app.log

# Output:
Payment failed
Payment failed
Payment failed

# No stack trace, no context, no timestamp
# You have no idea WHY it failed or WHEN it started
```

**Time to diagnose:** 2-3 hours (guessing and checking)

**Key takeaway:** Good logging turns 3-hour outages into 5-minute fixes.

---

### Scenario 2: Finding a Memory Leak

**Situation:**
Your Node.js service's memory usage grows from 200MB to 2GB over 24 hours, then crashes.

**Using logs to diagnose:**

```typescript
// Add memory logging to your service
setInterval(() => {
  const used = process.memoryUsage();
  logger.info('Memory usage', {
    heapUsed: Math.round(used.heapUsed / 1024 / 1024) + ' MB',
    heapTotal: Math.round(used.heapTotal / 1024 / 1024) + ' MB',
    rss: Math.round(used.rss / 1024 / 1024) + ' MB'
  });
}, 60000);  // Every minute
```

**Analyzing logs:**

```bash
# Extract memory usage over time
grep "Memory usage" combined.log | jq '.heapUsed'

# Output:
"234 MB"  # 10:00 AM
"245 MB"  # 10:01 AM
"256 MB"  # 10:02 AM
"267 MB"  # 10:03 AM
# ^ Clearly growing!

# Correlate with request patterns
grep "Memory usage" combined.log > memory.log
grep "Request received" combined.log > requests.log

# Paste side-by-side to see correlation
paste memory.log requests.log | less

# Discovery: Memory spikes after /api/reports endpoint
# Conclusion: Report generation is caching data and not releasing it
```

**Key takeaway:** Proactive logging helps diagnose issues before they become critical.

---

### Scenario 3: Tracking Down a Race Condition

**Situation:**
Sometimes (1 in 1000 requests) users see "Order not found" immediately after creating an order.

**Logging strategy:**

```typescript
// Add correlation IDs and timestamps
import { v4 as uuid } from 'uuid';

app.post('/api/orders', async (req, res) => {
  const requestId = uuid();
  const startTime = Date.now();
  
  logger.info('Order creation started', { 
    requestId, 
    userId: req.user.id,
    timestamp: startTime 
  });
  
  const order = await orderService.create(req.body);
  
  logger.info('Order created', { 
    requestId, 
    orderId: order.id,
    duration: Date.now() - startTime 
  });
  
  res.json({ orderId: order.id });
});

app.get('/api/orders/:id', async (req, res) => {
  const requestId = uuid();
  
  logger.info('Order fetch started', { 
    requestId, 
    orderId: req.params.id 
  });
  
  const order = await orderService.findById(req.params.id);
  
  if (!order) {
    logger.warn('Order not found', { 
      requestId, 
      orderId: req.params.id 
    });
  }
  
  res.json(order);
});
```

**Finding the bug:**

```bash
# Find instances where "Order not found" happened
grep "Order not found" combined.log | jq '.orderId'

# Output: 12345, 12389, 12401

# Check creation logs for order 12345
grep "12345" combined.log | jq '{time: .timestamp, message: .message, duration: .duration}'

# Output:
{"time":"2026-08-07 14:32:10.123","message":"Order creation started"}
{"time":"2026-08-07 14:32:10.156","message":"Order created","duration":33}
{"time":"2026-08-07 14:32:10.145","message":"Order fetch started"}  # ← BEFORE creation finished!
{"time":"2026-08-07 14:32:10.147","message":"Order not found"}

# Discovery: Frontend is fetching the order WHILE it's being created
# Cause: Frontend sends POST and immediately sends GET without waiting
# Solution: Make frontend wait for POST response before fetching
```

**Key takeaway:** Correlation IDs and precise timestamps are essential for debugging race conditions.

---

### Scenario 4: Detecting a DDOS Attack

**Situation:**
Your server is getting hammered with 10,000 requests/second (normally 1,000).

**Detection through logs:**

```typescript
// Log all requests with IP and user-agent
app.use((req, res, next) => {
  logger.info('Request received', {
    ip: req.ip,
    method: req.method,
    path: req.path,
    userAgent: req.headers['user-agent']
  });
  next();
});
```

**Analysis:**

```bash
# Count requests per IP in the last minute
grep "Request received" combined.log | \
  grep "$(date -u +"%Y-%m-%d %H:%M")" | \
  jq -r '.ip' | \
  sort | uniq -c | sort -nr | head -10

# Output:
8543 1.2.3.4      # ← SUSPICIOUS! One IP = 85% of traffic
234  5.6.7.8
156  9.10.11.12
...

# Check what this IP is requesting
grep "1.2.3.4" combined.log | jq '.path' | sort | uniq -c

# Output:
8543 /api/users/search

# Conclusion: Single IP hammering search endpoint
# Action: Block IP at firewall level, add rate limiting
```

**Implementation of rate limiting:**

```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 100,  // Max 100 requests per minute per IP
  handler: (req, res) => {
    logger.warn('Rate limit exceeded', { ip: req.ip });
    res.status(429).json({ error: 'Too many requests' });
  }
});

app.use('/api/', limiter);
```

**Key takeaway:** Logging request metadata helps detect and respond to attacks.

---

### Scenario 5: Compliance Audit (GDPR)

**Situation:**
A user requests deletion of all their data. You need to prove you deleted it from logs too.

**Problem:**

```bash
# User emails are scattered in logs
grep "john@example.com" logs/*.log

# Output (GDPR violation):
{"timestamp":"2026-08-07 10:00:00","message":"User login","email":"john@example.com"}
{"timestamp":"2026-08-07 10:15:00","message":"Profile updated","email":"john@example.com"}
# ... thousands of entries over months/years
```

**Solution 1: Don't log PII**

```typescript
// ❌ DON'T log emails directly
logger.info('User login', { email: user.email });

// ✅ DO log pseudonymous IDs
logger.info('User login', { userId: user.id });  // User ID is okay if not PII

// ✅ OR hash emails
import crypto from 'crypto';

function hashEmail(email: string): string {
  return crypto.createHash('sha256').update(email).digest('hex');
}

logger.info('User login', { emailHash: hashEmail(user.email) });
```

**Solution 2: Implement log scrubbing**

```typescript
// script/scrub-logs.ts
import fs from 'fs';
import readline from 'readline';

async function scrubEmail(email: string, logFile: string) {
  const rl = readline.createInterface({
    input: fs.createReadStream(logFile),
    crlfDelay: Infinity
  });
  
  const output = fs.createWriteStream(logFile + '.scrubbed');
  
  for await (const line of rl) {
    const log = JSON.parse(line);
    
    // Replace email with [REDACTED]
    const scrubbedLine = line.replace(email, '[REDACTED]');
    output.write(scrubbedLine + '\n');
  }
  
  output.close();
  
  // Replace original with scrubbed version
  fs.renameSync(logFile + '.scrubbed', logFile);
}

// Usage:
await scrubEmail('john@example.com', 'logs/combined.log');
```

**Key takeaway:** Design logging with compliance in mind from day one. Don't log PII if you don't need to.

---

### Scenario 6: When NOT to Use Logging

**Anti-pattern 1: Logging business metrics**

```typescript
// ❌ DON'T use logs for metrics
logger.info('Order completed', { orderId: 123, amount: 99.99 });

// ✅ DO use a metrics library
import { Counter, Histogram } from 'prom-client';

const ordersCompleted = new Counter({
  name: 'orders_completed_total',
  help: 'Total orders completed'
});

const orderAmount = new Histogram({
  name: 'order_amount_dollars',
  help: 'Order amount distribution'
});

ordersCompleted.inc();
orderAmount.observe(99.99);

// Why? Metrics are aggregated, logs are individual events
// Searching logs to count orders is SLOW and expensive
```

**Anti-pattern 2: Logging for debugging (always on)**

```typescript
// ❌ DON'T leave debug logs everywhere
function calculateTotal(items) {
  logger.debug('calculateTotal called', { items });  // ← Left from debugging
  let total = 0;
  for (const item of items) {
    logger.debug('Processing item', { item });  // ← Overkill!
    total += item.price;
  }
  logger.debug('Total calculated', { total });  // ← Unnecessary
  return total;
}

// ✅ DO use debugger or conditional logging
function calculateTotal(items) {
  // Use debugger during development
  // debugger;
  
  let total = 0;
  for (const item of items) {
    total += item.price;
  }
  
  // Only log the result if needed
  if (total > 10000) {
    logger.warn('Large order total', { total });
  }
  
  return total;
}
```

**Anti-pattern 3: Logging for feature flags**

```typescript
// ❌ DON'T log every feature flag check
if (featureFlags.newCheckout) {
  logger.info('Using new checkout');  // ← Logged millions of times
  return newCheckoutFlow();
}

// ✅ DO use a feature flag service with telemetry
import { FeatureFlags } from './feature-flags';

if (FeatureFlags.isEnabled('newCheckout', user)) {
  return newCheckoutFlow();
}
// FeatureFlags library handles telemetry internally
```

**When to use logging:**
- ✅ Errors and exceptions
- ✅ Security events (login, logout, permission changes)
- ✅ Business-critical operations (order placed, payment processed)
- ✅ External API calls
- ✅ State changes (status transitions)

**When NOT to use logging:**
- ❌ Metrics and analytics (use Prometheus, Datadog)
- ❌ Tracing (use OpenTelemetry, Jaeger)
- ❌ Performance profiling (use New Relic, APM tools)
- ❌ Feature flag evaluation (use LaunchDarkly, Split.io)
- ❌ High-frequency events (every request, every loop iteration)

---

## 🧪 SECTION 7: HANDS-ON EXERCISES

### Exercise 1: Fix the Bad Logger

**Given this code:**

```typescript
import winston from 'winston';

const logger = winston.createLogger({
  level: 'debug',  // Issue 1
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),  // Issue 2
    new winston.transports.File({
      filename: 'app.log'  // Issue 3
    })
  ]
});

export default logger;
```

**Problems:**
1. `level: 'debug'` will log debug messages in production (performance issue)
2. Console transport is always on (should be dev-only)
3. No log rotation (disk will fill up)
4. No timestamp format
5. No defaultMeta (can't identify service in microservices)
6. No error stack traces

**Your task:** Fix all 6 issues.

<details>
<summary>Click to see solution</summary>

```typescript
import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',  // ✅ Fix 1: Environment-based
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),  // ✅ Fix 4
    winston.format.errors({ stack: true }),  // ✅ Fix 6
    winston.format.json()
  ),
  defaultMeta: {  // ✅ Fix 5
    service: process.env.SERVICE_NAME || 'unknown-service',
    environment: process.env.NODE_ENV || 'development'
  },
  transports: [
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5242880,  // ✅ Fix 3: Rotation
      maxFiles: 5
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 5242880,  // ✅ Fix 3: Rotation
      maxFiles: 5
    })
  ]
});

if (process.env.NODE_ENV !== 'production') {  // ✅ Fix 2: Dev-only
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
        return `${timestamp} [${service}] ${level}: ${message} ${
          Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
        }`;
      })
    )
  }));
}

export default logger;
```

</details>

---

### Exercise 2: Implement Correlation IDs

**Scenario:** You have an Express API. Implement correlation IDs so you can trace a single request through multiple services.

**Starter code:**

```typescript
import express from 'express';
import logger from './logger';

const app = express();

app.post('/api/orders', async (req, res) => {
  logger.info('Creating order');
  const order = await createOrder(req.body);
  logger.info('Order created', { orderId: order.id });
  res.json(order);
});

async function createOrder(data) {
  logger.info('Saving to database');
  // ... save to DB ...
  logger.info('Calling payment service');
  // ... call payment service ...
  return order;
}
```

**Your task:**
1. Generate a unique request ID for each request
2. Log it with every log entry
3. Return it in response headers

<details>
<summary>Click to see solution</summary>

```typescript
import express from 'express';
import { v4 as uuid } from 'uuid';
import logger from './logger';

const app = express();

// Middleware to generate correlation ID
app.use((req, res, next) => {
  // Use existing ID from client or generate new one
  req.id = req.headers['x-request-id'] || uuid();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// Middleware to attach request ID to all logs
app.use((req, res, next) => {
  req.logger = logger.child({ requestId: req.id });
  next();
});

app.post('/api/orders', async (req, res) => {
  req.logger.info('Creating order');  // Uses child logger with requestId
  const order = await createOrder(req.body, req.logger);
  req.logger.info('Order created', { orderId: order.id });
  res.json(order);
});

async function createOrder(data, logger) {
  logger.info('Saving to database');
  // ... save to DB ...
  logger.info('Calling payment service');
  // ... call payment service ...
  return order;
}

// Now all logs have the same requestId:
// {"requestId":"abc-123","message":"Creating order"}
// {"requestId":"abc-123","message":"Saving to database"}
// {"requestId":"abc-123","message":"Calling payment service"}
// {"requestId":"abc-123","message":"Order created","orderId":456}
```

</details>

---

### Exercise 3: Implement PII Redaction

**Scenario:** Your logs accidentally contain sensitive data. Implement automatic redaction.

**Starter code:**

```typescript
import logger from './logger';

app.post('/api/login', (req, res) => {
  logger.info('Login attempt', req.body);
  // Problem: req.body contains password!
});

app.post('/api/payment', (req, res) => {
  logger.info('Payment processing', req.body);
  // Problem: req.body contains credit card!
});
```

**Your task:** Create a wrapper around the logger that automatically redacts sensitive fields.

<details>
<summary>Click to see solution</summary>

```typescript
// logger-wrapper.ts
import baseLogger from './logger';

const SENSITIVE_FIELDS = [
  'password',
  'token',
  'apiKey',
  'secret',
  'creditCard',
  'cardNumber',
  'cvv',
  'ssn',
  'pin'
];

function redactSensitive(obj: any, depth = 0): any {
  // Prevent infinite recursion
  if (depth > 10 || obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => redactSensitive(item, depth + 1));
  }
  
  const redacted = { ...obj };
  
  for (const key in redacted) {
    const lowerKey = key.toLowerCase();
    
    // Check if key matches sensitive field
    const isSensitive = SENSITIVE_FIELDS.some(field => 
      lowerKey.includes(field.toLowerCase())
    );
    
    if (isSensitive) {
      // Redact the value
      if (typeof redacted[key] === 'string' && redacted[key].length > 4) {
        // For credit cards, show last 4 digits
        if (lowerKey.includes('card') || lowerKey.includes('credit')) {
          redacted[key] = '****-****-****-' + redacted[key].slice(-4);
        } else {
          redacted[key] = '[REDACTED]';
        }
      } else {
        redacted[key] = '[REDACTED]';
      }
    } else if (typeof redacted[key] === 'object') {
      // Recursively redact nested objects
      redacted[key] = redactSensitive(redacted[key], depth + 1);
    }
  }
  
  return redacted;
}

// Wrap logger with automatic redaction
export default {
  info: (message: string, meta?: any) => {
    baseLogger.info(message, redactSensitive(meta));
  },
  error: (message: string, meta?: any) => {
    baseLogger.error(message, redactSensitive(meta));
  },
  warn: (message: string, meta?: any) => {
    baseLogger.warn(message, redactSensitive(meta));
  },
  debug: (message: string, meta?: any) => {
    baseLogger.debug(message, redactSensitive(meta));
  }
};
```

**Usage:**

```typescript
import logger from './logger-wrapper';

app.post('/api/login', (req, res) => {
  logger.info('Login attempt', req.body);
  // Output: {"message":"Login attempt","email":"john@example.com","password":"[REDACTED]"}
});

app.post('/api/payment', (req, res) => {
  logger.info('Payment processing', req.body);
  // Output: {"message":"Payment processing","amount":99.99,"creditCard":"****-****-****-1234"}
});
```

</details>

---

### Exercise 4: Implement Log Sampling

**Scenario:** Your `/health` endpoint gets 1000 requests/second. You don't need to log every single one.

**Your task:** Implement log sampling that logs:
- 100% of errors
- 10% of warnings
- 1% of info
- 0.1% of debug

<details>
<summary>Click to see solution</summary>

```typescript
// sampled-logger.ts
import baseLogger from './logger';

const SAMPLE_RATES = {
  error: 1.0,    // 100%
  warn: 0.1,     // 10%
  info: 0.01,    // 1%
  debug: 0.001   // 0.1%
};

function shouldSample(level: string): boolean {
  const rate = SAMPLE_RATES[level] || 1.0;
  return Math.random() < rate;
}

export default {
  info: (message: string, meta?: any) => {
    if (shouldSample('info')) {
      baseLogger.info(message, { ...meta, sampled: true, sampleRate: SAMPLE_RATES.info });
    }
  },
  error: (message: string, meta?: any) => {
    // Always log errors
    baseLogger.error(message, meta);
  },
  warn: (message: string, meta?: any) => {
    if (shouldSample('warn')) {
      baseLogger.warn(message, { ...meta, sampled: true, sampleRate: SAMPLE_RATES.warn });
    }
  },
  debug: (message: string, meta?: any) => {
    if (shouldSample('debug')) {
      baseLogger.debug(message, { ...meta, sampled: true, sampleRate: SAMPLE_RATES.debug });
    }
  }
};
```

**Usage:**

```typescript
import logger from './sampled-logger';

app.get('/health', (req, res) => {
  logger.info('Health check');  // Only logged 1% of the time
  res.json({ status: 'ok' });
});

app.post('/api/orders', (req, res) => {
  logger.info('Order created', { orderId: 123 });  // Logged 1% (info)
  // ... something goes wrong ...
  logger.error('Order failed', { error: err });  // ALWAYS logged (100%)
});
```

**Result:**
- Before: 1000 health check logs/second = 86.4 million logs/day
- After: 10 health check logs/second = 864,000 logs/day (100x reduction!)
- Errors still logged 100% of the time

</details>

---

### Exercise 5: Write Tests for Logger

**Your task:** Write unit tests to verify that:
1. Logs are written to files
2. Rotation works when maxsize is exceeded
3. Console transport is not added in production
4. defaultMeta is included in all logs

<details>
<summary>Click to see solution</summary>

```typescript
// logger.test.ts
import winston from 'winston';
import fs from 'fs';
import path from 'path';

describe('Logger', () => {
  const testLogDir = path.join(__dirname, '../logs/test');
  const errorLogPath = path.join(testLogDir, 'error.log');
  const combinedLogPath = path.join(testLogDir, 'combined.log');
  
  beforeEach(() => {
    // Clean up test logs
    if (fs.existsSync(testLogDir)) {
      fs.rmSync(testLogDir, { recursive: true });
    }
    fs.mkdirSync(testLogDir, { recursive: true });
  });
  
  afterEach(() => {
    // Clean up
    fs.rmSync(testLogDir, { recursive: true });
  });
  
  it('should write logs to files', async () => {
    const logger = winston.createLogger({
      format: winston.format.json(),
      transports: [
        new winston.transports.File({ filename: errorLogPath, level: 'error' }),
        new winston.transports.File({ filename: combinedLogPath })
      ]
    });
    
    logger.info('Test info message');
    logger.error('Test error message');
    
    // Wait for async writes
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Check files exist
    expect(fs.existsSync(errorLogPath)).toBe(true);
    expect(fs.existsSync(combinedLogPath)).toBe(true);
    
    // Check error.log only has errors
    const errorLog = fs.readFileSync(errorLogPath, 'utf-8');
    expect(errorLog).toContain('Test error message');
    expect(errorLog).not.toContain('Test info message');
    
    // Check combined.log has both
    const combinedLog = fs.readFileSync(combinedLogPath, 'utf-8');
    expect(combinedLog).toContain('Test info message');
    expect(combinedLog).toContain('Test error message');
  });
  
  it('should rotate logs when maxsize exceeded', async () => {
    const logger = winston.createLogger({
      format: winston.format.json(),
      transports: [
        new winston.transports.File({
          filename: combinedLogPath,
          maxsize: 1024,  // 1 KB
          maxFiles: 2
        })
      ]
    });
    
    // Write 2 KB of logs (should trigger rotation)
    for (let i = 0; i < 100; i++) {
      logger.info('X'.repeat(100));
    }
    
    // Wait for rotation
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Check that rotated file exists
    expect(fs.existsSync(combinedLogPath)).toBe(true);
    expect(fs.existsSync(combinedLogPath + '.1')).toBe(true);
  });
  
  it('should not add console transport in production', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    
    const logger = winston.createLogger({
      transports: [
        new winston.transports.File({ filename: combinedLogPath })
      ]
    });
    
    if (process.env.NODE_ENV !== 'production') {
      logger.add(new winston.transports.Console());
    }
    
    // Check no console transport
    const hasConsole = logger.transports.some(
      t => t.constructor.name === 'Console'
    );
    expect(hasConsole).toBe(false);
    
    process.env.NODE_ENV = originalEnv;
  });
  
  it('should include defaultMeta in all logs', async () => {
    const logger = winston.createLogger({
      format: winston.format.json(),
      defaultMeta: {
        service: 'test-service',
        environment: 'test'
      },
      transports: [
        new winston.transports.File({ filename: combinedLogPath })
      ]
    });
    
    logger.info('Test message');
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const logContent = fs.readFileSync(combinedLogPath, 'utf-8');
    const logLine = JSON.parse(logContent.trim());
    
    expect(logLine.service).toBe('test-service');
    expect(logLine.environment).toBe('test');
  });
});
```

</details>

---

## 🎯 SECTION 8: MAANG INTERVIEW TIPS

### What Interviewers Look For

**Junior Level:**
- [ ] Know the difference between `console.log` and a real logger
- [ ] Understand log levels (debug, info, warn, error)
- [ ] Can explain why logs need rotation
- [ ] Basic Winston configuration

**Mid Level:**
- [ ] Structured logging (JSON)
- [ ] Correlation IDs for tracing
- [ ] Log sampling at scale
- [ ] Security concerns (PII, log injection)
- [ ] Production best practices

**Senior Level:**
- [ ] Design centralized logging for microservices
- [ ] Performance implications at scale
- [ ] Compliance (GDPR, HIPAA)
- [ ] Observability (logs + metrics + traces)
- [ ] Cost optimization strategies

**Staff/Principal Level:**
- [ ] Architecture decisions (ELK vs CloudWatch vs custom)
- [ ] Organizational standards
- [ ] Team education and tooling
- [ ] Handling petabyte-scale logs

---

### Common Follow-Up Questions

After you explain Winston, interviewers often ask:

**1. "How would you handle logs in a Kubernetes cluster?"**

Answer: Use a DaemonSet with Fluentd/Filebeat on each node to ship logs to centralized storage. Alternatively, use stdout/stderr and let Kubernetes handle collection.

**2. "What's the difference between logging and tracing?"**

Answer: Logging records discrete events. Tracing follows a request across multiple services with parent-child relationships. Use OpenTelemetry for tracing.

**3. "How do you handle log aggregation across 100 microservices?"**

Answer: Use ELK stack or managed service (CloudWatch, Datadog). Key: consistent log format (JSON), service tags, correlation IDs.

**4. "What's your strategy for log retention?"**

Answer: Tiered storage - hot (7 days on SSD), warm (30 days on HDD), cold (90 days on S3). Delete after 90 days for GDPR compliance unless legal hold.

**5. "How do you prevent logs from containing secrets?"**

Answer: Automatic PII redaction, code reviews, grep CI checks for patterns like "password:", "token:", "key:", secret scanning tools (Trufflehog, git-secrets).

---

### Code Review Red Flags

If you're reviewing code and see these, flag them:

```typescript
// ❌ Console.log in production
console.log('User data:', user);

// ❌ Logging passwords
logger.info('Login', { email, password });

// ❌ Logging inside loops
for (const item of items) {
  logger.debug('Processing', item);  // 10,000 logs!
}

// ❌ No log rotation
new winston.transports.File({ filename: 'app.log' })

// ❌ Unstructured logging
logger.info(`User ${user.id} did ${action}`);

// ❌ Using string concatenation (use template literals or structured)
logger.info('User ' + userId + ' logged in');
```

---

### Impressive Things to Say

**In a behavioral interview:**
> "In my previous role, I implemented centralized logging for our microservices using the ELK stack, which reduced our mean time to resolution (MTTR) from 4 hours to 30 minutes. We also added PII redaction which was critical for our SOC 2 compliance."

**In a system design interview:**
> "For logging, I'd use Winston with JSON format and defaultMeta to tag each service. Logs would be shipped via Filebeat to Kafka for buffering, then processed by Logstash and stored in Elasticsearch with tiered retention. This handles 100K req/sec at about $3-4K/month on AWS."

**In a code review:**
> "I noticed we're logging user emails directly. For GDPR compliance, we should either hash them or use user IDs instead. Also, this endpoint logs on every request, which at our scale generates 2TB of logs per day. Can we sample this down to 1%?"

---

## 🎓 COMPLETION CHECKLIST

After studying all 3 parts of this module, you should be able to:

**Understanding:**
- [ ] Explain why Winston is better than console.log
- [ ] Describe how log levels work
- [ ] Understand the purpose of each formatter
- [ ] Explain log rotation and why it's critical
- [ ] Know when to use error.log vs combined.log

**Implementation:**
- [ ] Configure Winston from scratch
- [ ] Add correlation IDs to Express app
- [ ] Implement PII redaction
- [ ] Set up log sampling for high-traffic endpoints
- [ ] Write tests for logging

**Production:**
- [ ] Design centralized logging for microservices
- [ ] Handle GDPR/compliance requirements
- [ ] Optimize logging performance
- [ ] Debug production issues using logs
- [ ] Set up alerts on log patterns

**Interview Readiness:**
- [ ] Can explain our logger.ts line-by-line
- [ ] Can answer all 15 interview questions
- [ ] Can design an ELK stack architecture
- [ ] Can discuss tradeoffs (Winston vs Bunyan vs Pino)
- [ ] Can spot and fix bad logging practices

---

## 📚 RECOMMENDED NEXT STEPS

After mastering logging:

1. **M02: Error Handling Deep Dive** - Learn about custom error classes (shared/errors.ts)
2. **M03: Database Connection Pooling** - Learn about PostgreSQL pooling (shared/database.ts)
3. **M21: Monitoring & Observability** - Learn about metrics and tracing (beyond logging)

---

## 🔗 ADDITIONAL RESOURCES

**Official Documentation:**
- Winston: https://github.com/winstonjs/winston
- Winston transports: https://github.com/winstonjs/winston/blob/master/docs/transports.md

**Best Practices:**
- Logz.io logging best practices: https://logz.io/blog/logging-best-practices/
- 12 Factor App - Logs: https://12factor.net/logs

**Alternatives to Winston:**
- Pino (fastest): https://github.com/pinojs/pino
- Bunyan (JSON-first): https://github.com/trentm/node-bunyan
- Log4js (Java-style): https://github.com/log4js-node/log4js-node

**Centralized Logging:**
- ELK Stack: https://www.elastic.co/elastic-stack
- Datadog: https://www.datadoghq.com/
- AWS CloudWatch: https://aws.amazon.com/cloudwatch/

---

**🎓 END OF MODULE M01**

You've completed the comprehensive Logger Deep Dive! You now understand:
- ✅ Theory and fundamentals (Part 1)
- ✅ Line-by-line code explanation (Part 1)
- ✅ Architecture and flows (Part 1)
- ✅ 15 interview questions (Part 2)
- ✅ Production best practices (Part 2)
- ✅ Real-world scenarios (Part 3)
- ✅ Hands-on exercises (Part 3)

**Total time invested:** ~3-4 hours  
**Value for MAANG interviews:** Extremely high (logging is fundamental)

Next module: **M02-ERRORS-DEEP-DIVE.md** (coming soon!)
