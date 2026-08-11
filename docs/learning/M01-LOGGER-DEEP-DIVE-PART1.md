# M01: Logger Deep Dive - PART 1

**File:** `shared/logger.ts` (44 lines)  
**Level:** Foundation  
**Prerequisites:** Basic TypeScript, Node.js fundamentals  
**Time to Master:** 2-3 hours

---

## 📖 SECTION 1: THEORY - What is Logging and Why Does it Matter?

### 1.1 What is Logging?

Logging is the practice of **recording events** that happen in your application while it runs. Think of it as a **flight recorder** for your code - when something goes wrong in production, logs are often your only way to understand what happened.

**Real-World Analogy:**
Imagine you're a detective investigating a crime. You have:
- **Witnesses** (users reporting bugs)
- **Security footage** (logs)
- **Physical evidence** (error messages)

Without the security footage (logs), you're relying only on witness testimony, which can be unreliable. Logs give you a **timestamped, accurate record** of what actually happened.

### 1.2 Why Not Just Use `console.log()`?

You might be thinking: "I can just use `console.log()` everywhere, right?" Here's why that doesn't work in production:

| Feature | `console.log()` | Production Logger (Winston) |
|---------|-----------------|----------------------------|
| **Log Levels** | No (everything is equal) | Yes (error, warn, info, debug) |
| **File Output** | No (only console) | Yes (saves to files) |
| **Rotation** | No (files grow forever) | Yes (auto-rotates, limits size) |
| **Formatting** | Basic | JSON, timestamps, metadata |
| **Filtering** | No | Yes (by level, service, etc.) |
| **Performance** | Blocks execution | Async, non-blocking |
| **Production Ready** | ❌ | ✅ |

**Real Interview Story:**
> A candidate once told me: "I use `console.log()` in production." When I asked what happens when the disk fills up, they had no answer. Using `console.log()` in production is like driving without insurance - it works until it doesn't, and then you're in serious trouble.

### 1.3 The 5 Standard Log Levels

Think of log levels as a **severity spectrum** from "just FYI" to "THE BUILDING IS ON FIRE":

1. **DEBUG** 🔍
   - Most verbose
   - Used during development
   - Example: "User query took 45ms"
   - **Never shown in production**

2. **INFO** ℹ️
   - Normal operations
   - Business events
   - Example: "User 12345 logged in"
   - **Default production level**

3. **WARN** ⚠️
   - Something unexpected but not critical
   - Example: "API rate limit at 80%"
   - **Investigate soon**

4. **ERROR** 🚨
   - Something broke
   - User impact
   - Example: "Payment processing failed"
   - **Wake up on-call engineer**

5. **FATAL** 💀
   - Critical system failure
   - Service going down
   - Example: "Database connection lost"
   - **WAKE UP EVERYONE**

### 1.4 Why Winston?

Winston is the most popular logging library for Node.js. Here's why:

- **Mature**: Been around since 2011, battle-tested
- **Flexible**: Multiple transports (files, databases, cloud services)
- **Performant**: Async by default, won't block your app
- **Standard**: Used by Netflix, Uber, NASA
- **Well-maintained**: Active community, regular updates

**Alternatives:**
- **Bunyan**: JSON-only, slightly faster
- **Pino**: Fastest, but less flexible
- **Log4js**: Java-style logging

For MAANG interviews, knowing Winston is **table stakes**.

---

## 🔍 SECTION 2: LINE-BY-LINE CODE ANALYSIS

Let's analyze every single line of `shared/logger.ts`. I'll explain what each line does, why it's there, and what would break if you removed it.

### 2.1 Import Statement (Line 1-2)

```typescript
import winston from 'winston';
```

**What it does:**
- Imports the Winston library
- Uses **default import** syntax (not named import)

**Why not named import?**
```typescript
// ❌ WRONG - Winston doesn't export like this
import { winston } from 'winston';

// ✅ CORRECT - Winston exports a default object
import winston from 'winston';
```

**Interview Question Preview:**
Q: "What's the difference between default and named imports?"
A: Default imports use `import X from 'Y'`, named imports use `import { X } from 'Y'`. Default imports let you choose the name, named imports must match the export name.

### 2.2 Logger Creation (Lines 3-28)

```typescript
const logger = winston.createLogger({
```

**What it does:**
- Creates a new logger instance
- `createLogger()` is a **factory function** that returns a configured logger object
- This logger will be exported and used throughout your app

**Why not just use `winston` directly?**
```typescript
// ❌ WRONG - Modifies the global winston instance
winston.log('info', 'Hello');

// ✅ CORRECT - Creates an isolated instance
const logger = winston.createLogger({ ... });
logger.info('Hello');
```

**Production Consideration:**
In a microservices architecture, you might have **multiple logger instances** with different configurations (one for API Gateway, one for User Service). Creating instances keeps them isolated.

### 2.3 Log Level Configuration (Line 4)

```typescript
  level: process.env.LOG_LEVEL || 'info',
```

**What it does:**
- Sets the **minimum log level** to show
- Reads from environment variable `LOG_LEVEL`
- Falls back to `'info'` if not set

**The Level Hierarchy:**
```
debug < info < warn < error

If level = 'warn':
✅ warn logs shown
✅ error logs shown
❌ info logs hidden
❌ debug logs hidden
```

**Real-World Usage:**
```bash
# Development (show everything)
LOG_LEVEL=debug npm start

# Production (only important stuff)
LOG_LEVEL=info npm start

# Debugging production issues (temporarily)
LOG_LEVEL=debug npm start
```

**Interview Red Flag:**
If a candidate says "I set LOG_LEVEL=debug in production," that's a **massive red flag**. Debug logs in production can:
- Fill up disk space in hours
- Expose sensitive data (passwords, tokens)
- Slow down the application significantly

### 2.4 Format Configuration (Lines 5-10)

```typescript
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
```

**What `winston.format.combine()` does:**
Think of it like a **pipeline** where log messages flow through multiple transformations:

```
Raw Log → Add Timestamp → Add Error Stack → Format Strings → Convert to JSON → Output
```

Let's break down each formatter:

#### 2.4.1 Timestamp (Line 6)

```typescript
winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
```

**What it does:**
Adds a `timestamp` field to every log entry.

**Before:**
```json
{ "level": "info", "message": "User logged in" }
```

**After:**
```json
{ "timestamp": "2026-08-07 14:32:10", "level": "info", "message": "User logged in" }
```

**Why this format?**
- `YYYY-MM-DD HH:mm:ss` is **human-readable**
- Sorts chronologically in text editors
- Easy to grep in logs: `grep "2026-08-07 14:" combined.log`

**Alternative Formats:**
```typescript
// ISO 8601 (better for machines)
{ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }
// Output: 2026-08-07T14:32:10.123Z

// Unix timestamp (best for performance)
{ format: () => Date.now().toString() }
// Output: 1722178330000
```

**Interview Question:**
Q: "Why not use ISO 8601 format?"
A: "Human-readable vs machine-readable tradeoff. Our format is easier to read in log files, but ISO 8601 is better if you're sending logs to a centralized system like ELK or Datadog."

#### 2.4.2 Error Stack Traces (Line 7)

```typescript
winston.format.errors({ stack: true }),
```

**What it does:**
When you log an Error object, this formatter extracts the **stack trace**.

**Without this formatter:**
```typescript
logger.error(new Error('Payment failed'));
// Output: { "message": "Error: Payment failed" }
```

**With this formatter:**
```typescript
logger.error(new Error('Payment failed'));
// Output: {
//   "message": "Payment failed",
//   "stack": "Error: Payment failed\n    at processPayment (payment.ts:45)\n    at ..."
// }
```

**Why it matters:**
Stack traces tell you **WHERE** the error happened, not just WHAT happened. Without this, debugging production errors is like trying to find a needle in a haystack blindfolded.

**Production War Story:**
> At my last job, we had a "Cannot read property 'id' of undefined" error that happened randomly in production. Without stack traces, it took us 3 days to find the bug. With stack traces, it would have taken 10 minutes. Stack traces are **not optional** in production.

#### 2.4.3 String Interpolation (Line 8)

```typescript
winston.format.splat(),
```

**What it does:**
Enables **printf-style** string formatting (like sprintf in C).

**Example:**
```typescript
logger.info('User %s logged in at %d', 'john@example.com', Date.now());
// Output: "User john@example.com logged in at 1722178330000"
```

**Modern Alternative:**
```typescript
// Most developers prefer template literals
logger.info(`User ${email} logged in at ${Date.now()}`);
```

**Why include it?**
- Backwards compatibility with older code
- Some teams prefer the explicit formatting style
- Useful for internationalization (i18n)

**Interview Tip:**
If asked "What's splat?" don't panic. Just say: "It's for printf-style formatting. Most modern codebases use template literals instead, but it's there for compatibility."

#### 2.4.4 JSON Output (Line 9)

```typescript
winston.format.json()
```

**What it does:**
Converts the entire log entry into a **JSON string**.

**Why JSON?**
1. **Machine-readable**: Easy to parse with tools like `jq`, `grep`, Python
2. **Structured**: Each field is labeled and typed
3. **Standard**: Works with ELK, Splunk, Datadog, CloudWatch
4. **Searchable**: Can query by specific fields

**Example Output:**
```json
{"timestamp":"2026-08-07 14:32:10","level":"info","message":"User logged in","service":"user-service","environment":"production","userId":12345}
```

**Alternative: Pretty-printed (not for production):**
```typescript
winston.format.prettyPrint()
// Output:
// {
//   "timestamp": "2026-08-07 14:32:10",
//   "level": "info",
//   "message": "User logged in"
// }
```

**Production Best Practice:**
**ALWAYS use JSON in production**. It might look ugly to humans, but log aggregation tools LOVE it. You can always pretty-print locally for debugging.

### 2.5 Default Metadata (Lines 11-14)

```typescript
  defaultMeta: {
    service: process.env.SERVICE_NAME || 'unknown-service',
    environment: process.env.NODE_ENV || 'development'
  },
```

**What it does:**
Adds these fields to **every single log entry** automatically.

**Before defaultMeta:**
```typescript
logger.info('User logged in');
// Output: {"level":"info","message":"User logged in"}
```

**After defaultMeta:**
```typescript
logger.info('User logged in');
// Output: {
//   "level": "info",
//   "message": "User logged in",
//   "service": "user-service",
//   "environment": "production"
// }
```

**Why this is critical in microservices:**

Imagine you have 50 microservices all sending logs to a central server (like ELK). Without the `service` field, you can't tell which service a log came from:

```bash
# ❌ Can't filter logs without service field
grep "User logged in" combined.log

# ✅ Can filter by service
grep '"service":"user-service"' combined.log | grep "User logged in"
```

**Interview Question:**
Q: "What's the difference between `defaultMeta` and adding fields manually?"
A: "`defaultMeta` adds fields to EVERY log automatically. Manual fields need to be added every time. It's like the difference between setting a default value in a function parameter vs. passing it every time."

**Real Production Setup:**
```typescript
// api-gateway/.env
SERVICE_NAME=api-gateway
NODE_ENV=production

// user-service/.env
SERVICE_NAME=user-service
NODE_ENV=production

// Now all logs are automatically tagged with their service!
```

### 2.6 File Transport - Error Logs (Lines 16-21)

```typescript
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5242880,
      maxFiles: 5
    }),
```

**What's a "Transport"?**
A transport is a **destination** where logs are sent. Think of it like shipping packages - you can send them to multiple addresses (file, console, database, cloud service).

**Line-by-Line Breakdown:**

#### Line 16: `new winston.transports.File({`
Creates a new file transport. Winston has many transports:
- `winston.transports.File` - Save to files
- `winston.transports.Console` - Print to terminal
- `winston.transports.Http` - Send to HTTP endpoint
- Third-party: Database, Slack, Email, Sentry

#### Line 17: `filename: 'logs/error.log',`
Where to save error logs.

**Path Resolution:**
- Relative to **current working directory** (where you run `node server.js`)
- If you run from project root: `node-ecomm/logs/error.log`
- If logs/ doesn't exist, Winston **creates it automatically**

**Production Consideration:**
```typescript
// ❌ BAD - Relative path
filename: 'logs/error.log'

// ✅ BETTER - Absolute path
filename: path.join(__dirname, '../../logs/error.log')

// ✅ BEST - Environment variable
filename: process.env.ERROR_LOG_PATH || '/var/log/myapp/error.log'
```

#### Line 18: `level: 'error',`
This transport **only receives error-level logs** (and fatal, if you had that level).

**How level filtering works:**
```typescript
logger.debug('Debug message');  // ❌ Not sent to error.log
logger.info('Info message');    // ❌ Not sent to error.log
logger.warn('Warning message'); // ❌ Not sent to error.log
logger.error('Error message');  // ✅ Sent to error.log
```

**Why separate error logs?**
- **Faster triage**: Don't dig through info logs to find errors
- **Alerting**: Monitor error.log size, alert if it grows
- **Retention**: Keep error logs longer than debug logs
- **Analysis**: Run analytics on just errors

#### Line 19: `maxsize: 5242880,`
Maximum size of the log file in **bytes** before rotation.

**Let's do the math:**
```
5242880 bytes
= 5,242,880 bytes
= 5,120 KB
= 5 MB
```

**What happens when it reaches 5MB?**
1. Winston renames `error.log` to `error.log.1`
2. Creates a new empty `error.log`
3. New logs go to the new file

**Why 5MB?**
- **Balance**: Small enough to open in text editor, large enough to be meaningful
- **Performance**: Reading a 5MB file is fast, 500MB is slow
- **Disk space**: With 5 files rotation, max 25MB per log type

**Interview Question:**
Q: "What happens if you don't set maxsize?"
A: "The log file grows forever. In production, this can fill up your disk and crash your server. I've seen production servers go down because logs filled the entire 500GB disk."

#### Line 20: `maxFiles: 5`
Keep at most 5 rotated log files.

**Rotation Example:**
```
Day 1: error.log (3MB)
Day 2: error.log (5MB) → rotates
       error.log (new)
       error.log.1 (5MB)
Day 3: error.log (5MB) → rotates
       error.log (new)
       error.log.1 (5MB)
       error.log.2 (5MB)
Day 4: error.log (5MB) → rotates
       error.log (new)
       error.log.1 (5MB)
       error.log.2 (5MB)
       error.log.3 (5MB)
Day 5: error.log (5MB) → rotates
       error.log (new)
       error.log.1 (5MB)
       error.log.2 (5MB)
       error.log.3 (5MB)
       error.log.4 (5MB)
Day 6: error.log (5MB) → rotates
       error.log (new)
       error.log.1 (5MB)
       error.log.2 (5MB)
       error.log.3 (5MB)
       error.log.4 (5MB)
       error.log.5 (5MB) ← oldest file DELETED
```

**Total disk space used:**
- 5 files × 5MB = **25MB maximum**

**Production Best Practice:**
```typescript
// Development: Keep fewer files, smaller size
maxsize: 1048576,  // 1MB
maxFiles: 3,       // 3MB total

// Production: Keep more files, larger size
maxsize: 104857600,  // 100MB
maxFiles: 10,        // 1GB total

// High-traffic production: Rotate by date
// Use winston-daily-rotate-file npm package
```

### 2.7 File Transport - Combined Logs (Lines 22-27)

```typescript
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 5242880,
      maxFiles: 5
    })
```

**What's different from error.log?**
- **No `level` specified** - Receives ALL log levels (debug, info, warn, error)
- Same rotation settings (5MB, 5 files)

**Why have both error.log AND combined.log?**

Think of it like this:
- **combined.log** = Full movie with all scenes
- **error.log** = Trailer showing only the action scenes

**Real-World Usage:**
```bash
# Quick check: Any errors recently?
tail -f logs/error.log

# Deep dive: What was happening before the error?
tail -f logs/combined.log
```

**Interview Insight:**
This is a **common pattern** in production:
- One log for everything (combined)
- Separate logs for high-priority events (errors, security, audit)

### 2.8 Console Transport for Development (Lines 30-41)

```typescript
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
        return `${timestamp} [${service}] ${level}: ${message} ${
          Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
        }`;
      })
    )
  }));
}
```

This is the **most interesting** part of the entire file. Let's break it down carefully.

#### Line 30: Environment Check

```typescript
if (process.env.NODE_ENV !== 'production') {
```

**What it does:**
Only add console logging when **NOT in production**.

**Why?**
- **Development**: You want colorful, pretty logs in your terminal
- **Production**: Console logs are useless (no one's watching the terminal)
- **Performance**: Console logging is **slow** and **blocks the event loop**

**Common NODE_ENV values:**
```
development → console logging ON
test → console logging OFF (cleaner test output)
staging → console logging OFF
production → console logging OFF
```

**Interview Red Flag:**
If you see console logging in production Docker containers, that's a **code smell**. It wastes CPU and clutters stdout.

#### Line 31: Adding Transport Dynamically

```typescript
  logger.add(new winston.transports.Console({
```

**Why `.add()` instead of putting it in the original `transports` array?**

Compare these two approaches:

**❌ Approach 1: Ternary in transports array (messy)**
```typescript
const logger = winston.createLogger({
  transports: [
    new winston.transports.File({ filename: 'logs/error.log' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    process.env.NODE_ENV !== 'production' 
      ? new winston.transports.Console({ ... })
      : null  // ← Ugly! Creates null in array
  ].filter(Boolean)  // ← Extra filtering step
});
```

**✅ Approach 2: Conditional .add() (clean)**
```typescript
const logger = winston.createLogger({
  transports: [
    new winston.transports.File({ filename: 'logs/error.log' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({ ... }));
}
```

**Key Learning:** `.add()` lets you **dynamically add transports** after logger creation. This is useful for:
- Environment-specific transports
- Feature flags
- Plugin systems
- Runtime configuration

#### Lines 32-39: Console Format

```typescript
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
        return `${timestamp} [${service}] ${level}: ${message} ${
          Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
        }`;
      })
    )
```

**Why a different format for console?**
- **File logs**: JSON (for machines)
- **Console logs**: Pretty (for humans)

#### Line 33: Colorize

```typescript
      winston.format.colorize(),
```

**What it does:**
Adds ANSI color codes to log levels.

**Output:**
- `error` → Red
- `warn` → Yellow
- `info` → Green
- `debug` → Blue

**Example:**
```bash
# Without colorize
2026-08-07 14:32:10 [user-service] error: Payment failed

# With colorize
2026-08-07 14:32:10 [user-service] error: Payment failed
                                    ^^^^^ (red text in terminal)
```

**Why only for console?**
ANSI color codes look like garbage in log files:
```
[31merror[0m: Payment failed
```

#### Lines 34-38: Custom printf Format

```typescript
winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
  return `${timestamp} [${service}] ${level}: ${message} ${
    Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
  }`;
})
```

This is a **custom formatter**. Let's dissect it.

**The Parameter Destructuring:**
```typescript
({ timestamp, level, message, service, ...meta })
```

This extracts fields from the log object:
- `timestamp` - From `winston.format.timestamp()`
- `level` - From logger.info/error/etc
- `message` - The actual log message
- `service` - From `defaultMeta`
- `...meta` - Everything else (rest operator)

**Example log object:**
```javascript
{
  timestamp: '2026-08-07 14:32:10',
  level: 'info',
  message: 'User logged in',
  service: 'user-service',
  environment: 'production',
  userId: 12345,
  email: 'john@example.com'
}

// After destructuring:
timestamp = '2026-08-07 14:32:10'
level = 'info'
message = 'User logged in'
service = 'user-service'
meta = { environment: 'production', userId: 12345, email: 'john@example.com' }
```

**The Return Template:**
```typescript
return `${timestamp} [${service}] ${level}: ${message} ${
  Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
}`;
```

**Output:**
```
2026-08-07 14:32:10 [user-service] info: User logged in {
  "environment": "production",
  "userId": 12345,
  "email": "john@example.com"
}
```

**The Conditional Metadata:**
```typescript
Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
```

**What it does:**
- If `meta` has properties → Pretty-print them as JSON
- If `meta` is empty → Don't print anything (avoid empty `{}`)

**Why `JSON.stringify(meta, null, 2)`?**
- `meta` - The object to stringify
- `null` - No replacer function
- `2` - Indent with 2 spaces (pretty-print)

**Example:**
```javascript
// Without indent
JSON.stringify({ a: 1, b: 2 })
// Output: {"a":1,"b":2}

// With indent
JSON.stringify({ a: 1, b: 2 }, null, 2)
// Output:
// {
//   "a": 1,
//   "b": 2
// }
```

### 2.9 Export (Line 43)

```typescript
export default logger;
```

**What it does:**
Exports the configured logger as the **default export**.

**How other files use it:**
```typescript
// ✅ In other files
import logger from '../shared/logger';

logger.info('Hello world');
logger.error('Something broke', { userId: 123 });
```

**Why default export?**
- Only one logger per project (usually)
- Cleaner import syntax
- Common Node.js convention

**Alternative (named export):**
```typescript
// If you had multiple exports
export const logger = winston.createLogger({ ... });
export const errorLogger = winston.createLogger({ ... });

// Usage:
import { logger, errorLogger } from '../shared/logger';
```

---

## 🏗️ SECTION 3: ARCHITECTURE & FLOW DIAGRAMS

### 3.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     YOUR APPLICATION                     │
│                                                          │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐          │
│  │ API Gateway│  │User Service│  │Other Service│         │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘          │
│        │              │              │                  │
│        └──────────────┴──────────────┘                  │
│                       │                                  │
│                       ▼                                  │
│              ┌────────────────┐                          │
│              │ shared/logger.ts│                         │
│              └────────┬───────┘                          │
│                       │                                  │
│           ┌───────────┼───────────┐                     │
│           │           │           │                     │
│           ▼           ▼           ▼                     │
│      ┌────────┐  ┌────────┐  ┌────────┐               │
│      │File     │  │File     │  │Console │               │
│      │error.log│  │combined│  │(dev only)│              │
│      └────────┘  └────────┘  └────────┘               │
└─────────────────────────────────────────────────────────┘
```

### 3.2 Log Flow Through Formatters

```
┌─────────────────────────────────────────────────────────────┐
│ logger.info('User logged in', { userId: 123 })              │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
         ┌───────────────────────┐
         │ RAW LOG OBJECT        │
         │ {                     │
         │   level: 'info',      │
         │   message: 'User...'  │
         │   userId: 123         │
         │ }                     │
         └───────────┬───────────┘
                     │
                     ▼
         ┌───────────────────────┐
         │ ADD TIMESTAMP         │
         │ timestamp: '2026-...' │
         └───────────┬───────────┘
                     │
                     ▼
         ┌───────────────────────┐
         │ ADD DEFAULT META      │
         │ service: 'user-svc'   │
         │ environment: 'prod'   │
         └───────────┬───────────┘
                     │
                     ▼
         ┌───────────────────────┐
         │ FORMAT TO JSON        │
         │ (for file transports) │
         └───────────┬───────────┘
                     │
      ┌──────────────┼──────────────┐
      │              │              │
      ▼              ▼              ▼
┌─────────┐    ┌─────────┐    ┌─────────┐
│error.log│    │combined │    │Console  │
│(errors  │    │(all     │    │(dev only│
│ only)   │    │ levels) │    │ colored)│
└─────────┘    └─────────┘    └─────────┘
```

### 3.3 Log Level Filtering

```
Logger level: 'info'
────────────────────────────────────────

logger.debug('Debug message')
  │
  ├─► Level check: debug < info?
  │   YES → DROPPED ❌
  └─► Not sent to any transport


logger.info('Info message')
  │
  ├─► Level check: info >= info?
  │   YES → PASSED ✅
  │
  ├─► error.log filter: info >= error?
  │   NO → Not sent to error.log
  │
  ├─► combined.log filter: info >= global?
  │   YES → Written to combined.log ✅
  │
  └─► console filter: info >= global?
      YES → Printed to console ✅ (if dev)


logger.error('Error message')
  │
  ├─► Level check: error >= info?
  │   YES → PASSED ✅
  │
  ├─► error.log filter: error >= error?
  │   YES → Written to error.log ✅
  │
  ├─► combined.log filter: error >= global?
  │   YES → Written to combined.log ✅
  │
  └─► console filter: error >= global?
      YES → Printed to console ✅ (if dev)
```

### 3.4 File Rotation Lifecycle

```
TIME: Day 1, 10:00 AM
────────────────────────────────────
logs/
└── error.log (3 MB)


TIME: Day 2, 2:00 PM (hits 5MB limit)
────────────────────────────────────
logs/
├── error.log (0 MB) ← NEW FILE
└── error.log.1 (5 MB) ← ROTATED


TIME: Day 3, 5:00 PM (hits 5MB again)
────────────────────────────────────
logs/
├── error.log (0 MB) ← NEW FILE
├── error.log.1 (5 MB) ← PREVIOUS ROTATION
└── error.log.2 (5 MB) ← OLDEST


TIME: Day 6 (after 5 rotations)
────────────────────────────────────
logs/
├── error.log (0 MB)
├── error.log.1 (5 MB)
├── error.log.2 (5 MB)
├── error.log.3 (5 MB)
├── error.log.4 (5 MB)
└── error.log.5 (5 MB) ← WILL BE DELETED NEXT


TIME: Day 7 (6th rotation)
────────────────────────────────────
logs/
├── error.log (0 MB)
├── error.log.1 (5 MB)
├── error.log.2 (5 MB)
├── error.log.3 (5 MB)
├── error.log.4 (5 MB)
└── error.log.5 (5 MB)
    ▲
    └─ error.log.6 was deleted (exceeded maxFiles)
```

### 3.5 Environment-Specific Configuration

```
┌───────────────────────────────────────────────────────┐
│                   DEVELOPMENT                          │
├───────────────────────────────────────────────────────┤
│ LOG_LEVEL=debug                                        │
│ NODE_ENV=development                                   │
│                                                        │
│ Outputs:                                               │
│ ✅ Console (colorized, pretty)                         │
│ ✅ error.log (JSON)                                    │
│ ✅ combined.log (JSON, includes debug)                 │
└───────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────┐
│                   PRODUCTION                           │
├───────────────────────────────────────────────────────┤
│ LOG_LEVEL=info                                         │
│ NODE_ENV=production                                    │
│                                                        │
│ Outputs:                                               │
│ ❌ Console (disabled)                                  │
│ ✅ error.log (JSON)                                    │
│ ✅ combined.log (JSON, excludes debug)                 │
└───────────────────────────────────────────────────────┘
```

---

**🎓 END OF PART 1**

Part 1 covered:
- ✅ Theory and fundamentals
- ✅ Line-by-line code explanation (all 44 lines)
- ✅ Architecture diagrams and flow charts

**📌 Continue to M01-LOGGER-DEEP-DIVE-PART2.md for:**
- 🎯 15 Interview Questions with Detailed Answers
- 💡 Production Best Practices
- ⚡ Real-World Scenarios
- 🧪 Hands-On Exercises
