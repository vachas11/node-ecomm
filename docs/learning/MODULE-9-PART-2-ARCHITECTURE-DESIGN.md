# MODULE-9 PART 2: ARCHITECTURE & DESIGN

**Lead-Level Interview Questions with Perfect Answers**

**Questions 43-60: Architecture & Design Patterns**

---

## Q43: Microservices vs Monolith - when to use each?

**Perfect Answer:**

"Choose based on team size, scale, and complexity. Each has trade-offs.

**Monolith (Start here for most projects):**

```
Single codebase, single deployment, single database

Advantages:
✅ Simpler to develop (no distributed system complexity)
✅ Simpler to deploy (one artifact)
✅ Simpler to test (no network calls between components)
✅ Better performance (no network latency)
✅ Easier transactions (ACID in single database)
✅ Easier debugging (single stack trace)

Disadvantages:
❌ Scaling (must scale entire app)
❌ Deployment (small change = redeploy everything)
❌ Technology lock-in (one language/framework)
❌ Large codebase (slow builds, complex dependencies)
```

**Example monolith structure:**
```javascript
// Single Node.js application
src/
├── controllers/
│   ├── auth.controller.js
│   ├── user.controller.js
│   ├── order.controller.js
│   └── product.controller.js
├── services/
│   ├── auth.service.js
│   ├── user.service.js
│   ├── order.service.js
│   └── product.service.js
├── models/
│   ├── User.js
│   ├── Order.js
│   └── Product.js
└── server.js

// All deployed together
// All share same database
// All scale together
```

**Microservices (When you outgrow monolith):**

```
Multiple services, independent deployment, separate databases

Advantages:
✅ Independent scaling (scale hot services only)
✅ Independent deployment (change one service)
✅ Technology flexibility (different languages per service)
✅ Team autonomy (teams own services)
✅ Fault isolation (one service down ≠ all down)
✅ Easier to understand (small codebases)

Disadvantages:
❌ Distributed system complexity
❌ Network latency (service-to-service calls)
❌ Data consistency challenges (no ACID across services)
❌ Difficult to test (need all services running)
❌ Difficult to debug (distributed traces)
❌ Operational overhead (monitoring, logging, deployment)
```

**Example microservices architecture:**
```
services/
├── auth-service/          (Port 3001)
│   ├── src/
│   ├── package.json
│   └── Dockerfile
│
├── user-service/          (Port 3002)
│   ├── src/
│   ├── package.json
│   └── Dockerfile
│
├── order-service/         (Port 3003)
│   ├── src/
│   ├── package.json
│   └── Dockerfile
│
├── product-service/       (Port 3004)
│   ├── src/
│   ├── package.json
│   └── Dockerfile
│
└── api-gateway/           (Port 3000)
    ├── src/
    ├── package.json
    └── Dockerfile

// Each service:
// - Independent database
// - Independent deployment
// - Independent scaling
// - Communicates via HTTP/gRPC/messaging
```

**When to use Monolith:**
```
✅ Small team (< 10 developers)
✅ New project (MVP, proof of concept)
✅ Simple domain (CRUD app, content site)
✅ Low traffic (< 1000 req/sec)
✅ Tight coupling acceptable (features interconnected)
✅ Fast iteration needed (startup)

Example: Blog platform, internal tools, e-commerce MVP
```

**When to use Microservices:**
```
✅ Large team (> 20 developers, multiple teams)
✅ Mature product (proven market fit)
✅ Complex domain (multiple bounded contexts)
✅ High traffic (> 10,000 req/sec)
✅ Different scaling needs (product catalog vs checkout)
✅ Independent deployment required (frequent releases)

Example: Netflix, Amazon, Uber
```

**Hybrid: Modular Monolith (Best of both worlds)**
```javascript
// Start with well-organized monolith
// Can extract to microservices later

src/
├── modules/
│   ├── auth/
│   │   ├── auth.controller.js
│   │   ├── auth.service.js
│   │   ├── auth.model.js
│   │   └── auth.routes.js
│   │
│   ├── orders/
│   │   ├── orders.controller.js
│   │   ├── orders.service.js
│   │   ├── orders.model.js
│   │   └── orders.routes.js
│   │
│   └── products/
│       ├── products.controller.js
│       ├── products.service.js
│       ├── products.model.js
│       └── products.routes.js
│
└── server.js

// Modules communicate via interfaces (not direct calls)
// Easy to extract module to microservice later
```

**Migration path:**
```
Phase 1: Monolith
- Single application
- Fast development
- Validate product-market fit

Phase 2: Modular Monolith
- Organize by domain
- Define clear boundaries
- Use interfaces between modules

Phase 3: Extract critical services
- Extract high-traffic services (product catalog)
- Extract frequently-changing services (pricing)
- Keep less-critical features in monolith

Phase 4: Full Microservices (if needed)
- Extract remaining services
- Event-driven communication
- Service mesh
```

**Anti-pattern: Premature microservices**
```javascript
// ❌ BAD: 3-person team building 15 microservices
// - Overhead > productivity
// - Constant debugging of distributed issues
// - Slow feature development

// ✅ GOOD: 3-person team building modular monolith
// - Fast feature development
// - Can extract services later if needed
// - Focus on product, not infrastructure
```

**Decision framework:**
```
Question 1: Team size?
< 10: Monolith
> 20: Consider microservices

Question 2: Traffic?
< 1000 req/sec: Monolith can handle
> 10,000 req/sec: Microservices may be needed

Question 3: Domain complexity?
Simple CRUD: Monolith
Multiple bounded contexts: Microservices

Question 4: Deployment frequency?
Weekly/monthly: Monolith fine
Multiple per day: Microservices beneficial

Question 5: Scaling needs?
Uniform: Monolith
Different per component: Microservices

Answer "Microservices" to 3+: Consider microservices
Otherwise: Stick with monolith
```

**Interview tip:** Emphasize that monolith is NOT bad - it's the right choice for most projects. Microservices add complexity that only makes sense at scale. Show you understand trade-offs and can make pragmatic decisions based on team size, traffic, and domain complexity."

---

## Q44: How do you design RESTful APIs properly?

**Perfect Answer:**

"Follow REST principles: resources, HTTP methods, status codes, versioning, pagination.

**1. Resource-based URLs (Nouns, not verbs)**
```javascript
// ❌ BAD: Verbs in URLs
POST /api/getUsers
POST /api/createUser
POST /api/deleteUser

// ✅ GOOD: Nouns (resources)
GET    /api/users          // List users
POST   /api/users          // Create user
GET    /api/users/:id      // Get specific user
PUT    /api/users/:id      // Update user (full)
PATCH  /api/users/:id      // Update user (partial)
DELETE /api/users/:id      // Delete user

// Nested resources
GET    /api/users/:id/orders           // User's orders
POST   /api/users/:id/orders           // Create order for user
GET    /api/users/:id/orders/:orderId  // Specific order
```

**2. HTTP Methods (Use correctly)**
```javascript
// GET - Read (safe, idempotent, cacheable)
app.get('/api/products', async (req, res) => {
  const products = await db.query('SELECT * FROM products');
  res.json(products.rows);
});

// POST - Create (not idempotent)
app.post('/api/products', async (req, res) => {
  const { name, price } = req.body;
  const result = await db.query(
    'INSERT INTO products (name, price) VALUES ($1, $2) RETURNING *',
    [name, price]
  );
  res.status(201).json(result.rows[0]);  // 201 Created
});

// PUT - Replace (idempotent)
app.put('/api/products/:id', async (req, res) => {
  const { name, price, description } = req.body;
  const result = await db.query(
    'UPDATE products SET name = $1, price = $2, description = $3 WHERE id = $4 RETURNING *',
    [name, price, description, req.params.id]
  );
  res.json(result.rows[0]);
});

// PATCH - Partial update (idempotent)
app.patch('/api/products/:id', async (req, res) => {
  const updates = req.body;  // Only changed fields
  const fields = Object.keys(updates);
  const values = Object.values(updates);
  
  const setClause = fields.map((field, i) => `${field} = $${i + 1}`).join(', ');
  
  const result = await db.query(
    `UPDATE products SET ${setClause} WHERE id = $${fields.length + 1} RETURNING *`,
    [...values, req.params.id]
  );
  res.json(result.rows[0]);
});

// DELETE - Remove (idempotent)
app.delete('/api/products/:id', async (req, res) => {
  await db.query('DELETE FROM products WHERE id = $1', [req.params.id]);
  res.status(204).send();  // 204 No Content
});
```

**3. HTTP Status Codes (Use meaningful codes)**
```javascript
// Success codes
200 OK           - Request succeeded
201 Created      - Resource created
204 No Content   - Succeeded, no response body
206 Partial Content - Pagination

// Client error codes
400 Bad Request       - Invalid data
401 Unauthorized      - Not authenticated
403 Forbidden         - Authenticated but not allowed
404 Not Found         - Resource doesn't exist
409 Conflict          - Duplicate email, version mismatch
422 Unprocessable     - Validation errors
429 Too Many Requests - Rate limit exceeded

// Server error codes
500 Internal Server Error - Unexpected error
502 Bad Gateway          - Upstream service error
503 Service Unavailable  - Temporary downtime
504 Gateway Timeout      - Upstream timeout

// Example
app.post('/api/users', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Validation
    if (!email || !password) {
      return res.status(400).json({
        error: 'Email and password required'
      });
    }
    
    // Check duplicate
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: 'Email already exists'
      });
    }
    
    // Create user
    const hash = await bcrypt.hash(password, 12);
    const result = await db.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
      [email, hash]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('User creation failed', { error });
    res.status(500).json({
      error: 'Internal server error'
    });
  }
});
```

**4. Pagination (Essential for large datasets)**
```javascript
// Offset-based pagination
app.get('/api/products', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  
  const [products, count] = await Promise.all([
    db.query('SELECT * FROM products LIMIT $1 OFFSET $2', [limit, offset]),
    db.query('SELECT COUNT(*) FROM products')
  ]);
  
  const totalPages = Math.ceil(count.rows[0].count / limit);
  
  res.json({
    data: products.rows,
    pagination: {
      page,
      limit,
      totalPages,
      totalItems: parseInt(count.rows[0].count),
      hasNext: page < totalPages,
      hasPrev: page > 1
    }
  });
});

// Response:
{
  "data": [...],
  "pagination": {
    "page": 2,
    "limit": 20,
    "totalPages": 50,
    "totalItems": 1000,
    "hasNext": true,
    "hasPrev": true
  }
}
```

**5. Filtering, Sorting, Field Selection**
```javascript
app.get('/api/products', async (req, res) => {
  const { category, minPrice, maxPrice, sort, fields } = req.query;
  
  let query = 'SELECT * FROM products WHERE 1=1';
  const params = [];
  
  // Filtering
  if (category) {
    params.push(category);
    query += ` AND category = $${params.length}`;
  }
  
  if (minPrice) {
    params.push(minPrice);
    query += ` AND price >= $${params.length}`;
  }
  
  if (maxPrice) {
    params.push(maxPrice);
    query += ` AND price <= $${params.length}`;
  }
  
  // Sorting
  if (sort) {
    const sortFields = sort.split(',').map(field => {
      if (field.startsWith('-')) {
        return `${field.substring(1)} DESC`;
      }
      return `${field} ASC`;
    });
    query += ` ORDER BY ${sortFields.join(', ')}`;
  }
  
  const result = await db.query(query, params);
  
  // Field selection
  let data = result.rows;
  if (fields) {
    const selectedFields = fields.split(',');
    data = data.map(item => {
      const filtered = {};
      selectedFields.forEach(field => {
        if (item.hasOwnProperty(field)) {
          filtered[field] = item[field];
        }
      });
      return filtered;
    });
  }
  
  res.json({ data });
});

// Usage:
GET /api/products?category=electronics&minPrice=100&sort=-price,name&fields=id,name,price

// Returns electronics products, price >= 100, sorted by price DESC then name ASC, only id/name/price fields
```

**6. Versioning (Handle breaking changes)**
```javascript
// Strategy 1: URL versioning (most common)
app.use('/api/v1/users', usersV1Router);
app.use('/api/v2/users', usersV2Router);

// Strategy 2: Header versioning
app.use((req, res, next) => {
  const version = req.headers['api-version'] || 'v1';
  req.apiVersion = version;
  next();
});

app.get('/api/users', async (req, res) => {
  if (req.apiVersion === 'v2') {
    // New format
    return res.json({ data: users, meta: { ... } });
  }
  // Old format
  res.json(users);
});

// Strategy 3: Accept header
Accept: application/vnd.myapi.v2+json
```

**7. Error Response Format (Consistent)**
```javascript
// Standard error format
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "details": [
      {
        "field": "email",
        "message": "Invalid email format"
      },
      {
        "field": "password",
        "message": "Password must be at least 8 characters"
      }
    ]
  },
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}

// Implementation
app.use((err, req, res, next) => {
  const response = {
    success: false,
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message || 'An unexpected error occurred'
    },
    requestId: req.id
  };
  
  if (err.details) {
    response.error.details = err.details;
  }
  
  res.status(err.statusCode || 500).json(response);
});
```

**8. HATEOAS (Hypermedia - Optional)**
```javascript
// Include links to related resources
{
  "id": 123,
  "name": "John Doe",
  "email": "john@example.com",
  "_links": {
    "self": { "href": "/api/users/123" },
    "orders": { "href": "/api/users/123/orders" },
    "avatar": { "href": "/api/users/123/avatar" }
  }
}
```

**9. Rate Limiting Headers**
```javascript
app.use((req, res, next) => {
  // Add rate limit headers
  res.set({
    'X-RateLimit-Limit': '100',
    'X-RateLimit-Remaining': '73',
    'X-RateLimit-Reset': '1640000000'
  });
  next();
});
```

**10. CORS (Cross-Origin Resource Sharing)**
```javascript
app.use(cors({
  origin: ['https://myapp.com', 'https://staging.myapp.com'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400  // Cache preflight for 24 hours
}));
```

**Complete example:**
```javascript
// GET /api/v1/products?category=electronics&page=2&limit=20&sort=-price&fields=id,name,price
app.get('/api/v1/products', async (req, res) => {
  try {
    const { category, page = 1, limit = 20, sort, fields } = req.query;
    
    // Validation
    if (limit > 100) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_LIMIT',
          message: 'Limit cannot exceed 100'
        }
      });
    }
    
    // Build query
    let query = 'SELECT * FROM products';
    const params = [];
    
    if (category) {
      params.push(category);
      query += ` WHERE category = $${params.length}`;
    }
    
    if (sort) {
      const sortField = sort.startsWith('-') ? sort.substring(1) : sort;
      const sortOrder = sort.startsWith('-') ? 'DESC' : 'ASC';
      query += ` ORDER BY ${sortField} ${sortOrder}`;
    }
    
    const offset = (page - 1) * limit;
    query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);
    
    // Execute
    const result = await db.query(query, params);
    
    // Field selection
    let data = result.rows;
    if (fields) {
      const selectedFields = fields.split(',');
      data = data.map(item => 
        Object.fromEntries(
          selectedFields.map(field => [field, item[field]])
        )
      );
    }
    
    // Response
    res.json({
      success: true,
      data,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        hasNext: data.length === limit
      }
    });
  } catch (error) {
    logger.error('Product fetch failed', { error });
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch products'
      },
      requestId: req.id
    });
  }
});
```

**Interview tip:** Show you know REST principles (resources not verbs, proper HTTP methods/status codes), demonstrate pagination and filtering for production APIs, discuss versioning for breaking changes, and emphasize consistent error responses with request IDs for debugging."

---

## Q45: What is Event-Driven Architecture and when to use it?

**Perfect Answer:**

"Event-Driven Architecture uses events to communicate between services asynchronously. Decouples producers from consumers.

**Traditional Request-Response:**
```javascript
// Synchronous, tightly coupled
async function createOrder(orderData) {
  // Service calls happen sequentially
  const order = await orderService.create(orderData);      // Wait
  await inventoryService.reserve(order.items);              // Wait
  await paymentService.charge(order.userId, order.total);  // Wait
  await emailService.sendConfirmation(order.userId);       // Wait
  await analyticsService.track(order);                     // Wait
  
  return order;
  // Total time: 5 × 100ms = 500ms
  // If any service fails, entire operation fails
}
```

**Event-Driven:**
```javascript
// Asynchronous, loosely coupled
async function createOrder(orderData) {
  // 1. Create order
  const order = await orderService.create(orderData);
  
  // 2. Publish event (non-blocking)
  await eventBus.publish('order.created', {
    orderId: order.id,
    userId: order.userId,
    items: order.items,
    total: order.total,
    timestamp: new Date()
  });
  
  // 3. Return immediately
  return order;
  // Total time: 100ms (80% faster!)
  
  // Other services react to event independently:
  // - Inventory service reserves items
  // - Payment service charges user
  // - Email service sends confirmation
  // - Analytics service tracks order
  // - Shipping service creates label
  // All happen in background, in parallel
}
```

**Event Bus Implementation (Redis Pub/Sub):**
```javascript
class EventBus {
  constructor(redis) {
    this.redis = redis;
    this.subscriber = redis.duplicate();
    this.handlers = new Map();
  }
  
  // Publish event
  async publish(eventType, data) {
    const event = {
      type: eventType,
      data,
      timestamp: new Date().toISOString(),
      id: uuidv4()
    };
    
    await this.redis.publish(eventType, JSON.stringify(event));
    
    logger.info('Event published', { type: eventType, id: event.id });
  }
  
  // Subscribe to event
  subscribe(eventType, handler) {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
      
      // Subscribe to Redis channel
      this.subscriber.subscribe(eventType);
    }
    
    this.handlers.get(eventType).push(handler);
  }
  
  // Start listening
  start() {
    this.subscriber.on('message', async (channel, message) => {
      const event = JSON.parse(message);
      const handlers = this.handlers.get(channel) || [];
      
      logger.info('Event received', { type: channel, id: event.id });
      
      // Execute all handlers
      for (const handler of handlers) {
        try {
          await handler(event.data);
        } catch (error) {
          logger.error('Event handler failed', {
            type: channel,
            id: event.id,
            error: error.message
          });
        }
      }
    });
  }
}

// Usage in Order Service
const eventBus = new EventBus(redis);

app.post('/api/orders', async (req, res) => {
  const order = await db.query(
    'INSERT INTO orders (...) VALUES (...) RETURNING *',
    [...]
  );
  
  // Publish event
  await eventBus.publish('order.created', {
    orderId: order.rows[0].id,
    userId: req.user.id,
    items: req.body.items,
    total: req.body.total
  });
  
  res.status(201).json(order.rows[0]);
});

// Usage in Inventory Service
eventBus.subscribe('order.created', async (data) => {
  logger.info('Reserving inventory for order', { orderId: data.orderId });
  
  for (const item of data.items) {
    await db.query(
      'UPDATE products SET stock = stock - $1 WHERE id = $2',
      [item.quantity, item.productId]
    );
  }
  
  // Publish success event
  await eventBus.publish('inventory.reserved', {
    orderId: data.orderId,
    items: data.items
  });
});

// Usage in Payment Service
eventBus.subscribe('inventory.reserved', async (data) => {
  logger.info('Processing payment for order', { orderId: data.orderId });
  
  const payment = await stripe.charges.create({
    amount: data.total * 100,
    currency: 'usd',
    customer: data.userId
  });
  
  await eventBus.publish('payment.completed', {
    orderId: data.orderId,
    paymentId: payment.id
  });
});

// Usage in Email Service
eventBus.subscribe('payment.completed', async (data) => {
  logger.info('Sending confirmation email', { orderId: data.orderId });
  
  await sendEmail({
    to: data.userEmail,
    subject: 'Order confirmed',
    body: `Your order ${data.orderId} has been confirmed`
  });
});

// Start listening
eventBus.start();
```

**Event Store (Persistent events):**
```javascript
// Store all events for replay/debugging
async function publishWithStore(eventType, data) {
  const event = {
    id: uuidv4(),
    type: eventType,
    data,
    timestamp: new Date()
  };
  
  // 1. Store event in database
  await db.query(
    'INSERT INTO events (id, type, data, timestamp) VALUES ($1, $2, $3, $4)',
    [event.id, event.type, JSON.stringify(event.data), event.timestamp]
  );
  
  // 2. Publish to message bus
  await redis.publish(eventType, JSON.stringify(event));
  
  return event.id;
}

// Replay events (rebuild state)
async function replayEvents(eventType, fromTimestamp) {
  const events = await db.query(
    'SELECT * FROM events WHERE type = $1 AND timestamp >= $2 ORDER BY timestamp',
    [eventType, fromTimestamp]
  );
  
  for (const event of events.rows) {
    await handleEvent(event);
  }
}
```

**Dead Letter Queue (Handle failures):**
```javascript
class ResilientEventBus extends EventBus {
  async handleEvent(event, handler) {
    const maxRetries = 3;
    let attempts = 0;
    
    while (attempts < maxRetries) {
      try {
        await handler(event.data);
        return;  // Success
      } catch (error) {
        attempts++;
        
        logger.warn('Event handler failed, retrying', {
          event: event.id,
          attempt: attempts,
          error: error.message
        });
        
        if (attempts < maxRetries) {
          await sleep(1000 * attempts);  // Exponential backoff
        }
      }
    }
    
    // All retries failed, send to DLQ
    await this.sendToDeadLetterQueue(event);
  }
  
  async sendToDeadLetterQueue(event) {
    await db.query(
      'INSERT INTO dead_letter_queue (event_id, event_type, data, failed_at) VALUES ($1, $2, $3, $4)',
      [event.id, event.type, JSON.stringify(event), new Date()]
    );
    
    logger.error('Event moved to DLQ', { id: event.id, type: event.type });
    
    // Alert ops team
    await sendAlert({
      type: 'event-processing-failure',
      message: `Event ${event.id} failed after ${maxRetries} retries`
    });
  }
}
```

**When to use Event-Driven:**

**✅ Use Event-Driven when:**
```
1. Multiple services need to react to same event
   Example: Order created → inventory, payment, email, analytics all react

2. Async operations (don't block user)
   Example: Image processing, email sending, report generation

3. Decoupling services
   Example: Order service doesn't know about email service

4. Scalability (handle spikes)
   Example: Black Friday traffic → queue events, process at own pace

5. Audit trail / Event sourcing
   Example: Replay events to rebuild state

6. Real-time notifications
   Example: WebSocket server listens for events, pushes to clients
```

**❌ Don't use Event-Driven when:**
```
1. Immediate response needed
   Example: Login (need to know if password correct)

2. Simple CRUD operations
   Example: Get user profile (no events needed)

3. Strong consistency required
   Example: Bank transfer (need atomic transaction)

4. Few consumers (1-2 services)
   Example: Over-engineering for simple cases

5. Debugging complexity not worth it
   Example: Small team, simple domain
```

**Trade-offs:**
```
Advantages:
✅ Loose coupling (services independent)
✅ Scalability (async processing)
✅ Flexibility (easy to add consumers)
✅ Resilience (one service down ≠ all down)

Disadvantages:
❌ Eventual consistency (not immediate)
❌ Complex debugging (distributed traces needed)
❌ Message ordering challenges
❌ Duplicate messages (idempotency required)
❌ Monitoring complexity (need event tracking)
```

**Event Sourcing Pattern:**
```javascript
// Store events, not current state
// State derived by replaying events

// Events (immutable)
await storeEvent({
  type: 'account.created',
  data: { accountId: 123, balance: 0 }
});

await storeEvent({
  type: 'money.deposited',
  data: { accountId: 123, amount: 100 }
});

await storeEvent({
  type: 'money.withdrawn',
  data: { accountId: 123, amount: 30 }
});

// Replay to get current state
async function getAccountBalance(accountId) {
  const events = await db.query(
    'SELECT * FROM events WHERE data->\'accountId\' = $1 ORDER BY timestamp',
    [accountId]
  );
  
  let balance = 0;
  for (const event of events.rows) {
    if (event.type === 'money.deposited') {
      balance += event.data.amount;
    } else if (event.type === 'money.withdrawn') {
      balance -= event.data.amount;
    }
  }
  
  return balance;  // 100 - 30 = 70
}

// Benefits:
// - Complete audit trail
// - Can rebuild state at any point in time
// - Can add new projections retroactively
```

**Interview tip:** Show you understand async benefits (faster response, decoupling, scalability), demonstrate event bus implementation with Redis, discuss failure handling (DLQ, retries), explain when to use vs when not to (immediate response needs sync), and mention eventual consistency challenges."

---

---

## Q46: What is the API Gateway pattern and why use it?

**Perfect Answer:**

"API Gateway is single entry point for all clients, handling routing, authentication, rate limiting, and more.

**Without API Gateway:**
```
Client (Web App) → User Service (Port 3001)
                 → Order Service (Port 3002)
                 → Product Service (Port 3003)
                 → Payment Service (Port 3004)

Problems:
❌ Client needs to know all service URLs
❌ Client makes multiple requests (slow)
❌ Each service implements auth (duplication)
❌ No central rate limiting
❌ CORS config in every service
❌ Hard to version APIs
❌ Security exposure (all services public)
```

**With API Gateway:**
```
Client → API Gateway (Port 3000) → User Service
                                  → Order Service
                                  → Product Service
                                  → Payment Service

Benefits:
✅ Single entry point
✅ Request aggregation (fewer client requests)
✅ Centralized auth/rate limiting
✅ Protocol translation (REST → gRPC)
✅ API versioning
✅ Request/response transformation
✅ Backend services private
```

**API Gateway Implementation:**
```javascript
// services/api-gateway/src/server.js
const express = require('express');
const axios = require('axios');

const app = express();

// Service registry
const services = {
  users: 'http://user-service:3001',
  orders: 'http://order-service:3002',
  products: 'http://product-service:3003',
  payments: 'http://payment-service:3004'
};

// Middleware: Authentication (centralized)
async function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Middleware: Rate limiting (centralized)
const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});

app.use(rateLimiter);

// Middleware: Logging (centralized)
app.use((req, res, next) => {
  req.id = uuidv4();
  logger.info('Request received', {
    requestId: req.id,
    method: req.method,
    path: req.path,
    ip: req.ip
  });
  next();
});

// Route: User operations
app.get('/api/users/:id', authenticate, async (req, res) => {
  try {
    const response = await axios.get(
      `${services.users}/api/users/${req.params.id}`,
      {
        headers: {
          'X-Request-ID': req.id,
          'X-User-ID': req.user.id
        }
      }
    );
    
    res.json(response.data);
  } catch (error) {
    logger.error('User fetch failed', { error, requestId: req.id });
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch user'
    });
  }
});

// Route: Order operations
app.get('/api/orders', authenticate, async (req, res) => {
  try {
    const response = await axios.get(
      `${services.orders}/api/orders`,
      {
        headers: {
          'X-Request-ID': req.id,
          'X-User-ID': req.user.id
        },
        params: req.query
      }
    );
    
    res.json(response.data);
  } catch (error) {
    logger.error('Orders fetch failed', { error, requestId: req.id });
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch orders'
    });
  }
});

// Advanced: Request Aggregation (BFF pattern)
app.get('/api/dashboard', authenticate, async (req, res) => {
  try {
    // Make parallel requests to multiple services
    const [user, orders, stats] = await Promise.all([
      axios.get(`${services.users}/api/users/${req.user.id}`),
      axios.get(`${services.orders}/api/orders?userId=${req.user.id}`),
      axios.get(`${services.orders}/api/orders/stats?userId=${req.user.id}`)
    ]);
    
    // Aggregate response
    res.json({
      user: user.data,
      recentOrders: orders.data.slice(0, 5),
      stats: stats.data
    });
  } catch (error) {
    logger.error('Dashboard fetch failed', { error, requestId: req.id });
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

app.listen(3000, () => {
  console.log('API Gateway listening on port 3000');
});
```

**Request Transformation:**
```javascript
// Transform backend response before sending to client
app.get('/api/products/:id', async (req, res) => {
  const response = await axios.get(
    `${services.products}/api/products/${req.params.id}`
  );
  
  // Backend returns: { id, name, price_cents, stock_quantity, ... }
  // Client expects: { id, name, price, inStock, ... }
  
  const transformed = {
    id: response.data.id,
    name: response.data.name,
    price: response.data.price_cents / 100,  // cents → dollars
    inStock: response.data.stock_quantity > 0,
    image: `https://cdn.example.com/products/${response.data.id}.jpg`
  };
  
  res.json(transformed);
});
```

**Protocol Translation:**
```javascript
// Client uses REST, backend uses gRPC
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

// Load gRPC proto
const packageDefinition = protoLoader.loadSync('user.proto');
const userProto = grpc.loadPackageDefinition(packageDefinition).user;

// Create gRPC client
const userGrpcClient = new userProto.UserService(
  'user-service:50051',
  grpc.credentials.createInsecure()
);

// REST endpoint that calls gRPC backend
app.get('/api/users/:id', authenticate, async (req, res) => {
  return new Promise((resolve, reject) => {
    userGrpcClient.GetUser(
      { userId: req.params.id },
      (error, response) => {
        if (error) {
          return res.status(500).json({ error: error.message });
        }
        res.json(response);
      }
    );
  });
});
```

**API Versioning:**
```javascript
// Route v1 and v2 to different backends
app.use('/api/v1/users', (req, res) => {
  // Route to old user service
  proxy(req, res, 'http://user-service-v1:3001');
});

app.use('/api/v2/users', (req, res) => {
  // Route to new user service
  proxy(req, res, 'http://user-service-v2:3001');
});
```

**Response Caching:**
```javascript
// Cache at gateway level
const cache = new NodeCache({ stdTTL: 300 });

app.get('/api/products', async (req, res) => {
  const cacheKey = `products:${JSON.stringify(req.query)}`;
  
  // Check cache
  const cached = cache.get(cacheKey);
  if (cached) {
    return res.json(cached);
  }
  
  // Fetch from service
  const response = await axios.get(`${services.products}/api/products`, {
    params: req.query
  });
  
  // Cache response
  cache.set(cacheKey, response.data);
  
  res.json(response.data);
});
```

**Load Balancing:**
```javascript
// Multiple instances of same service
const userServiceInstances = [
  'http://user-service-1:3001',
  'http://user-service-2:3001',
  'http://user-service-3:3001'
];

let currentIndex = 0;

function getNextInstance() {
  const instance = userServiceInstances[currentIndex];
  currentIndex = (currentIndex + 1) % userServiceInstances.length;
  return instance;
}

app.get('/api/users/:id', authenticate, async (req, res) => {
  const instance = getNextInstance();  // Round-robin
  
  const response = await axios.get(`${instance}/api/users/${req.params.id}`);
  res.json(response.data);
});
```

**API Gateway Tools:**
```
Express (Node.js)     - Custom implementation, full control
Kong                  - Open-source, plugin-based, Lua
Nginx                 - Fast, C-based, configuration-driven
AWS API Gateway       - Managed, serverless, AWS integration
Azure API Management  - Managed, enterprise features
Traefik               - Cloud-native, Kubernetes integration
```

**When to use:**
```
✅ Microservices architecture
✅ Multiple client types (web, mobile, IoT)
✅ Need centralized auth/rate limiting
✅ Backend services should be private
✅ Need request aggregation (reduce client requests)
✅ Protocol translation (REST ↔ gRPC)

❌ Simple monolith
❌ Single client type
❌ Low traffic (overhead not worth it)
```

**Trade-offs:**
```
Advantages:
✅ Single entry point (simpler for clients)
✅ Centralized cross-cutting concerns
✅ Request aggregation (fewer client requests)
✅ Backend services isolated
✅ Easy to add new services

Disadvantages:
❌ Single point of failure (must be highly available)
❌ Potential bottleneck (must scale horizontally)
❌ Additional hop (latency overhead)
❌ Complexity (another service to maintain)
```

**High Availability:**
```javascript
// Deploy multiple gateway instances behind load balancer

Load Balancer (HAProxy/ALB)
    ↓
API Gateway 1 ← Health check
API Gateway 2 ← Health check
API Gateway 3 ← Health check
    ↓
Backend Services

// Health check endpoint
app.get('/health', async (req, res) => {
  // Check if gateway can reach critical services
  const healthy = await Promise.all([
    checkService(services.users),
    checkService(services.orders)
  ]);
  
  if (healthy.every(h => h)) {
    res.json({ status: 'healthy' });
  } else {
    res.status(503).json({ status: 'unhealthy' });
  }
});
```

**Interview tip:** Explain API Gateway as single entry point for microservices, show centralized auth/rate limiting/logging, demonstrate request aggregation to reduce client requests, discuss protocol translation (REST ↔ gRPC), mention it's a single point of failure (needs HA setup), and emphasize simpler client code."

---

## Q47: What is CQRS and when should you use it?

**Perfect Answer:**

"CQRS (Command Query Responsibility Segregation) separates read and write operations into different models.

**Traditional CRUD (Single Model):**
```javascript
// Same model for reads and writes
class OrderService {
  // Write
  async createOrder(data) {
    return db.query('INSERT INTO orders (...) VALUES (...)', [data]);
  }
  
  async updateOrder(id, data) {
    return db.query('UPDATE orders SET ... WHERE id = $1', [id]);
  }
  
  // Read
  async getOrder(id) {
    return db.query('SELECT * FROM orders WHERE id = $1', [id]);
  }
  
  async getOrders(filters) {
    return db.query('SELECT * FROM orders WHERE ...', [filters]);
  }
}

// Problems:
// - Complex queries slow down writes
// - Write schema optimized for consistency, not read performance
// - Difficult to scale reads and writes independently
```

**CQRS (Separate Models):**
```javascript
// Write Model (Commands) - Normalized, ACID transactions
class OrderCommandService {
  async createOrder(command) {
    // Validate business rules
    if (command.total < 0) {
      throw new Error('Invalid total');
    }
    
    // Write to write database
    const result = await writeDb.query(
      'INSERT INTO orders (user_id, total, status) VALUES ($1, $2, $3) RETURNING id',
      [command.userId, command.total, 'pending']
    );
    
    // Insert order items
    for (const item of command.items) {
      await writeDb.query(
        'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1, $2, $3, $4)',
        [result.rows[0].id, item.productId, item.quantity, item.price]
      );
    }
    
    // Publish event (update read model)
    await eventBus.publish('order.created', {
      orderId: result.rows[0].id,
      userId: command.userId,
      items: command.items,
      total: command.total
    });
    
    return result.rows[0];
  }
  
  async updateOrderStatus(orderId, status) {
    await writeDb.query(
      'UPDATE orders SET status = $1 WHERE id = $2',
      [status, orderId]
    );
    
    // Publish event
    await eventBus.publish('order.status_changed', {
      orderId,
      status
    });
  }
}

// Read Model (Queries) - Denormalized, optimized for reads
class OrderQueryService {
  async getOrder(id) {
    // Read from read database (denormalized)
    return readDb.query(`
      SELECT 
        o.id,
        o.total,
        o.status,
        u.name AS user_name,
        u.email AS user_email,
        json_agg(
          json_build_object(
            'productId', oi.product_id,
            'productName', p.name,
            'quantity', oi.quantity,
            'price', oi.price
          )
        ) AS items
      FROM orders_read o
      JOIN users_read u ON o.user_id = u.id
      JOIN order_items_read oi ON o.id = oi.order_id
      JOIN products_read p ON oi.product_id = p.id
      WHERE o.id = $1
      GROUP BY o.id, u.name, u.email
    `, [id]);
  }
  
  async getUserOrders(userId) {
    // Fast query on denormalized data
    return readDb.query(`
      SELECT * FROM orders_read_summary
      WHERE user_id = $1
      ORDER BY created_at DESC
    `, [userId]);
  }
  
  async getOrderStats() {
    // Materialized view for analytics
    return readDb.query('SELECT * FROM order_stats');
  }
}
```

**Event Handler (Sync Read Model):**
```javascript
// Listen for write events and update read model
eventBus.subscribe('order.created', async (event) => {
  // Denormalize and store in read database
  const order = await writeDb.query('SELECT * FROM orders WHERE id = $1', [event.orderId]);
  const user = await writeDb.query('SELECT * FROM users WHERE id = $1', [order.rows[0].user_id]);
  const items = await writeDb.query('SELECT * FROM order_items WHERE order_id = $1', [event.orderId]);
  
  // Insert into read model (denormalized)
  await readDb.query(`
    INSERT INTO orders_read (
      id, user_id, user_name, user_email, total, status, items, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, [
    order.rows[0].id,
    user.rows[0].id,
    user.rows[0].name,
    user.rows[0].email,
    order.rows[0].total,
    order.rows[0].status,
    JSON.stringify(items.rows),
    order.rows[0].created_at
  ]);
  
  // Update materialized views
  await readDb.query(`
    INSERT INTO order_stats (date, total_orders, total_revenue)
    VALUES (CURRENT_DATE, 1, $1)
    ON CONFLICT (date) DO UPDATE SET
      total_orders = order_stats.total_orders + 1,
      total_revenue = order_stats.total_revenue + $1
  `, [order.rows[0].total]);
});

eventBus.subscribe('order.status_changed', async (event) => {
  // Update read model
  await readDb.query(
    'UPDATE orders_read SET status = $1 WHERE id = $2',
    [event.status, event.orderId]
  );
});
```

**Separate Databases (Optional):**
```javascript
// Write database (PostgreSQL) - ACID, normalized
const writeDb = new Pool({
  host: 'write-db.example.com',
  database: 'orders_write',
  max: 20
});

// Read database (PostgreSQL replica or different DB) - denormalized
const readDb = new Pool({
  host: 'read-db.example.com',
  database: 'orders_read',
  max: 50  // More connections for reads
});

// Or different technology
// Write: PostgreSQL (ACID transactions)
// Read: MongoDB (flexible schema, fast reads)
// Read: Elasticsearch (full-text search, analytics)
```

**API Routes:**
```javascript
// Write endpoints (commands)
app.post('/api/orders', authenticate, async (req, res) => {
  const command = {
    userId: req.user.id,
    items: req.body.items,
    total: req.body.total
  };
  
  const order = await orderCommandService.createOrder(command);
  
  res.status(201).json(order);
});

app.patch('/api/orders/:id/status', authenticate, async (req, res) => {
  await orderCommandService.updateOrderStatus(req.params.id, req.body.status);
  
  res.status(200).json({ success: true });
});

// Read endpoints (queries)
app.get('/api/orders/:id', authenticate, async (req, res) => {
  const order = await orderQueryService.getOrder(req.params.id);
  
  res.json(order);
});

app.get('/api/users/:userId/orders', authenticate, async (req, res) => {
  const orders = await orderQueryService.getUserOrders(req.params.userId);
  
  res.json(orders);
});

app.get('/api/orders/stats', authenticate, async (req, res) => {
  const stats = await orderQueryService.getOrderStats();
  
  res.json(stats);
});
```

**When to use CQRS:**
```
✅ Read/write ratio very different (90%+ reads or 90%+ writes)
✅ Complex queries slow down writes
✅ Different scalability needs (scale reads independently)
✅ Multiple read models needed (SQL, search, analytics)
✅ Event sourcing (natural fit)
✅ Domain complexity (separate models clearer)

Example: E-commerce (many reads, few writes)
Example: Analytics dashboard (complex queries, simple writes)
Example: Audit systems (append-only writes, complex reports)
```

**When NOT to use CQRS:**
```
❌ Simple CRUD application
❌ Read/write ratio similar (50/50)
❌ Small scale (< 1000 req/sec)
❌ Strong consistency required immediately
❌ Small team (added complexity not worth it)

Example: Internal admin tool
Example: Simple blog
Example: Small API with few users
```

**Eventual Consistency:**
```javascript
// Write happens immediately
await orderCommandService.createOrder(command);
// ✅ Write confirmed

// Read might be stale for milliseconds
const order = await orderQueryService.getOrder(orderId);
// ⚠️ Might not see order yet (eventual consistency)

// Handle in UI
{
  "order": { ... },
  "lastUpdated": "2024-01-15T10:30:00Z",
  "stale": true  // Warning: data may be slightly outdated
}
```

**Benefits:**
```
✅ Independent scaling (scale read replicas)
✅ Optimized queries (denormalized, indexed for reads)
✅ Multiple read models (SQL, Elasticsearch, Redis)
✅ Simpler write model (no complex joins)
✅ Better performance (reads don't affect writes)
✅ Flexibility (change read model without changing write)
```

**Trade-offs:**
```
❌ Eventual consistency (not immediate)
❌ Increased complexity (two models to maintain)
❌ Synchronization overhead (keep models in sync)
❌ More infrastructure (potentially separate databases)
❌ Debugging harder (distributed state)
```

**CQRS with Event Sourcing:**
```javascript
// Store events, not state
const events = [
  { type: 'order.created', data: { orderId: 123, items: [...], total: 100 } },
  { type: 'payment.processed', data: { orderId: 123, amount: 100 } },
  { type: 'order.shipped', data: { orderId: 123, trackingNumber: 'ABC123' } }
];

// Write model: Append events
await eventStore.append('order.created', eventData);

// Read model: Project events to current state
function projectOrderState(events) {
  let state = { status: 'pending' };
  
  for (const event of events) {
    if (event.type === 'order.created') {
      state = { ...state, ...event.data, status: 'created' };
    } else if (event.type === 'payment.processed') {
      state.status = 'paid';
    } else if (event.type === 'order.shipped') {
      state.status = 'shipped';
      state.trackingNumber = event.data.trackingNumber;
    }
  }
  
  return state;
}

// Query: Replay events to get current state
const orderEvents = await eventStore.getEvents('order', 123);
const currentState = projectOrderState(orderEvents);
```

**Interview tip:** Explain CQRS as separating read and write models, show denormalized read model for fast queries, demonstrate event-driven sync between models, discuss eventual consistency trade-off, mention when to use (different scalability needs, complex queries) vs when not to (simple CRUD, small scale), and emphasize it adds complexity that must be justified."

---

## Q48: What is the Saga pattern for distributed transactions?

**Perfect Answer:**

"Saga pattern manages distributed transactions by breaking them into smaller local transactions with compensating actions for rollback.

**Problem: Distributed Transactions**
```javascript
// Order creation spans multiple services
async function createOrder(orderData) {
  // Transaction 1: Create order (Order Service)
  const order = await orderService.create(orderData);
  
  // Transaction 2: Reserve inventory (Inventory Service)
  await inventoryService.reserve(order.items);
  
  // Transaction 3: Process payment (Payment Service)
  await paymentService.charge(order.userId, order.total);
  
  // Transaction 4: Create shipment (Shipping Service)
  await shippingService.create(order);
  
  // Problem: What if payment fails?
  // - Order created ✅
  // - Inventory reserved ✅
  // - Payment failed ❌
  // - Shipment not created ❌
  
  // Need to undo order creation and inventory reservation!
  // But they're in different databases (no ACID transaction)
}
```

**Solution: Saga Pattern**

**Two approaches:**

**1. Choreography (Event-Driven)**
```javascript
// Each service listens for events and publishes events
// No central coordinator

// Order Service
app.post('/api/orders', async (req, res) => {
  // Step 1: Create order
  const order = await db.query(
    'INSERT INTO orders (user_id, total, status) VALUES ($1, $2, $3) RETURNING *',
    [req.user.id, req.body.total, 'pending']
  );
  
  // Publish event
  await eventBus.publish('order.created', {
    orderId: order.rows[0].id,
    userId: req.user.id,
    items: req.body.items,
    total: req.body.total
  });
  
  res.status(201).json(order.rows[0]);
});

// Inventory Service
eventBus.subscribe('order.created', async (event) => {
  try {
    // Step 2: Reserve inventory
    for (const item of event.items) {
      await db.query(
        'UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1',
        [item.quantity, item.productId]
      );
    }
    
    // Success: Publish event
    await eventBus.publish('inventory.reserved', {
      orderId: event.orderId,
      userId: event.userId,
      total: event.total
    });
  } catch (error) {
    // Failed: Publish failure event
    await eventBus.publish('inventory.reservation_failed', {
      orderId: event.orderId,
      reason: 'Insufficient stock'
    });
  }
});

// Payment Service
eventBus.subscribe('inventory.reserved', async (event) => {
  try {
    // Step 3: Process payment
    const charge = await stripe.charges.create({
      amount: event.total * 100,
      currency: 'usd',
      customer: event.userId
    });
    
    // Success: Publish event
    await eventBus.publish('payment.completed', {
      orderId: event.orderId,
      paymentId: charge.id
    });
  } catch (error) {
    // Failed: Publish failure event
    await eventBus.publish('payment.failed', {
      orderId: event.orderId,
      reason: error.message
    });
  }
});

// Shipping Service
eventBus.subscribe('payment.completed', async (event) => {
  // Step 4: Create shipment
  await db.query(
    'INSERT INTO shipments (order_id, status) VALUES ($1, $2)',
    [event.orderId, 'pending']
  );
  
  await eventBus.publish('shipment.created', {
    orderId: event.orderId
  });
});

// COMPENSATING ACTIONS (Rollback)

// Order Service: Listen for failures
eventBus.subscribe('inventory.reservation_failed', async (event) => {
  // Compensate: Cancel order
  await db.query(
    'UPDATE orders SET status = $1 WHERE id = $2',
    ['cancelled', event.orderId]
  );
  
  await eventBus.publish('order.cancelled', {
    orderId: event.orderId,
    reason: event.reason
  });
});

// Inventory Service: Listen for payment failure
eventBus.subscribe('payment.failed', async (event) => {
  // Compensate: Unreserve inventory
  const order = await db.query('SELECT * FROM orders WHERE id = $1', [event.orderId]);
  
  for (const item of order.rows[0].items) {
    await db.query(
      'UPDATE products SET stock = stock + $1 WHERE id = $2',
      [item.quantity, item.productId]
    );
  }
  
  await eventBus.publish('inventory.unreserved', {
    orderId: event.orderId
  });
});

// Order Service: Complete cancellation
eventBus.subscribe('inventory.unreserved', async (event) => {
  await db.query(
    'UPDATE orders SET status = $1 WHERE id = $2',
    ['cancelled', event.orderId]
  );
});
```

**2. Orchestration (Centralized Coordinator)**
```javascript
// Saga Orchestrator coordinates all steps
class OrderSaga {
  constructor(orderId, orderData) {
    this.orderId = orderId;
    this.orderData = orderData;
    this.currentStep = 0;
    this.completedSteps = [];
  }
  
  async execute() {
    try {
      // Step 1: Create order
      await this.createOrder();
      this.completedSteps.push('createOrder');
      
      // Step 2: Reserve inventory
      await this.reserveInventory();
      this.completedSteps.push('reserveInventory');
      
      // Step 3: Process payment
      await this.processPayment();
      this.completedSteps.push('processPayment');
      
      // Step 4: Create shipment
      await this.createShipment();
      this.completedSteps.push('createShipment');
      
      // Success!
      await this.complete();
      
    } catch (error) {
      // Something failed, compensate (rollback)
      await this.compensate();
      throw error;
    }
  }
  
  async createOrder() {
    const response = await axios.post('http://order-service/api/orders', {
      orderId: this.orderId,
      userId: this.orderData.userId,
      items: this.orderData.items,
      total: this.orderData.total
    });
    
    this.order = response.data;
  }
  
  async reserveInventory() {
    const response = await axios.post('http://inventory-service/api/reserve', {
      orderId: this.orderId,
      items: this.orderData.items
    });
    
    if (!response.data.success) {
      throw new Error('Insufficient inventory');
    }
  }
  
  async processPayment() {
    const response = await axios.post('http://payment-service/api/charge', {
      orderId: this.orderId,
      userId: this.orderData.userId,
      amount: this.orderData.total
    });
    
    if (!response.data.success) {
      throw new Error('Payment failed');
    }
    
    this.paymentId = response.data.paymentId;
  }
  
  async createShipment() {
    await axios.post('http://shipping-service/api/shipments', {
      orderId: this.orderId,
      items: this.orderData.items
    });
  }
  
  async complete() {
    await axios.patch(`http://order-service/api/orders/${this.orderId}`, {
      status: 'completed'
    });
  }
  
  // COMPENSATING ACTIONS
  async compensate() {
    logger.error('Saga failed, compensating', {
      orderId: this.orderId,
      completedSteps: this.completedSteps
    });
    
    // Reverse order of completed steps
    for (const step of this.completedSteps.reverse()) {
      try {
        if (step === 'createShipment') {
          await this.cancelShipment();
        } else if (step === 'processPayment') {
          await this.refundPayment();
        } else if (step === 'reserveInventory') {
          await this.unreserveInventory();
        } else if (step === 'createOrder') {
          await this.cancelOrder();
        }
      } catch (error) {
        logger.error('Compensation failed', { step, error });
        // Alert ops team - manual intervention needed
        await sendAlert({
          type: 'saga-compensation-failure',
          orderId: this.orderId,
          step,
          error: error.message
        });
      }
    }
  }
  
  async cancelShipment() {
    await axios.delete(`http://shipping-service/api/shipments/${this.orderId}`);
  }
  
  async refundPayment() {
    await axios.post('http://payment-service/api/refund', {
      paymentId: this.paymentId
    });
  }
  
  async unreserveInventory() {
    await axios.post('http://inventory-service/api/unreserve', {
      orderId: this.orderId,
      items: this.orderData.items
    });
  }
  
  async cancelOrder() {
    await axios.patch(`http://order-service/api/orders/${this.orderId}`, {
      status: 'cancelled'
    });
  }
}

// Usage
app.post('/api/orders', async (req, res) => {
  const orderId = uuidv4();
  const saga = new OrderSaga(orderId, req.body);
  
  try {
    await saga.execute();
    res.status(201).json({ orderId, status: 'completed' });
  } catch (error) {
    res.status(400).json({
      orderId,
      status: 'cancelled',
      reason: error.message
    });
  }
});
```

**Saga State Machine:**
```javascript
// Track saga progress in database
CREATE TABLE saga_state (
  saga_id UUID PRIMARY KEY,
  saga_type VARCHAR(50),
  current_step INTEGER,
  completed_steps TEXT[],
  status VARCHAR(20),
  data JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

class PersistentSaga {
  async saveState() {
    await db.query(`
      INSERT INTO saga_state (saga_id, saga_type, current_step, completed_steps, status, data)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (saga_id) DO UPDATE SET
        current_step = $3,
        completed_steps = $4,
        status = $5,
        data = $6,
        updated_at = NOW()
    `, [
      this.sagaId,
      this.type,
      this.currentStep,
      this.completedSteps,
      this.status,
      JSON.stringify(this.data)
    ]);
  }
  
  async execute() {
    await this.saveState();  // Save before each step
    
    try {
      await this.step1();
      this.currentStep++;
      await this.saveState();
      
      await this.step2();
      this.currentStep++;
      await this.saveState();
      
      // ... more steps
    } catch (error) {
      this.status = 'compensating';
      await this.saveState();
      await this.compensate();
    }
  }
  
  // Can resume saga if service crashes
  static async resume(sagaId) {
    const state = await db.query('SELECT * FROM saga_state WHERE saga_id = $1', [sagaId]);
    
    const saga = new PersistentSaga(state.rows[0]);
    await saga.resumeFromStep(state.rows[0].current_step);
  }
}
```

**Choreography vs Orchestration:**

| Aspect | Choreography | Orchestration |
|--------|--------------|---------------|
| Coordination | Decentralized (events) | Centralized (coordinator) |
| Complexity | Distributed logic | Single place |
| Coupling | Loose (services independent) | Tight (coordinator knows all) |
| Observability | Hard (trace events) | Easy (single state machine) |
| Failure handling | Each service handles own | Coordinator handles all |
| Best for | Simple flows, few steps | Complex flows, many steps |

**When to use Saga:**
```
✅ Distributed transactions across services
✅ Microservices architecture
✅ Long-running processes (hours/days)
✅ Need eventual consistency
✅ Can define compensating actions

Example: E-commerce order (inventory, payment, shipping)
Example: Travel booking (flight, hotel, car)
Example: Banking (transfer between accounts in different systems)
```

**When NOT to use Saga:**
```
❌ Single database (use ACID transaction)
❌ Strong consistency required (use 2PC if possible)
❌ Can't define compensating actions
❌ Simple operations (overkill)

Example: User registration (single service)
Example: Update profile (single database)
```

**Idempotency (Critical for Saga):**
```javascript
// Services must handle duplicate requests
async function reserveInventory(orderId, items) {
  // Check if already processed
  const existing = await db.query(
    'SELECT * FROM inventory_reservations WHERE order_id = $1',
    [orderId]
  );
  
  if (existing.rows.length > 0) {
    // Already processed, return success (idempotent)
    return { success: true, cached: true };
  }
  
  // Process reservation
  for (const item of items) {
    await db.query(
      'UPDATE products SET stock = stock - $1 WHERE id = $2',
      [item.quantity, item.productId]
    );
  }
  
  // Record reservation
  await db.query(
    'INSERT INTO inventory_reservations (order_id, items) VALUES ($1, $2)',
    [orderId, JSON.stringify(items)]
  );
  
  return { success: true };
}
```

**Interview tip:** Explain Saga as breaking distributed transaction into smaller local transactions with compensating actions for rollback, show both choreography (event-driven, decentralized) and orchestration (coordinator, centralized), demonstrate compensating actions for each step, discuss idempotency requirement (services must handle duplicates), mention when to use (microservices, distributed transactions) vs ACID (single database), and emphasize eventual consistency trade-off."

---

---

## Q49: What is Service Mesh and when do you need it?

**Perfect Answer:**

"Service mesh is infrastructure layer that handles service-to-service communication - routing, security, observability - without changing application code.

**Without Service Mesh:**
```javascript
// Every service must implement its own resilience logic
const result = await retryStrategy.execute(() =>
  axios.get('http://order-service/api/orders')
);

// Problems:
❌ Logic duplicated in every service
❌ Different languages = different implementations
❌ Hard to update (change code, redeploy all services)
❌ Inconsistent behavior across services
```

**With Service Mesh (Istio/Linkerd):**
```
Application code stays simple:
const result = await axios.get('http://order-service/api/orders');

Service mesh sidecar handles:
✅ Retry (3 attempts, exponential backoff)
✅ Circuit breaking (auto-detect failures)
✅ Distributed tracing (automatic headers)
✅ Mutual TLS (automatic cert rotation)
✅ Load balancing (round-robin, least-conn)
✅ Traffic routing (canary, blue/green)
✅ Observability (metrics, traces)
```

**When to use:**
- 20+ microservices
- Multiple teams/languages
- Need consistent policies
- Strong security requirements (mTLS)
- Kubernetes-based deployment

**When NOT to use:**
- Few services (< 10)
- Simple architecture
- Small team
- Not using Kubernetes

**Trade-offs:**
- +2-5ms latency per hop
- +50-200MB memory per pod (sidecar)
- Worth it for complex distributed systems

**Interview tip:** Explain service mesh as infrastructure layer via sidecar proxies, show how it removes resilience logic from code, mention when justified (many services, multiple teams) vs overhead (few services, simple architecture)."

---

## Q50: How do you design APIs for different client types?

**Perfect Answer:**

"Use Backend-for-Frontend (BFF) pattern - separate API layer per client type, optimized for each client's needs.

**Web BFF (Rich data):**
```javascript
app.get('/api/dashboard', authenticate, async (req, res) => {
  const [user, orders, analytics] = await Promise.all([
    axios.get(`${SERVICES.users}/api/users/${req.user.id}`),
    axios.get(`${SERVICES.orders}/api/orders?limit=100`),
    axios.get(`${SERVICES.analytics}/api/stats?granularity=hourly&days=30`)
  ]);
  
  res.json({
    user: user.data,
    orders: orders.data,
    analytics: analytics.data
  });
  // Response: ~2MB
});
```

**Mobile BFF (Minimal data):**
```javascript
app.get('/api/dashboard', authenticate, async (req, res) => {
  const [userBasic, recentOrders] = await Promise.all([
    axios.get(`${SERVICES.users}/api/users/${req.user.id}?fields=name,avatar`),
    axios.get(`${SERVICES.orders}/api/orders?limit=10&fields=id,total,status`)
  ]);
  
  res.json({
    user: { name: userBasic.data.name, avatar: userBasic.data.avatar },
    recentOrders: recentOrders.data
  });
  // Response: ~50KB (40× smaller!)
});
```

**IoT BFF (Ultra-minimal):**
```javascript
app.get('/api/status', authenticateDevice, async (req, res) => {
  const orders = await axios.get(`${SERVICES.orders}/api/orders?limit=1&fields=status`);
  
  res.json({
    c: orders.data.length,        // count
    s: orders.data[0]?.status,    // status code
    t: Date.now()                 // timestamp
  });
  // Response: ~100 bytes (20,000× smaller!)
});
```

**When to use BFF:**
- Multiple client types (web, mobile, IoT)
- Clients need different data shapes
- Different performance requirements

**BFF vs GraphQL:**
- BFF: Full control, optimized per client
- GraphQL: Client controls query, single API
- Choice: BFF for 3+ very different clients, GraphQL for flexible querying

**Interview tip:** Show web (rich), mobile (minimal), IoT (ultra-minimal) examples with actual size differences, explain BFF aggregates backend services and transforms responses per client needs."

---

---

## Q51: GraphQL vs REST - when to use each?

**Perfect Answer:**

"GraphQL and REST solve different problems. Choose based on client flexibility needs vs API simplicity.

**REST API:**
```javascript
// Multiple endpoints, fixed responses
GET /api/users/123
{
  "id": 123,
  "name": "John",
  "email": "john@example.com",
  "createdAt": "2024-01-15"
}

GET /api/users/123/orders
{
  "orders": [
    { "id": 1, "total": 100, "status": "completed" },
    { "id": 2, "total": 50, "status": "pending" }
  ]
}

GET /api/orders/1/items
{
  "items": [
    { "productId": 10, "quantity": 2, "price": 50 }
  ]
}

// Problems:
❌ Over-fetching (get fields you don't need)
❌ Under-fetching (need multiple requests)
❌ 3 requests for related data
❌ 300ms total (100ms each)
```

**GraphQL:**
```javascript
// Single endpoint, client specifies exactly what it needs
POST /graphql

// Query
{
  user(id: 123) {
    name
    email
    orders(limit: 10) {
      id
      total
      status
      items {
        productId
        quantity
        price
      }
    }
  }
}

// Response (exact shape requested)
{
  "data": {
    "user": {
      "name": "John",
      "email": "john@example.com",
      "orders": [
        {
          "id": 1,
          "total": 100,
          "status": "completed",
          "items": [
            { "productId": 10, "quantity": 2, "price": 50 }
          ]
        }
      ]
    }
  }
}

// Benefits:
✅ Single request (100ms vs 300ms)
✅ No over-fetching (only requested fields)
✅ No under-fetching (get related data)
✅ Client controls response shape
```

**GraphQL Implementation:**
```javascript
const { ApolloServer, gql } = require('apollo-server-express');

// Schema definition
const typeDefs = gql`
  type User {
    id: ID!
    name: String!
    email: String!
    orders(limit: Int): [Order!]!
  }
  
  type Order {
    id: ID!
    total: Float!
    status: String!
    items: [OrderItem!]!
  }
  
  type OrderItem {
    productId: ID!
    quantity: Int!
    price: Float!
  }
  
  type Query {
    user(id: ID!): User
    users(limit: Int, offset: Int): [User!]!
  }
  
  type Mutation {
    createOrder(userId: ID!, items: [OrderItemInput!]!): Order!
  }
  
  input OrderItemInput {
    productId: ID!
    quantity: Int!
  }
`;

// Resolvers (data fetching logic)
const resolvers = {
  Query: {
    user: async (parent, { id }, context) => {
      return await context.db.query('SELECT * FROM users WHERE id = $1', [id]);
    },
    
    users: async (parent, { limit = 20, offset = 0 }, context) => {
      return await context.db.query(
        'SELECT * FROM users LIMIT $1 OFFSET $2',
        [limit, offset]
      );
    }
  },
  
  User: {
    // Nested resolver - only called if client requests orders
    orders: async (parent, { limit = 10 }, context) => {
      return await context.db.query(
        'SELECT * FROM orders WHERE user_id = $1 LIMIT $2',
        [parent.id, limit]
      );
    }
  },
  
  Order: {
    // Only called if client requests items
    items: async (parent, args, context) => {
      return await context.db.query(
        'SELECT * FROM order_items WHERE order_id = $1',
        [parent.id]
      );
    }
  },
  
  Mutation: {
    createOrder: async (parent, { userId, items }, context) => {
      const result = await context.db.query(
        'INSERT INTO orders (user_id, total) VALUES ($1, $2) RETURNING *',
        [userId, calculateTotal(items)]
      );
      
      return result.rows[0];
    }
  }
};

// Server setup
const server = new ApolloServer({
  typeDefs,
  resolvers,
  context: ({ req }) => ({
    db: pool,
    user: req.user
  })
});

server.applyMiddleware({ app });
```

**N+1 Query Problem (GraphQL Challenge):**
```javascript
// Bad: N+1 queries
const resolvers = {
  Query: {
    users: async () => {
      return await db.query('SELECT * FROM users LIMIT 10');
      // Returns 10 users
    }
  },
  
  User: {
    orders: async (parent) => {
      // Called 10 times (once per user)!
      return await db.query('SELECT * FROM orders WHERE user_id = $1', [parent.id]);
    }
  }
};

// Problem:
// 1 query for users (SELECT * FROM users)
// + 10 queries for orders (SELECT * FROM orders WHERE user_id = ?)
// = 11 queries total (N+1 problem)

// Solution: DataLoader (batching)
const DataLoader = require('dataloader');

const orderLoader = new DataLoader(async (userIds) => {
  // Single query for all users
  const orders = await db.query(
    'SELECT * FROM orders WHERE user_id = ANY($1)',
    [userIds]
  );
  
  // Group by user_id
  const ordersByUser = {};
  orders.rows.forEach(order => {
    if (!ordersByUser[order.user_id]) {
      ordersByUser[order.user_id] = [];
    }
    ordersByUser[order.user_id].push(order);
  });
  
  // Return in same order as userIds
  return userIds.map(id => ordersByUser[id] || []);
});

const resolvers = {
  User: {
    orders: async (parent, args, context) => {
      return await context.loaders.orders.load(parent.id);
    }
  }
};

// Now: 1 query for users + 1 query for all orders = 2 queries total!
```

**GraphQL Caching (Complex):**
```javascript
// REST: Easy caching (URL-based)
GET /api/users/123 → Cache key: "users:123"

// GraphQL: Hard (query-based caching)
POST /graphql
{
  user(id: 123) { name, email }
}
// Cache key: hash of entire query?

// Solution: Persisted queries
// Client sends query hash instead of full query
POST /graphql
{
  "extensions": {
    "persistedQuery": {
      "version": 1,
      "sha256Hash": "abc123..."
    }
  }
}

// Server caches by hash
// Or use Apollo Client automatic caching (by __typename + id)
```

**REST vs GraphQL Comparison:**

| Aspect | REST | GraphQL |
|--------|------|---------|
| Endpoints | Multiple (/users, /orders) | Single (/graphql) |
| Over-fetching | Common (fixed responses) | No (client specifies) |
| Under-fetching | Common (need multiple requests) | No (nested queries) |
| Versioning | URL versioning (/v1, /v2) | Schema evolution |
| Caching | Easy (HTTP caching) | Complex (query-based) |
| Learning curve | Low | High |
| Tooling | Mature (Postman, Swagger) | Growing (GraphiQL, Playground) |
| File upload | Native (multipart/form-data) | Requires extra setup |
| Real-time | WebSockets/SSE | Subscriptions (built-in) |
| Error handling | HTTP status codes | Always 200, errors in response |

**When to use REST:**
```
✅ Simple CRUD operations
✅ Public APIs (easy to document, test)
✅ Caching critical (CDN, browser cache)
✅ File uploads/downloads
✅ Small team (less learning curve)
✅ Existing REST infrastructure

Example: Public API for third-party integrations
```

**When to use GraphQL:**
```
✅ Complex data relationships (nested objects)
✅ Multiple client types (web, mobile) with different needs
✅ Rapid frontend iteration (backend changes less)
✅ Mobile apps (reduce payload size)
✅ Real-time updates (subscriptions)
✅ Internal APIs (team controls both sides)

Example: Facebook, GitHub, Shopify (complex data, many clients)
```

**Hybrid Approach:**
```javascript
// Use both!

// REST for simple operations
GET /api/health
GET /api/metrics
POST /api/webhooks

// GraphQL for complex queries
POST /graphql
{
  dashboard {
    user { ... }
    orders { ... }
    analytics { ... }
  }
}
```

**Interview tip:** Show GraphQL solves over/under-fetching with single flexible endpoint, demonstrate N+1 problem and DataLoader solution, compare REST (simple, cacheable, mature) vs GraphQL (flexible, complex queries, steep learning curve), discuss when to use each based on API complexity and client diversity, mention REST for public APIs and GraphQL for internal/complex data."

---

## Q52: How do you implement WebSockets for real-time features?

**Perfect Answer:**

"WebSockets provide full-duplex communication for real-time features like chat, notifications, live updates.

**HTTP vs WebSocket:**
```
HTTP (Request-Response):
Client → Server: GET /api/messages (100ms)
Client → Server: GET /api/messages (100ms) [poll every second]
Client → Server: GET /api/messages (100ms)
❌ Inefficient (constant polling)
❌ High latency (1s delay)
❌ Server overhead (many requests)

WebSocket (Persistent Connection):
Client ⇄ Server: Upgrade to WebSocket
Client ← Server: New message! (instant)
Client ← Server: User typing... (instant)
✅ Real-time (no polling delay)
✅ Efficient (single connection)
✅ Bidirectional (server can push)
```

**WebSocket Server (Socket.IO):**
```javascript
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: ['http://localhost:3000'],
    credentials: true
  },
  // Connection settings
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling']  // Fallback to polling if WS fails
});

// Authentication middleware
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  
  if (!token) {
    return next(new Error('Authentication required'));
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.userId = decoded.id;
    socket.username = decoded.name;
    next();
  } catch (error) {
    next(new Error('Invalid token'));
  }
});

// Connection handler
io.on('connection', (socket) => {
  console.log('User connected', socket.userId);
  
  // Join user-specific room (for private messages)
  socket.join(`user:${socket.userId}`);
  
  // Notify others user is online
  socket.broadcast.emit('user:online', {
    userId: socket.userId,
    username: socket.username
  });
  
  // Chat message
  socket.on('message:send', async (data) => {
    const { roomId, text } = data;
    
    // Validate
    if (!text || text.length > 1000) {
      return socket.emit('error', { message: 'Invalid message' });
    }
    
    // Save to database
    const message = await db.query(
      'INSERT INTO messages (room_id, user_id, text) VALUES ($1, $2, $3) RETURNING *',
      [roomId, socket.userId, text]
    );
    
    // Broadcast to room
    io.to(`room:${roomId}`).emit('message:new', {
      id: message.rows[0].id,
      userId: socket.userId,
      username: socket.username,
      text,
      timestamp: new Date()
    });
  });
  
  // Join chat room
  socket.on('room:join', async (roomId) => {
    socket.join(`room:${roomId}`);
    
    // Load recent messages
    const messages = await db.query(
      'SELECT * FROM messages WHERE room_id = $1 ORDER BY created_at DESC LIMIT 50',
      [roomId]
    );
    
    socket.emit('room:messages', messages.rows.reverse());
    
    // Notify others user joined
    socket.to(`room:${roomId}`).emit('user:joined', {
      userId: socket.userId,
      username: socket.username
    });
  });
  
  // Leave room
  socket.on('room:leave', (roomId) => {
    socket.leave(`room:${roomId}`);
    
    socket.to(`room:${roomId}`).emit('user:left', {
      userId: socket.userId,
      username: socket.username
    });
  });
  
  // Typing indicator
  socket.on('typing:start', (roomId) => {
    socket.to(`room:${roomId}`).emit('user:typing', {
      userId: socket.userId,
      username: socket.username
    });
  });
  
  socket.on('typing:stop', (roomId) => {
    socket.to(`room:${roomId}`).emit('user:stopped-typing', {
      userId: socket.userId
    });
  });
  
  // Disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected', socket.userId);
    
    // Notify others user is offline
    socket.broadcast.emit('user:offline', {
      userId: socket.userId
    });
  });
});

httpServer.listen(3000, () => {
  console.log('WebSocket server listening on port 3000');
});
```

**WebSocket Client (React):**
```javascript
import { useEffect, useState } from 'react';
import io from 'socket.io-client';

function ChatRoom({ roomId, token }) {
  const [socket, setSocket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  
  useEffect(() => {
    // Connect to WebSocket server
    const newSocket = io('http://localhost:3000', {
      auth: { token },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5
    });
    
    // Connection events
    newSocket.on('connect', () => {
      console.log('Connected');
      setIsConnected(true);
      
      // Join room
      newSocket.emit('room:join', roomId);
    });
    
    newSocket.on('disconnect', () => {
      console.log('Disconnected');
      setIsConnected(false);
    });
    
    newSocket.on('connect_error', (error) => {
      console.error('Connection error', error.message);
    });
    
    // Message events
    newSocket.on('room:messages', (msgs) => {
      setMessages(msgs);
    });
    
    newSocket.on('message:new', (message) => {
      setMessages(prev => [...prev, message]);
    });
    
    // User events
    newSocket.on('user:joined', (user) => {
      console.log(`${user.username} joined`);
    });
    
    newSocket.on('user:typing', (user) => {
      console.log(`${user.username} is typing...`);
    });
    
    setSocket(newSocket);
    
    // Cleanup on unmount
    return () => {
      newSocket.emit('room:leave', roomId);
      newSocket.close();
    };
  }, [roomId, token]);
  
  const sendMessage = (text) => {
    if (!socket || !isConnected) return;
    
    socket.emit('message:send', {
      roomId,
      text
    });
  };
  
  const startTyping = () => {
    socket?.emit('typing:start', roomId);
  };
  
  return (
    <div>
      {!isConnected && <div>Reconnecting...</div>}
      
      <MessageList messages={messages} />
      
      <MessageInput 
        onSend={sendMessage}
        onTyping={startTyping}
        disabled={!isConnected}
      />
    </div>
  );
}
```

**Scaling WebSockets (Redis Adapter):**
```javascript
// Problem: Multiple servers, connections on different servers
// User A connects to Server 1
// User B connects to Server 2
// User A sends message → only reaches Server 1 (User B doesn't receive)

// Solution: Redis Pub/Sub adapter
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');

const pubClient = createClient({ host: 'redis' });
const subClient = pubClient.duplicate();

Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
  io.adapter(createAdapter(pubClient, subClient));
});

// Now messages broadcast across all servers:
// User A (Server 1) → Redis Pub/Sub → Server 2 → User B
```

**Horizontal Scaling Architecture:**
```
Load Balancer (sticky sessions)
    ↓
┌────────┬────────┬────────┐
│Server 1│Server 2│Server 3│
│  WS    │  WS    │  WS    │
└───┬────┴───┬────┴───┬────┘
    └────────┼────────┘
             ↓
        Redis Pub/Sub
```

**Authentication & Authorization:**
```javascript
// Authenticate on connection
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  const decoded = jwt.verify(token, JWT_SECRET);
  socket.userId = decoded.id;
  next();
});

// Authorize specific actions
socket.on('message:send', async (data) => {
  // Check if user is member of room
  const isMember = await db.query(
    'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
    [data.roomId, socket.userId]
  );
  
  if (isMember.rows.length === 0) {
    return socket.emit('error', { message: 'Not authorized' });
  }
  
  // Process message
});
```

**Rate Limiting:**
```javascript
const rateLimit = new Map();

socket.on('message:send', async (data) => {
  const key = socket.userId;
  const limit = 10;  // 10 messages per minute
  const window = 60000;
  
  const now = Date.now();
  const userLimit = rateLimit.get(key) || { count: 0, resetAt: now + window };
  
  if (now > userLimit.resetAt) {
    userLimit.count = 0;
    userLimit.resetAt = now + window;
  }
  
  if (userLimit.count >= limit) {
    return socket.emit('error', { message: 'Rate limit exceeded' });
  }
  
  userLimit.count++;
  rateLimit.set(key, userLimit);
  
  // Process message
});
```

**Heartbeat (Connection Health):**
```javascript
// Server pings client every 25s
// If no pong after 60s, disconnect

io.on('connection', (socket) => {
  socket.isAlive = true;
  
  socket.on('pong', () => {
    socket.isAlive = true;
  });
});

// Cleanup dead connections
setInterval(() => {
  io.sockets.sockets.forEach((socket) => {
    if (socket.isAlive === false) {
      return socket.disconnect();
    }
    
    socket.isAlive = false;
    socket.ping();
  });
}, 30000);
```

**Use Cases:**
```
✅ Chat applications
✅ Real-time notifications
✅ Live dashboards (metrics, analytics)
✅ Collaborative editing (Google Docs)
✅ Online gaming
✅ Live sports scores
✅ Stock tickers
✅ IoT device updates
```

**WebSocket vs Alternatives:**
```
WebSocket:
✅ Full-duplex (bidirectional)
✅ Low latency (< 10ms)
✅ Efficient (single connection)
❌ Complex to scale
❌ Requires sticky sessions

Server-Sent Events (SSE):
✅ Simple (built into browsers)
✅ Auto-reconnect
✅ HTTP/2 compatible
❌ One-way (server → client only)
❌ Text data only

Long Polling:
✅ Works everywhere (HTTP)
✅ No special infrastructure
❌ High latency (100-1000ms)
❌ Inefficient (constant requests)
```

**Interview tip:** Show WebSocket provides bidirectional real-time communication, demonstrate Socket.IO server with rooms and authentication, explain scaling challenge (Redis adapter for multiple servers), discuss rate limiting and connection health, mention use cases (chat, notifications, live updates), compare to SSE (one-way) and long polling (inefficient)."

---

## Q53: What is rate limiting and how do you implement it?

**Perfect Answer:**

"Rate limiting restricts number of requests a client can make in a time window, preventing abuse and ensuring fair resource usage.

**Why Rate Limiting:**
```
Without rate limiting:
- Malicious user makes 100,000 req/sec
- Database overloaded
- Legitimate users can't access service
- $10,000 cloud bill

With rate limiting:
- Limit to 100 req/15min per user
- Attacker blocked after 100 requests
- Service stays available
- Costs controlled
```

**Token Bucket Algorithm:**
```javascript
// Most common algorithm

class TokenBucket {
  constructor(capacity, refillRate) {
    this.capacity = capacity;       // Max tokens (burst)
    this.tokens = capacity;         // Current tokens
    this.refillRate = refillRate;   // Tokens per second
    this.lastRefill = Date.now();
  }
  
  refill() {
    const now = Date.now();
    const timePassed = (now - this.lastRefill) / 1000;
    const tokensToAdd = timePassed * this.refillRate;
    
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
  
  consume(tokens = 1) {
    this.refill();
    
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;  // Request allowed
    }
    
    return false;  // Rate limited
  }
}

// Usage
const bucket = new TokenBucket(100, 10);  // 100 max, refill 10/sec

if (bucket.consume(1)) {
  // Process request
} else {
  // 429 Too Many Requests
}
```

**Redis-Based Rate Limiter (Distributed):**
```javascript
const redis = require('redis');
const client = redis.createClient();

class RedisRateLimiter {
  constructor(options) {
    this.windowMs = options.windowMs || 60000;     // 1 minute
    this.max = options.max || 100;                 // 100 requests
    this.keyPrefix = options.keyPrefix || 'rate:';
  }
  
  async consume(identifier) {
    const key = `${this.keyPrefix}${identifier}`;
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    // Remove old entries (outside window)
    await client.zRemRangeByScore(key, 0, windowStart);
    
    // Count requests in current window
    const count = await client.zCard(key);
    
    if (count >= this.max) {
      // Rate limited
      const oldestEntry = await client.zRange(key, 0, 0, { withScores: true });
      const retryAfter = Math.ceil((oldestEntry[0].score + this.windowMs - now) / 1000);
      
      return {
        allowed: false,
        remaining: 0,
        retryAfter
      };
    }
    
    // Add current request
    await client.zAdd(key, [{ score: now, value: `${now}:${Math.random()}` }]);
    
    // Set expiry on key
    await client.expire(key, Math.ceil(this.windowMs / 1000));
    
    return {
      allowed: true,
      remaining: this.max - count - 1
    };
  }
}

// Usage
const limiter = new RedisRateLimiter({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 100                    // 100 requests
});

app.use(async (req, res, next) => {
  const identifier = req.user?.id || req.ip;
  
  const result = await limiter.consume(identifier);
  
  // Add rate limit headers
  res.set({
    'X-RateLimit-Limit': '100',
    'X-RateLimit-Remaining': result.remaining,
    'X-RateLimit-Reset': Date.now() + 900000  // 15 min from now
  });
  
  if (!result.allowed) {
    res.set('Retry-After', result.retryAfter);
    return res.status(429).json({
      error: 'Too many requests',
      retryAfter: result.retryAfter
    });
  }
  
  next();
});
```

**Different Limits per Endpoint:**
```javascript
const rateLimiters = {
  login: new RedisRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 5  // Only 5 login attempts per 15 min
  }),
  
  register: new RedisRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 3  // Only 3 registrations per hour
  }),
  
  api: new RedisRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 100  // 100 API calls per 15 min
  })
};

app.post('/api/auth/login', async (req, res, next) => {
  const result = await rateLimiters.login.consume(req.ip);
  
  if (!result.allowed) {
    return res.status(429).json({
      error: 'Too many login attempts',
      retryAfter: result.retryAfter
    });
  }
  
  next();
});
```

**Tiered Rate Limits (By User Plan):**
```javascript
const getLimiter = (userPlan) => {
  const limits = {
    free: { windowMs: 60000, max: 10 },      // 10 req/min
    basic: { windowMs: 60000, max: 100 },    // 100 req/min
    premium: { windowMs: 60000, max: 1000 }  // 1000 req/min
  };
  
  return new RedisRateLimiter(limits[userPlan] || limits.free);
};

app.use(async (req, res, next) => {
  const userPlan = req.user?.plan || 'free';
  const limiter = getLimiter(userPlan);
  
  const result = await limiter.consume(req.user?.id || req.ip);
  
  if (!result.allowed) {
    return res.status(429).json({
      error: 'Rate limit exceeded',
      plan: userPlan,
      upgradeUrl: '/pricing'
    });
  }
  
  next();
});
```

**Cost-Based Rate Limiting:**
```javascript
// Different operations cost different amounts
const costs = {
  'GET /api/users': 1,           // Cheap read
  'POST /api/orders': 10,        // Expensive write
  'POST /api/reports/generate': 100  // Very expensive
};

app.use(async (req, res, next) => {
  const endpoint = `${req.method} ${req.path}`;
  const cost = costs[endpoint] || 1;
  
  const result = await limiter.consume(req.user.id, cost);
  
  if (!result.allowed) {
    return res.status(429).json({
      error: 'Rate limit exceeded',
      cost,
      remaining: result.remaining
    });
  }
  
  next();
});
```

**Rate Limit Response Headers:**
```javascript
// Standard headers
res.set({
  'X-RateLimit-Limit': '100',           // Total allowed
  'X-RateLimit-Remaining': '87',        // Requests left
  'X-RateLimit-Reset': '1640000000',    // Unix timestamp when limit resets
  'Retry-After': '60'                   // Seconds to wait (when 429)
});

// Alternative format
res.set({
  'RateLimit-Limit': '100',
  'RateLimit-Remaining': '87',
  'RateLimit-Reset': '60'  // Seconds (not timestamp)
});
```

**Algorithms Comparison:**
```
Token Bucket:
✅ Allows bursts (up to capacity)
✅ Smooth rate over time
✅ Most common
Example: 100 tokens, refill 10/sec
- Can burst 100 requests immediately
- Then 10 req/sec sustained

Fixed Window:
✅ Simple to implement
❌ Burst at window boundaries
Example: 100 req/min, window starts at :00
- 100 requests at 12:00:59
- 100 requests at 12:01:00
- = 200 requests in 2 seconds!

Sliding Window:
✅ Accurate rate limiting
✅ No boundary bursts
❌ More complex
Example: 100 req/min, sliding window
- Count requests in last 60 seconds
- Always enforces 100/min

Leaky Bucket:
✅ Smooth output rate
❌ Doesn't allow bursts
Example: Process 10 req/sec
- Incoming requests queue
- Processed at fixed rate
```

**Bypass for Internal Services:**
```javascript
app.use(async (req, res, next) => {
  // Skip rate limiting for internal services
  const isInternal = req.headers['x-internal-service'] === process.env.INTERNAL_SECRET;
  
  if (isInternal) {
    return next();
  }
  
  // Rate limit external requests
  const result = await limiter.consume(req.ip);
  
  if (!result.allowed) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }
  
  next();
});
```

**Interview tip:** Explain rate limiting prevents abuse and ensures fair resource usage, show token bucket algorithm (most common), demonstrate Redis-based distributed implementation, discuss different limits per endpoint (login stricter than API), mention tiered limits by user plan, show proper HTTP headers (X-RateLimit-*), and compare algorithms (token bucket allows bursts, fixed window has boundary issues, sliding window most accurate)."

---

## Q54: How do you implement API versioning strategies?

**Perfect Answer:**

"API versioning manages breaking changes while supporting existing clients. Three main strategies: URL, header, or content negotiation.

**Strategy 1: URL Versioning (Most Common)**
```javascript
// Version in URL path
app.use('/api/v1/users', usersV1Router);
app.use('/api/v2/users', usersV2Router);
app.use('/api/v3/users', usersV3Router);

// V1: Returns full user object
app.get('/api/v1/users/:id', async (req, res) => {
  const user = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.created_at
  });
});

// V2: Returns nested address object (breaking change)
app.get('/api/v2/users/:id', async (req, res) => {
  const user = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    address: {
      street: user.street,
      city: user.city,
      country: user.country
    },
    createdAt: user.created_at
  });
});

// V3: Uses camelCase instead of snake_case (breaking change)
app.get('/api/v3/users/:id', async (req, res) => {
  const user = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    address: {
      street: user.street,
      city: user.city,
      country: user.country
    },
    createdAt: user.created_at  // Now camelCase
  });
});

// Pros:
✅ Explicit version in URL (easy to debug)
✅ Easy to cache (different URLs)
✅ Easy to route (separate routers)
✅ Works with all HTTP clients

// Cons:
❌ URL changes on version upgrade
❌ Code duplication across versions
```

**Strategy 2: Header Versioning**
```javascript
// Version in Accept or custom header
app.use('/api/users', async (req, res, next) => {
  // Get version from header
  const version = req.headers['api-version'] || 'v1';
  req.apiVersion = version;
  next();
});

app.get('/api/users/:id', async (req, res) => {
  const user = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  
  // Route based on version
  if (req.apiVersion === 'v3') {
    return res.json(formatUserV3(user));
  } else if (req.apiVersion === 'v2') {
    return res.json(formatUserV2(user));
  } else {
    return res.json(formatUserV1(user));
  }
});

// Client usage:
// curl -H "API-Version: v2" https://api.example.com/api/users/123

// Pros:
✅ Clean URLs (same endpoint)
✅ Easier to evolve (no URL changes)
✅ RESTful (resource doesn't change)

// Cons:
❌ Less visible (hidden in headers)
❌ Harder to debug
❌ Caching complex (vary by header)
❌ Not all clients support custom headers
```

**Strategy 3: Content Negotiation (Accept Header)**
```javascript
// Version in Accept header MIME type
app.get('/api/users/:id', async (req, res) => {
  const user = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  
  const acceptHeader = req.headers['accept'] || '';
  
  if (acceptHeader.includes('application/vnd.myapi.v3+json')) {
    res.type('application/vnd.myapi.v3+json');
    return res.json(formatUserV3(user));
  } else if (acceptHeader.includes('application/vnd.myapi.v2+json')) {
    res.type('application/vnd.myapi.v2+json');
    return res.json(formatUserV2(user));
  } else {
    res.type('application/json');
    return res.json(formatUserV1(user));
  }
});

// Client usage:
// curl -H "Accept: application/vnd.myapi.v2+json" https://api.example.com/api/users/123

// Pros:
✅ RESTful standard (content negotiation)
✅ Clean URLs
✅ Supports multiple formats (JSON, XML)

// Cons:
❌ Complex to implement
❌ Difficult for clients to use
❌ Uncommon in practice
```

**Shared Business Logic (DRY)**
```javascript
// services/userService.js - Shared logic
class UserService {
  async getUser(id) {
    const user = await db.query('SELECT * FROM users WHERE id = $1', [id]);
    return user.rows[0];
  }
  
  async updateUser(id, data) {
    return await db.query('UPDATE users SET name = $1, email = $2 WHERE id = $3 RETURNING *', 
      [data.name, data.email, id]);
  }
}

// Formatters per version
class UserFormatterV1 {
  format(user) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      created_at: user.created_at
    };
  }
}

class UserFormatterV2 {
  format(user) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      address: {
        street: user.street,
        city: user.city
      },
      created_at: user.created_at
    };
  }
}

class UserFormatterV3 {
  format(user) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      address: {
        street: user.street,
        city: user.city
      },
      createdAt: user.created_at  // camelCase
    };
  }
}

// Routes
app.get('/api/v1/users/:id', async (req, res) => {
  const user = await userService.getUser(req.params.id);
  res.json(new UserFormatterV1().format(user));
});

app.get('/api/v2/users/:id', async (req, res) => {
  const user = await userService.getUser(req.params.id);
  res.json(new UserFormatterV2().format(user));
});

app.get('/api/v3/users/:id', async (req, res) => {
  const user = await userService.getUser(req.params.id);
  res.json(new UserFormatterV3().format(user));
});
```

**Version Deprecation Strategy:**
```javascript
// Warn clients about deprecated versions
app.use('/api/v1', (req, res, next) => {
  res.set({
    'X-API-Version': 'v1',
    'X-API-Deprecated': 'true',
    'X-API-Sunset': '2024-12-31',  // Shutdown date
    'X-API-Latest': 'v3',
    'Link': '</api/v3>; rel="successor-version"'
  });
  
  logger.warn('Deprecated API version used', {
    version: 'v1',
    path: req.path,
    ip: req.ip,
    userAgent: req.headers['user-agent']
  });
  
  next();
});

// Return deprecation in response
app.get('/api/v1/users/:id', async (req, res) => {
  const user = await userService.getUser(req.params.id);
  
  res.json({
    data: formatUserV1(user),
    _meta: {
      deprecated: true,
      sunsetDate: '2024-12-31',
      migrateTo: 'v3',
      migrationGuide: 'https://docs.example.com/migration/v1-to-v3'
    }
  });
});
```

**Version Detection Middleware:**
```javascript
function versionMiddleware(req, res, next) {
  // Try URL first
  const urlMatch = req.path.match(/^\/api\/(v\d+)\//);
  if (urlMatch) {
    req.apiVersion = urlMatch[1];
    return next();
  }
  
  // Try header
  const headerVersion = req.headers['api-version'];
  if (headerVersion) {
    req.apiVersion = headerVersion;
    return next();
  }
  
  // Try Accept header
  const accept = req.headers['accept'] || '';
  const acceptMatch = accept.match(/application\/vnd\.myapi\.(v\d+)\+json/);
  if (acceptMatch) {
    req.apiVersion = acceptMatch[1];
    return next();
  }
  
  // Default to latest
  req.apiVersion = 'v3';
  next();
}

app.use(versionMiddleware);
```

**Breaking vs Non-Breaking Changes:**
```
Non-Breaking (No new version needed):
✅ Adding new optional fields
✅ Adding new endpoints
✅ Adding new query parameters (optional)
✅ Making required field optional
✅ Relaxing validation rules

Breaking (Requires new version):
❌ Removing fields
❌ Renaming fields
❌ Changing field types (string → number)
❌ Adding required fields
❌ Changing response structure
❌ Changing error codes
❌ Stricter validation
❌ Changing authentication
```

**Semantic Versioning (SemVer):**
```
v1.2.3
│ │ │
│ │ └─ PATCH: Bug fixes (backward compatible)
│ └─── MINOR: New features (backward compatible)
└───── MAJOR: Breaking changes

Examples:
v1.0.0 → v1.0.1: Bug fix (auto-upgrade safe)
v1.0.1 → v1.1.0: New feature (auto-upgrade safe)
v1.1.0 → v2.0.0: Breaking change (manual upgrade needed)
```

**Version Lifecycle:**
```
Timeline for v1 → v2 migration:

Month 1: Launch v2
- v1: Supported ✅
- v2: Available ✅

Month 2-6: Encourage migration
- v1: Supported ✅ (add deprecation headers)
- v2: Recommended ✅
- Send emails to v1 users
- Show migration guide

Month 7-11: Sunset warning
- v1: Deprecated ⚠️ (warn in responses)
- v2: Recommended ✅
- Announce sunset date
- Personal outreach to heavy v1 users

Month 12: Sunset v1
- v1: Returns 410 Gone ❌
- v2: Supported ✅

Best practice: 6-12 month deprecation period
```

**API Gateway Version Routing:**
```javascript
// Gateway routes based on version
const SERVICES = {
  v1: {
    users: 'http://user-service-v1:3001',
    orders: 'http://order-service-v1:3002'
  },
  v2: {
    users: 'http://user-service-v2:3001',
    orders: 'http://order-service-v2:3002'
  }
};

app.use('/api/:version/:service/*', (req, res) => {
  const { version, service } = req.params;
  const targetUrl = SERVICES[version]?.[service];
  
  if (!targetUrl) {
    return res.status(404).json({ error: 'Version or service not found' });
  }
  
  // Forward to correct service version
  proxy.web(req, res, { target: targetUrl });
});
```

**Interview tip:** Show URL versioning (most common, explicit), compare with header versioning (clean URLs but less visible) and content negotiation (RESTful but complex), demonstrate shared business logic with version-specific formatters to avoid duplication, explain breaking vs non-breaking changes, discuss deprecation strategy with sunset dates and migration period (6-12 months), mention version lifecycle from launch to sunset."

---

## Q55: What is database sharding and when do you need it?

**Perfect Answer:**

"Sharding is horizontal partitioning - splitting large database into smaller pieces (shards) across multiple servers for scalability.

**Without Sharding (Single Database):**
```
All 100M users in one database

Problems:
❌ Single point of failure
❌ Limited by single server (CPU, RAM, disk)
❌ Slow queries (scanning 100M rows)
❌ Expensive vertical scaling (bigger server)
❌ Backup takes hours
❌ Can't scale beyond single machine limits
```

**With Sharding (Distributed):**
```
100M users split across 4 shards

Shard 1: Users 0-25M    (Server 1)
Shard 2: Users 25-50M   (Server 2)
Shard 3: Users 50-75M   (Server 3)
Shard 4: Users 75-100M  (Server 4)

Benefits:
✅ Horizontal scaling (add more servers)
✅ Better performance (smaller datasets)
✅ Fault tolerance (one shard down ≠ all down)
✅ Faster queries (25M rows vs 100M)
✅ Parallel operations (4× throughput)
```

**Sharding Strategies:**

**1. Hash-Based Sharding (Most Common)**
```javascript
function getShardId(userId) {
  // Hash user ID to determine shard
  const hash = crypto.createHash('md5').update(userId.toString()).digest('hex');
  const hashInt = parseInt(hash.substring(0, 8), 16);
  
  return hashInt % NUM_SHARDS;  // 0, 1, 2, or 3
}

// Usage
async function getUser(userId) {
  const shardId = getShardId(userId);
  const db = getShardConnection(shardId);
  
  return await db.query('SELECT * FROM users WHERE id = $1', [userId]);
}

// Pros:
✅ Even distribution (no hot shards)
✅ Simple to implement
✅ Scales linearly

// Cons:
❌ Hard to add/remove shards (rehashing needed)
❌ Range queries difficult (must query all shards)
```

**2. Range-Based Sharding**
```javascript
function getShardId(userId) {
  if (userId <= 25000000) return 0;
  if (userId <= 50000000) return 1;
  if (userId <= 75000000) return 2;
  return 3;
}

// Pros:
✅ Easy to add shards (just split ranges)
✅ Range queries efficient (single shard)
✅ Natural partitioning (by date, geography)

// Cons:
❌ Uneven distribution (hot shards)
❌ Need to rebalance (move data between shards)

// Example: Hot shard
Shard 0: 100,000 active users (old users, inactive)
Shard 3: 5,000,000 active users (new users, very active)
// Shard 3 overloaded!
```

**3. Geographic Sharding**
```javascript
function getShardId(country) {
  const shardMap = {
    'US': 0,
    'UK': 1,
    'EU': 1,
    'ASIA': 2,
    'OTHER': 3
  };
  
  return shardMap[country] || 3;
}

// Pros:
✅ Low latency (data close to users)
✅ Compliance (GDPR - EU data in EU)
✅ Natural boundaries

// Cons:
❌ Uneven distribution (more US users)
❌ Cross-shard queries (user travels)
```

**Shard Routing Layer:**
```javascript
class ShardRouter {
  constructor() {
    this.shards = [
      new Pool({ host: 'shard-0.db', database: 'users' }),
      new Pool({ host: 'shard-1.db', database: 'users' }),
      new Pool({ host: 'shard-2.db', database: 'users' }),
      new Pool({ host: 'shard-3.db', database: 'users' })
    ];
  }
  
  getShardId(key) {
    const hash = crypto.createHash('md5').update(key.toString()).digest('hex');
    return parseInt(hash.substring(0, 8), 16) % this.shards.length;
  }
  
  getShard(key) {
    const shardId = this.getShardId(key);
    return this.shards[shardId];
  }
  
  async query(key, sql, params) {
    const shard = this.getShard(key);
    return await shard.query(sql, params);
  }
  
  // Query all shards (expensive!)
  async queryAll(sql, params) {
    const results = await Promise.all(
      this.shards.map(shard => shard.query(sql, params))
    );
    
    // Merge results
    return results.flatMap(r => r.rows);
  }
}

// Usage
const router = new ShardRouter();

// Single shard query (fast)
app.get('/api/users/:id', async (req, res) => {
  const result = await router.query(
    req.params.id,
    'SELECT * FROM users WHERE id = $1',
    [req.params.id]
  );
  
  res.json(result.rows[0]);
});

// All shards query (slow)
app.get('/api/users/search', async (req, res) => {
  const results = await router.queryAll(
    'SELECT * FROM users WHERE name ILIKE $1 LIMIT 10',
    [`%${req.query.q}%`]
  );
  
  res.json(results);
});
```

**Cross-Shard Queries (Challenge):**
```javascript
// Problem: User A (Shard 0) sends message to User B (Shard 2)
// Need to query multiple shards

async function getConversation(user1Id, user2Id) {
  const shard1 = router.getShard(user1Id);
  const shard2 = router.getShard(user2Id);
  
  // Query both shards in parallel
  const [messages1, messages2] = await Promise.all([
    shard1.query(
      'SELECT * FROM messages WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)',
      [user1Id, user2Id]
    ),
    // Only query shard2 if different from shard1
    shard1 !== shard2 ? shard2.query(
      'SELECT * FROM messages WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)',
      [user1Id, user2Id]
    ) : Promise.resolve({ rows: [] })
  ]);
  
  // Merge and sort
  const allMessages = [...messages1.rows, ...messages2.rows]
    .sort((a, b) => a.created_at - b.created_at);
  
  return allMessages;
}

// Better approach: Denormalize
// Store messages in BOTH user shards
async function sendMessage(senderId, receiverId, text) {
  const senderShard = router.getShard(senderId);
  const receiverShard = router.getShard(receiverId);
  
  const message = {
    id: uuidv4(),
    sender_id: senderId,
    receiver_id: receiverId,
    text,
    created_at: new Date()
  };
  
  // Write to both shards
  await Promise.all([
    senderShard.query(
      'INSERT INTO messages (id, sender_id, receiver_id, text, created_at) VALUES ($1, $2, $3, $4, $5)',
      [message.id, senderId, receiverId, text, message.created_at]
    ),
    receiverShard.query(
      'INSERT INTO messages (id, sender_id, receiver_id, text, created_at) VALUES ($1, $2, $3, $4, $5)',
      [message.id, senderId, receiverId, text, message.created_at]
    )
  ]);
  
  // Now each user can query their own shard only!
}
```

**Resharding (Adding Shards):**
```javascript
// Problem: 4 shards → 8 shards
// Need to move ~50% of data

// Old: hash % 4 → 0,1,2,3
// New: hash % 8 → 0,1,2,3,4,5,6,7

// Consistent Hashing (Better)
// Minimizes data movement when adding shards

class ConsistentHash {
  constructor(shards) {
    this.ring = [];
    this.virtualNodes = 150;  // Virtual nodes per shard
    
    shards.forEach(shard => {
      for (let i = 0; i < this.virtualNodes; i++) {
        const hash = this.hash(`${shard.id}:${i}`);
        this.ring.push({ hash, shard });
      }
    });
    
    // Sort ring by hash
    this.ring.sort((a, b) => a.hash - b.hash);
  }
  
  hash(key) {
    return parseInt(
      crypto.createHash('md5').update(key).digest('hex').substring(0, 8),
      16
    );
  }
  
  getShard(key) {
    const keyHash = this.hash(key);
    
    // Find first ring position >= keyHash
    for (const node of this.ring) {
      if (node.hash >= keyHash) {
        return node.shard;
      }
    }
    
    // Wrap around to first node
    return this.ring[0].shard;
  }
}

// Adding shard only moves ~12.5% of data (1/8)
// Not 50% like simple hash % N
```

**When to shard:**
```
✅ Database > 1TB (single server limits)
✅ Queries slow despite indexing (table too large)
✅ Write throughput limited (single server bottleneck)
✅ Can't scale vertically anymore (largest server)
✅ Clear shard key (user_id, tenant_id)
✅ Team can handle complexity

Typical trigger: 10M+ active users, 100TB+ data
```

**When NOT to shard:**
```
❌ Database < 100GB (single server handles easily)
❌ Read-heavy workload (use read replicas instead)
❌ Can optimize queries (indexes, caching)
❌ Can scale vertically (bigger server cheaper)
❌ No clear shard key (many cross-shard queries)
❌ Small team (complexity overhead)

Try first: Indexes, caching, read replicas, vertical scaling
Shard last: High complexity, operational overhead
```

**Alternatives to sharding:**
```
1. Read Replicas (for reads)
   - Master handles writes
   - Replicas handle reads
   - Scales read throughput

2. Vertical Scaling (bigger server)
   - More CPU, RAM, disk
   - Simpler than sharding
   - Limit: Largest available server

3. Table Partitioning (same server)
   - Split table by range
   - Still single server
   - Better query performance

4. Caching (Redis)
   - Cache hot data
   - Reduces DB load
   - Scales reads

Sharding is last resort after these fail.
```

**Interview tip:** Explain sharding as horizontal partitioning across servers for scale, show hash-based sharding (even distribution, hard to reshard) vs range-based (easy to reshard, hot shards), demonstrate shard routing layer, discuss cross-shard query challenges (denormalize or query multiple shards), mention resharding complexity (consistent hashing helps), explain when to shard (1TB+, 10M+ users, can't scale vertically) vs alternatives (read replicas, caching, vertical scaling), emphasize sharding is last resort due to high complexity."

---

---

## Q56: How do you implement caching strategies effectively?

**Perfect Answer:**

"Caching stores frequently accessed data in fast storage (memory) to reduce database load and improve response time.

**Cache Layers:**
```
Client → CDN → Application Cache → Database Cache → Database

Layer 1: CDN (Cloudflare, CloudFront)
- Static assets (images, CSS, JS)
- TTL: Days/weeks
- Hit rate: 95%+

Layer 2: Application Cache (Redis)
- API responses, session data
- TTL: Minutes/hours
- Hit rate: 70-90%

Layer 3: Database Cache (query cache)
- Query results
- TTL: Seconds
- Hit rate: 50-70%
```

**Redis Caching Implementation:**
```javascript
const redis = require('redis');
const client = redis.createClient();

// Cache-aside pattern (most common)
async function getUser(userId) {
  const cacheKey = `user:${userId}`;
  
  // 1. Try cache first
  const cached = await client.get(cacheKey);
  if (cached) {
    console.log('Cache HIT');
    return JSON.parse(cached);
  }
  
  console.log('Cache MISS');
  
  // 2. Query database
  const user = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
  
  // 3. Store in cache (TTL: 5 minutes)
  await client.setEx(cacheKey, 300, JSON.stringify(user.rows[0]));
  
  return user.rows[0];
}

// Result:
// First call: 100ms (database query)
// Subsequent calls: 1ms (Redis cache) - 100× faster!
```

**Cache Invalidation Strategies:**
```javascript
// 1. Time-based (TTL)
await client.setEx('user:123', 300, data);  // Expires in 5 minutes

// 2. Event-based (invalidate on update)
async function updateUser(userId, data) {
  // Update database
  await db.query('UPDATE users SET name = $1 WHERE id = $2', [data.name, userId]);
  
  // Invalidate cache
  await client.del(`user:${userId}`);
  
  // Optional: Update cache immediately (write-through)
  const updated = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
  await client.setEx(`user:${userId}`, 300, JSON.stringify(updated.rows[0]));
}

// 3. Tag-based (invalidate related keys)
async function createOrder(userId, orderData) {
  const order = await db.query('INSERT INTO orders (...) VALUES (...) RETURNING *', [...]);
  
  // Invalidate all user-related caches
  await client.del(`user:${userId}`);
  await client.del(`user:${userId}:orders`);
  await client.del(`user:${userId}:stats`);
  
  return order;
}
```

**Cache Patterns:**

**1. Cache-Aside (Lazy Loading)**
```javascript
// Application manages cache
async function getData(key) {
  const cached = await cache.get(key);
  if (cached) return cached;
  
  const data = await db.query(...);
  await cache.set(key, data, TTL);
  return data;
}

// Pros:
✅ Only cache what's used
✅ Cache miss = fetch from DB (works)
❌ Cache miss penalty (slow first request)
❌ Stale data possible
```

**2. Write-Through**
```javascript
// Write to cache and DB together
async function saveData(key, data) {
  // Write to DB
  await db.query('INSERT INTO ...');
  
  // Write to cache
  await cache.set(key, data, TTL);
  
  return data;
}

// Pros:
✅ Cache always fresh
✅ No cache misses on reads
❌ Write latency (2 writes)
❌ Cache waste (may never read)
```

**3. Write-Behind (Write-Back)**
```javascript
// Write to cache immediately, DB async
async function saveData(key, data) {
  // Write to cache (fast)
  await cache.set(key, data, TTL);
  
  // Queue DB write (async)
  queue.add('db-write', { key, data });
  
  return data;
}

// Worker processes queue
queue.process('db-write', async (job) => {
  await db.query('INSERT INTO ...', job.data);
});

// Pros:
✅ Fast writes (cache only)
✅ Batch DB writes (efficient)
❌ Data loss risk (if cache fails before DB write)
❌ Complex to implement
```

**4. Read-Through**
```javascript
// Cache loader fetches from DB automatically
const cache = createCache({
  load: async (key) => {
    return await db.query('SELECT * FROM users WHERE id = $1', [key]);
  },
  ttl: 300
});

// Usage
const user = await cache.get(userId);  // Cache handles miss

// Pros:
✅ Simple application code
✅ Automatic cache loading
❌ Need caching library
```

**Cache Key Design:**
```javascript
// Bad: Collision risk
cache.set('user', data);  // Which user?

// Good: Namespaced, unique
cache.set('user:123', data);
cache.set('user:123:orders', data);
cache.set('user:123:orders:page:2', data);

// Include version for breaking changes
cache.set('v2:user:123', data);

// Include query params for API responses
const cacheKey = `api:products:${JSON.stringify(req.query)}`;
```

**Thundering Herd Problem:**
```javascript
// Problem: Cache expires, 1000 concurrent requests hit DB

// Solution 1: Cache locking
async function getUser(userId) {
  const cacheKey = `user:${userId}`;
  const lockKey = `lock:${cacheKey}`;
  
  const cached = await cache.get(cacheKey);
  if (cached) return cached;
  
  // Try to acquire lock
  const lock = await cache.set(lockKey, '1', { NX: true, EX: 10 });
  
  if (!lock) {
    // Another request is fetching, wait and retry
    await sleep(100);
    return getUser(userId);  // Retry (should be cached now)
  }
  
  try {
    // Fetch from DB
    const user = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
    await cache.setEx(cacheKey, 300, JSON.stringify(user.rows[0]));
    return user.rows[0];
  } finally {
    // Release lock
    await cache.del(lockKey);
  }
}

// Solution 2: Probabilistic early expiration
async function getUser(userId) {
  const cacheKey = `user:${userId}`;
  const data = await cache.get(cacheKey);
  
  if (data) {
    const { value, cachedAt, ttl } = JSON.parse(data);
    const age = Date.now() - cachedAt;
    
    // Refresh cache early with probability
    const probability = age / ttl;
    if (Math.random() < probability) {
      // Async refresh (don't block request)
      refreshCache(cacheKey);
    }
    
    return value;
  }
  
  // Cache miss, fetch from DB
  const user = await db.query(...);
  await cache.setEx(cacheKey, 300, JSON.stringify({
    value: user,
    cachedAt: Date.now(),
    ttl: 300000
  }));
  
  return user;
}
```

**Cache Warming:**
```javascript
// Pre-populate cache on startup
async function warmCache() {
  console.log('Warming cache...');
  
  // Cache popular products
  const products = await db.query('SELECT * FROM products WHERE featured = true');
  for (const product of products.rows) {
    await cache.setEx(`product:${product.id}`, 3600, JSON.stringify(product));
  }
  
  // Cache homepage data
  const homepage = await db.query('SELECT * FROM homepage_config');
  await cache.setEx('homepage', 3600, JSON.stringify(homepage.rows[0]));
  
  console.log('Cache warmed');
}

// Run on app startup
warmCache();
```

**Cache Monitoring:**
```javascript
// Track cache metrics
const cacheStats = {
  hits: 0,
  misses: 0,
  errors: 0
};

async function getCached(key) {
  try {
    const data = await cache.get(key);
    
    if (data) {
      cacheStats.hits++;
      return data;
    }
    
    cacheStats.misses++;
    return null;
  } catch (error) {
    cacheStats.errors++;
    logger.error('Cache error', { error });
    return null;  // Fail gracefully
  }
}

// Expose metrics
app.get('/metrics', (req, res) => {
  const total = cacheStats.hits + cacheStats.misses;
  const hitRate = total > 0 ? (cacheStats.hits / total * 100).toFixed(2) : 0;
  
  res.json({
    hits: cacheStats.hits,
    misses: cacheStats.misses,
    errors: cacheStats.errors,
    hitRate: `${hitRate}%`
  });
});

// Alert if hit rate drops
setInterval(() => {
  const total = cacheStats.hits + cacheStats.misses;
  const hitRate = total > 0 ? cacheStats.hits / total : 0;
  
  if (hitRate < 0.5 && total > 100) {
    sendAlert({ type: 'low-cache-hit-rate', hitRate });
  }
}, 60000);
```

**When to cache:**
```
✅ Read-heavy data (90%+ reads)
✅ Expensive queries (> 100ms)
✅ Rarely changing data (products, configs)
✅ High traffic (1000+ req/sec)
✅ Tolerance for stale data

Example: Product catalog, homepage, user profiles
```

**When NOT to cache:**
```
❌ Write-heavy data (stock quantities, balances)
❌ Personalized data (shopping cart, preferences)
❌ Real-time requirements (chat, live scores)
❌ Small datasets (cache overhead not worth it)
❌ Security-sensitive (passwords, tokens)

Example: Bank balances, authentication tokens
```

**Interview tip:** Show cache-aside pattern (most common), demonstrate cache invalidation (TTL, event-based, tag-based), explain thundering herd problem and solutions (locking, probabilistic refresh), discuss cache warming for popular data, mention monitoring (hit rate, alert if < 50%), compare when to cache (read-heavy, expensive queries) vs when not to (write-heavy, real-time, security-sensitive), emphasize caching reduces DB load 70-90% for read-heavy workloads."

---

## Q57: What is the difference between authentication and authorization?

**Perfect Answer:**

"Authentication verifies WHO you are (identity). Authorization determines WHAT you can do (permissions).

**Authentication (Who are you?):**
```javascript
// User provides credentials
POST /api/auth/login
{
  "email": "john@example.com",
  "password": "secret123"
}

// Server verifies identity
async function login(email, password) {
  // 1. Find user
  const user = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  
  if (!user.rows[0]) {
    throw new Error('User not found');  // Authentication failed
  }
  
  // 2. Verify password
  const valid = await bcrypt.compare(password, user.rows[0].password_hash);
  
  if (!valid) {
    throw new Error('Invalid password');  // Authentication failed
  }
  
  // 3. Generate token (proof of identity)
  const token = jwt.sign(
    { id: user.rows[0].id, email: user.rows[0].email },
    JWT_SECRET
  );
  
  return { token };  // Authentication succeeded
}

// Client includes token in subsequent requests
GET /api/profile
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

// Server verifies token = authentication
```

**Authorization (What can you do?):**
```javascript
// After authentication, check permissions

// Role-Based Access Control (RBAC)
const user = {
  id: 123,
  email: 'john@example.com',
  role: 'editor'  // Role determines permissions
};

const permissions = {
  admin: ['read', 'write', 'delete', 'manage-users'],
  editor: ['read', 'write'],
  viewer: ['read']
};

function authorize(user, action) {
  const userPermissions = permissions[user.role] || [];
  
  if (!userPermissions.includes(action)) {
    throw new Error('Forbidden');  // Authorization failed
  }
}

// Usage
app.delete('/api/posts/:id', authenticate, async (req, res) => {
  // Authentication: req.user exists (who they are)
  
  // Authorization: Check if they can delete
  try {
    authorize(req.user, 'delete');
  } catch (error) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  // Proceed with delete
  await db.query('DELETE FROM posts WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});
```

**Comparison:**
```
Authentication:
- Question: "Who are you?"
- Methods: Password, OAuth, biometrics, 2FA
- Result: Identity verified (JWT token)
- Status codes: 401 Unauthorized (invalid credentials)
- Examples: Login, SSO, API keys

Authorization:
- Question: "What can you do?"
- Methods: RBAC, ABAC, permissions, ACLs
- Result: Permission granted/denied
- Status codes: 403 Forbidden (not allowed)
- Examples: Admin panel, delete button, API endpoint access
```

**Authentication Methods:**

**1. Basic Auth**
```javascript
// Username:password in Base64
Authorization: Basic am9objpzZWNyZXQxMjM=

// Server decodes
const auth = Buffer.from(req.headers.authorization.split(' ')[1], 'base64').toString();
const [username, password] = auth.split(':');

// Pros: Simple
// Cons: Insecure (credentials in every request), no logout
```

**2. Session-Based**
```javascript
// Login creates session
app.post('/login', async (req, res) => {
  const user = await verifyCredentials(req.body.email, req.body.password);
  
  req.session.userId = user.id;  // Store in session (server-side)
  req.session.save();
  
  res.json({ success: true });
});

// Subsequent requests include session cookie
GET /api/profile
Cookie: sessionId=abc123

// Server loads session
app.get('/api/profile', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  res.json({ userId: req.session.userId });
});

// Pros: Server controls sessions (can revoke)
// Cons: Server state (doesn't scale), CSRF vulnerable
```

**3. Token-Based (JWT)**
```javascript
// Login returns JWT
app.post('/login', async (req, res) => {
  const user = await verifyCredentials(req.body.email, req.body.password);
  
  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
  
  res.json({ token });
});

// Client includes token
GET /api/profile
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

// Server verifies token
app.use((req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Pros: Stateless (scales), no server session
// Cons: Can't revoke (until expiry), larger payload
```

**4. OAuth 2.0**
```javascript
// Login via Google
app.get('/auth/google', (req, res) => {
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${GOOGLE_CLIENT_ID}&` +
    `redirect_uri=${REDIRECT_URI}&` +
    `response_type=code&` +
    `scope=profile email`;
  
  res.redirect(authUrl);
});

// Google redirects back with code
app.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  
  // Exchange code for token
  const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
    code,
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code'
  });
  
  const { access_token } = tokenResponse.data;
  
  // Get user info
  const userResponse = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${access_token}` }
  });
  
  const { email, name } = userResponse.data;
  
  // Create/login user
  const user = await findOrCreateUser(email, name);
  
  const jwt = generateJWT(user);
  res.json({ token: jwt });
});

// Pros: No password management, trusted providers
// Cons: Complex flow, third-party dependency
```

**Authorization Methods:**

**1. Role-Based (RBAC)**
```javascript
// Simple roles
function requireRole(role) {
  return (req, res, next) => {
    if (req.user.role !== role) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

app.delete('/api/users/:id', authenticate, requireRole('admin'), handler);

// Multiple roles
function requireAnyRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

app.get('/api/reports', authenticate, requireAnyRole('admin', 'manager'), handler);
```

**2. Permission-Based**
```javascript
// Fine-grained permissions
const permissions = new Map([
  ['admin', ['user:read', 'user:write', 'user:delete', 'post:read', 'post:write', 'post:delete']],
  ['editor', ['post:read', 'post:write', 'user:read']],
  ['viewer', ['post:read', 'user:read']]
]);

function requirePermission(permission) {
  return (req, res, next) => {
    const userPermissions = permissions.get(req.user.role) || [];
    
    if (!userPermissions.includes(permission)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

app.delete('/api/posts/:id', authenticate, requirePermission('post:delete'), handler);
```

**3. Resource-Based (Ownership)**
```javascript
// Only owner can edit
app.put('/api/posts/:id', authenticate, async (req, res) => {
  const post = await db.query('SELECT * FROM posts WHERE id = $1', [req.params.id]);
  
  if (!post.rows[0]) {
    return res.status(404).json({ error: 'Post not found' });
  }
  
  // Check ownership
  if (post.rows[0].author_id !== req.user.id) {
    return res.status(403).json({ error: 'Not your post' });
  }
  
  // Update post
  await db.query('UPDATE posts SET title = $1 WHERE id = $2', [req.body.title, req.params.id]);
  res.json({ success: true });
});
```

**4. Attribute-Based (ABAC)**
```javascript
// Complex rules based on attributes
function canEditPost(user, post) {
  // Owner can always edit
  if (post.author_id === user.id) return true;
  
  // Admin can edit any
  if (user.role === 'admin') return true;
  
  // Editor can edit if same department AND post not published
  if (user.role === 'editor' && user.department === post.department && post.status !== 'published') {
    return true;
  }
  
  return false;
}

app.put('/api/posts/:id', authenticate, async (req, res) => {
  const post = await db.query('SELECT * FROM posts WHERE id = $1', [req.params.id]);
  
  if (!canEditPost(req.user, post.rows[0])) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  // Update post
});
```

**Real-World Example:**
```javascript
// E-commerce permissions

// Authentication: User logs in
POST /api/auth/login → Returns JWT

// Authorization checks:

// 1. View products (anyone)
GET /api/products → No auth required

// 2. View own orders (authenticated users)
GET /api/orders → Requires authentication
   → Returns only req.user.id orders

// 3. View all orders (admins only)
GET /api/admin/orders → Requires authentication + admin role

// 4. Cancel order (owner or admin)
DELETE /api/orders/:id → Requires authentication + (ownership OR admin role)

// 5. Manage users (admins only)
POST /api/users → Requires authentication + admin role
DELETE /api/users/:id → Requires authentication + admin role
```

**Interview tip:** Clearly distinguish authentication (identity verification, who you are, 401 status) from authorization (permission checking, what you can do, 403 status), show JWT for authentication and RBAC for authorization, demonstrate resource-based authorization (ownership checks), mention different auth methods (session, token, OAuth) and when to use each, explain authorization patterns (RBAC for roles, permission-based for fine-grained, ABAC for complex rules)."

---

---

## Q58: What are idempotency and how do you implement it?

**Perfect Answer:**

"Idempotency means an operation produces the same result no matter how many times it's executed. Critical for reliable distributed systems.

**Why Idempotency Matters:**
```
Without idempotency:
1. Client: POST /api/orders (create order)
2. Network timeout (no response received)
3. Client: Retry POST /api/orders
4. Result: 2 orders created! (duplicate charge)

With idempotency:
1. Client: POST /api/orders (idempotency-key: abc123)
2. Network timeout
3. Client: Retry POST /api/orders (same key: abc123)
4. Result: 1 order (duplicate detected, returns cached response)
```

**HTTP Methods Idempotency:**
```
GET    - Idempotent ✅ (read doesn't change state)
PUT    - Idempotent ✅ (set to specific value)
PATCH  - Idempotent ✅ (if designed properly)
DELETE - Idempotent ✅ (delete same resource = same result)
POST   - NOT idempotent ❌ (creates new resource each time)

Examples:

GET /api/users/123
→ Call 10 times = same result ✅

PUT /api/users/123 { "name": "John" }
→ Call 10 times = name still "John" ✅

DELETE /api/users/123
→ Call 10 times = user still deleted ✅ (404 after first)

POST /api/orders { "items": [...] }
→ Call 10 times = 10 orders ❌ (not idempotent!)
```

**Idempotency Key Implementation:**
```javascript
const redis = require('redis');
const client = redis.createClient();

// Middleware to handle idempotency
async function idempotencyMiddleware(req, res, next) {
  // Only for non-idempotent methods
  if (req.method !== 'POST') {
    return next();
  }
  
  const idempotencyKey = req.headers['idempotency-key'];
  
  if (!idempotencyKey) {
    return res.status(400).json({
      error: 'Idempotency-Key header required for POST requests'
    });
  }
  
  const cacheKey = `idempotency:${idempotencyKey}`;
  
  // Check if request already processed
  const cached = await client.get(cacheKey);
  
  if (cached) {
    // Return cached response
    const cachedResponse = JSON.parse(cached);
    
    return res.status(cachedResponse.statusCode).json(cachedResponse.body);
  }
  
  // Store original res.json to intercept response
  const originalJson = res.json.bind(res);
  
  res.json = function(body) {
    // Cache response for 24 hours
    client.setEx(cacheKey, 86400, JSON.stringify({
      statusCode: res.statusCode,
      body
    }));
    
    return originalJson(body);
  };
  
  next();
}

app.use(idempotencyMiddleware);

// Usage
app.post('/api/orders', authenticate, async (req, res) => {
  // Create order (will be cached by middleware)
  const order = await db.query(
    'INSERT INTO orders (user_id, total) VALUES ($1, $2) RETURNING *',
    [req.user.id, req.body.total]
  );
  
  res.status(201).json(order.rows[0]);
});

// Client usage:
POST /api/orders
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
{ "items": [...], "total": 100 }

// Retry with same key:
POST /api/orders
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000  // Same key!
→ Returns cached response (no duplicate order)
```

**Database-Level Idempotency:**
```javascript
// Use unique constraint to prevent duplicates
CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  idempotency_key VARCHAR(255) UNIQUE NOT NULL,  -- Unique!
  user_id INTEGER NOT NULL,
  total DECIMAL(10,2),
  created_at TIMESTAMP DEFAULT NOW()
);

// Insert with idempotency key
app.post('/api/orders', authenticate, async (req, res) => {
  const idempotencyKey = req.headers['idempotency-key'];
  
  try {
    const order = await db.query(
      'INSERT INTO orders (idempotency_key, user_id, total) VALUES ($1, $2, $3) RETURNING *',
      [idempotencyKey, req.user.id, req.body.total]
    );
    
    res.status(201).json(order.rows[0]);
  } catch (error) {
    if (error.code === '23505') {  // Unique violation
      // Duplicate detected, return existing order
      const existing = await db.query(
        'SELECT * FROM orders WHERE idempotency_key = $1',
        [idempotencyKey]
      );
      
      return res.status(200).json(existing.rows[0]);
    }
    
    throw error;
  }
});
```

**Idempotent PATCH Operations:**
```javascript
// Non-idempotent (increment)
PATCH /api/users/123
{ "balance": "+10" }  // Add 10 to balance
// Call twice = +20 ❌

// Idempotent (set absolute value)
PATCH /api/users/123
{ "balance": 110 }  // Set balance to 110
// Call twice = 110 ✅

// Idempotent with version
PATCH /api/users/123
{
  "balance": 110,
  "version": 5  // Only apply if current version = 5
}
// Call twice = second fails (version mismatch) ✅
```

**Payment Idempotency (Critical):**
```javascript
// Stripe example (idempotency built-in)
async function chargeCustomer(amount, customerId) {
  const idempotencyKey = uuidv4();
  
  try {
    const charge = await stripe.charges.create({
      amount: amount * 100,  // Cents
      currency: 'usd',
      customer: customerId
    }, {
      idempotencyKey  // Stripe handles duplicate detection
    });
    
    return charge;
  } catch (error) {
    if (error.type === 'idempotency_error') {
      // Duplicate detected, safe to retry
      return await chargeCustomer(amount, customerId);
    }
    
    throw error;
  }
}

// Without idempotency:
// Network issue → retry → customer charged twice! 💸💸

// With idempotency:
// Network issue → retry → Stripe detects duplicate → returns original charge ✅
```

**Event Processing Idempotency:**
```javascript
// Process events idempotently
async function processOrderEvent(event) {
  const eventId = event.id;
  const processedKey = `processed:${eventId}`;
  
  // Check if already processed
  const alreadyProcessed = await redis.exists(processedKey);
  
  if (alreadyProcessed) {
    console.log(`Event ${eventId} already processed, skipping`);
    return;
  }
  
  // Process event
  await db.query('UPDATE inventory SET stock = stock - $1 WHERE product_id = $2', 
    [event.quantity, event.productId]);
  
  // Mark as processed (TTL: 7 days)
  await redis.setEx(processedKey, 604800, '1');
}

// If event delivered twice (message queue retry), second processing skipped ✅
```

**Version-Based Idempotency:**
```javascript
// Optimistic locking
app.put('/api/posts/:id', authenticate, async (req, res) => {
  const { title, content, version } = req.body;
  
  // Update only if version matches (prevents concurrent updates)
  const result = await db.query(`
    UPDATE posts 
    SET title = $1, content = $2, version = version + 1
    WHERE id = $3 AND version = $4
    RETURNING *
  `, [title, content, req.params.id, version]);
  
  if (result.rows.length === 0) {
    return res.status(409).json({
      error: 'Version conflict',
      message: 'Post was modified by another user'
    });
  }
  
  res.json(result.rows[0]);
});

// Client flow:
// 1. GET /api/posts/123 → { id: 123, title: "Hello", version: 5 }
// 2. User edits locally
// 3. PUT /api/posts/123 { title: "Updated", version: 5 }
// 4. If another user updated (version now 6), PUT fails with 409
```

**Idempotency Key Generation:**
```javascript
// Client generates unique key
const idempotencyKey = uuidv4();  // UUID v4
// or
const idempotencyKey = crypto.randomUUID();  // Node 16+

// Store with request context
localStorage.setItem('order-request-key', idempotencyKey);

// Use same key for retries
fetch('/api/orders', {
  method: 'POST',
  headers: {
    'Idempotency-Key': idempotencyKey,
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify(orderData)
});

// If retry needed, use SAME key
```

**Idempotency Best Practices:**
```
1. Store idempotency keys for 24 hours minimum
   → Enough time for retries, not forever

2. Return same response for duplicate requests
   → Status code + body identical

3. Validate idempotency key format (UUID)
   → Prevent collisions

4. Use database constraints when possible
   → Atomic duplicate prevention

5. Document idempotency in API
   → Clients know how to use it

6. For critical operations (payments), always require key
   → Non-optional for financial transactions

7. Consider request fingerprint as fallback
   → Hash(userId + endpoint + body) if no key provided
```

**When Idempotency is Critical:**
```
✅ Financial transactions (payments, transfers)
✅ Order creation (e-commerce)
✅ User registration (no duplicate accounts)
✅ API webhooks (may retry)
✅ Message queue processing (at-least-once delivery)
✅ Event processing (duplicate events)

Example: Stripe requires idempotency keys for all POST requests
```

**Interview tip:** Explain idempotency as same result regardless of repetitions, show why critical (network retries = duplicates), demonstrate idempotency-key header pattern with Redis caching, show database unique constraint approach, discuss HTTP methods (GET/PUT/DELETE idempotent, POST not), mention payment systems (Stripe) require idempotency, explain version-based optimistic locking, emphasize 24-hour key storage minimum for safe retries."

---

## Q59: How do you handle file uploads at scale?

**Perfect Answer:**

"File uploads at scale require streaming, direct-to-storage uploads, and proper validation. Never load entire file into memory.

**Bad: Loading into Memory (Small Scale)**
```javascript
// ❌ BAD: Loads entire file into memory
app.post('/api/upload', async (req, res) => {
  const file = req.body.file;  // Entire file in memory!
  
  // 100 concurrent 50MB uploads = 5GB memory usage
  // Server crashes with OutOfMemory error
  
  await fs.writeFile(`./uploads/${file.name}`, file.data);
  res.json({ success: true });
});
```

**Good: Streaming (Large Scale)**
```javascript
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { createPresignedPost } = require('@aws-sdk/s3-presigned-post');
const stream = require('stream');

// Stream directly to disk (temporary)
const upload = multer({
  storage: multer.diskStorage({
    destination: './tmp/uploads',
    filename: (req, file, cb) => {
      const uniqueName = `${Date.now()}-${file.originalname}`;
      cb(null, uniqueName);
    }
  }),
  limits: {
    fileSize: 50 * 1024 * 1024,  // 50MB limit
    files: 5  // Max 5 files per request
  },
  fileFilter: (req, file, cb) => {
    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'];
    
    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error('Invalid file type'));
    }
    
    cb(null, true);
  }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  // File streamed to disk (not in memory)
  const file = req.file;
  
  res.json({
    filename: file.filename,
    size: file.size,
    path: `/uploads/${file.filename}`
  });
});

// Memory usage: ~1MB per upload (streaming buffer)
// 100 concurrent uploads = 100MB memory (manageable!)
```

**Best: Direct-to-S3 Upload (No Server Load)**
```javascript
// Generate presigned URL for direct client → S3 upload
app.post('/api/upload/presign', authenticate, async (req, res) => {
  const { filename, contentType, fileSize } = req.body;
  
  // Validate
  if (fileSize > 50 * 1024 * 1024) {
    return res.status(400).json({ error: 'File too large' });
  }
  
  const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
  if (!allowedTypes.includes(contentType)) {
    return res.status(400).json({ error: 'Invalid file type' });
  }
  
  // Generate unique key
  const key = `uploads/${req.user.id}/${Date.now()}-${filename}`;
  
  // Create presigned POST
  const s3Client = new S3Client({ region: 'us-east-1' });
  
  const { url, fields } = await createPresignedPost(s3Client, {
    Bucket: 'my-bucket',
    Key: key,
    Conditions: [
      ['content-length-range', 0, fileSize],  // Max size
      ['eq', '$Content-Type', contentType]     // Exact type
    ],
    Fields: {
      'Content-Type': contentType
    },
    Expires: 600  // URL valid for 10 minutes
  });
  
  // Save upload record to database
  await db.query(
    'INSERT INTO uploads (user_id, key, filename, status) VALUES ($1, $2, $3, $4)',
    [req.user.id, key, filename, 'pending']
  );
  
  res.json({ url, fields, key });
});

// Client uploads directly to S3
fetch(url, {
  method: 'POST',
  body: formData  // Contains fields + file
})
  .then(() => {
    // Notify server upload complete
    fetch('/api/upload/complete', {
      method: 'POST',
      body: JSON.stringify({ key })
    });
  });

// Server marks upload as complete
app.post('/api/upload/complete', authenticate, async (req, res) => {
  const { key } = req.body;
  
  // Verify ownership
  const upload = await db.query(
    'SELECT * FROM uploads WHERE key = $1 AND user_id = $2',
    [key, req.user.id]
  );
  
  if (!upload.rows[0]) {
    return res.status(404).json({ error: 'Upload not found' });
  }
  
  // Mark complete
  await db.query(
    'UPDATE uploads SET status = $1, completed_at = NOW() WHERE key = $2',
    ['completed', key]
  );
  
  res.json({ success: true });
});

// Benefits:
// ✅ No server bandwidth (direct S3 upload)
// ✅ No server CPU/memory (client streams to S3)
// ✅ Faster (parallel uploads to S3)
// ✅ Scalable (S3 handles load)
```

**Multipart Upload (Files > 100MB)**
```javascript
const { Upload } = require('@aws-sdk/lib-storage');

app.post('/api/upload/large', upload.single('file'), async (req, res) => {
  const file = req.file;
  
  try {
    // Stream file to S3 in parts (5MB chunks)
    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: 'my-bucket',
        Key: `uploads/${Date.now()}-${file.originalname}`,
        Body: fs.createReadStream(file.path),
        ContentType: file.mimetype
      },
      partSize: 5 * 1024 * 1024,  // 5MB parts
      queueSize: 4  // Upload 4 parts concurrently
    });
    
    // Track progress
    upload.on('httpUploadProgress', (progress) => {
      const percent = (progress.loaded / progress.total * 100).toFixed(2);
      console.log(`Upload progress: ${percent}%`);
    });
    
    const result = await upload.done();
    
    // Delete temp file
    fs.unlinkSync(file.path);
    
    res.json({
      url: result.Location,
      key: result.Key
    });
  } catch (error) {
    // Delete temp file on error
    if (file.path) fs.unlinkSync(file.path);
    throw error;
  }
});
```

**Image Processing Pipeline:**
```javascript
// After upload, process async
const queue = require('bull');
const sharp = require('sharp');

const imageQueue = new Queue('image-processing', {
  redis: { host: 'localhost', port: 6379 }
});

// Add to queue after upload
app.post('/api/upload/complete', authenticate, async (req, res) => {
  const { key } = req.body;
  
  await db.query('UPDATE uploads SET status = $1 WHERE key = $2', ['completed', key]);
  
  // Queue image processing
  await imageQueue.add('process-image', { key, userId: req.user.id });
  
  res.json({ success: true });
});

// Worker processes images
imageQueue.process('process-image', async (job) => {
  const { key } = job.data;
  
  // Download from S3
  const s3Object = await s3Client.send(new GetObjectCommand({
    Bucket: 'my-bucket',
    Key: key
  }));
  
  const buffer = await streamToBuffer(s3Object.Body);
  
  // Generate thumbnails
  const thumbnail = await sharp(buffer)
    .resize(300, 300, { fit: 'cover' })
    .toBuffer();
  
  const medium = await sharp(buffer)
    .resize(800, 800, { fit: 'inside' })
    .toBuffer();
  
  // Upload thumbnails
  await Promise.all([
    s3Client.send(new PutObjectCommand({
      Bucket: 'my-bucket',
      Key: key.replace('/uploads/', '/thumbs/'),
      Body: thumbnail,
      ContentType: 'image/jpeg'
    })),
    s3Client.send(new PutObjectCommand({
      Bucket: 'my-bucket',
      Key: key.replace('/uploads/', '/medium/'),
      Body: medium,
      ContentType: 'image/jpeg'
    }))
  ]);
  
  // Update database
  await db.query(
    'UPDATE uploads SET thumbnails_generated = true WHERE key = $1',
    [key]
  );
});
```

**Security Validations:**
```javascript
const fileType = require('file-type');

// Validate MIME type (not just extension)
async function validateFile(buffer) {
  const type = await fileType.fromBuffer(buffer);
  
  if (!type) {
    throw new Error('Unknown file type');
  }
  
  const allowed = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'];
  
  if (!allowed.includes(type.mime)) {
    throw new Error(`File type ${type.mime} not allowed`);
  }
  
  return type;
}

// Virus scanning
const ClamScan = require('clamscan');

async function scanFile(filePath) {
  const clamscan = await new ClamScan().init();
  
  const { is_infected, viruses } = await clamscan.scan_file(filePath);
  
  if (is_infected) {
    throw new Error(`Virus detected: ${viruses.join(', ')}`);
  }
}

// Usage
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    // Read first 4100 bytes (enough for file-type detection)
    const buffer = await fs.readFile(req.file.path, { length: 4100 });
    
    // Validate real file type
    await validateFile(buffer);
    
    // Scan for viruses
    await scanFile(req.file.path);
    
    // Upload to S3
    await uploadToS3(req.file.path);
    
    res.json({ success: true });
  } catch (error) {
    fs.unlinkSync(req.file.path);  // Delete file
    res.status(400).json({ error: error.message });
  }
});
```

**Rate Limiting Uploads:**
```javascript
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: 100,  // 100 uploads per hour per user
  keyGenerator: (req) => req.user.id,
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many uploads',
      retryAfter: '1 hour'
    });
  }
});

app.post('/api/upload', authenticate, uploadLimiter, upload.single('file'), handler);
```

**CDN Serving:**
```
Upload flow:
Client → Server → S3 bucket

Serve flow:
Client → CloudFront CDN → S3 bucket

// CDN caches files at edge locations
// 95%+ requests served from CDN (not S3)
// Lower latency (edge location closer to user)
// Lower S3 costs (fewer requests)
```

**Interview tip:** Emphasize streaming (never load full file into memory), show direct-to-S3 uploads with presigned URLs (no server bandwidth), demonstrate multipart for large files (>100MB), discuss async processing pipeline (thumbnails, transcoding), mention security (MIME validation, virus scanning), show rate limiting (prevent abuse), explain CDN for serving (CloudFront caches at edge)."

---

## Q60: What is the difference between horizontal and vertical scaling?

**Perfect Answer:**

"Vertical scaling adds resources to single server (bigger). Horizontal scaling adds more servers (more).

**Vertical Scaling (Scale Up):**
```
Before:
Server: 4 CPU, 8GB RAM, 100GB disk
Handles: 1000 requests/second

After:
Server: 16 CPU, 64GB RAM, 1TB disk  ← Bigger server
Handles: 4000 requests/second

Method: Upgrade existing server
```

**Horizontal Scaling (Scale Out):**
```
Before:
Server 1: 4 CPU, 8GB RAM
Handles: 1000 requests/second

After:
Server 1: 4 CPU, 8GB RAM  ─┐
Server 2: 4 CPU, 8GB RAM  ─┼─ Load Balancer
Server 3: 4 CPU, 8GB RAM  ─┤
Server 4: 4 CPU, 8GB RAM  ─┘
Handles: 4000 requests/second

Method: Add more servers
```

**Comparison:**

| Aspect | Vertical Scaling | Horizontal Scaling |
|--------|------------------|-------------------|
| Method | Bigger server | More servers |
| Cost | Exponential (32 CPU >> 2× 16 CPU) | Linear (N servers = N× cost) |
| Limit | Hardware limit (biggest server) | Unlimited (add more servers) |
| Downtime | Required (upgrade) | Zero (add behind LB) |
| Complexity | Simple (one server) | Complex (distributed) |
| Fault tolerance | Single point of failure | Redundant |
| Best for | Databases, caches | Stateless apps, APIs |

**When to Use Vertical:**
```
✅ Database (hard to distribute)
✅ Cache (Redis, Memcached)
✅ Simple applications
✅ Cost < $1000/month
✅ < 10,000 requests/sec

Example: PostgreSQL primary (can't shard easily)
- Start: 4 CPU, 8GB → handles 5K req/sec
- Grow: 8 CPU, 16GB → handles 10K req/sec
- Max: 64 CPU, 512GB → handles 50K req/sec
```

**When to Use Horizontal:**
```
✅ Stateless applications
✅ Web servers
✅ API gateways
✅ Microservices
✅ Need high availability
✅ Traffic unpredictable

Example: Node.js API servers
- Start: 2 servers → handles 2K req/sec
- Grow: 10 servers → handles 10K req/sec
- Peak: 100 servers → handles 100K req/sec
- Scale down: 5 servers (save cost)
```

**Hybrid Approach (Both):**
```
Application Tier (Horizontal):
- 10× Node.js servers (4 CPU, 8GB each)
- Auto-scale 5-20 based on traffic
- Handles: 10K-40K req/sec

Database Tier (Vertical):
- 1× PostgreSQL primary (32 CPU, 256GB)
- 2× Read replicas (16 CPU, 128GB)
- Handles: 20K writes/sec, 60K reads/sec

Best of both worlds!
```

**Interview tip:** Clearly distinguish vertical (bigger server, simple, limited) vs horizontal (more servers, complex, unlimited), show comparison table, explain when to use each (vertical for databases, horizontal for stateless apps), mention hybrid approach (horizontal app tier, vertical database tier), emphasize horizontal provides fault tolerance and auto-scaling."

---

**ARCHITECTURE & DESIGN SECTION COMPLETE! ✅**

**Progress: 60/100 questions complete**

**Breakdown:**
- Security: 15 questions (Q1-Q15) ✅
- Error Handling & Resilience: 12 questions (Q16-Q27) ✅
- Database & Performance: 15 questions (Q28-Q42) ✅
- Architecture & Design: 18 questions (Q43-Q60) ✅

**Remaining categories:**
- Node.js Specific: 15 questions (Q61-Q75)
- DevOps & Deployment: 15 questions (Q76-Q90)
- System Design: 10 questions (Q91-Q100)

Ready to start Node.js Specific section (Q61-Q75)?

**Progress: 53/100 questions complete**

Continuing with Q54-Q60 (Architecture & Design)...
