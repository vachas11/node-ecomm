# M08: Token Blacklist Deep Dive

**File:** `shared/auth/blacklist.ts` (100 lines)  
**Level:** Security  
**Prerequisites:** M04 (Redis), M05 (JWT Auth), Token revocation concepts  
**Time to Master:** 2-3 hours

---

## 📖 SECTION 1: THEORY - Token Blacklisting Fundamentals

### 1.1 What is Token Blacklisting?

**Token blacklisting** = Maintaining a list of revoked tokens that should no longer be accepted.

**Real-World Analogy:**

Think of a **hotel key card**:

**Without blacklisting:**
- Guest checks out
- Key card still works (until natural expiration)
- Guest can re-enter room! ❌
- **Problem:** No way to revoke access immediately

**With blacklisting:**
- Guest checks out
- Front desk adds card to "do not accept" list
- Card reader checks list
- Card rejected at door ✅
- **Benefit:** Instant revocation!

### 1.2 Why Token Blacklisting is Necessary

**Problem: JWTs are stateless**

```typescript
// Traditional session-based auth
// User logs out → Delete session from database
await db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
// Session gone, user logged out ✅

// JWT-based auth
// User logs out → ??? Token still valid!
const token = jwt.sign({ userId: 123 }, secret, { expiresIn: '15m' });
// Token is self-contained, server doesn't track it
// Token will work until it expires (15 min) ❌
```

**Scenarios requiring immediate revocation:**

**1. User logout**
```typescript
// User clicks "Log out"
// Without blacklist: Token works for 15 more minutes ❌
// With blacklist: Token revoked immediately ✅
```

**2. Password change**
```typescript
// User changes password (security concern)
// Without blacklist: Old tokens still work ❌
// With blacklist: Revoke all existing tokens ✅
```

**3. Account compromise**
```typescript
// Admin detects suspicious activity
// Without blacklist: Can't stop attacker ❌
// With blacklist: Revoke all user's tokens ✅
```

**4. Token theft**
```typescript
// User reports "someone accessed my account"
// Without blacklist: Stolen token works until expiration ❌
// With blacklist: Revoke stolen token immediately ✅
```

**5. Role/permission change**
```typescript
// Admin removes user's admin privileges
// Without blacklist: Old admin token still works ❌
// With blacklist: Revoke token, force re-login with new role ✅
```

### 1.3 Blacklist Implementation Strategies

**Strategy 1: Blacklist Individual Tokens (Our Approach)**

```typescript
// Store each revoked token's JTI
blacklist:a3f8b9c2-d1e4-f7a8-b5c9 = 1  (expires in 15 min)
blacklist:b4g9c0d3-e2f5-a8b1-c6d9 = 1  (expires in 15 min)

// Pros:
// - Fine-grained control (revoke specific tokens)
// - Memory efficient (only blacklisted tokens)
// - Auto-cleanup (TTL based on token expiration)

// Cons:
// - Lookup on every request (Redis query)
// - Can't revoke all user tokens at once easily
```

**Strategy 2: Token Version Number**

```typescript
// Store version in database
interface User {
  id: number;
  tokenVersion: number;  // Increment on revocation
}

// Include in token
const token = jwt.sign({ 
  userId: 123, 
  tokenVersion: 5 
}, secret);

// Verify version matches
const decoded = jwt.verify(token, secret);
const user = await db.query('SELECT tokenVersion FROM users WHERE id = $1', [decoded.userId]);
if (decoded.tokenVersion !== user.tokenVersion) {
  throw new Error('Token revoked');
}

// Revoke all user tokens
await db.query('UPDATE users SET tokenVersion = tokenVersion + 1 WHERE id = $1', [userId]);

// Pros:
// - Revoke all user tokens with one query
// - No Redis needed
// - Handles compromised accounts well

// Cons:
// - Database query on every request (slow)
// - Can't revoke individual tokens
// - Can't restore accidentally revoked tokens
```

**Strategy 3: Allowlist (Whitelist)**

```typescript
// Store only valid tokens (opposite of blacklist)
valid_tokens:user:123 = Set([jti1, jti2, jti3])

// Check if token in allowlist
if (!allowlist.includes(decoded.jti)) {
  throw new Error('Token not valid');
}

// Pros:
// - Default deny (more secure)
// - Easy to revoke (remove from set)

// Cons:
// - Must store ALL active tokens (high memory)
// - Manual cleanup needed
// - Doesn't scale well
```

**Comparison:**

| Strategy | Lookup Speed | Memory | Revoke Individual | Revoke All | Scale |
|----------|--------------|--------|-------------------|------------|-------|
| **Blacklist** | Fast (Redis) | Low | ✅ Yes | ❌ Hard | Excellent |
| **Version** | Slow (DB) | Very Low | ❌ No | ✅ Easy | Good |
| **Allowlist** | Fast (Redis) | High | ✅ Yes | ✅ Easy | Poor |

**Our choice: Blacklist (Strategy 1)**

Why?
- Fast lookup (Redis ~1ms)
- Low memory (only revoked tokens)
- Auto-cleanup with TTL
- Good balance of features

### 1.4 TTL (Time To Live) Strategy

**Key insight: Blacklist entries don't need to live forever**

```typescript
// Token expires in 15 minutes
const token = jwt.sign(payload, secret, { expiresIn: '15m' });

// Blacklist entry should also expire in 15 minutes
await redis.setEx(`blacklist:${jti}`, 900, '1');  // 900s = 15 min

// After 15 minutes:
// - Token expired naturally (JWT verify fails)
// - Blacklist entry deleted (Redis TTL)
// - Memory freed automatically ✅
```

**Why match TTL to token expiration?**

```typescript
// Scenario: Token blacklisted at 10:00, expires at 10:15

// 10:00-10:15: Token not expired yet
// → Need blacklist entry to block it

// After 10:15: Token expired
// → Blacklist entry no longer needed
// → Redis deletes it automatically
```

**Memory calculation:**

```typescript
// Without TTL (keep forever):
// 1M users × 10 tokens each = 10M entries
// 10M × 100 bytes = 1GB memory ❌

// With TTL (auto-cleanup):
// Only recently revoked tokens stored
// ~1% of users revoke at any time
// 100k entries × 100 bytes = 10MB memory ✅
```

### 1.5 Blacklist Performance Considerations

**Lookup overhead:**

```typescript
// Without blacklist:
// 1. Verify JWT signature (~1ms)
// 2. Check expiration (instant)
// Total: ~1ms

// With blacklist:
// 1. Verify JWT signature (~1ms)
// 2. Check expiration (instant)
// 3. Check Redis blacklist (~1ms)
// Total: ~2ms

// 100% overhead, but acceptable trade-off for security
```

**Optimization: Skip blacklist for low-security endpoints**

```typescript
// High security (always check blacklist)
app.delete('/api/users/:id', authenticate({ checkBlacklist: true }), deleteUser);

// Low security (skip for performance)
app.get('/api/public/posts', authenticate({ checkBlacklist: false }), getPosts);
```

**Optimization: Batch blacklist checks**

```typescript
// ❌ BAD: Check each token individually
for (const token of tokens) {
  await isBlacklisted(token.jti);  // N Redis queries
}

// ✅ GOOD: Batch check with pipeline
const pipeline = redis.pipeline();
tokens.forEach(t => pipeline.exists(`blacklist:${t.jti}`));
const results = await pipeline.exec();  // 1 Redis round-trip
```

### 1.6 Security Considerations

**1. Don't expose which tokens are blacklisted**

```typescript
// ❌ BAD: Specific error message
if (isBlacklisted(jti)) {
  throw new Error('This specific token has been revoked');
}
// Attacker learns: Token was valid, but revoked (info leak)

// ✅ GOOD: Generic error message
if (isBlacklisted(jti)) {
  throw new UnauthorizedError('Invalid token');
}
// Same error as expired/invalid token (no info leak)
```

**2. Rate limit blacklist checks**

```typescript
// Attacker tries to enumerate blacklisted tokens
for (let i = 0; i < 1000000; i++) {
  await isBlacklisted(randomJTI());
}

// Solution: Rate limit authentication endpoint
app.use('/api', apiRateLimiter);
```

**3. Log blacklist additions**

```typescript
// Security audit trail
logger.info('Token blacklisted', {
  jti: jti.substring(0, 8),  // Don't log full JTI
  userId,
  reason: 'user_logout',
  timestamp: Date.now()
});
```

---

## 🔍 SECTION 2: LINE-BY-LINE CODE ANALYSIS

### 2.1 Imports (Lines 1-2)

```typescript
import redisClient from '../redis';
import logger from '../logger';
```

**Line 1:** Redis client from M04 - for storing blacklist entries.

**Line 2:** Winston logger from M01 - for audit logging.

### 2.2 addToBlacklist Function (Lines 4-22)

```typescript
export const addToBlacklist = async (jti: string, ttlSeconds: number): Promise<boolean> => {
  try {
    if (!jti) throw new Error('JTI is required for blacklisting');

    if (!ttlSeconds || ttlSeconds <= 0) {
      logger.warn('Invalid TTL for blacklist, using default 15 minutes', { jti });
      ttlSeconds = 900;
    }

    const key = `blacklist:${jti}`;
    await redisClient.client?.setEx(key, ttlSeconds, '1');

    logger.info('Token added to blacklist', { jti: jti.substring(0, 8) + '...', ttl: ttlSeconds });
    return true;
  } catch (error: any) {
    logger.error('Failed to add token to blacklist', { jti: jti?.substring(0, 8) + '...', error: error.message });
    return false;
  }
};
```

**Purpose:** Add a token to the blacklist with automatic expiration.

#### Line 6: Validate JTI

```typescript
if (!jti) throw new Error('JTI is required for blacklisting');
```

**Why validate?**

```typescript
// Without validation:
await addToBlacklist('', 900);
// Creates key: blacklist: (empty JTI!)
// All tokens would match this ❌

// With validation:
await addToBlacklist('', 900);
// Throws error ✅
```

#### Lines 8-11: Validate and Default TTL

```typescript
if (!ttlSeconds || ttlSeconds <= 0) {
  logger.warn('Invalid TTL for blacklist, using default 15 minutes', { jti });
  ttlSeconds = 900;
}
```

**Why validate TTL?**

```typescript
// Invalid values:
ttlSeconds = 0     // Token never blocked
ttlSeconds = -100  // Invalid Redis TTL
ttlSeconds = null  // TypeError

// All fallback to 900 seconds (15 minutes)
```

**Why 15 minutes default?**

Matches default access token expiration from M05.

**Why warn log?**

```json
{
  "level": "warn",
  "message": "Invalid TTL for blacklist, using default 15 minutes",
  "jti": "a3f8b9c2...",
  "timestamp": "2023-01-15T10:30:00.000Z"
}
```

**Helps debug:**
- Developer forgot to calculate TTL
- Token expiration mismatch
- Logic error in calling code

#### Line 13: Generate Key

```typescript
const key = `blacklist:${jti}`;
```

**Redis key format:**

```redis
blacklist:a3f8b9c2-d1e4-f7a8-b5c9-d2e6f3a7b1c4
```

**Why prefix `blacklist:`?**

**Namespace organization:**

```redis
# Blacklist keys
blacklist:a3f8b9c2-d1e4-f7a8-b5c9
blacklist:b4g9c0d3-e2f5-a8b1-c6d9

# Other keys
ratelimit:192.168.1.1
cache:user:123
session:abc123

# Easy to:
# - Find all blacklisted tokens: KEYS blacklist:*
# - Flush blacklist: DEL blacklist:* (dev only)
# - Monitor blacklist size: COUNT blacklist:*
```

#### Line 14: Set with Expiry

```typescript
await redisClient.client?.setEx(key, ttlSeconds, '1');
```

**Redis SETEX command:**

```redis
SETEX blacklist:a3f8b9c2-d1e4-f7a8 900 "1"
      ↑ key                         ↑   ↑
                                  TTL  value
```

**Why value `'1'`?**

```typescript
// We only care if key exists, not the value
// Could be any value: '1', 'true', 'revoked'
// Using '1' is convention (small, simple)
```

**Atomic operation:**

```typescript
// SETEX is atomic (set + expire in one command)
// vs non-atomic:
await redis.set(key, '1');
await redis.expire(key, ttlSeconds);
// Problem: If server crashes between calls,
// key exists forever (no TTL) ❌

// SETEX avoids this ✅
```

**Optional chaining `?.`:**

```typescript
redisClient.client?.setEx(...)

// If Redis client not initialized:
// → Returns undefined (no error)
// → Function returns false (graceful failure)
```

#### Line 16: Success Log

```typescript
logger.info('Token added to blacklist', { jti: jti.substring(0, 8) + '...', ttl: ttlSeconds });
```

**Why `jti.substring(0, 8) + '...'`?**

**Security: Don't log full JTI**

```typescript
// ❌ BAD: Full JTI in logs
logger.info('Token blacklisted', { 
  jti: 'a3f8b9c2-d1e4-f7a8-b5c9-d2e6f3a7b1c4' 
});
// If logs compromised, attacker can test if tokens blacklisted

// ✅ GOOD: Truncated JTI
logger.info('Token blacklisted', { 
  jti: 'a3f8b9c2...' 
});
// Enough to identify in debugging
// Not enough to exploit
```

**Audit log example:**

```json
{
  "level": "info",
  "message": "Token added to blacklist",
  "jti": "a3f8b9c2...",
  "ttl": 900,
  "timestamp": "2023-01-15T10:30:00.000Z"
}
```

#### Lines 17-21: Error Handling

```typescript
} catch (error: any) {
  logger.error('Failed to add token to blacklist', { jti: jti?.substring(0, 8) + '...', error: error.message });
  return false;
}
```

**Return `false` instead of throwing:**

```typescript
// Graceful failure pattern
const success = await addToBlacklist(jti, ttl);
if (!success) {
  logger.warn('Could not blacklist token, but continuing...');
}

// vs throwing (would crash request)
try {
  await addToBlacklist(jti, ttl);
} catch (err) {
  // Request fails ❌
}
```

**When is this error caught?**

- Redis connection lost
- Network timeout
- Out of memory
- Invalid command

### 2.3 isBlacklisted Function (Lines 24-40)

```typescript
export const isBlacklisted = async (jti: string): Promise<boolean> => {
  try {
    if (!jti) return false;

    const key = `blacklist:${jti}`;
    const exists = await redisClient.exists(key);

    if (exists) {
      logger.debug('Blacklisted token detected', { jti: jti.substring(0, 8) + '...' });
    }

    return exists;
  } catch (error: any) {
    logger.error('Failed to check token blacklist', { jti: jti?.substring(0, 8) + '...', error: error.message });
    return false;
  }
};
```

**Purpose:** Check if a token is blacklisted.

**Most called function** - runs on every authenticated request!

#### Line 26: Early Return for Empty JTI

```typescript
if (!jti) return false;
```

**Defensive programming:**

```typescript
// If JTI missing (shouldn't happen):
// Treat as not blacklisted (allow request)
// Better than crashing
```

#### Line 29: Check Existence

```typescript
const exists = await redisClient.exists(key);
```

**Redis EXISTS command:**

```redis
EXISTS blacklist:a3f8b9c2-d1e4-f7a8
→ Returns 1 if exists, 0 if not
```

**Fast operation:**
- O(1) complexity
- ~1ms latency
- No data transfer (just yes/no)

#### Lines 31-33: Debug Log

```typescript
if (exists) {
  logger.debug('Blacklisted token detected', { jti: jti.substring(0, 8) + '...' });
}
```

**Why `debug` level?**

```typescript
// Happens often (every blocked request)
// Don't spam logs with `info`
// Only show in debug mode

// Enable debug logging:
logger.level = 'debug';
```

**Security event:**

```json
{
  "level": "debug",
  "message": "Blacklisted token detected",
  "jti": "a3f8b9c2...",
  "timestamp": "2023-01-15T10:30:00.000Z"
}
```

**Use case:**
- Investigate suspicious activity
- Track how often blacklisted tokens are used
- Detect token replay attacks

#### Line 35: Return Boolean

```typescript
return exists;
```

**Converts Redis result:**

```typescript
exists = 1  →  return true
exists = 0  →  return false
```

#### Lines 36-39: Error Handling

```typescript
} catch (error: any) {
  logger.error('Failed to check token blacklist', { jti: jti?.substring(0, 8) + '...', error: error.message });
  return false;
}
```

**Return `false` on error:**

```typescript
// Redis down → Assume not blacklisted
// Better to allow request than block legitimate user

// Trade-off:
// Security: Revoked tokens might work during Redis outage ❌
// Availability: Users can still access system ✅
```

**Why this trade-off?**

```typescript
// Most requests: Legitimate users with valid tokens
// Few requests: Attackers with revoked tokens

// Redis down:
// Block all → 100% of users affected ❌
// Allow all → <1% security issue (attackers) ✅
```

### 2.4 removeFromBlacklist Function (Lines 42-55)

```typescript
export const removeFromBlacklist = async (jti: string): Promise<boolean> => {
  try {
    if (!jti) return false;

    const key = `blacklist:${jti}`;
    await redisClient.del(key);

    logger.info('Token removed from blacklist', { jti: jti.substring(0, 8) + '...' });
    return true;
  } catch (error: any) {
    logger.error('Failed to remove token from blacklist', { jti: jti?.substring(0, 8) + '...', error: error.message });
    return false;
  }
};
```

**Purpose:** Remove a token from the blacklist (undo revocation).

**Use cases:**

```typescript
// 1. Accidental revocation
// Admin accidentally revoked wrong token
await removeFromBlacklist(jti);

// 2. Testing
// Test blacklist functionality, then clean up
await addToBlacklist(jti, 900);
// ... run tests ...
await removeFromBlacklist(jti);

// 3. Customer support
// User: "I can't log in!"
// Support: "Let me un-revoke your token"
await removeFromBlacklist(jti);
```

#### Line 47: Delete Key

```typescript
await redisClient.del(key);
```

**Redis DEL command:**

```redis
DEL blacklist:a3f8b9c2-d1e4-f7a8
→ Returns 1 if deleted, 0 if didn't exist
```

**Idempotent:**

```typescript
// Call multiple times = same result
await removeFromBlacklist(jti);  // Deletes key
await removeFromBlacklist(jti);  // Key already gone, no error ✅
```

### 2.5 clearUserTokens Function (Lines 57-70)

```typescript
export const clearUserTokens = async (userId: number): Promise<number> => {
  try {
    if (!userId) throw new Error('User ID is required');

    const pattern = `user:${userId}:token:*`;
    const count = await redisClient.delPattern(pattern);

    logger.info('All user tokens cleared', { userId, count });
    return count;
  } catch (error: any) {
    logger.error('Failed to clear user tokens', { userId, error: error.message });
    return 0;
  }
};
```

**Purpose:** Revoke all tokens for a specific user.

**Use cases:**

```typescript
// 1. Account compromise
// Security team: "User account hacked!"
await clearUserTokens(userId);
// All devices logged out ✅

// 2. Password change
app.post('/auth/change-password', async (req, res) => {
  await updatePassword(userId, newPassword);
  await clearUserTokens(userId);  // Force re-login everywhere
  res.json({ message: 'Password changed, please login again' });
});

// 3. Role change
// Admin removes user's privileges
await db.query('UPDATE users SET role = $1 WHERE id = $2', ['user', userId]);
await clearUserTokens(userId);  // Force re-login to get new role
```

#### Line 61: Pattern Matching

```typescript
const pattern = `user:${userId}:token:*`;
```

**Redis key pattern:**

```redis
user:123:token:a3f8b9c2-d1e4-f7a8-b5c9
user:123:token:b4g9c0d3-e2f5-a8b1-c6d9
user:123:token:c5h0d4e3-f3g6-b9c2-d7e0

Pattern: user:123:token:*
Matches all 3 keys ✅
```

**Why this pattern?**

```typescript
// Assumes tokens stored as:
// user:{userId}:token:{jti}

// Our current implementation stores as:
// blacklist:{jti}

// This function expects different key structure!
// Likely for future feature: Track active tokens per user
```

#### Line 62: Delete Pattern

```typescript
const count = await redisClient.delPattern(pattern);
```

**From M04 Redis module:**

```typescript
// Finds all keys matching pattern and deletes them
async delPattern(pattern: string): Promise<number> {
  const keys = await this.client.keys(pattern);
  if (keys.length === 0) return 0;
  
  for (const key of keys) {
    await this.client.del(key);
  }
  
  return keys.length;
}
```

**⚠️ Production warning:**

```typescript
// KEYS command is blocking!
// Don't use in production with many keys

// Better: Use SCAN for production
let cursor = '0';
let count = 0;
do {
  const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
  cursor = nextCursor;
  if (keys.length > 0) {
    await redis.del(...keys);
    count += keys.length;
  }
} while (cursor !== '0');
```

#### Line 64: Log Result

```typescript
logger.info('All user tokens cleared', { userId, count });
```

**Audit trail:**

```json
{
  "level": "info",
  "message": "All user tokens cleared",
  "userId": 123,
  "count": 5,
  "timestamp": "2023-01-15T10:30:00.000Z"
}
```

**Important security event:**
- Who revoked all user's tokens?
- When?
- How many tokens cleared?

### 2.6 addBulkToBlacklist Function (Lines 72-88)

```typescript
export const addBulkToBlacklist = async (tokens: Array<{ jti: string; ttl: number }>): Promise<number> => {
  try {
    if (!Array.isArray(tokens) || tokens.length === 0) return 0;

    let successCount = 0;
    for (const { jti, ttl } of tokens) {
      const success = await addToBlacklist(jti, ttl);
      if (success) successCount++;
    }

    logger.info('Bulk blacklist operation completed', { total: tokens.length, successful: successCount });
    return successCount;
  } catch (error: any) {
    logger.error('Bulk blacklist operation failed', { error: error.message });
    return 0;
  }
};
```

**Purpose:** Blacklist multiple tokens at once.

**Use cases:**

```typescript
// 1. Bulk user logout
// Company policy: Force re-login for all employees
const allTokens = await getAllActiveTokens();
await addBulkToBlacklist(allTokens);

// 2. Security incident
// Detected breach, revoke all tokens issued in last hour
const recentTokens = await getTokensIssuedSince(Date.now() - 3600000);
await addBulkToBlacklist(recentTokens);

// 3. Maintenance window
// "Logging out all users for maintenance in 5 minutes"
const allUserTokens = await getAllUserTokens();
await addBulkToBlacklist(allUserTokens);
```

#### Line 74: Validate Input

```typescript
if (!Array.isArray(tokens) || tokens.length === 0) return 0;
```

**Two checks:**

```typescript
// Check 1: Is it an array?
!Array.isArray(tokens)

// Prevents:
addBulkToBlacklist(null)  // TypeError
addBulkToBlacklist({jti: '...'})  // Not an array

// Check 2: Has items?
tokens.length === 0

// Early return if nothing to do
```

#### Lines 76-79: Sequential Processing

```typescript
let successCount = 0;
for (const { jti, ttl } of tokens) {
  const success = await addToBlacklist(jti, ttl);
  if (success) successCount++;
}
```

**Why sequential (`for` loop) not parallel?**

```typescript
// Sequential (current):
for (const token of tokens) {
  await addToBlacklist(token.jti, token.ttl);
}
// Processes one at a time
// Safe, predictable

// Parallel (alternative):
await Promise.all(tokens.map(t => addToBlacklist(t.jti, t.ttl)));
// Processes all at once
// Faster but might overwhelm Redis
```

**Performance comparison:**

```typescript
// 100 tokens, 1ms per Redis call

// Sequential:
// 100 × 1ms = 100ms total

// Parallel:
// 100 calls simultaneously
// ~5-10ms total (network latency dominates)

// Trade-off:
// Parallel: 10x faster but risks Redis overload
// Sequential: Slower but safer for production
```

**Improvement for production:**

```typescript
// Batch in chunks
async function addBulkToBlacklistOptimized(tokens) {
  const CHUNK_SIZE = 100;
  let successCount = 0;
  
  for (let i = 0; i < tokens.length; i += CHUNK_SIZE) {
    const chunk = tokens.slice(i, i + CHUNK_SIZE);
    
    // Process chunk in parallel
    const results = await Promise.all(
      chunk.map(t => addToBlacklist(t.jti, t.ttl))
    );
    
    successCount += results.filter(Boolean).length;
  }
  
  return successCount;
}

// 10,000 tokens:
// 100 chunks × 10ms = 1 second total
// vs 10 seconds sequential
// vs Redis overload if all parallel
```

### 2.7 getBlacklistStats Function (Lines 90-99)

```typescript
export const getBlacklistStats = async (): Promise<{ totalBlacklisted: number; pattern: string; error?: string }> => {
  try {
    const pattern = 'blacklist:*';
    const keys = await redisClient.client?.keys(pattern);
    return { totalBlacklisted: keys?.length || 0, pattern };
  } catch (error: any) {
    logger.error('Failed to get blacklist stats', { error: error.message });
    return { totalBlacklisted: 0, pattern: 'blacklist:*', error: error.message };
  }
};
```

**Purpose:** Get statistics about blacklisted tokens.

**Use cases:**

```typescript
// 1. Monitoring dashboard
app.get('/admin/stats', async (req, res) => {
  const stats = await getBlacklistStats();
  res.json({
    blacklistedTokens: stats.totalBlacklisted,
    // ...other stats
  });
});

// 2. Alerting
const stats = await getBlacklistStats();
if (stats.totalBlacklisted > 10000) {
  alertOncall('High number of blacklisted tokens: ' + stats.totalBlacklisted);
}

// 3. Health check
const stats = await getBlacklistStats();
if (stats.error) {
  // Redis issue
  return { status: 'unhealthy', reason: 'Blacklist unavailable' };
}
```

#### Line 93: Redis KEYS Command

```typescript
const keys = await redisClient.client?.keys(pattern);
```

**⚠️ DANGEROUS in production!**

```redis
KEYS blacklist:*
```

**Why dangerous?**

```typescript
// KEYS is O(N) - blocks Redis while scanning
// 1 million keys = 1 second blocked
// All other requests wait ❌

// Production alternative: Use SCAN
let cursor = '0';
const allKeys = [];
do {
  const [nextCursor, keys] = await redis.scan(
    cursor, 
    'MATCH', 
    'blacklist:*', 
    'COUNT', 
    1000
  );
  cursor = nextCursor;
  allKeys.push(...keys);
} while (cursor !== '0');

return { totalBlacklisted: allKeys.length, pattern };
```

**When KEYS is okay:**

- Development environment
- Small datasets (<10,000 keys)
- Admin tools (infrequent use)
- Debugging

---

## 🎯 SECTION 3: REAL-WORLD USAGE EXAMPLES

### 3.1 User Logout Flow

```typescript
app.post('/auth/logout', authenticate(), async (req, res) => {
  const { jti } = req.user;
  const token = req.token;
  
  // Calculate remaining TTL
  const decoded = jwt.decode(token) as any;
  const now = Math.floor(Date.now() / 1000);
  const ttl = decoded.exp - now;
  
  // Blacklist token
  const success = await addToBlacklist(jti, ttl);
  
  if (!success) {
    logger.warn('Failed to blacklist token on logout', { userId: req.user.userId, jti });
    // Continue anyway (token expires naturally)
  }
  
  res.json({ message: 'Logged out successfully' });
});
```

### 3.2 Password Change Flow

```typescript
app.post('/auth/change-password', authenticate(), async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  
  // Verify current password
  const user = await db.query('SELECT * FROM users WHERE id = $1', [req.user.userId]);
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    return res.status(401).json({ error: 'Current password incorrect' });
  }
  
  // Update password
  const newHash = await bcrypt.hash(newPassword, 10);
  await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.user.userId]);
  
  // Blacklist current token (force re-login)
  const decoded = jwt.decode(req.token) as any;
  const ttl = decoded.exp - Math.floor(Date.now() / 1000);
  await addToBlacklist(req.user.jti, ttl);
  
  // Note: Can't revoke ALL user's tokens with current implementation
  // Would need to store all JTIs per user
  
  res.json({ 
    message: 'Password changed successfully. Please login again.',
    requiresRelogin: true
  });
});
```

### 3.3 Admin Force Logout

```typescript
app.post('/admin/users/:userId/force-logout', 
  authenticate(), 
  authorize('admin'),
  async (req, res) => {
    const { userId } = req.params;
    
    // Get all active tokens for user (from database or Redis)
    const activeTokens = await db.query(
      'SELECT jti, expires_at FROM active_tokens WHERE user_id = $1',
      [userId]
    );
    
    // Blacklist all tokens
    const tokensToBlacklist = activeTokens.map(t => ({
      jti: t.jti,
      ttl: Math.floor((t.expires_at.getTime() - Date.now()) / 1000)
    }));
    
    const count = await addBulkToBlacklist(tokensToBlacklist);
    
    logger.info('Admin forced user logout', {
      adminId: req.user.userId,
      targetUserId: userId,
      tokensRevoked: count
    });
    
    res.json({ 
      message: `Logged out user ${userId}`,
      tokensRevoked: count
    });
  }
);
```

---

**🎓 END OF MODULE**

You've mastered:
- ✅ Token blacklisting fundamentals
- ✅ Why blacklisting is necessary for JWTs
- ✅ Implementation strategies (blacklist vs version vs allowlist)
- ✅ TTL strategy for automatic cleanup
- ✅ Line-by-line code analysis of all functions
- ✅ Real-world usage examples
- ✅ Security considerations and best practices

**🎉 M08: TOKEN BLACKLIST DEEP DIVE COMPLETE!**

**Next module:** M09-API-GATEWAY-DEEP-DIVE (server setup, routing, middleware orchestration)

**Progress: 8 out of 27 modules completed!**
