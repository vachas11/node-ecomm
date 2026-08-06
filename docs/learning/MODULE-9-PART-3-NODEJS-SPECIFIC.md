# MODULE-9 PART 3: NODE.JS SPECIFIC

**Lead-Level Interview Questions with Perfect Answers**

**Questions 61-75: Node.js Specific Patterns**

---

## Q61: How does Node.js event loop work?

**Perfect Answer:**

"Node.js event loop is single-threaded non-blocking I/O that processes async operations through phases.

**Event Loop Phases:**
```
   ┌───────────────────────────┐
┌─>│           timers          │
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
│  │     pending callbacks     │
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
│  │       idle, prepare       │
│  └─────────────┬─────────────┘      ┌───────────────┐
│  ┌─────────────┴─────────────┐      │   incoming:   │
│  │           poll            │<─────┤  connections, │
│  └─────────────┬─────────────┘      │   data, etc.  │
│  ┌─────────────┴─────────────┐      └───────────────┘
│  │           check           │
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
│  │      close callbacks      │
│  └─────────────┬─────────────┘
└──────────────────┘

1. Timers: setTimeout(), setInterval()
2. Pending callbacks: I/O callbacks deferred
3. Idle, prepare: Internal use
4. Poll: I/O operations (most time spent here)
5. Check: setImmediate()
6. Close callbacks: socket.on('close')
```

**Execution Order:**
```javascript
console.log('1. Sync code');

setTimeout(() => console.log('2. Timer'), 0);

setImmediate(() => console.log('3. Immediate'));

Promise.resolve().then(() => console.log('4. Promise'));

process.nextTick(() => console.log('5. nextTick'));

console.log('6. Sync code');

// Output:
// 1. Sync code
// 6. Sync code
// 5. nextTick (microtasks first!)
// 4. Promise (microtasks)
// 2. Timer (timers phase)
// 3. Immediate (check phase)

// Why?
// 1. All sync code executes first
// 2. Microtasks (nextTick, Promise) execute between phases
// 3. Timer phase (setTimeout)
// 4. Check phase (setImmediate)
```

**Microtasks vs Macrotasks:**
```javascript
// Microtasks (higher priority):
process.nextTick(() => {})  // Highest priority
Promise.resolve().then(() => {})

// Macrotasks (lower priority):
setTimeout(() => {}, 0)
setImmediate(() => {})
setInterval(() => {}, 100)

// Event loop:
// 1. Execute current phase
// 2. Execute ALL microtasks
// 3. Move to next phase
// 4. Execute ALL microtasks
// 5. Repeat
```

**Why Node.js is Fast:**
```javascript
// Traditional blocking I/O (Apache, PHP):
function handleRequest(req, res) {
  const user = db.query('SELECT * FROM users WHERE id = 1');  // BLOCKS 100ms
  const orders = db.query('SELECT * FROM orders WHERE user_id = 1');  // BLOCKS 100ms
  res.send({ user, orders });
  // Total: 200ms per request
  // 10 concurrent requests = 2000ms (sequential blocking)
}

// Node.js non-blocking I/O:
async function handleRequest(req, res) {
  const [user, orders] = await Promise.all([
    db.query('SELECT * FROM users WHERE id = 1'),  // Non-blocking
    db.query('SELECT * FROM orders WHERE user_id = 1')  // Non-blocking
  ]);
  res.send({ user, orders });
  // Total: 100ms per request (parallel!)
  // 10 concurrent requests = 100ms (all parallel)
}

// Node.js delegates I/O to libuv thread pool
// Event loop never blocks
```

**Interview tip:** Explain event loop as single-threaded non-blocking via phases, show execution order (sync → microtasks → timers → check), demonstrate why Node.js is fast (non-blocking I/O, parallel operations), mention libuv handles I/O in thread pool while event loop processes callbacks."

---

## Q62: What is the difference between process.nextTick() and setImmediate()?

**Perfect Answer:**

"process.nextTick() executes before event loop continues (microtask). setImmediate() executes in check phase of event loop (macrotask).

**Execution Timing:**
```javascript
console.log('start');

setImmediate(() => {
  console.log('setImmediate');
});

process.nextTick(() => {
  console.log('nextTick');
});

console.log('end');

// Output:
// start
// end
// nextTick        ← Executes first (before event loop)
// setImmediate    ← Executes later (check phase)
```

**process.nextTick() (Microtask):**
```javascript
// Executes after current operation, before event loop continues
process.nextTick(() => {
  console.log('nextTick 1');
});

process.nextTick(() => {
  console.log('nextTick 2');
});

setTimeout(() => {
  console.log('timer');
}, 0);

// Output:
// nextTick 1
// nextTick 2
// timer

// All nextTick callbacks execute BEFORE moving to timers phase
```

**setImmediate() (Macrotask):**
```javascript
// Executes in check phase (after poll phase)
setImmediate(() => {
  console.log('immediate 1');
});

setImmediate(() => {
  console.log('immediate 2');
});

setTimeout(() => {
  console.log('timer');
}, 0);

// Output (may vary):
// timer           (timers phase)
// immediate 1     (check phase)
// immediate 2     (check phase)

// Order of timer vs immediate depends on when event loop starts
```

**Use Cases:**

**process.nextTick() - Defer to next tick:**
```javascript
// Allow caller to register event handlers before emitting
class MyEmitter extends EventEmitter {
  constructor() {
    super();
    
    // ❌ BAD: Emit before caller can register handlers
    this.emit('ready');
  }
}

const emitter = new MyEmitter();
emitter.on('ready', () => {
  console.log('ready');  // Never fires!
});

// ✅ GOOD: Defer emission
class MyEmitter extends EventEmitter {
  constructor() {
    super();
    
    process.nextTick(() => {
      this.emit('ready');  // Fires after constructor returns
    });
  }
}

const emitter = new MyEmitter();
emitter.on('ready', () => {
  console.log('ready');  // Fires! ✅
});
```

**setImmediate() - Break long operations:**
```javascript
// ❌ BAD: Blocks event loop
function processArray(arr) {
  for (let i = 0; i < arr.length; i++) {
    // Heavy computation
    compute(arr[i]);
  }
}

processArray(new Array(1000000));  // Blocks for seconds

// ✅ GOOD: Yield to event loop
function processArray(arr, index = 0) {
  const batchSize = 1000;
  const end = Math.min(index + batchSize, arr.length);
  
  for (let i = index; i < end; i++) {
    compute(arr[i]);
  }
  
  if (end < arr.length) {
    setImmediate(() => processArray(arr, end));  // Yield
  }
}

processArray(new Array(1000000));  // Non-blocking!
```

**Danger of process.nextTick():**
```javascript
// ❌ DANGEROUS: Infinite recursion starves event loop
function recursive() {
  process.nextTick(recursive);  // Never reaches timers/IO!
}

recursive();  // Event loop stuck in nextTick phase

// setTimeout, setImmediate, I/O never execute
// Application hangs!

// ✅ SAFE: Use setImmediate instead
function recursive() {
  setImmediate(recursive);  // Allows other phases to run
}

recursive();  // Event loop continues normally
```

**Interview tip:** Explain process.nextTick() executes before event loop continues (highest priority, can starve loop), setImmediate() executes in check phase (after I/O), show use cases (nextTick for deferring after constructor, setImmediate for breaking long operations), warn about nextTick recursion danger."

---

## Q63: How do you handle memory leaks in Node.js?

**Perfect Answer:**

"Memory leaks occur when objects aren't garbage collected. Common causes: global variables, closures, event listeners, timers.

**Common Memory Leaks:**

**1. Global Variables**
```javascript
// ❌ BAD: Leak
function processUsers() {
  allUsers = [];  // Missing const/let = global!
  
  for (let i = 0; i < 1000000; i++) {
    allUsers.push({ id: i, data: 'x'.repeat(1000) });
  }
}

processUsers();  // allUsers never garbage collected

// ✅ GOOD: Local variable
function processUsers() {
  const allUsers = [];  // Local, garbage collected after function
  
  for (let i = 0; i < 1000000; i++) {
    allUsers.push({ id: i, data: 'x'.repeat(1000) });
  }
}
```

**2. Event Listeners Not Removed**
```javascript
// ❌ BAD: Leak
class UserService {
  constructor(eventBus) {
    this.users = new Map();
    
    eventBus.on('user.created', (user) => {
      this.users.set(user.id, user);
    });
  }
}

// Create 1000 instances
for (let i = 0; i < 1000; i++) {
  new UserService(eventBus);
}

// All 1000 listeners still attached!
// eventBus holds references to all instances
// None can be garbage collected

// ✅ GOOD: Remove listener
class UserService {
  constructor(eventBus) {
    this.users = new Map();
    this.eventBus = eventBus;
    
    this.onUserCreated = (user) => {
      this.users.set(user.id, user);
    };
    
    eventBus.on('user.created', this.onUserCreated);
  }
  
  destroy() {
    this.eventBus.off('user.created', this.onUserCreated);
    this.users.clear();
  }
}
```

**3. Closures Holding References**
```javascript
// ❌ BAD: Leak
function setupServer() {
  const cache = new Map();  // Large cache
  
  for (let i = 0; i < 100000; i++) {
    cache.set(i, { data: 'x'.repeat(1000) });
  }
  
  app.get('/api/data', (req, res) => {
    // Closure keeps 'cache' in memory forever
    res.json(cache.get(req.query.id));
  });
}

setupServer();
// cache never garbage collected (route handler references it)

// ✅ GOOD: Module-level cache with cleanup
const cache = new LRU({ max: 1000, maxAge: 3600000 });

app.get('/api/data', (req, res) => {
  res.json(cache.get(req.query.id));
});

// LRU auto-evicts old entries
```

**4. Timers/Intervals Not Cleared**
```javascript
// ❌ BAD: Leak
class Monitor {
  start() {
    setInterval(() => {
      this.checkHealth();  // Closure holds 'this'
    }, 1000);
  }
}

const monitor = new Monitor();
monitor.start();
monitor = null;  // Doesn't help! Interval still running

// ✅ GOOD: Clear interval
class Monitor {
  start() {
    this.interval = setInterval(() => {
      this.checkHealth();
    }, 1000);
  }
  
  stop() {
    clearInterval(this.interval);
  }
}

const monitor = new Monitor();
monitor.start();
monitor.stop();  // Now can be garbage collected
```

**5. Large Objects in Memory**
```javascript
// ❌ BAD: Caching everything
const cache = new Map();

app.get('/api/users/:id', async (req, res) => {
  if (cache.has(req.params.id)) {
    return res.json(cache.get(req.params.id));
  }
  
  const user = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  
  cache.set(req.params.id, user);  // Never evicted!
  
  res.json(user);
});

// After 1M requests, 1M users in cache
// Memory usage: Gigabytes

// ✅ GOOD: LRU cache with size limit
const LRU = require('lru-cache');

const cache = new LRU({
  max: 1000,           // Max 1000 items
  maxAge: 1000 * 60 * 5  // 5 minutes
});

app.get('/api/users/:id', async (req, res) => {
  const cached = cache.get(req.params.id);
  if (cached) return res.json(cached);
  
  const user = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  
  cache.set(req.params.id, user);
  
  res.json(user);
});
```

**Detecting Memory Leaks:**

**1. Heap Snapshots**
```javascript
// Take heap snapshot
const v8 = require('v8');
const fs = require('fs');

function takeHeapSnapshot() {
  const snapshotStream = v8.writeHeapSnapshot();
  console.log('Heap snapshot written to', snapshotStream);
}

// Take snapshots periodically
setInterval(() => {
  takeHeapSnapshot();
}, 60000);

// Compare snapshots in Chrome DevTools
// Memory → Load snapshot → Compare
// Look for objects growing between snapshots
```

**2. Monitor Memory Usage**
```javascript
const used = process.memoryUsage();

console.log({
  rss: `${Math.round(used.rss / 1024 / 1024)}MB`,           // Total
  heapTotal: `${Math.round(used.heapTotal / 1024 / 1024)}MB`, // Allocated
  heapUsed: `${Math.round(used.heapUsed / 1024 / 1024)}MB`,   // Used
  external: `${Math.round(used.external / 1024 / 1024)}MB`    // C++ objects
});

// Monitor over time
setInterval(() => {
  const usage = process.memoryUsage();
  
  if (usage.heapUsed > 500 * 1024 * 1024) {  // > 500MB
    console.error('HIGH MEMORY USAGE', usage);
    // Alert ops team
  }
}, 10000);
```

**3. Memory Profiling**
```bash
# Run with --inspect
node --inspect server.js

# Open Chrome DevTools
chrome://inspect

# Take heap snapshots
# Record allocation timeline
# See which objects/functions allocate most memory
```

**4. Automated Leak Detection**
```javascript
const memwatch = require('@airbnb/node-memwatch');

memwatch.on('leak', (info) => {
  console.error('Memory leak detected!', info);
  // info.growth: Heap growth
  // info.reason: Why leak detected
  
  // Take heap snapshot
  const heapDiff = new memwatch.HeapDiff();
  
  // ... run some operations ...
  
  const diff = heapDiff.end();
  console.log('Heap diff', diff);
});
```

**Preventing Leaks:**
```javascript
// 1. Use WeakMap for metadata
const metadata = new WeakMap();  // Not Map!

function attachMetadata(obj, meta) {
  metadata.set(obj, meta);
}

// When obj is garbage collected, metadata entry is too

// 2. Limit array sizes
const recentRequests = [];

app.use((req, res, next) => {
  recentRequests.push({ url: req.url, timestamp: Date.now() });
  
  // Keep only last 1000
  if (recentRequests.length > 1000) {
    recentRequests.shift();
  }
  
  next();
});

// 3. Use streams for large data
// ❌ BAD: Load entire file into memory
const data = fs.readFileSync('huge-file.json');
res.send(data);  // 1GB in memory

// ✅ GOOD: Stream
fs.createReadStream('huge-file.json').pipe(res);  // ~1MB in memory

// 4. Cleanup in finally
async function processRequest() {
  const conn = await pool.connect();
  
  try {
    const result = await conn.query('SELECT ...');
    return result;
  } finally {
    conn.release();  // Always release!
  }
}
```

**Interview tip:** Show common leak sources (global variables, event listeners not removed, closures holding references, timers not cleared), demonstrate heap snapshot comparison, show memory monitoring with process.memoryUsage(), mention prevention strategies (WeakMap for metadata, limit array sizes, streams for large data, cleanup in finally)."

---

## Q64: What is the purpose of clustering in Node.js?

**Perfect Answer:**

"Clustering spawns multiple Node.js processes to utilize all CPU cores, improving throughput and availability.

**Problem: Single Process**
```
Single Node.js process:
- Uses 1 CPU core (out of 8)
- Handles 1000 req/sec
- If crashes, entire app down

CPU utilization: 12.5% (1/8 cores)
```

**Solution: Cluster Module**
```javascript
const cluster = require('cluster');
const os = require('os');

if (cluster.isMaster) {
  // Master process
  const numCPUs = os.cpus().length;  // 8 cores
  
  console.log(`Master ${process.pid} starting ${numCPUs} workers`);
  
  // Fork workers
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
  
  // Worker died, restart
  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died`);
    console.log('Starting new worker');
    cluster.fork();
  });
  
} else {
  // Worker process
  const express = require('express');
  const app = express();
  
  app.get('/', (req, res) => {
    res.send(`Hello from worker ${process.pid}`);
  });
  
  app.listen(3000, () => {
    console.log(`Worker ${process.pid} listening on port 3000`);
  });
}

// Result:
// 8 processes listening on port 3000
// OS load balances requests across workers
// CPU utilization: 100% (all 8 cores)
// Throughput: 8000 req/sec (8× improvement!)
```

**Benefits:**
```
✅ Utilize all CPU cores (8 cores = 8× throughput)
✅ High availability (one worker dies, others continue)
✅ Zero-downtime restarts (reload workers one at a time)
✅ Isolation (worker crash doesn't affect others)
```

**Zero-Downtime Reload:**
```javascript
// Graceful restart
if (cluster.isMaster) {
  // Listen for SIGUSR2 (reload signal)
  process.on('SIGUSR2', () => {
    const workers = Object.values(cluster.workers);
    
    function reloadWorker(index) {
      if (index >= workers.length) {
        console.log('All workers reloaded');
        return;
      }
      
      const worker = workers[index];
      
      // Fork new worker
      const newWorker = cluster.fork();
      
      // When new worker ready, kill old worker
      newWorker.on('listening', () => {
        worker.disconnect();
        
        setTimeout(() => {
          worker.kill();
          reloadWorker(index + 1);  // Reload next
        }, 1000);
      });
    }
    
    reloadWorker(0);
  });
}

// Trigger reload:
// kill -SIGUSR2 <master-pid>

// Result:
// - New workers start
// - Old workers gracefully shutdown (finish current requests)
// - Zero requests dropped
```

**Shared State Problem:**
```javascript
// ❌ PROBLEM: Each worker has separate memory
if (cluster.isWorker) {
  const app = express();
  let counter = 0;  // Each worker has own counter!
  
  app.get('/increment', (req, res) => {
    counter++;
    res.json({ counter, worker: process.pid });
  });
  
  app.listen(3000);
}

// Request 1 → Worker 1: counter = 1
// Request 2 → Worker 2: counter = 1 (not 2!)
// Counters not shared across workers

// ✅ SOLUTION: Use Redis for shared state
const redis = require('redis');
const client = redis.createClient();

if (cluster.isWorker) {
  const app = express();
  
  app.get('/increment', async (req, res) => {
    const counter = await client.incr('counter');
    res.json({ counter, worker: process.pid });
  });
  
  app.listen(3000);
}

// Now counter is shared across all workers
```

**PM2 Alternative (Production):**
```bash
# Install PM2
npm install -g pm2

# Start app with cluster mode
pm2 start app.js -i max  # max = number of CPUs

# PM2 handles:
# - Clustering (automatic)
# - Auto-restart on crash
# - Zero-downtime reload
# - Monitoring
# - Log management

# Commands
pm2 reload app        # Zero-downtime reload
pm2 restart app       # Restart all workers
pm2 scale app +2      # Add 2 more workers
pm2 monit             # Monitor CPU/memory
pm2 logs              # View logs

# ecosystem.config.js
module.exports = {
  apps: [{
    name: 'api',
    script: './server.js',
    instances: 'max',
    exec_mode: 'cluster',
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production'
    }
  }]
};

# Start with config
pm2 start ecosystem.config.js
```

**When to Use Clustering:**
```
✅ CPU-intensive operations
✅ High traffic (> 1000 req/sec)
✅ Multi-core servers (4+ cores)
✅ Need high availability
✅ Stateless application

Example: API server with image processing
- 8 cores, 1000 req/sec per core
- Clustering = 8000 req/sec total
```

**When NOT to Use Clustering:**
```
❌ I/O-bound operations (already async)
❌ Single-core server
❌ Low traffic (< 100 req/sec)
❌ Stateful application (WebSocket, sessions)
❌ Local development

Example: Simple CRUD API on single core
- Single process handles 1000 req/sec
- Clustering adds complexity, no benefit
```

**Worker Communication:**
```javascript
// Master → Worker
if (cluster.isMaster) {
  const worker = cluster.fork();
  
  worker.send({ type: 'config', data: { apiKey: 'secret' } });
}

// Worker receives
if (cluster.isWorker) {
  process.on('message', (msg) => {
    if (msg.type === 'config') {
      console.log('Received config', msg.data);
    }
  });
}

// Worker → Master
if (cluster.isWorker) {
  process.send({ type: 'request-count', count: 1000 });
}

// Master receives
if (cluster.isMaster) {
  cluster.on('message', (worker, msg) => {
    if (msg.type === 'request-count') {
      console.log(`Worker ${worker.process.pid}: ${msg.count} requests`);
    }
  });
}
```

**Interview tip:** Explain clustering spawns multiple processes to use all CPU cores (8 cores = 8× throughput), show cluster module code with master forking workers, demonstrate zero-downtime reload (restart workers one by one), mention shared state problem (use Redis), show PM2 as production alternative (handles clustering automatically), discuss when to use (CPU-intensive, high traffic) vs when not to (I/O-bound, low traffic)."

---

## Q65: What are streams in Node.js and when to use them?

**Perfect Answer:**

"Streams process data piece-by-piece (chunks) instead of loading entire dataset into memory. Essential for large files and real-time data.

**Problem: Loading Entire File**
```javascript
// ❌ BAD: Load 1GB file into memory
const fs = require('fs');

app.get('/download', (req, res) => {
  const data = fs.readFileSync('large-file.mp4');  // 1GB in memory!
  
  res.send(data);
});

// 10 concurrent requests = 10GB memory usage
// Server crashes with OutOfMemory error
```

**Solution: Streaming**
```javascript
// ✅ GOOD: Stream file (1MB chunks)
const fs = require('fs');

app.get('/download', (req, res) => {
  const stream = fs.createReadStream('large-file.mp4');
  
  stream.pipe(res);  // Pipe directly to response
});

// Memory usage: ~1MB per request (chunk size)
// 10 concurrent requests = 10MB memory (manageable!)
```

**Stream Types:**

**1. Readable Stream (Read data)**
```javascript
const fs = require('fs');

const readable = fs.createReadStream('input.txt');

// Event-based
readable.on('data', (chunk) => {
  console.log('Received chunk:', chunk.length, 'bytes');
});

readable.on('end', () => {
  console.log('No more data');
});

readable.on('error', (err) => {
  console.error('Error:', err);
});

// Flow control (backpressure)
readable.on('data', (chunk) => {
  // Process chunk
  if (!processChunk(chunk)) {
    readable.pause();  // Too fast, pause
    
    setTimeout(() => {
      readable.resume();  // Resume after processing
    }, 100);
  }
});
```

**2. Writable Stream (Write data)**
```javascript
const fs = require('fs');

const writable = fs.createWriteStream('output.txt');

// Write data
writable.write('Hello ');
writable.write('World\n');

// End stream
writable.end('Final line');

// Events
writable.on('finish', () => {
  console.log('All data written');
});

writable.on('error', (err) => {
  console.error('Write error:', err);
});

// Backpressure handling
const canWrite = writable.write(chunk);

if (!canWrite) {
  // Buffer full, wait for drain
  writable.once('drain', () => {
    // Can write again
  });
}
```

**3. Duplex Stream (Read + Write)**
```javascript
const { Duplex } = require('stream');

// TCP socket is duplex
const net = require('net');

const socket = net.connect({ port: 8080 });

// Can read
socket.on('data', (data) => {
  console.log('Received:', data.toString());
});

// Can write
socket.write('Hello server');
socket.end();
```

**4. Transform Stream (Modify data)**
```javascript
const { Transform } = require('stream');

// Uppercase transform
class UppercaseTransform extends Transform {
  _transform(chunk, encoding, callback) {
    const uppercased = chunk.toString().toUpperCase();
    this.push(uppercased);
    callback();
  }
}

const uppercase = new UppercaseTransform();

// Usage
process.stdin
  .pipe(uppercase)
  .pipe(process.stdout);

// Type "hello" → outputs "HELLO"
```

**Piping Streams:**
```javascript
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');

// Chain: Read → Compress → Encrypt → Write
fs.createReadStream('input.txt')
  .pipe(zlib.createGzip())                    // Compress
  .pipe(crypto.createCipher('aes192', 'key'))  // Encrypt
  .pipe(fs.createWriteStream('output.gz.enc')); // Write

// Memory usage: Just chunks in pipeline (few MB)
// vs loading entire file (could be GB)
```

**Real-World Use Cases:**

**1. File Upload**
```javascript
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

app.post('/upload', multer().single('file'), async (req, res) => {
  // Stream to S3 (not into memory)
  const stream = require('stream');
  const bufferStream = new stream.PassThrough();
  bufferStream.end(req.file.buffer);
  
  await s3Client.send(new PutObjectCommand({
    Bucket: 'my-bucket',
    Key: req.file.originalname,
    Body: bufferStream  // Stream!
  }));
  
  res.json({ success: true });
});
```

**2. CSV Processing**
```javascript
const fs = require('fs');
const csv = require('csv-parser');

let count = 0;

// Process 10M row CSV (streaming)
fs.createReadStream('huge-data.csv')
  .pipe(csv())
  .on('data', (row) => {
    // Process row (insert to DB, etc.)
    processRow(row);
    count++;
    
    if (count % 10000 === 0) {
      console.log(`Processed ${count} rows`);
    }
  })
  .on('end', () => {
    console.log(`Total: ${count} rows`);
  });

// Memory usage: Constant (few MB)
// vs loading entire CSV into memory (GB)
```

**3. Log Tailing**
```javascript
const fs = require('fs');
const { Transform } = require('stream');

// Filter log stream
class ErrorFilter extends Transform {
  _transform(line, encoding, callback) {
    if (line.toString().includes('ERROR')) {
      this.push(line);
    }
    callback();
  }
}

// Tail log file
const tail = require('tail').Tail;
const logTail = new tail('app.log');

logTail.on('line', (line) => {
  if (line.includes('ERROR')) {
    console.error('Error detected:', line);
    // Send alert
  }
});
```

**4. HTTP Proxy**
```javascript
const http = require('http');

const server = http.createServer((req, res) => {
  // Proxy request to backend
  const options = {
    hostname: 'backend.example.com',
    port: 80,
    path: req.url,
    method: req.method,
    headers: req.headers
  };
  
  const proxyReq = http.request(options, (proxyRes) => {
    // Pipe backend response to client
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);  // Stream!
  });
  
  // Pipe client request to backend
  req.pipe(proxyReq);  // Stream!
  
  // Memory usage: Constant (just chunks in transit)
});
```

**Backpressure Handling:**
```javascript
const fs = require('fs');

const readable = fs.createReadStream('large-input.txt');
const writable = fs.createWriteStream('output.txt');

// Manual piping with backpressure
readable.on('data', (chunk) => {
  const canWrite = writable.write(chunk);
  
  if (!canWrite) {
    // Writable buffer full, pause readable
    readable.pause();
    
    writable.once('drain', () => {
      // Buffer drained, resume readable
      readable.resume();
    });
  }
});

// Or just use pipe() (handles backpressure automatically)
readable.pipe(writable);
```

**Performance Comparison:**
```javascript
// Without streaming (load all into memory)
const data = await fs.promises.readFile('1GB-file.json');
const parsed = JSON.parse(data);
// Memory: 1GB+, Time: 5s

// With streaming
const parser = JSONStream.parse('*');
fs.createReadStream('1GB-file.json')
  .pipe(parser)
  .on('data', (obj) => {
    // Process each object
  });
// Memory: ~10MB, Time: 3s (parallel processing)
```

**When to Use Streams:**
```
✅ Large files (> 100MB)
✅ Real-time data (logs, chat)
✅ Media streaming (video, audio)
✅ File processing (CSV, JSON)
✅ Proxying requests
✅ Network sockets

Example: Video streaming service
- 1GB video file
- Stream: 5MB memory
- No stream: 1GB memory (200× more!)
```

**Interview tip:** Explain streams process data in chunks (not all at once), show 4 types (Readable, Writable, Duplex, Transform), demonstrate piping (readable.pipe(writable)), show real-world examples (file upload to S3, CSV processing, HTTP proxy), mention backpressure handling (pause/resume), compare performance (1GB file: stream = 5MB memory vs no stream = 1GB memory)."

---

---

## Q66: What is the difference between require() and import?

**Perfect Answer:**

"require() is CommonJS (synchronous, Node.js native). import is ES Modules (asynchronous, modern standard).

**CommonJS (require)**
```javascript
// Synchronous loading
const express = require('express');
const { Router } = require('express');

// Can be conditional
if (process.env.NODE_ENV === 'development') {
  const devTools = require('./dev-tools');
}

// Dynamic require
const moduleName = 'express';
const module = require(moduleName);

// Exports
module.exports = function() { };
module.exports.helper = function() { };

// Or
exports.helper = function() { };
```

**ES Modules (import)**
```javascript
// Static imports (top-level only)
import express from 'express';
import { Router } from 'express';

// ❌ CANNOT be conditional at top level
if (condition) {
  import something from './module';  // Syntax error!
}

// Dynamic import (async)
const module = await import('./module.js');

// Or with then
import('./module.js').then(module => {
  module.default();
});

// Exports
export default function() { };
export function helper() { };

// Or
export { helper, another };
```

**Key Differences:**

| Feature | require() | import |
|---------|-----------|--------|
| Loading | Synchronous | Asynchronous |
| When | Runtime (anywhere) | Parse time (top-level) |
| Conditional | Yes | No (use dynamic import) |
| Tree-shaking | No | Yes (webpack) |
| Standard | CommonJS | ES Modules |
| Node.js | Native | Supported (13.2+) |

**Using ES Modules in Node.js:**
```javascript
// Option 1: .mjs extension
// user.mjs
export function getUser() {
  return { name: 'John' };
}

// server.mjs
import { getUser } from './user.mjs';

// Option 2: package.json type
{
  "type": "module"
}

// Now .js files are ES Modules
// user.js
export function getUser() {
  return { name: 'John' };
}

// server.js
import { getUser } from './user.js';  // Must include .js!
```

**Mixing CommonJS and ES Modules:**
```javascript
// ES Module importing CommonJS (works)
import express from 'express';  // express is CommonJS

// CommonJS importing ES Module (doesn't work directly)
const module = require('./esmodule.js');  // Error!

// Solution: dynamic import in CommonJS
(async () => {
  const module = await import('./esmodule.js');
  module.default();
})();
```

**Interview tip:** Explain require() is synchronous CommonJS (Node.js native), import is asynchronous ES Modules (modern standard with tree-shaking), show how to enable ES Modules in Node.js (.mjs or "type": "module"), mention mixing (ES Module can import CommonJS, but not vice versa without dynamic import)."

---

## Q67: How do you debug memory leaks using heap snapshots?

**Perfect Answer:**

"Heap snapshots capture memory state at a point in time. Compare snapshots to find growing objects.

**Taking Heap Snapshots:**
```javascript
const v8 = require('v8');
const fs = require('fs');

function takeSnapshot(filename) {
  const snapshotStream = v8.writeHeapSnapshot(filename);
  console.log('Snapshot saved to', snapshotStream);
}

// Take baseline snapshot
takeSnapshot('./snapshots/baseline.heapsnapshot');

// Run operations
for (let i = 0; i < 10000; i++) {
  // Suspected leak
}

// Take after snapshot
takeSnapshot('./snapshots/after.heapsnapshot');
```

**Analyzing in Chrome DevTools:**
```
1. Open Chrome → DevTools → Memory tab
2. Load baseline.heapsnapshot
3. Load after.heapsnapshot
4. Select "Comparison" view
5. Sort by "Size Delta" (descending)

Growing objects indicate potential leaks:
- Array: +1000 instances, +50MB
- Object: +500 instances, +10MB
- String: +2000 instances, +5MB

Click on class name → see allocation stack traces
```

**Automated Leak Detection:**
```javascript
const v8 = require('v8');

class MemoryMonitor {
  constructor() {
    this.snapshots = [];
    this.threshold = 50 * 1024 * 1024;  // 50MB growth
  }
  
  async monitor() {
    const baseline = this.getMemoryUsage();
    this.snapshots.push({ timestamp: Date.now(), usage: baseline });
    
    setInterval(() => {
      const current = this.getMemoryUsage();
      const growth = current.heapUsed - baseline.heapUsed;
      
      if (growth > this.threshold) {
        console.error('Memory leak detected!', {
          growth: `${Math.round(growth / 1024 / 1024)}MB`,
          baseline: `${Math.round(baseline.heapUsed / 1024 / 1024)}MB`,
          current: `${Math.round(current.heapUsed / 1024 / 1024)}MB`
        });
        
        // Take snapshot for analysis
        const filename = `leak-${Date.now()}.heapsnapshot`;
        v8.writeHeapSnapshot(filename);
        
        // Alert ops team
        this.sendAlert({ growth, filename });
      }
      
      this.snapshots.push({ timestamp: Date.now(), usage: current });
      
      // Keep last hour only
      const oneHourAgo = Date.now() - 3600000;
      this.snapshots = this.snapshots.filter(s => s.timestamp > oneHourAgo);
    }, 60000);  // Check every minute
  }
  
  getMemoryUsage() {
    return process.memoryUsage();
  }
  
  sendAlert(info) {
    // Send to Slack, PagerDuty, etc.
  }
}

const monitor = new MemoryMonitor();
monitor.monitor();
```

**Interview tip:** Show how to take heap snapshots with v8.writeHeapSnapshot(), explain comparing snapshots in Chrome DevTools to find growing objects, demonstrate automated monitoring that alerts on memory growth > threshold."

---

## Q68: What is the purpose of buffer in Node.js?

**Perfect Answer:**

"Buffer handles binary data in Node.js. Essential for files, images, network protocols.

**Creating Buffers:**
```javascript
// From string
const buf1 = Buffer.from('Hello', 'utf8');

// Allocate fixed size
const buf2 = Buffer.alloc(10);  // 10 bytes, filled with 0

// Unsafe (faster but uninitialized)
const buf3 = Buffer.allocUnsafe(10);  // May contain old data

// From array
const buf4 = Buffer.from([1, 2, 3, 4]);
```

**Reading/Writing:**
```javascript
const buf = Buffer.alloc(4);

// Write
buf.writeUInt32BE(0x12345678, 0);  // Big-endian
// buf: <Buffer 12 34 56 78>

// Read
const value = buf.readUInt32BE(0);  // 0x12345678

// String conversion
const str = buf.toString('hex');  // '12345678'
```

**Use Cases:**
```javascript
// 1. File I/O
const fs = require('fs');
const buffer = fs.readFileSync('image.png');  // Buffer
console.log(buffer);  // <Buffer 89 50 4e 47 ...>

// 2. Network
const net = require('net');
const socket = net.connect(8080);
socket.on('data', (buffer) => {
  console.log('Received bytes:', buffer.length);
});

// 3. Crypto
const crypto = require('crypto');
const hash = crypto.createHash('sha256');
hash.update('password');
const buffer = hash.digest();  // Buffer, not string
```

**Interview tip:** Explain Buffer handles binary data (images, files, network), show creation (Buffer.from, Buffer.alloc), demonstrate read/write binary data, mention use cases (file I/O, network sockets, cryptography)."

---

## Q69: How does Node.js handle child processes?

**Perfect Answer:**

"Node.js spawns child processes to run external commands or separate Node.js scripts for CPU-intensive tasks.

**Methods:**

**1. exec() - Run command, buffer output**
```javascript
const { exec } = require('child_process');

exec('ls -la', (error, stdout, stderr) => {
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  console.log('Output:', stdout);
  console.error('Errors:', stderr);
});

// Pros: Simple, shell parsing
// Cons: Buffers ALL output (not for large outputs)
```

**2. spawn() - Stream output**
```javascript
const { spawn } = require('child_process');

const child = spawn('find', ['.', '-name', '*.js']);

child.stdout.on('data', (data) => {
  console.log(`stdout: ${data}`);
});

child.stderr.on('data', (data) => {
  console.error(`stderr: ${data}`);
});

child.on('close', (code) => {
  console.log(`Exited with code ${code}`);
});

// Pros: Streaming (large output), no shell overhead
// Cons: More complex
```

**3. fork() - Separate Node.js process**
```javascript
// parent.js
const { fork } = require('child_process');

const child = fork('./worker.js');

// Send message to child
child.send({ type: 'task', data: [1, 2, 3] });

// Receive from child
child.on('message', (msg) => {
  console.log('Result from child:', msg);
});

// worker.js
process.on('message', (msg) => {
  if (msg.type === 'task') {
    // Heavy computation
    const result = msg.data.reduce((a, b) => a + b);
    
    // Send result back
    process.send({ type: 'result', value: result });
  }
});

// Pros: IPC (inter-process communication), isolate CPU work
// Cons: Memory overhead (separate V8 instance)
```

**CPU-Intensive Task Offloading:**
```javascript
// main.js
const { fork } = require('child_process');

app.post('/api/process-image', async (req, res) => {
  const worker = fork('./image-processor.js');
  
  worker.send({ image: req.body.imageData });
  
  worker.on('message', (result) => {
    res.json({ thumbnail: result.thumbnail });
    worker.kill();
  });
  
  worker.on('error', (err) => {
    res.status(500).json({ error: err.message });
    worker.kill();
  });
});

// image-processor.js
const sharp = require('sharp');

process.on('message', async (msg) => {
  const thumbnail = await sharp(Buffer.from(msg.image))
    .resize(200, 200)
    .toBuffer();
  
  process.send({ thumbnail: thumbnail.toString('base64') });
});

// Benefit: Image processing doesn't block event loop
```

**Interview tip:** Show exec() for simple commands (buffers output), spawn() for streaming (large output), fork() for separate Node.js processes (CPU-intensive tasks), demonstrate worker pattern to offload image processing from main thread."

---

## Q70: What are Worker Threads and when to use them?

**Perfect Answer:**

"Worker Threads run JavaScript in parallel on multiple CPU cores within same process. For CPU-intensive operations.

**Problem: CPU Blocking**
```javascript
// CPU-intensive hash
app.post('/api/hash', (req, res) => {
  const hash = crypto.pbkdf2Sync(req.body.password, 'salt', 100000, 64, 'sha512');
  res.json({ hash: hash.toString('hex') });
});

// Takes 100ms to compute
// Blocks event loop (all other requests wait)
```

**Solution: Worker Threads**
```javascript
const { Worker } = require('worker_threads');

app.post('/api/hash', async (req, res) => {
  const worker = new Worker('./hash-worker.js', {
    workerData: { password: req.body.password }
  });
  
  worker.on('message', (hash) => {
    res.json({ hash });
  });
  
  worker.on('error', (err) => {
    res.status(500).json({ error: err.message });
  });
});

// hash-worker.js
const { workerData, parentPort } = require('worker_threads');
const crypto = require('crypto');

const hash = crypto.pbkdf2Sync(workerData.password, 'salt', 100000, 64, 'sha512');

parentPort.postMessage(hash.toString('hex'));

// Now doesn't block event loop!
```

**Worker Pool Pattern:**
```javascript
const { Worker } = require('worker_threads');

class WorkerPool {
  constructor(workerScript, poolSize = 4) {
    this.workers = [];
    this.freeWorkers = [];
    this.taskQueue = [];
    
    for (let i = 0; i < poolSize; i++) {
      const worker = new Worker(workerScript);
      this.workers.push(worker);
      this.freeWorkers.push(worker);
    }
  }
  
  async runTask(data) {
    return new Promise((resolve, reject) => {
      const task = { data, resolve, reject };
      
      if (this.freeWorkers.length > 0) {
        this.executeTask(task);
      } else {
        this.taskQueue.push(task);
      }
    });
  }
  
  executeTask(task) {
    const worker = this.freeWorkers.pop();
    
    worker.once('message', (result) => {
      task.resolve(result);
      this.freeWorkers.push(worker);
      
      // Process next queued task
      if (this.taskQueue.length > 0) {
        this.executeTask(this.taskQueue.shift());
      }
    });
    
    worker.once('error', (err) => {
      task.reject(err);
      this.freeWorkers.push(worker);
    });
    
    worker.postMessage(task.data);
  }
}

// Usage
const pool = new WorkerPool('./hash-worker.js', 4);

app.post('/api/hash', async (req, res) => {
  try {
    const hash = await pool.runTask({ password: req.body.password });
    res.json({ hash });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4 workers handle tasks in parallel
```

**When to Use:**
```
✅ CPU-intensive operations (hashing, encryption, compression)
✅ Image/video processing
✅ Large data processing
✅ Scientific calculations

Example: Password hashing with bcrypt
- 100ms per hash
- Worker thread: Non-blocking
```

**When NOT to Use:**
```
❌ I/O operations (already async)
❌ Simple operations (overhead not worth it)
❌ Low CPU usage

Example: Database queries
- Already non-blocking via libuv
- Worker thread adds overhead, no benefit
```

**Worker Threads vs Child Processes:**
```
Worker Threads:
✅ Share memory (faster communication)
✅ Lighter weight (same V8 instance)
✅ Faster startup
❌ Crash affects whole process

Child Processes:
✅ Full isolation (crash doesn't affect parent)
✅ Can run different languages
❌ Heavier (separate V8 instance)
❌ Slower IPC
```

**Interview tip:** Explain Worker Threads run JavaScript in parallel for CPU-intensive tasks, show worker pool pattern (reuse workers), compare to child processes (lighter weight but less isolation), mention when to use (CPU-bound) vs when not to (I/O-bound)."

---

## Q71: What is the V8 engine and how does it optimize JavaScript?

**Perfect Answer:**

"V8 is Google's JavaScript engine that compiles JS to machine code. Uses JIT compilation and optimizations.

**V8 Pipeline:**
```
JavaScript code
    ↓
Parser (AST)
    ↓
Ignition (Interpreter) → Bytecode
    ↓
TurboFan (Optimizing Compiler) → Machine Code
```

**Hidden Classes:**
```javascript
// ❌ BAD: Changing object shape
function Point(x, y) {
  this.x = x;
  this.y = y;
}

const p1 = new Point(1, 2);  // Hidden class C0
const p2 = new Point(3, 4);  // Same hidden class C0

p1.z = 5;  // Creates new hidden class C1 (slower!)

// ✅ GOOD: Same shape
function Point(x, y, z) {
  this.x = x;
  this.y = y;
  this.z = z || 0;
}

const p1 = new Point(1, 2);  // Hidden class C0
const p2 = new Point(3, 4);  // Same hidden class C0
const p3 = new Point(5, 6, 7);  // Same hidden class C0

// All objects same shape = faster property access
```

**Inline Caching:**
```javascript
// V8 caches property access
function getX(obj) {
  return obj.x;
}

getX({ x: 1 });  // First call: slow (lookup)
getX({ x: 2 });  // Cached: fast (no lookup)
getX({ x: 3 });  // Cached: fast

// If different shape, cache invalidated
getX({ y: 1, x: 4 });  // Slow again (different shape)
```

**Optimization Tips:**
```javascript
// 1. Use monomorphic functions (single type)
// ✅ GOOD
function add(a, b) {
  return a + b;
}
add(1, 2);  // Numbers only
add(3, 4);

// ❌ BAD (polymorphic)
add(1, 2);     // Numbers
add('a', 'b'); // Strings (deoptimized!)

// 2. Initialize all properties
// ✅ GOOD
function User() {
  this.name = '';
  this.age = 0;
  this.email = '';
}

// 3. Avoid delete
// ❌ BAD
const obj = { x: 1, y: 2 };
delete obj.x;  // Changes hidden class

// ✅ GOOD
obj.x = undefined;  // Keeps hidden class

// 4. Use typed arrays for numbers
// ✅ GOOD
const arr = new Int32Array(1000000);

// ❌ BAD
const arr = new Array(1000000);
```

**Interview tip:** Explain V8 compiles JS to machine code via JIT, show hidden classes (same object shape = fast), mention inline caching (caches property access), give optimization tips (monomorphic functions, initialize all properties, avoid delete, use typed arrays)."

---

## Q72: How do you profile Node.js applications?

**Perfect Answer:**

"Profiling identifies performance bottlenecks - CPU hotspots, memory usage, slow functions.

**Built-in Profiler:**
```bash
# CPU profiling
node --prof app.js

# Generates isolate-*-v8.log

# Process log
node --prof-process isolate-*-v8.log > profile.txt

# Shows:
# - Functions consuming most CPU
# - Call stacks
# - Tick percentages
```

**Chrome DevTools:**
```bash
# Start with inspector
node --inspect app.js

# Or attach to running process
kill -SIGUSR1 <pid>

# Open chrome://inspect
# Click "Open dedicated DevTools for Node"

# Profiler tab:
# - Start profiling
# - Run operations
# - Stop profiling
# - See flame graph (function call hierarchy)
```

**Clinic.js (Comprehensive):**
```bash
npm install -g clinic

# CPU profiling
clinic doctor -- node app.js

# Memory profiling
clinic heapprofiler -- node app.js

# Event loop lag
clinic bubbleprof -- node app.js

# Opens HTML report with visualizations
```

**Performance Hooks:**
```javascript
const { performance, PerformanceObserver } = require('perf_hooks');

// Measure function duration
performance.mark('A');

expensiveOperation();

performance.mark('B');
performance.measure('A to B', 'A', 'B');

const measure = performance.getEntriesByName('A to B')[0];
console.log(`Took ${measure.duration}ms`);

// Observer
const obs = new PerformanceObserver((items) => {
  items.getEntries().forEach((entry) => {
    console.log(`${entry.name}: ${entry.duration}ms`);
  });
});

obs.observe({ entryTypes: ['measure'] });
```

**Interview tip:** Show node --prof for CPU profiling, Chrome DevTools for visual flame graphs, Clinic.js for comprehensive analysis, performance hooks for custom measurements."

---

## Q73: What is garbage collection in Node.js?

**Perfect Answer:**

"Garbage collection automatically frees memory from objects no longer referenced. V8 uses generational GC.

**Garbage Collection Phases:**
```
New Space (Young Generation):
- New objects allocated here (1-8MB)
- Scavenger GC (fast, frequent)
- Survivors promoted to Old Space

Old Space (Old Generation):
- Long-lived objects (large, 100s MB)
- Mark-Sweep-Compact GC (slow, infrequent)
```

**When Objects Are Collected:**
```javascript
function create() {
  const obj = { data: 'x'.repeat(1000000) };
  return obj;
}

const ref = create();  // obj alive (referenced by ref)

ref = null;  // obj eligible for GC (no references)

// GC runs automatically, frees memory
```

**Forcing GC (Testing Only):**
```bash
# Start with --expose-gc
node --expose-gc app.js
```

```javascript
// Force GC
if (global.gc) {
  global.gc();
  console.log('GC triggered');
}

// Check memory
const before = process.memoryUsage().heapUsed;
global.gc();
const after = process.memoryUsage().heapUsed;

console.log(`Freed: ${(before - after) / 1024 / 1024}MB`);
```

**GC Tuning:**
```bash
# Increase heap size (default 1.4GB)
node --max-old-space-size=4096 app.js  # 4GB

# Monitor GC
node --trace-gc app.js

# Output:
# [12345:0x104008000]  1234 ms: Scavenge 2.1 (3.2) -> 1.8 (4.2) MB, 1.2 / 0.0 ms
#                               |        |      |     |
#                               |        |      |     └─ GC time
#                               |        |      └─ After size
#                               |        └─ Before size
#                               └─ GC type
```

**Interview tip:** Explain V8 uses generational GC (young generation fast, old generation slow), show when objects are collected (no references), mention forcing GC with --expose-gc (testing only), show GC tuning with --max-old-space-size."

---

## Q74: What are the differences between setImmediate, setTimeout, and process.nextTick?

**Perfect Answer:**

"All schedule callbacks, but execute at different times in event loop.

**Execution Order:**
```javascript
console.log('1');

setTimeout(() => console.log('2'), 0);
setImmediate(() => console.log('3'));
process.nextTick(() => console.log('4'));

console.log('5');

// Output:
// 1
// 5
// 4    ← nextTick (after current operation)
// 2    ← setTimeout (timers phase)
// 3    ← setImmediate (check phase)
```

**process.nextTick:**
- Executes after current operation, before event loop
- Highest priority
- Can starve event loop if recursive

**setTimeout(fn, 0):**
- Executes in timers phase
- Minimum delay 1ms (not 0ms)
- Lower priority than nextTick

**setImmediate:**
- Executes in check phase
- After I/O operations
- Designed for "do this after I/O"

**Interview tip:** Show execution order (nextTick → setTimeout → setImmediate), explain when each executes in event loop, mention nextTick highest priority but can starve loop."

---

## Q75: How do you handle uncaught exceptions and unhandled rejections?

**Perfect Answer:**

"Catch uncaught exceptions/rejections to log and gracefully shutdown, preventing silent failures.

**Uncaught Exception:**
```javascript
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  
  // Log to monitoring
  logger.error('Uncaught exception', { error, stack: error.stack });
  
  // Graceful shutdown
  server.close(() => {
    process.exit(1);
  });
  
  // Force exit if not closed in 10s
  setTimeout(() => {
    process.exit(1);
  }, 10000);
});

// Triggered by:
throw new Error('Something broke');
```

**Unhandled Rejection:**
```javascript
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  
  // Log to monitoring
  logger.error('Unhandled rejection', { reason, promise });
  
  // In Node.js 15+, this crashes by default
  // In older versions, continue running (dangerous!)
  
  // Graceful shutdown
  server.close(() => {
    process.exit(1);
  });
});

// Triggered by:
Promise.reject('Error');
async function() { throw new Error(); }  // Without try/catch
```

**Best Practice: Always use try/catch:**
```javascript
// ✅ GOOD
app.get('/api/users', async (req, res, next) => {
  try {
    const users = await db.query('SELECT * FROM users');
    res.json(users);
  } catch (error) {
    next(error);  // Pass to error handler
  }
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error('Request error', { error: err, path: req.path });
  res.status(500).json({ error: 'Internal server error' });
});
```

**Interview tip:** Show uncaughtException and unhandledRejection handlers to log and gracefully shutdown, emphasize always use try/catch in async functions, mention Node.js 15+ crashes on unhandled rejection by default."

---

**NODE.JS SPECIFIC SECTION COMPLETE! ✅**

**Progress: 75/100 questions complete**

**Next:** DevOps & Deployment (Q76-Q90) and System Design (Q91-Q100)

Moving to create MODULE-9-PART-4-DEVOPS.md...
