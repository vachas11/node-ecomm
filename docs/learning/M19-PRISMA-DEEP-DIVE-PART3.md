# M19: Prisma Deep Dive - PART 3 (Aggregations & Batch Operations)

**Prerequisites:** M18 (All Parts), M19-PART1, M19-PART2  
**Level:** Intermediate  
**Time to Master:** 3-4 hours  
**Focus:** Counting, aggregating, and batch processing data efficiently

---

## 📖 SECTION 1: THEORY

### What Are Aggregations?

Aggregations perform calculations across multiple records: counting rows, summing values, finding averages, min/max, etc. Instead of fetching all records and calculating in application code, Prisma pushes the computation to the database (faster and more memory-efficient).

**Real-World Analogy:**
- **Without Aggregation**: Like manually counting every item in a warehouse by fetching each box and tallying in Excel (slow, uses memory)
- **With Aggregation**: Like asking the warehouse manager "How many total items?" and getting an instant answer (fast, database does the work)

### Types of Aggregations in Prisma

```
┌───────────────────────────────────────────────────────────┐
│              PRISMA AGGREGATION OPERATIONS                │
├───────────────────────────────────────────────────────────┤
│                                                           │
│  count()       Count number of records                    │
│  aggregate()   Multiple calculations: _sum, _avg, ...     │
│  groupBy()     Group records and aggregate per group      │
│                                                           │
│  Example: Orders table with 1000 rows                     │
│  ┌──────┬─────────┬────────┬─────────┐                  │
│  │ id   │ user_id │ status │ amount  │                  │
│  ├──────┼─────────┼────────┼─────────┤                  │
│  │ 101  │ 1       │ done   │ 99.99   │                  │
│  │ 102  │ 1       │ pend   │ 49.99   │                  │
│  │ 103  │ 2       │ done   │ 199.00  │                  │
│  │ ...  │ ...     │ ...    │ ...     │                  │
│  └──────┴─────────┴────────┴─────────┘                  │
│                                                           │
│  count({ where: { status: "done" } })                    │
│    → 450 completed orders                                │
│                                                           │
│  aggregate({ _sum: { amount: true } })                   │
│    → Total revenue: $123,456.78                          │
│                                                           │
│  groupBy({ by: ['user_id'], _count: true })              │
│    → User 1: 25 orders, User 2: 30 orders, ...          │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

### Batch Operations: Why They Matter

**Problem:** Creating 1000 users with a loop:
```typescript
for (const user of users) {
  await prisma.user.create({ data: user });  // 1000 database round-trips
}
// Time: ~10 seconds (10ms per query)
```

**Solution:** Batch create with `createMany()`:
```typescript
await prisma.user.createMany({ data: users });  // 1 database round-trip
// Time: ~200ms (50x faster!)
```

**Performance Impact:**
- **Loop of create()**: N round-trips, transaction overhead per operation
- **createMany()**: 1 round-trip, single transaction, database-optimized batch insert
- **Rule of Thumb**: Use batch operations when inserting/updating/deleting 10+ records

---

## 🔍 SECTION 2: LINE-BY-LINE CODE ANALYSIS

### count(): Counting Records

From our existing TokenRepository ([services/api-gateway/src/repositories/token.repository.ts:110-116](../../services/api-gateway/src/repositories/token.repository.ts#L110-L116)):

```typescript
async countActiveByUserId(userId: string): Promise<number> {
  return await this.prisma.refreshToken.count({
    where: {
      userId,                     // Filter by user
      expiresAt: {
        gt: new Date()            // Only count non-expired tokens
      }
    }
  });
}
```

**Generated SQL:**
```sql
SELECT COUNT(*) 
FROM refresh_tokens 
WHERE user_id = $1 
  AND expires_at > NOW();
```

**Why count() instead of findMany().length?**
- `count()`: Database returns just the number (4 bytes)
- `findMany().length`: Database returns ALL rows, application counts (could be megabytes)
- Performance: `count()` is 100-1000x faster for large tables

#### count() with Multiple Conditions

```typescript
// Count users by role and status
async getUserStatistics() {
  const [activeCustomers, inactiveCustomers, activeAdmins] = await Promise.all([
    this.prisma.user.count({ 
      where: { role: 'customer', isActive: true } 
    }),
    this.prisma.user.count({ 
      where: { role: 'customer', isActive: false } 
    }),
    this.prisma.user.count({ 
      where: { role: 'admin', isActive: true } 
    })
  ]);

  return { activeCustomers, inactiveCustomers, activeAdmins };
}
```

---

### aggregate(): Multiple Calculations at Once

```typescript
// Calculate order statistics
async getOrderStatistics() {
  const stats = await this.prisma.order.aggregate({
    _count: {
      _all: true,           // Count all orders
      id: true              // Count non-null IDs (same as _all here)
    },
    _sum: {
      totalAmount: true     // Sum of all order amounts
    },
    _avg: {
      totalAmount: true     // Average order value
    },
    _min: {
      totalAmount: true,    // Smallest order amount
      createdAt: true       // Oldest order date
    },
    _max: {
      totalAmount: true,    // Largest order amount
      createdAt: true       // Most recent order date
    },
    where: {
      status: 'completed'   // Only completed orders
    }
  });

  return {
    totalOrders: stats._count._all,           // 1,250
    totalRevenue: stats._sum.totalAmount,     // 125,000.50
    averageOrder: stats._avg.totalAmount,     // 100.00
    smallestOrder: stats._min.totalAmount,    // 9.99
    largestOrder: stats._max.totalAmount,     // 1,999.99
    firstOrderDate: stats._min.createdAt,     // 2024-01-01
    lastOrderDate: stats._max.createdAt       // 2026-08-12
  };
}
```

**Generated SQL:**
```sql
SELECT 
  COUNT(*) as count_all,
  SUM(total_amount) as sum_amount,
  AVG(total_amount) as avg_amount,
  MIN(total_amount) as min_amount,
  MAX(total_amount) as max_amount,
  MIN(created_at) as min_date,
  MAX(created_at) as max_date
FROM orders
WHERE status = 'completed';
```

**Performance Note:**
All calculations run in a **single query** instead of 7 separate queries. The database computes everything in one scan.

---

### groupBy(): Aggregating by Groups

```typescript
// Revenue by user (find top spenders)
async getRevenueByUser() {
  const result = await this.prisma.order.groupBy({
    by: ['userId'],                // Group by user_id column
    _sum: {
      totalAmount: true            // Sum amount per user
    },
    _count: {
      id: true                     // Count orders per user
    },
    where: {
      status: 'completed'          // Only completed orders
    },
    orderBy: {
      _sum: {
        totalAmount: 'desc'        // Sort by revenue (highest first)
      }
    },
    take: 10                       // Top 10 users
  });

  // Result:
  // [
  //   { userId: 5, _sum: { totalAmount: 5000.00 }, _count: { id: 50 } },
  //   { userId: 12, _sum: { totalAmount: 4500.00 }, _count: { id: 45 } },
  //   ...
  // ]

  return result;
}
```

**Generated SQL:**
```sql
SELECT 
  user_id,
  SUM(total_amount) as sum_amount,
  COUNT(id) as count_id
FROM orders
WHERE status = 'completed'
GROUP BY user_id
ORDER BY sum_amount DESC
LIMIT 10;
```

#### groupBy() with Multiple Fields

```typescript
// Sales by month and status
async getSalesByMonthAndStatus() {
  const result = await this.prisma.$queryRaw`
    SELECT 
      DATE_TRUNC('month', created_at) as month,
      status,
      COUNT(*) as order_count,
      SUM(total_amount) as revenue
    FROM orders
    GROUP BY month, status
    ORDER BY month DESC, status;
  `;

  // Note: Prisma's groupBy() doesn't support date functions like DATE_TRUNC
  // For complex grouping, use $queryRaw (covered in M19-PART4)

  return result;
}
```

**Limitation:** Prisma's `groupBy()` requires grouping by actual columns. For computed groupings (e.g., date truncation), fall back to raw SQL.

---

### createMany(): Bulk Inserts

```typescript
// Seed database with initial users
async seedUsers(users: Array<{
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  role: string;
}>) {
  const result = await this.prisma.user.createMany({
    data: users,          // Array of user objects
    skipDuplicates: true  // Skip rows that violate unique constraints (don't error)
  });

  return result.count;  // Number of rows actually inserted
}

// Usage:
const count = await seedUsers([
  { email: "user1@example.com", passwordHash: "...", firstName: "Alice", ... },
  { email: "user2@example.com", passwordHash: "...", firstName: "Bob", ... },
  // ... 1000 more users
]);
console.log(`Inserted ${count} users`);  // "Inserted 1002 users"
```

**Generated SQL:**
```sql
INSERT INTO users (email, password_hash, first_name, last_name, role, created_at, updated_at)
VALUES 
  ('user1@example.com', '...', 'Alice', 'Johnson', 'customer', NOW(), NOW()),
  ('user2@example.com', '...', 'Bob', 'Smith', 'customer', NOW(), NOW()),
  ...
ON CONFLICT (email) DO NOTHING;  -- skipDuplicates: true
```

**Key Options:**
- `skipDuplicates: true` - Silently skip rows that violate unique constraints (useful for idempotent imports)
- `skipDuplicates: false` (default) - Error if any row violates unique constraint (entire batch fails)

**Limitations of createMany():**
- ❌ Does NOT return created IDs (returns `{ count: number }` only)
- ❌ Does NOT trigger Prisma middleware (if you have custom middleware)
- ❌ Does NOT support nested creates (can't create user + profile in one createMany)
- ✅ Use when: Bulk imports, seeding, and you don't need IDs back

---

### updateMany(): Bulk Updates

```typescript
// Mark all pending orders older than 7 days as "expired"
async expireOldPendingOrders() {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const result = await this.prisma.order.updateMany({
    where: {
      status: 'pending',
      createdAt: {
        lt: sevenDaysAgo
      }
    },
    data: {
      status: 'expired'
    }
  });

  return result.count;  // Number of rows updated
}

// Update pricing for all active products in a category
async updateCategoryPrices(categoryId: number, priceMultiplier: number) {
  // Note: Prisma doesn't support column math in updateMany
  // For complex updates, use raw SQL

  await this.prisma.$executeRaw`
    UPDATE products
    SET price = price * ${priceMultiplier}
    WHERE id IN (
      SELECT product_id 
      FROM product_categories 
      WHERE category_id = ${categoryId}
    )
    AND is_active = true;
  `;
}
```

**Generated SQL (first example):**
```sql
UPDATE orders
SET status = 'expired'
WHERE status = 'pending'
  AND created_at < '2026-08-05 00:00:00';
```

**Performance:**
- Updates all matching rows in **one query** (no loop)
- Returns `{ count: number }` (number of rows affected)
- **Limitation:** Can't use current column values in calculation (e.g., `price = price * 1.1`)

---

### deleteMany(): Bulk Deletes

From our existing TokenRepository ([services/api-gateway/src/repositories/token.repository.ts:93-99](../../services/api-gateway/src/repositories/token.repository.ts#L93-L99)):

```typescript
async deleteByUserId(userId: string): Promise<void> {
  await this.prisma.refreshToken.deleteMany({
    where: { userId }         // Delete ALL tokens for this user
  });
}
```

**Generated SQL:**
```sql
DELETE FROM refresh_tokens
WHERE user_id = $1;
```

#### deleteMany() with Time-Based Cleanup

```typescript
// Delete expired tokens (cleanup job)
async deleteExpiredTokens(): Promise<number> {
  const result = await this.prisma.refreshToken.deleteMany({
    where: {
      expiresAt: {
        lte: new Date()       // expires_at <= NOW()
      }
    }
  });

  return result.count;  // Number of tokens deleted
}

// Delete old audit logs (90 days retention)
async cleanupOldAuditLogs(): Promise<number> {
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const result = await this.prisma.auditLog.deleteMany({
    where: {
      createdAt: {
        lt: ninetyDaysAgo
      }
    }
  });

  return result.count;
}
```

**Safety Note:**
`deleteMany()` has NO confirmation - it immediately deletes all matching rows. Always:
1. Test `where` clause with `count()` first
2. Use `where` clause (never delete everything with empty `where`)
3. Consider soft deletes (set `deletedAt` instead of deleting)

---

### upsert(): Insert or Update (Idempotent Operations)

```typescript
// Create user if doesn't exist, update if exists
async upsertUser(email: string, userData: {
  passwordHash?: string;
  firstName?: string;
  lastName?: string;
}) {
  return await this.prisma.user.upsert({
    where: { email },         // Find by unique field
    
    // If found, update these fields
    update: {
      firstName: userData.firstName,
      lastName: userData.lastName,
      updatedAt: new Date()
    },
    
    // If NOT found, create with these fields
    create: {
      email,
      passwordHash: userData.passwordHash!,  // Required for create
      firstName: userData.firstName || '',
      lastName: userData.lastName || '',
      role: 'customer'
    }
  });
}

// Usage in sync job (idempotent):
await upsertUser('john@example.com', {
  firstName: 'John',
  lastName: 'Doe'
});
// Run again → same result (idempotent)
```

**Generated SQL (simplified):**
```sql
-- PostgreSQL uses ON CONFLICT
INSERT INTO users (email, first_name, last_name, ...)
VALUES ('john@example.com', 'John', 'Doe', ...)
ON CONFLICT (email) DO UPDATE
SET first_name = 'John', last_name = 'Doe', updated_at = NOW();
```

**Use Cases:**
- Syncing external data (run multiple times without duplicates)
- Import jobs (update if exists, create if new)
- Cache refresh (upsert computed values)

---

## 🏗️ SECTION 3: ARCHITECTURE & FLOW DIAGRAMS

### Aggregation Query Flow

```
┌────────────────────────────────────────────────────────────────┐
│            AGGREGATION QUERY EXECUTION                          │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Application Code                                              │
│  ┌──────────────────────────────────────────┐                 │
│  │ const stats = await prisma.order.        │                 │
│  │   aggregate({                             │                 │
│  │     _sum: { totalAmount: true },         │                 │
│  │     _count: true                          │                 │
│  │   });                                     │                 │
│  └──────────────┬───────────────────────────┘                 │
│                 │                                               │
│                 ▼                                               │
│  Prisma Query Engine (Rust)                                    │
│  ┌──────────────────────────────────────────┐                 │
│  │ Translates to SQL:                        │                 │
│  │ SELECT SUM(total_amount), COUNT(*)       │                 │
│  │ FROM orders WHERE status = 'completed';  │                 │
│  └──────────────┬───────────────────────────┘                 │
│                 │                                               │
│                 ▼                                               │
│  PostgreSQL Database                                           │
│  ┌──────────────────────────────────────────┐                 │
│  │ Scans 1,000,000 rows                     │                 │
│  │ Computes sum and count                   │                 │
│  │ Returns: { sum: 125000.50, count: 1250 }│                 │
│  └──────────────┬───────────────────────────┘                 │
│                 │                                               │
│                 ▼                                               │
│  Application receives:                                         │
│  { _sum: { totalAmount: 125000.50 }, _count: { _all: 1250 } }│
│                                                                 │
│  Time: ~50ms (database does all the work)                     │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

### Batch Operation Performance Comparison

```
┌──────────────────────────────────────────────────────────────┐
│       CREATE 1000 USERS: LOOP VS BATCH                        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ❌ Loop (1000 separate create() calls)                     │
│  ┌─────────────────────────────────────────────────┐        │
│  │ for (const user of users) {                     │        │
│  │   await prisma.user.create({ data: user });    │        │
│  │ }                                                │        │
│  └─────────────────────────────────────────────────┘        │
│                                                              │
│  Round-trips: 1000 (one per user)                           │
│  Time: ████████████████████████████████████ 10 seconds      │
│  Transaction overhead: 1000 BEGIN/COMMIT pairs              │
│  Network latency: 1000 × 2ms = 2 seconds wasted             │
│                                                              │
│  ✅ Batch (1 createMany() call)                            │
│  ┌─────────────────────────────────────────────────┐        │
│  │ await prisma.user.createMany({                 │        │
│  │   data: users                                   │        │
│  │ });                                             │        │
│  └─────────────────────────────────────────────────┘        │
│                                                              │
│  Round-trips: 1 (all users in one query)                    │
│  Time: ███ 200ms (50x faster!)                              │
│  Transaction overhead: 1 BEGIN/COMMIT pair                  │
│  Network latency: 1 × 2ms = 2ms                             │
│                                                              │
│  Speedup: 50x faster, 99% less network traffic              │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 🎯 SECTION 4: PRACTICAL EXAMPLES & INTERVIEW PREP

### Example 1: Dashboard Statistics (Multiple Aggregations)

```typescript
async getDashboardStats(userId: number) {
  // Run all queries in parallel
  const [userOrders, revenue, recentActivity] = await Promise.all([
    // Count orders by status
    this.prisma.order.groupBy({
      by: ['status'],
      _count: true,
      where: { userId }
    }),
    
    // Calculate total spent
    this.prisma.order.aggregate({
      _sum: { totalAmount: true },
      where: { userId, status: 'completed' }
    }),
    
    // Get recent order count (last 30 days)
    this.prisma.order.count({
      where: {
        userId,
        createdAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        }
      }
    })
  ]);

  return {
    ordersByStatus: userOrders,  // [{ status: 'completed', _count: 15 }, ...]
    totalSpent: revenue._sum.totalAmount || 0,
    ordersLast30Days: recentActivity
  };
}
```

### Example 2: Bulk Import with Error Handling

```typescript
async importProducts(products: Array<{
  name: string;
  price: number;
  stock: number;
}>) {
  try {
    // Attempt batch insert
    const result = await this.prisma.product.createMany({
      data: products,
      skipDuplicates: true  // Skip if product name already exists
    });

    return {
      success: true,
      inserted: result.count,
      skipped: products.length - result.count
    };
  } catch (error) {
    // Fallback: Insert one-by-one to identify problematic rows
    const errors: string[] = [];
    let successCount = 0;

    for (const product of products) {
      try {
        await this.prisma.product.create({ data: product });
        successCount++;
      } catch (err) {
        errors.push(`Failed to insert ${product.name}: ${err.message}`);
      }
    }

    return {
      success: false,
      inserted: successCount,
      errors
    };
  }
}
```

### Example 3: Cleanup Job (Delete + Count)

```typescript
// Run nightly: Delete expired tokens and log count
async cleanupExpiredTokens() {
  const now = new Date();

  // Count before deleting (for logging)
  const expiredCount = await this.prisma.refreshToken.count({
    where: { expiresAt: { lte: now } }
  });

  if (expiredCount === 0) {
    console.log('No expired tokens to clean up');
    return { deleted: 0 };
  }

  // Delete expired tokens
  const result = await this.prisma.refreshToken.deleteMany({
    where: { expiresAt: { lte: now } }
  });

  console.log(`Deleted ${result.count} expired tokens`);
  return { deleted: result.count };
}
```

### Example 4: Report Generation (Complex Grouping)

```typescript
// Monthly sales report
async getMonthlySalesReport(year: number) {
  // Use raw SQL for date functions (Prisma groupBy limitation)
  const report = await this.prisma.$queryRaw<Array<{
    month: Date;
    order_count: number;
    total_revenue: number;
    avg_order: number;
  }>>`
    SELECT 
      DATE_TRUNC('month', created_at) as month,
      COUNT(*) as order_count,
      SUM(total_amount) as total_revenue,
      AVG(total_amount) as avg_order
    FROM orders
    WHERE EXTRACT(YEAR FROM created_at) = ${year}
      AND status = 'completed'
    GROUP BY month
    ORDER BY month ASC;
  `;

  return report.map(row => ({
    month: row.month.toISOString().slice(0, 7),  // "2026-08"
    orders: Number(row.order_count),
    revenue: Number(row.total_revenue),
    avgOrder: Number(row.avg_order)
  }));
}
```

---

## 🎙️ INTERVIEW QUESTIONS

### 1. **Q:** What's the difference between `count()` and `findMany().length`?

**A:**
- **count()**: Database counts rows and returns just the number (e.g., 4 bytes). Fast and memory-efficient.
- **findMany().length**: Database fetches ALL rows, sends them to application, application counts. Slow and memory-intensive for large tables.

```typescript
// ❌ BAD: Fetches 1M rows, uses 500MB RAM
const users = await prisma.user.findMany();
const count = users.length;  // Takes 10 seconds

// ✅ GOOD: Database counts, returns just the number
const count = await prisma.user.count();  // Takes 50ms
```

**Rule:** Always use `count()` when you only need the count.

### 2. **Q:** When would you use `createMany()` instead of a loop of `create()` calls?

**A:**
Use `createMany()` when:
- Inserting 10+ records (batch operations are 10-50x faster)
- You don't need the created IDs back
- You don't need nested creates (e.g., user + profile)
- Seeding databases, bulk imports, or ETL pipelines

```typescript
// ❌ 1000 queries (10 seconds)
for (const user of users) {
  await prisma.user.create({ data: user });
}

// ✅ 1 query (200ms)
await prisma.user.createMany({ data: users });
```

**Limitation:** `createMany()` returns `{ count: number }`, NOT the created records or IDs.

### 3. **Q:** Explain the purpose of `skipDuplicates` in `createMany()`.

**A:**
`skipDuplicates: true` tells Prisma to **silently skip rows** that violate unique constraints instead of erroring.

**Use Cases:**
- **Idempotent imports**: Run the same import multiple times without errors
- **Syncing data**: Merge external data without checking if each row exists

```typescript
// skipDuplicates: false (default) - Error if ANY duplicate
await prisma.user.createMany({
  data: [
    { email: "user1@example.com", ... },  // New
    { email: "user2@example.com", ... },  // Duplicate → ERROR (entire batch fails)
  ]
});

// skipDuplicates: true - Skip duplicates silently
const result = await prisma.user.createMany({
  data: [
    { email: "user1@example.com", ... },  // New → Inserted
    { email: "user2@example.com", ... },  // Duplicate → Skipped
  ],
  skipDuplicates: true
});
console.log(result.count);  // 1 (only new row inserted)
```

### 4. **Q:** What are the limitations of Prisma's `groupBy()`? When would you fall back to raw SQL?

**A:**
**Limitations:**
1. Can only group by **actual columns** (not computed values)
2. No date functions (e.g., `DATE_TRUNC`, `EXTRACT(YEAR ...)`)
3. No complex expressions in `by` clause

**Fall back to raw SQL when:**
- Grouping by date ranges (monthly, yearly sales)
- Using window functions (ROW_NUMBER, RANK)
- Complex HAVING clauses
- Custom aggregations not supported by Prisma

```typescript
// ❌ Prisma doesn't support this
await prisma.order.groupBy({
  by: ['DATE_TRUNC("month", createdAt)'],  // ERROR: Not a column
  _sum: { totalAmount: true }
});

// ✅ Use raw SQL instead
const result = await prisma.$queryRaw`
  SELECT 
    DATE_TRUNC('month', created_at) as month,
    SUM(total_amount) as revenue
  FROM orders
  GROUP BY month;
`;
```

### 5. **Q:** How would you implement an upsert operation for multiple rows?

**A:**
Prisma's `upsert()` works on **one row** only. For multiple rows, use:

**Option 1: Loop (slow but simple)**
```typescript
for (const item of items) {
  await prisma.product.upsert({
    where: { sku: item.sku },
    update: { price: item.price },
    create: item
  });
}
```

**Option 2: Raw SQL with ON CONFLICT (fast)**
```typescript
// PostgreSQL
await prisma.$executeRaw`
  INSERT INTO products (sku, name, price)
  VALUES 
    ${Prisma.join(items.map(item => Prisma.sql`(${item.sku}, ${item.name}, ${item.price})`))}
  ON CONFLICT (sku) DO UPDATE
  SET price = EXCLUDED.price;
`;
```

**Option 3: Split into createMany + updateMany (middle ground)**
```typescript
const existing = await prisma.product.findMany({
  where: { sku: { in: items.map(i => i.sku) } },
  select: { sku: true }
});

const existingSkus = new Set(existing.map(p => p.sku));
const toCreate = items.filter(i => !existingSkus.has(i.sku));
const toUpdate = items.filter(i => existingSkus.has(i.sku));

await prisma.product.createMany({ data: toCreate });
for (const item of toUpdate) {
  await prisma.product.update({
    where: { sku: item.sku },
    data: { price: item.price }
  });
}
```

---

## ✅ MODULE COMPLETION CHECKLIST

- ✅ Theory: Aggregations vs application-side calculations
- ✅ count(): Counting with filters (from TokenRepository)
- ✅ aggregate(): Multiple calculations in one query
- ✅ groupBy(): Group and aggregate (with limitations)
- ✅ createMany(): Bulk inserts with skipDuplicates
- ✅ updateMany(): Bulk updates (from TokenRepository)
- ✅ deleteMany(): Bulk deletes (from TokenRepository)
- ✅ upsert(): Idempotent operations
- ✅ Performance comparison: Loop vs batch operations
- ✅ Real-world examples: Dashboard stats, cleanup jobs
- ✅ Interview questions with comprehensive answers

---

**Next:** [M19-PART4: Transactions & Raw Queries](M19-PRISMA-DEEP-DIVE-PART4.md)  
**Previous:** [M19-PART2: Relations & Joins](M19-PRISMA-DEEP-DIVE-PART2.md)

---

**Last Updated:** 2026-08-12  
**Module Length:** ~620 lines  
**Status:** ✅ Ready for Learning
