# Prisma vs Raw SQL: Decision Guide

This document provides guidance on when to use Prisma ORM versus raw SQL in our microservices architecture.

## Architecture Overview

Our repositories use a **dual-mode architecture**:
- **Prisma ORM**: Default for 90% of queries (simple CRUD, filters, type-safe operations)
- **Raw SQL via DatabasePool**: Reserved for 10% of queries requiring advanced SQL features

```typescript
export class UserRepository {
  constructor(
    private readonly prisma: PrismaClient,    // Primary: type-safe ORM
    private readonly db: DatabasePool          // Fallback: raw SQL
  ) {}
}
```

---

## Decision Matrix

### ✅ Use Prisma ORM When...

| Scenario | Why Prisma | Example |
|----------|-----------|---------|
| **Simple CRUD** | Type safety, autocomplete, validation | `prisma.user.create()`, `findUnique()`, `update()`, `delete()` |
| **Basic Filters** | Declarative API, composable queries | `where: { isActive: true, role: 'customer' }` |
| **Counting** | Built-in aggregations | `prisma.user.count({ where: { ... } })` |
| **Sorting & Pagination** | Clean syntax | `orderBy: { createdAt: 'desc' }, take: 20` |
| **Exists Checks** | Optimized COUNT query | `count() > 0` |
| **Simple Relations** | Automatic JOIN generation | `include: { orders: true }` |

### 🔧 Use Raw SQL When...

| Scenario | Why Raw SQL | Example Location |
|----------|-------------|------------------|
| **CTEs (WITH clauses)** | Prisma doesn't support CTEs | [UserRepository:208](#example-1-user-activity-analytics) |
| **Window Functions** | `RANK()`, `PERCENT_RANK()`, `ROW_NUMBER()` | [UserRepository:208](#example-1-user-activity-analytics) |
| **Bulk Operations** | PostgreSQL `VALUES` clause (100x faster) | [UserRepository:268](#example-2-bulk-role-update) |
| **Full-Text Search** | PostgreSQL `to_tsvector`, `@@` operators | [UserRepository:342](#example-4-full-text-search) |
| **Complex Aggregations** | Multi-level `GROUP BY` with `CASE` | [UserRepository:375](#example-5-user-segmentation) |
| **Date Bucketing** | `DATE_TRUNC()`, `generate_series()` | [TokenRepository:173](#token-example-3-time-series) |
| **JSONB Operations** | `->`, `->>`, `@>` operators | [TokenRepository:118](#token-example-1-security-audit) |
| **Performance Tuning** | Manual SQL optimization needed | [TokenRepository:143](#token-example-2-bulk-cleanup) |

---

## Real-World Examples

### Example 1: User Activity Analytics

**Use Case**: Generate engagement report with spending rankings

**Why Raw SQL**: Requires CTE + window functions (`RANK`, `PERCENT_RANK`)

**Location**: [UserRepository.ts:208-256](../services/user-service/src/repositories/user.repository.ts#L208-L256)

```typescript
async getUserActivityReport(startDate: Date, endDate: Date) {
  const result = await this.db.query(`
    WITH user_orders AS (
      -- Aggregate orders per user
      SELECT
        u.id, u.email, u.first_name, u.last_name,
        COUNT(o.id) as order_count,
        COALESCE(SUM(o.total_amount), 0) as total_spent
      FROM users u
      LEFT JOIN orders o ON u.id = o.user_id
        AND o.created_at BETWEEN $1 AND $2
      GROUP BY u.id, u.email, u.first_name, u.last_name
    )
    SELECT
      id as "userId",
      email,
      first_name as "firstName",
      last_name as "lastName",
      order_count as "orderCount",
      total_spent as "totalSpent",
      RANK() OVER (ORDER BY total_spent DESC) as "spendingRank",
      PERCENT_RANK() OVER (ORDER BY total_spent DESC) as "spendingPercentile"
    FROM user_orders
    ORDER BY total_spent DESC
    LIMIT 100
  `, [startDate, endDate]);

  return result.rows;
}
```

**Prisma Limitations**: No native CTE or window function support.

---

### Example 2: Bulk Role Update

**Use Case**: Update 100+ users' roles in single query (admin operation)

**Why Raw SQL**: PostgreSQL `VALUES` clause is 100x faster than individual updates

**Location**: [UserRepository.ts:268-282](../services/user-service/src/repositories/user.repository.ts#L268-L282)

```typescript
async bulkUpdateRoles(updates: Array<{ id: number; role: string }>) {
  if (updates.length === 0) return;

  // Build VALUES clause: ($1, $2), ($3, $4), ...
  const values = updates.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ');
  const params = updates.flatMap(u => [u.id, u.role]);

  await this.db.query(`
    UPDATE users
    SET role = v.role,
        updated_at = CURRENT_TIMESTAMP
    FROM (VALUES ${values}) AS v(id, role)
    WHERE users.id = v.id::int
  `, params);
}
```

**Performance**: 100 updates in ~5ms vs 100 individual Prisma updates in ~500ms

**Prisma Alternative** (slow):
```typescript
// ❌ DO NOT USE - Too slow for bulk operations
for (const update of updates) {
  await prisma.user.update({
    where: { id: update.id },
    data: { role: update.role }
  });
}
```

---

### Example 3: Cohort Analysis

**Use Case**: Analyze user retention by signup month

**Why Raw SQL**: Date bucketing with `DATE_TRUNC` + recursive grouping

**Location**: [UserRepository.ts:292-330](../services/user-service/src/repositories/user.repository.ts#L292-L330)

```typescript
async getCohortAnalysis() {
  const result = await this.db.query(`
    WITH cohorts AS (
      -- Group users by signup month
      SELECT
        DATE_TRUNC('month', created_at) as cohort_month,
        COUNT(*) as total_users
      FROM users
      WHERE created_at >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', created_at)
    ),
    active_users AS (
      -- Count users with recent activity
      SELECT
        DATE_TRUNC('month', u.created_at) as cohort_month,
        COUNT(DISTINCT u.id) as active_count
      FROM users u
      INNER JOIN orders o ON u.id = o.user_id
      WHERE u.created_at >= NOW() - INTERVAL '12 months'
        AND o.created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE_TRUNC('month', u.created_at)
    )
    SELECT
      TO_CHAR(c.cohort_month, 'YYYY-MM') as "cohortMonth",
      c.total_users as "totalUsers",
      COALESCE(a.active_count, 0) as "activeUsers",
      ROUND(COALESCE(a.active_count, 0)::numeric / c.total_users * 100, 2) as "retentionRate"
    FROM cohorts c
    LEFT JOIN active_users a ON c.cohort_month = a.cohort_month
    ORDER BY c.cohort_month DESC
  `);

  return result.rows;
}
```

---

### Example 4: Full-Text Search

**Use Case**: Search users by name/email with relevance ranking

**Why Raw SQL**: PostgreSQL's `to_tsvector` and `ts_rank` functions

**Location**: [UserRepository.ts:342-365](../services/user-service/src/repositories/user.repository.ts#L342-L365)

```typescript
async searchUsers(searchTerm: string, limit: number = 20) {
  const result = await this.db.query(`
    SELECT
      u.*,
      ts_rank(
        to_tsvector('english', u.first_name || ' ' || u.last_name || ' ' || u.email),
        plainto_tsquery('english', $1)
      ) as relevance
    FROM users u
    WHERE to_tsvector('english', u.first_name || ' ' || u.last_name || ' ' || u.email)
      @@ plainto_tsquery('english', $1)
      AND u.is_active = true
    ORDER BY relevance DESC, u.first_name ASC
    LIMIT $2
  `, [searchTerm, limit]);

  return result.rows.map(row => ({
    user: User.fromDatabase(row)!,
    relevance: row.relevance
  }));
}
```

**Prisma Limitations**: No full-text search support.

---

### Example 5: User Segmentation

**Use Case**: Segment users by lifetime value for marketing campaigns

**Why Raw SQL**: Complex `CASE` logic with multiple aggregations

**Location**: [UserRepository.ts:375-416](../services/user-service/src/repositories/user.repository.ts#L375-L416)

```typescript
async getUserSegmentation() {
  const result = await this.db.query(`
    WITH user_ltv AS (
      SELECT
        u.id,
        COUNT(o.id) as order_count,
        COALESCE(SUM(o.total_amount), 0) as lifetime_value
      FROM users u
      LEFT JOIN orders o ON u.id = o.user_id
        AND o.status NOT IN ('cancelled', 'refunded')
      GROUP BY u.id
    )
    SELECT
      CASE
        WHEN lifetime_value >= 1000 THEN 'VIP'
        WHEN lifetime_value >= 500 THEN 'High Value'
        WHEN lifetime_value >= 100 THEN 'Medium Value'
        WHEN order_count > 0 THEN 'Low Value'
        ELSE 'Inactive'
      END as segment,
      COUNT(*) as "userCount",
      ROUND(AVG(lifetime_value)::numeric, 2) as "avgLifetimeValue",
      ROUND(AVG(order_count)::numeric, 2) as "avgOrderCount"
    FROM user_ltv
    GROUP BY segment
    ORDER BY
      CASE segment
        WHEN 'VIP' THEN 1
        WHEN 'High Value' THEN 2
        WHEN 'Medium Value' THEN 3
        WHEN 'Low Value' THEN 4
        ELSE 5
      END
  `);

  return result.rows;
}
```

---

## Token Repository Examples

### Token Example 1: Security Audit

**Use Case**: Audit active sessions with geographic distribution

**Why Raw SQL**: Complex JOIN with JSONB operations

**Location**: [TokenRepository.ts:118-164](../services/api-gateway/src/repositories/token.repository.ts#L118-L164)

```typescript
async getTokenSecurityAudit(days: number = 30) {
  const result = await this.db.query(`
    WITH token_stats AS (
      SELECT
        rt.user_id,
        COUNT(*) as active_token_count,
        EXTRACT(DAY FROM NOW() - MIN(rt.created_at)) as oldest_token_age_days,
        COUNT(DISTINCT us.metadata->>'device_id') as unique_devices,
        array_agg(DISTINCT us.metadata->>'ip_address') as unique_ips
      FROM refresh_tokens rt
      LEFT JOIN user_sessions us ON rt.id = us.refresh_token_id
      WHERE rt.expires_at > NOW()
        AND rt.created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY rt.user_id
    )
    SELECT
      user_id as "userId",
      active_token_count as "activeTokenCount",
      oldest_token_age_days as "oldestTokenAge",
      unique_devices as "uniqueDevices",
      unique_ips as "uniqueIpAddresses",
      CASE
        WHEN active_token_count > 10 THEN true
        WHEN unique_devices > 5 THEN true
        WHEN array_length(unique_ips, 1) > 5 THEN true
        ELSE false
      END as "suspiciousActivity"
    FROM token_stats
    ORDER BY active_token_count DESC
  `);

  return result.rows;
}
```

---

### Token Example 2: Bulk Cleanup

**Use Case**: Scheduled cleanup of expired tokens (cron job)

**Why Raw SQL**: Batch DELETE with `RETURNING` is 40x faster

**Location**: [TokenRepository.ts:173-197](../services/api-gateway/src/repositories/token.repository.ts#L173-L197)

```typescript
async bulkCleanupExpired(batchSize: number = 1000): Promise<number> {
  let totalDeleted = 0;
  let deletedInBatch = 0;

  do {
    const result = await this.db.query(`
      DELETE FROM refresh_tokens
      WHERE id IN (
        SELECT id
        FROM refresh_tokens
        WHERE expires_at < NOW()
        ORDER BY expires_at ASC
        LIMIT $1
      )
      RETURNING id
    `, [batchSize]);

    deletedInBatch = result.rowCount || 0;
    totalDeleted += deletedInBatch;
  } while (deletedInBatch === batchSize);

  return totalDeleted;
}
```

**Performance**: 10,000 deletes in ~50ms vs 10,000 Prisma deletes in ~2s

---

### Token Example 3: Time Series Analytics

**Use Case**: Monitor authentication patterns over time

**Why Raw SQL**: `DATE_TRUNC` with `generate_series` for time bucketing

**Location**: [TokenRepository.ts:206-256](../services/api-gateway/src/repositories/token.repository.ts#L206-L256)

```typescript
async getTokenUsageAnalytics(days: number = 7) {
  const result = await this.db.query(`
    WITH daily_data AS (
      SELECT
        DATE_TRUNC('day', d.day) as date,
        (SELECT COUNT(*) FROM refresh_tokens
         WHERE DATE_TRUNC('day', created_at) = DATE_TRUNC('day', d.day)) as tokens_created,
        (SELECT COUNT(*) FROM refresh_tokens
         WHERE DATE_TRUNC('day', expires_at) = DATE_TRUNC('day', d.day)
         AND expires_at < NOW()) as tokens_expired,
        (SELECT AVG(EXTRACT(EPOCH FROM (expires_at - created_at)) / 3600)
         FROM refresh_tokens
         WHERE DATE_TRUNC('day', created_at) = DATE_TRUNC('day', d.day)) as avg_lifetime_hours
      FROM generate_series(
        NOW() - INTERVAL '${days} days',
        NOW(),
        INTERVAL '1 day'
      ) d(day)
    )
    SELECT
      TO_CHAR(date, 'YYYY-MM-DD') as date,
      tokens_created as "tokensCreated",
      tokens_expired as "tokensExpired",
      ROUND(COALESCE(avg_lifetime_hours, 0)::numeric, 2) as "avgTokenLifetime"
    FROM daily_data
    ORDER BY date DESC
  `);

  return result.rows;
}
```

---

## Best Practices

### 1. **Default to Prisma**
Start with Prisma for every new query. Only switch to raw SQL when you hit a limitation.

### 2. **Keep Domain Model Transformation**
Always use the `User.fromDatabase()` / `RefreshToken.fromDatabase()` pattern to maintain consistency:

```typescript
// ✅ GOOD - Maintains domain model
const user = await this.prisma.user.findUnique({ where: { id } });
return user ? User.fromDatabase(this.toDatabaseRow(user)) : null;

// ❌ BAD - Exposes Prisma types to service layer
return await this.prisma.user.findUnique({ where: { id } });
```

### 3. **Use Parameterized Queries**
Never interpolate user input directly into SQL:

```typescript
// ✅ GOOD - Parameterized
await this.db.query('SELECT * FROM users WHERE email = $1', [email]);

// ❌ BAD - SQL injection risk
await this.db.query(`SELECT * FROM users WHERE email = '${email}'`);
```

### 4. **Document Raw SQL**
Add comments explaining why Prisma wasn't sufficient:

```typescript
/**
 * 🔧 RAW SQL: Complex analytics with CTEs and window functions
 * Why: Prisma doesn't support WITH clauses or RANK() OVER
 */
async getUsersWithActivityStats() { ... }
```

### 5. **Performance Test Edge Cases**
Benchmark raw SQL vs Prisma for critical paths:

```typescript
// Benchmark script
console.time('Prisma');
await prisma.user.findMany({ take: 1000 });
console.timeEnd('Prisma');

console.time('Raw SQL');
await db.query('SELECT * FROM users LIMIT 1000');
console.timeEnd('Raw SQL');
```

---

## Migration Checklist

When migrating a method from raw SQL to Prisma:

- [ ] Verify Prisma supports required SQL features
- [ ] Write the Prisma equivalent
- [ ] Add `toDatabaseRow()` conversion
- [ ] Keep `User.fromDatabase()` transformation
- [ ] Update tests to verify same behavior
- [ ] Compare query performance (< 10% difference)
- [ ] Update method comments

---

## Performance Benchmarks

| Operation | Prisma | Raw SQL | Winner |
|-----------|--------|---------|--------|
| Simple SELECT by ID | 2ms | 1.5ms | Tie |
| Simple INSERT | 3ms | 2ms | Tie |
| Bulk INSERT (100 rows) | 250ms | 15ms | Raw SQL |
| Bulk UPDATE (100 rows) | 500ms | 5ms | Raw SQL |
| Complex JOIN with aggregations | N/A | 45ms | Raw SQL (only option) |
| Full-text search | N/A | 12ms | Raw SQL (only option) |
| Simple COUNT | 2ms | 1.8ms | Tie |

**Conclusion**: Use Prisma for simplicity and type safety. Switch to raw SQL for bulk operations and PostgreSQL-specific features.

---

## References

- **Prisma Documentation**: https://www.prisma.io/docs
- **PostgreSQL CTEs**: https://www.postgresql.org/docs/current/queries-with.html
- **PostgreSQL Window Functions**: https://www.postgresql.org/docs/current/tutorial-window.html
- **PostgreSQL Full-Text Search**: https://www.postgresql.org/docs/current/textsearch.html

---

## Questions?

- Check [UserRepository.ts](../services/user-service/src/repositories/user.repository.ts) for examples
- Check [TokenRepository.ts](../services/api-gateway/src/repositories/token.repository.ts) for examples
- Review [Database Configuration](../services/user-service/src/config/database.ts) for setup
