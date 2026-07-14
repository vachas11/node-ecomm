# 🚀 E-Commerce Microservices Platform

A production-ready microservices architecture built with Node.js, demonstrating scalable API design, security best practices, and cloud deployment patterns.

## 🏗️ Architecture Overview

```
                         ┌─────────────┐
                         │   Client    │
                         └──────┬──────┘
                                │
                         ┌──────▼───────┐
                         │ API Gateway  │  ← Rate limiting, Auth, Routing
                         │   :3000      │
                         └──────┬───────┘
                                │
                ┌───────────────┼───────────────┐
                │               │               │
         ┌──────▼──────┐ ┌─────▼──────┐ ┌─────▼──────┐
         │    User     │ │  Product   │ │   Order    │
         │  Service    │ │  Service   │ │  Service   │
         │   :3001     │ │   :3002    │ │   :3003    │
         └──────┬──────┘ └─────┬──────┘ └─────┬──────┘
                │               │               │
         ┌──────▼──────┐ ┌─────▼──────┐ ┌─────▼──────┐
         │ PostgreSQL  │ │ PostgreSQL │ │ PostgreSQL │
         │   (User)    │ │ (Product)  │ │  (Order)   │
         └─────────────┘ └─────────────┘ └─────────────┘
                                │
                         ┌──────▼───────┐
                         │  RabbitMQ    │  ← Event Bus
                         └──────┬───────┘
                                │
                         ┌──────▼───────┐
                         │    Email     │
                         │   Service    │
                         └──────────────┘

         ┌─────────────────────────────────────────┐
         │   Shared Infrastructure                 │
         │  • Redis (Caching + Rate Limiting)      │
         │  • CloudWatch (Logging)                 │
         │  • ECS/Fargate (Container Orchestration)│
         └─────────────────────────────────────────┘
```

## 🎯 Key Features & Interview Highlights

### Microservices Architecture
✅ **Service Independence** - Each service has its own database  
✅ **API Gateway Pattern** - Single entry point for clients  
✅ **Event-Driven Communication** - RabbitMQ for async operations  
✅ **Service Discovery** - Ready for Consul/Eureka integration  

### Scalability Patterns
✅ **Horizontal Scaling** - Stateless services behind load balancer  
✅ **Database Connection Pooling** - Efficient resource management  
✅ **Redis Caching** - Hot data caching with TTL  
✅ **Rate Limiting** - Prevent abuse, DDoS protection  
✅ **Pagination** - Offset and cursor-based for large datasets  

### Security Best Practices
✅ **JWT Authentication** - Stateless auth with refresh tokens  
✅ **bcrypt Password Hashing** - 10 salt rounds  
✅ **Input Validation** - Joi schema validation  
✅ **SQL Injection Prevention** - Parameterized queries  
✅ **Helmet.js** - Security headers  
✅ **CORS** - Configurable cross-origin policies  
✅ **Secrets Management** - Environment variables + AWS Secrets Manager ready  

### DevOps & Deployment
✅ **Docker** - Multi-stage builds for optimal size  
✅ **docker-compose** - Local development environment  
✅ **Health Checks** - For AWS ECS, Kubernetes  
✅ **Graceful Shutdown** - Zero-downtime deployments  
✅ **CI/CD Pipeline** - GitHub Actions for automated deployment  
✅ **AWS ECS/Fargate** - Production deployment configuration  

### Observability
✅ **Structured Logging** - Winston with CloudWatch integration  
✅ **Error Tracking** - Custom error classes with stack traces  
✅ **Health Endpoints** - Monitor service + database status  
✅ **Request Tracing** - Correlation IDs across services  

## 📦 Services

| Service | Port | Status | Description |
|---------|------|--------|-------------|
| **API Gateway** | 3000 | 🚧 Building | Routing, rate limiting, authentication |
| **User Service** | 3001 | ✅ Complete | Authentication, JWT, user management |
| **Product Service** | 3002 | 🚧 Building | Product catalog, caching, pagination |
| **Order Service** | 3003 | ⏳ Pending | Order management, event publishing |
| **Email Service** | - | ⏳ Pending | Background worker, RabbitMQ consumer |

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Docker & Docker Compose
- PostgreSQL 14+
- Redis 7+
- RabbitMQ 3.12+

### Local Development

1. **Clone and install:**
   ```bash
   git clone <repo>
   cd node-js-ecomm
   ```

2. **Start infrastructure:**
   ```bash
   docker-compose up -d postgres redis rabbitmq
   ```

3. **Start services:**
   ```bash
   # Terminal 1: User Service
   cd services/user-service
   npm install
   cp .env.example .env
   npm run dev

   # Terminal 2: Product Service (coming next)
   cd services/product-service
   npm install
   cp .env.example .env
   npm run dev

   # Terminal 3: API Gateway (coming next)
   cd services/api-gateway
   npm install
   npm run dev
   ```

4. **Test endpoints:**
   ```bash
   # Health check
   curl http://localhost:3001/health

   # Register user
   curl -X POST http://localhost:3001/api/auth/register \
     -H "Content-Type: application/json" \
     -d '{
       "email": "test@example.com",
       "password": "Test@1234",
       "firstName": "John",
       "lastName": "Doe"
     }'
   ```

### Docker Deployment

```bash
# Build all services
docker-compose build

# Start entire stack
docker-compose up -d

# View logs
docker-compose logs -f

# Scale services
docker-compose up -d --scale user-service=3
```

## 🏛️ Tech Stack

| Category | Technology | Purpose |
|----------|-----------|---------|
| **Runtime** | Node.js 18 | JavaScript runtime |
| **Framework** | Express.js | Web framework |
| **Database** | PostgreSQL 14 | Relational database |
| **Cache** | Redis 7 | Caching & rate limiting |
| **Message Queue** | RabbitMQ 3.12 | Event-driven communication |
| **Authentication** | JWT + bcrypt | Secure auth |
| **Validation** | Joi | Schema validation |
| **Security** | Helmet.js | HTTP headers |
| **Logging** | Winston | Structured logging |
| **Containers** | Docker | Containerization |
| **Cloud** | AWS ECS/Fargate | Container orchestration |
| **CI/CD** | GitHub Actions | Automated deployment |

## 📚 Documentation

- [User Service Documentation](./docs/USER-SERVICE.md)
- Product Service Documentation (coming soon)
- API Gateway Documentation (coming soon)
- Deployment Guide (coming soon)

## 🎓 Interview Preparation Guide

### System Design Questions You Can Answer

**"Design a scalable e-commerce backend"**
- Show this architecture diagram
- Explain microservices decomposition
- Discuss database-per-service pattern
- Demonstrate horizontal scaling with load balancer

**"How do you handle authentication in microservices?"**
- JWT stateless authentication
- Token verification at API Gateway
- Refresh token rotation
- Role-based authorization

**"How would you scale this to 1 million concurrent users?"**
- Horizontal scaling with auto-scaling groups
- Database read replicas + connection pooling
- Redis cluster for distributed caching
- Message queue for async operations
- CDN for static assets

**"How do you ensure security?"**
- bcrypt password hashing
- JWT with short expiration
- Input validation at all layers
- SQL injection prevention
- Helmet.js security headers
- Secrets management (AWS Secrets Manager)
- Rate limiting

**"Explain your deployment strategy"**
- Docker containers for consistency
- AWS ECS/Fargate for orchestration
- Blue-green deployment for zero downtime
- Health checks for automatic rollback
- CI/CD pipeline for automated testing + deployment

## 🔄 Development Progress

- [x] Project structure setup
- [x] Shared utilities (logger, errors, database, redis)
- [x] User Service (JWT auth, bcrypt, PostgreSQL)
- [ ] Product Service (caching, pagination)
- [ ] Order Service (event publishing)
- [ ] Email Service (event consumer)
- [ ] API Gateway (routing, rate limiting)
- [ ] Docker configuration
- [ ] docker-compose setup
- [ ] AWS deployment configs
- [ ] CI/CD pipeline
- [ ] Monitoring & alerting

## 📧 Contact

Built as an interview preparation project demonstrating:
- Senior-level Node.js development
- Microservices architecture
- Scalable system design
- Security best practices
- Cloud deployment (AWS)
- Production-ready code patterns

---

**Next Steps:** Continue building Product Service with Redis caching and pagination patterns.
