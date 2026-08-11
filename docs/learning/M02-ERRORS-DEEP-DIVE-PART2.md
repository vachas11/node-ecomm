# M02: Error Handling Deep Dive - PART 2

**Middleware, Architecture, Interview Questions & Exercises**

---

## 🔍 SECTION 3: ERROR HANDLER MIDDLEWARE (Lines 72-121)

### 3.1 The errorHandler Function (Lines 72-121)

This is the **heart** of our error handling system. Every error in the application eventually passes through here.

```typescript
export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction): void => {
```

**Function signature breakdown:**

- **`export const`**: Exported function (not a class method)
- **`errorHandler`**: Function name
- **`err: any`**: The error object (any type because could be anything)
- **`req: Request`**: Express request object
- **`res: Response`**: Express response object
- **`next: NextFunction`**: Next middleware (rarely used in error handlers)
- **`: void`**: Returns nothing (sends response directly)

**Why 4 parameters?**
Express recognizes error-handling middleware by the **4-parameter signature**. Regular middleware has 3 parameters (req, res, next).

```typescript
// ✅ Error handler (4 params)
app.use((err, req, res, next) => { /* ... */ });

// ✅ Regular middleware (3 params)
app.use((req, res, next) => { /* ... */ });
```

### 3.2 Import Logger (Line 73)

```typescript
const logger = require('./logger').default;
```

**Why `require()` instead of `import`?**

This avoids a **circular dependency** problem:
- `logger.ts` imports from `errors.ts` (for typing)
- `errors.ts` can't import from `logger.ts` (would create cycle)

**Circular dependency:**
```
errors.ts → logger.ts → errors.ts → logger.ts → ...  ❌ INFINITE LOOP
```

**Solution: Dynamic require:**
```typescript
// Inside the function, not at module level
const logger = require('./logger').default;
```

This loads the logger **at runtime** (when function executes) instead of at **import time**, breaking the cycle.

**Why `.default`?**
```typescript
// logger.ts exports as:
export default logger;

// So we need .default to access it
const logger = require('./logger').default;
```

**TypeScript vs CommonJS:**
- `import/export` = ES6 modules (TypeScript)
- `require()` = CommonJS modules (Node.js)
- They can be mixed (TypeScript compiles imports to require)

### 3.3 Set Default Status and Message (Lines 75-76)

```typescript
err.statusCode = err.statusCode || 500;
err.message = err.message || 'Internal Server Error';
```

**What's happening:**

**`err.statusCode = err.statusCode || 500`**
- If error has statusCode, use it
- If not (like `throw new Error('Oops')`), default to 500

**Example:**
```typescript
// Custom error
const err = new ValidationError('Bad input');
err.statusCode = 400;  // Already set
// After line 75: err.statusCode = 400 || 500 = 400 ✅

// Generic error
const err = new Error('Something broke');
// err.statusCode is undefined
// After line 75: err.statusCode = undefined || 500 = 500 ✅
```

**Why this matters:**
Handles errors from:
- Our custom classes (have statusCode)
- Third-party libraries (might not have statusCode)
- JavaScript runtime errors (no statusCode)

**Same pattern for message:**
```typescript
err.message = err.message || 'Internal Server Error';
```

All errors should have a message, but just in case, default to generic message.

### 3.4 Logging Logic (Lines 78-93)

```typescript
if (err.statusCode >= 500) {
  logger.error('Server Error:', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip
  });
} else {
  logger.warn('Client Error:', {
    message: err.message,
    url: req.originalUrl,
    method: req.method,
    statusCode: err.statusCode
  });
}
```

**Why split by status code?**

**5xx errors (>= 500):**
- **Our fault** (bugs, infrastructure issues)
- Log as **ERROR** level (wake up on-call engineer)
- Include **stack trace** (need to debug)
- Include **request context** (url, method, IP)

**4xx errors (< 500):**
- **Client's fault** (bad input, unauthorized, not found)
- Log as **WARN** level (expected, not critical)
- **No stack trace** (not a bug, just invalid request)
- Still log context (to detect abuse patterns)

**Breakdown of logged fields:**

**For 5xx errors:**
```typescript
{
  message: err.message,        // "Database connection lost"
  stack: err.stack,            // Full stack trace
  url: req.originalUrl,        // "/api/users/123"
  method: req.method,          // "POST"
  ip: req.ip                   // "192.168.1.1"
}
```

**For 4xx errors:**
```typescript
{
  message: err.message,        // "Email is required"
  url: req.originalUrl,        // "/api/users"
  method: req.method,          // "POST"
  statusCode: err.statusCode   // 400
}
// No stack trace ← saves log space
```

**Production insight:**
This logging strategy means:
- Error logs (5xx) = things we need to fix
- Warning logs (4xx) = usage patterns, potential abuse

**Example abuse detection:**
```bash
# Find IPs with many 401 errors (brute force attack?)
grep "Client Error" combined.log | \
  grep "401" | \
  jq -r '.ip' | \
  sort | uniq -c | sort -nr | head -10
```

### 3.5 Development vs Production Response (Lines 95-106)

```typescript
if (process.env.NODE_ENV === 'development') {
  res.status(err.statusCode).json({
    success: false,
    error: {
      message: err.message,
      statusCode: err.statusCode,
      stack: err.stack,        // ← ONLY IN DEV
      details: err.details || null
    }
  });
  return;
}
```

**Development response:**

Includes **everything** for debugging:
```json
{
  "success": false,
  "error": {
    "message": "Validation failed",
    "statusCode": 400,
    "stack": "Error: Validation failed\n    at UserController.create (user.controller.ts:45)\n    at ...",
    "details": [
      { "field": "email", "message": "Invalid email" }
    ]
  }
}
```

**Why include stack trace in dev?**
- Immediate debugging without checking logs
- See exact line where error occurred
- Faster development cycle

**Security note:**
Stack traces reveal:
- Internal file paths
- Code structure
- Library versions
- Potential vulnerabilities

**NEVER** send stack traces in production!

**Early return:**
```typescript
return;
```

Exits the function after sending development response. Without this, code would continue to production response (bad!).

### 3.6 Production Response (Lines 108-120)

```typescript
const response: { success: boolean; error: { message: string; statusCode: number; details?: any } } = {
  success: false,
  error: {
    message: err.isOperational ? err.message : 'Something went wrong',
    statusCode: err.statusCode
  }
};

if (err.details) {
  response.error.details = err.details;
}

res.status(err.statusCode).json(response);
```

**Line 108: Type annotation**
```typescript
const response: { success: boolean; error: { message: string; statusCode: number; details?: any } }
```

This is a **complex type annotation**. Let's break it down:

```typescript
{
  success: boolean;              // Must be boolean
  error: {                       // Nested object
    message: string;             // Must be string
    statusCode: number;          // Must be number
    details?: any                // Optional (? = optional)
  }
}
```

**Why this verbose type?**
Ensures response structure is **consistent** across all errors. TypeScript will error if we try to add unexpected fields.

**Line 111: Conditional message**
```typescript
message: err.isOperational ? err.message : 'Something went wrong',
```

**This is critical for security!**

**Operational error (expected):**
```typescript
const err = new ValidationError('Email is required');
err.isOperational = true;
// Client sees: "Email is required" ✅ Safe to show
```

**Programming error (bug):**
```typescript
const err = new Error('Cannot read property "id" of undefined');
err.isOperational = undefined;  // Generic Error has no isOperational
// Client sees: "Something went wrong" ✅ Don't leak bug details
```

**Why hide programming errors?**
```typescript
// ❌ BAD: Leak internal details
throw new Error('Failed to connect to database at postgres://admin:SECRET_PASSWORD@db:5432');
// Client would see the password!

// ✅ GOOD: Generic message
err.isOperational = false;
// Client sees: "Something went wrong"
// Real error logged server-side only
```

**Lines 116-118: Conditionally add details**
```typescript
if (err.details) {
  response.error.details = err.details;
}
```

**Why conditional?**
Only `ValidationError` has details. Other errors don't, so don't add an empty field.

**With details (ValidationError):**
```json
{
  "success": false,
  "error": {
    "message": "Validation failed",
    "statusCode": 400,
    "details": [
      { "field": "email", "message": "Required" }
    ]
  }
}
```

**Without details (NotFoundError):**
```json
{
  "success": false,
  "error": {
    "message": "User not found",
    "statusCode": 404
  }
}
```

**Line 120: Send response**
```typescript
res.status(err.statusCode).json(response);
```

- `res.status(err.statusCode)` - Set HTTP status code
- `.json(response)` - Send JSON response

**HTTP response structure:**
```http
HTTP/1.1 404 Not Found
Content-Type: application/json

{
  "success": false,
  "error": {
    "message": "User not found",
    "statusCode": 404
  }
}
```

---

## 🔍 SECTION 4: ASYNCHANDLER WRAPPER (Lines 123-127)

### 4.1 The Problem asyncHandler Solves

**Without asyncHandler:**

```typescript
// ❌ BUG: Unhandled promise rejection
app.get('/api/users/:id', async (req, res) => {
  const user = await userService.findById(req.params.id);
  // If userService.findById throws, Express doesn't catch it!
  // Result: Server hangs, no response sent
  res.json(user);
});
```

**Why doesn't Express catch it?**

Express was designed before `async/await`. It expects errors to be passed to `next()`:

```typescript
// ✅ Manual error handling
app.get('/api/users/:id', async (req, res, next) => {
  try {
    const user = await userService.findById(req.params.id);
    res.json(user);
  } catch (err) {
    next(err);  // ← Must manually pass to next()
  }
});
```

**Problem:** Every route needs try/catch! Repetitive and error-prone.

**Solution: asyncHandler wrapper**

```typescript
// ✅ With asyncHandler (no try/catch needed!)
app.get('/api/users/:id', asyncHandler(async (req, res) => {
  const user = await userService.findById(req.params.id);
  res.json(user);
}));
```

### 4.2 Line-by-Line Breakdown

```typescript
export const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
```

**Line 123: Function signature**

```typescript
export const asyncHandler = (fn: ...) => { ... }
```

**`asyncHandler`** is a **higher-order function** (function that takes a function as input and returns a function as output).

**Parameter type:**
```typescript
fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
```

This means `fn` must be an async function (returns a Promise).

**Return type:**
```typescript
: RequestHandler
```

Returns an Express-compatible request handler.

**Line 124: Return wrapped function**

```typescript
return (req: Request, res: Response, next: NextFunction) => {
```

Returns a **new function** that Express will call. This is the actual route handler.

**Line 125: The magic**

```typescript
Promise.resolve(fn(req, res, next)).catch(next);
```

Let's dissect this:

**1. `fn(req, res, next)`**
- Calls the original async function
- Returns a Promise

**2. `Promise.resolve(...)`**
- Wraps the result in a Promise (in case fn returns non-Promise)
- Ensures we have a Promise to call .catch() on

**3. `.catch(next)`**
- If Promise rejects (error thrown), call `next(err)`
- This passes error to Express error handling middleware

**Visual flow:**

```
User Request
    ↓
asyncHandler wrapper
    ↓
fn(req, res, next) executes
    ↓
    ├─ Success → Response sent ✅
    │
    └─ Error thrown → .catch(next)
                          ↓
                      next(err)
                          ↓
                   errorHandler middleware
                          ↓
                   Error response sent
```

**Why `Promise.resolve()`?**

Safety net in case `fn` doesn't return a Promise:

```typescript
// If someone forgets async keyword
const handler = (req, res) => {
  return userService.findById(req.params.id);  // Oops, not async
};

// Promise.resolve() still works
Promise.resolve(handler(req, res, next)).catch(next);
```

### 4.3 Complete Usage Example

```typescript
import { asyncHandler, NotFoundError } from './shared/errors';

// Define route handler as async function
const getUser = asyncHandler(async (req, res) => {
  const user = await userService.findById(req.params.id);
  
  if (!user) {
    throw new NotFoundError('User not found');  // ← Automatically caught!
  }
  
  res.json({ success: true, data: user });
});

// Register route
app.get('/api/users/:id', getUser);
```

**What happens when error is thrown:**

1. `throw new NotFoundError()` rejects the Promise
2. `.catch(next)` catches the rejection
3. `next(err)` passes error to Express
4. Express calls `errorHandler` middleware
5. Client receives formatted error response

**Without asyncHandler, you'd need:**

```typescript
const getUser = async (req, res, next) => {  // ← Need next parameter
  try {  // ← Need try
    const user = await userService.findById(req.params.id);
    
    if (!user) {
      throw new NotFoundError('User not found');
    }
    
    res.json({ success: true, data: user });
  } catch (err) {  // ← Need catch
    next(err);  // ← Need to call next
  }
};
```

**asyncHandler saves:**
- 3 lines per route (try/catch/next)
- Forgetting to call next() (common bug)
- Consistent error handling

---

## 🏗️ SECTION 5: ARCHITECTURE DIAGRAMS

### 5.1 Complete Error Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    CLIENT REQUEST                            │
│              POST /api/users                                 │
│              { "email": "" }                                 │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │  Express Middleware  │
              │  (asyncHandler wrap) │
              └──────────┬───────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │   Route Handler      │
              │  (Business Logic)    │
              └──────────┬───────────┘
                         │
                         ├─── SUCCESS ──→ res.json({ data })
                         │
                         └─── ERROR THROWN
                                  │
                                  ▼
                      ┌───────────────────────┐
                      │  asyncHandler catches │
                      │  calls next(err)      │
                      └──────────┬────────────┘
                                 │
                                 ▼
                      ┌───────────────────────┐
                      │  errorHandler         │
                      │  Middleware           │
                      └──────────┬────────────┘
                                 │
                    ┌────────────┼────────────┐
                    │            │            │
                    ▼            ▼            ▼
              ┌─────────┐  ┌─────────┐  ┌─────────┐
              │Log Error│  │ Format  │  │  Send   │
              │(Winston)│  │Response │  │ to Client│
              └─────────┘  └─────────┘  └─────────┘
```

### 5.2 Error Class Hierarchy

```
                    Error (JS built-in)
                         │
                         │
                    AppError
                    │
                    ├─ statusCode: number
                    ├─ isOperational: boolean
                    └─ timestamp: string
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
ValidationError    NotFoundError    DatabaseError
(400)              (404)            (500)
│                  │                │
├─ details[]       └─ (no extra)   └─ originalError
└─ (client error)                     (server error)

        │                │                │
        ▼                ▼                ▼
UnauthorizedError  ConflictError    ServiceUnavailable
(401)              (409)            (503)

        │
        ▼
ForbiddenError
(403)
```

### 5.3 Status Code Decision Tree

```
Error Occurs
     │
     ▼
Is it client's fault?
     │
     ├─ YES → 4xx
     │    │
     │    ├─ Bad input? → 400 (ValidationError)
     │    ├─ Not logged in? → 401 (UnauthorizedError)
     │    ├─ No permission? → 403 (ForbiddenError)
     │    ├─ Not found? → 404 (NotFoundError)
     │    └─ Duplicate? → 409 (ConflictError)
     │
     └─ NO → 5xx
          │
          ├─ Generic error? → 500 (DatabaseError)
          └─ Temporary down? → 503 (ServiceUnavailableError)
```

### 5.4 Operational vs Programming Error Flow

```
Error Thrown
     │
     ▼
err.isOperational?
     │
     ├─ TRUE (Operational) → Expected Error
     │    │
     │    ├─ Log as WARN (4xx) or ERROR (5xx)
     │    ├─ Send appropriate response to client
     │    └─ Continue serving requests ✅
     │
     └─ FALSE (Programming) → Bug/Unexpected
          │
          ├─ Log as ERROR with full details
          ├─ Send generic "Something went wrong"
          ├─ Alert on-call engineer
          └─ Consider crashing (process.exit)
               │
               └─ Let PM2/Kubernetes restart ✅
```

---

## 🎯 SECTION 6: 10 INTERVIEW QUESTIONS

### Q1: Explain the difference between operational and programming errors

**Level:** Mid

**Answer:**
Operational errors are **expected** errors that can happen during normal operation, even in bug-free code. Examples: network timeouts, invalid user input, file not found. These should be handled gracefully.

Programming errors are **bugs** in the code - things that shouldn't happen if the code is correct. Examples: accessing `undefined.property`, calling a function with wrong parameters, infinite recursion.

In our code, we use the `isOperational` flag:
```typescript
export class AppError extends Error {
  public isOperational: boolean;
  
  constructor(message: string, statusCode: number, isOperational = true) {
    // Operational errors default to true
  }
}
```

For operational errors, we log and send a nice error response. For programming errors, we should log, alert, and potentially crash the process (let it restart clean) because the application might be in an undefined state.

---

### Q2: Why do we need custom error classes instead of just using Error?

**Level:** Junior

**Answer:**
JavaScript's built-in `Error` class doesn't have HTTP status codes or type information. In a REST API, we need to:

1. **Return appropriate HTTP status codes** (400 for bad input, 404 for not found, etc.)
2. **Distinguish error types** programmatically (catch specific errors differently)
3. **Include metadata** (validation details, timestamps, etc.)
4. **Control what's sent to clients** (hide internal errors in production)

Example without custom errors:
```typescript
throw new Error('User not found');  // What status code? 500? 404?
```

Example with custom errors:
```typescript
throw new NotFoundError('User not found');  // Automatically 404
```

The error handler middleware can then read `err.statusCode` and format responses consistently.

---

### Q3: What does asyncHandler do and why is it needed?

**Level:** Mid

**Answer:**
`asyncHandler` is a wrapper that catches errors from async route handlers and passes them to Express error middleware.

The problem: Express doesn't automatically catch errors thrown in async functions:
```typescript
// ❌ Error not caught - hangs!
app.get('/users', async (req, res) => {
  const users = await db.query('SELECT * FROM users');
  // If this throws, Express doesn't catch it
  res.json(users);
});
```

Without asyncHandler, you need try/catch everywhere:
```typescript
// ✅ Manual error handling (verbose)
app.get('/users', async (req, res, next) => {
  try {
    const users = await db.query('SELECT * FROM users');
    res.json(users);
  } catch (err) {
    next(err);
  }
});
```

With asyncHandler:
```typescript
// ✅ Clean and automatic
app.get('/users', asyncHandler(async (req, res) => {
  const users = await db.query('SELECT * FROM users');
  res.json(users);
}));
```

It works by wrapping the async function and catching any rejections:
```typescript
return (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
```

---

### Q4: Why do we hide error stack traces in production?

**Level:** Junior

**Answer:**
Stack traces reveal sensitive information about your application:

1. **Internal file paths** - Attacker learns your directory structure
2. **Code structure** - See how modules are organized
3. **Library versions** - Can exploit known vulnerabilities
4. **Business logic** - Understand how system works

Example dangerous stack trace:
```
Error: Payment processing failed
    at PaymentService.charge (/app/src/services/payment.service.ts:127)
    at checkCreditCard (/app/src/utils/creditcard.validator.ts:45)
    at verifyWithVisa (/app/src/integrations/visa-api.ts:89)
```

From this, an attacker knows:
- You use Visa API
- You have a credit card validator
- Exact line numbers for targeted attacks

In production, return generic messages:
```json
{
  "error": "Something went wrong",
  "statusCode": 500
}
```

Stack traces should only be in server logs (not sent to client).

---

### Q5: When would you use 401 vs 403 vs 404?

**Level:** Junior/Mid

**Answer:**
- **401 Unauthorized**: User needs to log in (authentication failed)
- **403 Forbidden**: User is logged in but doesn't have permission (authorization failed)
- **404 Not Found**: Resource doesn't exist

Examples:

**401 - No authentication:**
```typescript
GET /api/profile
→ No token in headers
→ 401: "Authentication required"
```

**403 - Authenticated but not authorized:**
```typescript
GET /api/admin/users
→ Token valid, but user.role = 'user' (not 'admin')
→ 403: "Admin access required"
```

**404 - Resource doesn't exist:**
```typescript
GET /api/users/999
→ User 999 doesn't exist in database
→ 404: "User not found"
```

**Memory trick:**
- 401 = "Who are you?" (identity unknown)
- 403 = "I know who you are, but no" (identity known, permission denied)
- 404 = "That thing doesn't exist" (nothing to do with identity)

---

### Q6: Why is isOperational defaulted to true in AppError?

**Level:** Mid

**Answer:**
Most errors in a well-built API are **operational** (expected) rather than programming errors (bugs):

- User input validation failures (expected)
- Resources not found (expected)
- Authentication failures (expected)
- External API timeouts (expected)
- Database constraints (expected)

Programming errors are the **exception**:
- Bugs in code logic
- Infrastructure failures
- Corrupted state

By defaulting `isOperational = true`, we:
1. Don't need to set it for most errors
2. Force conscious decision when it's false
3. Fail safe (better to show error than crash)

Example:
```typescript
// ValidationError extends AppError
throw new ValidationError('Bad input');
// isOperational = true (default, don't need to set)

// DatabaseError explicitly sets false
export class DatabaseError extends AppError {
  constructor(message: string) {
    super(message, 500, false);  // ← Explicitly false
  }
}
```

The few classes that set it to `false` (DatabaseError, ServiceUnavailableError) are infrastructure issues that might require crashing/restarting.

---

### Q7: How would you handle errors from third-party APIs?

**Level:** Senior

**Answer:**
Third-party API errors need special handling because:
1. You don't control their error format
2. Their errors might expose sensitive data
3. You need to translate to your error format

**Strategy:**

```typescript
async function callPaymentAPI(amount: number) {
  try {
    const response = await paymentAPI.charge({ amount });
    return response;
  } catch (err) {
    // Third-party error - don't expose directly
    
    // Check if it's their specific error type
    if (err instanceof PaymentAPIError) {
      // Translate to our error type
      if (err.code === 'CARD_DECLINED') {
        throw new ValidationError('Payment declined', [
          { field: 'card', message: 'Card was declined' }
        ]);
      }
      if (err.code === 'INSUFFICIENT_FUNDS') {
        throw new ValidationError('Insufficient funds');
      }
    }
    
    // Unknown error - wrap in our error type
    throw new ServiceUnavailableError(
      'Payment service temporarily unavailable'
    );
    // Log the real error server-side
    logger.error('Payment API error', { 
      originalError: err.message,
      code: err.code 
    });
  }
}
```

**Key principles:**
1. **Never expose third-party errors directly** (security risk)
2. **Translate known error codes** to your error types
3. **Wrap unknown errors** generically
4. **Log original errors** server-side for debugging
5. **Consider circuit breaker** if API is frequently failing

---

### Q8: What's the security risk of logging originalError?

**Level:** Senior

**Answer:**
The `originalError` field in DatabaseError stores the raw error from the database driver. This can contain sensitive information:

**Dangerous information in database errors:**

```typescript
// PostgreSQL error example
{
  message: "duplicate key value violates unique constraint",
  code: "23505",
  detail: "Key (email)=(admin@company.com) already exists.",
  constraint: "users_email_key",
  table: "users",
  schema: "public"
}
```

From this, an attacker learns:
- Table names (`users`)
- Column names (`email`)
- Constraint names (can infer relationships)
- Actual data values (`admin@company.com`)
- Database type (PostgreSQL)

**Proper handling:**

```typescript
export class DatabaseError extends AppError {
  public originalError: Error | null;
  
  constructor(message: string, originalError: Error | null = null) {
    super(message, 500, false);
    this.originalError = originalError;  // ← Store for logging
  }
}

// In error handler
if (err instanceof DatabaseError) {
  // Log original error server-side (developers see it)
  logger.error('Database error', {
    message: err.message,
    originalError: err.originalError
  });
  
  // Send generic message to client
  res.status(500).json({
    error: 'Database operation failed'  // ← Generic, safe
  });
}
```

**Never send to client:**
- Table/column names
- Constraint names
- Actual data values
- Database type/version
- Query text

---

### Q9: How would you implement error monitoring in production?

**Level:** Senior

**Answer:**
Production error monitoring requires multiple layers:

**1. Error Aggregation Service**

Integrate with Sentry, Datadog, or similar:

```typescript
import * as Sentry from '@sentry/node';

// Initialize Sentry
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  release: process.env.APP_VERSION
});

// In error handler
export const errorHandler = (err, req, res, next) => {
  // Send to Sentry
  Sentry.captureException(err, {
    tags: {
      statusCode: err.statusCode,
      isOperational: err.isOperational
    },
    user: {
      id: req.user?.id,
      email: req.user?.email
    },
    extra: {
      url: req.originalUrl,
      method: req.method,
      body: req.body  // Be careful with sensitive data!
    }
  });
  
  // Continue with normal error handling
  logger.error('Error occurred', { error: err });
  res.status(err.statusCode).json({ error: err.message });
};
```

**2. Metrics and Alerting**

```typescript
import { Counter } from 'prom-client';

const errorCounter = new Counter({
  name: 'http_errors_total',
  help: 'Total HTTP errors',
  labelNames: ['status_code', 'method', 'path']
});

// In error handler
errorCounter.inc({
  status_code: err.statusCode,
  method: req.method,
  path: req.route?.path || req.url
});

// Alert if error rate > threshold
if (errorRate > 100) {  // 100 errors/min
  alertPagerDuty('High error rate detected');
}
```

**3. Log Aggregation**

Already covered in M01 (ELK stack, CloudWatch, etc.)

**4. Structured Logging**

```typescript
logger.error('Error details', {
  errorId: uuid(),  // Unique ID for tracking
  errorType: err.constructor.name,
  statusCode: err.statusCode,
  isOperational: err.isOperational,
  userId: req.user?.id,
  requestId: req.id,
  url: req.originalUrl,
  method: req.method,
  userAgent: req.headers['user-agent'],
  ip: req.ip,
  timestamp: new Date().toISOString()
});
```

**5. Error Budget Tracking**

```typescript
// Track error percentage against SLO
const errorRate = errors / total;
const errorBudget = 1 - SLO;  // e.g., 99.9% SLO = 0.1% budget

if (errorRate > errorBudget) {
  // Freeze non-critical releases
  logger.warn('Error budget exceeded', { errorRate, errorBudget });
}
```

---

### Q10: Design an error handling strategy for a microservices architecture

**Level:** Staff/Principal

**Answer:**

**Architecture:**

```
┌──────────────────────────────────────────────────────────┐
│                     API Gateway                           │
│  - Catches all errors from downstream                    │
│  - Translates to client-friendly responses               │
│  - Correlation ID for tracing                            │
└────────────────┬─────────────────────────────────────────┘
                 │
    ┌────────────┼────────────┐
    │            │            │
    ▼            ▼            ▼
┌─────────┐  ┌─────────┐  ┌─────────┐
│  User   │  │ Order   │  │ Payment │
│ Service │  │ Service │  │ Service │
└─────────┘  └─────────┘  └─────────┘
    │            │            │
    └────────────┴────────────┘
                 │
                 ▼
        ┌────────────────┐
        │  Error Schema  │
        │  (Shared)      │
        └────────────────┘
```

**1. Shared Error Schema**

Create a shared npm package (`@company/errors`):

```typescript
// @company/errors
export class BaseServiceError extends Error {
  constructor(
    public code: string,        // 'USER_NOT_FOUND'
    public message: string,
    public statusCode: number,
    public service: string,     // 'user-service'
    public metadata?: any
  ) {
    super(message);
  }
}
```

**2. Service-Specific Errors**

Each service extends base error:

```typescript
// user-service/errors.ts
import { BaseServiceError } from '@company/errors';

export class UserNotFoundError extends BaseServiceError {
  constructor(userId: string) {
    super(
      'USER_NOT_FOUND',
      `User ${userId} not found`,
      404,
      'user-service',
      { userId }
    );
  }
}
```

**3. API Gateway Error Translation**

```typescript
// api-gateway/error-translator.ts
export function translateServiceError(err: any): AppError {
  // Errors from downstream services
  if (err.service) {
    switch (err.code) {
      case 'USER_NOT_FOUND':
        return new NotFoundError('User not found');
      case 'PAYMENT_DECLINED':
        return new ValidationError('Payment declined');
      case 'SERVICE_UNAVAILABLE':
        return new ServiceUnavailableError();
      default:
        return new AppError('Service error', 502);
    }
  }
  
  // Network errors
  if (err.code === 'ECONNREFUSED') {
    return new ServiceUnavailableError('Service temporarily unavailable');
  }
  
  // Unknown errors
  return new AppError('Something went wrong', 500, false);
}
```

**4. Correlation ID Propagation**

```typescript
// middleware/correlation-id.ts
app.use((req, res, next) => {
  req.correlationId = req.headers['x-correlation-id'] || uuid();
  res.setHeader('X-Correlation-ID', req.correlationId);
  next();
});

// When calling downstream services
const response = await axios.get('http://user-service/users/123', {
  headers: {
    'X-Correlation-ID': req.correlationId  // ← Propagate!
  }
});
```

**5. Circuit Breaker Integration**

```typescript
import CircuitBreaker from 'opossum';

const userServiceBreaker = new CircuitBreaker(callUserService, {
  timeout: 3000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000
});

userServiceBreaker.fallback(() => {
  throw new ServiceUnavailableError('User service unavailable');
});

// Use in routes
app.get('/users/:id', asyncHandler(async (req, res) => {
  const user = await userServiceBreaker.fire(req.params.id);
  res.json(user);
}));
```

**6. Centralized Error Logging**

All services send errors to centralized logging:

```typescript
// Each service
logger.error('Service error', {
  correlationId: req.correlationId,
  service: 'user-service',
  errorCode: err.code,
  statusCode: err.statusCode,
  metadata: err.metadata
});
```

**7. Error Budget & SLOs**

```typescript
// Track per-service error rates
const serviceErrorRates = {
  'user-service': 0.05%,
  'order-service': 0.02%,
  'payment-service': 0.15%  // ← Exceeding budget!
};

// Alert on SLO violations
if (serviceErrorRates['payment-service'] > 0.1%) {
  alertOncall('Payment service exceeding error budget');
}
```

**Key Principles:**
1. **Consistent error schema** across all services
2. **Correlation IDs** for tracing across services
3. **Circuit breakers** to prevent cascade failures
4. **Error translation** at API gateway (don't leak internal errors)
5. **Centralized logging** for debugging
6. **Per-service SLOs** and error budgets

---

**🎓 END OF PART 2**

Part 2 covered:
- ✅ errorHandler middleware line-by-line (lines 72-121)
- ✅ asyncHandler wrapper explanation (lines 123-127)
- ✅ Architecture diagrams
- ✅ 10 comprehensive interview questions

**📌 Continue to M02-ERRORS-DEEP-DIVE-PART3.md for:**
- 💡 Production Best Practices
- ⚡ Real-World Scenarios
- 🧪 Hands-On Exercises
- 🎯 MAANG Interview Tips
