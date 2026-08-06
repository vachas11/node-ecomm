# MODULE-4: USER SERVICE DEEP DIVE (Part 2)

**This is Part 2 - continuation of MODULE-4-USER-SERVICE-DEEP-DIVE.md**

---

# PART 4: Routes Configuration

**File:** `services/user-service/src/routes/auth.routes.js`

This file connects controller functions to HTTP endpoints.

## Complete Routes File

```javascript
const express = require('express');
const router = express.Router();

// Controllers
const {
  register,
  login,
  refresh,
  logout,
  logoutAll,
  getProfile,
  updateProfile,
  changePassword
} = require('../controllers/auth.controller');

// Middleware
const { authenticate } = require('../../../../shared/auth/middleware');
const {
  loginRateLimiter,
  registerRateLimiter,
  refreshRateLimiter
} = require('../../../../shared/auth/rateLimiter');

// Validation middleware (optional but recommended)
const { validateRegistration, validateLogin } = require('../middleware/validation');

// ==========================================
// PUBLIC ROUTES (No authentication required)
// ==========================================

/**
 * POST /api/auth/register
 * Create new user account
 * Rate limit: 3 attempts per hour
 */
router.post('/register',
  registerRateLimiter,      // Rate limiting
  validateRegistration,     // Input validation
  register                  // Controller
);

/**
 * POST /api/auth/login
 * Authenticate user and issue tokens
 * Rate limit: 5 failed attempts per 15 minutes
 */
router.post('/login',
  loginRateLimiter,         // Rate limiting (stricter)
  validateLogin,            // Input validation
  login                     // Controller
);

/**
 * POST /api/auth/refresh
 * Get new access token using refresh token
 * Rate limit: 10 attempts per hour
 */
router.post('/refresh',
  refreshRateLimiter,       // Rate limiting
  refresh                   // Controller
);

// ==========================================
// PROTECTED ROUTES (Authentication required)
// ==========================================

/**
 * GET /api/auth/profile
 * Get current user's profile
 * Requires: Valid access token
 */
router.get('/profile',
  authenticate,             // Verify JWT
  getProfile                // Controller
);

/**
 * PUT /api/auth/profile
 * Update current user's profile
 * Requires: Valid access token
 */
router.put('/profile',
  authenticate,             // Verify JWT
  updateProfile             // Controller
);

/**
 * PUT /api/auth/change-password
 * Change user's password
 * Requires: Valid access token, current password
 */
router.put('/change-password',
  authenticate,             // Verify JWT
  changePassword            // Controller
);

/**
 * POST /api/auth/logout
 * Logout from current session
 * Requires: Valid access token
 */
router.post('/logout',
  authenticate,             // Verify JWT
  logout                    // Controller
);

/**
 * POST /api/auth/logout-all
 * Logout from all sessions/devices
 * Requires: Valid access token
 */
router.post('/logout-all',
  authenticate,             // Verify JWT
  logoutAll                 // Controller
);

module.exports = router;
```

---

## Middleware Chain Explained

**The Order Matters!**

```javascript
router.post('/login',
  loginRateLimiter,     // 1. Check rate limit FIRST
  validateLogin,        // 2. Validate input
  login                 // 3. Execute controller
);

// Why this order?

// CORRECT ORDER:
Request comes in
    ↓
1. Rate limiter: Too many requests? → 429 (fast rejection)
2. Validation: Valid email format? → 400 (fast rejection)
3. Controller: Query database, verify password → 200/401
    ↓
Response

// WRONG ORDER (rate limiter last):
Request comes in
    ↓
1. Validation: Valid email → ✅
2. Controller: Query database (10ms), verify password (250ms)
3. Rate limiter: Too many requests? → 429
    ↓
Result: Wasted 260ms on database + bcrypt before rate limiting!

// Attacker makes 1000 requests:
// Wrong order: 1000 × 260ms = 260 seconds of DB load 💀
// Correct order: 1000 × 2ms rate limit check = 2 seconds ✅
```

**Middleware Chain for Protected Routes:**

```javascript
router.get('/profile',
  authenticate,         // JWT verification
  getProfile           // Controller
);

// Flow:
Request: GET /api/auth/profile
Headers: Authorization: Bearer eyJhbGci...
    ↓
authenticate() middleware:
├─ Extract token from Authorization header
├─ Verify signature (RS256)
├─ Check expiry
├─ Check blacklist (Redis)
├─ Attach user to req.user = { userId, email, role }
└─ Call next()
    ↓
getProfile() controller:
├─ Read req.user.userId
├─ Query database for user data
└─ Return user profile
    ↓
Response: { success: true, data: { user: {...} } }
```

---

## Validation Middleware

**File:** `services/user-service/src/middleware/validation.js`

```javascript
const { ValidationError } = require('../../../../shared/errors');

/**
 * Validate registration input
 */
function validateRegistration(req, res, next) {
  const { email, password, firstName, lastName } = req.body;
  
  // Email validation
  if (!email) {
    return next(new ValidationError('Email is required'));
  }
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return next(new ValidationError('Invalid email format'));
  }
  
  // Password validation
  if (!password) {
    return next(new ValidationError('Password is required'));
  }
  
  if (password.length < 8) {
    return next(new ValidationError('Password must be at least 8 characters'));
  }
  
  if (!/[A-Z]/.test(password)) {
    return next(new ValidationError('Password must contain at least one uppercase letter'));
  }
  
  if (!/[a-z]/.test(password)) {
    return next(new ValidationError('Password must contain at least one lowercase letter'));
  }
  
  if (!/[0-9]/.test(password)) {
    return next(new ValidationError('Password must contain at least one number'));
  }
  
  // Name validation (optional fields)
  if (firstName && firstName.length > 50) {
    return next(new ValidationError('First name too long (max 50 characters)'));
  }
  
  if (lastName && lastName.length > 50) {
    return next(new ValidationError('Last name too long (max 50 characters)'));
  }
  
  // All valid
  next();
}

/**
 * Validate login input
 */
function validateLogin(req, res, next) {
  const { email, password } = req.body;
  
  if (!email) {
    return next(new ValidationError('Email is required'));
  }
  
  if (!password) {
    return next(new ValidationError('Password is required'));
  }
  
  // Don't validate email format or password strength on login
  // User might have old account with weak password
  // Just check they provided something
  
  next();
}

module.exports = {
  validateRegistration,
  validateLogin
};
```

**Why Validate in Middleware?**

```javascript
// ❌ Without middleware (validation in controller):
async function register(req, res, next) {
  try {
    // Validation code (30 lines)
    if (!email) throw new ValidationError(...);
    if (!emailRegex.test(email)) throw new ValidationError(...);
    if (password.length < 8) throw new ValidationError(...);
    // ... more validation
    
    // Actual logic (20 lines)
    const hashedPassword = await bcrypt.hash(password, 12);
    await db.query('INSERT INTO users ...');
    // ...
  } catch (error) {
    next(error);
  }
}

// Problems:
// 1. Controller bloated (50 lines)
// 2. Validation mixed with business logic
// 3. Hard to test
// 4. Not reusable

// ✅ With middleware (separation of concerns):
function validateRegistration(req, res, next) {
  // Validation code (30 lines)
  // Pure validation logic
  // Reusable
  // Easy to test
  next();
}

async function register(req, res, next) {
  try {
    // Only business logic (20 lines)
    const hashedPassword = await bcrypt.hash(password, 12);
    await db.query('INSERT INTO users ...');
    // ...
  } catch (error) {
    next(error);
  }
}

// Benefits:
// ✅ Clean separation
// ✅ Reusable validation
// ✅ Easy to test
// ✅ Easy to read
```

**Password Strength Validation:**

```javascript
// Minimum requirements:
// - 8+ characters
// - 1 uppercase letter
// - 1 lowercase letter
// - 1 number

// Examples:
"password" ❌ (no uppercase, no number)
"Password" ❌ (no number)
"Password1" ✅ (all requirements met)
"MyP@ssw0rd" ✅ (exceeds requirements)

// Why these requirements?
// NIST SP 800-63B guidelines:
// - Minimum 8 characters
// - Check against common passwords (e.g., "password123")
// - No complexity requirements (uppercase/number) UNLESS short

// Our approach:
// - 8 characters minimum
// - Complexity required (prevents "password" type passwords)
// - Balance: Secure but not frustrating
```

---

# PART 5: Internal APIs (Service-to-Service)

**File:** `services/user-service/src/routes/internal.routes.js`

These are endpoints that **only other services** can call, not public clients.

```javascript
const express = require('express');
const router = express.Router();

// Controllers
const {
  getUserById,
  getUsersByIds,
  verifyUserExists
} = require('../controllers/internal.controller');

// Middleware - authenticate service tokens
const { authenticateService } = require('../../../../shared/auth/middleware');

// All internal routes require service authentication
router.use(authenticateService);

/**
 * GET /api/internal/users/:id
 * Get user by ID (for other services)
 * 
 * Used by:
 * - Order Service: Get user info for order
 * - Product Service: Get user info for review
 * 
 * Requires: Valid service token with 'read:users' permission
 */
router.get('/users/:id', getUserById);

/**
 * POST /api/internal/users/bulk
 * Get multiple users by IDs (batch operation)
 * 
 * Body: { userIds: [1, 2, 3, ...] }
 * 
 * Used by:
 * - Order Service: Get user info for multiple orders
 * 
 * Requires: Valid service token with 'read:users' permission
 */
router.post('/users/bulk', getUsersByIds);

/**
 * GET /api/internal/users/:id/verify
 * Check if user exists (lightweight check)
 * 
 * Used by:
 * - Any service: Verify user before creating related data
 * 
 * Requires: Valid service token with 'read:users' permission
 */
router.get('/users/:id/verify', verifyUserExists);

module.exports = router;
```

---

## Internal Controller

**File:** `services/user-service/src/controllers/internal.controller.js`

```javascript
const db = require('../config/database');
const { NotFoundError, ForbiddenError } = require('../../../../shared/errors');

/**
 * Get user by ID
 */
async function getUserById(req, res, next) {
  try {
    const { id } = req.params;
    
    // Check service has permission
    if (!req.service.permissions.includes('read:users')) {
      throw new ForbiddenError('Service does not have read:users permission');
    }
    
    // Query user
    const result = await db.query(
      `SELECT user_id, email, first_name, last_name, role, created_at
       FROM users
       WHERE user_id = $1`,
      [id]
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
          createdAt: user.created_at
        }
      }
    });
    
  } catch (error) {
    next(error);
  }
}

/**
 * Get multiple users by IDs (batch operation)
 */
async function getUsersByIds(req, res, next) {
  try {
    const { userIds } = req.body;
    
    // Check service has permission
    if (!req.service.permissions.includes('read:users')) {
      throw new ForbiddenError('Service does not have read:users permission');
    }
    
    // Validate input
    if (!Array.isArray(userIds) || userIds.length === 0) {
      throw new ValidationError('userIds must be non-empty array');
    }
    
    if (userIds.length > 100) {
      throw new ValidationError('Maximum 100 users per request');
    }
    
    // Query users (use ANY for array parameter)
    const result = await db.query(
      `SELECT user_id, email, first_name, last_name, role
       FROM users
       WHERE user_id = ANY($1::int[])`,
      [userIds]
    );
    
    // Map to object for easy lookup
    const users = result.rows.reduce((acc, user) => {
      acc[user.user_id] = {
        userId: user.user_id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role
      };
      return acc;
    }, {});
    
    res.json({
      success: true,
      data: { users }
    });
    
  } catch (error) {
    next(error);
  }
}

/**
 * Verify user exists (lightweight check)
 */
async function verifyUserExists(req, res, next) {
  try {
    const { id } = req.params;
    
    // Check service has permission
    if (!req.service.permissions.includes('read:users')) {
      throw new ForbiddenError('Service does not have read:users permission');
    }
    
    // Lightweight query (just check existence)
    const result = await db.query(
      'SELECT EXISTS(SELECT 1 FROM users WHERE user_id = $1) as exists',
      [id]
    );
    
    res.json({
      success: true,
      data: {
        exists: result.rows[0].exists
      }
    });
    
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getUserById,
  getUsersByIds,
  verifyUserExists
};
```

---

## Service-to-Service Communication Flow

**Scenario: Order Service needs user info**

```
Order Service needs to create order for user ID 123
    ↓
Order Service generates service token:
const serviceToken = generateServiceToken({
  serviceName: 'order-service',
  permissions: ['read:users', 'write:orders']
});
    ↓
Order Service calls User Service:
GET http://user-service:3001/api/internal/users/123
Headers: Authorization: Bearer <service-token>
    ↓
User Service receives request:
    ↓
authenticateService() middleware:
├─ Extract token
├─ Verify signature
├─ Check type = 'service'
├─ Attach to req.service = { name: 'order-service', permissions: [...] }
└─ next()
    ↓
getUserById() controller:
├─ Check req.service.permissions includes 'read:users' ✅
├─ Query database for user 123
└─ Return user data
    ↓
Order Service receives user data:
{
  success: true,
  data: {
    user: {
      userId: 123,
      email: 'user@test.com',
      firstName: 'John',
      lastName: 'Doe'
    }
  }
}
    ↓
Order Service creates order with user info ✅
```

**Why Service Tokens?**

```javascript
// ❌ BAD: Use user's access token
Order Service: "I need user 123 data"
    ↓
Uses user's access token (stolen/forwarded)
    ↓
Problems:
├─ Security risk (token forwarding)
├─ Token expires (user logs out)
├─ Wrong authorization (user's permissions, not service's)
└─ Can't distinguish service vs user request

// ✅ GOOD: Use service token
Order Service: "I need user 123 data"
    ↓
Generates service token (order-service identity)
    ↓
Benefits:
├─ Service identity (know which service calling)
├─ Service permissions (read:users, write:orders)
├─ Longer expiry (1 hour vs 15 min)
├─ Audit trail (which service accessed what)
└─ Security (if service compromised, revoke service token)
```

---

# PART 6: Interview Questions & Answers

## Q1: "Walk me through the user registration flow"

**Perfect Answer:**

"Registration happens in 8 steps:

**1. Rate limiting** (3 attempts/hour) - prevent spam accounts

**2. Input validation** - check email format, password strength (8+ chars, uppercase, lowercase, number)

**3. Check existing user** - query database for duplicate email, prevent duplicate accounts

**4. Hash password** - bcrypt with 12 salt rounds (4096 iterations, ~250ms per hash) - slow by design to prevent brute force

**5. Database transaction** - insert user into users table, ensure atomic operation

**6. Generate tokens** - access token (15 min expiry, rich payload with userId/email/role) and refresh token (7 days, minimal payload)

**7. Store refresh token** - hash with SHA-256 before storing in database, if database leaked attacker can't use tokens

**8. Return response** - 201 Created with user object and both tokens

The transaction ensures if any step fails, everything rolls back - no orphaned data. The password is never stored plainly, never logged, never returned in responses."

---

## Q2: "How do you prevent brute force attacks on login?"

**Perfect Answer:**

"I use multiple layers of protection:

**Layer 1: Rate limiting** - 5 failed attempts per 15 minutes per email+IP combination using `skipSuccessfulRequests: true` so legitimate logins don't count

**Layer 2: Generic error messages** - 'Invalid email or password' for both wrong email AND wrong password, prevents email enumeration

**Layer 3: bcrypt slowness** - 250ms per password verification, makes brute force impractical (4 attempts/second max)

**Layer 4: Token rotation** - each login deletes old refresh tokens, limits token sprawl

**For advanced protection:**
- Account lockout after 10 failed attempts
- CAPTCHA after 3 failures  
- IP reputation scoring
- Honeypot endpoints to identify bots
- Anomaly detection (1000 IPs trying same password = coordinated attack)

At 5 attempts per 15 minutes, testing 1 million passwords would take ~50 years, making brute force economically infeasible."

---

## Q3: "Explain token refresh flow and why you rotate tokens"

**Perfect Answer:**

"Refresh flow in 7 steps:

**1. Client sends refresh token** via POST /api/auth/refresh

**2. Verify JWT signature** - ensures token wasn't tampered with

**3. Hash token and lookup in database** - refresh tokens stored as SHA-256 hashes

**4. Check token reuse** - if used within 5 seconds of creation, indicates potential attack (intercepted token used by attacker), revoke all user's tokens

**5. Generate new tokens** - both new access and refresh tokens

**6. Rotate refresh token** - delete old token from database, insert new token, old token no longer valid

**7. Return new tokens** - client replaces both tokens

**Why rotation?**

**Security:** If refresh token leaked, it's only valid once. Attacker uses it → victim's next refresh fails → both know something's wrong → revoke all tokens.

**Without rotation:** Attacker could silently use stolen refresh token for 7 days.

**Trade-off:** Slightly more database writes (2 per refresh: delete + insert) vs significantly better security. Worth it."

---

## Q4: "Why hash refresh tokens before storing in database?"

**Perfect Answer:**

"Refresh tokens are JWTs - they're self-contained and can be used immediately. If I stored them plainly and the database was compromised, the attacker has direct access to valid tokens.

**Scenario without hashing:**
```
Database leaked:
├─ Attacker sees refresh_tokens table
├─ Sees plaintext JWT tokens
├─ Uses tokens to get access tokens
└─ Account takeover! 💀
```

**With SHA-256 hashing:**
```
Database leaked:
├─ Attacker sees hashes: '5e884898da28047...'
├─ Can't reverse SHA-256 (one-way function)
├─ Can't generate matching JWT
└─ Tokens useless! ✅
```

**Why SHA-256 not bcrypt?**

bcrypt is slow (250ms) - great for passwords but overkill for token lookup. We hash tokens thousands of times per second. SHA-256 is fast (< 1ms) and cryptographically secure for this use case.

**Access tokens aren't stored** because they're short-lived (15 min) and stateless - blacklist handles revocation when needed."

---

## Q5: "Why delete all refresh tokens on password change?"

**Perfect Answer:**

"Security best practice: any password change should revoke all sessions.

**Scenario:**
- Monday: User's password compromised, attacker logs in
- Tuesday: User realizes breach, changes password
- If tokens not revoked: Attacker's session still valid for up to 7 days

**My implementation:**
1. Verify current password (prevent unauthorized change)
2. Hash new password with bcrypt
3. Update users table
4. Delete ALL refresh tokens from database
5. Blacklist current access token (Redis)
6. Force re-login on all devices

**Why all devices?**

Can't distinguish attacker's session from legitimate sessions in database. Safest: invalidate everything, user re-authenticates legitimate devices with new password, attacker locked out permanently.

This follows NIST SP 800-63B guidance: 'Verifiers SHALL revoke the authenticator immediately upon notification from the subscriber that it has been lost or stolen.'

**Trade-off:** Slight inconvenience (re-login on all devices) vs preventing account compromise. Easy choice."

---

## Q6: "How do you handle service-to-service authentication?"

**Perfect Answer:**

"I use service tokens - specialized JWTs for backend services:

**Service Token Structure:**
```javascript
{
  serviceName: 'order-service',
  permissions: ['read:users', 'write:orders'],
  type: 'service',
  exp: <1 hour from now>,
  jti: <unique ID>
}
```

**Flow:**

Order Service needs user data:
1. Generate service token (signed with private key)
2. Call User Service: `GET /api/internal/users/123` with `Authorization: Bearer <service-token>`
3. User Service validates token with `authenticateService()` middleware
4. Check permissions: `req.service.permissions.includes('read:users')`
5. Return user data if authorized

**Why not user access tokens?**

- User token expires when user logs out
- Wrong authorization model (user's permissions ≠ service's permissions)
- Security risk (token forwarding)
- Can't audit which service accessed what

**Why not API keys?**

- JWTs are stateless, no database lookup needed
- JWTs include permissions in payload
- JWTs can be revoked via blacklist if needed
- Standard OAuth 2.0 pattern (client_credentials flow)

**Permission scoping:** Each service gets minimal required permissions. Order Service: `read:users`, Product Service: `read:users, write:products`. Principle of least privilege."

---

## Q7: "How do you test authentication endpoints?"

**Perfect Answer:**

"I test at three levels:

**Unit Tests** (mock database):
```javascript
describe('register', () => {
  test('creates user with valid input', async () => {
    db.query.mockResolvedValue({ rows: [{ user_id: 1, email: 'test@test.com' }] });
    
    const res = await register(req, res, next);
    
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO users'));
    expect(res.status).toBe(201);
  });
  
  test('rejects duplicate email', async () => {
    db.query.mockResolvedValue({ rows: [{ user_id: 1 }] });  // User exists
    
    await register(req, res, next);
    
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Email already registered'
    }));
  });
});
```

**Integration Tests** (real database + Redis):
```javascript
describe('auth flow', () => {
  test('register → login → access protected endpoint → logout', async () => {
    // Register
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({ email: 'test@test.com', password: 'Password123' });
    
    expect(regRes.status).toBe(201);
    const { accessToken, refreshToken } = regRes.body.data;
    
    // Access protected endpoint
    const profileRes = await request(app)
      .get('/api/auth/profile')
      .set('Authorization', `Bearer ${accessToken}`);
    
    expect(profileRes.status).toBe(200);
    
    // Logout
    await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken });
    
    // Access token now blacklisted
    const profileRes2 = await request(app)
      .get('/api/auth/profile')
      .set('Authorization', `Bearer ${accessToken}`);
    
    expect(profileRes2.status).toBe(401);
  });
});
```

**E2E Tests** (entire system):
- Test rate limiting (make 6 login attempts, verify 6th is 429)
- Test token refresh flow
- Test password change revokes all sessions
- Test concurrent requests with same token

**Security Tests:**
- SQL injection attempts
- XSS in input fields
- Token tampering (modify JWT and verify rejection)
- Expired token handling
- Blacklisted token rejection"

---

## Q8: "What happens if database goes down during registration?"

**Perfect Answer:**

"Depends on when it fails:

**Scenario 1: Fail before transaction**
```
1. Validate input ✅
2. Check existing user → Database error ❌
3. Return 500 Internal Server Error
4. User sees error, tries again later
5. No data written ✅
```

**Scenario 2: Fail during transaction**
```
1. BEGIN TRANSACTION ✅
2. INSERT INTO users ✅
3. Network error 💀
4. INSERT INTO refresh_tokens ❌
5. Database automatically ROLLBACK
6. User insert reverted (ACID properties)
7. Return 500 Internal Server Error
8. No orphaned data ✅
```

**Why transactions matter:**

Without transaction:
- User inserted, refresh token not inserted
- Inconsistent state: user exists but can't login
- Manual cleanup required

With transaction:
- Both succeed or both fail
- Consistent state always
- No manual cleanup needed

**Recovery:**

1. Log error with full context (request ID, user email, timestamp)
2. Alert on-call engineer (PagerDuty)
3. Return 500 with request ID to user
4. User retries when database back online
5. Registration succeeds on retry

**Monitoring:**

- Alert if database connection pool exhausted
- Alert if query latency > 100ms
- Alert if error rate > 1%
- Dashboard showing database connection count

**For high availability:**

- Database replication (primary + read replicas)
- Automatic failover (if primary fails, promote replica)
- Connection pooling with retry logic
- Circuit breaker to fail fast if database consistently down"

---

# PART 7: Tutorial vs Production Comparison

## Registration Endpoint

### Tutorial Approach:

```javascript
// Tutorial registration (insecure, incomplete)
app.post('/register', async (req, res) => {
  const { email, password } = req.body;
  
  // Hash password
  const hashedPassword = bcrypt.hashSync(password, 10);  // 10 rounds (weak!)
  
  // Insert user
  await db.query(
    'INSERT INTO users (email, password) VALUES (?, ?)',
    [email, hashedPassword]  // SQL injection risk!
  );
  
  res.json({ message: 'Registered!' });
});

// Problems:
// ❌ No input validation
// ❌ No duplicate email check
// ❌ Weak password hashing (10 rounds)
// ❌ SQL injection risk (? placeholders)
// ❌ No error handling
// ❌ No rate limiting
// ❌ No transaction
// ❌ Doesn't return tokens
// ❌ Synchronous bcrypt (blocks event loop)
```

### Production Approach:

```javascript
// Production registration (secure, complete)
router.post('/register',
  registerRateLimiter,      // 3 attempts per hour
  validateRegistration,     // Email format, password strength
  async (req, res, next) => {
    try {
      const { email, password, firstName, lastName } = req.body;
      
      // Check duplicate
      const existing = await db.query(
        'SELECT user_id FROM users WHERE email = $1',  // Parameterized (no SQL injection)
        [email.toLowerCase()]
      );
      
      if (existing.rows.length > 0) {
        throw new ConflictError('Email already registered');
      }
      
      // Hash password (async, 12 rounds)
      const passwordHash = await bcrypt.hash(password, 12);
      
      // Transaction (atomic)
      const result = await db.transaction(async (client) => {
        const userResult = await client.query(
          `INSERT INTO users (email, password_hash, first_name, last_name)
           VALUES ($1, $2, $3, $4)
           RETURNING user_id, email, first_name, last_name`,
          [email.toLowerCase(), passwordHash, firstName, lastName]
        );
        
        const user = userResult.rows[0];
        
        // Generate tokens
        const accessToken = generateAccessToken({
          userId: user.user_id,
          email: user.email,
          role: 'user'
        });
        
        const refreshToken = generateRefreshToken({
          userId: user.user_id
        });
        
        // Store hashed refresh token
        const tokenHash = crypto
          .createHash('sha256')
          .update(refreshToken)
          .digest('hex');
        
        await client.query(
          `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
           VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
          [user.user_id, tokenHash]
        );
        
        return { user, accessToken, refreshToken };
      });
      
      // Return tokens
      res.status(201).json({
        success: true,
        data: {
          user: {
            userId: result.user.user_id,
            email: result.user.email,
            firstName: result.user.first_name,
            lastName: result.user.last_name
          },
          accessToken: result.accessToken,
          refreshToken: result.refreshToken
        }
      });
      
    } catch (error) {
      next(error);
    }
  }
);

// Benefits:
// ✅ Rate limiting (prevents spam)
// ✅ Input validation (prevents bad data)
// ✅ Duplicate check (prevents conflicts)
// ✅ Strong hashing (12 rounds, async)
// ✅ SQL injection safe (parameterized queries)
// ✅ Transaction (atomic, consistent)
// ✅ Returns tokens (ready to use)
// ✅ Error handling (centralized)
// ✅ Structured response (consistent format)
```

---

## Login Endpoint

### Tutorial Approach:

```javascript
// Tutorial login (insecure)
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  
  const user = await db.query(
    'SELECT * FROM users WHERE email = ?',
    [email]
  );
  
  if (!user) {
    return res.status(401).json({ error: 'User not found' });  // Reveals email doesn't exist!
  }
  
  const valid = bcrypt.compareSync(password, user.password);  // Synchronous (blocks!)
  
  if (!valid) {
    return res.status(401).json({ error: 'Wrong password' });  // Reveals email exists!
  }
  
  const token = jwt.sign({ userId: user.id }, 'secret-key');  // HS256 (symmetric)
  
  res.json({ token });
});

// Problems:
// ❌ No rate limiting (brute force vulnerable)
// ❌ Reveals whether email exists (enumeration attack)
// ❌ Synchronous bcrypt (blocks event loop)
// ❌ Hardcoded secret (security risk)
// ❌ HS256 not RS256 (less secure for distributed systems)
// ❌ Doesn't rotate tokens
// ❌ Only returns access token (no refresh)
```

### Production Approach:

```javascript
// Production login (secure)
router.post('/login',
  loginRateLimiter,  // 5 failed attempts per 15 min
  validateLogin,
  async (req, res, next) => {
    try {
      const { email, password } = req.body;
      
      const result = await db.query(
        `SELECT user_id, email, password_hash, first_name, last_name, role
         FROM users WHERE email = $1`,
        [email.toLowerCase()]
      );
      
      // Generic error message (don't reveal if email exists)
      if (result.rows.length === 0) {
        throw new ValidationError('Invalid email or password');
      }
      
      const user = result.rows[0];
      
      // Async password verification
      const passwordValid = await bcrypt.compare(password, user.password_hash);
      
      if (!passwordValid) {
        throw new ValidationError('Invalid email or password');  // Same message!
      }
      
      // Generate tokens (RS256)
      const accessToken = generateAccessToken({
        userId: user.user_id,
        email: user.email,
        role: user.role
      });
      
      const refreshToken = generateRefreshToken({
        userId: user.user_id
      });
      
      // Token rotation (delete old, insert new)
      await db.transaction(async (client) => {
        await client.query(
          'DELETE FROM refresh_tokens WHERE user_id = $1',
          [user.user_id]
        );
        
        const tokenHash = crypto
          .createHash('sha256')
          .update(refreshToken)
          .digest('hex');
        
        await client.query(
          `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
           VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
          [user.user_id, tokenHash]
        );
      });
      
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
);

// Benefits:
// ✅ Rate limiting (prevents brute force)
// ✅ Generic error messages (prevents enumeration)
// ✅ Async bcrypt (doesn't block)
// ✅ RS256 with key pairs (more secure)
// ✅ Token rotation (limits token sprawl)
// ✅ Returns both tokens (access + refresh)
// ✅ Structured response
```

---

# MODULE-4 COMPLETE! 🎉

**You now understand EVERYTHING about User Service:**

✅ **Architecture** - Why simpler than Gateway, what it's responsible for

✅ **Database** - Connection pooling, why 20 connections, transactions

✅ **8 Auth Controllers:**
1. Register - Password hashing, transactions, token generation
2. Login - Token rotation, security messages, rate limiting
3. Refresh - Token reuse detection, rotation
4. Logout - Blacklist access token, delete refresh token
5. Logout All - Security breach response
6. Get Profile - Why query DB not use JWT
7. Update Profile - Dynamic query building
8. Change Password - Why revoke all tokens

✅ **Routes** - Middleware chains, why order matters

✅ **Validation** - Input validation, password strength, email format

✅ **Internal APIs** - Service-to-service communication, service tokens, permissions

✅ **Interview Q&A** - 8 questions with perfect answers

✅ **Tutorial vs Production** - What tutorials miss, why production is better

---

## Progress Summary

**Completed:**
- ✅ MODULE-1: API Gateway Entry Point
- ✅ MODULE-2: Resilience Patterns
- ✅ MODULE-3: Authentication (JWT, Middleware, Blacklist, Rate Limiting)
- ✅ MODULE-4: User Service (Complete!)

**Next:**
- ⏳ MODULE-5: Shared Utilities (Logger, errors, Redis, database)
- ⏳ MODULE-6: Hands-On Testing Guide
- ⏳ MODULE-7: Request Flow Complete
- ⏳ MODULE-8: Production vs Tutorial
- ⏳ MODULE-9: Interview Questions Complete
- ⏳ MODULE-10: Performance Metrics

**Ready to continue with MODULE-5 (Shared Utilities)?** 🚀
