# M19: Prisma Advanced Queries - PART 1 (Filtering & Sorting)

**Files Analyzed:**
- `services/user-service/src/repositories/user.repository.ts` (complex filters)
- `services/api-gateway/src/repositories/token.repository.ts` (date filtering, sorting)

**Level:** Intermediate  
**Prerequisites:** M18 (all 4 parts - Foundations complete)  
**Time to Master:** 3-4 hours  
**Part:** 1 of 4 in M19 Advanced Queries series

---

## 📖 SECTION 1: THEORY

### Beyond Basic CRUD: Complex Filters

**Real-World Analogy:**  
Basic CRUD is like asking "Give me user #123". Advanced filtering is like asking **"Give me all active VIP users who signed up in the last 30 days, ordered by spending, excluding anyone from the banned list"**. This requires combining multiple conditions with logic operators.

```
Basic:     where: { id: 123 }
Advanced:  where: {
             AND: [
               { isActive: true },
               { role: 'vip' },
               { createdAt: { gte: thirtyDaysAgo } },
               { id: { notIn: bannedIds } }
             ]
           }
```

---

### Filter Operator Categories

```
┌─────────────────────────────────────────────────────┐
│  EQUALITY OPERATORS                                 │
├─────────────────────────────────────────────────────┤
│  • equals          → field = value                  │
│  • not             → field != value                 │
│  • in              → field IN (...)                 │
│  • notIn           → field NOT IN (...)             │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  COMPARISON OPERATORS (numbers, dates)              │
├─────────────────────────────────────────────────────┤
│  • gt              → field > value                  │
│  • gte             → field >= value                 │
│  • lt              → field < value                  │
│  • lte             → field <= value                 │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  STRING OPERATORS                                   │
├─────────────────────────────────────────────────────┤
│  • contains        → field LIKE '%value%'           │
│  • startsWith      → field LIKE 'value%'            │
│  • endsWith        → field LIKE '%value'            │
│  • mode            → 'insensitive' for ILIKE        │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  NULL OPERATORS                                     │
├─────────────────────────────────────────────────────┤
│  • is: null        → field IS NULL                  │
│  • isNot: null     → field IS NOT NULL              │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  LOGICAL OPERATORS                                  │
├─────────────────────────────────────────────────────┤
│  • AND             → All conditions must be true    │
│  • OR              → At least one must be true      │
│  • NOT             → Condition must be false        │
└─────────────────────────────────────────────────────┘
```

---

### Sorting & Pagination Strategies

**Two Approaches:**

**1. Offset-Based Pagination** (Simple but slow at high offsets)
```typescript
// Page 1: skip 0, take 20
// Page 2: skip 20, take 20
// Page 100: skip 1980, take 20  ← Slow! Database scans 1980 rows
```

**2. Cursor-Based Pagination** (Fast, works at any offset)
```typescript
// Page 1: cursor: undefined, take 20
// Page 2: cursor: lastUserId, take 20  ← Database starts from cursor
// Page 100: cursor: lastUserId, take 20  ← Still fast!
```

**When to use each:**
- **Offset**: Admin panels, internal tools (small datasets)
- **Cursor**: Public APIs, infinite scroll, mobile apps (large datasets)

---

## 🔍 SECTION 2: LINE-BY-LINE CODE ANALYSIS

### Comparison Operators: Date Filtering

**File:** `token.repository.ts` (lines 36-44)

```typescript
async findRefreshToken(tokenHash: string): Promise<RefreshToken | null> {
  const token = await this.prisma.refreshToken.findFirst({
    where: {
      tokenHash,
      expiresAt: { gt: new Date() }
    }
  });

  return token ? RefreshToken.fromDatabase(this.toDatabaseRow(token)) : null;
}
```

**Line 39:** Greater than operator
```typescript
expiresAt: { gt: new Date() }
```

**Breakdown:**
- **`gt`**: Greater than (>)
- **`new Date()`**: Current timestamp
- **Logic**: Only return tokens where `expiresAt > NOW()`
- **Use case**: Filter out expired tokens

**All Comparison Operators:**
```typescript
// Numeric/Date comparisons
{ gt: 100 }      // Greater than: field > 100
{ gte: 100 }     // Greater or equal: field >= 100
{ lt: 100 }      // Less than: field < 100
{ lte: 100 }     // Less or equal: field <= 100

// Examples
expiresAt: { gt: new Date() }                    // Not expired
createdAt: { gte: new Date('2024-01-01') }       // Created since Jan 2024
age: { lt: 18 }                                  // Minors only
totalSpent: { lte: 1000 }                        // Low spenders
```

**Generated SQL:**
```sql
SELECT * FROM "refresh_tokens"
WHERE "token_hash" = $1 
  AND "expires_at" > $2;
-- Parameters: ['abc123', '2026-08-12T12:00:00.000Z']
```

---

### Logical Operators: AND (Implicit)

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

**Lines 91-93:** Implicit AND
```typescript
where: {
  id,              // ← Condition 1
  isActive: true   // ← Condition 2
}
// Both must be true (implicit AND)
```

**Implicit AND Rule:**
When you have multiple fields at the same level, Prisma combines them with AND:

```typescript
// These are equivalent:
where: { id: 1, isActive: true }

where: {
  AND: [
    { id: 1 },
    { isActive: true }
  ]
}
```

**Generated SQL:**
```sql
SELECT * FROM "users"
WHERE "id" = $1 AND "is_active" = $2;
-- Parameters: [123, true]
```

---

### Logical Operators: NOT

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

**Line 112:** NOT operator
```typescript
id: { not: userId }
```

**Purpose:** Exclude specific user from email uniqueness check

**Real-World Use Case:**
```typescript
// User is updating their email
// Check if another user has this email

// ❌ Without NOT: Finds current user (always returns true)
const exists = await prisma.user.count({
  where: { email: newEmail }
});
// Returns 1 even if newEmail is current user's email

// ✅ With NOT: Excludes current user
const exists = await prisma.user.count({
  where: {
    email: newEmail,
    id: { not: currentUserId }  // "Other users with this email"
  }
});
// Returns 0 if no other user has this email
```

**NOT with Complex Conditions:**
```typescript
// Exclude multiple IDs
where: {
  id: { not: { in: [1, 2, 3] } }
}
// SQL: WHERE id NOT IN (1, 2, 3)

// Exclude a range
where: {
  age: { not: { gte: 18, lte: 65 } }
}
// SQL: WHERE NOT (age >= 18 AND age <= 65)
// Finds minors (<18) or seniors (>65)
```

---

### Logical Operators: OR

**Example (not in your current code, but common pattern):**

```typescript
// Find users by email OR username
async findByEmailOrUsername(search: string): Promise<User[]> {
  const users = await this.prisma.user.findMany({
    where: {
      OR: [
        { email: search },
        { username: search }
      ]
    }
  });

  return users.map(u => User.fromDatabase(this.toDatabaseRow(u)));
}
```

**Anatomy:**
```typescript
where: {
  OR: [
    { email: "test@example.com" },
    { username: "testuser" }
  ]
}
// At least ONE condition must be true
```

**Generated SQL:**
```sql
SELECT * FROM "users"
WHERE "email" = $1 OR "username" = $2;
-- Parameters: ['test@example.com', 'testuser']
```

**Complex OR Example:**
```typescript
// Find VIP users OR high spenders
where: {
  OR: [
    { role: 'vip' },
    { totalSpent: { gte: 10000 } }
  ]
}
// SQL: WHERE role = 'vip' OR total_spent >= 10000
```

---

### Combining AND + OR

**Example:** Find users matching complex business logic

```typescript
// Find active customers who either:
// 1. Have verified email, OR
// 2. Signed up in last 7 days (grace period)

where: {
  AND: [
    { isActive: true },        // ← Must be active
    { role: 'customer' },      // ← Must be customer
    {
      OR: [                    // ← At least one:
        { emailVerified: true },
        { createdAt: { gte: sevenDaysAgo } }
      ]
    }
  ]
}
```

**Logic Tree:**
```
            AND
           / | \
          /  |  \
    isActive  role  OR
                   / \
                  /   \
        emailVerified  createdAt
```

**Generated SQL:**
```sql
SELECT * FROM "users"
WHERE "is_active" = true
  AND "role" = 'customer'
  AND (
    "email_verified" = true 
    OR "created_at" >= '2026-08-05T00:00:00.000Z'
  );
```

---

### String Operators: contains, startsWith, endsWith

**Example (common search pattern):**

```typescript
// Search users by name
async searchUsersByName(query: string): Promise<User[]> {
  const users = await this.prisma.user.findMany({
    where: {
      OR: [
        { firstName: { contains: query, mode: 'insensitive' } },
        { lastName: { contains: query, mode: 'insensitive' } },
        { email: { contains: query, mode: 'insensitive' } }
      ]
    },
    take: 20
  });

  return users.map(u => User.fromDatabase(this.toDatabaseRow(u)));
}
```

**String Operators Explained:**

**1. `contains` - Partial match**
```typescript
{ firstName: { contains: "John" } }
// SQL: WHERE first_name LIKE '%John%'
// Matches: "John", "Johnny", "John Doe", "Johnathan"
```

**2. `startsWith` - Prefix match**
```typescript
{ email: { startsWith: "admin" } }
// SQL: WHERE email LIKE 'admin%'
// Matches: "admin@example.com", "admin1@company.com"
```

**3. `endsWith` - Suffix match**
```typescript
{ email: { endsWith: ".edu" } }
// SQL: WHERE email LIKE '%.edu'
// Matches: "student@university.edu", "prof@college.edu"
```

**4. `mode: 'insensitive'` - Case-insensitive**
```typescript
{ firstName: { contains: "john", mode: 'insensitive' } }
// PostgreSQL: WHERE first_name ILIKE '%john%'
// MySQL: WHERE first_name LIKE '%john%' COLLATE utf8_general_ci
// Matches: "John", "JOHN", "john", "JoHn"
```

**Performance Warning:**
```typescript
// ⚠️ SLOW - Full table scan
where: { email: { contains: "example" } }

// ✅ FAST - Uses index (if you have one)
where: { email: { startsWith: "admin" } }

// ✅ FASTER - Exact match uses unique index
where: { email: "admin@example.com" }
```

---

### Array Operators: in, notIn

**File:** `user.repository.ts` (line 112 shows `not` pattern)

**Example (bulk operations):**

```typescript
// Find users by multiple IDs
async findByIds(ids: number[]): Promise<User[]> {
  const users = await this.prisma.user.findMany({
    where: {
      id: { in: ids }
    }
  });

  return users.map(u => User.fromDatabase(this.toDatabaseRow(u)));
}

// Exclude banned users
async findActiveExcludingBanned(bannedIds: number[]): Promise<User[]> {
  return this.prisma.user.findMany({
    where: {
      isActive: true,
      id: { notIn: bannedIds }
    }
  });
}
```

**`in` Operator:**
```typescript
where: {
  id: { in: [1, 2, 3, 4, 5] }
}
// SQL: WHERE id IN (1, 2, 3, 4, 5)
```

**`notIn` Operator:**
```typescript
where: {
  role: { notIn: ['banned', 'suspended'] }
}
// SQL: WHERE role NOT IN ('banned', 'suspended')
```

**Empty Array Handling:**
```typescript
// ⚠️ Empty array
where: { id: { in: [] } }
// Returns: [] (no results, which is correct)

where: { id: { notIn: [] } }
// Returns: All records (no exclusions)
```

---

### Null Handling: is, isNot

**Example (optional fields):**

```typescript
// Find users who haven't provided names
async findUsersWithoutNames(): Promise<User[]> {
  return this.prisma.user.findMany({
    where: {
      OR: [
        { firstName: { is: null } },
        { lastName: { is: null } }
      ]
    }
  });
}

// Find users with complete profiles
async findUsersWithCompleteProfiles(): Promise<User[]> {
  return this.prisma.user.findMany({
    where: {
      AND: [
        { firstName: { isNot: null } },
        { lastName: { isNot: null } },
        { emailVerified: true }
      ]
    }
  });
}
```

**Operators:**
```typescript
// IS NULL
{ firstName: { is: null } }
// SQL: WHERE first_name IS NULL

// IS NOT NULL
{ firstName: { isNot: null } }
// SQL: WHERE first_name IS NOT NULL

// ❌ DON'T USE equals/not with null
{ firstName: null }           // TypeScript error
{ firstName: { equals: null } }  // Works but non-idiomatic
```

---

### Sorting: orderBy

**File:** `token.repository.ts` (line 54)

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

**Line 54:** Simple sort
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
```

---

**Multi-Field Sorting:**
```typescript
// Sort by role (ascending), then by createdAt (descending)
orderBy: [
  { role: 'asc' },
  { createdAt: 'desc' }
]
// SQL: ORDER BY role ASC, created_at DESC
// Result: admins first (alphabetically), then customers, then vendors
//         Within each role, newest first
```

**Null Handling in Sorts:**
```typescript
orderBy: { firstName: { sort: 'asc', nulls: 'last' } }
// SQL (PostgreSQL): ORDER BY first_name ASC NULLS LAST
// Users with names come first, users without names at end
```

---

### Pagination: Offset-Based

**Pattern 1: take + skip**

```typescript
// Get page 3 (20 users per page)
const page = 3;
const pageSize = 20;

const users = await this.prisma.user.findMany({
  where: { isActive: true },
  orderBy: { createdAt: 'desc' },
  skip: (page - 1) * pageSize,  // Skip first 40
  take: pageSize                 // Take next 20
});

// Page 1: skip 0, take 20   → Records 1-20
// Page 2: skip 20, take 20  → Records 21-40
// Page 3: skip 40, take 20  → Records 41-60
```

**With Total Count (for pagination UI):**
```typescript
const [users, total] = await Promise.all([
  prisma.user.findMany({
    skip: (page - 1) * pageSize,
    take: pageSize,
    orderBy: { createdAt: 'desc' }
  }),
  prisma.user.count({ where: { isActive: true } })
]);

const totalPages = Math.ceil(total / pageSize);
const hasNextPage = page < totalPages;
const hasPrevPage = page > 1;

return {
  data: users,
  pagination: {
    page,
    pageSize,
    total,
    totalPages,
    hasNextPage,
    hasPrevPage
  }
};
```

**Performance Caveat:**
```
Page 1 (skip 0):     ⚡ 0.1ms
Page 10 (skip 180):  ⚡ 0.2ms
Page 100 (skip 1980): 🐢 50ms  ← Database scans 1980 rows
Page 1000 (skip 19980): 🐌 500ms ← Very slow!
```

---

### Pagination: Cursor-Based (Better Performance)

**Pattern 2: cursor + take**

```typescript
// First page
const firstPage = await prisma.user.findMany({
  take: 20,
  orderBy: { id: 'asc' },
  where: { isActive: true }
});

const lastUser = firstPage[firstPage.length - 1];
const cursor = lastUser.id;

// Second page (pass cursor)
const secondPage = await prisma.user.findMany({
  take: 20,
  skip: 1,  // Skip the cursor itself
  cursor: { id: cursor },
  orderBy: { id: 'asc' },
  where: { isActive: true }
});
```

**How Cursor Works:**
```
Database records: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

First page (take 3):
  Result: [1, 2, 3]
  Cursor: 3

Second page (cursor: 3, skip: 1, take: 3):
  Start from: id = 3
  Skip: 1 (skip record 3 itself)
  Take: 3
  Result: [4, 5, 6]
  Cursor: 6

Third page (cursor: 6, skip: 1, take: 3):
  Result: [7, 8, 9]
```

**Benefits:**
- ✅ **Constant performance**: O(1) regardless of page number
- ✅ **Stable**: New records don't shift pages
- ✅ **Works with infinite scroll**

**Drawbacks:**
- ❌ Can't jump to arbitrary page (no "Go to page 50")
- ❌ Requires sequential navigation

---

## 🏗️ SECTION 3: ARCHITECTURE DIAGRAMS

### Filter Operator Precedence

```
┌─────────────────────────────────────┐
│  Implicit AND (highest precedence) │
│  { id: 1, isActive: true }          │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Explicit AND                       │
│  { AND: [...] }                     │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  OR                                 │
│  { OR: [...] }                      │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  NOT (lowest precedence)            │
│  { NOT: {...} }                     │
└─────────────────────────────────────┘
```

### Offset vs Cursor Pagination

```
OFFSET-BASED PAGINATION
┌─────────────────────────────────────────┐
│ Page 1: skip 0, take 20                 │
│ ┌─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─│
│ │1│2│3│4│5│6│7│8│9│0│...              │
│ └─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─│
│ ⚡ Fast (0.1ms)                         │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ Page 100: skip 1980, take 20            │
│ Database must scan 1980 rows first...   │
│ ┌─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─│
│ │X│X│X│...(1980 rows)...│1│2│3│...│20│ │
│ └─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─│
│ 🐌 Slow (500ms)                         │
└─────────────────────────────────────────┘

CURSOR-BASED PAGINATION
┌─────────────────────────────────────────┐
│ Page 1: take 20                         │
│ ┌─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─│
│ │1│2│3│4│5│6│7│8│9│0│...           │20││
│ └─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─│
│ Cursor: 20                              │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ Page 100: cursor 1980, take 20          │
│ Start from cursor (index seek)          │
│               ┌─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┐ │
│               │1│2│3│4│5│6│7│...│20│   │
│               └─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┘ │
│ ⚡ Fast (0.2ms) - same as page 1!      │
└─────────────────────────────────────────┘
```

---

## 🎯 SECTION 4: PRACTICAL EXAMPLES & INTERVIEW PREP

### Example: Complete Search Implementation

```typescript
interface UserSearchParams {
  query?: string;
  role?: string;
  isActive?: boolean;
  createdAfter?: Date;
  page?: number;
  pageSize?: number;
}

async searchUsers(params: UserSearchParams): Promise<{ users: User[]; total: number }> {
  const {
    query,
    role,
    isActive,
    createdAfter,
    page = 1,
    pageSize = 20
  } = params;

  // Build dynamic where clause
  const where: Prisma.UserWhereInput = {
    AND: [
      // Text search (if provided)
      query ? {
        OR: [
          { firstName: { contains: query, mode: 'insensitive' } },
          { lastName: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } }
        ]
      } : {},
      // Role filter (if provided)
      role ? { role } : {},
      // Active filter (if provided)
      isActive !== undefined ? { isActive } : {},
      // Date filter (if provided)
      createdAfter ? { createdAt: { gte: createdAfter } } : {}
    ].filter(condition => Object.keys(condition).length > 0)  // Remove empty {}
  };

  const [users, total] = await Promise.all([
    this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    this.prisma.user.count({ where })
  ]);

  return {
    users: users.map(u => User.fromDatabase(this.toDatabaseRow(u))),
    total
  };
}
```

---

## 📝 INTERVIEW QUESTIONS

### Q1: What's the difference between implicit AND and explicit AND?

**Answer:**

**Implicit AND (default):**
```typescript
where: {
  id: 1,
  isActive: true
}
// Both conditions at same level → Implicit AND
```

**Explicit AND:**
```typescript
where: {
  AND: [
    { id: 1 },
    { isActive: true }
  ]
}
```

**They're functionally equivalent**, but explicit AND is needed when:
1. Combining with OR/NOT
2. Dynamic query building
3. Readability in complex queries

---

### Q2: Why is cursor-based pagination faster than offset-based?

**Answer:**

**Offset-based** (`skip + take`):
- Database must scan `skip` rows before returning results
- Page 100: Scans 1980 rows, returns 20
- Performance degrades linearly: O(n)

**Cursor-based** (`cursor + take`):
- Database uses index to jump directly to cursor
- Uses `WHERE id > cursor ORDER BY id LIMIT 20`
- Performance constant: O(1)

**Example:**
```typescript
// Offset: Page 1000 (skip 19980)
SELECT * FROM users 
ORDER BY id 
OFFSET 19980 LIMIT 20;  -- Scans 19980 rows 🐌

// Cursor: Page 1000 (cursor: 19980)
SELECT * FROM users 
WHERE id > 19980 
ORDER BY id 
LIMIT 20;  -- Index seek ⚡
```

---

### Q3: How do you search case-insensitively in Prisma?

**Answer:**

Use `mode: 'insensitive'`:
```typescript
where: {
  email: { 
    contains: "admin", 
    mode: 'insensitive' 
  }
}
// PostgreSQL: ILIKE '%admin%'
// Matches: "Admin", "ADMIN", "admin@example.com"
```

**Without `mode`:**
```typescript
where: {
  email: { contains: "admin" }
}
// PostgreSQL: LIKE '%admin%' (case-sensitive)
// Only matches: "admin@example.com" (not "Admin")
```

---

### Q4: How do you handle empty arrays in `in`/`notIn` filters?

**Answer:**

**`in` with empty array:**
```typescript
where: { id: { in: [] } }
// Returns: [] (no results) ✅ Correct behavior
```

**`notIn` with empty array:**
```typescript
where: { id: { notIn: [] } }
// Returns: All records (no exclusions) ✅ Correct behavior
```

**Defensive Programming:**
```typescript
const bannedIds = []; // Empty from database

// ❌ BAD - Returns all users if bannedIds is empty
where: { id: { notIn: bannedIds } }

// ✅ GOOD - Skip filter if bannedIds is empty
where: {
  ...(bannedIds.length > 0 && { id: { notIn: bannedIds } })
}
```

---

## ✅ PART 1 COMPLETION CHECKLIST

- ✅ All filter operators covered (equals, gt, lte, contains, in, etc.)
- ✅ Logical operators explained (AND, OR, NOT)
- ✅ String operations with case-insensitivity
- ✅ Null handling (is, isNot)
- ✅ Sorting (single and multi-field)
- ✅ Both pagination strategies (offset vs cursor)
- ✅ Real-world search example
- ✅ 4 interview questions with detailed answers

---

**Next Module:** M19-PART2 - Relations & Joins  
**Progress:** 1 out of 4 parts in M19 Advanced Queries completed

---

**Last Updated:** August 12, 2026  
**Author:** Claude Code Assistant  
**Review Status:** ✅ Ready for Production Use
