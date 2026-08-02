# Production-Grade Authentication Implementation - Complete Guide

## 🎉 Implementation Complete!

All 4 phases have been successfully implemented:

✅ **Phase 1:** Shared Auth Library (JWT, middleware, blacklist, rate limiting)  
✅ **Phase 2:** Security Fixes in User Service (refresh, logout, rate limiting)  
✅ **Phase 3:** API Gateway (centralized routing and auth)  
✅ **Phase 4:** Service-to-Service Authentication (internal APIs)

---

## 📋 What Was Implemented

### Phase 1: Shared Auth Library (`/shared/auth/`)

**Created Files:**
- `shared/auth/jwt.js` - Enhanced JWT with 15min access tokens, service tokens, jti tracking
- `shared/auth/middleware.js` - Authenticate, authorize, service auth middleware
- `shared/auth/blacklist.js` - Redis-based token revocation
- `shared/auth/rateLimiter.js` - Rate limiting presets (login, register, refresh, API)

**Key Features:**
- Access tokens: 15 minutes (OWASP recommended)
- Refresh tokens: 7 days
- Service tokens: 1 hour (for internal APIs)
- JWT ID (`jti`) for revocation tracking
- Token type validation (`access`, `refresh`, `service`)
- Secret validation on startup (32+ characters required)

### Phase 2: User Service Security Fixes

**Modified Files:**
- `services/user-service/src/controllers/auth.controller.js` - Added refresh, logout, logout-all
- `services/user-service/src/routes/auth.routes.js` - Added rate limiting, new routes
- `services/user-service/src/server.js` - Redis initialization
- `services/user-service/.env.example` - Updated token lifetimes, Redis config
- `services/user-service/package.json` - Added dependencies

**New Endpoints:**
- `POST /api/auth/refresh` - Refresh access token with rotation
- `POST /api/auth/logout` - Logout from current device
- `POST /api/auth/logout-all` - Logout from all devices

**Security Improvements:**
- Refresh tokens stored as SHA-256 hashes in database
- Token rotation on every refresh (old token invalidated)
- Reuse detection (revokes ALL tokens on suspicious activity)
- Rate limiting:
  - Login: 5 attempts per 15 minutes per IP
  - Register: 3 accounts per hour per IP
  - Refresh: 10 per hour
  - Password change: 5 per hour

### Phase 3: API Gateway

**Created Files:**
- `services/api-gateway/src/server.js` - Main gateway server
- `services/api-gateway/src/config/services.js` - Service registry
- `services/api-gateway/src/middleware/proxy.js` - HTTP proxy
- `services/api-gateway/src/routes/index.js` - Route definitions
- `services/api-gateway/package.json` - Dependencies
- `services/api-gateway/.env.example` - Configuration

**Features:**
- Centralized authentication at gateway
- Request proxying to backend services
- User context forwarding via headers (`x-user-id`, `x-user-email`, `x-user-role`)
- Service health checks
- Request ID tracking for distributed tracing
- Global rate limiting

### Phase 4: Service-to-Service Authentication

**Created Files:**
- `services/user-service/src/routes/internal.routes.js` - Internal API endpoints

**Features:**
- Service token generation and verification
- Permission-based authorization
- Internal endpoints:
  - `GET /api/internal/users/:id` - Get user by ID
  - `POST /api/internal/users/bulk` - Get multiple users
  - `GET /api/internal/users/:id/verify` - Verify user exists

---

## 🚀 Setup Instructions

### Prerequisites

- Node.js 18+ installed
- PostgreSQL 14+ running
- Redis server running

### Step 1: Install Dependencies

```bash
# User Service
cd services/user-service
npm install

# API Gateway
cd ../api-gateway
npm install
```

### Step 2: Set Up PostgreSQL Database

```bash
# Create database
psql -U postgres
CREATE DATABASE user_db;

# The schema will be auto-created on first run
# Tables: users, refresh_tokens
```

### Step 3: Start Redis

**Using Docker:**
```bash
docker run -d -p 6379:6379 --name redis redis:7-alpine
```

**Or install locally:**
```bash
# Windows (via Chocolatey)
choco install redis

# Mac (via Homebrew)
brew install redis
brew services start redis

# Linux (via apt)
sudo apt install redis-server
sudo systemctl start redis
```

### Step 4: Configure Environment Variables

**User Service:** `services/user-service/.env`
```bash
# Copy example and update secrets
cp .env.example .env

# CRITICAL: Change these secrets (min 32 characters)
JWT_SECRET=your-production-secret-at-least-32-characters-long-change-this
JWT_REFRESH_SECRET=different-secret-for-refresh-tokens-32-chars-minimum
```

**API Gateway:** `services/api-gateway/.env`
```bash
# Copy example
cp .env.example .env

# MUST match user-service secrets
JWT_SECRET=your-production-secret-at-least-32-characters-long-change-this
JWT_REFRESH_SECRET=different-secret-for-refresh-tokens-32-chars-minimum
```

### Step 5: Start Services

**Terminal 1 - User Service:**
```bash
cd services/user-service
npm run dev
# Runs on http://localhost:3001
```

**Terminal 2 - API Gateway:**
```bash
cd services/api-gateway
npm run dev
# Runs on http://localhost:3000
```

### Step 6: Verify Health

```bash
# Check user service
curl http://localhost:3001/health

# Check API gateway
curl http://localhost:3000/health
```

---

## 🧪 Testing the Implementation

### Test 1: User Registration

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "SecurePass123!",
    "firstName": "John",
    "lastName": "Doe"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": 1,
      "email": "test@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "role": "user"
    },
    "tokens": {
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    }
  }
}
```

### Test 2: Login

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "SecurePass123!"
  }'
```

### Test 3: Access Protected Endpoint

```bash
# Save access token from login response
ACCESS_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

curl -X GET http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

### Test 4: Refresh Access Token

```bash
# Save refresh token from login
REFRESH_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

curl -X POST http://localhost:3000/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\": \"$REFRESH_TOKEN\"}"
```

**Expected:** New access token + new refresh token (rotation)

### Test 5: Logout

```bash
curl -X POST http://localhost:3000/api/auth/logout \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\": \"$REFRESH_TOKEN\"}"
```

**Then verify token is blacklisted:**
```bash
# This should fail with 401
curl -X GET http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

### Test 6: Logout All Devices

```bash
# Login from multiple "devices" (get multiple tokens)
# Then logout all:

curl -X POST http://localhost:3000/api/auth/logout-all \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected:** All refresh tokens deleted, current access token blacklisted

### Test 7: Rate Limiting

```bash
# Try 6 failed login attempts (limit is 5)
for i in {1..6}; do
  curl -X POST http://localhost:3000/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"wrong"}'
  echo ""
done
```

**Expected:** 6th attempt returns 429 Too Many Requests

### Test 8: Service-to-Service Authentication

**Generate service token (in Node.js):**
```javascript
// In node REPL or script
require('dotenv').config();
const { generateServiceToken } = require('./shared/auth/jwt');

const serviceToken = generateServiceToken('order-service', {
  permissions: ['read:users']
});

console.log(serviceToken);
```

**Call internal API:**
```bash
SERVICE_TOKEN="generated-token-from-above"

curl -X GET http://localhost:3001/api/internal/users/1 \
  -H "Authorization: Bearer $SERVICE_TOKEN"
```

**Expected:** User data returned with `requestedBy: "order-service"`

---

## 📊 Database Verification

### Check Stored Refresh Tokens

```sql
-- Connect to database
psql -U postgres -d user_db

-- View refresh tokens (hashed)
SELECT 
  id, 
  user_id, 
  LEFT(token_hash, 16) as token_preview,
  expires_at,
  created_at
FROM refresh_tokens;
```

### Check Token Rotation

```sql
-- Count tokens per user (should be 1 per device)
SELECT user_id, COUNT(*) as token_count
FROM refresh_tokens
GROUP BY user_id;
```

---

## 🔍 Redis Verification

### Check Blacklisted Tokens

```bash
# Connect to Redis
redis-cli

# List blacklisted tokens
KEYS blacklist:*

# Check specific token
GET blacklist:<jti-value>

# View TTL
TTL blacklist:<jti-value>
```

### Check Rate Limiting

```bash
# View rate limit counters
KEYS ratelimit:*

# Check login attempts for an IP
GET ratelimit:<timestamp>:<ip>:test@example.com
```

---

## 🏗️ Architecture Overview

```
┌─────────────┐
│   Client    │
│ (Web/Mobile)│
└──────┬──────┘
       │ JWT: Bearer eyJhbGc...
       ▼
┌─────────────────────────────┐
│   API Gateway (Port 3000)   │
│  ┌─────────────────────┐    │
│  │ Rate Limiting       │    │
│  │ JWT Verification    │    │
│  │ Request Routing     │    │
│  └─────────────────────┘    │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ User Service (Port 3001)│
│  ┌─────────────────┐    │
│  │ Auth Endpoints  │    │
│  │ Internal APIs   │    │
│  │ PostgreSQL DB   │    │
│  └─────────────────┘    │
└─────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ Redis (Port 6379)       │
│  • Token Blacklist      │
│  • Rate Limiting        │
└─────────────────────────┘
```

---

## 🔐 Security Features Summary

| Feature | Status | Description |
|---------|--------|-------------|
| **Short Access Tokens** | ✅ | 15 minutes (OWASP recommended) |
| **Token Refresh** | ✅ | With automatic rotation |
| **Token Revocation** | ✅ | Redis blacklist with TTL |
| **Logout** | ✅ | Single device and all devices |
| **Rate Limiting** | ✅ | Per-endpoint limits with Redis |
| **Reuse Detection** | ✅ | Revokes all tokens on compromise |
| **Token Hashing** | ✅ | SHA-256 in database |
| **JWT Validation** | ✅ | Type checking, secret validation |
| **Service Auth** | ✅ | Separate tokens for internal APIs |
| **Request Tracing** | ✅ | X-Request-ID headers |

---

## 📈 Monitoring & Logs

### Key Metrics to Monitor

**Authentication:**
- Failed login attempts (brute force detection)
- Token refresh rate (unusual patterns)
- Logout frequency
- Rate limit hits

**Performance:**
- Gateway response time
- Redis latency
- Database pool usage

**Security Events:**
- Token reuse attempts
- Multiple failed logins from same IP
- Blacklisted token usage attempts

### Log Examples

**Successful login:**
```json
{
  "level": "info",
  "message": "User logged in successfully",
  "userId": 123,
  "email": "user@example.com"
}
```

**Rate limit exceeded:**
```json
{
  "level": "warn",
  "message": "Rate limit exceeded",
  "ip": "192.168.1.100",
  "path": "/api/auth/login",
  "method": "POST"
}
```

**Token reuse detected:**
```json
{
  "level": "warn",
  "message": "Refresh token not found in database - possible reuse attempt",
  "userId": 123,
  "jti": "550e8400..."
}
```

---

## 🐛 Troubleshooting

### Problem: "JWT_SECRET must be at least 32 characters long"

**Solution:** Update `.env` files with stronger secrets:
```bash
# Generate strong secrets (32+ chars)
JWT_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
```

### Problem: Redis connection refused

**Solution:** Start Redis server:
```bash
# Docker
docker start redis

# Linux
sudo systemctl start redis

# Mac
brew services start redis
```

### Problem: Token expired after 24 hours

**Solution:** Check `.env` has updated value:
```bash
JWT_EXPIRES_IN=15m  # Not 24h
```

### Problem: Rate limiting not working

**Solution:** Verify Redis is connected:
```bash
redis-cli PING
# Should return: PONG
```

Check logs for "Rate limiter using Redis store"

### Problem: Service token rejected

**Solution:** Ensure token has correct type and permissions:
```javascript
const token = generateServiceToken('order-service', {
  permissions: ['read:users']  // Must match route requirements
});
```

---

## 🚀 Next Steps

### For Development

1. **Create `.env` files** from `.env.example` templates
2. **Change JWT secrets** to strong random values
3. **Start PostgreSQL and Redis**
4. **Run `npm install`** in both services
5. **Start services** with `npm run dev`

### For Production Deployment

1. **Use AWS Secrets Manager** for JWT secrets
2. **Set up AWS ElastiCache** for Redis (high availability)
3. **Configure RDS PostgreSQL** with SSL
4. **Enable CloudWatch logging**
5. **Set up Application Load Balancer** for gateway
6. **Configure Auto Scaling** for services
7. **Enable HTTPS** with valid certificates
8. **Set `NODE_ENV=production`**

### Future Enhancements

- [ ] Multi-factor authentication (2FA/TOTP)
- [ ] Email verification flow
- [ ] Password reset with secure tokens
- [ ] Session management UI (list active sessions)
- [ ] OAuth 2.0 / OpenID Connect
- [ ] API keys for third-party integrations
- [ ] Audit logs for compliance

---

## 📚 Additional Resources

- **JWT Best Practices:** https://tools.ietf.org/html/rfc8725
- **OWASP Auth Cheatsheet:** https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- **Rate Limiting Strategies:** https://blog.logrocket.com/rate-limiting-node-js/
- **Microservices Security:** https://microservices.io/patterns/security/access-token.html

---

## ✅ Implementation Checklist

- [x] Shared auth library created
- [x] JWT with 15-minute access tokens
- [x] Refresh token endpoint with rotation
- [x] Logout and logout-all endpoints
- [x] Token blacklisting with Redis
- [x] Rate limiting on auth endpoints
- [x] API Gateway with centralized auth
- [x] Service-to-service authentication
- [x] Internal API routes example
- [x] Environment configuration
- [x] Health check endpoints
- [x] Graceful shutdown handling
- [x] Error logging and monitoring
- [x] Documentation and testing guide

---

## 🎉 Success!

Your production-grade authentication system is now ready! You have:

✅ **Security:** Token revocation, rate limiting, short-lived tokens  
✅ **Scalability:** Stateless JWT, Redis caching, horizontal scaling ready  
✅ **Flexibility:** Hybrid architecture (gateway + shared library)  
✅ **Monitoring:** Request tracing, structured logging, health checks  
✅ **Best Practices:** OWASP recommendations, industry standards

**Start the services and begin testing!**
