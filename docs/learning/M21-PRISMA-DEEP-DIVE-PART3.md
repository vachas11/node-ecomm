# M21: Prisma Deep Dive - PART 3 (Error Handling & Resilience)

**Prerequisites:** M21-PART1, M21-PART2  
**Level:** Production/Expert  
**Time to Master:** 4-5 hours  
**Focus:** Handling errors gracefully and building resilient database operations

---

## 📖 SECTION 1: THEORY

### Types of Database Errors

```
┌────────────────────────────────────────────────────────────┐
│              DATABASE ERROR CATEGORIES                      │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  1. CONNECTION ERRORS                                      │
│     - Database unreachable (network down)                 │
│     - Connection timeout                                   │
│     - Connection pool exhausted                            │
│     → Retry with exponential backoff                      │
│                                                            │
│  2. CONSTRAINT VIOLATIONS                                  │
│     - Unique constraint (duplicate email)                 │
│     - Foreign key violation (invalid user_id)             │
│     - Not null constraint (required field missing)        │
│     → Return 4xx error to client (user error)            │
│                                                            │
│  3. QUERY ERRORS                                           │
│     - Syntax error (invalid SQL)                          │
│     - Table/column not found                              │
│     - Type mismatch                                        │
│     → Log as bug, return 500 to client                   │
│                                                            │
│  4. TRANSACTION ERRORS                                     │
│     - Deadlock detected                                    │
│     - Transaction timeout                                  │
│     - Serialization failure                                │
│     → Retry transaction automatically                     │
│                                                            │
│  5. DATA ERRORS                                            │
│     - Record not found (404)                              │
│     - Record already deleted                               │
│     → Return appropriate HTTP status                      │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### Prisma Error Codes

Prisma provides **typed error codes** for common scenarios:

```typescript
// Common error codes:
// P2002: Unique constraint violation
// P2003: Foreign key constraint violation
// P2025: Record not found
// P2024: Connection pool timeout
// P2034: Transaction failed (deadlock)
```

---

## 🔍 SECTION 2: LINE-BY-LINE CODE ANALYSIS

### Prisma Error Types

```typescript
import { Prisma } from '@prisma/client';

// Prisma provides these error classes:
// 1. PrismaClientKnownRequestError - Known errors with codes
// 2. PrismaClientUnknownRequestError - Unknown errors
// 3. PrismaClientRustPanicError - Query engine crashed
// 4. PrismaClientInitializationError - Failed to connect
// 5. PrismaClientValidationError - Invalid query parameters
```

---

### Error Handler: User-Friendly Responses

```typescript
// src/utils/prisma-errors.ts

import { Prisma } from '@prisma/client';

export interface ErrorResponse {
  statusCode: number;
  message: string;
  code?: string;
  field?: string;
  retryable: boolean;
}

export function handlePrismaError(error: unknown): ErrorResponse {
  // Type 1: Known Request Errors (most common)
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    
    // P2002: Unique constraint violation
    if (error.code === 'P2002') {
      const field = error.meta?.target as string[] | undefined;
      return {
        statusCode: 409,  // Conflict
        message: `A record with this ${field?.[0] || 'value'} already exists.`,
        code: 'DUPLICATE_ENTRY',
        field: field?.[0],
        retryable: false  // User error, don't retry
      };
    }
    
    // P2025: Record not found
    if (error.code === 'P2025') {
      return {
        statusCode: 404,
        message: 'The requested record was not found.',
        code: 'NOT_FOUND',
        retryable: false
      };
    }
    
    // P2003: Foreign key constraint violation
    if (error.code === 'P2003') {
      const field = error.meta?.field_name as string | undefined;
      return {
        statusCode: 400,  // Bad Request
        message: `Invalid reference: ${field} does not exist.`,
        code: 'INVALID_REFERENCE',
        field,
        retryable: false
      };
    }
    
    // P2024: Connection pool timeout
    if (error.code === 'P2024') {
      return {
        statusCode: 503,  // Service Unavailable
        message: 'Database connection pool exhausted. Please retry.',
        code: 'POOL_EXHAUSTED',
        retryable: true  // Temporary, can retry
      };
    }
    
    // P2034: Transaction failed (deadlock)
    if (error.code === 'P2034') {
      return {
        statusCode: 409,
        message: 'Transaction conflict detected. Please retry.',
        code: 'TRANSACTION_CONFLICT',
        retryable: true
      };
    }
  }
  
  // Type 2: Initialization Error (database unreachable)
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return {
      statusCode: 503,
      message: 'Database is temporarily unavailable.',
      code: 'DATABASE_UNAVAILABLE',
      retryable: true
    };
  }
  
  // Type 3: Validation Error (bad query parameters)
  if (error instanceof Prisma.PrismaClientValidationError) {
    return {
      statusCode: 400,
      message: 'Invalid request parameters.',
      code: 'VALIDATION_ERROR',
      retryable: false
    };
  }
  
  // Type 4: Unknown error
  return {
    statusCode: 500,
    message: 'An unexpected error occurred.',
    code: 'INTERNAL_ERROR',
    retryable: false
  };
}
```

**Line-by-Line:**

```typescript
if (error instanceof Prisma.PrismaClientKnownRequestError) {
│                      └─ Check error type (type guard)
└─ Known errors have .code property

  if (error.code === 'P2002') {
  │              └─ Unique constraint violation code
  └─ Each Prisma error has a specific code
  
    const field = error.meta?.target as string[] | undefined;
    │             │       └─ Contains constraint details
    │             └─ error.meta has additional info
    └─ Extract which field violated constraint
    
    return {
      statusCode: 409,
      │           └─ HTTP 409 Conflict (standard for duplicates)
      └─ Map database error to HTTP status
      
      message: `A record with this ${field?.[0] || 'value'} already exists.`,
      │         └─ User-friendly message (not raw SQL error)
      └─ Don't expose internal details to client
      
      retryable: false
      └─ Client error, retrying won't help
    };
  }
}
```

---

### Express Middleware: Global Error Handler

```typescript
// src/middleware/error-handler.ts

import { Request, Response, NextFunction } from 'express';
import { handlePrismaError } from '../utils/prisma-errors';

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Handle Prisma errors
  const errorResponse = handlePrismaError(error);
  
  // Log error for monitoring
  console.error('Error occurred:', {
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path,
    statusCode: errorResponse.statusCode,
    code: errorResponse.code,
    message: errorResponse.message,
    stack: error instanceof Error ? error.stack : undefined
  });
  
  // Send response to client
  res.status(errorResponse.statusCode).json({
    error: {
      message: errorResponse.message,
      code: errorResponse.code,
      ...(errorResponse.field && { field: errorResponse.field }),
      ...(errorResponse.retryable && { retryable: true })
    }
  });
}

// Usage in Express app
app.use(errorHandler);
```

**Client Response Examples:**

```json
// Duplicate email (P2002)
{
  "error": {
    "message": "A record with this email already exists.",
    "code": "DUPLICATE_ENTRY",
    "field": "email",
    "retryable": false
  }
}

// Pool exhausted (P2024)
{
  "error": {
    "message": "Database connection pool exhausted. Please retry.",
    "code": "POOL_EXHAUSTED",
    "retryable": true
  }
}

// Record not found (P2025)
{
  "error": {
    "message": "The requested record was not found.",
    "code": "NOT_FOUND",
    "retryable": false
  }
}
```

---

### Retry Logic: Exponential Backoff

```typescript
// src/utils/retry.ts

interface RetryOptions {
  maxRetries: number;
  initialDelay: number;  // milliseconds
  maxDelay: number;
  backoffMultiplier: number;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelay: 100,
  maxDelay: 5000,
  backoffMultiplier: 2
};

export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const config = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: unknown;
  
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await operation();
      
    } catch (error) {
      lastError = error;
      
      // Check if error is retryable
      const errorResponse = handlePrismaError(error);
      
      if (!errorResponse.retryable) {
        // Don't retry user errors (404, 400, 409 duplicates, etc.)
        throw error;
      }
      
      // Last attempt, don't sleep
      if (attempt === config.maxRetries) {
        break;
      }
      
      // Calculate delay with exponential backoff
      const delay = Math.min(
        config.initialDelay * Math.pow(config.backoffMultiplier, attempt),
        config.maxDelay
      );
      
      console.log(`Retry attempt ${attempt + 1}/${config.maxRetries} after ${delay}ms`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  // All retries exhausted
  throw lastError;
}
```

**Backoff Calculation Example:**

```
Attempt 1: 100ms * 2^0 = 100ms
Attempt 2: 100ms * 2^1 = 200ms
Attempt 3: 100ms * 2^2 = 400ms
Attempt 4: 100ms * 2^3 = 800ms
Attempt 5: 100ms * 2^4 = 1600ms
...
Max:       5000ms (capped)
```

**Usage:**

```typescript
// Wrap database operations in retry logic
async function createUserWithRetry(data: UserCreateInput) {
  return await retryWithBackoff(async () => {
    return await prisma.user.create({ data });
  }, {
    maxRetries: 3,
    initialDelay: 100
  });
}

// Handles transient errors:
// - Connection timeouts → Retries
// - Pool exhaustion → Retries
// - Deadlocks → Retries
// But NOT:
// - Duplicate emails → Fails immediately (user error)
// - Invalid data → Fails immediately
```

---

### Circuit Breaker Pattern

```typescript
// src/utils/circuit-breaker.ts

enum CircuitState {
  CLOSED = 'CLOSED',    // Normal operation
  OPEN = 'OPEN',        // Too many failures, reject requests
  HALF_OPEN = 'HALF_OPEN'  // Testing if service recovered
}

class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  private successCount: number = 0;
  
  constructor(
    private threshold: number = 5,        // Open after 5 failures
    private timeout: number = 60000,      // Try again after 60s
    private halfOpenRequests: number = 3  // Test with 3 requests
  ) {}
  
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      // Check if timeout passed
      if (Date.now() - this.lastFailureTime > this.timeout) {
        console.log('Circuit breaker: OPEN → HALF_OPEN');
        this.state = CircuitState.HALF_OPEN;
        this.successCount = 0;
      } else {
        throw new Error('Circuit breaker is OPEN. Service unavailable.');
      }
    }
    
    try {
      const result = await operation();
      
      // Success: reset failure count
      if (this.state === CircuitState.HALF_OPEN) {
        this.successCount++;
        
        if (this.successCount >= this.halfOpenRequests) {
          console.log('Circuit breaker: HALF_OPEN → CLOSED (recovered)');
          this.state = CircuitState.CLOSED;
          this.failureCount = 0;
        }
      } else if (this.state === CircuitState.CLOSED) {
        this.failureCount = 0;  // Reset on success
      }
      
      return result;
      
    } catch (error) {
      this.failureCount++;
      this.lastFailureTime = Date.now();
      
      if (this.failureCount >= this.threshold) {
        console.log('Circuit breaker: CLOSED → OPEN (too many failures)');
        this.state = CircuitState.OPEN;
      }
      
      throw error;
    }
  }
  
  getState() {
    return this.state;
  }
}

// Usage: Protect database operations
const dbCircuitBreaker = new CircuitBreaker(5, 60000);

export async function findUserWithCircuitBreaker(id: number) {
  return await dbCircuitBreaker.execute(async () => {
    return await prisma.user.findUnique({ where: { id } });
  });
}
```

**State Transitions:**

```
┌──────────────────────────────────────────────────────────┐
│            CIRCUIT BREAKER STATE MACHINE                  │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  CLOSED (Normal)                                         │
│  ┌────────────────────┐                                 │
│  │ All requests pass  │                                 │
│  │ Failures counted   │                                 │
│  └────────┬───────────┘                                 │
│           │                                              │
│           │ 5+ failures                                  │
│           ↓                                              │
│  OPEN (Fail Fast)                                        │
│  ┌────────────────────┐                                 │
│  │ Reject immediately │                                 │
│  │ Wait 60 seconds    │                                 │
│  └────────┬───────────┘                                 │
│           │                                              │
│           │ Timeout passed                               │
│           ↓                                              │
│  HALF_OPEN (Testing)                                     │
│  ┌────────────────────┐                                 │
│  │ Allow 3 test reqs  │                                 │
│  └───┬────────────┬───┘                                 │
│      │            │                                      │
│      │ 3 success  │ Any failure                         │
│      ↓            ↓                                      │
│   CLOSED        OPEN                                     │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

## 🏗️ SECTION 3: ARCHITECTURE & FLOW DIAGRAMS

### Error Handling Flow

```
┌──────────────────────────────────────────────────────────┐
│         REQUEST → ERROR → RESPONSE FLOW                   │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  1. Client Request                                       │
│     POST /api/users { email: "john@example.com" }       │
│     ↓                                                    │
│  2. Controller                                           │
│     try {                                                │
│       await userService.createUser(data);                │
│     } catch (error) {                                    │
│       next(error);  // Pass to error handler            │
│     }                                                    │
│     ↓                                                    │
│  3. Prisma Query                                         │
│     prisma.user.create({ data: { email: "john@..." } }) │
│     ↓                                                    │
│  4. Database Error                                       │
│     ERROR: duplicate key value violates unique "email"  │
│     ↓                                                    │
│  5. Prisma Wraps Error                                   │
│     PrismaClientKnownRequestError { code: 'P2002' }     │
│     ↓                                                    │
│  6. Error Handler Middleware                             │
│     handlePrismaError(error)                            │
│     → statusCode: 409                                    │
│     → message: "Email already exists"                   │
│     ↓                                                    │
│  7. Client Response                                      │
│     {                                                    │
│       "error": {                                         │
│         "message": "Email already exists",              │
│         "code": "DUPLICATE_ENTRY",                      │
│         "field": "email"                                 │
│       }                                                  │
│     }                                                    │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

## 🎯 SECTION 4: PRACTICAL EXAMPLES & INTERVIEW PREP

### Example 1: Repository with Error Handling

```typescript
// src/repositories/user.repository.ts

import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { retryWithBackoff } from '../utils/retry';

export class UserRepository {
  async create(data: Prisma.UserCreateInput) {
    try {
      return await retryWithBackoff(async () => {
        return await prisma.user.create({ data });
      });
      
    } catch (error) {
      // Check specific error
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new Error(`User with email ${data.email} already exists.`);
        }
      }
      
      throw error;  // Re-throw unknown errors
    }
  }
  
  async findById(id: number) {
    const user = await prisma.user.findUnique({
      where: { id }
    });
    
    if (!user) {
      throw new Error(`User with id ${id} not found.`);
    }
    
    return user;
  }
  
  async update(id: number, data: Prisma.UserUpdateInput) {
    try {
      return await prisma.user.update({
        where: { id },
        data
      });
      
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        // P2025: Record not found
        if (error.code === 'P2025') {
          throw new Error(`User with id ${id} not found.`);
        }
        
        // P2002: Unique constraint (e.g., email)
        if (error.code === 'P2002') {
          const field = (error.meta?.target as string[])?.[0];
          throw new Error(`User with this ${field} already exists.`);
        }
      }
      
      throw error;
    }
  }
}
```

---

### Example 2: Health Check with Database

```typescript
// src/routes/health.ts

import { Router } from 'express';
import { prisma } from '../config/database';

const router = Router();

router.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    checks: {
      database: 'unknown'
    }
  };
  
  try {
    // Quick database check
    await prisma.$queryRaw`SELECT 1`;
    health.checks.database = 'healthy';
    
    res.status(200).json(health);
    
  } catch (error) {
    health.status = 'unhealthy';
    health.checks.database = 'unhealthy';
    
    res.status(503).json({
      ...health,
      error: error instanceof Error ? error.message : 'Database check failed'
    });
  }
});

router.get('/health/deep', async (req, res) => {
  const checks = {
    database: { status: 'unknown', latency: 0 },
    poolConnections: { active: 0, idle: 0 },
    queryTest: { status: 'unknown' }
  };
  
  try {
    // 1. Connection check
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    checks.database.latency = Date.now() - start;
    checks.database.status = 'healthy';
    
    // 2. Pool status (if metrics available)
    try {
      const metrics = await prisma.$metrics.json();
      checks.poolConnections.active = metrics.counters.find(
        (c: any) => c.key === 'prisma_pool_connections_busy'
      )?.value || 0;
    } catch (e) {
      // Metrics not available, skip
    }
    
    // 3. Query test
    const userCount = await prisma.user.count();
    checks.queryTest.status = 'healthy';
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      checks
    });
    
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      checks,
      error: error instanceof Error ? error.message : 'Health check failed'
    });
  }
});

export default router;
```

---

## 🎙️ INTERVIEW QUESTIONS

### 1. **Q:** How do you handle Prisma errors in production?

**A:**
**Multi-layered approach:**

**1. Type-Safe Error Checking:**
```typescript
if (error instanceof Prisma.PrismaClientKnownRequestError) {
  if (error.code === 'P2002') {
    // Handle unique constraint violation
  }
}
```

**2. User-Friendly Messages:**
```typescript
// ❌ Don't expose: "duplicate key value violates unique constraint"
// ✅ Do expose: "Email already exists"
```

**3. Appropriate HTTP Status Codes:**
- 400: Bad Request (validation errors)
- 404: Not Found (P2025)
- 409: Conflict (P2002 - duplicates)
- 503: Service Unavailable (connection errors)
- 500: Internal Server Error (unknown errors)

**4. Logging:**
```typescript
console.error('Database error:', {
  code: error.code,
  message: error.message,
  stack: error.stack,
  userId: req.user?.id,
  path: req.path
});
```

**5. Monitoring:**
- Track error rates by type (P2002, P2025, etc.)
- Alert on connection errors (P2024)
- Alert on query errors (unexpected failures)

### 2. **Q:** Explain the difference between retryable and non-retryable errors.

**A:**
**Retryable Errors (Transient):**
- **Cause**: Temporary issues (network blip, pool exhaustion, deadlock)
- **Action**: Retry with exponential backoff
- **Examples**:
  - P2024: Connection pool timeout
  - P2034: Transaction conflict (deadlock)
  - Connection timeout
  - Database temporarily unavailable

**Non-Retryable Errors (Permanent):**
- **Cause**: User error or data issue
- **Action**: Return error to client immediately
- **Examples**:
  - P2002: Unique constraint (duplicate email)
  - P2003: Foreign key violation (invalid reference)
  - P2025: Record not found
  - Validation errors

**Decision Logic:**
```typescript
function isRetryable(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const retryableCodes = ['P2024', 'P2034'];
    return retryableCodes.includes(error.code);
  }
  
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return true;  // Connection errors are retryable
  }
  
  return false;  // Default: don't retry
}
```

### 3. **Q:** What is exponential backoff and why is it important?

**A:**
**Exponential backoff** increases delay between retries exponentially.

**Formula:**
```
delay = initialDelay * (backoffMultiplier ^ attempt)
```

**Example:**
```
Attempt 1: 100ms
Attempt 2: 200ms (100 * 2^1)
Attempt 3: 400ms (100 * 2^2)
Attempt 4: 800ms (100 * 2^3)
```

**Why Important:**

1. **Prevents Thundering Herd:**
   - Without backoff: 1000 clients retry immediately → overwhelm database
   - With backoff: Retries spread over time → database recovers

2. **Gives Service Time to Recover:**
   - Database overload needs time to clear queue
   - Immediate retries just add more load

3. **Reduces Wasted Resources:**
   - Fewer total retry attempts needed
   - Less CPU/network consumed

**Real-World Scenario:**
```
Database pool exhausted (10 connections busy)
- Without backoff: 100 requests retry every 1s → 100 requests/s load
- With backoff: Retries spread over 1s, 2s, 4s → Load decreases over time
- Result: Database recovers, requests succeed
```

### 4. **Q:** Explain the Circuit Breaker pattern and when to use it.

**A:**
**Circuit Breaker** protects your system from cascading failures.

**How It Works:**
1. **CLOSED (Normal)**: All requests go through, failures counted
2. **OPEN (Fail Fast)**: After threshold (e.g., 5 failures), reject immediately
3. **HALF_OPEN (Testing)**: After timeout (e.g., 60s), allow test requests
4. **Back to CLOSED**: If tests succeed, resume normal operation

**Benefits:**
- ✅ **Prevents cascading failures**: Fails fast instead of waiting for timeout
- ✅ **Gives service time to recover**: No new requests during open state
- ✅ **Better UX**: Immediate error (50ms) vs timeout (30s)

**When to Use:**
- ✅ **External services**: Database, APIs, microservices
- ✅ **High-latency operations**: Queries that can hang
- ✅ **Critical paths**: Operations that impact availability

**When NOT to Use:**
- ❌ **Fast operations**: No benefit for 10ms queries
- ❌ **User-specific errors**: Circuit breaker is shared across all users

**Implementation:**
```typescript
const breaker = new CircuitBreaker(5, 60000);

async function getUser(id: number) {
  return await breaker.execute(async () => {
    return await prisma.user.findUnique({ where: { id } });
  });
}
```

### 5. **Q:** How do you test error handling in your application?

**A:**
**Multi-level Testing Strategy:**

**1. Unit Tests: Mock Prisma Errors**
```typescript
import { Prisma } from '@prisma/client';

test('handles duplicate email error', async () => {
  const mockError = new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed',
    { code: 'P2002', clientVersion: '5.0.0', meta: { target: ['email'] } }
  );
  
  jest.spyOn(prisma.user, 'create').mockRejectedValue(mockError);
  
  await expect(userService.create({ email: 'test@example.com' }))
    .rejects
    .toThrow('Email already exists');
});
```

**2. Integration Tests: Real Database**
```typescript
test('duplicate email returns 409', async () => {
  // Create first user
  await request(app)
    .post('/api/users')
    .send({ email: 'duplicate@example.com' });
  
  // Try to create duplicate
  const response = await request(app)
    .post('/api/users')
    .send({ email: 'duplicate@example.com' });
  
  expect(response.status).toBe(409);
  expect(response.body.error.code).toBe('DUPLICATE_ENTRY');
});
```

**3. Chaos Engineering: Inject Failures**
```typescript
// Test retry logic by killing database mid-request
test('retries on connection failure', async () => {
  let attempts = 0;
  
  jest.spyOn(prisma, '$queryRaw').mockImplementation(async () => {
    attempts++;
    if (attempts < 3) {
      throw new Prisma.PrismaClientInitializationError('Connection failed', '5.0.0');
    }
    return [{ count: 1 }];
  });
  
  const result = await retryWithBackoff(() => prisma.$queryRaw`SELECT 1`);
  
  expect(attempts).toBe(3);  // Retried 2 times before success
});
```

**4. Load Testing: Simulate Pool Exhaustion**
```bash
# Simulate 100 concurrent requests
ab -n 1000 -c 100 http://localhost:3000/api/users

# Monitor for P2024 errors (pool timeout)
# Verify circuit breaker opens after threshold
```

---

## ✅ MODULE COMPLETION CHECKLIST

- ✅ Theory: Database error categories and types
- ✅ Prisma error codes (P2002, P2025, P2024, P2034)
- ✅ Type-safe error handling with typed error classes
- ✅ User-friendly error messages and HTTP status codes
- ✅ Retry logic with exponential backoff
- ✅ Circuit breaker pattern for resilience
- ✅ Global error handler middleware
- ✅ Health check endpoints
- ✅ Testing error handling
- ✅ Interview questions with comprehensive answers

---

**Next:** [M21-PART4: Advanced Production Patterns](M21-PRISMA-DEEP-DIVE-PART4.md)  
**Previous:** [M21-PART2: Query Optimization & Monitoring](M21-PRISMA-DEEP-DIVE-PART2.md)

---

**Last Updated:** 2026-08-12  
**Module Length:** ~620 lines  
**Status:** ✅ Ready for Learning
