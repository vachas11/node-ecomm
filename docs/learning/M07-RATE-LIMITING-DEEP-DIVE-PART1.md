# M07: Rate Limiting Deep Dive - PART 1

**File:** `shared/auth/rateLimiter.ts` (163 lines)  
**Level:** Security  
**Prerequisites:** M04 (Redis), M06 (Auth Middleware), Express middleware  
**Time to Master:** 2-3 hours

---

## 📖 SECTION 1: THEORY - Rate Limiting Fundamentals

### 1.1 What is Rate Limiting?

**Rate limiting** = Restricting how many requests a client can make in a time window.

**Real-World Analogy:**

Think of a **water faucet with a flow regulator**:

**Without rate limiting:**
- Faucet fully open (no restriction)
- Water flows at maximum rate
- Can drain entire tank in seconds
- **Problem:** Resource exhaustion!

**With rate limiting:**
- Regulator limits flow to 1 liter per minute
- Tank lasts much longer
- Multiple people can use water fairly
- **Benefit:** Fair resource distribution!

**API rate limiting:**

```
Without rate limiting:
  Client → 10,000 requests/second → Server
  Result: Server overwhelmed, crashes ❌

With rate limiting:
  Client → 100 requests/minute → Server
  Excess requests → 429 Too Many Requests
  Result: Server stable, serves all clients ✅
```

### 1.2 Why Rate Limiting is Critical

**1. Prevent Abuse**

```typescript
// Brute force attack (without rate limiting)
for (let i = 0; i < 1000000; i++) {
  await fetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'admin@example.com',
      password: `password${i}`
    })
  });
}
// Tries 1 million passwords per minute
// Eventually cracks password ❌

// With rate limiting (5 requests per 15 min)
// After 5 attempts → 429 Too Many Requests
// Attacker blocked ✅
```

**2. Fair Resource Distribution**

```typescript
// Without rate limiting:
// User A: 10,000 requests/min (greedy)
// User B: 100 requests/min
// Result: User B starved, slow responses

// With rate limiting:
// User A: 100 requests/min (limited)
// User B: 100 requests/min (limited)
// Result: Fair distribution, both served
```

**3. Cost Control**

```typescript
// Cloud API costs (without rate limiting)
Client → 1,000,000 requests/day → API Gateway
→ $100/day cost ❌

// With rate limiting (100,000 requests/day)
→ $10/day cost ✅
```

**4. DDoS Protection**

```typescript
// DDoS attack (100,000 bots attacking)
Without rate limiting: Server crashes

With rate limiting: 
  - Each bot limited to 100 req/min
  - Attack spread over time
  - Server survives ✅
```

### 1.3 Rate Limiting Algorithms

**1. Fixed Window**

```
Time windows: [0-60s] [60-120s] [120-180s]
Limit: 10 requests per minute

0s: Request 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 ✅
59s: All 10 requests used
60s: Counter resets to 0
60s: Request 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 ✅

Problem (burst at window boundaries):
  59s: 10 requests ✅
  60s: 10 requests ✅ (new window)
  = 20 requests in 1 second! ❌
```

**Pros:**
- Simple to implement
- Low memory usage
- Fast

**Cons:**
- Allows bursts at window boundaries
- Not smooth rate limiting

**2. Sliding Window**

```
Time: Continuous sliding window (last 60 seconds)
Limit: 10 requests per minute

0s: Request 1
10s: Request 2
20s: Request 3
...
70s: Request 11
  → Check requests in [10s-70s] = 10 requests ✅

75s: Request 12
  → Check requests in [15s-75s] = 10 requests ✅

No burst problem!
```

**Pros:**
- Smooth rate limiting
- No burst at boundaries
- More accurate

**Cons:**
- More complex
- Higher memory (store timestamps)

**3. Token Bucket**

```
Bucket capacity: 10 tokens
Refill rate: 1 token per second

Start: 10 tokens in bucket
  ↓
Request 1: Consume 1 token → 9 left
Request 2: Consume 1 token → 8 left
...
Request 10: Consume 1 token → 0 left
Request 11: No tokens! → 429 ❌
  ↓
Wait 1 second → 1 token added
  ↓
Request 12: Consume 1 token → 0 left ✅
```

**Pros:**
- Allows bursts (if tokens available)
- Smooth average rate
- Good for variable traffic

**Cons:**
- Complex implementation
- Requires state management

**4. Leaky Bucket**

```
Bucket capacity: 10 requests
Leak rate: 1 request per second

Requests arrive → Queue in bucket
Bucket processes 1 request/second (leak)

0s: 5 requests arrive → Queue: [1,2,3,4,5]
1s: Process request 1 → Queue: [2,3,4,5]
2s: Process request 2 → Queue: [3,4,5]
...
If bucket full (10 requests) → 429 ❌
```

**Pros:**
- Smooth output rate
- Absorbs bursts
- Predictable performance

**Cons:**
- Queue management overhead
- Can delay requests

**Comparison Table:**

| Algorithm | Burst Handling | Smoothness | Complexity | Memory |
|-----------|----------------|------------|------------|---------|
| **Fixed Window** | Poor (allows bursts) | Low | Low | Low |
| **Sliding Window** | Good | High | Medium | Medium |
| **Token Bucket** | Excellent (allows bursts) | High | High | Medium |
| **Leaky Bucket** | Good (queues) | Very High | High | High |

**Our implementation: Fixed Window with Redis**

```typescript
// Simple and effective for most use cases
// Redis INCR + EXPIRE for atomic counters
```

### 1.4 Rate Limit Headers

**Standard headers (RFC 6585):**

```http
HTTP/1.1 200 OK
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1640000000

HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1640000000
Retry-After: 900
```

**Header meanings:**

- **X-RateLimit-Limit:** Maximum requests allowed in window
- **X-RateLimit-Remaining:** Requests left in current window
- **X-RateLimit-Reset:** Unix timestamp when counter resets
- **Retry-After:** Seconds to wait before retry

**Client-side handling:**

```typescript
async function apiRequest(endpoint: string) {
  const response = await fetch(endpoint);
  
  // Read rate limit headers
  const limit = response.headers.get('X-RateLimit-Limit');
  const remaining = response.headers.get('X-RateLimit-Remaining');
  const reset = response.headers.get('X-RateLimit-Reset');
  
  console.log(`Rate limit: ${remaining}/${limit}, resets at ${new Date(parseInt(reset) * 1000)}`);
  
  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After');
    console.log(`Rate limited! Retry after ${retryAfter} seconds`);
    
    // Wait and retry
    await sleep(parseInt(retryAfter) * 1000);
    return apiRequest(endpoint);
  }
  
  return response.json();
}
```

### 1.5 Rate Limiting Strategies

**1. By IP Address**

```typescript
key = req.ip  // '192.168.1.100'

// Pros: Simple, works for anonymous users
// Cons: Multiple users behind same IP (NAT)
```

**2. By User ID**

```typescript
key = req.user.userId  // '123'

// Pros: Accurate per-user limit
// Cons: Only works for authenticated users
```

**3. By IP + User (fallback)**

```typescript
key = req.user?.userId || req.ip

// Pros: Works for both auth and anonymous
// Cons: Two rate limit pools (confusing)
```

**4. By IP + Email**

```typescript
key = `${req.ip}:${req.body.email}`

// Pros: Prevents distributed attacks on one account
// Cons: Attacker can use different IPs
```

**5. By API Key**

```typescript
key = req.headers['x-api-key']

// Pros: Per-application limits
// Cons: Requires API key management
```

**6. Tiered Limiting**

```typescript
// Different limits for different user tiers
if (req.user.plan === 'free') {
  max = 100;  // 100 req/hour
} else if (req.user.plan === 'pro') {
  max = 1000;  // 1000 req/hour
} else if (req.user.plan === 'enterprise') {
  max = 10000;  // 10,000 req/hour
}
```

### 1.6 Common Rate Limiting Pitfalls

**Pitfall 1: Not rate limiting expensive endpoints**

```typescript
// ❌ BAD: No rate limit on expensive query
app.get('/api/reports/generate', async (req, res) => {
  // Takes 10 seconds, uses 100% CPU
  const report = await generateComplexReport();
  res.json(report);
});

// Attacker: 100 concurrent requests
// → 100% CPU for 1000 seconds = server crash

// ✅ GOOD: Strict rate limit
app.get('/api/reports/generate', strictRateLimiter, async (req, res) => {
  const report = await generateComplexReport();
  res.json(report);
});
// Max 3 reports per 15 min
```

**Pitfall 2: Same limit for all endpoints**

```typescript
// ❌ BAD: Same limit everywhere
app.use(apiRateLimiter);  // 100 req/min for ALL endpoints

app.get('/api/health');  // Simple check → 100 req/min (ok)
app.post('/auth/login');  // Security sensitive → 100 req/min (too many!)

// ✅ GOOD: Different limits per endpoint
app.get('/api/health', healthCheckLimiter);  // 1000 req/min
app.post('/auth/login', loginRateLimiter);   // 5 req/15min
```

**Pitfall 3: Forgetting skipSuccessfulRequests**

```typescript
// ❌ BAD: Count successful logins
loginRateLimiter({ max: 5 });

// User logs in 5 times (switching devices)
// 6th login → 429 Too Many Requests
// → Legitimate user blocked!

// ✅ GOOD: Only count failures
loginRateLimiter({ 
  max: 5,
  skipSuccessfulRequests: true  // ← Don't count successful logins
});
```

**Pitfall 4: In-memory store in production**

```typescript
// ❌ BAD: Memory store with multiple servers
const limiter = rateLimit({
  store: new MemoryStore()  // Each server has own counter
});

// Problem:
// Server 1: User makes 100 requests
// Server 2: User makes 100 requests
// Total: 200 requests (limit bypassed!)

// ✅ GOOD: Redis store (shared)
const limiter = rateLimit({
  store: new RedisStore({ client: redis })
});
// All servers share same counter
```

**Pitfall 5: No graceful degradation**

```typescript
// ❌ BAD: Crash if Redis down
const limiter = rateLimit({
  store: new RedisStore({ client: redis })
});
// Redis down → All requests fail

// ✅ GOOD: Fallback to memory
try {
  if (redis.isConnected) {
    store = new RedisStore({ client: redis });
  } else {
    store = new MemoryStore();
    logger.warn('Using memory store (Redis down)');
  }
} catch (error) {
  store = new MemoryStore();
}
```

---

## 🔍 SECTION 2: LINE-BY-LINE CODE ANALYSIS (Part 1)

### 2.1 Imports (Lines 1-5)

```typescript
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { Request, Response, NextFunction } from 'express';
import redisClient from '../redis';
import logger from '../logger';
```

**Line 1: express-rate-limit**

```typescript
import rateLimit from 'express-rate-limit';
```

**Most popular Express rate limiting library:**

- Over 3M weekly downloads
- Flexible configuration
- Multiple store backends
- Standard rate limit headers

**Basic usage:**

```typescript
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 100  // Limit each IP to 100 requests per windowMs
});

app.use(limiter);
```

**Line 2: rate-limit-redis**

```typescript
import RedisStore from 'rate-limit-redis';
```

**Redis store for distributed rate limiting:**

**Why Redis?**

```typescript
// Without Redis (memory store)
Server 1: Counter for IP 192.168.1.1 = 50
Server 2: Counter for IP 192.168.1.1 = 50
Total requests: 100 (but limit is 100, so OK?)
→ Limit bypassed! ❌

// With Redis (shared store)
Redis: Counter for IP 192.168.1.1 = 100
Server 1: Queries Redis → 100 requests
Server 2: Queries Redis → 100 requests
Total: 100 (enforced across all servers) ✅
```

**Line 4: redisClient**

```typescript
import redisClient from '../redis';
```

From M04 - our Redis singleton instance.

### 2.2 Type Definitions (Lines 7-23)

#### AuthenticatedRequest Interface (Lines 7-10)

```typescript
interface AuthenticatedRequest extends Request {
  user?: { userId: number };
  rateLimit?: { remaining: number; total: number };
}
```

**Line 8: user property**

```typescript
user?: { userId: number };
```

Set by authenticate middleware (M06), used for per-user rate limiting.

**Line 9: rateLimit property**

```typescript
rateLimit?: { remaining: number; total: number };
```

**Rate limit info added by our custom middleware:**

```typescript
{
  remaining: 5,  // Requests left
  total: 10      // Total allowed
}
```

**Used in response:**

```typescript
app.get('/api/data', accountRateLimiter(), (req, res) => {
  res.json({
    data: [...],
    rateLimit: req.rateLimit  // Include in response
  });
});
```

#### RateLimiterOptions Interface (Lines 12-23)

```typescript
interface RateLimiterOptions {
  windowMs?: number;
  max?: number;
  message?: string;
  standardHeaders?: boolean;
  legacyHeaders?: boolean;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  keyGenerator?: (req: Request) => string;
  handler?: (req: Request, res: Response) => void;
  skip?: (req: Request) => boolean;
}
```

**Configuration interface for our rate limiter factory.**

**Line 13: windowMs**

```typescript
windowMs?: number;
```

**Time window in milliseconds:**

```typescript
windowMs: 15 * 60 * 1000  // 15 minutes
windowMs: 60 * 60 * 1000  // 1 hour
windowMs: 24 * 60 * 60 * 1000  // 24 hours
```

**Line 14: max**

```typescript
max?: number;
```

**Maximum requests in window:**

```typescript
max: 5    // Very strict (auth endpoints)
max: 100  // Normal (general API)
max: 1000 // Lenient (public endpoints)
```

**Line 15: message**

```typescript
message?: string;
```

**Error message when rate limited:**

```json
{
  "success": false,
  "error": {
    "message": "Too many login attempts, please try again after 15 minutes",
    "statusCode": 429
  }
}
```

**Lines 16-17: Headers**

```typescript
standardHeaders?: boolean;  // X-RateLimit-* headers
legacyHeaders?: boolean;    // X-RateLimit-* (old format)
```

**Standard headers (RFC 6585):**

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1640000000
```

**Lines 18-19: Skip Options**

```typescript
skipSuccessfulRequests?: boolean;
skipFailedRequests?: boolean;
```

**skipSuccessfulRequests:**

```typescript
// Login attempts
skipSuccessfulRequests: true

// User logs in successfully → Don't count
// User fails login → Count towards limit
// Benefit: Legitimate users not penalized
```

**skipFailedRequests:**

```typescript
// API rate limiting
skipFailedRequests: true

// Request succeeds (200) → Count
// Request fails (500) → Don't count
// Benefit: Server errors don't consume limit
```

**Line 20: keyGenerator**

```typescript
keyGenerator?: (req: Request) => string;
```

**Function to generate rate limit key:**

```typescript
// By IP
keyGenerator: (req) => req.ip

// By user ID
keyGenerator: (req) => req.user.userId

// By IP + email
keyGenerator: (req) => `${req.ip}:${req.body.email}`
```

**Line 21: handler**

```typescript
handler?: (req: Request, res: Response) => void;
```

**Custom 429 response handler:**

```typescript
handler: (req, res) => {
  res.status(429).json({
    error: 'Too many requests',
    retryAfter: 900  // 15 minutes
  });
}
```

**Line 22: skip**

```typescript
skip?: (req: Request) => boolean;
```

**Conditionally skip rate limiting:**

```typescript
// Skip rate limiting for admins
skip: (req) => req.user?.role === 'admin'

// Skip for internal IPs
skip: (req) => req.ip.startsWith('10.0.0.')

// Skip during maintenance mode
skip: (req) => process.env.MAINTENANCE_MODE === 'true'
```

### 2.3 createRateLimiter Factory (Lines 25-72)

```typescript
export const createRateLimiter = (options: RateLimiterOptions = {}) => {
  const {
    windowMs = 15 * 60 * 1000,
    max = 100,
    message = 'Too many requests, please try again later',
    standardHeaders = true,
    legacyHeaders = false,
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
    keyGenerator = (req: Request) => req.ip || 'unknown',
    handler,
    skip
  } = options;
```

**Factory function** that creates configured rate limiter middleware.

#### Lines 26-37: Destructure with Defaults

```typescript
const {
  windowMs = 15 * 60 * 1000,
  max = 100,
  // ...
} = options;
```

**Destructuring with default values:**

```typescript
// If options.windowMs provided: Use it
// If options.windowMs not provided: Use 15 * 60 * 1000 (default)

// Example:
createRateLimiter({ windowMs: 60000 })
// windowMs = 60000 (provided)

createRateLimiter({})
// windowMs = 15 * 60 * 1000 (default)
```

**Line 27: Default window**

```typescript
windowMs = 15 * 60 * 1000,
```

**15 minutes default** - good balance:

```typescript
15 * 60 * 1000
= 15 * 60000
= 900000 milliseconds
= 15 minutes
```

**Why 15 minutes?**
- Long enough: Users don't hit limit frequently
- Short enough: Blocks attackers effectively
- Industry standard (many APIs use this)

**Line 28: Default max**

```typescript
max = 100,
```

**100 requests per 15 minutes:**

```typescript
100 requests / 15 minutes
= 100 / 15
≈ 6.67 requests per minute
≈ 1 request every 9 seconds
```

**Reasonable for general API usage.**

**Line 34: Default keyGenerator**

```typescript
keyGenerator = (req: Request) => req.ip || 'unknown',
```

**By IP address:**

```typescript
req.ip  // '192.168.1.100'

// If behind proxy (nginx, cloudflare):
req.ip  // '10.0.0.1' (wrong, internal IP)

// Need to trust proxy:
app.set('trust proxy', 1);
req.ip  // '192.168.1.100' (correct, client IP)
```

**Fallback to 'unknown':**

```typescript
req.ip || 'unknown'

// If req.ip is undefined (shouldn't happen)
// Use 'unknown' as key
// All users without IP share same limit
```

**Lines 35-36: Optional overrides**

```typescript
handler,
skip
```

**No defaults** - optional features:

```typescript
// Without handler: Uses our default (lines 48-51)
// Without skip: Never skips rate limiting
```

#### Lines 39-53: Limiter Configuration

```typescript
const limiterConfig: any = {
  windowMs,
  max,
  message: { success: false, error: { message, statusCode: 429 } },
  standardHeaders,
  legacyHeaders,
  skipSuccessfulRequests,
  skipFailedRequests,
  keyGenerator,
  handler: handler || ((req: Request, res: Response) => {
    logger.warn('Rate limit exceeded', { ip: req.ip, path: req.path, method: req.method, userAgent: req.headers['user-agent'] });
    res.status(429).json({ success: false, error: { message, statusCode: 429, retryAfter: Math.ceil(windowMs / 1000) } });
  }),
  skip
};
```

**Line 39: Type any**

```typescript
const limiterConfig: any = {
```

**Why `any`?**

express-rate-limit types are complex, `any` avoids type errors:

```typescript
// Without any: TypeScript errors
const limiterConfig: RateLimitRequestHandler = { ... };
// Error: Type mismatch on store property

// With any: No errors
const limiterConfig: any = { ... };
```

**Line 42: Message format**

```typescript
message: { success: false, error: { message, statusCode: 429 } },
```

**Structured error response:**

```json
{
  "success": false,
  "error": {
    "message": "Too many login attempts, please try again after 15 minutes",
    "statusCode": 429
  }
}
```

**Why this format?**

**Consistency** with our error handler (M02):

```typescript
// All errors use same format
{ success: false, error: { message, statusCode } }
```

**Lines 48-51: Default handler**

```typescript
handler: handler || ((req: Request, res: Response) => {
  logger.warn('Rate limit exceeded', { ip: req.ip, path: req.path, method: req.method, userAgent: req.headers['user-agent'] });
  res.status(429).json({ success: false, error: { message, statusCode: 429, retryAfter: Math.ceil(windowMs / 1000) } });
}),
```

**Line 48: Fallback pattern**

```typescript
handler || defaultHandler
```

Use custom handler if provided, otherwise use default.

**Line 49: Warning log**

```typescript
logger.warn('Rate limit exceeded', { 
  ip: req.ip, 
  path: req.path, 
  method: req.method, 
  userAgent: req.headers['user-agent'] 
});
```

**Why log rate limit hits?**

**Security monitoring:**

```json
{
  "level": "warn",
  "message": "Rate limit exceeded",
  "ip": "192.168.1.100",
  "path": "/auth/login",
  "method": "POST",
  "userAgent": "curl/7.64.1",
  "timestamp": "2023-01-15T10:30:00.000Z"
}
```

**Use cases:**
- Detect attacks (many rate limit hits)
- Find abusive users
- Monitor API usage patterns
- Trigger alerts for suspicious activity

**Line 50: Response**

```typescript
res.status(429).json({ 
  success: false, 
  error: { 
    message, 
    statusCode: 429, 
    retryAfter: Math.ceil(windowMs / 1000) 
  } 
});
```

**retryAfter calculation:**

```typescript
Math.ceil(windowMs / 1000)

// Example:
windowMs = 15 * 60 * 1000 = 900000 ms
windowMs / 1000 = 900 seconds
Math.ceil(900) = 900

// Response:
{
  "error": {
    "message": "...",
    "retryAfter": 900  // 15 minutes in seconds
  }
}
```

**Why `Math.ceil`?**

Round up to next second:

```typescript
windowMs = 14500  // 14.5 seconds
windowMs / 1000 = 14.5
Math.ceil(14.5) = 15  // Round up to 15 seconds

// Better to wait slightly longer than retry too soon
```

#### Lines 55-69: Redis Store Setup

```typescript
try {
  if (redisClient.isConnected && redisClient.client) {
    limiterConfig.store = new RedisStore({
      // @ts-ignore - Type mismatch but works at runtime
      sendCommand: (...args: any[]) => redisClient.client!.sendCommand(args),
      prefix: 'ratelimit:'
    });
    logger.info('Rate limiter using Redis store');
  } else {
    logger.warn('Rate limiter using in-memory store (Redis not connected)');
  }
} catch (error: any) {
  logger.error('Failed to initialize Redis store for rate limiter', { error: error.message });
  logger.warn('Falling back to in-memory rate limit store');
}
```

**Line 56: Check Redis connection**

```typescript
if (redisClient.isConnected && redisClient.client)
```

**Two checks:**

1. `redisClient.isConnected` - Connection established
2. `redisClient.client` - Client exists (not null)

**Why both?**

```typescript
// Startup sequence:
// 1. Redis client created but not connected
//    isConnected = false, client = exists
// 2. Connection established
//    isConnected = true, client = exists

// Only use Redis when fully ready
```

**Lines 57-61: Create Redis store**

```typescript
limiterConfig.store = new RedisStore({
  // @ts-ignore - Type mismatch but works at runtime
  sendCommand: (...args: any[]) => redisClient.client!.sendCommand(args),
  prefix: 'ratelimit:'
});
```

**Line 58: @ts-ignore comment**

```typescript
// @ts-ignore - Type mismatch but works at runtime
```

**Why needed?**

TypeScript type mismatch between rate-limit-redis and our Redis client types:

```typescript
// rate-limit-redis expects specific Redis client type
// Our redisClient is slightly different type
// But works at runtime, so ignore type error
```

**Line 59: sendCommand adapter**

```typescript
sendCommand: (...args: any[]) => redisClient.client!.sendCommand(args)
```

**Adapter function** connecting rate-limit-redis to our Redis client:

```typescript
// rate-limit-redis calls:
store.sendCommand('INCR', 'ratelimit:192.168.1.1')

// We adapt to our client:
redisClient.client.sendCommand(['INCR', 'ratelimit:192.168.1.1'])
```

**Line 60: Key prefix**

```typescript
prefix: 'ratelimit:'
```

**Redis key namespacing:**

```typescript
// Keys in Redis:
ratelimit:192.168.1.1
ratelimit:192.168.1.2
ratelimit:192.168.1.3

// Vs other keys:
cache:user:123
session:a3f8b9c2
blacklist:token123

// Easy to find all rate limit keys
// Easy to flush rate limits: DEL ratelimit:*
```

**Lines 64-68: Graceful degradation**

```typescript
} else {
  logger.warn('Rate limiter using in-memory store (Redis not connected)');
}
} catch (error: any) {
  logger.error('Failed to initialize Redis store for rate limiter', { error: error.message });
  logger.warn('Falling back to in-memory rate limit store');
}
```

**Fallback to memory store:**

```typescript
// Redis down: Use memory store (per-server counters)
// Better than no rate limiting at all!

// Production warning visible in logs
logger.warn('Rate limiter using in-memory store...')
```

**Why graceful degradation?**

```typescript
// Without fallback:
// Redis down → Rate limiting broken → App vulnerable

// With fallback:
// Redis down → Memory store → Rate limiting works (less effective but better than nothing)
```

#### Line 71: Return middleware

```typescript
return rateLimit(limiterConfig);
```

**Creates and returns** express-rate-limit middleware with our configuration.

---

**🎓 END OF PART 1**

Part 1 covered:
- ✅ Theory: Rate limiting fundamentals and algorithms
- ✅ Why rate limiting is critical (abuse, DDoS, cost)
- ✅ Rate limiting strategies and common pitfalls
- ✅ Line-by-line: Imports, types, createRateLimiter factory (lines 1-72)

**📌 Continue to M07-RATE-LIMITING-DEEP-DIVE-PART2.md for:**
- 🔍 Pre-configured rate limiters (login, register, API)
- 🔍 Custom accountRateLimiter with account locking
- 🏗️ Complete rate limiting architecture
- 🎯 Interview questions
- 💡 Best practices
