# M04: Redis Caching Deep Dive - PART 1

**File:** `shared/redis.ts` (129 lines)  
**Level:** Foundation  
**Prerequisites:** M01 (Logging), M03 (Database), Redis basics  
**Time to Master:** 3-4 hours

---

## 📖 SECTION 1: THEORY - Redis and Caching Fundamentals

### 1.1 What is Redis?

**Redis** = **RE**mote **DI**ctionary **S**erver

It's an **in-memory data store** that acts as:
- **Cache**: Store frequently accessed data
- **Session store**: Store user sessions
- **Message broker**: Pub/sub messaging
- **Rate limiter**: Track request counts
- **Leaderboard**: Sorted sets for rankings

**Real-World Analogy:**

Think of a library:

**Without Redis (Database only):**
- Every book request → Go to warehouse (slow)
- Popular books still in warehouse
- Everyone waits for warehouse retrieval
- **Problem:** Slow and wasteful!

**With Redis (Cache):**
- Popular books on front desk (fast access)
- Rarely requested books in warehouse
- 80% of requests served from front desk
- **Benefit:** Fast and efficient!

### 1.2 Why Caching is Critical

**Performance impact of caching:**

```
Without cache:
Database query: 50-100ms
At 1000 req/sec: 50-100 seconds of DB time per second
Result: Database overwhelmed ❌

With Redis cache:
Cache hit: 1-2ms (50x faster!)
Cache miss: 50-100ms (database query + cache store)
At 90% cache hit rate:
- 900 requests: 1-2ms (from cache)
- 100 requests: 100ms (from database)
Result: Database handles only 10% of load ✅
```

**Real production numbers:**

| Metric | Without Cache | With Redis Cache |
|--------|---------------|------------------|
| Response time | 100ms | 5ms |
| Database load | 1000 queries/sec | 100 queries/sec |
| Throughput | 500 req/sec | 5000 req/sec |
| Cost | $$$$ (large database) | $$ (small database + Redis) |

### 1.3 Cache Hit vs Cache Miss

**Cache Hit:** Data found in cache
```
User requests profile
    ↓
Check Redis
    ↓
Found! (Cache Hit)
    ↓
Return immediately (1-2ms)
```

**Cache Miss:** Data not in cache
```
User requests profile
    ↓
Check Redis
    ↓
Not found (Cache Miss)
    ↓
Query database (50-100ms)
    ↓
Store in Redis
    ↓
Return to user
```

**Cache hit ratio:**
```
Hit Rate = (Cache Hits / Total Requests) × 100%

Examples:
90% hit rate = 9 out of 10 requests served from cache
50% hit rate = Half requests hit cache (cache not effective)
99% hit rate = Almost all requests from cache (excellent!)
```

**Target hit rates:**
- **User profiles**: 90-95% (accessed frequently)
- **Product catalog**: 95-99% (rarely changes)
- **Search results**: 70-80% (many unique searches)
- **Session data**: 99%+ (accessed every request)

### 1.4 Cache Eviction Strategies

**What happens when Redis runs out of memory?**

Redis has **maxmemory** limit. When reached, it evicts (removes) keys based on policy:

**1. LRU (Least Recently Used)** - Default
- Removes keys that haven't been accessed recently
- Good for general caching

**2. LFU (Least Frequently Used)**
- Removes keys accessed least often
- Good for long-term caching

**3. TTL (Time To Live)**
- Removes keys closest to expiration
- Predictable eviction

**4. Random**
- Removes random keys
- Fast but unpredictable

**Our approach: TTL-based expiration**

```typescript
await redis.set('user:123', userData, 3600);  // Expires after 1 hour
```

Every cached item has an expiration time. Redis automatically removes expired keys.

### 1.5 Redis vs Memcached vs Database

**Comparison:**

| Feature | Redis | Memcached | Database |
|---------|-------|-----------|----------|
| **Speed** | 1-2ms | 1ms | 50-100ms |
| **Data Types** | Strings, Lists, Sets, Hashes | Only strings | All types |
| **Persistence** | Optional (can save to disk) | No | Yes |
| **Use Case** | Cache + more | Cache only | Permanent storage |
| **Complexity** | Medium | Low | High |
| **Max Value Size** | 512MB | 1MB | Unlimited |

**When to use each:**

**Redis:**
- General caching ✅
- Session storage ✅
- Rate limiting ✅
- Real-time leaderboards ✅
- Pub/sub messaging ✅

**Memcached:**
- Simple key-value caching
- When you need extreme simplicity
- Legacy systems

**Database:**
- Permanent data storage
- Complex queries (JOINs, aggregations)
- ACID transactions
- Large datasets

### 1.6 Common Caching Patterns

**1. Cache-Aside (Lazy Loading)**

Most common pattern, used in our code:

```typescript
// Check cache first
const cached = await redis.get('user:123');
if (cached) {
  return cached;  // Cache hit
}

// Cache miss - query database
const user = await db.query('SELECT * FROM users WHERE id = $1', [123]);

// Store in cache for next time
await redis.set('user:123', user, 3600);

return user;
```

**2. Write-Through**

Write to cache and database simultaneously:

```typescript
// Update database
await db.query('UPDATE users SET name = $1 WHERE id = $2', [name, userId]);

// Update cache
await redis.set(`user:${userId}`, updatedUser, 3600);
```

**3. Write-Behind (Write-Back)**

Write to cache first, sync to database later:

```typescript
// Write to cache immediately
await redis.set(`user:${userId}`, updatedUser, 3600);

// Queue database update (async)
queue.add('update-user', { userId, data: updatedUser });
```

**4. Refresh-Ahead**

Proactively refresh cache before expiration:

```typescript
const TTL = 3600;  // 1 hour
const REFRESH_THRESHOLD = 300;  // 5 minutes before expiration

const ttl = await redis.ttl('user:123');
if (ttl < REFRESH_THRESHOLD) {
  // Refresh cache in background
  refreshCacheInBackground('user:123');
}
```

---

## 🔍 SECTION 2: LINE-BY-LINE CODE ANALYSIS (Part 1)

### 2.1 Imports (Lines 1-2)

```typescript
import { createClient, RedisClientType } from 'redis';
import logger from './logger';
```

**Line 1: Redis imports**

- **`createClient`**: Factory function to create Redis client
- **`RedisClientType`**: TypeScript type for the client

**Why 'redis' package?**

The `redis` package (node-redis) is the official Redis client for Node.js:
- **Official**: Maintained by Redis team
- **TypeScript**: Full type support
- **Modern**: Promise-based API (async/await)
- **Features**: Pipelining, pub/sub, clustering

**Alternatives:**
- `ioredis`: More features, slightly more complex
- `redis-om`: Object mapping (ORM for Redis)

**RedisClientType:**

```typescript
// Used for typing
public client: RedisClientType | null = null;

// TypeScript knows what methods are available
this.client?.get(key)  // ✅ Valid
this.client?.invalidMethod()  // ❌ TypeScript error
```

### 2.2 RedisClient Class (Lines 4-6)

```typescript
class RedisClient {
  public client: RedisClientType | null = null;
  public isConnected = false;
```

**Why a class?**

Encapsulates Redis operations:
- `connect()` - Establish connection
- `get()`, `set()`, `del()` - Basic operations
- `exists()`, `incr()`, `expire()` - Advanced operations
- `ping()`, `disconnect()` - Health checks

**Line 5: client property**

```typescript
public client: RedisClientType | null = null;
```

**Why `| null`?**

Before calling `connect()`, client doesn't exist:

```typescript
const redis = new RedisClient();
redis.client  // null (not connected yet)

await redis.connect();
redis.client  // RedisClientType (connected)
```

**Why `public`?**

Allows direct access for advanced operations:

```typescript
// Basic operations (use wrapper methods)
await redis.get('key');

// Advanced operations (use client directly)
await redis.client?.sendCommand(['HGETALL', 'myhash']);
```

**Line 6: isConnected flag**

```typescript
public isConnected = false;
```

Tracks connection state to prevent duplicate connections:

```typescript
if (this.isConnected) {
  return this.client;  // Already connected
}
```

### 2.3 Connect Method (Lines 8-31)

This is the **most important** method - establishes Redis connection.

#### Lines 8-11: Connection Check

```typescript
async connect(): Promise<RedisClientType> {
  if (this.isConnected && this.client) {
    return this.client;
  }
```

**Why check first?**

Prevent creating multiple connections:

```typescript
// Without check
await redis.connect();  // Connection 1
await redis.connect();  // Connection 2 (duplicate!)
await redis.connect();  // Connection 3 (memory leak!)

// With check
await redis.connect();  // Connection 1
await redis.connect();  // Returns existing connection
await redis.connect();  // Returns existing connection
```

**Why check both conditions?**

```typescript
if (this.isConnected && this.client)
```

- `this.isConnected` - Boolean flag (fast check)
- `this.client` - Actual client exists (null check)

Both must be true for safe reuse.

#### Lines 14-18: Client Creation

```typescript
this.client = createClient({
  url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`,
  password: process.env.REDIS_PASSWORD || undefined,
  ...(process.env.NODE_ENV === 'production' && process.env.REDIS_TLS === 'true' && { socket: { tls: true } })
});
```

**Line 15: Connection URL**

```typescript
url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`
```

**URL format:**
```
redis://hostname:port

Examples:
redis://localhost:6379          (development)
redis://redis-cache.aws.com:6379  (production)
redis://10.0.1.50:6380          (custom port)
```

**Environment fallbacks:**

```typescript
REDIS_HOST || 'localhost'  // Development default
REDIS_PORT || 6379         // Redis default port
```

**Production example:**

```bash
# .env.production
REDIS_HOST=redis-primary.us-east-1.cache.amazonaws.com
REDIS_PORT=6379
REDIS_PASSWORD=super_secret_password
```

**Line 16: Password authentication**

```typescript
password: process.env.REDIS_PASSWORD || undefined,
```

**Why `|| undefined`?**

If `REDIS_PASSWORD` is not set:
- `|| undefined` - Pass undefined (no password)
- Without `|| undefined` - Pass empty string (authentication fails!)

```typescript
// Development (no password)
password: undefined  // ✅ Works

// Production (with password)
password: 'secret123'  // ✅ Works

// Wrong approach
password: process.env.REDIS_PASSWORD  // Could be empty string ❌
```

**Line 17: TLS configuration**

```typescript
...(process.env.NODE_ENV === 'production' && process.env.REDIS_TLS === 'true' && { socket: { tls: true } })
```

**Breakdown:**

```typescript
// Condition 1: Production environment
process.env.NODE_ENV === 'production'

// AND Condition 2: TLS enabled
process.env.REDIS_TLS === 'true'

// If both true: Spread this object
{ socket: { tls: true } }

// Result:
createClient({
  url: '...',
  password: '...',
  socket: { tls: true }  // ← Added only in production with TLS
});
```

**Why TLS?**

**Development:**
- Local Redis, no encryption needed
- TLS adds overhead (slower)

**Production:**
- Redis on remote server (AWS ElastiCache, Azure Cache)
- TLS encrypts data in transit (security)
- Required for compliance (PCI-DSS, HIPAA)

**TLS example:**

```bash
# .env.production
NODE_ENV=production
REDIS_HOST=redis.example.com
REDIS_TLS=true

# Connection uses TLS
# redis://redis.example.com:6379 (encrypted)
```

#### Lines 20-23: Event Handlers

```typescript
this.client.on('connect', () => logger.info('Redis client connecting...'));
this.client.on('ready', () => { this.isConnected = true; logger.info('Redis client connected and ready'); });
this.client.on('error', (err: Error) => { logger.error('Redis client error:', { error: err.message }); this.isConnected = false; });
this.client.on('end', () => { logger.warn('Redis client connection closed'); this.isConnected = false; });
```

**Event lifecycle:**

```
1. 'connect' → TCP connection established
       ↓
2. 'ready' → Authentication complete, ready for commands
       ↓
   (Normal operation)
       ↓
3. 'error' → Something went wrong
   OR
   'end' → Connection closed gracefully
```

**Line 20: 'connect' event**

```typescript
this.client.on('connect', () => logger.info('Redis client connecting...'));
```

**When it fires:**
- TCP connection to Redis server established
- Before authentication

**Purpose:**
- Log connection attempts
- Track connection timing

**Line 21: 'ready' event**

```typescript
this.client.on('ready', () => { 
  this.isConnected = true; 
  logger.info('Redis client connected and ready'); 
});
```

**When it fires:**
- Authentication successful
- Client ready to execute commands

**Critical:** Sets `isConnected = true`

**Line 22: 'error' event**

```typescript
this.client.on('error', (err: Error) => { 
  logger.error('Redis client error:', { error: err.message }); 
  this.isConnected = false; 
});
```

**When it fires:**
- Connection failed
- Network issues
- Authentication failed
- Redis server down

**Example errors:**
```
"ECONNREFUSED" - Redis not running
"WRONGPASS" - Invalid password
"READONLY" - Replica in read-only mode
```

**Sets `isConnected = false`** to prevent using broken connection.

**Production pattern:**

```typescript
this.client.on('error', (err: Error) => {
  logger.error('Redis error', { error: err.message });
  this.isConnected = false;
  
  // Alert on critical errors
  if (err.message.includes('ECONNREFUSED')) {
    alertOncall('Redis server down');
  }
  
  // Attempt reconnection
  setTimeout(() => this.connect(), 5000);
});
```

**Line 23: 'end' event**

```typescript
this.client.on('end', () => { 
  logger.warn('Redis client connection closed'); 
  this.isConnected = false; 
});
```

**When it fires:**
- `disconnect()` called
- Server closed connection
- Network interruption

**Difference from 'error':**
- **'error'**: Unexpected failure
- **'end'**: Expected/graceful closure

#### Lines 25-30: Connection and Error Handling

```typescript
await this.client.connect();
return this.client;
} catch (error: any) {
  logger.error('Failed to connect to Redis:', { error: error.message });
  throw error;
}
```

**Line 25: Establish connection**

```typescript
await this.client.connect();
```

**What this does:**
1. Opens TCP socket to Redis
2. Authenticates (if password provided)
3. Waits for 'ready' event
4. Returns when ready

**Async/await:**

```typescript
// Without await (wrong)
this.client.connect();
return this.client;  // ❌ Returns before connected!

// With await (correct)
await this.client.connect();
return this.client;  // ✅ Returns after connected
```

**Line 26: Return client**

```typescript
return this.client;
```

Returns the connected client for chaining:

```typescript
const client = await redis.connect();
await client.set('key', 'value');
```

**Lines 27-30: Error handling**

```typescript
} catch (error: any) {
  logger.error('Failed to connect to Redis:', { error: error.message });
  throw error;
}
```

**Why log and re-throw?**

1. **Log**: Capture connection failure in logs
2. **Re-throw**: Let caller handle error

**Example errors:**

```json
{
  "level": "error",
  "message": "Failed to connect to Redis",
  "error": "getaddrinfo ENOTFOUND redis.example.com"
}
```

**Caller handling:**

```typescript
try {
  await redis.connect();
} catch (err) {
  // Redis down - use degraded mode
  logger.warn('Redis unavailable, running without cache');
  // Application continues without cache
}
```

### 2.4 Get Method (Lines 33-41)

Retrieves cached data from Redis.

```typescript
async get<T = any>(key: string): Promise<T | null> {
  try {
    const data = await this.client?.get(key);
    return data ? JSON.parse(data) : null;
  } catch (error: any) {
    logger.error('Redis GET error:', { key, error: error.message });
    return null;
  }
}
```

**Line 33: Method signature**

```typescript
async get<T = any>(key: string): Promise<T | null>
```

**Generic type `<T>`:**

```typescript
interface User {
  id: number;
  email: string;
}

// Type-safe retrieval
const user = await redis.get<User>('user:123');
// user is User | null

if (user) {
  console.log(user.email);  // ✅ TypeScript knows .email exists
}
```

**Return type `T | null`:**
- `T` - Data found in cache
- `null` - Cache miss or error

**Line 35: Optional chaining**

```typescript
const data = await this.client?.get(key);
```

**Why `?.` (optional chaining)?**

`this.client` might be `null` (before connection):

```typescript
// Without optional chaining
const data = await this.client.get(key);
// ❌ Error if client is null

// With optional chaining
const data = await this.client?.get(key);
// ✅ Returns undefined if client is null
```

**What `get(key)` returns:**

```typescript
await client.get('user:123')
// Returns: '{"id":123,"email":"john@example.com"}'
// (JSON string, not object!)
```

**Line 36: Parse JSON**

```typescript
return data ? JSON.parse(data) : null;
```

**Why parse?**

Redis stores everything as **strings**. We store objects as JSON strings:

```typescript
// When storing
const user = { id: 123, email: 'john@example.com' };
await redis.set('user:123', user);  // Internally: JSON.stringify(user)

// When retrieving
const data = await client.get('user:123');
// data = '{"id":123,"email":"john@example.com"}' (string!)

const user = JSON.parse(data);
// user = { id: 123, email: 'john@example.com' } (object!)
```

**Ternary breakdown:**

```typescript
data ? JSON.parse(data) : null

// If data exists: Parse and return
// If data is null/undefined: Return null (cache miss)
```

**Lines 37-40: Error handling**

```typescript
} catch (error: any) {
  logger.error('Redis GET error:', { key, error: error.message });
  return null;
}
```

**Why return `null` on error?**

**Graceful degradation** - cache failure shouldn't break the app:

```typescript
// In application code
const user = await redis.get('user:123');
if (!user) {
  // Cache miss OR cache error → Query database
  user = await db.query('SELECT * FROM users WHERE id = $1', [123]);
}
```

**Common errors:**
- Network timeout
- Redis server down
- Invalid JSON in cache (corrupt data)

**Example log:**

```json
{
  "level": "error",
  "message": "Redis GET error",
  "key": "user:123",
  "error": "Connection timeout"
}
```

---

**🎓 END OF PART 1**

Part 1 covered:
- ✅ Theory: What is Redis and why caching is critical
- ✅ Cache patterns and eviction strategies
- ✅ Line-by-line: Imports, class, connect() method (lines 1-31)
- ✅ Line-by-line: get() method (lines 33-41)

**📌 Continue to M04-REDIS-DEEP-DIVE-PART2.md for:**
- 🔍 set(), del(), and other methods (lines 43-125)
- 🏗️ Architecture diagrams
- 🎯 Interview questions
- 💡 Best practices
- ⚡ Real-world scenarios
- 🧪 Hands-on exercises
