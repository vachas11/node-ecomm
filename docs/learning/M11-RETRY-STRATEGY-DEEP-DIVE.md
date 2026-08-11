# M11: Retry Strategy Deep Dive

**File:** `services/api-gateway/src/lib/RetryStrategy.ts` (129 lines)  
**Level:** Resiliency Patterns  
**Prerequisites:** M01 (Logger), M10 (Circuit Breaker), Promise patterns  
**Time to Master:** 2-3 hours

---

## 📖 SECTION 1: THEORY - Retry Patterns

### 1.1 What is Retry Strategy?

**Retry Strategy** = Automatically retry failed requests with intelligent backoff to handle transient failures.

**Real-World Analogy:**

Think of **calling someone on the phone**:

**No Retry (Give up immediately):**
```
Call → Busy signal → Give up ❌
Problem: They might have been available 1 second later
```

**Immediate Retry (No delay):**
```
Call → Busy → Call → Busy → Call → Busy
Problem: Still busy, you're spamming them!
```

**Retry with Backoff (Smart retry):**
```
Call → Busy
Wait 1 minute → Call → Busy
Wait 2 minutes → Call → Busy
Wait 4 minutes → Call → Connected! ✅
Problem solved: Patient, increasing delays
```

### 1.2 The Problem: Transient Failures

**Transient failures** = Temporary errors that resolve themselves.

**Examples:**

**1. Network hiccup**
```typescript
// T+0s: Network packet lost
await fetch('http://api.example.com/data')
// → Error: ETIMEDOUT

// T+1s: Network fine
await fetch('http://api.example.com/data')
// → Success ✅

// Retry would have succeeded!
```

**2. Service temporarily overloaded**
```typescript
// T+0s: Service at 100% CPU
await fetch('http://api.example.com/data')
// → Error: 503 Service Unavailable

// T+10s: Service back to 50% CPU
await fetch('http://api.example.com/data')
// → Success ✅
```

**3. Database connection pool exhausted**
```typescript
// T+0s: All 20 connections in use
await db.query('SELECT * FROM products')
// → Error: Connection pool timeout

// T+2s: 5 connections freed
await db.query('SELECT * FROM products')
// → Success ✅
```

**4. Rate limit temporarily exceeded**
```typescript
// T+0s: Hit rate limit (100 req/min)
await fetch('http://api.example.com/data')
// → Error: 429 Too Many Requests

// T+60s: Rate limit window reset
await fetch('http://api.example.com/data')
// → Success ✅
```

### 1.3 Exponential Backoff

**Exponential backoff** = Double the delay after each retry.

**Formula:**
```
delay = initialDelay × (backoffFactor ^ attempt)
```

**Example with initialDelay=100ms, backoffFactor=2:**

```typescript
Attempt 1: delay = 100 × (2^0) = 100ms
Attempt 2: delay = 100 × (2^1) = 200ms
Attempt 3: delay = 100 × (2^2) = 400ms
Attempt 4: delay = 100 × (2^3) = 800ms
Attempt 5: delay = 100 × (2^4) = 1600ms
```

**Visual timeline:**

```
T+0s:     Request 1 → Fail
T+0.1s:   ⏱️ Wait 100ms
T+0.2s:   Request 2 → Fail
T+0.4s:   ⏱️ Wait 200ms
T+0.6s:   Request 3 → Fail
T+1.0s:   ⏱️ Wait 400ms
T+1.4s:   Request 4 → Success ✅
```

**Why exponential?**

**Linear backoff (bad):**
```typescript
// Wait same time after each failure
Attempt 1: wait 1s
Attempt 2: wait 1s
Attempt 3: wait 1s
Attempt 4: wait 1s

// Problems:
// - If service recovers in 2s: Wastes time with 1s delays
// - If service needs 10s: Still hammering it every 1s
```

**Exponential backoff (good):**
```typescript
// Increasing delays
Attempt 1: wait 100ms  (quick retry for transient errors)
Attempt 2: wait 200ms
Attempt 3: wait 400ms
Attempt 4: wait 800ms

// Benefits:
// - Quick recovery for short outages ✅
// - Backs off for longer outages ✅
// - Reduces load on failing service ✅
```

### 1.4 Jitter (Random Variation)

**Jitter** = Add random variation to retry delays.

**Problem without jitter:**

```typescript
// 100 clients hit rate limit at same time
// All retry at exactly same intervals:

T+0s:    100 requests → All fail (rate limit)
T+1s:    100 requests → All fail (thundering herd!)
T+2s:    100 requests → All fail
T+4s:    100 requests → All fail

// Synchronized retries create "thundering herd"
```

**Solution with jitter:**

```typescript
// Add ±25% random variation

Client 1: wait 100ms
Client 2: wait 120ms
Client 3: wait 85ms
Client 4: wait 110ms
...

// Requests spread out over time ✅
```

**Jitter calculation:**

```typescript
// Base delay: 1000ms
// Jitter: ±25%

jitterAmount = 1000 × 0.25 = 250ms
range = [-250ms, +250ms]

// Random delays:
750ms  (1000 - 250)
1000ms (1000 + 0)
1250ms (1000 + 250)
// And everything in between
```

**Visual comparison:**

```
Without Jitter (Thundering Herd):
Client 1:  ▓░░░░▓░░░░▓
Client 2:  ▓░░░░▓░░░░▓
Client 3:  ▓░░░░▓░░░░▓
         All requests at same time ❌

With Jitter (Spread Out):
Client 1:  ▓░░░░▓░░░░░▓
Client 2:  ▓░░░▓░░░▓░░░
Client 3:  ▓░░░░░▓░░▓░░
         Requests distributed ✅
```

### 1.5 Retriable vs Non-Retriable Errors

**Retriable errors** = Errors that might succeed if retried.

**Examples:**

**1. Network errors (retriable):**
```typescript
// Temporary network issues
'ECONNREFUSED'   // Connection refused (service restarting)
'ECONNRESET'     // Connection reset (network hiccup)
'ETIMEDOUT'      // Timeout (service slow)
'ECONNABORTED'   // Connection aborted
'EHOSTUNREACH'   // Host unreachable (routing issue)
'ENETUNREACH'    // Network unreachable
'EAI_AGAIN'      // DNS lookup failed temporarily

// All might succeed on retry ✅
```

**2. HTTP 5xx errors (retriable):**
```typescript
500 Internal Server Error  // Server crashed, might recover
502 Bad Gateway           // Proxy error, might resolve
503 Service Unavailable   // Service overloaded, might recover
504 Gateway Timeout       // Timeout, might succeed later

// All indicate server issues that might resolve ✅
```

**3. HTTP 429 (retriable with delay):**
```typescript
429 Too Many Requests     // Rate limited, retry after cooldown
// Will succeed after rate limit window ✅
```

**Non-retriable errors** = Errors that will fail again if retried.

**Examples:**

**1. HTTP 4xx errors (client errors):**
```typescript
400 Bad Request           // Invalid request format
401 Unauthorized          // Invalid/missing auth token
403 Forbidden             // Insufficient permissions
404 Not Found             // Resource doesn't exist
405 Method Not Allowed    // Wrong HTTP method
422 Unprocessable Entity  // Validation error

// Request is wrong, retrying won't help ❌
```

**2. Application errors:**
```typescript
'INVALID_TOKEN'      // Token is invalid, won't become valid
'CIRCUIT_OPEN'       // Circuit breaker open, retry blocked
'ENOTFOUND'          // Domain doesn't exist (DNS)

// Fundamental issues, retrying won't help ❌
```

**Decision tree:**

```
Error occurred
  ↓
Is it 4xx?
  Yes → Don't retry ❌
  No → ↓
Is it 5xx or 429?
  Yes → Retry ✅
  No → ↓
Is it network error (ECONN*, ETIMEDOUT)?
  Yes → Retry ✅
  No → ↓
Is it in nonRetriableErrors list?
  Yes → Don't retry ❌
  No → Don't retry (unknown error) ❌
```

### 1.6 Max Retries and Max Delay

**Max retries** = Stop after N attempts.

```typescript
maxRetries: 3

// Attempts:
Attempt 1: Original request
Attempt 2: Retry 1
Attempt 3: Retry 2
// Stop (max reached)

// Why limit?
// - Prevent infinite loops
// - Fail fast if issue persists
// - Don't waste resources
```

**Max delay** = Cap maximum wait time.

```typescript
maxDelay: 2000  // 2 seconds

// Without cap:
Attempt 1: wait 100ms
Attempt 2: wait 200ms
Attempt 3: wait 400ms
Attempt 4: wait 800ms
Attempt 5: wait 1600ms
Attempt 6: wait 3200ms   ← Too long!
Attempt 7: wait 6400ms   ← Way too long!

// With cap (maxDelay: 2000ms):
Attempt 1: wait 100ms
Attempt 2: wait 200ms
Attempt 3: wait 400ms
Attempt 4: wait 800ms
Attempt 5: wait 1600ms
Attempt 6: wait 2000ms   ← Capped ✅
Attempt 7: wait 2000ms   ← Capped ✅
```

**Why cap delay?**

```typescript
// Without cap:
// - Delays grow too large (minutes)
// - Request takes forever
// - User timeout

// With cap:
// - Reasonable wait times ✅
// - Predictable latency ✅
```

### 1.7 Retry Strategy vs Circuit Breaker

**Different purposes:**

```typescript
// Retry: Handle transient failures
// Circuit Breaker: Prevent cascading failures

// Use together:
const result = await circuitBreaker.execute(() =>
  retry.execute(() =>
    axios.get('...')
  )
);
```

**When each pattern helps:**

**Scenario 1: Single network hiccup**
```typescript
Request 1: Network packet lost → Retry succeeds ✅
// Retry: Solves it
// Circuit Breaker: Not needed (1 failure)
```

**Scenario 2: Service down for 30 seconds**
```typescript
Request 1: Fail → Retry 3 times → All fail
Request 2: Fail → Retry 3 times → All fail
Request 3: Fail → Retry 3 times → All fail
Request 4: Fail → Retry 3 times → All fail
Request 5: Fail → Retry 3 times → All fail

// Retry: Wastes 5 × 3 retries = 15 attempts ❌
// Circuit Breaker: Opens after 5 failures, stops retries ✅
```

**Scenario 3: Service recovering**
```typescript
T+0s:  Circuit opens (service down)
T+30s: Circuit goes HALF_OPEN
       Request 1: Fail → Retry → Success ✅
       Circuit closes (service recovered)

// Retry: Helps recover from temporary failure ✅
// Circuit Breaker: Protected during outage, tested recovery ✅
```

**Best practice: Combine both**

```typescript
// Outer: Circuit breaker (prevents cascading failures)
// Inner: Retry (handles transient errors)

const result = await circuitBreaker.execute(async () => {
  return retry.execute(async (attempt) => {
    return axios.get('http://api.example.com/data', {
      headers: { 'X-Retry-Attempt': attempt }
    });
  });
});
```

---

## 🔍 SECTION 2: LINE-BY-LINE CODE ANALYSIS

### 2.1 Imports and Interfaces (Lines 1-13)

```typescript
import logger from '../../../../shared/logger';

interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffFactor?: number;
  jitter?: boolean;
}

interface RetryContext {
  [key: string]: any;
}
```

#### Lines 3-9: RetryOptions Interface

```typescript
interface RetryOptions {
  maxRetries?: number;        // How many retry attempts (default: 3)
  initialDelay?: number;      // Starting delay in ms (default: 100)
  maxDelay?: number;          // Maximum delay cap in ms (default: 2000)
  backoffFactor?: number;     // Exponential multiplier (default: 2)
  jitter?: boolean;           // Add random variation (default: true)
}
```

**All optional** = Can use defaults or customize.

**Common configurations:**

```typescript
// Aggressive (fast retries, low tolerance)
{
  maxRetries: 2,
  initialDelay: 50,
  maxDelay: 500,
  backoffFactor: 2,
  jitter: true
}
// Use for: Real-time APIs, low latency requirements

// Balanced (default)
{
  maxRetries: 3,
  initialDelay: 100,
  maxDelay: 2000,
  backoffFactor: 2,
  jitter: true
}
// Use for: Most APIs, general purpose

// Patient (many retries, long delays)
{
  maxRetries: 5,
  initialDelay: 500,
  maxDelay: 10000,
  backoffFactor: 2,
  jitter: true
}
// Use for: Batch jobs, background tasks
```

#### Lines 11-13: RetryContext Interface

```typescript
interface RetryContext {
  [key: string]: any;
}
```

**Index signature** = Accept any key-value pairs.

```typescript
// Can pass any context for logging
const context: RetryContext = {
  service: 'product-service',
  productId: 123,
  userId: 456,
  requestId: 'abc-123'
};

// All included in logs
retry.execute(fn, context);
// Logs: { service: 'product-service', productId: 123, ... }
```

### 2.2 Class Constructor (Lines 15-33)

```typescript
export class RetryStrategy {
  private maxRetries: number;
  private initialDelay: number;
  private maxDelay: number;
  private backoffFactor: number;
  private jitter: boolean;
  private nonRetriableErrors: Set<string>;
  private nonRetriableStatusCodes: Set<number>;

  constructor(options: RetryOptions = {}) {
    this.maxRetries = options.maxRetries || 3;
    this.initialDelay = options.initialDelay || 100;
    this.maxDelay = options.maxDelay || 2000;
    this.backoffFactor = options.backoffFactor || 2;
    this.jitter = options.jitter !== undefined ? options.jitter : true;

    this.nonRetriableErrors = new Set(['ENOTFOUND', 'INVALID_TOKEN', 'CIRCUIT_OPEN']);
    this.nonRetriableStatusCodes = new Set([400, 401, 403, 404, 405, 422]);
  }
}
```

#### Lines 21-22: Error Blacklists

```typescript
private nonRetriableErrors: Set<string>;
private nonRetriableStatusCodes: Set<number>;
```

**Set** = Fast lookup (O(1)).

```typescript
// Check if error is non-retriable
if (this.nonRetriableErrors.has(error.code)) {
  // Don't retry
}

// Fast: O(1) lookup
// vs Array: O(N) with includes()
```

#### Line 29: Jitter Default

```typescript
this.jitter = options.jitter !== undefined ? options.jitter : true;
```

**Why this check?**

```typescript
// Problem with simple || operator:
this.jitter = options.jitter || true;

// If user passes false:
options.jitter = false
this.jitter = false || true  // → true ❌
// False is falsy, so || returns true

// Correct check:
options.jitter !== undefined ? options.jitter : true

// If user passes false:
false !== undefined ? false : true  // → false ✅

// If user omits:
undefined !== undefined ? undefined : true  // → true ✅
```

#### Lines 31-32: Initialize Blacklists

```typescript
this.nonRetriableErrors = new Set(['ENOTFOUND', 'INVALID_TOKEN', 'CIRCUIT_OPEN']);
this.nonRetriableStatusCodes = new Set([400, 401, 403, 404, 405, 422]);
```

**nonRetriableErrors:**

```typescript
'ENOTFOUND'      // DNS lookup failed (domain doesn't exist)
'INVALID_TOKEN'  // Auth token invalid (won't become valid)
'CIRCUIT_OPEN'   // Circuit breaker blocking (retry blocked)
```

**nonRetriableStatusCodes:**

```typescript
400  // Bad Request (malformed request)
401  // Unauthorized (invalid credentials)
403  // Forbidden (insufficient permissions)
404  // Not Found (resource doesn't exist)
405  // Method Not Allowed (wrong HTTP method)
422  // Unprocessable Entity (validation failed)
```

### 2.3 Execute Method (Lines 35-84)

```typescript
async execute<T>(fn: (attempt: number) => Promise<T>, context: RetryContext = {}): Promise<T> {
  let lastError: Error | null = null;
  let attempt = 0;

  while (attempt < this.maxRetries) {
    try {
      const result = await fn(attempt);

      if (attempt > 0) {
        logger.info(`Request succeeded after ${attempt} retries`, context);
      }

      return result;
    } catch (error: any) {
      lastError = error;
      attempt++;

      if (!this._shouldRetry(error, attempt)) {
        logger.debug('Error not retriable', {
          ...context,
          error: error.message,
          code: error.code,
          statusCode: error.response?.status,
          attempt
        });
        throw error;
      }

      if (attempt >= this.maxRetries) {
        logger.warn('Max retries reached', { ...context, attempts: attempt, error: error.message });
        break;
      }

      const delay = this._calculateDelay(attempt);

      logger.warn('Request failed, retrying', {
        ...context,
        attempt,
        maxRetries: this.maxRetries,
        delayMs: delay,
        error: error.message,
        code: error.code
      });

      await this._sleep(delay);
    }
  }

  throw lastError;
}
```

**Purpose:** Execute function with retry logic.

**Signature:**

```typescript
async execute<T>(
  fn: (attempt: number) => Promise<T>,  // Function to retry
  context: RetryContext = {}            // Optional context for logging
): Promise<T>
```

**Function receives attempt number:**

```typescript
retry.execute(async (attempt) => {
  console.log(`Attempt ${attempt}`);
  return axios.get('...', {
    headers: {
      'X-Retry-Attempt': attempt  // Include in request
    }
  });
});

// Output:
// Attempt 0 (original request)
// Attempt 1 (first retry)
// Attempt 2 (second retry)
```

#### Lines 36-37: Initialize State

```typescript
let lastError: Error | null = null;
let attempt = 0;
```

**lastError:** Store error to throw if all retries fail.  
**attempt:** Count retries (starts at 0).

#### Line 39: Retry Loop

```typescript
while (attempt < this.maxRetries) {
```

**Retry logic:**

```typescript
// maxRetries = 3

attempt = 0 → 0 < 3 → Try request
attempt = 1 → 1 < 3 → Retry 1
attempt = 2 → 2 < 3 → Retry 2
attempt = 3 → 3 < 3 → False, exit loop
```

**Total attempts:**

```typescript
maxRetries = 3
// Total: 3 attempts
// - 1 original request
// - 2 retries
```

#### Lines 40-47: Success Path

```typescript
try {
  const result = await fn(attempt);

  if (attempt > 0) {
    logger.info(`Request succeeded after ${attempt} retries`, context);
  }

  return result;
}
```

**Log only if retried:**

```typescript
attempt = 0 → Don't log (first try succeeded)
attempt = 1 → Log "succeeded after 1 retries"
attempt = 2 → Log "succeeded after 2 retries"
```

**Why log?**

```typescript
// Monitoring: Track retry success rate
// Logs show:
// - 90% succeed on first try
// - 8% succeed after 1 retry
// - 2% succeed after 2 retries

// Indicates service reliability
```

#### Lines 48-61: Failure Path - Non-Retriable

```typescript
} catch (error: any) {
  lastError = error;
  attempt++;

  if (!this._shouldRetry(error, attempt)) {
    logger.debug('Error not retriable', {
      ...context,
      error: error.message,
      code: error.code,
      statusCode: error.response?.status,
      attempt
    });
    throw error;
  }
```

**Check if should retry:**

```typescript
// Examples:
error.code = 'ECONNREFUSED' → shouldRetry = true ✅
error.code = 'INVALID_TOKEN' → shouldRetry = false ❌

error.response.status = 500 → shouldRetry = true ✅
error.response.status = 404 → shouldRetry = false ❌
```

**Throw immediately if non-retriable:**

```typescript
// Don't waste time retrying errors that won't succeed
if (!this._shouldRetry(error, attempt)) {
  throw error;  // Fail fast ✅
}
```

#### Lines 63-66: Max Retries Check

```typescript
if (attempt >= this.maxRetries) {
  logger.warn('Max retries reached', { ...context, attempts: attempt, error: error.message });
  break;
}
```

**Exit loop if max reached:**

```typescript
// maxRetries = 3
attempt = 3 → 3 >= 3 → Break ✅

// Will throw lastError after loop
```

#### Lines 68-79: Retry with Delay

```typescript
const delay = this._calculateDelay(attempt);

logger.warn('Request failed, retrying', {
  ...context,
  attempt,
  maxRetries: this.maxRetries,
  delayMs: delay,
  error: error.message,
  code: error.code
});

await this._sleep(delay);
```

**Calculate exponential backoff + jitter:**

```typescript
attempt = 1 → delay = 100ms
attempt = 2 → delay = 200ms
attempt = 3 → delay = 400ms
```

**Log retry:**

```json
{
  "level": "warn",
  "message": "Request failed, retrying",
  "service": "product-service",
  "attempt": 1,
  "maxRetries": 3,
  "delayMs": 100,
  "error": "ECONNREFUSED",
  "code": "ECONNREFUSED"
}
```

**Sleep before retry:**

```typescript
await this._sleep(100);  // Wait 100ms
// Then loop continues with next attempt
```

#### Lines 83: Throw Last Error

```typescript
throw lastError;
```

**All retries exhausted:**

```typescript
// Original request failed
// Retry 1 failed
// Retry 2 failed
// → Throw last error to caller
```

### 2.4 Should Retry (Lines 86-100)

```typescript
private _shouldRetry(error: Error & { code?: string; response?: { status: number } }, attempt: number): boolean {
  if (attempt >= this.maxRetries) return false;
  if (error.code && this.nonRetriableErrors.has(error.code)) return false;

  if (error.response?.status) {
    const status = error.response.status;
    if (this.nonRetriableStatusCodes.has(status)) return false;
    if (status >= 500 || status === 429) return true;
  }

  const retriableNetworkErrors = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN'];
  if (error.code && retriableNetworkErrors.includes(error.code)) return true;

  return false;
}
```

**Purpose:** Decide if error is worth retrying.

**Decision tree:**

```
1. Max retries reached?
   → No retry ❌

2. Error code in nonRetriableErrors?
   → No retry ❌

3. HTTP status in nonRetriableStatusCodes (4xx)?
   → No retry ❌

4. HTTP status 5xx or 429?
   → Retry ✅

5. Error code in retriableNetworkErrors?
   → Retry ✅

6. Unknown error
   → No retry ❌ (conservative)
```

#### Line 87: Check Max Retries

```typescript
if (attempt >= this.maxRetries) return false;
```

**Prevent infinite retries:**

```typescript
// Even if error is retriable
// Stop at max retries
```

#### Line 88: Check Non-Retriable Errors

```typescript
if (error.code && this.nonRetriableErrors.has(error.code)) return false;
```

**Examples:**

```typescript
error.code = 'INVALID_TOKEN' → return false ❌
error.code = 'CIRCUIT_OPEN' → return false ❌
error.code = 'ENOTFOUND' → return false ❌
```

#### Lines 90-94: Check HTTP Status

```typescript
if (error.response?.status) {
  const status = error.response.status;
  if (this.nonRetriableStatusCodes.has(status)) return false;
  if (status >= 500 || status === 429) return true;
}
```

**HTTP status logic:**

```typescript
// 4xx errors (client errors)
400, 401, 403, 404, 405, 422 → return false ❌

// 5xx errors (server errors)
500, 502, 503, 504 → return true ✅

// 429 (rate limit)
429 → return true ✅
```

**Why retry 5xx?**

```typescript
// 5xx = Server-side issue
// Might be temporary:
// - Service restarting
// - High load
// - Transient database error
// Retry might succeed ✅
```

**Why retry 429?**

```typescript
// 429 Too Many Requests
// Rate limit will reset
// Retry with backoff will succeed ✅
```

#### Lines 96-97: Check Network Errors

```typescript
const retriableNetworkErrors = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN'];
if (error.code && retriableNetworkErrors.includes(error.code)) return true;
```

**Network error codes:**

```typescript
'ECONNREFUSED'   // Connection refused (service down/restarting)
'ECONNRESET'     // Connection reset by peer (network issue)
'ETIMEDOUT'      // Timeout (service slow)
'ECONNABORTED'   // Connection aborted (network issue)
'EHOSTUNREACH'   // No route to host (routing problem)
'ENETUNREACH'    // Network unreachable (network down)
'EAI_AGAIN'      // DNS lookup timeout (temporary DNS issue)

// All temporary network issues ✅
```

#### Line 99: Default to No Retry

```typescript
return false;
```

**Conservative approach:**

```typescript
// Unknown error → Don't retry
// Better safe than sorry
// Prevents retrying errors that shouldn't be retried
```

### 2.5 Calculate Delay (Lines 102-113)

```typescript
private _calculateDelay(attempt: number): number {
  let delay = this.initialDelay * Math.pow(this.backoffFactor, attempt - 1);
  delay = Math.min(delay, this.maxDelay);

  if (this.jitter) {
    const jitterAmount = delay * 0.25;
    const jitterOffset = (Math.random() * jitterAmount * 2) - jitterAmount;
    delay = delay + jitterOffset;
  }

  return Math.floor(delay);
}
```

**Purpose:** Calculate retry delay with exponential backoff and jitter.

#### Line 103: Exponential Backoff

```typescript
let delay = this.initialDelay * Math.pow(this.backoffFactor, attempt - 1);
```

**Formula breakdown:**

```typescript
// initialDelay = 100
// backoffFactor = 2

attempt = 1:
delay = 100 × 2^(1-1) = 100 × 2^0 = 100 × 1 = 100ms

attempt = 2:
delay = 100 × 2^(2-1) = 100 × 2^1 = 100 × 2 = 200ms

attempt = 3:
delay = 100 × 2^(3-1) = 100 × 2^2 = 100 × 4 = 400ms

attempt = 4:
delay = 100 × 2^(4-1) = 100 × 2^3 = 100 × 8 = 800ms
```

**Why `attempt - 1`?**

```typescript
// Want first retry to have base delay:
attempt = 1 → delay = initialDelay ✅

// Not:
attempt = 1 → delay = initialDelay × 2 ❌
// Would skip the base delay
```

#### Line 104: Cap Maximum Delay

```typescript
delay = Math.min(delay, this.maxDelay);
```

**Prevent unbounded growth:**

```typescript
// Without cap (maxDelay = 2000):
attempt = 5 → delay = 1600ms ✅
attempt = 6 → delay = 3200ms → Capped to 2000ms ✅
attempt = 7 → delay = 6400ms → Capped to 2000ms ✅

// Keeps delays reasonable
```

#### Lines 106-109: Add Jitter

```typescript
if (this.jitter) {
  const jitterAmount = delay * 0.25;
  const jitterOffset = (Math.random() * jitterAmount * 2) - jitterAmount;
  delay = delay + jitterOffset;
}
```

**Jitter calculation:**

```typescript
// delay = 1000ms
// jitterAmount = 1000 × 0.25 = 250ms

// jitterOffset calculation:
Math.random() → 0.0 to 1.0
Math.random() × 250 → 0 to 250
Math.random() × 250 × 2 → 0 to 500
(Math.random() × 500) - 250 → -250 to +250

// Final delay:
delay + jitterOffset
= 1000 + (-250 to +250)
= 750ms to 1250ms
```

**Visual distribution:**

```
Base delay: 1000ms
Jitter ±25%:

  750ms                1000ms               1250ms
    |--------------------|--------------------|
    ←------- -25% ------→←------- +25% ------→
    
Random delays spread evenly across range
```

**Example delays with jitter:**

```typescript
// Base: 1000ms, Jitter: ±25%
Trial 1: 850ms   (1000 - 150)
Trial 2: 1120ms  (1000 + 120)
Trial 3: 920ms   (1000 - 80)
Trial 4: 1230ms  (1000 + 230)
Trial 5: 780ms   (1000 - 220)
```

#### Line 112: Floor Result

```typescript
return Math.floor(delay);
```

**Remove decimals:**

```typescript
delay = 1234.567
Math.floor(delay) = 1234

// setTimeout expects integer milliseconds
```

### 2.6 Sleep Helper (Lines 115-117)

```typescript
private _sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

**Purpose:** Async delay function.

**Usage:**

```typescript
await this._sleep(1000);  // Wait 1 second
console.log('1 second later');
```

**How it works:**

```typescript
// 1. Create Promise
new Promise((resolve) => {
  // 2. Set timeout
  setTimeout(() => {
    // 3. Resolve after delay
    resolve();
  }, ms);
})

// 4. Await promise (pauses execution)
await sleepPromise;

// 5. Continue after delay
```

### 2.7 Customization Methods (Lines 119-126)

```typescript
addNonRetriableError(errorCode: string): void {
  this.nonRetriableErrors.add(errorCode);
}

addNonRetriableStatus(statusCode: number): void {
  this.nonRetriableStatusCodes.add(statusCode);
}
```

**Purpose:** Add custom non-retriable errors at runtime.

**Use case:**

```typescript
// Create retry strategy
const retry = new RetryStrategy();

// Add application-specific non-retriable errors
retry.addNonRetriableError('PRODUCT_NOT_FOUND');
retry.addNonRetriableError('USER_SUSPENDED');

// Add business logic status codes
retry.addNonRetriableStatus(409);  // Conflict (business rule violation)
retry.addNonRetriableStatus(410);  // Gone (resource permanently deleted)

// Now these won't be retried
await retry.execute(async () => {
  const response = await api.createOrder();
  if (response.error === 'PRODUCT_NOT_FOUND') {
    throw new Error('PRODUCT_NOT_FOUND');  // Won't retry ✅
  }
});
```

---

## 🎯 SECTION 3: REAL-WORLD USAGE EXAMPLES

### 3.1 Basic API Call with Retry

```typescript
const retry = new RetryStrategy({
  maxRetries: 3,
  initialDelay: 100,
  maxDelay: 2000,
  backoffFactor: 2,
  jitter: true
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await retry.execute(
      async (attempt) => {
        const response = await axios.get(
          `http://product-service/products/${req.params.id}`,
          {
            headers: { 'X-Retry-Attempt': attempt },
            timeout: 5000
          }
        );
        return response.data;
      },
      { productId: req.params.id, requestId: req.id }
    );
    
    res.json(product);
  } catch (error: any) {
    logger.error('Failed to fetch product', {
      productId: req.params.id,
      error: error.message
    });
    res.status(503).json({ error: 'Service unavailable' });
  }
});
```

### 3.2 With Circuit Breaker

```typescript
const circuitBreaker = new CircuitBreaker('product-service');
const retry = new RetryStrategy({ maxRetries: 2 });

app.get('/api/products/:id', async (req, res) => {
  try {
    // Outer: Circuit breaker (prevents cascading failures)
    const product = await circuitBreaker.execute(async () => {
      // Inner: Retry (handles transient errors)
      return retry.execute(
        async (attempt) => {
          const response = await axios.get(
            `http://product-service/products/${req.params.id}`,
            { timeout: 3000 }
          );
          return response.data;
        },
        { productId: req.params.id }
      );
    });
    
    res.json(product);
  } catch (error: any) {
    if (error.code === 'CIRCUIT_OPEN') {
      return res.status(503).json({
        error: 'Product service unavailable',
        retryAfter: 30
      });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

### 3.3 Database Query with Retry

```typescript
const dbRetry = new RetryStrategy({
  maxRetries: 5,
  initialDelay: 200,
  maxDelay: 5000
});

async function getUser(userId: number) {
  return dbRetry.execute(
    async () => {
      const result = await db.query(
        'SELECT * FROM users WHERE id = $1',
        [userId]
      );
      
      if (result.rows.length === 0) {
        throw new Error('USER_NOT_FOUND');  // Non-retriable
      }
      
      return result.rows[0];
    },
    { userId, operation: 'getUser' }
  );
}

// Add USER_NOT_FOUND to non-retriable list
dbRetry.addNonRetriableError('USER_NOT_FOUND');
```

### 3.4 Batch Processing with Retry

```typescript
const batchRetry = new RetryStrategy({
  maxRetries: 3,
  initialDelay: 500,
  maxDelay: 5000
});

async function processBatch(items: any[]) {
  const results = [];
  
  for (const item of items) {
    try {
      const result = await batchRetry.execute(
        async (attempt) => {
          logger.info('Processing item', { itemId: item.id, attempt });
          return await processItem(item);
        },
        { itemId: item.id }
      );
      
      results.push({ id: item.id, status: 'success', result });
    } catch (error: any) {
      logger.error('Failed to process item', {
        itemId: item.id,
        error: error.message
      });
      results.push({ id: item.id, status: 'failed', error: error.message });
    }
  }
  
  return results;
}
```

---

## 🎓 SECTION 4: MAANG INTERVIEW QUESTIONS

### Q1: How would you implement adaptive retry delays based on server response?

**Answer:**

```typescript
class AdaptiveRetryStrategy extends RetryStrategy {
  private _calculateDelay(attempt: number, error?: Error & { response?: { headers: any } }): number {
    // Check for Retry-After header
    if (error?.response?.headers['retry-after']) {
      const retryAfter = parseInt(error.response.headers['retry-after']);
      return retryAfter * 1000;  // Convert to ms
    }
    
    // Check for X-RateLimit-Reset header
    if (error?.response?.headers['x-ratelimit-reset']) {
      const resetTime = parseInt(error.response.headers['x-ratelimit-reset']);
      const delay = (resetTime * 1000) - Date.now();
      return Math.max(0, delay);
    }
    
    // Fallback to exponential backoff
    return super._calculateDelay(attempt);
  }
}

// Usage:
const retry = new AdaptiveRetryStrategy();
await retry.execute(async () => {
  const response = await axios.get('...');
  return response.data;
});

// If 429 response with Retry-After: 60
// → Waits exactly 60 seconds (respects server)
// Not exponential backoff
```

### Q2: How would you implement per-error-type retry policies?

**Answer:**

```typescript
interface ErrorPolicy {
  shouldRetry: boolean;
  maxRetries?: number;
  initialDelay?: number;
}

class PolicyBasedRetryStrategy {
  private policies: Map<string, ErrorPolicy> = new Map();
  
  constructor() {
    // Default policies
    this.policies.set('ECONNREFUSED', {
      shouldRetry: true,
      maxRetries: 5,
      initialDelay: 100
    });
    
    this.policies.set('ETIMEDOUT', {
      shouldRetry: true,
      maxRetries: 3,
      initialDelay: 500  // Longer delay for timeouts
    });
    
    this.policies.set('401', {
      shouldRetry: false  // Never retry auth errors
    });
    
    this.policies.set('503', {
      shouldRetry: true,
      maxRetries: 10,      // Many retries for service unavailable
      initialDelay: 1000   // Longer initial delay
    });
  }
  
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    let attempt = 0;
    
    while (true) {
      try {
        return await fn();
      } catch (error: any) {
        const errorKey = error.code || error.response?.status?.toString();
        const policy = this.policies.get(errorKey);
        
        if (!policy || !policy.shouldRetry) {
          throw error;  // Don't retry
        }
        
        attempt++;
        const maxRetries = policy.maxRetries || 3;
        if (attempt >= maxRetries) {
          throw error;  // Max retries reached
        }
        
        const initialDelay = policy.initialDelay || 100;
        const delay = initialDelay * Math.pow(2, attempt - 1);
        await sleep(delay);
      }
    }
  }
}
```

### Q3: How would you implement retry with exponential backoff AND circuit breaker?

**Answer:**

```typescript
class ResilientClient {
  private circuitBreaker: CircuitBreaker;
  private retry: RetryStrategy;
  
  constructor(serviceName: string) {
    this.circuitBreaker = new CircuitBreaker(serviceName, {
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 3000,
      resetTimeout: 30000
    });
    
    this.retry = new RetryStrategy({
      maxRetries: 3,
      initialDelay: 100,
      maxDelay: 2000
    });
    
    // Don't retry when circuit is open
    this.retry.addNonRetriableError('CIRCUIT_OPEN');
  }
  
  async call<T>(fn: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    return this.circuitBreaker.execute(
      async () => {
        return this.retry.execute(fn);
      },
      fallback
    );
  }
}

// Usage:
const client = new ResilientClient('product-service');

const product = await client.call(
  // Primary
  () => axios.get('http://product-service/products/123'),
  
  // Fallback
  async () => {
    const cached = await redis.get('product:123');
    return JSON.parse(cached);
  }
);
```

---

**🎉 M11: RETRY STRATEGY DEEP DIVE COMPLETE!**

You've mastered:
- ✅ Retry pattern for handling transient failures
- ✅ Exponential backoff algorithm
- ✅ Jitter to prevent thundering herd
- ✅ Retriable vs non-retriable error classification
- ✅ Max retries and max delay caps
- ✅ HTTP status code handling (4xx, 5xx, 429)
- ✅ Network error code handling
- ✅ Combining retry with circuit breaker
- ✅ Adaptive retry based on server headers
- ✅ Per-error-type retry policies

**Next module:** M12-CONNECTION-POOL-DEEP-DIVE (database connection pooling, resource management)

**Progress: 11 out of 27 modules completed! (41% done)**
