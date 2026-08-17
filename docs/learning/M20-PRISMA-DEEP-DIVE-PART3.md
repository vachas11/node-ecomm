# M20: Prisma Deep Dive - PART 3 (Production Deployment)

**Prerequisites:** M20-PART1, M20-PART2  
**Level:** Advanced  
**Time to Master:** 4-5 hours  
**Focus:** Safely deploying migrations to production and handling failures

---

## 📖 SECTION 1: THEORY

### Production vs Development: Key Differences

```
┌────────────────────────────────────────────────────────────┐
│     DEVELOPMENT vs PRODUCTION MIGRATIONS                    │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  DEVELOPMENT (migrate dev)                                 │
│  ✅ Interactive (prompts for name)                         │
│  ✅ Can reset database (prisma migrate reset)              │
│  ✅ Can edit migrations freely                             │
│  ✅ Regenerates client automatically                       │
│  ❌ Data loss acceptable                                   │
│                                                            │
│  PRODUCTION (migrate deploy)                               │
│  ✅ Non-interactive (CI/CD friendly)                       │
│  ❌ Cannot reset (data must be preserved)                  │
│  ❌ Cannot edit (checksums validated)                      │
│  ✅ Regenerates client automatically                       │
│  ✅ Zero downtime required                                 │
│  ✅ Rollback strategy needed                               │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### Zero-Downtime Deployment Principles

**The Challenge:**
During deployment, you have **two versions of your code** running simultaneously:
- **Old code**: Existing pods/containers (before deployment)
- **New code**: New pods/containers (during rolling update)

**The Problem:**
If your migration breaks old code, you have downtime during the deploy.

**The Solution: Backward-Compatible Migrations**

```
┌────────────────────────────────────────────────────────────┐
│          ZERO-DOWNTIME DEPLOYMENT FLOW                      │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  Phase 1: Expand (Add new schema, keep old)               │
│  ┌─────────────────────────────────────────┐             │
│  │ Old code still works (uses old columns) │             │
│  │ New code can use new columns            │             │
│  └─────────────────────────────────────────┘             │
│  Migration: ADD column (nullable or with default)         │
│  Deploy: New code (reads both old & new columns)          │
│                                                            │
│  Phase 2: Migrate Data (backfill)                         │
│  ┌─────────────────────────────────────────┐             │
│  │ Background job populates new columns    │             │
│  └─────────────────────────────────────────┘             │
│  No deployment, just data migration                       │
│                                                            │
│  Phase 3: Contract (Remove old schema)                    │
│  ┌─────────────────────────────────────────┐             │
│  │ Remove old column references from code  │             │
│  └─────────────────────────────────────────┘             │
│  Deploy: New code (only uses new columns)                 │
│  Migration: DROP old column                               │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

## 🔍 SECTION 2: LINE-BY-LINE CODE ANALYSIS

### `prisma migrate deploy`: Production Command

**Command:**
```bash
npx prisma migrate deploy
```

**What It Does:**
1. Connects to production database
2. Reads migrations from `prisma/migrations/` folder
3. Queries `_prisma_migrations` table to see what's applied
4. Applies **only pending migrations** (skips already applied)
5. Regenerates Prisma Client
6. **No prompts** (fully automated)

**Typical Use:** CI/CD pipeline, Dockerfile CMD, Kubernetes init container

---

### CI/CD Integration: GitHub Actions Example

**File:** `.github/workflows/deploy.yml`

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]  # Trigger on push to main

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
      # Step 1: Checkout code
      - name: Checkout repository
        uses: actions/checkout@v3

      # Step 2: Set up Node.js
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
          cache: 'npm'

      # Step 3: Install dependencies
      - name: Install dependencies
        run: npm ci

      # Step 4: Run migrations (BEFORE deploying app)
      - name: Run database migrations
        env:
          DATABASE_URL: ${{ secrets.PROD_DATABASE_URL }}
        run: |
          npx prisma migrate deploy
          # ↑ Applies pending migrations to production DB
          # No prompts, fully automated
          # Fails if any migration errors → Stops deployment

      # Step 5: Build application
      - name: Build app
        run: npm run build

      # Step 6: Run tests
      - name: Run tests
        run: npm test

      # Step 7: Deploy to production
      - name: Deploy to AWS/Azure/GCP
        run: |
          # Deploy Docker image, update Kubernetes, etc.
          echo "Deploying application..."
```

**Key Points:**
1. **Migrations run BEFORE deployment**: Ensures DB is ready for new code
2. **Environment variable**: `DATABASE_URL` from GitHub Secrets (never in code!)
3. **Fail fast**: If migration fails, deployment stops (old code keeps running)
4. **Atomic**: Each migration is a transaction (all-or-nothing)

---

### Dockerfile: Migration in Container

**Dockerfile:**
```dockerfile
# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
RUN npx prisma generate  # Generate Prisma Client at build time
COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine AS production
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package*.json ./

# Run migrations on container start
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
#                  └─ Migrations first, then start app
```

**Flow:**
1. Container starts
2. `npx prisma migrate deploy` runs
3. If migrations succeed → Start app (`node dist/server.js`)
4. If migrations fail → Container exits (orchestrator restarts with old version)

**Kubernetes Alternative: Init Container**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-gateway
spec:
  replicas: 3
  template:
    spec:
      # Init container runs BEFORE main app
      initContainers:
      - name: migrations
        image: my-app:latest
        command: ["npx", "prisma", "migrate", "deploy"]
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: url
      
      # Main app container (starts after migrations complete)
      containers:
      - name: app
        image: my-app:latest
        command: ["node", "dist/server.js"]
```

**Benefit:** Migrations run **once per deployment**, not once per pod.

---

### `prisma migrate status`: Check Migration State

**Command:**
```bash
npx prisma migrate status
```

**Output (All Applied):**
```
Database schema is up to date!

Following migrations have been applied:

20260812120530_init
20260812134520_add_user_phone
20260812150000_add_orders_table
```

**Output (Pending Migrations):**
```
Following migration(s) have not yet been applied:

20260815101500_add_user_role
20260815103000_add_order_status_index

To apply the pending migration(s), run:
  npx prisma migrate deploy
```

**Output (Schema Drift Detected):**
```
⚠️  Your schema.prisma has changes that are not reflected in the database:
  
  • Added field "phoneNumber" on model "User"
  
Run the following command to create and apply a migration:
  npx prisma migrate dev --name add_phone
```

**Use Cases:**
1. **Pre-deployment check**: CI/CD runs this to verify no drift before deploying
2. **Debugging**: Check if migrations are out of sync
3. **Health check**: Monitor in production (alert if drift detected)

**CI/CD Pre-Deploy Check:**
```yaml
# In GitHub Actions, before deploy
- name: Check for schema drift
  run: |
    npx prisma migrate status --schema=./prisma/schema.prisma
    if [ $? -ne 0 ]; then
      echo "❌ Schema drift detected! Run migrations locally first."
      exit 1
    fi
```

---

### Zero-Downtime Pattern: Adding Required Field

**Scenario:** Add required `role` field to `users` table with 1M rows in production.

**❌ WRONG (Causes Downtime):**
```prisma
// ONE-STEP (breaks old code immediately)
model User {
  role String  // Required field → Old code crashes (doesn't know about it)
}
```

**✅ RIGHT (Three-Step Deploy):**

#### Deploy 1: Add Nullable Field
```prisma
model User {
  role String? @default("customer")  // Nullable with default
}
```

```bash
# In CI/CD:
npx prisma migrate deploy  # Applies migration
# Then deploy app
```

**Migration:**
```sql
ALTER TABLE "users" ADD COLUMN "role" TEXT DEFAULT 'customer';
```

**Status:**
- ✅ Old code: Still works (ignores new column)
- ✅ New code: Can read/write role (optional)
- ✅ Database: All existing rows have `role = 'customer'`

#### Deploy 2: Backfill + Update Code
```typescript
// Background job (run AFTER Deploy 1)
async function backfillRoles() {
  await prisma.$executeRaw`
    UPDATE users 
    SET role = 'admin' 
    WHERE email LIKE '%@company.com' 
    AND role IS NULL;
  `;
}
```

Update all app code to **require** role in business logic (but schema still allows NULL for now).

#### Deploy 3: Make Required
```prisma
model User {
  role String  // Now required (all rows have values)
}
```

```bash
npx prisma migrate deploy  # Makes column NOT NULL
```

**Migration:**
```sql
ALTER TABLE "users" ALTER COLUMN "role" SET NOT NULL;
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
```

**Status:**
- ✅ Zero downtime (each deploy is backward-compatible)
- ✅ Data migrated safely (backfill complete before making required)
- ✅ Rollback safe (can revert Deploy 3 without losing data)

---

### Rollback Strategy: Forward-Only Migrations

**Important:** Prisma Migrate does **NOT** support automatic rollback.

**Why?**
- Database migrations are **forward-only** (you can't undo a schema change without losing data)
- Example: If you drop a column, the data is gone (rollback can't recover it)

**Rollback Patterns:**

#### Pattern 1: Create Reverse Migration
```bash
# Original migration: ADD column
# File: 20260815101500_add_role/migration.sql
ALTER TABLE "users" ADD COLUMN "role" TEXT;

# If you need to rollback, create NEW forward migration:
npx prisma migrate dev --name remove_role --create-only

# File: 20260815110000_remove_role/migration.sql
ALTER TABLE "users" DROP COLUMN "role";

# Apply rollback
npx prisma migrate deploy
```

#### Pattern 2: Blue-Green Deployment
```
┌────────────────────────────────────────────────────────────┐
│          BLUE-GREEN DEPLOYMENT WITH MIGRATIONS              │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  1. Run migrations on GREEN environment (new)             │
│     npx prisma migrate deploy (on green DB)               │
│                                                            │
│  2. Deploy app to GREEN environment                       │
│     Test thoroughly                                        │
│                                                            │
│  3. Switch traffic to GREEN                               │
│     Load balancer: blue → green                           │
│                                                            │
│  4. If issues, switch back to BLUE                        │
│     Old code + old schema still available                 │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

#### Pattern 3: Feature Flags
```typescript
// Deploy migration but don't use new column yet
const USE_NEW_ROLE_COLUMN = process.env.FEATURE_NEW_ROLE === 'true';

async function getUser(id: number) {
  const user = await prisma.user.findUnique({ where: { id } });
  
  if (USE_NEW_ROLE_COLUMN) {
    return { ...user, role: user.role };  // New column
  } else {
    return { ...user, role: 'customer' };  // Fallback
  }
}
```

**Rollback:** Set `FEATURE_NEW_ROLE=false` in environment → No code deploy needed

---

## 🏗️ SECTION 3: ARCHITECTURE & FLOW DIAGRAMS

### Production Deployment Flow

```
┌────────────────────────────────────────────────────────────┐
│       CI/CD PIPELINE WITH MIGRATIONS                        │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  1. Developer pushes to main branch                        │
│     git push origin main                                   │
│     ↓                                                      │
│  2. CI/CD triggered (GitHub Actions, GitLab CI, etc.)     │
│     ↓                                                      │
│  3. Run database migrations                                │
│     npx prisma migrate deploy                             │
│     ↓                                                      │
│     ├─ Success: Migrations applied ✅                     │
│     │  Continue to next step                              │
│     │                                                      │
│     └─ Failure: Migration error ❌                        │
│        Stop pipeline (don't deploy broken code)           │
│        Old version keeps running                          │
│     ↓                                                      │
│  4. Build application                                      │
│     npm run build                                          │
│     ↓                                                      │
│  5. Run tests                                              │
│     npm test                                               │
│     ↓                                                      │
│  6. Deploy to production                                   │
│     Docker push, Kubernetes apply, etc.                   │
│     ↓                                                      │
│  7. Health check                                           │
│     Wait for pods to be ready                             │
│     ↓                                                      │
│  8. Smoke tests                                            │
│     Test critical endpoints                               │
│     ↓                                                      │
│  ✅ DONE: New version live                                │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

## 🎯 SECTION 4: PRACTICAL EXAMPLES & INTERVIEW PREP

### Example 1: Safe Production Migration Checklist

```bash
#!/bin/bash
# deploy-migrations.sh

set -e  # Exit on any error

echo "🔍 Step 1: Check current migration status"
npx prisma migrate status
if [ $? -ne 0 ]; then
  echo "❌ Schema drift detected! Fix locally first."
  exit 1
fi

echo "✅ Step 2: Backup database"
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql

echo "🚀 Step 3: Apply migrations"
npx prisma migrate deploy

echo "🧪 Step 4: Run smoke tests"
npm run test:smoke

echo "✅ Deployment complete!"
```

### Example 2: Handling Failed Production Migration

**Scenario:** Migration fails halfway through.

**Step 1: Check what failed**
```bash
npx prisma migrate status

# Output:
# Following migration has failed:
# 20260815101500_add_role
#   Started: 2026-08-15 10:15:00
#   Finished: null
```

**Step 2: Connect to database**
```bash
psql $DATABASE_URL
```

**Step 3: Check _prisma_migrations table**
```sql
SELECT * FROM _prisma_migrations 
WHERE finished_at IS NULL;

-- Output:
-- migration_name: 20260815101500_add_role
-- logs: ERROR: column "role" of type text conflicts with existing type integer
```

**Step 4: Fix database manually**
```sql
-- The migration tried to add "role" TEXT but it already exists as INTEGER
-- Fix: Drop the incorrect column
ALTER TABLE users DROP COLUMN IF EXISTS role;

-- Now the migration can succeed
```

**Step 5: Mark migration as failed (so it retries)**
```sql
DELETE FROM _prisma_migrations 
WHERE migration_name = '20260815101500_add_role';
```

**Step 6: Re-run migrations**
```bash
npx prisma migrate deploy  # Will retry the failed migration
```

---

## 🎙️ INTERVIEW QUESTIONS

### 1. **Q:** Why should database migrations run BEFORE deploying the application code?

**A:**
**Reason:** Ensures the database schema is ready for the new code.

**Flow:**
```
✅ CORRECT ORDER:
1. Apply migrations (schema updated)
2. Deploy new code (expects new schema)
→ No errors, app works immediately

❌ WRONG ORDER:
1. Deploy new code (expects new schema)
2. Apply migrations (schema still old)
→ App crashes because columns/tables don't exist yet
```

**Exception:** When using blue-green deployment, you might deploy code first (to green environment) with migrations, then switch traffic.

### 2. **Q:** What is a "forward-only" migration strategy and why does Prisma use it?

**A:**
**Forward-only:** Migrations only move forward in time. No automatic rollback or "down" migrations.

**Why:**
1. **Data loss prevention:** Dropping a column destroys data. Automatic rollback can't recover it.
2. **Complexity:** Automatic rollback is hard (e.g., how do you un-split a column?).
3. **Production reality:** True rollbacks are rare. Usually you fix forward (add missing column, not revert entire deploy).

**How to "Rollback":**
Create a **new forward migration** that reverses the change:
```bash
# Original: Add column
ALTER TABLE users ADD COLUMN role TEXT;

# Rollback: Create new migration that drops it
ALTER TABLE users DROP COLUMN role;
```

### 3. **Q:** Explain the expand-contract pattern for zero-downtime migrations.

**A:**
**Pattern:** Make backward-compatible changes in three phases.

**Phase 1: Expand (Add new, keep old)**
- Add new column (nullable or with default)
- Deploy code that reads BOTH old and new columns
- **Status:** Old code works (ignores new column), new code works

**Phase 2: Migrate (Backfill)**
- Background job copies data from old → new column
- No deployment needed

**Phase 3: Contract (Remove old)**
- Deploy code that ONLY uses new column
- Create migration to drop old column
- **Status:** Only new code and new column

**Example:**
```sql
-- Phase 1: Add full_name, keep name
ALTER TABLE users ADD COLUMN full_name TEXT;

-- Phase 2: Backfill
UPDATE users SET full_name = name WHERE full_name IS NULL;

-- Phase 3: Drop name
ALTER TABLE users DROP COLUMN name;
```

### 4. **Q:** How do you handle a migration that takes 10 minutes to run (e.g., adding index to 100M rows)?

**A:**
**Problem:** Long-running migrations block deployments and can lock tables.

**Solution 1: Create index CONCURRENTLY**
```sql
-- Regular index (locks table for writes)
CREATE INDEX users_email_idx ON users(email);  -- ❌ Blocks for 10 min

-- Concurrent index (no locks)
CREATE INDEX CONCURRENTLY users_email_idx ON users(email);  -- ✅ Safe
```

Use `--create-only` to edit migration:
```bash
npx prisma migrate dev --name add_email_index --create-only
# Edit migration.sql to add CONCURRENTLY
npx prisma migrate dev
```

**Solution 2: Run migration out-of-band**
```bash
# In production, run migration manually BEFORE deploy
psql $DATABASE_URL < prisma/migrations/xxx_add_index/migration.sql

# Mark as applied
INSERT INTO _prisma_migrations (id, checksum, migration_name, finished_at, started_at)
VALUES (uuid_generate_v4(), '...', 'xxx_add_index', NOW(), NOW());

# Then deploy app (skips already-applied migration)
npx prisma migrate deploy
```

**Solution 3: Split into batches**
```sql
-- Instead of one big index, batch by ID range
CREATE INDEX users_email_idx_p1 ON users(email) WHERE id < 10000000;
CREATE INDEX users_email_idx_p2 ON users(email) WHERE id >= 10000000 AND id < 20000000;
-- Combine later with: CREATE INDEX users_email_idx ON users(email);
```

### 5. **Q:** What's your strategy for testing migrations before production?

**A:**
**Multi-Stage Testing:**

**1. Local Development**
```bash
# Test migration on local DB
npx prisma migrate dev --name add_role
npm test  # Run full test suite
```

**2. CI/CD (Automated)**
```yaml
# GitHub Actions tests migration on fresh DB
- run: npx prisma migrate deploy
- run: npm test
```

**3. Staging Environment**
```bash
# Apply to staging (copy of production data)
npx prisma migrate deploy
# Run integration tests
npm run test:integration
# Manual QA testing
```

**4. Production (With Safeguards)**
```bash
# 1. Backup first
pg_dump $DATABASE_URL > backup.sql

# 2. Run migrations
npx prisma migrate deploy

# 3. Health check
curl https://api.example.com/health

# 4. Monitor logs for 10 min
kubectl logs -f deployment/api-gateway

# 5. If issues, rollback via reverse migration
```

**Additional Safety:**
- Feature flags (deploy migration but don't use new columns yet)
- Blue-green deployment (test on green before switching traffic)
- Canary deployment (1% of traffic to new version first)

---

## ✅ MODULE COMPLETION CHECKLIST

- ✅ Theory: Production vs development differences
- ✅ Zero-downtime deployment principles (expand-contract)
- ✅ `prisma migrate deploy` in CI/CD (GitHub Actions, Dockerfile)
- ✅ `prisma migrate status` for drift detection
- ✅ Rollback strategies (forward-only migrations)
- ✅ Safe production migration checklist
- ✅ Handling failed migrations in production
- ✅ Interview questions with comprehensive answers

---

**Next:** [M20-PART4: Advanced Schema Management](M20-PRISMA-DEEP-DIVE-PART4.md)  
**Previous:** [M20-PART2: Development Workflow](M20-PRISMA-DEEP-DIVE-PART2.md)

---

**Last Updated:** 2026-08-12  
**Module Length:** ~620 lines  
**Status:** ✅ Ready for Learning
