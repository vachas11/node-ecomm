# M20: Prisma Deep Dive - PART 2 (Development Workflow)

**Prerequisites:** M20-PART1  
**Level:** Advanced  
**Time to Master:** 3-4 hours  
**Focus:** Day-to-day migration operations in development

---

## 📖 SECTION 1: THEORY

### Development Migration Workflow

The typical development cycle with Prisma Migrate:

```
┌────────────────────────────────────────────────────────────┐
│          DAILY DEVELOPMENT WORKFLOW                         │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  1. Feature request: "Add user phone number"              │
│     ↓                                                      │
│  2. Edit schema.prisma                                     │
│     Add: phone String? @map("phone_number")               │
│     ↓                                                      │
│  3. Run: npx prisma migrate dev --name add_user_phone     │
│     → Generates migration file                            │
│     → Applies to dev database                             │
│     → Regenerates Prisma Client                           │
│     ↓                                                      │
│  4. Test changes locally                                   │
│     - Run tests                                            │
│     - Try in app                                           │
│     ↓                                                      │
│  5. Commit everything                                      │
│     git add prisma/                                        │
│     git commit -m "feat: add user phone field"            │
│     ↓                                                      │
│  6. Push to remote                                         │
│     git push origin feature/add-phone                     │
│     ↓                                                      │
│  7. Teammate pulls changes                                 │
│     git pull                                               │
│     npx prisma migrate dev ← Applies same migration       │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### `prisma migrate dev` Deep Dive

**Full Command:**
```bash
npx prisma migrate dev [options]
```

**Options:**
- `--name <name>`: Name the migration (e.g., `add_phone`)
- `--create-only`: Generate migration file but DON'T apply (for manual edits)
- `--skip-generate`: Don't regenerate Prisma Client (faster, use when client unchanged)
- `--skip-seed`: Don't run seed script after migration

**What It Does:**
1. Detects schema changes (compares `schema.prisma` to database)
2. Generates migration SQL file
3. Applies migration to database
4. Updates `_prisma_migrations` table
5. Regenerates Prisma Client
6. Runs seed script (if `prisma/seed.ts` exists)

---

## 🔍 SECTION 2: LINE-BY-LINE CODE ANALYSIS

### Common Schema Changes

#### 1. Adding a New Field

**Before:**
```prisma
model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  createdAt DateTime @default(now()) @map("created_at")

  @@map("users")
}
```

**After:**
```prisma
model User {
  id          Int      @id @default(autoincrement())
  email       String   @unique
  phoneNumber String?  @map("phone_number") @db.VarChar(20)  // ← NEW
  createdAt   DateTime @default(now()) @map("created_at")

  @@map("users")
}
```

**Run Migration:**
```bash
npx prisma migrate dev --name add_user_phone

# Prompt:
# ? Enter a name for the new migration: › add_user_phone
```

**Generated Migration:**
```sql
-- AlterTable
ALTER TABLE "users" ADD COLUMN "phone_number" VARCHAR(20);
```

**Why `VARCHAR(20)` and not `TEXT`?**
- `@db.VarChar(20)` → Fixed-size column (faster, less disk space)
- `String` alone → TEXT (unlimited, slower for indexing)

**Why nullable (`String?`)?**
- Existing users don't have phone numbers
- Cannot add NOT NULL column without default to non-empty table
- **Alternative:** Add with default, then make required later

#### 2. Making a Field Required (Two-Step Process)

**Problem:** Can't directly change `String?` → `String` if table has existing rows.

**Step 1: Add default value**
```prisma
model User {
  phoneNumber String @default("") @map("phone_number")  // Default for existing rows
}
```

```bash
npx prisma migrate dev --name add_phone_with_default
```

**Generated Migration:**
```sql
-- AlterTable
ALTER TABLE "users" ADD COLUMN "phone_number" TEXT NOT NULL DEFAULT '';
```

**Step 2: Remove default (optional, if you want NULL to error)**
```prisma
model User {
  phoneNumber String @map("phone_number")  // No default, required
}
```

```bash
npx prisma migrate dev --name remove_phone_default
```

**Generated Migration:**
```sql
-- AlterTable
ALTER TABLE "users" ALTER COLUMN "phone_number" DROP DEFAULT;
```

**Production Note:** In production, you'd backfill data before removing default:
```sql
-- Before removing default, set real phone numbers
UPDATE users SET phone_number = '+1-555-0000' WHERE phone_number = '';
```

---

#### 3. Adding an Index

**Schema Change:**
```prisma
model User {
  id          Int      @id @default(autoincrement())
  email       String   @unique
  phoneNumber String?  @map("phone_number")
  createdAt   DateTime @default(now()) @map("created_at")

  @@map("users")
  @@index([phoneNumber])  // ← NEW INDEX
}
```

**Migration:**
```bash
npx prisma migrate dev --name add_phone_index
```

**Generated SQL:**
```sql
-- CreateIndex
CREATE INDEX "users_phone_number_idx" ON "users"("phone_number");
```

**Performance Impact:**
- **Before:** `SELECT * FROM users WHERE phone_number = '...'` → Full table scan (slow)
- **After:** Uses index → ~100x faster for lookups

**Index Naming Convention:**
Prisma auto-generates: `{table}_{column}_idx`
- `users_phone_number_idx`
- `orders_user_id_idx`

---

#### 4. Adding a Relation (Foreign Key)

**Schema Change:**
```prisma
model User {
  id      Int       @id @default(autoincrement())
  email   String    @unique
  orders  Order[]   // ← Virtual field (not in DB)

  @@map("users")
}

model Order {
  id        Int      @id @default(autoincrement())
  userId    Int      @map("user_id")
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)  // ← FK
  status    String
  createdAt DateTime @default(now()) @map("created_at")

  @@map("orders")
  @@index([userId])
}
```

**Migration:**
```bash
npx prisma migrate dev --name add_orders_table
```

**Generated SQL:**
```sql
-- CreateTable
CREATE TABLE "orders" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orders_user_id_idx" ON "orders"("user_id");

-- AddForeignKey
ALTER TABLE "orders" 
ADD CONSTRAINT "orders_user_id_fkey" 
FOREIGN KEY ("user_id") REFERENCES "users"("id") 
ON DELETE CASCADE ON UPDATE CASCADE;
```

**Key Points:**
- **Foreign Key Constraint**: `orders_user_id_fkey` enforces referential integrity
- **ON DELETE CASCADE**: When user deleted, their orders auto-delete
- **Index on FK**: Speeds up joins (`SELECT * FROM orders WHERE user_id = 1`)

---

### `prisma migrate dev --create-only`: Manual Edits

Sometimes you need to customize the generated SQL (add triggers, custom indexes, data migrations).

**Workflow:**
```bash
# Step 1: Generate migration WITHOUT applying
npx prisma migrate dev --name add_phone --create-only

# Output:
# Prisma Migrate created the following migration without applying it:
# migrations/
#   └─ 20260812150000_add_phone/
#       └─ migration.sql
```

**Step 2: Edit migration file**
```sql
-- migrations/20260812150000_add_phone/migration.sql

-- AlterTable (Prisma generated)
ALTER TABLE "users" ADD COLUMN "phone_number" VARCHAR(20);

-- Custom: Add check constraint (manual)
ALTER TABLE "users" 
ADD CONSTRAINT "phone_format_check" 
CHECK (phone_number ~* '^\+?[1-9]\d{1,14}$');
-- Ensures phone numbers match E.164 format

-- Custom: Create trigger (manual)
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at_trigger
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();
```

**Step 3: Apply modified migration**
```bash
npx prisma migrate dev

# Applies the migration with your custom SQL
```

**Use Cases for `--create-only`:**
- Add database triggers
- Add custom constraints (CHECK, EXCLUDE)
- Add comments to columns
- Create database functions/procedures
- Data migrations (backfill values)

---

### `prisma migrate reset`: Nuclear Option

**⚠️ WARNING:** This command **DELETES ALL DATA** in the database.

**What It Does:**
1. Drops entire database
2. Recreates database
3. Applies ALL migrations from scratch
4. Runs seed script

**Command:**
```bash
npx prisma migrate reset

# Prompt:
# ⚠️  We need to reset the database.
# Do you want to continue? All data will be lost. › (y/N)
```

**When to Use:**
- Development: You messed up migrations and want clean slate
- Testing: Reset to known state between test runs
- After fixing migration conflicts

**When NOT to Use:**
- ❌ NEVER in production (data loss!)
- ❌ Staging with important test data
- ❌ When you can fix with forward migration

**Alternative (Manual Reset):**
```bash
# Drop all tables manually
psql -U myuser -d mydb -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

# Then apply migrations
npx prisma migrate dev
```

---

### `prisma db push`: Prototyping Without Migrations

**Use Case:** Rapid prototyping, schema experimentation, **NOT** for production.

**Difference from `migrate dev`:**
```
┌──────────────────────────────────────────────────────────┐
│        migrate dev vs db push                             │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  migrate dev                                             │
│  ✅ Creates migration files (tracked in Git)            │
│  ✅ Reproducible (others can apply same changes)        │
│  ✅ Production-safe                                      │
│  ❌ Slower (prompts for name)                           │
│                                                          │
│  db push                                                 │
│  ❌ No migration files (no history)                     │
│  ❌ Not reproducible (schema in DB only)                │
│  ❌ NOT production-safe                                  │
│  ✅ Fast (no prompts, direct sync)                      │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Command:**
```bash
npx prisma db push

# Syncs schema.prisma → database directly
# No migration file created
```

**Example Workflow (Prototyping):**
```bash
# Day 1: Try out a field
# Add: phoneNumber String?
npx prisma db push  # Fast, no migration

# Day 2: Change to required
# Change: phoneNumber String
npx prisma db push  # Fast, overwrites

# Day 3: Happy with schema, create real migration
npx prisma migrate dev --name add_phone
# Now it's tracked in Git
```

**When to Use `db push`:**
- ✅ Local prototyping (schema still in flux)
- ✅ Quick experiments (trying out ideas)
- ✅ Disposable databases (reset often)

**When to Use `migrate dev`:**
- ✅ Production code (needs history)
- ✅ Team collaboration (others need same schema)
- ✅ Stable features (ready to commit)

---

## 🏗️ SECTION 3: ARCHITECTURE & FLOW DIAGRAMS

### Schema Evolution Timeline

```
┌────────────────────────────────────────────────────────────┐
│          SCHEMA EVOLUTION EXAMPLE                           │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  Week 1: Initial Schema                                    │
│  ┌──────────────┐                                         │
│  │ model User {  │                                         │
│  │   id    Int   │                                         │
│  │   email String│                                         │
│  │ }             │                                         │
│  └──────────────┘                                         │
│  Migration: 001_init                                       │
│                                                            │
│  Week 2: Add phone                                         │
│  ┌──────────────┐                                         │
│  │ model User {  │                                         │
│  │   id    Int   │                                         │
│  │   email String│                                         │
│  │   phone String? ← NEW                                  │
│  │ }             │                                         │
│  └──────────────┘                                         │
│  Migration: 002_add_phone                                  │
│                                                            │
│  Week 3: Add orders relation                               │
│  ┌──────────────┐        ┌────────────┐                  │
│  │ model User {  │        │ model Order│                  │
│  │   id    Int   │        │   id    Int│                  │
│  │   email String│        │   userId Int│ ← FK            │
│  │   phone String?│       │   status Str│                  │
│  │   orders Order[]│ ──▶  │ }          │                  │
│  │ }             │        └────────────┘                  │
│  └──────────────┘                                         │
│  Migration: 003_add_orders                                 │
│                                                            │
│  Week 4: Index for performance                             │
│  Migration: 004_add_user_phone_index                       │
│                                                            │
│  Git history:                                              │
│  ├─ 001_init.sql                                          │
│  ├─ 002_add_phone.sql                                     │
│  ├─ 003_add_orders.sql                                    │
│  └─ 004_add_user_phone_index.sql                         │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

## 🎯 SECTION 4: PRACTICAL EXAMPLES & INTERVIEW PREP

### Example 1: Renaming a Field (Safe Pattern)

**Problem:** Want to rename `firstName` → `fullName` without breaking production.

**❌ WRONG WAY:**
```prisma
// Before
model User {
  firstName String @map("first_name")
}

// After (immediate rename)
model User {
  fullName String @map("full_name")  // ❌ Breaks existing queries!
}
```

**✅ RIGHT WAY (3-Step Deploy):**

**Step 1: Add new field, keep old**
```prisma
model User {
  firstName String  @map("first_name")   // Keep old
  fullName  String? @map("full_name")    // Add new (nullable)
}
```

```bash
npx prisma migrate dev --name add_full_name
```

**Step 2: Backfill data + update code**
```sql
-- In migration file (or separate script)
UPDATE users SET full_name = first_name WHERE full_name IS NULL;
```

Update app code to use `fullName` everywhere.

**Step 3: Remove old field**
```prisma
model User {
  fullName String @map("full_name")  // Only new field
}
```

```bash
npx prisma migrate dev --name remove_first_name
```

**Why 3 steps?**
- ✅ Zero downtime (old code still works during Step 2)
- ✅ Data preserved (backfill before removal)
- ✅ Rollback possible (if Step 2 fails, still have old field)

---

### Example 2: Adding NOT NULL Column to Existing Table

**Problem:** Add required field to table with 1M existing rows.

**❌ WRONG:**
```prisma
model User {
  role String  // ❌ Can't add NOT NULL without default to non-empty table
}
```

**Error:**
```
column "role" contains null values
```

**✅ SOLUTION 1: Add with default**
```prisma
model User {
  role String @default("customer")
}
```

Migration automatically backfills:
```sql
ALTER TABLE "users" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'customer';
```

**✅ SOLUTION 2: Add nullable, backfill, make required**

**Step 1: Add nullable**
```prisma
model User {
  role String?
}
```

**Step 2: Backfill**
```sql
UPDATE users SET role = 'customer' WHERE role IS NULL;
```

**Step 3: Make required**
```prisma
model User {
  role String
}
```

---

### Example 3: Complex Data Migration

**Scenario:** Split `name` field into `firstName` and `lastName`.

**Step 1: Add new fields**
```prisma
model User {
  name      String        // Old field (keep for now)
  firstName String? @map("first_name")  // New
  lastName  String? @map("last_name")   // New
}
```

```bash
npx prisma migrate dev --name add_name_fields --create-only
```

**Step 2: Edit migration to include data migration**
```sql
-- Add columns
ALTER TABLE "users" ADD COLUMN "first_name" TEXT;
ALTER TABLE "users" ADD COLUMN "last_name" TEXT;

-- Split name into first/last
UPDATE users
SET 
  first_name = SPLIT_PART(name, ' ', 1),
  last_name = CASE 
    WHEN array_length(string_to_array(name, ' '), 1) > 1 
    THEN SPLIT_PART(name, ' ', 2)
    ELSE ''
  END
WHERE first_name IS NULL;
```

**Step 3: Apply migration**
```bash
npx prisma migrate dev
```

**Step 4: Update code to use new fields**

**Step 5: Remove old field**
```prisma
model User {
  firstName String @map("first_name")
  lastName  String @map("last_name")
}
```

```bash
npx prisma migrate dev --name remove_name_field
```

---

## 🎙️ INTERVIEW QUESTIONS

### 1. **Q:** What's the difference between `prisma migrate dev` and `prisma db push`?

**A:**
| Feature | `migrate dev` | `db push` |
|---------|--------------|-----------|
| **Creates migration files** | ✅ Yes | ❌ No |
| **Git tracked** | ✅ Yes | ❌ No |
| **Reproducible** | ✅ Yes (others apply same) | ❌ No (local only) |
| **Production-safe** | ✅ Yes | ❌ No |
| **Speed** | Slower (prompts) | ✅ Faster (no prompts) |
| **Use case** | Production code | Prototyping |

**Example:**
```bash
# Prototyping phase (schema changing daily)
npx prisma db push  # Fast, no history needed

# Ready to commit (stable feature)
npx prisma migrate dev --name add_phone  # Create migration, track in Git
```

### 2. **Q:** When would you use `--create-only` flag?

**A:**
Use `--create-only` when you need to **customize the generated SQL** before applying.

**Use Cases:**
1. **Add custom constraints:**
   ```sql
   ALTER TABLE users ADD CONSTRAINT email_format 
   CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$');
   ```

2. **Add database triggers:**
   ```sql
   CREATE TRIGGER update_timestamp 
   BEFORE UPDATE ON users 
   FOR EACH ROW EXECUTE FUNCTION update_updated_at();
   ```

3. **Data migrations:**
   ```sql
   UPDATE users SET role = 'customer' WHERE role IS NULL;
   ```

4. **Performance indexes:**
   ```sql
   CREATE INDEX CONCURRENTLY users_email_idx ON users(email);
   -- CONCURRENTLY prevents table locking
   ```

**Workflow:**
```bash
npx prisma migrate dev --name add_phone --create-only  # Generate only
vi prisma/migrations/.../migration.sql  # Edit SQL
npx prisma migrate dev  # Apply modified migration
```

### 3. **Q:** How do you safely add a NOT NULL column to a table with existing data?

**A:**
**Problem:** Can't add NOT NULL column to non-empty table without a value for existing rows.

**Solution 1: Add with default**
```prisma
model User {
  role String @default("customer")  // Default satisfies NOT NULL
}
```

**Solution 2: Three-step migration**
```bash
# Step 1: Add nullable
model User { role String? }
npx prisma migrate dev --name add_role_nullable

# Step 2: Backfill data
UPDATE users SET role = 'customer' WHERE role IS NULL;

# Step 3: Make required
model User { role String }
npx prisma migrate dev --name make_role_required
```

**Production Best Practice:** Use Solution 2 for zero-downtime deployments:
- Step 1 deploys → old code still works (ignores new nullable field)
- Step 2 runs background job → backfills data
- Step 3 deploys after backfill complete → new code uses required field

### 4. **Q:** What happens if you run `prisma migrate dev` on a dirty working tree (uncommitted changes)?

**A:**
Prisma **allows** it but **warns** you.

**Output:**
```
⚠️ Your local changes will be applied to the database without being tracked by a migration.
This is fine for development, but in production you should always commit migrations.

Continue? (y/N)
```

**Recommendation:**
- ✅ Development: OK (you're experimenting)
- ❌ Before committing: Run `prisma migrate dev` on clean tree (ensures migration captures ALL changes)

**Why it matters:**
If you have uncommitted schema changes and run `migrate dev`, the migration file might not include everything → schema drift when teammates pull.

### 5. **Q:** Explain how to handle a failed migration in development.

**A:**
**Scenario:** Migration applied halfway, then errored (e.g., constraint violation).

**Check Status:**
```bash
npx prisma migrate status

# Output:
# Following migrations have not yet been applied:
# 20260812150000_add_phone
#   Status: Failed
#   Started: 2026-08-12 15:00:00
#   Finished: null
```

**Option 1: Fix Forward (Preferred)**
```bash
# 1. Check what failed
psql -U user -d db -c "SELECT * FROM _prisma_migrations WHERE finished_at IS NULL;"

# 2. Manually fix database issue
psql -U user -d db -c "ALTER TABLE users ADD COLUMN phone VARCHAR(20);"

# 3. Mark migration as applied
psql -U user -d db -c "UPDATE _prisma_migrations SET finished_at = NOW() WHERE migration_name = '20260812150000_add_phone';"

# 4. Verify
npx prisma migrate status  # Should show "No pending migrations"
```

**Option 2: Reset (Nuclear)**
```bash
npx prisma migrate reset  # Drops DB, reapplies all migrations from scratch
```

**Option 3: Delete Failed Migration**
```bash
# 1. Remove migration from _prisma_migrations
DELETE FROM _prisma_migrations WHERE migration_name = '20260812150000_add_phone';

# 2. Remove migration folder
rm -rf prisma/migrations/20260812150000_add_phone/

# 3. Fix schema and recreate
npx prisma migrate dev --name add_phone
```

---

## ✅ MODULE COMPLETION CHECKLIST

- ✅ Theory: Development workflow (edit schema → migrate → commit)
- ✅ `prisma migrate dev` command with all options
- ✅ Common schema changes (add field, add index, add relation)
- ✅ Making fields required (two-step pattern)
- ✅ `--create-only` for manual SQL edits
- ✅ `prisma migrate reset` (nuclear option)
- ✅ `prisma db push` for prototyping
- ✅ Practical examples (renaming fields, data migrations)
- ✅ Interview questions with comprehensive answers

---

**Next:** [M20-PART3: Production Deployment](M20-PRISMA-DEEP-DIVE-PART3.md)  
**Previous:** [M20-PART1: Migration Fundamentals](M20-PRISMA-DEEP-DIVE-PART1.md)

---

**Last Updated:** 2026-08-12  
**Module Length:** ~600 lines  
**Status:** ✅ Ready for Learning
