# M05: JWT Authentication Deep Dive - PART 2

**File:** `shared/auth/jwt.ts` (157 lines)  
**Level:** Security  
**Prerequisites:** M05 Part 1  
**Time to Master:** 2-3 hours

---

## 🔍 SECTION 3: LINE-BY-LINE CODE ANALYSIS (Part 2 - Token Generation)

### 3.1 generateAccessToken Function (Lines 42-52)

```typescript
export function generateAccessToken(payload: TokenPayload): string {
  return jwt.sign(
    {
      ...payload,
      jti: uuidv4(),
      tokenType: 'access'
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN, issuer: JWT_ISSUER }
  );
}
```

This function creates **access tokens** for user authentication.

#### Line 42: Function Signature

```typescript
export function generateAccessToken(payload: TokenPayload): string
```

**Why `export`?**

Makes the function available to other files:

```typescript
// In user-service/controllers/authController.ts
import { generateAccessToken } from '@shared/auth/jwt';

const accessToken = generateAccessToken({
  userId: user.id,
  email: user.email,
  role: user.role
});
```

**Input: `TokenPayload`**

```typescript
interface TokenPayload {
  userId: number;
  email: string;
  role: string;
  jti?: string;      // Will be added by function
  tokenType?: string; // Will be added by function
  iat?: number;      // Added by jwt.sign()
}
```

**Output: `string`**

The JWT token as a string:

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEyMywiZW1haWwiOiJqb2huQGV4YW1wbGUuY29tIiwicm9sZSI6InVzZXIiLCJqdGkiOiJhM2Y4YjljMi1kMWU0LWY3YTgiLCJ0b2tlblR5cGUiOiJhY2Nlc3MiLCJpYXQiOjE2MzkwMTY4MDAsImV4cCI6MTYzOTAxNzcwMCwiaXNzIjoiYXBpLWdhdGV3YXkifQ.4p5QcZ8Xj9kVZX7n8P3Y6m2L1wR5tK8aH3bN7uE2fG4
```

#### Lines 43-48: jwt.sign() Call

```typescript
return jwt.sign(
  {
    ...payload,
    jti: uuidv4(),
    tokenType: 'access'
  },
  JWT_SECRET,
  { expiresIn: JWT_EXPIRES_IN, issuer: JWT_ISSUER }
);
```

**jwt.sign() parameters:**

```typescript
jwt.sign(payload, secret, options)
```

1. **payload**: Data to encode in token
2. **secret**: Secret key for signing
3. **options**: Additional settings

#### Line 44: Spread Operator

```typescript
{
  ...payload,  // ← Spread all properties from input
  jti: uuidv4(),
  tokenType: 'access'
}
```

**What spread does:**

```typescript
// Input
payload = {
  userId: 123,
  email: 'john@example.com',
  role: 'user'
}

// After spread
{
  userId: 123,
  email: 'john@example.com',
  role: 'user',
  jti: 'a3f8b9c2-d1e4-f7a8-b5c9-d2e6f3a7b1c4',
  tokenType: 'access'
}
```

#### Line 45: JWT ID (jti)

```typescript
jti: uuidv4(),
```

**Generates unique ID:**

```typescript
uuidv4()
// Returns: 'a3f8b9c2-d1e4-f7a8-b5c9-d2e6f3a7b1c4'
```

**Why unique IDs for every token?**

**1. Token revocation:**

```typescript
// Blacklist specific token
await redis.set(`blacklist:${jti}`, '1', 900); // 15 min expiry

// Check if token blacklisted
if (await redis.exists(`blacklist:${decodedToken.jti}`)) {
  throw new UnauthorizedError('Token has been revoked');
}
```

**2. Audit logging:**

```typescript
logger.info('User login', {
  userId: 123,
  jti: 'a3f8b9c2-d1e4-f7a8-b5c9-d2e6f3a7b1c4',
  timestamp: Date.now()
});

// Later: Track which token was used
logger.info('API request', {
  endpoint: '/users/profile',
  jti: 'a3f8b9c2-d1e4-f7a8-b5c9-d2e6f3a7b1c4'
});
```

**3. Prevent replay attacks:**

```typescript
// Store used token IDs
await redis.set(`used:${jti}`, '1', 900);

// On next use
if (await redis.exists(`used:${jti}`)) {
  throw new UnauthorizedError('Token already used');
}
```

**UUID v4 collision probability:**

Chance of collision = practically zero (1 in 5.3 × 10³⁶)

Even generating 1 billion tokens per second for 85 years, collision probability is < 0.0000000001%

#### Line 46: Token Type

```typescript
tokenType: 'access'
```

**Why explicit token type?**

Prevents token confusion attacks:

```typescript
// ❌ VULNERABLE: Accept any token
function verifyToken(token: string) {
  return jwt.verify(token, JWT_SECRET);
}

// Attacker uses refresh token as access token!
// Refresh tokens live 7 days vs 15 minutes

// ✅ SECURE: Check token type
function verifyAccessToken(token: string) {
  const decoded = jwt.verify(token, JWT_SECRET);
  if (decoded.tokenType !== 'access') {
    throw new UnauthorizedError('Invalid token type');
  }
  return decoded;
}
```

**Real attack scenario:**

```typescript
// User logs in, gets:
accessToken = { ..., tokenType: 'access', exp: 15min }
refreshToken = { ..., tokenType: 'refresh', exp: 7days }

// Attacker steals refresh token
// Tries to use it as access token

// Without type check:
// ✅ Works! Attacker has 7-day access token

// With type check:
// ❌ Rejected! Wrong token type
```

#### Line 48: Secret Key

```typescript
JWT_SECRET,
```

Used for **HMAC-SHA256** signature:

```
HMACSHA256(
  base64UrlEncode(header) + "." + base64UrlEncode(payload),
  JWT_SECRET
)
```

**Why this secret is critical:**

```typescript
// If attacker knows JWT_SECRET:
const fakeToken = jwt.sign(
  { userId: 1, role: 'admin' },  // ← Claim to be admin!
  JWT_SECRET
);
// Server accepts fake token ❌

// Without JWT_SECRET:
const fakeToken = jwt.sign(
  { userId: 1, role: 'admin' },
  'wrong-secret'
);
// Server rejects (signature invalid) ✅
```

#### Lines 49: Options

```typescript
{ expiresIn: JWT_EXPIRES_IN, issuer: JWT_ISSUER }
```

**expiresIn: '15m'**

Adds `exp` claim to token:

```typescript
{
  userId: 123,
  iat: 1639016800,   // Issued at: 2021-12-09 12:00:00
  exp: 1639017700    // Expires:  2021-12-09 12:15:00 (15 min later)
}
```

**How expiration works:**

```typescript
// jwt.verify() automatically checks expiration
try {
  jwt.verify(token, JWT_SECRET);
  // ✅ Token valid
} catch (err) {
  if (err.name === 'TokenExpiredError') {
    // ❌ Token expired
    throw new UnauthorizedError('Token expired');
  }
}
```

**issuer: 'api-gateway'**

Adds `iss` claim:

```typescript
{
  userId: 123,
  iss: 'api-gateway'  // ← Who issued this token
}
```

**Why specify issuer?**

In microservices, verify tokens come from correct service:

```typescript
// User Service only accepts tokens from API Gateway
jwt.verify(token, JWT_SECRET, {
  issuer: 'api-gateway'  // ← Reject if iss !== 'api-gateway'
});
```

### 3.2 generateRefreshToken Function (Lines 54-64)

```typescript
export function generateRefreshToken(payload: RefreshTokenPayload): string {
  return jwt.sign(
    {
      ...payload,
      jti: uuidv4(),
      tokenType: 'refresh'
    },
    JWT_REFRESH_SECRET,
    { expiresIn: JWT_REFRESH_EXPIRES_IN, issuer: JWT_ISSUER }
  );
}
```

Creates **refresh tokens** for getting new access tokens.

#### Line 54: Different Payload Type

```typescript
export function generateRefreshToken(payload: RefreshTokenPayload): string
```

**RefreshTokenPayload vs TokenPayload:**

```typescript
// Access token payload (full data)
interface TokenPayload {
  userId: number;
  email: string;    // ← Has email
  role: string;     // ← Has role
}

// Refresh token payload (minimal data)
interface RefreshTokenPayload {
  userId: number;   // ← Only userId!
}
```

**Why minimal data in refresh token?**

**Security by minimal exposure:**

```typescript
// If access token stolen:
// Attacker sees: userId, email, role
// Knows: User is admin, email is admin@company.com

// If refresh token stolen:
// Attacker sees: userId only
// Doesn't know: Email, role, or any other details
```

**Refresh token use case:**

```typescript
// Client: Access token expired
const refreshToken = localStorage.getItem('refreshToken');

// Server: Exchange refresh token for new access token
const decoded = verifyRefreshToken(refreshToken);
// Only has userId, must query database for latest user data
const user = await db.query('SELECT * FROM users WHERE id = $1', [decoded.userId]);

// Generate new access token with fresh data
const newAccessToken = generateAccessToken({
  userId: user.id,
  email: user.email,
  role: user.role
});
```

**Why query database?**

Ensures fresh data in new access token:

```typescript
// User changed role 10 minutes ago
// Old access token: { role: 'user' }
// Database now: { role: 'admin' }

// Without database query:
// New access token: { role: 'user' } ❌ Stale data

// With database query:
// New access token: { role: 'admin' } ✅ Fresh data
```

#### Line 59: Different Secret

```typescript
JWT_REFRESH_SECRET,
```

**Why separate secret for refresh tokens?**

**Defense in depth:**

```typescript
// Scenario 1: Access token secret compromised
JWT_SECRET = 'exposed_secret'
// ❌ Attacker can forge access tokens
// ✅ Attacker CANNOT forge refresh tokens (different secret)

// Scenario 2: Refresh token secret compromised
JWT_REFRESH_SECRET = 'exposed_secret'
// ❌ Attacker can forge refresh tokens
// ✅ Attacker CANNOT forge access tokens (different secret)

// Both compromised:
// ❌ Full breach (rotate both secrets immediately)
```

**Secret rotation strategy:**

```typescript
// Rotate secrets independently
// Week 1: Rotate JWT_SECRET
//   - All access tokens invalidated
//   - Refresh tokens still work
//   - Users get new access tokens automatically

// Week 2: Rotate JWT_REFRESH_SECRET
//   - All refresh tokens invalidated
//   - Users must re-login

// Alternating reduces disruption
```

#### Line 60: Longer Expiration

```typescript
{ expiresIn: JWT_REFRESH_EXPIRES_IN, issuer: JWT_ISSUER }
// JWT_REFRESH_EXPIRES_IN = '7d'
```

**7 days vs 15 minutes:**

| Token Type | Expiry | Why? |
|------------|--------|------|
| Access | 15 min | Short window if stolen |
| Refresh | 7 days | Don't annoy users with frequent logins |

**Trade-off:**

```typescript
// Shorter refresh token expiry:
expiresIn: '1d'  // 1 day
// Pro: More secure (must login daily)
// Con: Annoying for users

// Longer refresh token expiry:
expiresIn: '30d'  // 30 days
// Pro: Better UX (login monthly)
// Con: Longer exposure if stolen

// Balanced:
expiresIn: '7d'  // 7 days
// Pro: Login weekly (acceptable)
// Pro: Limited exposure (1 week)
```

### 3.3 generateServiceToken Function (Lines 66-76)

```typescript
export function generateServiceToken(
  payload: ServiceTokenPayload
): string {
  return jwt.sign(
    { ...payload, jti: uuidv4(), tokenType: 'service' },
    JWT_SECRET,
    { expiresIn: '1h', issuer: JWT_ISSUER }
  );
}
```

Creates **service tokens** for machine-to-machine communication.

#### Line 66-67: Service Token Payload

```typescript
export function generateServiceToken(
  payload: ServiceTokenPayload
): string
```

**ServiceTokenPayload:**

```typescript
interface ServiceTokenPayload {
  serviceId: string;       // Which service
  permissions: string[];   // What it can do
}
```

**Example usage:**

```typescript
// User Service needs to call Order Service
const token = generateServiceToken({
  serviceId: 'user-service',
  permissions: ['read:orders', 'create:orders']
});

// Call Order Service with token
const response = await axios.get('http://order-service/api/orders', {
  headers: {
    Authorization: `Bearer ${token}`
  }
});
```

#### Line 71: Same Secret as Access Tokens

```typescript
JWT_SECRET,
```

**Why same secret as access tokens?**

Both verified by same middleware:

```typescript
// Middleware verifies both user and service tokens
function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    if (decoded.tokenType === 'access') {
      // User token
      req.user = decoded;
    } else if (decoded.tokenType === 'service') {
      // Service token
      req.service = decoded;
    }
    
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}
```

**Alternative approach (separate secret):**

```typescript
const JWT_SERVICE_SECRET = process.env.JWT_SERVICE_SECRET;

// Generate with different secret
generateServiceToken(payload, JWT_SERVICE_SECRET);

// Verify with different secret
jwt.verify(token, JWT_SERVICE_SECRET);

// Pro: Service tokens isolated from user tokens
// Con: More secrets to manage
```

#### Line 72: 1 Hour Expiration

```typescript
{ expiresIn: '1h', issuer: JWT_ISSUER }
```

**Why 1 hour for service tokens?**

Balance between security and operational overhead:

```typescript
// Too short (5 minutes):
expiresIn: '5m'
// Con: Services must refresh tokens every 5 min
// Con: More token generation overhead
// Con: More network calls

// Too long (24 hours):
expiresIn: '24h'
// Con: If stolen, attacker has 24h access
// Con: If permissions change, must wait 24h

// Balanced (1 hour):
expiresIn: '1h'
// Pro: Hourly refresh is reasonable
// Pro: Limited exposure window
// Pro: Permissions update hourly
```

**Automatic token refresh pattern:**

```typescript
class ServiceClient {
  private token: string | null = null;
  private tokenExpiry: number | null = null;

  private async getToken(): Promise<string> {
    // Token expired or about to expire?
    if (!this.token || Date.now() >= this.tokenExpiry! - 60000) {
      // Generate new token
      this.token = generateServiceToken({
        serviceId: 'user-service',
        permissions: ['read:orders']
      });
      
      // Cache for 59 minutes (1 min buffer)
      this.tokenExpiry = Date.now() + 59 * 60 * 1000;
    }
    
    return this.token;
  }

  async callOrderService() {
    const token = await this.getToken();
    return axios.get('http://order-service/api/orders', {
      headers: { Authorization: `Bearer ${token}` }
    });
  }
}
```

### 3.4 Token Generation Flow Diagram

**Full token generation flow:**

```
┌─────────────────────────────────────────────────────────────┐
│                     USER LOGIN FLOW                         │
└─────────────────────────────────────────────────────────────┘

1. User submits credentials
   ┌──────────────┐
   │ POST /login  │
   │ email: john@ │
   │ pass: ****** │
   └──────┬───────┘
          │
          ▼
2. Validate credentials
   ┌──────────────────────────────┐
   │ db.query(                    │
   │   'SELECT * FROM users       │
   │    WHERE email = $1'         │
   │ )                            │
   └──────┬───────────────────────┘
          │
          ▼
3. Generate token pair
   ┌──────────────────────────────────────────────────────────┐
   │ generateTokenPair(user)                                  │
   │   ↓                                                      │
   │   ├─→ generateAccessToken({                             │
   │   │     userId: 123,                                     │
   │   │     email: 'john@example.com',                       │
   │   │     role: 'user'                                     │
   │   │   })                                                 │
   │   │   ↓                                                  │
   │   │   └─→ jwt.sign(                                      │
   │   │         { ...payload, jti: uuid(), tokenType: 'access' }, │
   │   │         JWT_SECRET,                                  │
   │   │         { expiresIn: '15m' }                         │
   │   │       )                                              │
   │   │       ↓                                              │
   │   │       Returns: "eyJhbGciOiJIUzI1NiIsInR5c..."       │
   │   │                                                      │
   │   └─→ generateRefreshToken({                            │
   │         userId: 123                                      │
   │       })                                                 │
   │       ↓                                                  │
   │       └─→ jwt.sign(                                      │
   │             { userId: 123, jti: uuid(), tokenType: 'refresh' }, │
   │             JWT_REFRESH_SECRET,                          │
   │             { expiresIn: '7d' }                          │
   │           )                                              │
   │           ↓                                              │
   │           Returns: "eyJhbGciOiJIUzI1NiIsInR5c..."       │
   └──────────────────────────────────────────────────────────┘
          │
          ▼
4. Return tokens to client
   ┌──────────────────────────────┐
   │ {                            │
   │   accessToken: "eyJ...",     │
   │   refreshToken: "eyJ...",    │
   │   expiresIn: 900             │
   │ }                            │
   └──────────────────────────────┘
```

**Service-to-service flow:**

```
┌─────────────────────────────────────────────────────────────┐
│                SERVICE-TO-SERVICE FLOW                      │
└─────────────────────────────────────────────────────────────┘

1. Service A needs to call Service B
   ┌──────────────────────┐
   │ User Service         │
   │ needs order data     │
   └──────┬───────────────┘
          │
          ▼
2. Generate service token
   ┌────────────────────────────────────────┐
   │ generateServiceToken({                 │
   │   serviceId: 'user-service',           │
   │   permissions: [                       │
   │     'read:orders',                     │
   │     'create:orders'                    │
   │   ]                                    │
   │ })                                     │
   │   ↓                                    │
   │ jwt.sign(                              │
   │   { ..., jti: uuid(), tokenType: 'service' }, │
   │   JWT_SECRET,                          │
   │   { expiresIn: '1h' }                  │
   │ )                                      │
   └────────┬───────────────────────────────┘
          │
          ▼
3. Call Service B with token
   ┌────────────────────────────────────────┐
   │ axios.get(                             │
   │   'http://order-service/api/orders',   │
   │   {                                    │
   │     headers: {                         │
   │       Authorization: `Bearer ${token}` │
   │     }                                  │
   │   }                                    │
   │ )                                      │
   └────────────────────────────────────────┘
```

**Token generation comparison:**

```
┌──────────────┬──────────────┬──────────────┬──────────────┐
│   Feature    │ Access Token │Refresh Token │Service Token │
├──────────────┼──────────────┼──────────────┼──────────────┤
│ Payload      │ Full user    │ Only userId  │ serviceId +  │
│              │ data         │              │ permissions  │
├──────────────┼──────────────┼──────────────┼──────────────┤
│ Secret       │ JWT_SECRET   │JWT_REFRESH   │ JWT_SECRET   │
│              │              │_SECRET       │              │
├──────────────┼──────────────┼──────────────┼──────────────┤
│ Expiration   │ 15 minutes   │ 7 days       │ 1 hour       │
├──────────────┼──────────────┼──────────────┼──────────────┤
│ Token Type   │ 'access'     │ 'refresh'    │ 'service'    │
├──────────────┼──────────────┼──────────────┼──────────────┤
│ Use Case     │ Every API    │ Get new      │ Service to   │
│              │ request      │ access token │ service      │
└──────────────┴──────────────┴──────────────┴──────────────┘
```

---

## 🎨 SECTION 4: TOKEN STRUCTURE VISUALIZATION

### 4.1 Access Token Anatomy

```
ENCODED TOKEN:
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEyMywiZW1haWwiOiJqb2huQGV4YW1wbGUuY29tIiwicm9sZSI6InVzZXIiLCJqdGkiOiJhM2Y4YjljMi1kMWU0LWY3YTgiLCJ0b2tlblR5cGUiOiJhY2Nlc3MiLCJpYXQiOjE2MzkwMTY4MDAsImV4cCI6MTYzOTAxNzcwMCwiaXNzIjoiYXBpLWdhdGV3YXkifQ.4p5QcZ8Xj9kVZX7n8P3Y6m2L1wR5tK8aH3bN7uE2fG4
     │                                  │                                                                                                                                                                                           │
     └──────────── HEADER ─────────────┴──────────────────────────────────────────────────── PAYLOAD ────────────────────────────────────────────────────────────────────────────────────────────┴──────── SIGNATURE ────────

DECODED:

┌─────────────────────────────────────────────────────────────────┐
│ HEADER                                                          │
├─────────────────────────────────────────────────────────────────┤
│ {                                                               │
│   "alg": "HS256",    ← Algorithm: HMAC SHA-256                 │
│   "typ": "JWT"       ← Type: JSON Web Token                    │
│ }                                                               │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ PAYLOAD (Claims)                                                │
├─────────────────────────────────────────────────────────────────┤
│ {                                                               │
│   "userId": 123,            ← Custom: User ID                  │
│   "email": "john@ex.com",   ← Custom: User email               │
│   "role": "user",           ← Custom: User role                │
│   "jti": "a3f8b9c2-...",    ← JWT ID (unique)                  │
│   "tokenType": "access",    ← Custom: Token type               │
│   "iat": 1639016800,        ← Issued at (Unix timestamp)       │
│   "exp": 1639017700,        ← Expires at (15 min later)        │
│   "iss": "api-gateway"      ← Issuer                           │
│ }                                                               │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ SIGNATURE                                                       │
├─────────────────────────────────────────────────────────────────┤
│ HMACSHA256(                                                     │
│   base64UrlEncode(header) + "." + base64UrlEncode(payload),    │
│   JWT_SECRET                                                    │
│ )                                                               │
│ = 4p5QcZ8Xj9kVZX7n8P3Y6m2L1wR5tK8aH3bN7uE2fG4                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Token Size Comparison

```
Access Token (full user data):
────────────────────────────────────────────────────────────────
Header (36 bytes):
  { "alg": "HS256", "typ": "JWT" }

Payload (185 bytes):
  {
    "userId": 123,
    "email": "john@example.com",
    "role": "user",
    "jti": "a3f8b9c2-d1e4-f7a8-b5c9-d2e6f3a7b1c4",
    "tokenType": "access",
    "iat": 1639016800,
    "exp": 1639017700,
    "iss": "api-gateway"
  }

Signature (43 bytes):
  4p5QcZ8Xj9kVZX7n8P3Y6m2L1wR5tK8aH3bN7uE2fG4

Total: ~350 bytes (Base64 encoded)
────────────────────────────────────────────────────────────────

Refresh Token (minimal data):
────────────────────────────────────────────────────────────────
Header (36 bytes):
  { "alg": "HS256", "typ": "JWT" }

Payload (120 bytes):
  {
    "userId": 123,
    "jti": "b4g9c0d3-e2f5-a8b1-c6d9-e3f7a0b4c8d2",
    "tokenType": "refresh",
    "iat": 1639016800,
    "exp": 1639621600,
    "iss": "api-gateway"
  }

Signature (43 bytes):
  5q6RdY9Xk0wVaY8o9Q4Z7n3M2xS6uL9bI4cO8vF3gH5

Total: ~250 bytes (Base64 encoded)
────────────────────────────────────────────────────────────────

Service Token (permissions):
────────────────────────────────────────────────────────────────
Header (36 bytes):
  { "alg": "HS256", "typ": "JWT" }

Payload (210 bytes):
  {
    "serviceId": "user-service",
    "permissions": ["read:orders", "create:orders", "delete:orders"],
    "jti": "c5h0d4e3-f3g6-b9c2-d7e0-f4g8a1c5d9e3",
    "tokenType": "service",
    "iat": 1639016800,
    "exp": 1639020400,
    "iss": "api-gateway"
  }

Signature (43 bytes):
  6r7SeZ0Yl1xWbZ9p0R5A8o4N3yT7vM0cJ5dP9wG4hI6

Total: ~380 bytes (Base64 encoded)
────────────────────────────────────────────────────────────────

Size Impact:
  • Each request sends token in Authorization header
  • 350-380 bytes overhead per request
  • At 1000 req/sec: 350KB/sec = 28GB/month just for tokens!
  • Keep tokens small: Only include necessary data
```

---

**🎓 END OF PART 2**

Part 2 covered:
- ✅ Token generation functions (generateAccessToken, generateRefreshToken, generateServiceToken)
- ✅ Line-by-line analysis of token creation (lines 42-76)
- ✅ UUID usage and JWT ID (jti) purpose
- ✅ Token type field for security
- ✅ Different secrets for defense in depth
- ✅ Token generation flow diagrams
- ✅ Token structure visualization

**📌 Continue to M05-JWT-AUTH-DEEP-DIVE-PART3.md for:**
- 🔍 Token verification functions (verifyAccessToken, verifyRefreshToken, verifyServiceToken)
- 🔍 Utility functions (extractTokenMetadata, generateTokenPair, getTokenExpiry, getTokenTTL)
- 🏗️ Full authentication architecture diagrams
- 🎯 MAANG interview questions about JWT
- 💡 Production best practices
- ⚡ Real-world attack scenarios and defenses
- 🧪 Hands-on exercises
