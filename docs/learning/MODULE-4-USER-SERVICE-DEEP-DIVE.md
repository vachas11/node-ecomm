# MODULE-4: USER SERVICE DEEP DIVE

**Complete explanation of User Service - where authentication actually happens!**

---

## Overview

**What is User Service?**

```
User Service = Authentication Backend

Responsibilities:
├─ User registration (create accounts)
├─ Login (verify credentials, issue tokens)
├─ Token refresh (rotate tokens)
├─ Logout (revoke tokens)
├─ Profile management (read/update user data)
├─ Password changes (security)
└─ Internal APIs (service-to-service user lookups)

NOT responsible for:
├─ Token verification (that's API Gateway middleware)
├─ Rate limiting (that's API Gateway)
├─ Request routing (that's API Gateway)
└─ Frontend (that's separate React/Vue app)

Think of it as:
API Gateway = Front door (checks IDs, routes traffic)
User Service = Authentication office (issues IDs, manages accounts)
```

**Architecture:**

```
Client Request:
POST /api/auth/login
    ↓
API Gateway (port 3000):
├─ Rate limit check ✅
├─ Request logging ✅
└─ Proxy to User Service
    ↓
User Service (port 3001):
├─ Validate credentials
├─ Generate tokens
├─ Store refresh token in DB
└─ Return tokens + user data
    ↓
API Gateway:
├─ Forward response to client
└─ Log duration
    ↓
Client receives:
{
  "success": true,
  "data": {
    "user": { "userId": 1, "email": "user@test.com", ... },
    "accessToken": "eyJhbGci...",
    "refreshToken": "eyJhbGci..."
  }
}
```

---

# PART 1: User Service Entry Point

**File:** `services/user-service/src/server.js`

This is similar to API Gateway's server.js, but simpler (no proxy logic, no resilience patterns).

## Complete Code Walkthrough

```javascript
require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const logger = require('../../../shared/logger');
const { errorHandler } = require('../../../shared/errors');
const redisClient = require('../../../shared/redis');
const db = require('./config/database');

// Import routes
const authRoutes = require('./routes/auth.routes');
const internalRoutes = require('./routes/internal.routes');

const app = express();
const PORT = process.env.USER_SERVICE_PORT || 3001;

// Security middleware
app.use(helmet());

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request ID
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || uuidv4();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// Request logging
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
      userAgent: req.get('user-agent')
    });
  });
  
  next();
});

// Health check
app.get('/health', async (req, res) => {
  try {
    // Check database
    await db.query('SELECT 1');
    
    // Check Redis
    await redisClient.ping();
    
    res.json({
      status: 'healthy',
      service: 'user-service',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: { status: 'connected' },
      redis: { status: 'connected' }
    });
  } catch (error) {
    logger.error('Health check failed:', { error: error.message });
    res.status(503).json({
      status: 'unhealthy',
      service: 'user-service',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Routes
app.use('/api/auth', authRoutes);           // Public auth endpoints
app.use('/api/internal', internalRoutes);   // Internal service-to-service

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      message: 'Endpoint not found',
      code: 'NOT_FOUND',
      path: req.path
    }
  });
});

// Global error handler
app.use(errorHandler);

// Graceful shutdown
const gracefulShutdown = async (signal) => {
  logger.info(`${signal} received, shutting down gracefully...`);
  
  server.close(async () => {
    logger.info('HTTP server closed');
    
    // Close database connections
    await db.end();
    logger.info('Database connections closed');
    
    // Close Redis
    await redisClient.disconnect();
    logger.info('Redis disconnected');
    
    logger.info('All connections closed');
    process.exit(0);
  });
  
  // Force shutdown after 30 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
};

// Start server
let server;
const startServer = async () => {
  try {
    // Connect to database
    await db.connect();
    logger.info('Database connected');
    
    // Connect to Redis
    await redisClient.connect();
    logger.info('Redis connected');
    
    // Start HTTP server
    server = app.listen(PORT, () => {
      logger.info(`User Service running on port ${PORT}`, {
        environment: process.env.NODE_ENV,
        nodeVersion: process.version
      });
    });
    
    // Register shutdown handlers
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    
  } catch (error) {
    logger.error('Failed to start User Service:', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
};

// Global error handlers
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', {
    error: error.message,
    stack: error.stack
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', { reason, promise });
  process.exit(1);
});

startServer();

module.exports = app;
```

**Key Differences from API Gateway:**

```javascript
// API Gateway has:
├─ Circuit breaker
├─ Retry strategy
├─ Connection pooling
├─ Bulkhead isolation
├─ Proxy middleware
└─ Service registry

// User Service has:
├─ Database connection
├─ Auth controllers
├─ Internal routes
└─ Simpler (no proxy logic)

// Why?
// API Gateway = Router (needs resilience to handle backend failures)
// User Service = Worker (just processes requests, simpler)
```

---

# PART 2: Database Configuration

**File:** `services/user-service/src/config/database.js`

```javascript
const { Pool } = require('pg');
const logger = require('../../../../shared/logger');

// Create connection pool
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'ecommerce_users',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  
  // Pool configuration
  max: 20,                      // Maximum connections
  min: 5,                       // Minimum connections (always ready)
  idleTimeoutMillis: 30000,     // Close idle connections after 30s
  connectionTimeoutMillis: 2000, // Timeout if can't get connection
});

// Connection event handlers
pool.on('connect', (client) => {
  logger.debug('New database client connected');
});

pool.on('error', (err, client) => {
  logger.error('Unexpected database error:', {
    error: err.message,
    stack: err.stack
  });
});

// Helper function: Execute query
const query = async (text, params) => {
  const start = Date.now();
  
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    
    logger.debug('Executed query', {
      query: text,
      duration: `${duration}ms`,
      rows: result.rowCount
    });
    
    return result;
  } catch (error) {
    logger.error('Query error:', {
      query: text,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};

// Helper function: Get single client from pool (for transactions)
const getClient = async () => {
  const client = await pool.connect();
  
  // Wrap client.query to add logging
  const originalQuery = client.query.bind(client);
  client.query = async (...args) => {
    const start = Date.now();
    try {
      const result = await originalQuery(...args);
      const duration = Date.now() - start;
      logger.debug('Transaction query', {
        duration: `${duration}ms`,
        rows: result.rowCount
      });
      return result;
    } catch (error) {
      logger.error('Transaction query error:', {
        error: error.message
      });
      throw error;
    }
  };
  
  return client;
};

// Helper function: Execute transaction
const transaction = async (callback) => {
  const client = await getClient();
  
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// Test connection
const connect = async () => {
  try {
    const result = await query('SELECT NOW()');
    logger.info('Database connection established', {
      timestamp: result.rows[0].now
    });
  } catch (error) {
    logger.error('Failed to connect to database:', {
      error: error.message
    });
    throw error;
  }
};

// Close all connections
const end = async () => {
  await pool.end();
  logger.info('Database pool closed');
};

module.exports = {
  query,
  getClient,
  transaction,
  connect,
  end
};
```

**Why Connection Pooling?**

```javascript
// WITHOUT pooling (bad):
for (let i = 0; i < 100; i++) {
  const client = new Client();  // New connection
  await client.connect();       // 50-200ms handshake
  await client.query('SELECT * FROM users');
  await client.end();           // Close connection
}

// Time: 100 × 200ms = 20 seconds! 💀

// WITH pooling (good):
for (let i = 0; i < 100; i++) {
  await pool.query('SELECT * FROM users');  // Reuse connection
}

// Time: 100 × 5ms = 500ms ✅
// 40x faster!
```

**Pool Configuration Explained:**

```javascript
max: 20  // Maximum connections

// Why 20?
// PostgreSQL default max_connections: 100
// Reserve for:
// - User Service: 20 connections
// - Product Service: 20 connections
// - Order Service: 20 connections
// - Background jobs: 20 connections
// - Admin tools: 10 connections
// - Buffer: 10 connections
// Total: 100 ✅

min: 5  // Minimum connections (always open)

// Why 5?
// Keep 5 connections always ready
// No connection overhead for first 5 requests
// Trade-off: Memory vs latency

idleTimeoutMillis: 30000  // 30 seconds

// If connection idle for 30s, close it
// Reduces memory during low traffic
// Still keeps min=5 open

connectionTimeoutMillis: 2000  // 2 seconds

// If can't get connection in 2s, error
// Prevents hanging requests
// Indicates pool exhaustion (increase max)
```

---

# PART 3: Auth Controller - COMPLETE

**File:** `services/user-service/src/controllers/auth.controller.js`

This is the **CORE** of authentication. Every function explained line-by-line!

## Function 1: Register (Create New User)

```javascript
const bcrypt = require('bcrypt');
const { generateAccessToken, generateRefreshToken } = require('../../../../shared/auth/jwt');
const db = require('../config/database');
const { ValidationError, ConflictError } = require('../../../../shared/errors');

async function register(req, res, next) {
  try {
    const { email, password, firstName, lastName } = req.body;
    
    // 1. Validate input
    if (!email || !password) {
      throw new ValidationError('Email and password are required');
    }
    
    if (password.length < 8) {
      throw new ValidationError('Password must be at least 8 characters');
    }
    
    // 2. Check if user already exists
    const existingUser = await db.query(
      'SELECT user_id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    
    if (existingUser.rows.length > 0) {
      throw new ConflictError('Email already registered');
    }
    
    // 3. Hash password
    const saltRounds = 12;  // 2^12 = 4096 iterations
    const passwordHash = await bcrypt.hash(password, saltRounds);
    
    // 4. Insert user into database (transaction)
    const result = await db.transaction(async (client) => {
      // Insert user
      const userResult = await client.query(
        `INSERT INTO users (email, password_hash, first_name, last_name, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         RETURNING user_id, email, first_name, last_name, created_at`,
        [email.toLowerCase(), passwordHash, firstName, lastName]
      );
      
      const user = userResult.rows[0];
      
      // 5. Generate tokens
      const accessToken = generateAccessToken({
        userId: user.user_id,
        email: user.email,
        role: 'user'  // Default role
      });
      
      const refreshToken = generateRefreshToken({
        userId: user.user_id
      });
      
      // 6. Store refresh token in database
      const crypto = require('crypto');
      const tokenHash = crypto
        .createHash('sha256')
        .update(refreshToken)
        .digest('hex');
      
      await client.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, created_at)
         VALUES ($1, $2, NOW() + INTERVAL '7 days', NOW())`,
        [user.user_id, tokenHash]
      );
      
      return { user, accessToken, refreshToken };
    });
    
    // 7. Return response
    res.status(201).json({
      success: true,
      data: {
        user: {
          userId: result.user.user_id,
          email: result.user.email,
          firstName: result.user.first_name,
          lastName: result.user.last_name,
          createdAt: result.user.created_at
        },
        accessToken: result.accessToken,
        refreshToken: result.refreshToken
      }
    });
    
  } catch (error) {
    next(error);
  }
}
```

**Line-by-Line Explanation:**

### Step 1: Validate Input

```javascript
if (!email || !password) {
  throw new ValidationError('Email and password are required');
}

// Why validate?
// Frontend validation can be bypassed
// API must validate EVERYTHING
// Never trust client input

if (password.length < 8) {
  throw new ValidationError('Password must be at least 8 characters');
}

// Why 8 characters minimum?
// NIST guidelines: 8+ characters
// 8 chars = 218 trillion combinations (lowercase + numbers)
// 12 chars = 475 million trillion combinations
// More = better, but 8 is acceptable minimum
```

### Step 2: Check Existing User

```javascript
const existingUser = await db.query(
  'SELECT user_id FROM users WHERE email = $1',
  [email.toLowerCase()]
);

// Why SELECT user_id instead of SELECT *?
// Only need to know if user exists
// Don't fetch unnecessary data
// Faster query

// Why email.toLowerCase()?
// Emails are case-insensitive
// user@test.com = USER@TEST.COM
// Prevent duplicate accounts
```

### Step 3: Hash Password

```javascript
const saltRounds = 12;
const passwordHash = await bcrypt.hash(password, saltRounds);

// Why bcrypt?
// Designed for password hashing
// Slow by design (prevents brute force)
// Auto-generates salt
// Auto-stores salt in hash

// What is salt?
// Random data added to password before hashing
// Same password → different hash each time
// Prevents rainbow table attacks

// Why 12 rounds?
// 2^12 = 4096 iterations
// Takes ~250ms to hash
// Slow enough to prevent brute force
// Fast enough to not frustrate users

// Time to crack:
// 10 rounds: ~100ms/hash → 10 hashes/sec
// 12 rounds: ~250ms/hash → 4 hashes/sec
// 14 rounds: ~1000ms/hash → 1 hash/sec
```

**bcrypt Internals:**

```javascript
// Example bcrypt hash:
$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LkYWW5SPKqWxpqWKK
 │  │  │                              │
 │  │  └─ Salt (22 chars)            └─ Hash (31 chars)
 │  └─ Cost factor (12 = 2^12 iterations)
 └─ Algorithm version (2b = latest)

// To verify:
bcrypt.compare(password, hash)
// 1. Extracts salt from hash
// 2. Hashes input password with same salt
// 3. Compares hashes
// Returns true if match
```

### Step 4: Insert User (Transaction)

```javascript
await db.transaction(async (client) => {
  // Insert user
  const userResult = await client.query(...);
  
  // Insert refresh token
  await client.query(...);
  
  return { user, tokens };
});

// Why transaction?
// Ensures BOTH operations succeed or BOTH fail
// Prevents orphaned data

// Scenario without transaction:
1. Insert user: SUCCESS ✅
2. Network error 💀
3. Insert refresh token: FAILS ❌
Result: User exists but no refresh token (broken state)

// With transaction:
1. BEGIN TRANSACTION
2. Insert user ✅
3. Network error 💀
4. Insert refresh token ❌
5. ROLLBACK (user insert reverted)
Result: No user, no token (consistent state) ✅
```

### Step 5: Generate Tokens

```javascript
const accessToken = generateAccessToken({
  userId: user.user_id,
  email: user.email,
  role: 'user'
});

// Access token payload:
{
  userId: 123,
  email: 'user@test.com',
  role: 'user',
  type: 'access',
  iat: 1690000000,  // Issued at
  exp: 1690000900,  // Expires in 15 min
  jti: 'uuid-here'  // JWT ID (for blacklist)
}

const refreshToken = generateRefreshToken({
  userId: user.user_id
});

// Refresh token payload (minimal):
{
  userId: 123,
  type: 'refresh',
  iat: 1690000000,
  exp: 1690604800,  // Expires in 7 days
  jti: 'uuid-here'
}

// Why different payloads?
// Access token: Rich data (email, role) for authorization
// Refresh token: Minimal data (just userId) for security
```

### Step 6: Store Refresh Token

```javascript
const crypto = require('crypto');
const tokenHash = crypto
  .createHash('sha256')
  .update(refreshToken)
  .digest('hex');

await client.query(
  `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, created_at)
   VALUES ($1, $2, NOW() + INTERVAL '7 days', NOW())`,
  [user.user_id, tokenHash]
);

// Why hash refresh token before storing?
// Security: If database compromised, attacker can't use tokens
// Refresh token = JWT (can be used immediately)
// Hashed token = Can't be used without original

// Why store in database?
// Access tokens: Not stored (stateless)
// Refresh tokens: Stored (can be revoked)

// Scenario:
Database leaked!
├─ Access tokens: Not in database ✅
├─ Refresh tokens: Hashed ✅
└─ Attacker: Can't generate valid tokens ✅
```

**SHA-256 Hash Example:**

```javascript
// Original refresh token (JWT):
eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEyMy...

// SHA-256 hash (stored in DB):
5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8

// To verify refresh token:
1. Client sends refresh token
2. Server hashes it (SHA-256)
3. Server looks up hash in database
4. If found: Valid ✅
5. If not found: Invalid or revoked ❌
```

### Step 7: Return Response

```javascript
res.status(201).json({
  success: true,
  data: {
    user: {
      userId: result.user.user_id,
      email: result.user.email,
      firstName: result.user.first_name,
      lastName: result.user.last_name,
      createdAt: result.user.created_at
    },
    accessToken: result.accessToken,
    refreshToken: result.refreshToken
  }
});

// Why 201 Created?
// 201 = Resource created successfully
// 200 = OK (general success)
// 201 more specific, better RESTful design

// Why not return password_hash?
// NEVER return sensitive data
// Only return what client needs
```

---

## Function 2: Login (Authenticate User)

```javascript
async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    
    // 1. Validate input
    if (!email || !password) {
      throw new ValidationError('Email and password are required');
    }
    
    // 2. Find user by email
    const result = await db.query(
      `SELECT user_id, email, password_hash, first_name, last_name, role
       FROM users
       WHERE email = $1`,
      [email.toLowerCase()]
    );
    
    if (result.rows.length === 0) {
      // Don't reveal whether email exists (security)
      throw new ValidationError('Invalid email or password');
    }
    
    const user = result.rows[0];
    
    // 3. Verify password
    const passwordValid = await bcrypt.compare(password, user.password_hash);
    
    if (!passwordValid) {
      throw new ValidationError('Invalid email or password');
    }
    
    // 4. Generate tokens
    const accessToken = generateAccessToken({
      userId: user.user_id,
      email: user.email,
      role: user.role || 'user'
    });
    
    const refreshToken = generateRefreshToken({
      userId: user.user_id
    });
    
    // 5. Store new refresh token, delete old ones (token rotation)
    await db.transaction(async (client) => {
      // Delete old refresh tokens for this user
      await client.query(
        'DELETE FROM refresh_tokens WHERE user_id = $1',
        [user.user_id]
      );
      
      // Store new refresh token
      const crypto = require('crypto');
      const tokenHash = crypto
        .createHash('sha256')
        .update(refreshToken)
        .digest('hex');
      
      await client.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, created_at)
         VALUES ($1, $2, NOW() + INTERVAL '7 days', NOW())`,
        [user.user_id, tokenHash]
      );
    });
    
    // 6. Return response
    res.json({
      success: true,
      data: {
        user: {
          userId: user.user_id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          role: user.role
        },
        accessToken,
        refreshToken
      }
    });
    
  } catch (error) {
    next(error);
  }
}
```

**Key Points:**

### Password Verification

```javascript
const passwordValid = await bcrypt.compare(password, user.password_hash);

// How bcrypt.compare works:
// 1. Extract salt from stored hash
// 2. Hash input password with same salt
// 3. Compare hashes
// 4. Return true if match

// Example:
Stored hash: $2b$12$LQv3c1yqBWVHxkd0LHAkCOYz...
Input password: "mypassword123"
    ↓
Extract salt: LQv3c1yqBWVHxkd0LHAkCO
    ↓
Hash input with salt: $2b$12$LQv3c1yqBWVHxkd0LHAkCOYz...
    ↓
Compare: Match! ✅
```

### Security: Don't Reveal Whether Email Exists

```javascript
// ❌ BAD (reveals if email exists):
if (result.rows.length === 0) {
  throw new ValidationError('Email not found');  // Attacker knows email doesn't exist
}

if (!passwordValid) {
  throw new ValidationError('Wrong password');  // Attacker knows email exists
}

// ✅ GOOD (doesn't reveal):
if (result.rows.length === 0 || !passwordValid) {
  throw new ValidationError('Invalid email or password');  // Same message for both!
}

// Why?
// Attacker can enumerate valid emails:
try login with test1@example.com → "Email not found"
try login with test2@example.com → "Wrong password"  ← Email exists!

// With generic message:
try login with test1@example.com → "Invalid email or password"
try login with test2@example.com → "Invalid email or password"
// Can't tell which is which ✅
```

### Token Rotation

```javascript
// Delete old refresh tokens
await client.query(
  'DELETE FROM refresh_tokens WHERE user_id = $1',
  [user.user_id]
);

// Store new refresh token
await client.query(
  'INSERT INTO refresh_tokens ...'
);

// Why delete old tokens?
// Each login = new tokens
// Old tokens no longer valid
// Reduces token sprawl

// User logs in on:
Monday: Device A → Token 1
Tuesday: Device B → Token 2 (Token 1 deleted)
Wednesday: Device A → Token 3 (Token 2 deleted)

// Only latest token valid
// Prevents token accumulation
```

---

## Function 3: Refresh (Get New Access Token)

```javascript
const { verifyToken } = require('../../../../shared/auth/jwt');
const blacklist = require('../../../../shared/auth/blacklist');

async function refresh(req, res, next) {
  try {
    const { refreshToken } = req.body;
    
    // 1. Validate input
    if (!refreshToken) {
      throw new ValidationError('Refresh token required');
    }
    
    // 2. Verify refresh token signature
    let decoded;
    try {
      decoded = verifyToken(refreshToken, 'refresh');
    } catch (error) {
      throw new ValidationError('Invalid refresh token');
    }
    
    // 3. Hash token to look up in database
    const crypto = require('crypto');
    const tokenHash = crypto
      .createHash('sha256')
      .update(refreshToken)
      .digest('hex');
    
    // 4. Check if token exists in database
    const result = await db.query(
      `SELECT rt.token_id, rt.user_id, rt.created_at, u.email, u.role
       FROM refresh_tokens rt
       JOIN users u ON rt.user_id = u.user_id
       WHERE rt.token_hash = $1 AND rt.expires_at > NOW()`,
      [tokenHash]
    );
    
    if (result.rows.length === 0) {
      // Token not in database or expired
      // This could indicate token reuse attack!
      logger.warn('Refresh token not found in database', {
        userId: decoded.userId,
        tokenId: decoded.jti
      });
      throw new ValidationError('Invalid or expired refresh token');
    }
    
    const tokenData = result.rows[0];
    
    // 5. Check for token reuse (security)
    // If token used multiple times, possible attack
    const timeSinceCreated = Date.now() - new Date(tokenData.created_at).getTime();
    if (timeSinceCreated < 5000) {  // Less than 5 seconds
      logger.error('Possible token reuse detected', {
        userId: tokenData.user_id,
        tokenId: tokenData.token_id,
        timeSinceCreated
      });
      
      // Revoke all user's tokens
      await db.query(
        'DELETE FROM refresh_tokens WHERE user_id = $1',
        [tokenData.user_id]
      );
      
      throw new ValidationError('Token reuse detected, please login again');
    }
    
    // 6. Generate new tokens (token rotation)
    const newAccessToken = generateAccessToken({
      userId: tokenData.user_id,
      email: tokenData.email,
      role: tokenData.role
    });
    
    const newRefreshToken = generateRefreshToken({
      userId: tokenData.user_id
    });
    
    // 7. Rotate refresh token (delete old, insert new)
    await db.transaction(async (client) => {
      // Delete old refresh token
      await client.query(
        'DELETE FROM refresh_tokens WHERE token_id = $1',
        [tokenData.token_id]
      );
      
      // Insert new refresh token
      const newTokenHash = crypto
        .createHash('sha256')
        .update(newRefreshToken)
        .digest('hex');
      
      await client.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, created_at)
         VALUES ($1, $2, NOW() + INTERVAL '7 days', NOW())`,
        [tokenData.user_id, newTokenHash]
      );
    });
    
    // 8. Return new tokens
    res.json({
      success: true,
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken
      }
    });
    
  } catch (error) {
    next(error);
  }
}
```

**Token Reuse Detection:**

```javascript
// Normal flow:
10:00:00 - Client: "Refresh my token"
10:00:01 - Server: Generates new tokens, returns them
10:00:02 - Client receives tokens
10:15:00 - Client: "Refresh my token" (using new token)
    ↓
All good ✅

// Attack scenario (token stolen):
10:00:00 - Client: "Refresh my token"
10:00:01 - Server: Returns new tokens
10:00:02 - Attacker: Intercepts tokens
10:00:03 - Attacker: "Refresh my token" (using stolen token)
10:00:04 - Server: Token used within 5 seconds! 🚨
          Deletes ALL user's refresh tokens
          User must re-login
    ↓
Attack detected and mitigated! ✅
```

---

## Function 4: Logout (Revoke Tokens)

```javascript
async function logout(req, res, next) {
  try {
    const { refreshToken } = req.body;
    
    // Extract access token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new ValidationError('Access token required');
    }
    
    const accessToken = authHeader.split(' ')[1];
    
    // 1. Verify and decode access token
    const decoded = verifyToken(accessToken, 'access');
    
    // 2. Calculate time until token expires
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = Math.max(decoded.exp - now, 0);
    
    // 3. Add access token to blacklist
    if (expiresIn > 0) {
      await blacklist.addToBlacklist(decoded.jti, expiresIn);
    }
    
    // 4. Delete refresh token from database
    if (refreshToken) {
      const crypto = require('crypto');
      const tokenHash = crypto
        .createHash('sha256')
        .update(refreshToken)
        .digest('hex');
      
      await db.query(
        'DELETE FROM refresh_tokens WHERE token_hash = $1',
        [tokenHash]
      );
    }
    
    // 5. Return success
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
    
  } catch (error) {
    next(error);
  }
}
```

**Complete Logout Flow:**

```
Client clicks "Logout"
    ↓
POST /api/auth/logout
Headers: Authorization: Bearer <access-token>
Body: { refreshToken: "<refresh-token>" }
    ↓
Server:
1. Decode access token → jti = "abc-123", exp = 1690001500
2. Calculate expiresIn = 1690001500 - 1690000000 = 1500 seconds
3. Redis: SET blacklist:abc-123 "revoked" EX 1500 ✅
4. Database: DELETE FROM refresh_tokens WHERE token_hash = ... ✅
    ↓
Response: { success: true }
    ↓
User's next request:
Headers: Authorization: Bearer <same-access-token>
    ↓
Gateway authenticate() middleware:
1. Verify token ✅
2. Check blacklist: GET blacklist:abc-123 → "revoked" ❌
3. Return 401 TOKEN_REVOKED
    ↓
User must re-login ✅
```

---

## Function 5: Logout All (Revoke All Devices)

```javascript
async function logoutAll(req, res, next) {
  try {
    // User is already authenticated (authenticate middleware ran)
    const userId = req.user.userId;
    
    // Extract current access token
    const authHeader = req.headers.authorization;
    const accessToken = authHeader.split(' ')[1];
    const decoded = verifyToken(accessToken, 'access');
    
    // 1. Blacklist current access token
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = Math.max(decoded.exp - now, 0);
    
    if (expiresIn > 0) {
      await blacklist.addToBlacklist(decoded.jti, expiresIn);
    }
    
    // 2. Delete ALL refresh tokens for this user
    const result = await db.query(
      'DELETE FROM refresh_tokens WHERE user_id = $1 RETURNING token_id',
      [userId]
    );
    
    logger.info('Logout all devices', {
      userId,
      tokensRevoked: result.rowCount
    });
    
    // 3. Return success
    res.json({
      success: true,
      message: `Logged out from ${result.rowCount} device(s)`,
      devicesLoggedOut: result.rowCount
    });
    
  } catch (error) {
    next(error);
  }
}
```

**Use Case:**

```
User: "I lost my phone! Log me out everywhere!"
    ↓
POST /api/auth/logout-all
    ↓
Server:
├─ Blacklist current access token (this session)
├─ Delete ALL refresh tokens from database
│  ├─ Token from phone ✅ deleted
│  ├─ Token from laptop ✅ deleted
│  ├─ Token from tablet ✅ deleted
│  └─ 3 tokens deleted total
└─ Return: "Logged out from 3 device(s)"
    ↓
Lost phone:
├─ Tries to refresh token
├─ Token not in database
└─ Must re-login ✅

All devices secured! ✅
```

---

## Function 6: Get Profile

```javascript
async function getProfile(req, res, next) {
  try {
    // User already authenticated (middleware set req.user)
    const userId = req.user.userId;
    
    // Fetch user from database
    const result = await db.query(
      `SELECT user_id, email, first_name, last_name, role, created_at, updated_at
       FROM users
       WHERE user_id = $1`,
      [userId]
    );
    
    if (result.rows.length === 0) {
      throw new NotFoundError('User not found');
    }
    
    const user = result.rows[0];
    
    res.json({
      success: true,
      data: {
        user: {
          userId: user.user_id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          role: user.role,
          createdAt: user.created_at,
          updatedAt: user.updated_at
        }
      }
    });
    
  } catch (error) {
    next(error);
  }
}
```

**Why Query Database?**

```javascript
// Can't we use req.user from JWT?
// req.user comes from JWT token:
{
  userId: 123,
  email: 'user@test.com',
  role: 'user'
}

// But what if:
// - User changed email (still shows old email in JWT)
// - User changed role (still shows old role in JWT)
// - User deleted account (JWT still valid until expiry)

// Solution: Query database for latest data
// Trade-off: 5-10ms database query vs stale data

// Alternative: Cache user data in Redis for 1 minute
const cachedUser = await redis.get(`user:${userId}`);
if (cachedUser) return JSON.parse(cachedUser);

const user = await db.query(...);
await redis.setex(`user:${userId}`, 60, JSON.stringify(user));
return user;

// Result: 1ms Redis query instead of 10ms DB query ✅
```

---

## Function 7: Update Profile

```javascript
async function updateProfile(req, res, next) {
  try {
    const userId = req.user.userId;
    const { firstName, lastName } = req.body;
    
    // Validate input
    if (!firstName && !lastName) {
      throw new ValidationError('At least one field required');
    }
    
    // Build dynamic UPDATE query
    const updates = [];
    const values = [];
    let paramCounter = 1;
    
    if (firstName) {
      updates.push(`first_name = $${paramCounter++}`);
      values.push(firstName);
    }
    
    if (lastName) {
      updates.push(`last_name = $${paramCounter++}`);
      values.push(lastName);
    }
    
    updates.push(`updated_at = NOW()`);
    values.push(userId);  // WHERE user_id = $N
    
    // Execute update
    const result = await db.query(
      `UPDATE users 
       SET ${updates.join(', ')}
       WHERE user_id = $${paramCounter}
       RETURNING user_id, email, first_name, last_name, updated_at`,
      values
    );
    
    if (result.rows.length === 0) {
      throw new NotFoundError('User not found');
    }
    
    const user = result.rows[0];
    
    res.json({
      success: true,
      data: {
        user: {
          userId: user.user_id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          updatedAt: user.updated_at
        }
      }
    });
    
  } catch (error) {
    next(error);
  }
}
```

**Dynamic Query Building:**

```javascript
// Why dynamic query?
// User might update only firstName, only lastName, or both

// Example 1: Update only firstName
firstName = "John"
lastName = undefined

Query:
UPDATE users 
SET first_name = $1, updated_at = NOW()
WHERE user_id = $2

// Example 2: Update both
firstName = "John"
lastName = "Doe"

Query:
UPDATE users 
SET first_name = $1, last_name = $2, updated_at = NOW()
WHERE user_id = $3

// Dynamic building handles all cases ✅
```

---

## Function 8: Change Password

```javascript
async function changePassword(req, res, next) {
  try {
    const userId = req.user.userId;
    const { currentPassword, newPassword } = req.body;
    
    // 1. Validate input
    if (!currentPassword || !newPassword) {
      throw new ValidationError('Current and new password required');
    }
    
    if (newPassword.length < 8) {
      throw new ValidationError('New password must be at least 8 characters');
    }
    
    if (currentPassword === newPassword) {
      throw new ValidationError('New password must be different');
    }
    
    // 2. Fetch user's current password hash
    const result = await db.query(
      'SELECT password_hash FROM users WHERE user_id = $1',
      [userId]
    );
    
    if (result.rows.length === 0) {
      throw new NotFoundError('User not found');
    }
    
    const user = result.rows[0];
    
    // 3. Verify current password
    const passwordValid = await bcrypt.compare(
      currentPassword,
      user.password_hash
    );
    
    if (!passwordValid) {
      throw new ValidationError('Current password is incorrect');
    }
    
    // 4. Hash new password
    const saltRounds = 12;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);
    
    // 5. Update password and revoke all tokens (transaction)
    await db.transaction(async (client) => {
      // Update password
      await client.query(
        `UPDATE users 
         SET password_hash = $1, updated_at = NOW()
         WHERE user_id = $2`,
        [newPasswordHash, userId]
      );
      
      // Delete all refresh tokens (force re-login on all devices)
      await client.query(
        'DELETE FROM refresh_tokens WHERE user_id = $1',
        [userId]
      );
    });
    
    // 6. Blacklist current access token
    const authHeader = req.headers.authorization;
    const accessToken = authHeader.split(' ')[1];
    const decoded = verifyToken(accessToken, 'access');
    
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = Math.max(decoded.exp - now, 0);
    
    if (expiresIn > 0) {
      await blacklist.addToBlacklist(decoded.jti, expiresIn);
    }
    
    logger.info('Password changed', { userId });
    
    // 7. Return success
    res.json({
      success: true,
      message: 'Password changed successfully. Please login again.'
    });
    
  } catch (error) {
    next(error);
  }
}
```

**Why Revoke All Tokens on Password Change?**

```
Scenario: Password compromised
10:00 AM - User realizes password leaked
10:05 AM - User changes password
10:10 AM - Attacker tries to use old session

// Without token revocation:
├─ Attacker's token still valid (15 min expiry)
├─ Attacker can still access account for 10 more minutes
└─ Password change didn't help! 💀

// With token revocation:
├─ All refresh tokens deleted
├─ Current access token blacklisted
├─ Attacker's token invalid immediately
└─ Account secured! ✅

Security best practice:
ANY password change = Revoke ALL sessions
```

---

**MODULE-4 Part 1 Complete!**

**Next: Part 2 will cover:**
- Routes configuration (how controllers connect to endpoints)
- Internal APIs (service-to-service communication)
- Interview Q&A for each function
- Tutorial vs Production comparisons
- Testing strategies

Ready for Part 2? 🚀
