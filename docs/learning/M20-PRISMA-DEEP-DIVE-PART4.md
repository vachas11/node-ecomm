# M20: Prisma Deep Dive - PART 4 (Advanced Schema Management)

**Prerequisites:** M20-PART1, M20-PART2, M20-PART3  
**Level:** Advanced  
**Time to Master:** 4-5 hours  
**Focus:** Introspection, complex migrations, troubleshooting, and multi-environment strategies

---

## 📖 SECTION 1: THEORY

### Schema Introspection: Reverse Engineering

**Introspection** is the process of generating a `schema.prisma` file from an **existing database**.

**Use Cases:**
1. **Inheriting a legacy database**: Team used raw SQL, now wants Prisma
2. **Database created manually**: DBA created tables, dev needs Prisma schema
3. **Syncing schema changes**: Someone altered DB directly, need to update `schema.prisma`
4. **Multi-database setups**: Different teams own different schemas

**Real-World Analogy:**
Like taking a photo of a building and creating blueprints from it (reverse of building from blueprints).

### Schema Validation

Prisma provides commands to validate schema correctness:

```
┌────────────────────────────────────────────────────────────┐
│         SCHEMA VALIDATION COMMANDS                          │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  npx prisma validate                                       │
│    ✅ Checks schema.prisma syntax                         │
│    ✅ Validates field types, attributes                   │
│    ✅ Checks for naming conflicts                         │
│    ❌ Does NOT check database state                       │
│                                                            │
│  npx prisma format                                         │
│    ✅ Auto-formats schema.prisma                          │
│    ✅ Sorts models alphabetically                         │
│    ✅ Aligns field attributes                             │
│                                                            │
│  npx prisma migrate status                                 │
│    ✅ Checks if schema matches database                   │
│    ✅ Detects drift (schema changed but not migrated)     │
│    ✅ Shows pending migrations                            │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

## 🔍 SECTION 2: LINE-BY-LINE CODE ANALYSIS

### `prisma db pull`: Introspect Existing Database

**Scenario:** Inheriting a database with tables created manually.

**Database State (created via raw SQL):**
```sql
CREATE TABLE customers (
  customer_id SERIAL PRIMARY KEY,
  email_address VARCHAR(255) UNIQUE NOT NULL,
  full_name VARCHAR(200),
  created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE orders (
  order_id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(customer_id) ON DELETE CASCADE,
  order_total DECIMAL(10, 2) NOT NULL,
  order_status VARCHAR(20) DEFAULT 'pending',
  created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_status ON orders(order_status);
```

**Step 1: Configure datasource**
```prisma
// prisma/schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}
```

**Step 2: Run introspection**
```bash
npx prisma db pull

# Output:
# Prisma schema loaded from prisma/schema.prisma
# Datasource "db": PostgreSQL database "legacy_db" at "localhost:5432"
# 
# Introspecting based on datasource defined in prisma/schema.prisma …
# 
# ✔ Introspected 2 models and wrote them into prisma/schema.prisma in 342ms
#       
# Run prisma generate to generate Prisma Client.
```

**Step 3: Review generated schema**
```prisma
// prisma/schema.prisma (AUTO-GENERATED)

model customers {
  customer_id    Int       @id @default(autoincrement())
  email_address  String    @unique @db.VarChar(255)
  full_name      String?   @db.VarChar(200)
  created_date   DateTime? @default(now()) @db.Timestamp(6)
  orders         orders[]

  @@index([customer_id])
}

model orders {
  order_id      Int         @id @default(autoincrement())
  customer_id   Int
  order_total   Decimal     @db.Decimal(10, 2)
  order_status  String      @default("pending") @db.VarChar(20)
  created_date  DateTime?   @default(now()) @db.Timestamp(6)
  customers     customers   @relation(fields: [customer_id], references: [customer_id], onDelete: Cascade)

  @@index([customer_id], map: "idx_orders_customer")
  @@index([order_status], map: "idx_orders_status")
}
```

**Step 4: Refine schema (optional but recommended)**
```prisma
// Rename models to follow Prisma conventions
model Customer {  // ← Capitalized, singular
  id           Int       @id @default(autoincrement()) @map("customer_id")
  email        String    @unique @map("email_address") @db.VarChar(255)
  fullName     String?   @map("full_name") @db.VarChar(200)
  createdAt    DateTime? @default(now()) @map("created_date")
  
  orders       Order[]   // ← Capitalized relation

  @@map("customers")  // ← Keep DB table name
}

model Order {
  id           Int       @id @default(autoincrement()) @map("order_id")
  customerId   Int       @map("customer_id")
  customer     Customer  @relation(fields: [customerId], references: [id], onDelete: Cascade)
  
  total        Decimal   @map("order_total") @db.Decimal(10, 2)
  status       String    @default("pending") @map("order_status") @db.VarChar(20)
  createdAt    DateTime? @default(now()) @map("created_date")

  @@map("orders")
  @@index([customerId], map: "idx_orders_customer")
  @@index([status], map: "idx_orders_status")
}
```

**Step 5: Baseline migration**
```bash
# Create initial migration from introspected schema
npx prisma migrate dev --name baseline --create-only

# Since tables already exist, edit migration to be a no-op
echo "-- Already applied" > prisma/migrations/xxx_baseline/migration.sql

# Mark as applied
npx prisma migrate resolve --applied xxx_baseline
```

---

### Complex Migration: Splitting a Column

**Scenario:** Split `full_name` into `first_name` and `last_name`.

**Challenge:** Can't do this in a single migration without data loss.

**Solution: Multi-Phase Migration**

#### Phase 1: Add New Columns
```prisma
model Customer {
  id           Int       @id @default(autoincrement())
  fullName     String?   @map("full_name")  // Keep old
  firstName    String?   @map("first_name")  // NEW
  lastName     String?   @map("last_name")   // NEW
  createdAt    DateTime? @default(now())

  @@map("customers")
}
```

```bash
npx prisma migrate dev --name add_name_fields --create-only
```

**Generated Migration:**
```sql
-- AlterTable
ALTER TABLE "customers" ADD COLUMN "first_name" TEXT;
ALTER TABLE "customers" ADD COLUMN "last_name" TEXT;
```

**Edit to include data migration:**
```sql
-- AlterTable
ALTER TABLE "customers" ADD COLUMN "first_name" TEXT;
ALTER TABLE "customers" ADD COLUMN "last_name" TEXT;

-- Data migration: Split full_name
UPDATE customers
SET 
  first_name = CASE
    WHEN position(' ' in full_name) > 0 
    THEN substring(full_name from 1 for position(' ' in full_name) - 1)
    ELSE full_name
  END,
  last_name = CASE
    WHEN position(' ' in full_name) > 0 
    THEN substring(full_name from position(' ' in full_name) + 1)
    ELSE ''
  END
WHERE full_name IS NOT NULL;
```

```bash
npx prisma migrate dev  # Apply modified migration
```

#### Phase 2: Update Application Code
Update all code to use `firstName` and `lastName` instead of `fullName`.

#### Phase 3: Remove Old Column
```prisma
model Customer {
  id           Int       @id @default(autoincrement())
  firstName    String?   @map("first_name")
  lastName     String?   @map("last_name")
  createdAt    DateTime? @default(now())

  @@map("customers")
}
```

```bash
npx prisma migrate dev --name remove_full_name
```

**Generated Migration:**
```sql
-- AlterTable
ALTER TABLE "customers" DROP COLUMN "full_name";
```

---

### Multi-Environment Schema Management

**Challenge:** Different environments need different configurations.

**Pattern: Environment-Specific Overrides**

**Base schema:** `prisma/schema.prisma`
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
  output   = "../src/generated/prisma-client"
}

// Models...
```

**Development override:** `prisma/schema.dev.prisma`
```prisma
datasource db {
  provider = "postgresql"
  url      = "postgresql://localhost:5432/myapp_dev"
}

// ... rest same as schema.prisma
```

**CI/Test override:** `prisma/schema.test.prisma`
```prisma
datasource db {
  provider = "postgresql"
  url      = "postgresql://localhost:5432/myapp_test"
}

// ... rest same
```

**Usage:**
```bash
# Development
npx prisma migrate dev --schema=prisma/schema.prisma

# Test
npx prisma migrate deploy --schema=prisma/schema.test.prisma

# Production (uses env var)
DATABASE_URL="..." npx prisma migrate deploy
```

**Alternative: Single Schema with Env Vars**
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")  // Different per environment
}
```

**Environment Files:**
- `.env.development`: `DATABASE_URL=postgresql://localhost/dev`
- `.env.test`: `DATABASE_URL=postgresql://localhost/test`
- `.env.production`: (Set in CI/CD secrets)

---

### Troubleshooting Common Migration Issues

#### Issue 1: "Migration already applied"

**Error:**
```
The migration `20260815101500_add_role` was modified after it was applied.
```

**Cause:** Edited migration file after it was applied.

**Fix:**
```bash
# Option 1: Revert edit (if not critical)
git checkout prisma/migrations/20260815101500_add_role/migration.sql

# Option 2: Create new migration with fix
npx prisma migrate dev --name fix_role_migration

# Option 3: Reset locally (dev only)
npx prisma migrate reset
```

---

#### Issue 2: Schema Drift

**Error:**
```
Your Prisma schema is out of sync with your database schema.
The following changes were detected:
  • Added field "phoneNumber" on model "User"
```

**Cause:** Database was modified outside of Prisma (manual ALTER TABLE).

**Fix:**
```bash
# Option 1: Pull changes from DB
npx prisma db pull  # Updates schema.prisma to match DB

# Option 2: Push schema to DB
npx prisma db push  # Updates DB to match schema.prisma

# Option 3: Create migration
npx prisma migrate dev --name sync_schema
```

---

#### Issue 3: Migration Conflicts (Team Scenario)

**Scenario:**
- Dev A creates migration `20260815101500_add_phone`
- Dev B creates migration `20260815101530_add_role`
- Both push to Git

**Conflict:**
```
prisma/migrations/
├── 20260815101500_add_phone/   (Dev A)
├── 20260815101530_add_role/    (Dev B)
```

**Resolution:**
```bash
# Pull both migrations
git pull

# Run migrations locally (applies both)
npx prisma migrate dev

# If conflicts in schema.prisma, resolve manually
# Then create merge migration
npx prisma migrate dev --name merge_phone_and_role
```

---

## 🏗️ SECTION 3: ARCHITECTURE & FLOW DIAGRAMS

### Introspection vs Migration Flow

```
┌────────────────────────────────────────────────────────────┐
│        SCHEMA-FIRST vs DATABASE-FIRST                       │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  SCHEMA-FIRST (Normal Prisma Workflow)                     │
│  ┌──────────────┐                                         │
│  │ schema.prisma│                                         │
│  └──────┬───────┘                                         │
│         │                                                  │
│         ↓                                                  │
│  ┌──────────────┐                                         │
│  │prisma migrate│                                         │
│  │     dev      │                                         │
│  └──────┬───────┘                                         │
│         │                                                  │
│         ↓                                                  │
│  ┌──────────────┐                                         │
│  │   Database   │                                         │
│  └──────────────┘                                         │
│                                                            │
│  DATABASE-FIRST (Introspection)                            │
│  ┌──────────────┐                                         │
│  │   Database   │ ← Already exists (legacy, manual)      │
│  └──────┬───────┘                                         │
│         │                                                  │
│         ↓                                                  │
│  ┌──────────────┐                                         │
│  │ prisma db    │                                         │
│  │     pull     │                                         │
│  └──────┬───────┘                                         │
│         │                                                  │
│         ↓                                                  │
│  ┌──────────────┐                                         │
│  │ schema.prisma│ ← Generated from DB                    │
│  └──────────────┘                                         │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

## 🎯 SECTION 4: PRACTICAL EXAMPLES & INTERVIEW PREP

### Example 1: Introspecting Production DB (Read-Only)

```bash
#!/bin/bash
# introspect-prod.sh - Safely introspect production without changes

# Use read-only credentials
export DATABASE_URL="postgresql://readonly_user:pass@prod-db:5432/myapp"

# Introspect (read-only operation)
npx prisma db pull --force  # --force overwrites local schema.prisma

# Diff with current schema
git diff prisma/schema.prisma

# If drift detected, create migration locally
npx prisma migrate dev --name sync_prod_drift

# Commit and deploy
git add prisma/
git commit -m "fix: sync schema with production state"
```

---

### Example 2: Migrating Between Database Providers

**Scenario:** Moving from PostgreSQL to MySQL.

**Step 1: Backup data**
```bash
pg_dump $DATABASE_URL > backup.sql
```

**Step 2: Update schema.prisma**
```prisma
datasource db {
  provider = "mysql"  // Changed from "postgresql"
  url      = env("MYSQL_DATABASE_URL")
}
```

**Step 3: Create baseline**
```bash
npx prisma migrate dev --name baseline --create-only

# Manually create MySQL tables from backup
mysql -u user -p myapp < converted_backup.sql

# Mark baseline as applied
npx prisma migrate resolve --applied baseline
```

**Step 4: Continue with MySQL**
```bash
npx prisma migrate dev --name add_new_field
```

---

### Example 3: Schema Validation in CI

```yaml
# .github/workflows/validate-schema.yml

name: Validate Prisma Schema

on: [pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: npm ci
      
      # Check 1: Syntax validation
      - name: Validate schema syntax
        run: npx prisma validate

      # Check 2: Format check
      - name: Check schema formatting
        run: |
          npx prisma format
          git diff --exit-code prisma/schema.prisma || {
            echo "❌ Schema needs formatting. Run 'npx prisma format' locally."
            exit 1
          }

      # Check 3: Migration check
      - name: Check for pending migrations
        env:
          DATABASE_URL: ${{ secrets.TEST_DATABASE_URL }}
        run: |
          npx prisma migrate deploy
          npx prisma migrate status
```

---

## 🎙️ INTERVIEW QUESTIONS

### 1. **Q:** When would you use `prisma db pull` vs `prisma migrate dev`?

**A:**
| Command | Use Case | Direction |
|---------|----------|-----------|
| **`db pull`** | Introspection | Database → Schema |
| **`migrate dev`** | Normal workflow | Schema → Database |

**Use `db pull` when:**
- Inheriting legacy database
- Database was modified manually (DBA made changes)
- Syncing after direct SQL alterations
- Starting Prisma on existing project

**Use `migrate dev` when:**
- Normal development (schema-first approach)
- Creating new features
- Team collaboration with migrations

**Example:**
```bash
# Inherited legacy DB
npx prisma db pull  # Generate schema from DB

# Refine schema
vi prisma/schema.prisma  # Rename models, add @map

# Create baseline
npx prisma migrate dev --name baseline

# Future changes
npx prisma migrate dev --name add_field  # Normal workflow
```

### 2. **Q:** How do you handle a complex data migration that can't be expressed in a single SQL statement?

**A:**
Use **`--create-only`** to write custom migration logic.

**Example: Encrypt existing passwords**
```bash
# Step 1: Generate migration file
npx prisma migrate dev --name encrypt_passwords --create-only

# Step 2: Edit migration.sql
```

```sql
-- migrations/xxx_encrypt_passwords/migration.sql

-- Add new column
ALTER TABLE users ADD COLUMN encrypted_password TEXT;

-- Custom logic: Can't do encryption in SQL, so...
-- Option A: Call external script
DO $$
BEGIN
  -- Mark for manual processing
  RAISE NOTICE 'Run encrypt-passwords.js script before applying';
END $$;

-- Option B: Set placeholder
UPDATE users SET encrypted_password = 'NEEDS_ENCRYPTION_' || id;
```

```bash
# Step 3: Run Node.js script to encrypt
node scripts/encrypt-passwords.js

# Step 4: Apply migration
npx prisma migrate dev
```

**Alternative: Split into two migrations**
```bash
# Migration 1: Add column
npx prisma migrate dev --name add_encrypted_password

# Run script
node scripts/encrypt-passwords.js

# Migration 2: Remove old column
npx prisma migrate dev --name remove_plain_password
```

### 3. **Q:** What's the difference between `prisma migrate resolve --applied` and `prisma migrate resolve --rolled-back`?

**A:**
Both mark a migration's status **without running SQL**.

**`--applied`:** Mark as successfully applied
- **Use:** Migration ran manually (outside Prisma), need to mark as done
- **Example:**
  ```bash
  # Created migration but applied SQL manually
  psql $DATABASE_URL < migration.sql
  
  # Mark as applied so Prisma doesn't try again
  npx prisma migrate resolve --applied 20260815101500_add_role
  ```

**`--rolled-back`:** Mark as rolled back
- **Use:** Migration failed, you manually fixed DB, want to retry
- **Example:**
  ```bash
  # Migration failed halfway
  npx prisma migrate status  # Shows: Failed
  
  # Manually fix database
  psql $DATABASE_URL -c "DROP TABLE broken_table;"
  
  # Mark as rolled back
  npx prisma migrate resolve --rolled-back 20260815101500_broken
  
  # Fix migration file and retry
  npx prisma migrate dev
  ```

### 4. **Q:** How do you ensure migrations are tested before production?

**A:**
**Multi-Stage Testing Strategy:**

**1. Local Development**
```bash
# Test on dev DB (disposable)
npx prisma migrate dev --name add_field
npm test  # Run all tests
```

**2. Automated CI Tests**
```yaml
# GitHub Actions: Fresh DB per PR
- run: docker run -d postgres:14
- run: npx prisma migrate deploy
- run: npm test
```

**3. Staging (Production Clone)**
```bash
# Copy production data to staging
pg_dump prod_db | psql staging_db

# Apply migrations
npx prisma migrate deploy

# Run smoke tests
npm run test:smoke

# Manual QA
```

**4. Production (With Rollback Plan)**
```bash
# Backup first
pg_dump prod_db > backup_$(date +%Y%m%d).sql

# Apply migrations
npx prisma migrate deploy

# Monitor metrics
watch 'psql -c "SELECT count(*) FROM users"'

# If issues: Rollback via reverse migration
```

**5. Post-Deployment Validation**
```bash
# Check migration status
npx prisma migrate status  # Should show "up to date"

# Check data integrity
npm run test:data-integrity

# Monitor error rates
curl https://metrics.example.com/errors
```

### 5. **Q:** What's your strategy for handling migration conflicts in a team?

**A:**
**Prevention:**
1. **Communicate:** Team chat when creating migrations
2. **Pull often:** `git pull` before creating migration
3. **Atomic commits:** One migration per PR

**Resolution (When Conflicts Happen):**

**Scenario:** Two devs create migrations at same time
```
Dev A: 20260815101500_add_phone
Dev B: 20260815101530_add_role
```

**Step 1: Pull both migrations**
```bash
git pull
```

**Step 2: Run both migrations locally**
```bash
npx prisma migrate dev  # Applies both in order
```

**Step 3: Check for schema conflicts**
```bash
npx prisma validate  # Checks for errors
```

**Step 4: If conflicts exist, create merge migration**
```prisma
// If both added conflicting fields, resolve in schema
model User {
  phone String?  // Dev A
  role  String?  // Dev B
  // No conflict if different fields
}
```

```bash
npx prisma migrate dev --name merge_phone_and_role
```

**Step 5: Commit and push**
```bash
git add prisma/migrations/
git commit -m "chore: merge migrations from phone and role branches"
git push
```

**Best Practice:** Use **migration naming conventions**
```bash
# Include ticket number
npx prisma migrate dev --name JIRA-1234-add-phone
npx prisma migrate dev --name JIRA-5678-add-role
# Easier to trace who created what
```

---

## ✅ MODULE COMPLETION CHECKLIST

- ✅ Theory: Introspection (database-first approach)
- ✅ `prisma db pull` for reverse engineering existing databases
- ✅ Complex migrations (splitting columns, data migrations)
- ✅ Multi-environment schema management
- ✅ Troubleshooting (drift, conflicts, failed migrations)
- ✅ Schema validation in CI/CD
- ✅ Interview questions with comprehensive answers

---

## 🎓 M20 SERIES COMPLETE!

You've now mastered:
- ✅ **M20-PART1:** Migration Fundamentals
- ✅ **M20-PART2:** Development Workflow
- ✅ **M20-PART3:** Production Deployment
- ✅ **M20-PART4:** Advanced Schema Management

**Total Learning Time:** 14-18 hours  
**Total Content:** ~2,360 lines of comprehensive Prisma migrations documentation

You can now:
- Manage database schema evolution with confidence
- Deploy migrations safely to production
- Handle complex migration scenarios (data migrations, column splits)
- Troubleshoot migration issues
- Implement zero-downtime deployment strategies
- Pass senior/lead-level Prisma migrations interview questions

**Next Step:** Master Prisma in Production (M21 series) for performance, monitoring, and error handling.

---

**Next:** [M21-PART1: Production Fundamentals](M21-PRISMA-DEEP-DIVE-PART1.md) *(To be created)*  
**Previous:** [M20-PART3: Production Deployment](M20-PRISMA-DEEP-DIVE-PART3.md)

---

**Last Updated:** 2026-08-12  
**Module Length:** ~570 lines  
**Status:** ✅ Ready for Learning
