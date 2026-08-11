# M10: Circuit Breaker Deep Dive

**File:** `services/api-gateway/src/lib/CircuitBreaker.ts` (200 lines)  
**Level:** Resiliency Patterns  
**Prerequisites:** M01 (Logger), M09 (API Gateway), Promise patterns  
**Time to Master:** 3-4 hours

---

## 📖 SECTION 1: THEORY - Circuit Breaker Pattern

### 1.1 What is a Circuit Breaker?

**Circuit Breaker** = Prevents cascading failures by stopping requests to a failing service.

**Real-World Analogy:**

Think of an **electrical circuit breaker** in your home:

**Normal Operation (Circuit CLOSED):**
```
Power → Circuit Breaker → Appliance
✅ Electricity flows normally
```

**Overload Detected (Circuit OPEN):**
```
Power → Circuit Breaker 🔴 X Appliance
❌ Circuit breaker trips, stops electricity
Protects house from fire
```

**Testing (Circuit HALF-OPEN):**
```
Power → Circuit Breaker ⚠️ → Appliance
⚠️ Test if safe to resume
```

### 1.2 The Problem: Cascading Failures

**Without Circuit Breaker:**

```
┌─────────────┐
│ API Gateway │
└──────┬──────┘
       │ 100 req/s
       ↓
┌─────────────────┐
│ Product Service │  ← Service crashes
│   (Down! ❌)    │
└─────────────────┘

Problems:
1. Every request waits for timeout (5s)
2. Gateway threads blocked (100 threads × 5s)
3. Gateway runs out of resources
4. Gateway crashes too! ❌
5. Cascading failure affects ALL services
```

**Timeline without Circuit Breaker:**

```
T+0s:  Product Service crashes
       API Gateway: "Service down? Let me retry..."
       
T+5s:  First 100 requests timeout
       API Gateway: "All threads blocked waiting..."
       
T+10s: Next 100 requests timeout
       API Gateway: Memory exhausted ❌
       
T+15s: API Gateway crashes
       All services unreachable! 💥
```

**With Circuit Breaker:**

```
┌─────────────┐
│ API Gateway │
└──────┬──────┘
       │
       ↓
┌─────────────┐
│   Circuit   │  ← Detects failures
│   Breaker   │     Opens circuit
│  (OPEN 🔴)  │     Fails fast
└──────┬──────┘
       │
       X  Requests blocked immediately
       
Product Service still down, but:
✅ Gateway doesn't waste resources
✅ Fails fast (1ms not 5s)
✅ Other services work normally
✅ System remains stable
```

**Timeline with Circuit Breaker:**

```
T+0s:  Product Service crashes
       
T+1s:  Circuit Breaker detects 5 failures
       Opens circuit 🔴
       
T+1s-30s: All requests fail immediately (1ms)
          "Circuit breaker OPEN"
          ✅ Gateway stays healthy
          
T+30s: Circuit tries HALF-OPEN ⚠️
       Allows 1 test request
       
If success: Close circuit ✅
If fail: Open circuit again 🔴
```

### 1.3 Circuit Breaker States

**Three states:**

```
        ┌─────────────────┐
        │     CLOSED      │  ← Normal operation
        │   (Healthy)     │     All requests pass through
        └────────┬────────┘
                 │
         5 failures detected
                 │
                 ↓
        ┌─────────────────┐
        │      OPEN       │  ← Service failing
        │   (Blocking)    │     All requests rejected
        └────────┬────────┘
                 │
         30s timeout expires
                 │
                 ↓
        ┌─────────────────┐
        │   HALF_OPEN     │  ← Testing recovery
        │   (Testing)     │     Allow test requests
        └────────┬────────┘
                 │
        2 successes?     Failure?
                 │            │
         ┌───────┴─────┐      │
         │             │      │
         ↓             ↓      ↓
      CLOSED       Back to OPEN
```

**State Details:**

**1. CLOSED (Normal)**

```typescript
// Service healthy
// All requests pass through
// Track failure rate

Request → Circuit Breaker (CLOSED) → Service → Response ✅

// If 5 failures out of 10 requests:
// → Transition to OPEN
```

**2. OPEN (Blocking)**

```typescript
// Service failing
// Reject all requests immediately
// Wait for resetTimeout (30s)

Request → Circuit Breaker (OPEN) → ❌ Error: Circuit breaker OPEN

// After 30 seconds:
// → Transition to HALF_OPEN
```

**3. HALF_OPEN (Testing)**

```typescript
// Testing if service recovered
// Allow limited requests through
// If 2 successes: → CLOSED
// If 1 failure: → OPEN

Request 1 → Circuit Breaker (HALF_OPEN) → Service → ✅ Success (1/2)
Request 2 → Circuit Breaker (HALF_OPEN) → Service → ✅ Success (2/2)
// → Transition to CLOSED (service recovered)

OR

Request 1 → Circuit Breaker (HALF_OPEN) → Service → ❌ Failure
// → Transition back to OPEN (still failing)
```

### 1.4 Key Parameters

**1. failureThreshold (default: 5)**

```typescript
// How many failures before opening circuit?

failureThreshold: 5
// After 5 consecutive failures → OPEN

// Low threshold (2-3):
// - Opens quickly (more sensitive)
// - May open on temporary glitches
// - Use for critical services

// High threshold (10-20):
// - Slower to open (more tolerant)
// - Gives service time to recover
// - Use for non-critical services
```

**2. successThreshold (default: 2)**

```typescript
// How many successes to close circuit?

successThreshold: 2
// In HALF_OPEN state:
// - 2 successful requests → CLOSED

// Low threshold (1-2):
// - Closes quickly (aggressive recovery)
// - May close too early (flapping)

// High threshold (5-10):
// - More confident recovery
// - Takes longer to recover
```

**3. timeout (default: 3000ms)**

```typescript
// How long to wait for request?

timeout: 3000  // 3 seconds
// If request takes >3s → Treat as failure

// Short timeout (1-2s):
// - Fail fast
// - Better for real-time APIs

// Long timeout (5-10s):
// - Tolerate slow responses
// - Better for batch operations
```

**4. resetTimeout (default: 30000ms)**

```typescript
// How long circuit stays OPEN?

resetTimeout: 30000  // 30 seconds
// After opening, wait 30s before trying HALF_OPEN

// Short reset (10-15s):
// - Quick recovery attempts
// - More load on failing service

// Long reset (60-120s):
// - Give service time to recover
// - Less load on failing service
```

**5. volumeThreshold (default: 10)**

```typescript
// Minimum requests before opening circuit

volumeThreshold: 10
// Need at least 10 requests before checking failure rate

// Why needed?
// Prevents opening on startup:
// - Service starts
// - First request fails (cold start)
// - Circuit opens? ❌ Too early!

// With volume threshold:
// - Wait for 10 requests
// - Then check failure rate ✅
```

### 1.5 When to Use Circuit Breaker

**✅ Use Circuit Breaker When:**

**1. Calling external services**

```typescript
// External API call
const circuitBreaker = new CircuitBreaker('payment-api');
await circuitBreaker.execute(() => 
  axios.post('https://api.stripe.com/charges', ...)
);

// If Stripe down:
// - Circuit opens
// - Don't waste time on failed requests
// - System remains responsive ✅
```

**2. Microservice communication**

```typescript
// Service-to-service call
const productBreaker = new CircuitBreaker('product-service');
await productBreaker.execute(() =>
  axios.get('http://product-service/products/123')
);

// If Product Service down:
// - Circuit opens
// - Gateway doesn't crash
// - Other services work ✅
```

**3. Database calls (with caution)**

```typescript
// Read-heavy database
const replicaBreaker = new CircuitBreaker('db-replica');
await replicaBreaker.execute(() =>
  db.replica.query('SELECT * FROM products')
);

// If replica down:
// - Circuit opens
// - Fallback to primary ✅
```

**❌ Don't Use Circuit Breaker When:**

**1. User authentication**

```typescript
// ❌ BAD: Circuit breaker on auth
const authBreaker = new CircuitBreaker('auth');
await authBreaker.execute(() => verifyToken(token));

// Problem:
// - Auth fails 5 times (wrong tokens)
// - Circuit opens
// - All users blocked! ❌
// - Including users with valid tokens

// ✅ Better: No circuit breaker, rate limiting instead
```

**2. Database writes (critical)**

```typescript
// ❌ BAD: Circuit breaker on order creation
const orderBreaker = new CircuitBreaker('create-order');
await orderBreaker.execute(() =>
  db.query('INSERT INTO orders ...')
);

// Problem:
// - Circuit opens
// - Orders lost! ❌
// - Data inconsistency

// ✅ Better: Retry with exponential backoff, queue for later
```

**3. Low-traffic endpoints**

```typescript
// ❌ BAD: Circuit breaker on admin endpoint (1 req/day)
const adminBreaker = new CircuitBreaker('admin');
await adminBreaker.execute(() => generateReport());

// Problem:
// - volumeThreshold = 10
// - Admin endpoint gets 1 req/day
// - Never reaches threshold
// - Circuit breaker useless

// ✅ Better: Simple try/catch, manual intervention
```

### 1.6 Circuit Breaker vs Other Patterns

**Circuit Breaker vs Retry:**

```typescript
// Retry: Keep trying
try {
  await fetch('...');
} catch (error) {
  await delay(1000);
  await fetch('...');  // Try again
  await delay(2000);
  await fetch('...');  // Try again
  // ... 10 retries later ...
}
// Problem: Wastes resources on failing service ❌

// Circuit Breaker: Stop trying
if (circuitBreaker.isOpen()) {
  throw new Error('Service down');  // Fail fast
}
// Benefit: Don't waste resources ✅
```

**Circuit Breaker vs Timeout:**

```typescript
// Timeout: Per-request protection
await axios.get('...', { timeout: 5000 });
// Waits 5s every request
// If service slow: Still waits 5s × N requests ❌

// Circuit Breaker: Aggregate protection
// After 5 failures:
// → Circuit opens
// → All requests fail in 1ms ✅
```

**Circuit Breaker vs Bulkhead:**

```typescript
// Bulkhead: Isolate resources
const pool1 = new Pool({ max: 10 });  // 10 connections for Service A
const pool2 = new Pool({ max: 10 });  // 10 connections for Service B
// If Service A slow: Only uses pool1, pool2 unaffected ✅

// Circuit Breaker: Stop sending requests
// If Service A slow: Circuit opens, stop all requests ✅

// Use together:
// Bulkhead: Prevents resource exhaustion
// Circuit Breaker: Prevents cascading failures
```

**Comprehensive Protection:**

```typescript
// All patterns together
const result = await bulkhead.execute(async () => {  // Isolate resources
  return circuitBreaker.execute(async () => {        // Stop if failing
    return retry(async () => {                       // Retry transient errors
      return axios.get('...', { timeout: 5000 });    // Timeout per request
    });
  });
});
```

---

## 🔍 SECTION 2: LINE-BY-LINE CODE ANALYSIS

### 2.1 Imports and Types (Lines 1-22)

```typescript
import { EventEmitter } from 'events';
import logger from '../../../../shared/logger';

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerOptions {
  failureThreshold?: number;
  successThreshold?: number;
  timeout?: number;
  resetTimeout?: number;
  volumeThreshold?: number;
}

interface CircuitBreakerStats {
  totalRequests: number;
  totalFailures: number;
  totalSuccesses: number;
  totalTimeouts: number;
  totalRejections: number;
  lastError: string | null;
}
```

#### Line 1: EventEmitter

```typescript
import { EventEmitter } from 'events';
```

**EventEmitter** = Node.js built-in for event-driven programming.

**Why EventEmitter?**

```typescript
// Circuit breaker emits events for monitoring
circuitBreaker.on('open', (data) => {
  // Alert oncall: Service down!
  alertOncall(`Circuit opened for ${data.service}`);
});

circuitBreaker.on('close', (data) => {
  // Service recovered
  logger.info(`Service ${data.service} recovered`);
});

// Events:
// - 'open': Circuit opened (service failing)
// - 'close': Circuit closed (service recovered)
// - 'halfOpen': Circuit testing recovery
```

**EventEmitter API:**

```typescript
class MyEmitter extends EventEmitter {}

const emitter = new MyEmitter();

// Listen for event
emitter.on('eventName', (data) => {
  console.log('Event received:', data);
});

// Emit event
emitter.emit('eventName', { foo: 'bar' });
// → Logs: Event received: { foo: 'bar' }
```

#### Line 4: CircuitState Type

```typescript
type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
```

**Union type** = One of three string literals.

**TypeScript enforcement:**

```typescript
let state: CircuitState;

state = 'CLOSED';      // ✅ Valid
state = 'OPEN';        // ✅ Valid
state = 'HALF_OPEN';   // ✅ Valid
state = 'HALF-OPEN';   // ❌ TypeScript error (typo caught!)
state = 'open';        // ❌ TypeScript error (case matters)
```

#### Lines 6-12: Options Interface

```typescript
interface CircuitBreakerOptions {
  failureThreshold?: number;
  successThreshold?: number;
  timeout?: number;
  resetTimeout?: number;
  volumeThreshold?: number;
}
```

**All fields optional** (`?`):

```typescript
// Can create with no options
new CircuitBreaker('service');

// Or customize some options
new CircuitBreaker('service', {
  failureThreshold: 10,
  timeout: 5000
});

// Or customize all options
new CircuitBreaker('service', {
  failureThreshold: 10,
  successThreshold: 3,
  timeout: 5000,
  resetTimeout: 60000,
  volumeThreshold: 20
});
```

#### Lines 14-21: Stats Interface

```typescript
interface CircuitBreakerStats {
  totalRequests: number;
  totalFailures: number;
  totalSuccesses: number;
  totalTimeouts: number;
  totalRejections: number;
  lastError: string | null;
}
```

**Metrics for monitoring:**

```typescript
const stats = circuitBreaker.getStats();
// {
//   totalRequests: 1000,
//   totalFailures: 50,      (5% failure rate)
//   totalSuccesses: 950,
//   totalTimeouts: 10,      (1% timeout)
//   totalRejections: 200,   (Circuit was open)
//   lastError: 'ECONNREFUSED'
// }

// Use for:
// - Dashboards (Grafana)
// - Alerting (if failure rate > 10%)
// - Debugging (what was last error?)
```

### 2.2 Class Declaration and Constructor (Lines 23-52)

```typescript
export class CircuitBreaker extends EventEmitter {
  private serviceName: string;
  private state: CircuitState = 'CLOSED';
  private failureThreshold: number;
  private successThreshold: number;
  private timeout: number;
  private resetTimeout: number;
  private volumeThreshold: number;
  private failures = 0;
  private successes = 0;
  private requestCount = 0;
  private nextAttempt = Date.now();
  private stats: CircuitBreakerStats = {
    totalRequests: 0,
    totalFailures: 0,
    totalSuccesses: 0,
    totalTimeouts: 0,
    totalRejections: 0,
    lastError: null
  };

  constructor(serviceName: string, options: CircuitBreakerOptions = {}) {
    super();
    this.serviceName = serviceName;
    this.failureThreshold = options.failureThreshold || 5;
    this.successThreshold = options.successThreshold || 2;
    this.timeout = options.timeout || 3000;
    this.resetTimeout = options.resetTimeout || 30000;
    this.volumeThreshold = options.volumeThreshold || 10;
  }
}
```

#### Line 23: Extends EventEmitter

```typescript
export class CircuitBreaker extends EventEmitter {
```

**Inheritance:**

```typescript
// CircuitBreaker gains EventEmitter methods:
circuitBreaker.on('open', callback);    // From EventEmitter
circuitBreaker.emit('open', data);      // From EventEmitter
circuitBreaker.execute(fn);             // CircuitBreaker method
```

#### Lines 24-42: Private Fields

```typescript
private serviceName: string;
private state: CircuitState = 'CLOSED';
```

**serviceName:** Identifies which service (for logging).

**state:** Current circuit state (CLOSED by default).

```typescript
private failures = 0;
private successes = 0;
private requestCount = 0;
```

**failures:** Consecutive failures (reset on success).  
**successes:** Consecutive successes in HALF_OPEN state.  
**requestCount:** Total requests in current window.

**Why track both failures and requestCount?**

```typescript
// Need volumeThreshold requests before opening circuit
// Example:
volumeThreshold = 10
failureThreshold = 5

// Scenario 1: Low volume
requestCount = 3
failures = 3  (100% failure rate)
// → Don't open (need 10 requests) ✅

// Scenario 2: High volume
requestCount = 10
failures = 5  (50% failure rate)
// → Open circuit ✅
```

```typescript
private nextAttempt = Date.now();
```

**nextAttempt:** Timestamp when to try HALF_OPEN.

```typescript
// Circuit opens at T+0s
this.nextAttempt = Date.now() + 30000;  // T+30s

// Request at T+10s:
if (Date.now() < this.nextAttempt) {
  // 10s < 30s → Still OPEN, reject ❌
}

// Request at T+35s:
if (Date.now() < this.nextAttempt) {
  // 35s < 30s → False, try HALF_OPEN ✅
}
```

#### Lines 44-52: Constructor

```typescript
constructor(serviceName: string, options: CircuitBreakerOptions = {}) {
  super();
  this.serviceName = serviceName;
  this.failureThreshold = options.failureThreshold || 5;
  this.successThreshold = options.successThreshold || 2;
  this.timeout = options.timeout || 3000;
  this.resetTimeout = options.resetTimeout || 30000;
  this.volumeThreshold = options.volumeThreshold || 10;
}
```

**Line 45: super()**

```typescript
super();
```

**Calls EventEmitter constructor** (required for inheritance).

**Lines 47-51: Default Values**

```typescript
this.failureThreshold = options.failureThreshold || 5;
```

**Default pattern:**

```typescript
// If option provided: Use it
options.failureThreshold = 10
→ this.failureThreshold = 10

// If not provided: Use default
options.failureThreshold = undefined
→ this.failureThreshold = 5
```

### 2.3 Execute Method (Lines 54-92)

```typescript
async execute<T>(fn: () => Promise<T>, fallback?: (() => Promise<T>) | null): Promise<T> {
  this.stats.totalRequests++;
  this.requestCount++;

  if (this.state === 'OPEN') {
    if (Date.now() < this.nextAttempt) {
      this.stats.totalRejections++;
      const error = new Error(`Circuit breaker OPEN for ${this.serviceName}`) as Error & { code: string };
      error.code = 'CIRCUIT_OPEN';

      if (fallback) {
        logger.warn('Circuit breaker OPEN, using fallback', {
          service: this.serviceName,
          nextAttempt: new Date(this.nextAttempt).toISOString()
        });
        return await fallback();
      }
      throw error;
    }

    this.state = 'HALF_OPEN';
    this.successes = 0;
    this.emit('halfOpen', { service: this.serviceName });
    logger.info(`Circuit breaker HALF_OPEN for ${this.serviceName}`);
  }

  try {
    const result = await this._executeWithTimeout(fn, this.timeout);
    this._onSuccess();
    return result;
  } catch (error: any) {
    this._onFailure(error);
    if (fallback) {
      logger.warn('Request failed, using fallback', { service: this.serviceName, error: error.message });
      return await fallback();
    }
    throw error;
  }
}
```

**Purpose:** Execute function with circuit breaker protection.

**Signature:**

```typescript
async execute<T>(
  fn: () => Promise<T>,           // Function to execute
  fallback?: (() => Promise<T>)   // Optional fallback function
): Promise<T>
```

**Generic `<T>`:**

```typescript
// Return type matches function return type
const product: Product = await circuitBreaker.execute(
  () => getProduct(123)  // Returns Promise<Product>
);  // execute() returns Promise<Product>

const order: Order = await circuitBreaker.execute(
  () => getOrder(456)  // Returns Promise<Order>
);  // execute() returns Promise<Order>
```

#### Lines 55-56: Track Metrics

```typescript
this.stats.totalRequests++;
this.requestCount++;
```

**Two counters:**

```typescript
// stats.totalRequests: Lifetime total (never reset)
// For metrics: "Circuit breaker has seen 10,000 requests total"

// requestCount: Current window (reset when circuit closes)
// For logic: "Have we seen enough requests to open circuit?"
```

#### Lines 58-78: Handle OPEN State

```typescript
if (this.state === 'OPEN') {
  if (Date.now() < this.nextAttempt) {
    // Still in timeout period → Reject
    this.stats.totalRejections++;
    const error = new Error(`Circuit breaker OPEN for ${this.serviceName}`);
    error.code = 'CIRCUIT_OPEN';

    if (fallback) {
      return await fallback();  // Use fallback if provided
    }
    throw error;  // No fallback, throw error
  }

  // Timeout period over → Try HALF_OPEN
  this.state = 'HALF_OPEN';
  this.successes = 0;
  this.emit('halfOpen', { service: this.serviceName });
  logger.info(`Circuit breaker HALF_OPEN for ${this.serviceName}`);
}
```

**State machine logic:**

```
OPEN + Time < nextAttempt
  → Reject immediately (with fallback if available)

OPEN + Time >= nextAttempt
  → Transition to HALF_OPEN
  → Allow request through (test recovery)
```

**Lines 61-63: Add Error Code**

```typescript
const error = new Error(`Circuit breaker OPEN for ${this.serviceName}`) as Error & { code: string };
error.code = 'CIRCUIT_OPEN';
```

**Why add `code` property?**

```typescript
// Error handling can distinguish circuit breaker errors
try {
  await circuitBreaker.execute(...);
} catch (error) {
  if (error.code === 'CIRCUIT_OPEN') {
    // Circuit breaker rejected
    // Use cached data
    return cachedData;
  } else {
    // Real error (network, timeout, etc.)
    throw error;
  }
}
```

**Type assertion:**

```typescript
as Error & { code: string }
```

**Tells TypeScript:**

```typescript
// Error type has both:
error.message  // From Error
error.code     // Added property
```

**Lines 64-70: Fallback Logic**

```typescript
if (fallback) {
  logger.warn('Circuit breaker OPEN, using fallback', {
    service: this.serviceName,
    nextAttempt: new Date(this.nextAttempt).toISOString()
  });
  return await fallback();
}
```

**Fallback pattern:**

```typescript
// Get product from service (or fallback to cached)
const product = await circuitBreaker.execute(
  // Primary: Call service
  () => axios.get('http://product-service/products/123'),
  
  // Fallback: Return cached data
  async () => {
    const cached = await redis.get('product:123');
    return JSON.parse(cached);
  }
);

// If circuit OPEN:
// 1. Don't call service (circuit OPEN)
// 2. Use fallback (return cached data)
// 3. User gets stale data (better than error) ✅
```

**Common fallback strategies:**

```typescript
// 1. Cached data
fallback: () => redis.get('product:123')

// 2. Default values
fallback: () => Promise.resolve({ id: 123, name: 'Unknown' })

// 3. Alternative service
fallback: () => axios.get('http://backup-service/products/123')

// 4. Degraded response
fallback: () => Promise.resolve({ 
  error: 'Service unavailable',
  retryAfter: 30 
})
```

#### Lines 74-77: Transition to HALF_OPEN

```typescript
this.state = 'HALF_OPEN';
this.successes = 0;
this.emit('halfOpen', { service: this.serviceName });
logger.info(`Circuit breaker HALF_OPEN for ${this.serviceName}`);
```

**Reset successes counter:**

```typescript
this.successes = 0;
// Start counting from 0
// Need successThreshold (2) successes to close
```

**Emit event:**

```typescript
this.emit('halfOpen', { service: this.serviceName });

// Monitoring code:
circuitBreaker.on('halfOpen', (data) => {
  logger.info(`Testing recovery for ${data.service}`);
  // Could notify: "Service may be recovering"
});
```

#### Lines 80-92: Execute Request

```typescript
try {
  const result = await this._executeWithTimeout(fn, this.timeout);
  this._onSuccess();
  return result;
} catch (error: any) {
  this._onFailure(error);
  if (fallback) {
    logger.warn('Request failed, using fallback', { service: this.serviceName, error: error.message });
    return await fallback();
  }
  throw error;
}
```

**Success path:**

```
Execute with timeout
  ↓
Success
  ↓
_onSuccess()
  - Increment success counter
  - If HALF_OPEN + enough successes → CLOSED
  ↓
Return result ✅
```

**Failure path:**

```
Execute with timeout
  ↓
Failure (or timeout)
  ↓
_onFailure()
  - Increment failure counter
  - If enough failures → OPEN
  ↓
Fallback available?
  Yes → Return fallback result ✅
  No → Throw error ❌
```

### 2.4 Execute With Timeout (Lines 94-105)

```typescript
private _executeWithTimeout<T>(fn: () => Promise<T>, timeout: number): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        const error = new Error('Request timeout') as Error & { code: string };
        error.code = 'ETIMEDOUT';
        reject(error);
      }, timeout);
    })
  ]);
}
```

**Purpose:** Execute function with timeout.

**Promise.race:**

```typescript
Promise.race([
  promise1,
  promise2
])
// Returns whichever resolves/rejects first
```

**How it works:**

```typescript
// Race between:
// 1. Actual function
fn()

// 2. Timeout promise
new Promise((_, reject) => {
  setTimeout(() => reject(error), timeout);
})

// Scenario 1: Function completes in 2s (timeout 3s)
// → fn() wins race → Success ✅

// Scenario 2: Function takes 5s (timeout 3s)
// → Timeout wins race → Reject with ETIMEDOUT ❌
```

**Visual timeline:**

```
T+0s:  Start both promises
       Promise 1: fn() executing...
       Promise 2: setTimeout(3000) waiting...

T+2s:  fn() completes
       → Race winner: fn() ✅
       → Return result
       → setTimeout still pending (but ignored)

OR

T+3s:  setTimeout fires
       → Race winner: Timeout ❌
       → Reject with ETIMEDOUT
       → fn() still running (but result ignored)
```

**Lines 98-102: Timeout Promise**

```typescript
new Promise<never>((_, reject) => {
  setTimeout(() => {
    const error = new Error('Request timeout') as Error & { code: string };
    error.code = 'ETIMEDOUT';
    reject(error);
  }, timeout);
})
```

**`Promise<never>`:**

```typescript
// Promise that always rejects (never resolves)
// TypeScript knows: This promise can't return a value

// vs Promise<T>:
new Promise<Product>((resolve) => ...)  // Can resolve with Product
new Promise<never>((_, reject) => ...)  // Can only reject
```

**ETIMEDOUT code:**

```typescript
error.code = 'ETIMEDOUT'
// Standard Node.js error code for timeouts
// Same code as network timeouts (axios, fetch)
```

### 2.5 On Success Handler (Lines 107-117)

```typescript
private _onSuccess(): void {
  this.failures = 0;
  this.stats.totalSuccesses++;

  if (this.state === 'HALF_OPEN') {
    this.successes++;
    if (this.successes >= this.successThreshold) {
      this._close();
    }
  }
}
```

**Purpose:** Handle successful request.

#### Line 108: Reset Failures

```typescript
this.failures = 0;
```

**Why reset?**

```typescript
// We track CONSECUTIVE failures
// Success → Reset counter

// Timeline:
failures = 0
Request 1: Fail → failures = 1
Request 2: Fail → failures = 2
Request 3: Success → failures = 0  ← Reset
Request 4: Fail → failures = 1  (not 3!)
```

**Prevents opening circuit on occasional failures:**

```typescript
// Without reset:
Request 1: Fail → failures = 1
Request 2: Success
Request 3: Fail → failures = 2
Request 4: Success
Request 5: Fail → failures = 3
...
// Eventually hits threshold, opens circuit ❌

// With reset:
Request 1: Fail → failures = 1
Request 2: Success → failures = 0  ← Reset
Request 3: Fail → failures = 1
Request 4: Success → failures = 0  ← Reset
// Never opens (failures not consecutive) ✅
```

#### Lines 111-116: HALF_OPEN Logic

```typescript
if (this.state === 'HALF_OPEN') {
  this.successes++;
  if (this.successes >= this.successThreshold) {
    this._close();
  }
}
```

**State machine:**

```
HALF_OPEN + Success
  → Increment successes counter
  → If successes >= successThreshold (2)
    → Transition to CLOSED ✅

HALF_OPEN + Another Success
  → Still not enough successes
  → Stay HALF_OPEN, wait for more ⚠️
```

**Example with successThreshold = 2:**

```typescript
// Circuit in HALF_OPEN state
successes = 0

Request 1: Success
  → successes = 1
  → 1 >= 2? No
  → Stay HALF_OPEN ⚠️

Request 2: Success
  → successes = 2
  → 2 >= 2? Yes
  → Call _close() ✅
  → Transition to CLOSED
```

### 2.6 On Failure Handler (Lines 119-143)

```typescript
private _onFailure(error: Error & { code?: string }): void {
  this.failures++;
  this.stats.totalFailures++;
  this.stats.lastError = error.message;

  if (error.code === 'ETIMEDOUT') {
    this.stats.totalTimeouts++;
  }

  logger.warn('Circuit breaker request failed', {
    service: this.serviceName,
    state: this.state,
    failures: this.failures,
    error: error.message
  });

  if (this.state === 'HALF_OPEN') {
    this._open();
    return;
  }

  if (this.requestCount >= this.volumeThreshold && this.failures >= this.failureThreshold) {
    this._open();
  }
}
```

**Purpose:** Handle failed request.

#### Lines 120-126: Track Failure

```typescript
this.failures++;
this.stats.totalFailures++;
this.stats.lastError = error.message;

if (error.code === 'ETIMEDOUT') {
  this.stats.totalTimeouts++;
}
```

**Separate timeout tracking:**

```typescript
// Distinguish timeouts from other errors
stats.totalFailures = 100
stats.totalTimeouts = 80

// Analysis: 80% failures are timeouts
// → Service slow, not crashing
// → Increase timeout? Or scale service?

// vs
stats.totalFailures = 100
stats.totalTimeouts = 5

// Analysis: 5% failures are timeouts
// → Service crashing, not slow
// → Check logs for errors
```

#### Lines 135-138: HALF_OPEN Failure

```typescript
if (this.state === 'HALF_OPEN') {
  this._open();
  return;
}
```

**Single failure in HALF_OPEN → Reopen circuit:**

```typescript
// HALF_OPEN state testing recovery
Request 1: Success → successes = 1
Request 2: Fail → _onFailure() called
  → Immediately reopen circuit ❌
  → Don't wait for more failures

// Why?
// Service still failing → Don't let more requests through
```

**Aggressive reopening:**

```typescript
// Could be more tolerant:
if (this.state === 'HALF_OPEN') {
  if (this.failures >= 2) {  // Allow 1 failure
    this._open();
  }
}

// But we use:
if (this.state === 'HALF_OPEN') {
  this._open();  // Any failure reopens ✅
}

// Reason: Better safe than sorry
// - If service still failing, block immediately
// - Protects system from more failures
```

#### Lines 140-142: CLOSED to OPEN Transition

```typescript
if (this.requestCount >= this.volumeThreshold && this.failures >= this.failureThreshold) {
  this._open();
}
```

**Two conditions (both must be true):**

```typescript
// Condition 1: Enough volume
this.requestCount >= this.volumeThreshold
// Need at least 10 requests (volumeThreshold)
// Prevents opening on startup/low traffic

// AND

// Condition 2: Enough failures
this.failures >= this.failureThreshold
// 5 consecutive failures (failureThreshold)

// Both true → Open circuit ✅
```

**Why both conditions?**

```typescript
// Scenario 1: Low volume
requestCount = 5
failures = 5  (100% failure rate!)
// → Don't open (need 10 requests)
// → Service might be starting up

// Scenario 2: High volume, few failures
requestCount = 100
failures = 3  (3% failure rate)
// → Don't open (need 5 failures)
// → Occasional failures are normal

// Scenario 3: High volume, many failures
requestCount = 100
failures = 10  (10% failure rate)
// → Open circuit! ✅
// → Service definitely failing
```

### 2.7 Open Circuit (Lines 145-161)

```typescript
private _open(): void {
  this.state = 'OPEN';
  this.nextAttempt = Date.now() + this.resetTimeout;

  this.emit('open', {
    service: this.serviceName,
    failures: this.failures,
    lastError: this.stats.lastError,
    nextAttempt: new Date(this.nextAttempt).toISOString()
  });

  logger.error(`Circuit breaker OPEN for ${this.serviceName}`, {
    failures: this.failures,
    totalRequests: this.requestCount,
    nextAttempt: new Date(this.nextAttempt).toISOString()
  });
}
```

**Purpose:** Open circuit (block all requests).

#### Line 147: Set Next Attempt

```typescript
this.nextAttempt = Date.now() + this.resetTimeout;
```

**Calculate when to try HALF_OPEN:**

```typescript
// Current time: 10:00:00
// resetTimeout: 30000ms (30 seconds)
// nextAttempt: 10:00:30

// Requests between 10:00:00 - 10:00:30:
// → Rejected (circuit OPEN)

// Request at 10:00:35:
// → Allowed (try HALF_OPEN)
```

#### Lines 149-154: Emit Event

```typescript
this.emit('open', {
  service: this.serviceName,
  failures: this.failures,
  lastError: this.stats.lastError,
  nextAttempt: new Date(this.nextAttempt).toISOString()
});
```

**Monitoring use case:**

```typescript
circuitBreaker.on('open', (data) => {
  // Alert oncall
  alertOncall(`Circuit OPEN for ${data.service}`, {
    failures: data.failures,
    lastError: data.lastError,
    nextAttempt: data.nextAttempt
  });

  // Create incident
  createIncident({
    title: `${data.service} circuit breaker opened`,
    severity: 'high',
    description: `Last error: ${data.lastError}`
  });

  // Update status page
  updateStatusPage(data.service, 'degraded');
});
```

### 2.8 Close Circuit (Lines 163-172)

```typescript
private _close(): void {
  const previousState = this.state;
  this.state = 'CLOSED';
  this.failures = 0;
  this.successes = 0;
  this.requestCount = 0;

  this.emit('close', { service: this.serviceName, previousState });
  logger.info(`Circuit breaker CLOSED for ${this.serviceName} - service recovered`);
}
```

**Purpose:** Close circuit (allow all requests).

#### Lines 165-168: Reset Counters

```typescript
this.state = 'CLOSED';
this.failures = 0;
this.successes = 0;
this.requestCount = 0;
```

**Fresh start:**

```typescript
// Service recovered
// Reset all counters
// Start monitoring again with clean slate
```

**Why reset requestCount?**

```typescript
// Old window had:
requestCount = 100
failures = 10

// If we don't reset:
// Next window starts with requestCount = 100
// → Already above volumeThreshold
// → First failure could open circuit ❌

// With reset:
// Next window starts with requestCount = 0
// → Need 10 requests before checking ✅
```

### 2.9 Get Stats (Lines 174-184)

```typescript
getStats() {
  return {
    service: this.serviceName,
    state: this.state,
    failures: this.failures,
    successes: this.successes,
    requestCount: this.requestCount,
    nextAttempt: this.state === 'OPEN' ? new Date(this.nextAttempt).toISOString() : null,
    stats: { ...this.stats }
  };
}
```

**Purpose:** Get current circuit breaker status.

**Example output:**

```typescript
// Circuit CLOSED (healthy)
{
  service: 'product-service',
  state: 'CLOSED',
  failures: 0,
  successes: 0,
  requestCount: 45,
  nextAttempt: null,
  stats: {
    totalRequests: 10000,
    totalFailures: 50,
    totalSuccesses: 9950,
    totalTimeouts: 10,
    totalRejections: 0,
    lastError: null
  }
}

// Circuit OPEN (failing)
{
  service: 'product-service',
  state: 'OPEN',
  failures: 10,
  successes: 0,
  requestCount: 100,
  nextAttempt: '2023-01-15T10:30:00.000Z',
  stats: {
    totalRequests: 10000,
    totalFailures: 550,
    totalSuccesses: 9450,
    totalTimeouts: 250,
    totalRejections: 300,
    lastError: 'ECONNREFUSED'
  }
}
```

**Dashboard use case:**

```typescript
// Monitoring dashboard
app.get('/admin/circuit-breakers', (req, res) => {
  const stats = [
    productBreaker.getStats(),
    orderBreaker.getStats(),
    userBreaker.getStats()
  ];
  
  res.json(stats);
});

// Display:
// Service          State    Failures  Success Rate
// product-service  CLOSED   0         99.5%
// order-service    OPEN     10        94.5%  ⚠️
// user-service     CLOSED   1         99.9%
```

### 2.10 Utility Methods (Lines 186-197)

```typescript
getState(): CircuitState {
  return this.state;
}

reset(): void {
  this.state = 'CLOSED';
  this.failures = 0;
  this.successes = 0;
  this.requestCount = 0;
  logger.info(`Circuit breaker manually reset for ${this.serviceName}`);
}
```

**getState:** Simple getter.

**reset:** Manual recovery (admin action).

**Use case for reset:**

```typescript
// Admin panel
app.post('/admin/circuit-breakers/:service/reset', authenticate(), authorize('admin'), (req, res) => {
  const breaker = getCircuitBreaker(req.params.service);
  
  breaker.reset();
  
  logger.info('Circuit breaker manually reset', {
    service: req.params.service,
    admin: req.user.email
  });
  
  res.json({ message: 'Circuit breaker reset' });
});

// Use when:
// - Service recovered but circuit still OPEN
// - False positive (circuit opened incorrectly)
// - Testing/debugging
```

---

## 🎯 SECTION 3: REAL-WORLD USAGE EXAMPLES

### 3.1 Basic Usage

```typescript
// Create circuit breaker
const productBreaker = new CircuitBreaker('product-service', {
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 3000,
  resetTimeout: 30000,
  volumeThreshold: 10
});

// Use in route handler
app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await productBreaker.execute(async () => {
      const response = await axios.get(
        `http://product-service/products/${req.params.id}`
      );
      return response.data;
    });
    
    res.json(product);
  } catch (error: any) {
    if (error.code === 'CIRCUIT_OPEN') {
      return res.status(503).json({
        error: 'Product service temporarily unavailable',
        retryAfter: 30
      });
    }
    
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});
```

### 3.2 With Fallback

```typescript
// Circuit breaker with fallback to cache
app.get('/api/products/:id', async (req, res) => {
  const product = await productBreaker.execute(
    // Primary: Call service
    async () => {
      const response = await axios.get(
        `http://product-service/products/${req.params.id}`
      );
      return response.data;
    },
    
    // Fallback: Return cached data
    async () => {
      const cached = await redis.get(`product:${req.params.id}`);
      if (!cached) {
        throw new Error('No cached data available');
      }
      return JSON.parse(cached);
    }
  );
  
  res.json(product);
});
```

### 3.3 With Monitoring

```typescript
// Set up monitoring
productBreaker.on('open', (data) => {
  logger.error('Circuit breaker opened', data);
  
  // Alert oncall
  alertOncall({
    title: `Circuit breaker OPEN: ${data.service}`,
    severity: 'high',
    details: {
      failures: data.failures,
      lastError: data.lastError,
      nextAttempt: data.nextAttempt
    }
  });
  
  // Update metrics
  metrics.circuitBreakerOpened.inc({ service: data.service });
});

productBreaker.on('close', (data) => {
  logger.info('Circuit breaker closed', data);
  
  // Notify recovery
  notifyOncall({
    title: `Circuit breaker CLOSED: ${data.service}`,
    severity: 'info',
    message: 'Service recovered'
  });
  
  // Update metrics
  metrics.circuitBreakerClosed.inc({ service: data.service });
});

productBreaker.on('halfOpen', (data) => {
  logger.info('Circuit breaker testing recovery', data);
  
  // Update metrics
  metrics.circuitBreakerHalfOpen.inc({ service: data.service });
});
```

### 3.4 Dashboard Endpoint

```typescript
app.get('/admin/circuit-breakers', authenticate(), authorize('admin'), (req, res) => {
  const breakers = {
    product: productBreaker.getStats(),
    order: orderBreaker.getStats(),
    user: userBreaker.getStats()
  };
  
  res.json(breakers);
});

// Response:
{
  "product": {
    "service": "product-service",
    "state": "CLOSED",
    "failures": 0,
    "requestCount": 1234,
    "stats": {
      "totalRequests": 50000,
      "totalFailures": 125,
      "totalSuccesses": 49875,
      "successRate": "99.75%"
    }
  },
  "order": {
    "service": "order-service",
    "state": "OPEN",
    "failures": 10,
    "nextAttempt": "2023-01-15T10:30:00.000Z",
    "stats": {
      "totalRequests": 45000,
      "totalFailures": 2250,
      "totalRejections": 5000,
      "lastError": "ECONNREFUSED"
    }
  }
}
```

---

**🎓 M10: CIRCUIT BREAKER DEEP DIVE COMPLETE!**

You've mastered:
- ✅ Circuit breaker pattern and state machine (CLOSED → OPEN → HALF_OPEN)
- ✅ Preventing cascading failures in microservices
- ✅ Failure detection with volume and failure thresholds
- ✅ Timeout handling with Promise.race
- ✅ Fallback patterns for graceful degradation
- ✅ Event-driven monitoring (open, close, halfOpen events)
- ✅ Metrics tracking (requests, failures, timeouts, rejections)
- ✅ State transitions and recovery testing
- ✅ Manual reset for admin intervention
- ✅ Real-world usage with monitoring and dashboards

**Next module:** M11-RETRY-STRATEGY-DEEP-DIVE (exponential backoff, jitter, retry policies)

**Progress: 10 out of 27 modules completed! (37% done)**
