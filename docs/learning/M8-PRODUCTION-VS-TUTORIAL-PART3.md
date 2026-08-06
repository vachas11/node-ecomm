# PRODUCTION VS TUTORIAL - PART 3

**Database, Authentication, Performance, and Testing Patterns**

---

# CATEGORY 4: Logging & Monitoring (Continued)

## 28. Log Levels

### ❌ Tutorial Approach

```javascript
console.log('Everything');  // All logs same priority
console.log('Server started');
console.log('User logged in');
console.log('Database connection failed');  // Critical!
```

### ✅ Production Approach

```javascript
// Use appropriate log levels
logger.error('Database connection failed', { error: err });  // Critical
logger.warn('Rate limit approaching', { current: 95, max: 100 });  // Warning
logger.info('User logged in', { userId: 123 });  // Normal operation
logger.http('GET /api/users 200 45ms');  // HTTP requests
logger.debug('Cache hit', { key: 'user:123' });  // Debugging info

// Production: Only log warn/error
if (process.env.NODE_ENV === 'production') {
  logger.level = 'warn';
}

// Development: Log everything
if (process.env.NODE_ENV === 'development') {
  logger.level = 'debug';
}
```

**Log level hierarchy:**
```
error   → Always log (critical failures)
warn    → Production log level (concerning events)
info    → Normal operations (user actions)
http    → HTTP requests (verbose)
debug   → Debugging details (very verbose)
```

---

## 29. Sensitive Data in Logs

### ❌ Tutorial Approach

```javascript
logger.info('User logged in', {
  email: user.email,
  password: req.body.password,  // ❌ Never log passwords!
  creditCard: req.body.creditCard,  // ❌ PCI violation!
  ssn: user.ssn  // ❌ PII violation!
});
```

### ✅ Production Approach

```javascript
// Redact sensitive fields
function redactSensitive(obj) {
  const sensitive = ['password', 'creditCard', 'ssn', 'token', 'apiKey'];
  const redacted = { ...obj };
  
  sensitive.forEach(field => {
    if (redacted[field]) {
      redacted[field] = '[REDACTED]';
    }
  });
  
  return redacted;
}

logger.info('User logged in', redactSensitive({
  email: user.email,
  password: req.body.password,
  userId: user.id
}));

// Output:
{
  "email": "john@example.com",
  "password": "[REDACTED]",
  "userId": 123
}
```

**Automatic redaction with Winston:**
```javascript
const { createLogger, format } = require('winston');

const redactFormat = format((info) => {
  const sensitive = ['password', 'creditCard', 'ssn', 'token', 'apiKey'];
  
  function redact(obj) {
    if (typeof obj !== 'object') return obj;
    
    Object.keys(obj).forEach(key => {
      if (sensitive.includes(key)) {
        obj[key] = '[REDACTED]';
      } else if (typeof obj[key] === 'object') {
        redact(obj[key]);
      }
    });
    
    return obj;
  }
  
  return redact(info);
});

const logger = createLogger({
  format: format.combine(
    redactFormat(),
    format.json()
  )
});
```

---

## 30. Alerting and Monitoring

### ❌ Tutorial Approach

```javascript
// No alerting - check logs manually
logger.error('Payment failed', { orderId: 123 });
// Hope someone sees it eventually?
```

### ✅ Production Approach

```javascript
const Sentry = require('@sentry/node');

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 1.0
});

// Error tracking
app.use(Sentry.Handlers.errorHandler());

// Custom alerts
async function alertOnCriticalError(error, context) {
  // Sentry
  Sentry.captureException(error, { extra: context });
  
  // PagerDuty
  await pagerduty.trigger({
    routing_key: process.env.PAGERDUTY_KEY,
    event_action: 'trigger',
    payload: {
      summary: error.message,
      severity: 'critical',
      source: 'user-service',
      custom_details: context
    }
  });
  
  // Slack
  await slack.chat.postMessage({
    channel: '#alerts',
    text: `🚨 Critical Error: ${error.message}`,
    attachments: [{
      color: 'danger',
      fields: [
        { title: 'Service', value: 'user-service', short: true },
        { title: 'Environment', value: process.env.NODE_ENV, short: true },
        { title: 'Request ID', value: context.requestId, short: false }
      ]
    }]
  });
}

// Usage
try {
  await processPayment(order);
} catch (err) {
  logger.error('Payment failed', { error: err, orderId: order.id });
  
  // Alert team immediately
  await alertOnCriticalError(err, {
    orderId: order.id,
    userId: order.userId,
    amount: order.amount
  });
  
  throw err;
}
```

---

## 31. Metrics Collection

### ❌ Tutorial Approach

```javascript
// No metrics - just logs
app.get('/api/users', async (req, res) => {
  const users = await db.query('SELECT * FROM users');
  res.json({ users });
});
```

### ✅ Production Approach

```javascript
const prometheus = require('prom-client');

// Create metrics
const httpRequestDuration = new prometheus.Histogram({
  name: 'http_request_duration_ms',
  help: 'Duration of HTTP requests in ms',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [10, 50, 100, 200, 500, 1000, 2000, 5000]
});

const httpRequestTotal = new prometheus.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code']
});

const activeConnections = new prometheus.Gauge({
  name: 'active_connections',
  help: 'Number of active database connections'
});

// Middleware to collect metrics
app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    
    httpRequestDuration
      .labels(req.method, req.route?.path || req.path, res.statusCode)
      .observe(duration);
    
    httpRequestTotal
      .labels(req.method, req.route?.path || req.path, res.statusCode)
      .inc();
  });
  
  next();
});

// Expose metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', prometheus.register.contentType);
  res.end(await prometheus.register.metrics());
});

// Update gauge periodically
setInterval(() => {
  activeConnections.set(db.pool.totalCount);
}, 5000);
```

**Grafana dashboard query:**
```promql
# P95 latency
histogram_quantile(0.95, 
  rate(http_request_duration_ms_bucket[5m])
)

# Error rate
rate(http_requests_total{status_code=~"5.."}[5m])

# Requests per second
rate(http_requests_total[1m])
```

---

# CATEGORY 5: Database

## 32. Connection Pooling

### ❌ Tutorial Approach

```javascript
const { Client } = require('pg');

// New connection per request!
app.get('/api/users', async (req, res) => {
  const client = new Client({
    host: 'localhost',
    database: 'myapp',
    user: 'postgres',
    password: 'password'
  });
  
  await client.connect();  // ~80ms TCP handshake
  const result = await client.query('SELECT * FROM users');  // ~10ms query
  await client.end();  // ~20ms close
  
  res.json({ users: result.rows });
});

// Every request: 110ms overhead
// 100 requests: 11 seconds wasted!
```

### ✅ Production Approach

```javascript
const { Pool } = require('pg');

// Connection pool (shared across requests)
const pool = new Pool({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  
  // Pool configuration
  min: 5,                    // Minimum connections (always open)
  max: 20,                   // Maximum connections
  idleTimeoutMillis: 30000,  // Close idle connections after 30s
  connectionTimeoutMillis: 2000,  // Fail after 2s if no connection available
  
  // SSL for production
  ssl: process.env.NODE_ENV === 'production' ? {
    rejectUnauthorized: true
  } : false
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await pool.end();
  process.exit(0);
});

app.get('/api/users', async (req, res) => {
  // Reuse connection from pool
  const result = await pool.query('SELECT * FROM users');  // ~10ms query
  res.json({ users: result.rows });
  // Connection returned to pool automatically
});

// First request: 90ms (create connection + query)
// Subsequent: 10ms (reuse connection)
// 100 requests: ~1 second (90% faster!)
```

---

## 33. Transactions

### ❌ Tutorial Approach

```javascript
// No transactions - data inconsistency risk!
app.post('/api/transfer', async (req, res) => {
  const { fromAccount, toAccount, amount } = req.body;
  
  // Deduct from sender
  await db.query(
    'UPDATE accounts SET balance = balance - $1 WHERE id = $2',
    [amount, fromAccount]
  );
  
  // ⚠️ Server crashes here!
  // Money deducted but not added to recipient!
  
  // Add to recipient
  await db.query(
    'UPDATE accounts SET balance = balance + $1 WHERE id = $2',
    [amount, toAccount]
  );
  
  res.json({ success: true });
});
```

### ✅ Production Approach

```javascript
app.post('/api/transfer', async (req, res) => {
  const { fromAccount, toAccount, amount } = req.body;
  
  const client = await pool.connect();
  
  try {
    // Start transaction
    await client.query('BEGIN');
    
    // Deduct from sender
    const senderResult = await client.query(
      'UPDATE accounts SET balance = balance - $1 WHERE id = $2 RETURNING balance',
      [amount, fromAccount]
    );
    
    // Check balance
    if (senderResult.rows[0].balance < 0) {
      throw new Error('Insufficient funds');
    }
    
    // Add to recipient
    await client.query(
      'UPDATE accounts SET balance = balance + $1 WHERE id = $2',
      [amount, toAccount]
    );
    
    // Commit transaction (both updates succeed)
    await client.query('COMMIT');
    
    res.json({ success: true });
    
  } catch (err) {
    // Rollback on error (neither update happens)
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();  // Return connection to pool
  }
});
```

**ACID properties:**
- **Atomicity**: All or nothing (both updates or neither)
- **Consistency**: Balance constraint maintained (total unchanged)
- **Isolation**: Other transactions don't see intermediate state
- **Durability**: Once committed, permanent (survives crash)

---

## 34. SQL Injection Prevention (Detailed)

### ❌ Tutorial Approach

```javascript
// String interpolation - VULNERABLE!
const userId = req.params.id;
const query = `SELECT * FROM users WHERE id = ${userId}`;
const result = await db.query(query);
```

**Attack:**
```javascript
// Attacker sends: /api/users/1; DROP TABLE users;--
const userId = "1; DROP TABLE users;--";
const query = `SELECT * FROM users WHERE id = ${userId}`;
// Query becomes:
// SELECT * FROM users WHERE id = 1; DROP TABLE users;--
// Users table deleted! 💥
```

### ✅ Production Approach

```javascript
// Parameterized queries - SAFE!
const userId = req.params.id;
const query = 'SELECT * FROM users WHERE id = $1';
const result = await db.query(query, [userId]);
```

**Why safe:**
```javascript
// Even with malicious input:
const userId = "1; DROP TABLE users;--";

// Database treats entire string as single value:
// SELECT * FROM users WHERE id = '1; DROP TABLE users;--'
// No rows match, but table safe!

// Database driver automatically escapes:
userId = "1' OR '1'='1" 
// Becomes: SELECT * FROM users WHERE id = '1'' OR ''1''=''1'
// Treated as literal string, not SQL code
```

---

## 35. Database Migrations

### ❌ Tutorial Approach

```javascript
// Manually run SQL scripts
// schema.sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255)
);

// Later: Add column manually in production
ALTER TABLE users ADD COLUMN name VARCHAR(255);
// Forget to run on staging → data inconsistency!
```

### ✅ Production Approach

```javascript
// migrations/001_create_users.sql
-- UP
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- DOWN
DROP TABLE users;

// migrations/002_add_name_to_users.sql
-- UP
ALTER TABLE users ADD COLUMN name VARCHAR(255);

-- DOWN
ALTER TABLE users DROP COLUMN name;

// Run migrations
const { migrate } = require('postgres-migrations');

async function runMigrations() {
  try {
    await migrate({
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT),
    }, 'migrations');
    
    logger.info('Migrations completed');
  } catch (err) {
    logger.error('Migration failed', { error: err });
    process.exit(1);
  }
}

// Run before starting server
runMigrations().then(() => {
  app.listen(3000);
});
```

**Benefits:**
- Version controlled (in Git)
- Reproducible (same migrations everywhere)
- Rollback capability (DOWN scripts)
- Tracked (migrations_table records what's applied)
- CI/CD integration (auto-run on deploy)

---

## 36. Query Optimization

### ❌ Tutorial Approach

```javascript
// N+1 query problem
app.get('/api/posts', async (req, res) => {
  // Get all posts
  const posts = await db.query('SELECT * FROM posts');
  
  // For each post, get author (N queries!)
  for (const post of posts.rows) {
    const author = await db.query(
      'SELECT * FROM users WHERE id = $1',
      [post.author_id]
    );
    post.author = author.rows[0];
  }
  
  res.json({ posts: posts.rows });
});

// 100 posts = 101 queries (1 + 100)
// Time: 100 × 10ms = 1000ms
```

### ✅ Production Approach

```javascript
// Single query with JOIN
app.get('/api/posts', async (req, res) => {
  const result = await db.query(`
    SELECT 
      posts.*,
      users.name AS author_name,
      users.email AS author_email
    FROM posts
    JOIN users ON posts.author_id = users.id
    ORDER BY posts.created_at DESC
    LIMIT 100
  `);
  
  // Transform result
  const posts = result.rows.map(row => ({
    id: row.id,
    title: row.title,
    content: row.content,
    author: {
      name: row.author_name,
      email: row.author_email
    }
  }));
  
  res.json({ posts });
});

// 100 posts = 1 query
// Time: 15ms (100x faster!)
```

**Indexes:**
```sql
-- Add index on foreign key
CREATE INDEX idx_posts_author_id ON posts(author_id);

-- Add index on frequently filtered columns
CREATE INDEX idx_posts_created_at ON posts(created_at);

-- Composite index
CREATE INDEX idx_posts_author_created ON posts(author_id, created_at);
```

---

## 37. Database Connection Limits

### ❌ Tutorial Approach

```javascript
// Pool size = 100
const pool = new Pool({ max: 100 });

// 200 concurrent requests
// 100 get connections
// 100 wait forever (connectionTimeoutMillis not set)
// Server appears hung!
```

### ✅ Production Approach

```javascript
const pool = new Pool({
  max: 20,  // Database max_connections = 100, reserve for multiple services
  min: 5,   // Keep 5 connections warm
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,  // Fail fast if no connection
  
  // Track stats
  application_name: 'user-service'
});

// Monitor pool
setInterval(() => {
  logger.info('Pool stats', {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount
  });
  
  // Alert if many waiting
  if (pool.waitingCount > 5) {
    logger.warn('High connection contention', {
      waiting: pool.waitingCount,
      total: pool.totalCount
    });
  }
}, 10000);

// Graceful degradation
app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users');
    res.json({ users: result.rows });
  } catch (err) {
    if (err.message.includes('timeout')) {
      // Return cached data if available
      const cached = await cache.get('users');
      if (cached) {
        return res.json({ users: cached, fromCache: true });
      }
    }
    throw err;
  }
});
```

**Calculate pool size:**
```
connections = ((core_count * 2) + effective_spindle_count)

Example:
- 4 CPU cores
- 1 SSD (counts as 1 spindle)
- connections = (4 * 2) + 1 = 9

Reserve 20% for other operations
Recommended pool size: 7-8 per service
```

---

## 38. Database Backup and Recovery

### ❌ Tutorial Approach

```javascript
// No backups
// Database crash = all data lost!
```

### ✅ Production Approach

```bash
# Automated daily backups
# backup.sh
#!/bin/bash

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups"
DB_NAME="myapp"

# Full backup
pg_dump -U postgres -d $DB_NAME -F c -f "$BACKUP_DIR/backup_$DATE.dump"

# Compress
gzip "$BACKUP_DIR/backup_$DATE.dump"

# Upload to S3
aws s3 cp "$BACKUP_DIR/backup_$DATE.dump.gz" \
  s3://my-backups/$DB_NAME/ \
  --storage-class GLACIER

# Delete local backups older than 7 days
find $BACKUP_DIR -name "*.dump.gz" -mtime +7 -delete

# Cron: Daily at 2 AM
# 0 2 * * * /scripts/backup.sh
```

**Point-in-time recovery:**
```bash
# PostgreSQL WAL (Write-Ahead Logging)
# postgresql.conf
wal_level = replica
archive_mode = on
archive_command = 'aws s3 cp %p s3://my-backups/wal/%f'

# Restore to specific time
pg_restore -U postgres -d myapp_restored backup.dump
# Edit recovery.conf
restore_command = 'aws s3 cp s3://my-backups/wal/%f %p'
recovery_target_time = '2026-08-03 10:30:00'
```

---

## 39. Read Replicas

### ❌ Tutorial Approach

```javascript
// All reads and writes to primary
const result = await pool.query('SELECT * FROM users');
// Heavy read load slows down writes!
```

### ✅ Production Approach

```javascript
// Primary for writes
const primaryPool = new Pool({
  host: process.env.DB_PRIMARY_HOST,
  max: 10
});

// Replica for reads
const replicaPool = new Pool({
  host: process.env.DB_REPLICA_HOST,
  max: 20  // More connections for reads
});

// Write to primary
app.post('/api/users', async (req, res) => {
  const result = await primaryPool.query(
    'INSERT INTO users (email, name) VALUES ($1, $2) RETURNING *',
    [req.body.email, req.body.name]
  );
  res.json({ user: result.rows[0] });
});

// Read from replica
app.get('/api/users', async (req, res) => {
  const result = await replicaPool.query('SELECT * FROM users');
  res.json({ users: result.rows });
});

// Handle replication lag
app.get('/api/users/:id', async (req, res) => {
  // Critical: Read from primary (always fresh)
  if (req.query.critical === 'true') {
    const result = await primaryPool.query(
      'SELECT * FROM users WHERE id = $1',
      [req.params.id]
    );
    return res.json({ user: result.rows[0] });
  }
  
  // Non-critical: Read from replica (may be slightly stale)
  const result = await replicaPool.query(
    'SELECT * FROM users WHERE id = $1',
    [req.params.id]
  );
  res.json({ user: result.rows[0] });
});
```

**Replication lag:**
```javascript
// Check lag
const lagResult = await primaryPool.query(`
  SELECT 
    client_addr,
    pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) AS lag_bytes,
    (pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) / 1024 / 1024) AS lag_mb
  FROM pg_stat_replication;
`);

// Alert if lag > 100MB
if (lagResult.rows[0].lag_mb > 100) {
  logger.warn('High replication lag', { lag_mb: lagResult.rows[0].lag_mb });
}
```

---

# CATEGORY 6: Authentication & Security

## 40. JWT vs Session Cookies

### ❌ Tutorial Approach

```javascript
// Store everything in JWT (too much data!)
const token = jwt.sign({
  userId: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  permissions: user.permissions,  // Array of 50 permissions
  preferences: user.preferences,  // Large object
  lastLogin: user.lastLogin
}, secret);

// JWT size: 2KB+
// Sent on EVERY request
// 1000 requests = 2MB wasted bandwidth
```

### ✅ Production Approach

```javascript
// Minimal JWT (stateless)
const accessToken = jwt.sign({
  sub: user.id,      // Subject (user ID)
  email: user.email,
  role: user.role,   // Only essential data
  type: 'access',
  jti: uuidv4()      // For blacklist
}, privateKey, {
  algorithm: 'RS256',
  expiresIn: '15m'
});

// JWT size: 300 bytes
// 1000 requests = 300KB (87% reduction)

// Fetch full user data when needed
app.get('/api/profile', async (req, res) => {
  // req.user.userId from JWT
  const user = await db.query(
    'SELECT * FROM users WHERE id = $1',
    [req.user.userId]
  );
  res.json({ user: user.rows[0] });
});
```

---

## 41. Refresh Token Rotation

### ❌ Tutorial Approach

```javascript
// Long-lived access token (30 days)
const token = jwt.sign({ userId: user.id }, secret, {
  expiresIn: '30d'
});

// Problems:
// - Stolen token valid for 30 days!
// - No way to revoke (stateless)
// - User logout doesn't work (token still valid)
```

### ✅ Production Approach

```javascript
// Short-lived access token (15 minutes)
const accessToken = jwt.sign({ userId: user.id }, secret, {
  expiresIn: '15m'
});

// Long-lived refresh token (7 days, stored in DB)
const refreshToken = jwt.sign({ userId: user.id, type: 'refresh' }, secret, {
  expiresIn: '7d'
});

// Store refresh token (hashed)
const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
await db.query(
  'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
  [user.id, tokenHash, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)]
);

// Refresh endpoint
app.post('/api/auth/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  
  // Verify refresh token
  const decoded = jwt.verify(refreshToken, secret);
  
  // Check database
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const result = await db.query(
    'SELECT * FROM refresh_tokens WHERE token_hash = $1',
    [tokenHash]
  );
  
  if (result.rows.length === 0) {
    throw new UnauthorizedError('Invalid refresh token');
  }
  
  // Generate new tokens
  const newAccessToken = generateAccessToken(user);
  const newRefreshToken = generateRefreshToken(user);
  
  // Rotate refresh token (delete old, insert new)
  await db.transaction(async (client) => {
    await client.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
    
    const newHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');
    await client.query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, newHash, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)]
    );
  });
  
  res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
});
```

**Benefits:**
- Short access token (15 min) → limited exposure if stolen
- Refresh token rotation → old tokens invalid
- Database lookup → can revoke anytime
- Logout works → delete refresh token from DB

---

## 42. Password Reset Security

### ❌ Tutorial Approach

```javascript
// Email reset link with user ID
app.post('/api/forgot-password', async (req, res) => {
  const user = await findUserByEmail(req.body.email);
  
  // ❌ Predictable token
  const resetToken = user.id.toString();
  
  // ❌ No expiry
  // ❌ No one-time use
  
  await sendEmail(user.email, `
    Reset link: https://example.com/reset-password?token=${resetToken}
  `);
  
  res.json({ success: true });
});

// Attacker can guess tokens: 1, 2, 3, ...
// No expiry → link works forever
```

### ✅ Production Approach

```javascript
const crypto = require('crypto');

app.post('/api/forgot-password', async (req, res) => {
  const user = await findUserByEmail(req.body.email);
  
  if (!user) {
    // ⚠️ Don't reveal if email exists (security)
    return res.json({ success: true, message: 'If email exists, reset link sent' });
  }
  
  // Generate cryptographically secure token
  const resetToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
  
  // Store hashed token with expiry
  await db.query(`
    INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
    VALUES ($1, $2, $3)
  `, [user.id, tokenHash, new Date(Date.now() + 60 * 60 * 1000)]);  // 1 hour expiry
  
  // Send email
  await sendEmail(user.email, `
    Reset link (valid for 1 hour):
    https://example.com/reset-password?token=${resetToken}
  `);
  
  res.json({ success: true, message: 'If email exists, reset link sent' });
});

app.post('/api/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  
  // Hash token
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  
  // Find valid token
  const result = await db.query(`
    SELECT * FROM password_reset_tokens
    WHERE token_hash = $1 AND expires_at > NOW()
  `, [tokenHash]);
  
  if (result.rows.length === 0) {
    throw new ValidationError('Invalid or expired reset token');
  }
  
  const resetRecord = result.rows[0];
  
  // Update password
  const passwordHash = await bcrypt.hash(newPassword, 12);
  
  await db.transaction(async (client) => {
    // Update password
    await client.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [passwordHash, resetRecord.user_id]
    );
    
    // Delete reset token (one-time use)
    await client.query(
      'DELETE FROM password_reset_tokens WHERE token_hash = $1',
      [tokenHash]
    );
    
    // Revoke all refresh tokens (logout all devices)
    await client.query(
      'DELETE FROM refresh_tokens WHERE user_id = $1',
      [resetRecord.user_id]
    );
  });
  
  res.json({ success: true });
});
```

**Security features:**
- ✅ Cryptographically secure token (not predictable)
- ✅ Token hashed in database (database leak protection)
- ✅ 1-hour expiry
- ✅ One-time use (deleted after use)
- ✅ Revoke all sessions (logout all devices)
- ✅ Don't reveal if email exists (prevents enumeration)

---

## 43. Multi-Factor Authentication (MFA)

### ❌ Tutorial Approach

```javascript
// Password only
app.post('/api/login', async (req, res) => {
  const user = await findUser(req.body.email);
  const isValid = await bcrypt.compare(req.body.password, user.password_hash);
  
  if (!isValid) {
    throw new ValidationError('Invalid credentials');
  }
  
  const token = generateToken(user);
  res.json({ token });
});

// Compromised password = account compromised
```

### ✅ Production Approach

```javascript
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');

// Enable MFA
app.post('/api/auth/mfa/enable', authenticate, async (req, res) => {
  // Generate secret
  const secret = speakeasy.generateSecret({
    name: `MyApp (${req.user.email})`,
    issuer: 'MyApp'
  });
  
  // Store secret (encrypted)
  await db.query(
    'UPDATE users SET mfa_secret = $1, mfa_enabled = false WHERE id = $2',
    [secret.base32, req.user.userId]
  );
  
  // Generate QR code
  const qrCode = await QRCode.toDataURL(secret.otpauth_url);
  
  res.json({
    secret: secret.base32,
    qrCode,
    message: 'Scan QR code with Google Authenticator'
  });
});

// Verify and activate MFA
app.post('/api/auth/mfa/verify', authenticate, async (req, res) => {
  const { token } = req.body;
  
  const user = await db.query('SELECT mfa_secret FROM users WHERE id = $1', [req.user.userId]);
  
  // Verify token
  const isValid = speakeasy.totp.verify({
    secret: user.rows[0].mfa_secret,
    encoding: 'base32',
    token,
    window: 1  // Allow 1 time step tolerance (30 seconds)
  });
  
  if (!isValid) {
    throw new ValidationError('Invalid MFA code');
  }
  
  // Enable MFA
  await db.query(
    'UPDATE users SET mfa_enabled = true WHERE id = $1',
    [req.user.userId]
  );
  
  res.json({ success: true, message: 'MFA enabled' });
});

// Login with MFA
app.post('/api/auth/login', async (req, res) => {
  const { email, password, mfaToken } = req.body;
  
  const user = await findUser(email);
  const isValid = await bcrypt.compare(password, user.password_hash);
  
  if (!isValid) {
    throw new ValidationError('Invalid credentials');
  }
  
  // Check if MFA enabled
  if (user.mfa_enabled) {
    if (!mfaToken) {
      // Request MFA token
      return res.status(200).json({
        success: false,
        mfaRequired: true,
        message: 'MFA code required'
      });
    }
    
    // Verify MFA token
    const isMfaValid = speakeasy.totp.verify({
      secret: user.mfa_secret,
      encoding: 'base32',
      token: mfaToken,
      window: 1
    });
    
    if (!isMfaValid) {
      throw new ValidationError('Invalid MFA code');
    }
  }
  
  // Generate tokens
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);
  
  res.json({ accessToken, refreshToken });
});
```

---

## 44. API Rate Limiting (Advanced)

### ❌ Tutorial Approach

```javascript
// Simple counter (resets at fixed intervals)
const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});

// Problem: Burst at window reset
// 11:59:59 → 100 requests
// 12:00:00 → 100 requests (window resets)
// 200 requests in 1 second!
```

### ✅ Production Approach

```javascript
// Sliding window with Redis
const RedisStore = require('rate-limit-redis');

const limiter = rateLimit({
  store: new RedisStore({
    client: redisClient,
    prefix: 'ratelimit:'
  }),
  windowMs: 15 * 60 * 1000,
  max: 100,
  
  // Sliding window (not fixed)
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
  
  // Custom key generator
  keyGenerator: (req) => {
    // Authenticated: per user
    if (req.user) {
      return `user:${req.user.userId}`;
    }
    // Unauthenticated: per IP
    return `ip:${req.ip}`;
  },
  
  // Custom handler
  handler: (req, res) => {
    const retryAfter = Math.ceil(15 * 60 * (1 - (req.rateLimit.current / req.rateLimit.limit)));
    
    res.status(429).json({
      success: false,
      error: {
        message: 'Too many requests',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter,
        limit: req.rateLimit.limit,
        remaining: req.rateLimit.remaining,
        resetTime: new Date(Date.now() + retryAfter * 1000).toISOString()
      }
    });
  }
});

// Different limits per endpoint
app.post('/api/auth/login', rateLimit({ max: 5, windowMs: 15 * 60 * 1000 }));
app.post('/api/auth/register', rateLimit({ max: 3, windowMs: 60 * 60 * 1000 }));
app.get('/api/users', rateLimit({ max: 100, windowMs: 15 * 60 * 1000 }));
```

---

## 45. Account Lockout

### ❌ Tutorial Approach

```javascript
// No lockout - unlimited attempts
app.post('/api/login', async (req, res) => {
  const user = await findUser(req.body.email);
  const isValid = await bcrypt.compare(req.body.password, user.password_hash);
  
  if (!isValid) {
    throw new ValidationError('Invalid credentials');
  }
  
  // Attacker can try millions of passwords
});
```

### ✅ Production Approach

```javascript
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  
  const user = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  
  if (user.rows.length === 0) {
    throw new ValidationError('Invalid credentials');
  }
  
  const userRecord = user.rows[0];
  
  // Check if account locked
  if (userRecord.locked_until && new Date(userRecord.locked_until) > new Date()) {
    const remainingTime = Math.ceil((new Date(userRecord.locked_until) - new Date()) / 1000);
    throw new ValidationError(`Account locked. Try again in ${remainingTime} seconds`);
  }
  
  // Verify password
  const isValid = await bcrypt.compare(password, userRecord.password_hash);
  
  if (!isValid) {
    // Increment failed attempts
    const failedAttempts = userRecord.failed_attempts + 1;
    
    if (failedAttempts >= 5) {
      // Lock account for 15 minutes
      await db.query(
        'UPDATE users SET failed_attempts = $1, locked_until = $2 WHERE id = $3',
        [failedAttempts, new Date(Date.now() + 15 * 60 * 1000), userRecord.id]
      );
      
      // Alert user
      await sendEmail(userRecord.email, 'Account Locked', 
        'Multiple failed login attempts detected. Account locked for 15 minutes.'
      );
      
      throw new ValidationError('Account locked due to multiple failed attempts');
    }
    
    // Update failed attempts
    await db.query(
      'UPDATE users SET failed_attempts = $1 WHERE id = $2',
      [failedAttempts, userRecord.id]
    );
    
    throw new ValidationError(`Invalid credentials (${5 - failedAttempts} attempts remaining)`);
  }
  
  // Reset failed attempts on success
  await db.query(
    'UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1',
    [userRecord.id]
  );
  
  // Generate tokens
  const accessToken = generateAccessToken(userRecord);
  const refreshToken = generateRefreshToken(userRecord);
  
  res.json({ accessToken, refreshToken });
});
```

---

## 46. Secure Session Management

### ❌ Tutorial Approach

```javascript
const session = require('express-session');

app.use(session({
  secret: 'keyboard cat',  // ❌ Weak secret
  resave: true,            // ❌ Unnecessary saves
  saveUninitialized: true  // ❌ Tracks all visitors
}));

// Stored in memory (lost on restart)
// No secure/httpOnly flags
```

### ✅ Production Approach

```javascript
const session = require('express-session');
const RedisStore = require('connect-redis')(session);

app.use(session({
  store: new RedisStore({ client: redisClient }),
  secret: process.env.SESSION_SECRET,  // Strong secret from env
  resave: false,                       // Only save if modified
  saveUninitialized: false,            // Don't create session until needed
  name: 'sessionId',                   // Don't use default 'connect.sid'
  
  cookie: {
    secure: true,        // HTTPS only
    httpOnly: true,      // Not accessible via JavaScript
    maxAge: 24 * 60 * 60 * 1000,  // 24 hours
    sameSite: 'strict',  // CSRF protection
    domain: '.example.com'  // Share across subdomains
  },
  
  // Rolling session (extend on activity)
  rolling: true,
  
  // Session regeneration on privilege change
  genid: (req) => {
    return uuidv4();
  }
}));

// Regenerate session on login (prevent session fixation)
app.post('/api/login', async (req, res) => {
  const user = await authenticateUser(req.body);
  
  // Regenerate session ID
  req.session.regenerate((err) => {
    if (err) throw err;
    
    // Set user in session
    req.session.userId = user.id;
    req.session.email = user.email;
    
    res.json({ success: true });
  });
});

// Destroy session on logout
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) throw err;
    res.json({ success: true });
  });
});
```

---

**PRODUCTION-VS-TUTORIAL Part 3 - Section 1 Complete!** ✅

**Covered (46/50):**
- ✅ Logging (5 more comparisons)
- ✅ Database (8 comparisons)
- ✅ Authentication (7 comparisons)

**4 more comparisons remaining:**
- Performance (3): Caching, compression, lazy loading
- Testing (1): Unit vs integration

**Almost there!** Just 10 more minutes to complete MODULE-8! 🚀
