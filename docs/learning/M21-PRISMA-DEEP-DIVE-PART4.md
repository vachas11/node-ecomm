# M21: Prisma Deep Dive - PART 4 (Advanced Production Patterns)

**Prerequisites:** M21-PART1, M21-PART2, M21-PART3  
**Level:** Production/Expert  
**Time to Master:** 5-6 hours  
**Focus:** Advanced patterns, caching, soft deletes, audit logging, and production best practices

---

## 📖 SECTION 1: THEORY

### Production Patterns Overview

```
┌────────────────────────────────────────────────────────────┐
│         PRODUCTION PATTERNS FOR PRISMA                      │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  1. SOFT DELETES                                           │
│     Mark records as deleted instead of removing them       │
│     → Recoverable, audit trail, referential integrity     │
│                                                            │
│  2. AUDIT LOGGING                                          │
│     Track who changed what and when                        │
│     → Compliance, debugging, security                     │
│                                                            │
│  3. OPTIMISTIC LOCKING                                     │
│     Prevent concurrent update conflicts                    │
│     → Version number, check before update                 │
│                                                            │
│  4. READ REPLICAS                                          │
│     Route reads to replica, writes to primary             │
│     → Scale read-heavy workloads                          │
│                                                            │
│  5. CACHING STRATEGIES                                     │
│     Cache frequently accessed data (Redis, in-memory)     │
│     → Reduce database load, faster responses              │
│                                                            │
│  6. ROW-LEVEL SECURITY                                     │
│     Users only see their own data                         │
│     → Multi-tenant, privacy, security                     │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

## 🔍 SECTION 2: LINE-BY-LINE CODE ANALYSIS

### Pattern 1: Soft Deletes via Middleware

**Schema:**
```prisma
model User {
  id        Int       @id @default(autoincrement())
  email     String    @unique
  deletedAt DateTime? @map("deleted_at")  // NULL = active, NOT NULL = deleted
  
  @@map("users")
}
```

**Middleware Implementation:**
```typescript
// src/middleware/soft-delete.ts

import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';

export function setupSoftDelete() {
  prisma.$use(async (params, next) => {
    
    // 1. Intercept DELETE operations → Convert to UPDATE
    if (params.action === 'delete') {
      params.action = 'update';
      params.args.data = { deletedAt: new Date() };
    }
    
    if (params.action === 'deleteMany') {
      params.action = 'updateMany';
      params.args.data = { deletedAt: new Date() };
    }
    
    // 2. Auto-filter deleted records on READ operations
    if (params.action === 'findUnique' || params.action === 'findFirst') {
      params.args.where = {
        ...params.args.where,
        deletedAt: null  // Only non-deleted
      };
    }
    
    if (params.action === 'findMany') {
      // Keep existing where clause, add deletedAt filter
      if (params.args.where) {
        if (params.args.where.deletedAt === undefined) {
          params.args.where.deletedAt = null;
        }
      } else {
        params.args.where = { deletedAt: null };
      }
    }
    
    // 3. Handle COUNT operations
    if (params.action === 'count') {
      params.args.where = {
        ...params.args.where,
        deletedAt: null
      };
    }
    
    return next(params);
  });
}

// Initialize in app
setupSoftDelete();

// Usage: Normal Prisma calls now use soft deletes
await prisma.user.delete({ where: { id: 1 } });
// SQL: UPDATE users SET deleted_at = NOW() WHERE id = 1

await prisma.user.findMany();
// SQL: SELECT * FROM users WHERE deleted_at IS NULL

// To find deleted records (opt-in):
await prisma.user.findMany({
  where: { deletedAt: { not: null } }
});
```

**Benefits:**
- ✅ **Recoverable**: Can restore deleted records
- ✅ **Referential integrity**: Foreign keys still valid
- ✅ **Audit trail**: Know when record was deleted
- ✅ **Transparent**: App code doesn't change

---

### Pattern 2: Audit Logging

**Schema:**
```prisma
model User {
  id        Int       @id @default(autoincrement())
  email     String
  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")
  
  auditLogs AuditLog[]
  
  @@map("users")
}

model AuditLog {
  id          Int      @id @default(autoincrement())
  userId      Int?     @map("user_id")
  user        User?    @relation(fields: [userId], references: [id])
  action      String   // CREATE, UPDATE, DELETE
  entityType  String   @map("entity_type")  // User, Order, Product
  entityId    Int      @map("entity_id")
  changes     Json?    // JSON of before/after values
  ipAddress   String?  @map("ip_address")
  userAgent   String?  @map("user_agent")
  createdAt   DateTime @default(now()) @map("created_at")
  
  @@map("audit_logs")
  @@index([entityType, entityId])
  @@index([userId])
  @@index([createdAt])
}
```

**Audit Middleware:**
```typescript
// src/middleware/audit-log.ts

import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { AsyncLocalStorage } from 'async_hooks';

// Store request context (userId, IP, etc.)
const requestContext = new AsyncLocalStorage<{
  userId?: number;
  ipAddress?: string;
  userAgent?: string;
}>();

export function setRequestContext(context: any) {
  requestContext.enterWith(context);
}

export function setupAuditLog() {
  prisma.$use(async (params, next) => {
    const ctx = requestContext.getStore();
    
    // Only audit specific models
    const auditableModels = ['User', 'Order', 'Product'];
    if (!auditableModels.includes(params.model || '')) {
      return next(params);
    }
    
    let action: string | null = null;
    let beforeData: any = null;
    
    // Determine action
    if (params.action === 'create') {
      action = 'CREATE';
    } else if (params.action === 'update' || params.action === 'updateMany') {
      action = 'UPDATE';
      
      // Fetch before state
      if (params.action === 'update') {
        beforeData = await prisma[params.model!.toLowerCase()].findUnique({
          where: params.args.where
        });
      }
    } else if (params.action === 'delete' || params.action === 'deleteMany') {
      action = 'DELETE';
      
      // Fetch before state
      if (params.action === 'delete') {
        beforeData = await prisma[params.model!.toLowerCase()].findUnique({
          where: params.args.where
        });
      }
    }
    
    // Execute actual operation
    const result = await next(params);
    
    // Log audit entry
    if (action && result) {
      const entityId = 
        params.action === 'create' ? result.id :
        params.args.where?.id || null;
      
      if (entityId) {
        await prisma.auditLog.create({
          data: {
            userId: ctx?.userId,
            action,
            entityType: params.model!,
            entityId,
            changes: {
              before: beforeData,
              after: params.action === 'delete' ? null : result
            },
            ipAddress: ctx?.ipAddress,
            userAgent: ctx?.userAgent
          }
        });
      }
    }
    
    return result;
  });
}

// Express middleware to set context
export function auditContextMiddleware(req: Request, res: Response, next: NextFunction) {
  setRequestContext({
    userId: req.user?.id,
    ipAddress: req.ip,
    userAgent: req.get('user-agent')
  });
  next();
}
```

**Usage:**
```typescript
// In Express app
app.use(auditContextMiddleware);

// Now all Prisma operations are logged
await prisma.user.update({
  where: { id: 1 },
  data: { email: 'newemail@example.com' }
});
// → Creates audit log:
// {
//   action: 'UPDATE',
//   entityType: 'User',
//   entityId: 1,
//   changes: {
//     before: { id: 1, email: 'old@example.com' },
//     after: { id: 1, email: 'newemail@example.com' }
//   },
//   userId: 123,
//   ipAddress: '192.168.1.1'
// }
```

---

### Pattern 3: Optimistic Locking

**Schema:**
```prisma
model Product {
  id       Int    @id @default(autoincrement())
  name     String
  stock    Int
  version  Int    @default(0)  // Optimistic lock version
  
  @@map("products")
}
```

**Implementation:**
```typescript
// src/repositories/product.repository.ts

export class ProductRepository {
  async updateWithOptimisticLock(
    id: number,
    version: number,  // Current version client has
    data: Prisma.ProductUpdateInput
  ) {
    try {
      // Update only if version matches
      const updated = await prisma.product.update({
        where: {
          id,
          version  // ← Check version matches
        },
        data: {
          ...data,
          version: { increment: 1 }  // Increment version
        }
      });
      
      return updated;
      
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          // Record not found OR version mismatch
          throw new Error(
            'Conflict: Record was modified by another user. Please refresh and try again.'
          );
        }
      }
      throw error;
    }
  }
}

// Usage:
const product = await prisma.product.findUnique({ where: { id: 1 } });
// { id: 1, name: "Laptop", stock: 10, version: 5 }

// User 1 updates
await productRepo.updateWithOptimisticLock(1, 5, { stock: 9 });
// Success: version 5 → 6

// User 2 tries to update with old version
await productRepo.updateWithOptimisticLock(1, 5, { stock: 8 });
// ❌ Error: "Conflict: Record was modified by another user"
```

**How It Works:**
```
User A reads:    version=5
User B reads:    version=5

User A updates:  WHERE id=1 AND version=5 SET stock=9, version=6 ✅
User B updates:  WHERE id=1 AND version=5 SET stock=8, version=6 ❌ (no match)
```

---

### Pattern 4: Read Replicas

**Configuration:**
```typescript
// src/config/database.ts

import { PrismaClient } from '@prisma/client';

// Primary (read-write)
export const prismaPrimary = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_PRIMARY_URL  // primary.db.example.com
    }
  }
});

// Replica (read-only)
export const prismaReplica = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_REPLICA_URL  // replica.db.example.com
    }
  }
});

// Smart router: reads → replica, writes → primary
export class DatabaseRouter {
  static async read<T>(operation: (prisma: PrismaClient) => Promise<T>): Promise<T> {
    return operation(prismaReplica);
  }
  
  static async write<T>(operation: (prisma: PrismaClient) => Promise<T>): Promise<T> {
    return operation(prismaPrimary);
  }
}
```

**Usage:**
```typescript
// Reads go to replica
const users = await DatabaseRouter.read((prisma) =>
  prisma.user.findMany()
);

// Writes go to primary
const newUser = await DatabaseRouter.write((prisma) =>
  prisma.user.create({ data: { email: 'test@example.com' } })
);

// Read-after-write consistency issue:
const user = await DatabaseRouter.write((prisma) =>
  prisma.user.create({ data: { email: 'test@example.com' } })
);

// ⚠️ Replica might not have this yet (replication lag)
const fetchedUser = await DatabaseRouter.read((prisma) =>
  prisma.user.findUnique({ where: { id: user.id } })
);
// fetchedUser might be null!

// Solution: Read from primary immediately after write
const fetchedUser = await DatabaseRouter.write((prisma) =>
  prisma.user.findUnique({ where: { id: user.id } })
);
```

---

### Pattern 5: Caching with Redis

```typescript
// src/utils/cache.ts

import Redis from 'ioredis';
import { prisma } from '../config/database';

const redis = new Redis(process.env.REDIS_URL);

export class CachedRepository {
  private cachePrefix: string;
  private defaultTTL: number;
  
  constructor(cachePrefix: string, defaultTTL: number = 300) {
    this.cachePrefix = cachePrefix;
    this.defaultTTL = defaultTTL;
  }
  
  private getCacheKey(id: number | string): string {
    return `${this.cachePrefix}:${id}`;
  }
  
  async findById(id: number, fetcher: () => Promise<any>, ttl?: number) {
    const cacheKey = this.getCacheKey(id);
    
    // Try cache first
    const cached = await redis.get(cacheKey);
    if (cached) {
      console.log(`Cache HIT: ${cacheKey}`);
      return JSON.parse(cached);
    }
    
    console.log(`Cache MISS: ${cacheKey}`);
    
    // Fetch from database
    const data = await fetcher();
    
    if (data) {
      // Store in cache
      await redis.setex(
        cacheKey,
        ttl || this.defaultTTL,
        JSON.stringify(data)
      );
    }
    
    return data;
  }
  
  async invalidate(id: number | string) {
    const cacheKey = this.getCacheKey(id);
    await redis.del(cacheKey);
    console.log(`Cache INVALIDATED: ${cacheKey}`);
  }
  
  async invalidatePattern(pattern: string) {
    const keys = await redis.keys(`${this.cachePrefix}:${pattern}`);
    if (keys.length > 0) {
      await redis.del(...keys);
      console.log(`Cache INVALIDATED: ${keys.length} keys`);
    }
  }
}

// Usage in repository
export class UserRepository {
  private cache = new CachedRepository('user', 300);
  
  async findById(id: number) {
    return await this.cache.findById(
      id,
      () => prisma.user.findUnique({ where: { id } })
    );
  }
  
  async update(id: number, data: any) {
    const updated = await prisma.user.update({
      where: { id },
      data
    });
    
    // Invalidate cache after update
    await this.cache.invalidate(id);
    
    return updated;
  }
}
```

**Cache Strategies:**

```
┌──────────────────────────────────────────────────────────┐
│              CACHE INVALIDATION STRATEGIES                │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  1. TIME-BASED (TTL)                                     │
│     Cache expires after N seconds                        │
│     ✅ Simple, works for rarely-changing data           │
│     ❌ Stale data until expiry                          │
│                                                          │
│  2. WRITE-THROUGH                                        │
│     Update cache on every write                          │
│     ✅ Always fresh data                                │
│     ❌ Cache writes add latency                         │
│                                                          │
│  3. CACHE-ASIDE (Lazy Loading)                           │
│     Populate cache on read miss                          │
│     ✅ Only cache what's needed                         │
│     ❌ First request is slow (cache miss)               │
│                                                          │
│  4. EXPLICIT INVALIDATION                                │
│     Delete cache entry on write                          │
│     ✅ Cache always accurate                            │
│     ❌ Must track all write paths                       │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

## 🏗️ SECTION 3: ARCHITECTURE & FLOW DIAGRAMS

### Read Replica Architecture

```
┌──────────────────────────────────────────────────────────┐
│           READ REPLICA ARCHITECTURE                       │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Application                                             │
│  ┌────────────────────────────────────────┐             │
│  │ DatabaseRouter                         │             │
│  │ ├─ read() → prismaReplica             │             │
│  │ └─ write() → prismaPrimary            │             │
│  └───────┬─────────────────┬──────────────┘             │
│          │                 │                             │
│          │ Reads (90%)     │ Writes (10%)               │
│          ↓                 ↓                             │
│  ┌────────────┐    ┌────────────┐                      │
│  │  Replica   │    │  Primary   │                      │
│  │ (Read-Only)│◀───│(Read-Write)│                      │
│  └────────────┘    └────────────┘                      │
│         ▲                │                               │
│         └────────────────┘                               │
│         Replication (async)                              │
│                                                          │
│  Benefits:                                               │
│  ✅ Scale reads horizontally (add more replicas)        │
│  ✅ Reduce load on primary (90% offloaded)              │
│  ✅ Geographic distribution (replicas closer to users)  │
│                                                          │
│  Challenges:                                             │
│  ⚠️  Replication lag (replica 1-2s behind primary)      │
│  ⚠️  Read-after-write consistency (user sees old data)  │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

## 🎯 SECTION 4: PRACTICAL EXAMPLES & INTERVIEW PREP

### Example 1: Multi-Tenant Row-Level Security

```typescript
// src/middleware/tenant-filter.ts

import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { AsyncLocalStorage } from 'async_hooks';

const tenantContext = new AsyncLocalStorage<{ tenantId: number }>();

export function setTenantContext(tenantId: number) {
  tenantContext.enterWith({ tenantId });
}

export function setupRowLevelSecurity() {
  prisma.$use(async (params, next) => {
    const ctx = tenantContext.getStore();
    
    // Only apply to tenant-scoped models
    const tenantModels = ['User', 'Order', 'Product'];
    if (!tenantModels.includes(params.model || '')) {
      return next(params);
    }
    
    // Auto-add tenantId filter on reads
    if (params.action === 'findUnique' || params.action === 'findFirst' || params.action === 'findMany') {
      params.args.where = {
        ...params.args.where,
        tenantId: ctx?.tenantId
      };
    }
    
    // Auto-add tenantId on writes
    if (params.action === 'create') {
      params.args.data.tenantId = ctx?.tenantId;
    }
    
    if (params.action === 'update' || params.action === 'updateMany') {
      params.args.where = {
        ...params.args.where,
        tenantId: ctx?.tenantId
      };
    }
    
    return next(params);
  });
}

// Express middleware
app.use((req, res, next) => {
  const tenantId = req.user?.tenantId;  // From JWT or session
  if (tenantId) {
    setTenantContext(tenantId);
  }
  next();
});

// Now queries are automatically scoped
await prisma.user.findMany();
// SQL: SELECT * FROM users WHERE tenant_id = 1
// Users can only see their tenant's data!
```

---

### Example 2: Background Job Processing

```typescript
// src/jobs/cleanup.ts

import { prisma } from '../config/database';

export async function cleanupExpiredTokens() {
  console.log('Starting token cleanup job...');
  
  try {
    const result = await prisma.refreshToken.deleteMany({
      where: {
        expiresAt: {
          lte: new Date()  // Expired tokens
        }
      }
    });
    
    console.log(`✅ Cleaned up ${result.count} expired tokens`);
    
  } catch (error) {
    console.error('❌ Token cleanup failed:', error);
  }
}

export async function archiveOldOrders() {
  console.log('Starting order archival job...');
  
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  
  try {
    // Move old orders to archive table
    await prisma.$executeRaw`
      INSERT INTO order_archive 
      SELECT * FROM orders 
      WHERE status = 'completed' 
        AND created_at < ${sixMonthsAgo};
    `;
    
    const result = await prisma.order.deleteMany({
      where: {
        status: 'completed',
        createdAt: {
          lt: sixMonthsAgo
        }
      }
    });
    
    console.log(`✅ Archived ${result.count} old orders`);
    
  } catch (error) {
    console.error('❌ Order archival failed:', error);
  }
}

// Schedule with cron
import cron from 'node-cron';

// Run cleanup every night at 2 AM
cron.schedule('0 2 * * *', cleanupExpiredTokens);

// Run archival every Sunday at 3 AM
cron.schedule('0 3 * * 0', archiveOldOrders);
```

---

## 🎙️ INTERVIEW QUESTIONS

### 1. **Q:** Explain the trade-offs between soft deletes and hard deletes.

**A:**

| Aspect | Soft Delete | Hard Delete |
|--------|-------------|-------------|
| **Data Recovery** | ✅ Recoverable | ❌ Permanent |
| **Storage** | ❌ Grows over time | ✅ Freed immediately |
| **Referential Integrity** | ✅ Foreign keys valid | ❌ Cascade deletes |
| **Query Performance** | ⚠️ Slower (filter deleted) | ✅ Faster |
| **Compliance** | ✅ Audit trail | ❌ No history |
| **Complexity** | ⚠️ Filter in queries | ✅ Simple |

**Use Soft Deletes When:**
- ✅ Audit trail required (compliance, GDPR)
- ✅ User might want to restore (email, notes)
- ✅ Related records must stay valid (orders → users)

**Use Hard Deletes When:**
- ✅ Sensitive data (passwords, credit cards)
- ✅ Privacy laws require deletion (GDPR "right to be forgotten")
- ✅ Storage cost is concern

**Hybrid Approach:**
```typescript
// Soft delete
await prisma.user.update({
  where: { id },
  data: { deletedAt: new Date() }
});

// Hard delete after 90 days (compliance requirement)
await prisma.user.deleteMany({
  where: {
    deletedAt: {
      lte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    }
  }
});
```

### 2. **Q:** How does optimistic locking differ from pessimistic locking?

**A:**

**Optimistic Locking:**
- **Assumption**: Conflicts are rare
- **Mechanism**: Version number check before update
- **Flow**:
  1. Read record (version=5)
  2. User modifies data
  3. Update WHERE version=5 SET data=..., version=6
  4. If version mismatch → Conflict error
- **Pros**: No database locks, better performance
- **Cons**: Conflict handling in application code

**Pessimistic Locking:**
- **Assumption**: Conflicts are common
- **Mechanism**: Acquire exclusive lock on read
- **Flow**:
  1. Read record WITH LOCK (`SELECT FOR UPDATE`)
  2. Database blocks other reads/writes
  3. User modifies data
  4. Update (guaranteed no conflicts)
  5. Release lock on commit
- **Pros**: Guaranteed no conflicts
- **Cons**: Locks can cause contention, deadlocks

**In Prisma:**
```typescript
// Optimistic (version check)
await prisma.product.update({
  where: { id: 1, version: 5 },
  data: { stock: 9, version: { increment: 1 } }
});

// Pessimistic (use transaction + raw SQL)
await prisma.$transaction(async (tx) => {
  const product = await tx.$queryRaw`
    SELECT * FROM products WHERE id = 1 FOR UPDATE
  `;
  
  // Now locked, other transactions wait
  await tx.product.update({
    where: { id: 1 },
    data: { stock: product.stock - 1 }
  });
});
```

**When to Use:**
- **Optimistic**: High read, low write (product catalog)
- **Pessimistic**: High contention (inventory, banking)

### 3. **Q:** What is replication lag and how do you handle it?

**A:**
**Replication Lag**: Time delay between primary writing data and replica having it.

**Typical Lag:** 100ms - 2 seconds

**Problem:**
```typescript
// Write to primary
const user = await prismaPrimary.user.create({
  data: { email: 'new@example.com' }
});

// Read from replica immediately
const fetched = await prismaReplica.user.findUnique({
  where: { id: user.id }
});
// fetched === null (replica doesn't have it yet!)
```

**Solutions:**

**1. Read-After-Write from Primary:**
```typescript
const user = await prismaPrimary.user.create({ data });
// Read from primary for 5 seconds
const fetched = await prismaPrimary.user.findUnique({ where: { id: user.id } });
```

**2. Sticky Sessions:**
```typescript
// After write, set cookie: recentWrite=true
res.cookie('recentWrite', 'true', { maxAge: 5000 });

// On next request, check cookie
if (req.cookies.recentWrite) {
  // Route reads to primary for 5 seconds
  return prismaPrimary.user.findUnique(...);
} else {
  // Normal reads to replica
  return prismaReplica.user.findUnique(...);
}
```

**3. Accept Eventually Consistent:**
```typescript
// For non-critical reads, accept stale data
const posts = await prismaReplica.post.findMany();
// It's OK if this is 1 second old
```

**4. Check Replication Position:**
```sql
-- PostgreSQL: Check if replica caught up
SELECT pg_last_wal_replay_lsn() >= 'target_lsn';
```

### 4. **Q:** Explain cache invalidation strategies for Prisma.

**A:**
**Strategies:**

**1. Time-To-Live (TTL):**
```typescript
await redis.setex('user:1', 300, JSON.stringify(user));  // 5 min
```
- ✅ Simple
- ❌ Stale data until expiry
- **Use**: Rarely-changing data (product specs)

**2. Explicit Invalidation:**
```typescript
async update(id, data) {
  const user = await prisma.user.update({ where: { id }, data });
  await redis.del(`user:${id}`);  // Invalidate on write
  return user;
}
```
- ✅ Always accurate
- ❌ Must track all write paths
- **Use**: Critical data (user profiles)

**3. Cache Warming:**
```typescript
// Pre-populate cache on deploy
async warmCache() {
  const popular = await prisma.product.findMany({
    where: { isPopular: true }
  });
  
  for (const product of popular) {
    await redis.setex(`product:${product.id}`, 3600, JSON.stringify(product));
  }
}
```
- ✅ No cache misses
- ❌ Requires knowing what to cache
- **Use**: Predictable access patterns

**4. Write-Through:**
```typescript
async update(id, data) {
  const user = await prisma.user.update({ where: { id }, data });
  await redis.setex(`user:${id}`, 300, JSON.stringify(user));  // Update cache
  return user;
}
```
- ✅ Always fresh
- ❌ Slower writes
- **Use**: Read-heavy workloads

**Best Practice: Layered Caching:**
```
L1: In-memory (Node.js) - 10s TTL, 1000 items max
L2: Redis - 5min TTL
L3: Database - Source of truth
```

### 5. **Q:** How would you implement audit logging for compliance?

**A:**
**Requirements:** Track WHO changed WHAT, WHEN, and HOW.

**Implementation:**

**1. Schema:**
```prisma
model AuditLog {
  id          Int      @id @default(autoincrement())
  userId      Int?     // Who
  action      String   // CREATE, UPDATE, DELETE
  entityType  String   // User, Order, Product
  entityId    Int      // Which record
  changes     Json     // Before/after values
  ipAddress   String?
  userAgent   String?
  createdAt   DateTime @default(now())  // When
}
```

**2. Middleware (Automatic):**
```typescript
prisma.$use(async (params, next) => {
  // Capture before state for UPDATE/DELETE
  let beforeData = null;
  if (params.action === 'update' || params.action === 'delete') {
    beforeData = await prisma[params.model].findUnique({
      where: params.args.where
    });
  }
  
  // Execute operation
  const result = await next(params);
  
  // Log audit entry
  await prisma.auditLog.create({
    data: {
      userId: getCurrentUserId(),
      action: params.action.toUpperCase(),
      entityType: params.model,
      entityId: result?.id || params.args.where.id,
      changes: { before: beforeData, after: result },
      ipAddress: getCurrentIpAddress(),
      userAgent: getCurrentUserAgent()
    }
  });
  
  return result;
});
```

**3. Query Audit Logs:**
```typescript
// Who updated user 123?
await prisma.auditLog.findMany({
  where: { entityType: 'User', entityId: 123, action: 'UPDATE' },
  orderBy: { createdAt: 'desc' }
});

// All changes by user 456 in last 7 days
await prisma.auditLog.findMany({
  where: {
    userId: 456,
    createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
  }
});
```

**Compliance Features:**
- ✅ Immutable logs (never update, only insert)
- ✅ Tamper-proof (hash changes field)
- ✅ Long retention (archive after 7 years)
- ✅ Exportable (CSV/JSON for auditors)

---

## ✅ MODULE COMPLETION CHECKLIST

- ✅ Theory: Production patterns overview
- ✅ Soft deletes via middleware
- ✅ Audit logging with AsyncLocalStorage
- ✅ Optimistic locking with version numbers
- ✅ Read replicas for scaling reads
- ✅ Caching strategies with Redis
- ✅ Row-level security for multi-tenancy
- ✅ Background job processing
- ✅ Interview questions with comprehensive answers

---

## 🎓 M21 SERIES & ENTIRE PRISMA SERIES COMPLETE!

You've now mastered:
- ✅ **M21-PART1:** Connection Pooling & Performance
- ✅ **M21-PART2:** Query Optimization & Monitoring
- ✅ **M21-PART3:** Error Handling & Resilience
- ✅ **M21-PART4:** Advanced Production Patterns

**Total M21 Learning Time:** 17-21 hours  
**Total M21 Content:** ~2,550 lines

---

## 🏆 COMPLETE PRISMA MASTERY ACHIEVED!

**Full Series Summary:**
- ✅ **M18 (4 parts):** Foundations - Schema, Client, CRUD, Repository Pattern (~2,000 lines)
- ✅ **M19 (4 parts):** Advanced Queries - Filtering, Relations, Aggregations, Transactions (~2,430 lines)
- ✅ **M20 (4 parts):** Migrations - Fundamentals, Workflow, Production, Schema Management (~2,360 lines)
- ✅ **M21 (4 parts):** Production - Pooling, Optimization, Errors, Advanced Patterns (~2,550 lines)

**Grand Total:** ~9,340 lines of comprehensive Prisma documentation  
**Total Learning Time:** 60-80 hours to master all modules  
**Coverage:** Foundation → Advanced → Migrations → Production

**You can now:**
- Write type-safe database queries with confidence
- Design and evolve database schemas safely
- Deploy migrations to production with zero downtime
- Optimize queries for performance
- Handle errors gracefully
- Build resilient, production-ready applications
- Pass principal/staff-level Prisma interview questions

---

**Previous:** [M21-PART3: Error Handling & Resilience](M21-PRISMA-DEEP-DIVE-PART3.md)

---

**Last Updated:** 2026-08-12  
**Module Length:** ~640 lines  
**Status:** ✅ Ready for Learning
