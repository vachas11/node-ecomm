# M06: Auth Middleware Deep Dive - PART 2

**File:** `shared/auth/middleware.ts` (145 lines)  
**Level:** Security  
**Prerequisites:** M06 Part 1  
**Time to Master:** 2-3 hours

---

## 🔍 SECTION 3: LINE-BY-LINE CODE ANALYSIS (Part 2)

### 3.1 authorize Middleware (Lines 47-61)

```typescript
export const authorize = (...allowedRoles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    try {
      if (!req.user) throw new UnauthorizedError('User not authenticated');
      if (!allowedRoles.includes(req.user.role)) {
        throw new ForbiddenError(`Access denied. Required roles: ${allowedRoles.join(', ')}`);
      }

      logger.debug('User authorized', { userId: req.user.userId, role: req.user.role, allowedRoles });
      next();
    } catch (error) {
      next(error);
    }
  };
};
```

**Purpose:** Check if authenticated user has required role(s).

#### Line 47: Rest Parameters

```typescript
export const authorize = (...allowedRoles: string[]) => {
```

**Rest parameter (`...`)** collects arguments into an array:

```typescript
// Single role
authorize('admin')
// allowedRoles = ['admin']

// Multiple roles
authorize('admin', 'moderator')
// allowedRoles = ['admin', 'moderator']

// Array of roles
authorize('admin', 'moderator', 'superadmin')
// allowedRoles = ['admin', 'moderator', 'superadmin']
```

**Alternative approaches:**

```typescript
// Array parameter (less convenient)
authorize(['admin', 'moderator'])

// Rest parameter (more convenient)
authorize('admin', 'moderator')
```

**Usage examples:**

```typescript
// Admin only
app.delete('/api/users/:id', authenticate(), authorize('admin'), deleteUser);

// Admin or moderator
app.post('/api/posts/approve', authenticate(), authorize('admin', 'moderator'), approvePost);

// Any authenticated user (no role check needed - skip authorize)
app.get('/api/profile', authenticate(), getProfile);
```

#### Line 48: Synchronous Middleware

```typescript
return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
```

**Not async** - no database/Redis calls needed:

```typescript
// authenticate: async (checks blacklist in Redis)
export const authenticate = (options = {}) => {
  return async (req, res, next) => {
    await isBlacklisted(jti);  // ← Async Redis call
  };
};

// authorize: sync (just checks req.user.role in memory)
export const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {  // ← Sync check
      throw error;
    }
  };
};
```

**When to use async vs sync middleware:**

| Middleware Type | Use async? | Reason |
|----------------|-----------|---------|
| Database query | ✅ Yes | `await db.query()` |
| Redis check | ✅ Yes | `await redis.get()` |
| HTTP request | ✅ Yes | `await fetch()` |
| In-memory check | ❌ No | Just checking variables |
| Simple validation | ❌ No | No I/O operations |

#### Line 50: Authentication Check

```typescript
if (!req.user) throw new UnauthorizedError('User not authenticated');
```

**Why check if user exists?**

**authorize** must come **after** authenticate:

```typescript
// ✅ CORRECT ORDER
app.get('/admin', authenticate(), authorize('admin'), handler);
                  ↑               ↑
           Sets req.user    Checks req.user.role

// ❌ WRONG ORDER
app.get('/admin', authorize('admin'), authenticate(), handler);
                  ↑                   ↑
          req.user undefined    Sets req.user (too late!)

// Error: Cannot read property 'role' of undefined
```

**Defense against misconfiguration:**

```typescript
// Developer forgets authenticate()
app.get('/admin', authorize('admin'), handler);
                  ↑
            No authenticate() before!

// Without check:
if (!allowedRoles.includes(req.user.role))
// → Runtime error: Cannot read property 'role' of undefined

// With check:
if (!req.user) throw new UnauthorizedError('User not authenticated');
// → Clear error: "User not authenticated"
```

#### Line 51-53: Role Check

```typescript
if (!allowedRoles.includes(req.user.role)) {
  throw new ForbiddenError(`Access denied. Required roles: ${allowedRoles.join(', ')}`);
}
```

**Line 51: Array.includes()**

```typescript
allowedRoles.includes(req.user.role)
```

**Examples:**

```typescript
// User is admin
req.user.role = 'admin'
allowedRoles = ['admin', 'moderator']
allowedRoles.includes('admin')  // → true ✅

// User is regular user
req.user.role = 'user'
allowedRoles = ['admin', 'moderator']
allowedRoles.includes('user')  // → false ❌
```

**Line 52: ForbiddenError**

```typescript
throw new ForbiddenError(`Access denied. Required roles: ${allowedRoles.join(', ')}`);
```

**Why ForbiddenError (403) instead of UnauthorizedError (401)?**

**HTTP status codes semantics:**

| Code | Error | Meaning | Use When |
|------|-------|---------|----------|
| **401 Unauthorized** | UnauthorizedError | "Who are you?" | No/invalid token |
| **403 Forbidden** | ForbiddenError | "I know who you are, but you can't do this" | Valid token, wrong role |

**Example messages:**

```typescript
// 401: Authentication problem
throw new UnauthorizedError('No token provided');
throw new UnauthorizedError('Token expired');
throw new UnauthorizedError('Invalid token');

// 403: Authorization problem
throw new ForbiddenError('Access denied. Required roles: admin');
throw new ForbiddenError('You do not have permission to delete this resource');
```

**Error message with join():**

```typescript
allowedRoles = ['admin', 'moderator', 'superadmin']
allowedRoles.join(', ')
// → 'admin, moderator, superadmin'

// Full error message:
'Access denied. Required roles: admin, moderator, superadmin'
```

**Why include allowed roles in error?**

**Better developer experience:**

```json
// ❌ Vague error
{
  "error": "Access denied"
}

// ✅ Clear error
{
  "error": "Access denied. Required roles: admin, moderator"
}
// Developer knows: "Oh, I need admin or moderator role!"
```

#### Line 55: Audit Logging

```typescript
logger.debug('User authorized', { userId: req.user.userId, role: req.user.role, allowedRoles });
```

**Logs successful authorization:**

```json
{
  "level": "debug",
  "message": "User authorized",
  "userId": 123,
  "role": "admin",
  "allowedRoles": ["admin", "moderator"],
  "timestamp": "2023-01-15T10:30:00.000Z"
}
```

**Why log authorization (not just authentication)?**

**Compliance and forensics:**

```typescript
// Track who accessed what
// "User 123 (admin) accessed DELETE /api/users/456"

// Detect privilege escalation
// "User 123 (user) attempted to access admin endpoint"
// "User 123 (admin) role recently changed from 'user' to 'admin'"
```

**Production enhancement:**

```typescript
logger.info('User authorized', {
  userId: req.user.userId,
  role: req.user.role,
  allowedRoles,
  endpoint: req.path,        // What they accessed
  method: req.method,        // GET/POST/DELETE
  ip: req.ip,               // Where from
  userAgent: req.headers['user-agent']
});
```

#### Lines 56-60: Success and Error Handling

```typescript
next();
} catch (error) {
  next(error);
}
```

**Line 56:** If all checks pass, continue to next middleware/handler.

**Lines 57-59:** Catch and pass errors to error handler.

**Complete flow:**

```
Request arrives
       ↓
authenticate() → Sets req.user
       ↓
authorize('admin') → Checks req.user.role
       ↓
  ├─ Role matches? → next() → Route handler ✅
  │
  └─ Role doesn't match? → throw ForbiddenError → 403 response ❌
```

### 3.2 optionalAuth Middleware (Lines 63-92)

```typescript
export const optionalAuth = (options: AuthOptions = {}) => {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;

      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const decoded = verifyAccessToken(token);

        if (options.checkBlacklist !== false) {
          const blacklisted = await isBlacklisted(decoded.jti);
          if (!blacklisted) {
            req.user = { userId: decoded.userId, email: decoded.email, role: decoded.role, jti: decoded.jti };
            req.token = token;
          }
        } else {
          req.user = { userId: decoded.userId, email: decoded.email, role: decoded.role, jti: decoded.jti };
          req.token = token;
        }
      }

      next();
    } catch (error: any) {
      if (error instanceof UnauthorizedError) {
        logger.warn('Invalid token in optional auth', { ip: req.ip, path: req.path, error: error.message });
      }
      next();
    }
  };
};
```

**Purpose:** Allow both authenticated and anonymous users.

**Use cases:**

```typescript
// Public endpoint with personalized content
app.get('/api/products', optionalAuth(), (req, res) => {
  if (req.user) {
    // Show recommended products based on user history
    return res.json(getRecommendedProducts(req.user.userId));
  } else {
    // Show generic products
    return res.json(getPopularProducts());
  }
});

// Public posts with private drafts
app.get('/api/posts', optionalAuth(), (req, res) => {
  const posts = await getPosts({
    includeDrafts: req.user?.role === 'admin'  // Admins see drafts
  });
  res.json(posts);
});
```

#### Line 66: Check Header Exists

```typescript
const authHeader = req.headers.authorization;
```

**Doesn't throw error** if missing (unlike `authenticate`):

```typescript
// authenticate: Throws if missing
const token = extractToken(req);  // ← Throws UnauthorizedError

// optionalAuth: Just checks
const authHeader = req.headers.authorization;
if (authHeader) {  // ← No error if missing
  // Authenticate user
}
```

#### Lines 68-82: Conditional Authentication

```typescript
if (authHeader && authHeader.startsWith('Bearer ')) {
  const token = authHeader.substring(7);
  const decoded = verifyAccessToken(token);

  if (options.checkBlacklist !== false) {
    const blacklisted = await isBlacklisted(decoded.jti);
    if (!blacklisted) {
      req.user = { userId: decoded.userId, email: decoded.email, role: decoded.role, jti: decoded.jti };
      req.token = token;
    }
  } else {
    req.user = { userId: decoded.userId, email: decoded.email, role: decoded.role, jti: decoded.jti };
    req.token = token;
  }
}
```

**Logic flow:**

```
Has Authorization header?
       ↓
    Yes │ No
        │  ↓
        │ Skip (req.user stays undefined)
        ↓
Valid Bearer token?
       ↓
    Yes │ No
        │  ↓
        │ Skip (catch block handles)
        ↓
Verify token
       ↓
Valid?
       ↓
    Yes │ No
        │  ↓
        │ Skip (catch block handles)
        ↓
Check blacklist (if enabled)
       ↓
Not blacklisted?
       ↓
Set req.user ✅
```

#### Lines 72-76: Blacklist Check with Set

```typescript
if (options.checkBlacklist !== false) {
  const blacklisted = await isBlacklisted(decoded.jti);
  if (!blacklisted) {
    req.user = { ... };
    req.token = token;
  }
}
```

**Key difference from `authenticate`:**

```typescript
// authenticate: Throws if blacklisted
if (blacklisted) throw new UnauthorizedError('Token has been revoked');

// optionalAuth: Just doesn't set req.user
if (!blacklisted) {
  req.user = { ... };  // Only set if NOT blacklisted
}
// If blacklisted: req.user stays undefined (treated as anonymous)
```

**Why different behavior?**

**Graceful degradation:**

```typescript
// User's token is blacklisted (e.g., they logged out on another device)

// With authenticate: Hard failure
// → 401 error, user blocked

// With optionalAuth: Soft failure
// → Treated as anonymous user, still sees public content
```

#### Line 84: Always Call next()

```typescript
next();
```

**Critical:** Always proceed, even without authentication.

```typescript
// authenticate: Only calls next() if authenticated
if (authenticated) {
  next();
} else {
  throw error;  // ← Blocks request
}

// optionalAuth: Always calls next()
if (authenticated) {
  req.user = decoded;
}
next();  // ← Always proceeds
```

#### Lines 85-90: Swallow Errors

```typescript
} catch (error: any) {
  if (error instanceof UnauthorizedError) {
    logger.warn('Invalid token in optional auth', { ip: req.ip, path: req.path, error: error.message });
  }
  next();
}
```

**Line 86: Check Error Type**

```typescript
if (error instanceof UnauthorizedError)
```

**Only log authentication errors:**

```typescript
// Log these:
UnauthorizedError: 'Token expired'
UnauthorizedError: 'Invalid token'

// Don't log these (re-throw):
DatabaseError: 'Connection failed'
Error: 'Redis timeout'
```

**Line 87: Warning Log**

```typescript
logger.warn('Invalid token in optional auth', { ip: req.ip, path: req.path, error: error.message });
```

**Why `warn` not `error`?**

**Not critical** in optional auth context:

```json
{
  "level": "warn",
  "message": "Invalid token in optional auth",
  "ip": "192.168.1.100",
  "path": "/api/products",
  "error": "Token expired"
}
```

**Use cases for this log:**
- Detect token expiry patterns
- Find clients sending malformed tokens
- Monitor potential attacks

**Line 89: Always next()**

```typescript
next();
```

**Never pass error to next():**

```typescript
// ❌ Don't do this in optionalAuth
catch (error) {
  next(error);  // Would block request
}

// ✅ Always proceed
catch (error) {
  // Log if needed
  next();  // Always continue
}
```

### 3.3 authenticateService Middleware (Lines 94-106)

```typescript
export const authenticateService = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const token = extractToken(req);
    const decoded = verifyServiceToken(token);

    req.service = { serviceId: decoded.serviceId, permissions: decoded.permissions || [], jti: decoded.jti };

    logger.debug('Service authenticated', { serviceId: decoded.serviceId, permissions: decoded.permissions });
    next();
  } catch (error) {
    next(error);
  }
};
```

**Purpose:** Authenticate **service-to-service** requests (not users).

**Use case:**

```typescript
// User Service calls Order Service
// User Service → Order Service

// Order Service endpoint (requires service token)
app.get('/api/orders', authenticateService, (req, res) => {
  console.log(`Service ${req.service.serviceId} requested orders`);
  // req.service = { serviceId: 'user-service', permissions: [...] }
});
```

#### Line 94: Not a Factory

```typescript
export const authenticateService = async (req, res, next) => {
```

**Direct middleware** (not factory):

```typescript
// authenticate: Factory (returns middleware)
export const authenticate = (options = {}) => {
  return async (req, res, next) => { ... };
};

// Usage: Call to get middleware
app.get('/users', authenticate(), handler);
                  ↑
               Call it!

// authenticateService: Direct middleware
export const authenticateService = async (req, res, next) => { ... };

// Usage: Pass directly
app.get('/orders', authenticateService, handler);
                   ↑
              No parentheses!
```

**Why not a factory?**

**No configuration needed:**

```typescript
// authenticate: Configurable
authenticate({ checkBlacklist: true })
authenticate({ checkBlacklist: false })

// authenticateService: No options
// Always same behavior, no configuration
```

#### Line 97: Verify Service Token

```typescript
const decoded = verifyServiceToken(token);
```

**Different from verifyAccessToken:**

```typescript
// verifyAccessToken (M05)
const decoded = jwt.verify(token, JWT_SECRET);
if (decoded.tokenType !== 'access') throw error;
// Returns: { userId, email, role, jti, tokenType: 'access' }

// verifyServiceToken
const decoded = jwt.verify(token, JWT_SECRET);
if (decoded.tokenType !== 'service') throw error;
// Returns: { serviceId, permissions, jti, tokenType: 'service' }
```

**Token comparison:**

| Field | Access Token | Service Token |
|-------|--------------|---------------|
| **Identifies** | User | Service |
| **ID field** | `userId: 123` | `serviceId: 'user-service'` |
| **Permissions** | `role: 'admin'` | `permissions: ['read:orders']` |
| **tokenType** | `'access'` | `'service'` |

#### Line 99: Set req.service

```typescript
req.service = { serviceId: decoded.serviceId, permissions: decoded.permissions || [], jti: decoded.jti };
```

**Why `|| []` for permissions?**

**Defensive programming:**

```typescript
// Token might not have permissions field
decoded.permissions  // → undefined

// Without fallback:
req.service = { permissions: undefined }
req.service.permissions.includes('read:orders')  // ❌ Error!

// With fallback:
req.service = { permissions: decoded.permissions || [] }
req.service.permissions.includes('read:orders')  // ✅ Returns false
```

**req.service structure:**

```typescript
{
  serviceId: 'user-service',
  permissions: ['read:orders', 'create:orders'],
  jti: 'b4g9c0d3-e2f5-a8b1-c6d9-e3f7a0b4c8d2'
}
```

### 3.4 authorizeService Middleware (Lines 108-126)

```typescript
export const authorizeService = (...requiredPermissions: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    try {
      if (!req.service) throw new UnauthorizedError('Service not authenticated');

      const { serviceId, permissions } = req.service;
      const hasPermission = requiredPermissions.some(required => permissions.includes(required));

      if (!hasPermission) {
        throw new ForbiddenError(`Service '${serviceId}' lacks required permissions: ${requiredPermissions.join(', ')}`);
      }

      logger.debug('Service authorized', { serviceId, requiredPermissions, grantedPermissions: permissions });
      next();
    } catch (error) {
      next(error);
    }
  };
};
```

**Purpose:** Check if service has required permissions.

**Usage:**

```typescript
// Require read:orders permission
app.get('/api/orders', 
  authenticateService, 
  authorizeService('read:orders'), 
  getOrders
);

// Require write:orders OR delete:orders (any one)
app.post('/api/orders', 
  authenticateService, 
  authorizeService('write:orders', 'create:orders'), 
  createOrder
);
```

#### Line 114: Check Service Authenticated

```typescript
if (!req.service) throw new UnauthorizedError('Service not authenticated');
```

**Similar to authorize checking req.user:**

```typescript
// authorize: Check user authenticated
if (!req.user) throw new UnauthorizedError('User not authenticated');

// authorizeService: Check service authenticated
if (!req.service) throw new UnauthorizedError('Service not authenticated');
```

#### Line 116-117: Permission Check

```typescript
const { serviceId, permissions } = req.service;
const hasPermission = requiredPermissions.some(required => permissions.includes(required));
```

**Line 116: Destructure**

```typescript
const { serviceId, permissions } = req.service;

// Same as:
const serviceId = req.service.serviceId;
const permissions = req.service.permissions;
```

**Line 117: Array.some()**

```typescript
requiredPermissions.some(required => permissions.includes(required))
```

**What `some()` does:**

Returns `true` if **any** element matches:

```typescript
// Service has these permissions
permissions = ['read:orders', 'read:users']

// Endpoint requires any one of these
requiredPermissions = ['read:orders', 'write:orders']

// Check
requiredPermissions.some(required => permissions.includes(required))
// Iteration 1: permissions.includes('read:orders')  → true ✅
// → Returns true immediately (short-circuit)

// Result: hasPermission = true
```

**Why `some()` not `every()`?**

**OR logic** (any permission sufficient):

```typescript
// some(): Requires ANY permission (OR)
authorizeService('read:orders', 'write:orders')
// Service needs: read:orders OR write:orders

// every(): Would require ALL permissions (AND)
requiredPermissions.every(required => permissions.includes(required))
// Service needs: read:orders AND write:orders
```

**Example scenarios:**

```typescript
// Service permissions
permissions = ['read:orders', 'read:users', 'write:users']

// Scenario 1: Require read:orders OR write:orders
requiredPermissions = ['read:orders', 'write:orders']
hasPermission = true  // ✅ Has read:orders

// Scenario 2: Require delete:orders OR admin:*
requiredPermissions = ['delete:orders', 'admin:*']
hasPermission = false  // ❌ Has neither

// Scenario 3: Require read:users
requiredPermissions = ['read:users']
hasPermission = true  // ✅ Has read:users
```

#### Line 119-120: Permission Denied

```typescript
if (!hasPermission) {
  throw new ForbiddenError(`Service '${serviceId}' lacks required permissions: ${requiredPermissions.join(', ')}`);
}
```

**Clear error message:**

```
Service 'user-service' lacks required permissions: delete:orders, admin:delete
```

**Why include service ID?**

**Better debugging:**

```json
// ❌ Vague
{
  "error": "Insufficient permissions"
}

// ✅ Clear
{
  "error": "Service 'user-service' lacks required permissions: delete:orders"
}
// Developer knows: "user-service needs delete:orders permission"
```

### 3.5 checkBlacklist Middleware (Lines 128-142)

```typescript
export const checkBlacklist = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const token = extractToken(req);
    const decoded = decodeTokenUnsafe(token);

    if (!decoded || !decoded.jti) throw new UnauthorizedError('Invalid token format');

    const blacklisted = await isBlacklisted(decoded.jti as string);
    if (blacklisted) throw new UnauthorizedError('Token has been revoked');

    next();
  } catch (error) {
    next(error);
  }
};
```

**Purpose:** Standalone blacklist check (without authentication).

**Use case:**

```typescript
// Check blacklist before expensive operations
app.post('/api/process-large-file', 
  checkBlacklist,  // ← Quick blacklist check first
  authenticate(),   // ← Full authentication
  uploadFile,      // ← Expensive operation
  processFile
);

// Why?
// 1. checkBlacklist is fast (just Redis lookup)
// 2. Blocks revoked tokens ASAP
// 3. Saves CPU on token verification if already blacklisted
```

#### Line 131: Decode Without Verification

```typescript
const decoded = decodeTokenUnsafe(token);
```

**Why `decodeTokenUnsafe`?**

**Performance:**

```typescript
// verifyAccessToken: Slow (signature verification)
const decoded = jwt.verify(token, JWT_SECRET);
// → HMAC-SHA256 computation (~1-2ms)

// decodeTokenUnsafe: Fast (just base64 decode)
const decoded = jwt.decode(token);
// → Base64 decode (~0.1ms)
```

**For blacklist check, we only need `jti`:**

```typescript
// Don't need to verify signature yet
// Just need token ID to check Redis
const decoded = decodeTokenUnsafe(token);
const blacklisted = await redis.exists(`blacklist:${decoded.jti}`);
```

**Security is fine because:**

1. This middleware should be used with `authenticate()`
2. `authenticate()` will verify signature properly
3. This just checks blacklist early

#### Line 133: Validate Decoded Token

```typescript
if (!decoded || !decoded.jti) throw new UnauthorizedError('Invalid token format');
```

**Two checks:**

```typescript
// Check 1: Token decoded successfully?
!decoded
// Token might be malformed (not valid JWT format)

// Check 2: Token has jti field?
!decoded.jti
// Token might be missing jti (shouldn't happen with our tokens)
```

**Example failures:**

```typescript
// Invalid token format
const token = 'not.a.valid.jwt';
const decoded = jwt.decode(token);
// decoded = null

// Valid JWT but missing jti (old token format)
const token = 'eyJ...';  // { userId: 123, email: '...' }
const decoded = jwt.decode(token);
// decoded = { userId: 123, email: '...' }
// decoded.jti = undefined
```

#### Line 135: Type Assertion

```typescript
const blacklisted = await isBlacklisted(decoded.jti as string);
```

**Why `as string`?**

**TypeScript doesn't know jti is string:**

```typescript
// decoded.jti could be undefined (from jwt.JwtPayload type)
decoded.jti: string | undefined

// But we already checked it exists (line 133)
if (!decoded.jti) throw error;

// So we know it's string, tell TypeScript
decoded.jti as string
```

---

## 🏗️ SECTION 4: COMPLETE AUTHENTICATION ARCHITECTURE

### 4.1 Full Middleware Chain

```
┌────────────────────────────────────────────────────────────────────┐
│                   COMPLETE MIDDLEWARE FLOW                         │
└────────────────────────────────────────────────────────────────────┘

CLIENT REQUEST
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│ app.use(express.json())                                         │
│ Parse JSON body                                                 │
└──────────────────────────┬──────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│ app.use(logger)                                                 │
│ Log: "POST /api/users 127.0.0.1"                               │
└──────────────────────────┬──────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│ authenticate()                                                  │
│ 1. Extract token from Authorization header                     │
│ 2. Verify JWT signature                                        │
│ 3. Check token not expired                                     │
│ 4. Check blacklist (if enabled)                                │
│ 5. Set req.user = { userId, email, role, jti }                │
└──────────────────────────┬──────────────────────────────────────┘
       │
       ├─ ✅ Success → req.user set
       │
       └─ ❌ Failure → 401 Unauthorized
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│ authorize('admin', 'moderator')                                 │
│ 1. Check req.user exists                                        │
│ 2. Check req.user.role in ['admin', 'moderator']              │
└──────────────────────────┬──────────────────────────────────────┘
       │
       ├─ ✅ Role matches → Continue
       │
       └─ ❌ Role doesn't match → 403 Forbidden
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│ ROUTE HANDLER                                                   │
│ async (req, res) => {                                          │
│   // Business logic                                            │
│   const users = await db.query('SELECT * FROM users');        │
│   res.json(users);                                             │
│ }                                                               │
└──────────────────────────┬──────────────────────────────────────┘
       │
       ▼
RESPONSE SENT TO CLIENT
```

### 4.2 Different Endpoint Types

**1. Public Endpoint (no auth)**

```typescript
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Flow:
// Request → Route handler → Response
```

**2. Public with Optional Auth**

```typescript
app.get('/api/products', optionalAuth(), (req, res) => {
  if (req.user) {
    res.json(getPersonalizedProducts(req.user.userId));
  } else {
    res.json(getPopularProducts());
  }
});

// Flow:
// Request → optionalAuth → Route handler → Response
// (req.user set if token provided, undefined otherwise)
```

**3. Authenticated Endpoint**

```typescript
app.get('/api/profile', authenticate(), (req, res) => {
  res.json(req.user);
});

// Flow:
// Request → authenticate → Route handler → Response
// (req.user always set, or 401 error)
```

**4. Role-Protected Endpoint**

```typescript
app.delete('/api/users/:id', authenticate(), authorize('admin'), async (req, res) => {
  await deleteUser(req.params.id);
  res.json({ message: 'Deleted' });
});

// Flow:
// Request → authenticate → authorize → Route handler → Response
// (req.user set + role is 'admin', or 403 error)
```

**5. Service Endpoint**

```typescript
app.get('/api/orders', authenticateService, authorizeService('read:orders'), (req, res) => {
  const orders = await getOrders();
  res.json(orders);
});

// Flow:
// Request → authenticateService → authorizeService → Route handler → Response
// (req.service set with permissions, or 401/403 error)
```

### 4.3 Error Flow Diagram

```
┌────────────────────────────────────────────────────────────────┐
│                      ERROR HANDLING FLOW                       │
└────────────────────────────────────────────────────────────────┘

Request arrives
       │
       ▼
authenticate()
       │
       ├─ No Authorization header
       │  → throw UnauthorizedError('No token provided')
       │  → catch (error) { next(error) }
       │  → Error handler middleware
       │  → Response: 401 { "error": "No token provided" }
       │
       ├─ Token expired
       │  → throw UnauthorizedError('Token expired')
       │  → catch (error) { next(error) }
       │  → Error handler middleware
       │  → Response: 401 { "error": "Token expired" }
       │
       ├─ Token blacklisted
       │  → throw UnauthorizedError('Token has been revoked')
       │  → catch (error) { next(error) }
       │  → Error handler middleware
       │  → Response: 401 { "error": "Token has been revoked" }
       │
       └─ ✅ Success → next()
              │
              ▼
         authorize('admin')
              │
              ├─ req.user undefined
              │  → throw UnauthorizedError('User not authenticated')
              │  → catch (error) { next(error) }
              │  → Error handler middleware
              │  → Response: 401 { "error": "User not authenticated" }
              │
              ├─ Wrong role
              │  → throw ForbiddenError('Access denied. Required roles: admin')
              │  → catch (error) { next(error) }
              │  → Error handler middleware
              │  → Response: 403 { "error": "Access denied..." }
              │
              └─ ✅ Success → next()
                     │
                     ▼
                Route Handler
```

---

## 🎯 SECTION 5: MAANG INTERVIEW QUESTIONS

### Q1: Explain the difference between authentication and authorization middleware

**Answer:**

**Authentication:** Verifies **WHO** you are

```typescript
// authenticate middleware
export const authenticate = () => {
  return async (req, res, next) => {
    // 1. Extract token from header
    const token = extractToken(req);
    
    // 2. Verify JWT signature and expiration
    const decoded = verifyAccessToken(token);
    
    // 3. Set user identity on request
    req.user = decoded;
    
    next();
  };
};

// Result: We know user ID, email, role
// But we haven't checked permissions yet
```

**Authorization:** Verifies **WHAT** you can do

```typescript
// authorize middleware
export const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    // Assumes authenticate() already ran
    
    // Check if user has required role
    if (!allowedRoles.includes(req.user.role)) {
      throw new ForbiddenError('Access denied');
    }
    
    next();
  };
};

// Result: We verified user has permission for this action
```

**Key differences:**

| Aspect | Authentication | Authorization |
|--------|---------------|---------------|
| **Question** | Who are you? | What can you do? |
| **Verifies** | Identity (valid token) | Permissions (role/permissions) |
| **Sets** | `req.user` | Nothing (just checks) |
| **Error** | 401 Unauthorized | 403 Forbidden |
| **Order** | First | Second |

**Real-world analogy:**

```
Airport Security:

Authentication = Passport check
- Verifies WHO you are (identity)
- If passport invalid → Not allowed in (401)

Authorization = Boarding pass check
- Verifies WHAT you can do (which flight)
- If wrong ticket → Can't board this flight (403)
```

**Usage example:**

```typescript
// Public endpoint - No auth needed
app.get('/api/products', getProducts);

// Authenticated endpoint - WHO but not WHAT
app.get('/api/profile', authenticate(), getProfile);
// Any authenticated user can access

// Authorized endpoint - WHO + WHAT
app.delete('/api/users/:id', authenticate(), authorize('admin'), deleteUser);
// Must be authenticated AND admin role
```

### Q2: How would you implement rate limiting for authentication endpoints?

**Answer:**

**Why rate limit auth endpoints?**

Prevent **brute force attacks**:

```typescript
// Attacker tries to guess passwords
POST /auth/login { email: 'admin@example.com', password: 'password1' }
POST /auth/login { email: 'admin@example.com', password: 'password2' }
POST /auth/login { email: 'admin@example.com', password: 'password3' }
// ... 1000 attempts per second

// Without rate limiting: Eventually finds correct password
// With rate limiting: Blocked after 5 attempts
```

**Implementation approaches:**

**1. Redis-based rate limiting:**

```typescript
import Redis from 'ioredis';
const redis = new Redis();

export const loginRateLimiter = async (req, res, next) => {
  const key = `login-attempts:${req.body.email}`;
  
  // Increment attempt count
  const attempts = await redis.incr(key);
  
  // Set expiry on first attempt (15 min window)
  if (attempts === 1) {
    await redis.expire(key, 900);  // 15 minutes
  }
  
  // Check limit
  if (attempts > 5) {
    const ttl = await redis.ttl(key);
    return res.status(429).json({
      error: 'Too many login attempts',
      retryAfter: ttl
    });
  }
  
  next();
};

// Usage
app.post('/auth/login', loginRateLimiter, login);
```

**2. Token bucket algorithm:**

```typescript
class TokenBucket {
  private tokens: Map<string, { count: number; lastRefill: number }>;
  private capacity: number;
  private refillRate: number;
  
  constructor(capacity: number, refillRate: number) {
    this.tokens = new Map();
    this.capacity = capacity;  // Max tokens
    this.refillRate = refillRate;  // Tokens per second
  }
  
  consume(key: string, amount: number = 1): boolean {
    const now = Date.now();
    const bucket = this.tokens.get(key) || { count: this.capacity, lastRefill: now };
    
    // Refill tokens based on time passed
    const timePassed = (now - bucket.lastRefill) / 1000;
    const tokensToAdd = timePassed * this.refillRate;
    bucket.count = Math.min(this.capacity, bucket.count + tokensToAdd);
    bucket.lastRefill = now;
    
    // Try to consume tokens
    if (bucket.count >= amount) {
      bucket.count -= amount;
      this.tokens.set(key, bucket);
      return true;  // Allowed
    }
    
    return false;  // Rate limited
  }
}

const limiter = new TokenBucket(10, 1);  // 10 tokens, refill 1/sec

export const rateLimitMiddleware = (req, res, next) => {
  const key = req.ip;
  
  if (!limiter.consume(key)) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }
  
  next();
};
```

**3. Sliding window (Redis):**

```typescript
export const slidingWindowRateLimiter = async (req, res, next) => {
  const key = `rate-limit:${req.ip}`;
  const now = Date.now();
  const windowSize = 60 * 1000;  // 1 minute
  const maxRequests = 10;
  
  // Add current request timestamp
  await redis.zadd(key, now, `${now}-${Math.random()}`);
  
  // Remove requests outside window
  await redis.zremrangebyscore(key, 0, now - windowSize);
  
  // Count requests in window
  const count = await redis.zcard(key);
  
  // Set expiry
  await redis.expire(key, 60);
  
  if (count > maxRequests) {
    return res.status(429).json({
      error: 'Too many requests',
      limit: maxRequests,
      window: '1 minute'
    });
  }
  
  next();
};
```

**4. Different limits for different endpoints:**

```typescript
const createRateLimiter = (maxAttempts: number, windowSeconds: number) => {
  return async (req, res, next) => {
    const key = `rate-limit:${req.path}:${req.ip}`;
    const attempts = await redis.incr(key);
    
    if (attempts === 1) {
      await redis.expire(key, windowSeconds);
    }
    
    if (attempts > maxAttempts) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }
    
    next();
  };
};

// Strict limit for login
app.post('/auth/login', createRateLimiter(5, 900), login);

// More lenient for token refresh
app.post('/auth/refresh', createRateLimiter(20, 60), refresh);

// Very lenient for public endpoints
app.get('/api/products', createRateLimiter(100, 60), getProducts);
```

**5. Exponential backoff:**

```typescript
export const exponentialBackoffRateLimiter = async (req, res, next) => {
  const key = `login-attempts:${req.body.email}`;
  const attempts = await redis.incr(key);
  
  if (attempts === 1) {
    await redis.expire(key, 3600);  // 1 hour
  }
  
  // Calculate wait time: 2^attempts seconds
  const waitTime = Math.pow(2, attempts - 1);
  const lockKey = `login-locked:${req.body.email}`;
  const locked = await redis.get(lockKey);
  
  if (locked) {
    const ttl = await redis.ttl(lockKey);
    return res.status(429).json({
      error: 'Too many attempts',
      retryAfter: ttl
    });
  }
  
  // Lock account after failed attempt
  if (attempts > 3) {
    await redis.setex(lockKey, waitTime, '1');
    return res.status(429).json({
      error: `Account locked for ${waitTime} seconds`
    });
  }
  
  next();
};
```

**Best practices:**

1. **Different limits** for different actions
2. **IP + email** combined key (prevent distributed attacks)
3. **Exponential backoff** for repeated failures
4. **Clear error messages** with retry-after
5. **Monitor** rate limit hits (detect attacks)

### Q3: How would you implement refresh token rotation?

**Answer:**

**Refresh token rotation:** Generate a new refresh token every time it's used, invalidate the old one.

**Why?**

**Security:** If refresh token stolen, window of use is minimized.

**Implementation:**

```typescript
app.post('/auth/refresh', async (req, res) => {
  try {
    const oldRefreshToken = req.body.refreshToken;
    
    // 1. Verify old refresh token
    const decoded = verifyRefreshToken(oldRefreshToken);
    
    // 2. Check if token already used (reuse detection)
    const used = await redis.get(`refresh-used:${decoded.jti}`);
    if (used) {
      // Token reuse detected! Possible attack
      // Revoke ALL tokens for this user
      await revokeAllUserTokens(decoded.userId);
      
      logger.error('Refresh token reuse detected', {
        userId: decoded.userId,
        jti: decoded.jti
      });
      
      return res.status(401).json({
        error: 'Token reuse detected. All sessions revoked.'
      });
    }
    
    // 3. Mark old token as used
    await redis.setex(`refresh-used:${decoded.jti}`, 7 * 24 * 60 * 60, '1');
    
    // 4. Get fresh user data
    const user = await db.query('SELECT * FROM users WHERE id = $1', [decoded.userId]);
    
    // 5. Generate NEW token pair
    const newTokens = generateTokenPair(user);
    
    // 6. Store new refresh token hash in database
    const refreshTokenHash = await bcrypt.hash(newTokens.refreshToken, 10);
    await db.query(
      'UPDATE refresh_tokens SET token_hash = $1, created_at = NOW() WHERE user_id = $2',
      [refreshTokenHash, user.id]
    );
    
    // 7. Return new tokens
    res.json({
      accessToken: newTokens.accessToken,
      refreshToken: newTokens.refreshToken
    });
  } catch (error) {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// Helper: Revoke all tokens for user
async function revokeAllUserTokens(userId: number) {
  // Delete refresh tokens from database
  await db.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
  
  // Increment token version (invalidates all access tokens)
  await db.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [userId]);
}
```

**Token rotation flow:**

```
User has:
  - Access token A1 (expires in 15 min)
  - Refresh token R1 (valid for 7 days)

After 15 minutes:
  - Access token A1 expires
  - Client sends R1 to /auth/refresh

Server:
  1. Verifies R1 is valid ✅
  2. Checks R1 not used before ✅
  3. Marks R1 as used (can't use again)
  4. Generates NEW tokens:
     - Access token A2
     - Refresh token R2
  5. Returns A2 and R2

Client now has:
  - Access token A2 (fresh 15 min)
  - Refresh token R2 (fresh 7 days)
  - Old R1 is now invalid

If attacker tries to use R1:
  - Server detects R1 already used
  - Revokes ALL tokens for this user
  - User must re-login
```

---

## 💡 SECTION 6: PRODUCTION BEST PRACTICES

### 1. Request ID Tracking

```typescript
import { v4 as uuidv4 } from 'uuid';

// Add request ID to all requests
app.use((req, res, next) => {
  req.id = uuidv4();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// Include in logs
logger.info('User authenticated', {
  requestId: req.id,  // ← Track request
  userId: req.user.userId,
  path: req.path
});

// Include in errors
throw new UnauthorizedError('Token expired', {
  requestId: req.id  // ← Client can report this ID
});
```

### 2. Audit Logging

```typescript
export const authenticate = (options = {}) => {
  return async (req, res, next) => {
    try {
      const token = extractToken(req);
      const decoded = verifyAccessToken(token);
      
      // Comprehensive audit log
      logger.info('Authentication success', {
        userId: decoded.userId,
        email: decoded.email,
        role: decoded.role,
        jti: decoded.jti,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        path: req.path,
        method: req.method,
        timestamp: new Date().toISOString()
      });
      
      req.user = decoded;
      next();
    } catch (error) {
      // Log authentication failures
      logger.warn('Authentication failed', {
        ip: req.ip,
        path: req.path,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      
      next(error);
    }
  };
};
```

### 3. Security Headers

```typescript
import helmet from 'helmet';

app.use(helmet());  // Sets security headers

// Custom security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
```

### 4. Token Fingerprinting

```typescript
// Generate fingerprint on login
const fingerprint = crypto.randomBytes(32).toString('hex');
const fingerprintHash = crypto.createHash('sha256').update(fingerprint).digest('hex');

// Include hash in token
const token = generateAccessToken({
  userId: user.id,
  email: user.email,
  role: user.role,
  fingerprint: fingerprintHash  // ← Hash, not actual fingerprint
});

// Send fingerprint to client in HttpOnly cookie
res.cookie('__Secure-Fgp', fingerprint, {
  httpOnly: true,
  secure: true,
  sameSite: 'strict'
});

// Verify fingerprint on every request
export const authenticate = (options = {}) => {
  return async (req, res, next) => {
    const token = extractToken(req);
    const decoded = verifyAccessToken(token);
    
    // Verify fingerprint matches
    const fingerprint = req.cookies['__Secure-Fgp'];
    const fingerprintHash = crypto.createHash('sha256').update(fingerprint).digest('hex');
    
    if (fingerprintHash !== decoded.fingerprint) {
      throw new UnauthorizedError('Token fingerprint mismatch');
    }
    
    req.user = decoded;
    next();
  };
};
```

### 5. Monitoring and Alerts

```typescript
// Track authentication metrics
const authMetrics = {
  successful: 0,
  failed: 0,
  blacklisted: 0
};

export const authenticate = (options = {}) => {
  return async (req, res, next) => {
    try {
      // ... authentication logic
      authMetrics.successful++;
      next();
    } catch (error) {
      if (error.message.includes('blacklisted')) {
        authMetrics.blacklisted++;
      } else {
        authMetrics.failed++;
      }
      
      // Alert on suspicious patterns
      if (authMetrics.failed > 100 && authMetrics.failed / authMetrics.successful > 0.5) {
        alertSecurity('High authentication failure rate');
      }
      
      next(error);
    }
  };
};

// Expose metrics endpoint
app.get('/metrics/auth', (req, res) => {
  res.json(authMetrics);
});
```

---

**🎓 END OF PART 2**

Part 2 covered:
- ✅ authorize middleware (role-based access control)
- ✅ optionalAuth middleware (public endpoints with optional auth)
- ✅ authenticateService & authorizeService (service-to-service)
- ✅ checkBlacklist standalone middleware
- ✅ Complete authentication architecture diagrams
- ✅ MAANG interview questions with detailed answers
- ✅ Production best practices

**🎉 M06: AUTH MIDDLEWARE DEEP DIVE COMPLETE!**

You've mastered:
- Express middleware fundamentals
- Authentication vs authorization
- All authentication middleware patterns
- Service-to-service authentication
- Complete auth flow architecture
- Interview questions for MAANG
- Production-ready security practices

**Next module:** M07-RATE-LIMITING-DEEP-DIVE
