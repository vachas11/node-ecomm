# M19: Prisma Deep Dive - PART 4 (Transactions & Raw Queries)

**Prerequisites:** M18 (All Parts), M19-PART1, M19-PART2, M19-PART3  
**Level:** Advanced  
**Time to Master:** 4-5 hours  
**Focus:** Atomic operations and dropping down to raw SQL when needed

---

## 📖 SECTION 1: THEORY

### What Are Transactions?

A transaction is a **group of database operations that execute as a single unit** - either ALL succeed, or ALL fail (rollback). No partial execution.

**Real-World Analogy:**
Imagine transferring $100 from Account A to Account B:
1. Subtract $100 from Account A
2. Add $100 to Account B

**Without Transaction:**
If step 1 succeeds but step 2 fails (server crash), money vanishes! Account A lost $100, but Account B didn't receive it.

**With Transaction:**
Either BOTH steps succeed (money transferred) OR BOTH fail (money stays in Account A). No money lost.

### ACID Properties

Transactions guarantee **ACID**:

```
┌───────────────────────────────────────────────────────────┐
│                   ACID PROPERTIES                          │
├───────────────────────────────────────────────────────────┤
│                                                           │
│  A - Atomicity                                            │
│      All operations succeed, or all fail (no partial)     │
│      Example: Create order + deduct stock → Both or none │
│                                                           │
│  C - Consistency                                          │
│      Database remains in valid state (constraints hold)   │
│      Example: Foreign keys, unique constraints enforced   │
│                                                           │
│  I - Isolation                                            │
│      Concurrent transactions don't interfere              │
│      Example: Two users buying last item → Only one wins │
│                                                           │
│  D - Durability                                           │
│      Committed data persists even if server crashes       │
│      Example: Order confirmed → Saved permanently         │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

### When to Use Transactions

**✅ Use Transactions When:**
- Multiple tables must stay synchronized (e.g., order + inventory)
- Operations depend on each other (e.g., check stock → create order)
- Partial execution would corrupt data
- Transferring values between records (money, points, inventory)

**❌ Don't Use Transactions When:**
- Single operation (Prisma wraps each query in transaction automatically)
- Read-only queries (no data modification)
- Independent operations (can fail separately without issue)
- Long-running operations (locks database, blocks other users)

**Example Scenarios:**

| Scenario | Transaction Needed? | Why |
|----------|-------------------|------|
| Create user | ❌ No | Single operation |
| Create user + profile | ✅ Yes | Both must exist together |
| Fetch user list | ❌ No | Read-only |
| Create order + deduct stock | ✅ Yes | Stock must match orders |
| Send email + log it | ❌ No | Log can fail independently |

---

### Prisma Transaction Types

Prisma offers **two transaction APIs**:

#### 1. Sequential Operations (`$transaction([...])`)

```typescript
await prisma.$transaction([
  prisma.user.create({ data: { ... } }),
  prisma.profile.create({ data: { ... } }),
  prisma.auditLog.create({ data: { ... } })
]);
```

- Operations run **sequentially** (one after another)
- Simple syntax for independent operations
- All succeed or all rollback

#### 2. Interactive Transactions (`$transaction(async (tx) => { ... })`)

```typescript
await prisma.$transaction(async (tx) => {
  const user = await tx.user.create({ data: { ... } });  // Get ID
  await tx.profile.create({ data: { userId: user.id } }); // Use ID
});
```

- Operations can **depend on previous results**
- Access to returned data (e.g., created IDs)
- More control (conditional logic, loops)
- **Default timeout:** 5 seconds (configurable)

---

## 🔍 SECTION 2: LINE-BY-LINE CODE ANALYSIS

### $transaction([...]): Sequential Operations

```typescript
// Delete user and all their data atomically
async deleteUserAndData(userId: number): Promise<void> {
  await this.prisma.$transaction([
    // Order matters: Delete children first (foreign key constraints)
    this.prisma.refreshToken.deleteMany({ where: { userId: userId.toString() } }),
    this.prisma.order.deleteMany({ where: { userId } }),
    this.prisma.profile.delete({ where: { userId } }),
    this.prisma.user.delete({ where: { id: userId } })
  ]);
  
  // If ANY operation fails:
  // - Database rolls back ALL changes
  // - User remains with all their data intact
  // - Error is thrown to caller
}
```

**Generated SQL:**
```sql
BEGIN;
  DELETE FROM refresh_tokens WHERE user_id = '123';
  DELETE FROM orders WHERE user_id = 123;
  DELETE FROM profiles WHERE user_id = 123;
  DELETE FROM users WHERE id = 123;
COMMIT;

-- If any DELETE fails:
ROLLBACK;
```

**Key Points:**
- Each query is a **Prisma promise** (not `await` inside array)
- Queries run **in order** (top to bottom)
- **Cannot** access results of previous queries
- **All-or-nothing**: One failure = entire transaction rolls back

---

### $transaction(async (tx) => { ... }): Interactive Transactions

```typescript
// Create order and update product stock atomically
async checkout(userId: number, items: Array<{
  productId: number;
  quantity: number;
}>) {
  return await this.prisma.$transaction(async (tx) => {
    // Step 1: Check stock for ALL products
    const products = await tx.product.findMany({
      where: { id: { in: items.map(i => i.productId) } },
      select: { id: true, price: true, stock: true }
    });

    // Step 2: Validate stock availability
    for (const item of items) {
      const product = products.find(p => p.id === item.productId);
      
      if (!product) {
        throw new Error(`Product ${item.productId} not found`);
      }
      
      if (product.stock < item.quantity) {
        throw new Error(`Insufficient stock for product ${item.productId}`);
      }
    }

    // Step 3: Calculate total
    const total = items.reduce((sum, item) => {
      const product = products.find(p => p.id === item.productId)!;
      return sum + product.price.toNumber() * item.quantity;
    }, 0);

    // Step 4: Create order
    const order = await tx.order.create({
      data: {
        userId,
        status: 'pending',
        totalAmount: total,
        items: {
          create: items.map(item => {
            const product = products.find(p => p.id === item.productId)!;
            return {
              productId: item.productId,
              quantity: item.quantity,
              priceAtTime: product.price
            };
          })
        }
      }
    });

    // Step 5: Deduct stock for each product
    for (const item of items) {
      await tx.product.update({
        where: { id: item.productId },
        data: {
          stock: {
            decrement: item.quantity  // Atomic decrement
          }
        }
      });
    }

    return order;
  }, {
    maxWait: 5000,      // Wait max 5s to acquire lock
    timeout: 10000      // Transaction must complete within 10s
  });
}
```

**Transaction Lifecycle:**
```
┌──────────────────────────────────────────────────────┐
│  1. BEGIN TRANSACTION                                 │
│     ↓                                                 │
│  2. Check stock (read locks on product rows)         │
│     ↓                                                 │
│  3. Validate (if insufficient → throw → ROLLBACK)    │
│     ↓                                                 │
│  4. Create order                                      │
│     ↓                                                 │
│  5. Update stock (write locks)                       │
│     ↓                                                 │
│  6. COMMIT (release all locks)                       │
│                                                       │
│  If step 3 fails: ROLLBACK (undo steps 1-2)         │
│  If step 5 fails: ROLLBACK (undo steps 1-4)         │
└──────────────────────────────────────────────────────┘
```

**Key Options:**
- `maxWait`: How long to wait for a lock (if another transaction holds it)
- `timeout`: How long the transaction can run before auto-rollback
- **Default values**: `maxWait: 2000ms`, `timeout: 5000ms`

**When to Increase Timeout:**
- Complex multi-step operations
- High-traffic systems (more lock contention)
- External API calls within transaction (⚠️ NOT RECOMMENDED)

---

### $queryRaw: Type-Safe Raw SELECT Queries

From our existing UserRepository ([services/user-service/src/repositories/user.repository.ts:170-183](../../services/user-service/src/repositories/user.repository.ts#L170-L183)):

```typescript
async findUsersByRole(role: string): Promise<User[]> {
  const rows = await this.db.query<UserDatabaseRow>(
    'SELECT * FROM users WHERE role = $1 AND is_active = true ORDER BY created_at DESC',
    [role]
  );
  
  return rows.map(row => User.fromDatabaseRow(row));
}
```

**Prisma Equivalent with $queryRaw:**
```typescript
async findUsersByRole(role: string): Promise<User[]> {
  // Type-safe: Prisma validates query at runtime
  const rows = await this.prisma.$queryRaw<UserDatabaseRow[]>`
    SELECT * 
    FROM users 
    WHERE role = ${role} 
      AND is_active = true 
    ORDER BY created_at DESC
  `;
  
  return rows.map(row => User.fromDatabaseRow(row));
}
```

**Key Points:**
- **Tagged template literal**: `` $queryRaw`...` `` (note the backticks)
- **Parameterized queries**: `${variable}` is safely escaped (prevents SQL injection)
- **Type casting**: `<UserDatabaseRow[]>` tells TypeScript the return type
- **Returns raw database rows**: snake_case columns (not Prisma's camelCase)

#### Complex Query Example: Full-Text Search

```typescript
// Search users by name (case-insensitive, partial match)
async searchUsers(query: string, limit: number = 10): Promise<User[]> {
  const rows = await this.prisma.$queryRaw<UserDatabaseRow[]>`
    SELECT *
    FROM users
    WHERE 
      (
        first_name ILIKE ${`%${query}%`}
        OR last_name ILIKE ${`%${query}%`}
        OR email ILIKE ${`%${query}%`}
      )
      AND is_active = true
    ORDER BY 
      -- Exact match first, then partial matches
      CASE 
        WHEN first_name ILIKE ${query} THEN 1
        WHEN last_name ILIKE ${query} THEN 2
        ELSE 3
      END,
      first_name ASC
    LIMIT ${limit};
  `;
  
  return rows.map(row => User.fromDatabaseRow(row));
}
```

**Why Raw SQL?**
- **ILIKE**: Case-insensitive LIKE (Prisma has `contains` but not `mode: 'insensitive'` for all DBs)
- **Complex CASE ordering**: Prisma's `orderBy` doesn't support computed columns
- **Performance**: Single query instead of multiple Prisma filters

---

### $executeRaw: Raw INSERT/UPDATE/DELETE

```typescript
// Bulk role assignment (update multiple users)
async bulkUpdateRole(userIds: number[], newRole: string): Promise<number> {
  // Prisma.sql for array formatting (safe from injection)
  const result = await this.prisma.$executeRaw`
    UPDATE users
    SET role = ${newRole}, updated_at = NOW()
    WHERE id IN (${Prisma.join(userIds)})
      AND is_active = true
  `;
  
  return result;  // Returns number of affected rows
}

// Complex update: Increase prices by 10% for specific category
async increasePrices(categoryId: number, percentage: number): Promise<number> {
  const multiplier = 1 + (percentage / 100);
  
  const result = await this.prisma.$executeRaw`
    UPDATE products
    SET 
      price = price * ${multiplier},
      updated_at = NOW()
    WHERE id IN (
      SELECT product_id 
      FROM product_categories 
      WHERE category_id = ${categoryId}
    )
    AND is_active = true
  `;
  
  return result;  // Number of products updated
}
```

**$executeRaw vs $queryRaw:**
- **$queryRaw**: SELECT queries (returns rows)
- **$executeRaw**: INSERT/UPDATE/DELETE (returns affected row count)

**Prisma.join() Helper:**
```typescript
const ids = [1, 2, 3];

// ✅ GOOD: Prisma.join() safely formats arrays
await prisma.$executeRaw`
  DELETE FROM users WHERE id IN (${Prisma.join(ids)})
`;
// SQL: DELETE FROM users WHERE id IN ($1, $2, $3)
// Params: [1, 2, 3]

// ❌ BAD: String interpolation (SQL injection risk!)
await prisma.$executeRaw`
  DELETE FROM users WHERE id IN (${ids.join(',')})
`;
// SQL: DELETE FROM users WHERE id IN (1, 2, 3)  ← NOT parameterized!
```

---

### $queryRawUnsafe: Dynamic Queries (⚠️ USE WITH CAUTION)

```typescript
// ⚠️ UNSAFE: User input directly in query
async sortUsers(sortColumn: string, sortOrder: string) {
  // ❌ DANGEROUS: SQL injection vulnerability!
  const users = await this.prisma.$queryRawUnsafe(
    `SELECT * FROM users ORDER BY ${sortColumn} ${sortOrder}`
  );
  
  return users;
}

// If attacker passes:
// sortColumn = "id; DROP TABLE users; --"
// SQL: SELECT * FROM users ORDER BY id; DROP TABLE users; --
// Result: All users deleted! 💥
```

**✅ SAFE Alternative: Whitelist Input**
```typescript
async sortUsers(sortColumn: string, sortOrder: 'asc' | 'desc') {
  // Whitelist valid columns
  const validColumns = ['id', 'email', 'first_name', 'last_name', 'created_at'];
  
  if (!validColumns.includes(sortColumn)) {
    throw new Error(`Invalid sort column: ${sortColumn}`);
  }
  
  if (sortOrder !== 'asc' && sortOrder !== 'desc') {
    throw new Error('Sort order must be asc or desc');
  }
  
  // Now safe to use $queryRawUnsafe
  const users = await this.prisma.$queryRawUnsafe<User[]>(
    `SELECT * FROM users WHERE is_active = true ORDER BY ${sortColumn} ${sortOrder}`
  );
  
  return users;
}
```

**When to Use $queryRawUnsafe:**
- Dynamic table names (validated from whitelist)
- Dynamic column names (validated from schema)
- Complex queries where Prisma.sql is too restrictive

**Security Checklist:**
1. ✅ Validate ALL dynamic inputs against whitelist
2. ✅ Never interpolate user input directly
3. ✅ Use $queryRaw (parameterized) whenever possible
4. ✅ Log queries for audit trail
5. ✅ Test with SQL injection payloads (e.g., `'; DROP TABLE users; --`)

---

## 🏗️ SECTION 3: ARCHITECTURE & FLOW DIAGRAMS

### Transaction Isolation Levels

```
┌────────────────────────────────────────────────────────────┐
│          TRANSACTION ISOLATION LEVELS                       │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  READ UNCOMMITTED (weakest)                                │
│  ┌─────────────────────────────────────┐                  │
│  │ Can read uncommitted changes         │                  │
│  │ Problem: "Dirty reads"               │                  │
│  │ Example: See order before it's saved │                  │
│  └─────────────────────────────────────┘                  │
│                                                            │
│  READ COMMITTED (PostgreSQL default)                       │
│  ┌─────────────────────────────────────┐                  │
│  │ Only read committed data             │                  │
│  │ Problem: "Non-repeatable reads"      │                  │
│  │ Example: Read same row twice → diff  │                  │
│  └─────────────────────────────────────┘                  │
│                                                            │
│  REPEATABLE READ                                           │
│  ┌─────────────────────────────────────┐                  │
│  │ Same row returns same data           │                  │
│  │ Problem: "Phantom reads"             │                  │
│  │ Example: Query returns different rows│                  │
│  └─────────────────────────────────────┘                  │
│                                                            │
│  SERIALIZABLE (strongest)                                  │
│  ┌─────────────────────────────────────┐                  │
│  │ Full isolation (like single-user DB) │                  │
│  │ Problem: Performance (heavy locking) │                  │
│  │ Use: Critical financial transactions │                  │
│  └─────────────────────────────────────┘                  │
│                                                            │
│  Prisma uses PostgreSQL default: READ COMMITTED            │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### Transaction Deadlock Scenario

```
┌──────────────────────────────────────────────────────────┐
│                   DEADLOCK EXAMPLE                        │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Timeline:                                               │
│                                                          │
│  T1: BEGIN                    T2: BEGIN                  │
│  T1: LOCK Product A           T2: LOCK Product B         │
│  T1: [waiting for Product B]  T2: [waiting for Product A]│
│       ↓                              ↓                   │
│       └──────────── DEADLOCK ────────┘                  │
│                                                          │
│  Resolution: Database detects deadlock and kills T2     │
│  T2 gets error: "deadlock detected"                     │
│  T1 completes successfully                              │
│                                                          │
│  Prevention:                                             │
│  - Always acquire locks in same order (A before B)      │
│  - Keep transactions short                              │
│  - Use timeouts                                          │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

## 🎯 SECTION 4: PRACTICAL EXAMPLES & INTERVIEW PREP

### Example 1: Money Transfer (Classic Transaction)

```typescript
async transferBalance(
  fromUserId: number,
  toUserId: number,
  amount: number
) {
  return await this.prisma.$transaction(async (tx) => {
    // Step 1: Check sender's balance
    const sender = await tx.userWallet.findUnique({
      where: { userId: fromUserId }
    });

    if (!sender || sender.balance < amount) {
      throw new Error('Insufficient balance');
    }

    // Step 2: Deduct from sender
    await tx.userWallet.update({
      where: { userId: fromUserId },
      data: { balance: { decrement: amount } }
    });

    // Step 3: Add to recipient
    await tx.userWallet.update({
      where: { userId: toUserId },
      data: { balance: { increment: amount } }
    });

    // Step 4: Log transaction
    await tx.transaction.create({
      data: {
        fromUserId,
        toUserId,
        amount,
        type: 'transfer',
        status: 'completed'
      }
    });

    return { success: true, amount };
  });
}
```

### Example 2: Inventory Management with Retry

```typescript
async purchaseProduct(
  userId: number,
  productId: number,
  quantity: number
) {
  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Lock product row (prevent concurrent purchases)
        const product = await tx.product.findUnique({
          where: { id: productId }
        });

        if (!product || product.stock < quantity) {
          throw new Error('Insufficient stock');
        }

        // Create order
        const order = await tx.order.create({
          data: {
            userId,
            status: 'pending',
            totalAmount: product.price.toNumber() * quantity,
            items: {
              create: {
                productId,
                quantity,
                priceAtTime: product.price
              }
            }
          }
        });

        // Deduct stock
        await tx.product.update({
          where: { id: productId },
          data: { stock: { decrement: quantity } }
        });

        return order;
      }, {
        timeout: 10000  // 10s timeout
      });

    } catch (error) {
      attempt++;
      
      if (error.message.includes('Insufficient stock')) {
        throw error;  // Don't retry if out of stock
      }
      
      if (attempt >= maxRetries) {
        throw new Error(`Transaction failed after ${maxRetries} attempts`);
      }
      
      // Wait before retry (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, attempt)));
    }
  }
}
```

### Example 3: Combining Prisma + Raw SQL in Transaction

```typescript
async generateMonthlyReport(month: Date) {
  return await this.prisma.$transaction(async (tx) => {
    // Step 1: Prisma query for order data
    const orders = await tx.order.findMany({
      where: {
        createdAt: {
          gte: month,
          lt: new Date(month.getFullYear(), month.getMonth() + 1, 1)
        },
        status: 'completed'
      },
      include: { items: true }
    });

    // Step 2: Raw SQL for complex aggregation
    const topProducts = await tx.$queryRaw<Array<{
      product_id: number;
      product_name: string;
      units_sold: number;
      revenue: number;
    }>>`
      SELECT 
        p.id as product_id,
        p.name as product_name,
        SUM(oi.quantity) as units_sold,
        SUM(oi.quantity * oi.price_at_time) as revenue
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN products p ON p.id = oi.product_id
      WHERE o.created_at >= ${month}
        AND o.created_at < ${new Date(month.getFullYear(), month.getMonth() + 1, 1)}
        AND o.status = 'completed'
      GROUP BY p.id, p.name
      ORDER BY revenue DESC
      LIMIT 10;
    `;

    // Step 3: Store report
    await tx.monthlyReport.create({
      data: {
        month,
        totalOrders: orders.length,
        totalRevenue: orders.reduce((sum, o) => sum + o.totalAmount.toNumber(), 0),
        topProducts: topProducts
      }
    });

    return { orders: orders.length, topProducts };
  });
}
```

---

## 🎙️ INTERVIEW QUESTIONS

### 1. **Q:** What's the difference between `$transaction([...])` and `$transaction(async (tx) => { ... })`?

**A:**
- **`$transaction([...])`** (Sequential):
  - Array of Prisma promises
  - Simpler syntax
  - Cannot access results of previous operations
  - Use when operations are independent

- **`$transaction(async (tx) => { ... })`** (Interactive):
  - Callback function with transaction client
  - Can read results and make decisions
  - Supports conditional logic, loops
  - Use when operations depend on previous results

```typescript
// Sequential: Create user + profile (no dependency)
await prisma.$transaction([
  prisma.user.create({ data: { email: "..." } }),
  prisma.profile.create({ data: { userId: 1, bio: "..." } })  // ❌ Can't get user.id
]);

// Interactive: Create user, THEN profile with user's ID
await prisma.$transaction(async (tx) => {
  const user = await tx.user.create({ data: { email: "..." } });
  await tx.profile.create({ data: { userId: user.id, bio: "..." } });  // ✅ Use user.id
});
```

### 2. **Q:** When would you use raw SQL (`$queryRaw`) instead of Prisma queries?

**A:**
Use raw SQL when:
1. **Complex queries** Prisma doesn't support (CTEs, window functions, full-text search)
2. **Performance-critical** queries (hand-optimized SQL)
3. **Database-specific features** (PostgreSQL's ILIKE, JSON operators)
4. **Dynamic queries** (validated column/table names)
5. **Complex aggregations** (DATE_TRUNC, custom CASE statements)

```typescript
// Prisma doesn't support this:
const result = await prisma.$queryRaw`
  WITH monthly_sales AS (
    SELECT 
      DATE_TRUNC('month', created_at) as month,
      SUM(total_amount) as revenue,
      ROW_NUMBER() OVER (ORDER BY SUM(total_amount) DESC) as rank
    FROM orders
    GROUP BY month
  )
  SELECT * FROM monthly_sales WHERE rank <= 5;
`;
```

**Always prefer Prisma when possible** for type safety and maintainability.

### 3. **Q:** How would you handle transaction timeouts in a high-traffic system?

**A:**
```typescript
async checkout(userId: number, items: CartItem[]) {
  try {
    return await this.prisma.$transaction(
      async (tx) => {
        // ... checkout logic
      },
      {
        maxWait: 5000,    // Wait up to 5s for lock
        timeout: 15000,   // Transaction can run for 15s
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
      }
    );
  } catch (error) {
    if (error.code === 'P2028') {  // Transaction timeout
      // Retry with exponential backoff
      await delay(100);
      return this.checkout(userId, items);
    }
    
    throw error;
  }
}
```

**Best Practices:**
1. **Keep transactions short** (< 5 seconds)
2. **Don't call external APIs** inside transactions (move to after commit)
3. **Use optimistic locking** (version columns) instead of long locks
4. **Implement retry logic** for transient errors
5. **Monitor transaction duration** (alertif > 1s)

### 4. **Q:** Explain the security risk of `$queryRawUnsafe` and how to mitigate it.

**A:**
**Risk:** SQL injection - user input directly concatenated into query.

```typescript
// ❌ VULNERABLE
async search(userInput: string) {
  return await prisma.$queryRawUnsafe(
    `SELECT * FROM users WHERE name LIKE '%${userInput}%'`
  );
}

// Attacker passes: userInput = "'; DROP TABLE users; --"
// SQL: SELECT * FROM users WHERE name LIKE '%'; DROP TABLE users; --%'
// Result: users table deleted! 💥
```

**Mitigation:**
1. **Use $queryRaw with tagged templates** (parameterized):
   ```typescript
   await prisma.$queryRaw`SELECT * FROM users WHERE name LIKE ${`%${userInput}%`}`
   ```

2. **Whitelist dynamic inputs**:
   ```typescript
   const validColumns = ['name', 'email', 'created_at'];
   if (!validColumns.includes(sortColumn)) throw new Error('Invalid column');
   ```

3. **Escape special characters** (last resort):
   ```typescript
   const escaped = userInput.replace(/'/g, "''");
   ```

4. **Never use for user-facing queries** - reserve for admin tools only

### 5. **Q:** How would you debug a deadlock issue in production?

**A:**
**Deadlock Detection:**
1. **Error code:** Prisma throws `P2034` for deadlocks
2. **Logs:** Enable query logging: `log: ['query', 'info', 'warn', 'error']`
3. **Database logs:** PostgreSQL logs deadlock details

**Debugging Steps:**
```typescript
// 1. Log transaction details
try {
  await prisma.$transaction(async (tx) => {
    console.log('Transaction started:', new Date());
    // ... operations with timestamps
  });
} catch (error) {
  if (error.code === 'P2034') {
    console.error('Deadlock detected:', {
      time: new Date(),
      user: userId,
      operation: 'checkout'
    });
  }
}

// 2. Query PostgreSQL for deadlock info
SELECT * FROM pg_stat_activity WHERE wait_event_type = 'Lock';
```

**Solutions:**
1. **Always acquire locks in same order** (sort IDs before locking)
   ```typescript
   const productIds = items.map(i => i.productId).sort();
   for (const id of productIds) {
     await tx.product.findUnique({ where: { id } });  // Lock in order
   }
   ```

2. **Reduce transaction scope** (lock fewer resources)
3. **Use optimistic locking** (version columns, retry on conflict)
4. **Increase timeout** (let one transaction finish before other starts)

---

## ✅ MODULE COMPLETION CHECKLIST

- ✅ Theory: ACID properties, when to use transactions
- ✅ $transaction([...]): Sequential operations
- ✅ $transaction(async (tx) => {}): Interactive transactions with timeout options
- ✅ $queryRaw: Type-safe raw SELECT queries
- ✅ $executeRaw: Raw INSERT/UPDATE/DELETE with Prisma.join()
- ✅ $queryRawUnsafe: Security risks and mitigation strategies
- ✅ Transaction lifecycle diagrams (BEGIN/COMMIT/ROLLBACK)
- ✅ Isolation levels and deadlock scenarios
- ✅ Real-world examples: Money transfer, inventory management
- ✅ Interview questions with comprehensive answers

---

**Next:** [M20-PART1: Migrations Deep Dive](M20-PRISMA-DEEP-DIVE-PART1.md) *(To be created)*  
**Previous:** [M19-PART3: Aggregations & Batch Operations](M19-PRISMA-DEEP-DIVE-PART3.md)

---

## 🎓 M19 SERIES COMPLETE!

You've now mastered:
- ✅ **M19-PART1:** Advanced Filtering & Sorting
- ✅ **M19-PART2:** Relations & Joins
- ✅ **M19-PART3:** Aggregations & Batch Operations
- ✅ **M19-PART4:** Transactions & Raw Queries

**Total Learning Time:** 13-16 hours  
**Total Content:** ~2,400 lines of comprehensive Prisma advanced queries documentation

You can now:
- Write complex Prisma queries with confidence
- Optimize queries for performance
- Handle relations and nested data
- Use transactions for data integrity
- Fall back to raw SQL when needed
- Pass senior/lead-level Prisma interview questions

**Next Step:** Master Prisma Migrations (M20 series) for production-ready schema management.

---

**Last Updated:** 2026-08-12  
**Module Length:** ~650 lines  
**Status:** ✅ Ready for Learning
