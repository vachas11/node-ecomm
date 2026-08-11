# M17: Controller Pattern Deep Dive

**Files:**  
- `services/user-service/src/controllers/user.controller.ts` (51 lines)
- `services/user-service/src/routes/auth.routes.ts` (26 lines)
- `services/user-service/src/routes/internal.routes.ts` (131 lines)
- `services/user-service/src/middleware/validator.ts` (78 lines)

**Purpose:** HTTP request/response layer - the waiter that takes orders and serves food

---

## 📖 Part 1: What is the Controller Pattern?

### The Restaurant Analogy (Complete Picture)

```
Customer → Waiter → Chef → Pantry → Storage
 HTTP      Controller  Service  Repository  Database

┌────────────────────────────────────────────┐
│ Customer (HTTP Client)                     │
│ "I'd like pasta with extra cheese"        │
└──────────────┬─────────────────────────────┘
               │
               ▼
┌────────────────────────────────────────────┐
│ WAITER (Controller) ← WE ARE HERE          │
│ - Takes the order (parse HTTP request)    │
│ - Translates to kitchen language          │
│ - Serves the food (format HTTP response)  │
│ - Handles complaints (error handling)     │
└──────────────┬─────────────────────────────┘
               │
               ▼
┌────────────────────────────────────────────┐
│ CHEF (Service Layer)                       │
│ - Validates recipe (business logic)       │
│ - Coordinates cooking steps                │
│ - Applies seasoning (transforms data)      │
└──────────────┬─────────────────────────────┘
               │
               ▼
┌────────────────────────────────────────────┐
│ PANTRY (Repository Layer)                  │
│ - Stores ingredients                       │
│ - Retrieves ingredients                    │
└────────────────────────────────────────────┘
```

### The Problem Controller Solves

**Without Controllers (Bad):**
```typescript
// Everything mixed together
app.post('/register', async (req, res) => {
  try {
    // Parse request
    const { email, password } = req.body;
    
    // Validate
    if (!email) return res.status(400).json({error: 'Email required'});
    
    // Business logic
    const exists = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    if (exists.rows.length > 0) return res.status(409).json({error: 'Email taken'});
    
    // Hash password
    const hash = await bcrypt.hash(password, 10);
    
    // Save
    await db.query('INSERT INTO users (email, password_hash) VALUES ($1, $2)', [email, hash]);
    
    // Response
    res.status(201).json({success: true});
  } catch (err) {
    res.status(500).json({error: 'Something went wrong'});
  }
});
```

**Problems:**
1. Route handler is 50+ lines
2. HTTP concerns mixed with business logic
3. Can't reuse logic (need GraphQL? Duplicate everything)
4. Hard to test (need to mock Express req/res)

**With Controllers (Good):**
```typescript
// Route: Thin, just wiring
app.post('/register', userController.register);

// Controller: HTTP → Service
async register(req, res) {
  const user = await userService.createUser(req.body);
  res.status(201).json({ success: true, data: { user } });
}

// Service: Business logic
async createUser(data) {
  validate(data);
  checkDuplicates(data.email);
  const hash = await hashPassword(data.password);
  return await repo.create({...data, passwordHash: hash});
}
```

### Controller Responsibilities

✅ **What Controllers DO:**
1. **Parse requests:** Extract data from `req.body`, `req.params`, `req.query`
2. **Call services:** Delegate to business logic layer
3. **Format responses:** Convert service results to JSON
4. **Set HTTP status codes:** 200, 201, 400, 404, etc.
5. **Handle errors:** Catch and convert to HTTP responses

❌ **What Controllers DO NOT DO:**
1. Business logic (service's job)
2. Database queries (repository's job)
3. Password hashing (service's job)
4. Validation logic (middleware's job, or service's job)

---

## 🔍 Part 2: Line-by-Line Code Analysis

### Section 1: Controller Factory Pattern (user.controller.ts)

```typescript
1  /**
2   * User Controller - HTTP handlers for user operations
3   * Handles request/response transformation, delegates to UserService
4   */
5
6  import { Request, Response } from 'express';
7  import { UserService } from '../services/user.service';
8  import { asyncHandler } from '../../../../shared/errors';
```

**Line 6:** Import Express types
- `Request`: Incoming HTTP request
- `Response`: Outgoing HTTP response

**Line 7:** Import service layer
- Controller depends on service
- Service does NOT depend on controller (unidirectional dependency)

**Line 8:** Import `asyncHandler` utility
- Wraps async functions to catch errors
- Passes errors to Express error handler

```typescript
10 interface AuthenticatedRequest extends Request {
11   user?: { userId: number; email: string; role: string };
12 }
```

**Lines 10-12:** Extend Express Request type

**Why extend?**
```typescript
// Without extension
async getProfile(req: Request, res: Response) {
  const userId = req.user.userId; // TypeScript error: Property 'user' does not exist
}

// With extension
async getProfile(req: AuthenticatedRequest, res: Response) {
  const userId = req.user!.userId; // TypeScript knows req.user exists
}
```

The `authenticate()` middleware adds `user` to the request:
```typescript
// In authenticate middleware
const payload = jwt.verify(token, secret);
req.user = { userId: payload.userId, email: payload.email, role: payload.role };
next();
```

```typescript
14 export function createUserController(userService: UserService) {
```

**Line 14:** Factory function pattern

**Why factory instead of class?**

**Class pattern (NOT used here):**
```typescript
export class UserController {
  constructor(private userService: UserService) {}
  
  getProfile = async (req, res) => { ... }
  updateProfile = async (req, res) => { ... }
}

// Usage
const controller = new UserController(userService);
app.get('/profile', controller.getProfile);
```

**Factory pattern (USED here):**
```typescript
export function createUserController(userService: UserService) {
  const getProfile = async (req, res) => { ... };
  const updateProfile = async (req, res) => { ... };
  
  return { getProfile, updateProfile };
}

// Usage
const { getProfile, updateProfile } = createUserController(userService);
app.get('/profile', getProfile);
```

**Benefits of factory:**
1. Simpler (no `this` binding issues)
2. Closure captures `userService` automatically
3. Can selectively export methods
4. More functional programming style

---

### Section 2: Get Profile Handler (Lines 15-23)

```typescript
15   const getProfile = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
16     const userId = req.user!.userId;
17     const user = await userService.getUserById(userId);
18
19     res.json({
20       success: true,
21       data: { user: user.toJSON() }
22     });
23   });
```

**Line 15:** Wrap with `asyncHandler`

**What `asyncHandler` does:**
```typescript
// In shared/errors.ts
export const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
```

**Without asyncHandler:**
```typescript
const getProfile = async (req, res) => {
  try {
    const user = await userService.getUserById(req.user!.userId);
    res.json({ success: true, data: { user } });
  } catch (err) {
    // Must manually handle error
    res.status(500).json({ success: false, error: err.message });
  }
};
```

**With asyncHandler:**
```typescript
const getProfile = asyncHandler(async (req, res) => {
  const user = await userService.getUserById(req.user!.userId);
  res.json({ success: true, data: { user } });
  // Errors automatically caught and passed to error handler middleware
});
```

**Line 16:** Extract user ID from request
```typescript
const userId = req.user!.userId;
```

The `!` (non-null assertion) tells TypeScript "I guarantee `req.user` exists"

**Why safe here?**
- Route uses `authenticate()` middleware (see routes section)
- Middleware runs BEFORE controller
- If no token, middleware responds with 401 and stops

**Middleware chain:**
```
Request → authenticate() → getProfile()
          ↓ No token
          401 Response (stops here)
```

**Line 17:** Call service layer
```typescript
const user = await userService.getUserById(userId);
```

**What controller does NOT do:**
- ❌ No database query
- ❌ No business logic
- ❌ No validation

Just delegates to service and handles response.

**Lines 19-22:** Format HTTP response
```typescript
res.json({
  success: true,
  data: { user: user.toJSON() }
});
```

**Standardized response format:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": 123,
      "email": "user@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "role": "customer",
      "isActive": true,
      "emailVerified": false,
      "createdAt": "2026-08-08T10:00:00.000Z",
      "updatedAt": "2026-08-08T10:00:00.000Z"
    }
  }
}
```

**Why `user.toJSON()`?**
```typescript
// User model has toJSON() method
toJSON(): UserPublicData {
  return {
    id: this.id,
    email: this.email,
    // ... other safe fields
    // EXCLUDES password_hash
  };
}
```

Ensures password never leaks into response.

---

### Section 3: Update Profile Handler (Lines 25-35)

```typescript
25   const updateProfile = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
26     const userId = req.user!.userId;
27     const { firstName, lastName, email } = req.body;
28
29     const user = await userService.updateProfile(userId, { firstName, lastName, email });
30
31     res.json({
32       success: true,
33       data: { user: user.toJSON() }
34     });
35   });
```

**Line 27:** Extract fields from request body
```typescript
const { firstName, lastName, email } = req.body;
```

**Note:** No validation here!

**Where validation happens:**
```typescript
// In routes (see later)
router.put('/profile', 
  authenticate(), 
  validate(schemas.updateProfile), // ← Validation middleware
  userController.updateProfile
);
```

Middleware validates BEFORE controller runs:
```
Request → authenticate() → validate() → updateProfile()
                           ↓ Invalid
                           400 Response (stops here)
```

**Line 29:** Pass to service
```typescript
const user = await userService.updateProfile(userId, { firstName, lastName, email });
```

Service handles:
- Email uniqueness check
- Database update
- Logging

Controller just coordinates HTTP.

**Lines 31-34:** Standard success response
- Default status code: 200 (Express default)
- Could explicitly set: `res.status(200).json(...)`

---

### Section 4: Change Password Handler (Lines 37-47)

```typescript
37   const changePassword = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
38     const userId = req.user!.userId;
39     const { currentPassword, newPassword } = req.body;
40
41     await userService.changePassword({ userId, currentPassword, newPassword });
42
43     res.json({
44       success: true,
45       message: 'Password changed successfully'
46     });
47   });
```

**Line 39:** Extract passwords from body
- `validate(schemas.changePassword)` middleware already validated:
  - Both fields present
  - newPassword ≥ 8 characters
  - newPassword ≠ currentPassword

**Line 41:** Service returns boolean, but we don't use it
```typescript
await userService.changePassword(...); // Returns true/false
```

**Why not check return value?**
- Service throws error on failure
- If we reach line 43, operation succeeded
- asyncHandler catches any errors

**Lines 43-46:** Success response with message
```json
{
  "success": true,
  "message": "Password changed successfully"
}
```

**Note:** No `data` field (no user object returned)
- Password change doesn't return updated user
- Just confirmation message

```typescript
49   return { getProfile, updateProfile, changePassword };
50 }
```

**Lines 49-50:** Return object with handlers
- Factory function returns methods
- Used in routes: `userController.getProfile`

---

## 🔍 Part 3: Routes and Middleware

### Section 5: Auth Routes (auth.routes.ts)

```typescript
1  /**
2   * Auth Routes - User profile and password operations
3   * Note: Login, logout, refresh are handled by API Gateway
4   */
5
6  import { Router } from 'express';
7  import { authenticate } from '../../../../shared/auth/middleware';
8  import { validate, schemas } from '../middleware/validator';
9  import { passwordChangeRateLimiter } from '../../../../shared/auth/rateLimiter';
10 import { createUserController } from '../controllers/user.controller';
11 import { UserService } from '../services/user.service';
12 import { UserRepository } from '../repositories/user.repository';
13 import { db } from '../config/database';
```

**Line 7:** Import auth middleware
- Verifies JWT token
- Extracts user data
- Adds to `req.user`

**Line 8:** Import validation middleware and schemas
- `validate()`: Middleware factory
- `schemas`: Joi validation schemas

**Line 9:** Import rate limiter for password changes
- Prevents brute force attacks
- Limits password change attempts

```typescript
15 const router = Router();
16
17 const userRepository = new UserRepository(db);
18 const userService = new UserService(userRepository);
19 const userController = createUserController(userService);
```

**Lines 17-19:** Dependency injection chain

**The dependency flow:**
```
db (PostgreSQL pool)
  ↓
UserRepository (data access)
  ↓
UserService (business logic)
  ↓
UserController (HTTP handlers)
  ↓
Routes (URL mapping)
```

**Each layer only knows about the layer below it:**
- Routes know about Controllers
- Controllers know about Services
- Services know about Repositories
- Repositories know about Database

**No layer knows about layers above it** (unidirectional dependency).

```typescript
21 router.get('/profile', authenticate(), userController.getProfile);
```

**Line 21:** GET /profile endpoint

**Middleware chain:**
```
Request → authenticate() → getProfile()
```

1. `authenticate()` verifies JWT
2. If valid, adds `req.user` and calls `next()`
3. `getProfile()` executes

**Why `authenticate()` is called?**
```typescript
// In shared/auth/middleware.ts
export const authenticate = () => {
  return asyncHandler(async (req, res, next) => {
    const token = extractToken(req);
    const payload = jwt.verify(token, secret);
    req.user = { userId: payload.userId, email: payload.email, role: payload.role };
    next();
  });
};
```

It's a **middleware factory** that returns the actual middleware function.

```typescript
22 router.put('/profile', authenticate(), validate(schemas.updateProfile), userController.updateProfile);
```

**Line 22:** PUT /profile endpoint

**Middleware chain:**
```
Request → authenticate() → validate() → updateProfile()
```

1. Verify JWT token
2. Validate request body against schema
3. Execute controller

**What `validate(schemas.updateProfile)` checks:**
```typescript
// In validator.ts
updateProfile: Joi.object({
  firstName: Joi.string().min(2).max(50).trim().optional(),
  lastName: Joi.string().min(2).max(50).trim().optional(),
  email: Joi.string().email().lowercase().trim().optional()
}).min(1) // At least one field required
```

**Example validation failures:**
```json
// Empty body
{ } → 400 "Must have at least 1 field"

// Invalid email
{ "email": "not-an-email" } → 400 "Please provide a valid email address"

// Field too short
{ "firstName": "J" } → 400 "firstName must be at least 2 characters"
```

```typescript
23 router.put('/change-password', authenticate(), passwordChangeRateLimiter, validate(schemas.changePassword), userController.changePassword);
```

**Line 23:** PUT /change-password endpoint

**Middleware chain:**
```
Request → authenticate() → passwordChangeRateLimiter → validate() → changePassword()
```

**Why rate limiter?**
```typescript
// In shared/auth/rateLimiter.ts
export const passwordChangeRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts
  message: 'Too many password change attempts, please try again later'
});
```

Prevents:
1. Brute force attacks
2. Automated password changes
3. Account takeover attempts

**What `validate(schemas.changePassword)` checks:**
```typescript
changePassword: Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: Joi.string()
    .min(8)
    .required()
    .invalid(Joi.ref('currentPassword')) // Can't be same as current
    .messages({
      'any.invalid': 'New password must be different from current password'
    })
})
```

---

### Section 6: Internal Routes (internal.routes.ts)

```typescript
1  /**
2   * Internal Routes - Service-to-service communication
3   * These endpoints are called by api-gateway, NOT exposed publicly
4   * Security: Network-level isolation (Docker network) + X-Service-Name header check
5   *
6   * IMPORTANT: All routes go through UserService (proper layered architecture)
7   */
```

**Key concept: Internal vs Public routes**

```
┌──────────────────────────────────────────┐
│         Internet (Public)                 │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│         API Gateway (Port 3000)          │
│  Public routes: /api/auth/*               │
└──────────────┬───────────────────────────┘
               │
               │ Docker Network (Private)
               │
               ▼
┌──────────────────────────────────────────┐
│     User Service (Port 3001)             │
│  /api/auth/* ← Public routes              │
│  /api/internal/* ← Internal routes        │
└──────────────────────────────────────────┘
```

**Security layers:**
1. **Network isolation:** User Service not exposed to internet
2. **Header verification:** Check `X-Service-Name` header
3. **Docker network:** Only gateway can reach user service

```typescript
21 const verifyInternalService = (req: Request, res: Response, next: NextFunction): void => {
22   const serviceName = req.headers['x-service-name'];
23   const allowedServices = ['api-gateway', 'order-service', 'product-service'];
24
25   if (!serviceName || !allowedServices.includes(serviceName as string)) {
26     logger.warn('Unauthorized internal service call', { serviceName, path: req.path, ip: req.ip });
27     res.status(403).json({ success: false, error: { message: 'Forbidden', statusCode: 403 } });
28     return;
29   }
30
31   next();
32 };
```

**Lines 21-32:** Custom middleware for service-to-service auth

**Line 22:** Extract service name from header
```typescript
// API Gateway adds this header
axios.post('http://user-service:3001/api/internal/users', data, {
  headers: { 'X-Service-Name': 'api-gateway' }
});
```

**Line 23:** Whitelist of allowed services
- `api-gateway`: Public-facing gateway
- `order-service`: Needs user data for orders
- `product-service`: Needs user data for reviews/ratings

**Lines 25-29:** Reject unauthorized requests
```typescript
if (!serviceName || !allowedServices.includes(serviceName as string)) {
  logger.warn('Unauthorized internal service call', { serviceName, path: req.path, ip: req.ip });
  res.status(403).json({ success: false, error: { message: 'Forbidden', statusCode: 403 } });
  return;
}
```

**Why log warnings?**
- Detect intrusion attempts
- Debug misconfigured services
- Audit trail for security

```typescript
34 router.use(verifyInternalService);
```

**Line 34:** Apply middleware to ALL internal routes
- Every route below this line requires `X-Service-Name` header
- Runs before individual route handlers

---

### Section 7: Registration Endpoint (Lines 36-54)

```typescript
36 router.post(
37   '/users',
38   asyncHandler(async (req: Request, res: Response) => {
39     const { email, password, firstName, lastName } = req.body;
40
41     const user = await userService.createUser({ email, password, firstName, lastName });
42
43     res.status(201).json({
44       success: true,
45       data: {
46         id: user.id,
47         email: user.email,
48         role: user.role,
49         firstName: user.firstName,
50         lastName: user.lastName
51       }
52     });
53   })
54 );
```

**Lines 36-54:** POST /internal/users (user registration)

**Why internal route for registration?**
```
User → API Gateway → User Service
       /api/auth/register → /api/internal/users
```

**Flow:**
1. User sends registration to API Gateway
2. Gateway validates request
3. Gateway forwards to User Service internal endpoint
4. User Service creates user
5. Gateway returns response to user

**Why this architecture?**
- **Single entry point:** All public traffic through gateway
- **Rate limiting:** Gateway rate limits before reaching service
- **Request validation:** Gateway validates before internal call
- **Circuit breaker:** Gateway can fail fast if user service down

**Line 43:** `res.status(201)` - Created
- 201 = Resource created successfully
- Different from 200 (OK) which means "operation succeeded"

**HTTP status code best practices:**
- 200: GET, PUT, DELETE succeeded
- 201: POST created resource
- 204: DELETE succeeded with no content
- 400: Bad request (validation failed)
- 401: Unauthorized (not authenticated)
- 403: Forbidden (authenticated but not allowed)
- 404: Not found
- 409: Conflict (e.g., email already exists)
- 500: Server error

---

### Section 8: Login Validation Endpoint (Lines 56-68)

```typescript
56 router.post(
57   '/users/validate',
58   asyncHandler(async (req: Request, res: Response) => {
59     const { email, password } = req.body;
60
61     const result = await userService.validateCredentials(email, password);
62
63     res.json({
64       success: true,
65       data: result
66     });
67   })
68 );
```

**Lines 56-68:** POST /internal/users/validate (login validation)

**Full login flow:**
```
1. User → Gateway: POST /api/auth/login { email, password }
2. Gateway → User Service: POST /api/internal/users/validate { email, password }
3. User Service validates credentials
4. User Service → Gateway: { id, email, role, firstName, lastName }
5. Gateway generates JWT tokens
6. Gateway → User: { accessToken, refreshToken, user }
```

**Why split validation and token generation?**

**Option 1: User Service generates tokens (Bad)**
```typescript
// User Service
async login(email, password) {
  const user = validateCredentials(email, password);
  const token = jwt.sign({userId: user.id}, secret); // User service knows about JWT
  return { token, user };
}
```

**Problems:**
- User Service coupled to JWT implementation
- Can't switch auth methods (OAuth, SAML) without changing user service
- Secrets (JWT_SECRET) must be in user service

**Option 2: Gateway generates tokens (Good - current approach)**
```typescript
// User Service
async validateCredentials(email, password) {
  // Just validate, return user data
  return { id, email, role };
}

// API Gateway
async login(req, res) {
  const userData = await userServiceClient.validateCredentials(email, password);
  const token = jwt.sign(userData, secret); // Gateway handles JWT
  return { token, user: userData };
}
```

**Benefits:**
- User Service is auth-method agnostic
- Easy to switch JWT → OAuth
- Secrets centralized in gateway
- User Service focused on user management

---

### Section 9: Get User by ID (Lines 70-88)

```typescript
70 router.get(
71   '/users/:id',
72   asyncHandler(async (req: Request, res: Response) => {
73     const userId = parseInt(req.params.id, 10);
74
75     const user = await userService.getActiveUserById(userId);
76
77     res.json({
78       success: true,
79       data: {
80         id: user.id,
81         email: user.email,
82         role: user.role,
83         firstName: user.firstName,
84         lastName: user.lastName
85       }
86     });
87   })
88 );
```

**Line 73:** Parse URL parameter
```typescript
const userId = parseInt(req.params.id, 10);
```

**URL:** `/api/internal/users/123`
- `req.params.id` = `"123"` (string)
- `parseInt(..., 10)` = `123` (number)

**Why base 10?**
```typescript
parseInt('08') // In some browsers: 0 (octal)
parseInt('08', 10) // Always: 8 (decimal)
```

**Line 75:** Use `getActiveUserById()`
- Only returns ACTIVE users
- Throws NotFoundError if inactive or not found

**Why return partial user data?**
```typescript
// Full User model has 9+ fields
{
  id, email, role, firstName, lastName,
  isActive, emailVerified, createdAt, updatedAt
}

// Internal API only returns needed fields
{
  id, email, role, firstName, lastName
}
```

**Benefits:**
1. Smaller response size
2. Less data over network
3. Only expose what's needed

---

### Section 10: Bulk Get Users (Lines 102-128)

```typescript
102 router.post(
103   '/users/bulk',
104   asyncHandler(async (req: Request, res: Response) => {
105     const { userIds } = req.body;
106
107     if (!Array.isArray(userIds) || userIds.length === 0) {
108       throw new ValidationError('userIds array is required');
109     }
110
111     const users = await userService.getUsersById(userIds);
112
113     res.json({
114       success: true,
115       data: {
116         users: users.map(u => ({
117           id: u.id,
118           email: u.email,
119           firstName: u.firstName,
120           lastName: u.lastName,
121           role: u.role,
122           isActive: u.isActive
123         })),
124         count: users.length
125       }
126     });
127   })
128 );
```

**Lines 107-109:** Manual validation in controller

**Why validate here instead of middleware?**
```typescript
// Hard to express in Joi:
// "Must be non-empty array of numbers"

// Easier to validate manually:
if (!Array.isArray(userIds) || userIds.length === 0) {
  throw new ValidationError('userIds array is required');
}
```

**Could use Joi:**
```typescript
Joi.object({
  userIds: Joi.array().items(Joi.number().integer().positive()).min(1).required()
})
```

**Line 111:** Service handles the heavy lifting
- Limits to 100 users (prevents abuse)
- Filters out non-existent users
- Returns User[] array

**Lines 116-123:** Transform to response shape
```typescript
users.map(u => ({
  id: u.id,
  email: u.email,
  firstName: u.firstName,
  lastName: u.lastName,
  role: u.role,
  isActive: u.isActive
}))
```

**Why map instead of `user.toJSON()`?**
- `toJSON()` includes `createdAt`, `updatedAt`, `emailVerified`
- Bulk endpoints should minimize data
- Only return what caller needs

**Line 124:** Include count in response
```json
{
  "success": true,
  "data": {
    "users": [ /* array of users */ ],
    "count": 42
  }
}
```

Useful for pagination or knowing how many were found.

---

## 🔍 Part 4: Validation Middleware Deep Dive

### Section 11: Joi Validation (validator.ts)

```typescript
10 export const validate = (schema: Schema) => {
11   return (req: Request, res: Response, next: NextFunction): void => {
12     const { error, value } = schema.validate(req.body, {
13       abortEarly: false,
14       stripUnknown: true
15     });
```

**Line 10:** Middleware factory
- Takes a Joi schema
- Returns middleware function

**Line 12:** Validate request body
```typescript
schema.validate(req.body, options)
```

**Option: `abortEarly: false`**
```typescript
// With abortEarly: true (default)
{ firstName: '', lastName: '' }
→ Errors: ["firstName is required"] // Stops at first error

// With abortEarly: false
{ firstName: '', lastName: '' }
→ Errors: ["firstName is required", "lastName is required"] // All errors
```

**Option: `stripUnknown: true`**
```typescript
// Input
{ firstName: 'John', lastName: 'Doe', hacker: 'DROP TABLE users' }

// With stripUnknown: true
→ { firstName: 'John', lastName: 'Doe' } // Unknown field removed

// Without stripUnknown
→ { firstName: 'John', lastName: 'Doe', hacker: 'DROP TABLE users' } // Passed through
```

```typescript
17     if (error) {
18       const details: ValidationDetail[] = error.details.map(detail => ({
19         field: detail.path.join('.'),
20         message: detail.message
21       }));
22
23       next(new ValidationError('Validation failed', details));
24       return;
25     }
```

**Lines 18-21:** Transform Joi errors to friendly format

**Joi error format:**
```typescript
{
  details: [
    {
      message: '"email" must be a valid email',
      path: ['email'],
      type: 'string.email'
    }
  ]
}
```

**Transformed format:**
```typescript
{
  field: 'email',
  message: '"email" must be a valid email'
}
```

**Line 23:** Pass to error handler
```typescript
next(new ValidationError('Validation failed', details));
```

The `next(error)` pattern:
- Skips remaining middleware
- Jumps to error handler middleware

```typescript
27     req.body = value;
28     next();
29   };
30 };
```

**Line 27:** Replace body with validated value
```typescript
// Input
{ email: ' USER@EXAMPLE.COM ', password: 'pass123', hacker: 'DROP TABLE' }

// After validation (lowercase, trim, stripUnknown)
req.body = { email: 'user@example.com', password: 'pass123' }
```

Controller receives cleaned data.

---

### Section 12: Joi Schemas (Lines 32-77)

```typescript
32 export const schemas = {
33   register: Joi.object({
34     email: Joi.string()
35       .email()
36       .lowercase()
37       .trim()
38       .required()
39       .messages({
40         'string.email': 'Please provide a valid email address',
41         'any.required': 'Email is required'
42       }),
```

**Line 35:** `.email()` - Built-in email validation
- Checks format: `user@domain.com`
- Not just "contains @"

**Line 36:** `.lowercase()` - Transform to lowercase
- `USER@EXAMPLE.COM` → `user@example.com`

**Line 37:** `.trim()` - Remove whitespace
- `  user@example.com  ` → `user@example.com`

**Lines 39-42:** Custom error messages
```typescript
.messages({
  'string.email': 'Please provide a valid email address',
  'any.required': 'Email is required'
})
```

**Without custom messages:**
```json
{
  "message": "\"email\" must be a valid email",
  "field": "email"
}
```

**With custom messages:**
```json
{
  "message": "Please provide a valid email address",
  "field": "email"
}
```

```typescript
44     password: Joi.string()
45       .min(8)
46       .required()
47       .messages({
48         'string.min': 'Password must be at least 8 characters long',
49         'any.required': 'Password is required'
50       }),
51
52     firstName: Joi.string().min(2).max(50).trim().optional(),
53     lastName: Joi.string().min(2).max(50).trim().optional()
54   }),
```

**Line 52-53:** Optional fields
- `.optional()` means field can be omitted
- If provided, must pass validation (min 2, max 50)

```typescript
61   updateProfile: Joi.object({
62     firstName: Joi.string().min(2).max(50).trim().optional(),
63     lastName: Joi.string().min(2).max(50).trim().optional(),
64     email: Joi.string().email().lowercase().trim().optional()
65   }).min(1),
```

**Line 65:** `.min(1)` on object
- At least 1 field must be present
- Prevents empty updates

**Example:**
```json
// Valid
{ "firstName": "John" } ✅
{ "email": "new@example.com" } ✅

// Invalid
{ } ❌ "Must have at least 1 field"
```

```typescript
67   changePassword: Joi.object({
68     currentPassword: Joi.string().required(),
69     newPassword: Joi.string()
70       .min(8)
71       .required()
72       .invalid(Joi.ref('currentPassword'))
73       .messages({
74         'any.invalid': 'New password must be different from current password'
75       })
76   })
```

**Line 72:** `.invalid(Joi.ref('currentPassword'))`
- Compares against another field
- Ensures new password ≠ current password

**Example:**
```json
// Valid
{ "currentPassword": "old123", "newPassword": "new456" } ✅

// Invalid
{ "currentPassword": "same123", "newPassword": "same123" } ❌
// Error: "New password must be different from current password"
```

---

## 🎯 Part 5: Interview Questions & Answers

### Q1: What is the Controller layer and what are its responsibilities?
**Answer:** The Controller layer handles HTTP concerns - parsing requests, calling services, and formatting responses.

**Responsibilities:**
1. Parse HTTP requests (`req.body`, `req.params`, `req.query`)
2. Call service layer methods
3. Format HTTP responses (JSON)
4. Set HTTP status codes
5. Handle errors (via asyncHandler)

**What it does NOT do:**
- Business logic (service's job)
- Database queries (repository's job)
- Complex validation (middleware/service's job)

### Q2: Why use `asyncHandler` instead of try/catch in every controller?
**Answer:** DRY (Don't Repeat Yourself) and centralized error handling.

**Without asyncHandler:**
```typescript
const getProfile = async (req, res) => {
  try {
    const user = await userService.getUserById(req.user.userId);
    res.json({ success: true, data: { user } });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};
```

**With asyncHandler:**
```typescript
const getProfile = asyncHandler(async (req, res) => {
  const user = await userService.getUserById(req.user.userId);
  res.json({ success: true, data: { user } });
});
```

Errors are caught and passed to centralized error handler middleware.

### Q3: Explain the factory pattern used in `createUserController()`.
**Answer:** Factory function that creates and returns controller methods with closures.

```typescript
export function createUserController(userService: UserService) {
  const getProfile = async (req, res) => {
    // Closure captures userService
    const user = await userService.getUserById(req.user.userId);
    res.json({ success: true, data: { user } });
  };
  
  return { getProfile };
}
```

**Benefits:**
1. No `this` binding issues
2. Simpler than class-based controllers
3. Service injected via closure
4. Can selectively export methods

**Alternative (class pattern):**
```typescript
export class UserController {
  constructor(private userService: UserService) {}
  
  getProfile = async (req, res) => {
    // Must use arrow function or bind(this)
  };
}
```

### Q4: Why have both public and internal routes?
**Answer:** Security and architecture - single entry point for public traffic.

```
Public Routes:
User → Gateway:3000 → User Service:3001
       /api/auth/profile

Internal Routes:
Gateway → User Service:3001
          /api/internal/users/123
```

**Benefits:**
1. **Single entry point:** All public traffic through gateway
2. **Network isolation:** User service not exposed to internet
3. **Centralized auth:** Gateway handles JWT verification for public routes
4. **Rate limiting:** Gateway rate limits before reaching services
5. **Circuit breaker:** Gateway can fail fast

### Q5: What does the `verifyInternalService` middleware do?
**Answer:** Verifies requests to internal endpoints come from allowed services.

```typescript
const verifyInternalService = (req, res, next) => {
  const serviceName = req.headers['x-service-name'];
  const allowedServices = ['api-gateway', 'order-service', 'product-service'];
  
  if (!serviceName || !allowedServices.includes(serviceName)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  next();
};
```

**Security layers:**
1. Network isolation (Docker network)
2. Header verification (`X-Service-Name`)
3. Whitelist of allowed services

### Q6: Why split credential validation and token generation?
**Answer:** Separation of concerns - User Service shouldn't know about JWT implementation.

**Current architecture:**
```
1. Gateway receives login request
2. Gateway asks User Service: "Are these credentials valid?"
3. User Service responds: "Yes, here's the user data"
4. Gateway generates JWT tokens
5. Gateway returns tokens to user
```

**Benefits:**
1. User Service is auth-method agnostic
2. Can switch JWT → OAuth without changing user service
3. Secrets (JWT_SECRET) centralized in gateway
4. User Service focused on user management

### Q7: Explain the middleware chain for PUT /profile.
**Answer:**
```typescript
router.put('/profile', authenticate(), validate(schemas.updateProfile), userController.updateProfile);
```

**Execution order:**
```
1. authenticate()
   - Verify JWT token
   - Extract user data
   - Add to req.user
   
2. validate(schemas.updateProfile)
   - Validate req.body against Joi schema
   - Transform (lowercase, trim)
   - Strip unknown fields
   
3. userController.updateProfile
   - Extract data from req.user and req.body
   - Call userService.updateProfile()
   - Format and send response
```

If any middleware fails, remaining ones don't run.

### Q8: What's the difference between `abortEarly: true` and `abortEarly: false` in Joi?
**Answer:**

**`abortEarly: true` (default):**
```json
Input: { email: "", password: "" }
Errors: ["Email is required"]
// Stops at first error
```

**`abortEarly: false`:**
```json
Input: { email: "", password: "" }
Errors: [
  "Email is required",
  "Password is required"
]
// Returns ALL errors
```

Better UX with `abortEarly: false` - user sees all issues at once.

### Q9: What does `stripUnknown: true` do in Joi validation?
**Answer:** Removes fields not defined in the schema.

```typescript
// Schema
Joi.object({ firstName: Joi.string(), lastName: Joi.string() })

// Input
{ firstName: 'John', lastName: 'Doe', hacker: 'DROP TABLE users' }

// With stripUnknown: true
req.body = { firstName: 'John', lastName: 'Doe' }
// 'hacker' field removed

// Without stripUnknown
req.body = { firstName: 'John', lastName: 'Doe', hacker: 'DROP TABLE users' }
// 'hacker' field passed through
```

**Security benefit:** Prevents mass assignment vulnerabilities.

### Q10: Why does `updateProfile` schema have `.min(1)` on the object?
**Answer:** Ensures at least one field is present - prevents empty updates.

```typescript
Joi.object({
  firstName: Joi.string().optional(),
  lastName: Joi.string().optional(),
  email: Joi.string().optional()
}).min(1)
```

**Examples:**
```json
{ "firstName": "John" } ✅
{ } ❌ "Must have at least 1 field"
```

Without `.min(1)`, empty updates would be accepted (wasteful database calls).

### Q11: Why use `parseInt(req.params.id, 10)` instead of just `parseInt(req.params.id)`?
**Answer:** Ensure base-10 parsing (avoid octal interpretation).

```typescript
// Some environments treat leading 0 as octal
parseInt('08')      // May return 0 (octal)
parseInt('08', 10)  // Always returns 8 (decimal)

// URL parameter
/users/08 → req.params.id = "08"
parseInt(req.params.id)      // Risky
parseInt(req.params.id, 10)  // Safe
```

Always specify radix for predictable behavior.

### Q12: What's the benefit of standardized response format?
**Answer:** Consistent API contract for frontend developers.

**Standardized:**
```json
{
  "success": true,
  "data": { "user": {...} }
}

{
  "success": false,
  "error": {
    "message": "User not found",
    "statusCode": 404
  }
}
```

**Benefits:**
1. Frontend knows exactly where to find data
2. Easy to create reusable API client
3. Type-safe with TypeScript
4. Consistent error handling

### Q13: Why return different status codes (200 vs 201)?
**Answer:** Semantic HTTP - status codes convey meaning.

**Common status codes:**
- **200 OK:** Generic success (GET, PUT, DELETE)
- **201 Created:** Resource created (POST)
- **204 No Content:** Success with no response body (DELETE)
- **400 Bad Request:** Validation failed
- **401 Unauthorized:** Not authenticated
- **403 Forbidden:** Authenticated but not allowed
- **404 Not Found:** Resource doesn't exist
- **409 Conflict:** Resource conflict (duplicate email)
- **500 Internal Server Error:** Server error

Proper codes help clients handle responses correctly.

### Q14: How would you add request logging to all controllers?
**Answer:** Add logging middleware before controllers.

```typescript
const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    logger.info('HTTP Request', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: Date.now() - start,
      userId: req.user?.userId
    });
  });
  
  next();
};

// Apply to all routes
app.use(requestLogger);
```

**Logs:**
```
INFO: HTTP Request { method: 'GET', path: '/profile', statusCode: 200, duration: 45, userId: 123 }
```

### Q15: How would you add response transformation middleware?
**Answer:** Middleware that modifies response before sending.

```typescript
const transformResponse = (req, res, next) => {
  const originalJson = res.json.bind(res);
  
  res.json = (data) => {
    // Wrap all responses
    return originalJson({
      success: !data.error,
      timestamp: new Date().toISOString(),
      ...data
    });
  };
  
  next();
};

// Apply globally
app.use(transformResponse);

// Controllers can still use res.json normally
res.json({ data: { user } });
// Automatically becomes:
// { success: true, timestamp: '...', data: { user } }
```

---

## 💡 Part 6: Production Considerations

### 1. Request ID Tracking

```typescript
import { v4 as uuidv4 } from 'uuid';

const addRequestId = (req, res, next) => {
  req.id = req.headers['x-request-id'] || uuidv4();
  res.setHeader('X-Request-ID', req.id);
  next();
};

// Use in controllers
const getProfile = asyncHandler(async (req, res) => {
  logger.info('Get profile', { requestId: req.id, userId: req.user.userId });
  // ...
});
```

**Benefits:**
- Trace requests across services
- Debug distributed systems
- Link logs together

### 2. Response Compression

```typescript
import compression from 'compression';

app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  },
  level: 6 // 1-9, 6 is good balance
}));
```

**Reduces response size by ~70% for JSON.**

### 3. CORS Configuration

```typescript
import cors from 'cors';

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS.split(','),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
```

### 4. Security Headers

```typescript
import helmet from 'helmet';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"]
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true
  }
}));
```

### 5. Request Timeout

```typescript
const requestTimeout = (timeoutMs = 30000) => {
  return (req, res, next) => {
    req.setTimeout(timeoutMs, () => {
      res.status(408).json({
        success: false,
        error: { message: 'Request timeout', statusCode: 408 }
      });
    });
    next();
  };
};

app.use(requestTimeout(30000)); // 30 seconds
```

### 6. Graceful Shutdown

```typescript
let server;

const startServer = () => {
  server = app.listen(3001, () => {
    logger.info('User Service listening on port 3001');
  });
};

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, closing server...');
  
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
  
  // Force close after 30 seconds
  setTimeout(() => {
    logger.error('Forced shutdown');
    process.exit(1);
  }, 30000);
});
```

---

## 📝 Summary

### Key Takeaways

1. **Controller = HTTP layer** - Parses requests, formats responses
2. **asyncHandler** eliminates try/catch boilerplate
3. **Factory pattern** creates controllers with closures
4. **Middleware chains** compose request processing (auth → validation → controller)
5. **Internal routes** enable service-to-service communication
6. **Joi validation** provides declarative schema validation
7. **Standardized responses** ensure consistent API contract
8. **HTTP status codes** convey semantic meaning

### Interview Readiness

You can now confidently explain:
- ✅ What the Controller layer does and doesn't do
- ✅ How middleware chains work
- ✅ Public vs internal routes architecture
- ✅ Factory pattern for controllers
- ✅ Joi validation with abortEarly and stripUnknown
- ✅ asyncHandler pattern for error handling
- ✅ HTTP status code best practices
- ✅ Production patterns (logging, CORS, security headers)

### Next Steps

- **M18:** Complete Registration Flow (Gateway → User Service → Database)
- **M19:** Complete Login Flow (validation → JWT generation → token management)
- **M20:** Token Refresh Flow (refresh tokens, rotation, security)

---

**Module 17 Complete!** 🎉  
You now understand the Controller Pattern and how to build production-grade HTTP handlers for MAANG-level interviews.
