# M07: Rate Limiting Deep Dive - PART 2

**File:** `shared/auth/rateLimiter.ts` (163 lines)  
**Level:** Security  
**Prerequisites:** M07 Part 1  
**Time to Master:** 2-3 hours

---

## 🔍 SECTION 3: LINE-BY-LINE CODE ANALYSIS (Part 2 - Pre-configured Limiters)

### 3.1 loginRateLimiter (Lines 74-83)

```typescript
export const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts, please try again after 15 minutes',
  skipSuccessfulRequests: true,
  keyGenerator: (req: Request) => {
    const email = (req.body as any)?.email || 'unknown';
    return `${req.ip}:${email}`;
  }
});
```

**Purpose:** Prevent brute force password attacks.

#### Line 75: 15 Minute Window

```typescript
windowMs: 15 * 60 * 1000,
```

**Why 15 minutes?**

**Balance security vs UX:**

```typescript
// Too short (5 minutes):
// User forgets password, tries 5 times
// Locked out after 5 min
// Tries again, locked again
// Frustrating! ❌

// Too long (1 hour):
// Attacker can try many passwords
// 5 per hour = 120 per day
// Might crack weak passwords ❌

// 15 minutes (sweet spot):
// Slows attacker significantly
// Reasonable for legitimate users ✅
```

#### Line 76: Max 5 Attempts

```typescript
max: 5,
```

**Why 5 attempts?**

**Statistics from user studies:**

```typescript
// Most users succeed within:
// 1st attempt: 60%
// 2nd attempt: 25%
// 3rd attempt: 10%
// 4th attempt: 3%
// 5th attempt: 1%
// Total: 99% of users succeed within 5 attempts

// 5 attempts covers 99% of legitimate users
// While blocking 99.99% of brute force attacks
```

#### Line 78: skipSuccessfulRequests

```typescript
skipSuccessfulRequests: true,
```

**Critical for login rate limiting!**

**Without this:**

```typescript
skipSuccessfulRequests: false  // ❌ BAD

// User logs in from phone → Count: 1
// User logs in from laptop → Count: 2
// User logs in from work PC → Count: 3
// User logs in from tablet → Count: 4
// User logs in from home PC → Count: 5
// User logs in from another device → 429 BLOCKED!
// Legitimate user locked out! ❌
```

**With this:**

```typescript
skipSuccessfulRequests: true  // ✅ GOOD

// User logs in successfully 10 times → Count: 0
// User fails login 5 times → Count: 5 → BLOCKED
// Only failed attempts count ✅
```

#### Lines 79-82: Combined Key (IP + Email)

```typescript
keyGenerator: (req: Request) => {
  const email = (req.body as any)?.email || 'unknown';
  return `${req.ip}:${email}`;
}
```

**Why combine IP + email?**

**Prevents distributed attacks on single account:**

**Attack scenario without combined key:**

```typescript
// keyGenerator: req.ip only

// Attacker uses 100 different IPs:
IP 1: Try 5 passwords for admin@example.com
IP 2: Try 5 passwords for admin@example.com
IP 3: Try 5 passwords for admin@example.com
...
IP 100: Try 5 passwords for admin@example.com

// Total: 500 password attempts on same account!
// Rate limit bypassed! ❌
```

**With combined key:**

```typescript
// keyGenerator: `${ip}:${email}`

Keys created:
192.168.1.1:admin@example.com → 5 attempts
192.168.1.2:admin@example.com → 5 attempts
...

// BUT ALSO track account-level:
// Many different IPs attacking same email → Suspicious!
// Can trigger account lockout
```

**Line 80: Extract email safely**

```typescript
const email = (req.body as any)?.email || 'unknown';
```

**Type assertion `as any`:**

```typescript
// req.body type is unknown
// Need to assert it's an object with email field
(req.body as any)?.email
```

**Optional chaining `?.`:**

```typescript
req.body?.email

// If req.body is null/undefined:
// → Returns undefined (no error)

// Without optional chaining:
req.body.email
// → Error if req.body is null
```

**Fallback to 'unknown':**

```typescript
|| 'unknown'

// If email field missing:
// → All requests without email share same key
// → They'll be limited together
```

**Line 81: Key format**

```typescript
return `${req.ip}:${email}`;
```

**Template literal:**

```typescript
req.ip = '192.168.1.100'
email = 'admin@example.com'

// Result:
'192.168.1.100:admin@example.com'
```

**Redis keys:**

```redis
ratelimit:192.168.1.100:admin@example.com = 3
ratelimit:192.168.1.101:admin@example.com = 2
ratelimit:192.168.1.100:user@example.com = 1
```

**Usage:**

```typescript
app.post('/auth/login', loginRateLimiter, async (req, res) => {
  const { email, password } = req.body;
  
  const user = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    // Failed login → Will count towards rate limit
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  // Successful login → Won't count (skipSuccessfulRequests: true)
  const tokens = generateTokenPair(user);
  res.json(tokens);
});
```

### 3.2 registerRateLimiter (Lines 85-91)

```typescript
export const registerRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: 'Too many accounts created from this IP, please try again after an hour',
  skipSuccessfulRequests: false,
  keyGenerator: (req: Request) => req.ip || 'unknown'
});
```

**Purpose:** Prevent mass account creation (spam, bots).

#### Line 86: 1 Hour Window

```typescript
windowMs: 60 * 60 * 1000,
```

**Why 1 hour?**

**Longer window for account creation:**

```typescript
// Account creation is less frequent than login
// Most users create 1 account, rarely 2+
// Legitimate users unlikely to hit this limit

// Attacker creating spam accounts:
// 3 per hour = 72 per day
// Still blocked effectively ✅
```

#### Line 87: Max 3 Accounts

```typescript
max: 3,
```

**Why 3?**

**Use cases:**

```typescript
// Personal account + Work account
3 accounts covers:
1. Personal email
2. Work email
3. Alternative email

// More than 3 in 1 hour = Suspicious
```

#### Line 89: Count All Attempts

```typescript
skipSuccessfulRequests: false,
```

**Why count successful registrations?**

**Even successful registrations can be abuse:**

```typescript
// Spam bot creating accounts:
// All registrations succeed (valid emails)
// But all are spam accounts!

// Must count successful registrations ✅
```

#### Line 90: Key by IP only

```typescript
keyGenerator: (req: Request) => req.ip || 'unknown'
```

**Why IP only (no email)?**

**Can't use email as key:**

```typescript
// Each registration has different email!
user1@example.com
user2@example.com
user3@example.com

// If keyed by email, rate limit never triggered
// Each email is unique, so each gets 3 attempts

// By IP: All registrations from same IP counted together ✅
```

**Usage:**

```typescript
app.post('/auth/register', registerRateLimiter, async (req, res) => {
  const { email, password } = req.body;
  
  // Check if email exists
  const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing) {
    return res.status(409).json({ error: 'Email already registered' });
  }
  
  // Create account (counts towards rate limit)
  const passwordHash = await bcrypt.hash(password, 10);
  await db.query('INSERT INTO users (email, password_hash) VALUES ($1, $2)', [email, passwordHash]);
  
  res.status(201).json({ message: 'Account created' });
});
```

### 3.3 refreshRateLimiter (Lines 93-99)

```typescript
export const refreshRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Too many token refresh attempts, please login again',
  skipSuccessfulRequests: false,
  keyGenerator: (req: AuthenticatedRequest) => String((req as AuthenticatedRequest).user?.userId || req.ip)
});
```

**Purpose:** Prevent refresh token abuse.

#### Line 95: Max 10 Per Hour

```typescript
max: 10,
```

**Why 10?**

**Normal refresh pattern:**

```typescript
// Access token expires every 15 minutes
// User active for 1 hour:
//   15 min: Refresh 1
//   30 min: Refresh 2
//   45 min: Refresh 3
//   60 min: Refresh 4

// Normal: ~4 refreshes per hour
// Limit: 10 per hour (2.5x buffer) ✅
```

#### Line 98: Key by userId or IP

```typescript
keyGenerator: (req: AuthenticatedRequest) => String((req as AuthenticatedRequest).user?.userId || req.ip)
```

**Fallback pattern:**

```typescript
req.user?.userId  // If authenticated
|| req.ip         // If not authenticated (fallback)
```

**Why userId preferred?**

**Per-user accuracy:**

```typescript
// Multiple users behind same IP (office, school):
// IP-based: All users share same limit (unfair)
// User-based: Each user has own limit (fair) ✅

// Example:
Office IP: 192.168.1.100
User A: 10 refreshes (maxed out)
User B: 0 refreshes (can still refresh)
// Fair distribution ✅
```

**Why String()?**

```typescript
String(req.user?.userId || req.ip)

// userId is number: 123
// req.ip is string: '192.168.1.100'

// Convert to string for consistent key type:
String(123) = '123'
String('192.168.1.100') = '192.168.1.100'
```

**Usage:**

```typescript
app.post('/auth/refresh', 
  authenticate(),  // Sets req.user
  refreshRateLimiter, 
  async (req, res) => {
    const { refreshToken } = req.body;
    
    const decoded = verifyRefreshToken(refreshToken);
    const user = await db.query('SELECT * FROM users WHERE id = $1', [decoded.userId]);
    
    const accessToken = generateAccessToken(user);
    res.json({ accessToken });
  }
);
```

### 3.4 passwordChangeRateLimiter (Lines 101-106)

```typescript
export const passwordChangeRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Too many password change attempts, please try again later',
  keyGenerator: (req: AuthenticatedRequest) => String((req as AuthenticatedRequest).user?.userId || req.ip)
});
```

**Purpose:** Prevent password change abuse.

#### Line 103: Max 5 Per Hour

```typescript
max: 5,
```

**Why 5?**

**Legitimate use cases:**

```typescript
// User forgets new password:
// 1. Change password
// 2. Forget it
// 3. Change again
// 4. Forget it again
// 5. Change one more time

// 5 attempts enough for confused user
// But blocks rapid changes (suspicious) ✅
```

**Why rate limit password changes?**

**Attack scenarios:**

```typescript
// 1. Attacker has temporary access
// Rapidly changes password to lock out real user

// 2. Credential stuffing
// Attacker tries leaked passwords rapidly

// 3. Enumeration
// Try changing password to detect valid accounts

// Rate limiting prevents all these ✅
```

**Usage:**

```typescript
app.post('/auth/change-password', 
  authenticate(),
  passwordChangeRateLimiter, 
  async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    
    // Verify current password
    const user = await db.query('SELECT * FROM users WHERE id = $1', [req.user.userId]);
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      return res.status(401).json({ error: 'Current password incorrect' });
    }
    
    // Update password
    const newHash = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.user.userId]);
    
    // Revoke all tokens (force re-login)
    await revokeAllUserTokens(req.user.userId);
    
    res.json({ message: 'Password changed successfully' });
  }
);
```

### 3.5 apiRateLimiter (Lines 108-113)

```typescript
export const apiRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests, please slow down',
  keyGenerator: (req: AuthenticatedRequest) => String((req as AuthenticatedRequest).user?.userId || req.ip)
});
```

**Purpose:** General API rate limiting.

#### Line 110: Max 100 Per 15 Minutes

```typescript
max: 100,
```

**Rate calculation:**

```typescript
100 requests / 15 minutes
= 100 / 15
≈ 6.67 requests per minute
≈ 1 request every 9 seconds

// Reasonable for general API usage ✅
```

**Usage:**

```typescript
// Apply to all API routes
app.use('/api', apiRateLimiter);

// Or specific routes
app.get('/api/users', apiRateLimiter, getUsers);
app.post('/api/posts', apiRateLimiter, createPost);
```

### 3.6 strictRateLimiter (Lines 115-120)

```typescript
export const strictRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: 'Too many requests to sensitive endpoint',
  keyGenerator: (req: AuthenticatedRequest) => String((req as AuthenticatedRequest).user?.userId || req.ip)
});
```

**Purpose:** Protect expensive/sensitive operations.

#### Line 117: Max 3 Per 15 Minutes

```typescript
max: 3,
```

**Very strict!**

**Use cases:**

```typescript
// Expensive operations:
app.post('/api/reports/generate', strictRateLimiter, generateReport);
// Takes 10 seconds, high CPU

// Sensitive operations:
app.delete('/api/users/:id', strictRateLimiter, deleteUser);
// Permanent data loss

// Payment operations:
app.post('/api/payments', strictRateLimiter, processPayment);
// Real money involved

// Email sending:
app.post('/api/emails/send-bulk', strictRateLimiter, sendBulkEmail);
// Can be abused for spam
```

### 3.7 accountRateLimiter Custom Middleware (Lines 122-162)

```typescript
interface AccountRateLimiterOptions {
  windowMs?: number;
  max?: number;
  accountLockDuration?: number;
}

export const accountRateLimiter = (options: AccountRateLimiterOptions = {}) => {
  const { windowMs = 15 * 60 * 1000, max = 5, accountLockDuration = 60 * 60 * 1000 } = options;

  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const identifier = (req.body as any)?.email || req.ip;
      const key = `account_limit:${identifier}`;
      const lockKey = `account_locked:${identifier}`;

      const isLocked = await redisClient.exists(lockKey);
      if (isLocked) {
        res.status(429).json({ success: false, error: { message: 'Account temporarily locked due to too many failed attempts', statusCode: 429, locked: true } });
        return;
      }

      const attempts = await redisClient.incr(key);
      if (attempts === 1) {
        await redisClient.expire(key, Math.ceil(windowMs / 1000));
      }

      if (attempts && attempts > max) {
        await redisClient.client?.setEx(lockKey, Math.ceil(accountLockDuration / 1000), '1');
        logger.warn('Account locked due to rate limit', { identifier, attempts, lockDuration: accountLockDuration / 1000 });
        res.status(429).json({ success: false, error: { message: `Account locked for ${accountLockDuration / 60000} minutes due to too many attempts`, statusCode: 429, locked: true } });
        return;
      }

      req.rateLimit = { remaining: max - (attempts || 0), total: max };
      next();
    } catch (error: any) {
      logger.error('Account rate limiter error', { error: error.message });
      next();
    }
  };
};
```

**Purpose:** Account-specific rate limiting with **locking**.

**Different from express-rate-limit limiters:**

| Feature | express-rate-limit | accountRateLimiter |
|---------|-------------------|-------------------|
| **Implementation** | Library-based | Custom middleware |
| **Store** | Redis (automatic) | Manual Redis calls |
| **Account locking** | No | Yes ✅ |
| **Custom logic** | Limited | Full control ✅ |

#### Lines 122-126: Options Interface

```typescript
interface AccountRateLimiterOptions {
  windowMs?: number;
  max?: number;
  accountLockDuration?: number;
}
```

**Line 125: accountLockDuration**

```typescript
accountLockDuration?: number;
```

**New option:** How long to lock account after max attempts exceeded.

**Different from windowMs:**

```typescript
// windowMs: Reset counter after this time
// accountLockDuration: Lock account for this time

// Example:
windowMs: 15 * 60 * 1000  // Count attempts in 15 min
max: 5                     // 5 attempts allowed
accountLockDuration: 60 * 60 * 1000  // Lock for 1 hour

// Timeline:
// 0:00 - Attempt 1
// 0:01 - Attempt 2
// 0:02 - Attempt 3
// 0:03 - Attempt 4
// 0:04 - Attempt 5
// 0:05 - Attempt 6 → LOCKED for 1 hour!
// 0:15 - windowMs expires, but still locked
// 1:05 - Lock expires, counter resets
```

#### Lines 128-129: Defaults

```typescript
const { windowMs = 15 * 60 * 1000, max = 5, accountLockDuration = 60 * 60 * 1000 } = options;
```

**Defaults:**
- Window: 15 minutes (count attempts)
- Max: 5 attempts
- Lock duration: 1 hour (punishment)

#### Line 133: Identifier

```typescript
const identifier = (req.body as any)?.email || req.ip;
```

**Prefer email over IP:**

```typescript
// Email provided: Use email
// Email not provided: Use IP

// Why email?
// Tracks specific account, not just IP
```

#### Lines 134-135: Keys

```typescript
const key = `account_limit:${identifier}`;
const lockKey = `account_locked:${identifier}`;
```

**Two Redis keys:**

```redis
# Attempt counter
account_limit:admin@example.com = 3

# Lock flag
account_locked:admin@example.com = 1
```

**Why separate keys?**

```typescript
// Counter expires after windowMs
// Lock expires after accountLockDuration (different)

// Can't use same key with different expirations
```

#### Lines 137-140: Check if Locked

```typescript
const isLocked = await redisClient.exists(lockKey);
if (isLocked) {
  res.status(429).json({ success: false, error: { message: 'Account temporarily locked due to too many failed attempts', statusCode: 429, locked: true } });
  return;
}
```

**Line 137: Check lock exists**

```typescript
await redisClient.exists(lockKey)

// Returns 1 if key exists, 0 if not
// Truthy if locked, falsy if not locked
```

**Lines 138-140: Block if locked**

```typescript
if (isLocked) {
  res.status(429).json({ ... });
  return;  // ← Don't call next()
}
```

**Early return** - stop processing immediately.

**Response includes `locked: true`:**

```json
{
  "success": false,
  "error": {
    "message": "Account temporarily locked due to too many failed attempts",
    "statusCode": 429,
    "locked": true
  }
}
```

**Client can distinguish:**

```typescript
// Client side
if (error.locked) {
  // Account locked - show "Try again in 1 hour"
} else {
  // Rate limited - show "Try again in 15 min"
}
```

#### Lines 142-145: Increment Counter

```typescript
const attempts = await redisClient.incr(key);
if (attempts === 1) {
  await redisClient.expire(key, Math.ceil(windowMs / 1000));
}
```

**Line 142: Atomic increment**

```typescript
await redisClient.incr(key)

// Redis INCR command:
// - Atomic (thread-safe)
// - Creates key if doesn't exist (starts at 0)
// - Increments by 1
// - Returns new value
```

**Lines 143-145: Set expiry on first attempt**

```typescript
if (attempts === 1) {
  await redisClient.expire(key, Math.ceil(windowMs / 1000));
}
```

**Why check `attempts === 1`?**

```typescript
// First attempt: Set expiry
// Later attempts: Expiry already set, don't reset it

// Without check:
// 0:00 - Attempt 1 → Expire at 0:15
// 0:14 - Attempt 2 → Expire at 0:29 (wrong! extends window)
// 0:28 - Attempt 3 → Expire at 0:43 (wrong again!)

// With check:
// 0:00 - Attempt 1 → Expire at 0:15
// 0:14 - Attempt 2 → Don't change expiry
// 0:15 - Counter resets (correct!)
```

#### Lines 147-151: Lock Account

```typescript
if (attempts && attempts > max) {
  await redisClient.client?.setEx(lockKey, Math.ceil(accountLockDuration / 1000), '1');
  logger.warn('Account locked due to rate limit', { identifier, attempts, lockDuration: accountLockDuration / 1000 });
  res.status(429).json({ success: false, error: { message: `Account locked for ${accountLockDuration / 60000} minutes due to too many attempts`, statusCode: 429, locked: true } });
  return;
}
```

**Line 147: Check exceeded**

```typescript
if (attempts && attempts > max)
```

**Why check `attempts`?**

```typescript
// attempts could be undefined if Redis error
attempts > max  // ❌ Error if attempts is undefined

attempts && attempts > max  // ✅ Safe
```

**Line 148: Set lock with expiry**

```typescript
await redisClient.client?.setEx(lockKey, Math.ceil(accountLockDuration / 1000), '1');
```

**Redis SETEX:**

```redis
SETEX account_locked:admin@example.com 3600 "1"
      ↑ key                              ↑    ↑
                                      seconds value
```

**Atomic operation** - set value and expiry together.

**Line 149: Warning log**

```typescript
logger.warn('Account locked due to rate limit', { identifier, attempts, lockDuration: accountLockDuration / 1000 });
```

**Important security event:**

```json
{
  "level": "warn",
  "message": "Account locked due to rate limit",
  "identifier": "admin@example.com",
  "attempts": 6,
  "lockDuration": 3600,
  "timestamp": "2023-01-15T10:30:00.000Z"
}
```

**Alerting use case:**

```typescript
// Many account locks in short time → Attack!
if (accountLocksLastHour > 10) {
  alertSecurity('Multiple accounts locked - possible attack');
}
```

**Line 150: Error response**

```typescript
res.status(429).json({ 
  success: false, 
  error: { 
    message: `Account locked for ${accountLockDuration / 60000} minutes due to too many attempts`, 
    statusCode: 429, 
    locked: true 
  } 
});
```

**Convert ms to minutes:**

```typescript
accountLockDuration / 60000

// Example:
60 * 60 * 1000 / 60000 = 60 minutes
```

#### Line 155: Set Rate Limit Info

```typescript
req.rateLimit = { remaining: max - (attempts || 0), total: max };
```

**Add to request for route handler:**

```typescript
// Route handler can access:
app.post('/login', accountRateLimiter(), (req, res) => {
  console.log(`${req.rateLimit.remaining}/${req.rateLimit.total} attempts remaining`);
  
  // Include in response
  res.json({
    message: 'Login successful',
    rateLimit: req.rateLimit
  });
});
```

**Client sees:**

```json
{
  "message": "Login successful",
  "rateLimit": {
    "remaining": 3,
    "total": 5
  }
}
```

**Good UX:** Client can show "3 attempts remaining" warning.

#### Lines 157-160: Error Handling

```typescript
} catch (error: any) {
  logger.error('Account rate limiter error', { error: error.message });
  next();
}
```

**Graceful degradation:**

```typescript
// Redis error → Log it but continue
// Better to allow request than block legitimate user
next();  // ← Always proceed on error
```

**Why always proceed?**

```typescript
// Without next():
// Redis error → Request hangs
// User sees loading forever ❌

// With next():
// Redis error → Request proceeds (no rate limiting)
// Better than blocking ✅
```

---

## 🏗️ SECTION 4: COMPLETE RATE LIMITING ARCHITECTURE

### 4.1 Rate Limiting Flow Diagram

```
┌────────────────────────────────────────────────────────────────┐
│                  RATE LIMITING FLOW                            │
└────────────────────────────────────────────────────────────────┘

Client Request
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│ Rate Limiter Middleware                                         │
└──────────────────────────┬──────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│ 1. Generate Key                                                 │
│    key = keyGenerator(req)                                      │
│    → '192.168.1.100:admin@example.com'                         │
└──────────────────────────┬──────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Check Redis                                                  │
│    attempts = INCR ratelimit:192.168.1.100:admin@example.com  │
│    → attempts = 3                                               │
└──────────────────────────┬──────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. First Attempt?                                               │
│    if (attempts === 1)                                          │
│      EXPIRE ratelimit:... 900  // 15 min                       │
└──────────────────────────┬──────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. Check Limit                                                  │
│    if (attempts > max)                                          │
└──────────────────────────┬──────────────────────────────────────┘
       │
       ├─ attempts ≤ max (OK)
       │  │
       │  ▼
       │  ┌─────────────────────────────────────────────────────┐
       │  │ 5. Add Rate Limit Headers                           │
       │  │    X-RateLimit-Limit: 5                             │
       │  │    X-RateLimit-Remaining: 2                         │
       │  │    X-RateLimit-Reset: 1640000000                    │
       │  └──────────────────────┬──────────────────────────────┘
       │                         │
       │                         ▼
       │                    next() → Continue to route handler ✅
       │
       └─ attempts > max (BLOCKED)
          │
          ▼
          ┌─────────────────────────────────────────────────────┐
          │ 6. Rate Limit Exceeded                              │
          │    Log warning                                      │
          │    Send 429 response                                │
          │    {                                                │
          │      "error": "Too many requests",                  │
          │      "retryAfter": 900                              │
          │    }                                                │
          └─────────────────────────────────────────────────────┘
                         │
                         ▼
                    Response sent ❌
```

### 4.2 Account Locking Flow

```
┌────────────────────────────────────────────────────────────────┐
│              ACCOUNT LOCKING MECHANISM                         │
└────────────────────────────────────────────────────────────────┘

Failed Login Attempt
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│ accountRateLimiter()                                            │
└──────────────────────────┬──────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│ 1. Check if Already Locked                                      │
│    exists account_locked:admin@example.com                      │
└──────────────────────────┬──────────────────────────────────────┘
       │
       ├─ Locked
       │  │
       │  ▼
       │  ┌─────────────────────────────────────────────────────┐
       │  │ Return 429                                           │
       │  │ {                                                    │
       │  │   "error": "Account locked",                         │
       │  │   "locked": true                                     │
       │  │ }                                                    │
       │  └─────────────────────────────────────────────────────┘
       │                 │
       │                 ▼
       │             BLOCKED ❌
       │
       └─ Not Locked
          │
          ▼
          ┌─────────────────────────────────────────────────────┐
          │ 2. Increment Attempt Counter                        │
          │    INCR account_limit:admin@example.com             │
          │    → attempts = 5                                   │
          └──────────────────────┬──────────────────────────────┘
                  │
                  ▼
          ┌─────────────────────────────────────────────────────┐
          │ 3. Check if Exceeded Limit                          │
          │    if (attempts > 5)                                │
          └──────────────────────┬──────────────────────────────┘
                  │
                  ├─ Not Exceeded (attempts ≤ 5)
                  │  │
                  │  ▼
                  │  ┌───────────────────────────────────────────┐
                  │  │ Set req.rateLimit                         │
                  │  │ {                                         │
                  │  │   remaining: 1,                           │
                  │  │   total: 5                                │
                  │  │ }                                         │
                  │  └────────────────┬──────────────────────────┘
                  │                   │
                  │                   ▼
                  │              next() → Continue ✅
                  │
                  └─ Exceeded (attempts > 5)
                     │
                     ▼
                     ┌──────────────────────────────────────────┐
                     │ 4. Lock Account                          │
                     │    SETEX account_locked:admin@example... │
                     │         3600 "1"                         │
                     │    (1 hour lock)                         │
                     └────────────────┬─────────────────────────┘
                     │
                     ▼
                     ┌──────────────────────────────────────────┐
                     │ 5. Log Warning                           │
                     │    "Account locked: admin@example.com"   │
                     └────────────────┬─────────────────────────┘
                     │
                     ▼
                     ┌──────────────────────────────────────────┐
                     │ 6. Return 429                            │
                     │    {                                     │
                     │      "error": "Account locked for 60...",│
                     │      "locked": true                      │
                     │    }                                     │
                     └──────────────────────────────────────────┘
                                │
                                ▼
                           LOCKED ❌
```

### 4.3 Redis Key Structure

```
┌────────────────────────────────────────────────────────────────┐
│                    REDIS KEY LAYOUT                            │
└────────────────────────────────────────────────────────────────┘

Rate Limit Counters:
─────────────────────────────────────────────────────────────────
ratelimit:192.168.1.100                    = 3   TTL: 900s
ratelimit:192.168.1.100:admin@example.com  = 5   TTL: 900s
ratelimit:192.168.1.101                    = 1   TTL: 900s
ratelimit:user:123                         = 10  TTL: 900s

Account Attempt Counters:
─────────────────────────────────────────────────────────────────
account_limit:admin@example.com            = 4   TTL: 900s
account_limit:192.168.1.100                = 2   TTL: 900s
account_limit:user@example.com             = 1   TTL: 900s

Account Locks:
─────────────────────────────────────────────────────────────────
account_locked:admin@example.com           = 1   TTL: 3600s
account_locked:hacker@example.com          = 1   TTL: 3600s

Namespace Benefits:
─────────────────────────────────────────────────────────────────
1. Organized: Easy to find related keys
2. Bulk operations: KEYS ratelimit:* (dev only)
3. Selective flush: Delete all rate limits
4. Monitoring: Track ratelimit:* vs account_*
```

---

## 🎯 SECTION 5: MAANG INTERVIEW QUESTIONS

### Q1: Design a rate limiting system for a distributed API

**Answer:**

**Requirements:**
- 1M requests per second
- 100,000 users
- Distributed across 10 servers
- Per-user rate limiting (100 req/min)

**Architecture:**

```typescript
// Option 1: Redis Centralized (our approach)
┌─────────┐     ┌─────────┐     ┌─────────┐
│ Server1 │────▶│         │◀────│ Server2 │
└─────────┘     │  Redis  │     └─────────┘
┌─────────┐     │ (shared │     ┌─────────┐
│ Server3 │────▶│ counter)│◀────│ Server4 │
└─────────┘     └─────────┘     └─────────┘

Pros:
- Accurate rate limiting across all servers
- Simple implementation
- Redis is fast (~100k ops/sec per instance)

Cons:
- Single point of failure (mitigate with Redis cluster)
- Network latency for every request (~1-2ms)
- Redis becomes bottleneck at extreme scale

// Option 2: Token Bucket (local + sync)
Each server maintains local token bucket
Periodically sync with central store (every 10s)

Pros:
- Fast (no network for every request)
- Handles Redis failure

Cons:
- Less accurate (can exceed limit during sync window)
- Complex synchronization logic

// Option 3: Sliding Window Log
Store timestamp of each request in Redis sorted set

ZADD ratelimit:user:123 1640000000 "req-1"
ZADD ratelimit:user:123 1640000001 "req-2"

Pros:
- Very accurate
- No burst problem

Cons:
- High memory usage (store every timestamp)
- Slow for high-traffic users
```

**Implementation:**

```typescript
// Redis cluster for high availability
import Redis from 'ioredis';

const cluster = new Redis.Cluster([
  { host: 'redis1', port: 6379 },
  { host: 'redis2', port: 6379 },
  { host: 'redis3', port: 6379 }
]);

// Rate limiter with cluster
export const distributedRateLimiter = async (
  key: string,
  max: number,
  windowMs: number
): Promise<boolean> => {
  const current = Date.now();
  const windowStart = current - windowMs;
  
  // Sliding window using sorted set
  await cluster.zremrangebyscore(key, 0, windowStart);
  const count = await cluster.zcard(key);
  
  if (count >= max) {
    return false;  // Rate limited
  }
  
  await cluster.zadd(key, current, `${current}-${Math.random()}`);
  await cluster.expire(key, Math.ceil(windowMs / 1000));
  
  return true;  // Allowed
};

// Usage
if (!(await distributedRateLimiter(`user:${userId}`, 100, 60000))) {
  return res.status(429).json({ error: 'Rate limit exceeded' });
}
```

**Scaling considerations:**

```typescript
// 1M requests/sec, 100k users
// = 10 req/sec per user average

// Redis capacity:
// Single Redis: ~100k ops/sec
// 1M req/sec needs: 10 Redis instances

// With Redis Cluster (6 nodes):
// Capacity: 600k ops/sec
// Headroom: 1.67x (good for bursts)

// Cost:
// 6 Redis instances: ~$600/month
// vs 10 servers: ~$1000/month
// Total: $1600/month for 1M req/sec
```

### Q2: How would you handle rate limiting for API keys vs user tokens?

**Answer:**

**Different rate limit strategies:**

**API Keys (external developers):**

```typescript
// Tiered rate limits by plan
interface ApiKeyRateLimit {
  free: { requests: 1000, window: 3600 },    // 1k/hour
  pro: { requests: 100000, window: 3600 },   // 100k/hour
  enterprise: { requests: 1000000, window: 3600 }  // 1M/hour
}

export const apiKeyRateLimiter = async (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  // Get API key details from database
  const keyData = await db.query('SELECT plan, user_id FROM api_keys WHERE key = $1', [apiKey]);
  
  // Get rate limit for plan
  const limits = ApiKeyRateLimit[keyData.plan];
  
  // Check rate limit
  const key = `api-key:${apiKey}`;
  const count = await redis.incr(key);
  
  if (count === 1) {
    await redis.expire(key, limits.window);
  }
  
  if (count > limits.requests) {
    return res.status(429).json({
      error: 'API key rate limit exceeded',
      limit: limits.requests,
      window: limits.window,
      upgrade: keyData.plan === 'free' ? 'Upgrade to Pro for higher limits' : null
    });
  }
  
  // Add headers
  res.setHeader('X-RateLimit-Limit', limits.requests);
  res.setHeader('X-RateLimit-Remaining', limits.requests - count);
  
  next();
};
```

**User Tokens (internal users):**

```typescript
// Per-endpoint rate limits
export const userTokenRateLimiter = async (req, res, next) => {
  const userId = req.user.userId;
  const endpoint = req.path;
  
  // Different limits per endpoint
  const limits = {
    '/api/users': { max: 100, window: 900 },      // 100/15min
    '/api/posts': { max: 50, window: 900 },       // 50/15min
    '/api/reports': { max: 3, window: 900 }       // 3/15min (expensive)
  };
  
  const limit = limits[endpoint] || { max: 100, window: 900 };
  
  const key = `user:${userId}:${endpoint}`;
  const count = await redis.incr(key);
  
  if (count === 1) {
    await redis.expire(key, limit.window);
  }
  
  if (count > limit.max) {
    return res.status(429).json({
      error: 'User rate limit exceeded',
      endpoint,
      limit: limit.max
    });
  }
  
  next();
};
```

**Comparison:**

| Feature | API Keys | User Tokens |
|---------|----------|-------------|
| **Rate Limit** | High (by plan) | Moderate |
| **Key By** | API key | User ID + endpoint |
| **Tiered** | Yes (free/pro/enterprise) | No (same for all) |
| **Per-Endpoint** | No (global limit) | Yes |
| **Billing** | Based on usage | No |

### Q3: Implement rate limiting with exponential backoff

**Answer:**

**Exponential backoff:** Increase wait time for repeated violations.

```typescript
export const exponentialBackoffRateLimiter = async (req, res, next) => {
  const identifier = req.user?.userId || req.ip;
  const attemptKey = `attempts:${identifier}`;
  const lockKey = `locked:${identifier}`;
  
  // Check if locked
  const lockData = await redis.get(lockKey);
  if (lockData) {
    const lock = JSON.parse(lockData);
    const remainingTime = Math.ceil((lock.until - Date.now()) / 1000);
    
    return res.status(429).json({
      error: 'Too many requests',
      retryAfter: remainingTime,
      backoffLevel: lock.level
    });
  }
  
  // Get attempt count
  let attempts = parseInt(await redis.get(attemptKey) || '0');
  
  // Check current window
  const windowKey = `window:${identifier}`;
  const requests = await redis.incr(windowKey);
  
  if (requests === 1) {
    await redis.expire(windowKey, 60);  // 1 minute window
  }
  
  // Exceeded limit?
  if (requests > 10) {
    attempts++;
    await redis.set(attemptKey, attempts, 'EX', 3600);  // Remember for 1 hour
    
    // Calculate backoff: 2^attempts seconds
    const backoffSeconds = Math.min(Math.pow(2, attempts), 3600);  // Max 1 hour
    const until = Date.now() + (backoffSeconds * 1000);
    
    await redis.set(lockKey, JSON.stringify({ level: attempts, until }), 'EX', backoffSeconds);
    
    logger.warn('Exponential backoff triggered', {
      identifier,
      attempts,
      backoffSeconds
    });
    
    return res.status(429).json({
      error: 'Rate limit exceeded with exponential backoff',
      retryAfter: backoffSeconds,
      backoffLevel: attempts,
      message: `Wait ${backoffSeconds} seconds. Backoff increases with repeated violations.`
    });
  }
  
  // Success - reset attempts counter
  if (attempts > 0) {
    await redis.del(attemptKey);
  }
  
  next();
};

// Backoff progression:
// 1st violation: 2^1 = 2 seconds
// 2nd violation: 2^2 = 4 seconds
// 3rd violation: 2^3 = 8 seconds
// 4th violation: 2^4 = 16 seconds
// 5th violation: 2^5 = 32 seconds
// 6th violation: 2^6 = 64 seconds
// 10th violation: 2^10 = 1024 seconds (17 min)
```

---

## 💡 SECTION 6: PRODUCTION BEST PRACTICES

### 1. Monitor Rate Limit Hits

```typescript
// Track rate limit metrics
const rateLimitMetrics = {
  hits: 0,
  total: 0,
  byEndpoint: new Map<string, number>()
};

export const monitoredRateLimiter = createRateLimiter({
  handler: (req, res) => {
    rateLimitMetrics.hits++;
    rateLimitMetrics.byEndpoint.set(
      req.path,
      (rateLimitMetrics.byEndpoint.get(req.path) || 0) + 1
    );
    
    logger.warn('Rate limit hit', {
      path: req.path,
      ip: req.ip,
      userId: req.user?.userId
    });
    
    res.status(429).json({ error: 'Rate limited' });
  }
});

// Metrics endpoint
app.get('/admin/metrics/rate-limits', (req, res) => {
  res.json({
    totalRequests: rateLimitMetrics.total,
    rateLimitHits: rateLimitMetrics.hits,
    hitRate: rateLimitMetrics.hits / rateLimitMetrics.total,
    byEndpoint: Object.fromEntries(rateLimitMetrics.byEndpoint)
  });
});

// Alert if hit rate too high
setInterval(() => {
  const hitRate = rateLimitMetrics.hits / rateLimitMetrics.total;
  if (hitRate > 0.1) {  // 10% of requests rate limited
    alertOncall('High rate limit hit rate: ' + (hitRate * 100).toFixed(2) + '%');
  }
}, 60000);
```

### 2. Dynamic Rate Limits

```typescript
// Adjust limits based on server load
export const dynamicRateLimiter = createRateLimiter({
  max: async (req) => {
    const load = os.loadavg()[0];  // 1-min load average
    const cpuCount = os.cpus().length;
    
    // If load is high, reduce limit
    if (load > cpuCount * 0.8) {
      return 50;  // Strict limit under load
    } else if (load > cpuCount * 0.5) {
      return 75;  // Moderate limit
    } else {
      return 100;  // Normal limit
    }
  }
});
```

### 3. Whitelist Important IPs

```typescript
export const whitelistedRateLimiter = createRateLimiter({
  skip: (req) => {
    const whitelistedIPs = [
      '10.0.0.1',      // Internal monitoring
      '192.168.1.1'    // Admin IP
    ];
    
    return whitelistedIPs.includes(req.ip);
  }
});
```

### 4. Rate Limit by Cost

```typescript
// Different "cost" per endpoint
export const costBasedRateLimiter = async (req, res, next) => {
  const costs = {
    '/api/users': 1,           // Cheap
    '/api/reports': 10,        // Expensive
    '/api/analytics': 5        // Medium
  };
  
  const cost = costs[req.path] || 1;
  const userId = req.user.userId;
  
  const key = `cost:${userId}`;
  const spent = await redis.incrby(key, cost);
  
  if (spent === cost) {
    await redis.expire(key, 3600);  // 1 hour window
  }
  
  const budget = 1000;  // 1000 "credits" per hour
  
  if (spent > budget) {
    return res.status(429).json({
      error: 'Rate limit exceeded',
      spent,
      budget
    });
  }
  
  req.rateLimit = {
    remaining: budget - spent,
    total: budget
  };
  
  next();
};
```

### 5. Graceful Degradation

```typescript
// Fallback chain: Redis Cluster → Redis Single → Memory → No limiting
let store;

try {
  // Try Redis Cluster first
  if (redisCluster.isReady) {
    store = new RedisStore({ client: redisCluster });
    logger.info('Rate limiter using Redis Cluster');
  }
} catch (err) {
  try {
    // Fallback to single Redis
    if (redisClient.isConnected) {
      store = new RedisStore({ client: redisClient });
      logger.warn('Rate limiter using single Redis (cluster failed)');
    }
  } catch (err) {
    // Fallback to memory
    store = new MemoryStore();
    logger.error('Rate limiter using memory store (Redis unavailable)');
  }
}
```

---

**🎓 END OF PART 2**

Part 2 covered:
- ✅ Pre-configured rate limiters (login, register, refresh, password change, API, strict)
- ✅ Custom accountRateLimiter with account locking mechanism
- ✅ Complete rate limiting architecture diagrams
- ✅ MAANG interview questions with implementations
- ✅ Production best practices (monitoring, dynamic limits, cost-based)

**🎉 M07: RATE LIMITING DEEP DIVE COMPLETE!**

You've mastered:
- Rate limiting algorithms and strategies
- express-rate-limit library integration
- Redis-based distributed rate limiting
- Account locking mechanisms
- Different limiters for different use cases
- Interview questions for MAANG
- Production-ready monitoring and scaling

**Next module:** M08-TOKEN-BLACKLIST-DEEP-DIVE
