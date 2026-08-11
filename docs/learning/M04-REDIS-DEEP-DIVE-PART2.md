# M04: Redis Caching Deep Dive - PART 2

**Continued Code Analysis, Architecture, Interview Questions & Exercises**

---

## 🔍 SECTION 3: LINE-BY-LINE CODE ANALYSIS (Part 2)

### 3.1 Set Method (Lines 43-53)

Stores data in Redis with automatic expiration.

```typescript
async set(key: string, value: any, expiryInSeconds = 3600): Promise<boolean> {
  try {
    const serialized = JSON.stringify(value);
    await this.client?.setEx(key, expiryInSeconds, serialized);
    logger.debug('Cache set:', { key, ttl: expiryInSeconds });
    return true;
  } catch (error: any) {
    logger.error('Redis SET error:', { key, error: error.message });
    return false;
  }
}
```

**Line 43: Method signature**

```typescript
async set(key: string, value: any, expiryInSeconds = 3600): Promise<boolean>
```

**Parameters:**
- `key: string` - Cache key (e.g., 'user:123')
- `value: any` - Data to cache (object, array, string, number)
- `expiryInSeconds = 3600` - Default 1 hour TTL

**Return:** `boolean` - true on success, false on error

**Why default to 3600 seconds (1 hour)?**

Good balance:
- Short enough: Data doesn't go stale
- Long enough: Reduces database load

**Different expiry times:**

```typescript
// Session data (15 minutes)
await redis.set('session:abc123', sessionData, 900);

// User profile (1 hour) - default
await redis.set('user:123', userData);

// Product catalog (24 hours)
await redis.set('product:456', productData, 86400);

// API rate limit (1 minute)
await redis.set('ratelimit:ip:1.2.3.4', count, 60);
```

**Line 45: Serialize to JSON**

```typescript
const serialized = JSON.stringify(value);
```

**Why stringify?**

Redis only stores **strings**. Objects must be converted:

```typescript
// Input: Object
const user = { id: 123, email: 'john@example.com', age: 30 };

// Serialized: String
const serialized = '{"id":123,"email":"john@example.com","age":30}';

// Stored in Redis as string
await redis.set('user:123', serialized);
```

**What types can be stored?**

```typescript
// Objects ✅
await redis.set('user', { id: 1, name: 'John' });

// Arrays ✅
await redis.set('items', [1, 2, 3, 4]);

// Strings ✅
await redis.set('message', 'Hello World');

// Numbers ✅
await redis.set('count', 42);

// Booleans ✅
await redis.set('isActive', true);

// Dates ⚠️ (converted to ISO string)
await redis.set('timestamp', new Date());
// Stored as: "2026-08-07T14:32:10.123Z"
```

**Line 46: setEx command**

```typescript
await this.client?.setEx(key, expiryInSeconds, serialized);
```

**What is `setEx`?**

Redis command: **SET** with **EX**piration

```redis
SETEX user:123 3600 '{"id":123,"email":"john@example.com"}'
       ↑       ↑     ↑
       key     TTL   value
```

**Alternative approaches:**

```typescript
// ❌ Old way (two commands, not atomic)
await client.set(key, value);
await client.expire(key, 3600);
// Problem: If app crashes between commands, no expiration set!

// ✅ Modern way (one atomic command)
await client.setEx(key, 3600, value);
// Atomic: Both set and expiration happen together
```

**Line 47: Debug logging**

```typescript
logger.debug('Cache set:', { key, ttl: expiryInSeconds });
```

**Why `debug` level?**

Cache operations are frequent (thousands per second). Debug level means:
- Not logged in production by default
- Can enable for debugging: `LOG_LEVEL=debug`

**Example log:**

```json
{
  "level": "debug",
  "message": "Cache set",
  "key": "user:123",
  "ttl": 3600
}
```

**Lines 49-52: Error handling**

```typescript
} catch (error: any) {
  logger.error('Redis SET error:', { key, error: error.message });
  return false;
}
```

**Why return `false` instead of throwing?**

**Graceful degradation** - cache write failures shouldn't break the app:

```typescript
// In application code
const user = await db.query('SELECT * FROM users WHERE id = $1', [123]);

// Try to cache (non-critical)
const cached = await redis.set('user:123', user);
if (!cached) {
  logger.warn('Failed to cache user, continuing without cache');
}

// Return user regardless of cache success
return user;
```

### 3.2 Del Method (Lines 55-64)

Deletes a single key from cache.

```typescript
async del(key: string): Promise<boolean> {
  try {
    await this.client?.del(key);
    logger.debug('Cache deleted:', { key });
    return true;
  } catch (error: any) {
    logger.error('Redis DEL error:', { key, error: error.message });
    return false;
  }
}
```

**When to delete cache?**

**1. Data updated:**

```typescript
// Update user in database
await db.query('UPDATE users SET email = $1 WHERE id = $2', [newEmail, userId]);

// Invalidate cache (so next request gets fresh data)
await redis.del(`user:${userId}`);
```

**2. User logs out:**

```typescript
// Delete session
await redis.del(`session:${sessionId}`);
```

**3. Permission changed:**

```typescript
// User becomes admin
await db.query('UPDATE users SET role = $1 WHERE id = $2', ['admin', userId]);

// Invalidate user cache
await redis.del(`user:${userId}`);
```

**Why `del()` returns nothing useful:**

Redis `DEL` returns count of keys deleted:
- 1 if key existed and was deleted
- 0 if key didn't exist

Our method ignores this and returns `boolean` (success/failure).

### 3.3 DelPattern Method (Lines 66-79)

Deletes multiple keys matching a pattern.

```typescript
async delPattern(pattern: string): Promise<number> {
  try {
    const keys = await this.client?.keys(pattern);
    if (keys && keys.length > 0) {
      await this.client?.del(keys);
      logger.debug('Cache pattern deleted:', { pattern, count: keys.length });
      return keys.length;
    }
    return 0;
  } catch (error: any) {
    logger.error('Redis DEL pattern error:', { pattern, error: error.message });
    return 0;
  }
}
```

**What is a pattern?**

**Glob-style wildcards:**
- `*` - Matches anything
- `?` - Matches single character
- `[abc]` - Matches a, b, or c

**Examples:**

```typescript
// Delete all user caches
await redis.delPattern('user:*');
// Matches: user:1, user:2, user:123, user:abc

// Delete all sessions for a user
await redis.delPattern('session:user123:*');
// Matches: session:user123:abc, session:user123:xyz

// Delete all product caches
await redis.delPattern('product:*');

// Delete all temporary keys
await redis.delPattern('temp:*');
```

**Line 68: Find matching keys**

```typescript
const keys = await this.client?.keys(pattern);
```

**What `keys(pattern)` does:**

Scans Redis and returns all keys matching the pattern:

```typescript
await redis.keys('user:*')
// Returns: ['user:1', 'user:2', 'user:123', ...]
```

**⚠️ PRODUCTION WARNING:**

`KEYS` command is **blocking** and **slow** on large datasets:

```
1 million keys in Redis
KEYS * → Scans all 1 million → Takes 5-10 seconds
During scan: Redis blocks all other operations!
```

**Better approach for production:**

```typescript
// ❌ BAD in production
async delPattern(pattern: string) {
  const keys = await this.client.keys(pattern);  // Blocks Redis!
  await this.client.del(keys);
}

// ✅ BETTER for production (use SCAN instead)
async delPattern(pattern: string) {
  let cursor = 0;
  let deleted = 0;
  
  do {
    // SCAN is non-blocking, iterative
    const result = await this.client.scan(cursor, {
      MATCH: pattern,
      COUNT: 100
    });
    
    cursor = result.cursor;
    const keys = result.keys;
    
    if (keys.length > 0) {
      await this.client.del(keys);
      deleted += keys.length;
    }
  } while (cursor !== 0);
  
  return deleted;
}
```

**Lines 69-72: Delete matched keys**

```typescript
if (keys && keys.length > 0) {
  await this.client?.del(keys);
  logger.debug('Cache pattern deleted:', { pattern, count: keys.length });
  return keys.length;
}
```

**Batch deletion:**

```typescript
// Redis DEL accepts array
await client.del(['user:1', 'user:2', 'user:3']);
// Deletes all 3 keys in one command
```

**Use cases:**

```typescript
// User deleted - clear all their data
await redis.delPattern(`user:${userId}:*`);
// Deletes: user:123:profile, user:123:settings, user:123:cart

// Product category updated - clear all products in category
await redis.delPattern(`product:category:${categoryId}:*`);

// Deployment - clear all caches
await redis.delPattern('*');  // ⚠️ Use carefully!
```

### 3.4 Exists Method (Lines 81-89)

Check if key exists in cache.

```typescript
async exists(key: string): Promise<boolean> {
  try {
    const result = await this.client?.exists(key);
    return result === 1;
  } catch (error: any) {
    logger.error('Redis EXISTS error:', { key, error: error.message });
    return false;
  }
}
```

**Line 84: exists returns number**

```typescript
const result = await this.client?.exists(key);
return result === 1;
```

**What `exists()` returns:**

```typescript
// Key exists
await client.exists('user:123')  // → 1

// Key doesn't exist
await client.exists('user:999')  // → 0

// Multiple keys
await client.exists(['user:1', 'user:2', 'user:3'])  // → 2 (if 2 exist)
```

Our method converts number to boolean:
- `1` → `true`
- `0` → `false`

**Use cases:**

```typescript
// Check if user is logged in
if (await redis.exists(`session:${sessionId}`)) {
  // Session exists, user is authenticated
  return true;
}

// Check if rate limit exceeded
if (await redis.exists(`ratelimit:${userId}`)) {
  throw new TooManyRequestsError('Rate limit exceeded');
}

// Conditional caching
if (!await redis.exists(`product:${productId}`)) {
  // Not cached, fetch from database
  const product = await db.query('SELECT * FROM products WHERE id = $1', [productId]);
  await redis.set(`product:${productId}`, product);
}
```

### 3.5 Incr Method (Lines 91-98)

Atomically increments a counter.

```typescript
async incr(key: string): Promise<number | null> {
  try {
    return await this.client?.incr(key) || null;
  } catch (error: any) {
    logger.error('Redis INCR error:', { key, error: error.message });
    return null;
  }
}
```

**What is INCR?**

**Atomic increment** - increments number by 1:

```typescript
await redis.incr('visits')  // 0 → 1
await redis.incr('visits')  // 1 → 2
await redis.incr('visits')  // 2 → 3
```

**Why atomic matters:**

**Without atomicity (race condition):**

```typescript
// Request 1 and Request 2 arrive simultaneously
const count1 = await redis.get('counter');  // Both read: 5
await redis.set('counter', count1 + 1);     // Both write: 6
// Result: Counter is 6 (should be 7!)
```

**With atomicity (INCR):**

```typescript
// Request 1 and Request 2 arrive simultaneously
await redis.incr('counter');  // Atomic: 5 → 6
await redis.incr('counter');  // Atomic: 6 → 7
// Result: Counter is 7 ✅
```

**Use cases:**

**1. Page view counter:**

```typescript
app.get('/product/:id', async (req, res) => {
  // Increment view count
  await redis.incr(`product:${req.params.id}:views`);
  
  // Get product
  const product = await getProduct(req.params.id);
  res.json(product);
});
```

**2. Rate limiting:**

```typescript
async function checkRateLimit(userId: string): Promise<boolean> {
  const key = `ratelimit:${userId}`;
  
  // Increment counter
  const count = await redis.incr(key);
  
  // First request? Set expiration
  if (count === 1) {
    await redis.expire(key, 60);  // 60 seconds window
  }
  
  // Check limit
  return count <= 100;  // Max 100 requests per minute
}
```

**3. Distributed ID generation:**

```typescript
async function generateOrderId(): Promise<string> {
  const id = await redis.incr('order:id:sequence');
  return `ORD-${id.toString().padStart(8, '0')}`;
  // Returns: ORD-00000001, ORD-00000002, etc.
}
```

**4. Statistics tracking:**

```typescript
// Track API endpoints
await redis.incr(`api:${endpoint}:calls`);
await redis.incr(`api:${endpoint}:errors`);
await redis.incr(`api:${endpoint}:success`);
```

### 3.6 Expire Method (Lines 100-108)

Sets expiration time on existing key.

```typescript
async expire(key: string, seconds: number): Promise<boolean> {
  try {
    await this.client?.expire(key, seconds);
    return true;
  } catch (error: any) {
    logger.error('Redis EXPIRE error:', { key, error: error.message });
    return false;
  }
}
```

**When to use:**

**1. Extend TTL:**

```typescript
// User activity - extend session
if (await redis.exists(`session:${sessionId}`)) {
  await redis.expire(`session:${sessionId}`, 3600);  // Extend by 1 hour
}
```

**2. Add expiration to non-expiring key:**

```typescript
// Created with INCR (no TTL)
await redis.incr('ratelimit:user123');

// Add expiration
await redis.expire('ratelimit:user123', 60);
```

**3. Temporary feature flag:**

```typescript
// Enable feature for 24 hours
await redis.set('feature:new_checkout', true);
await redis.expire('feature:new_checkout', 86400);
```

**Common pitfall:**

```typescript
// ❌ Race condition
await redis.set('key', 'value');
// Another process might read here (before expiration set)
await redis.expire('key', 3600);

// ✅ Better: Use setEx (atomic)
await redis.setEx('key', 3600, 'value');
```

### 3.7 Ping Method (Lines 110-118)

Health check to verify Redis is responding.

```typescript
async ping(): Promise<boolean> {
  try {
    const result = await this.client?.ping();
    return result === 'PONG';
  } catch (error: any) {
    logger.error('Redis PING error:', { error: error.message });
    return false;
  }
}
```

**What PING does:**

```redis
PING → PONG
```

Simple command that Redis always responds to if alive.

**Use in health checks:**

```typescript
// Health check endpoint
app.get('/health', async (req, res) => {
  const health = {
    database: await checkDatabase(),
    redis: await redis.ping(),
    timestamp: new Date().toISOString()
  };
  
  const status = health.database && health.redis ? 200 : 503;
  res.status(status).json(health);
});
```

**Monitoring pattern:**

```typescript
setInterval(async () => {
  const isAlive = await redis.ping();
  
  if (!isAlive) {
    logger.error('Redis health check failed');
    metrics.increment('redis.health_check.failed');
    alertOncall('Redis is down');
  }
}, 30000);  // Every 30 seconds
```

### 3.8 Disconnect Method (Lines 120-125)

Gracefully closes Redis connection.

```typescript
async disconnect(): Promise<void> {
  if (this.client && this.isConnected) {
    await this.client.quit();
    logger.info('Redis client disconnected');
  }
}
```

**Line 122: quit() vs disconnect()**

```typescript
await this.client.quit();
```

**What `quit()` does:**
1. Stops accepting new commands
2. Waits for pending commands to complete
3. Closes connection gracefully
4. Sends QUIT command to server

**Alternative: `disconnect()`**
```typescript
await this.client.disconnect();
// Immediately closes connection (force quit)
// Pending commands may fail
```

**When to call:**

```typescript
// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down...');
  
  // Stop accepting requests
  server.close();
  
  // Close database
  await db.close();
  
  // Close Redis
  await redis.disconnect();
  
  // Exit
  process.exit(0);
});
```

### 3.9 Singleton Export (Line 128)

```typescript
export default new RedisClient();
```

**Why singleton?**

Only **one Redis connection** for the entire application:

```typescript
// ❌ Multiple instances (bad)
// fileA.ts
const redis1 = new RedisClient();

// fileB.ts
const redis2 = new RedisClient();
// → Two connections, wastes resources

// ✅ Singleton (good)
// shared/redis.ts
export default new RedisClient();

// Any file
import redis from './shared/redis';
// → Same instance everywhere
```

**Benefits:**
1. **Efficiency**: One connection, not 10+
2. **State sharing**: Connection state shared across modules
3. **Easy to use**: Just import and use

---

## 🏗️ SECTION 4: ARCHITECTURE DIAGRAMS

### 4.1 Cache-Aside Pattern (Our Implementation)

```
┌─────────────────────────────────────────────────┐
│           REQUEST: Get User Profile             │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
          ┌──────────────────────┐
          │  Check Redis Cache   │
          └──────────┬───────────┘
                     │
            ┌────────┴────────┐
            │                 │
        Cache Hit         Cache Miss
            │                 │
            ▼                 ▼
    ┌───────────────┐  ┌──────────────┐
    │ Return from   │  │ Query        │
    │ cache (1-2ms) │  │ Database     │
    └───────────────┘  │ (50-100ms)   │
                       └──────┬───────┘
                              │
                              ▼
                       ┌──────────────┐
                       │ Store in     │
                       │ Redis cache  │
                       │ (TTL: 1hr)   │
                       └──────┬───────┘
                              │
                              ▼
                       ┌──────────────┐
                       │ Return to    │
                       │ user         │
                       └──────────────┘
```

### 4.2 Write-Through Cache Update

```
┌─────────────────────────────────────────────────┐
│         REQUEST: Update User Email              │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
          ┌──────────────────────┐
          │  Update Database     │
          │  SET email = ...     │
          └──────────┬───────────┘
                     │
                     ▼
          ┌──────────────────────┐
          │  Invalidate Cache    │
          │  DEL user:123        │
          └──────────┬───────────┘
                     │
                     ▼
          ┌──────────────────────┐
          │  Return Success      │
          └──────────────────────┘

Next Read:
          ┌──────────────────────┐
          │  Cache Miss          │
          │  (deleted above)     │
          └──────────┬───────────┘
                     │
                     ▼
          ┌──────────────────────┐
          │  Fetch fresh data    │
          │  from database       │
          └──────────┬───────────┘
                     │
                     ▼
          ┌──────────────────────┐
          │  Cache for next time │
          └──────────────────────┘
```

### 4.3 Rate Limiting with Redis

```
┌─────────────────────────────────────────┐
│      API Request from User              │
└──────────────┬──────────────────────────┘
               │
               ▼
    ┌──────────────────────┐
    │ INCR ratelimit:user  │
    │ Returns: 1           │
    └──────────┬───────────┘
               │
               ├─ count === 1?
               │     │
               │     └─ Yes → EXPIRE ratelimit:user 60
               │              (Set 60 second window)
               │
               ▼
    ┌──────────────────────┐
    │ count <= 100?        │
    └──────────┬───────────┘
               │
        ┌──────┴──────┐
        │             │
      YES            NO
        │             │
        ▼             ▼
┌───────────┐  ┌──────────────┐
│ Allow     │  │ Reject       │
│ Request   │  │ 429 Too Many │
└───────────┘  │ Requests     │
               └──────────────┘
```

---

## 🎯 SECTION 5: 8 INTERVIEW QUESTIONS

### Q1: What is Redis and why use it for caching?

**Level:** Junior

**Answer:**

Redis is an in-memory data store that's extremely fast (1-2ms response time vs 50-100ms for databases).

**Why use for caching:**
1. **Speed**: 50-100x faster than database
2. **Reduced load**: Database handles 10% of traffic instead of 100%
3. **Cost**: Smaller database = lower cost
4. **Scalability**: Can handle 10,000+ req/sec

**Example impact:**
- Without cache: 100ms response time
- With 90% cache hit rate: 10ms average response time

---

### Q2: Explain cache invalidation strategies

**Level:** Mid

**Answer:**

**Three main strategies:**

**1. Time-based (TTL):**
```typescript
await redis.set('user:123', userData, 3600);  // Expires after 1 hour
```
- Pros: Simple, automatic cleanup
- Cons: Might serve stale data

**2. Event-based:**
```typescript
// On user update
await db.update('users', ...);
await redis.del('user:123');  // Invalidate immediately
```
- Pros: Always fresh data
- Cons: Requires coordination

**3. Hybrid (TTL + event-based):**
```typescript
// Cache with TTL
await redis.set('user:123', userData, 3600);

// On update: invalidate immediately
await redis.del('user:123');
```
- Pros: Best of both worlds
- Cons: More complex

Our code uses **hybrid approach**.

---

### Q3: Why do we use JSON.stringify/parse for Redis values?

**Level:** Junior/Mid

**Answer:**

Redis only stores **strings**. JavaScript objects must be serialized:

```typescript
// Storing
const user = { id: 123, email: 'john@example.com' };
const serialized = JSON.stringify(user);
// → '{"id":123,"email":"john@example.com"}'
await redis.set('user:123', serialized);

// Retrieving
const data = await redis.get('user:123');
// → '{"id":123,"email":"john@example.com"}' (string)
const user = JSON.parse(data);
// → { id: 123, email: 'john@example.com' } (object)
```

**Alternative:** Use MessagePack (more efficient, binary format)

---

### Q4: What's the difference between quit() and disconnect()?

**Level:** Mid

**Answer:**

**quit()** - Graceful shutdown:
```typescript
await client.quit();
```
- Waits for pending commands to complete
- Sends QUIT to server
- Use for graceful shutdown

**disconnect()** - Force close:
```typescript
await client.disconnect();
```
- Immediately closes connection
- Pending commands may fail
- Use for emergency shutdown

**Best practice:** Always use `quit()` for normal shutdown.

---

### Q5: How would you implement cache warming?

**Level:** Senior

**Answer:**

**Cache warming** = Pre-populating cache with frequently accessed data.

**Strategy:**

```typescript
async function warmCache() {
  logger.info('Starting cache warming...');
  
  // 1. Most popular products
  const products = await db.query(`
    SELECT * FROM products 
    ORDER BY views DESC 
    LIMIT 100
  `);
  
  for (const product of products) {
    await redis.set(`product:${product.id}`, product, 86400);
  }
  
  // 2. Featured content
  const featured = await db.query('SELECT * FROM featured_items');
  await redis.set('featured', featured, 3600);
  
  // 3. Static configurations
  const config = await db.query('SELECT * FROM config');
  await redis.set('config', config, 3600);
  
  logger.info('Cache warming complete');
}

// Run on startup
app.listen(3000, async () => {
  await redis.connect();
  await warmCache();  // Warm cache before accepting traffic
  logger.info('Server ready');
});
```

**When to warm:**
- Application startup
- After deployment
- After cache flush
- Scheduled (daily at low-traffic times)

---

### Q6: What's the risk of using KEYS command in production?

**Level:** Senior

**Answer:**

`KEYS` command scans **all keys** in Redis and is **blocking**:

```typescript
// ❌ DANGEROUS in production
await redis.client.keys('*');
// With 1 million keys: Takes 5-10 seconds
// During scan: Redis blocks ALL operations!
```

**Problems:**
1. **Blocking**: Redis can't process other commands
2. **Slow**: O(N) complexity (scans all keys)
3. **Outage**: Can cause service downtime

**Solution: Use SCAN instead**

```typescript
// ✅ SAFE for production
async function scanKeys(pattern: string) {
  let cursor = '0';
  const keys = [];
  
  do {
    const result = await redis.client.scan(cursor, {
      MATCH: pattern,
      COUNT: 100  // Scan in batches
    });
    
    cursor = result.cursor;
    keys.push(...result.keys);
  } while (cursor !== '0');
  
  return keys;
}
```

**SCAN characteristics:**
- **Non-blocking**: Returns control after each batch
- **Iterative**: Multiple calls to scan all keys
- **Safe**: Doesn't block other operations

---

### Q7: How would you implement a distributed rate limiter with Redis?

**Level:** Senior

**Answer:**

```typescript
async function checkRateLimit(
  userId: string,
  limit: number = 100,
  windowSeconds: number = 60
): Promise<{ allowed: boolean; remaining: number }> {
  const key = `ratelimit:${userId}`;
  
  // Atomic increment
  const count = await redis.incr(key);
  
  // First request? Set expiration
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }
  
  // Check limit
  const allowed = count <= limit;
  const remaining = Math.max(0, limit - count);
  
  return { allowed, remaining };
}

// Usage in API
app.post('/api/orders', async (req, res) => {
  const { allowed, remaining } = await checkRateLimit(req.user.id);
  
  if (!allowed) {
    return res.status(429).json({
      error: 'Rate limit exceeded',
      retryAfter: 60
    });
  }
  
  // Set headers
  res.setHeader('X-RateLimit-Limit', '100');
  res.setHeader('X-RateLimit-Remaining', remaining.toString());
  
  // Process request
  const order = await createOrder(req.body);
  res.json(order);
});
```

**Why this works across multiple servers:**
- Redis `INCR` is **atomic** (thread-safe)
- All app instances share same Redis
- Counter is synchronized across all servers

---

### Q8: Design a caching strategy for a social media feed

**Level:** Staff/Principal

**Answer:**

**Requirements:**
- User has 1000 followers
- Feed updates in real-time
- Support pagination
- High read:write ratio (100:1)

**Strategy: Hybrid approach**

**1. Cache recent posts (fan-out on write):**

```typescript
// When user creates post
async function createPost(userId: string, content: string) {
  // Save to database
  const post = await db.insert('posts', { userId, content });
  
  // Fan-out: Add to all followers' feeds
  const followers = await db.query(
    'SELECT follower_id FROM follows WHERE user_id = $1',
    [userId]
  );
  
  for (const follower of followers) {
    // Add post to feed cache (sorted set by timestamp)
    await redis.client.zAdd(
      `feed:${follower.follower_id}`,
      { score: Date.now(), member: post.id }
    );
    
    // Keep only latest 100 posts
    await redis.client.zRemRangeByRank(
      `feed:${follower.follower_id}`,
      0,
      -101  // Keep latest 100
    );
  }
  
  // Set expiration
  await redis.expire(`feed:${userId}`, 3600);
}

// Reading feed (fast!)
async function getFeed(userId: string, page: number = 1) {
  const key = `feed:${userId}`;
  
  // Get post IDs from sorted set (by timestamp)
  const postIds = await redis.client.zRevRange(
    key,
    (page - 1) * 20,
    page * 20 - 1
  );
  
  if (postIds.length === 0) {
    // Cache miss - build feed from database
    return await buildFeedFromDB(userId);
  }
  
  // Get post details from cache or DB
  const posts = await Promise.all(
    postIds.map(id => getPost(id))
  );
  
  return posts;
}
```

**2. Cache individual posts:**

```typescript
async function getPost(postId: string) {
  // Check cache
  const cached = await redis.get(`post:${postId}`);
  if (cached) return cached;
  
  // Cache miss
  const post = await db.query(
    'SELECT * FROM posts WHERE id = $1',
    [postId]
  );
  
  // Cache for 1 hour
  await redis.set(`post:${postId}`, post, 3600);
  
  return post;
}
```

**Key decisions:**
1. **Fan-out on write**: Pre-compute feeds (fast reads)
2. **Sorted sets**: Efficient pagination and ordering
3. **Limited cache**: Only recent 100 posts per feed
4. **Two-level cache**: Feed structure + individual posts
5. **TTL**: 1 hour expiration to handle edge cases

**Trade-offs:**
- **Pros**: Extremely fast reads (1-2ms)
- **Cons**: Slow writes for users with many followers
- **Optimization**: For celebrity accounts (1M+ followers), use pull model instead

---

**🎓 END OF MODULE M04**

Part 2 covered:
- ✅ All remaining methods (set, del, incr, etc.)
- ✅ Architecture diagrams
- ✅ 8 comprehensive interview questions
- ✅ Production best practices

**Completed: 4 of 27 modules! 🎉**

**Next module:** M05 - JWT Auth Deep Dive (shared/auth/jwt.ts)

Ready to continue or take a break?
