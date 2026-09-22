# REVISION: Coding Exercises (11 Exercises)

**Problems Only - No Solutions**

Use this file for:
- ✅ Hands-on coding practice
- ✅ Implementation skill building
- ✅ Testing your understanding without peeking
- ✅ Interview preparation drills

---

## Table of Contents

- [Logger Patterns (5 Exercises)](#logger-patterns-5-exercises)
- [Error Handling (5 Exercises)](#error-handling-5-exercises)
- [Repository Pattern (1 Exercise)](#repository-pattern-1-exercise)

---

## Logger Patterns (5 Exercises)

### Exercise 1: Fix the Bad Logger
**Source:** [M01-LOGGER-DEEP-DIVE-PART3.md:426](../M01-LOGGER-DEEP-DIVE-PART3.md)

**Given this code:**

```typescript
import winston from 'winston';

const logger = winston.createLogger({
  level: 'debug',  // Issue 1
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),  // Issue 2
    new winston.transports.File({
      filename: 'app.log'  // Issue 3
    })
  ]
});

export default logger;
```

**Problems:**
1. `level: 'debug'` will log debug messages in production (performance issue)
2. Console transport is always on (should be dev-only)
3. No log rotation (disk will fill up)
4. No timestamp format
5. No defaultMeta (can't identify service in microservices)
6. No error stack traces

**Your task:** Fix all 6 issues.

---

### Exercise 2: Implement Correlation IDs
**Source:** [M01-LOGGER-DEEP-DIVE-PART3.md:509](../M01-LOGGER-DEEP-DIVE-PART3.md)

**Scenario:** You have an Express API. Implement correlation IDs so you can trace a single request through multiple services.

**Starter code:**

```typescript
import express from 'express';
import logger from './logger';

const app = express();

app.post('/api/orders', async (req, res) => {
  logger.info('Creating order');
  const order = await createOrder(req.body);
  logger.info('Order created', { orderId: order.id });
  res.json(order);
});

async function createOrder(data) {
  logger.info('Saving to database');
  // ... save to DB ...
  logger.info('Calling payment service');
  // ... call payment service ...
  return order;
}
```

**Your task:**
1. Generate a unique request ID for each request
2. Log it with every log entry
3. Return it in response headers

**Hints:**
- Use `uuid` library for ID generation
- Consider middleware for ID generation
- Use Winston child loggers to attach request ID to all logs

---

### Exercise 3: Implement PII Redaction
**Source:** [M01-LOGGER-DEEP-DIVE-PART3.md:592](../M01-LOGGER-DEEP-DIVE-PART3.md)

**Scenario:** Your logs accidentally contain sensitive data. Implement automatic redaction.

**Starter code:**

```typescript
import logger from './logger';

app.post('/api/login', (req, res) => {
  logger.info('Login attempt', req.body);
  // Problem: req.body contains password!
});

app.post('/api/payment', (req, res) => {
  logger.info('Payment processing', req.body);
  // Problem: req.body contains credit card!
});
```

**Your task:** Create a wrapper around the logger that automatically redacts sensitive fields.

**Requirements:**
- Redact fields: password, token, apiKey, secret, creditCard, cardNumber, cvv, ssn, pin
- For credit cards, show last 4 digits only
- Handle nested objects recursively
- Prevent infinite recursion (max depth: 10)

---

### Exercise 4: Implement Log Sampling
**Source:** [M01-LOGGER-DEEP-DIVE-PART3.md:711](../M01-LOGGER-DEEP-DIVE-PART3.md)

**Scenario:** Your `/health` endpoint gets 1000 requests/second. You don't need to log every single one.

**Your task:** Implement log sampling that logs:
- 100% of errors
- 10% of warnings
- 1% of info
- 0.1% of debug

**Requirements:**
- Create a wrapped logger with sampling logic
- Add metadata to sampled logs indicating the sample rate
- Ensure errors are ALWAYS logged
- Use Math.random() for sampling decision

---

### Exercise 5: Write Tests for Logger
**Source:** [M01-LOGGER-DEEP-DIVE-PART3.md:789](../M01-LOGGER-DEEP-DIVE-PART3.md)

**Your task:** Write unit tests to verify that:
1. Logs are written to files
2. Rotation works when maxsize is exceeded
3. Console transport is not added in production
4. defaultMeta is included in all logs

**Test framework:** Use Jest or your preferred testing framework

**Hints:**
- Create a test log directory
- Clean up test logs before/after each test
- Mock `process.env.NODE_ENV` for production tests
- Read log files to verify content
- Test file size limits for rotation

---

## Error Handling (5 Exercises)

### Exercise 1: Create a Custom Error Class
**Source:** [M02-ERRORS-DEEP-DIVE-PART3.md:405](../M02-ERRORS-DEEP-DIVE-PART3.md)

**Task:** Create a `RateLimitError` class for 429 status code.

**Requirements:**
- Extend `AppError` base class
- Accept `message` (default: 'Too many requests')
- Accept `retryAfter` parameter (default: 60 seconds)
- Set appropriate status code (429)
- Set error name to 'RateLimitError'
- Store `retryAfter` as public property

**Bonus:** Update the error handler to add `Retry-After` header when this error is thrown.

---

### Exercise 2: Implement Validation Middleware
**Source:** [M02-ERRORS-DEEP-DIVE-PART3.md:437](../M02-ERRORS-DEEP-DIVE-PART3.md)

**Task:** Create a reusable validation middleware using Joi.

**Requirements:**
- Accept a Joi schema as parameter
- Return Express middleware function
- Validate `req.body` against the schema
- Set `abortEarly: false` to get all validation errors
- Throw `ValidationError` with formatted details
- Format details as: `{ field: string, message: string }[]`

**Example usage:**
```typescript
const createUserSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  age: Joi.number().integer().min(18).optional()
});

app.post('/users', 
  validate(createUserSchema),  // ← Your middleware
  asyncHandler(async (req, res) => {
    const user = await userService.create(req.body);
    res.json(user);
  })
);
```

---

### Exercise 3: Handle Database Errors Specifically
**Source:** [M02-ERRORS-DEEP-DIVE-PART3.md:488](../M02-ERRORS-DEEP-DIVE-PART3.md)

**Task:** Catch specific PostgreSQL error codes and throw appropriate errors.

**PostgreSQL error codes to handle:**
- `23505` - UNIQUE_VIOLATION (duplicate key)
- `23503` - FOREIGN_KEY_VIOLATION (referenced record doesn't exist)
- `23502` - NOT_NULL_VIOLATION (missing required field)

**Your task:** In the `UserService.create()` method:
1. Wrap repository call in try-catch
2. Check `err.code` for specific PostgreSQL errors
3. Throw appropriate custom error for each case:
   - UNIQUE_VIOLATION → `ConflictError`
   - FOREIGN_KEY_VIOLATION → `ValidationError`
   - NOT_NULL_VIOLATION → `ValidationError`
4. For unknown errors, throw generic `DatabaseError`

**Hints:**
- PostgreSQL errors have `code`, `constraint`, and `column` properties
- Extract field name from `err.constraint` for better error messages

---

### Exercise 4: Write Tests for Error Handling
**Source:** [M02-ERRORS-DEEP-DIVE-PART3.md:540](../M02-ERRORS-DEEP-DIVE-PART3.md)

**Task:** Write unit tests for the errorHandler middleware.

**Test cases to implement:**
1. Should handle ValidationError with 400 status
2. Should handle NotFoundError with 404 status
3. Should hide programming errors in production (generic message)
4. Should show full error with stack trace in development

**Test setup requirements:**
- Mock Request, Response objects
- Mock `res.status()` and `res.json()` methods
- Test error handler with different error types
- Verify correct status codes and response format
- Test NODE_ENV-based behavior

---

### Exercise 5: Implement Global Error Handling
**Source:** [M02-ERRORS-DEEP-DIVE-PART3.md:639](../M02-ERRORS-DEEP-DIVE-PART3.md)

**Task:** Set up complete error handling for an Express app.

**Requirements:**
1. Add error handler middleware (must be LAST)
2. Add 404 handler for unknown routes (must be AFTER all routes)
3. Handle unhandled promise rejections (outside Express)
4. Handle uncaught exceptions
5. Use asyncHandler wrapper for async routes
6. Crash process on unhandled rejection in production

**Architecture:**
```
Routes →
404 Handler (catch-all) →
Error Handler (last middleware) →
Process-level handlers
```

**Hints:**
- Use `process.on('unhandledRejection', ...)` 
- Use `process.on('uncaughtException', ...)`
- Always crash on uncaught exception (use `process.exit(1)`)
- Let PM2/Kubernetes restart the process

---

## Repository Pattern (1 Exercise)

### Exercise: Implement Additional Repository Methods
**Source:** [M15-REPOSITORY-PATTERN-DEEP-DIVE.md:1576](../M15-REPOSITORY-PATTERN-DEEP-DIVE.md)

**Task:** Add these methods to `UserRepository`:

```typescript
// 1. Find users by role
async findByRole(role: string): Promise<User[]> {
  // TODO: Implement
  // Hint: SELECT * FROM users WHERE role = $1 AND is_active = true
}

// 2. Find recently created users (last N days)
async findRecentUsers(days: number = 7): Promise<User[]> {
  // TODO: Implement
  // Hint: Use CURRENT_DATE - INTERVAL '${days} days'
  // Order by created_at DESC
}

// 3. Count users by role
async countByRole(role: string): Promise<number> {
  // TODO: Implement
  // Hint: SELECT COUNT(*) as count FROM users WHERE role = $1
  // Remember to parseInt the result
}

// 4. Find inactive users (not deactivated, but haven't logged in for N days)
// Assume we add a last_login column
async findInactiveUsers(days: number = 90): Promise<User[]> {
  // TODO: Implement
  // Hint: Check is_active = true AND (last_login IS NULL OR last_login < ...)
}

// 5. Bulk deactivate users
async deactivateMany(ids: number[]): Promise<number> {
  // TODO: Implement
  // Return: Number of users deactivated
  // Hint: Use UPDATE with IN clause and placeholders
  // Handle empty array case
}
```

**Requirements:**
- Use parameterized queries ($1, $2, etc.) to prevent SQL injection
- Use `User.fromDatabaseArray()` to transform results
- Handle edge cases (empty arrays, NULL values)
- Return appropriate types (User[], number)
- Set updated_at timestamp in bulk operations

---

## How to Use This File

### Practice Mode
1. Pick an exercise
2. Implement the solution without looking at answers
3. Test your implementation
4. Check the source file for the official solution
5. Compare and learn from differences

### Interview Drill
1. Set a timer (20-30 minutes per exercise)
2. Implement the solution
3. Write unit tests
4. Explain your approach out loud
5. Discuss trade-offs and alternatives

### Progress Tracking
- **Beginner**: Complete exercises 1-2 in each section
- **Intermediate**: Complete all exercises, basic implementation
- **Advanced**: Complete all exercises with tests and edge cases

### Finding Solutions
Each exercise has a source reference showing:
- Exact file and line number
- Complete solution with explanation
- Best practices and patterns
- Common pitfalls to avoid

Click the source link (e.g., `[M01-LOGGER-DEEP-DIVE-PART3.md:426]`) to see the full solution.

---

## Tips for Success

**Logger Exercises:**
- Winston is the industry standard for Node.js
- Focus on production readiness (rotation, sampling, security)
- Understand log levels and when to use each

**Error Handling Exercises:**
- Custom error classes improve API consistency
- Always use parameterized queries
- Handle operational vs programming errors differently
- Test error scenarios thoroughly

**Repository Pattern Exercise:**
- Isolate ALL database operations in repository
- Use parameterized queries to prevent SQL injection
- Domain models separate database shape from API shape
- PostgreSQL-specific features (RETURNING, EXISTS, INTERVAL)

---

**Total Exercises:** 11  
**Estimated Time (with solutions):** 8-12 hours  
**Estimated Time (problems only):** 3-4 hours
