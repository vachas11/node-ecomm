# M13: Bulkhead Isolator Deep Dive

**File:** `services/api-gateway/src/lib/BulkheadIsolator.ts` (193 lines)  
**Level:** Resiliency Patterns  
**Prerequisites:** M01 (Logger), M10 (Circuit Breaker), Promise patterns  
**Time to Master:** 2-3 hours

---

## 📖 SECTION 1: THEORY - Bulkhead Pattern

### 1.1 What is the Bulkhead Pattern?

**Bulkhead** = Isolate resources to prevent cascading failures.

**Real-World Analogy:**

Think of a **ship with compartments (bulkheads)**:

**Without Bulkheads:**
```
┌─────────────────────────────────┐
│                                 │
│        Entire Ship              │
│      (One Big Space)            │
│                                 │
└─────────────────────────────────┘

Hull breach → Water floods entire ship → Ship sinks 💥
```

**With Bulkheads:**
```
┌────────┬────────┬────────┬─────────┐
│        │        │        │         │
│ Room 1 │ Room 2 │ Room 3 │ Room 4  │
│   ✅   │   ✅   │   💧   │   ✅    │
│        │        │ Flooded│         │
└────────┴────────┴────────┴─────────┘

Hull breach → Water floods ONE compartment
Other compartments stay dry → Ship stays afloat ✅
```

**In Software:**

**Without Bulkhead:**
```
┌────────────────────────────────┐
│     Thread Pool (100)          │
│                                │
│  Service A: 95 threads         │ ← Slow service hogs all threads
│  Service B: 5 threads          │ ← Fast service starved
│                                │
└────────────────────────────────┘

Service A slow → Uses all threads → Service B requests fail ❌
```

**With Bulkhead:**
```
┌──────────────┬─────────────────┐
│   Pool A     │     Pool B      │
│   (50 max)   │    (50 max)     │
│              │                 │
│  Service A:  │  Service B:     │
│  50 threads  │  10 threads     │
│              │                 │
└──────────────┴─────────────────┘

Service A slow → Uses its 50 threads
Service B → Still has 40 threads available ✅
Isolation prevents cascading failure ✅
```

### 1.2 The Problem: Resource Exhaustion

**Without Bulkhead:**

```typescript
// Shared thread pool (100 threads)
const server = http.createServer();

app.get('/fast', fastHandler);      // 10ms response
app.get('/slow', slowHandler);      // 30s response (slow DB query)

// Timeline:
T+0s:  1000 requests to /slow arrive
       → Uses all 100 threads
       
T+1s:  Request to /fast arrives
       → No threads available ❌
       → Waits for /slow to finish
       
T+30s: /slow requests complete
       → /fast finally gets thread
       → Response after 29s wait! ❌

// Fast endpoint affected by slow endpoint 💥
```

**With Bulkhead:**

```typescript
// Separate bulkheads
const slowBulkhead = new BulkheadIsolator('slow-service', { 
  maxConcurrent: 10  // Limit slow requests
});

const fastBulkhead = new BulkheadIsolator('fast-service', { 
  maxConcurrent: 90  // More capacity for fast requests
});

app.get('/fast', async (req, res) => {
  const result = await fastBulkhead.execute(() => fastHandler());
  res.json(result);
});

app.get('/slow', async (req, res) => {
  const result = await slowBulkhead.execute(() => slowHandler());
  res.json(result);
});

// Timeline:
T+0s:  1000 requests to /slow arrive
       → Uses 10 threads (bulkhead limit)
       → Remaining 990 queued or rejected
       
T+1s:  Request to /fast arrives
       → Uses fastBulkhead (90 threads available)
       → Responds immediately ✅

// Fast endpoint UNAFFECTED by slow endpoint ✅
```

### 1.3 Bulkhead Parameters

**1. maxConcurrent (default: 50)**

```typescript
maxConcurrent: 50
// Maximum concurrent requests executing at once
// Request 51 queues or gets rejected
```

**Determining maxConcurrent:**

```typescript
// Factors to consider:
// 1. Downstream service capacity
// 2. Available system resources (CPU, memory)
// 3. Acceptable latency
// 4. Request duration

// Example calculation:
// Service: Product Service
// - Can handle: 100 req/s
// - Avg response time: 500ms
// 
// maxConcurrent = 100 req/s × 0.5s = 50 concurrent requests

// Conservative (protect downstream):
maxConcurrent: 20

// Balanced:
maxConcurrent: 50

// Aggressive (maximize throughput):
maxConcurrent: 100
```

**2. maxQueueDepth (default: 100)**

```typescript
maxQueueDepth: 100
// Maximum requests waiting in queue
// Request 101 gets rejected immediately
```

**Queue behavior:**

```
Active:  [▓▓▓▓▓] (5 / 5 maxConcurrent)
Queue:   [░░░░░░░░░░] (10 / 100 maxQueueDepth)
         
New request arrives:
  → Active full? Check queue
  → Queue has space? Enqueue
  → Queue full? Reject ❌
```

**Why limit queue?**

```typescript
// Unlimited queue:
// - 10,000 requests queue up
// - Service slow: 10s per request
// - Request 10,000 waits: 10,000 × 10s = 27 hours! ❌
// - Request times out anyway
// - Wasted memory

// Limited queue (100):
// - After 100 queued, reject immediately
// - Fast failure (fail fast principle) ✅
// - Bounded memory usage ✅
// - Client can retry elsewhere
```

### 1.4 Bulkhead States

**Request can be in 3 states:**

```
┌────────────┐
│  REJECTED  │  ← Queue full, reject immediately
└────────────┘

┌────────────┐
│   QUEUED   │  ← Waiting for available slot
└─────┬──────┘
      │ Slot available
      ↓
┌────────────┐
│  EXECUTING │  ← Running in active slot
└────────────┘
```

**State transitions:**

```typescript
// Request arrives
if (activeCount < maxConcurrent) {
  // Direct execution (no queue)
  EXECUTING
} else if (queue.length < maxQueueDepth) {
  // Queue request
  QUEUED → (wait) → EXECUTING
} else {
  // Queue full
  REJECTED
}
```

**Visual timeline:**

```
maxConcurrent: 3
maxQueueDepth: 2

T+0s:  3 requests arrive → EXECUTING [▓▓▓]
T+1s:  2 more arrive → QUEUED [░░]
T+2s:  1 more arrives → REJECTED ❌ (queue full)

T+3s:  First request completes → [▓▓]
       First queued request → EXECUTING [▓▓▓]
       Queue now [░]

T+4s:  New request arrives → QUEUED [░░] (has space)
```

### 1.5 Bulkhead vs Other Patterns

**Bulkhead vs Circuit Breaker:**

```typescript
// Circuit Breaker: Stop trying when downstream fails
// Bulkhead: Limit concurrent load on downstream

// Circuit Breaker:
if (tooManyFailures) {
  return error;  // Don't even try
}

// Bulkhead:
if (tooManyConcurrent) {
  queue();  // Wait for capacity
  // OR
  reject();  // No capacity
}

// Use together:
circuitBreaker.execute(() =>
  bulkhead.execute(() =>
    callService()
  )
);
```

**Bulkhead vs Rate Limiter:**

```typescript
// Rate Limiter: Limit requests per time window
// - 100 requests per minute
// - Time-based

// Bulkhead: Limit concurrent requests
// - 50 requests at a time
// - Concurrency-based

// Rate Limiter:
if (requestsThisMinute >= 100) {
  reject();  // Wait until next minute
}

// Bulkhead:
if (activeRequests >= 50) {
  queue();  // Wait for request to complete
}

// Use together:
rateLimiter.check() →
  bulkhead.execute() →
    callService()
```

**Bulkhead vs Semaphore:**

```typescript
// Semaphore: Low-level primitive (OS/language feature)
// Bulkhead: High-level pattern (application logic)

// Semaphore:
const sem = new Semaphore(10);
await sem.acquire();
try {
  await work();
} finally {
  sem.release();
}

// Bulkhead (built on semaphore concept):
await bulkhead.execute(() => work());
// + Queueing
// + Metrics
// + Logging
// + Error handling
```

### 1.6 When to Use Bulkhead

**✅ Use Bulkhead When:**

**1. Multiple services share resources**

```typescript
// Gateway calls 3 services
// All use same thread pool
// Isolate each service

const productBulkhead = new BulkheadIsolator('product', { maxConcurrent: 30 });
const orderBulkhead = new BulkheadIsolator('order', { maxConcurrent: 30 });
const userBulkhead = new BulkheadIsolator('user', { maxConcurrent: 40 });

// Total: 100 threads allocated
// Each service isolated ✅
```

**2. Mixed fast and slow operations**

```typescript
// Fast endpoint (10ms)
const fastBulkhead = new BulkheadIsolator('fast', { maxConcurrent: 80 });

// Slow endpoint (5s)
const slowBulkhead = new BulkheadIsolator('slow', { maxConcurrent: 20 });

// Slow operations can't starve fast ones ✅
```

**3. Critical vs non-critical paths**

```typescript
// Critical: Order processing
const criticalBulkhead = new BulkheadIsolator('critical', { maxConcurrent: 70 });

// Non-critical: Analytics
const analyticsBulkhead = new BulkheadIsolator('analytics', { maxConcurrent: 30 });

// Analytics issues don't affect orders ✅
```

**❌ Don't Use Bulkhead When:**

**1. Single service with uniform load**

```typescript
// Only one downstream service
// All requests similar duration
// Bulkhead adds overhead with no benefit ❌

// Better: Simple concurrency limit
const concurrentRequests = 0;
const MAX = 50;

if (concurrentRequests >= MAX) {
  throw new Error('Too busy');
}
```

**2. Already using connection pools**

```typescript
// Connection pool already limits concurrency
const pool = new Pool({ max: 20 });

// Bulkhead redundant ❌
// Pool already prevents resource exhaustion
```

---

## 🔍 SECTION 2: LINE-BY-LINE CODE ANALYSIS

### 2.1 Imports and Interfaces (Lines 1-22)

```typescript
import logger from '../../../../shared/logger';

interface BulkheadOptions {
  maxConcurrent?: number;
  maxQueueDepth?: number;
}

interface QueueItem<T> {
  fn: () => Promise<T>;
  context: Record<string, any>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  enqueuedAt: number;
}

interface BulkheadStats {
  totalRequests: number;
  totalRejected: number;
  totalCompleted: number;
  maxQueueDepth: number;
  maxActiveCount: number;
}
```

#### Lines 3-6: BulkheadOptions

```typescript
interface BulkheadOptions {
  maxConcurrent?: number;     // Max concurrent executions
  maxQueueDepth?: number;     // Max queued requests
}
```

**Both optional** = Use defaults if not provided.

#### Lines 8-14: QueueItem

```typescript
interface QueueItem<T> {
  fn: () => Promise<T>;              // Function to execute
  context: Record<string, any>;      // Logging context
  resolve: (value: T) => void;       // Promise resolve
  reject: (error: Error) => void;    // Promise reject
  enqueuedAt: number;                // Timestamp when queued
}
```

**Why store resolve/reject?**

```typescript
// Execute stores the promise resolvers
// Process queue calls them later

// Enqueue:
return new Promise((resolve, reject) => {
  queue.push({ fn, resolve, reject, ... });
});

// Process queue (later):
const item = queue.shift();
item.fn()
  .then(result => item.resolve(result))  // ← Resolve original promise
  .catch(error => item.reject(error));
```

**enqueuedAt for wait time:**

```typescript
// Enqueue:
enqueuedAt: Date.now()  // T+0s

// Process:
waitTime = Date.now() - item.enqueuedAt  // T+5s - T+0s = 5000ms
logger.info('Request waited 5000ms in queue');
```

#### Lines 16-22: BulkheadStats

```typescript
interface BulkheadStats {
  totalRequests: number;      // All requests (executed + rejected)
  totalRejected: number;      // Rejected (queue full)
  totalCompleted: number;     // Successfully completed
  maxQueueDepth: number;      // Max queue depth observed
  maxActiveCount: number;     // Max concurrent observed
}
```

**Metrics for monitoring:**

```typescript
// Example:
{
  totalRequests: 10000,
  totalRejected: 234,      // 2.34% rejection rate
  totalCompleted: 9766,    // 97.66% success rate
  maxQueueDepth: 87,       // Peak queue: 87 (out of 100 max)
  maxActiveCount: 50       // Hit maxConcurrent limit
}
```

### 2.2 Class Constructor (Lines 24-42)

```typescript
export class BulkheadIsolator {
  private serviceName: string;
  private maxConcurrent: number;
  private maxQueueDepth: number;
  private activeCount = 0;
  private queue: QueueItem<any>[] = [];
  private stats: BulkheadStats = {
    totalRequests: 0,
    totalRejected: 0,
    totalCompleted: 0,
    maxQueueDepth: 0,
    maxActiveCount: 0
  };

  constructor(serviceName: string, options: BulkheadOptions = {}) {
    this.serviceName = serviceName;
    this.maxConcurrent = options.maxConcurrent || 50;
    this.maxQueueDepth = options.maxQueueDepth || 100;
  }
}
```

#### Line 28: Active Count

```typescript
private activeCount = 0;
```

**Tracks currently executing requests:**

```typescript
// Request starts → activeCount++
// Request completes → activeCount--

// Used to check capacity:
if (activeCount < maxConcurrent) {
  // Has capacity, execute immediately
}
```

#### Line 29: Queue Array

```typescript
private queue: QueueItem<any>[] = [];
```

**FIFO queue:**

```typescript
// Enqueue: push to end
queue.push(item);

// Dequeue: shift from start
const item = queue.shift();

// First In First Out ✅
```

**Why FIFO not LIFO?**

```typescript
// FIFO (First In First Out):
// Request 1 queued at T+0s
// Request 2 queued at T+1s
// Process: Request 1 first ✅
// Fair queueing

// LIFO (Last In First Out):
// Request 1 queued at T+0s
// Request 2 queued at T+1s
// Process: Request 2 first ❌
// Request 1 starved!
```

### 2.3 Execute Method (Lines 44-76)

```typescript
async execute<T>(fn: () => Promise<T>, context: Record<string, any> = {}): Promise<T> {
  this.stats.totalRequests++;

  if (this.activeCount >= this.maxConcurrent && this.queue.length >= this.maxQueueDepth) {
    this.stats.totalRejected++;

    logger.warn(`Bulkhead queue full for ${this.serviceName}`, {
      service: this.serviceName,
      activeCount: this.activeCount,
      queueDepth: this.queue.length,
      maxConcurrent: this.maxConcurrent,
      maxQueueDepth: this.maxQueueDepth
    });

    const error = new Error(`Service ${this.serviceName} is overloaded`) as Error & {
      code: string;
      statusCode: number;
      queueDepth: number;
      activeCount: number;
    };
    error.code = 'BULKHEAD_FULL';
    error.statusCode = 503;
    error.queueDepth = this.queue.length;
    error.activeCount = this.activeCount;
    throw error;
  }

  if (this.activeCount < this.maxConcurrent) {
    return await this._executeImmediate(fn);
  }

  return await this._enqueue(fn, context);
}
```

**Purpose:** Execute function with bulkhead protection.

#### Line 45: Track Request

```typescript
this.stats.totalRequests++;
```

**Count all requests:**

```typescript
// Executed immediately: +1
// Queued: +1
// Rejected: +1

// Total attempts, regardless of outcome
```

#### Lines 47-69: Reject if Full

```typescript
if (this.activeCount >= this.maxConcurrent && this.queue.length >= this.maxQueueDepth) {
  this.stats.totalRejected++;
  // ... throw error
}
```

**Both conditions must be true:**

```typescript
// Condition 1: Active slots full
this.activeCount >= this.maxConcurrent
// (50 / 50 concurrent)

// AND

// Condition 2: Queue full
this.queue.length >= this.maxQueueDepth
// (100 / 100 queued)

// Both true → Reject ❌
```

**Why both conditions?**

```typescript
// Scenario 1: Active full, queue has space
activeCount = 50 / 50  ✅ Full
queueDepth = 30 / 100  ❌ Space available
→ Queue request ✅

// Scenario 2: Active has space
activeCount = 40 / 50  ❌ Has capacity
queueDepth = 100 / 100 ✅ (doesn't matter)
→ Execute immediately ✅

// Scenario 3: Both full
activeCount = 50 / 50  ✅ Full
queueDepth = 100 / 100 ✅ Full
→ Reject ❌
```

#### Lines 58-68: Build Rich Error

```typescript
const error = new Error(`Service ${this.serviceName} is overloaded`) as Error & {
  code: string;
  statusCode: number;
  queueDepth: number;
  activeCount: number;
};
error.code = 'BULKHEAD_FULL';
error.statusCode = 503;
error.queueDepth = this.queue.length;
error.activeCount = this.activeCount;
```

**Rich error information:**

```typescript
{
  message: 'Service product-service is overloaded',
  code: 'BULKHEAD_FULL',
  statusCode: 503,
  queueDepth: 100,
  activeCount: 50
}
```

**Error handling:**

```typescript
try {
  await bulkhead.execute(() => callService());
} catch (error) {
  if (error.code === 'BULKHEAD_FULL') {
    // Bulkhead overloaded
    logger.error('Service overloaded', {
      queueDepth: error.queueDepth,
      activeCount: error.activeCount
    });
    
    return res.status(503).json({
      error: 'Service temporarily unavailable',
      retryAfter: 60
    });
  }
  
  // Other error
  throw error;
}
```

#### Lines 71-75: Route Request

```typescript
if (this.activeCount < this.maxConcurrent) {
  return await this._executeImmediate(fn);
}

return await this._enqueue(fn, context);
```

**Decision logic:**

```
Has capacity?
  Yes → Execute immediately
  No  → Enqueue
```

**Example:**

```typescript
// maxConcurrent = 50

// Request 1-50:
activeCount = 0-49 < 50
→ _executeImmediate()

// Request 51:
activeCount = 50 >= 50
→ _enqueue()
```

### 2.4 Execute Immediate (Lines 78-90)

```typescript
private async _executeImmediate<T>(fn: () => Promise<T>): Promise<T> {
  this.activeCount++;
  this._updateStats();

  try {
    const result = await fn();
    this.stats.totalCompleted++;
    return result;
  } finally {
    this.activeCount--;
    this._processQueue();
  }
}
```

**Purpose:** Execute request immediately (has capacity).

#### Lines 79-80: Acquire Slot

```typescript
this.activeCount++;
this._updateStats();
```

**Increment active:**

```typescript
// Before: activeCount = 30
// After: activeCount = 31

// Occupies 1 slot
```

**Update max stats:**

```typescript
_updateStats() {
  if (this.activeCount > this.stats.maxActiveCount) {
    this.stats.maxActiveCount = this.activeCount;
  }
}

// Track peak concurrency
```

#### Lines 82-85: Execute Function

```typescript
try {
  const result = await fn();
  this.stats.totalCompleted++;
  return result;
}
```

**Execute user function:**

```typescript
// User code:
await bulkhead.execute(() => 
  axios.get('http://product-service/products/123')
);

// Bulkhead calls:
const result = await fn();  // ← Calls axios.get()
return result;              // ← Returns product data
```

#### Lines 86-89: Release Slot

```typescript
} finally {
  this.activeCount--;
  this._processQueue();
}
```

**Finally block** = Always runs (success or error).

```typescript
// Success:
// 1. Return result
// 2. finally: activeCount--
// 3. finally: Process queue

// Error:
// 1. Throw error
// 2. finally: activeCount-- (still runs!)
// 3. finally: Process queue
// 4. Error propagates to caller
```

**Why _processQueue()?**

```typescript
// Slot just freed up
// Check if queued requests waiting
// Start next queued request

// Before: [▓▓▓▓▓] Queue: [░░░]
// After:  [▓▓▓▓] Queue: [░░]
//         ↑ Slot freed
// Process: [▓▓▓▓▓] Queue: [░]
//          ↑ Queued request started
```

### 2.5 Enqueue Method (Lines 92-111)

```typescript
private _enqueue<T>(fn: () => Promise<T>, context: Record<string, any>): Promise<T> {
  return new Promise((resolve, reject) => {
    const queueItem: QueueItem<T> = {
      fn,
      context,
      resolve,
      reject,
      enqueuedAt: Date.now()
    };

    this.queue.push(queueItem);
    this._updateStats();

    logger.debug(`Request queued for ${this.serviceName}`, {
      service: this.serviceName,
      queueDepth: this.queue.length,
      activeCount: this.activeCount
    });
  });
}
```

**Purpose:** Queue request when at capacity.

**Returns a Promise:**

```typescript
// Caller waits for promise:
const result = await bulkhead.execute(() => work());
//                    ↑ Waits here if queued

// Promise resolves when:
// 1. Slot becomes available
// 2. Request executes
// 3. _processQueue() calls item.resolve(result)
```

#### Lines 93-100: Create Queue Item

```typescript
return new Promise((resolve, reject) => {
  const queueItem: QueueItem<T> = {
    fn,
    context,
    resolve,
    reject,
    enqueuedAt: Date.now()
  };
```

**Capture promise resolvers:**

```typescript
// Outer promise:
const promise = new Promise((resolve, reject) => {
  // Store resolve/reject for later
  queueItem.resolve = resolve;
  queueItem.reject = reject;
});

// Later in _processQueue():
item.fn()
  .then(result => item.resolve(result))  // ← Resolves outer promise
  .catch(error => item.reject(error));   // ← Rejects outer promise
```

**Why this pattern?**

```typescript
// Allows queueing to work:

// T+0s: Request queued
const promise = bulkhead.execute(() => work());
// Promise created, waiting...

// T+5s: Slot available, process queue
item.resolve(result);
// Promise resolves!

// T+5s: Caller continues
const result = await promise;  // ← Receives result
```

#### Line 102: Add to Queue

```typescript
this.queue.push(queueItem);
```

**FIFO queue:**

```typescript
// Queue: [item1, item2]
queue.push(item3);
// Queue: [item1, item2, item3]

// Later:
const first = queue.shift();
// first = item1 (First In First Out)
```

### 2.6 Process Queue (Lines 113-138)

```typescript
private _processQueue(): void {
  if (this.queue.length === 0 || this.activeCount >= this.maxConcurrent) return;

  const item = this.queue.shift()!;
  const waitTime = Date.now() - item.enqueuedAt;

  logger.debug(`Processing queued request for ${this.serviceName}`, {
    service: this.serviceName,
    waitTimeMs: waitTime,
    remainingQueue: this.queue.length
  });

  this.activeCount++;
  this._updateStats();

  item.fn()
    .then(result => {
      item.resolve(result);
      this.stats.totalCompleted++;
    })
    .catch(error => item.reject(error))
    .finally(() => {
      this.activeCount--;
      this._processQueue();
    });
}
```

**Purpose:** Start next queued request when slot available.

#### Line 114: Guard Conditions

```typescript
if (this.queue.length === 0 || this.activeCount >= this.maxConcurrent) return;
```

**Two conditions to skip:**

```typescript
// Condition 1: Queue empty
this.queue.length === 0
// Nothing to process

// OR

// Condition 2: No capacity
this.activeCount >= this.maxConcurrent
// All slots full, wait

// Either true → Return early
```

#### Lines 116-117: Dequeue Item

```typescript
const item = this.queue.shift()!;
const waitTime = Date.now() - item.enqueuedAt;
```

**Get first item:**

```typescript
// Queue: [item1, item2, item3]
const item = queue.shift();
// item = item1
// Queue: [item2, item3]
```

**Calculate wait time:**

```typescript
// Enqueued: 1704470400000 (10:00:00.000)
// Now:      1704470405000 (10:00:05.000)
// Wait:     5000ms (5 seconds)
```

**Log wait time:**

```json
{
  "level": "debug",
  "message": "Processing queued request for product-service",
  "service": "product-service",
  "waitTimeMs": 5000,
  "remainingQueue": 2
}
```

**Monitoring use:**

```typescript
// Track wait times:
// - p50: 100ms (median)
// - p95: 500ms (95th percentile)
// - p99: 2000ms (99th percentile)
// - max: 5000ms (peak)

// If wait times too high:
// → Increase maxConcurrent
// → Increase maxQueueDepth
// → Scale service
```

#### Lines 125-126: Acquire Slot

```typescript
this.activeCount++;
this._updateStats();
```

**Occupy slot:**

```typescript
// Before: activeCount = 49, queue = [item]
// After:  activeCount = 50, queue = []
```

#### Lines 128-138: Execute Queued Function

```typescript
item.fn()
  .then(result => {
    item.resolve(result);
    this.stats.totalCompleted++;
  })
  .catch(error => item.reject(error))
  .finally(() => {
    this.activeCount--;
    this._processQueue();
  });
```

**Promise chain:**

```typescript
// Execute function
item.fn()

// Success: Resolve original promise
.then(result => item.resolve(result))

// Error: Reject original promise
.catch(error => item.reject(error))

// Always: Release slot and process next
.finally(() => {
  activeCount--;
  _processQueue();  // Recursive! Start next queued item
})
```

**Recursive processing:**

```typescript
// Queue: [req1, req2, req3]
// Active: [▓▓▓▓] (4/5 concurrent)

// Slot frees:
_processQueue()
  → Start req1
  → Queue: [req2, req3]
  → Active: [▓▓▓▓▓] (5/5)

// Another slot frees:
_processQueue()
  → Start req2
  → Queue: [req3]
  → Active: [▓▓▓▓▓] (5/5)

// Drains queue automatically ✅
```

### 2.7 Update Stats (Lines 140-147)

```typescript
private _updateStats(): void {
  if (this.queue.length > this.stats.maxQueueDepth) {
    this.stats.maxQueueDepth = this.queue.length;
  }
  if (this.activeCount > this.stats.maxActiveCount) {
    this.stats.maxActiveCount = this.activeCount;
  }
}
```

**Purpose:** Track peak metrics.

**Max queue depth:**

```typescript
// Track highest queue depth observed
// Over time:
maxQueueDepth = 0  // Empty
maxQueueDepth = 15 // Peak at 15
maxQueueDepth = 87 // New peak!
maxQueueDepth = 87 // Stays at peak
```

**Max active count:**

```typescript
// Track highest concurrency observed
maxActiveCount = 10 // Low load
maxActiveCount = 35 // Medium load
maxActiveCount = 50 // Hit limit!
```

**Capacity planning:**

```typescript
// If maxActiveCount = 50 (hit limit):
// → System at capacity
// → Consider increasing maxConcurrent

// If maxActiveCount = 20 (under limit):
// → Over-provisioned
// → Can reduce maxConcurrent
```

### 2.8 Get State (Lines 149-159)

```typescript
getState() {
  return {
    service: this.serviceName,
    activeCount: this.activeCount,
    queueDepth: this.queue.length,
    maxConcurrent: this.maxConcurrent,
    maxQueueDepth: this.maxQueueDepth,
    utilization: (this.activeCount / this.maxConcurrent * 100).toFixed(2) + '%',
    stats: { ...this.stats }
  };
}
```

**Purpose:** Get current bulkhead state.

**Example output:**

```typescript
{
  service: 'product-service',
  activeCount: 35,           // 35 executing now
  queueDepth: 12,            // 12 waiting
  maxConcurrent: 50,         // Max: 50
  maxQueueDepth: 100,        // Max queue: 100
  utilization: '70.00%',     // 35/50 = 70% utilized
  stats: {
    totalRequests: 10000,
    totalRejected: 234,
    totalCompleted: 9766,
    maxQueueDepth: 87,
    maxActiveCount: 50
  }
}
```

**Utilization calculation:**

```typescript
utilization = (activeCount / maxConcurrent * 100).toFixed(2) + '%'

// Examples:
activeCount = 25, maxConcurrent = 50
→ (25 / 50 * 100).toFixed(2) = '50.00%'

activeCount = 50, maxConcurrent = 50
→ (50 / 50 * 100).toFixed(2) = '100.00%'
```

### 2.9 Get Metrics (Lines 161-179)

```typescript
getMetrics() {
  return {
    service: this.serviceName,
    gauge: {
      activeCount: this.activeCount,
      queueDepth: this.queue.length,
      utilizationPercent: (this.activeCount / this.maxConcurrent * 100)
    },
    counter: {
      totalRequests: this.stats.totalRequests,
      totalRejected: this.stats.totalRejected,
      totalCompleted: this.stats.totalCompleted
    },
    max: {
      maxQueueDepth: this.stats.maxQueueDepth,
      maxActiveCount: this.stats.maxActiveCount
    }
  };
}
```

**Purpose:** Get metrics in Prometheus format.

**Metric types:**

**1. Gauge (current value):**

```typescript
gauge: {
  activeCount: 35,          // Current active
  queueDepth: 12,           // Current queue
  utilizationPercent: 70    // Current utilization
}

// Gauges can go up or down
// Represent current state
```

**2. Counter (cumulative):**

```typescript
counter: {
  totalRequests: 10000,     // All-time total
  totalRejected: 234,       // All-time rejections
  totalCompleted: 9766      // All-time completions
}

// Counters only increase
// Represent cumulative totals
```

**3. Max (peak):**

```typescript
max: {
  maxQueueDepth: 87,        // Peak queue depth
  maxActiveCount: 50        // Peak concurrency
}

// Track highest observed values
```

**Prometheus usage:**

```typescript
// Export to Prometheus
app.get('/metrics', (req, res) => {
  const metrics = bulkhead.getMetrics();
  
  const prometheusFormat = `
# HELP bulkhead_active_count Current active requests
# TYPE bulkhead_active_count gauge
bulkhead_active_count{service="${metrics.service}"} ${metrics.gauge.activeCount}

# HELP bulkhead_queue_depth Current queue depth
# TYPE bulkhead_queue_depth gauge
bulkhead_queue_depth{service="${metrics.service}"} ${metrics.gauge.queueDepth}

# HELP bulkhead_total_requests Total requests
# TYPE bulkhead_total_requests counter
bulkhead_total_requests{service="${metrics.service}"} ${metrics.counter.totalRequests}

# HELP bulkhead_total_rejected Total rejected
# TYPE bulkhead_total_rejected counter
bulkhead_total_rejected{service="${metrics.service}"} ${metrics.counter.totalRejected}
  `;
  
  res.set('Content-Type', 'text/plain');
  res.send(prometheusFormat);
});
```

### 2.10 Reset Stats (Lines 181-189)

```typescript
resetStats(): void {
  this.stats = {
    totalRequests: 0,
    totalRejected: 0,
    totalCompleted: 0,
    maxQueueDepth: 0,
    maxActiveCount: 0
  };
}
```

**Purpose:** Reset cumulative stats.

**Use case:**

```typescript
// Testing
const bulkhead = new BulkheadIsolator('test');
await bulkhead.execute(() => work1());
await bulkhead.execute(() => work2());
// stats.totalRequests = 2

bulkhead.resetStats();
// stats.totalRequests = 0

await bulkhead.execute(() => work3());
// stats.totalRequests = 1 (fresh count)
```

---

## 🎯 SECTION 3: REAL-WORLD USAGE

### 3.1 Basic Usage

```typescript
const productBulkhead = new BulkheadIsolator('product-service', {
  maxConcurrent: 50,
  maxQueueDepth: 100
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await productBulkhead.execute(
      async () => {
        const response = await axios.get(
          `http://product-service/products/${req.params.id}`
        );
        return response.data;
      },
      { productId: req.params.id, requestId: req.id }
    );
    
    res.json(product);
  } catch (error: any) {
    if (error.code === 'BULKHEAD_FULL') {
      return res.status(503).json({
        error: 'Service temporarily overloaded',
        retryAfter: 30
      });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

### 3.2 Multiple Bulkheads

```typescript
// Separate bulkheads per service
const productBulkhead = new BulkheadIsolator('product', { maxConcurrent: 40 });
const orderBulkhead = new BulkheadIsolator('order', { maxConcurrent: 30 });
const userBulkhead = new BulkheadIsolator('user', { maxConcurrent: 30 });

// Products endpoint
app.get('/api/products/:id', async (req, res) => {
  const product = await productBulkhead.execute(() => 
    getProduct(req.params.id)
  );
  res.json(product);
});

// Orders endpoint (isolated from products)
app.get('/api/orders/:id', async (req, res) => {
  const order = await orderBulkhead.execute(() => 
    getOrder(req.params.id)
  );
  res.json(order);
});

// If products slow → doesn't affect orders ✅
```

### 3.3 Monitoring Dashboard

```typescript
app.get('/admin/bulkheads', authenticate(), authorize('admin'), (req, res) => {
  const bulkheads = {
    product: productBulkhead.getState(),
    order: orderBulkhead.getState(),
    user: userBulkhead.getState()
  };
  
  res.json(bulkheads);
});

// Response:
{
  "product": {
    "service": "product",
    "activeCount": 35,
    "queueDepth": 12,
    "maxConcurrent": 40,
    "utilization": "87.50%",
    "stats": { "totalRequests": 10000, ... }
  },
  "order": {
    "service": "order",
    "activeCount": 5,
    "queueDepth": 0,
    "maxConcurrent": 30,
    "utilization": "16.67%",
    "stats": { "totalRequests": 2500, ... }
  }
}
```

---

**🎉 M13: BULKHEAD ISOLATOR DEEP DIVE COMPLETE!**

You've mastered:
- ✅ Bulkhead pattern for resource isolation
- ✅ Preventing cascading failures through compartmentalization
- ✅ Concurrency limiting (maxConcurrent)
- ✅ Request queueing (maxQueueDepth)
- ✅ FIFO queue processing
- ✅ Promise resolver pattern for async queueing
- ✅ Wait time tracking for queue latency
- ✅ Recursive queue processing
- ✅ Rich error handling (BULKHEAD_FULL)
- ✅ Metrics tracking (gauges, counters, max values)
- ✅ Utilization monitoring
- ✅ Multi-bulkhead isolation strategies

**Next module:** M14-USER-SERVICE-SERVER-DEEP-DIVE (user service architecture, database integration)

**Progress: 13 out of 27 modules completed! (48% done)**
