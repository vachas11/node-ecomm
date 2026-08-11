# M16: Service Layer Deep Dive

**File:** `services/user-service/src/services/user.service.ts`  
**Lines:** 211 lines  
**Purpose:** Business logic layer orchestrating user operations between controllers and repositories

---

## 📖 Part 1: What is the Service Layer?

### The Three-Layer Architecture

Think of a restaurant:

```
┌─────────────────────────────────────────────┐
│  Controller = WAITER                         │
│  Takes orders, serves food                   │
│  (HTTP: receives requests, sends responses)  │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│  Service = CHEF ← WE ARE HERE                │
│  Validates recipes, coordinates cooking      │
│  (Business logic: validation, orchestration) │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│  Repository = PANTRY                         │
│  Stores/retrieves ingredients                │
│  (Data access: SQL queries)                  │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│  Database = STORAGE ROOM                     │
└─────────────────────────────────────────────┘
```

### The Problem Service Layer Solves

**Without Service Layer (Bad):**
```typescript
// Controller doing everything
app.post('/register', async (req, res) => {
  // Validation
  if (!req.body.email) return res.status(400).json({...});
  
  // Business logic
  const exists = await userRepo.existsByEmail(req.body.email);
  if (exists) return res.status(409).json({...});
  
  // Password hashing
  const hash = await bcrypt.hash(req.body.password, 10);
  
  // Database
  const user = await userRepo.create({...});
  
  // Logging
  logger.info('User created', {userId: user.id});
  
  res.json(user);
});
```

**Problems:**
1. Controller is fat (100+ lines)
2. Business logic duplicated across multiple endpoints
3. Can't unit test without mocking HTTP
4. Violates Single Responsibility Principle

**With Service Layer (Good):**
```typescript
// Controller: Thin, only HTTP concerns
app.post('/register', async (req, res) => {
  const user = await userService.createUser(req.body);
  res.status(201).json(user);
});

// Service: Fat, all business logic
class UserService {
  async createUser(data) {
    // Validation
    this.validatePasswordStrength(data.password);
    
    // Business rule: email uniqueness
    const exists = await this.repo.existsByEmail(data.email);
    if (exists) throw new ConflictError('Email taken');
    
    // Hash password
    const hash = await hashPassword(data.password);
    
    // Save
    const user = await this.repo.create({...data, passwordHash: hash});
    
    // Logging
    logger.info('User created', {userId: user.id});
    
    return user;
  }
}
```

### Service Layer Responsibilities

✅ **What Service Layer DOES:**
1. **Validation:** Input validation, business rule enforcement
2. **Orchestration:** Coordinate multiple repository calls
3. **Authorization:** Check permissions before operations
4. **Side effects:** Logging, metrics, event emission
5. **Error handling:** Convert database errors to domain errors
6. **Business logic:** Password hashing, email verification

❌ **What Service Layer DOES NOT DO:**
1. HTTP handling (controller's job)
2. SQL queries (repository's job)
3. JSON parsing (middleware's job)
4. Response formatting (controller's job)

---

## 🔍 Part 2: Line-by-Line Code Analysis

### Section 1: Imports and Interfaces (Lines 1-32)

```typescript
1  /**
2   * User Service - Business logic for user management
3   * All user operations go through this layer
4   */
5
6  import { User } from '../models/User';
7  import { UserRepository, CreateUserData, UpdateUserData } from '../repositories/user.repository';
8  import { hashPassword, comparePassword, validatePasswordStrength } from '../utils/password';
9  import { NotFoundError, ValidationError, UnauthorizedError, ConflictError } from '../../../../shared/errors';
10 import logger from '../../../../shared/logger';
```

**Line 6:** Import domain model
- `User`: The clean camelCase model for business logic

**Line 7:** Import repository and DTOs
- `UserRepository`: Data access layer
- `CreateUserData`, `UpdateUserData`: Input shapes

**Line 8:** Import password utilities
- `hashPassword()`: bcrypt hashing (cost factor 10)
- `comparePassword()`: bcrypt comparison
- `validatePasswordStrength()`: Password policy enforcement

**Line 9:** Import custom error classes
- `NotFoundError`: HTTP 404
- `ValidationError`: HTTP 400
- `UnauthorizedError`: HTTP 401
- `ConflictError`: HTTP 409

**Why custom errors?**
```typescript
// Without custom errors
throw new Error('User not found'); // Generic 500 error

// With custom errors
throw new NotFoundError('User not found'); // Proper 404 response
```

**Line 10:** Import logger
- Winston logger from shared utilities
- Structured logging with metadata

```typescript
12 interface RegisterUserData {
13   email: string;
14   password: string;
15   firstName: string;
16   lastName: string;
17 }
```

**Lines 12-17:** Input DTO for registration
- Includes plaintext `password` (service will hash it)
- Does NOT include `role` (defaults to 'customer' for security)

**Why separate from `CreateUserData`?**
```typescript
// RegisterUserData: What users provide
{ email, password, firstName, lastName }

// CreateUserData: What repository expects
{ email, passwordHash, firstName, lastName, role? }

// Service transforms between them
```

```typescript
19 interface ChangePasswordData {
20   userId: number;
21   currentPassword: string;
22   newPassword: string;
23 }
```

**Lines 19-23:** Input for password change operation
- `currentPassword`: Must verify before allowing change
- `newPassword`: Will be validated and hashed

```typescript
25 interface ValidateCredentialsResult {
26   id: number;
27   email: string;
28   role: string;
29   firstName: string | null;
30   lastName: string | null;
31 }
```

**Lines 25-31:** Return shape for login validation
- Used by auth controller to generate JWT
- `| null` for optional fields (firstName, lastName might not be set)

**Why not return the full `User` model?**
- Login only needs data for JWT payload
- Smaller surface area = more secure
- JWT payload should be minimal (token size matters)

---

### Section 2: Constructor and Dependency Injection (Lines 33-34)

```typescript
33 export class UserService {
34   constructor(private readonly userRepository: UserRepository) {}
```

**Line 34:** Dependency injection pattern
- `private readonly userRepository`: Injected from outside
- Repository is the ONLY database access point

**Dependency flow:**
```typescript
// In server.ts
const db = getDatabasePool();
const userRepository = new UserRepository(db);
const userService = new UserService(userRepository); // Inject here
const userController = new UserController(userService);
```

**Benefits:**
1. **Testability:** Can inject a mock repository
2. **Loose coupling:** Service doesn't create its own repository
3. **Inversion of Control:** Dependencies managed externally

**Testing example:**
```typescript
// user.service.test.ts
const mockRepo = {
  existsByEmail: jest.fn(),
  create: jest.fn(),
  // ... other methods
} as any;

const service = new UserService(mockRepo);

// Now you can test without a real database
```

---

### Section 3: User Registration (Lines 36-63)

```typescript
36   async createUser(data: RegisterUserData): Promise<User> {
37     const { email, password, firstName, lastName } = data;
```

**Line 36:** Public method for user registration
- `async`: Will perform I/O (database, hashing)
- Returns `Promise<User>` (not null - throws on failure)

**Line 37:** Destructure input

```typescript
39     const passwordValidation = validatePasswordStrength(password);
40     if (!passwordValidation.isValid) {
41       throw new ValidationError('Password validation failed', passwordValidation.errors);
42     }
```

**Lines 39-42:** Password strength validation

**How `validatePasswordStrength()` works:**
```typescript
// In password.ts
validatePasswordStrength('weak') // { isValid: false, errors: ['Must be 8+ chars', ...] }
validatePasswordStrength('Strong@123') // { isValid: true, errors: [] }
```

**Line 41:** Throw `ValidationError` with details
```typescript
// Error contains array of specific issues
{
  statusCode: 400,
  message: 'Password validation failed',
  errors: [
    'Password must be at least 8 characters long',
    'Password must contain at least one uppercase letter',
    'Password must contain at least one special character'
  ]
}
```

**Why validate BEFORE checking database?**
```typescript
// WRONG: Check database first
const exists = await repo.existsByEmail(email); // Slow DB query
validatePassword(password); // Fast validation

// RIGHT: Fast checks first (fail fast principle)
validatePassword(password); // Fast validation
const exists = await repo.existsByEmail(email); // Slow DB query
```

```typescript
44     const emailExists = await this.userRepository.existsByEmail(email);
45     if (emailExists) {
46       throw new ConflictError('User with this email already exists');
47     }
```

**Lines 44-47:** Business rule: email uniqueness
- Repository checks database
- Service enforces the business rule

**Why not rely on database UNIQUE constraint?**
```typescript
// Database will prevent duplicates, but error is generic
await repo.create({email: 'duplicate@example.com', ...});
// Error: "duplicate key value violates unique constraint"
// User sees: "Internal server error" (500)

// With service layer check
const exists = await repo.existsByEmail('duplicate@example.com');
if (exists) throw new ConflictError('Email already exists');
// User sees: "Email already exists" (409)
```

**Both are needed:**
- Service layer: User-friendly error message
- Database constraint: Race condition protection

```typescript
49     const passwordHash = await hashPassword(password);
```

**Line 49:** Hash password with bcrypt
```typescript
// In password.ts
export const hashPassword = async (password: string): Promise<string> => {
  const salt = await bcrypt.genSalt(10); // Cost factor 10
  return bcrypt.hash(password, salt);
};
```

**Cost factor 10 explained:**
- bcrypt work factor: 2^10 = 1024 iterations
- Takes ~100-200ms on modern hardware
- Good balance: Slow enough for security, fast enough for UX

**Why async?**
- bcrypt is CPU-intensive
- Node.js uses thread pool for crypto operations
- Prevents blocking event loop

```typescript
50     const user = await this.userRepository.create({
51       email,
52       passwordHash,
53       firstName,
54       lastName
55     });
56
57     if (!user) {
58       throw new Error('Failed to create user');
59     }
```

**Lines 50-59:** Create user in database

**Note the transformation:**
```typescript
// Input to service
{ email, password, firstName, lastName }

// Passed to repository
{ email, passwordHash, firstName, lastName }
// password → passwordHash (service transformed it)
```

**Line 57-59:** Defensive programming
- Repository returns `User | null`
- Service ensures non-null (throws if null)
- Controllers can trust they'll get a User or an error

```typescript
61     logger.info('User created', { userId: user.id, email: user.email });
62     return user;
63   }
```

**Line 61:** Structured logging
```typescript
// Winston output
{
  level: 'info',
  message: 'User created',
  userId: 123,
  email: 'user@example.com',
  timestamp: '2026-08-08T10:30:00.000Z'
}
```

**Why log here instead of repository?**
- Service layer knows the BUSINESS CONTEXT
- Repository just executes queries
- Service knows "this is a user registration"

---

### Section 4: Login Validation (Lines 65-89)

```typescript
65   async validateCredentials(email: string, password: string): Promise<ValidateCredentialsResult> {
66     const userRow = await this.userRepository.findByEmailWithPassword(email);
67     if (!userRow) {
68       throw new UnauthorizedError('Invalid email or password');
69     }
```

**Lines 65-69:** Find user and check existence

**Line 66:** Uses `findByEmailWithPassword()` (returns `UserDatabaseRow` with password hash)

**Line 68:** Security best practice - SAME error for both cases
```typescript
// WRONG: Reveals which accounts exist
if (!userRow) throw new Error('Email not found');
if (!validPassword) throw new Error('Password incorrect');
// Attacker can enumerate valid emails

// RIGHT: Generic message
if (!userRow || !validPassword) throw new Error('Invalid email or password');
// Attacker can't tell if email exists
```

```typescript
71     if (!userRow.is_active) {
72       throw new UnauthorizedError('Account is deactivated');
73     }
```

**Lines 71-73:** Check account status
- Prevents login to deactivated accounts
- Business rule enforced at service layer

**Why check `is_active` separately?**
```typescript
// Could use findActiveByEmail() in repository, but...
// Login needs DIFFERENT error messages:

if (!userRow) {
  throw new UnauthorizedError('Invalid email or password'); // Don't reveal account exists
}
if (!userRow.is_active) {
  throw new UnauthorizedError('Account is deactivated'); // OK to reveal, user already proved they know the email
}
```

```typescript
75     const isPasswordValid = await comparePassword(password, userRow.password_hash);
76     if (!isPasswordValid) {
77       throw new UnauthorizedError('Invalid email or password');
78     }
```

**Lines 75-78:** Verify password with bcrypt

```typescript
// In password.ts
export const comparePassword = async (password: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};
```

**How bcrypt.compare works:**
1. Extract salt from stored hash
2. Hash the plaintext password with that salt
3. Compare in constant-time (prevents timing attacks)

**Why constant-time comparison matters:**
```typescript
// WRONG: Early exit
if (hash[0] !== computed[0]) return false; // Fast when first char differs
if (hash[1] !== computed[1]) return false; // Slower when second char differs
// Attacker can measure timing to guess hash character by character

// RIGHT: Compare full string always (bcrypt does this)
// Same time regardless of how many characters match
```

```typescript
80     logger.info('User credentials validated', { userId: userRow.id, email: userRow.email });
81
82     return {
83       id: userRow.id,
84       email: userRow.email,
85       role: userRow.role,
86       firstName: userRow.first_name,
87       lastName: userRow.last_name
88     };
89   }
```

**Lines 82-88:** Return minimal data for JWT
- Transform database shape (snake_case) to camelCase
- Only include fields needed for JWT payload
- **Does NOT include password_hash** (even though we have it)

**Usage in auth controller:**
```typescript
const userData = await userService.validateCredentials(email, password);
const token = jwt.sign(
  { 
    userId: userData.id, 
    email: userData.email, 
    role: userData.role 
  }, 
  secret, 
  { expiresIn: '15m' }
);
```

---

### Section 5: User Retrieval Methods (Lines 91-113)

```typescript
91   async getUserById(userId: number): Promise<User> {
92     const user = await this.userRepository.findById(userId);
93     if (!user) {
94       throw new NotFoundError('User not found');
95     }
96     return user;
97   }
```

**Lines 91-97:** Get user by ID with error handling

**Why wrap repository call?**
```typescript
// Repository: Returns User | null
const user = await repo.findById(123);
if (!user) { /* handle null */ }

// Service: Returns User or throws
const user = await service.getUserById(123); // Guaranteed User or error
// Controller doesn't need to check null
```

**Benefits:**
1. Consistent error handling
2. Logging opportunity
3. Business rule enforcement (e.g., check permissions)

```typescript
99   async getActiveUserById(userId: number): Promise<User> {
100     const user = await this.userRepository.findActiveById(userId);
101     if (!user) {
102       throw new NotFoundError('User not found or deactivated');
103     }
104     return user;
105   }
```

**Lines 99-105:** Get ACTIVE user only

**When to use `getUserById()` vs `getActiveUserById()`:**
```typescript
// Admin viewing any user (including deactivated)
const user = await service.getUserById(userId);

// User accessing their own profile (must be active)
const user = await service.getActiveUserById(userId);

// Processing payment (must be active)
const user = await service.getActiveUserById(userId);
```

```typescript
107   async getUserByEmail(email: string): Promise<User> {
108     const user = await this.userRepository.findByEmail(email);
109     if (!user) {
110       throw new NotFoundError('User not found');
111     }
112     return user;
113   }
```

**Lines 107-113:** Get user by email

**Usage example:**
```typescript
// Password reset flow
app.post('/forgot-password', async (req, res) => {
  const user = await userService.getUserByEmail(req.body.email);
  const token = generateResetToken(user.id);
  await sendResetEmail(user.email, token);
});
```

---

### Section 6: Profile Update (Lines 115-130)

```typescript
115   async updateProfile(userId: number, updates: UpdateUserData): Promise<User> {
116     if (updates.email) {
117       const emailExists = await this.userRepository.existsByEmailExcludingUser(updates.email, userId);
118       if (emailExists) {
119         throw new ConflictError('Email already in use');
120       }
121     }
```

**Lines 116-121:** Email change validation

**Line 117:** `existsByEmailExcludingUser()` checks if email belongs to ANOTHER user

**Example:**
```typescript
// User 123 wants to change email to 'new@example.com'

// Scenario 1: Email available
await repo.existsByEmailExcludingUser('new@example.com', 123); // false ✅

// Scenario 2: User already has this email (no-op update)
await repo.existsByEmailExcludingUser('current@example.com', 123); // false ✅
// Returns false because email belongs to USER 123 (excluded)

// Scenario 3: Email taken by another user
await repo.existsByEmailExcludingUser('taken@example.com', 123); // true ❌
// Returns true because email belongs to USER 456
```

```typescript
123     const user = await this.userRepository.update(userId, updates);
124     if (!user) {
125       throw new NotFoundError('User not found');
126     }
127
128     logger.info('User profile updated', { userId });
129     return user;
130   }
```

**Lines 123-130:** Perform update and log

**Note what's NOT in this method:**
- ❌ Password update (separate method with special validation)
- ❌ Role update (admin-only operation)
- ❌ Email verification reset (separate concern)

**Separation of concerns:**
```typescript
// Profile update: firstName, lastName, email
updateProfile(userId, { firstName: 'John' });

// Password change: Requires current password verification
changePassword({ userId, currentPassword, newPassword });

// Admin operations: Different service method
adminUpdateUserRole(userId, 'admin');
```

---

### Section 7: Password Change (Lines 132-155)

```typescript
132   async changePassword(data: ChangePasswordData): Promise<boolean> {
133     const { userId, currentPassword, newPassword } = data;
134
135     const passwordValidation = validatePasswordStrength(newPassword);
136     if (!passwordValidation.isValid) {
137       throw new ValidationError('New password validation failed', passwordValidation.errors);
138     }
```

**Lines 135-138:** Validate new password strength
- Must pass same requirements as registration
- Fail fast before database queries

```typescript
140     const userRow = await this.userRepository.findByIdWithPassword(userId);
141     if (!user Row) {
142       throw new NotFoundError('User not found');
143     }
```

**Line 140:** Need `findByIdWithPassword()` to verify current password

```typescript
145     const isPasswordValid = await comparePassword(currentPassword, userRow.password_hash);
146     if (!isPasswordValid) {
147       throw new UnauthorizedError('Current password is incorrect');
148     }
```

**Lines 145-148:** Verify current password

**Why require current password?**
```typescript
// Without current password verification:
// 1. Attacker steals JWT token
// 2. Attacker changes password
// 3. Real user locked out forever

// With current password verification:
// 1. Attacker steals JWT token
// 2. Attacker tries to change password
// 3. Doesn't know current password → blocked ✅
```

**Security consideration:**
- JWT token is NOT sufficient for password change
- Require re-authentication (current password)
- High-sensitivity operations need extra verification

```typescript
150     const passwordHash = await hashPassword(newPassword);
151     await this.userRepository.updatePassword(userId, passwordHash);
152
153     logger.info('User password changed', { userId });
154     return true;
155   }
```

**Lines 150-155:** Hash and save new password

**What's missing here? Token invalidation!**

In production, you'd add:
```typescript
await this.userRepository.updatePassword(userId, passwordHash);

// Invalidate all existing sessions
await blacklist.clearUserTokens(userId);

// User must login again with new password
logger.info('User password changed and sessions invalidated', { userId });
```

---

### Section 8: Email Verification (Lines 157-164)

```typescript
157   async verifyEmail(userId: number): Promise<boolean> {
158     const success = await this.userRepository.updateEmailVerified(userId, true);
159     if (!success) {
160       throw new NotFoundError('User not found');
161     }
162     logger.info('Email verified', { userId });
163     return true;
164   }
```

**Lines 157-164:** Mark email as verified

**Full email verification flow:**
```typescript
// Step 1: User registers
const user = await userService.createUser({...});

// Step 2: Generate verification token
const token = jwt.sign({ userId: user.id, type: 'email_verify' }, secret, { expiresIn: '24h' });

// Step 3: Send email with link
await sendEmail(user.email, `Click: https://app.com/verify?token=${token}`);

// Step 4: User clicks link
app.get('/verify', async (req, res) => {
  const { userId } = jwt.verify(req.query.token, secret);
  await userService.verifyEmail(userId); // ← This method
  res.send('Email verified!');
});
```

**Why track email verification?**
1. Prevent spam registrations (bots can't access email)
2. Compliance (some features require verified email)
3. Account recovery (can't reset password without verified email)

---

### Section 9: Account State Management (Lines 166-182)

```typescript
166   async deactivateAccount(userId: number): Promise<boolean> {
167     const success = await this.userRepository.deactivate(userId);
168     if (!success) {
169       throw new NotFoundError('User not found');
170     }
171     logger.info('Account deactivated', { userId });
172     return true;
173   }
```

**Lines 166-173:** Soft delete user account

**When to deactivate:**
```typescript
// User requests account deletion
app.delete('/account', authenticateUser, async (req, res) => {
  await userService.deactivateAccount(req.userId);
  await blacklist.clearUserTokens(req.userId);
  res.send('Account deactivated');
});

// Admin bans user
app.post('/admin/ban/:userId', authenticateAdmin, async (req, res) => {
  await userService.deactivateAccount(req.params.userId);
  await blacklist.clearUserTokens(req.params.userId);
  res.send('User banned');
});
```

```typescript
175   async activateAccount(userId: number): Promise<boolean> {
176     const success = await this.userRepository.activate(userId);
177     if (!success) {
178       throw new NotFoundError('User not found');
179     }
180     logger.info('Account activated', { userId });
181     return true;
182   }
```

**Lines 175-182:** Reactivate deactivated account

**Reactivation flow:**
```typescript
// User requests reactivation
app.post('/reactivate', async (req, res) => {
  const user = await userService.getUserByEmail(req.body.email);
  
  if (user.isActive) {
    return res.status(400).json({ message: 'Account already active' });
  }
  
  // Send reactivation link to verify email ownership
  const token = jwt.sign({ userId: user.id }, secret, { expiresIn: '1h' });
  await sendEmail(user.email, `Reactivate: https://app.com/reactivate?token=${token}`);
  
  res.send('Check your email');
});

app.get('/reactivate', async (req, res) => {
  const { userId } = jwt.verify(req.query.token, secret);
  await userService.activateAccount(userId);
  res.send('Account reactivated!');
});
```

---

### Section 10: Hard Delete (Lines 184-191)

```typescript
184   async deleteUser(userId: number): Promise<boolean> {
185     const success = await this.userRepository.delete(userId);
186     if (!success) {
187       throw new NotFoundError('User not found');
188     }
189     logger.warn('User permanently deleted', { userId });
190     return true;
191   }
```

**Lines 184-191:** Permanent deletion (GDPR)

**Line 189:** Uses `logger.warn()` not `logger.info()`
- Hard delete is DANGEROUS
- Warn level for audit/alerting

**GDPR "Right to be Forgotten" implementation:**
```typescript
async handleGDPRDeletion(userId: number) {
  // 1. Check for dependencies
  const hasOrders = await orderRepo.existsByUserId(userId);
  
  if (hasOrders) {
    // Can't hard delete (foreign keys)
    // Anonymize instead
    await this.updateProfile(userId, {
      email: `deleted-${userId}@anonymized.local`,
      firstName: '[Deleted]',
      lastName: '[User]'
    });
    await this.deactivateAccount(userId);
    logger.warn('User anonymized (had orders)', { userId });
  } else {
    // No dependencies, safe to hard delete
    await this.deleteUser(userId);
    logger.warn('User hard deleted (GDPR)', { userId });
  }
  
  // Invalidate all sessions
  await blacklist.clearUserTokens(userId);
}
```

---

### Section 11: Bulk Operations (Lines 193-209)

```typescript
193   async getUsersById(userIds: number[]): Promise<User[]> {
194     if (userIds.length === 0) {
195       return [];
196     }
```

**Lines 194-196:** Early return for empty array
- Avoids unnecessary database queries
- Common pattern for bulk operations

```typescript
197     if (userIds.length > 100) {
198       throw new ValidationError('Maximum 100 users per bulk request');
199     }
```

**Lines 197-199:** Rate limiting bulk operations

**Why limit to 100?**
1. **Performance:** 100 individual queries might take 1-2 seconds
2. **Memory:** 100 User objects is manageable
3. **Abuse prevention:** Prevents scraping entire user database

**Better implementation in production:**
```typescript
async getUsersById(userIds: number[]): Promise<User[]> {
  if (userIds.length === 0) return [];
  if (userIds.length > 100) {
    throw new ValidationError('Maximum 100 users per bulk request');
  }

  // Deduplicate IDs
  const uniqueIds = [...new Set(userIds)];

  // Single query instead of N queries
  const result = await this.userRepository.db.query<UserDatabaseRow>(
    'SELECT * FROM users WHERE id = ANY($1)',
    [uniqueIds]
  );

  return User.fromDatabaseArray(result.rows);
}
```

```typescript
201     const users: User[] = [];
202     for (const id of userIds) {
203       const user = await this.userRepository.findById(id);
204       if (user) {
205         users.push(user);
206       }
207     }
208     return users;
209   }
```

**Lines 201-209:** Sequential queries (N+1 problem)

**Performance issue:**
```typescript
// Current implementation: N queries
getUsersById([1, 2, 3, 4, 5]);
// Query 1: SELECT * FROM users WHERE id = 1
// Query 2: SELECT * FROM users WHERE id = 2
// Query 3: SELECT * FROM users WHERE id = 3
// Query 4: SELECT * FROM users WHERE id = 4
// Query 5: SELECT * FROM users WHERE id = 5
// Total: 5 round trips (500ms if 100ms per query)

// Optimized: 1 query
// SELECT * FROM users WHERE id IN (1, 2, 3, 4, 5)
// Total: 1 round trip (100ms)
```

**When N+1 is acceptable:**
- N is small (< 10)
- Queries are cached
- Simpler code is worth the cost

**When N+1 is NOT acceptable:**
- N is large (> 100)
- High throughput endpoints
- Production critical paths

---

## 🏗️ Part 3: Service Layer in the Architecture

### Request Flow Through All Layers

```
┌─────────────────────────────────────────────────────┐
│ HTTP Request: POST /api/auth/register               │
│ Body: { email, password, firstName, lastName }      │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ Middleware: Express JSON parser                      │
│ - Parse JSON body                                    │
│ - Attach to req.body                                 │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ Middleware: Request validation (optional)            │
│ - Check required fields                              │
│ - Validate email format                              │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ Controller: user.controller.ts                       │
│ - Extract req.body                                   │
│ - Call service.createUser()                          │
│ - Format response                                    │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ Service: user.service.ts ← WE ARE HERE               │
│ ✓ Validate password strength                         │
│ ✓ Check email uniqueness                             │
│ ✓ Hash password                                      │
│ ✓ Call repository.create()                           │
│ ✓ Log success                                        │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ Repository: user.repository.ts                       │
│ - Build SQL INSERT query                             │
│ - Execute with parameterized values                  │
│ - Transform result to User model                     │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ Database: PostgreSQL users table                     │
└─────────────────────────────────────────────────────┘
```

### Error Flow

```
┌─────────────────────────────────────────────────────┐
│ Service throws ValidationError                       │
│ throw new ValidationError('Password too weak')       │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ Controller catches error                             │
│ try { await service.createUser() }                   │
│ catch (err) { next(err) }                            │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│ Error handler middleware                             │
│ if (err instanceof ValidationError) {                │
│   res.status(err.statusCode).json(...)               │
│ }                                                    │
└─────────────────────────────────────────────────────┘
```

---

## 🎯 Part 4: Interview Questions & Answers

### Q1: What is the Service Layer and why do we need it?
**Answer:** The Service Layer contains business logic and orchestrates operations between controllers and repositories.

**Why needed:**
1. **Separation of Concerns:** HTTP handling (controller) vs business rules (service) vs data access (repository)
2. **Reusability:** Same service method used by HTTP API, GraphQL, CLI
3. **Testability:** Test business logic without mocking HTTP
4. **Single Responsibility:** Each layer has one job

**Example:**
```typescript
// Controller: Thin, only HTTP
app.post('/register', async (req, res) => {
  const user = await userService.createUser(req.body);
  res.status(201).json(user);
});

// Service: Fat, all business logic
async createUser(data) {
  validatePassword(data.password);
  checkEmailUnique(data.email);
  hashPassword(data.password);
  saveToDatabase(data);
}
```

### Q2: Why does `validateCredentials()` use the same error message for "email not found" and "wrong password"?
**Answer:** **Security best practice** to prevent account enumeration.

```typescript
// WRONG: Reveals which accounts exist
if (!user) throw new Error('Email not found');
if (!validPassword) throw new Error('Wrong password');
// Attacker tries random emails until they get "Wrong password" → valid account found

// RIGHT: Generic message
if (!user || !validPassword) throw new Error('Invalid email or password');
// Attacker can't tell if account exists
```

This prevents attackers from building a list of valid email addresses to target.

### Q3: Why require current password when changing password?
**Answer:** **JWT tokens alone aren't sufficient for high-sensitivity operations.**

**Scenario without current password:**
1. Attacker steals JWT token (XSS, network sniffing, etc.)
2. Attacker changes password using stolen token
3. Real user locked out permanently

**Scenario with current password:**
1. Attacker steals JWT token
2. Attacker tries to change password
3. Doesn't know current password → **blocked** ✅

High-sensitivity operations (password change, account deletion, adding payment method) should require re-authentication.

### Q4: What's the difference between `getUserById()` and `getActiveUserById()`?
**Answer:**
- `getUserById()`: Returns user regardless of `is_active` status
- `getActiveUserById()`: Returns ONLY if `is_active = true`

**When to use each:**
```typescript
// Admin viewing any user profile
const user = await service.getUserById(userId);

// User accessing features (must be active)
const user = await service.getActiveUserById(userId);

// Processing payment (must be active)
const user = await service.getActiveUserById(userId);
```

### Q5: Why validate password strength before checking database?
**Answer:** **Fail fast principle** - cheap validations before expensive operations.

```typescript
// WRONG: Slow operation first
const exists = await repo.existsByEmail(email); // 50ms database query
validatePassword(password); // 1ms validation

// RIGHT: Fast checks first
validatePassword(password); // 1ms validation
const exists = await repo.existsByEmail(email); // 50ms database query
```

If password is weak, no point checking database. Saves database load and improves response time.

### Q6: What's the N+1 query problem in `getUsersById()`?
**Answer:** Sequential queries instead of batch query.

```typescript
// N+1 problem (current implementation)
for (const id of [1,2,3]) {
  await repo.findById(id); // 3 separate queries
}
// SELECT * FROM users WHERE id = 1
// SELECT * FROM users WHERE id = 2
// SELECT * FROM users WHERE id = 3

// Solution: Batch query
await db.query('SELECT * FROM users WHERE id = ANY($1)', [[1,2,3]]);
// 1 query instead of 3
```

**Impact:** With 100 IDs and 100ms latency per query, N+1 takes 10 seconds vs batch query takes 100ms.

### Q7: Why do service methods throw errors instead of returning null?
**Answer:** **Explicit error handling** and **type safety**.

```typescript
// With null returns (repository pattern)
const user = await repo.findById(123);
if (!user) { /* handle null everywhere */ }

// With thrown errors (service pattern)
const user = await service.getUserById(123); // Guaranteed User or error
// No null checks needed, TypeScript knows it's never null
```

Benefits:
1. Controllers don't need null checks
2. Errors are explicit (404, 401, etc.)
3. Better error messages for users

### Q8: How would you add transaction support to this service?
**Answer:**
```typescript
export class UserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly db: DatabasePool
  ) {}

  async createUserWithProfile(userData: RegisterUserData, profileData: ProfileData) {
    const transaction = await this.db.beginTransaction();
    
    try {
      // Both operations in same transaction
      const userRepo = new UserRepository(transaction);
      const user = await this.createUser(userData); // Uses transaction
      
      await profileRepo.create({ userId: user.id, ...profileData });
      
      await transaction.commit();
      return user;
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }
}
```

### Q9: Why hash passwords in the service layer instead of repository?
**Answer:** **Business logic vs data access separation**.

**Repository responsibility:** Store and retrieve data
```typescript
// Repository: Just save the hash
create(data: { passwordHash: string }) {
  // INSERT INTO users (password_hash) VALUES ($1)
}
```

**Service responsibility:** Enforce business rules
```typescript
// Service: Hash before saving
async createUser(data: { password: string }) {
  const passwordHash = await hashPassword(data.password); // Business logic
  return this.repo.create({ ...data, passwordHash });
}
```

If hashing was in repository:
- ❌ Repository knows about password requirements (wrong layer)
- ❌ Can't reuse repository for bulk imports with pre-hashed passwords
- ❌ Testing is harder (need to mock bcrypt in repository tests)

### Q10: How would you implement "forgot password" with this service?
**Answer:**
```typescript
async requestPasswordReset(email: string): Promise<void> {
  // Use getUserByEmail (throws if not found)
  const user = await this.getUserByEmail(email);
  
  // Generate reset token (JWT with short expiry)
  const resetToken = jwt.sign(
    { userId: user.id, type: 'password_reset' },
    process.env.RESET_SECRET!,
    { expiresIn: '1h' }
  );
  
  // Send email with reset link
  await sendEmail(user.email, {
    subject: 'Password Reset Request',
    body: `Reset your password: https://app.com/reset?token=${resetToken}`
  });
  
  logger.info('Password reset requested', { userId: user.id });
}

async resetPassword(resetToken: string, newPassword: string): Promise<void> {
  // Verify token
  const payload = jwt.verify(resetToken, process.env.RESET_SECRET!);
  if (payload.type !== 'password_reset') {
    throw new UnauthorizedError('Invalid reset token');
  }
  
  // Validate new password
  const validation = validatePasswordStrength(newPassword);
  if (!validation.isValid) {
    throw new ValidationError('Password too weak', validation.errors);
  }
  
  // Update password
  const passwordHash = await hashPassword(newPassword);
  await this.userRepository.updatePassword(payload.userId, passwordHash);
  
  // Invalidate all sessions
  await blacklist.clearUserTokens(payload.userId);
  
  logger.info('Password reset completed', { userId: payload.userId });
}
```

### Q11: How do you handle race conditions in `createUser()`?
**Answer:** **Both service layer check AND database constraint.**

```typescript
// Service layer: User-friendly error
const exists = await repo.existsByEmail(email);
if (exists) throw new ConflictError('Email already exists');

// Database: Prevents race condition
CREATE UNIQUE INDEX idx_users_email ON users(email);
```

**Race condition scenario:**
```
Time  Request A              Request B
─────────────────────────────────────────
t1    Check email available  
t2                           Check email available
t3    Both see "available"   Both see "available"
t4    Insert user            
t5                           Insert user (FAILS due to UNIQUE constraint)
```

Service check provides UX, database constraint provides safety.

### Q12: Why use dependency injection in the constructor?
**Answer:** **Testability and flexibility.**

```typescript
// With DI (current)
class UserService {
  constructor(private readonly repo: UserRepository) {}
}

// Test with mock
const mockRepo = { create: jest.fn(), ... };
const service = new UserService(mockRepo);
// Easy to test without database

// Without DI (bad)
class UserService {
  private repo = new UserRepository(getPool());
}
// Hard to test, always needs real database
```

Benefits:
1. Unit test without database
2. Swap implementations (in-memory for dev, Postgres for prod)
3. Clear dependencies (visible in constructor)

### Q13: How would you add caching to this service?
**Answer:**
```typescript
export class UserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly cache: RedisClient
  ) {}

  async getUserById(userId: number): Promise<User> {
    // Check cache first
    const cacheKey = `user:${userId}`;
    const cached = await this.cache.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }
    
    // Cache miss, get from database
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    
    // Store in cache for 5 minutes
    await this.cache.setex(cacheKey, 300, JSON.stringify(user));
    
    return user;
  }

  async updateProfile(userId: number, updates: UpdateUserData): Promise<User> {
    const user = await this.userRepository.update(userId, updates);
    
    // Invalidate cache
    await this.cache.del(`user:${userId}`);
    
    return user;
  }
}
```

### Q14: What's the problem with logging in `createUser()` and how would you improve it?
**Answer:** **Security: logs contain PII (email).**

```typescript
// Current (logs PII)
logger.info('User created', { userId: user.id, email: user.email });

// Better: Hash or redact PII
logger.info('User created', { 
  userId: user.id, 
  emailHash: sha256(user.email).substring(0, 8) 
});

// Or: Separate PII-safe logs
logger.info('User created', { userId: user.id });
auditLog.info('User created', { userId: user.id, email: user.email }); // Secure storage
```

Consider:
1. GDPR compliance (PII in logs must be deletable)
2. Log aggregation services (don't send PII to third parties)
3. Access control (who can read logs?)

### Q15: How would you implement role-based access control in this service?
**Answer:**
```typescript
export class UserService {
  async updateUserRole(adminUserId: number, targetUserId: number, newRole: string): Promise<User> {
    // Check admin has permission
    const admin = await this.getUserById(adminUserId);
    if (!admin.isAdmin()) {
      throw new ForbiddenError('Only admins can change roles');
    }
    
    // Get target user
    const target = await this.getUserById(targetUserId);
    
    // Business rule: Can't demote yourself
    if (adminUserId === targetUserId && newRole !== 'admin') {
      throw new ValidationError('Cannot demote yourself');
    }
    
    // Business rule: Must be valid role
    if (!['customer', 'vendor', 'admin'].includes(newRole)) {
      throw new ValidationError('Invalid role');
    }
    
    // Update role
    const updated = await this.userRepository.update(targetUserId, { role: newRole });
    
    // Invalidate sessions (permissions changed)
    await blacklist.clearUserTokens(targetUserId);
    
    logger.info('User role changed', { 
      adminId: adminUserId, 
      targetId: targetUserId, 
      newRole 
    });
    
    return updated;
  }
}
```

---

## 💡 Part 5: Production Considerations

### 1. Rate Limiting

```typescript
export class UserService {
  private readonly rateLimiter: RateLimiter;

  async createUser(data: RegisterUserData, ip: string): Promise<User> {
    // Rate limit registrations per IP
    const allowed = await this.rateLimiter.checkLimit(
      `register:${ip}`,
      5, // Max 5 registrations
      3600 // Per hour
    );
    
    if (!allowed) {
      throw new TooManyRequestsError('Registration limit exceeded');
    }
    
    // ... existing logic
  }
}
```

### 2. Distributed Locks

```typescript
async changePassword(data: ChangePasswordData): Promise<boolean> {
  const lockKey = `password_change:${data.userId}`;
  const lock = await acquireLock(lockKey, 10000); // 10s timeout
  
  try {
    // ... password change logic
  } finally {
    await lock.release();
  }
}
```

**Why needed:**
- Prevents concurrent password changes
- Avoids race conditions with token invalidation

### 3. Idempotency

```typescript
async verifyEmail(userId: number, idempotencyKey: string): Promise<boolean> {
  // Check if already processed
  const processed = await this.cache.get(`idempotency:${idempotencyKey}`);
  if (processed) {
    return JSON.parse(processed);
  }
  
  // Process
  const success = await this.userRepository.updateEmailVerified(userId, true);
  
  // Store result for 24 hours
  await this.cache.setex(`idempotency:${idempotencyKey}`, 86400, JSON.stringify(success));
  
  return success;
}
```

### 4. Async Operations

```typescript
async createUser(data: RegisterUserData): Promise<User> {
  const user = await this.userRepository.create({...});
  
  // Don't block response on email sending
  this.sendWelcomeEmail(user.email).catch(err => {
    logger.error('Failed to send welcome email', { userId: user.id, error: err });
  });
  
  return user;
}

private async sendWelcomeEmail(email: string): Promise<void> {
  // Send welcome email asynchronously
}
```

### 5. Metrics

```typescript
import { metrics } from '../lib/metrics';

async validateCredentials(email: string, password: string): Promise<ValidateCredentialsResult> {
  const start = Date.now();
  
  try {
    const result = await this.performValidation(email, password);
    
    metrics.histogram('user_login_duration_ms', Date.now() - start);
    metrics.increment('user_login_success');
    
    return result;
  } catch (err) {
    metrics.increment('user_login_failed', { reason: err.constructor.name });
    throw err;
  }
}
```

### 6. Circuit Breaker for External Services

```typescript
async createUser(data: RegisterUserData): Promise<User> {
  const user = await this.userRepository.create({...});
  
  try {
    // External service with circuit breaker
    await this.circuitBreaker.execute(
      () => this.notificationService.sendWelcomeEmail(user.email)
    );
  } catch (err) {
    // Log but don't fail user creation
    logger.error('Welcome email circuit open', { userId: user.id });
  }
  
  return user;
}
```

---

## ⚡ Part 6: Real-World Scenarios

### Scenario 1: Complete Registration Flow

```typescript
// Controller
app.post('/auth/register', async (req, res) => {
  const user = await userService.createUser(req.body);
  
  // Generate verification token
  const verifyToken = jwt.sign(
    { userId: user.id, type: 'email_verify' },
    secret,
    { expiresIn: '24h' }
  );
  
  // Send verification email (async)
  await emailService.sendVerificationEmail(user.email, verifyToken);
  
  res.status(201).json({
    user: user.toJSON(),
    message: 'Registration successful. Please check your email to verify your account.'
  });
});
```

### Scenario 2: Complete Login Flow

```typescript
// Controller
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  
  // Validate credentials
  const userData = await userService.validateCredentials(email, password);
  
  // Generate tokens
  const accessToken = jwt.sign(
    { userId: userData.id, email: userData.email, role: userData.role },
    process.env.JWT_SECRET!,
    { expiresIn: '15m' }
  );
  
  const refreshToken = jwt.sign(
    { userId: userData.id, jti: uuidv4() },
    process.env.REFRESH_SECRET!,
    { expiresIn: '7d' }
  );
  
  res.json({ accessToken, refreshToken, user: userData });
});
```

### Scenario 3: Profile Update with Email Change

```typescript
app.put('/profile', authenticateUser, async (req, res) => {
  const updates = req.body;
  
  // If email is changing, require email verification
  if (updates.email) {
    const user = await userService.getUserById(req.userId);
    
    if (updates.email !== user.email) {
      // Update email
      await userService.updateProfile(req.userId, { email: updates.email });
      
      // Mark as unverified
      await userService.updateEmailVerified(req.userId, false);
      
      // Send verification to NEW email
      const token = jwt.sign({ userId: req.userId }, secret, { expiresIn: '24h' });
      await emailService.sendVerificationEmail(updates.email, token);
      
      return res.json({ 
        message: 'Email updated. Please verify your new email address.' 
      });
    }
  }
  
  // Other updates
  const user = await userService.updateProfile(req.userId, updates);
  res.json(user.toJSON());
});
```

### Scenario 4: Account Deletion with Cleanup

```typescript
app.delete('/account', authenticateUser, async (req, res) => {
  const userId = req.userId;
  
  // Check for dependencies
  const hasActiveOrders = await orderService.hasActiveOrders(userId);
  if (hasActiveOrders) {
    return res.status(400).json({
      message: 'Cannot delete account with active orders. Please cancel or complete them first.'
    });
  }
  
  // Soft delete
  await userService.deactivateAccount(userId);
  
  // Invalidate all sessions
  await blacklist.clearUserTokens(userId);
  
  // Schedule hard delete after 30 days
  await scheduleTask({
    type: 'hard_delete_user',
    userId,
    executeAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  });
  
  res.json({ 
    message: 'Account deactivated. Data will be permanently deleted in 30 days.' 
  });
});
```

---

## 📝 Summary

### Key Takeaways

1. **Service Layer** = Business logic between controller and repository
2. **Dependency Injection** enables testability and flexibility
3. **Fail Fast** = Validate cheap operations before expensive ones
4. **Security** = Same error message for login failures (prevent enumeration)
5. **Re-authentication** = High-sensitivity operations need current password
6. **Separation of Concerns** = Password hashing in service, not repository
7. **Error Handling** = Throw specific errors (NotFoundError, ValidationError, etc.)
8. **Logging** = Service layer knows business context

### Interview Readiness

You can now confidently explain:
- ✅ What the Service Layer is and its responsibilities
- ✅ Why we need three layers (Controller/Service/Repository)
- ✅ How to handle authentication securely
- ✅ Why dependency injection matters
- ✅ How to structure business logic
- ✅ N+1 query problem and solutions
- ✅ Production patterns (rate limiting, caching, metrics)

### Next Steps

- **M17:** Study `user.controller.ts` (HTTP request/response handling)
- **M18-M20:** End-to-end flows (registration, login, token refresh)

---

**Module 16 Complete!** 🎉  
You now understand the Service Layer and how to implement business logic for MAANG-level interviews.
