# M15: Repository Pattern Deep Dive

**File:** `services/user-service/src/repositories/user.repository.ts`  
**Lines:** 172 lines  
**Purpose:** Data access layer implementing Repository Pattern for `users` table

---

## 📖 Part 1: What is the Repository Pattern?

### The Problem

Imagine you're building a library management system. Your business logic needs to:
- Find books by ISBN
- Check if a book is available
- Update book availability
- Add new books

**Bad approach:**
```typescript
// Business logic mixed with SQL
function borrowBook(userId: number, bookId: number) {
  const result = await db.query('SELECT * FROM books WHERE id = $1', [bookId]);
  if (result.rows[0].available) {
    await db.query('UPDATE books SET available = false WHERE id = $1', [bookId]);
    await db.query('INSERT INTO borrows (user_id, book_id) VALUES ($1, $2)', [userId, bookId]);
  }
}
```

**Problems:**
1. SQL scattered everywhere in business logic
2. Can't test without a real database
3. Can't switch databases easily
4. Duplicate queries across functions

### The Repository Solution

**Repository Pattern** = Create a dedicated class that handles ALL database operations for ONE entity.

```
┌─────────────────────────────────────────────┐
│         Controller Layer                     │
│  (Handles HTTP requests/responses)           │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│         Service Layer                        │
│  (Business logic: validation, rules)         │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│      Repository Layer ← WE ARE HERE          │
│  (ONLY talks to database)                    │
│  - findById()                                │
│  - create()                                  │
│  - update()                                  │
│  - delete()                                  │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│         PostgreSQL Database                  │
└─────────────────────────────────────────────┘
```

**Benefits:**
1. **Separation of Concerns:** Database code isolated from business logic
2. **Testability:** Mock the repository in tests
3. **DRY:** One place for each query
4. **Flexibility:** Swap databases without changing business logic
5. **Type Safety:** Repository enforces correct data shapes

---

## 🔍 Part 2: Line-by-Line Code Analysis

### Section 1: Imports and Interfaces (Lines 1-26)

```typescript
1  /**
2   * User Repository - Data access layer for users table
3   */
4
5  import { User, UserDatabaseRow } from '../models/User';
```

**Line 5:** Import two types:
- `User`: Domain model (clean JavaScript camelCase)
- `UserDatabaseRow`: Database shape (PostgreSQL snake_case)

**Why two types?**
- Database uses `first_name` (snake_case)
- JavaScript uses `firstName` (camelCase)
- The `User` model transforms between them

```typescript
7  // Database pool type (matches shared/database interface)
8  interface DatabasePool {
9    // eslint-disable-next-line @typescript-eslint/no-explicit-any
10   query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[]; rowCount: number | null }>;
11 }
```

**Lines 8-11:** Define database pool interface
- `query<T>`: Generic method - we tell TypeScript what shape the rows will have
- `sql: string`: The SQL query
- `params?: any[]`: Optional parameterized values ($1, $2, etc.)
- Returns `{ rows: T[]; rowCount: number | null }`

**Example:**
```typescript
db.query<UserDatabaseRow>('SELECT * FROM users WHERE id = $1', [123])
// TypeScript knows result.rows is UserDatabaseRow[]
```

```typescript
13 export interface CreateUserData {
14   email: string;
15   passwordHash: string;
16   firstName: string;
17   lastName: string;
18   role?: 'admin' | 'customer' | 'vendor';
19 }
```

**Lines 13-19:** Input DTO (Data Transfer Object) for creating users
- Uses camelCase (JavaScript convention)
- `role?`: Optional, defaults to 'customer'
- No `id`, `createdAt`, `updatedAt` (database generates these)
- No sensitive fields like `isActive` (only admins should set this)

```typescript
21 export interface UpdateUserData {
22   firstName?: string;
23   lastName?: string;
24   email?: string;
25 }
```

**Lines 21-25:** Input DTO for updating users
- All fields optional (`?`)
- Only allows updating safe fields
- Can't update `role`, `passwordHash`, `isActive` (need separate methods)
- **Security:** Prevents privilege escalation

---

### Section 2: Repository Class and Constructor (Lines 27-28)

```typescript
27 export class UserRepository {
28   constructor(private readonly db: DatabasePool) {}
```

**Line 27:** `export class UserRepository`
- One repository per database table
- Will be instantiated in `server.ts`

**Line 28:** Constructor with dependency injection
- `private readonly db`: Creates a private property that can't be modified
- `DatabasePool`: Injected from outside (from `shared/database.ts`)

**Dependency Injection Benefits:**
```typescript
// Easy to test with a mock
const mockDb = { query: jest.fn() };
const repo = new UserRepository(mockDb);

// Easy to swap implementations
const realDb = getPostgresPool();
const repo = new UserRepository(realDb);
```

---

### Section 3: Create User (Lines 30-41)

```typescript
30   async create(userData: CreateUserData): Promise<User | null> {
31     const { email, passwordHash, firstName, lastName, role = 'customer' } = userData;
```

**Line 30:** Create method signature
- `async`: Will perform I/O (database query)
- Returns `Promise<User | null>`
- Returns `null` if something goes wrong

**Line 31:** Destructure with default value
- `role = 'customer'`: If `userData.role` is undefined, use 'customer'

```typescript
33     const result = await this.db.query<UserDatabaseRow>(
34       `INSERT INTO users (email, password_hash, first_name, last_name, role)
35        VALUES ($1, $2, $3, $4, $5)
36        RETURNING *`,
37       [email, passwordHash, firstName, lastName, role]
38     );
```

**Lines 33-38:** INSERT query with RETURNING clause

**Key patterns:**

1. **Parameterized queries ($1, $2, etc.):**
   ```sql
   -- WRONG: SQL injection vulnerability
   `INSERT INTO users (email) VALUES ('${email}')`
   
   -- RIGHT: Parameterized (PostgreSQL escapes for us)
   `INSERT INTO users (email) VALUES ($1)`, [email]
   ```

2. **snake_case column names:**
   - Database: `first_name`, `last_name`, `password_hash`
   - JavaScript: `firstName`, `lastName`, `passwordHash`

3. **RETURNING * clause:**
   - PostgreSQL-specific feature
   - Returns the inserted row (including auto-generated `id`, `created_at`, etc.)
   - One query instead of two (INSERT + SELECT)

4. **Type safety with generics:**
   - `query<UserDatabaseRow>`: TypeScript knows `result.rows` is `UserDatabaseRow[]`

```typescript
40     return User.fromDatabase(result.rows[0]);
41   }
```

**Line 40:** Transform database row to domain model
- `result.rows[0]`: First row from INSERT RETURNING
- `User.fromDatabase()`: Static factory method transforms snake_case to camelCase

**Flow:**
```
CreateUserData (camelCase)
  ↓
SQL INSERT (snake_case columns)
  ↓
UserDatabaseRow (snake_case from database)
  ↓
User.fromDatabase() transforms to camelCase
  ↓
User domain model (camelCase)
```

---

### Section 4: Find by ID (Lines 43-49)

```typescript
43   async findById(id: number): Promise<User | null> {
44     const result = await this.db.query<UserDatabaseRow>(
45       'SELECT * FROM users WHERE id = $1',
46       [id]
47     );
48     return User.fromDatabase(result.rows[0] || null);
49   }
```

**Lines 43-49:** Basic lookup by primary key

**Line 48 breakdown:**
```typescript
result.rows[0] || null
```
- If user exists: `result.rows[0]` is a `UserDatabaseRow`
- If user doesn't exist: `result.rows[0]` is `undefined`, expression evaluates to `null`

Then:
```typescript
User.fromDatabase(null)  // Returns null
User.fromDatabase(row)   // Returns new User(row)
```

**Security note:**
- Returns `User` domain model (password excluded)
- See next method for password access

---

### Section 5: Find by ID WITH Password (Lines 51-57)

```typescript
51   async findByIdWithPassword(id: number): Promise<UserDatabaseRow | null> {
52     const result = await this.db.query<UserDatabaseRow>(
53       'SELECT * FROM users WHERE id = $1',
54       [id]
55     );
56     return result.rows[0] || null;
57   }
```

**Key differences from `findById()`:**

1. **Returns `UserDatabaseRow` instead of `User`:**
   - `UserDatabaseRow` includes `password_hash`
   - `User` domain model excludes password (toJSON() doesn't include it)

2. **Direct return (no transformation):**
   - Line 56: `return result.rows[0] || null`
   - Does NOT call `User.fromDatabase()`

**When to use each:**

```typescript
// Public API endpoints - NEVER include password
async getUserProfile(userId: number) {
  const user = await userRepo.findById(userId);
  return user?.toJSON(); // Safe: no password
}

// Login validation - NEED password for comparison
async login(email: string, password: string) {
  const userRow = await userRepo.findByEmailWithPassword(email);
  const valid = await comparePasswords(password, userRow.password_hash);
}
```

---

### Section 6: Find by Email (Lines 59-73)

```typescript
59   async findByEmail(email: string): Promise<User | null> {
60     const result = await this.db.query<UserDatabaseRow>(
61       'SELECT * FROM users WHERE email = $1',
62       [email]
63     );
64     return User.fromDatabase(result.rows[0] || null);
65   }
```

**Lines 59-65:** Same pattern as `findById()` but searching by email
- Email is a UNIQUE constraint in database
- Returns at most one user

```typescript
67   async findByEmailWithPassword(email: string): Promise<UserDatabaseRow | null> {
68     const result = await this.db.query<UserDatabaseRow>(
69       'SELECT * FROM users WHERE email = $1',
70       [email]
71     );
72     return result.rows[0] || null;
73   }
```

**Lines 67-73:** Password-included version for login

**Usage in authentication:**
```typescript
// Step 1: Get user with password
const userRow = await repo.findByEmailWithPassword('user@example.com');
if (!userRow) throw new Error('Invalid credentials');

// Step 2: Verify password
const valid = await bcrypt.compare(plainPassword, userRow.password_hash);
if (!valid) throw new Error('Invalid credentials');

// Step 3: Generate JWT (exclude password from token payload)
const token = jwt.sign({ 
  userId: userRow.id, 
  email: userRow.email 
}, secret);
```

---

### Section 7: Find Active User (Lines 75-81)

```typescript
75   async findActiveById(id: number): Promise<User | null> {
76     const result = await this.db.query<UserDatabaseRow>(
77       'SELECT * FROM users WHERE id = $1 AND is_active = true',
78       [id]
79     );
80     return User.fromDatabase(result.rows[0] || null);
81   }
```

**Lines 75-81:** Combined filter: ID + active status

**Line 77:** `WHERE id = $1 AND is_active = true`
- Returns `null` if user exists but is deactivated
- Used for operations requiring active accounts

**Example use cases:**
```typescript
// Before allowing login
const user = await repo.findActiveById(userId);
if (!user) {
  throw new Error('Account is deactivated');
}

// Before processing payment
const user = await repo.findActiveById(userId);
if (!user) {
  throw new Error('Cannot process payment for inactive account');
}
```

**Why not just `findById()` + check `isActive`?**
```typescript
// Inefficient: Two checks
const user = await repo.findById(userId);
if (!user || !user.isActive) throw new Error('...');

// Efficient: Database does the filtering
const user = await repo.findActiveById(userId);
if (!user) throw new Error('...');
```

---

### Section 8: Email Existence Checks (Lines 83-97)

```typescript
83   async existsByEmail(email: string): Promise<boolean> {
84     const result = await this.db.query<{ exists: boolean }>(
85       'SELECT EXISTS(SELECT 1 FROM users WHERE email = $1)',
86       [email]
87     );
88     return result.rows[0].exists;
89   }
```

**Lines 83-89:** Check if email is already taken

**Line 85:** PostgreSQL `EXISTS()` operator
```sql
SELECT EXISTS(SELECT 1 FROM users WHERE email = $1)
```

**How EXISTS works:**
1. Inner query: `SELECT 1 FROM users WHERE email = $1`
   - Returns 1 if ANY row matches
   - Returns nothing if no rows match
2. `EXISTS()`: Converts to boolean
   - `true` if inner query returned any rows
   - `false` if inner query returned no rows

**Result shape:**
```typescript
{ exists: boolean }
// Example: { exists: true } or { exists: false }
```

**Why not `SELECT COUNT(*)`?**
```sql
-- Slower: Counts ALL matching rows
SELECT COUNT(*) FROM users WHERE email = $1

-- Faster: Stops after finding first match
SELECT EXISTS(SELECT 1 FROM users WHERE email = $1)
```

**Usage:**
```typescript
// During registration
const taken = await repo.existsByEmail('new@example.com');
if (taken) {
  throw new Error('Email already registered');
}
```

```typescript
91   async existsByEmailExcludingUser(email: string, userId: number): Promise<boolean> {
92     const result = await this.db.query<{ exists: boolean }>(
93       'SELECT EXISTS(SELECT 1 FROM users WHERE email = $1 AND id != $2)',
94       [email, userId]
95     );
96     return result.rows[0].exists;
97   }
```

**Lines 91-97:** Check if email exists for a DIFFERENT user

**Line 93:** `WHERE email = $1 AND id != $2`
- Checks if email belongs to someone else
- Used when updating user's email

**Example:**
```typescript
// User 123 wants to change email to 'new@example.com'
const takenByOther = await repo.existsByEmailExcludingUser('new@example.com', 123);

if (takenByOther) {
  throw new Error('Email already taken by another user');
}

// If user already has 'new@example.com', this returns false (email belongs to them)
```

---

### Section 9: Dynamic Update Query (Lines 99-130)

This is the most complex method in the repository. Let's break it down step by step.

```typescript
99   async update(id: number, updates: UpdateUserData): Promise<User | null> {
100     const fields: string[] = [];
101     const values: (string | number)[] = [];
102     let paramCount = 1;
```

**Lines 100-102:** Initialize arrays for building dynamic query

- `fields`: SQL fragments like `"first_name = $1"`
- `values`: Actual values to bind to parameters
- `paramCount`: Current parameter number (starts at $1, then $2, $3, etc.)

```typescript
104     if (updates.firstName !== undefined) {
105       fields.push(`first_name = $${paramCount++}`);
106       values.push(updates.firstName);
107     }
```

**Lines 104-107:** Add firstName to query if provided

**Line 105 breakdown:**
```typescript
`first_name = $${paramCount++}`
```
- Template literal creates `"first_name = $1"`
- `paramCount++`: Use current value THEN increment
  - First field: `$1`, paramCount becomes 2
  - Second field: `$2`, paramCount becomes 3

**Example flow:**
```typescript
// Input: { firstName: 'John', email: 'john@example.com' }

// After firstName:
fields = ['first_name = $1']
values = ['John']
paramCount = 2

// After email:
fields = ['first_name = $1', 'email = $2']
values = ['John', 'john@example.com']
paramCount = 3
```

```typescript
108     if (updates.lastName !== undefined) {
109       fields.push(`last_name = $${paramCount++}`);
110       values.push(updates.lastName);
111     }
112     if (updates.email !== undefined) {
113       fields.push(`email = $${paramCount++}`);
114       values.push(updates.email);
115     }
```

**Lines 108-115:** Same pattern for lastName and email

**Why check `!== undefined` instead of truthy?**
```typescript
// WRONG: Can't set empty string
if (updates.firstName) { ... }  // Skips if firstName === ''

// RIGHT: Can set empty string
if (updates.firstName !== undefined) { ... }  // Includes firstName === ''
```

```typescript
117     if (fields.length === 0) {
118       return this.findById(id);
119     }
```

**Lines 117-119:** Handle empty updates
- If no fields provided, just return current user
- Avoids generating invalid SQL

```typescript
121     fields.push('updated_at = CURRENT_TIMESTAMP');
122     values.push(id);
```

**Line 121:** Always update timestamp
- `CURRENT_TIMESTAMP`: PostgreSQL function for current time
- No parameter needed (database generates it)

**Line 122:** Add user ID for WHERE clause

```typescript
124     const result = await this.db.query<UserDatabaseRow>(
125       `UPDATE users SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
126       values
127     );
```

**Lines 124-127:** Build and execute dynamic UPDATE query

**Line 125 breakdown:**
```typescript
`UPDATE users SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *`
```

**Example with input `{ firstName: 'John', email: 'john@example.com' }`:**

```
fields = ['first_name = $1', 'email = $2', 'updated_at = CURRENT_TIMESTAMP']
paramCount = 3
values = ['John', 'john@example.com', 123]

Generated SQL:
UPDATE users 
SET first_name = $1, email = $2, updated_at = CURRENT_TIMESTAMP 
WHERE id = $3 
RETURNING *

Parameters: ['John', 'john@example.com', 123]
```

**`RETURNING *`:**
- Returns updated row
- One query instead of UPDATE + SELECT

```typescript
129     return User.fromDatabase(result.rows[0] || null);
130   }
```

**Line 129:** Transform result to domain model

---

### Section 10: Specialized Update Methods (Lines 132-146)

```typescript
132   async updatePassword(id: number, passwordHash: string): Promise<boolean> {
133     const result = await this.db.query(
134       'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
135       [passwordHash, id]
136     );
137     return (result.rowCount ?? 0) > 0;
138   }
```

**Lines 132-138:** Update password only

**Why separate method instead of using `update()`?**
1. **Security:** Password changes need special validation
2. **Auditing:** Can log password changes separately
3. **Business logic:** Might need to invalidate sessions

**Line 137:** Return boolean success
```typescript
(result.rowCount ?? 0) > 0
```
- `result.rowCount`: Number of rows updated (null if command didn't return count)
- `?? 0`: If null/undefined, use 0
- `> 0`: True if any row updated

**Example:**
```typescript
const updated = await repo.updatePassword(userId, newHash);
if (updated) {
  // Invalidate all user sessions
  await blacklist.clearUserTokens(userId);
  logger.info('Password changed', { userId });
}
```

```typescript
140   async updateEmailVerified(id: number, verified: boolean): Promise<boolean> {
141     const result = await this.db.query(
142       'UPDATE users SET email_verified = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
143       [verified, id]
144     );
145     return (result.rowCount ?? 0) > 0;
146   }
```

**Lines 140-146:** Update email verification status

**Usage in email verification flow:**
```typescript
// User clicks verification link with token
const payload = jwt.verify(token, secret);

// Mark email as verified
await repo.updateEmailVerified(payload.userId, true);

// Now user can access features requiring verified email
```

---

### Section 11: Account State Management (Lines 148-162)

```typescript
148   async deactivate(id: number): Promise<boolean> {
149     const result = await this.db.query(
150       'UPDATE users SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
151       [id]
152     );
153     return (result.rowCount ?? 0) > 0;
154   }
```

**Lines 148-154:** Soft delete (set is_active = false)

**Soft delete vs Hard delete:**

```typescript
// Soft delete: Keep data, mark as inactive
await repo.deactivate(userId);
// User can't login, but data preserved for:
// - Order history
// - Audit trails
// - Reactivation later

// Hard delete: Permanently remove
await repo.delete(userId);
// Data gone forever
// Foreign key constraints might prevent this
```

```typescript
156   async activate(id: number): Promise<boolean> {
157     const result = await this.db.query(
158       'UPDATE users SET is_active = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
159       [id]
160     );
161     return (result.rowCount ?? 0) > 0;
162   }
```

**Lines 156-162:** Reactivate deactivated account

**Business logic flow:**
```typescript
// Admin receives reactivation request
const user = await repo.findById(userId);
if (!user) throw new Error('User not found');

if (user.isActive) {
  throw new Error('Account already active');
}

// Reactivate
await repo.activate(userId);

// Notify user
await sendEmail(user.email, 'Your account has been reactivated');
```

---

### Section 12: Hard Delete (Lines 164-170)

```typescript
164   async delete(id: number): Promise<boolean> {
165     const result = await this.db.query(
166       'DELETE FROM users WHERE id = $1',
167       [id]
168     );
169     return (result.rowCount ?? 0) > 0;
170   }
```

**Lines 164-170:** Permanent deletion

**When to use hard delete:**
1. **GDPR compliance:** "Right to be forgotten"
2. **Testing:** Clean up test data
3. **Spam accounts:** Remove fake registrations

**Database constraints matter:**
```sql
-- If orders table has:
-- FOREIGN KEY (user_id) REFERENCES users(id)

-- This will FAIL if user has orders:
DELETE FROM users WHERE id = 123;
-- ERROR: violates foreign key constraint

-- Solutions:
-- 1. Use ON DELETE CASCADE (dangerous)
-- 2. Delete child records first
-- 3. Use soft delete instead
```

---

## 🏗️ Part 3: Repository Pattern in the Architecture

### The Complete Flow

```
┌──────────────────────────────────────────────┐
│  HTTP Request: POST /api/auth/register       │
└────────────────┬─────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────┐
│  Controller: user.controller.ts              │
│  - Extract req.body                          │
│  - Call service layer                        │
└────────────────┬─────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────┐
│  Service: user.service.ts                    │
│  - Validate business rules                   │
│  - Hash password                             │
│  - Call repository                           │
└────────────────┬─────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────┐
│  Repository: user.repository.ts ← HERE       │
│  - Build SQL query                           │
│  - Execute query                             │
│  - Transform result                          │
└────────────────┬─────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────┐
│  Database: PostgreSQL                        │
│  - users table                               │
└──────────────────────────────────────────────┘
```

### Dependency Injection Flow

```typescript
// server.ts
const db = getDatabasePool();
const userRepository = new UserRepository(db);
const userService = new UserService(userRepository);
const userController = new UserController(userService);

app.use('/api/auth', authRoutes(userController));
```

**Benefits:**
1. **Testability:** Mock each layer independently
2. **Flexibility:** Swap implementations easily
3. **Clear responsibilities:** Each layer has one job

---

## 🎯 Part 4: Interview Questions & Answers

### Q1: What is the Repository Pattern and why use it?
**Answer:** The Repository Pattern creates a dedicated class that handles ALL database operations for ONE entity. Benefits:
1. Separates data access from business logic
2. Makes code testable (mock the repository)
3. Provides a single place for queries (DRY)
4. Allows swapping databases without changing business logic
5. Enforces type safety

### Q2: Why have both `findById()` and `findByIdWithPassword()`?
**Answer:** Security and separation of concerns:
- `findById()` returns `User` domain model (no password)
- `findByIdWithPassword()` returns `UserDatabaseRow` (with password)

Most operations don't need passwords. Login is the exception. Having separate methods makes it explicit when passwords are accessed and prevents accidental password leaks in API responses.

### Q3: Explain the dynamic UPDATE query in `update()` method.
**Answer:** The `update()` method builds SQL dynamically based on which fields are provided:

```typescript
// Input: { firstName: 'John', email: 'john@example.com' }

// Builds:
fields = ['first_name = $1', 'email = $2', 'updated_at = CURRENT_TIMESTAMP']
values = ['John', 'john@example.com', 123]

// Generates SQL:
UPDATE users SET first_name = $1, email = $2, updated_at = CURRENT_TIMESTAMP 
WHERE id = $3 RETURNING *
```

This allows partial updates without explicitly setting every field. The `paramCount++` ensures parameter numbers increment correctly ($1, $2, $3...).

### Q4: Why use parameterized queries ($1, $2) instead of string interpolation?
**Answer:** **SQL injection prevention**. 

Bad:
```typescript
// SQL injection vulnerability
const sql = `SELECT * FROM users WHERE email = '${email}'`;
// If email = "' OR '1'='1", returns ALL users
```

Good:
```typescript
// Database escapes the parameter
const sql = 'SELECT * FROM users WHERE email = $1';
// Parameters treated as DATA, not CODE
```

PostgreSQL's parameterized queries automatically escape values, preventing injection attacks.

### Q5: What's the difference between soft delete and hard delete?
**Answer:**
- **Soft delete** (`deactivate()`): Sets `is_active = false`, keeps data
  - Pros: Preserves history, can reactivate, audit trail
  - Cons: Database size grows, need to filter in queries
- **Hard delete** (`delete()`): Permanently removes record
  - Pros: Reclaims space, truly removes data
  - Cons: Can break foreign keys, can't undo

Use soft delete by default, hard delete for GDPR compliance or test cleanup.

### Q6: Why does `existsByEmail()` use `EXISTS()` instead of `COUNT(*)`?
**Answer:** Performance. 

```sql
-- Slower: Counts ALL matching rows
SELECT COUNT(*) FROM users WHERE email = $1

-- Faster: Stops after finding FIRST match
SELECT EXISTS(SELECT 1 FROM users WHERE email = $1)
```

`EXISTS()` returns true/false as soon as it finds one match. `COUNT(*)` scans all matching rows even though we only care if ANY exist.

### Q7: What does `RETURNING *` do in INSERT and UPDATE queries?
**Answer:** PostgreSQL-specific clause that returns the modified row(s) in the same query.

Without RETURNING:
```typescript
// Two round trips
await db.query('INSERT INTO users (...) VALUES (...)');
const user = await db.query('SELECT * FROM users WHERE id = $1', [id]);
```

With RETURNING:
```typescript
// One round trip
const result = await db.query('INSERT INTO users (...) VALUES (...) RETURNING *');
const user = result.rows[0];
```

Reduces latency and guarantees you get the exact row that was inserted/updated.

### Q8: How would you add pagination to this repository?
**Answer:**
```typescript
async findAll(page: number = 1, pageSize: number = 20): Promise<User[]> {
  const offset = (page - 1) * pageSize;
  
  const result = await this.db.query<UserDatabaseRow>(
    'SELECT * FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2',
    [pageSize, offset]
  );
  
  return User.fromDatabaseArray(result.rows);
}

async count(): Promise<number> {
  const result = await this.db.query<{ count: string }>(
    'SELECT COUNT(*) as count FROM users'
  );
  return parseInt(result.rows[0].count, 10);
}
```

Usage:
```typescript
const users = await repo.findAll(2, 50); // Page 2, 50 per page
const total = await repo.count();
const pages = Math.ceil(total / 50);
```

### Q9: How would you implement search with multiple filters?
**Answer:**
```typescript
interface SearchFilters {
  email?: string;
  role?: string;
  isActive?: boolean;
  search?: string; // Search first/last name
}

async search(filters: SearchFilters): Promise<User[]> {
  const conditions: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (filters.email) {
    conditions.push(`email ILIKE $${paramCount++}`);
    values.push(`%${filters.email}%`);
  }

  if (filters.role) {
    conditions.push(`role = $${paramCount++}`);
    values.push(filters.role);
  }

  if (filters.isActive !== undefined) {
    conditions.push(`is_active = $${paramCount++}`);
    values.push(filters.isActive);
  }

  if (filters.search) {
    conditions.push(`(first_name ILIKE $${paramCount} OR last_name ILIKE $${paramCount})`);
    values.push(`%${filters.search}%`);
    paramCount++;
  }

  const whereClause = conditions.length > 0 
    ? `WHERE ${conditions.join(' AND ')}` 
    : '';

  const result = await this.db.query<UserDatabaseRow>(
    `SELECT * FROM users ${whereClause} ORDER BY created_at DESC`,
    values
  );

  return User.fromDatabaseArray(result.rows);
}
```

### Q10: How do you test a repository without a real database?
**Answer:** Mock the database pool:

```typescript
// user.repository.test.ts
describe('UserRepository', () => {
  let mockDb: jest.Mocked<DatabasePool>;
  let repo: UserRepository;

  beforeEach(() => {
    mockDb = {
      query: jest.fn()
    } as any;
    repo = new UserRepository(mockDb);
  });

  it('should find user by ID', async () => {
    const mockUser = {
      id: 1,
      email: 'test@example.com',
      first_name: 'John',
      last_name: 'Doe',
      // ... other fields
    };

    mockDb.query.mockResolvedValue({
      rows: [mockUser],
      rowCount: 1
    });

    const user = await repo.findById(1);

    expect(mockDb.query).toHaveBeenCalledWith(
      'SELECT * FROM users WHERE id = $1',
      [1]
    );
    expect(user?.email).toBe('test@example.com');
  });

  it('should return null when user not found', async () => {
    mockDb.query.mockResolvedValue({
      rows: [],
      rowCount: 0
    });

    const user = await repo.findById(999);
    expect(user).toBeNull();
  });
});
```

### Q11: What happens if `update()` is called with an empty object?
**Answer:** 
```typescript
await repo.update(123, {});
```

Line 117-119 handles this:
```typescript
if (fields.length === 0) {
  return this.findById(id);
}
```

Returns the current user without executing an UPDATE. This prevents generating invalid SQL and avoids an unnecessary write operation.

### Q12: Why is the `db` property `readonly`?
**Answer:**
```typescript
constructor(private readonly db: DatabasePool) {}
```

`readonly` prevents accidental reassignment:
```typescript
// Compilation error
this.db = someOtherPool; // Error: Cannot assign to 'db' because it is a read-only property
```

This ensures the repository always uses the database pool it was initialized with, preventing bugs from swapping pools mid-execution.

### Q13: How would you add transaction support?
**Answer:**
```typescript
export class UserRepository {
  constructor(
    private readonly db: DatabasePool,
    private readonly transaction?: DatabaseTransaction // Optional transaction
  ) {}

  private getClient() {
    return this.transaction || this.db;
  }

  async create(userData: CreateUserData): Promise<User | null> {
    const client = this.getClient();
    const result = await client.query<UserDatabaseRow>(
      `INSERT INTO users (...) VALUES (...) RETURNING *`,
      [...]
    );
    return User.fromDatabase(result.rows[0]);
  }
}

// Usage:
const transaction = await db.beginTransaction();
try {
  const userRepo = new UserRepository(db, transaction);
  const user = await userRepo.create(...);
  await transaction.commit();
} catch (err) {
  await transaction.rollback();
  throw err;
}
```

### Q14: What's the risk of returning `User | null`?
**Answer:** Requires null checks everywhere:

```typescript
const user = await repo.findById(123);
// Must check for null
if (!user) throw new Error('Not found');

console.log(user.email); // Safe
```

**Alternative pattern:**
```typescript
// Throw if not found
async findByIdOrFail(id: number): Promise<User> {
  const user = await this.findById(id);
  if (!user) throw new NotFoundError('User not found');
  return user;
}

// Now TypeScript knows it's never null
const user = await repo.findByIdOrFail(123);
console.log(user.email); // No null check needed
```

### Q15: How would you implement bulk insert?
**Answer:**
```typescript
async createMany(users: CreateUserData[]): Promise<User[]> {
  if (users.length === 0) return [];

  // Build dynamic placeholders: ($1, $2, $3), ($4, $5, $6), ...
  const values: any[] = [];
  const placeholders: string[] = [];
  
  users.forEach((user, index) => {
    const base = index * 5;
    placeholders.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`
    );
    values.push(
      user.email,
      user.passwordHash,
      user.firstName,
      user.lastName,
      user.role || 'customer'
    );
  });

  const result = await this.db.query<UserDatabaseRow>(
    `INSERT INTO users (email, password_hash, first_name, last_name, role)
     VALUES ${placeholders.join(', ')}
     RETURNING *`,
    values
  );

  return User.fromDatabaseArray(result.rows);
}

// Usage:
const users = await repo.createMany([
  { email: 'user1@example.com', passwordHash: 'hash1', firstName: 'John', lastName: 'Doe' },
  { email: 'user2@example.com', passwordHash: 'hash2', firstName: 'Jane', lastName: 'Smith' }
]);
// One query instead of two
```

---

## 💡 Part 5: Production Considerations

### 1. Database Indexes

**Critical indexes for this repository:**

```sql
-- Primary key (automatically indexed)
CREATE INDEX idx_users_id ON users(id);

-- Email uniqueness (should be UNIQUE constraint)
CREATE UNIQUE INDEX idx_users_email ON users(email);

-- Active user lookups
CREATE INDEX idx_users_is_active ON users(is_active);

-- Compound index for common queries
CREATE INDEX idx_users_email_active ON users(email, is_active);
```

**Query analysis:**
```sql
-- Uses idx_users_email
SELECT * FROM users WHERE email = 'user@example.com';

-- Uses idx_users_is_active
SELECT * FROM users WHERE is_active = true;

-- Uses idx_users_email_active (compound index)
SELECT * FROM users WHERE email = 'user@example.com' AND is_active = true;
```

### 2. Connection Pool Sizing

```typescript
// In production server.ts
const pool = new Pool({
  max: 20,          // Max connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
});

// Why 20?
// - PostgreSQL default max_connections: 100
// - Reserve 20 for admin/monitoring
// - 80 / 4 services = 20 per service
```

### 3. Error Handling

**Specific PostgreSQL errors:**
```typescript
async create(userData: CreateUserData): Promise<User | null> {
  try {
    const result = await this.db.query<UserDatabaseRow>(
      `INSERT INTO users (...) VALUES (...) RETURNING *`,
      [...]
    );
    return User.fromDatabase(result.rows[0]);
  } catch (err: any) {
    if (err.code === '23505') { // Unique constraint violation
      throw new ConflictError('Email already exists');
    }
    if (err.code === '23503') { // Foreign key violation
      throw new BadRequestError('Invalid reference');
    }
    throw err; // Unknown error
  }
}
```

### 4. Query Timeouts

```typescript
async findById(id: number): Promise<User | null> {
  const result = await this.db.query<UserDatabaseRow>(
    'SELECT * FROM users WHERE id = $1',
    [id],
    { timeout: 5000 } // 5 second timeout
  );
  return User.fromDatabase(result.rows[0] || null);
}
```

### 5. Caching Layer

```typescript
export class CachedUserRepository extends UserRepository {
  constructor(
    db: DatabasePool,
    private readonly cache: RedisClient
  ) {
    super(db);
  }

  async findById(id: number): Promise<User | null> {
    // Check cache first
    const cached = await this.cache.get(`user:${id}`);
    if (cached) {
      return JSON.parse(cached);
    }

    // Not in cache, query database
    const user = await super.findById(id);
    
    // Store in cache for 5 minutes
    if (user) {
      await this.cache.setex(`user:${id}`, 300, JSON.stringify(user));
    }

    return user;
  }

  async update(id: number, updates: UpdateUserData): Promise<User | null> {
    const user = await super.update(id, updates);
    
    // Invalidate cache
    if (user) {
      await this.cache.del(`user:${id}`);
    }

    return user;
  }
}
```

### 6. Audit Logging

```typescript
async update(id: number, updates: UpdateUserData): Promise<User | null> {
  const before = await this.findById(id);
  const after = await super.update(id, updates);

  // Log the change
  await auditLog.create({
    userId: id,
    action: 'USER_UPDATE',
    before: before?.toJSON(),
    after: after?.toJSON(),
    timestamp: new Date()
  });

  return after;
}
```

### 7. Soft Delete Queries

**Always filter soft-deleted records:**
```typescript
// Bad: Returns inactive users
async findAll(): Promise<User[]> {
  const result = await this.db.query<UserDatabaseRow>('SELECT * FROM users');
  return User.fromDatabaseArray(result.rows);
}

// Good: Filters inactive users
async findAll(): Promise<User[]> {
  const result = await this.db.query<UserDatabaseRow>(
    'SELECT * FROM users WHERE is_active = true'
  );
  return User.fromDatabaseArray(result.rows);
}
```

### 8. Monitoring

```typescript
import { metrics } from '../lib/metrics';

async findById(id: number): Promise<User | null> {
  const start = Date.now();
  try {
    const result = await this.db.query<UserDatabaseRow>(
      'SELECT * FROM users WHERE id = $1',
      [id]
    );
    
    metrics.histogram('db_query_duration_ms', Date.now() - start, {
      method: 'findById',
      table: 'users'
    });
    
    return User.fromDatabase(result.rows[0] || null);
  } catch (err) {
    metrics.increment('db_query_errors', {
      method: 'findById',
      table: 'users'
    });
    throw err;
  }
}
```

---

## ⚡ Part 6: Real-World Scenarios

### Scenario 1: User Registration Flow

```typescript
// In user.service.ts
async register(email: string, password: string, firstName: string, lastName: string) {
  // Check if email taken
  const exists = await this.userRepository.existsByEmail(email);
  if (exists) {
    throw new ConflictError('Email already registered');
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, 10);

  // Create user
  const user = await this.userRepository.create({
    email,
    passwordHash,
    firstName,
    lastName,
    role: 'customer'
  });

  if (!user) {
    throw new InternalServerError('Failed to create user');
  }

  // Send verification email
  await sendVerificationEmail(user.email);

  return user;
}
```

### Scenario 2: Login Flow

```typescript
async login(email: string, password: string) {
  // Get user WITH password
  const userRow = await this.userRepository.findByEmailWithPassword(email);
  if (!userRow) {
    throw new UnauthorizedError('Invalid credentials');
  }

  // Check if active
  if (!userRow.is_active) {
    throw new ForbiddenError('Account is deactivated');
  }

  // Verify password
  const valid = await bcrypt.compare(password, userRow.password_hash);
  if (!valid) {
    throw new UnauthorizedError('Invalid credentials');
  }

  // Generate tokens (exclude password)
  const accessToken = jwt.sign(
    { userId: userRow.id, email: userRow.email, role: userRow.role },
    process.env.JWT_SECRET!,
    { expiresIn: '15m' }
  );

  const refreshToken = jwt.sign(
    { userId: userRow.id },
    process.env.REFRESH_TOKEN_SECRET!,
    { expiresIn: '7d' }
  );

  return { accessToken, refreshToken };
}
```

### Scenario 3: Profile Update

```typescript
async updateProfile(userId: number, updates: { firstName?: string; lastName?: string; email?: string }) {
  // If email is being changed, check availability
  if (updates.email) {
    const taken = await this.userRepository.existsByEmailExcludingUser(updates.email, userId);
    if (taken) {
      throw new ConflictError('Email already in use');
    }

    // Mark email as unverified
    await this.userRepository.updateEmailVerified(userId, false);
    
    // Send new verification email
    await sendVerificationEmail(updates.email);
  }

  // Update user
  const user = await this.userRepository.update(userId, updates);
  if (!user) {
    throw new NotFoundError('User not found');
  }

  return user;
}
```

### Scenario 4: Password Change

```typescript
async changePassword(userId: number, oldPassword: string, newPassword: string) {
  // Get user with password
  const userRow = await this.userRepository.findByIdWithPassword(userId);
  if (!userRow) {
    throw new NotFoundError('User not found');
  }

  // Verify old password
  const valid = await bcrypt.compare(oldPassword, userRow.password_hash);
  if (!valid) {
    throw new UnauthorizedError('Current password is incorrect');
  }

  // Hash new password
  const newHash = await bcrypt.hash(newPassword, 10);

  // Update password
  const updated = await this.userRepository.updatePassword(userId, newHash);
  if (!updated) {
    throw new InternalServerError('Failed to update password');
  }

  // Invalidate all sessions
  await blacklist.clearUserTokens(userId);

  logger.info('Password changed', { userId });
}
```

### Scenario 5: Account Deletion (GDPR)

```typescript
async deleteAccount(userId: number) {
  // Get user
  const user = await this.userRepository.findById(userId);
  if (!user) {
    throw new NotFoundError('User not found');
  }

  // Check for dependencies
  const hasOrders = await orderRepository.existsByUserId(userId);
  if (hasOrders) {
    // Anonymize instead of delete
    await this.userRepository.update(userId, {
      email: `deleted-${userId}@example.com`,
      firstName: 'Deleted',
      lastName: 'User'
    });
    await this.userRepository.deactivate(userId);
  } else {
    // Hard delete (no dependencies)
    await this.userRepository.delete(userId);
  }

  // Invalidate sessions
  await blacklist.clearUserTokens(userId);

  logger.info('Account deleted', { userId });
}
```

---

## 🧪 Part 7: Hands-On Exercise

### Exercise: Implement Additional Repository Methods

Add these methods to `UserRepository`:

```typescript
// 1. Find users by role
async findByRole(role: string): Promise<User[]> {
  // TODO: Implement
}

// 2. Find recently created users (last N days)
async findRecentUsers(days: number = 7): Promise<User[]> {
  // TODO: Implement
  // Hint: Use CURRENT_DATE - INTERVAL
}

// 3. Count users by role
async countByRole(role: string): Promise<number> {
  // TODO: Implement
}

// 4. Find inactive users (not deactivated, but haven't logged in for N days)
// Assume we add a last_login column
async findInactiveUsers(days: number = 90): Promise<User[]> {
  // TODO: Implement
}

// 5. Bulk deactivate users
async deactivateMany(ids: number[]): Promise<number> {
  // TODO: Implement
  // Return: Number of users deactivated
}
```

### Solutions

```typescript
// 1. Find users by role
async findByRole(role: string): Promise<User[]> {
  const result = await this.db.query<UserDatabaseRow>(
    'SELECT * FROM users WHERE role = $1 AND is_active = true',
    [role]
  );
  return User.fromDatabaseArray(result.rows);
}

// 2. Find recently created users
async findRecentUsers(days: number = 7): Promise<User[]> {
  const result = await this.db.query<UserDatabaseRow>(
    `SELECT * FROM users 
     WHERE created_at >= CURRENT_DATE - INTERVAL '${days} days'
     ORDER BY created_at DESC`,
    []
  );
  return User.fromDatabaseArray(result.rows);
}

// 3. Count users by role
async countByRole(role: string): Promise<number> {
  const result = await this.db.query<{ count: string }>(
    'SELECT COUNT(*) as count FROM users WHERE role = $1',
    [role]
  );
  return parseInt(result.rows[0].count, 10);
}

// 4. Find inactive users
async findInactiveUsers(days: number = 90): Promise<User[]> {
  const result = await this.db.query<UserDatabaseRow>(
    `SELECT * FROM users 
     WHERE is_active = true 
     AND (last_login IS NULL OR last_login < CURRENT_DATE - INTERVAL '${days} days')`,
    []
  );
  return User.fromDatabaseArray(result.rows);
}

// 5. Bulk deactivate
async deactivateMany(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
  const result = await this.db.query(
    `UPDATE users 
     SET is_active = false, updated_at = CURRENT_TIMESTAMP 
     WHERE id IN (${placeholders})`,
    ids
  );
  return result.rowCount ?? 0;
}
```

---

## 📝 Summary

### Key Takeaways

1. **Repository Pattern** isolates ALL database operations for ONE entity
2. **Parameterized queries** ($1, $2) prevent SQL injection
3. **Separate methods** for password access (`findByIdWithPassword`) enforce security
4. **Dynamic UPDATE queries** allow partial updates
5. **Soft delete** (`is_active = false`) preserves data, hard delete removes it
6. **`EXISTS()` is faster** than `COUNT(*)` for existence checks
7. **`RETURNING *`** reduces round trips (INSERT + SELECT in one query)
8. **Domain model transformation** (`User.fromDatabase()`) separates database shape from API shape

### Interview Readiness

You can now confidently explain:
- ✅ What the Repository Pattern is and when to use it
- ✅ How to prevent SQL injection with parameterized queries
- ✅ How to build dynamic SQL queries safely
- ✅ The difference between soft delete and hard delete
- ✅ How to structure a data access layer in a microservice
- ✅ PostgreSQL-specific features (RETURNING, EXISTS, INTERVAL)

### Next Steps

- **M16:** Study `user.service.ts` (business logic layer)
- **M17:** Study `user.controller.ts` (HTTP request handling)
- **M18-M20:** End-to-end flows (registration, login, token refresh)

---

**Module 15 Complete!** 🎉  
You now understand the Repository Pattern and how to build a production-grade data access layer for MAANG-level interviews.
