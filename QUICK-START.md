# Quick Start Guide - Production Auth System

## ✅ All Phases Complete!

Your production-grade authentication system has been fully implemented. Here's what to do next:

## 🚀 Quick Start (5 Minutes)

### 1. Install Dependencies

```bash
# User Service
cd services/user-service
npm install

# API Gateway
cd ../api-gateway  
npm install
```

### 2. Start Redis

```bash
# Using Docker (recommended)
docker run -d -p 6379:6379 --name redis redis:7-alpine

# Verify it's running
redis-cli PING
# Should return: PONG
```

### 3. Set Up Environment Variables

```bash
# User Service
cd services/user-service
cp .env.example .env

# API Gateway
cd ../api-gateway
cp .env.example .env

# ⚠️ IMPORTANT: Change JWT secrets in both .env files!
# Generate strong secrets:
openssl rand -hex 32
```

### 4. Start Services

**Terminal 1:**
```bash
cd services/user-service
npm run dev
```

**Terminal 2:**
```bash
cd services/api-gateway
npm run dev
```

### 5. Test It Works

```bash
# Register a user
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "SecurePass123!",
    "firstName": "John",
    "lastName": "Doe"
  }'

# You should get back tokens!
```

## 📋 What Was Built

### Phase 1: Shared Auth Library ✅
- `/shared/auth/jwt.js` - JWT generation with 15min access tokens
- `/shared/auth/middleware.js` - Authentication middleware
- `/shared/auth/blacklist.js` - Token revocation with Redis
- `/shared/auth/rateLimiter.js` - Rate limiting presets

### Phase 2: User Service Security ✅
- **New Endpoints:**
  - `POST /api/auth/refresh` - Refresh token with rotation
  - `POST /api/auth/logout` - Logout current device
  - `POST /api/auth/logout-all` - Logout all devices
- **Security:**
  - Refresh tokens stored as SHA-256 hashes
  - Token rotation on every refresh
  - Rate limiting (5 login attempts per 15 min)

### Phase 3: API Gateway ✅
- Central entry point on port 3000
- JWT verification before proxying
- User context forwarding to services
- Service health monitoring
- Global rate limiting

### Phase 4: Service-to-Service Auth ✅
- Service token generation
- Internal API routes (`/api/internal/*`)
- Permission-based authorization

## 🔐 Key Security Features

| Feature | Implemented |
|---------|-------------|
| 15-minute access tokens | ✅ |
| Refresh token rotation | ✅ |
| Token revocation (logout) | ✅ |
| Rate limiting | ✅ |
| Brute force protection | ✅ |
| Service-to-service auth | ✅ |
| Redis blacklist | ✅ |

## 📡 API Endpoints

### Public Routes (No Auth)
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login
- `POST /api/auth/refresh` - Refresh access token

### Protected Routes (Auth Required)
- `GET /api/auth/profile` - Get user profile
- `PUT /api/auth/profile` - Update profile
- `PUT /api/auth/change-password` - Change password
- `POST /api/auth/logout` - Logout
- `POST /api/auth/logout-all` - Logout all devices

### Health Checks
- `GET http://localhost:3000/health` - Gateway health
- `GET http://localhost:3001/health` - User service health

## 🧪 Quick Test

```bash
# 1. Register
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"Test123!","firstName":"Test","lastName":"User"}'

# 2. Login  
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"Test123!"}'

# 3. Save the accessToken from response, then:
curl -X GET http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer <your-access-token>"
```

## ⚠️ Before Production

1. **Change JWT secrets** (min 32 characters, randomly generated)
2. **Enable HTTPS** for all services
3. **Use AWS Secrets Manager** for secrets
4. **Set up AWS ElastiCache** for Redis
5. **Configure RDS PostgreSQL** with SSL
6. **Enable CloudWatch** logging
7. **Set NODE_ENV=production**

## 📖 Full Documentation

See [IMPLEMENTATION-GUIDE.md](./IMPLEMENTATION-GUIDE.md) for:
- Complete testing guide
- Security features explained
- Database verification
- Troubleshooting
- Production deployment checklist
- Architecture diagrams

## 🎯 Architecture

```
Client → API Gateway (3000) → User Service (3001)
                  ↓
              Redis (6379)
                  ↓
           PostgreSQL (5432)
```

## 🆘 Troubleshooting

**Redis connection failed?**
```bash
docker start redis
# or
redis-server
```

**"JWT_SECRET too short"?**
```bash
# Generate in .env files (min 32 chars):
JWT_SECRET=$(openssl rand -hex 32)
```

**Database error?**
```bash
# Create database:
createdb user_db
```

## ✨ Next Steps

1. **Start development** - Both services are ready
2. **Add product/order services** - Use same auth patterns
3. **Implement 2FA** - Future enhancement
4. **Add email verification** - Future enhancement
5. **Set up CI/CD** - Automated deployments

---

**Need help?** Check [IMPLEMENTATION-GUIDE.md](./IMPLEMENTATION-GUIDE.md) for detailed documentation.

**Ready to deploy?** Follow the production checklist in the implementation guide.

🎉 **Your production-grade auth system is ready!**
