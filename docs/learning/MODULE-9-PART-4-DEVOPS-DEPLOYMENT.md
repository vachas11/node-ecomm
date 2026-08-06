# MODULE-9 PART 4: DEVOPS & DEPLOYMENT

**Lead-Level Interview Questions with Perfect Answers**

**Questions 76-90: DevOps & Deployment**

---

## Q76: How do you deploy Node.js applications with zero downtime?

**Perfect Answer:**

"Zero-downtime deployment keeps old version running while new version starts, then switches traffic.

**Rolling Deployment Strategy:**
```
Step 1: 4 servers running v1.0
        [v1.0] [v1.0] [v1.0] [v1.0]

Step 2: Deploy v1.1 to server 1, remove from load balancer
        [v1.1] [v1.0] [v1.0] [v1.0]
                ↑
            Health check

Step 3: Add server 1 back, deploy to server 2
        [v1.1] [v1.1] [v1.0] [v1.0]

Step 4: Continue until all servers upgraded
        [v1.1] [v1.1] [v1.1] [v1.1]

Result: No downtime! Traffic always served by healthy servers
```

**Implementation with PM2:**
```bash
# ecosystem.config.js
module.exports = {
  apps: [{
    name: 'api',
    script: './server.js',
    instances: 4,
    exec_mode: 'cluster',
    wait_ready: true,           # Wait for app to signal ready
    listen_timeout: 10000,       # Timeout for ready signal
    kill_timeout: 5000           # Time to shutdown gracefully
  }]
};

# Deploy (zero downtime)
pm2 reload ecosystem.config.js

# PM2 reloads workers one by one:
# 1. Start new worker
# 2. Wait for ready signal
# 3. Kill old worker
# 4. Repeat for all workers
```

**Kubernetes Rolling Update:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
spec:
  replicas: 4
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1         # Max 1 extra pod during update
      maxUnavailable: 0   # Min 0 pods down (zero downtime!)
  template:
    spec:
      containers:
      - name: api
        image: api:v1.1
        readinessProbe:   # Health check
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
        lifecycle:
          preStop:        # Graceful shutdown
            exec:
              command: ["/bin/sh", "-c", "sleep 15"]

# Apply update
kubectl apply -f deployment.yaml

# K8s automatically:
# 1. Creates new pod
# 2. Waits for readiness probe
# 3. Routes traffic to new pod
# 4. Removes old pod
# 5. Repeats for all pods
```

**Blue-Green Deployment:**
```
Blue (v1.0) - Currently serving traffic
Green (v1.1) - New version deployed, not serving traffic

Step 1: Deploy v1.1 to Green environment
        Blue[v1.0] ← Load Balancer (100% traffic)
        Green[v1.1] (0% traffic)

Step 2: Test Green environment

Step 3: Switch traffic to Green
        Blue[v1.0] (0% traffic)
        Green[v1.1] ← Load Balancer (100% traffic)

Step 4: If issues, instant rollback (switch back to Blue)
```

**Graceful Shutdown:**
```javascript
// server.js
const express = require('express');
const app = express();

const server = app.listen(3000, () => {
  console.log('Server started');
  
  // Signal PM2 that app is ready
  if (process.send) {
    process.send('ready');
  }
});

// Graceful shutdown on SIGTERM
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  
  // Stop accepting new connections
  server.close(() => {
    console.log('HTTP server closed');
    
    // Close database connections
    db.end(() => {
      console.log('Database connections closed');
      process.exit(0);
    });
  });
  
  // Force shutdown after 30s
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
});
```

**Health Checks:**
```javascript
// Liveness probe (is app running?)
app.get('/health/live', (req, res) => {
  res.json({ status: 'alive' });
});

// Readiness probe (is app ready to serve traffic?)
app.get('/health/ready', async (req, res) => {
  try {
    // Check database
    await db.query('SELECT 1');
    
    // Check Redis
    await redis.ping();
    
    res.json({ status: 'ready' });
  } catch (error) {
    res.status(503).json({ status: 'not ready', error: error.message });
  }
});
```

**Interview tip:** Explain rolling deployment (update servers one by one, traffic always served), show PM2 reload command and K8s rolling update strategy (maxSurge/maxUnavailable), demonstrate graceful shutdown (stop accepting new connections, finish current requests, close resources), mention blue-green deployment for instant rollback."

---

## Q77: How do you implement CI/CD pipelines for Node.js?

**Perfect Answer:**

"CI/CD automates testing, building, and deployment. Ensures code quality before production.

**CI/CD Pipeline Stages:**
```
1. Code Push (GitHub)
     ↓
2. CI: Automated Tests (GitHub Actions)
   - Lint (ESLint)
   - Unit tests (Jest)
   - Integration tests
   - Security scan (npm audit)
     ↓
3. Build
   - Docker image
   - Version tag
     ↓
4. CD: Deploy
   - Staging (auto)
   - Production (manual approval)
```

**GitHub Actions:**
```yaml
# .github/workflows/ci-cd.yml
name: CI/CD

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:14
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      
      redis:
        image: redis:7
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        cache: 'npm'
    
    - name: Install dependencies
      run: npm ci
    
    - name: Lint
      run: npm run lint
    
    - name: Run tests
      run: npm test
      env:
        DATABASE_URL: postgresql://postgres:postgres@localhost:5432/test
        REDIS_URL: redis://localhost:6379
    
    - name: Security audit
      run: npm audit --audit-level=high
    
    - name: Upload coverage
      uses: codecov/codecov-action@v3
      with:
        files: ./coverage/coverage-final.json

  build:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Docker login
      uses: docker/login-action@v2
      with:
        username: ${{ secrets.DOCKER_USERNAME }}
        password: ${{ secrets.DOCKER_PASSWORD }}
    
    - name: Build and push
      uses: docker/build-push-action@v4
      with:
        context: .
        push: true
        tags: |
          myapp/api:${{ github.sha }}
          myapp/api:latest

  deploy-staging:
    needs: build
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    
    steps:
    - name: Deploy to staging
      run: |
        kubectl set image deployment/api api=myapp/api:${{ github.sha }} \
          --namespace=staging \
          --kubeconfig=${{ secrets.KUBECONFIG }}
    
    - name: Wait for rollout
      run: |
        kubectl rollout status deployment/api \
          --namespace=staging \
          --timeout=5m
    
    - name: Run smoke tests
      run: |
        curl -f https://staging.myapp.com/health || exit 1

  deploy-production:
    needs: deploy-staging
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    environment: production  # Requires manual approval
    
    steps:
    - name: Deploy to production
      run: |
        kubectl set image deployment/api api=myapp/api:${{ github.sha }} \
          --namespace=production \
          --kubeconfig=${{ secrets.KUBECONFIG }}
    
    - name: Wait for rollout
      run: |
        kubectl rollout status deployment/api \
          --namespace=production \
          --timeout=10m
    
    - name: Notify Slack
      uses: slackapi/slack-github-action@v1
      with:
        payload: |
          {
            "text": "✅ Deployed ${{ github.sha }} to production"
          }
      env:
        SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK }}
```

**Dockerfile (Multi-Stage Build):**
```dockerfile
# Stage 1: Build
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including devDependencies)
RUN npm ci

# Copy source
COPY . .

# Run tests
RUN npm test

# Build (if using TypeScript)
RUN npm run build

# Stage 2: Production
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ONLY production dependencies
RUN npm ci --only=production

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001
USER nodejs

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

EXPOSE 3000

CMD ["node", "dist/server.js"]
```

**GitLab CI:**
```yaml
# .gitlab-ci.yml
stages:
  - test
  - build
  - deploy

variables:
  DOCKER_IMAGE: $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA

test:
  stage: test
  image: node:18
  services:
    - postgres:14
    - redis:7
  variables:
    DATABASE_URL: postgresql://postgres:postgres@postgres:5432/test
    REDIS_URL: redis://redis:6379
  script:
    - npm ci
    - npm run lint
    - npm test
    - npm audit --audit-level=high
  coverage: '/All files[^|]*\|[^|]*\s+([\d\.]+)/'
  artifacts:
    reports:
      coverage_report:
        coverage_format: cobertura
        path: coverage/cobertura-coverage.xml

build:
  stage: build
  image: docker:latest
  services:
    - docker:dind
  before_script:
    - docker login -u $CI_REGISTRY_USER -p $CI_REGISTRY_PASSWORD $CI_REGISTRY
  script:
    - docker build -t $DOCKER_IMAGE .
    - docker push $DOCKER_IMAGE
  only:
    - main

deploy_staging:
  stage: deploy
  image: alpine/helm:latest
  script:
    - helm upgrade --install api ./helm \
        --set image.tag=$CI_COMMIT_SHA \
        --namespace staging
  only:
    - main

deploy_production:
  stage: deploy
  image: alpine/helm:latest
  script:
    - helm upgrade --install api ./helm \
        --set image.tag=$CI_COMMIT_SHA \
        --namespace production
  when: manual  # Manual trigger
  only:
    - main
```

**Best Practices:**
```
1. Run tests on every push
   ✅ Catch bugs early

2. Use Docker multi-stage builds
   ✅ Smaller image size (400MB → 150MB)

3. Separate staging and production
   ✅ Test before production

4. Require manual approval for production
   ✅ Prevent accidental deployments

5. Automated rollback on failure
   ✅ Minimize downtime

6. Notify team on deployment
   ✅ Slack, email, PagerDuty
```

**Interview tip:** Show CI/CD pipeline stages (test → build → deploy), demonstrate GitHub Actions workflow with tests/build/deploy, show Dockerfile multi-stage build (smaller production image), mention manual approval for production, explain automated rollback on health check failure."

---

## Q78: How do you monitor Node.js applications in production?

**Perfect Answer:**

"Monitor metrics (CPU, memory, requests), logs (errors, warnings), and traces (request flow) to detect and debug issues.

**Monitoring Stack:**
```
Metrics: Prometheus + Grafana
Logs: Winston + ELK Stack (Elasticsearch, Logstash, Kibana)
Traces: OpenTelemetry + Jaeger
Alerts: PagerDuty, Slack
```

**Application Metrics:**
```javascript
const promClient = require('prom-client');

// Create metrics registry
const register = new promClient.Registry();

// Collect default metrics (CPU, memory, event loop lag)
promClient.collectDefaultMetrics({ register });

// Custom metrics
const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.5, 1, 2, 5]
});
register.registerMetric(httpRequestDuration);

const httpRequestTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code']
});
register.registerMetric(httpRequestTotal);

const activeConnections = new promClient.Gauge({
  name: 'active_connections',
  help: 'Number of active connections'
});
register.registerMetric(activeConnections);

// Middleware to track metrics
app.use((req, res, next) => {
  const start = Date.now();
  
  activeConnections.inc();
  
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    
    httpRequestDuration
      .labels(req.method, req.route?.path || req.path, res.statusCode)
      .observe(duration);
    
    httpRequestTotal
      .labels(req.method, req.route?.path || req.path, res.statusCode)
      .inc();
    
    activeConnections.dec();
  });
  
  next();
});

// Metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```

**Prometheus Scraping:**
```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'api'
    scrape_interval: 15s
    static_configs:
      - targets: ['api-1:3000', 'api-2:3000', 'api-3:3000']
        labels:
          environment: 'production'
```

**Grafana Dashboard:**
```
Panels:
1. Request Rate (req/sec)
   - Query: rate(http_requests_total[5m])

2. Error Rate
   - Query: rate(http_requests_total{status_code=~"5.."}[5m])

3. P95 Latency
   - Query: histogram_quantile(0.95, http_request_duration_seconds_bucket)

4. Memory Usage
   - Query: process_resident_memory_bytes

5. Event Loop Lag
   - Query: nodejs_eventloop_lag_seconds

6. Active Connections
   - Query: active_connections

Alerts:
- High error rate (> 5%)
- High latency (P95 > 1s)
- High memory (> 80%)
- Event loop lag (> 100ms)
```

**Structured Logging:**
```javascript
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: {
    service: 'api',
    environment: process.env.NODE_ENV,
    version: process.env.VERSION
  },
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    logger.info('HTTP request', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: Date.now() - start,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      userId: req.user?.id,
      requestId: req.id
    });
  });
  
  next();
});

// Error logging
app.use((err, req, res, next) => {
  logger.error('Request error', {
    error: err.message,
    stack: err.stack,
    method: req.method,
    path: req.path,
    userId: req.user?.id,
    requestId: req.id
  });
  
  res.status(500).json({ error: 'Internal server error' });
});
```

**Distributed Tracing:**
```javascript
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const { JaegerExporter } = require('@opentelemetry/exporter-jaeger');

// Configure tracing
const provider = new NodeTracerProvider({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'api',
  }),
});

const exporter = new JaegerExporter({
  endpoint: 'http://jaeger:14268/api/traces',
});

provider.addSpanProcessor(new BatchSpanProcessor(exporter));
provider.register();

// Auto-instrument HTTP
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
const { registerInstrumentations } = require('@opentelemetry/instrumentation');

registerInstrumentations({
  instrumentations: [
    new HttpInstrumentation(),
  ],
});

// Now all HTTP requests are traced automatically
// View traces in Jaeger UI to see request flow across services
```

**Alerting:**
```yaml
# Prometheus alerts
groups:
  - name: api
    rules:
      - alert: HighErrorRate
        expr: rate(http_requests_total{status_code=~"5.."}[5m]) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High error rate detected"
          description: "Error rate is {{ $value | humanizePercentage }}"
      
      - alert: HighLatency
        expr: histogram_quantile(0.95, http_request_duration_seconds_bucket) > 1
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "High latency detected"
          description: "P95 latency is {{ $value }}s"
      
      - alert: HighMemoryUsage
        expr: process_resident_memory_bytes / process_virtual_memory_max_bytes > 0.8
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High memory usage"
          description: "Memory usage is {{ $value | humanizePercentage }}"
```

**Interview tip:** Show Prometheus for metrics collection (request rate, latency, errors), Grafana for dashboards and alerts, Winston for structured logging (JSON logs with context), OpenTelemetry for distributed tracing (track requests across services), mention alert rules (high error rate, latency, memory)."

---

## Q79: What is Docker and how do you containerize Node.js apps?

**Perfect Answer:**

"Docker packages applications with dependencies into containers - lightweight, isolated, portable environments.

**Why Docker:**
```
Without Docker:
- "Works on my machine" (dependency conflicts)
- Manual setup (install Node.js, PostgreSQL, Redis)
- Environment drift (dev ≠ staging ≠ production)

With Docker:
✅ Consistent environments (same container everywhere)
✅ Easy setup (docker-compose up)
✅ Isolation (dependencies don't conflict)
✅ Portable (run anywhere with Docker)
```

**Dockerfile:**
```dockerfile
# Use official Node.js image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files first (layer caching)
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start application
CMD ["node", "server.js"]
```

**Build and Run:**
```bash
# Build image
docker build -t my-api:1.0 .

# Run container
docker run -d \
  --name api \
  -p 3000:3000 \
  -e DATABASE_URL=postgresql://user:pass@db:5432/mydb \
  -e REDIS_URL=redis://redis:6379 \
  my-api:1.0

# View logs
docker logs api

# Execute command in container
docker exec -it api sh

# Stop container
docker stop api

# Remove container
docker rm api
```

**Docker Compose (Multi-Container):**
```yaml
# docker-compose.yml
version: '3.8'

services:
  api:
    build: .
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://postgres:postgres@db:5432/mydb
      REDIS_URL: redis://redis:6379
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 3s
      retries: 3
  
  db:
    image: postgres:14-alpine
    environment:
      POSTGRES_DB: mydb
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
  
  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5

volumes:
  postgres_data:
  redis_data:
```

**Commands:**
```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f api

# Stop all services
docker-compose down

# Rebuild and restart
docker-compose up -d --build
```

**Multi-Stage Build (Smaller Image):**
```dockerfile
# Stage 1: Build
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build  # If using TypeScript

# Stage 2: Production
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist
USER nodejs
CMD ["node", "dist/server.js"]

# Result: 400MB → 150MB (2.7× smaller!)
```

**Interview tip:** Explain Docker provides consistent isolated environments, show Dockerfile with multi-stage build (smaller image), demonstrate docker-compose for multi-container setup (app + database + Redis), mention benefits (works everywhere, easy setup, no dependency conflicts)."

---

## Q80: How do you use Kubernetes to orchestrate containers?

**Perfect Answer:**

"Kubernetes manages containerized applications - handles deployment, scaling, self-healing, load balancing.

**Kubernetes Architecture:**
```
Control Plane:
- API Server (kubectl commands)
- Scheduler (assign pods to nodes)
- Controller Manager (maintain desired state)
- etcd (cluster data store)

Worker Nodes:
- kubelet (run containers)
- kube-proxy (network routing)
- Container Runtime (Docker, containerd)
```

**Deployment:**
```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: production
spec:
  replicas: 3  # 3 pods
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
    spec:
      containers:
      - name: api
        image: myapp/api:1.0
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: "production"
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: url
        resources:
          requests:
            cpu: 200m
            memory: 256Mi
          limits:
            cpu: 500m
            memory: 512Mi
        livenessProbe:
          httpGet:
            path: /health/live
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health/ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
```

**Service (Load Balancer):**
```yaml
# service.yaml
apiVersion: v1
kind: Service
metadata:
  name: api-service
spec:
  type: LoadBalancer
  selector:
    app: api
  ports:
  - port: 80
    targetPort: 3000
```

**ConfigMap & Secret:**
```yaml
# configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: api-config
data:
  LOG_LEVEL: "info"
  MAX_CONNECTIONS: "100"

# secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: db-secret
type: Opaque
data:
  url: cG9zdGdyZXNxbDovL3VzZXI6cGFzc0BkYjozNDMyL215ZGI=  # base64 encoded
```

**Horizontal Pod Autoscaler:**
```yaml
# hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api
  minReplicas: 3
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80

# K8s automatically scales pods based on CPU/memory
# High load: scale up to 10 pods
# Low load: scale down to 3 pods
```

**Commands:**
```bash
# Apply configuration
kubectl apply -f deployment.yaml
kubectl apply -f service.yaml
kubectl apply -f hpa.yaml

# Get pods
kubectl get pods -n production

# Get services
kubectl get svc -n production

# View logs
kubectl logs -f api-5d7c8f9b4-xyz -n production

# Execute command in pod
kubectl exec -it api-5d7c8f9b4-xyz -n production -- sh

# Scale manually
kubectl scale deployment api --replicas=5 -n production

# Rolling update
kubectl set image deployment/api api=myapp/api:1.1 -n production

# Rollback
kubectl rollout undo deployment/api -n production

# View rollout status
kubectl rollout status deployment/api -n production
```

**Benefits:**
```
✅ Self-healing (restart failed pods)
✅ Auto-scaling (based on CPU/memory)
✅ Load balancing (distribute traffic)
✅ Rolling updates (zero downtime)
✅ Secret management (encrypted secrets)
✅ Service discovery (DNS for services)
```

**Interview tip:** Explain Kubernetes orchestrates containers (deployment, scaling, self-healing), show Deployment manifest with replicas/resources/probes, demonstrate HorizontalPodAutoscaler (auto-scale 3-10 pods), mention rolling updates (zero downtime) and auto-rollback on failure."

---

---

## Q81: How do you implement environment variables securely?

**Perfect Answer:**

"Store secrets in secure vaults (AWS Secrets Manager, HashiCorp Vault), inject at runtime, never commit to git.

**❌ BAD: Hardcoded Secrets:**
```javascript
const config = {
  dbPassword: 'mypassword123',  // Committed to git!
  apiKey: 'sk-abc123xyz'        // Exposed in code
};
```

**✅ GOOD: Environment Variables:**
```javascript
// .env (never commit!)
DATABASE_URL=postgresql://user:password@localhost:5432/mydb
API_KEY=sk-abc123xyz
JWT_SECRET=supersecret123

// .gitignore
.env
.env.local

// Load with dotenv
require('dotenv').config();

const config = {
  databaseUrl: process.env.DATABASE_URL,
  apiKey: process.env.API_KEY,
  jwtSecret: process.env.JWT_SECRET
};
```

**Docker Secrets:**
```bash
# Create secret
docker secret create db_password ./password.txt

# Use in service
docker service create \
  --name api \
  --secret db_password \
  myapp/api:1.0

# Access in container
const password = fs.readFileSync('/run/secrets/db_password', 'utf8');
```

**Kubernetes Secrets:**
```yaml
# Create secret
kubectl create secret generic db-secret \
  --from-literal=password=mypassword

# Use in pod
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: api
    env:
    - name: DATABASE_PASSWORD
      valueFrom:
        secretKeyRef:
          name: db-secret
          key: password
```

**AWS Secrets Manager:**
```javascript
const AWS = require('aws-sdk');
const secretsManager = new AWS.SecretsManager({ region: 'us-east-1' });

async function getSecret(secretName) {
  const data = await secretsManager.getSecretValue({ SecretId: secretName }).promise();
  return JSON.parse(data.SecretString);
}

// Load secrets at startup
const dbCreds = await getSecret('prod/database');
const apiKeys = await getSecret('prod/api-keys');

// Use in application
const pool = new Pool({
  host: dbCreds.host,
  user: dbCreds.username,
  password: dbCreds.password
});
```

**Interview tip:** Show environment variables with dotenv (never commit .env), demonstrate Kubernetes Secrets (base64 encoded, encrypted at rest), mention AWS Secrets Manager for production (automatic rotation, audit logs), emphasize never commit secrets to git."

---

## Q82: What is Infrastructure as Code (IaC)?

**Perfect Answer:**

"IaC manages infrastructure through code files (version controlled, reproducible) instead of manual configuration.

**Terraform Example:**
```hcl
# main.tf
provider "aws" {
  region = "us-east-1"
}

# VPC
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
  
  tags = {
    Name = "production-vpc"
  }
}

# Subnet
resource "aws_subnet" "public" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
  
  tags = {
    Name = "public-subnet"
  }
}

# EC2 Instance
resource "aws_instance" "api" {
  ami           = "ami-0c55b159cbfafe1f0"
  instance_type = "t3.medium"
  subnet_id     = aws_subnet.public.id
  
  user_data = <<-EOF
    #!/bin/bash
    curl -sL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
    npm install -g pm2
  EOF
  
  tags = {
    Name = "api-server"
  }
}

# RDS Database
resource "aws_db_instance" "postgres" {
  engine         = "postgres"
  engine_version = "14.7"
  instance_class = "db.t3.medium"
  allocated_storage = 100
  
  db_name  = "myapp"
  username = "admin"
  password = var.db_password
  
  backup_retention_period = 7
  
  tags = {
    Name = "production-db"
  }
}
```

**Commands:**
```bash
# Initialize
terraform init

# Plan (preview changes)
terraform plan

# Apply (create infrastructure)
terraform apply

# Destroy (remove infrastructure)
terraform destroy
```

**Benefits:**
```
✅ Version controlled (git)
✅ Reproducible (same config = same infra)
✅ Automated (no manual clicking)
✅ Documented (code is documentation)
✅ Testable (validate before apply)
```

**Interview tip:** Explain IaC as infrastructure defined in code files (Terraform, CloudFormation), show Terraform example (VPC, EC2, RDS), mention benefits (version controlled, reproducible, automated vs manual console clicking)."

---

## Q83: How do you handle database migrations in production?

**Perfect Answer:**

"Database migrations modify schema safely - versioned, tested, reversible, with zero downtime.

**Migration Tool (node-pg-migrate):**
```javascript
// migrations/1674000000000_create-users-table.js
exports.up = (pgm) => {
  pgm.createTable('users', {
    id: 'id',
    email: { type: 'varchar(255)', notNull: true, unique: true },
    password_hash: { type: 'varchar(255)', notNull: true },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp')
    }
  });
  
  pgm.createIndex('users', 'email');
};

exports.down = (pgm) => {
  pgm.dropTable('users');
};
```

**Run Migrations:**
```bash
# Run pending migrations
npm run migrate up

# Rollback last migration
npm run migrate down

# Create new migration
npm run migrate create add-username-to-users
```

**Zero-Downtime Migration:**
```javascript
// ❌ BAD: Breaking change
exports.up = (pgm) => {
  pgm.renameColumn('users', 'name', 'full_name');
  // Old code breaks immediately!
};

// ✅ GOOD: Multi-step
// Step 1: Add new column
exports.up = (pgm) => {
  pgm.addColumn('users', {
    full_name: { type: 'varchar(255)' }
  });
};

// Step 2: Backfill data
exports.up = (pgm) => {
  pgm.sql('UPDATE users SET full_name = name WHERE full_name IS NULL');
};

// Step 3: Deploy code using full_name (dual-write to both)

// Step 4: Remove old column (after code deployed)
exports.up = (pgm) => {
  pgm.dropColumn('users', 'name');
};
```

**Blue-Green Database Migration:**
```
1. Blue (old version) running
2. Create Green database (new schema)
3. Replicate data Blue → Green
4. Test Green
5. Switch traffic to Green
6. Keep Blue as backup for 24h
7. Remove Blue
```

**Interview tip:** Show versioned migrations with up/down functions, demonstrate zero-downtime migration (add column → backfill → deploy code → remove old column), mention testing migrations on staging before production, explain rollback strategy."

---

## Q84: What is blue-green deployment?

**Perfect Answer:**

"Blue-green deployment runs two identical environments (Blue: current, Green: new version), switches traffic instantly, allows instant rollback.

**Process:**
```
Step 1: Blue environment serving production traffic
        Blue (v1.0) ← Load Balancer (100%)
        Green (idle)

Step 2: Deploy v1.1 to Green environment
        Blue (v1.0) ← Load Balancer (100%)
        Green (v1.1) deployed, not serving traffic

Step 3: Test Green (smoke tests, health checks)
        curl https://green.myapp.com/health

Step 4: Switch traffic to Green (instant!)
        Blue (v1.0) (0%)
        Green (v1.1) ← Load Balancer (100%)

Step 5: Monitor Green
        If issues: Switch back to Blue (instant rollback!)
        If OK: Keep Blue for 24h, then decommission
```

**AWS Implementation:**
```
Using ELB + Auto Scaling Groups:

1. Blue ASG (v1.0) + ALB Target Group Blue
2. Deploy v1.1 to Green ASG
3. Add Green to ALB Target Group
4. Health checks pass → Route traffic to Green
5. Remove Blue from Target Group
```

**Kubernetes Implementation:**
```yaml
# Blue deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-blue
spec:
  replicas: 3
  template:
    metadata:
      labels:
        app: api
        version: blue
    spec:
      containers:
      - name: api
        image: myapp/api:v1.0

---
# Green deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-green
spec:
  replicas: 3
  template:
    metadata:
      labels:
        app: api
        version: green
    spec:
      containers:
      - name: api
        image: myapp/api:v1.1

---
# Service (switch by changing selector)
apiVersion: v1
kind: Service
metadata:
  name: api-service
spec:
  selector:
    app: api
    version: blue  # Change to 'green' to switch
  ports:
  - port: 80
    targetPort: 3000
```

**Switch Traffic:**
```bash
# Point to green
kubectl patch service api-service \
  -p '{"spec":{"selector":{"version":"green"}}}'

# Instant rollback if issues
kubectl patch service api-service \
  -p '{"spec":{"selector":{"version":"blue"}}}'
```

**Benefits:**
```
✅ Zero downtime (instant switch)
✅ Instant rollback (switch back to Blue)
✅ Test in production-like environment
✅ Reduced risk (easy to revert)
```

**Drawbacks:**
```
❌ 2× infrastructure cost (two environments)
❌ Database migrations complex (shared DB)
❌ Need same data in both environments
```

**Interview tip:** Explain blue-green as two identical environments (Blue: current, Green: new), show instant traffic switch via load balancer or Kubernetes Service selector, emphasize instant rollback capability (switch back to Blue), mention drawback of 2× infrastructure cost."

---

## Q85: How do you implement canary deployments?

**Perfect Answer:**

"Canary deployment gradually shifts traffic from old to new version, monitors metrics, auto-rollback on errors.

**Process:**
```
Step 1: All traffic to v1.0
        v1.0 (100%) ← Users

Step 2: Deploy v1.1, route 5% traffic
        v1.0 (95%) ← Users
        v1.1 (5%) ← Users
        Monitor: Error rate, latency, CPU

Step 3: If OK, increase to 25%
        v1.0 (75%) ← Users
        v1.1 (25%) ← Users

Step 4: If OK, increase to 50%
        v1.0 (50%) ← Users
        v1.1 (50%) ← Users

Step 5: If OK, increase to 100%
        v1.0 (0%) ← Users
        v1.1 (100%) ← Users

If errors detected at any step:
        Auto-rollback to v1.0 (100%)
```

**Kubernetes with Flagger:**
```yaml
# Install Flagger (progressive delivery)
kubectl apply -k github.com/fluxcd/flagger/kustomize/linkerd

# Canary resource
apiVersion: flagger.app/v1beta1
kind: Canary
metadata:
  name: api
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api
  service:
    port: 3000
  analysis:
    interval: 1m
    threshold: 5      # Max failed checks before rollback
    maxWeight: 50     # Max traffic % to canary
    stepWeight: 10    # Increase by 10% each step
    metrics:
    - name: request-success-rate
      thresholdRange:
        min: 99       # Min 99% success rate
      interval: 1m
    - name: request-duration
      thresholdRange:
        max: 500      # Max 500ms latency
      interval: 1m
  webhooks:
  - name: load-test
    url: http://flagger-loadtester/
    timeout: 5s
    metadata:
      cmd: "hey -z 1m -q 10 -c 2 http://api.default/"

# Deploy new version
kubectl set image deployment/api api=myapp/api:v1.1

# Flagger automatically:
# 1. Detects new version
# 2. Creates canary deployment
# 3. Routes 10% traffic
# 4. Runs load tests
# 5. Checks metrics (success rate, latency)
# 6. If OK: increase to 20%, 30%, ..., 100%
# 7. If metrics fail: rollback to v1.0
```

**Istio Traffic Splitting:**
```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: api
spec:
  hosts:
  - api.example.com
  http:
  - match:
    - headers:
        user-type:
          exact: beta   # Beta users get new version
    route:
    - destination:
        host: api
        subset: v1.1
      weight: 100
  - route:
    - destination:
        host: api
        subset: v1.0
      weight: 95        # 95% to old version
    - destination:
        host: api
        subset: v1.1
      weight: 5         # 5% to new version (canary)
```

**Monitoring During Canary:**
```javascript
// Alert if error rate increases
if (canaryErrorRate > baselineErrorRate * 1.5) {
  rollback();
}

// Alert if latency increases
if (canaryP95Latency > baselineP95Latency * 2) {
  rollback();
}

// Alert if CPU/memory spikes
if (canaryMemoryUsage > limits * 0.9) {
  rollback();
}
```

**Benefits:**
```
✅ Gradual rollout (5% → 25% → 50% → 100%)
✅ Lower risk (affects few users initially)
✅ Auto-rollback on metrics failure
✅ Real production validation
```

**Interview tip:** Explain canary as gradual traffic shift (5% → 100%), show Flagger automates canary analysis (monitors metrics, auto-rollback), demonstrate Istio VirtualService for traffic splitting, mention automatic rollback if error rate or latency increases."

---

## Q86: How do you handle logging at scale?

**Perfect Answer:**

"Centralized logging aggregates logs from all servers into searchable system (ELK Stack, CloudWatch, Datadog).

**ELK Stack (Elasticsearch, Logstash, Kibana):**
```
Application → Logstash → Elasticsearch → Kibana (UI)

Logstash: Collects logs from all servers
Elasticsearch: Stores and indexes logs
Kibana: Search and visualize logs
```

**Structured Logging:**
```javascript
const winston = require('winston');

const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()  // JSON format (structured)
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'app.log' })
  ]
});

// Log with context
logger.info('User login', {
  userId: 123,
  ip: '192.168.1.1',
  userAgent: 'Mozilla/5.0',
  duration: 45
});

// Output:
{
  "level": "info",
  "message": "User login",
  "userId": 123,
  "ip": "192.168.1.1",
  "userAgent": "Mozilla/5.0",
  "duration": 45,
  "timestamp": "2024-01-15T10:30:00.000Z"
}

// Searchable in Elasticsearch:
// userId:123
// level:error
// timestamp:[2024-01-15 TO 2024-01-16]
```

**Log Levels:**
```javascript
logger.error('Critical error', { error: err.message });  // Alert ops
logger.warn('High memory usage', { usage: 85 });         // Monitor
logger.info('User registered', { userId: 123 });         // Track events
logger.debug('Query executed', { sql, duration });       // Development only
```

**Correlation IDs:**
```javascript
// Middleware adds request ID
app.use((req, res, next) => {
  req.id = uuidv4();
  next();
});

// All logs include request ID
logger.info('Processing request', { requestId: req.id, path: req.path });
logger.info('Database query', { requestId: req.id, duration: 45 });
logger.info('Request complete', { requestId: req.id, statusCode: 200 });

// In Kibana, search: requestId:"abc-123"
// See entire request flow across services
```

**Log Retention:**
```
Development: 7 days
Staging: 30 days
Production: 90 days (compliance)

Older logs archived to S3 (cheap storage)
```

**Interview tip:** Show structured JSON logging with Winston (searchable fields), explain ELK Stack (centralized logs from all servers), demonstrate correlation IDs (trace request across services), mention log retention policies (90 days production, archive to S3)."

---

## Q87: What is feature flagging and how do you implement it?

**Perfect Answer:**

"Feature flags toggle features on/off without deploying code, enabling gradual rollouts, A/B testing, kill switches.

**Use Cases:**
```
1. Gradual Rollout
   - 5% users see new feature → monitor → 100%

2. A/B Testing
   - 50% users see variant A, 50% see variant B

3. Kill Switch
   - Disable broken feature instantly (no deploy)

4. Beta Features
   - Only show to beta users
```

**Implementation:**
```javascript
// Feature flag service
class FeatureFlags {
  constructor(provider) {
    this.provider = provider;  // LaunchDarkly, Split.io, or custom
  }
  
  async isEnabled(flagName, context) {
    return await this.provider.variation(flagName, context, false);
  }
}

const flags = new FeatureFlags(provider);

// Usage
app.get('/api/dashboard', authenticate, async (req, res) => {
  const newDashboard = await flags.isEnabled('new-dashboard', {
    userId: req.user.id,
    email: req.user.email,
    beta: req.user.beta
  });
  
  if (newDashboard) {
    res.json(getDashboardV2());
  } else {
    res.json(getDashboardV1());
  }
});
```

**LaunchDarkly Example:**
```javascript
const LaunchDarkly = require('launchdarkly-node-server-sdk');

const ldClient = LaunchDarkly.init(process.env.LAUNCHDARKLY_SDK_KEY);

await ldClient.waitForInitialization();

// Check flag
const showNewUI = await ldClient.variation('new-ui', {
  key: req.user.id,
  email: req.user.email,
  custom: {
    plan: req.user.plan,
    country: req.user.country
  }
}, false);

if (showNewUI) {
  // New UI
} else {
  // Old UI
}
```

**Percentage Rollout:**
```javascript
// Configuration
{
  "new-checkout": {
    "enabled": true,
    "percentage": 25,  // 25% of users
    "targeting": {
      "beta": true     // AND beta users only
    }
  }
}

// Implementation
async function isEnabled(flag, context) {
  const config = await getConfig(flag);
  
  if (!config.enabled) return false;
  
  // Targeting rules
  if (config.targeting) {
    if (config.targeting.beta && !context.beta) {
      return false;
    }
  }
  
  // Percentage rollout (consistent per user)
  const hash = crypto.createHash('md5')
    .update(`${flag}:${context.userId}`)
    .digest('hex');
  
  const bucket = parseInt(hash.substring(0, 8), 16) % 100;
  
  return bucket < config.percentage;
}
```

**Kill Switch:**
```javascript
// Disable feature instantly from dashboard (no deploy)
const canProcessPayments = await flags.isEnabled('payment-processing', context);

if (!canProcessPayments) {
  return res.status(503).json({
    error: 'Payment processing temporarily unavailable'
  });
}

// Process payment...
```

**Interview tip:** Explain feature flags toggle features without deploy (gradual rollout, A/B test, kill switch), show percentage rollout (25% users), demonstrate kill switch (disable broken feature instantly), mention LaunchDarkly or Split.io for production."

---

## Q88: How do you implement health checks and readiness probes?

**Perfect Answer:**

"Health checks verify service availability. Liveness (is alive?) vs Readiness (ready for traffic?).

**Liveness Probe (Is process running?):**
```javascript
// Simple ping
app.get('/health/live', (req, res) => {
  res.json({ status: 'alive' });
});

// Response: 200 OK
// If no response: Kubernetes restarts pod
```

**Readiness Probe (Ready to serve traffic?):**
```javascript
// Check dependencies
app.get('/health/ready', async (req, res) => {
  const checks = {
    database: false,
    redis: false,
    api: false
  };
  
  try {
    // Check database
    await db.query('SELECT 1');
    checks.database = true;
    
    // Check Redis
    await redis.ping();
    checks.redis = true;
    
    // Check external API
    const response = await axios.get('https://api.example.com/health', {
      timeout: 2000
    });
    checks.api = response.status === 200;
    
    // All checks passed
    if (checks.database && checks.redis && checks.api) {
      return res.json({ status: 'ready', checks });
    }
    
    // Some checks failed
    res.status(503).json({ status: 'not ready', checks });
    
  } catch (error) {
    res.status(503).json({
      status: 'not ready',
      checks,
      error: error.message
    });
  }
});

// Response: 200 OK (ready) or 503 Service Unavailable (not ready)
// Kubernetes routes traffic only when ready
```

**Kubernetes Probes:**
```yaml
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: api
    livenessProbe:
      httpGet:
        path: /health/live
        port: 3000
      initialDelaySeconds: 30  # Wait 30s after start
      periodSeconds: 10        # Check every 10s
      timeoutSeconds: 3        # Timeout after 3s
      failureThreshold: 3      # Restart after 3 failures
    
    readinessProbe:
      httpGet:
        path: /health/ready
        port: 3000
      initialDelaySeconds: 5   # Start checking after 5s
      periodSeconds: 5         # Check every 5s
      timeoutSeconds: 2
      successThreshold: 1      # Ready after 1 success
      failureThreshold: 3      # Not ready after 3 failures
```

**Deep Health Check:**
```javascript
app.get('/health/deep', async (req, res) => {
  const results = [];
  
  // Database
  try {
    const start = Date.now();
    await db.query('SELECT 1');
    results.push({
      name: 'database',
      status: 'healthy',
      duration: Date.now() - start
    });
  } catch (error) {
    results.push({
      name: 'database',
      status: 'unhealthy',
      error: error.message
    });
  }
  
  // Redis
  try {
    const start = Date.now();
    await redis.ping();
    results.push({
      name: 'redis',
      status: 'healthy',
      duration: Date.now() - start
    });
  } catch (error) {
    results.push({
      name: 'redis',
      status: 'unhealthy',
      error: error.message
    });
  }
  
  // Memory
  const mem = process.memoryUsage();
  results.push({
    name: 'memory',
    status: mem.heapUsed / mem.heapTotal < 0.9 ? 'healthy' : 'warning',
    heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotal: Math.round(mem.heapTotal / 1024 / 1024)
  });
  
  const allHealthy = results.every(r => r.status === 'healthy');
  
  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'healthy' : 'unhealthy',
    checks: results
  });
});
```

**Interview tip:** Distinguish liveness (is alive? restart if fails) vs readiness (ready for traffic? don't route if fails), show readiness probe checking database/Redis/external APIs, demonstrate Kubernetes probe configuration (initialDelay, period, threshold)."

---

## Q89: What is service mesh and when do you need it?

**Perfect Answer:**

"Service mesh manages service-to-service communication - handles retries, circuit breaking, encryption, observability without changing code.

(Note: Covered in detail in Q49 - Architecture & Design section)

**Quick Summary:**
```
Without Service Mesh:
- Each service implements retry, circuit breaker, mTLS
- Code duplication across 50 services
- Hard to update (change code, redeploy all)

With Service Mesh (Istio/Linkerd):
- Sidecar proxy intercepts all traffic
- Automatic retry, circuit breaker, mTLS
- No code changes needed
- Centralized configuration
```

**When to Use:**
```
✅ 20+ microservices
✅ Multiple teams/languages
✅ Need mTLS between services
✅ Complex traffic routing (canary, A/B)
✅ Kubernetes deployment

Example: 50 microservices, 5 teams, Node.js + Java + Go
→ Service mesh provides consistent behavior
```

**When NOT to Use:**
```
❌ < 10 services
❌ Simple architecture
❌ Small team
❌ Not using Kubernetes

Example: 3 services, single team
→ Overhead not justified
```

**Interview tip:** Briefly explain service mesh as sidecar proxies handling cross-cutting concerns (retry, circuit breaker, mTLS, observability), mention when justified (20+ services, multiple teams) vs overhead (< 10 services)."

---

## Q90: How do you implement disaster recovery and backup strategies?

**Perfect Answer:**

"Disaster recovery ensures business continuity after catastrophic failure. Requires backups, replication, failover procedures.

**RTO & RPO:**
```
RTO (Recovery Time Objective): How long to recover?
- Critical services: 1 hour
- Non-critical: 24 hours

RPO (Recovery Point Objective): How much data loss acceptable?
- Financial data: 0 minutes (no loss)
- Analytics: 1 day
```

**Backup Strategy (3-2-1 Rule):**
```
3 copies of data
2 different storage types
1 offsite copy

Example:
- Production database (AWS RDS)
- Daily backup to S3 (same region)
- S3 replication to different region
```

**Database Backups:**
```bash
# Automated daily backup
#!/bin/bash

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="backup_${TIMESTAMP}.sql.gz"

# Dump database
pg_dump -h db.example.com -U postgres mydb | gzip > $BACKUP_FILE

# Upload to S3
aws s3 cp $BACKUP_FILE s3://backups/database/$BACKUP_FILE

# Keep last 30 days locally
find /backups -name "backup_*.sql.gz" -mtime +30 -delete

# S3 lifecycle policy archives to Glacier after 90 days
```

**Multi-Region Replication:**
```
Primary Region (us-east-1):
- RDS Primary
- Application servers
- S3 bucket

Secondary Region (us-west-2):
- RDS Read Replica (async replication)
- Application servers (standby)
- S3 bucket (cross-region replication)

If us-east-1 fails:
1. Promote RDS replica in us-west-2 to primary
2. Update DNS to point to us-west-2
3. Applications start serving from us-west-2
```

**Disaster Recovery Testing:**
```bash
# Quarterly DR drill

1. Schedule maintenance window
2. Simulate failure (shutdown primary region)
3. Execute failover procedure
4. Verify all systems functional
5. Measure actual RTO
6. Document issues
7. Update runbooks
8. Failback to primary
```

**Runbook Example:**
```markdown
# Disaster Recovery Runbook

## When to Execute
- Primary region unavailable > 15 minutes
- Multiple service failures
- Security incident requiring isolation

## Pre-requisites
- Access to AWS console
- DNS credentials
- Datadog access

## Steps
1. Verify backups current (< 1 hour old)
2. Promote RDS replica: `aws rds promote-read-replica`
3. Update DNS: `aws route53 change-resource-record-sets`
4. Scale up secondary instances: `kubectl scale deployment api --replicas=10`
5. Verify health checks: `curl https://secondary.myapp.com/health`
6. Monitor metrics: Datadog dashboard
7. Notify stakeholders: Slack #incidents channel

## Rollback
1. Original region recovered
2. Sync data changes
3. Revert DNS
4. Scale down secondary
```

**Interview tip:** Explain RTO (recovery time) vs RPO (data loss tolerance), show 3-2-1 backup rule (3 copies, 2 storage types, 1 offsite), demonstrate multi-region replication with failover procedure, emphasize regular DR testing (quarterly drills) and documented runbooks."

---

**DEVOPS & DEPLOYMENT SECTION COMPLETE! ✅**

**Progress: 90/100 questions complete**

**Final section:** System Design (Q91-Q100)

Moving to create MODULE-9-PART-5-SYSTEM-DESIGN.md...
