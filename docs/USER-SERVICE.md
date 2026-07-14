# User Service Documentation

## Overview
Authentication and user management microservice built with Node.js, Express, PostgreSQL, and JWT.

## Features Implemented

### 🔐 Security
- **JWT Authentication** with access and refresh tokens
- **bcrypt** password hashing (10 salt rounds)
- **Password strength validation** (uppercase, lowercase, numbers, special chars)
- **Helmet.js** for security headers
- **CORS** configuration
- **Input validation** with Joi

### 🏗️ Architecture Patterns
- **Connection pooling** for PostgreSQL (20 max connections)
- **Graceful shutdown** handling
- **Health check endpoint** for AWS ECS/Kubernetes
- **Structured logging** with Winston
- **Custom error handling** with typed errors
- **Async handler** wrapper to avoid try-catch hell

### 📡 API Endpoints

#### Public Endpoints
```
POST /api/auth/register
Body: {
  email: string (required),
  password: string (required, min 8 chars),
  firstName: string (optional),
  lastName: string (optional)
}
Response: { user, tokens: { accessToken, refreshToken } }

POST /api/auth/login
Body: {
  email: string,
  password: string
}
Response: { user, tokens }
```

#### Protected Endpoints (Require JWT)
```
GET /api/auth/profile
Headers: Authorization: Bearer <access_token>
Response: { user }

PUT /api/auth/profile
Headers: Authorization: Bearer <access_token>
Body: {
  firstName: string (optional),
  lastName: string (optional),
  email: string (optional)
}
Response: { user }

PUT /api/auth/change-password
Headers: Authorization: Bearer <access_token>
Body: {
  currentPassword: string,
  newPassword: string
}
Response: { message }
```

#### Health Check
```
GET /health
Response: {
  status: 'healthy',
  service: 'user-service',
  timestamp: ISO string,
  uptime: seconds,
  database: { status, pool: { total, idle, waiting } }
}
```

## Database Schema

### Users Table
```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  role VARCHAR(50) DEFAULT 'customer',
  is_active BOOLEAN DEFAULT true,
  email_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexed on email for fast lookups
CREATE INDEX idx_users_email ON users(email);
```

### Refresh Tokens Table
```sql
CREATE TABLE refresh_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
```

## Environment Variables

See `.env.example` for all configuration options:

```env
# Required
NODE_ENV=development
PORT=3001
DB_HOST=localhost
DB_NAME=user_db
DB_USER=postgres
DB_PASSWORD=postgres
JWT_SECRET=your-secret-key
JWT_REFRESH_SECRET=your-refresh-secret

# Optional
DB_POOL_MAX=20
JWT_EXPIRES_IN=24h
JWT_REFRESH_EXPIRES_IN=7d
LOG_LEVEL=info
```

## Running Locally

1. **Install dependencies:**
   ```bash
   cd services/user-service
   npm install
   ```

2. **Set up PostgreSQL database:**
   ```bash
   createdb user_db
   ```

3. **Create `.env` file:**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Start service:**
   ```bash
   npm run dev
   ```

5. **Test health check:**
   ```bash
   curl http://localhost:3001/health
   ```

## Docker Usage

```bash
# Build image
docker build -t user-service .

# Run container
docker run -p 3001:3001 \
  -e DB_HOST=host.docker.internal \
  -e DB_NAME=user_db \
  -e DB_USER=postgres \
  -e DB_PASSWORD=postgres \
  -e JWT_SECRET=secret \
  -e JWT_REFRESH_SECRET=refresh-secret \
  user-service
```

## Scalability Features

### Horizontal Scaling
- **Stateless design** - JWT tokens contain all user info
- **Connection pooling** - Reuses DB connections efficiently
- **No session storage** - Can run multiple instances behind load balancer

### Performance
- **Indexed queries** - Email lookups are O(log n)
- **Prepared statements** - SQL injection prevention + query caching
- **Minimal database calls** - Single query for most operations

### AWS Deployment Ready
- **Health checks** for ECS target groups
- **Graceful shutdown** for zero-downtime deployments
- **CloudWatch logs** support (Winston transports)
- **SSL/TLS** database connections for RDS

## Interview Talking Points

### "How do you handle authentication in a microservices architecture?"
✅ JWT tokens are stateless - no shared session storage needed
✅ Each service can independently verify tokens with shared secret
✅ Refresh token rotation prevents token theft
✅ Short-lived access tokens (24h) + long-lived refresh tokens (7d)

### "How do you scale this service?"
✅ Horizontal scaling with load balancer (stateless)
✅ Database connection pooling (20 connections per instance)
✅ Read replicas for read-heavy operations
✅ Redis caching for hot user data (implemented in API Gateway)

### "How do you ensure security?"
✅ Bcrypt password hashing (salted, 10 rounds)
✅ Password strength validation
✅ JWT token expiration
✅ Helmet.js security headers
✅ Input validation with Joi
✅ Parameterized SQL queries (injection prevention)
✅ Non-root Docker user

### "How do you handle errors?"
✅ Typed error classes (ValidationError, UnauthorizedError, etc.)
✅ Global error handler middleware
✅ Structured error logging with Winston
✅ Different error responses for dev vs production
✅ Async error handling wrapper
