# M06: Auth Middleware Deep Dive - PART 1

**File:** `shared/auth/middleware.ts` (145 lines)  
**Level:** Security  
**Prerequisites:** M02 (Errors), M05 (JWT Auth), Express middleware concepts  
**Time to Master:** 2-3 hours

---

## 📖 SECTION 1: THEORY - Express Middleware Fundamentals

### 1.1 What is Middleware?

**Middleware** = Functions that execute **between** receiving a request and sending a response.

**Real-World Analogy:**

Think of middleware like **airport security checkpoints**:

```
Passenger arrives at airport
       ↓
🛂 Checkpoint 1: Check ticket (authentication)
       ↓
🛂 Checkpoint 2: Check passport (authorization)
       ↓
🛂 Checkpoint 3: Security scan (validation)
       ↓
Passenger boards plane (route handler)
```

**Express middleware flow:**

```
Client sends request
       ↓
🔒 Middleware 1: authenticate (verify JWT)
       ↓
🔒 Middleware 2: authorize (check role)
       ↓
🔒 Middleware 3: validateInput (check data)
       ↓
📍 Route Handler (business logic)
       ↓
Response sent to client
```

### 1.2 Middleware Signature

**Basic middleware function:**

```typescript
function middleware(req: Request, res: Response, next: NextFunction) {
  // Do something
  next();  // ← Call next middleware
}
```

**Three parameters:**

1. **`req`** (Request): Incoming HTTP request
2. **`res`** (Response): Outgoing HTTP response
3. **`next`** (NextFunction): Function to call next middleware

**Flow control:**

```typescript
// ✅ Continue to next middleware
next();

// ❌ Block request (send error)
res.status(401).json({ error: 'Unauthorized' });
// Don't call next()!

// 🔥 Pass error to error handler
next(new Error('Something went wrong'));
```

### 1.3 Middleware Types

**1. Application-level middleware**

```typescript
// Runs on ALL routes
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});
```

**2. Router-level middleware**

```typescript
const router = express.Router();

// Runs only on this router
router.use(authenticate);
router.get('/users', getUsers);
```

**3. Route-specific middleware**

```typescript
// Runs only on this route
app.get('/admin/users', authenticate, authorize('admin'), getUsers);
                       ↑              ↑
                  middleware 1   middleware 2
```

**4. Error-handling middleware**

```typescript
// 4 parameters (note: error first!)
app.use((error, req, res, next) => {
  res.status(500).json({ error: error.message });
});
```

**5. Built-in middleware**

```typescript
app.use(express.json());        // Parse JSON body
app.use(express.urlencoded());  // Parse URL-encoded body
app.use(express.static('public')); // Serve static files
```

### 1.4 Authentication vs Authorization

**Often confused - here's the difference:**

**Authentication: WHO are you?**

```typescript
// Verify identity (JWT token valid?)
app.get('/api/profile', authenticate, (req, res) => {
  // We know WHO you are (req.user.userId)
  res.json(req.user);
});
```

**Authorization: WHAT can you do?**

```typescript
// Verify permissions (are you an admin?)
app.delete('/api/users/:id', authenticate, authorize('admin'), (req, res) => {
  // We know WHO you are + WHAT you can do
  await deleteUser(req.params.id);
});
```

**Visual comparison:**

```
┌─────────────────────────────────────────────────────────┐
│                   AUTHENTICATION                        │
├─────────────────────────────────────────────────────────┤
│ Question: WHO are you?                                  │
│ Verifies: Identity (valid JWT token)                    │
│ Result:   req.user = { userId, email, role }           │
│ Error:    401 Unauthorized (no token / invalid)        │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                   AUTHORIZATION                         │
├─────────────────────────────────────────────────────────┤
│ Question: WHAT can you do?                              │
│ Verifies: Permissions (admin role? correct permission?) │
│ Result:   Proceed to route handler                      │
│ Error:    403 Forbidden (not allowed)                   │
└─────────────────────────────────────────────────────────┘
```

**Example flow:**

```typescript
// User tries to delete another user
DELETE /api/users/123
Authorization: Bearer eyJ...

// Step 1: authenticate (WHO?)
// ✅ Token valid → req.user = { userId: 456, role: 'user' }

// Step 2: authorize(['admin']) (WHAT?)
// ❌ Role is 'user', not 'admin'
// → 403 Forbidden
```

### 1.5 Middleware Execution Order

**Order matters!**

```typescript
// ✅ CORRECT ORDER
app.use(express.json());           // 1. Parse body
app.use(logger);                   // 2. Log request
app.get('/users', authenticate, authorize('admin'), getUsers);
                  ↑               ↑
                  First           Second

// ❌ WRONG ORDER
app.get('/users', authorize('admin'), authenticate, getUsers);
                  ↑                   ↑
                  Checks role first   Then verifies token

// Problem: authorize() checks req.user.role
// But authenticate() hasn't set req.user yet!
// Result: Error (req.user is undefined)
```

**Real execution flow:**

```
Request arrives
       ↓
express.json() → Parse JSON body
       ↓
logger → Log request
       ↓
authenticate → Verify JWT, set req.user
       ↓
authorize → Check req.user.role
       ↓
Route handler → Business logic
       ↓
Response sent
```

### 1.6 Common Middleware Patterns

**Pattern 1: Middleware Factory**

```typescript
// Returns a middleware function
export const authenticate = (options?: AuthOptions) => {
  return async (req, res, next) => {
    // Middleware logic using options
    next();
  };
};

// Usage:
app.get('/users', authenticate({ checkBlacklist: true }), getUsers);
```

**Why factory?**
- Configurable middleware
- Can pass options
- Reusable with different configs

**Pattern 2: Async Middleware with Try-Catch**

```typescript
export const authenticate = async (req, res, next) => {
  try {
    // Async operations
    const decoded = await verifyToken(token);
    next();
  } catch (error) {
    next(error);  // Pass to error handler
  }
};
```

**Why try-catch?**
- Catch async errors
- Pass to error handler
- Don't crash server

**Pattern 3: Request Augmentation**

```typescript
// Add custom properties to request
interface AuthenticatedRequest extends Request {
  user?: { userId: number; email: string; role: string };
}

export const authenticate = async (req: AuthenticatedRequest, res, next) => {
  req.user = decoded;  // ← Augment request
  next();
};

// Later routes access req.user
app.get('/profile', authenticate, (req: AuthenticatedRequest, res) => {
  res.json(req.user);  // ✅ TypeScript knows req.user exists
});
```

**Pattern 4: Early Return**

```typescript
export const authorize = (role: string) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
      // ← Early return, don't call next()
    }
    
    if (req.user.role !== role) {
      return res.status(403).json({ error: 'Forbidden' });
      // ← Early return
    }
    
    next();  // ← Only called if checks pass
  };
};
```

**Why early return?**
- Clear error handling
- Don't proceed on failure
- Explicit flow control

---

## 🔍 SECTION 2: LINE-BY-LINE CODE ANALYSIS (Part 1)

### 2.1 Imports (Lines 1-5)

```typescript
import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, verifyServiceToken, decodeTokenUnsafe } from './jwt';
import { isBlacklisted } from './blacklist';
import { UnauthorizedError, ForbiddenError } from '../errors';
import logger from '../logger';
```

**Line 1: Express types**

```typescript
import { Request, Response, NextFunction } from 'express';
```

**Request:** HTTP request object
- `req.body` - Request body
- `req.params` - URL parameters
- `req.headers` - HTTP headers
- `req.query` - Query parameters

**Response:** HTTP response object
- `res.json()` - Send JSON response
- `res.status()` - Set status code
- `res.send()` - Send response

**NextFunction:** Continue to next middleware
- `next()` - Call next middleware
- `next(error)` - Pass error to error handler

**Line 2: JWT verification**

```typescript
import { verifyAccessToken, verifyServiceToken, decodeTokenUnsafe } from './jwt';
```

From M05 JWT module:
- **verifyAccessToken** - Verify user tokens
- **verifyServiceToken** - Verify service-to-service tokens
- **decodeTokenUnsafe** - Decode without verification (for blacklist check)

**Line 3: Blacklist checking**

```typescript
import { isBlacklisted } from './blacklist';
```

From M08 (future module) - checks if token has been revoked.

**Line 4: Custom errors**

```typescript
import { UnauthorizedError, ForbiddenError } from '../errors';
```

From M02 Error Handling module:
- **UnauthorizedError** - 401 (not authenticated)
- **ForbiddenError** - 403 (not authorized)

**Line 5: Logging**

```typescript
import logger from '../logger';
```

From M01 Logger module - Winston logger for audit trails.

### 2.2 Type Definitions (Lines 7-15)

#### AuthenticatedRequest Interface (Lines 7-11)

```typescript
interface AuthenticatedRequest extends Request {
  user?: { userId: number; email: string; role: string; jti: string };
  token?: string;
  service?: { serviceId: string; permissions: string[]; jti: string };
}
```

**Why extend Request?**

**Type safety** - TypeScript knows about custom properties:

```typescript
// Without AuthenticatedRequest:
app.get('/profile', authenticate, (req: Request, res) => {
  res.json(req.user);  // ❌ TypeScript error: Property 'user' does not exist
});

// With AuthenticatedRequest:
app.get('/profile', authenticate, (req: AuthenticatedRequest, res) => {
  res.json(req.user);  // ✅ TypeScript knows req.user exists
});
```

**Line 8: user property**

```typescript
user?: { userId: number; email: string; role: string; jti: string };
```

**Why optional (`?`)?**

User might not be authenticated:

```typescript
// Public route (no auth)
app.get('/public', (req: AuthenticatedRequest, res) => {
  if (req.user) {
    // Authenticated user
  } else {
    // Anonymous user
  }
});
```

**User object structure:**

```typescript
{
  userId: 123,              // Database user ID
  email: 'john@example.com', // User's email
  role: 'admin',            // User's role
  jti: 'a3f8...'           // JWT ID (for blacklist)
}
```

**Line 9: token property**

```typescript
token?: string;
```

**Why store original token?**

Useful for blacklisting on logout:

```typescript
app.post('/logout', authenticate, async (req: AuthenticatedRequest, res) => {
  // Blacklist this specific token
  await blacklistToken(req.token!);
  res.json({ message: 'Logged out' });
});
```

**Line 10: service property**

```typescript
service?: { serviceId: string; permissions: string[]; jti: string };
```

For **service-to-service** authentication:

```typescript
{
  serviceId: 'user-service',           // Which service
  permissions: ['read:orders'],        // What it can do
  jti: 'b4g9...'                      // Token ID
}
```

**Example usage:**

```typescript
app.get('/api/orders', authenticateService, (req: AuthenticatedRequest, res) => {
  console.log(`Service ${req.service.serviceId} requested orders`);
  // Service is authenticated, not a user
});
```

#### AuthOptions Interface (Lines 13-15)

```typescript
interface AuthOptions {
  checkBlacklist?: boolean;
}
```

**Configuration for authenticate middleware:**

```typescript
// Check blacklist (default)
app.get('/users', authenticate({ checkBlacklist: true }), getUsers);

// Skip blacklist check (faster, less secure)
app.get('/public', authenticate({ checkBlacklist: false }), getUsers);
```

**Why optional blacklist check?**

**Performance trade-off:**

```typescript
// With blacklist check:
// 1. Verify JWT signature (fast)
// 2. Query Redis for blacklist (slow-ish, ~1-2ms)
// Total: ~3-5ms per request

// Without blacklist check:
// 1. Verify JWT signature (fast)
// Total: ~1-2ms per request
```

**When to skip blacklist:**
- High-traffic public endpoints
- Short-lived tokens (15 min)
- Internal services (trusted)

**When to check blacklist:**
- After password change
- After logout
- Sensitive operations

### 2.3 extractToken Helper (Lines 17-23)

```typescript
const extractToken = (req: Request): string => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError('No token provided');
  }
  return authHeader.substring(7);
};
```

**Purpose:** Extract JWT token from Authorization header.

#### Line 18: Get Authorization Header

```typescript
const authHeader = req.headers.authorization;
```

**HTTP Authorization header format:**

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
               ↑      ↑
             Type    Token
```

**Example request:**

```bash
curl http://localhost:3000/api/users \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**authHeader value:**

```typescript
"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

#### Line 19: Validation

```typescript
if (!authHeader || !authHeader.startsWith('Bearer ')) {
```

**Two checks:**

**1. Header exists?**

```typescript
!authHeader
```

```typescript
// No Authorization header
GET /api/users
// authHeader = undefined

// With Authorization header
GET /api/users
Authorization: Bearer eyJ...
// authHeader = "Bearer eyJ..."
```

**2. Correct format?**

```typescript
!authHeader.startsWith('Bearer ')
```

```typescript
// ❌ Wrong format (lowercase)
Authorization: bearer eyJ...

// ❌ Wrong format (typo)
Authorization: Barer eyJ...

// ❌ Wrong format (no space)
Authorization: BearereyJ...

// ✅ Correct format
Authorization: Bearer eyJ...
```

**Why strict format?**

**Security:** Prevent confusion attacks:

```typescript
// Attacker tries non-standard format
Authorization: Basic YWxhZGRpbjpvcGVuc2VzYW1l  // Base64, not JWT!
Authorization: Custom eyJ...                    // Custom scheme

// Our check rejects these ✅
```

#### Line 20: Throw Error

```typescript
throw new UnauthorizedError('No token provided');
```

**Why throw instead of returning null?**

**Middleware pattern** - errors should be thrown:

```typescript
// ❌ Return null approach
const token = extractToken(req);
if (!token) {
  return res.status(401).json({ error: 'No token' });
}
// Problem: Can't reuse in other functions

// ✅ Throw error approach
const token = extractToken(req);
// Automatically caught by try-catch
// Error handler sends 401 response
// Can reuse function anywhere
```

#### Line 22: Extract Token

```typescript
return authHeader.substring(7);
```

**Why `substring(7)`?**

```typescript
"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 0123456
        ↑
   Index 7 (start of token)
```

**Character count:**
- `B` = 0
- `e` = 1
- `a` = 2
- `r` = 3
- `e` = 4
- `r` = 5
- ` ` (space) = 6
- `e` (token start) = 7

**Substring extraction:**

```typescript
const authHeader = "Bearer eyJhbGci...";
const token = authHeader.substring(7);
// token = "eyJhbGci..."
```

**Alternative approaches:**

```typescript
// Using split (less efficient)
const token = authHeader.split(' ')[1];

// Using replace (less clear)
const token = authHeader.replace('Bearer ', '');

// Our approach (clear and efficient)
const token = authHeader.substring(7);
```

### 2.4 authenticate Middleware (Lines 25-45)

```typescript
export const authenticate = (options: AuthOptions = {}) => {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = extractToken(req);
      const decoded = verifyAccessToken(token);

      if (options.checkBlacklist !== false) {
        const blacklisted = await isBlacklisted(decoded.jti);
        if (blacklisted) throw new UnauthorizedError('Token has been revoked');
      }

      req.user = { userId: decoded.userId, email: decoded.email, role: decoded.role, jti: decoded.jti };
      req.token = token;

      logger.debug('User authenticated', { userId: decoded.userId, email: decoded.email, jti: decoded.jti });
      next();
    } catch (error) {
      next(error);
    }
  };
};
```

**Most important middleware** - verifies user identity.

#### Line 25: Middleware Factory Pattern

```typescript
export const authenticate = (options: AuthOptions = {}) => {
  return async (req, res, next) => {
    // Middleware logic
  };
};
```

**Why factory (function returning function)?**

**Configurability:**

```typescript
// Without factory (not configurable)
export const authenticate = async (req, res, next) => {
  // Always checks blacklist
  const blacklisted = await isBlacklisted(jti);
};

// Usage: Can't customize
app.get('/users', authenticate, getUsers);

// With factory (configurable)
export const authenticate = (options = {}) => {
  return async (req, res, next) => {
    // Check blacklist if enabled
    if (options.checkBlacklist) {
      await isBlacklisted(jti);
    }
  };
};

// Usage: Can customize
app.get('/users', authenticate({ checkBlacklist: true }), getUsers);
app.get('/public', authenticate({ checkBlacklist: false }), getUsers);
```

**Default options:**

```typescript
(options: AuthOptions = {})
```

If no options provided, defaults to empty object:

```typescript
// Both equivalent:
authenticate()
authenticate({})
```

#### Line 26: Async Middleware

```typescript
return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
```

**Why async?**

Operations inside are asynchronous:

```typescript
// Async operations:
await isBlacklisted(decoded.jti);  // Redis lookup
await someDatabase.query();        // Database query
await fetch();                     // HTTP request
```

**Return type `Promise<void>`:**

Middleware doesn't return a value, just calls `next()`:

```typescript
// ❌ Don't return anything
return res.json({ user });

// ✅ Call next() to continue
next();
```

#### Line 28: Extract Token

```typescript
const token = extractToken(req);
```

Gets token from `Authorization: Bearer <token>` header.

**What if header missing?**

`extractToken()` throws `UnauthorizedError`, caught by try-catch on line 41.

#### Line 29: Verify Token

```typescript
const decoded = verifyAccessToken(token);
```

From M05 JWT module - verifies:
1. **Signature** valid (using JWT_SECRET)
2. **Not expired** (checks `exp` claim)
3. **Token type** is 'access' (not refresh/service)

**What gets returned?**

```typescript
{
  userId: 123,
  email: 'john@example.com',
  role: 'admin',
  jti: 'a3f8b9c2-d1e4-f7a8-b5c9-d2e6f3a7b1c4',
  tokenType: 'access',
  iat: 1639016800,
  exp: 1639017700
}
```

#### Lines 31-34: Blacklist Check

```typescript
if (options.checkBlacklist !== false) {
  const blacklisted = await isBlacklisted(decoded.jti);
  if (blacklisted) throw new UnauthorizedError('Token has been revoked');
}
```

**Line 31: Check if enabled**

```typescript
if (options.checkBlacklist !== false)
```

**Truth table:**

| options.checkBlacklist | Result | Check runs? |
|------------------------|--------|-------------|
| `undefined` (default) | `!== false` → `true` | ✅ Yes |
| `true` | `!== false` → `true` | ✅ Yes |
| `false` | `!== false` → `false` | ❌ No |

**Why `!== false` instead of `=== true`?**

Default behavior is to check:

```typescript
// With !== false (default = check)
authenticate()                      // Checks ✅
authenticate({ checkBlacklist: true })  // Checks ✅
authenticate({ checkBlacklist: false }) // Skips ❌

// With === true (default = skip)
authenticate()                      // Skips ❌ (bad default!)
authenticate({ checkBlacklist: true })  // Checks ✅
authenticate({ checkBlacklist: false }) // Skips ❌
```

**Line 32: Query blacklist**

```typescript
const blacklisted = await isBlacklisted(decoded.jti);
```

**How isBlacklisted works (from M08):**

```typescript
// Redis check
const exists = await redis.exists(`blacklist:${jti}`);
return exists === 1;  // Returns true if blacklisted
```

**When is token blacklisted?**

```typescript
// User logs out
await redis.set(`blacklist:${jti}`, '1', ttl);

// User changes password
await redis.set(`blacklist:${jti}`, '1', ttl);

// Admin revokes token
await redis.set(`blacklist:${jti}`, '1', ttl);
```

**Line 33: Throw if blacklisted**

```typescript
if (blacklisted) throw new UnauthorizedError('Token has been revoked');
```

**Error flow:**

```
Token blacklisted
       ↓
throw UnauthorizedError
       ↓
Caught by try-catch (line 41)
       ↓
next(error) → Error handler
       ↓
Response: 401 Unauthorized
```

#### Line 36: Set req.user

```typescript
req.user = { userId: decoded.userId, email: decoded.email, role: decoded.role, jti: decoded.jti };
```

**Augment request** with user data:

```typescript
// Before authenticate:
req.user = undefined

// After authenticate:
req.user = {
  userId: 123,
  email: 'john@example.com',
  role: 'admin',
  jti: 'a3f8b9c2-...'
}
```

**Now available in all subsequent middleware and route handlers:**

```typescript
app.get('/profile', authenticate(), (req: AuthenticatedRequest, res) => {
  // req.user is set by authenticate middleware
  res.json({
    id: req.user.userId,
    email: req.user.email,
    role: req.user.role
  });
});
```

#### Line 37: Store Token

```typescript
req.token = token;
```

**Why store original token?**

For logout / blacklisting:

```typescript
app.post('/logout', authenticate(), async (req: AuthenticatedRequest, res) => {
  // Blacklist this specific token
  await blacklistToken(req.token);
  res.json({ message: 'Logged out successfully' });
});
```

#### Line 39: Audit Logging

```typescript
logger.debug('User authenticated', { userId: decoded.userId, email: decoded.email, jti: decoded.jti });
```

**Why log authentication?**

**Security audit trail:**

```json
{
  "level": "debug",
  "message": "User authenticated",
  "userId": 123,
  "email": "john@example.com",
  "jti": "a3f8b9c2-d1e4-f7a8-b5c9-d2e6f3a7b1c4",
  "timestamp": "2023-01-15T10:30:00.000Z"
}
```

**Use cases:**
- Track user activity
- Detect suspicious patterns
- Forensics after security incident
- Compliance (who accessed what data?)

**Production enhancement:**

```typescript
logger.debug('User authenticated', {
  userId: decoded.userId,
  email: decoded.email,
  jti: decoded.jti,
  ip: req.ip,              // User's IP
  userAgent: req.headers['user-agent'],  // Browser/app
  path: req.path,          // Which endpoint
  method: req.method       // GET/POST/etc
});
```

#### Line 40: Continue

```typescript
next();
```

**Call next middleware** in the chain:

```
authenticate() ✅ → next() → authorize() → Route handler
```

If authentication successful, pass control to next middleware/handler.

#### Lines 41-43: Error Handling

```typescript
} catch (error) {
  next(error);
}
```

**Why pass error to next()?**

**Centralized error handling:**

```typescript
// Middleware catches error
catch (error) {
  next(error);  // ← Pass to error handler
}

// Express error handler (at end of middleware chain)
app.use((error, req, res, next) => {
  if (error instanceof UnauthorizedError) {
    res.status(401).json({ error: error.message });
  } else if (error instanceof ForbiddenError) {
    res.status(403).json({ error: error.message });
  } else {
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

**Errors caught:**

1. **No Authorization header**
   ```
   extractToken() → UnauthorizedError('No token provided')
   ```

2. **Invalid token format**
   ```
   extractToken() → UnauthorizedError('No token provided')
   ```

3. **Token expired**
   ```
   verifyAccessToken() → UnauthorizedError('Token expired')
   ```

4. **Invalid signature**
   ```
   verifyAccessToken() → UnauthorizedError('Invalid token')
   ```

5. **Token blacklisted**
   ```
   UnauthorizedError('Token has been revoked')
   ```

---

**🎓 END OF PART 1**

Part 1 covered:
- ✅ Theory: Express middleware fundamentals
- ✅ Authentication vs Authorization concepts
- ✅ Middleware execution order and patterns
- ✅ Line-by-line: Imports, type definitions (lines 1-15)
- ✅ Line-by-line: extractToken helper (lines 17-23)
- ✅ Line-by-line: authenticate middleware (lines 25-45)

**📌 Continue to M06-AUTH-MIDDLEWARE-DEEP-DIVE-PART2.md for:**
- 🔍 authorize middleware (role-based access control)
- 🔍 optionalAuth middleware (public endpoints with optional auth)
- 🔍 authenticateService & authorizeService (service-to-service)
- 🔍 checkBlacklist standalone middleware
- 🏗️ Complete authentication flow diagrams
- 🎯 Interview questions
- 💡 Best practices
