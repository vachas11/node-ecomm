# M05: JWT Authentication Deep Dive - PART 1

**File:** `shared/auth/jwt.ts` (157 lines)  
**Level:** Security  
**Prerequisites:** M02 (Errors), Basic cryptography, Authentication concepts  
**Time to Master:** 3-4 hours

---

## 📖 SECTION 1: THEORY - JWT Authentication Fundamentals

### 1.1 What is JWT?

**JWT** = **J**SON **W**eb **T**oken

A JWT is a **compact, self-contained token** for securely transmitting information between parties as a JSON object.

**Real-World Analogy:**

Think of a JWT like a **movie ticket**:

**Traditional Session (Server-side state):**
- Theater gives you ticket stub with seat number
- Theater keeps master list of all valid tickets
- At entrance: Check your stub against master list
- **Problem:** Theater needs huge database for all tickets!

**JWT (Stateless):**
- Theater gives you ticket with **encrypted signature**
- Ticket contains: your name, movie, seat, timestamp
- Theater has **secret stamp** only they can create
- At entrance: Verify signature (no database lookup!)
- **Benefit:** Theater doesn't need to remember anything!

### 1.2 JWT Structure

A JWT has **three parts** separated by dots:

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEyMywiaWF0IjoxNjM5MDE2ODAwfQ.4p5QcZ8Xj9kVZX7n8P3Y6m2L1wR5tK8aH3bN7uE2fG4
        HEADER                           PAYLOAD                          SIGNATURE
```

**1. Header (Algorithm & Token Type):**
```json
{
  "alg": "HS256",
  "typ": "JWT"
}
```
- `alg`: Signing algorithm (HS256, RS256, etc.)
- `typ`: Token type (always "JWT")

**2. Payload (Claims/Data):**
```json
{
  "userId": 123,
  "email": "john@example.com",
  "role": "user",
  "iat": 1639016800,
  "exp": 1639020400
}
```
- `userId`, `email`, `role`: Custom claims (your data)
- `iat`: Issued at (timestamp)
- `exp`: Expiration (timestamp)

**3. Signature (Verification):**
```
HMACSHA256(
  base64UrlEncode(header) + "." + base64UrlEncode(payload),
  secret
)
```
- Ensures token hasn't been tampered with
- Only server with secret can create valid signature

### 1.3 Access Token vs Refresh Token

**Two-token strategy** for better security:

**Access Token:**
- **Short-lived**: 15 minutes
- **Contains**: User data (userId, email, role)
- **Used for**: Every API request
- **If stolen**: Attacker has 15 minutes of access
- **Stored**: Memory (never localStorage!)

**Refresh Token:**
- **Long-lived**: 7 days
- **Contains**: Only userId (minimal data)
- **Used for**: Getting new access tokens
- **If stolen**: Can revoke immediately
- **Stored**: HttpOnly cookie or secure storage

**Visual flow:**

```
Login
  ↓
Server generates:
  - Access Token (15min)
  - Refresh Token (7d)
  ↓
Client stores both
  ↓
API Request (Access Token in header)
  ↓
  ├─ Valid? → Process request ✅
  │
  └─ Expired? → Client uses Refresh Token
                    ↓
                 Get new Access Token
                    ↓
                 Retry API request ✅
```

**Why this pattern?**

**Security layered defense:**
1. Access token stolen? Only 15 min window
2. Refresh token stolen? Revoke it (blacklist)
3. Both stolen? User re-login required

### 1.4 JWT vs Session Cookies

**Comparison:**

| Feature | JWT | Session Cookies |
|---------|-----|-----------------|
| **Storage** | Client (token) | Server (session DB) |
| **Stateless** | Yes | No |
| **Scalability** | Excellent | Requires shared session store |
| **Revocation** | Hard (need blacklist) | Easy (delete session) |
| **Data size** | Large (all data in token) | Small (only session ID) |
| **Performance** | Fast (no DB lookup) | Slower (DB lookup) |

**When to use JWT:**
- Microservices architecture ✅
- Mobile apps ✅
- API-first applications ✅
- Need horizontal scaling ✅

**When to use sessions:**
- Monolithic applications
- Need instant revocation
- Simple authentication

### 1.5 Common JWT Security Vulnerabilities

**1. Weak Secret:**
```typescript
// ❌ DANGEROUS
const JWT_SECRET = 'secret123';

// ✅ SECURE
const JWT_SECRET = crypto.randomBytes(64).toString('hex');
// → 'a3f8b9c2d1e4f7a8b5c9d2e6f3a7b1c4d8e2f5a9b3c6d1e4f8a2b5c9d3e6f1a4'
```

**2. Algorithm Confusion Attack:**
```typescript
// Attacker changes header:
// { "alg": "none" } ← No signature verification!

// Prevention: Always specify algorithm
jwt.verify(token, secret, { algorithms: ['HS256'] });
```

**3. Storing in localStorage:**
```typescript
// ❌ VULNERABLE to XSS
localStorage.setItem('token', accessToken);

// ✅ SAFE options:
// - Memory variable (lost on refresh)
// - HttpOnly cookie (JS can't access)
// - Secure cookie with SameSite
```

**4. Not checking token type:**
```typescript
// ❌ Refresh token used as access token!
const decoded = jwt.verify(token, secret);

// ✅ Verify token type
const decoded = jwt.verify(token, secret);
if (decoded.tokenType !== 'access') {
  throw new Error('Invalid token type');
}
```

**5. No expiration:**
```typescript
// ❌ Token valid forever
jwt.sign(payload, secret);

// ✅ Always set expiration
jwt.sign(payload, secret, { expiresIn: '15m' });
```

---

## 🔍 SECTION 2: LINE-BY-LINE CODE ANALYSIS (Part 1)

### 2.1 Imports (Lines 1-3)

```typescript
import jwt, { SignOptions } from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { UnauthorizedError } from '../errors';
```

**Line 1: jsonwebtoken library**

- **`jwt`**: Main library for creating and verifying JWTs
- **`SignOptions`**: TypeScript type for jwt.sign() options

**Why jsonwebtoken?**
- Most popular JWT library for Node.js
- Well-tested and maintained
- Full TypeScript support
- Industry standard

**Alternatives:**
- `jose`: Modern, edge-runtime compatible
- `njwt`: More features, less popular
- Custom implementation (not recommended!)

**Line 2: uuid for unique IDs**

```typescript
import { v4 as uuidv4 } from 'uuid';
```

**What is `jti` (JWT ID)?**

Every token gets a unique ID:

```typescript
{
  "userId": 123,
  "jti": "a3f8b9c2-d1e4-f7a8-b5c9-d2e6f3a7b1c4"  // ← Unique token ID
}
```

**Why unique IDs?**

1. **Revocation**: Blacklist specific tokens
2. **Tracking**: Audit which tokens are used
3. **Replay prevention**: Detect token reuse

**Line 3: Error handling**

```typescript
import { UnauthorizedError } from '../errors';
```

Uses our custom error class from M02 for consistent error handling.

### 2.2 Environment Configuration (Lines 5-8, 40)

```typescript
const JWT_SECRET = process.env.JWT_SECRET || '';
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || '15m') as SignOptions['expiresIn'];
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || '';
const JWT_REFRESH_EXPIRES_IN = (process.env.JWT_REFRESH_EXPIRES_IN || '7d') as SignOptions['expiresIn'];

const JWT_ISSUER = process.env.JWT_ISSUER || 'api-gateway';
```

**Line 5: JWT_SECRET**

```typescript
const JWT_SECRET = process.env.JWT_SECRET || '';
```

**Critical security setting!**

**What is the secret?**
- Private key for signing tokens
- Must be kept secret (never commit to git!)
- Should be long and random

**Generating secure secret:**

```bash
# Generate 64-byte random string
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Output (example):
# a3f8b9c2d1e4f7a8b5c9d2e6f3a7b1c4d8e2f5a9b3c6d1e4f8a2b5c9d3e6f1a4b8c2d5e9f3a6b1c4d7e1f4a8
```

**Environment variable:**

```bash
# .env
JWT_SECRET=a3f8b9c2d1e4f7a8b5c9d2e6f3a7b1c4d8e2f5a9b3c6d1e4f8a2b5c9d3e6f1a4
```

**Security best practices:**
- Length: Minimum 256 bits (32 bytes)
- Randomness: Use cryptographically secure random generator
- Rotation: Change periodically (quarterly)
- Storage: Environment variables, not code
- Access: Restricted to production servers only

**Why fallback to empty string?**

```typescript
|| ''
```

Allows app to start without crashing. However, **should validate on startup:**

```typescript
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be set and at least 32 characters');
}
```

**Line 6: JWT_EXPIRES_IN**

```typescript
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || '15m') as SignOptions['expiresIn'];
```

**Default: 15 minutes**

**Why 15 minutes?**
- Short enough: Limited damage if stolen
- Long enough: Reduces refresh token calls
- Industry standard

**Format options:**

```typescript
'15m'    // 15 minutes
'1h'     // 1 hour
'7d'     // 7 days
'24h'    // 24 hours
60       // 60 seconds (number)
```

**Different expiry for different apps:**

```bash
# Public API (more security)
JWT_EXPIRES_IN=5m

# Internal admin (less friction)
JWT_EXPIRES_IN=1h

# Mobile app (balance)
JWT_EXPIRES_IN=15m
```

**Type assertion: `as SignOptions['expiresIn']`**

Ensures TypeScript knows this can be a number or string:

```typescript
SignOptions['expiresIn'] = string | number | undefined
```

**Lines 7-8: Refresh token config**

```typescript
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || '';
const JWT_REFRESH_EXPIRES_IN = (process.env.JWT_REFRESH_EXPIRES_IN || '7d') as SignOptions['expiresIn'];
```

**Why separate secret for refresh tokens?**

**Security isolation:**
- Access token compromised? Refresh tokens still safe
- Refresh token compromised? Access tokens still valid
- Different secrets = defense in depth

**Refresh token expiry: 7 days**

**Why 7 days?**
- Mobile apps: Don't annoy users with frequent logins
- Web apps: Balance security vs UX
- Enterprise: Can be longer (30d) for internal apps

**Line 40: JWT_ISSUER**

```typescript
const JWT_ISSUER = process.env.JWT_ISSUER || 'api-gateway';
```

**What is issuer (`iss` claim)?**

Identifies who created the token:

```json
{
  "userId": 123,
  "iss": "api-gateway",
  "iat": 1639016800
}
```

**Why important?**

In microservices, tokens might come from different services:

```typescript
// API Gateway issues tokens
iss: 'api-gateway'

// Admin service issues admin tokens
iss: 'admin-service'

// Mobile app backend
iss: 'mobile-api'
```

**Verification:**

```typescript
jwt.verify(token, secret, {
  issuer: 'api-gateway'  // Only accept tokens from API gateway
});
```

### 2.3 Type Definitions (Lines 10-38)

#### TokenPayload Interface (Lines 10-17)

```typescript
interface TokenPayload {
  userId: number;
  email: string;
  role: string;
  jti?: string;
  tokenType?: string;
  iat?: number;
}
```

**Required fields:**
- `userId`: User's unique ID
- `email`: User's email (for display)
- `role`: User's role ('user', 'admin', 'moderator')

**Optional fields (added by library):**
- `jti`: JWT ID (unique token identifier)
- `tokenType`: 'access', 'refresh', or 'service'
- `iat`: Issued at timestamp

**Why include email in token?**

Convenience - avoid database lookup:

```typescript
// With email in token
const decoded = verifyToken(req.headers.authorization);
res.json({ 
  message: `Welcome ${decoded.email}` 
});  // No DB query needed!

// Without email
const decoded = verifyToken(req.headers.authorization);
const user = await db.query('SELECT email FROM users WHERE id = $1', [decoded.userId]);
res.json({ 
  message: `Welcome ${user.email}` 
});  // Extra DB query
```

**Trade-off:**
- Pro: Fast (no DB lookup)
- Con: Token size larger, email might be stale if changed

#### RefreshTokenPayload Interface (Lines 19-24)

```typescript
interface RefreshTokenPayload {
  userId: number;
  jti?: string;
  tokenType?: string;
  iat?: number;
}
```

**Why minimal data?**

Refresh tokens should contain **only userId**:

**Security principle: Minimal privilege**
- Refresh token's only job: Generate new access token
- If stolen: Can't access user data (no email, role)
- Must exchange for access token first

**Example attack scenario:**

```typescript
// ❌ BAD: Refresh token has full user data
{
  "userId": 123,
  "email": "admin@company.com",
  "role": "admin",  // ← Attacker knows user is admin!
  "tokenType": "refresh"
}

// ✅ GOOD: Refresh token minimal
{
  "userId": 123,  // Only ID, nothing else
  "tokenType": "refresh"
}
// Attacker can't learn user details from stolen token
```

#### ServiceTokenPayload Interface (Lines 26-32)

```typescript
interface ServiceTokenPayload {
  serviceId: string;
  permissions: string[];
  jti?: string;
  tokenType?: string;
  iat?: number;
}
```

**What are service tokens?**

Tokens for **machine-to-machine** communication:

**Use cases:**
1. **Microservice to microservice:**
   ```typescript
   // User Service calls Order Service
   const token = generateServiceToken('user-service', {
     permissions: ['read:orders', 'create:orders']
   });
   
   axios.get('http://order-service/api/orders', {
     headers: { Authorization: `Bearer ${token}` }
   });
   ```

2. **Background jobs:**
   ```typescript
   // Cron job needs API access
   const token = generateServiceToken('email-worker', {
     permissions: ['read:users', 'send:emails']
   });
   ```

3. **Third-party integrations:**
   ```typescript
   // External service accessing your API
   const token = generateServiceToken('external-analytics', {
     permissions: ['read:events']
   });
   ```

**Permissions array:**

```typescript
permissions: [
  'read:users',
  'write:users',
  'delete:orders',
  'admin:*'
]
```

**Format: `action:resource`**
- `read:users` - Can read user data
- `write:orders` - Can create/update orders
- `admin:*` - Admin access to everything

#### UserForToken Interface (Lines 34-38)

```typescript
interface UserForToken {
  id: number;
  email: string;
  role: string;
}
```

**Purpose:** Input type for `generateTokenPair()`

**Why separate interface?**

Type safety - ensures you pass correct data:

```typescript
// ✅ Correct
const user = await db.query('SELECT id, email, role FROM users WHERE id = $1', [123]);
const tokens = generateTokenPair(user);

// ❌ TypeScript error - missing fields
const user = { id: 123 };
const tokens = generateTokenPair(user);  // Error: missing email and role
```

---

**🎓 END OF PART 1**

Part 1 covered:
- ✅ Theory: What is JWT and how it works
- ✅ Access vs Refresh tokens
- ✅ JWT security vulnerabilities
- ✅ Line-by-line: Imports, configuration, type definitions (lines 1-40)

**📌 Continue to M05-JWT-AUTH-DEEP-DIVE-PART2.md for:**
- 🔍 Token generation functions (generateAccessToken, generateRefreshToken)
- 🔍 Token verification functions (verifyAccessToken, verifyRefreshToken)
- 🔍 Utility functions (getTokenExpiry, getTokenTTL)
- 🏗️ Architecture diagrams
- 🎯 Interview questions
- 💡 Best practices
- ⚡ Real-world scenarios
- 🧪 Hands-on exercises
