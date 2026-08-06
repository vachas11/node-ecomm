# COMPLETE REQUEST FLOW TRACING - PART 2

**Login, Protected Endpoints, Token Refresh, and Failure Scenarios**

---

# FLOW 2: User Login

## Request

```bash
POST http://localhost:3000/api/auth/login
Content-Type: application/json

{
  "email": "john@example.com",
  "password": "SecurePass123"
}
```

---

## Timeline with Code

### T=0ms: Request Arrives at Gateway

Same as registration flow:
- Security headers applied (2ms)
- CORS check (1ms)
- Body parsed (1ms)
- Request ID assigned (1ms)

**T=5ms: Ready for next middleware**

---

### T=5ms: Login Rate Limit Check

**Different from registration!** Login has stricter limits.

**Location:** `services/api-gateway/src/middleware/rateLimiter.js`

```javascript
// Login rate limiter: 5 attempts per 15 minutes per IP
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 5,                     // 5 attempts
  keyGenerator: (req) => {
    // Combine IP + email for more granular limiting
    const email = req.body.email || '';
    return `${req.ip}:${email}`;
  }
});
```

**Redis check:**
```javascript
const key = `ratelimit:login:john@example.com:127.0.0.1`;

const current = await redis.get(key);
// current = '2' (2 previous attempts)

if (parseInt(current) < 5) {
  await redis.incr(key);
  // current = 3
  // ✅ PASS (3/5 attempts used)
} else {
  // ❌ RATE LIMITED
  throw new RateLimitError('Too many login attempts');
}
```

**✅ PASS - Continue**

**Time: 7ms (Redis read + increment)**

---

### T=12ms: Route Matched & Forwarded

Gateway forwards to User Service: `POST http://localhost:3001/api/auth/login`

---

### T=14ms: User Service Receives Request

### T=16ms: Route Matched

**Location:** `services/user-service/src/routes/auth.routes.js`

```javascript
router.post('/login',
  loginRateLimiter,      // Skip (already checked at Gateway)
  validateLogin,         // ⬅ NEXT
  login                  // ⬅ Then controller
);
```

---

### T=18ms: Input Validation

**Location:** `services/user-service/src/middleware/validators.js`

```javascript
const validateLogin = (req, res, next) => {
  const { email, password } = req.body;
  
  // 1. Email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new ValidationError('Invalid email format');
  }
  // ✅ 'john@example.com' is valid
  
  // 2. Password present
  if (!password || password.length === 0) {
    throw new ValidationError('Password is required');
  }
  // ✅ 'SecurePass123' is present
  
  next();
};
```

**✅ PASS**

---

### T=20ms: Login Controller Invoked

**Location:** `services/user-service/src/controllers/auth.controller.js`

```javascript
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    
    // Step 1: Find user by email
    const userResult = await db.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    
    if (userResult.rows.length === 0) {
      // Generic error message (don't reveal if email exists)
      throw new ValidationError('Invalid email or password');
    }
    
    const user = userResult.rows[0];
    
    // Step 2: Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!isValidPassword) {
      throw new ValidationError('Invalid email or password');
    }
    
    // Step 3: Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
    
    // Step 4: Token rotation (delete old, insert new)
    await db.transaction(async (client) => {
      // Delete old refresh tokens for this user
      await client.query(
        'DELETE FROM refresh_tokens WHERE user_id = $1',
        [user.user_id]
      );
      
      // Store new refresh token
      const tokenHash = crypto
        .createHash('sha256')
        .update(refreshToken)
        .digest('hex');
      
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      
      await client.query(
        'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
        [user.user_id, tokenHash, expiresAt]
      );
    });
    
    // Step 5: Return response
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
    
  } catch (err) {
    next(err);
  }
};
```

---

### T=22ms: Find User by Email

```javascript
const userResult = await db.query(
  'SELECT * FROM users WHERE email = $1',
  [email]
);
```

**SQL executed:**
```sql
SELECT * FROM users WHERE email = 'john@example.com';
```

**Database operation:**
1. Parse SQL (1ms)
2. Use index idx_users_email (B-tree lookup) (2ms)
3. Scan index to find user_id = 1 (1ms)
4. Fetch full row from table (2ms)
5. Return result (1ms)

**Total: 7ms**

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

**✅ User found**

---

### T=29ms: Verify Password

```javascript
const isValidPassword = await bcrypt.compare(password, user.password_hash);
```

**Bcrypt comparison:**
```javascript
// Input password: 'SecurePass123'
// Stored hash: '$2b$12$LQv3c1yqBWVHxkd0LHAkCOeih4ZBi9ALJ4HQAH9Xq9u4rO3JZ.vKe'

// Extract salt from hash
const salt = hash.substring(0, 29);
// '$2b$12$LQv3c1yqBWVHxkd0LHAkCO'

// Hash input password with same salt
const candidateHash = await bcrypt.hash('SecurePass123', salt);
// '$2b$12$LQv3c1yqBWVHxkd0LHAkCOeih4ZBi9ALJ4HQAH9Xq9u4rO3JZ.vKe'

// Compare hashes (constant-time comparison!)
const isMatch = crypto.timingSafeEqual(
  Buffer.from(hash),
  Buffer.from(candidateHash)
);
// true

return isMatch;
```

**Time: 250ms** (same as hashing - intentionally slow!)

**Why constant-time comparison?**
```javascript
// BAD (timing attack vulnerable):
if (hash === candidateHash) { ... }
// Stops comparing at first different character
// Attacker measures time to detect how many characters match

// GOOD (timing attack resistant):
crypto.timingSafeEqual(hash, candidateHash);
// Always compares entire string
// Time doesn't reveal how many characters match
```

**✅ Password valid**

---

### T=279ms: Generate Tokens

```javascript
const accessToken = generateAccessToken(user);
const refreshToken = generateRefreshToken(user);
```

**Access token:**
```javascript
// Payload
{
  sub: 1,
  email: 'john@example.com',
  role: 'user',
  type: 'access',
  jti: 'new-uuid-1',
  iat: 1691073000,
  exp: 1691073900,  // 15 minutes later
  iss: 'api-gateway',
  aud: 'user-service'
}
```

**Refresh token:**
```javascript
// Payload
{
  sub: 1,
  email: 'john@example.com',
  type: 'refresh',
  jti: 'new-uuid-2',
  iat: 1691073000,
  exp: 1691677800,  // 7 days later
  iss: 'api-gateway',
  aud: 'user-service'
}
```

**Time: 10ms** (5ms each)

---

### T=289ms: Token Rotation Transaction

**Why token rotation?**

**Without rotation:**
```
Login 1: Token A stored
Login 2: Token A + Token B stored
Login 3: Token A + Token B + Token C stored
...
User has 50 active tokens!
```

**With rotation:**
```
Login 1: Token A stored
Login 2: Delete Token A → Store Token B (only 1 token)
Login 3: Delete Token B → Store Token C (only 1 token)
...
User always has exactly 1 token!
```

**Benefits:**
- Logout all devices by deleting that 1 token
- No token accumulation
- Simpler token management
- More secure (less attack surface)

**Transaction:**
```javascript
await db.transaction(async (client) => {
  // Step 1: Delete old tokens
  await client.query(
    'DELETE FROM refresh_tokens WHERE user_id = $1',
    [user.user_id]
  );
  
  // Step 2: Hash new token
  const tokenHash = crypto
    .createHash('sha256')
    .update(refreshToken)
    .digest('hex');
  
  // Step 3: Store new token
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  
  await client.query(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [user.user_id, tokenHash, expiresAt]
  );
});
```

**Timeline:**

**T=291ms: BEGIN transaction**
```sql
BEGIN;
```

**T=293ms: Delete old tokens**
```sql
DELETE FROM refresh_tokens WHERE user_id = 1;
```

**Database operation:**
1. Acquire lock (1ms)
2. Find rows with user_id = 1 (use index) (2ms)
3. Delete 1 row (token_id = 1) (2ms)
4. Update indexes (2ms)

**Total: 7ms**

**Deleted:** 1 row (old refresh token from registration)

**T=300ms: Hash new token**
```javascript
const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
```

**Time: 1ms**

**T=301ms: Store new token**
```sql
INSERT INTO refresh_tokens (user_id, token_hash, expires_at) 
VALUES (1, '<new-hash>', '2026-08-10 10:35:00');
```

**Database operation:**
1. Generate token_id = 2
2. Insert row (3ms)
3. Update indexes (3ms)

**Total: 6ms**

**T=307ms: COMMIT transaction**
```sql
COMMIT;
```

**Time: 3ms**

**Total transaction time: 16ms**

---

### T=307ms: Format Response

```javascript
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
```

**Time: 2ms**

---

### T=309ms: Response Logged & Sent

**User Service logs:**
```json
{
  "level": "info",
  "message": "Login successful",
  "userId": 1,
  "email": "john@example.com",
  "duration": 289,
  "requestId": "b2c3d4e5-f6a7-8901-bcde-f23456789013"
}
```

---

### T=311ms: Response Returns to Gateway

**T=313ms: Gateway Logs & Sends to Client**

**Total time: 315ms**

---

## Login Timeline Summary

| Time | Layer | Action | Duration |
|------|-------|--------|----------|
| 0ms | Gateway | Request received | - |
| 5ms | Gateway | Rate limit check (Redis) | 7ms |
| 12ms | Network | Forward to User Service | 2ms |
| 20ms | User Service | Validation | 2ms |
| 22ms | Database | Find user by email | 7ms |
| 29ms | User Service | Verify password (bcrypt) | 250ms |
| 279ms | User Service | Generate tokens | 10ms |
| 289ms | Database | Transaction BEGIN | 2ms |
| 291ms | Database | Delete old tokens | 9ms |
| 300ms | User Service | Hash token | 1ms |
| 301ms | Database | Store new token | 6ms |
| 307ms | Database | COMMIT | 3ms |
| 310ms | User Service | Format response | 2ms |
| 313ms | Client | Response delivered | - |

**Total: 315ms**

**Bottleneck: bcrypt.compare (250ms = 79%)**

This is intentional! Prevents brute force attacks.

---

## Database State After Login

**refresh_tokens table:**
```sql
SELECT * FROM refresh_tokens;
```
```
 token_id | user_id |                          token_hash                          |       expires_at        |         created_at          
----------+---------+--------------------------------------------------------------+-------------------------+-----------------------------
        2 |       1 | 8f3a2b1c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e | 2026-08-10 10:35:00.301 | 2026-08-03 10:35:00.301
```

**Note:** token_id = 1 deleted, token_id = 2 inserted (rotation!)

---

## Redis State After Login

```bash
127.0.0.1:6379> GET ratelimit:login:john@example.com:127.0.0.1
"3"

127.0.0.1:6379> TTL ratelimit:login:john@example.com:127.0.0.1
(integer) 893  # ~14 minutes remaining
```

---

# FLOW 3: Get Profile (Protected Endpoint)

## Request

```bash
GET http://localhost:3000/api/auth/profile
Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
```

**This is where JWT verification happens!**

---

## Timeline with Code

### T=0ms: Request Arrives at Gateway

Standard processing:
- Security headers (2ms)
- CORS (1ms)
- Request ID (1ms)

**T=4ms: Ready for next middleware**

---

### T=4ms: Rate Limit Check

**General API rate limiter:** 100 requests per 15 minutes

```javascript
const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 100,                   // 100 requests
  keyGenerator: (req) => req.ip
});
```

**Redis check:**
```javascript
const key = `ratelimit:api:127.0.0.1`;

const current = await redis.get(key);
// current = '15' (15 requests made)

if (parseInt(current) < 100) {
  await redis.incr(key);
  // current = 16
  // ✅ PASS (16/100 requests used)
}
```

**Time: 2ms**

---

### T=6ms: Route Matched

**Location:** `services/api-gateway/src/routes/index.js`

```javascript
router.get('/api/auth/profile',
  authenticate,    // ⬅ JWT VERIFICATION HERE!
  proxy({ target: 'http://localhost:3001' })
);
```

---

### T=6ms: Authentication Middleware

**Location:** `services/api-gateway/src/middleware/authenticate.js`

```javascript
const authenticate = async (req, res, next) => {
  try {
    // Step 1: Extract token from header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('Authentication required', 'NO_TOKEN');
    }
    
    const token = authHeader.substring(7); // Remove 'Bearer '
    
    // Step 2: Verify JWT signature
    const decoded = jwt.verify(token, publicKey, {
      algorithms: ['RS256'],
      issuer: 'api-gateway',
      audience: 'user-service'
    });
    
    // Step 3: Check token type
    if (decoded.type !== 'access') {
      throw new UnauthorizedError('Invalid token type', 'INVALID_TOKEN');
    }
    
    // Step 4: Check blacklist
    const isBlacklisted = await redis.get(`blacklist:${decoded.jti}`);
    
    if (isBlacklisted) {
      throw new UnauthorizedError('Token has been revoked', 'TOKEN_REVOKED');
    }
    
    // Step 5: Attach user to request
    req.user = {
      userId: decoded.sub,
      email: decoded.email,
      role: decoded.role
    };
    
    next();
    
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new UnauthorizedError('Token expired', 'TOKEN_EXPIRED');
    } else if (err.name === 'JsonWebTokenError') {
      throw new UnauthorizedError('Invalid token', 'INVALID_TOKEN');
    }
    throw err;
  }
};
```

**Let's trace each step...**

---

### T=6ms: Extract Token

```javascript
const authHeader = req.headers.authorization;
// 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjEsImVtYWlsIjoiam9obkBleGFtcGxlLmNvbSIsInJvbGUiOiJ1c2VyIiwidHlwZSI6ImFjY2VzcyIsImp0aSI6Im5ldy11dWlkLTEiLCJpYXQiOjE2OTEwNzMwMDAsImV4cCI6MTY5MTA3MzkwMCwiaXNzIjoiYXBpLWdhdGV3YXkiLCJhdWQiOiJ1c2VyLXNlcnZpY2UifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'

if (!authHeader || !authHeader.startsWith('Bearer ')) {
  throw new UnauthorizedError('Authentication required');
}

const token = authHeader.substring(7);
// 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjEsImVtYWlsIjoiam9obkBleGFtcGxlLmNvbSIsInJvbGUiOiJ1c2VyIiwidHlwZSI6ImFjY2VzcyIsImp0aSI6Im5ldy11dWlkLTEiLCJpYXQiOjE2OTEwNzMwMDAsImV4cCI6MTY5MTA3MzkwMCwiaXNzIjoiYXBpLWdhdGV3YXkiLCJhdWQiOiJ1c2VyLXNlcnZpY2UifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
```

**✅ Token extracted**

---

### T=7ms: Verify JWT Signature

```javascript
const decoded = jwt.verify(token, publicKey, {
  algorithms: ['RS256'],
  issuer: 'api-gateway',
  audience: 'user-service'
});
```

**JWT verification steps:**

**1. Split token into parts**
```javascript
const parts = token.split('.');
// parts[0] = header (base64url encoded)
// parts[1] = payload (base64url encoded)
// parts[2] = signature (base64url encoded)
```

**2. Decode header**
```javascript
const header = JSON.parse(base64UrlDecode(parts[0]));
// { alg: 'RS256', typ: 'JWT' }

// Check algorithm
if (header.alg !== 'RS256') {
  throw new Error('Invalid algorithm');
}
// ✅ RS256 matches
```

**3. Decode payload**
```javascript
const payload = JSON.parse(base64UrlDecode(parts[1]));
// {
//   sub: 1,
//   email: 'john@example.com',
//   role: 'user',
//   type: 'access',
//   jti: 'new-uuid-1',
//   iat: 1691073000,
//   exp: 1691073900,
//   iss: 'api-gateway',
//   aud: 'user-service'
// }
```

**4. Verify signature**
```javascript
// Re-calculate signature from header + payload
const message = parts[0] + '.' + parts[1];

const calculatedSignature = rsaVerify(
  message,
  parts[2],  // Provided signature
  publicKey
);

// RSA verification:
// 1. Decrypt signature using public key
// 2. Compare decrypted hash with hash of message
// 3. If match → signature valid

if (!calculatedSignature) {
  throw new Error('Invalid signature');
}
// ✅ Signature valid (token not tampered!)
```

**5. Verify expiry**
```javascript
const now = Math.floor(Date.now() / 1000);
// 1691073600 (current Unix timestamp)

if (payload.exp < now) {
  throw new TokenExpiredError('Token expired');
}
// exp = 1691073900 (15 minutes from login)
// now = 1691073600 (10 minutes from login)
// exp > now
// ✅ Token not expired (5 minutes remaining)
```

**6. Verify issuer**
```javascript
if (payload.iss !== 'api-gateway') {
  throw new Error('Invalid issuer');
}
// ✅ Issuer matches
```

**7. Verify audience**
```javascript
if (payload.aud !== 'user-service') {
  throw new Error('Invalid audience');
}
// ✅ Audience matches
```

**Time: 10ms** (RSA signature verification is slower than HMAC)

**Result:**
```javascript
decoded = {
  sub: 1,
  email: 'john@example.com',
  role: 'user',
  type: 'access',
  jti: 'new-uuid-1',
  iat: 1691073000,
  exp: 1691073900,
  iss: 'api-gateway',
  aud: 'user-service'
}
```

**✅ JWT valid**

---

### T=17ms: Check Token Type

```javascript
if (decoded.type !== 'access') {
  throw new UnauthorizedError('Invalid token type');
}
// type = 'access'
// ✅ Correct type (not refresh or service token)
```

---

### T=18ms: Check Blacklist

```javascript
const isBlacklisted = await redis.get(`blacklist:${decoded.jti}`);
```

**Redis operation:**
```javascript
const key = `blacklist:new-uuid-1`;
const value = await redis.get(key);
// value = null (token not blacklisted)

if (value !== null) {
  throw new UnauthorizedError('Token has been revoked');
}
// ✅ Token not blacklisted
```

**Time: 2ms** (Redis is fast!)

**Why check blacklist?**
- User logs out → token added to blacklist
- Token still valid (not expired) but revoked
- Without blacklist: user can't truly logout!
- With blacklist: logout works ✅

---

### T=20ms: Attach User to Request

```javascript
req.user = {
  userId: decoded.sub,       // 1
  email: decoded.email,      // 'john@example.com'
  role: decoded.role         // 'user'
};
```

**req.user now available in downstream handlers!**

---

### T=20ms: Authentication Complete

**Total authentication time: 14ms**
- Extract token: 1ms
- Verify signature: 10ms
- Check type: <1ms
- Check blacklist: 2ms
- Attach user: <1ms

**✅ Authentication successful!**

---

### T=22ms: Proxy Preparation

Same as before:
- Bulkhead check (1ms)
- Circuit breaker check (1ms)
- Connection pool get (1ms)

---

### T=25ms: Forward to User Service

**Headers added:**
```javascript
headers: {
  'X-Request-ID': req.id,
  'X-Forwarded-For': req.ip,
  'X-User-ID': req.user.userId,      // Pass user ID!
  'X-User-Email': req.user.email,
  'X-User-Role': req.user.role
}
```

**Why pass user in headers?**
- User Service doesn't need to verify JWT again
- Gateway already verified it
- Faster (no duplicate work)
- Single source of truth (Gateway = auth authority)

---

### T=27ms: User Service Receives Request

**Location:** `services/user-service/src/controllers/auth.controller.js`

```javascript
exports.getProfile = async (req, res, next) => {
  try {
    // User ID from Gateway (already authenticated!)
    const userId = req.headers['x-user-id'];
    
    // Query database for latest user data
    const result = await db.query(
      'SELECT user_id, email, first_name, last_name, role, created_at, updated_at FROM users WHERE user_id = $1',
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
    
  } catch (err) {
    next(err);
  }
};
```

---

### T=29ms: Query User from Database

```sql
SELECT user_id, email, first_name, last_name, role, created_at, updated_at 
FROM users 
WHERE user_id = 1;
```

**Database operation:**
1. Parse SQL (1ms)
2. Primary key lookup (B-tree) (2ms)
3. Fetch row (2ms)
4. Return result (1ms)

**Total: 6ms**

**Why query database instead of using JWT data?**

**Bad approach (use JWT data):**
```javascript
// JWT has: email, role
// Just return that?
res.json({
  user: {
    email: req.user.email,
    role: req.user.role
  }
});
// ❌ Problem: What if user updated their name?
// ❌ Problem: What if admin changed their role?
// ❌ JWT is stale (issued 10 minutes ago)!
```

**Good approach (query database):**
```javascript
// Query database for current data
const user = await db.query('SELECT * FROM users WHERE user_id = $1', [userId]);
// ✅ Always returns latest data
// ✅ Name updates reflected
// ✅ Role changes reflected
// ✅ Only 6ms overhead (worth it!)
```

**Result:**
```javascript
user = {
  user_id: 1,
  email: 'john@example.com',
  first_name: 'John',
  last_name: 'Doe',
  role: 'user',
  created_at: '2026-08-03T10:30:00.290Z',
  updated_at: '2026-08-03T10:30:00.290Z'
}
```

---

### T=35ms: Format & Send Response

```javascript
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
```

**Time: 2ms**

---

### T=37ms: Response Returns to Gateway

### T=39ms: Gateway Sends to Client

**Total time: 40ms**

**Super fast!** No bcrypt, simple database query.

---

## Get Profile Timeline Summary

| Time | Layer | Action | Duration |
|------|-------|--------|----------|
| 0ms | Gateway | Request received | - |
| 4ms | Gateway | Rate limit check | 2ms |
| 6ms | Gateway | Extract token | 1ms |
| 7ms | Gateway | Verify JWT signature | 10ms |
| 17ms | Gateway | Check token type | <1ms |
| 18ms | Gateway | Check blacklist (Redis) | 2ms |
| 20ms | Gateway | Attach user to request | <1ms |
| 22ms | Gateway | Proxy preparation | 3ms |
| 25ms | Network | Forward to User Service | 2ms |
| 27ms | User Service | Extract user ID from headers | <1ms |
| 29ms | Database | Query user | 6ms |
| 35ms | User Service | Format response | 2ms |
| 37ms | Network | Return to Gateway | 2ms |
| 39ms | Client | Response delivered | - |

**Total: 40ms**

**Breakdown:**
- Gateway (auth): 16ms (40%)
- Network: 4ms (10%)
- Database: 6ms (15%)
- User Service: 2ms (5%)
- Other: 12ms (30%)

**Most time in JWT verification (10ms) - worth it for security!**

---

# FLOW 4: Token Refresh

## Request

```bash
POST http://localhost:3000/api/auth/refresh
Content-Type: application/json

{
  "refreshToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

---

## Timeline with Code

### T=0ms: Standard Gateway Processing

- Security headers (2ms)
- CORS (1ms)
- Body parsing (1ms)
- Request ID (1ms)
- Rate limit (2ms)

**T=7ms: Ready to forward**

---

### T=9ms: User Service Receives Request

**Location:** `services/user-service/src/controllers/auth.controller.js`

```javascript
exports.refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    
    // Step 1: Verify refresh token
    const decoded = jwt.verify(refreshToken, publicKey, {
      algorithms: ['RS256']
    });
    
    // Step 2: Check token type
    if (decoded.type !== 'refresh') {
      throw new UnauthorizedError('Invalid token type');
    }
    
    // Step 3: Hash token
    const tokenHash = crypto
      .createHash('sha256')
      .update(refreshToken)
      .digest('hex');
    
    // Step 4: Look up token in database
    const tokenResult = await db.query(
      'SELECT * FROM refresh_tokens WHERE token_hash = $1',
      [tokenHash]
    );
    
    if (tokenResult.rows.length === 0) {
      throw new UnauthorizedError('Invalid refresh token');
    }
    
    const storedToken = tokenResult.rows[0];
    
    // Step 5: Check expiry
    if (new Date(storedToken.expires_at) < new Date()) {
      throw new UnauthorizedError('Refresh token expired');
    }
    
    // Step 6: TOKEN REUSE DETECTION!
    const tokenAge = Date.now() - new Date(storedToken.created_at).getTime();
    
    if (tokenAge < 5000) {  // Less than 5 seconds old
      // Possible token reuse attack!
      // Revoke ALL tokens for this user
      await db.query(
        'DELETE FROM refresh_tokens WHERE user_id = $1',
        [storedToken.user_id]
      );
      
      throw new UnauthorizedError('Token reuse detected, all tokens revoked');
    }
    
    // Step 7: Get user
    const userResult = await db.query(
      'SELECT * FROM users WHERE user_id = $1',
      [storedToken.user_id]
    );
    
    const user = userResult.rows[0];
    
    // Step 8: Generate new tokens
    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user);
    
    // Step 9: Token rotation
    await db.transaction(async (client) => {
      // Delete old refresh token
      await client.query(
        'DELETE FROM refresh_tokens WHERE token_id = $1',
        [storedToken.token_id]
      );
      
      // Store new refresh token
      const newTokenHash = crypto
        .createHash('sha256')
        .update(newRefreshToken)
        .digest('hex');
      
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      
      await client.query(
        'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
        [user.user_id, newTokenHash, expiresAt]
      );
    });
    
    // Step 10: Return new tokens
    res.json({
      success: true,
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken
      }
    });
    
  } catch (err) {
    next(err);
  }
};
```

---

### T=11ms: Verify Refresh Token

```javascript
const decoded = jwt.verify(refreshToken, publicKey, {
  algorithms: ['RS256']
});
```

**Same verification as access token:**
- Split into parts (header, payload, signature)
- Verify signature with public key
- Check expiry

**Time: 10ms**

**Result:**
```javascript
decoded = {
  sub: 1,
  email: 'john@example.com',
  type: 'refresh',
  jti: 'new-uuid-2',
  iat: 1691073000,
  exp: 1691677800,  // 7 days later
  iss: 'api-gateway',
  aud: 'user-service'
}
```

---

### T=21ms: Check Token Type

```javascript
if (decoded.type !== 'refresh') {
  throw new UnauthorizedError('Invalid token type');
}
// type = 'refresh'
// ✅ Correct type
```

**Why check?**
- Prevent using access token as refresh token
- Different tokens for different purposes
- Security principle: least privilege

---

### T=22ms: Hash Token

```javascript
const tokenHash = crypto
  .createHash('sha256')
  .update(refreshToken)
  .digest('hex');
```

**Time: 1ms**

**Why hash?**
- Database stores hash, not original token
- If database compromised, attacker can't use tokens
- Must have original token to generate matching hash

---

### T=23ms: Look Up Token in Database

```sql
SELECT * FROM refresh_tokens WHERE token_hash = '<hash>';
```

**Database operation:**
1. Parse SQL (1ms)
2. Index lookup (idx_refresh_tokens_token_hash) (2ms)
3. Fetch row (2ms)
4. Return result (1ms)

**Total: 6ms**

**Result:**
```javascript
storedToken = {
  token_id: 2,
  user_id: 1,
  token_hash: '8f3a2b1c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e',
  expires_at: '2026-08-10 10:35:00.301',
  created_at: '2026-08-03 10:35:00.301'
}
```

**✅ Token found in database**

---

### T=29ms: Check Expiry

```javascript
if (new Date(storedToken.expires_at) < new Date()) {
  throw new UnauthorizedError('Refresh token expired');
}

// expires_at = '2026-08-10 10:35:00.301' (7 days from login)
// now = '2026-08-03 10:35:30.000' (30 seconds from login)
// expires_at > now
// ✅ Not expired (6 days 23 hours remaining)
```

---

### T=30ms: TOKEN REUSE DETECTION 🚨

**This is critical for security!**

```javascript
const tokenAge = Date.now() - new Date(storedToken.created_at).getTime();

if (tokenAge < 5000) {  // Less than 5 seconds old
  // Possible token reuse attack!
  // Revoke ALL tokens for this user
  await db.query(
    'DELETE FROM refresh_tokens WHERE user_id = $1',
    [storedToken.user_id]
  );
  
  throw new UnauthorizedError('Token reuse detected, all tokens revoked');
}
```

**Attack scenario:**

```
T=0: User refreshes token
     - Old token deleted
     - New token stored

T=1: Attacker intercepts and uses old token
     - Token deleted < 5 seconds ago
     - 🚨 REUSE DETECTED!
     - All user tokens revoked
     - User must login again
```

**Calculation:**
```javascript
// Token created: '2026-08-03 10:35:00.301'
// Now: '2026-08-03 10:35:30.000'
// Age: 30,000ms (30 seconds)

if (tokenAge < 5000) {
  // 30,000 < 5,000 = false
  // ✅ No reuse detected (token is old enough)
}
```

**Why 5 seconds?**
- If token used within 5 seconds of creation = suspicious
- Legitimate user unlikely to refresh twice in 5 seconds
- If detected = attacker probably intercepted token
- Better safe than sorry: revoke all tokens!

**Time: 1ms**

---

### T=31ms: Get User

```sql
SELECT * FROM users WHERE user_id = 1;
```

**Time: 6ms**

**Result:** User data (same as before)

---

### T=37ms: Generate New Tokens

```javascript
const newAccessToken = generateAccessToken(user);
const newRefreshToken = generateRefreshToken(user);
```

**Time: 10ms**

**New tokens have:**
- Different JTI (unique identifier)
- New IAT (issued at timestamp)
- New EXP (expiry timestamp)
- Same user data (sub, email, role)

---

### T=47ms: Token Rotation Transaction

**BEGIN transaction**

**T=49ms: Delete old refresh token**
```sql
DELETE FROM refresh_tokens WHERE token_id = 2;
```

**Time: 3ms**

**T=52ms: Hash new token**
```javascript
const newTokenHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');
```

**Time: 1ms**

**T=53ms: Store new refresh token**
```sql
INSERT INTO refresh_tokens (user_id, token_hash, expires_at) 
VALUES (1, '<new-hash>', '2026-08-10 10:35:47');
```

**Time: 6ms**

**T=59ms: COMMIT transaction**

**Total transaction time: 12ms**

---

### T=59ms: Format & Send Response

```javascript
res.json({
  success: true,
  data: {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken
  }
});
```

**Time: 2ms**

---

### T=61ms: Response Returns to Client

**Total time: 62ms**

**Very fast!** No bcrypt, simple database operations.

---

## Token Refresh Timeline Summary

| Time | Layer | Action | Duration |
|------|-------|--------|----------|
| 0ms | Gateway | Standard processing | 7ms |
| 9ms | User Service | Verify refresh token | 10ms |
| 21ms | User Service | Check token type | <1ms |
| 22ms | User Service | Hash token | 1ms |
| 23ms | Database | Look up token | 6ms |
| 29ms | User Service | Check expiry | 1ms |
| 30ms | User Service | Token reuse detection | 1ms |
| 31ms | Database | Get user | 6ms |
| 37ms | User Service | Generate new tokens | 10ms |
| 47ms | Database | Transaction BEGIN | 2ms |
| 49ms | Database | Delete old token | 3ms |
| 52ms | User Service | Hash new token | 1ms |
| 53ms | Database | Store new token | 6ms |
| 59ms | Database | COMMIT | 3ms |
| 62ms | Client | Response delivered | - |

**Total: 62ms**

**Breakdown:**
- JWT verification: 10ms (16%)
- Database queries: 15ms (24%)
- Transaction: 15ms (24%)
- Token generation: 10ms (16%)
- Other: 12ms (20%)

---

# FLOW 5: Failed Request (Circuit Breaker)

## Scenario: User Service is Down

**User makes request while User Service is offline**

---

## Timeline with Code

### T=0ms: Request Arrives

```bash
GET http://localhost:3000/api/auth/profile
Authorization: Bearer <valid-token>
```

---

### T=0-20ms: Standard Processing

- Security headers
- CORS
- Rate limit
- JWT verification (✅ Token valid)
- Blacklist check (✅ Not blacklisted)

**All checks pass!**

---

### T=22ms: Proxy Preparation

**Location:** `services/api-gateway/src/middleware/proxyAdvanced.js`

```javascript
// 1. Check bulkhead
const bulkhead = bulkheadIsolator.get('user-service');
await bulkhead.execute(async () => {
  
  // 2. Check circuit breaker
  const circuitBreaker = circuitBreakers.get('user-service');
  
  if (circuitBreaker.state === 'OPEN') {
    // ❌ Circuit breaker is OPEN!
    throw new ServiceUnavailableError('Circuit breaker OPEN for user-service');
  }
  
  // 3. Try to forward request
  const response = await retryStrategy.execute(async () => {
    return await axios.get(
      'http://localhost:3001/api/auth/profile',
      {
        headers: { 'X-User-ID': req.user.userId },
        httpAgent: connectionPool.get('user-service'),
        timeout: 30000
      }
    );
  });
  
  return response;
});
```

---

### T=24ms: Check Circuit Breaker State

**Current state (after 5 previous failures):**
```javascript
circuitBreaker = {
  state: 'OPEN',
  failureCount: 5,
  threshold: 5,
  lastFailureTime: Date.now() - 10000,  // 10 seconds ago
  resetTimeout: 30000  // 30 seconds
}
```

**Check:**
```javascript
if (circuitBreaker.state === 'OPEN') {
  // ❌ Circuit breaker OPEN!
  throw new ServiceUnavailableError('Circuit breaker OPEN for user-service');
}
```

**❌ Request rejected immediately (fail fast!)**

**Time: 2ms** (no network call attempted!)

---

### T=26ms: Error Handler

**Location:** `services/api-gateway/src/middleware/errorHandler.js`

```javascript
app.use((err, req, res, next) => {
  if (err instanceof ServiceUnavailableError) {
    res.status(503).json({
      success: false,
      error: {
        message: 'Service temporarily unavailable',
        code: 'CIRCUIT_BREAKER_OPEN',
        requestId: req.id,
        retryAfter: 30  // Seconds until circuit breaker resets
      }
    });
  }
});
```

---

### T=28ms: Response Sent

**Response (503 Service Unavailable):**
```json
{
  "success": false,
  "error": {
    "message": "Service temporarily unavailable",
    "code": "CIRCUIT_BREAKER_OPEN",
    "requestId": "c3d4e5f6-a7b8-9012-cdef-34567890abcd",
    "retryAfter": 30
  }
}
```

**Total time: 28ms**

**Compare to if circuit breaker was closed:**

```
Without circuit breaker (try to connect):
- Attempt 1: Connection refused (2000ms timeout)
- Retry backoff: 100ms
- Attempt 2: Connection refused (2000ms timeout)
- Retry backoff: 200ms
- Attempt 3: Connection refused (2000ms timeout)
Total: ~6,300ms (6.3 seconds!)

With circuit breaker (fail fast):
- Check state: Circuit OPEN
- Reject immediately: 2ms
Total: 28ms (0.028 seconds!)
```

**225x faster failure!** 🚀

---

## What Caused Circuit Breaker to Open?

**Previous 5 requests:**

### Request 1 (T=-60s): Success
```javascript
circuitBreaker.recordSuccess();
// failureCount = 0
// state = 'CLOSED'
```

### Request 2 (T=-30s): User Service goes down

**Attempt 1:**
```javascript
try {
  await axios.get('http://localhost:3001/api/auth/profile');
} catch (err) {
  // ECONNREFUSED (connection refused)
}
```

**Retry attempt 1:**
```javascript
// Wait 100ms
try {
  await axios.get('http://localhost:3001/api/auth/profile');
} catch (err) {
  // ECONNREFUSED
}
```

**Retry attempt 2:**
```javascript
// Wait 200ms
try {
  await axios.get('http://localhost:3001/api/auth/profile');
} catch (err) {
  // ECONNREFUSED
  // Max retries exceeded
}
```

**Circuit breaker records failure:**
```javascript
circuitBreaker.recordFailure();
// failureCount = 1
// state = 'CLOSED' (threshold not reached)
```

### Request 3-6 (T=-25s to T=-10s): Same pattern

Each request:
- Tries 3 times
- All fail
- Circuit breaker records failure

```javascript
// After request 3:
failureCount = 2;
state = 'CLOSED';

// After request 4:
failureCount = 3;
state = 'CLOSED';

// After request 5:
failureCount = 4;
state = 'CLOSED';

// After request 6:
failureCount = 5;
state = 'OPEN';  // ⚠️ THRESHOLD REACHED!
```

**Circuit breaker opens:**
```javascript
circuitBreaker.state = 'OPEN';
circuitBreaker.openedAt = Date.now();
```

---

## Circuit Breaker State Machine

```
         SUCCESS
CLOSED ─────────► CLOSED
  │                 │
  │ 5 FAILURES      │
  │                 │
  ▼                 │
OPEN ◄──────────────┘
  │         FAILURE
  │
  │ 30 SECONDS
  │ (resetTimeout)
  │
  ▼
HALF_OPEN
  │
  ├─ SUCCESS ──► CLOSED
  │
  └─ FAILURE ──► OPEN
```

**States explained:**

**CLOSED (normal):**
- All requests forwarded
- Failures counted
- After 5 failures → OPEN

**OPEN (service down):**
- All requests rejected (fail fast!)
- No network calls attempted
- After 30 seconds → HALF_OPEN

**HALF_OPEN (testing recovery):**
- One test request forwarded
- If success → CLOSED (service recovered!)
- If failure → OPEN (still down, wait another 30s)

---

## Recovery Timeline

**T=0s: Circuit breaker opens (after 5 failures)**
```javascript
state = 'OPEN';
openedAt = Date.now();
```

**T=0-30s: All requests fail fast**
```javascript
if (state === 'OPEN' && Date.now() - openedAt < resetTimeout) {
  throw new Error('Circuit breaker OPEN');
}
// All requests rejected in <5ms
// No load on dead service
```

**T=30s: Circuit breaker transitions to HALF_OPEN**
```javascript
if (Date.now() - openedAt >= resetTimeout) {
  state = 'HALF_OPEN';
}
```

**T=30.5s: Test request arrives**
```javascript
if (state === 'HALF_OPEN') {
  // Allow ONE request through (test if service recovered)
  try {
    const response = await axios.get('http://localhost:3001/api/auth/profile');
    
    // ✅ Success! Service is back!
    circuitBreaker.recordSuccess();
    state = 'CLOSED';
    failureCount = 0;
    
  } catch (err) {
    // ❌ Still failing
    circuitBreaker.recordFailure();
    state = 'OPEN';
    openedAt = Date.now();  // Reset timer (wait another 30s)
  }
}
```

**If service recovered:**
```javascript
// After success:
state = 'CLOSED';
failureCount = 0;

// All subsequent requests forwarded normally
// Circuit breaker back to monitoring mode
```

**If service still down:**
```javascript
// After failure:
state = 'OPEN';
openedAt = Date.now();

// Wait another 30 seconds before trying again
```

---

## Benefits of Circuit Breaker

**Without circuit breaker:**
```
User Service down
↓
Every request tries 3 times
↓
Each attempt waits 2 seconds (timeout)
↓
100 requests = 600 seconds of waiting
↓
Users wait 6 seconds per request
↓
Frustration! 😡
↓
Gateway overloaded (300 concurrent waiting requests)
↓
Gateway becomes slow/unresponsive
↓
Other services affected (cascade failure!)
↓
Entire system down! 💥
```

**With circuit breaker:**
```
User Service down
↓
First 5 requests try (fail)
↓
Circuit breaker opens
↓
Requests 6+ fail fast (<5ms)
↓
100 requests = <500ms total
↓
Users get immediate error (better UX)
↓
Gateway not overloaded (no waiting requests)
↓
Other services unaffected (isolated failure)
↓
After 30s, test if service recovered
↓
If recovered, resume normal operation
↓
System resilient! ✅
```

---

**REQUEST-FLOW-COMPLETE Part 2 Complete!** 🎉🎉

**What you learned:**

**Login Flow (315ms):**
- ✅ Password verification with bcrypt.compare (250ms)
- ✅ Token rotation (delete old, insert new)
- ✅ Rate limiting (5 attempts per 15 min)

**Get Profile Flow (40ms):**
- ✅ JWT verification (10ms)
- ✅ Signature validation with RS256
- ✅ Blacklist check in Redis (2ms)
- ✅ Database query for latest data (6ms)

**Token Refresh Flow (62ms):**
- ✅ Token reuse detection (< 5 seconds = attack!)
- ✅ Token rotation (delete old, insert new)
- ✅ Hash comparison (SHA-256)

**Circuit Breaker Flow (28ms):**
- ✅ Fail fast when service down (2ms vs 6300ms!)
- ✅ State machine (CLOSED → OPEN → HALF_OPEN)
- ✅ Automatic recovery testing
- ✅ Cascade failure prevention

**MODULE-7 COMPLETE!** You can now trace ANY request through the entire system! 🚀

**Progress: 70% complete (7/10 modules)!** 🎯

**Remaining:**
- MODULE-8: Production vs Tutorial (50+ comparisons)
- MODULE-9: Interview Questions (100+ Q&A)
- MODULE-10: Performance Metrics

Ready to continue? 🚀