# COMPLETE REQUEST FLOW TRACING

**Follow a request through every layer - millisecond by millisecond!**

---

## Overview

**This module traces 5 complete request flows:**

1. **User Registration** - Complete authentication setup
2. **User Login** - Token generation and storage
3. **Get Profile** - Protected endpoint with full security checks
4. **Token Refresh** - Rotation and reuse detection
5. **Failed Request** - Error handling and circuit breaker

**For each flow, you'll see:**
- ✅ Exact timeline (0ms, 5ms, 10ms, etc.)
- ✅ Every layer traversed (Gateway → Service → Database → Redis)
- ✅ Code executed at each step
- ✅ Data transformations
- ✅ Decision points (if/else branches taken)
- ✅ Performance measurements
- ✅ Failure scenarios

---

# FLOW 1: User Registration

## Request

```bash
POST http://localhost:3000/api/auth/register
Content-Type: application/json

{
  "email": "john@example.com",
  "password": "SecurePass123",
  "firstName": "John",
  "lastName": "Doe"
}
```

---

## Timeline with Code

### T=0ms: Request Arrives at Gateway

**Location:** `services/api-gateway/src/server.js:40`

```javascript
// Request logging middleware
app.use((req, res, next) => {
  const requestId = req.id;
  logger.info('Request received', {
    requestId,
    method: req.method,      // 'POST'
    url: req.originalUrl,    // '/api/auth/register'
    ip: req.ip,              // '127.0.0.1'
    userAgent: req.get('user-agent')
  });
  
  // Track start time
  const start = Date.now();
  
  // Continue to next middleware
  next();
});
```

**Output:**
```json
{
  "level": "info",
  "timestamp": "2026-08-03T10:30:00.000Z",
  "message": "Request received",
  "requestId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "method": "POST",
  "url": "/api/auth/register",
  "ip": "127.0.0.1"
}
```

---

### T=2ms: Security Headers Applied

**Location:** `services/api-gateway/src/server.js:18`

```javascript
// Helmet middleware
app.use(helmet());
```

**Headers added:**
```
X-DNS-Prefetch-Control: off
X-Frame-Options: SAMEORIGIN
Strict-Transport-Security: max-age=15552000; includeSubDomains
X-Download-Options: noopen
X-Content-Type-Options: nosniff
X-XSS-Protection: 1; mode=block
```

**Why each matters:**
- `X-Frame-Options: SAMEORIGIN` - Prevents clickjacking (can't iframe from other sites)
- `X-Content-Type-Options: nosniff` - Prevents MIME sniffing attacks
- `X-XSS-Protection: 1; mode=block` - Browser-level XSS protection
- `Strict-Transport-Security` - Forces HTTPS for next 180 days

---

### T=3ms: CORS Check

**Location:** `services/api-gateway/src/server.js:21`

```javascript
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
}));
```

**Check:**
```javascript
// Request origin
const origin = req.headers.origin; // 'http://localhost:3000'

// Allowed origin
const allowedOrigin = 'http://localhost:3000';

// Match?
if (origin === allowedOrigin) {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  // ✅ PASS
}
```

**Headers added:**
```
Access-Control-Allow-Origin: http://localhost:3000
Access-Control-Allow-Credentials: true
```

---

### T=4ms: Body Parsed

**Location:** `services/api-gateway/src/server.js:29`

```javascript
app.use(express.json({ limit: '10mb' }));
```

**Parse JSON body:**
```javascript
// Raw body (string):
'{"email":"john@example.com","password":"SecurePass123","firstName":"John","lastName":"Doe"}'

// Parsed (object):
req.body = {
  email: 'john@example.com',
  password: 'SecurePass123',
  firstName: 'John',
  lastName: 'Doe'
}
```

---

### T=5ms: Request ID Assigned

**Location:** `services/api-gateway/src/server.js:33`

```javascript
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || uuidv4();
  res.setHeader('X-Request-ID', req.id);
  next();
});
```

**UUID generation:**
```javascript
// v4 = random UUID
const requestId = uuidv4();
// Result: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

req.id = requestId;
res.setHeader('X-Request-ID', requestId);
```

**Why request ID matters:**
- Trace request across services
- Correlate logs
- Debug distributed systems
- Answer: "What happened to request X?"

---

### T=6ms: Rate Limit Check

**Location:** `services/api-gateway/src/middleware/rateLimiter.js`

```javascript
// Registration rate limiter: 3 attempts per hour per IP
const registerRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: 3,                     // 3 requests
  keyGenerator: (req) => req.ip
});
```

**Check Redis:**
```javascript
const key = `ratelimit:register:${req.ip}`;
// key = 'ratelimit:register:127.0.0.1'

const current = await redis.get(key);
// current = null (first request)

if (current === null) {
  // First request, create counter
  await redis.set(key, '1', 'EX', 3600); // TTL = 1 hour
  // ✅ PASS (1/3 requests used)
} else if (parseInt(current) < 3) {
  // Increment counter
  await redis.incr(key);
  // ✅ PASS (2/3 requests used)
} else {
  // Rate limit exceeded
  // ❌ REJECT with 429
}
```

**Response headers:**
```
X-RateLimit-Limit: 3
X-RateLimit-Remaining: 2
X-RateLimit-Reset: 1691073600
```

**✅ PASS - Continue**

---

### T=8ms: Route Matched

**Location:** `services/api-gateway/src/routes/index.js`

```javascript
router.post('/api/auth/register', 
  registerRateLimiter,   // ✅ Passed
  proxy({                // Forward to User Service
    target: 'http://localhost:3001',
    pathRewrite: { '^/api': '/api' }
  })
);
```

**Route matched!** Forward to User Service at `http://localhost:3001/api/auth/register`

---

### T=10ms: Proxy Preparation

**Location:** `services/api-gateway/src/middleware/proxyAdvanced.js`

```javascript
// 1. Check bulkhead (concurrency limit)
const bulkhead = bulkheadIsolator.get('user-service');
await bulkhead.execute(async () => {
  // 2. Check circuit breaker
  const circuitBreaker = circuitBreakers.get('user-service');
  if (circuitBreaker.state === 'OPEN') {
    throw new Error('Circuit breaker OPEN');
  }
  
  // 3. Get connection from pool
  const agent = connectionPool.get('user-service');
  
  // 4. Forward request with retry
  const response = await retryStrategy.execute(async () => {
    return await axios.post(
      'http://localhost:3001/api/auth/register',
      req.body,
      {
        headers: {
          'X-Request-ID': req.id,
          'X-Forwarded-For': req.ip,
          'Content-Type': 'application/json'
        },
        httpAgent: agent,  // Reuse connection
        timeout: 30000
      }
    );
  });
  
  return response;
});
```

**Checks:**
- ✅ Bulkhead: 1/30 active requests (not full)
- ✅ Circuit breaker: CLOSED (healthy)
- ✅ Connection pool: 2 idle sockets available (reuse!)

---

### T=12ms: Request Forwarded to User Service

**Network transmission:** 2ms (localhost, very fast)

**Request arrives at User Service**

---

### T=14ms: User Service Receives Request

**Location:** `services/user-service/src/server.js:40`

```javascript
// Request logging
app.use((req, res, next) => {
  logger.info('User Service received request', {
    requestId: req.headers['x-request-id'],
    method: req.method,
    url: req.originalUrl,
    ip: req.headers['x-forwarded-for']
  });
  next();
});
```

**Output:**
```json
{
  "level": "info",
  "timestamp": "2026-08-03T10:30:00.014Z",
  "message": "User Service received request",
  "requestId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "method": "POST",
  "url": "/api/auth/register"
}
```

---

### T=16ms: Route Matched in User Service

**Location:** `services/user-service/src/routes/auth.routes.js`

```javascript
router.post('/register',
  registerRateLimiter,    // Already checked at Gateway, skip
  validateRegistration,   // ⬅ NEXT: Validation
  register               // ⬅ Then controller
);
```

---

### T=18ms: Input Validation

**Location:** `services/user-service/src/middleware/validators.js`

```javascript
const validateRegistration = (req, res, next) => {
  const { email, password, firstName, lastName } = req.body;
  
  // 1. Email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new ValidationError('Invalid email format');
  }
  // ✅ 'john@example.com' matches
  
  // 2. Password strength
  if (password.length < 8) {
    throw new ValidationError('Password must be at least 8 characters');
  }
  // ✅ 'SecurePass123' = 13 characters
  
  if (!/[A-Z]/.test(password)) {
    throw new ValidationError('Password must contain uppercase letter');
  }
  // ✅ 'S' and 'P' are uppercase
  
  if (!/[a-z]/.test(password)) {
    throw new ValidationError('Password must contain lowercase letter');
  }
  // ✅ 'ecure', 'ass' are lowercase
  
  if (!/[0-9]/.test(password)) {
    throw new ValidationError('Password must contain number');
  }
  // ✅ '123' are numbers
  
  // 3. Name validation
  if (!firstName || firstName.trim().length === 0) {
    throw new ValidationError('First name is required');
  }
  // ✅ 'John' is valid
  
  if (!lastName || lastName.trim().length === 0) {
    throw new ValidationError('Last name is required');
  }
  // ✅ 'Doe' is valid
  
  next(); // ✅ All validations passed!
};
```

---

### T=20ms: Register Controller Invoked

**Location:** `services/user-service/src/controllers/auth.controller.js`

```javascript
exports.register = async (req, res, next) => {
  try {
    const { email, password, firstName, lastName } = req.body;
    
    // Step 1: Check if email exists
    const existingUser = await db.query(
      'SELECT user_id FROM users WHERE email = $1',
      [email]
    );
    
    if (existingUser.rows.length > 0) {
      throw new ConflictError('Email already registered');
    }
    
    // Step 2: Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    
    // Step 3: Transaction (insert user + refresh token)
    const result = await db.transaction(async (client) => {
      // Insert user
      const userResult = await client.query(
        'INSERT INTO users (email, password_hash, first_name, last_name) VALUES ($1, $2, $3, $4) RETURNING *',
        [email, passwordHash, firstName, lastName]
      );
      
      const user = userResult.rows[0];
      
      // Generate tokens
      const accessToken = generateAccessToken(user);
      const refreshToken = generateRefreshToken(user);
      
      // Hash refresh token
      const tokenHash = crypto
        .createHash('sha256')
        .update(refreshToken)
        .digest('hex');
      
      // Store refresh token
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      await client.query(
        'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
        [user.user_id, tokenHash, expiresAt]
      );
      
      return { user, accessToken, refreshToken };
    });
    
    // Step 4: Return response
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
    
  } catch (err) {
    next(err);
  }
};
```

**Let's trace each step with timing...**

---

### T=22ms: Check Email Exists (Database Query)

```javascript
const existingUser = await db.query(
  'SELECT user_id FROM users WHERE email = $1',
  [email]
);
```

**Database query:**
```sql
SELECT user_id FROM users WHERE email = 'john@example.com';
```

**Database operation:**
1. Parse SQL (1ms)
2. Check query cache (1ms)
3. Use index on email column (idx_users_email)
4. Scan index (3ms)
5. No rows found (email doesn't exist)
6. Return empty result (1ms)

**Total: 6ms**

**Result:**
```javascript
existingUser.rows = []  // Empty array
existingUser.rows.length = 0  // ✅ Email available!
```

---

### T=28ms: Hash Password (Bcrypt)

```javascript
const saltRounds = 12;
const passwordHash = await bcrypt.hash(password, saltRounds);
```

**Bcrypt operation:**
```javascript
// Input: 'SecurePass123'
// Salt rounds: 12 = 2^12 = 4096 iterations

// Step 1: Generate salt (random)
const salt = await bcrypt.genSalt(12);
// salt = '$2b$12$LQv3c1yqBWVHxkd0LHAkCO'

// Step 2: Hash password with salt
const hash = await bcrypt.hash('SecurePass123', salt);
// hash = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOeih4ZBi9ALJ4HQAH9Xq9u4rO3JZ.vKe'

// Time: ~250ms (intentionally slow!)
```

**Why 250ms is GOOD:**
- Brute force attacker tries 1 million passwords
- Without bcrypt: 1 million hashes in 1 second
- With bcrypt: 1 million hashes in 69 hours!
- Makes brute force impractical ✅

---

### T=278ms: Start Database Transaction

```javascript
await db.transaction(async (client) => {
  // All queries use this client
  // Either ALL succeed or ALL rollback
});
```

**Transaction starts:**
```sql
BEGIN;
```

---

### T=280ms: Insert User

```javascript
const userResult = await client.query(
  'INSERT INTO users (email, password_hash, first_name, last_name) VALUES ($1, $2, $3, $4) RETURNING *',
  [email, passwordHash, firstName, lastName]
);
```

**SQL executed:**
```sql
INSERT INTO users (email, password_hash, first_name, last_name) 
VALUES (
  'john@example.com',
  '$2b$12$LQv3c1yqBWVHxkd0LHAkCOeih4ZBi9ALJ4HQAH9Xq9u4rO3JZ.vKe',
  'John',
  'Doe'
) 
RETURNING *;
```

**Database operation:**
1. Acquire lock on users table (1ms)
2. Generate user_id (SERIAL auto-increment) = 1
3. Insert row (5ms)
4. Update email index (3ms)
5. Set created_at, updated_at timestamps
6. Return inserted row (1ms)

**Total: 10ms**

**Result:**
```javascript
userResult.rows[0] = {
  user_id: 1,
  email: 'john@example.com',
  password_hash: '$2b$12$LQv3c1yqBWVHxkd0LHAkCOeih4ZBi9ALJ4HQAH9Xq9u4rO3JZ.vKe',
  first_name: 'John',
  last_name: 'Doe',
  role: 'user',
  created_at: '2026-08-03T10:30:00.290Z',
  updated_at: '2026-08-03T10:30:00.290Z'
}
```

---

### T=290ms: Generate Access Token

```javascript
const accessToken = generateAccessToken(user);
```

**Location:** `shared/auth/jwt.js`

```javascript
function generateAccessToken(user) {
  const payload = {
    sub: user.user_id,           // Subject (user ID)
    email: user.email,
    role: user.role,
    type: 'access',
    jti: uuidv4()                // JWT ID (for revocation)
  };
  
  return jwt.sign(payload, privateKey, {
    algorithm: 'RS256',
    expiresIn: '15m',            // 15 minutes
    issuer: 'api-gateway',
    audience: 'user-service'
  });
}
```

**JWT creation:**
```javascript
// Header
const header = {
  alg: 'RS256',
  typ: 'JWT'
};

// Payload
const payload = {
  sub: 1,
  email: 'john@example.com',
  role: 'user',
  type: 'access',
  jti: 'f1e2d3c4-b5a6-7890-cdef-123456789012',
  iat: 1691070600,              // Issued at (Unix timestamp)
  exp: 1691071500,              // Expires at (iat + 15 minutes)
  iss: 'api-gateway',
  aud: 'user-service'
};

// Encode header and payload (Base64URL)
const encodedHeader = base64UrlEncode(JSON.stringify(header));
// 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9'

const encodedPayload = base64UrlEncode(JSON.stringify(payload));
// 'eyJzdWIiOjEsImVtYWlsIjoiam9obkBleGFtcGxlLmNvbSIsInJvbGUiOiJ1c2VyIiwidHlwZSI6ImFjY2VzcyIsImp0aSI6ImYxZTJkM2M0LWI1YTYtNzg5MC1jZGVmLTEyMzQ1Njc4OTAxMiIsImlhdCI6MTY5MTA3MDYwMCwiZXhwIjoxNjkxMDcxNTAwLCJpc3MiOiJhcGktZ2F0ZXdheSIsImF1ZCI6InVzZXItc2VydmljZSJ9'

// Sign with private key (RS256)
const signature = rsaSign(encodedHeader + '.' + encodedPayload, privateKey);
// 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'

// Combine
const accessToken = encodedHeader + '.' + encodedPayload + '.' + signature;
// 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjEsImVtYWlsIjoiam9obkBleGFtcGxlLmNvbSIsInJvbGUiOiJ1c2VyIiwidHlwZSI6ImFjY2VzcyIsImp0aSI6ImYxZTJkM2M0LWI1YTYtNzg5MC1jZGVmLTEyMzQ1Njc4OTAxMiIsImlhdCI6MTY5MTA3MDYwMCwiZXhwIjoxNjkxMDcxNTAwLCJpc3MiOiJhcGktZ2F0ZXdheSIsImF1ZCI6InVzZXItc2VydmljZSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
```

**Time: 5ms** (signing with RSA private key)

---

### T=295ms: Generate Refresh Token

```javascript
const refreshToken = generateRefreshToken(user);
```

**Same process as access token, but:**
- `type: 'refresh'` (not 'access')
- `expiresIn: '7d'` (7 days, not 15 minutes)
- Different `jti` (unique identifier)

**Time: 5ms**

---

### T=300ms: Hash Refresh Token

```javascript
const tokenHash = crypto
  .createHash('sha256')
  .update(refreshToken)
  .digest('hex');
```

**SHA-256 hashing:**
```javascript
// Input: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...' (full JWT)
// Output: '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8'

// Why hash before storing?
// - If database is compromised, attacker can't use tokens
// - Need original token to match hash (irreversible)
// - Security in depth! ✅
```

**Time: 1ms** (SHA-256 is very fast)

---

### T=301ms: Calculate Expiry Date

```javascript
const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
```

**Calculation:**
```javascript
const now = Date.now();
// 1691070600000 (Unix timestamp in milliseconds)

const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
// 7 days × 24 hours × 60 minutes × 60 seconds × 1000 ms
// = 604,800,000 ms

const expiresAt = new Date(now + sevenDaysMs);
// 2026-08-10T10:30:00.301Z (7 days from now)
```

---

### T=302ms: Store Refresh Token

```javascript
await client.query(
  'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
  [user.user_id, tokenHash, expiresAt]
);
```

**SQL executed:**
```sql
INSERT INTO refresh_tokens (user_id, token_hash, expires_at) 
VALUES (
  1,
  '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8',
  '2026-08-10 10:30:00.301'
);
```

**Database operation:**
1. Acquire lock on refresh_tokens table (1ms)
2. Generate token_id (SERIAL) = 1
3. Insert row (3ms)
4. Update indexes:
   - idx_refresh_tokens_user_id
   - idx_refresh_tokens_token_hash
5. Set created_at timestamp (1ms)

**Total: 8ms**

---

### T=310ms: Commit Transaction

```javascript
}); // End of transaction block
```

**SQL executed:**
```sql
COMMIT;
```

**What COMMIT does:**
1. Make all changes permanent (2ms)
2. Release locks (1ms)
3. Write to WAL (Write-Ahead Log) (2ms)
4. Flush to disk (if configured) (5ms)

**Total: 10ms**

**✅ Transaction successful!**
- User inserted
- Refresh token stored
- Both committed atomically (all or nothing)

---

### T=320ms: Format Response

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
```

**Response object:**
```json
{
  "success": true,
  "data": {
    "user": {
      "userId": 1,
      "email": "john@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "createdAt": "2026-08-03T10:30:00.290Z"
    },
    "accessToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**Serialize to JSON:** 2ms

**Note:** Password hash NOT included in response (security!)

---

### T=322ms: Response Logged

**Location:** `services/user-service/src/server.js`

```javascript
res.on('finish', () => {
  const duration = Date.now() - start;
  logger.info('Request completed', {
    requestId: req.id,
    method: req.method,
    url: req.originalUrl,
    status: res.statusCode,
    duration
  });
});
```

**Output:**
```json
{
  "level": "info",
  "timestamp": "2026-08-03T10:30:00.322Z",
  "message": "Request completed",
  "requestId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "method": "POST",
  "url": "/api/auth/register",
  "status": 201,
  "duration": 308
}
```

**Duration breakdown:**
- Validation: 2ms
- Check email: 6ms
- Hash password: 250ms (bcrypt - intentionally slow!)
- Transaction: 10ms
- Insert user: 10ms
- Generate tokens: 10ms
- Hash token: 1ms
- Store token: 8ms
- Commit: 10ms
- Format response: 2ms
- **Total: 309ms**

---

### T=324ms: Response Sent to Gateway

**Network transmission:** 2ms

---

### T=326ms: Gateway Receives Response

**Location:** `services/api-gateway/src/middleware/proxyAdvanced.js`

```javascript
// Retry strategy succeeded on first attempt
// Circuit breaker records success
circuitBreaker.recordSuccess();

// Bulkhead releases slot
bulkhead.release();

// Forward response to client
return response;
```

**Updates:**
- Circuit breaker: `successCount++`, `failureCount = 0`
- Bulkhead: `activeRequests--` (30 → 29)
- Connection pool: Socket returned to pool (idle)

---

### T=328ms: Gateway Logs Response

```javascript
res.on('finish', () => {
  const duration = Date.now() - start;
  logger.info('Response sent', {
    requestId: req.id,
    method: req.method,
    url: req.originalUrl,
    status: res.statusCode,
    duration,
    service: 'user-service'
  });
});
```

**Output:**
```json
{
  "level": "info",
  "timestamp": "2026-08-03T10:30:00.328Z",
  "message": "Response sent",
  "requestId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "method": "POST",
  "url": "/api/auth/register",
  "status": 201,
  "duration": 328,
  "service": "user-service"
}
```

---

### T=330ms: Response Sent to Client

**Total time: 330ms**

**Client receives:**
```http
HTTP/1.1 201 Created
Content-Type: application/json
X-Request-ID: a1b2c3d4-e5f6-7890-abcd-ef1234567890
X-RateLimit-Limit: 3
X-RateLimit-Remaining: 2
X-RateLimit-Reset: 1691073600
X-Frame-Options: SAMEORIGIN
X-Content-Type-Options: nosniff
Access-Control-Allow-Origin: http://localhost:3000

{
  "success": true,
  "data": {
    "user": {
      "userId": 1,
      "email": "john@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "createdAt": "2026-08-03T10:30:00.290Z"
    },
    "accessToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

---

## Timeline Summary

| Time | Layer | Action | Duration |
|------|-------|--------|----------|
| 0ms | Gateway | Request received | - |
| 2ms | Gateway | Security headers applied | 2ms |
| 3ms | Gateway | CORS check | 1ms |
| 4ms | Gateway | Body parsed | 1ms |
| 5ms | Gateway | Request ID assigned | 1ms |
| 6ms | Gateway | Rate limit check (Redis) | 2ms |
| 8ms | Gateway | Route matched | - |
| 10ms | Gateway | Proxy preparation | 2ms |
| 12ms | Network | Forward to User Service | 2ms |
| 14ms | User Service | Request received | - |
| 16ms | User Service | Route matched | 2ms |
| 18ms | User Service | Validation | 2ms |
| 20ms | User Service | Controller invoked | - |
| 22ms | Database | Check email exists | 6ms |
| 28ms | User Service | Hash password (bcrypt) | 250ms |
| 278ms | Database | Start transaction | 2ms |
| 280ms | Database | Insert user | 10ms |
| 290ms | User Service | Generate access token | 5ms |
| 295ms | User Service | Generate refresh token | 5ms |
| 300ms | User Service | Hash refresh token | 1ms |
| 301ms | User Service | Calculate expiry | 1ms |
| 302ms | Database | Store refresh token | 8ms |
| 310ms | Database | Commit transaction | 10ms |
| 320ms | User Service | Format response | 2ms |
| 322ms | User Service | Log response | - |
| 324ms | Network | Send to Gateway | 2ms |
| 326ms | Gateway | Receive response | - |
| 328ms | Gateway | Log response | 2ms |
| 330ms | Client | Response delivered | - |

**Total: 330ms**

**Bottleneck: bcrypt hashing (250ms = 76% of total time)**

This is intentional! Bcrypt prevents brute force attacks.

---

## Database State After Request

**users table:**
```sql
SELECT * FROM users;
```
```
 user_id |       email        |                       password_hash                        | first_name | last_name | role |         created_at          |         updated_at          
---------+--------------------+------------------------------------------------------------+------------+-----------+------+-----------------------------+-----------------------------
       1 | john@example.com   | $2b$12$LQv3c1yqBWVHxkd0LHAkCOeih4ZBi9ALJ4HQAH9Xq9u4rO3JZ.vKe | John       | Doe       | user | 2026-08-03 10:30:00.290     | 2026-08-03 10:30:00.290
```

**refresh_tokens table:**
```sql
SELECT * FROM refresh_tokens;
```
```
 token_id | user_id |                          token_hash                          |       expires_at        |         created_at          
----------+---------+--------------------------------------------------------------+-------------------------+-----------------------------
        1 |       1 | 5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8 | 2026-08-10 10:30:00.301 | 2026-08-03 10:30:00.302
```

---

## Redis State After Request

```bash
redis-cli

127.0.0.1:6379> KEYS ratelimit:register:*
1) "ratelimit:register:127.0.0.1"

127.0.0.1:6379> GET ratelimit:register:127.0.0.1
"1"

127.0.0.1:6379> TTL ratelimit:register:127.0.0.1
(integer) 3594  # ~59 minutes remaining
```

---

## What If It Failed?

### Scenario 1: Email Already Exists

**T=22ms: Check Email Exists**

```javascript
const existingUser = await db.query(
  'SELECT user_id FROM users WHERE email = $1',
  [email]
);

if (existingUser.rows.length > 0) {
  // ❌ Email taken!
  throw new ConflictError('Email already registered');
}
```

**Error thrown:**
```javascript
ConflictError {
  message: 'Email already registered',
  statusCode: 409,
  code: 'CONFLICT'
}
```

**Caught by error handler:**
```javascript
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
      code: err.code,
      requestId: req.id
    }
  });
});
```

**Response (409 Conflict):**
```json
{
  "success": false,
  "error": {
    "message": "Email already registered",
    "code": "CONFLICT",
    "requestId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  }
}
```

**Total time: 28ms** (much faster, failed early!)

---

### Scenario 2: Database Connection Lost

**T=22ms: Database Query Fails**

```javascript
try {
  const existingUser = await db.query(
    'SELECT user_id FROM users WHERE email = $1',
    [email]
  );
} catch (err) {
  // ❌ Database unreachable
  throw new ServiceUnavailableError('Database connection failed');
}
```

**Error propagates to Gateway**

**Gateway receives 503 response**

**Retry strategy triggered:**
```javascript
// Attempt 1: Failed (ECONNREFUSED)
// Wait 100ms
// Attempt 2: Failed (ECONNREFUSED)
// Wait 200ms
// Attempt 3: Failed (ECONNREFUSED)
// Max retries exceeded
```

**Circuit breaker records failures:**
```javascript
failureCount++;  // 1
failureCount++;  // 2
failureCount++;  // 3
failureCount++;  // 4
failureCount++;  // 5

if (failureCount >= threshold) {
  state = 'OPEN';  // ⚠️ Circuit breaker opened!
}
```

**Response to client (503 Service Unavailable):**
```json
{
  "success": false,
  "error": {
    "message": "Service temporarily unavailable",
    "code": "SERVICE_UNAVAILABLE",
    "requestId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "retryAfter": 30
  }
}
```

**Total time: ~900ms** (3 retries with backoff)

---

**REQUEST-FLOW-COMPLETE Part 1 (Registration) Complete!** ✅

**You now understand:**
- ✅ Every single millisecond of request processing
- ✅ Every layer traversed (Gateway → Service → Database → Redis)
- ✅ Every security check applied
- ✅ Every database operation
- ✅ Token generation and storage
- ✅ Error handling and circuit breaker
- ✅ Performance bottlenecks (bcrypt)

**This is DEEP knowledge!** Most developers never learn this level of detail! 🚀

Ready for Part 2? (Login flow, token verification, refresh, failure scenarios) 🎯
