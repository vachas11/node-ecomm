# M02: Error Handling Deep Dive - PART 3

**Best Practices, Real-World Scenarios & Exercises**

---

## 💡 SECTION 7: PRODUCTION BEST PRACTICES

### 7.1 DO's ✅

**1. Always use custom error classes**
```typescript
// ✅ GOOD
throw new NotFoundError('User not found');

// ❌ BAD
throw new Error('User not found');
```

**2. Wrap all async route handlers with asyncHandler**
```typescript
// ✅ GOOD
app.get('/users/:id', asyncHandler(async (req, res) => {
  const user = await userService.findById(req.params.id);
  res.json(user);
}));

// ❌ BAD (unhandled promise rejection)
app.get('/users/:id', async (req, res) => {
  const user = await userService.findById(req.params.id);
  res.json(user);
});
```

**3. Include context in errors**
```typescript
// ✅ GOOD
throw new NotFoundError(`User with ID ${userId} not found`);

// ❌ BAD (no context)
throw new NotFoundError('User not found');
```

**4. Use appropriate status codes**
```typescript
// ✅ GOOD
if (!user) throw new NotFoundError();          // 404
if (!req.user) throw new UnauthorizedError();  // 401
if (user.role !== 'admin') throw new ForbiddenError();  // 403
```

**5. Log errors with correlation IDs**
```typescript
// ✅ GOOD
logger.error('Payment failed', {
  requestId: req.id,
  userId: req.user.id,
  orderId: order.id,
  error: err.message
});
```

### 7.2 DON'Ts ❌

**1. Don't send stack traces to clients in production**
```typescript
// ❌ NEVER
if (process.env.NODE_ENV === 'production') {
  res.json({ error: err.message, stack: err.stack });  // ← Security risk!
}
```

**2. Don't use generic Error for business logic**
```typescript
// ❌ BAD
if (!user.email) {
  throw new Error('Email required');  // What status code?
}

// ✅ GOOD
if (!user.email) {
  throw new ValidationError('Email required', [
    { field: 'email', message: 'Email is required' }
  ]);
}
```

**3. Don't catch errors without re-throwing**
```typescript
// ❌ BAD (swallows error)
try {
  await paymentService.charge(amount);
} catch (err) {
  console.log('Error occurred');  // ← Error lost!
}

// ✅ GOOD
try {
  await paymentService.charge(amount);
} catch (err) {
  logger.error('Payment failed', { error: err });
  throw new ServiceUnavailableError('Payment processing failed');
}
```

**4. Don't expose internal error details**
```typescript
// ❌ BAD
throw new Error(`Database connection failed: postgres://user:password@host:5432/db`);

// ✅ GOOD
throw new DatabaseError('Database operation failed');
// Log the real error server-side only
```

**5. Don't forget to call next() in error middleware**
```typescript
// ❌ BAD
app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message });
  // Forgot to call next() if needed
});

// ✅ GOOD
app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message });
  // No need to call next() if we're sending response
});
```

---

## ⚡ SECTION 8: REAL-WORLD SCENARIOS

### Scenario 1: Handling Duplicate User Registration

**Problem:** User tries to register with an email that already exists.

**Bad approach:**
```typescript
app.post('/register', asyncHandler(async (req, res) => {
  const user = await userService.create(req.body);
  res.json(user);
  // If email exists, throws generic database error (500)
  // Client sees: "Internal Server Error"
}));
```

**Good approach:**
```typescript
// In UserService
async create(data: CreateUserDTO) {
  try {
    const user = await userRepository.create(data);
    return user;
  } catch (err) {
    // Check for PostgreSQL unique violation
    if (err.code === '23505' && err.constraint === 'users_email_key') {
      throw new ConflictError('Email already registered');
    }
    // Other database errors
    throw new DatabaseError('Failed to create user', err);
  }
}

// Client now sees: 409 Conflict - "Email already registered"
```

---

### Scenario 2: Validating Request Body

**Bad approach:**
```typescript
app.post('/users', asyncHandler(async (req, res) => {
  if (!req.body.email) {
    return res.status(400).json({ error: 'Email required' });
  }
  if (!req.body.password) {
    return res.status(400).json({ error: 'Password required' });
  }
  // ... more validations
  // Problems:
  // 1. Client sees one error at a time
  // 2. Inconsistent error format
  // 3. Code is messy
}));
```

**Good approach:**
```typescript
import Joi from 'joi';

const userSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  age: Joi.number().min(18).required()
});

app.post('/users', asyncHandler(async (req, res) => {
  const { error } = userSchema.validate(req.body, { abortEarly: false });
  
  if (error) {
    const details = error.details.map(d => ({
      field: d.path.join('.'),
      message: d.message
    }));
    throw new ValidationError('Validation failed', details);
  }
  
  const user = await userService.create(req.body);
  res.json(user);
}));

// Client receives ALL validation errors at once:
// {
//   "error": "Validation failed",
//   "details": [
//     { "field": "email", "message": "\"email\" must be a valid email" },
//     { "field": "password", "message": "\"password\" length must be at least 8 characters" }
//   ]
// }
```

---

### Scenario 3: Calling External APIs

**Problem:** External payment API can fail or timeout.

**Good approach with retry and circuit breaker:**
```typescript
import axios from 'axios';
import CircuitBreaker from 'opossum';

// Circuit breaker configuration
const paymentBreaker = new CircuitBreaker(
  async (orderId: string, amount: number) => {
    try {
      const response = await axios.post(
        'https://payment-api.com/charge',
        { orderId, amount },
        { timeout: 5000 }
      );
      return response.data;
    } catch (err) {
      if (err.code === 'ECONNABORTED') {
        throw new ServiceUnavailableError('Payment service timeout');
      }
      if (err.response?.status === 503) {
        throw new ServiceUnavailableError('Payment service unavailable');
      }
      throw new DatabaseError('Payment processing failed', err);
    }
  },
  {
    timeout: 5000,          // Timeout after 5 seconds
    errorThresholdPercentage: 50,  // Open circuit if 50% fail
    resetTimeout: 30000     // Try again after 30 seconds
  }
);

// Fallback when circuit is open
paymentBreaker.fallback(() => {
  throw new ServiceUnavailableError(
    'Payment service temporarily unavailable. Please try again later.'
  );
});

// Usage in route
app.post('/orders', asyncHandler(async (req, res) => {
  const order = await orderService.create(req.body);
  
  try {
    await paymentBreaker.fire(order.id, order.total);
    res.json({ success: true, order });
  } catch (err) {
    // Rollback order if payment fails
    await orderService.delete(order.id);
    throw err;
  }
}));
```

---

### Scenario 4: Rate Limiting Errors

**Implementation:**
```typescript
import rateLimit from 'express-rate-limit';

// Too many requests = 429
export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 429);
    this.name = 'TooManyRequestsError';
  }
}

// Rate limiter middleware
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 100,                  // Limit each IP to 100 requests per window
  handler: (req, res) => {
    throw new TooManyRequestsError(
      'Too many requests. Please try again in 15 minutes.'
    );
  }
});

app.use('/api/', limiter);
```

---

### Scenario 5: Authorization Hierarchy

**Problem:** Different levels of access control.

```typescript
// Middleware to check authentication
const authenticate = asyncHandler(async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    throw new UnauthorizedError('Authentication required');
  }
  
  const user = await verifyToken(token);
  if (!user) {
    throw new UnauthorizedError('Invalid or expired token');
  }
  
  req.user = user;
  next();
});

// Middleware to check role
const requireRole = (role: string) => {
  return asyncHandler(async (req, res, next) => {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }
    
    if (req.user.role !== role) {
      throw new ForbiddenError(`${role} access required`);
    }
    
    next();
  });
};

// Middleware to check ownership
const requireOwnership = (resourceGetter: (req) => Promise<any>) => {
  return asyncHandler(async (req, res, next) => {
    const resource = await resourceGetter(req);
    
    if (!resource) {
      throw new NotFoundError('Resource not found');
    }
    
    if (resource.userId !== req.user.id) {
      throw new ForbiddenError('You can only access your own resources');
    }
    
    req.resource = resource;
    next();
  });
};

// Usage:
// Public route (no auth)
app.get('/posts', asyncHandler(async (req, res) => {
  const posts = await postService.findAll();
  res.json(posts);
}));

// Requires authentication
app.get('/profile', authenticate, asyncHandler(async (req, res) => {
  res.json(req.user);
}));

// Requires admin role
app.get('/admin/users', authenticate, requireRole('admin'), asyncHandler(async (req, res) => {
  const users = await userService.findAll();
  res.json(users);
}));

// Requires ownership
app.put('/posts/:id', 
  authenticate, 
  requireOwnership(async (req) => await postService.findById(req.params.id)),
  asyncHandler(async (req, res) => {
    const updated = await postService.update(req.params.id, req.body);
    res.json(updated);
  })
);
```

---

## 🧪 SECTION 9: HANDS-ON EXERCISES

### Exercise 1: Create a Custom Error Class

**Task:** Create a `RateLimitError` class for 429 status code.

<details>
<summary>Click to see solution</summary>

```typescript
export class RateLimitError extends AppError {
  public retryAfter: number;  // Seconds until retry allowed
  
  constructor(message = 'Too many requests', retryAfter = 60) {
    super(message, 429);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

// In error handler, add Retry-After header:
if (err instanceof RateLimitError) {
  res.setHeader('Retry-After', err.retryAfter.toString());
  res.status(err.statusCode).json({
    error: err.message,
    retryAfter: err.retryAfter
  });
}
```

</details>

---

### Exercise 2: Implement Validation Middleware

**Task:** Create a reusable validation middleware using Joi.

<details>
<summary>Click to see solution</summary>

```typescript
import Joi from 'joi';
import { ValidationError } from './errors';

// Generic validation middleware
export const validate = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const { error } = schema.validate(req.body, { 
      abortEarly: false  // Get all errors, not just first
    });
    
    if (error) {
      const details = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message.replace(/"/g, '')  // Remove quotes
      }));
      
      throw new ValidationError('Validation failed', details);
    }
    
    next();
  };
};

// Usage:
const createUserSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  age: Joi.number().integer().min(18).optional()
});

app.post('/users', 
  validate(createUserSchema),  // ← Validation middleware
  asyncHandler(async (req, res) => {
    const user = await userService.create(req.body);
    res.json(user);
  })
);
```

</details>

---

### Exercise 3: Handle Database Errors Specifically

**Task:** Catch specific PostgreSQL error codes and throw appropriate errors.

<details>
<summary>Click to see solution</summary>

```typescript
// PostgreSQL error codes
const PG_ERRORS = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  NOT_NULL_VIOLATION: '23502'
};

export class UserService {
  async create(data: CreateUserDTO) {
    try {
      const user = await this.repository.create(data);
      return user;
    } catch (err: any) {
      // Unique violation (duplicate email/username)
      if (err.code === PG_ERRORS.UNIQUE_VIOLATION) {
        const field = err.constraint.replace('users_', '').replace('_key', '');
        throw new ConflictError(`${field} already exists`);
      }
      
      // Foreign key violation (referenced record doesn't exist)
      if (err.code === PG_ERRORS.FOREIGN_KEY_VIOLATION) {
        throw new ValidationError('Referenced resource does not exist', [
          { field: err.constraint, message: 'Invalid reference' }
        ]);
      }
      
      // Not null violation (missing required field)
      if (err.code === PG_ERRORS.NOT_NULL_VIOLATION) {
        throw new ValidationError(`${err.column} is required`, [
          { field: err.column, message: 'This field is required' }
        ]);
      }
      
      // Generic database error
      throw new DatabaseError('Failed to create user', err);
    }
  }
}
```

</details>

---

### Exercise 4: Write Tests for Error Handling

**Task:** Write unit tests for the errorHandler middleware.

<details>
<summary>Click to see solution</summary>

```typescript
import { errorHandler } from './errors';
import { Request, Response } from 'express';

describe('errorHandler', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;
  
  beforeEach(() => {
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    
    req = {
      originalUrl: '/api/users',
      method: 'POST',
      ip: '127.0.0.1'
    };
    
    res = {
      status: statusMock
    };
  });
  
  it('should handle ValidationError with 400 status', () => {
    const err = new ValidationError('Invalid input', [
      { field: 'email', message: 'Required' }
    ]);
    
    errorHandler(err, req as Request, res as Response, jest.fn());
    
    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({
      success: false,
      error: {
        message: 'Invalid input',
        statusCode: 400,
        details: [{ field: 'email', message: 'Required' }]
      }
    });
  });
  
  it('should handle NotFoundError with 404 status', () => {
    const err = new NotFoundError('User not found');
    
    errorHandler(err, req as Request, res as Response, jest.fn());
    
    expect(statusMock).toHaveBeenCalledWith(404);
    expect(jsonMock).toHaveBeenCalledWith({
      success: false,
      error: {
        message: 'User not found',
        statusCode: 404
      }
    });
  });
  
  it('should hide programming errors in production', () => {
    process.env.NODE_ENV = 'production';
    
    const err = new Error('Cannot read property of undefined');
    
    errorHandler(err, req as Request, res as Response, jest.fn());
    
    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({
      success: false,
      error: {
        message: 'Something went wrong',  // ← Generic message
        statusCode: 500
      }
    });
  });
  
  it('should show full error in development', () => {
    process.env.NODE_ENV = 'development';
    
    const err = new ValidationError('Bad input');
    
    errorHandler(err, req as Request, res as Response, jest.fn());
    
    const response = jsonMock.mock.calls[0][0];
    expect(response.error.stack).toBeDefined();  // ← Stack trace included
  });
});
```

</details>

---

### Exercise 5: Implement Global Error Handling

**Task:** Set up complete error handling for an Express app.

<details>
<summary>Click to see solution</summary>

```typescript
import express from 'express';
import { errorHandler, asyncHandler, NotFoundError } from './shared/errors';

const app = express();

// Body parser
app.use(express.json());

// Routes
app.get('/users/:id', asyncHandler(async (req, res) => {
  const user = await userService.findById(req.params.id);
  if (!user) {
    throw new NotFoundError('User not found');
  }
  res.json(user);
}));

// 404 handler (must be AFTER all routes)
app.use('*', (req, res) => {
  throw new NotFoundError(`Route ${req.originalUrl} not found`);
});

// Error handler (must be LAST middleware)
app.use(errorHandler);

// Unhandled promise rejections (outside Express)
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Crash the process in production (let PM2/K8s restart)
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
});

// Uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // Always crash on uncaught exception
  process.exit(1);
});

export default app;
```

</details>

---

## 🎯 SECTION 10: MAANG INTERVIEW CHECKLIST

### Junior Level
- [ ] Understand error vs exception
- [ ] Know HTTP status codes (400, 401, 403, 404, 500)
- [ ] Can create custom error classes
- [ ] Understand try/catch basics
- [ ] Know why to use asyncHandler

### Mid Level
- [ ] Operational vs programming errors
- [ ] Design error class hierarchy
- [ ] Implement error middleware
- [ ] Handle async errors properly
- [ ] Security considerations (hide stack traces)

### Senior Level
- [ ] Design error handling for microservices
- [ ] Circuit breakers and retries
- [ ] Error monitoring and alerting
- [ ] Error budgets and SLOs
- [ ] Database-specific error handling

### Staff/Principal Level
- [ ] Organization-wide error standards
- [ ] Error aggregation architecture
- [ ] Correlation and distributed tracing
- [ ] Chaos engineering for error scenarios
- [ ] Team education and tooling

---

## 📚 COMPLETION CHECKLIST

After studying all 3 parts, you should be able to:

**Understanding:**
- [ ] Explain operational vs programming errors
- [ ] Know when to use each error class
- [ ] Understand the error handling flow
- [ ] Know why asyncHandler is needed

**Implementation:**
- [ ] Create custom error classes
- [ ] Implement error middleware
- [ ] Use asyncHandler correctly
- [ ] Handle database errors specifically
- [ ] Validate input with structured errors

**Production:**
- [ ] Hide sensitive error details
- [ ] Log errors with context
- [ ] Implement monitoring
- [ ] Handle third-party API errors
- [ ] Design for microservices

**Interview Readiness:**
- [ ] Explain errors.ts line-by-line
- [ ] Answer all 10 interview questions
- [ ] Discuss security implications
- [ ] Design error handling architecture
- [ ] Debug production error scenarios

---

## 🔗 NEXT STEPS

After mastering error handling:

1. **M03: Database Deep Dive** - PostgreSQL connection pooling (shared/database.ts)
2. **M04: Redis Deep Dive** - Caching and session storage (shared/redis.ts)
3. **M05: JWT Auth Deep Dive** - Token generation and validation (shared/auth/jwt.ts)

---

**🎓 END OF MODULE M02**

You've completed the Error Handling Deep Dive! You now understand:
- ✅ Error class hierarchy (Part 1)
- ✅ errorHandler middleware (Part 2)
- ✅ asyncHandler wrapper (Part 2)
- ✅ 10 interview questions (Part 2)
- ✅ Production best practices (Part 3)
- ✅ Real-world scenarios (Part 3)
- ✅ Hands-on exercises (Part 3)

**Total time invested:** ~3-4 hours  
**Value for MAANG interviews:** Critical (error handling is tested in every backend interview)

Next module: **M03-DATABASE-DEEP-DIVE.md** - Ready when you are!
