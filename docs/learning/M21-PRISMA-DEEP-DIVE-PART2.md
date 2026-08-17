# M21: Prisma Deep Dive - PART 2 (Query Optimization & Monitoring)

**Prerequisites:** M21-PART1  
**Level:** Production/Expert  
**Time to Master:** 4-5 hours  
**Focus:** Writing fast queries, profiling, and monitoring Prisma in production

---

## 📖 SECTION 1: THEORY

### The Cost of Database Queries

Every database query has a **cost** measured in:
- **Time**: Milliseconds to execute
- **CPU**: Database server processing
- **Memory**: Query buffer, sorting, temp tables
- **I/O**: Disk reads (for non-cached data)
- **Locks**: Blocking other queries

**Performance Targets:**
```
┌────────────────────────────────────────────────────────────┐
│              QUERY PERFORMANCE TARGETS                      │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  < 10ms   ⚡ Excellent (cached, indexed)                  │
│  10-50ms  ✅ Good (most queries should be here)           │
│  50-100ms ⚠️  Acceptable (complex joins, aggregations)    │
│  100-500ms ❌ Slow (needs optimization)                   │
│  > 500ms  💥 Critical (blocking, investigate immediately) │
│                                                            │
│  Real-World Impact:                                        │
│  10ms query  → 100 requests/second per connection         │
│  100ms query → 10 requests/second per connection          │
│  500ms query → 2 requests/second per connection           │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### Query Optimization Principles

**The N+1 Problem (Already Solved by Prisma):**
```typescript
// ❌ Without Prisma (N+1 queries)
const users = await db.query('SELECT * FROM users');  // 1 query
for (const user of users) {
  const orders = await db.query(
    'SELECT * FROM orders WHERE user_id = ?', 
    [user.id]
  );  // N queries (one per user)
}
// Total: 1 + N queries (if 100 users, that's 101 queries!)

// ✅ Prisma solves this automatically
const users = await prisma.user.findMany({
  include: { orders: true }  // 1-2 queries (uses JOIN or batching)
});
```

**Select Only What You Need:**
```typescript
// ❌ BAD: Fetching entire user object (20 fields)
const user = await prisma.user.findUnique({
  where: { id: 1 }
});
// Returns: { id, email, passwordHash, firstName, lastName, phone, ... }
// Payload: 5KB

// ✅ GOOD: Select only needed fields
const user = await prisma.user.findUnique({
  where: { id: 1 },
  select: { id: true, email: true }
});
// Returns: { id, email }
// Payload: 500 bytes (10x smaller)
```

---

## 🔍 SECTION 2: LINE-BY-LINE CODE ANALYSIS

### Query Logging: Development vs Production

From [services/user-service/src/config/database.ts:21-26](../../services/user-service/src/config/database.ts#L21-L26):

```typescript
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development'
    ? ['query', 'info', 'warn', 'error']
    : ['error'],
});
```

**Line-by-Line:**

```typescript
log: process.env.NODE_ENV === 'development'
│    └─ Check environment
└─ Configure what Prisma logs

  ? ['query', 'info', 'warn', 'error']
    │       │      │      └─ Errors (always log)
    │       │      └─ Warnings (deprecations, etc.)
    │       └─ Info messages (connections, etc.)
    └─ QUERY: Logs every SQL query with duration

  : ['error'],
    └─ Production: Only errors (performance!)

// Example dev logs:
// prisma:query SELECT "users"."id", "users"."email" FROM "users" WHERE "users"."id" = $1 (2ms)
// prisma:query SELECT * FROM "orders" WHERE "user_id" = $1 (15ms)
```

**Why Different in Production?**
- **Development**: See all queries to debug and optimize
- **Production**: Logging every query adds overhead (5-10ms per query)
- **Trade-off**: Less visibility but better performance

**Custom Query Logging (Production-Safe):**
```typescript
const prisma = new PrismaClient({
  log: [
    { level: 'query', emit: 'event' },  // Emit as event, not console
    { level: 'error', emit: 'stdout' }
  ]
});

// Log only slow queries (> 100ms)
prisma.$on('query', (e: any) => {
  if (e.duration > 100) {
    console.warn(`🐌 Slow query detected (${e.duration}ms):`, e.query);
  }
});
```

---

### Using `select` to Reduce Payload

```typescript
// ❌ BAD: Fetching all fields (20+ columns)
async findById(id: number) {
  return await this.prisma.user.findUnique({
    where: { id }
  });
  // Returns: { id, email, passwordHash, firstName, lastName, role, 
  //           isActive, emailVerified, phone, address, createdAt, updatedAt, ... }
  // Payload: 5KB per user
}

// ✅ GOOD: Select only needed fields
async findByIdMinimal(id: number) {
  return await this.prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true
    }
  });
  // Returns: { id, email, firstName, lastName }
  // Payload: 500 bytes per user (10x smaller)
}

// Performance comparison (1000 users):
// Without select: 5KB × 1000 = 5MB transferred
// With select:    500B × 1000 = 500KB transferred
// Savings: 90% less data transferred!
```

**Real-World Use Case:**
```typescript
// API endpoint: Get user list for dropdown
app.get('/api/users/dropdown', async (req, res) => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,  // Only what dropdown needs
      firstName: true
    },
    where: { isActive: true },
    orderBy: { firstName: 'asc' }
  });
  
  res.json(users);
  // Mobile app receives 500KB instead of 5MB → Faster load!
});
```

---

### Index Usage Verification

```typescript
// Check if query uses index
async function explainQuery() {
  const result = await prisma.$queryRaw`
    EXPLAIN ANALYZE 
    SELECT * FROM users 
    WHERE email = 'john@example.com';
  `;
  
  console.log(result);
  // Output:
  // Index Scan using users_email_key on users (cost=0.29..8.30 rows=1) (actual time=0.015..0.016 rows=1)
  //   Index Cond: (email = 'john@example.com'::text)
  // Planning Time: 0.123 ms
  // Execution Time: 0.045 ms
}

// Key indicators:
// ✅ "Index Scan" → Using index (fast)
// ❌ "Seq Scan" → Full table scan (slow, needs index)
// ✅ Execution Time < 10ms → Fast query
```

**Adding Missing Index:**
```prisma
// schema.prisma
model User {
  id    Int    @id @default(autoincrement())
  email String @unique  // ← Creates index automatically
  
  @@index([role])  // ← Add index for frequently queried field
  @@index([createdAt])  // ← For date range queries
  @@index([isActive, role])  // ← Composite index for combined filters
}
```

```bash
npx prisma migrate dev --name add_performance_indexes
```

---

### Pagination: Offset vs Cursor

#### Offset-Based Pagination (Simple but Slow)

```typescript
async function getUsers(page: number, pageSize: number = 20) {
  const skip = (page - 1) * pageSize;
  
  return await prisma.user.findMany({
    skip,      // Skip first N records
    take: pageSize,
    orderBy: { createdAt: 'desc' }
  });
}

// Page 1: skip=0,  take=20 → Fast (0-20)
// Page 2: skip=20, take=20 → Fast (20-40)
// Page 100: skip=1980, take=20 → SLOW! Database scans 1980 rows first
```

**Performance Problem:**
```sql
-- Page 100 query
SELECT * FROM users 
ORDER BY created_at DESC 
OFFSET 1980 LIMIT 20;

-- Database must:
-- 1. Scan 2000 rows (1980 + 20)
-- 2. Sort all 2000 rows
-- 3. Discard first 1980 rows
-- 4. Return last 20 rows
-- Time: O(n) where n = page * pageSize
```

#### Cursor-Based Pagination (Fast for Deep Pages)

```typescript
async function getUsersCursor(cursor?: number, pageSize: number = 20) {
  return await prisma.user.findMany({
    take: pageSize,
    skip: cursor ? 1 : 0,  // Skip cursor itself
    cursor: cursor ? { id: cursor } : undefined,
    orderBy: { id: 'asc' }
  });
}

// Usage:
// Page 1: getUsersCursor(undefined, 20) → Returns users 1-20
// Page 2: getUsersCursor(20, 20)        → Returns users 21-40
// Page 100: getUsersCursor(1980, 20)    → Still fast!
```

**Generated SQL:**
```sql
-- Cursor-based (fast even for deep pages)
SELECT * FROM users 
WHERE id > 1980 
ORDER BY id ASC 
LIMIT 20;

-- Uses index on id → O(log n + pageSize)
-- No scanning of previous pages!
```

**Performance Comparison:**
```
Page 1:    Offset: 10ms, Cursor: 10ms (same)
Page 10:   Offset: 15ms, Cursor: 10ms
Page 100:  Offset: 150ms, Cursor: 10ms ← 15x faster!
Page 1000: Offset: 1500ms, Cursor: 10ms ← 150x faster!
```

---

### Query Batching with Prisma

```typescript
// ❌ BAD: N queries in a loop
async function getUsersWithOrderCounts(userIds: number[]) {
  const results = [];
  
  for (const id of userIds) {
    const user = await prisma.user.findUnique({ where: { id } });
    const orderCount = await prisma.order.count({ where: { userId: id } });
    results.push({ ...user, orderCount });
  }
  
  return results;
}
// 100 users → 200 queries (100 findUnique + 100 count)

// ✅ GOOD: Batch queries
async function getUsersWithOrderCountsBatched(userIds: number[]) {
  const [users, orderCounts] = await Promise.all([
    // 1 query for all users
    prisma.user.findMany({
      where: { id: { in: userIds } }
    }),
    
    // 1 query for all counts
    prisma.order.groupBy({
      by: ['userId'],
      _count: true,
      where: { userId: { in: userIds } }
    })
  ]);
  
  // Merge in memory
  const countMap = new Map(
    orderCounts.map(c => [c.userId, c._count])
  );
  
  return users.map(user => ({
    ...user,
    orderCount: countMap.get(user.id) || 0
  }));
}
// 100 users → 2 queries (findMany + groupBy)
```

---

## 🏗️ SECTION 3: ARCHITECTURE & FLOW DIAGRAMS

### Query Optimization Decision Tree

```
┌────────────────────────────────────────────────────────────┐
│            QUERY OPTIMIZATION FLOWCHART                     │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  Is query slow (> 100ms)?                                  │
│  │                                                         │
│  ├─ NO → ✅ No optimization needed                        │
│  │                                                         │
│  └─ YES → Check EXPLAIN ANALYZE                           │
│      │                                                     │
│      ├─ "Seq Scan" found?                                 │
│      │  └─ YES → Add index (@@index)                     │
│      │           Re-run migration                         │
│      │                                                     │
│      ├─ Fetching many fields?                             │
│      │  └─ YES → Use select: { ... }                     │
│      │           Reduce payload size                      │
│      │                                                     │
│      ├─ N+1 query pattern?                                │
│      │  └─ YES → Use include or batch with Promise.all   │
│      │                                                     │
│      ├─ Deep pagination (page > 10)?                      │
│      │  └─ YES → Switch to cursor pagination             │
│      │                                                     │
│      ├─ Complex aggregation?                              │
│      │  └─ YES → Consider raw SQL with indexes           │
│      │           Or database view                         │
│      │                                                     │
│      └─ Still slow?                                        │
│         └─ YES → Cache with Redis                         │
│                   Or denormalize data                     │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### Monitoring Architecture

```
┌────────────────────────────────────────────────────────────┐
│        PRODUCTION MONITORING STACK                          │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  Application (Node.js + Prisma)                           │
│  ┌──────────────────────────────────────┐                 │
│  │ Prisma middleware captures:          │                 │
│  │ - Query duration                     │                 │
│  │ - Query type (findMany, create, etc)│                 │
│  │ - Table name                         │                 │
│  └────────────┬─────────────────────────┘                 │
│               │                                            │
│               ↓                                            │
│  Prometheus (Metrics Storage)                             │
│  ┌──────────────────────────────────────┐                 │
│  │ Time-series database:                │                 │
│  │ - prisma_query_duration_ms           │                 │
│  │ - prisma_query_count_total           │                 │
│  │ - prisma_pool_connections_active     │                 │
│  └────────────┬─────────────────────────┘                 │
│               │                                            │
│               ↓                                            │
│  Grafana (Visualization)                                  │
│  ┌──────────────────────────────────────┐                 │
│  │ Dashboards:                          │                 │
│  │ - Query latency P50, P95, P99        │                 │
│  │ - Slow query count (> 100ms)        │                 │
│  │ - Connection pool utilization        │                 │
│  │ - Error rate                         │                 │
│  └────────────┬─────────────────────────┘                 │
│               │                                            │
│               ↓                                            │
│  Alerting (PagerDuty, Slack)                              │
│  ┌──────────────────────────────────────┐                 │
│  │ Alerts:                              │                 │
│  │ - P95 latency > 200ms                │                 │
│  │ - Error rate > 1%                    │                 │
│  │ - Pool exhaustion detected           │                 │
│  └──────────────────────────────────────┘                 │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

## 🎯 SECTION 4: PRACTICAL EXAMPLES & INTERVIEW PREP

### Example 1: Prisma Middleware for Query Monitoring

```typescript
// src/middleware/prisma-monitor.ts

import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';

// Track query metrics
const queryMetrics = {
  count: 0,
  totalDuration: 0,
  slowQueries: [] as Array<{ query: string; duration: number; timestamp: Date }>
};

export function setupPrismaMonitoring() {
  prisma.$use(async (params, next) => {
    const start = Date.now();
    
    try {
      // Execute query
      const result = await next(params);
      
      // Calculate duration
      const duration = Date.now() - start;
      
      // Update metrics
      queryMetrics.count++;
      queryMetrics.totalDuration += duration;
      
      // Log slow queries
      if (duration > 100) {
        const slowQuery = {
          query: `${params.model}.${params.action}`,
          duration,
          timestamp: new Date()
        };
        
        queryMetrics.slowQueries.push(slowQuery);
        
        console.warn(`🐌 Slow query detected:`, {
          model: params.model,
          action: params.action,
          duration: `${duration}ms`,
          args: JSON.stringify(params.args).substring(0, 200)  // Truncate
        });
      }
      
      return result;
      
    } catch (error) {
      const duration = Date.now() - start;
      
      console.error(`❌ Query error:`, {
        model: params.model,
        action: params.action,
        duration: `${duration}ms`,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      throw error;
    }
  });
}

// Metrics endpoint
export function getQueryMetrics() {
  return {
    totalQueries: queryMetrics.count,
    avgDuration: queryMetrics.totalDuration / queryMetrics.count,
    slowQueries: queryMetrics.slowQueries.slice(-10)  // Last 10
  };
}
```

**Usage in app:**
```typescript
// src/server.ts
import { setupPrismaMonitoring, getQueryMetrics } from './middleware/prisma-monitor';

setupPrismaMonitoring();

app.get('/metrics/queries', (req, res) => {
  res.json(getQueryMetrics());
});
```

---

### Example 2: Caching Slow Queries with Redis

```typescript
// src/utils/query-cache.ts

import Redis from 'ioredis';
import { prisma } from '../config/database';

const redis = new Redis(process.env.REDIS_URL);

export async function getCachedUser(id: number, ttl: number = 300) {
  const cacheKey = `user:${id}`;
  
  // Try cache first
  const cached = await redis.get(cacheKey);
  if (cached) {
    console.log(`✅ Cache hit: ${cacheKey}`);
    return JSON.parse(cached);
  }
  
  console.log(`❌ Cache miss: ${cacheKey}`);
  
  // Fetch from database
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true
    }
  });
  
  if (user) {
    // Store in cache for 5 minutes
    await redis.setex(cacheKey, ttl, JSON.stringify(user));
  }
  
  return user;
}

// Invalidate cache on update
export async function updateUserWithCacheInvalidation(
  id: number, 
  data: any
) {
  const user = await prisma.user.update({
    where: { id },
    data
  });
  
  // Invalidate cache
  await redis.del(`user:${id}`);
  
  return user;
}
```

**Performance Impact:**
```
Without cache:
  - Database query: 50ms
  - 1000 requests/min → 50 seconds of DB time

With cache (90% hit rate):
  - Cache hit: 2ms (900 requests)
  - Cache miss: 50ms (100 requests)
  - Total: 1.8s + 5s = 6.8s (87% faster!)
```

---

### Example 3: Optimizing Complex Queries

**Scenario:** Get users with order statistics.

```typescript
// ❌ SLOW: Multiple queries
async function getUsersWithStats() {
  const users = await prisma.user.findMany();
  
  for (const user of users) {
    user.orderCount = await prisma.order.count({
      where: { userId: user.id }
    });
    
    user.totalSpent = (await prisma.order.aggregate({
      where: { userId: user.id, status: 'completed' },
      _sum: { totalAmount: true }
    }))._sum.totalAmount;
  }
  
  return users;
}
// 100 users → 201 queries (1 findMany + 100 count + 100 aggregate)

// ✅ FAST: Single query with raw SQL
async function getUsersWithStatsOptimized() {
  return await prisma.$queryRaw`
    SELECT 
      u.id,
      u.email,
      u.first_name,
      u.last_name,
      COUNT(o.id) as order_count,
      COALESCE(SUM(CASE WHEN o.status = 'completed' THEN o.total_amount ELSE 0 END), 0) as total_spent
    FROM users u
    LEFT JOIN orders o ON o.user_id = u.id
    GROUP BY u.id, u.email, u.first_name, u.last_name
    ORDER BY total_spent DESC
    LIMIT 100;
  `;
}
// 100 users → 1 query (200x faster!)
```

---

## 🎙️ INTERVIEW QUESTIONS

### 1. **Q:** How do you identify slow queries in a Prisma application?

**A:**
**Multiple Approaches:**

**1. Development: Query Logging**
```typescript
const prisma = new PrismaClient({
  log: ['query']  // Logs all queries with duration
});
// Output: prisma:query SELECT * FROM users (duration: 150ms)
```

**2. Production: Middleware**
```typescript
prisma.$use(async (params, next) => {
  const start = Date.now();
  const result = await next(params);
  const duration = Date.now() - start;
  
  if (duration > 100) {
    console.warn(`Slow query: ${params.model}.${params.action} (${duration}ms)`);
  }
  
  return result;
});
```

**3. Database: PostgreSQL Logs**
```sql
-- Enable slow query logging
ALTER SYSTEM SET log_min_duration_statement = 100;  -- Log queries > 100ms
SELECT pg_reload_conf();

-- View slow queries
SELECT query, calls, mean_exec_time 
FROM pg_stat_statements 
WHERE mean_exec_time > 100 
ORDER BY mean_exec_time DESC;
```

**4. APM Tools:** Datadog, New Relic, Sentry (automatic query tracing)

### 2. **Q:** What's the difference between offset-based and cursor-based pagination? When would you use each?

**A:**

| Feature | Offset | Cursor |
|---------|--------|--------|
| **Performance** | Degrades with page number | Consistent (always fast) |
| **Deep pages** | Slow (page 100+) | ✅ Fast |
| **Jump to page** | ✅ Yes (page 50) | ❌ No (sequential only) |
| **Simplicity** | ✅ Simple | More complex |
| **Real-time data** | Can skip/duplicate rows | ✅ Consistent |

**Use Offset When:**
- ✅ Small datasets (< 10,000 rows)
- ✅ Need page numbers (1, 2, 3...)
- ✅ Users rarely go past page 10

**Use Cursor When:**
- ✅ Large datasets (100,000+ rows)
- ✅ Infinite scroll (mobile apps, feeds)
- ✅ Real-time data (new rows added frequently)

**Example:**
```typescript
// Offset: Good for small lists
const page3 = await prisma.user.findMany({
  skip: 40,  // Page 3 (20 per page)
  take: 20
});

// Cursor: Good for infinite scroll
const nextPage = await prisma.user.findMany({
  take: 20,
  cursor: { id: lastSeenUserId },
  skip: 1  // Skip the cursor itself
});
```

### 3. **Q:** How do you use `select` to improve query performance?

**A:**
`select` reduces payload size by fetching only needed fields.

**Problem:**
```typescript
// Fetches ALL 20+ fields
const user = await prisma.user.findUnique({ where: { id: 1 } });
// Payload: 5KB (includes passwordHash, createdAt, updatedAt, etc.)
```

**Solution:**
```typescript
// Fetches only 3 fields
const user = await prisma.user.findUnique({
  where: { id: 1 },
  select: {
    id: true,
    email: true,
    firstName: true
  }
});
// Payload: 500 bytes (10x smaller)
```

**Impact on 1000 users:**
- Without `select`: 5KB × 1000 = 5MB
- With `select`: 500B × 1000 = 500KB
- **Savings:** 90% less bandwidth, faster JSON parsing

**Best Practice:**
```typescript
// Define reusable select objects
const USER_MINIMAL = {
  id: true,
  email: true,
  firstName: true,
  lastName: true
};

const user = await prisma.user.findUnique({
  where: { id: 1 },
  select: USER_MINIMAL
});
```

### 4. **Q:** Explain how Prisma middleware works and give a use case.

**A:**
**Middleware** intercepts all Prisma queries, allowing you to:
- Log queries
- Measure performance
- Implement soft deletes
- Add row-level security

**How It Works:**
```typescript
prisma.$use(async (params, next) => {
  // params: { model, action, args }
  // next: function to execute actual query
  
  // BEFORE query execution
  console.log(`Executing: ${params.model}.${params.action}`);
  
  // Execute query
  const result = await next(params);
  
  // AFTER query execution
  console.log(`Result count: ${Array.isArray(result) ? result.length : 1}`);
  
  return result;
});
```

**Use Case: Soft Deletes**
```typescript
prisma.$use(async (params, next) => {
  // Intercept delete operations
  if (params.action === 'delete') {
    // Change to update
    params.action = 'update';
    params.args.data = { deletedAt: new Date() };
  }
  
  // Intercept deleteMany
  if (params.action === 'deleteMany') {
    params.action = 'updateMany';
    params.args.data = { deletedAt: new Date() };
  }
  
  // Auto-filter deleted records on findMany
  if (params.action === 'findMany') {
    params.args.where = {
      ...params.args.where,
      deletedAt: null
    };
  }
  
  return next(params);
});

// Now:
await prisma.user.delete({ where: { id: 1 } });  
// → Sets deletedAt instead of actually deleting

await prisma.user.findMany();  
// → Only returns non-deleted users
```

### 5. **Q:** How would you monitor Prisma query performance in production?

**A:**
**Multi-Layer Monitoring Strategy:**

**1. Application Level: Middleware**
```typescript
prisma.$use(async (params, next) => {
  const start = Date.now();
  const result = await next(params);
  const duration = Date.now() - start;
  
  // Send to metrics service
  metrics.histogram('prisma.query.duration', duration, {
    model: params.model,
    action: params.action
  });
  
  return result;
});
```

**2. Metrics Endpoint:**
```typescript
app.get('/metrics', async (req, res) => {
  const metrics = {
    poolStatus: {
      active: await prisma.$metrics.poolConnections.active,
      idle: await prisma.$metrics.poolConnections.idle
    },
    queryStats: {
      total: queryCount,
      avgDuration: totalDuration / queryCount,
      slowQueries: slowQueryLog.slice(-10)
    }
  };
  
  res.json(metrics);
});
```

**3. Database Level: pg_stat_statements**
```sql
SELECT 
  query,
  calls,
  mean_exec_time,
  max_exec_time
FROM pg_stat_statements
WHERE query LIKE '%users%'
ORDER BY mean_exec_time DESC
LIMIT 10;
```

**4. APM Integration:**
```typescript
// Sentry, Datadog, New Relic
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,  // 10% of requests
  integrations: [
    new Sentry.Integrations.Prisma({ client: prisma })
  ]
});
```

**Key Metrics to Track:**
- P50, P95, P99 query latency
- Query count per minute
- Slow query count (> 100ms)
- Error rate
- Connection pool utilization

---

## ✅ MODULE COMPLETION CHECKLIST

- ✅ Theory: Query performance targets and optimization principles
- ✅ Query logging (development vs production)
- ✅ Using `select` to reduce payload
- ✅ Index verification with EXPLAIN ANALYZE
- ✅ Pagination strategies (offset vs cursor)
- ✅ Query batching to avoid N+1
- ✅ Prisma middleware for monitoring
- ✅ Caching strategies with Redis
- ✅ Optimizing complex queries with raw SQL
- ✅ Interview questions with comprehensive answers

---

**Next:** [M21-PART3: Error Handling & Resilience](M21-PRISMA-DEEP-DIVE-PART3.md)  
**Previous:** [M21-PART1: Connection Pooling & Performance](M21-PRISMA-DEEP-DIVE-PART1.md)

---

**Last Updated:** 2026-08-12  
**Module Length:** ~650 lines  
**Status:** ✅ Ready for Learning
