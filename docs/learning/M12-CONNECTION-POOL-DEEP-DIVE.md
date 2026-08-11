# M12: Connection Pool Deep Dive

**File:** `services/api-gateway/src/lib/ConnectionPool.ts` (133 lines)  
**Level:** Performance & Resource Management  
**Prerequisites:** M01 (Logger), M09 (API Gateway), HTTP concepts  
**Time to Master:** 2-3 hours

---

## 📖 SECTION 1: THEORY - Connection Pooling

### 1.1 What is Connection Pooling?

**Connection Pool** = Reuse HTTP connections instead of creating new ones for each request.

**Real-World Analogy:**

Think of **phone calls**:

**Without Connection Pool (Create new connection each time):**
```
Request 1: Pick up phone → Dial → Wait for answer → Talk → Hang up
Request 2: Pick up phone → Dial → Wait for answer → Talk → Hang up
Request 3: Pick up phone → Dial → Wait for answer → Talk → Hang up

Each call: Full setup cost (dial, wait, establish connection)
```

**With Connection Pool (Keep line open):**
```
Request 1: Dial once → Talk
Request 2: → Talk (line still open!)
Request 3: → Talk (line still open!)

After 30s idle: Hang up automatically
Next request: Dial again if needed

Saves: Dialing + connection setup time ✅
```

### 1.2 The Problem: TCP Connection Overhead

**TCP connection establishment (3-way handshake):**

```
Client                          Server
  |                               |
  |--- SYN ---------------------->|  Step 1: Client requests connection
  |<-- SYN-ACK -------------------|  Step 2: Server acknowledges
  |--- ACK ---------------------->|  Step 3: Client confirms
  |                               |
  |=== Connection established ===|
  |                               |
  |--- HTTP Request ------------->|  Step 4: Send request
  |<-- HTTP Response -------------|  Step 5: Receive response
  |                               |
  |--- FIN ---------------------->|  Step 6: Close connection
  |<-- FIN-ACK -------------------|  Step 7: Server closes
  
Total: 7 round trips (3 setup + 2 data + 2 teardown)
```

**With HTTPS (TLS handshake):**

```
Additional steps after TCP:
  |--- ClientHello -------------->|  TLS 1: Propose encryption
  |<-- ServerHello ---------------|  TLS 2: Accept encryption
  |<-- Certificate ---------------|  TLS 3: Send SSL cert
  |--- ClientKeyExchange -------->|  TLS 4: Exchange keys
  |=== Encrypted connection ======|
  
Total: 11+ round trips!
```

**Time cost per connection:**

```typescript
// Without connection pooling:
TCP handshake:   50ms  (3 round trips)
TLS handshake:   100ms (additional round trips)
DNS lookup:      50ms  (if not cached)
Total overhead:  200ms per request ❌

// 100 requests = 100 × 200ms = 20 seconds wasted on handshakes!

// With connection pooling:
First request:   200ms (establish connection)
Next 99 requests: 0ms overhead ✅
Total saved:     19.8 seconds!
```

### 1.3 HTTP Keep-Alive

**HTTP Keep-Alive** = Keep TCP connection open after request completes.

**Without Keep-Alive (HTTP/1.0 default):**

```http
Request:
GET /api/products HTTP/1.1
Host: api.example.com
Connection: close          ← Close after response

Response:
HTTP/1.1 200 OK
Content-Length: 1234

{ ... data ... }

[Connection closed] ✂️

Next request:
[Create new connection] 🔧
```

**With Keep-Alive (HTTP/1.1 default):**

```http
Request 1:
GET /api/products HTTP/1.1
Host: api.example.com
Connection: keep-alive      ← Keep open

Response 1:
HTTP/1.1 200 OK
Connection: keep-alive
Keep-Alive: timeout=30

{ ... data ... }

[Connection stays open] ✅

Request 2 (same connection):
GET /api/orders HTTP/1.1
Host: api.example.com

Response 2:
HTTP/1.1 200 OK

{ ... data ... }

[Still open, reused!] ✅
```

### 1.4 Connection Pool Parameters

**Key parameters:**

**1. maxSockets (default: Infinity)**

```typescript
maxSockets: 100
// Maximum concurrent connections per host

// Example:
// 100 requests to product-service
// Only 100 connections open at once
// Request 101 waits until a connection frees up
```

**Why limit?**

```typescript
// Without limit:
// 1000 concurrent requests → 1000 connections
// Server: "Too many connections!" ❌
// Network: "TCP port exhaustion!" ❌

// With limit (100):
// 1000 concurrent requests → 100 connections
// Remaining 900 queue and wait ✅
// Controlled load on server ✅
```

**2. maxFreeSockets (default: 256)**

```typescript
maxFreeSockets: 10
// Maximum idle connections to keep open

// Pool behavior:
// Active requests: 50 connections
// Requests complete: 50 connections now free
// Pool keeps: 10 free connections
// Pool closes: 40 connections (excess)
```

**Why limit free sockets?**

```typescript
// Without limit:
// After spike: 1000 free connections sitting idle
// Memory: 1000 × 10KB = 10MB wasted ❌
// Server: "Why so many idle connections?" ⚠️

// With limit (10):
// After spike: 10 free connections kept
// Memory: 10 × 10KB = 100KB ✅
// Enough for next requests ✅
```

**3. keepAlive (default: false)**

```typescript
keepAlive: true
// Enable HTTP Keep-Alive
// Reuse connections for multiple requests
```

**4. keepAliveMsecs (default: 1000)**

```typescript
keepAliveMsecs: 30000  // 30 seconds
// Send TCP keep-alive packet every 30s to keep connection alive
```

**TCP Keep-Alive packets:**

```
Client                          Server
  |                               |
  |=== Idle connection ===========|  (no activity)
  |                               |
  |- TCP Keep-Alive Probe ------->|  After 30s: "Still there?"
  |<- TCP Keep-Alive ACK ----------|  "Yes, still here!"
  |                               |
  |=== Connection stays alive ====|
```

**Why send keep-alive packets?**

```typescript
// Problem: Firewalls close idle connections
// After 60s idle:
// Firewall: "No activity, closing connection" ✂️
// Next request: "Connection refused" ❌

// Solution: Send keep-alive every 30s
// Firewall: "Activity detected, keeping open" ✅
// Connection stays alive longer ✅
```

**5. timeout (default: undefined)**

```typescript
timeout: 60000  // 60 seconds
// Close connection if idle for 60 seconds
```

**Timeout behavior:**

```
T+0s:   Last request completes → Connection idle
T+30s:  Still idle (within timeout)
T+60s:  Timeout reached → Close connection ✂️
T+61s:  Next request → Create new connection 🔧
```

**6. scheduling (default: 'fifo')**

```typescript
scheduling: 'lifo'
// 'fifo': First In First Out (use oldest connection)
// 'lifo': Last In First Out (use newest connection)
```

**FIFO vs LIFO:**

```typescript
// FIFO (First In First Out):
// Pool has connections: [conn1, conn2, conn3]
// Request arrives → Use conn1 (oldest)
// Next request → Use conn2
// Next request → Use conn3
// Result: All connections used evenly ✅
// But: Old connections might be stale ⚠️

// LIFO (Last In First Out):
// Pool has connections: [conn1, conn2, conn3]
// Request arrives → Use conn3 (newest)
// Next request → Use conn3 (if free)
// Next request → Use conn3 (if free)
// Result: Reuse hot connections ✅
// Old connections (conn1, conn2) timeout and close ✅
// Fewer total connections needed ✅
```

**Why LIFO is better:**

```typescript
// LIFO concentrates load on fewer connections
// Example with 10 req/s:

// FIFO:
// 10 connections all used evenly
// All 10 stay open forever

// LIFO:
// 2-3 connections handle most load
// Remaining 7-8 timeout and close
// Memory savings! ✅
```

### 1.5 Connection Pool Lifecycle

**Connection states:**

```
┌──────────────┐
│   CLOSED     │  ← Initial state
└──────┬───────┘
       │ Request arrives
       ↓
┌──────────────┐
│  CONNECTING  │  ← TCP + TLS handshake
└──────┬───────┘
       │ Connection established
       ↓
┌──────────────┐
│    ACTIVE    │  ← Handling request
└──────┬───────┘
       │ Request completes
       ↓
┌──────────────┐
│     FREE     │  ← Waiting for reuse
└──────┬───────┘
       │
       ├─→ New request → Back to ACTIVE ↩️
       │
       ├─→ keepAlive timeout → CLOSED ✂️
       │
       └─→ maxFreeSockets exceeded → CLOSED ✂️
```

**Example timeline:**

```
T+0s:    Request 1 arrives
         → Create connection (CONNECTING)
         → 200ms: TCP + TLS handshake
         
T+0.2s:  Connection established (ACTIVE)
         → Send request, receive response
         → 50ms: Request completes
         
T+0.25s: Connection now FREE
         → Kept in pool for reuse
         
T+0.3s:  Request 2 arrives
         → Reuse FREE connection (ACTIVE)
         → 0ms handshake (reused!) ✅
         → 50ms: Request completes
         
T+0.35s: Connection now FREE again
         
T+30.35s: No activity for 30 seconds
          → keepAlive timeout
          → Close connection (CLOSED) ✂️
```

### 1.6 Connection Pool vs Database Pool

**HTTP Connection Pool (our implementation):**

```typescript
// Pooling HTTP connections to backend services
const agent = new http.Agent({
  keepAlive: true,
  maxSockets: 100
});

axios.get('http://product-service/products', { httpAgent: agent });
```

**Database Connection Pool (different concept):**

```typescript
// Pooling database connections
const pool = new Pool({
  host: 'localhost',
  database: 'ecommerce',
  max: 20,  // Maximum connections
  min: 5    // Minimum connections (pre-create)
});

await pool.query('SELECT * FROM products');
```

**Key differences:**

```typescript
// HTTP Connection Pool:
// - Lazy creation (create on demand)
// - No minimum connections
// - One pool per service
// - Lightweight (just TCP sockets)

// Database Connection Pool:
// - Eager creation (pre-create minimum)
// - Maintain minimum connections
// - One pool per database
// - Heavyweight (authenticated sessions)
```

---

## 🔍 SECTION 2: LINE-BY-LINE CODE ANALYSIS

### 2.1 Imports and Interfaces (Lines 1-9)

```typescript
import http from 'http';
import https from 'https';
import logger from '../../../../shared/logger';

interface PoolStats {
  created: number;
  requests: number;
  protocol: string;
}
```

#### Lines 1-2: HTTP Modules

```typescript
import http from 'http';
import https from 'https';
```

**http** = HTTP protocol module  
**https** = HTTPS protocol module

**Why both?**

```typescript
// Need different agents for different protocols:
const httpAgent = new http.Agent({ ... });   // For http://
const httpsAgent = new https.Agent({ ... }); // For https://

// Can't mix:
const httpAgent = new http.Agent();
axios.get('https://...', { httpAgent });  // ❌ Won't work
```

#### Lines 5-9: PoolStats Interface

```typescript
interface PoolStats {
  created: number;     // Timestamp when pool created
  requests: number;    // Total requests through this pool
  protocol: string;    // 'http' or 'https'
}
```

**Metrics for monitoring:**

```typescript
// Example stats:
{
  created: 1704470400000,  // 2024-01-05 10:00:00
  requests: 15234,
  protocol: 'https'
}

// Derived metrics:
// Age: Date.now() - created = 3600000ms (1 hour)
// Request rate: 15234 requests / 3600s = 4.2 req/s
```

### 2.2 Class Definition (Lines 11-14)

```typescript
class ConnectionPool {
  private agents: Map<string, http.Agent | https.Agent> = new Map();
  private stats: Map<string, PoolStats> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
}
```

#### Line 12: Agents Map

```typescript
private agents: Map<string, http.Agent | https.Agent> = new Map();
```

**Map structure:**

```typescript
// Key: "serviceName:serviceUrl"
// Value: http.Agent or https.Agent

agents = {
  'product-service:http://localhost:3003': http.Agent,
  'order-service:http://localhost:3004': http.Agent,
  'payment-api:https://api.stripe.com': https.Agent
}
```

**Why Map instead of Object?**

```typescript
// Map advantages:
// - Any key type (not just strings)
// - Maintains insertion order
// - Size property (agents.size)
// - Better performance for frequent add/delete

// Object disadvantages:
// - Only string keys
// - No size property (need Object.keys().length)
// - Prototype pollution risks
```

#### Line 13: Stats Map

```typescript
private stats: Map<string, PoolStats> = new Map();
```

**Parallel stats tracking:**

```typescript
// Same keys as agents map
stats = {
  'product-service:http://localhost:3003': {
    created: 1704470400000,
    requests: 1523,
    protocol: 'http'
  }
}
```

#### Line 14: Cleanup Interval

```typescript
private cleanupInterval: NodeJS.Timeout | null = null;
```

**Stores interval ID for cleanup task:**

```typescript
// Start cleanup:
this.cleanupInterval = setInterval(() => { ... }, 60000);

// Stop cleanup:
clearInterval(this.cleanupInterval);
this.cleanupInterval = null;
```

### 2.3 Get Agent Method (Lines 16-50)

```typescript
getAgent(serviceName: string, serviceUrl: string): http.Agent | https.Agent {
  const key = `${serviceName}:${serviceUrl}`;

  if (!this.agents.has(key)) {
    const isHttps = serviceUrl.startsWith('https://');
    const Agent = isHttps ? https.Agent : http.Agent;

    const agent = new Agent({
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: 100,
      maxFreeSockets: 10,
      timeout: 60000,
      scheduling: 'lifo'
    });

    this.agents.set(key, agent);
    this.stats.set(key, {
      created: Date.now(),
      requests: 0,
      protocol: isHttps ? 'https' : 'http'
    });

    logger.debug(`Created connection pool for ${serviceName}`, {
      service: serviceName,
      url: serviceUrl,
      protocol: isHttps ? 'https' : 'http'
    });
  }

  const stats = this.stats.get(key)!;
  stats.requests++;

  return this.agents.get(key)!;
}
```

**Purpose:** Get or create HTTP agent for service.

#### Line 17: Generate Key

```typescript
const key = `${serviceName}:${serviceUrl}`;
```

**Unique key per service + URL:**

```typescript
serviceName = 'product-service'
serviceUrl = 'http://localhost:3003'
key = 'product-service:http://localhost:3003'

// Different URLs for same service = different pools:
'product-service:http://localhost:3003'  // Pool 1
'product-service:http://localhost:3004'  // Pool 2 (different port)
```

**Why include both?**

```typescript
// Scenario: Multiple instances of same service
// Load balancer at different URLs:
'product-service:http://lb1.example.com'
'product-service:http://lb2.example.com'

// Need separate connection pools ✅
// Each URL has different backend servers
```

#### Lines 19-30: Create Agent (Lazy Initialization)

```typescript
if (!this.agents.has(key)) {
  const isHttps = serviceUrl.startsWith('https://');
  const Agent = isHttps ? https.Agent : http.Agent;

  const agent = new Agent({
    keepAlive: true,
    keepAliveMsecs: 30000,
    maxSockets: 100,
    maxFreeSockets: 10,
    timeout: 60000,
    scheduling: 'lifo'
  });
```

**Lazy initialization:**

```typescript
// Only create agent when first request arrives
// Not at application startup

// Benefits:
// - Don't create unused pools ✅
// - Faster startup time ✅
// - Only consume resources for services actually used ✅
```

**Line 20: Detect Protocol**

```typescript
const isHttps = serviceUrl.startsWith('https://');
```

**Protocol detection:**

```typescript
'https://api.example.com' → true  (https.Agent)
'http://localhost:3000'   → false (http.Agent)
```

**Line 21: Select Agent Class**

```typescript
const Agent = isHttps ? https.Agent : http.Agent;
```

**Dynamic class selection:**

```typescript
// Assign class to variable
const Agent = https.Agent;

// Then instantiate
const agent = new Agent({ ... });

// Equivalent to:
const agent = new https.Agent({ ... });
```

**Lines 23-30: Agent Configuration**

```typescript
const agent = new Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 100,
  maxFreeSockets: 10,
  timeout: 60000,
  scheduling: 'lifo'
});
```

**Parameter breakdown:**

```typescript
// keepAlive: true
// Enable HTTP Keep-Alive (reuse connections)
// Without: Each request creates new connection ❌
// With: Connections reused ✅

// keepAliveMsecs: 30000 (30 seconds)
// Send TCP keep-alive packet every 30s
// Prevents firewalls from closing idle connections

// maxSockets: 100
// Maximum 100 concurrent connections to this service
// Request 101 waits until a connection frees up

// maxFreeSockets: 10
// Keep maximum 10 idle connections open
// Excess idle connections are closed

// timeout: 60000 (60 seconds)
// Close connection if idle for 60 seconds
// Prevents accumulating stale connections

// scheduling: 'lifo'
// Last In First Out (use newest connections)
// Allows older connections to timeout
// Reduces total connection count
```

**Production tuning:**

```typescript
// High-traffic service (1000 req/s):
{
  maxSockets: 200,         // More concurrent connections
  maxFreeSockets: 50,      // Keep more idle connections
  timeout: 30000,          // Shorter timeout (churn connections)
  scheduling: 'lifo'       // Concentrate load
}

// Low-traffic service (10 req/s):
{
  maxSockets: 20,          // Fewer connections needed
  maxFreeSockets: 2,       // Keep minimal idle
  timeout: 120000,         // Longer timeout (stable connections)
  scheduling: 'lifo'       // Allow excess to timeout
}
```

#### Lines 32-43: Store Agent and Stats

```typescript
this.agents.set(key, agent);
this.stats.set(key, {
  created: Date.now(),
  requests: 0,
  protocol: isHttps ? 'https' : 'http'
});

logger.debug(`Created connection pool for ${serviceName}`, {
  service: serviceName,
  url: serviceUrl,
  protocol: isHttps ? 'https' : 'http'
});
```

**Initialize stats:**

```typescript
{
  created: 1704470400000,  // Current timestamp
  requests: 0,             // No requests yet
  protocol: 'https'        // Detected protocol
}
```

**Debug log:**

```json
{
  "level": "debug",
  "message": "Created connection pool for product-service",
  "service": "product-service",
  "url": "http://localhost:3003",
  "protocol": "http",
  "timestamp": "2024-01-05T10:00:00.000Z"
}
```

#### Lines 46-49: Update Stats and Return

```typescript
const stats = this.stats.get(key)!;
stats.requests++;

return this.agents.get(key)!;
```

**Increment request counter:**

```typescript
// Every call increments counter
// For request rate metrics

// First call:  requests = 0 → 1
// Second call: requests = 1 → 2
// Third call:  requests = 2 → 3
```

**Non-null assertion (`!`):**

```typescript
this.agents.get(key)!
// TypeScript: "I guarantee this exists"
// Safe because we just created it above if missing
```

### 2.4 Get Stats Method (Lines 52-68)

```typescript
getStats(serviceName?: string): PoolStats[] | Record<string, PoolStats & { age: number }> {
  if (serviceName) {
    const stats: (PoolStats & { key: string; age: number })[] = [];
    for (const [key, stat] of this.stats.entries()) {
      if (key.startsWith(`${serviceName}:`)) {
        stats.push({ key, ...stat, age: Date.now() - stat.created });
      }
    }
    return stats;
  }

  const allStats: Record<string, PoolStats & { age: number }> = {};
  for (const [key, stat] of this.stats.entries()) {
    allStats[key] = { ...stat, age: Date.now() - stat.created };
  }
  return allStats;
}
```

**Purpose:** Get pool statistics.

**Two modes:**

```typescript
// 1. Specific service
getStats('product-service')
// Returns: Array of stats for all product-service pools

// 2. All services
getStats()
// Returns: Object with all pool stats
```

#### Lines 53-60: Service-Specific Stats

```typescript
if (serviceName) {
  const stats: (PoolStats & { key: string; age: number })[] = [];
  for (const [key, stat] of this.stats.entries()) {
    if (key.startsWith(`${serviceName}:`)) {
      stats.push({ key, ...stat, age: Date.now() - stat.created });
    }
  }
  return stats;
}
```

**Filter by service name:**

```typescript
// Find all keys starting with "product-service:"
'product-service:http://localhost:3003'  ✅ Match
'product-service:http://localhost:3004'  ✅ Match
'order-service:http://localhost:3005'    ❌ No match

// Return:
[
  {
    key: 'product-service:http://localhost:3003',
    created: 1704470400000,
    requests: 1523,
    protocol: 'http',
    age: 3600000  // 1 hour
  },
  {
    key: 'product-service:http://localhost:3004',
    created: 1704471000000,
    requests: 842,
    protocol: 'http',
    age: 3000000  // 50 minutes
  }
]
```

**Age calculation:**

```typescript
age: Date.now() - stat.created

// created: 1704470400000 (10:00:00)
// now:     1704474000000 (11:00:00)
// age:     3600000ms = 1 hour
```

#### Lines 62-67: All Stats

```typescript
const allStats: Record<string, PoolStats & { age: number }> = {};
for (const [key, stat] of this.stats.entries()) {
  allStats[key] = { ...stat, age: Date.now() - stat.created };
}
return allStats;
```

**Return all pools:**

```typescript
{
  'product-service:http://localhost:3003': {
    created: 1704470400000,
    requests: 1523,
    protocol: 'http',
    age: 3600000
  },
  'order-service:http://localhost:3004': {
    created: 1704471000000,
    requests: 842,
    protocol: 'http',
    age: 3000000
  }
}
```

### 2.5 Get Health Method (Lines 70-88)

```typescript
getHealth(): Record<string, { activeSockets: number; freeSockets: number; requests: number }> {
  const health: Record<string, { activeSockets: number; freeSockets: number; requests: number }> = {};

  for (const [key, agent] of this.agents.entries()) {
    const sockets = (agent as any).sockets || {};
    const freeSockets = (agent as any).freeSockets || {};

    const totalSockets = Object.values(sockets).reduce((sum: number, arr: any) => sum + arr.length, 0);
    const totalFree = Object.values(freeSockets).reduce((sum: number, arr: any) => sum + arr.length, 0);

    health[key] = {
      activeSockets: totalSockets,
      freeSockets: totalFree,
      requests: this.stats.get(key)?.requests || 0
    };
  }

  return health;
}
```

**Purpose:** Get real-time connection health.

#### Lines 74-75: Access Internal State

```typescript
const sockets = (agent as any).sockets || {};
const freeSockets = (agent as any).freeSockets || {};
```

**Why `(agent as any)`?**

```typescript
// Agent's internal properties not exposed in types
// But exist at runtime

interface Agent {
  // Public API
  destroy(): void;
  
  // Internal (not in types, but exist)
  sockets: { [host: string]: Socket[] }      // Active connections
  freeSockets: { [host: string]: Socket[] }  // Idle connections
}

// Cast to `any` to access internal properties
const sockets = (agent as any).sockets;
```

**Socket structure:**

```typescript
// sockets (active connections)
{
  'localhost:3003:': [socket1, socket2, socket3],  // 3 active
  'localhost:3004:': [socket4]                     // 1 active
}

// freeSockets (idle connections)
{
  'localhost:3003:': [socket5, socket6],  // 2 idle
  'localhost:3004:': []                   // 0 idle
}
```

#### Lines 77-78: Count Sockets

```typescript
const totalSockets = Object.values(sockets).reduce((sum: number, arr: any) => sum + arr.length, 0);
const totalFree = Object.values(freeSockets).reduce((sum: number, arr: any) => sum + arr.length, 0);
```

**Count across all hosts:**

```typescript
// sockets:
{
  'localhost:3003:': [socket1, socket2, socket3],  // length: 3
  'localhost:3004:': [socket4]                     // length: 1
}

// Object.values() → [[socket1, socket2, socket3], [socket4]]
// .reduce((sum, arr) => sum + arr.length, 0)
// → 0 + 3 + 1 = 4 total active sockets
```

#### Lines 80-84: Build Health Object

```typescript
health[key] = {
  activeSockets: totalSockets,
  freeSockets: totalFree,
  requests: this.stats.get(key)?.requests || 0
};
```

**Example health data:**

```typescript
{
  'product-service:http://localhost:3003': {
    activeSockets: 15,   // 15 connections handling requests
    freeSockets: 5,      // 5 idle connections waiting
    requests: 1523       // 1523 total requests through pool
  },
  'order-service:http://localhost:3004': {
    activeSockets: 3,
    freeSockets: 2,
    requests: 842
  }
}
```

**Health interpretation:**

```typescript
// Healthy pool:
activeSockets: 10, freeSockets: 5
// → Good balance, some capacity available ✅

// Saturated pool:
activeSockets: 100, freeSockets: 0
// → All connections in use, requests queuing ⚠️
// → Consider increasing maxSockets

// Idle pool:
activeSockets: 0, freeSockets: 10
// → No current activity, connections waiting ✅

// Over-allocated pool:
activeSockets: 2, freeSockets: 98
// → Too many idle connections ⚠️
// → Consider decreasing maxFreeSockets
```

### 2.6 Destroy Agent Method (Lines 90-99)

```typescript
destroyAgent(serviceName: string): void {
  for (const [key, agent] of this.agents.entries()) {
    if (key.startsWith(`${serviceName}:`)) {
      agent.destroy();
      this.agents.delete(key);
      this.stats.delete(key);
      logger.info(`Destroyed connection pool for ${serviceName}`);
    }
  }
}
```

**Purpose:** Destroy all agents for a service.

**Use cases:**

```typescript
// 1. Service decommissioned
connectionPool.destroyAgent('old-service');
// Cleanup connections to removed service

// 2. Service URL changed
connectionPool.destroyAgent('product-service');
// Force recreation with new URL on next request

// 3. Connection issues
connectionPool.destroyAgent('problem-service');
// Reset all connections (nuclear option)
```

**agent.destroy():**

```typescript
// Closes all sockets (active + free)
// Prevents new connections
// Cleans up resources

agent.destroy();
// All connections closed ✂️
// Memory freed ✅
```

### 2.7 Destroy All Method (Lines 101-108)

```typescript
destroyAll(): void {
  for (const agent of this.agents.values()) {
    agent.destroy();
  }
  this.agents.clear();
  this.stats.clear();
  logger.info('Destroyed all connection pools');
}
```

**Purpose:** Cleanup all pools (application shutdown).

**Graceful shutdown flow:**

```typescript
// Server shutting down
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down...');
  
  // 1. Stop accepting new requests
  server.close();
  
  // 2. Wait for in-flight requests
  await waitForRequests();
  
  // 3. Destroy all connection pools
  connectionPool.destroyAll();
  
  // 4. Close database connections
  await db.close();
  
  // 5. Exit
  process.exit(0);
});
```

### 2.8 Cleanup Methods (Lines 110-128)

```typescript
startCleanup(intervalMs = 60000): void {
  this.cleanupInterval = setInterval(() => {
    logger.debug('Running connection pool cleanup');
    for (const [key, agent] of this.agents.entries()) {
      const freeSockets = (agent as any).freeSockets || {};
      const totalFree = Object.values(freeSockets).reduce((sum: number, arr: any) => sum + arr.length, 0);
      if (totalFree > 0) {
        logger.debug('Connection pool cleanup', { key, freeSockets: totalFree });
      }
    }
  }, intervalMs);
}

stopCleanup(): void {
  if (this.cleanupInterval) {
    clearInterval(this.cleanupInterval);
    this.cleanupInterval = null;
  }
}
```

**Purpose:** Periodic logging of idle connections.

**Note:** Current implementation only logs, doesn't actually cleanup.

**Enhanced cleanup implementation:**

```typescript
startCleanup(intervalMs = 60000): void {
  this.cleanupInterval = setInterval(() => {
    logger.debug('Running connection pool cleanup');
    
    for (const [key, agent] of this.agents.entries()) {
      const freeSockets = (agent as any).freeSockets || {};
      const totalFree = Object.values(freeSockets).reduce(
        (sum: number, arr: any) => sum + arr.length, 0
      );
      
      // Close excess free connections
      if (totalFree > 10) {
        const excess = totalFree - 10;
        logger.info('Closing excess connections', { 
          key, 
          freeSockets: totalFree,
          closing: excess 
        });
        
        // Close oldest free sockets
        for (const [host, sockets] of Object.entries(freeSockets)) {
          const toClose = (sockets as any[]).slice(0, excess);
          toClose.forEach((socket: any) => socket.destroy());
        }
      }
    }
  }, intervalMs);
}
```

### 2.9 Singleton Export (Lines 131-132)

```typescript
const connectionPool = new ConnectionPool();
export default connectionPool;
```

**Singleton pattern:**

```typescript
// Single instance shared across application
import connectionPool from './ConnectionPool';

// All imports get same instance
// Ensures connection pools are truly pooled ✅
```

**Usage:**

```typescript
// Module A
import connectionPool from './ConnectionPool';
const agent1 = connectionPool.getAgent('product-service', 'http://...');

// Module B
import connectionPool from './ConnectionPool';
const agent2 = connectionPool.getAgent('product-service', 'http://...');

// agent1 === agent2 ✅ (same instance)
```

---

## 🎯 SECTION 3: REAL-WORLD USAGE

### 3.1 With Axios

```typescript
import axios from 'axios';
import connectionPool from './lib/ConnectionPool';

async function getProduct(productId: number) {
  const agent = connectionPool.getAgent(
    'product-service',
    'http://localhost:3003'
  );
  
  const response = await axios.get(
    `http://localhost:3003/products/${productId}`,
    {
      httpAgent: agent,  // Use pooled agent
      timeout: 5000
    }
  );
  
  return response.data;
}
```

### 3.2 Monitoring Dashboard

```typescript
app.get('/admin/connection-pools', authenticate(), authorize('admin'), (req, res) => {
  const stats = connectionPool.getStats();
  const health = connectionPool.getHealth();
  
  const dashboard = Object.keys(stats).map(key => ({
    service: key,
    age: Math.floor(stats[key].age / 1000) + 's',
    requests: stats[key].requests,
    protocol: stats[key].protocol,
    activeSockets: health[key]?.activeSockets || 0,
    freeSockets: health[key]?.freeSockets || 0,
    utilization: health[key] 
      ? `${Math.floor((health[key].activeSockets / 100) * 100)}%`
      : '0%'
  }));
  
  res.json(dashboard);
});

// Response:
[
  {
    "service": "product-service:http://localhost:3003",
    "age": "3600s",
    "requests": 1523,
    "protocol": "http",
    "activeSockets": 15,
    "freeSockets": 5,
    "utilization": "15%"
  },
  {
    "service": "order-service:http://localhost:3004",
    "age": "3000s",
    "requests": 842,
    "protocol": "http",
    "activeSockets": 50,
    "freeSockets": 0,
    "utilization": "50%"
  }
]
```

### 3.3 Graceful Shutdown

```typescript
const server = app.listen(3000);

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, starting graceful shutdown');
  
  // 1. Stop accepting new requests
  server.close(() => {
    logger.info('HTTP server closed');
  });
  
  // 2. Wait for in-flight requests (up to 30s)
  setTimeout(() => {
    logger.warn('Forcing shutdown after 30s');
    
    // 3. Destroy all connection pools
    connectionPool.destroyAll();
    
    // 4. Close other resources
    redis.disconnect();
    db.close();
    
    process.exit(0);
  }, 30000);
});
```

---

**🎉 M12: CONNECTION POOL DEEP DIVE COMPLETE!**

You've mastered:
- ✅ Connection pooling fundamentals and TCP overhead
- ✅ HTTP Keep-Alive mechanism
- ✅ Connection pool parameters (maxSockets, maxFreeSockets, keepAlive, timeout, scheduling)
- ✅ LIFO vs FIFO scheduling strategies
- ✅ Lazy agent creation per service
- ✅ Protocol detection (HTTP vs HTTPS)
- ✅ Connection lifecycle (CONNECTING → ACTIVE → FREE → CLOSED)
- ✅ Health monitoring (active vs free sockets)
- ✅ Statistics tracking (requests, age, protocol)
- ✅ Graceful cleanup and shutdown
- ✅ Singleton pattern for global pool management

**Next module:** M13-BULKHEAD-ISOLATOR-DEEP-DIVE (resource isolation, bulkhead pattern)

**Progress: 12 out of 27 modules completed! (44% done)**
