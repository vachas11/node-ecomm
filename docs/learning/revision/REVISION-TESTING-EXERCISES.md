# REVISION: Testing Exercises (30 Exercises)

**Goals and Commands Only - No Expected Outputs**

Use this file for:
- ✅ Hands-on testing practice
- ✅ Understanding API flows
- ✅ Testing without spoilers
- ✅ Real-world validation skills

---

## Table of Contents

- [Authentication & Authorization (12 Exercises)](#authentication--authorization-12-exercises)
- [Connection Pool & Resilience (6 Exercises)](#connection-pool--resilience-6-exercises)
- [Performance Testing (4 Exercises)](#performance-testing-4-exercises)
- [Load Testing (3 Exercises)](#load-testing-3-exercises)
- [Chaos Engineering (3 Exercises)](#chaos-engineering-3-exercises)
- [Security Testing (2 Exercises)](#security-testing-2-exercises)

---

## Authentication & Authorization (12 Exercises)

### Exercise 1: User Registration
**Source:** [M6-HANDS-ON-TESTING-GUIDE.md:367](../M6-HANDS-ON-TESTING-GUIDE.md)  
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

**Your task:** Execute the curl command and verify the response structure includes user data and tokens.

---

### Exercise 2: Duplicate Email Registration
**Source:** [M6-HANDS-ON-TESTING-GUIDE.md:441](../M6-HANDS-ON-TESTING-GUIDE.md)  
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

**Your task:** Confirm you receive a 409 Conflict error.

---

### Exercise 3: Login
**Source:** [M6-HANDS-ON-TESTING-GUIDE.md:480](../M6-HANDS-ON-TESTING-GUIDE.md)  
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

**Your task:** Save the returned access and refresh tokens for subsequent tests.

---

### Exercise 4: Wrong Password
**Source:** [M6-HANDS-ON-TESTING-GUIDE.md:545](../M6-HANDS-ON-TESTING-GUIDE.md)  
**Goal:** Verify invalid credentials are rejected

**Test:**
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "WrongPassword"
  }'
```

**Your task:** Confirm you receive a 401 Unauthorized error.

---

### Exercise 5: Access Protected Endpoint
**Source:** [M6-HANDS-ON-TESTING-GUIDE.md:577](../M6-HANDS-ON-TESTING-GUIDE.md)  
**Goal:** Use access token to get user profile

**Test:**
```bash
curl http://localhost:3000/api/users/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Your task:** Replace `YOUR_ACCESS_TOKEN` with the token from Exercise 3 and verify profile is returned.

---

### Exercise 6: Access Without Token
**Source:** [M6-HANDS-ON-TESTING-GUIDE.md:621](../M6-HANDS-ON-TESTING-GUIDE.md)  
**Goal:** Verify protected endpoint requires authentication

**Test:**
```bash
curl http://localhost:3000/api/users/me
```

**Your task:** Confirm you receive a 401 Unauthorized error without the Authorization header.

---

### Exercise 7: Refresh Token
**Source:** [M6-HANDS-ON-TESTING-GUIDE.md:646](../M6-HANDS-ON-TESTING-GUIDE.md)  
**Goal:** Get new access token using refresh token

**Test:**
```bash
curl -X POST http://localhost:3000/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "YOUR_REFRESH_TOKEN"
  }'
```

**Your task:** Replace `YOUR_REFRESH_TOKEN` and verify you receive a new access token.

---

### Exercise 8: Logout
**Source:** [M6-HANDS-ON-TESTING-GUIDE.md:692](../M6-HANDS-ON-TESTING-GUIDE.md)  
**Goal:** Invalidate tokens

**Test:**
```bash
curl -X POST http://localhost:3000/api/auth/logout \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "YOUR_REFRESH_TOKEN"
  }'
```

**Your task:** Logout and verify tokens are invalidated.

---

### Exercise 9: Access After Logout
**Source:** [M6-HANDS-ON-TESTING-GUIDE.md:750](../M6-HANDS-ON-TESTING-GUIDE.md)  
**Goal:** Verify token blacklisting works

**Test:**
```bash
curl http://localhost:3000/api/users/me \
  -H "Authorization: Bearer YOUR_OLD_ACCESS_TOKEN"
```

**Your task:** Try using the old access token and confirm it's rejected.

---

### Exercise 10: Test Login Rate Limiting
**Source:** [M6-HANDS-ON-TESTING-GUIDE.md:786](../M6-HANDS-ON-TESTING-GUIDE.md)  
**Goal:** Verify rate limiting prevents brute force attacks

**Test:**
```bash
# Attempt 6 logins in rapid succession
for i in {1..6}; do
  curl -X POST http://localhost:3000/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{
      "email": "test@example.com",
      "password": "WrongPassword"
    }'
  echo "\n--- Attempt $i ---"
done
```

**Your task:** Verify the 6th attempt is rate-limited (429 status).

---

### Exercise 11: Test API Rate Limiting
**Source:** [M6-HANDS-ON-TESTING-GUIDE.md:877](../M6-HANDS-ON-TESTING-GUIDE.md)  
**Goal:** Verify general API rate limiting

**Test:**
```bash
# Attempt 11 requests in rapid succession
for i in {1..11}; do
  curl http://localhost:3000/api/users/me \
    -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
  echo "\n--- Request $i ---"
done
```

**Your task:** Verify the 11th request is rate-limited (429 status).

---

### Exercise 12: Trigger Circuit Breaker
**Source:** [M6-HANDS-ON-TESTING-GUIDE.md:911](../M6-HANDS-ON-TESTING-GUIDE.md)  
**Goal:** Test circuit breaker pattern

**Test:**
```bash
# 1. Stop the User Service
# (Stop the user-service process)

# 2. Make 6 rapid requests to trigger circuit breaker
for i in {1..6}; do
  curl http://localhost:3000/api/users/me \
    -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
  echo "\n--- Request $i ---"
done

# 3. Circuit should now be OPEN - test it
curl http://localhost:3000/api/users/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Your task:** Verify circuit breaker opens after failures and rejects requests immediately.

---

## Connection Pool & Resilience (6 Exercises)

### Exercise 13: Verify Connection Pool Benefits
**Source:** [M6-HANDS-ON-TESTING-GUIDE-PART2.md:9](../M6-HANDS-ON-TESTING-GUIDE-PART2.md)  
**Goal:** Compare response times with/without connection pooling

**Test:**
```bash
# Make 10 sequential requests
for i in {1..10}; do
  time curl http://localhost:3000/api/users/me \
    -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
done
```

**Your task:** Measure and compare response times. Connection pooling should show faster responses.

---

### Exercise 14: Test Connection Pool Limits
**Source:** [M6-HANDS-ON-TESTING-GUIDE-PART2.md:136](../M6-HANDS-ON-TESTING-GUIDE-PART2.md)  
**Goal:** Verify connection pool handles limits correctly

**Test:**
```bash
# Simulate 15 concurrent requests (pool max = 10)
for i in {1..15}; do
  curl http://localhost:3000/api/users/me \
    -H "Authorization: Bearer YOUR_ACCESS_TOKEN" &
done
wait
```

**Your task:** Verify all requests complete successfully despite exceeding pool size.

---

### Exercise 15: Test Exponential Backoff
**Source:** [M6-HANDS-ON-TESTING-GUIDE-PART2.md:189](../M6-HANDS-ON-TESTING-GUIDE-PART2.md)  
**Goal:** Verify retry strategy uses exponential backoff

**Test:**
```bash
# Stop User Service temporarily
# Make request to trigger retries
curl http://localhost:3000/api/users/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -v
```

**Your task:** Check logs to verify retry delays: ~100ms, ~200ms, ~400ms.

---

### Exercise 16: Test Non-Retriable Errors
**Source:** [M6-HANDS-ON-TESTING-GUIDE-PART2.md:285](../M6-HANDS-ON-TESTING-GUIDE-PART2.md)  
**Goal:** Verify 4xx errors are not retried

**Test:**
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "WrongPassword"
  }' \
  -v
```

**Your task:** Verify 401 error is returned immediately without retries.

---

### Exercise 17: Test Service Isolation
**Source:** [M6-HANDS-ON-TESTING-GUIDE-PART2.md:370](../M6-HANDS-ON-TESTING-GUIDE-PART2.md)  
**Goal:** Verify bulkhead isolation between services

**Test:**
```bash
# Create 20 concurrent slow requests
for i in {1..20}; do
  curl http://localhost:3000/api/slow-endpoint \
    -H "Authorization: Bearer YOUR_ACCESS_TOKEN" &
done

# Immediately test if fast endpoints still work
curl http://localhost:3000/health
```

**Your task:** Verify health endpoint responds quickly despite slow endpoint load.

---

### Exercise 18: Test Bulkhead Queue
**Source:** [M6-HANDS-ON-TESTING-GUIDE-PART2.md:480](../M6-HANDS-ON-TESTING-GUIDE-PART2.md)  
**Goal:** Verify request queueing when bulkhead is full

**Test:**
```bash
# Send requests exceeding concurrency limit
for i in {1..15}; do
  curl http://localhost:3000/api/users/me \
    -H "Authorization: Bearer YOUR_ACCESS_TOKEN" &
done
wait
```

**Your task:** Verify some requests queue and all eventually complete.

---

## Performance Testing (4 Exercises)

### Exercise 19: Measure Response Times
**Source:** [M6-HANDS-ON-TESTING-GUIDE-PART2.md:526](../M6-HANDS-ON-TESTING-GUIDE-PART2.md)  
**Goal:** Establish performance baselines

**Test:**
```bash
# Test various endpoints and measure times
echo "Testing /health..."
time curl http://localhost:3000/health

echo "Testing /api/users/me..."
time curl http://localhost:3000/api/users/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"

echo "Testing /api/auth/login..."
time curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "Password123"}'
```

**Your task:** Record response times and establish baselines.

---

### Exercise 20: Database Connection Pool Performance
**Source:** [M6-HANDS-ON-TESTING-GUIDE-PART2.md:665](../M6-HANDS-ON-TESTING-GUIDE-PART2.md)  
**Goal:** Measure database query performance

**Test:**
```bash
# Make 50 sequential database queries
for i in {1..50}; do
  curl http://localhost:3000/api/users/me \
    -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
    -w "\nTime: %{time_total}s\n"
done
```

**Your task:** Calculate average query time and identify outliers.

---

## Load Testing (3 Exercises)

### Exercise 21: Find Breaking Point
**Source:** [M6-HANDS-ON-TESTING-GUIDE-PART2.md:795](../M6-HANDS-ON-TESTING-GUIDE-PART2.md)  
**Goal:** Determine maximum concurrent requests

**Test:**
```bash
# Start with 10 concurrent requests, increase gradually
for concurrency in 10 20 50 100 200; do
  echo "Testing $concurrency concurrent requests..."
  for i in $(seq 1 $concurrency); do
    curl http://localhost:3000/api/users/me \
      -H "Authorization: Bearer YOUR_ACCESS_TOKEN" &
  done
  wait
done
```

**Your task:** Identify the concurrency level where errors/timeouts begin.

---

### Exercise 22: Sustained Load Test
**Source:** [M6-HANDS-ON-TESTING-GUIDE-PART2.md:855](../M6-HANDS-ON-TESTING-GUIDE-PART2.md)  
**Goal:** Test system under sustained load

**Test:**
```bash
# Run 10 requests/second for 5 minutes
for i in {1..300}; do
  curl http://localhost:3000/api/users/me \
    -H "Authorization: Bearer YOUR_ACCESS_TOKEN" &
  sleep 0.1
done
```

**Your task:** Monitor memory, CPU, and response times over 5 minutes.

---

### Exercise 23: Spike Test
**Source:** [M6-HANDS-ON-TESTING-GUIDE-PART2.md:905](../M6-HANDS-ON-TESTING-GUIDE-PART2.md)  
**Goal:** Test sudden traffic spike handling

**Test:**
```bash
# Normal load
for i in {1..10}; do
  curl http://localhost:3000/api/users/me \
    -H "Authorization: Bearer YOUR_ACCESS_TOKEN" &
done

# Sudden spike
for i in {1..100}; do
  curl http://localhost:3000/api/users/me \
    -H "Authorization: Bearer YOUR_ACCESS_TOKEN" &
done
wait
```

**Your task:** Verify system recovers after spike.

---

## Chaos Engineering (3 Exercises)

### Exercise 24: Database Connection Loss
**Source:** [M6-HANDS-ON-TESTING-GUIDE-PART2.md:950](../M6-HANDS-ON-TESTING-GUIDE-PART2.md)  
**Goal:** Test graceful degradation when database fails

**Test:**
```bash
# 1. Stop PostgreSQL
Stop-Service postgresql*

# 2. Try to access user profile
curl http://localhost:3000/api/users/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"

# 3. Restart PostgreSQL
Start-Service postgresql*

# 4. Verify recovery
curl http://localhost:3000/api/users/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Your task:** Verify appropriate error during outage and automatic recovery.

---

### Exercise 25: Redis Connection Loss
**Source:** [M6-HANDS-ON-TESTING-GUIDE-PART2.md:1022](../M6-HANDS-ON-TESTING-GUIDE-PART2.md)  
**Goal:** Test Redis failure handling

**Test:**
```bash
# 1. Stop Redis
redis-cli shutdown

# 2. Try operations that use Redis (rate limiting, caching)
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "Password123"}'

# 3. Restart Redis
redis-server &

# 4. Verify recovery
curl http://localhost:3000/health
```

**Your task:** Verify system functions without Redis (degraded mode) and recovers.

---

### Exercise 26: Network Partition
**Source:** [M6-HANDS-ON-TESTING-GUIDE-PART2.md:1103](../M6-HANDS-ON-TESTING-GUIDE-PART2.md)  
**Goal:** Simulate network latency/partition

**Test:**
```bash
# Add network delay (Linux/Mac)
sudo tc qdisc add dev lo root netem delay 500ms

# Test requests with delay
time curl http://localhost:3000/api/users/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"

# Remove delay
sudo tc qdisc del dev lo root
```

**Your task:** Verify timeouts are handled correctly under network delay.

---

## Security Testing (2 Exercises)

### Exercise 27: SQL Injection Attempt
**Source:** [M6-HANDS-ON-TESTING-GUIDE-PART2.md:1157](../M6-HANDS-ON-TESTING-GUIDE-PART2.md)  
**Goal:** Verify SQL injection protection

**Test:**
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com\" OR \"1\"=\"1",
    "password": "anything"
  }'
```

**Your task:** Verify the malicious input is treated as literal string, not SQL.

---

### Exercise 28: XSS Attack Prevention
**Source:** [M6-HANDS-ON-TESTING-GUIDE-PART2.md:1215](../M6-HANDS-ON-TESTING-GUIDE-PART2.md)  
**Goal:** Verify XSS script injection is prevented

**Test:**
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "hacker@example.com",
    "password": "Password123",
    "firstName": "<script>alert(\"XSS\")</script>",
    "lastName": "Test"
  }'
```

**Your task:** Verify malicious script is either rejected or sanitized.

---

## Exercise 29: JWT Tampering (BONUS)
**Source:** [M6-HANDS-ON-TESTING-GUIDE-PART2.md:1282](../M6-HANDS-ON-TESTING-GUIDE-PART2.md)  
**Goal:** Verify JWT signature validation

**Task:** Modify a JWT token payload and verify it's rejected.

---

## Exercise 30: Log Analysis (BONUS)
**Source:** [M6-HANDS-ON-TESTING-GUIDE-PART2.md:1349](../M6-HANDS-ON-TESTING-GUIDE-PART2.md)  
**Goal:** Practice log analysis for debugging

**Task:** Review application logs to trace a request through the system.

---

## How to Use This File

### Prerequisites
- API Gateway running on port 3000
- User Service running on port 3001
- PostgreSQL and Redis running
- Valid access and refresh tokens from Exercise 1

### Test Workflow
1. **Start services**: Ensure all services are running
2. **Run exercises sequentially**: Some exercises depend on previous ones
3. **Verify responses**: Check status codes and response structure
4. **Check logs**: Review application logs for insights
5. **Compare with source**: Refer to source files for expected outputs

### Tips for Testing
- Save tokens as environment variables for reuse
- Use `-v` flag with curl for verbose output
- Monitor logs in a separate terminal: `tail -f logs/combined.log`
- Reset state between tests if needed (clear database, restart services)

### Common Commands
```bash
# Save token (PowerShell)
$ACCESS_TOKEN = "your_token_here"

# Save token (Bash)
export ACCESS_TOKEN="your_token_here"

# Use saved token
curl http://localhost:3000/api/users/me -H "Authorization: Bearer $ACCESS_TOKEN"

# Check service health
curl http://localhost:3000/health
```

---

**Total Exercises:** 30  
**Estimated Time (with analysis):** 6-8 hours  
**Estimated Time (execution only):** 2-3 hours
