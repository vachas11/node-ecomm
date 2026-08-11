# M03: Database Connection Pooling Deep Dive - PART 2

**Continued Code Analysis, Architecture, Interview Questions & Exercises**

---

## 🔍 SECTION 3: LINE-BY-LINE CODE ANALYSIS (Part 2)

### 3.1 Pool Event Handlers (Lines 45-62)

Event handlers monitor the pool's health and log important events.

#### Connect Event (Lines 45-51)

```typescript
this.pool.on('connect', () => {
  logger.info(`New client connected to ${config.database}`, {
    totalCount: this.pool.totalCount,
    idleCount: this.pool.idleCount,
    waitingCount: this.pool.waitingCount
  });
});
```

**When this fires:**
- A new connection is established to the database
- Happens during initialization (creating `min` connections)
- Happens when demand exceeds idle connections

**What's logged:**

```json
{
  "level": "info",
  "message": "New client connected to user_service_db",
  "totalCount": 6,
  "idleCount": 5,
  "waitingCount": 0
}
```

**Why log this?**

1. **Monitor pool growth:** If you see many connects, pool might be too small
2. **Detect connection issues:** No connects = database might be down
3. **Track initialization:** See when pool is ready

**Production monitoring:**

```typescript
// Alert if connections grow rapidly
let connectionCount = 0;
this.pool.on('connect', () => {
  connectionCount++;
  if (connectionCount > 50) {  // 50 connections in short time
    alertOncall('Rapid connection growth - possible connection leak');
  }
});
```

#### Error Event (Lines 53-55)

```typescript
this.pool.on('error', (err: Error) => {
  logger.error('Unexpected error on idle client', { error: err.message });
});
```

**When this fires:**
- Error occurs on an **idle** connection (not actively being used)
- Database server disconnects client
- Network issues

**Example errors:**
- `Connection terminated unexpectedly`
- `Connection reset by peer`
- `Client has been released and cannot be used anymore`

**Why critical?**

This catches errors that happen **outside** of queries:

```typescript
// Query error ← Caught by try/catch
try {
  await pool.query('SELECT * FROM users');
} catch (err) {
  // Handle here
}

// Idle connection error ← Caught by this event handler
// Connection was sitting idle, database server restarted
// Without this handler, error would be uncaught
```

**Production pattern:**

```typescript
this.pool.on('error', (err: Error) => {
  logger.error('Unexpected error on idle client', { error: err.message });
  
  // Critical errors that require immediate action
  if (err.message.includes('Connection terminated')) {
    alertOncall('Database connections being terminated');
  }
  
  // Track error rate
  metrics.increment('database.idle_errors');
});
```

#### Remove Event (Lines 57-62)

```typescript
this.pool.on('remove', () => {
  logger.info(`Client removed from pool ${config.database}`, {
    totalCount: this.pool.totalCount,
    idleCount: this.pool.idleCount
  });
});
```

**When this fires:**
- Connection is removed from the pool
- Happens when idle timeout expires
- Happens when connection has an error
- Happens when pool is shut down

**Why log this?**

1. **Track pool shrinkage:** If pool shrinks during traffic, might need higher `min`
2. **Detect connection issues:** Many removals = unstable connections
3. **Verify cleanup:** Ensure connections are properly closed on shutdown

**Normal pattern:**

```
12:00:00 - Traffic spike, pool grows to 20
12:05:00 - Traffic drops
12:05:30 - Idle timeout, connections start being removed
12:06:00 - Pool stabilizes at min (5)
```

### 3.2 Query Method (Lines 66-86)

This is the **primary method** for executing queries.

```typescript
async query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
  const start = Date.now();
  try {
    const result = await this.pool.query(text, params) as unknown as QueryResult<T>;
    const duration = Date.now() - start;

    logger.debug('Query executed', {
      query: text.substring(0, 100),
      duration: `${duration}ms`,
      rows: result.rowCount
    });

    return result;
  } catch (error: any) {
    logger.error('Database query error', {
      query: text.substring(0, 100),
      error: error.message
    });
    throw error;
  }
}
```

#### Line 66: Method Signature

```typescript
async query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>>
```

**Breakdown:**

- **`async`**: Returns a Promise
- **`<T = any>`**: Generic type (defaults to `any` if not specified)
- **`text: string`**: SQL query text
- **`params?: any[]`**: Optional query parameters
- **`: Promise<QueryResult<T>>`**: Return type

**Generic type usage:**

```typescript
interface User {
  id: number;
  email: string;
}

// Type-safe query
const result = await pool.query<User>(
  'SELECT id, email FROM users WHERE id = $1',
  [123]
);

// result.rows is User[]
result.rows[0].email  // ✅ TypeScript knows this exists
result.rows[0].age    // ❌ TypeScript error
```

#### Lines 67-69: Query Timing

```typescript
const start = Date.now();
try {
  const result = await this.pool.query(text, params) as unknown as QueryResult<T>;
```

**Why track timing?**

Performance monitoring:
- Detect slow queries
- Track query performance over time
- Alert on degradation

**The `as unknown as` cast:**

```typescript
as unknown as QueryResult<T>
```

**Why this weird cast?**

TypeScript issue: `pg` library has strict types that don't match our flexible `QueryResult<T>`. The double cast works around this:

```
pg.QueryResult → unknown → our QueryResult<T>
```

This is safe because we defined `QueryResult<T>` to match what `pg` actually returns.

#### Lines 70-76: Success Logging

```typescript
const duration = Date.now() - start;

logger.debug('Query executed', {
  query: text.substring(0, 100),
  duration: `${duration}ms`,
  rows: result.rowCount
});
```

**Why `logger.debug()`?**

Query logs are **very verbose** (thousands per second). Using `debug` level means:
- Not logged in production (by default)
- Can enable for debugging: `LOG_LEVEL=debug`
- Doesn't flood logs in normal operation

**Why `text.substring(0, 100)`?**

Truncate query to prevent logging huge queries:

```typescript
// Without substring
query: "SELECT * FROM users WHERE email = 'test@example.com' AND (status = 'active' OR status = 'pending') AND created_at > '2024-01-01' AND role IN ('admin', 'moderator', 'user') AND ... (5000 more characters)"

// With substring(0, 100)
query: "SELECT * FROM users WHERE email = 'test@example.com' AND (status = 'active' OR status = 'pending'..."
```

**Performance tracking:**

```typescript
// Find slow queries in logs
grep "Query executed" combined.log | \
  jq 'select(.duration | tonumber > 1000)' | \
  jq .query

// Output: Queries that took > 1 second
```

#### Lines 79-85: Error Handling

```typescript
} catch (error: any) {
  logger.error('Database query error', {
    query: text.substring(0, 100),
    error: error.message
  });
  throw error;
}
```

**Why log and re-throw?**

1. **Log first**: Capture query context (which query failed)
2. **Re-throw**: Let caller handle error (maybe retry, maybe return 500)

**Without re-throw:**

```typescript
} catch (error) {
  logger.error('Error', { error });
  // Missing: throw error;
}
// Caller thinks query succeeded! ❌
```

**Error logged:**

```json
{
  "level": "error",
  "message": "Database query error",
  "query": "SELECT * FROM users WHERE id = $1",
  "error": "relation \"users\" does not exist"
}
```

**Production pattern:**

```typescript
catch (error: any) {
  logger.error('Database query error', {
    query: text.substring(0, 100),
    error: error.message,
    code: error.code,  // PostgreSQL error code (e.g., '23505')
    stack: error.stack
  });
  
  // Translate to our error types
  if (error.code === '23505') {  // Unique violation
    throw new ConflictError('Duplicate entry');
  }
  
  throw new DatabaseError('Query failed', error);
}
```

### 3.3 Transaction Method (Lines 88-102)

Handles database transactions (BEGIN/COMMIT/ROLLBACK).

```typescript
async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await this.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error('Transaction rolled back', { error: error.message });
    throw error;
  } finally {
    client.release();
  }
}
```

#### Line 88: Method Signature

```typescript
async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>
```

**Callback pattern:**

User provides a function that receives a `client` and does work with it:

```typescript
await pool.transaction(async (client) => {
  // client is a dedicated connection
  await client.query('INSERT INTO users...');
  await client.query('INSERT INTO orders...');
  // Automatically committed if no error
});
```

**Generic `<T>`:**

Return type matches callback return type:

```typescript
const userId = await pool.transaction<number>(async (client) => {
  const result = await client.query('INSERT INTO users... RETURNING id');
  return result.rows[0].id;  // number
});
// userId is typed as number
```

#### Line 89: Acquire Client

```typescript
const client = await this.pool.connect();
```

**Critical:** Gets a **dedicated connection** from the pool.

**Why dedicated?**

All transaction statements must run on the **same connection**:

```
BEGIN    ↘
INSERT   → Same connection (C1)
UPDATE   → Same connection (C1)
COMMIT   ↗
```

#### Lines 90-93: Transaction Flow

```typescript
try {
  await client.query('BEGIN');
  const result = await callback(client);
  await client.query('COMMIT');
```

**Visual flow:**

```
1. BEGIN
   ↓
2. Execute callback (user's queries)
   ↓
3. COMMIT (if success)
```

**What BEGIN does:**

Starts a transaction. All subsequent queries are part of the transaction until COMMIT/ROLLBACK.

**What COMMIT does:**

Makes all changes permanent.

**Example:**

```typescript
await pool.transaction(async (client) => {
  // Create user
  await client.query('INSERT INTO users(email) VALUES($1)', ['john@example.com']);
  
  // Create profile
  await client.query('INSERT INTO profiles(user_id, name) VALUES($1, $2)', [userId, 'John']);
  
  // Both succeed or both fail (atomic)
});
```

#### Lines 95-98: Rollback on Error

```typescript
} catch (error: any) {
  await client.query('ROLLBACK');
  logger.error('Transaction rolled back', { error: error.message });
  throw error;
}
```

**ROLLBACK** undoes all changes made in the transaction.

**Example:**

```typescript
await pool.transaction(async (client) => {
  await client.query('INSERT INTO users(email) VALUES($1)', ['john@example.com']);
  // ✅ User inserted
  
  await client.query('INSERT INTO invalid_table(x) VALUES(1)');
  // ❌ Error: table doesn't exist
  
  // ROLLBACK triggered
  // User insert is undone
});
// Database unchanged ✅
```

**Why log before re-throw?**

Capture the error context before passing it up:

```json
{
  "level": "error",
  "message": "Transaction rolled back",
  "error": "relation \"invalid_table\" does not exist"
}
```

#### Lines 99-101: Always Release

```typescript
} finally {
  client.release();
}
```

**`finally` block:**

Runs **whether or not** an error occurred. Ensures connection is returned to pool.

**Why critical?**

**Without finally:**

```typescript
const client = await pool.connect();
await client.query('BEGIN');
throw new Error('Oops');
// ❌ client.release() never called
// ← Connection leaked! Pool exhausted over time
```

**With finally:**

```typescript
try {
  // ...
} finally {
  client.release();  // ← Always runs
}
// ✅ Connection returned to pool even on error
```

**Connection leak scenario:**

```
12:00:00 - Pool: 20 connections
12:01:00 - 5 transactions fail without release
          Pool: 15 available
12:02:00 - 10 more transactions fail
          Pool: 5 available
12:03:00 - 5 more transactions fail
          Pool: 0 available ← EXHAUSTED!
12:03:01 - All new requests hang
```

### 3.4 GetStats Method (Lines 104-110)

```typescript
getStats(): DatabaseStats {
  return {
    totalConnections: this.pool.totalCount,
    idleConnections: this.pool.idleCount,
    waitingConnections: this.pool.waitingCount
  };
}
```

**Simple method:** Returns pool metrics.

**Properties explained:**

- **`totalCount`**: Active + idle connections
- **`idleCount`**: Connections available for use
- **`waitingCount`**: Requests waiting for a connection

**Usage in monitoring:**

```typescript
// Health check endpoint
app.get('/health/database', (req, res) => {
  const stats = pool.getStats();
  
  const health = {
    status: stats.waitingConnections > 0 ? 'degraded' : 'healthy',
    stats: stats
  };
  
  res.json(health);
});

// Output:
// {
//   "status": "healthy",
//   "stats": {
//     "totalConnections": 8,
//     "idleConnections": 5,
//     "waitingConnections": 0
//   }
// }
```

**Alerting:**

```typescript
setInterval(() => {
  const stats = pool.getStats();
  
  // Alert if pool exhausted
  if (stats.waitingConnections > 5) {
    alertOncall('Database pool exhausted', { stats });
  }
  
  // Alert if pool too large
  if (stats.totalConnections === 20 && stats.idleConnections < 2) {
    logger.warn('Pool at max capacity', { stats });
  }
}, 60000);  // Check every minute
```

### 3.5 Close Method (Lines 112-116)

```typescript
async close(): Promise<void> {
  logger.info('Closing database pool...');
  await this.pool.end();
  logger.info('Database pool closed');
}
```

**What `pool.end()` does:**

1. Closes all connections in the pool
2. Rejects new connection requests
3. Waits for active connections to finish

**When to call:**

```typescript
// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing server...');
  
  // Stop accepting new requests
  server.close();
  
  // Close database pool
  await pool.close();
  
  // Exit
  process.exit(0);
});
```

**Why important?**

**Without closing:**

```typescript
// Server shuts down
// Database connections still open
// Database: "These connections are orphaned, keep them for 30 minutes..."
// Result: Waste database resources
```

**With closing:**

```typescript
await pool.close();
// All connections cleanly closed
// Database: "OK, connections closed properly"
// Result: Clean shutdown ✅
```

---

## 🏗️ SECTION 4: ARCHITECTURE DIAGRAMS

### 4.1 Pool Lifecycle

```
INITIALIZATION
──────────────
┌─────────────────────────────┐
│ new DatabasePool({ ... })   │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Create `min` connections    │
│ (5 connections)             │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────────────┐
│ Pool Ready                           │
│ [C1-idle, C2-idle, C3-idle,         │
│  C4-idle, C5-idle]                  │
└─────────────────────────────────────┘


REQUEST HANDLING
────────────────
Request arrives → pool.query('SELECT...')
           │
           ▼
┌─────────────────────────────┐
│ Pool has idle connection?   │
└──────────┬─────────┬────────┘
           │         │
       YES │         │ NO
           │         │
           ▼         ▼
    ┌──────────┐ ┌────────────────┐
    │ Borrow C1│ │ totalCount<max?│
    └─────┬────┘ └────┬──────┬────┘
          │           │      │
          │       YES │      │ NO
          │           │      │
          │           ▼      ▼
          │   ┌──────────┐ ┌─────────────┐
          │   │Create C6 │ │Wait in queue│
          │   │Borrow C6 │ │(timeout:5s) │
          │   └─────┬────┘ └──────┬──────┘
          │         │             │
          ▼         ▼             ▼
    ┌──────────────────────────────────┐
    │ Execute query on connection      │
    └──────────┬───────────────────────┘
               │
               ▼
    ┌──────────────────────────┐
    │ Return connection to pool│
    └──────────────────────────┘


IDLE TIMEOUT
────────────
Connection idle for 30s
           │
           ▼
┌─────────────────────────────┐
│ totalCount > min?           │
└──────────┬─────────┬────────┘
           │         │
       YES │         │ NO
           │         │
           ▼         ▼
    ┌──────────┐ ┌────────────┐
    │ Close    │ │ Keep alive │
    │connection│ │            │
    └──────────┘ └────────────┘
```

### 4.2 Query vs Transaction Flow

```
SIMPLE QUERY
────────────
pool.query('SELECT...')
    │
    ├─ Borrow connection from pool
    │
    ├─ Execute query
    │
    └─ Return connection to pool
       (automatic, happens in pg library)


TRANSACTION
───────────
pool.transaction(async (client) => {
    │
    ├─ pool.connect() ← Borrow dedicated client
    │
    ├─ BEGIN
    │
    ├─ client.query('INSERT...')
    │     │
    │     └─ Uses same client (C1)
    │
    ├─ client.query('UPDATE...')
    │     │
    │     └─ Uses same client (C1)
    │
    ├─ COMMIT (on success)
    │  OR
    │  ROLLBACK (on error)
    │
    └─ client.release() ← Return to pool
       (in finally block)
});
```

### 4.3 Connection States

```
┌────────────────────────────────────────┐
│            CONNECTION POOL             │
│                                        │
│  ┌──────────────────────────────────┐ │
│  │         IDLE STATE               │ │
│  │  [C1, C2, C3, C4, C5]           │ │
│  │  Ready for use                   │ │
│  └─────────┬────────────────────────┘ │
│            │                           │
│            │ Request arrives           │
│            ▼                           │
│  ┌──────────────────────────────────┐ │
│  │         ACTIVE STATE             │ │
│  │  C1: Executing query             │ │
│  │  Duration: 0-5000ms              │ │
│  └─────────┬────────────────────────┘ │
│            │                           │
│            │ Query completes           │
│            ▼                           │
│  ┌──────────────────────────────────┐ │
│  │         IDLE STATE               │ │
│  │  [C1, C2, C3, C4, C5]           │ │
│  └─────────┬────────────────────────┘ │
│            │                           │
│            │ Idle for 30s              │
│            ▼                           │
│  ┌──────────────────────────────────┐ │
│  │         CLOSED STATE             │ │
│  │  Connection terminated           │ │
│  │  (if above min)                  │ │
│  └──────────────────────────────────┘ │
│                                        │
└────────────────────────────────────────┘
```

---

## 🎯 SECTION 5: 10 INTERVIEW QUESTIONS

### Q1: What is connection pooling and why is it needed?

**Level:** Junior

**Answer:**

Connection pooling is reusing database connections instead of creating new ones for each request.

**Why needed:**

Creating a new connection is expensive (50-100ms overhead):
- TCP handshake
- SSL negotiation
- Authentication
- Database initialization

At 1000 req/sec, that's 50-100 seconds of CPU time wasted just on connections!

With a pool of 20 connections:
- Connections created once at startup
- Reused for all requests
- 0-1ms overhead per request
- Can handle 10,000+ req/sec

**Real impact:**
- Without pool: ~100 req/sec max
- With pool: 10,000+ req/sec

---

### Q2: Explain the `min` and `max` pool configuration

**Level:** Junior/Mid

**Answer:**

**min:** Minimum connections kept alive even when idle
- Default: 5
- Ensures fast response to new requests
- Too high: wastes database resources
- Too low: slow ramp-up when traffic arrives

**max:** Maximum connections that can exist
- Default: 20
- Prevents overwhelming the database
- Too high: database connection limit exceeded
- Too low: requests queue up, slow responses

**How to choose:**

```
max = (db_max_connections * 0.8) / app_instances

Example:
- PostgreSQL max_connections = 100
- 2 app instances
- max = (100 * 0.8) / 2 = 40 per instance
```

---

### Q3: Why can't you use pool.query() for transactions?

**Level:** Mid

**Answer:**

Each `pool.query()` call might use a **different connection** from the pool.

**The problem:**

```typescript
await pool.query('BEGIN');       // Connection C1
await pool.query('INSERT...');   // Connection C2 (doesn't know about BEGIN!)
await pool.query('COMMIT');      // Connection C3 (doesn't know about INSERT!)
```

Result: Transaction never committed, data lost!

**Solution:** Use a dedicated client:

```typescript
const client = await pool.connect();  // Get dedicated connection
try {
  await client.query('BEGIN');
  await client.query('INSERT...');  // Same connection
  await client.query('COMMIT');     // Same connection
} finally {
  client.release();  // Return to pool
}
```

**Better:** Use the transaction helper:

```typescript
await pool.transaction(async (client) => {
  await client.query('INSERT...');
  await client.query('UPDATE...');
});
```

---

### Q4: What happens when the pool is exhausted?

**Level:** Mid

**Answer:**

When all connections are busy and a new request arrives:

1. **Check:** Is totalCount < max?
   - YES → Create new connection
   - NO → Add request to wait queue

2. **Wait in queue** with timeout (connectionTimeoutMillis: 5000ms)

3. **After 5 seconds:**
   - If connection available → Use it
   - If still waiting → Throw error: "Connection timeout"

**Example:**

```
Pool: max=20, all busy
Request 21 arrives
  ↓
Wait in queue for connection
  ↓
After 5 seconds, no connection available
  ↓
Error thrown: "Connection pool exhausted"
```

**How to handle:**

```typescript
try {
  await pool.query('SELECT...');
} catch (err) {
  if (err.message.includes('timeout')) {
    // Pool exhausted - scale up or optimize queries
    logger.error('Connection pool exhausted');
  }
}
```

---

### Q5: Why is client.release() in a finally block?

**Level:** Mid

**Answer:**

The `finally` block runs **whether or not** an error occurs. This ensures connections are always returned to the pool.

**Without finally:**

```typescript
const client = await pool.connect();
await client.query('BEGIN');
throw new Error('Something broke');
// client.release() never called!
// Connection leaked forever
```

**With finally:**

```typescript
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('INSERT...');
  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release();  // ← Always runs, even on error
}
```

**Why critical:**

Connection leaks exhaust the pool over time:
- Transaction 1 fails, leaks 1 connection
- Transaction 2 fails, leaks 1 connection
- After 20 failures → Pool completely exhausted
- All new requests hang

---

### Q6: What's the difference between idleTimeoutMillis and connectionTimeoutMillis?

**Level:** Mid

**Answer:**

**idleTimeoutMillis (30000ms):**
- How long to keep **unused** connection before closing
- Applies to connections sitting idle in the pool
- Only closes if totalCount > min

**connectionTimeoutMillis (5000ms):**
- How long to **wait** for available connection
- Applies when pool is exhausted
- Throws error if exceeded

**Visual:**

```
idleTimeoutMillis:
─────────────────────────────────
Connection idle for 30 seconds
    ↓
If totalCount > min
    ↓
Close connection


connectionTimeoutMillis:
─────────────────────────────────
Pool exhausted (all connections busy)
    ↓
New request waits
    ↓
After 5 seconds, still no connection
    ↓
Throw error
```

---

### Q7: How would you monitor pool health in production?

**Level:** Senior

**Answer:**

**1. Expose metrics endpoint:**

```typescript
app.get('/metrics/database', (req, res) => {
  const stats = pool.getStats();
  res.json({
    total: stats.totalConnections,
    idle: stats.idleConnections,
    waiting: stats.waitingConnections,
    utilizationPercent: ((stats.totalConnections - stats.idleConnections) / stats.totalConnections) * 100
  });
});
```

**2. Set up alerts:**

```typescript
// Alert if pool exhausted
if (stats.waitingConnections > 5) {
  alertPagerDuty('Database pool exhausted', { stats });
}

// Alert if utilization too high
const utilization = (stats.totalConnections - stats.idleConnections) / stats.totalConnections;
if (utilization > 0.9) {  // 90%
  alertSlack('Database pool at 90% utilization');
}
```

**3. Track metrics over time:**

```typescript
setInterval(() => {
  const stats = pool.getStats();
  
  // Send to Prometheus/Datadog
  metrics.gauge('db.pool.total', stats.totalConnections);
  metrics.gauge('db.pool.idle', stats.idleConnections);
  metrics.gauge('db.pool.waiting', stats.waitingConnections);
}, 10000);  // Every 10 seconds
```

**4. Log slow queries:**

```typescript
async query(text: string, params?: any[]) {
  const start = Date.now();
  const result = await this.pool.query(text, params);
  const duration = Date.now() - start;
  
  if (duration > 1000) {  // Slower than 1 second
    logger.warn('Slow query detected', {
      query: text.substring(0, 100),
      duration: `${duration}ms`,
      params: params
    });
  }
  
  return result;
}
```

---

### Q8: What's the purpose of the 'error' event handler on idle clients?

**Level:** Mid/Senior

**Answer:**

The `'error'` event catches errors that occur on connections **outside of active queries**.

**Scenarios:**

1. **Database server restarts:**
   - Idle connections are terminated
   - Without handler: Uncaught exception, app crashes
   - With handler: Error logged, connection removed from pool

2. **Network issues:**
   - Connection drops while idle
   - Pool automatically removes bad connection
   - Next query gets a fresh connection

3. **Database maintenance:**
   - DBA kills idle sessions
   - Handler logs event for monitoring

**Example:**

```typescript
this.pool.on('error', (err: Error) => {
  // This fires if database kills idle connection
  logger.error('Idle client error', { 
    error: err.message,
    // Error: "Connection terminated unexpectedly"
  });
  
  // pg library automatically removes the connection
  // Next query will get a different connection or create new one
});
```

**Why critical:**

Without this handler, errors on idle connections become **unhandled rejections** which crash Node.js in production.

---

### Q9: How would you implement read replicas with connection pooling?

**Level:** Senior

**Answer:**

Create separate pools for primary (write) and replicas (read):

```typescript
class DatabaseManager {
  private primaryPool: DatabasePool;
  private replicaPools: DatabasePool[];
  private currentReplicaIndex: number = 0;
  
  constructor() {
    // Primary for writes
    this.primaryPool = new DatabasePool({
      host: 'primary-db.example.com',
      database: 'mydb'
    });
    
    // Replicas for reads (round-robin)
    this.replicaPools = [
      new DatabasePool({
        host: 'replica-1.example.com',
        database: 'mydb'
      }),
      new DatabasePool({
        host: 'replica-2.example.com',
        database: 'mydb'
      })
    ];
  }
  
  // Write operations → Primary
  async write(query: string, params?: any[]) {
    return await this.primaryPool.query(query, params);
  }
  
  // Read operations → Replicas (round-robin)
  async read(query: string, params?: any[]) {
    const pool = this.replicaPools[this.currentReplicaIndex];
    this.currentReplicaIndex = (this.currentReplicaIndex + 1) % this.replicaPools.length;
    
    try {
      return await pool.query(query, params);
    } catch (err) {
      // Replica down? Fallback to primary
      logger.warn('Replica query failed, falling back to primary', { error: err });
      return await this.primaryPool.query(query, params);
    }
  }
  
  // Transactions always go to primary
  async transaction(callback: (client) => Promise<any>) {
    return await this.primaryPool.transaction(callback);
  }
}
```

**Usage:**

```typescript
const db = new DatabaseManager();

// Write to primary
await db.write('INSERT INTO users(email) VALUES($1)', ['john@example.com']);

// Read from replica
const users = await db.read('SELECT * FROM users WHERE active = true');

// Transaction on primary
await db.transaction(async (client) => {
  await client.query('INSERT INTO orders...');
  await client.query('UPDATE inventory...');
});
```

---

### Q10: Design a database pooling strategy for microservices

**Level:** Staff/Principal

**Answer:**

**Architecture:**

```
┌─────────────────────────────────────────┐
│         API GATEWAY (Port 3000)         │
│  - No database connection               │
│  - Routes requests to services          │
└──────────────┬──────────────────────────┘
               │
    ┌──────────┼──────────┐
    │          │          │
    ▼          ▼          ▼
┌────────┐ ┌────────┐ ┌────────┐
│ User   │ │ Order  │ │Payment │
│Service │ │Service │ │Service │
│Port    │ │Port    │ │Port    │
│3001    │ │3002    │ │3003    │
└───┬────┘ └───┬────┘ └───┬────┘
    │          │          │
    ▼          ▼          ▼
┌─────────────────────────────────┐
│      PostgreSQL Cluster         │
│  - Primary (writes)             │
│  - Replica 1 (reads)            │
│  - Replica 2 (reads)            │
│  max_connections = 200          │
└─────────────────────────────────┘
```

**Per-Service Pool Configuration:**

```typescript
// Each service gets its own pool
// user-service/database.ts
const pool = new DatabasePool({
  database: 'users_db',
  max: 20,  // 20 connections per instance
  min: 5
});

// order-service/database.ts
const pool = new DatabasePool({
  database: 'orders_db',
  max: 30,  // More connections (higher traffic)
  min: 10
});
```

**Connection Budget:**

```
PostgreSQL max_connections = 200
Reserve 20 for admin/monitoring

Available = 180

Allocation:
- User Service (2 instances): 2 * 20 = 40
- Order Service (3 instances): 3 * 30 = 90
- Payment Service (2 instances): 2 * 15 = 30
- Background Jobs (1 instance): 20

Total: 180 ✅
```

**Shared Database Pattern:**

Some services share a database:

```typescript
// shared/database-factory.ts
export function createDatabasePool(serviceName: string) {
  return new DatabasePool({
    database: 'shared_db',
    max: parseInt(process.env[`DB_POOL_MAX_${serviceName.toUpperCase()}`] || '20'),
    min: parseInt(process.env[`DB_POOL_MIN_${serviceName.toUpperCase()}`] || '5')
  });
}

// user-service: DB_POOL_MAX_USER_SERVICE=25
// order-service: DB_POOL_MAX_ORDER_SERVICE=30
```

**Key Principles:**
1. **Separate pools per service** (isolation)
2. **Size based on traffic** (high traffic = larger pool)
3. **Stay within database limits** (coordinate across services)
4. **Monitor per-service** (detect which service has issues)
5. **Connection budget** (don't exceed database capacity)

---

**🎓 END OF PART 2**

Part 2 covered:
- ✅ Pool event handlers (lines 45-62)
- ✅ Query method (lines 66-86)
- ✅ Transaction method (lines 88-102)
- ✅ Stats & close methods (lines 104-117)
- ✅ Architecture diagrams
- ✅ 10 comprehensive interview questions

**📌 Next:** Check the plan to see if we need M03-PART3, or move to M04 (Redis)!

This completes the Database Connection Pooling module. Ready to continue with M04: Redis Deep Dive when you are!
