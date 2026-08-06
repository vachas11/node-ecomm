# Testing Prometheus Metrics (Without Docker)

## Step 1: Install Dependencies

```bash
cd services/api-gateway
npm install
```

## Step 2: Start Your Services

```bash
# Terminal 1: Start Redis
redis-server

# Terminal 2: Start User Service
cd services/user-service
npm run dev

# Terminal 3: Start API Gateway
cd services/api-gateway
npm run dev
```

## Step 3: View Metrics Endpoint

Open browser: http://localhost:3000/metrics

You'll see output like:

```
# HELP http_requests_total Total number of HTTP requests
# TYPE http_requests_total counter
http_requests_total{service="user",method="POST",path="/api/auth/login",status_code="200"} 0

# HELP http_request_duration_seconds Duration of HTTP requests in seconds
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{service="user",method="POST",path="/api/auth/login",le="0.005"} 0
http_request_duration_seconds_bucket{service="user",method="POST",path="/api/auth/login",le="0.01"} 0
http_request_duration_seconds_bucket{service="user",method="POST",path="/api/auth/login",le="+Inf"} 0

# HELP circuit_breaker_state Circuit breaker state (0=closed, 1=half_open, 2=open)
# TYPE circuit_breaker_state gauge
circuit_breaker_state{service="user"} 0

# HELP bulkhead_active_requests Number of currently active requests in bulkhead
# TYPE bulkhead_active_requests gauge
bulkhead_active_requests{service="user"} 0

# HELP gateway_uptime_seconds Gateway uptime in seconds
# TYPE gateway_uptime_seconds gauge
gateway_uptime_seconds 45.123
```

## Step 4: Generate Traffic

```bash
# Make some requests
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123","name":"Test User"}'

curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'

# Make multiple requests
for i in {1..100}; do
  curl -X POST http://localhost:3000/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"password123"}' &
done
wait
```

## Step 5: Check Metrics Again

Refresh http://localhost:3000/metrics

Now you'll see actual data:

```
http_requests_total{service="user",method="POST",path="/api/auth/login",status_code="200"} 100
http_requests_total{service="user",method="POST",path="/api/auth/register",status_code="201"} 1

http_request_duration_seconds_count{service="user",method="POST",path="/api/auth/login"} 100
http_request_duration_seconds_sum{service="user",method="POST",path="/api/auth/login"} 15.67

circuit_breaker_state{service="user"} 0
circuit_breaker_successes_total{service="user"} 101
circuit_breaker_failures_total{service="user"} 0

bulkhead_active_requests{service="user"} 0
bulkhead_utilization_percent{service="user"} 0
```

## Step 6: Test Error Scenarios

### Test Circuit Breaker

```bash
# Stop user service (simulate crash)
# In Terminal 2, press Ctrl+C

# Make requests (will fail)
for i in {1..10}; do
  curl http://localhost:3000/api/auth/login
done

# Check metrics
curl http://localhost:3000/metrics | grep circuit_breaker

# Output:
# circuit_breaker_state{service="user"} 2  # ← OPEN!
# circuit_breaker_failures_total{service="user"} 10
# circuit_breaker_rejections_total{service="user"} 5
```

### Test Bulkhead

```bash
# Create slow endpoint in user service (simulate slow DB)
# Then flood with requests

for i in {1..200}; do
  curl http://localhost:3000/api/auth/login &
done

# Check metrics
curl http://localhost:3000/metrics | grep bulkhead

# Output:
# bulkhead_active_requests{service="user"} 50  # ← At capacity!
# bulkhead_utilization_percent{service="user"} 100
# bulkhead_rejections_total{service="user"} 150  # ← Rejecting!
```

## Key Metrics to Track

### **Answer to "Which endpoint sees maximum traffic?"**

```bash
# Get all request metrics
curl http://localhost:3000/metrics | grep "http_requests_total{" | sort -t'}' -k2 -n

# Output (sorted by count):
http_requests_total{service="user",method="POST",path="/api/auth/login",status_code="200"} 1543
http_requests_total{service="user",method="POST",path="/api/auth/register",status_code="201"} 892
http_requests_total{service="user",method="GET",path="/api/auth/profile",status_code="200"} 234
```

**Answer: `/api/auth/login` with 1543 requests!**

### Average Response Time

```bash
curl http://localhost:3000/metrics | grep "http_request_duration_seconds"

# Calculate average:
# sum / count = 2407.14 / 15430 = 0.156 seconds (156ms average)
```

### Error Rate

```bash
curl http://localhost:3000/metrics | grep 'status_code="5'

# Compare with total:
# errors / total = 115 / 15430 = 0.74% error rate
```

### Circuit Breaker Status

```bash
curl http://localhost:3000/metrics | grep circuit_breaker_state

# 0 = CLOSED (healthy)
# 1 = HALF_OPEN (testing)
# 2 = OPEN (service down)
```

## What This Solves

**Before Prometheus:**
- ❌ No visibility into traffic patterns
- ❌ Can't identify hot endpoints
- ❌ No performance metrics
- ❌ Manual log analysis

**With Prometheus:**
- ✅ Real-time traffic monitoring
- ✅ Instant identification of hot endpoints
- ✅ P50/P95/P99 latency tracking
- ✅ Error rate monitoring
- ✅ Circuit breaker visibility
- ✅ Bulkhead utilization
- ✅ Query with PromQL (powerful)

## PromQL Queries (Once you add Prometheus)

```promql
# Top 10 endpoints by traffic
topk(10, rate(http_requests_total[5m]))

# Average response time
rate(http_request_duration_seconds_sum[5m]) / rate(http_request_duration_seconds_count[5m])

# Error rate
rate(http_requests_total{status_code=~"5.."}[5m]) / rate(http_requests_total[5m]) * 100

# Circuit breaker open count
count(circuit_breaker_state == 2)

# Bulkhead utilization
bulkhead_utilization_percent
```

## Production Setup (Later with Docker)

When ready for full stack:

```bash
# Start Prometheus + Grafana
docker-compose -f docker-compose.monitoring.yml up -d

# Access:
# Prometheus: http://localhost:9090
# Grafana: http://localhost:3001 (admin/admin)
```

---

## This Is Industry Standard ✅

Every production company uses this:
- Netflix: Prometheus + Atlas
- Uber: Prometheus + M3
- Google: Prometheus (invented it)
- Amazon: Prometheus + CloudWatch
- Spotify: Prometheus + Grafana

You now have **lead-level observability** implemented. 🚀
