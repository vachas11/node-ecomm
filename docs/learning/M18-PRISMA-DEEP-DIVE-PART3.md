# M18: Prisma Deep Dive - PART 3 (Basic CRUD Operations)

**Files Analyzed:**
- `services/user-service/src/repositories/user.repository.ts` (lines 36-148)
- `services/api-gateway/src/repositories/token.repository.ts` (lines 23-100)

**Level:** Foundation  
**Prerequisites:** M18-PART1 (Schema), M18-PART2 (Client & Config)  
**Time to Master:** 3-4 hours  
**Part:** 3 of 4 in M18 Foundations series

---

## 📖 SECTION 1: THEORY

### The CRUD Operations Spectrum

**Real-World Analogy:**  
Think of CRUD operations like **"basic conversations with your database"**:
- **CREATE** = "Hey database, remember this new user"
- **READ** = "Hey database, tell me about user #123"
- **UPDATE** = "Hey database, user #123 changed their email"
- **DELETE** = "Hey database, forget user #123"

Prisma makes these conversations type-safe and intuitive.

---

### Prisma's CRUD Methods

```
┌─────────────────────────────────────────────────────────┐
│  CREATE Operations                                      │
├─────────────────────────────────────────────────────────┤
│  • create()        → Insert single record              │
│  • createMany()    → Insert multiple records (bulk)    │
│  • upsert()        → Update if exists, create if not   │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  READ Operations                                        │
├─────────────────────────────────────────────────────────┤
│  • findUnique()    → Find by ID or unique field        │
│  • findFirst()     → Find first match (with filters)   │
│  • findMany()      → Find all matches (with filters)   │
│  • count()         → Count matching records            │
│  • aggregate()     → Calculate sum, avg, min, max      │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  UPDATE Operations                                      │
├─────────────────────────────────────────────────────────┤
│  • update()        → Update single record              │
│  • updateMany()    → Update multiple records (bulk)    │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  DELETE Operations                                      │
├─────────────────────────────────────────────────────────┤
│  • delete()        → Delete single record              │
│  • deleteMany()    → Delete multiple records (bulk)    │
└─────────────────────────────────────────────────────────┘
```

**This module covers:** The bolded operations above (80% of daily use).  
**Next module (M19):** Advanced operations (aggregations, transactions, raw queries).

---

### Performance Characteristics

| Operation | Speed | Use Case |
|-----------|-------|----------|
| `findUnique()` | ⚡ Fast (indexed) | Find by ID or unique email |
| `findFirst()` | 🐢 Slower (scan) | Find with complex filters |
| `findMany()` | 🐌 Slowest (full scan) | List all users |
| `count()` | ⚡ Fast (index-only) | Existence checks |
| `update()` | ⚡ Fast (indexed) | Update by ID |
| `updateMany()` | 🐢 Slower (scan) | Bulk updates with filters |
| `delete()` | ⚡ Fast (indexed) | Delete by ID |
| `deleteMany()` | 🐢 Slower (scan) | Bulk deletes with filters |

**Key Insight:** Operations using `@id` or `@unique` fields are fast (B-tree index lookup). Operations with arbitrary filters require table scans.

---

## 🔍 SECTION 2: LINE-BY-LINE CODE ANALYSIS

### CREATE Operations

#### Example 1: `prisma.user.create()` - Simple Insert

**File:** `user.repository.ts` (lines 36-50)

```typescript
async create(userData: CreateUserData): Promise<User | null> {
  const { email, passwordHash, firstName, lastName, role = 'customer' } = userData;

  const user = await this.prisma.user.create({
    data: {
      email,
      passwordHash,
      firstName,
      lastName,
      role
    }
  });

  return User.fromDatabase(this.toDatabaseRow(user));
}
```

**Line-by-Line Breakdown:**

**Line 36:** Method signature with typed input
```typescript
async create(userData: CreateUserData): Promise<User | null>
```
- **`CreateUserData`**: Interface ensures only valid fields passed
- **`Promise<User | null>`**: Returns domain model (not Prisma type)
- **Why `null`?** Allows graceful handling if creation somehow fails (though `create()` throws on error)

**Line 37:** Destructuring with default
```typescript
const { email, passwordHash, firstName, lastName, role = 'customer' } = userData;
```
- **`role = 'customer'`**: Default value (also in schema, but double-safe)
- **Why destructure?** Makes the `data` object below cleaner

**Lines 39-47:** Prisma create call
```typescript
const user = await this.prisma.user.create({
  data: {
    email,
    passwordHash,
    firstName,
    lastName,
    role
  }
});
```

**Anatomy of `create()`:**
```typescript
prisma.user.create({
  data: {           // ← Required: The data to insert
    field: value,   // ← Type-checked against User model
    ...
  },
  select: {         // ← Optional: Choose fields to return
    id: true,
    email: true
  },
  include: {        // ← Optional: Include relations
    posts: true
  }
})
```

**Generated SQL (approximately):**
```sql
INSERT INTO "users" (
  "email", 
  "password_hash", 
  "first_name", 
  "last_name", 
  "role",
  "created_at",      -- Auto-added (@default(now()))
  "updated_at"       -- Auto-added (@default(now()))
) 
VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
RETURNING *;

-- Parameters: ['test@example.com', 'hash123', 'John', 'Doe', 'customer']
```

**Key Points:**
1. **`RETURNING *`**: Prisma always returns the created record
2. **Auto-fields**: `id`, `createdAt`, `updatedAt` set automatically
3. **Parameterized**: Values passed as `$1, $2, ...` (SQL injection safe)

**What breaks if you pass invalid data?**
```typescript
// ❌ TypeScript compile error
await prisma.user.create({
  data: {
    email: "test@example.com",
    invalidField: "oops"  // Error: Object literal may only specify known properties
  }
});

// ❌ Runtime error (database constraint)
await prisma.user.create({
  data: {
    email: "duplicate@example.com"  // Error: P2002 Unique constraint failed on email
  }
});
```

**Line 49:** Transform to domain model
```typescript
return User.fromDatabase(this.toDatabaseRow(user));
```
- **`toDatabaseRow()`**: Convert Prisma type (camelCase) → Database row (snake_case)
- **`User.fromDatabase()`**: Domain model factory (adds business logic)
- **Why transform?** Keeps domain layer independent of Prisma (easier to swap ORMs later)

---

#### Example 2: `prisma.refreshToken.create()` - With Timestamp

**File:** `token.repository.ts` (lines 23-32)

```typescript
async createRefreshToken(userId: number, tokenHash: string, expiresAt: Date): Promise<RefreshToken | null> {
  const token = await this.prisma.refreshToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt
    }
  });

  return RefreshToken.fromDatabase(this.toDatabaseRow(token));
}
```

**Key Difference:** `expiresAt: Date` parameter
- **Client provides:** Application calculates expiry (e.g., 7 days from now)
- **Database stores:** As `TIMESTAMP` column
- **Prisma handles:** JavaScript `Date` ↔ PostgreSQL `TIMESTAMP` conversion

**Example Usage:**
```typescript
const expiresAt = new Date();
expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now

await tokenRepo.createRefreshToken(
  userId: 123,
  tokenHash: "abc123",
  expiresAt  // ← Prisma converts to TIMESTAMP
);
```

**Generated SQL:**
```sql
INSERT INTO "refresh_tokens" ("user_id", "token_hash", "expires_at", "created_at")
VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
RETURNING *;

-- Parameters: [123, 'abc123', '2026-08-19T12:00:00.000Z']
```

---

### READ Operations

#### Example 3: `prisma.user.findUnique()` - Find by ID

**File:** `user.repository.ts` (lines 53-59)

```typescript
async findById(id: number): Promise<User | null> {
  const user = await this.prisma.user.findUnique({
    where: { id }
  });

  return user ? User.fromDatabase(this.toDatabaseRow(user)) : null;
}
```

**Anatomy of `findUnique()`:**
```typescript
prisma.user.findUnique({
  where: {
    id: 123,           // ← Must be @id or @unique field
    // OR
    email: "test@example.com"  // ← @unique field works too
  }
})
```

**Key Constraint:** `where` must use `@id` or `@unique` field
```typescript
// ✅ VALID (id is @id)
await prisma.user.findUnique({ where: { id: 1 } });

// ✅ VALID (email is @unique)
await prisma.user.findUnique({ where: { email: "test@example.com" } });

// ❌ INVALID (firstName is not @unique)
await prisma.user.findUnique({ where: { firstName: "John" } });
// TypeScript error: Type '{ firstName: string }' is not assignable to type 'UserWhereUniqueInput'
```

**Generated SQL:**
```sql
SELECT * FROM "users" WHERE "id" = $1 LIMIT 1;
-- Parameters: [123]
```

**Why `LIMIT 1`?** Prisma guarantees single result (unique constraint).

**Return Type:**
- **Found:** `User` object
- **Not found:** `null` (NOT an error)

**Performance:** ⚡ **Extremely fast** (B-tree index on `@id` field)
- 1 million users: ~0.1ms query time
- 100 million users: Still ~0.1ms (logarithmic lookup)

---

#### Example 4: `prisma.user.findUnique()` - Find by Email

**File:** `user.repository.ts` (lines 71-77)

```typescript
async findByEmail(email: string): Promise<User | null> {
  const user = await this.prisma.user.findUnique({
    where: { email }
  });

  return user ? User.fromDatabase(this.toDatabaseRow(user)) : null;
}
```

**Same as `findById`, but using `@unique email` field.**

**Generated SQL:**
```sql
SELECT * FROM "users" WHERE "email" = $1 LIMIT 1;
-- Uses idx_users_email index (see schema @@index)
```

**Interview Question Preview:** "Why is `findUnique({ where: { email } })` faster than `findFirst({ where: { email } })`?"

**Answer:**
- **`findUnique`**: Prisma knows email is unique → Uses unique index → Single lookup
- **`findFirst`**: Prisma doesn't assume uniqueness → Full table scan → Slower

Always use `findUnique()` for `@unique` fields!

---

#### Example 5: `prisma.user.findFirst()` - Find with Multiple Filters

**File:** `user.repository.ts` (lines 89-98)

```typescript
async findActiveById(id: number): Promise<User | null> {
  const user = await this.prisma.user.findFirst({
    where: {
      id,
      isActive: true
    }
  });

  return user ? User.fromDatabase(this.toDatabaseRow(user)) : null;
}
```

**`findFirst()` vs `findUnique()`:**

| Feature | `findUnique()` | `findFirst()` |
|---------|---------------|---------------|
| Where clause | Only `@id` or `@unique` fields | Any field combination |
| Performance | ⚡ Fast (index) | 🐢 Slower (scan) |
| Return | Single result or null | First match or null |
| Use case | Find by ID/email | Complex filters |

**Generated SQL:**
```sql
SELECT * FROM "users" 
WHERE "id" = $1 AND "is_active" = $2 
LIMIT 1;
-- Parameters: [123, true]
```

**Why `LIMIT 1`?** `findFirst()` returns only the first matching record.

**Common Use Case:** Soft delete checks
```typescript
// Find user only if active (not soft-deleted)
const activeUser = await prisma.user.findFirst({
  where: {
    id: userId,
    isActive: true  // ← Soft delete filter
  }
});

if (!activeUser) {
  throw new Error('User not found or deactivated');
}
```

---

#### Example 6: `prisma.refreshToken.findMany()` - List with Filters

**File:** `token.repository.ts` (lines 48-58)

```typescript
async findUserTokens(userId: number): Promise<RefreshToken[]> {
  const tokens = await this.prisma.refreshToken.findMany({
    where: {
      userId,
      expiresAt: { gt: new Date() }
    },
    orderBy: { createdAt: 'desc' }
  });

  return RefreshToken.fromDatabaseArray(tokens.map(t => this.toDatabaseRow(t)));
}
```

**Anatomy of `findMany()`:**
```typescript
prisma.model.findMany({
  where: {              // ← Optional: Filter conditions
    field: value,
    field2: { gt: 10 }
  },
  orderBy: {            // ← Optional: Sort order
    field: 'asc' | 'desc'
  },
  take: 10,             // ← Optional: Limit results (LIMIT)
  skip: 20,             // ← Optional: Offset (OFFSET)
  select: {             // ← Optional: Choose fields
    id: true,
    email: true
  }
})
```

**Line-by-Line:**

**Lines 49-52:** Where clause with comparison operator
```typescript
where: {
  userId,                      // ← Exact match (userId = ?)
  expiresAt: { gt: new Date() }  // ← Greater than (expiresAt > NOW())
}
```

**Comparison Operators:**
```typescript
// Numeric / Date comparisons
{ gt: value }     // Greater than (>)
{ gte: value }    // Greater than or equal (>=)
{ lt: value }     // Less than (<)
{ lte: value }    // Less than or equal (<=)

// String comparisons
{ contains: "text" }     // LIKE '%text%'
{ startsWith: "John" }   // LIKE 'John%'
{ endsWith: ".com" }     // LIKE '%.com'

// Array / Enum
{ in: [1, 2, 3] }        // IN (1, 2, 3)
{ notIn: [1, 2] }        // NOT IN (1, 2)
```

**Line 53:** Order by
```typescript
orderBy: { createdAt: 'desc' }
```
- **`'desc'`**: Descending (newest first)
- **`'asc'`**: Ascending (oldest first)

**Generated SQL:**
```sql
SELECT * FROM "refresh_tokens"
WHERE "user_id" = $1 AND "expires_at" > $2
ORDER BY "created_at" DESC;
-- Parameters: [123, '2026-08-12T12:00:00.000Z']
```

**Return Type:** **Array** (even if 0 results)
```typescript
// 0 results → []
// 1 result → [token]
// N results → [token1, token2, ...]
```

---

#### Example 7: `prisma.user.count()` - Existence Check

**File:** `user.repository.ts` (lines 101-106)

```typescript
async existsByEmail(email: string): Promise<boolean> {
  const count = await this.prisma.user.count({
    where: { email }
  });
  return count > 0;
}
```

**Why `count()` instead of `findUnique()`?**

❌ **Slower approach:**
```typescript
const user = await prisma.user.findUnique({ where: { email } });
return user !== null;
// Fetches entire user object (id, email, passwordHash, firstName, ...)
// Wastes bandwidth if you only need existence
```

✅ **Faster approach:**
```typescript
const count = await prisma.user.count({ where: { email } });
return count > 0;
// Only counts, doesn't fetch data
// Uses index-only scan (faster)
```

**Generated SQL:**
```sql
SELECT COUNT(*) FROM "users" WHERE "email" = $1;
-- Returns: 0 (doesn't exist) or 1 (exists)
```

**Performance Benefit:** Count uses **index-only scan** (doesn't touch table data).

---

#### Example 8: `prisma.user.count()` - With Exclusion

**File:** `user.repository.ts` (lines 109-117)

```typescript
async existsByEmailExcludingUser(email: string, userId: number): Promise<boolean> {
  const count = await this.prisma.user.count({
    where: {
      email,
      id: { not: userId }
    }
  });
  return count > 0;
}
```

**Use Case:** Email uniqueness check during user update
```typescript
// User is updating their email
const newEmail = "newemail@example.com";
const currentUserId = 123;

// Check if another user has this email
const emailTaken = await repo.existsByEmailExcludingUser(newEmail, currentUserId);

if (emailTaken) {
  throw new Error('Email already in use by another user');
}

// Safe to update
await repo.update(currentUserId, { email: newEmail });
```

**Operator:** `{ not: userId }`
- **Syntax:** `{ not: value }` → `field != value`
- **Also works:** `{ not: { in: [1, 2, 3] } }` → `field NOT IN (1, 2, 3)`

**Generated SQL:**
```sql
SELECT COUNT(*) FROM "users" 
WHERE "email" = $1 AND "id" != $2;
-- Parameters: ['newemail@example.com', 123]
```

---

### UPDATE Operations

#### Example 9: `prisma.user.update()` - Partial Update

**File:** `user.repository.ts` (lines 120-136)

```typescript
async update(id: number, updates: UpdateUserData): Promise<User | null> {
  if (Object.keys(updates).length === 0) {
    return this.findById(id);
  }

  const user = await this.prisma.user.update({
    where: { id },
    data: {
      ...(updates.firstName !== undefined && { firstName: updates.firstName }),
      ...(updates.lastName !== undefined && { lastName: updates.lastName }),
      ...(updates.email !== undefined && { email: updates.email }),
      updatedAt: new Date()
    }
  });

  return User.fromDatabase(this.toDatabaseRow(user));
}
```

**Line 121-123:** Guard clause
```typescript
if (Object.keys(updates).length === 0) {
  return this.findById(id);
}
```
- **Why?** Calling `update()` with empty data object throws error
- **Solution:** Return existing user if nothing to update

**Lines 128-131:** Conditional spread
```typescript
data: {
  ...(updates.firstName !== undefined && { firstName: updates.firstName }),
  ...(updates.lastName !== undefined && { lastName: updates.lastName }),
  ...(updates.email !== undefined && { email: updates.email }),
  updatedAt: new Date()
}
```

**Pattern Explained:**
```typescript
// If updates.firstName is defined:
...(true && { firstName: "John" })
// Spreads: firstName: "John"

// If updates.firstName is undefined:
...(false && { firstName: undefined })
// Spreads: {} (nothing)
```

**Result:** Only defined fields are updated.

**Example:**
```typescript
await repo.update(123, { firstName: "John" });
// SQL: UPDATE users SET first_name = 'John', updated_at = NOW() WHERE id = 123

await repo.update(123, { email: "new@example.com" });
// SQL: UPDATE users SET email = 'new@example.com', updated_at = NOW() WHERE id = 123
```

**Line 131:** Manual `updatedAt`
```typescript
updatedAt: new Date()
```
- **Why manual?** You're using `update()` not `updateMany()`
- **`@updatedAt` behavior:** Only auto-updates in `updateMany()` (Prisma quirk)
- **Best practice:** Always set explicitly in `update()`

---

#### Example 10: `prisma.user.updateMany()` - Bulk Update

**File:** `user.repository.ts` (lines 139-148)

```typescript
async updatePassword(id: number, passwordHash: string): Promise<boolean> {
  const result = await this.prisma.user.updateMany({
    where: { id },
    data: {
      passwordHash,
      updatedAt: new Date()
    }
  });
  return result.count > 0;
}
```

**`updateMany()` vs `update()`:**

| Feature | `update()` | `updateMany()` |
|---------|-----------|----------------|
| Returns | Full record | Count only |
| Error if not found | ✅ Throws | ❌ Returns count: 0 |
| @updatedAt | ⚠️ Manual | ✅ Auto (but still set manually to be safe) |
| Where clause | `@id` or `@unique` only | Any field |

**Why use `updateMany()` here?**
- **Simpler return:** Boolean (success/fail) instead of full user
- **No exception:** Returns `count: 0` if user not found (graceful)

**Generated SQL:**
```sql
UPDATE "users" 
SET "password_hash" = $1, "updated_at" = $2
WHERE "id" = $3;
-- Returns affected row count: 0 or 1
```

---

### DELETE Operations

#### Example 11: `prisma.refreshToken.deleteMany()` - Delete with Filter

**File:** `token.repository.ts` (lines 61-66)

```typescript
async deleteRefreshToken(tokenHash: string): Promise<boolean> {
  const result = await this.prisma.refreshToken.deleteMany({
    where: { tokenHash }
  });
  return result.count > 0;
}
```

**`delete()` vs `deleteMany()`:**

| Feature | `delete()` | `deleteMany()` |
|---------|-----------|----------------|
| Where clause | `@id` or `@unique` only | Any field |
| Error if not found | ✅ Throws | ❌ Returns count: 0 |
| Return | Full record | Count only |
| Use case | Delete by ID | Delete with filters |

**Why `deleteMany()` with non-unique field?**
- **`tokenHash` is not `@unique`** in schema (could have been though)
- **`delete()` won't work** on non-unique fields
- **`deleteMany()` works** on any field

**Generated SQL:**
```sql
DELETE FROM "refresh_tokens" WHERE "token_hash" = $1;
-- Returns affected row count
```

---

#### Example 12: `prisma.refreshToken.deleteMany()` - Bulk Delete

**File:** `token.repository.ts` (lines 77-82)

```typescript
async cleanupExpiredTokens(): Promise<number> {
  const result = await this.prisma.refreshToken.deleteMany({
    where: { expiresAt: { lte: new Date() } }
  });
  return result.count;
}
```

**Use Case:** Cron job cleanup
```typescript
// Every hour:
const deleted = await tokenRepo.cleanupExpiredTokens();
logger.info(`Deleted ${deleted} expired tokens`);
```

**Operator:** `{ lte: new Date() }`
- **`lte`**: Less than or equal
- **`new Date()`**: Current timestamp
- **Logic:** Delete all tokens where `expiresAt <= NOW()`

**Generated SQL:**
```sql
DELETE FROM "refresh_tokens" WHERE "expires_at" <= $1;
-- Parameters: ['2026-08-12T12:00:00.000Z']
-- Could delete 0, 1, or 1000+ rows
```

---

## 🏗️ SECTION 3: ARCHITECTURE DIAGRAMS

### CRUD Method Decision Tree

```
Need to work with database?
         │
         ├─ Single record?
         │  │
         │  ├─ By ID/unique field?
         │  │  │
         │  │  ├─ CREATE → prisma.model.create()
         │  │  ├─ READ → prisma.model.findUnique()
         │  │  ├─ UPDATE → prisma.model.update()
         │  │  └─ DELETE → prisma.model.delete()
         │  │
         │  └─ By other fields?
         │     │
         │     ├─ READ → prisma.model.findFirst()
         │     ├─ UPDATE → prisma.model.updateMany() (returns count)
         │     └─ DELETE → prisma.model.deleteMany() (returns count)
         │
         └─ Multiple records?
            │
            ├─ CREATE → prisma.model.createMany()
            ├─ READ → prisma.model.findMany()
            ├─ UPDATE → prisma.model.updateMany()
            └─ DELETE → prisma.model.deleteMany()
```

### Query Performance Comparison

```
Operation: Find user by ID

┌──────────────────────────────────────┐
│  findUnique({ where: { id: 1 } })   │
├──────────────────────────────────────┤
│  Uses: Primary key index            │
│  Complexity: O(log n)                │
│  Time: ~0.1ms (1M records)          │
└──────────────────────────────────────┘
                 ⚡ FAST

Operation: Find user by first name

┌──────────────────────────────────────┐
│  findFirst({ where: { firstName } }) │
├──────────────────────────────────────┤
│  Uses: Full table scan               │
│  Complexity: O(n)                    │
│  Time: ~500ms (1M records)          │
└──────────────────────────────────────┘
                 🐢 SLOW

Solution: Add index in schema
@@index([firstName])
```

---

## 🎯 SECTION 4: PRACTICAL EXAMPLES & INTERVIEW PREP

### Example: Complete User Registration Flow

```typescript
// 1. Check if email already exists
const exists = await userRepo.existsByEmail(email);
if (exists) {
  throw new Error('Email already registered');
}

// 2. Hash password
const passwordHash = await bcrypt.hash(password, 10);

// 3. Create user
const user = await userRepo.create({
  email,
  passwordHash,
  firstName,
  lastName
});

// 4. Create refresh token
const expiresAt = new Date();
expiresAt.setDate(expiresAt.getDate() + 7);

await tokenRepo.createRefreshToken(
  user.id,
  tokenHash,
  expiresAt
);

return user;
```

---

### Common Patterns

**Pattern 1: Soft Delete**
```typescript
// Don't use delete(), use update()
await prisma.user.update({
  where: { id: userId },
  data: { isActive: false }
});

// Query only active users
await prisma.user.findMany({
  where: { isActive: true }
});
```

**Pattern 2: Pagination**
```typescript
const page = 2;
const pageSize = 20;

const users = await prisma.user.findMany({
  skip: (page - 1) * pageSize,  // Skip first 20
  take: pageSize,                // Take next 20
  orderBy: { createdAt: 'desc' }
});
```

**Pattern 3: Search**
```typescript
const users = await prisma.user.findMany({
  where: {
    email: { contains: searchTerm }  // LIKE '%searchTerm%'
  }
});
```

---

## 📝 INTERVIEW QUESTIONS

### Q1: When should you use `findUnique()` vs `findFirst()`?

**Answer:**
- **`findUnique()`**: When searching by `@id` or `@unique` field (id, email)
  - ✅ Faster (uses unique index)
  - ✅ Type-safe (TypeScript enforces unique fields only)
  
- **`findFirst()`**: When searching by non-unique field or multiple conditions
  - ⚠️ Slower (table scan)
  - ✅ More flexible (any field combination)

**Example:**
```typescript
// ✅ GOOD - uses unique index
await prisma.user.findUnique({ where: { email } });

// ❌ BAD - can't use findUnique on non-unique field
await prisma.user.findUnique({ where: { firstName } }); // TypeScript error

// ✅ GOOD - findFirst allows it
await prisma.user.findFirst({ where: { firstName } });
```

---

### Q2: What's returned when `update()` doesn't find a record?

**Answer:**
**`update()` throws `P2025` error:**
```typescript
try {
  await prisma.user.update({
    where: { id: 999999 },  // Doesn't exist
    data: { firstName: "John" }
  });
} catch (error) {
  // PrismaClientKnownRequestError: P2025
  // "Record to update not found"
}
```

**`updateMany()` returns `count: 0`:**
```typescript
const result = await prisma.user.updateMany({
  where: { id: 999999 },
  data: { firstName: "John" }
});
console.log(result.count); // 0 (no error thrown)
```

---

### Q3: How do you update only changed fields?

**Answer:**
Use conditional spread operator:
```typescript
const updates = { firstName: "John" }; // Only firstName provided

await prisma.user.update({
  where: { id },
  data: {
    ...(updates.firstName !== undefined && { firstName: updates.firstName }),
    ...(updates.lastName !== undefined && { lastName: updates.lastName }),
    updatedAt: new Date()
  }
});

// SQL: UPDATE users SET first_name = 'John', updated_at = NOW()
//      (lastName not in UPDATE statement)
```

**Without conditional spread (updates ALL fields):**
```typescript
data: {
  firstName: updates.firstName,  // "John"
  lastName: updates.lastName,    // undefined → sets to NULL!
}
// SQL: UPDATE users SET first_name = 'John', last_name = NULL
```

---

### Q4: What's the difference between `delete()` and `deleteMany()`?

**Answer:**

| `delete()` | `deleteMany()` |
|-----------|----------------|
| Where: `@id` or `@unique` only | Where: Any field |
| Returns: Full deleted record | Returns: `{ count: number }` |
| Error: Throws if not found | Error: Returns `count: 0` |
| Use: Delete by ID | Use: Bulk delete with filters |

**Example:**
```typescript
// delete() - single by ID
const deleted = await prisma.user.delete({ where: { id: 1 } });
console.log(deleted); // User { id: 1, email: "...", ... }

// deleteMany() - bulk with filter
const result = await prisma.user.deleteMany({
  where: { isActive: false }
});
console.log(result.count); // 42 (deleted 42 inactive users)
```

---

## ✅ PART 3 COMPLETION CHECKLIST

- ✅ All basic CRUD operations covered (create, find, update, delete, count)
- ✅ Line-by-line analysis of actual project code
- ✅ `findUnique()` vs `findFirst()` explained
- ✅ `update()` vs `updateMany()` differences shown
- ✅ Comparison operators covered (gt, lte, contains, etc.)
- ✅ Performance characteristics explained
- ✅ Common patterns provided (soft delete, pagination, search)
- ✅ 4 interview questions with detailed answers

---

**Next Module:** M18-PART4 - Repository Pattern & Type Safety  
**Progress:** 3 out of 4 parts in M18 Foundations completed

---

**Last Updated:** August 12, 2026  
**Author:** Claude Code Assistant  
**Review Status:** ✅ Ready for Production Use
