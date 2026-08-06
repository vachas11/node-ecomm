# HANDS-ON TESTING GUIDE

**Transform theory into practice - test everything you've learned!**

---

## Overview

**What This Guide Covers:**

```
You've learned the theory across 5 modules:
├─ MODULE-1: API Gateway entry point
├─ MODULE-2: Resilience patterns
├─ MODULE-3: Authentication
├─ MODULE-4: User Service
└─ MODULE-5: Shared utilities

Now let's TEST IT ALL! 🧪

This guide provides:
├─ Setup instructions (get everything running)
├─ 25+ hands-on exercises
├─ Expected results for each test
├─ Common issues and fixes
└─ Performance measurements
```

---

# PART 1: Environment Setup

## Prerequisites Check

```bash
# Check Node.js (need v18+)
node --version
# Expected: v18.x.x or v20.x.x

# Check npm
npm --version
# Expected: 9.x.x or 10.x.x

# Check PostgreSQL
psql --version
# Expected: PostgreSQL 14.x or 15.x

# Check Redis
redis-cli --version
# Expected: redis-cli 7.x.x
```

**If missing:**

```bash
# Node.js: Download from https://nodejs.org/
# PostgreSQL: Download from https://www.postgresql.org/download/
# Redis: Download from https://redis.io/download/
# Windows: Or use Chocolatey
choco install nodejs postgresql redis
```

---

## Step 1: Install Dependencies

```bash
# Navigate to project root
cd C:\Users\vachas.shukla\Node\node-ecomm

# Install all dependencies
npm install

# Expected output:
# added 250 packages in 30s
# No errors or warnings (deprecation warnings OK)
```

**If errors occur:**

```bash
# Clear cache and retry
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

---

## Step 2: Start PostgreSQL

```bash
# Windows (PowerShell):
# Check if PostgreSQL service is running
Get-Service -Name postgresql*

# If not running, start it:
Start-Service -Name postgresql-x64-14  # Adjust version number

# Verify connection
psql -U postgres -c "SELECT version();"

# Expected output:
# PostgreSQL 14.x on x86_64-pc-mingw64, compiled by gcc...
```

---

## Step 3: Create Database

```bash
# Connect to PostgreSQL
psql -U postgres

# In psql prompt:
CREATE DATABASE ecommerce_users;

# Verify
\l
# Should see ecommerce_users in list

# Exit
\q
```

---

## Step 4: Run Migrations

```bash
# Create users table
psql -U postgres -d ecommerce_users -f services/user-service/migrations/001_create_users_table.sql

# Create refresh_tokens table
psql -U postgres -d ecommerce_users -f services/user-service/migrations/002_create_refresh_tokens_table.sql

# Verify tables exist
psql -U postgres -d ecommerce_users -c "\dt"

# Expected output:
#          List of relations
#  Schema |      Name       | Type  |  Owner   
# --------+-----------------+-------+----------
#  public | users           | table | postgres
#  public | refresh_tokens  | table | postgres
```

**If migration files don't exist, create them:**

```sql
-- services/user-service/migrations/001_create_users_table.sql
CREATE TABLE IF NOT EXISTS users (
    user_id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    role VARCHAR(50) DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);
```

```sql
-- services/user-service/migrations/002_create_refresh_tokens_table.sql
CREATE TABLE IF NOT EXISTS refresh_tokens (
    token_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
```

---

## Step 5: Start Redis

```bash
# Windows (PowerShell):
# Start Redis server
redis-server

# Expected output:
#                 _._                                                  
#            _.-``__ ''-._                                             
#       _.-``    `.  `_.  ''-._           Redis 7.0.0 (00000000/0) 64 bit
#   .-`` .-```.  ```\/    _.,_ ''-._                                   
#  (    '      ,       .-`  | `,    )     Running in standalone mode
#  |`-._`-...-` __...-.``-._|'` _.-'|     Port: 6379
#  |    `-._   `._    /     _.-'    |     PID: 1234
#   `-._    `-._  `-./  _.-'    _.-'                                   
#  |`-._`-._    `-.__.-'    _.-'_.-'|                                  
#  |    `-._`-._        _.-'_.-'    |           http://redis.io        
#   `-._    `-._`-.__.-'_.-'    _.-'                                   
#  |`-._`-._    `-.__.-'    _.-'_.-'|                                  
#  |    `-._`-._        _.-'_.-'    |                                  
#   `-._    `-._`-.__.-'_.-'    _.-'                                   
#       `-._    `-.__.-'    _.-'                                       
#           `-._        _.-'                                           
#               `-.__.-'                                               
# 
# Server initialized
# Ready to accept connections

# In a NEW terminal, verify Redis is running
redis-cli ping
# Expected: PONG
```

---

## Step 6: Configure Environment Variables

```bash
# Create .env file in project root
# Copy from .env.example if it exists

# Or create manually:
```

**File: `.env`**

```env
# Server Ports
PORT=3000
USER_SERVICE_PORT=3001

# Environment
NODE_ENV=development

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ecommerce_users
DB_USER=postgres
DB_PASSWORD=your_postgres_password

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# JWT Secrets (generate your own!)
JWT_ACCESS_SECRET=your-super-secret-access-key-at-least-32-characters-long
JWT_REFRESH_SECRET=your-super-secret-refresh-key-at-least-32-characters-long
JWT_SERVICE_SECRET=your-super-secret-service-key-at-least-32-characters-long

# Access token expiry (15 minutes)
ACCESS_TOKEN_EXPIRY=15m

# Refresh token expiry (7 days)
REFRESH_TOKEN_EXPIRY=7d

# Service token expiry (1 hour)
SERVICE_TOKEN_EXPIRY=1h

# CORS
CORS_ORIGIN=http://localhost:3000

# Service URLs
USER_SERVICE_URL=http://localhost:3001
```

**Generate secure secrets:**

```bash
# In Node.js REPL:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Use output for JWT secrets
```

---

## Step 7: Start Services

**Terminal 1: User Service**

```bash
cd services/user-service
npm run dev

# Expected output:
# [INFO] 2026-08-03 10:00:00 Database connected
# [INFO] 2026-08-03 10:00:00 Redis connected  
# [INFO] 2026-08-03 10:00:00 User Service running on port 3001
```

**Terminal 2: API Gateway**

```bash
cd services/api-gateway
npm run dev

# Expected output:
# [INFO] 2026-08-03 10:00:01 Redis connected
# [INFO] 2026-08-03 10:00:01 API Gateway running on port 3000
```

**Verify both are running:**

```bash
# Check API Gateway health
curl http://localhost:3000/health

# Expected:
# {
#   "status": "healthy",
#   "service": "api-gateway",
#   "timestamp": "2026-08-03T10:00:02.123Z",
#   "uptime": 1.234,
#   "redis": { "status": "connected" },
#   "services": [
#     { "name": "user-service", "status": "healthy", "url": "http://localhost:3001" }
#   ]
# }

# Check User Service health
curl http://localhost:3001/health

# Expected:
# {
#   "status": "healthy",
#   "service": "user-service",
#   "timestamp": "2026-08-03T10:00:03.456Z",
#   "uptime": 2.345,
#   "database": { "status": "connected" },
#   "redis": { "status": "connected" }
# }
```

**If services won't start:**

```bash
# Check logs for errors
# Common issues:

# 1. Port already in use
Error: listen EADDRINUSE: address already in use :::3000
# Solution: Kill process on that port
# Windows:
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# 2. Database connection failed
Error: connect ECONNREFUSED 127.0.0.1:5432
# Solution: Start PostgreSQL service

# 3. Redis connection failed
Error: connect ECONNREFUSED 127.0.0.1:6379
# Solution: Start Redis server

# 4. Missing environment variables
Error: JWT_ACCESS_SECRET is required
# Solution: Check .env file exists and has all required variables
```

---

# PART 2: Basic Testing (Authentication Flow)

## Exercise 1: User Registration

**Goal:** Create a new user account

**Test:**

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Password123",
    "firstName": "John",
    "lastName": "Doe"
  }'
```

**Expected Response (201 Created):**

```json
{
  "success": true,
  "data": {
    "user": {
      "userId": 1,
      "email": "test@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "createdAt": "2026-08-03T10:05:00.123Z"
    },
    "accessToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**What Just Happened:**

1. Request sent to API Gateway (port 3000)
2. Gateway forwarded to User Service (port 3001)
3. User Service:
   - Validated input ✅
   - Checked email not taken ✅
   - Hashed password (bcrypt 12 rounds) ✅
   - Inserted user into database ✅
   - Generated access + refresh tokens ✅
   - Stored hashed refresh token ✅
4. Response returned through Gateway ✅

**Verify in Database:**

```bash
psql -U postgres -d ecommerce_users -c "SELECT user_id, email, first_name, last_name, created_at FROM users;"

# Expected:
#  user_id |       email        | first_name | last_name |         created_at         
# ---------+--------------------+------------+-----------+----------------------------
#        1 | test@example.com   | John       | Doe       | 2026-08-03 10:05:00.123
```

**Save tokens for next tests:**

```bash
# On Windows PowerShell:
$ACCESS_TOKEN = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
$REFRESH_TOKEN = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."

# On Mac/Linux:
export ACCESS_TOKEN="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
export REFRESH_TOKEN="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

## Exercise 2: Duplicate Email Registration

**Goal:** Verify duplicate email is rejected

**Test:**

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "DifferentPassword123",
    "firstName": "Jane",
    "lastName": "Smith"
  }'
```

**Expected Response (409 Conflict):**

```json
{
  "success": false,
  "error": {
    "message": "Email already registered",
    "code": "CONFLICT",
    "requestId": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

**What Happened:**

- User Service checked database for existing email ✅
- Found user_id = 1 with that email ✅
- Threw ConflictError (409 status) ✅
- Error handler returned consistent error format ✅

---

## Exercise 3: Login

**Goal:** Authenticate with credentials

**Test:**

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Password123"
  }'
```

**Expected Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "user": {
      "userId": 1,
      "email": "test@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "role": "user"
    },
    "accessToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**What Happened:**

1. User Service queried user by email ✅
2. Compared password hash (bcrypt.compare, ~250ms) ✅
3. Generated new tokens ✅
4. Deleted old refresh tokens (token rotation) ✅
5. Stored new refresh token ✅
6. Returned user data + tokens ✅

**Verify token rotation:**

```bash
psql -U postgres -d ecommerce_users -c "SELECT COUNT(*) FROM refresh_tokens WHERE user_id = 1;"

# Expected:
#  count 
# -------
#      1
# (Only latest refresh token stored)
```

**Update saved tokens:**

```bash
# Save new tokens from login response
$ACCESS_TOKEN = "<new-access-token>"
$REFRESH_TOKEN = "<new-refresh-token>"
```

---

## Exercise 4: Wrong Password

**Goal:** Verify wrong password is rejected

**Test:**

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "WrongPassword123"
  }'
```

**Expected Response (400 Bad Request):**

```json
{
  "success": false,
  "error": {
    "message": "Invalid email or password",
    "code": "VALIDATION_ERROR",
    "requestId": "..."
  }
}
```

**Note:** Same error message as wrong email (security - don't reveal if email exists)

---

## Exercise 5: Access Protected Endpoint

**Goal:** Get user profile with valid token

**Test:**

```bash
curl http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

**Expected Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "user": {
      "userId": 1,
      "email": "test@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "role": "user",
      "createdAt": "2026-08-03T10:05:00.123Z",
      "updatedAt": "2026-08-03T10:05:00.123Z"
    }
  }
}
```

**What Happened:**

1. Gateway extracted token from Authorization header ✅
2. authenticate() middleware:
   - Verified JWT signature (RS256 with public key) ✅
   - Checked expiry (exp claim) ✅
   - Checked blacklist in Redis ✅
   - Attached user to req.user ✅
3. Gateway forwarded request with X-User-ID header ✅
4. User Service read user from database ✅
5. Returned profile ✅

---

## Exercise 6: Access Without Token

**Goal:** Verify authentication is required

**Test:**

```bash
curl http://localhost:3000/api/auth/profile
```

**Expected Response (401 Unauthorized):**

```json
{
  "success": false,
  "error": {
    "message": "Authentication required",
    "code": "NO_TOKEN",
    "requestId": "..."
  }
}
```

---

## Exercise 7: Refresh Token

**Goal:** Get new access token using refresh token

**Test:**

```bash
curl -X POST http://localhost:3000/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d "{
    \"refreshToken\": \"$REFRESH_TOKEN\"
  }"
```

**Expected Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**What Happened:**

1. Verified refresh token signature ✅
2. Hashed token (SHA-256) ✅
3. Looked up hash in database ✅
4. Checked token reuse (< 5 seconds = attack) ✅
5. Generated new tokens ✅
6. Deleted old refresh token ✅
7. Stored new refresh token ✅
8. Returned new tokens ✅

**Update saved tokens:**

```bash
$ACCESS_TOKEN = "<new-access-token>"
$REFRESH_TOKEN = "<new-refresh-token>"
```

---

## Exercise 8: Logout

**Goal:** Revoke tokens

**Test:**

```bash
curl -X POST http://localhost:3000/api/auth/logout \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"refreshToken\": \"$REFRESH_TOKEN\"
  }"
```

**Expected Response (200 OK):**

```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

**What Happened:**

1. Extracted access token jti ✅
2. Calculated time until expiry ✅
3. Added jti to Redis blacklist with TTL ✅
4. Deleted refresh token from database ✅

**Verify blacklist:**

```bash
redis-cli
127.0.0.1:6379> KEYS blacklist:*
# Expected: 1) "blacklist:<jti>"

127.0.0.1:6379> GET blacklist:<jti>
# Expected: "revoked"

127.0.0.1:6379> TTL blacklist:<jti>
# Expected: (integer) 895  # ~15 minutes = 900 seconds
```

**Verify refresh token deleted:**

```bash
psql -U postgres -d ecommerce_users -c "SELECT COUNT(*) FROM refresh_tokens WHERE user_id = 1;"

# Expected:
#  count 
# -------
#      0
```

---

## Exercise 9: Access After Logout

**Goal:** Verify blacklisted token is rejected

**Test:**

```bash
curl http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

**Expected Response (401 Unauthorized):**

```json
{
  "success": false,
  "error": {
    "message": "Token has been revoked",
    "code": "TOKEN_REVOKED",
    "requestId": "..."
  }
}
```

**What Happened:**

- authenticate() middleware checked Redis blacklist ✅
- Found token jti in blacklist ✅
- Rejected request ✅

**Success!** Token revocation works! 🎉

---

# PART 3: Rate Limiting Tests

## Exercise 10: Test Login Rate Limiting

**Goal:** Trigger rate limit after 5 failed login attempts

**Setup:** Login with wrong password 6 times

**Test:**

```bash
# Attempt 1-5 (should all return 400)
for i in {1..5}; do
  echo "Attempt $i:"
  curl -X POST http://localhost:3000/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{
      "email": "test@example.com",
      "password": "WrongPassword"
    }'
  echo "\n"
done

# Attempt 6 (should return 429)
echo "Attempt 6:"
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "WrongPassword"
  }'
```

**Expected: Attempts 1-5 (400 Bad Request):**

```json
{
  "success": false,
  "error": {
    "message": "Invalid email or password",
    "code": "VALIDATION_ERROR"
  }
}
```

**Expected: Attempt 6 (429 Too Many Requests):**

```json
{
  "success": false,
  "error": {
    "message": "Too many login attempts, please try again in 15 minutes",
    "code": "LOGIN_RATE_LIMIT_EXCEEDED",
    "retryAfter": 900
  }
}
```

**Response Headers (Attempt 6):**

```
HTTP/1.1 429 Too Many Requests
RateLimit-Limit: 5
RateLimit-Remaining: 0
RateLimit-Reset: 1691070900
Retry-After: 900
```

**Verify in Redis:**

```bash
redis-cli
127.0.0.1:6379> KEYS ratelimit:login:*
# Expected: 1) "ratelimit:login:test@example.com:127.0.0.1"

127.0.0.1:6379> GET ratelimit:login:test@example.com:127.0.0.1
# Expected: "5"

127.0.0.1:6379> TTL ratelimit:login:test@example.com:127.0.0.1
# Expected: (integer) 895  # ~15 minutes
```

**What Happened:**

- Each failed login incremented Redis counter ✅
- After 5 attempts, rate limiter blocked 6th attempt ✅
- Redis key has 15-minute TTL ✅
- After 15 minutes, counter resets automatically ✅

**Success!** Rate limiting protects against brute force! 🎉

---

## Exercise 11: Test API Rate Limiting

**Goal:** Verify general API rate limit (100 requests per 15 min)

**Test:**

```bash
# Make 101 requests to health endpoint
for i in {1..101}; do
  echo "Request $i:"
  curl http://localhost:3000/health
  echo "\n"
done
```

**Expected: Requests 1-100 (200 OK)**

**Expected: Request 101 (429 Too Many Requests):**

```json
{
  "success": false,
  "error": {
    "message": "Too many requests from this IP, please try again later",
    "code": "RATE_LIMIT_EXCEEDED",
    "retryAfter": 900
  }
}
```

---

# PART 4: Circuit Breaker Tests

## Exercise 12: Trigger Circuit Breaker

**Goal:** See circuit breaker OPEN after service failures

**Setup:** Stop User Service, make requests through Gateway

**Test:**

```bash
# Stop User Service (Ctrl+C in Terminal 1)

# Make 6 requests to trigger circuit breaker (threshold = 5)
for i in {1..6}; do
  echo "Request $i:"
  curl http://localhost:3000/api/auth/profile \
    -H "Authorization: Bearer <some-token>"
  echo "\n"
  sleep 1
done
```

**Expected: Requests 1-5:**

```json
{
  "success": false,
  "error": {
    "message": "Service unavailable",
    "code": "SERVICE_UNAVAILABLE"
  }
}
```

**Expected: Request 6:**

```json
{
  "success": false,
  "error": {
    "message": "Circuit breaker OPEN for user-service",
    "code": "CIRCUIT_BREAKER_OPEN"
  }
}
```

**Check Gateway Logs:**

```
[ERROR] Request to user-service failed (attempt 1/5)
[ERROR] Request to user-service failed (attempt 2/5)
[ERROR] Request to user-service failed (attempt 3/5)
[ERROR] Request to user-service failed (attempt 4/5)
[ERROR] Request to user-service failed (attempt 5/5)
[WARN] Circuit breaker OPEN for user-service
[ERROR] Circuit breaker OPEN, rejecting request
```

**What Happened:**

1. Requests 1-5 tried to reach User Service ✅
2. All failed (connection refused) ✅
3. After 5 failures, circuit breaker opened ✅
4. Request 6 rejected immediately (fail fast) ✅
5. Circuit breaker prevents hammering dead service ✅

**Test Recovery:**

```bash
# Restart User Service (Terminal 1)
cd services/user-service
npm run dev

# Wait 30 seconds (resetTimeout)
sleep 30

# Make new request
curl http://localhost:3000/health
# Expected: Circuit breaker HALF_OPEN → Try request → Success → Circuit CLOSED
```

**Success!** Circuit breaker prevents cascade failures! 🎉

---

**HANDS-ON-TESTING-GUIDE Part 1 Complete!**

You've tested:
✅ User registration (password hashing, database insert, token generation)
✅ Duplicate email rejection (conflict detection)
✅ Login (password verification, token rotation)
✅ Protected endpoints (JWT verification, blacklist check)
✅ Token refresh (rotation, reuse detection)
✅ Logout (blacklist + database delete)
✅ Rate limiting (5 login attempts, 100 API requests)
✅ Circuit breaker (fail fast after 5 failures, recovery)

**Next: Part 2 will cover:**
- Connection pooling tests
- Retry strategy tests
- Performance measurements
- Load testing
- Error scenarios
- Advanced testing techniques

Ready for Part 2? 🚀
