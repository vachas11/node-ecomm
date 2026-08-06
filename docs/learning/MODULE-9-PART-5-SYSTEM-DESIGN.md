# MODULE 9 - PART 5: SYSTEM DESIGN (Q91-Q100)

**Lead-Level Interview Preparation - Final 10 Questions**

---

## Q91: Design a URL shortener like bit.ly

**Perfect Answer:**

"URL shortener converts long URLs to short codes. Key challenges: unique ID generation, high read throughput, analytics.

**Requirements:**
```
Functional:
- Shorten URL → Return short code
- Access short URL → Redirect to original
- Custom aliases (optional)
- Expiry dates
- Analytics (click tracking)

Non-Functional:
- 100M URLs shortened per day
- 10:1 read-to-write ratio (1B redirects/day)
- < 100ms redirect latency
- 99.9% availability
```

**Architecture:**
```
Client
  ↓
Load Balancer (ALB)
  ↓
API Servers (Node.js cluster)
  ├─ POST /shorten → Write to DB
  ├─ GET /:code → Read from cache → DB
  ↓
Cache Layer (Redis)
  ├─ Hot URLs cached (80% hit rate)
  ├─ TTL: 24 hours
  ↓
Database (PostgreSQL + Read Replicas)
  ├─ Primary: Writes
  ├─ Replicas: Reads
  ↓
Analytics (Kafka + ClickHouse)
  ├─ Async click tracking
  ├─ Real-time dashboards
```

**Database Schema:**
```sql
CREATE TABLE urls (
  id BIGSERIAL PRIMARY KEY,
  short_code VARCHAR(7) UNIQUE NOT NULL,
  original_url TEXT NOT NULL,
  user_id BIGINT,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,
  click_count BIGINT DEFAULT 0,
  INDEX idx_short_code (short_code),
  INDEX idx_user_id (user_id)
);

CREATE TABLE clicks (
  id BIGSERIAL PRIMARY KEY,
  url_id BIGINT REFERENCES urls(id),
  clicked_at TIMESTAMP DEFAULT NOW(),
  ip_address INET,
  user_agent TEXT,
  referer TEXT,
  country VARCHAR(2)
);
```

**Shorten URL API:**
```javascript
app.post('/shorten', authenticate, async (req, res) => {
  const { url, customAlias, expiresIn } = req.body;
  
  // Validate URL
  if (!isValidURL(url)) {
    return res.status(400).json({ error: 'Invalid URL' });
  }
  
  // Check custom alias availability
  if (customAlias) {
    const exists = await db.query(
      'SELECT 1 FROM urls WHERE short_code = $1',
      [customAlias]
    );
    if (exists.rows.length > 0) {
      return res.status(409).json({ error: 'Alias already taken' });
    }
  }
  
  // Generate short code
  const shortCode = customAlias || generateShortCode();
  
  // Calculate expiry
  const expiresAt = expiresIn 
    ? new Date(Date.now() + expiresIn * 1000)
    : null;
  
  // Insert to database
  const result = await db.query(`
    INSERT INTO urls (short_code, original_url, user_id, expires_at)
    VALUES ($1, $2, $3, $4)
    RETURNING id, short_code
  `, [shortCode, url, req.user.id, expiresAt]);
  
  res.json({
    shortUrl: `https://bit.ly/${shortCode}`,
    originalUrl: url,
    expiresAt
  });
});
```

**Unique ID Generation (Base62):**
```javascript
// Base62: [a-zA-Z0-9] = 62 characters
// 7 characters = 62^7 = 3.5 trillion combinations

function generateShortCode() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  
  // Generate 7 random characters
  for (let i = 0; i < 7; i++) {
    code += chars[Math.floor(Math.random() * 62)];
  }
  
  return code;
}

// Alternative: Counter-based (more efficient)
function base62Encode(num) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  
  while (num > 0) {
    result = chars[num % 62] + result;
    num = Math.floor(num / 62);
  }
  
  return result.padStart(7, 'a');
}

// Use auto-increment ID from database
// ID 1 → 'aaaaaab'
// ID 62 → 'aaaaaba'
// ID 3521614606208 → 'zzzzzzz'
```

**Redirect API:**
```javascript
app.get('/:code', async (req, res) => {
  const { code } = req.params;
  
  // Check cache first (Redis)
  let url = await redis.get(`url:${code}`);
  
  if (!url) {
    // Cache miss - query database
    const result = await db.query(`
      SELECT original_url, expires_at
      FROM urls
      WHERE short_code = $1
    `, [code]);
    
    if (result.rows.length === 0) {
      return res.status(404).send('URL not found');
    }
    
    const { original_url, expires_at } = result.rows[0];
    
    // Check expiry
    if (expires_at && new Date(expires_at) < new Date()) {
      return res.status(410).send('URL expired');
    }
    
    url = original_url;
    
    // Cache for 24 hours
    await redis.set(`url:${code}`, url, 'EX', 86400);
  }
  
  // Track click asynchronously
  trackClick(code, req);
  
  // Redirect
  res.redirect(301, url);
});

// Async click tracking (non-blocking)
async function trackClick(code, req) {
  const event = {
    shortCode: code,
    timestamp: Date.now(),
    ip: req.ip,
    userAgent: req.get('user-agent'),
    referer: req.get('referer'),
    country: geoip.lookup(req.ip)?.country
  };
  
  // Send to Kafka (async)
  await kafka.send('clicks', event);
  
  // Update counter (async)
  await db.query('UPDATE urls SET click_count = click_count + 1 WHERE short_code = $1', [code]);
}
```

**Scaling:**
```
1. Database sharding (shard by short_code hash)
2. Read replicas (10 read:1 write ratio)
3. Redis cluster (distributed cache)
4. CDN (cache redirects at edge)
5. Rate limiting (prevent abuse)
```

**Interview tip:** Show database schema (urls + clicks tables), demonstrate Base62 encoding (7 chars = 3.5T combinations), explain caching strategy (Redis for hot URLs, 80% hit rate), mention async click tracking (Kafka + ClickHouse), discuss scaling (read replicas, sharding, CDN)."

---

## Q92: Design a rate limiter

**Perfect Answer:**

"Rate limiter restricts requests per time window. Prevents abuse, protects backend, ensures fair usage.

**Requirements:**
```
- Limit by: User ID, IP address, API key
- Time windows: Second, minute, hour, day
- Rules: 100 req/min, 1000 req/hour
- Distributed (multiple servers)
- Low latency (< 5ms overhead)
```

**Algorithms:**

**1. Token Bucket (Best for smooth rate limiting):**
```javascript
class TokenBucket {
  constructor(capacity, refillRate) {
    this.capacity = capacity;        // Max tokens
    this.tokens = capacity;          // Current tokens
    this.refillRate = refillRate;    // Tokens per second
    this.lastRefill = Date.now();
  }
  
  tryConsume(tokens = 1) {
    this.refill();
    
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;  // Request allowed
    }
    
    return false;  // Request denied
  }
  
  refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsed * this.refillRate;
    
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
}

// Usage
const bucket = new TokenBucket(100, 10);  // 100 capacity, 10 tokens/sec

if (bucket.tryConsume(1)) {
  // Process request
} else {
  // Return 429 Too Many Requests
}
```

**2. Sliding Window Log (Most accurate):**
```javascript
class SlidingWindowLog {
  constructor(maxRequests, windowMs) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = [];  // Timestamps of requests
  }
  
  tryRequest() {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    // Remove old requests outside window
    this.requests = this.requests.filter(time => time > windowStart);
    
    if (this.requests.length < this.maxRequests) {
      this.requests.push(now);
      return true;  // Allowed
    }
    
    return false;  // Denied
  }
}

// Usage
const limiter = new SlidingWindowLog(100, 60000);  // 100 req/min

if (limiter.tryRequest()) {
  // Process request
} else {
  // 429
}
```

**3. Fixed Window Counter (Simple but has edge case):**
```javascript
class FixedWindowCounter {
  constructor(maxRequests, windowMs) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.count = 0;
    this.windowStart = Date.now();
  }
  
  tryRequest() {
    const now = Date.now();
    
    // Reset window if expired
    if (now - this.windowStart >= this.windowMs) {
      this.count = 0;
      this.windowStart = now;
    }
    
    if (this.count < this.maxRequests) {
      this.count++;
      return true;
    }
    
    return false;
  }
}

// Edge case: 200 requests at window boundary
// 11:59:59 → 100 requests (allowed)
// 12:00:00 → 100 requests (allowed)
// Total: 200 requests in 1 second!
```

**Redis-Based Implementation (Distributed):**
```javascript
const redis = require('redis').createClient();

async function rateLimitToken(userId, maxRequests, windowSeconds) {
  const key = `ratelimit:${userId}`;
  const now = Date.now();
  const windowStart = now - (windowSeconds * 1000);
  
  // Lua script (atomic operation)
  const script = `
    local key = KEYS[1]
    local now = tonumber(ARGV[1])
    local window_start = tonumber(ARGV[2])
    local max_requests = tonumber(ARGV[3])
    
    -- Remove old requests
    redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)
    
    -- Count current requests
    local count = redis.call('ZCARD', key)
    
    if count < max_requests then
      -- Add new request
      redis.call('ZADD', key, now, now)
      redis.call('EXPIRE', key, 60)
      return {1, count + 1}
    else
      return {0, count}
    end
  `;
  
  const result = await redis.eval(script, 1, key, now, windowStart, maxRequests);
  
  return {
    allowed: result[0] === 1,
    remaining: maxRequests - result[1]
  };
}

// Usage
app.use(async (req, res, next) => {
  const result = await rateLimitToken(req.user.id, 100, 60);
  
  res.set('X-RateLimit-Limit', '100');
  res.set('X-RateLimit-Remaining', result.remaining);
  
  if (!result.allowed) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  
  next();
});
```

**Multi-Tier Rate Limiting:**
```javascript
const limits = {
  'api:read': { requests: 1000, window: 3600 },    // 1000/hour
  'api:write': { requests: 100, window: 3600 },    // 100/hour
  'api:expensive': { requests: 10, window: 60 },   // 10/min
};

app.get('/api/search', async (req, res) => {
  const allowed = await checkRateLimit(req.user.id, 'api:read');
  if (!allowed) return res.status(429).json({ error: 'Rate limit exceeded' });
  
  // Process request
});

app.post('/api/process', async (req, res) => {
  const allowed = await checkRateLimit(req.user.id, 'api:expensive');
  if (!allowed) return res.status(429).json({ error: 'Rate limit exceeded' });
  
  // Expensive operation
});
```

**Interview tip:** Compare token bucket (smooth rate limiting) vs sliding window (accurate) vs fixed window (simple but edge case), show Redis-based implementation with Lua script (atomic operations), demonstrate multi-tier rate limits (read: 1000/hr, write: 100/hr, expensive: 10/min), mention rate limit headers (X-RateLimit-Limit, X-RateLimit-Remaining)."

---

## Q93: Design a real-time notification system

**Perfect Answer:**

"Real-time notifications push updates instantly to users. Use WebSockets for browser, push notifications for mobile.

**Architecture:**
```
Client (Browser/Mobile)
  ↓
WebSocket Connection / FCM / APNs
  ↓
Notification Gateway (Node.js + Socket.io)
  ├─ Connection management
  ├─ User → Socket mapping
  ↓
Message Queue (Redis Streams / Kafka)
  ├─ Decouple producers from consumers
  ├─ Persistent queue
  ↓
Notification Service
  ├─ Business logic
  ├─ Filtering (user preferences)
  ├─ Batching (group related notifications)
  ↓
Database (PostgreSQL)
  ├─ Notification history
  ├─ User preferences
```

**WebSocket Server:**
```javascript
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const redis = require('redis');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: { origin: '*' }
});

const redisClient = redis.createClient();
const subscriber = redisClient.duplicate();

// Store user → socket mapping
const userSockets = new Map();

// Authentication middleware
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  
  try {
    const user = await verifyToken(token);
    socket.userId = user.id;
    next();
  } catch (error) {
    next(new Error('Authentication failed'));
  }
});

// Connection handler
io.on('connection', (socket) => {
  console.log(`User ${socket.userId} connected`);
  
  // Store user → socket mapping
  userSockets.set(socket.userId, socket.id);
  
  // Join user-specific room
  socket.join(`user:${socket.userId}`);
  
  // Send unread notifications
  sendUnreadNotifications(socket.userId, socket);
  
  // Disconnect handler
  socket.on('disconnect', () => {
    console.log(`User ${socket.userId} disconnected`);
    userSockets.delete(socket.userId);
  });
  
  // Mark notification as read
  socket.on('mark-read', async (notificationId) => {
    await db.query(
      'UPDATE notifications SET read_at = NOW() WHERE id = $1',
      [notificationId]
    );
  });
});

// Listen to Redis pub/sub for notifications
subscriber.subscribe('notifications', (message) => {
  const notification = JSON.parse(message);
  
  // Send to specific user
  io.to(`user:${notification.userId}`).emit('notification', notification);
});

server.listen(3000);
```

**Notification Producer:**
```javascript
// When event occurs (new message, like, comment, etc.)
async function sendNotification(userId, type, data) {
  const notification = {
    id: uuidv4(),
    userId,
    type,  // 'message', 'like', 'comment', etc.
    data,
    createdAt: new Date(),
    read: false
  };
  
  // Save to database
  await db.query(`
    INSERT INTO notifications (id, user_id, type, data, created_at)
    VALUES ($1, $2, $3, $4, $5)
  `, [notification.id, userId, type, JSON.stringify(data), notification.createdAt]);
  
  // Publish to Redis (real-time)
  await redis.publish('notifications', JSON.stringify(notification));
  
  // Send mobile push notification (if user offline)
  const isOnline = userSockets.has(userId);
  if (!isOnline) {
    await sendPushNotification(userId, notification);
  }
}

// Usage
app.post('/api/posts/:id/like', authenticate, async (req, res) => {
  const { id } = req.params;
  
  // Like post
  await db.query('INSERT INTO likes (post_id, user_id) VALUES ($1, $2)', [id, req.user.id]);
  
  // Get post author
  const post = await db.query('SELECT user_id FROM posts WHERE id = $1', [id]);
  const authorId = post.rows[0].user_id;
  
  // Send notification to author
  await sendNotification(authorId, 'like', {
    postId: id,
    likedBy: req.user.id,
    likedByName: req.user.name
  });
  
  res.json({ success: true });
});
```

**Mobile Push Notifications (FCM):**
```javascript
const admin = require('firebase-admin');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

async function sendPushNotification(userId, notification) {
  // Get user's FCM token from database
  const result = await db.query(
    'SELECT fcm_token FROM devices WHERE user_id = $1',
    [userId]
  );
  
  if (result.rows.length === 0) return;
  
  const tokens = result.rows.map(row => row.fcm_token);
  
  const message = {
    notification: {
      title: getNotificationTitle(notification),
      body: getNotificationBody(notification)
    },
    data: {
      notificationId: notification.id,
      type: notification.type
    },
    tokens
  };
  
  // Send to FCM
  const response = await admin.messaging().sendMulticast(message);
  
  console.log(`Sent ${response.successCount} notifications`);
}

function getNotificationTitle(notification) {
  switch (notification.type) {
    case 'like': return 'New Like';
    case 'comment': return 'New Comment';
    case 'message': return 'New Message';
    default: return 'Notification';
  }
}
```

**Notification Preferences:**
```javascript
// User can configure what notifications they receive
app.put('/api/notifications/preferences', authenticate, async (req, res) => {
  const { emailNotifications, pushNotifications, types } = req.body;
  
  await db.query(`
    INSERT INTO notification_preferences (user_id, email, push, types)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id)
    DO UPDATE SET email = $2, push = $3, types = $4
  `, [req.user.id, emailNotifications, pushNotifications, JSON.stringify(types)]);
  
  res.json({ success: true });
});

// Check preferences before sending
async function shouldSendNotification(userId, type) {
  const prefs = await db.query(
    'SELECT types FROM notification_preferences WHERE user_id = $1',
    [userId]
  );
  
  if (prefs.rows.length === 0) return true;  // Default: send all
  
  const allowedTypes = JSON.parse(prefs.rows[0].types);
  return allowedTypes.includes(type);
}
```

**Batching Notifications:**
```javascript
// Instead of 10 separate "X liked your post" notifications,
// batch into "John and 9 others liked your post"

const notificationBatch = new Map();

function batchNotification(userId, type, data) {
  const key = `${userId}:${type}:${data.postId}`;
  
  if (!notificationBatch.has(key)) {
    notificationBatch.set(key, []);
    
    // Send batched notification after 5 seconds
    setTimeout(() => {
      const batch = notificationBatch.get(key);
      notificationBatch.delete(key);
      
      sendBatchedNotification(userId, type, batch);
    }, 5000);
  }
  
  notificationBatch.get(key).push(data);
}

function sendBatchedNotification(userId, type, batch) {
  if (batch.length === 1) {
    sendNotification(userId, type, batch[0]);
  } else {
    sendNotification(userId, `${type}_batch`, {
      count: batch.length,
      users: batch.map(b => b.likedByName).slice(0, 3),  // "John, Jane, Bob"
      postId: batch[0].postId
    });
  }
}
```

**Interview tip:** Show WebSocket server with Socket.io (user → socket mapping), demonstrate Redis pub/sub for distributing notifications across servers, explain mobile push notifications with FCM, mention notification preferences (user can disable certain types), discuss batching (combine 10 likes into "X and 9 others liked your post")."

---

## Q94: Design a distributed cache

**Perfect Answer:**

"Distributed cache stores frequently accessed data in memory across multiple servers. Reduces database load, improves latency.

**Requirements:**
```
- Distributed across N servers
- Key-value store (GET/SET)
- Eviction policy (LRU)
- High availability (replication)
- Partitioning (consistent hashing)
```

**Architecture:**
```
Client
  ↓
Cache Client Library
  ├─ Hashing (determine which server)
  ├─ Retry logic
  ├─ Circuit breaker
  ↓
Cache Server Cluster (3-node cluster)
  ├─ Server 1 (keys 0-1000)
  ├─ Server 2 (keys 1001-2000)
  ├─ Server 3 (keys 2001-3000)
  ↓
Replication (Master-Slave)
  ├─ Each key replicated to 2 servers
  ├─ Read from any replica
  ├─ Write to master only
```

**Consistent Hashing:**
```javascript
// Without consistent hashing (bad):
// - Server 3 goes down → rehash everything → 66% cache miss
// With consistent hashing:
// - Server 3 goes down → only 33% keys rehashed → 67% cache hit

class ConsistentHashing {
  constructor(virtualNodes = 150) {
    this.virtualNodes = virtualNodes;
    this.ring = new Map();  // position → server
    this.servers = [];
  }
  
  addServer(server) {
    this.servers.push(server);
    
    // Add virtual nodes (spread keys evenly)
    for (let i = 0; i < this.virtualNodes; i++) {
      const hash = this.hash(`${server}:${i}`);
      this.ring.set(hash, server);
    }
    
    // Sort ring by hash value
    this.ring = new Map([...this.ring.entries()].sort((a, b) => a[0] - b[0]));
  }
  
  removeServer(server) {
    // Remove all virtual nodes for this server
    for (let i = 0; i < this.virtualNodes; i++) {
      const hash = this.hash(`${server}:${i}`);
      this.ring.delete(hash);
    }
    
    this.servers = this.servers.filter(s => s !== server);
  }
  
  getServer(key) {
    if (this.ring.size === 0) return null;
    
    const hash = this.hash(key);
    
    // Find first server with hash >= key hash (clockwise on ring)
    for (const [ringHash, server] of this.ring.entries()) {
      if (ringHash >= hash) {
        return server;
      }
    }
    
    // Wrap around to first server
    return this.ring.values().next().value;
  }
  
  hash(key) {
    // Simple hash (use better hash in production)
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = (hash << 5) - hash + key.charCodeAt(i);
      hash = hash & hash;  // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
}

// Usage
const ch = new ConsistentHashing();
ch.addServer('server1:6379');
ch.addServer('server2:6379');
ch.addServer('server3:6379');

const server = ch.getServer('user:123');  // 'server2:6379'
```

**Cache Client:**
```javascript
class CacheClient {
  constructor(servers) {
    this.consistentHash = new ConsistentHashing();
    this.connections = new Map();
    
    servers.forEach(server => {
      this.consistentHash.addServer(server);
      this.connections.set(server, redis.createClient({ url: `redis://${server}` }));
    });
  }
  
  async get(key) {
    const server = this.consistentHash.getServer(key);
    const connection = this.connections.get(server);
    
    try {
      const value = await connection.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error(`Error getting ${key} from ${server}:`, error);
      
      // Try replica servers (fallback)
      return await this.getFromReplica(key, server);
    }
  }
  
  async set(key, value, ttl = 3600) {
    const server = this.consistentHash.getServer(key);
    const connection = this.connections.get(server);
    
    try {
      await connection.set(key, JSON.stringify(value), 'EX', ttl);
      
      // Replicate to next server (async)
      this.replicateToNext(key, value, ttl, server);
    } catch (error) {
      console.error(`Error setting ${key} on ${server}:`, error);
      throw error;
    }
  }
  
  async delete(key) {
    const server = this.consistentHash.getServer(key);
    const connection = this.connections.get(server);
    
    await connection.del(key);
    
    // Delete from replica
    this.deleteFromReplica(key, server);
  }
  
  async getFromReplica(key, failedServer) {
    // Find next server in ring (replica)
    const servers = Array.from(this.connections.keys());
    const index = servers.indexOf(failedServer);
    const replicaServer = servers[(index + 1) % servers.length];
    
    const connection = this.connections.get(replicaServer);
    const value = await connection.get(key);
    
    return value ? JSON.parse(value) : null;
  }
  
  async replicateToNext(key, value, ttl, primaryServer) {
    const servers = Array.from(this.connections.keys());
    const index = servers.indexOf(primaryServer);
    const replicaServer = servers[(index + 1) % servers.length];
    
    const connection = this.connections.get(replicaServer);
    await connection.set(key, JSON.stringify(value), 'EX', ttl);
  }
}

// Usage
const cache = new CacheClient([
  'localhost:6379',
  'localhost:6380',
  'localhost:6381'
]);

// Set value
await cache.set('user:123', { name: 'John', email: 'john@example.com' });

// Get value
const user = await cache.get('user:123');
console.log(user);  // { name: 'John', email: 'john@example.com' }
```

**Cache-Aside Pattern:**
```javascript
async function getUser(userId) {
  // 1. Check cache
  let user = await cache.get(`user:${userId}`);
  
  if (user) {
    return user;  // Cache hit
  }
  
  // 2. Cache miss - query database
  const result = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
  user = result.rows[0];
  
  if (!user) {
    return null;  // User not found
  }
  
  // 3. Store in cache (TTL: 1 hour)
  await cache.set(`user:${userId}`, user, 3600);
  
  return user;
}

// Write-through: Update cache on write
async function updateUser(userId, updates) {
  // 1. Update database
  await db.query('UPDATE users SET name = $1 WHERE id = $2', [updates.name, userId]);
  
  // 2. Update cache
  const user = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
  await cache.set(`user:${userId}`, user.rows[0], 3600);
}

// Cache invalidation: Delete on write
async function deleteUser(userId) {
  // 1. Delete from database
  await db.query('DELETE FROM users WHERE id = $1', [userId]);
  
  // 2. Delete from cache
  await cache.delete(`user:${userId}`);
}
```

**LRU Eviction (Built into Redis):**
```bash
# Redis config
maxmemory 2gb
maxmemory-policy allkeys-lru  # Evict least recently used keys
```

**Interview tip:** Explain consistent hashing (adding/removing server only rehashes 1/N keys), show cache client with server selection logic, demonstrate cache-aside pattern (check cache → miss → query DB → store in cache), mention replication (each key stored on 2 servers for redundancy), discuss LRU eviction policy (remove least recently used when memory full)."

---

## Q95: Design a recommendation system

**Perfect Answer:**

"Recommendation system suggests items users might like. Use collaborative filtering, content-based filtering, or hybrid.

**Approaches:**

**1. Collaborative Filtering (User-Based):**
```
"Users who liked A also liked B"

Steps:
1. Find similar users (Jaccard similarity, cosine similarity)
2. Recommend items liked by similar users
```

**Implementation:**
```javascript
// User-item matrix
const ratings = {
  'user1': { 'movie1': 5, 'movie2': 3, 'movie3': 4 },
  'user2': { 'movie1': 5, 'movie2': 4, 'movie4': 2 },
  'user3': { 'movie2': 2, 'movie3': 5, 'movie4': 5 }
};

// Cosine similarity between two users
function cosineSimilarity(user1, user2) {
  const ratings1 = ratings[user1];
  const ratings2 = ratings[user2];
  
  // Find common items
  const commonItems = Object.keys(ratings1).filter(item => item in ratings2);
  
  if (commonItems.length === 0) return 0;
  
  // Calculate dot product and magnitudes
  let dotProduct = 0;
  let magnitude1 = 0;
  let magnitude2 = 0;
  
  commonItems.forEach(item => {
    dotProduct += ratings1[item] * ratings2[item];
    magnitude1 += ratings1[item] ** 2;
    magnitude2 += ratings2[item] ** 2;
  });
  
  return dotProduct / (Math.sqrt(magnitude1) * Math.sqrt(magnitude2));
}

// Find k most similar users
function findSimilarUsers(userId, k = 5) {
  const similarities = [];
  
  for (const otherUser in ratings) {
    if (otherUser === userId) continue;
    
    const similarity = cosineSimilarity(userId, otherUser);
    similarities.push({ user: otherUser, similarity });
  }
  
  // Sort by similarity (descending)
  similarities.sort((a, b) => b.similarity - a.similarity);
  
  return similarities.slice(0, k);
}

// Recommend items
function recommendItems(userId, k = 10) {
  const userRatings = ratings[userId];
  const similarUsers = findSimilarUsers(userId, 5);
  
  const scores = {};
  
  // Aggregate ratings from similar users
  similarUsers.forEach(({ user, similarity }) => {
    const theirRatings = ratings[user];
    
    for (const item in theirRatings) {
      if (item in userRatings) continue;  // Skip already rated items
      
      if (!scores[item]) scores[item] = 0;
      scores[item] += theirRatings[item] * similarity;
    }
  });
  
  // Sort by score
  const recommendations = Object.entries(scores)
    .map(([item, score]) => ({ item, score }))
    .sort((a, b) => b.score - a.score);
  
  return recommendations.slice(0, k);
}

// Usage
const recs = recommendItems('user1', 5);
console.log(recs);
// [{ item: 'movie4', score: 8.5 }, ...]
```

**2. Content-Based Filtering:**
```
"If you liked Item A (action movie), you might like Item B (action movie)"

Steps:
1. Extract item features (genre, director, actors)
2. Find similar items (cosine similarity)
3. Recommend similar items
```

**Implementation:**
```javascript
// Item features
const items = {
  'movie1': { genre: ['action', 'sci-fi'], director: 'Nolan', year: 2010 },
  'movie2': { genre: ['action', 'thriller'], director: 'Tarantino', year: 2012 },
  'movie3': { genre: ['comedy', 'romance'], director: 'Anderson', year: 2014 }
};

// Feature vector
function featureVector(item) {
  const allGenres = ['action', 'sci-fi', 'thriller', 'comedy', 'romance'];
  const vector = {};
  
  allGenres.forEach(genre => {
    vector[genre] = item.genre.includes(genre) ? 1 : 0;
  });
  
  return vector;
}

// Cosine similarity
function itemSimilarity(item1, item2) {
  const vec1 = featureVector(items[item1]);
  const vec2 = featureVector(items[item2]);
  
  let dotProduct = 0;
  let mag1 = 0;
  let mag2 = 0;
  
  for (const key in vec1) {
    dotProduct += vec1[key] * vec2[key];
    mag1 += vec1[key] ** 2;
    mag2 += vec2[key] ** 2;
  }
  
  return dotProduct / (Math.sqrt(mag1) * Math.sqrt(mag2));
}

// Recommend similar items
function recommendSimilar(itemId, k = 5) {
  const similarities = [];
  
  for (const otherItem in items) {
    if (otherItem === itemId) continue;
    
    const similarity = itemSimilarity(itemId, otherItem);
    similarities.push({ item: otherItem, similarity });
  }
  
  similarities.sort((a, b) => b.similarity - a.similarity);
  
  return similarities.slice(0, k);
}
```

**3. Matrix Factorization (SVD):**
```
Decompose user-item matrix into user-features × item-features

User-Item Matrix (m×n):
         movie1  movie2  movie3  movie4
user1      5       3       4       ?
user2      5       4       ?       2
user3      ?       2       5       5

Factorize into:
User-Features (m×k) × Item-Features (k×n)

Predict missing ratings using matrix multiplication
```

**Production Architecture:**
```
Offline Training (Daily):
1. Extract user interactions (clicks, purchases, ratings)
2. Train model (collaborative filtering, ML)
3. Generate recommendations for all users
4. Store in cache/database

Online Serving:
1. User requests recommendations
2. Fetch pre-computed recommendations from cache
3. Apply filters (in-stock, personalization)
4. Return top 10 items
```

**Real-Time Personalization:**
```javascript
app.get('/api/recommendations', authenticate, async (req, res) => {
  const userId = req.user.id;
  
  // 1. Get base recommendations (pre-computed)
  let recommendations = await cache.get(`recs:${userId}`);
  
  if (!recommendations) {
    recommendations = await db.query(
      'SELECT item_id, score FROM recommendations WHERE user_id = $1 ORDER BY score DESC LIMIT 50',
      [userId]
    );
  }
  
  // 2. Apply real-time filters
  const userContext = {
    recentlyViewed: await getRecentlyViewed(userId),
    currentLocation: req.headers['x-geo-location'],
    timeOfDay: new Date().getHours()
  };
  
  recommendations = recommendations.filter(rec => {
    // Filter out recently viewed
    if (userContext.recentlyViewed.includes(rec.item_id)) return false;
    
    // Filter by location availability
    // Filter by time-based relevance
    
    return true;
  });
  
  // 3. Re-rank based on recent interactions
  recommendations = await rerank(recommendations, userContext);
  
  res.json({ recommendations: recommendations.slice(0, 10) });
});
```

**Interview tip:** Compare collaborative filtering (user-user similarity) vs content-based (item-item similarity) vs hybrid (combine both), show cosine similarity calculation for finding similar users/items, explain offline training (batch job computes recommendations) vs online serving (fetch from cache), mention cold start problem (new users/items have no data)."

---

## Q96: Design a logging and monitoring system

**Perfect Answer:**

"Logging collects application events. Monitoring tracks metrics and alerts on anomalies.

(Note: Partially covered in Q78 and Q86)

**Architecture:**
```
Application Servers
  ├─ Structured logs (JSON)
  ├─ Metrics (Prometheus)
  ├─ Traces (OpenTelemetry)
  ↓
Collection Layer
  ├─ Fluentd / Logstash (log aggregation)
  ├─ Prometheus (metric scraping)
  ├─ Jaeger (trace collection)
  ↓
Storage Layer
  ├─ Elasticsearch (logs)
  ├─ Prometheus TSDB (metrics)
  ├─ Jaeger storage (traces)
  ↓
Visualization & Alerting
  ├─ Kibana (log search)
  ├─ Grafana (metric dashboards)
  ├─ Jaeger UI (trace viewing)
  ├─ AlertManager (alert routing)
```

**Structured Logging:**
```javascript
const winston = require('winston');

const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'app.log' })
  ]
});

// Log with context
logger.info('User login', {
  userId: 123,
  ip: '192.168.1.1',
  userAgent: 'Mozilla/5.0',
  duration: 45,
  success: true
});

// Output:
{
  "level": "info",
  "message": "User login",
  "userId": 123,
  "ip": "192.168.1.1",
  "userAgent": "Mozilla/5.0",
  "duration": 45,
  "success": true,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

**Metrics Collection (Prometheus):**
```javascript
const promClient = require('prom-client');

// Counter: Monotonically increasing (total requests)
const httpRequestsTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status']
});

// Histogram: Distribution (request duration)
const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route'],
  buckets: [0.1, 0.5, 1, 2, 5]  // 100ms, 500ms, 1s, 2s, 5s
});

// Gauge: Current value (active connections)
const activeConnections = new promClient.Gauge({
  name: 'active_connections',
  help: 'Number of active connections'
});

// Middleware
app.use((req, res, next) => {
  const start = Date.now();
  
  activeConnections.inc();
  
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    
    httpRequestsTotal.labels(req.method, req.route?.path || req.path, res.statusCode).inc();
    httpRequestDuration.labels(req.method, req.route?.path || req.path).observe(duration);
    activeConnections.dec();
  });
  
  next();
});

// Expose metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', promClient.register.contentType);
  res.end(await promClient.register.metrics());
});
```

**Distributed Tracing:**
```javascript
const opentelemetry = require('@opentelemetry/api');
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { JaegerExporter } = require('@opentelemetry/exporter-jaeger');

// Setup tracer
const provider = new NodeTracerProvider();
provider.addSpanProcessor(
  new opentelemetry.BatchSpanProcessor(
    new JaegerExporter({ endpoint: 'http://localhost:14268/api/traces' })
  )
);
provider.register();

const tracer = opentelemetry.trace.getTracer('api-gateway');

// Trace request
app.get('/api/users/:id', async (req, res) => {
  const span = tracer.startSpan('get-user');
  
  try {
    // Database query
    const dbSpan = tracer.startSpan('database-query', { parent: span });
    const user = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    dbSpan.end();
    
    // External API call
    const apiSpan = tracer.startSpan('fetch-user-posts', { parent: span });
    const posts = await axios.get(`http://post-service/users/${req.params.id}/posts`);
    apiSpan.end();
    
    res.json({ user, posts: posts.data });
  } finally {
    span.end();
  }
});

// In Jaeger UI:
// - See full request trace
// - Each span shows duration
// - Identify slow database queries
// - Find service bottlenecks
```

**Alerting Rules:**
```yaml
# Prometheus alert rules
groups:
- name: api-alerts
  rules:
  - alert: HighErrorRate
    expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.05
    for: 5m
    labels:
      severity: critical
    annotations:
      summary: "High error rate detected"
      description: "Error rate is {{ $value }} (threshold: 5%)"
  
  - alert: HighLatency
    expr: histogram_quantile(0.95, http_request_duration_seconds) > 1
    for: 10m
    labels:
      severity: warning
    annotations:
      summary: "High latency detected"
      description: "P95 latency is {{ $value }}s (threshold: 1s)"
  
  - alert: ServiceDown
    expr: up{job="api-gateway"} == 0
    for: 1m
    labels:
      severity: critical
    annotations:
      summary: "Service is down"
```

**Interview tip:** Show structured logging with Winston (JSON format, searchable fields), demonstrate Prometheus metrics (counter, histogram, gauge), explain distributed tracing with OpenTelemetry (trace request across services, identify bottlenecks), mention alerting rules (high error rate, high latency, service down)."

---

## Q97: Design a job queue system

**Perfect Answer:**

"Job queue processes background tasks asynchronously. Decouples producers from consumers, enables retries, prioritization.

**Architecture:**
```
Producers (API servers)
  ├─ Enqueue jobs
  ↓
Message Queue (Redis, RabbitMQ, Kafka)
  ├─ Persistent storage
  ├─ Priority queues
  ↓
Consumers (Worker processes)
  ├─ Process jobs
  ├─ Retry on failure
  ├─ Dead letter queue (failed jobs)
```

**Implementation (Bull Queue):**
```javascript
const Queue = require('bull');

// Create queue
const emailQueue = new Queue('email', {
  redis: { host: 'localhost', port: 6379 }
});

// Producer: Add job to queue
app.post('/api/send-email', authenticate, async (req, res) => {
  const { to, subject, body } = req.body;
  
  // Add job to queue (non-blocking)
  await emailQueue.add({
    to,
    subject,
    body,
    userId: req.user.id
  }, {
    attempts: 3,           // Retry up to 3 times
    backoff: {
      type: 'exponential',
      delay: 2000          // 2s, 4s, 8s
    },
    priority: 5,           // Higher number = higher priority
    delay: 0               // Process immediately (or delay: 60000 for 1 min)
  });
  
  res.json({ message: 'Email queued' });
});

// Consumer: Process jobs
emailQueue.process(async (job) => {
  const { to, subject, body } = job.data;
  
  console.log(`Processing job ${job.id}: Send email to ${to}`);
  
  try {
    // Send email
    await sendEmail(to, subject, body);
    
    // Update progress
    job.progress(100);
    
    return { sent: true, to };
  } catch (error) {
    console.error(`Failed to send email to ${to}:`, error);
    
    // Will retry based on attempts config
    throw error;
  }
});

// Event listeners
emailQueue.on('completed', (job, result) => {
  console.log(`Job ${job.id} completed:`, result);
});

emailQueue.on('failed', (job, error) => {
  console.log(`Job ${job.id} failed:`, error.message);
});

emailQueue.on('stalled', (job) => {
  console.log(`Job ${job.id} stalled (worker crashed?)`);
});
```

**Priority Queues:**
```javascript
// High priority job (processed first)
await emailQueue.add({ to: 'vip@example.com' }, { priority: 10 });

// Low priority job (processed last)
await emailQueue.add({ to: 'bulk@example.com' }, { priority: 1 });

// Processing order:
// 1. priority: 10 (VIP)
// 2. priority: 5 (normal)
// 3. priority: 1 (bulk)
```

**Delayed Jobs (Scheduled Tasks):**
```javascript
// Send email after 1 hour
await emailQueue.add({ to: 'user@example.com' }, {
  delay: 3600000  // 1 hour in milliseconds
});

// Recurring job (every day at 9am)
await emailQueue.add({ type: 'daily-report' }, {
  repeat: {
    cron: '0 9 * * *'  // 9am daily
  }
});
```

**Dead Letter Queue:**
```javascript
// Failed jobs after max retries go to dead letter queue
emailQueue.on('failed', async (job, error) => {
  if (job.attemptsMade >= job.opts.attempts) {
    console.log(`Job ${job.id} moved to dead letter queue`);
    
    // Store failed job for manual review
    await db.query(`
      INSERT INTO failed_jobs (job_id, data, error, created_at)
      VALUES ($1, $2, $3, NOW())
    `, [job.id, JSON.stringify(job.data), error.message]);
  }
});

// Admin endpoint to retry failed jobs
app.post('/admin/retry-failed-job/:id', async (req, res) => {
  const { id } = req.params;
  
  const result = await db.query('SELECT data FROM failed_jobs WHERE job_id = $1', [id]);
  const jobData = JSON.parse(result.rows[0].data);
  
  // Re-queue job
  await emailQueue.add(jobData);
  
  await db.query('DELETE FROM failed_jobs WHERE job_id = $1', [id]);
  
  res.json({ message: 'Job re-queued' });
});
```

**Worker Scaling:**
```javascript
// Start multiple worker processes
const cluster = require('cluster');
const os = require('os');

if (cluster.isMaster) {
  const numWorkers = os.cpus().length;
  
  console.log(`Starting ${numWorkers} workers`);
  
  for (let i = 0; i < numWorkers; i++) {
    cluster.fork();
  }
  
  cluster.on('exit', (worker) => {
    console.log(`Worker ${worker.process.pid} died, starting new worker`);
    cluster.fork();
  });
} else {
  // Worker process
  emailQueue.process(async (job) => {
    // Process jobs
  });
}
```

**Job Monitoring:**
```javascript
// Get queue stats
app.get('/admin/queue-stats', async (req, res) => {
  const waiting = await emailQueue.getWaitingCount();
  const active = await emailQueue.getActiveCount();
  const completed = await emailQueue.getCompletedCount();
  const failed = await emailQueue.getFailedCount();
  
  res.json({ waiting, active, completed, failed });
});

// Get job status
app.get('/api/job/:id', async (req, res) => {
  const job = await emailQueue.getJob(req.params.id);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  res.json({
    id: job.id,
    state: await job.getState(),
    progress: job.progress(),
    data: job.data,
    returnValue: job.returnvalue,
    failedReason: job.failedReason
  });
});
```

**Interview tip:** Show Bull queue implementation (producer adds jobs, consumer processes), explain retry strategy (exponential backoff: 2s, 4s, 8s), demonstrate priority queues (VIP: priority 10, normal: 5, bulk: 1), mention dead letter queue (failed jobs after max retries), discuss worker scaling (multiple worker processes for throughput)."

---

## Q98: Design a search autocomplete system

**Perfect Answer:**

"Autocomplete suggests results as user types. Requires prefix matching, ranking, and low latency (<100ms).

**Requirements:**
```
- Prefix matching ("face" → "facebook", "facetime")
- Ranking by popularity
- Fuzzy matching (typo tolerance)
- < 100ms latency
- Personalization (optional)
```

**Approach 1: Trie Data Structure:**
```javascript
class TrieNode {
  constructor() {
    this.children = {};
    this.isEndOfWord = false;
    this.frequency = 0;
    this.suggestions = [];  // Top suggestions at this node
  }
}

class Trie {
  constructor() {
    this.root = new TrieNode();
  }
  
  insert(word, frequency) {
    let node = this.root;
    
    for (const char of word.toLowerCase()) {
      if (!node.children[char]) {
        node.children[char] = new TrieNode();
      }
      node = node.children[char];
      
      // Update top suggestions at each node
      this.updateSuggestions(node, word, frequency);
    }
    
    node.isEndOfWord = true;
    node.frequency = frequency;
  }
  
  updateSuggestions(node, word, frequency) {
    // Keep top 10 suggestions at each node
    node.suggestions.push({ word, frequency });
    node.suggestions.sort((a, b) => b.frequency - a.frequency);
    node.suggestions = node.suggestions.slice(0, 10);
  }
  
  autocomplete(prefix) {
    let node = this.root;
    
    // Navigate to prefix node
    for (const char of prefix.toLowerCase()) {
      if (!node.children[char]) {
        return [];  // Prefix not found
      }
      node = node.children[char];
    }
    
    // Return pre-computed suggestions
    return node.suggestions.map(s => s.word);
  }
}

// Build trie from popular searches
const trie = new Trie();
trie.insert('facebook', 1000000);
trie.insert('facetime', 500000);
trie.insert('face recognition', 200000);
trie.insert('twitter', 800000);

// Autocomplete
console.log(trie.autocomplete('face'));
// ['facebook', 'facetime', 'face recognition']
```

**Approach 2: Database with Full-Text Search:**
```sql
CREATE TABLE search_queries (
  id SERIAL PRIMARY KEY,
  query TEXT NOT NULL,
  frequency BIGINT DEFAULT 1,
  last_searched TIMESTAMP DEFAULT NOW()
);

-- Index for prefix matching
CREATE INDEX idx_query_prefix ON search_queries USING gin (query gin_trgm_ops);

-- Autocomplete query
SELECT query, frequency
FROM search_queries
WHERE query ILIKE 'face%'
ORDER BY frequency DESC
LIMIT 10;
```

**API Implementation:**
```javascript
app.get('/api/autocomplete', async (req, res) => {
  const { q } = req.query;
  
  if (!q || q.length < 2) {
    return res.json({ suggestions: [] });
  }
  
  // Check cache first
  const cacheKey = `autocomplete:${q}`;
  let suggestions = await redis.get(cacheKey);
  
  if (suggestions) {
    return res.json({ suggestions: JSON.parse(suggestions) });
  }
  
  // Query trie or database
  suggestions = trie.autocomplete(q);
  
  // Cache for 1 hour
  await redis.set(cacheKey, JSON.stringify(suggestions), 'EX', 3600);
  
  res.json({ suggestions });
});

// Track search queries
app.post('/api/search', authenticate, async (req, res) => {
  const { query } = req.body;
  
  // Increment frequency (async, non-blocking)
  incrementSearchFrequency(query);
  
  // Perform actual search
  const results = await searchDatabase(query);
  
  res.json({ results });
});

async function incrementSearchFrequency(query) {
  await db.query(`
    INSERT INTO search_queries (query, frequency)
    VALUES ($1, 1)
    ON CONFLICT (query)
    DO UPDATE SET
      frequency = search_queries.frequency + 1,
      last_searched = NOW()
  `, [query]);
}
```

**Fuzzy Matching (Typo Tolerance):**
```javascript
// Levenshtein distance (edit distance)
function levenshtein(a, b) {
  const matrix = [];
  
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,  // Substitution
          matrix[i][j - 1] + 1,      // Insertion
          matrix[i - 1][j] + 1       // Deletion
        );
      }
    }
  }
  
  return matrix[b.length][a.length];
}

// Fuzzy autocomplete
function fuzzyAutocomplete(query, maxDistance = 2) {
  const suggestions = [];
  
  for (const word of allWords) {
    const distance = levenshtein(query, word.substring(0, query.length));
    
    if (distance <= maxDistance) {
      suggestions.push({ word, distance, frequency: word.frequency });
    }
  }
  
  // Sort by distance (ascending), then frequency (descending)
  suggestions.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    return b.frequency - a.frequency;
  });
  
  return suggestions.slice(0, 10).map(s => s.word);
}
```

**Personalization:**
```javascript
app.get('/api/autocomplete', authenticate, async (req, res) => {
  const { q } = req.query;
  
  // Global suggestions
  const globalSuggestions = trie.autocomplete(q);
  
  // User's search history
  const userHistory = await db.query(`
    SELECT query, COUNT(*) as count
    FROM search_history
    WHERE user_id = $1 AND query ILIKE $2
    GROUP BY query
    ORDER BY count DESC
    LIMIT 5
  `, [req.user.id, `${q}%`]);
  
  // Merge (user history first)
  const suggestions = [
    ...userHistory.rows.map(r => r.query),
    ...globalSuggestions
  ];
  
  // Deduplicate
  const unique = [...new Set(suggestions)].slice(0, 10);
  
  res.json({ suggestions: unique });
});
```

**Interview tip:** Compare Trie (fast prefix matching, O(k) where k = prefix length) vs database (flexible but slower), show pre-computed suggestions at each Trie node (avoid traversing entire subtree), demonstrate caching (Redis for < 100ms latency), mention fuzzy matching with Levenshtein distance (typo tolerance), discuss personalization (user history + global trends)."

---

## Q99: Design a file upload system for large files

**Perfect Answer:**

"Large file uploads require chunking, resumable uploads, progress tracking, and parallel uploads.

(Note: Covered in Q54 - Architecture & Design section)

**Quick Summary:**

**Chunked Upload:**
```javascript
// Client: Split file into chunks
const chunkSize = 5 * 1024 * 1024;  // 5MB chunks
const chunks = Math.ceil(file.size / chunkSize);

for (let i = 0; i < chunks; i++) {
  const start = i * chunkSize;
  const end = Math.min(start + chunkSize, file.size);
  const chunk = file.slice(start, end);
  
  // Upload chunk
  await axios.post(`/api/upload/${uploadId}/chunk/${i}`, chunk, {
    headers: { 'Content-Type': 'application/octet-stream' }
  });
  
  // Update progress
  progress = ((i + 1) / chunks) * 100;
}

// Finalize upload
await axios.post(`/api/upload/${uploadId}/complete`);
```

**Resumable Upload:**
```javascript
// Client: Resume from last uploaded chunk
const lastChunk = await axios.get(`/api/upload/${uploadId}/status`);

for (let i = lastChunk.data.lastChunk + 1; i < chunks; i++) {
  // Upload remaining chunks
}
```

**Server:**
```javascript
// Store chunks temporarily
app.post('/api/upload/:id/chunk/:index', async (req, res) => {
  const { id, index } = req.params;
  const chunkPath = `uploads/${id}/chunk_${index}`;
  
  await fs.promises.writeFile(chunkPath, req.body);
  
  res.json({ uploaded: true });
});

// Merge chunks
app.post('/api/upload/:id/complete', async (req, res) => {
  const { id } = req.params;
  const chunks = await fs.promises.readdir(`uploads/${id}`);
  
  // Sort chunks
  chunks.sort((a, b) => {
    const aIndex = parseInt(a.split('_')[1]);
    const bIndex = parseInt(b.split('_')[1]);
    return aIndex - bIndex;
  });
  
  // Merge
  const finalPath = `uploads/${id}/file`;
  const writeStream = fs.createWriteStream(finalPath);
  
  for (const chunk of chunks) {
    const chunkPath = `uploads/${id}/${chunk}`;
    const data = await fs.promises.readFile(chunkPath);
    writeStream.write(data);
    await fs.promises.unlink(chunkPath);  // Delete chunk
  }
  
  writeStream.end();
  
  res.json({ url: finalPath });
});
```

**S3 Multipart Upload:**
```javascript
const AWS = require('aws-sdk');
const s3 = new AWS.S3();

// Initiate multipart upload
const multipart = await s3.createMultipartUpload({
  Bucket: 'my-bucket',
  Key: 'file.zip'
}).promise();

const uploadId = multipart.UploadId;

// Upload parts
const parts = [];
for (let i = 0; i < chunks; i++) {
  const part = await s3.uploadPart({
    Bucket: 'my-bucket',
    Key: 'file.zip',
    PartNumber: i + 1,
    UploadId: uploadId,
    Body: chunk
  }).promise();
  
  parts.push({ PartNumber: i + 1, ETag: part.ETag });
}

// Complete multipart upload
await s3.completeMultipartUpload({
  Bucket: 'my-bucket',
  Key: 'file.zip',
  UploadId: uploadId,
  MultipartUpload: { Parts: parts }
}).promise();
```

**Interview tip:** Briefly explain chunked upload (split file into 5MB chunks), resumable upload (track last uploaded chunk, resume from there), S3 multipart upload (AWS handles merging), mention parallel chunk uploads (faster for large files)."

---

## Q100: Design a distributed transaction system (Saga pattern)

**Perfect Answer:**

"Distributed transactions span multiple services. Saga pattern coordinates transactions using compensating actions (no 2PC).

(Note: Covered in Q46 - Architecture & Design section)

**Problem:**
```
Order Service: Create order
Payment Service: Charge payment
Inventory Service: Reserve stock

If payment fails after order created → Inconsistent state!
```

**Saga Pattern (Choreography):**
```javascript
// Order Service
app.post('/api/orders', async (req, res) => {
  const orderId = uuidv4();
  
  // Step 1: Create order (pending)
  await db.query(`
    INSERT INTO orders (id, user_id, status)
    VALUES ($1, $2, 'pending')
  `, [orderId, req.user.id]);
  
  // Publish event
  await kafka.send('order-created', {
    orderId,
    userId: req.user.id,
    amount: req.body.amount,
    items: req.body.items
  });
  
  res.json({ orderId, status: 'pending' });
});

// Listen for payment-success event
kafka.on('payment-success', async (event) => {
  const { orderId } = event;
  
  // Update order status
  await db.query(
    'UPDATE orders SET status = $1 WHERE id = $2',
    ['confirmed', orderId]
  );
});

// Listen for payment-failed event (compensate)
kafka.on('payment-failed', async (event) => {
  const { orderId } = event;
  
  // Compensating action: Cancel order
  await db.query(
    'UPDATE orders SET status = $1 WHERE id = $2',
    ['cancelled', orderId]
  );
});
```

```javascript
// Payment Service
kafka.on('order-created', async (event) => {
  const { orderId, userId, amount } = event;
  
  try {
    // Charge payment
    await stripe.charges.create({
      amount: amount * 100,
      currency: 'usd',
      customer: userId
    });
    
    // Success
    await kafka.send('payment-success', { orderId });
    
  } catch (error) {
    // Failed
    await kafka.send('payment-failed', { orderId, error: error.message });
  }
});
```

```javascript
// Inventory Service
kafka.on('payment-success', async (event) => {
  const { orderId, items } = event;
  
  try {
    // Reserve stock
    for (const item of items) {
      await db.query(
        'UPDATE products SET stock = stock - $1 WHERE id = $2',
        [item.quantity, item.productId]
      );
    }
    
    await kafka.send('inventory-reserved', { orderId });
    
  } catch (error) {
    // Failed - trigger compensation
    await kafka.send('inventory-failed', { orderId });
  }
});

// Listen for order cancellation (compensate)
kafka.on('order-cancelled', async (event) => {
  const { orderId, items } = event;
  
  // Compensating action: Restore stock
  for (const item of items) {
    await db.query(
      'UPDATE products SET stock = stock + $1 WHERE id = $2',
      [item.quantity, item.productId]
    );
  }
});
```

**Saga Orchestrator Pattern:**
```javascript
// Saga Orchestrator Service
class OrderSaga {
  async execute(order) {
    const saga = {
      orderId: order.id,
      status: 'in-progress',
      steps: ['order', 'payment', 'inventory', 'shipment'],
      currentStep: 0,
      completed: []
    };
    
    try {
      // Step 1: Create order
      await orderService.createOrder(order);
      saga.completed.push('order');
      saga.currentStep++;
      
      // Step 2: Process payment
      await paymentService.charge(order.userId, order.amount);
      saga.completed.push('payment');
      saga.currentStep++;
      
      // Step 3: Reserve inventory
      await inventoryService.reserve(order.items);
      saga.completed.push('inventory');
      saga.currentStep++;
      
      // Step 4: Create shipment
      await shipmentService.create(order.id);
      saga.completed.push('shipment');
      
      saga.status = 'completed';
      
    } catch (error) {
      saga.status = 'failed';
      
      // Compensate (rollback completed steps in reverse)
      await this.compensate(saga);
    }
    
    return saga;
  }
  
  async compensate(saga) {
    // Rollback in reverse order
    const steps = saga.completed.reverse();
    
    for (const step of steps) {
      switch (step) {
        case 'shipment':
          await shipmentService.cancel(saga.orderId);
          break;
        case 'inventory':
          await inventoryService.release(saga.orderId);
          break;
        case 'payment':
          await paymentService.refund(saga.orderId);
          break;
        case 'order':
          await orderService.cancel(saga.orderId);
          break;
      }
    }
  }
}
```

**Interview tip:** Explain Saga pattern as alternative to 2PC (2-phase commit), show choreography approach (services react to events via Kafka), demonstrate compensating actions (if payment fails → cancel order, restore inventory), mention orchestrator pattern (centralized saga coordinator vs distributed event-driven)."

---

**🎉 ALL 100 QUESTIONS COMPLETE! 🎉**

**Total Coverage:**
- Q1-Q42: Security, Error Handling, Database & Performance (MODULE-9-INTERVIEW-QUESTIONS-COMPLETE.md)
- Q43-Q60: Architecture & Design Patterns (MODULE-9-PART-2-ARCHITECTURE-DESIGN.md)
- Q61-Q75: Node.js Internals & Advanced Patterns (MODULE-9-PART-3-NODEJS-SPECIFIC.md)
- Q76-Q90: DevOps & Deployment (MODULE-9-PART-4-DEVOPS-DEPLOYMENT.md)
- Q91-Q100: System Design (MODULE-9-PART-5-SYSTEM-DESIGN.md)

**Next: Creating comprehensive summary document...**
