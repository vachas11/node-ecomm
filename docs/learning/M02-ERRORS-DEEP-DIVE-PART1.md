# M02: Error Handling Deep Dive - PART 1

**File:** `shared/errors.ts` (128 lines)  
**Level:** Foundation  
**Prerequisites:** M01 (Logging), Basic TypeScript, Express.js  
**Time to Master:** 3-4 hours

---

## 📖 SECTION 1: THEORY - Error Handling Fundamentals

### 1.1 What is Error Handling?

Error handling is the process of **anticipating, detecting, and resolving** errors that occur during program execution. Think of it as the **immune system** for your application - it identifies problems and responds appropriately.

**Real-World Analogy:**
Imagine you're a restaurant manager:
- **Customer complaint** (400 error) - Wrong order delivered
- **Kitchen fire alarm** (500 error) - System failure
- **VIP reservation conflict** (409 error) - Resource conflict

Without proper error handling, every problem would shut down the restaurant. With it, you handle each situation appropriately:
- Apologize and remake the order (handle client error gracefully)
- Evacuate and call fire department (log and escalate critical errors)
- Offer alternative seating (resolve conflicts programmatically)

### 1.2 Why Not Just Use `throw new Error()`?

You might think: "I can just use JavaScript's built-in `Error` class, right?"

Here's why that doesn't work in production:

| Feature | `throw new Error()` | Custom Error Classes |
|---------|---------------------|---------------------|
| **HTTP Status Code** | No (500 by default) | Yes (400, 401, 404, etc.) |
| **Error Type** | Generic | Specific (Validation, NotFound, etc.) |
| **Client vs Server** | Can't distinguish | Operational vs Programming |
| **Metadata** | No | Yes (details, timestamp, etc.) |
| **Production Safety** | Leaks stack traces | Hides internal errors |
| **API Consistency** | Random formats | Standardized response |

**Example of the problem:**

```typescript
// ❌ BAD: Generic Error
app.post('/api/users', (req, res) => {
  if (!req.body.email) {
    throw new Error('Email is required');  // What status code? 500? 400?
  }
  // Client sees: 500 Internal Server Error (misleading!)
});

// ✅ GOOD: Custom ValidationError
app.post('/api/users', (req, res) => {
  if (!req.body.email) {
    throw new ValidationError('Email is required', [
      { field: 'email', message: 'Email is required' }
    ]);  // Automatically returns 400 Bad Request
  }
});
```

### 1.3 The Error Hierarchy

Our error system has a **class hierarchy** like a family tree:

```
Error (JavaScript built-in)
  │
  └── AppError (our base class)
        │
        ├── ValidationError (400)
        ├── UnauthorizedError (401)
        ├── ForbiddenError (403)
        ├── NotFoundError (404)
        ├── ConflictError (409)
        ├── DatabaseError (500)
        └── ServiceUnavailableError (503)
```

**Why this hierarchy matters:**

1. **Catch specific errors:**
   ```typescript
   try {
     await userService.create(data);
   } catch (err) {
     if (err instanceof ValidationError) {
       // Handle validation errors differently
       return res.status(400).json({ errors: err.details });
     }
     if (err instanceof DatabaseError) {
       // Alert on-call engineer
       alertOncall('Database error in user creation');
     }
     throw err;
   }
   ```

2. **Type safety in TypeScript:**
   ```typescript
   function handleError(err: AppError) {
     // TypeScript knows err has statusCode property
     console.log(err.statusCode);  // ✅ Type-safe
     console.log(err.isOperational);  // ✅ Type-safe
   }
   ```

### 1.4 Operational vs Programming Errors

This is a **critical distinction** that many developers miss:

**Operational Errors** (Expected, handle gracefully):
- User input validation fails ✅
- Network request times out ✅
- Database connection lost ✅
- File not found ✅
- API rate limit exceeded ✅

**Programming Errors** (Bugs, should crash):
- Calling undefined function ❌
- Accessing null.property ❌
- Infinite recursion ❌
- Type errors ❌
- Logic bugs ❌

**In our code:**
```typescript
export class AppError extends Error {
  public isOperational: boolean;  // ← This flag distinguishes them!
  
  constructor(message: string, statusCode: number, isOperational = true) {
    // By default, isOperational = true (expected errors)
  }
}
```

**Why this matters:**

```typescript
// Operational error: Handle and continue
if (err.isOperational) {
  logger.warn('Expected error occurred', { error: err.message });
  res.status(err.statusCode).json({ error: err.message });
  // ✅ App continues running
}

// Programming error: Log and crash
else {
  logger.error('CRITICAL: Programming error', { error: err, stack: err.stack });
  process.exit(1);  // ❌ Crash and let process manager restart
  // Why crash? Because the app is in an unknown state
}
```

**Production principle:**
> "Never trust an application in an undefined state. If you have a bug, crash immediately and restart clean."
> - Node.js Best Practices

### 1.5 HTTP Status Codes Quick Reference

Our error classes map to HTTP status codes:

**2xx Success:**
- 200 OK - Success
- 201 Created - Resource created

**4xx Client Errors** (User's fault):
- 400 Bad Request - **ValidationError** - Invalid input
- 401 Unauthorized - **UnauthorizedError** - Not logged in
- 403 Forbidden - **ForbiddenError** - Logged in but no permission
- 404 Not Found - **NotFoundError** - Resource doesn't exist
- 409 Conflict - **ConflictError** - Duplicate resource

**5xx Server Errors** (Our fault):
- 500 Internal Server Error - **DatabaseError** - Something broke
- 503 Service Unavailable - **ServiceUnavailableError** - Temporarily down

**Memory trick:**
- **4xx** = "You (client) messed up"
- **5xx** = "I (server) messed up"

### 1.6 Error Handling Strategy Overview

Our error handling has 3 layers:

```
┌────────────────────────────────────────┐
│ LAYER 1: Error Classes                 │
│ (AppError, ValidationError, etc.)      │
│ Create typed errors with metadata      │
└─────────────┬──────────────────────────┘
              │
              ▼
┌────────────────────────────────────────┐
│ LAYER 2: asyncHandler Wrapper          │
│ Catches async errors automatically     │
│ Passes to error handler middleware     │
└─────────────┬──────────────────────────┘
              │
              ▼
┌────────────────────────────────────────┐
│ LAYER 3: errorHandler Middleware       │
│ Logs error, formats response           │
│ Returns appropriate HTTP status        │
└────────────────────────────────────────┘
```

**Visual flow:**

```
Request → Route Handler → Business Logic
                              │
                              ├─ Success → Response
                              │
                              └─ Error Thrown
                                    │
                                    ▼
                          asyncHandler catches
                                    │
                                    ▼
                          errorHandler middleware
                                    │
                                    ├─ Log error
                                    ├─ Format response
                                    └─ Send to client
```

---

## 🔍 SECTION 2: LINE-BY-LINE CODE ANALYSIS

### 2.1 Import Statements (Line 1)

```typescript
import { Request, Response, NextFunction, RequestHandler } from 'express';
```

**What each type is:**

- **`Request`**: Type for Express request object (contains body, params, query, headers)
- **`Response`**: Type for Express response object (has methods like .json(), .status())
- **`NextFunction`**: Type for the `next()` callback in middleware
- **`RequestHandler`**: Type for Express route handler functions

**Why we need these:**

TypeScript needs to know the **types** of function parameters. Without these imports:

```typescript
// ❌ Without types
export const errorHandler = (err, req, res, next) => {
  // TypeScript error: Parameter 'err' implicitly has an 'any' type
};

// ✅ With types
export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  // TypeScript knows what properties req and res have
  req.body  // ✅ OK
  req.xyz   // ❌ Error: Property 'xyz' does not exist
};
```

### 2.2 AppError Base Class (Lines 3-15)

This is the **foundation** of our entire error system. Let's analyze every line.

```typescript
export class AppError extends Error {
```

**`export class`**: Makes this class available to other files
**`AppError`**: Our custom error class name
**`extends Error`**: Inherits from JavaScript's built-in Error class

**What does `extends Error` give us?**
- `message` property (error description)
- `stack` property (stack trace showing where error occurred)
- Can be caught with `catch (err)`
- Works with `instanceof` checks

#### Line 4-6: Property Declarations

```typescript
  public statusCode: number;
  public isOperational: boolean;
  public timestamp: string;
```

**Why declare properties first?**
TypeScript requires explicit property declarations for type checking.

**`public`**: Can be accessed from outside the class
```typescript
const err = new AppError('User not found', 404);
console.log(err.statusCode);  // ✅ Can access because public
```

**Property types:**
- `statusCode: number` - HTTP status code (200, 400, 500, etc.)
- `isOperational: boolean` - true = expected error, false = bug
- `timestamp: string` - When error occurred (ISO 8601 format)

#### Lines 8-14: Constructor

```typescript
  constructor(message: string, statusCode: number, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.timestamp = new Date().toISOString();
    Error.captureStackTrace(this, this.constructor);
  }
```

**Line 8: Constructor signature**
```typescript
constructor(message: string, statusCode: number, isOperational = true)
```

- `message: string` - Error description (required)
- `statusCode: number` - HTTP status (required)
- `isOperational = true` - Default parameter (optional, defaults to true)

**Why default `isOperational = true`?**
Most errors in web apps are **operational** (user errors, network issues). Programming errors (bugs) are the exception.

**Line 9: super(message)**
```typescript
super(message);
```

**What is `super()`?**
Calls the parent class (`Error`) constructor. This sets up:
- The `message` property
- The error name
- The prototype chain

**Critical rule:** When extending a class, you **must** call `super()` before accessing `this`.

```typescript
// ❌ WRONG
constructor(message: string) {
  this.statusCode = 400;  // Error: Must call super() first
  super(message);
}

// ✅ CORRECT
constructor(message: string) {
  super(message);  // Call parent constructor first
  this.statusCode = 400;
}
```

**Line 10-12: Property initialization**
```typescript
this.statusCode = statusCode;
this.isOperational = isOperational;
this.timestamp = new Date().toISOString();
```

**Why use `this.`?**
- `this` refers to the current instance of the class
- `this.statusCode = statusCode` assigns the parameter to the instance property

**`new Date().toISOString()`** produces:
```typescript
"2026-08-07T14:32:10.123Z"
```

**Why ISO format?**
- Sortable
- Timezone-aware (Z = UTC)
- Standard format recognized by all systems
- Human-readable

**Line 13: Error.captureStackTrace**
```typescript
Error.captureStackTrace(this, this.constructor);
```

**What does this do?**
Creates a `.stack` property with the error's stack trace.

**Why the two parameters?**
- `this` - The error object to attach stack to
- `this.constructor` - Exclude the constructor itself from stack trace

**Without this line:**
```
Error: User not found
    at new AppError (errors.ts:8)  ← Constructor shown (noise)
    at UserService.findById (user.service.ts:45)
```

**With this line:**
```
Error: User not found
    at UserService.findById (user.service.ts:45)  ← Cleaner!
```

**Production value:**
Stack traces tell you WHERE the error originated. Without them, debugging is like finding a needle in a haystack blindfolded.

### 2.3 ValidationError Class (Lines 17-25)

```typescript
export class ValidationError extends AppError {
  public details: any[];

  constructor(message = 'Validation failed', details: any[] = []) {
    super(message, 400);
    this.name = 'ValidationError';
    this.details = details;
  }
}
```

**Line 17: Class declaration**
```typescript
export class ValidationError extends AppError {
```

**`extends AppError`**: Inherits all properties and methods from AppError
- Gets `statusCode` ✅
- Gets `isOperational` ✅
- Gets `timestamp` ✅
- Gets `message` (from Error) ✅

**Line 18: Additional property**
```typescript
public details: any[];
```

**Why `details`?**
Validation errors often have **multiple failures**:

```typescript
// User submits a form with 3 invalid fields
const errors = new ValidationError('Validation failed', [
  { field: 'email', message: 'Invalid email format' },
  { field: 'password', message: 'Must be at least 8 characters' },
  { field: 'age', message: 'Must be a number' }
]);

// Client receives structured error response:
{
  "error": "Validation failed",
  "details": [
    { "field": "email", "message": "Invalid email format" },
    { "field": "password", "message": "Must be at least 8 characters" },
    { "field": "age", "message": "Must be a number" }
  ]
}
```

**Line 20: Constructor with default parameters**
```typescript
constructor(message = 'Validation failed', details: any[] = []) {
```

**Default parameters:**
- `message = 'Validation failed'` - If no message provided, use this
- `details: any[] = []` - If no details provided, use empty array

**Usage:**
```typescript
// Minimal
new ValidationError();  
// → message: 'Validation failed', details: []

// With custom message
new ValidationError('Invalid user data');  
// → message: 'Invalid user data', details: []

// With full details
new ValidationError('Invalid user data', [
  { field: 'email', message: 'Required' }
]);
// → message: 'Invalid user data', details: [...]
```

**Line 21: super(message, 400)**
```typescript
super(message, 400);
```

**Why 400?**
- 400 = Bad Request (client error)
- Validation errors are **always** the client's fault
- The user sent invalid data

**What `super(message, 400)` does:**
Calls `AppError` constructor, which:
1. Calls `Error` constructor with message
2. Sets `statusCode = 400`
3. Sets `isOperational = true` (default)
4. Sets `timestamp = current time`
5. Captures stack trace

**Line 22: Set error name**
```typescript
this.name = 'ValidationError';
```

**Why set `.name`?**
- Makes error type visible in logs
- Helps debugging in production
- Used by error monitoring tools (Sentry, Datadog)

**Without setting name:**
```javascript
console.log(err.toString());
// Output: Error: Validation failed  ← Generic "Error"
```

**With setting name:**
```javascript
console.log(err.toString());
// Output: ValidationError: Validation failed  ← Specific type!
```

**Line 23: Store details**
```typescript
this.details = details;
```

Assigns the details array to the instance property so it can be accessed later in the error handler.

### 2.4 UnauthorizedError Class (Lines 27-32)

```typescript
export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized access') {
    super(message, 401);
    this.name = 'UnauthorizedError';
  }
}
```

**Simpler than ValidationError because:**
- No extra properties needed
- Just needs message and status code

**Status code 401:**
- **401 Unauthorized** = "You need to log in"
- User hasn't provided authentication credentials
- Or credentials are invalid

**Common usage:**
```typescript
// No token in request
if (!req.headers.authorization) {
  throw new UnauthorizedError('Authentication token required');
}

// Invalid token
const user = await verifyToken(token);
if (!user) {
  throw new UnauthorizedError('Invalid or expired token');
}
```

**401 vs 403 confusion:**
This is a **common interview question**!

- **401 Unauthorized**: "Who are you?" (authentication failed)
- **403 Forbidden**: "I know who you are, but you can't do that" (authorization failed)

```typescript
// 401: Not logged in
GET /api/profile
→ UnauthorizedError: Please log in

// 403: Logged in as user, trying to access admin panel
GET /api/admin/users
→ ForbiddenError: Admin access required
```

### 2.5 ForbiddenError Class (Lines 34-39)

```typescript
export class ForbiddenError extends AppError {
  constructor(message = 'Access forbidden') {
    super(message, 403);
    this.name = 'ForbiddenError';
  }
}
```

**Status code 403:**
- **403 Forbidden** = "You're authenticated, but not authorized"
- User is logged in but lacks permissions

**Real-world examples:**

```typescript
// Example 1: Role-based access control
if (user.role !== 'admin') {
  throw new ForbiddenError('Admin privileges required');
}

// Example 2: Resource ownership
if (post.authorId !== user.id) {
  throw new ForbiddenError('You can only edit your own posts');
}

// Example 3: Feature flags
if (!user.hasFeature('beta_features')) {
  throw new ForbiddenError('Beta access required');
}
```

### 2.6 NotFoundError Class (Lines 41-46)

```typescript
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404);
    this.name = 'NotFoundError';
  }
}
```

**Status code 404:**
- **404 Not Found** = "The thing you're looking for doesn't exist"
- Most common error in REST APIs

**Common usage patterns:**

```typescript
// Pattern 1: Database query returns null
const user = await userRepository.findById(id);
if (!user) {
  throw new NotFoundError(`User with ID ${id} not found`);
}

// Pattern 2: Route doesn't exist (Express fallback)
app.use('*', (req, res) => {
  throw new NotFoundError(`Route ${req.originalUrl} not found`);
});

// Pattern 3: File doesn't exist
if (!fs.existsSync(filePath)) {
  throw new NotFoundError(`File ${filePath} not found`);
}
```

**Interview insight:**
"When should you return 404 vs 400?"
- **404**: Resource doesn't exist (`GET /users/999` where user 999 doesn't exist)
- **400**: Invalid ID format (`GET /users/abc` where ID should be a number)

### 2.7 ConflictError Class (Lines 48-53)

```typescript
export class ConflictError extends AppError {
  constructor(message = 'Resource conflict') {
    super(message, 409);
    this.name = 'ConflictError';
  }
}
```

**Status code 409:**
- **409 Conflict** = "This conflicts with existing data"
- Usually for duplicate resources

**Real-world examples:**

```typescript
// Example 1: Duplicate email registration
const existingUser = await userRepository.findByEmail(email);
if (existingUser) {
  throw new ConflictError('Email already registered');
}

// Example 2: Duplicate order ID
const existingOrder = await orderRepository.findById(orderId);
if (existingOrder) {
  throw new ConflictError('Order ID already exists');
}

// Example 3: Optimistic locking failure
if (currentVersion !== requestedVersion) {
  throw new ConflictError('Resource was modified by another user');
}

// Example 4: Business rule conflict
if (user.status === 'banned' && action === 'post') {
  throw new ConflictError('Banned users cannot create posts');
}
```

**409 vs 400 vs 422:**
- **409 Conflict**: Resource already exists or state conflict
- **400 Bad Request**: Invalid input format
- **422 Unprocessable Entity**: Valid format but business logic failure (less common)

### 2.8 DatabaseError Class (Lines 55-63)

```typescript
export class DatabaseError extends AppError {
  public originalError: Error | null;

  constructor(message = 'Database operation failed', originalError: Error | null = null) {
    super(message, 500, false);  // ← Note: isOperational = false
    this.name = 'DatabaseError';
    this.originalError = originalError;
  }
}
```

**Key differences from previous errors:**

**1. Status code 500 (server error):**
```typescript
super(message, 500, false);
```
- **500** = Internal Server Error (our fault, not client's)
- Client can't fix this by changing their request

**2. isOperational = false:**
```typescript
super(message, 500, false);
```

**Why false?**
Database errors are often **not operational**:
- Connection pool exhausted (configuration issue)
- Database server down (infrastructure issue)
- Disk full (ops issue)
- Corrupted data (bug in our code)

**When the flag matters:**
```typescript
if (!err.isOperational) {
  // This is serious - might need to crash the process
  logger.error('Non-operational error', { error: err });
  
  if (process.env.NODE_ENV === 'production') {
    // Alert on-call engineer
    alertPagerDuty('Database error - service may be unstable');
    
    // Consider crashing (let process manager restart)
    setTimeout(() => process.exit(1), 1000);
  }
}
```

**3. originalError property:**
```typescript
public originalError: Error | null;
```

**Why store the original error?**
Database libraries throw their own errors with useful details:

```typescript
try {
  await db.query('SELECT * FROM users WHERE id = $1', [userId]);
} catch (err) {
  // err is a PostgreSQL error with details:
  // - err.code (e.g., '23505' for duplicate key)
  // - err.constraint (e.g., 'users_email_key')
  // - err.detail (human-readable explanation)
  
  throw new DatabaseError(
    'Failed to fetch user', 
    err as Error  // ← Store original error
  );
}
```

**In error handler:**
```typescript
if (err instanceof DatabaseError && err.originalError) {
  logger.error('Database error details', {
    message: err.message,
    originalMessage: err.originalError.message,
    code: (err.originalError as any).code,
    stack: err.originalError.stack
  });
}
```

**Production benefit:**
Original error has low-level details useful for debugging but shouldn't be sent to client (security risk). We log it but return generic message.

### 2.9 ServiceUnavailableError Class (Lines 65-70)

```typescript
export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable') {
    super(message, 503, false);  // ← isOperational = false
    this.name = 'ServiceUnavailableError';
  }
}
```

**Status code 503:**
- **503 Service Unavailable** = "We're down right now, try again later"
- Temporary outage

**When to use:**

```typescript
// Example 1: Circuit breaker open
if (circuitBreaker.isOpen()) {
  throw new ServiceUnavailableError('Payment service is currently unavailable');
}

// Example 2: Maintenance mode
if (process.env.MAINTENANCE_MODE === 'true') {
  throw new ServiceUnavailableError('System under maintenance. Back at 2am UTC.');
}

// Example 3: Rate limit exceeded (alternative to 429)
if (rateLimitExceeded) {
  throw new ServiceUnavailableError('Too many requests. Please try again in 60 seconds.');
}

// Example 4: Dependency down
try {
  await externalAPI.call();
} catch (err) {
  throw new ServiceUnavailableError('External payment service unavailable');
}
```

**Why isOperational = false?**
Service being unavailable is usually **our infrastructure problem**, not a normal operational scenario.

**503 vs 500:**
- **503**: Temporary issue, client should retry (service will recover)
- **500**: Unknown error, might need code fix

**Production pattern with Retry-After header:**
```typescript
if (err instanceof ServiceUnavailableError) {
  res.setHeader('Retry-After', '60');  // Retry after 60 seconds
  res.status(503).json({ error: err.message });
}
```

---

**🎓 END OF PART 1**

Part 1 covered:
- ✅ Theory and fundamentals of error handling
- ✅ Line-by-line analysis of all error classes (lines 1-70)
- ✅ Deep dive into operational vs programming errors
- ✅ HTTP status codes explained

**📌 Continue to M02-ERRORS-DEEP-DIVE-PART2.md for:**
- 🔍 errorHandler middleware (lines 72-121)
- 🔍 asyncHandler wrapper (lines 123-127)
- 🏗️ Architecture diagrams
- 🎯 Interview questions
- 💡 Production best practices
- ⚡ Real-world scenarios
- 🧪 Hands-on exercises
