/**
 * ESLint Configuration for TypeScript
 *
 * MAANG Interview: Why ESLint?
 * "ESLint catches bugs that TypeScript doesn't:
 *  - Unused variables (dead code)
 *  - Console.logs left in production
 *  - Missing error handling
 *  - Implicit 'any' types
 *  - Non-null assertions (dangerous)"
 *
 * Q: What's the difference between ESLint and TypeScript?
 * A: TypeScript = Type checker (catches type errors)
 *    ESLint = Code quality tool (catches logic errors, style issues)
 *
 * Example:
 *   function divide(a: number, b: number) {
 *     return a / b;  // TypeScript: ✅ (types are correct)
 *   }                // ESLint: ⚠️ (no zero-division check!)
 */

module.exports = {
  root: true,  // Stop ESLint from looking in parent directories

  // Parser: Tells ESLint how to understand TypeScript
  // Q: Why @typescript-eslint/parser?
  // A: Default ESLint parser only understands JavaScript.
  //    TypeScript has syntax JavaScript doesn't (interfaces, generics, etc.)
  parser: '@typescript-eslint/parser',

  parserOptions: {
    ecmaVersion: 2022,        // Modern JS features (async/await, optional chaining)
    sourceType: 'module',     // Use ES modules (import/export)
    project: './tsconfig.json' // TypeScript config for type-aware linting
    // Q: What's type-aware linting?
    // A: ESLint can use TypeScript's type system to find bugs:
    //    - no-floating-promises: await missing on async function
    //    - no-misused-promises: Promise used in if statement
    //    - These rules need the TypeScript compiler (project: tsconfig.json)
  },

  // Extends: Pre-configured rule sets
  extends: [
    'eslint:recommended',  // ESLint's recommended rules
    'plugin:@typescript-eslint/recommended',  // TypeScript basics
    'plugin:@typescript-eslint/recommended-requiring-type-checking',  // Type-aware rules
    'prettier'  // Turns OFF ESLint formatting rules (Prettier handles them)
  ],
  // Q: Why include 'prettier' at the END?
  // A: Order matters! 'prettier' disables formatting rules from previous extends.
  //    If 'prettier' was first, other extends would re-enable formatting rules.

  plugins: ['@typescript-eslint'],

  // Custom rules
  rules: {
    /* ============================================
     * TypeScript-Specific Rules
     * ============================================ */

    // Ban unused variables
    '@typescript-eslint/no-unused-vars': ['error', {
      argsIgnorePattern: '^_'  // Allow _unused parameters (convention)
    }],
    // Q: Why allow _unused?
    // A: Express middleware requires 4 parameters:
    //    (err, req, res, _next) => { ... }
    //    We need _next for type signature but don't use it.
    // Interview Tip: "I use _ prefix for intentionally unused parameters"

    // Require explicit return types on functions
    '@typescript-eslint/explicit-function-return-type': 'warn',
    // Q: Why warn instead of error?
    // A: Small functions are obvious:
    //    const add = (a: number, b: number) => a + b;  // Clearly returns number
    //    Warn = Developer can override if obvious, but CI reminds them.
    // Interview Tip: "I use explicit return types for documentation and
    //                 catching mistakes (intended User, returned User | null)"

    // Ban 'any' type
    '@typescript-eslint/no-explicit-any': 'error',
    // Q: Why ban 'any'?
    // A: 'any' defeats TypeScript's purpose:
    //    function bad(data: any) { return data.name; }  // No error if data has no name!
    //    function good(data: User) { return data.name; } // Type-safe!
    // Interview Tip: "I ban 'any' - if you MUST use it, use 'unknown' and
    //                 narrow with type guards"

    // Ban non-null assertions (!)
    '@typescript-eslint/no-non-null-assertion': 'error',
    // Q: What's a non-null assertion?
    // A: user.email! = "I PROMISE email exists, TypeScript trust me"
    //    Dangerous! If email is null, runtime crash.
    // Better:
    //    if (user.email) { use(user.email); }  // Type-safe check
    // Interview Tip: "I ban ! operator - it's a way to lie to TypeScript"

    // Require await in async functions
    '@typescript-eslint/require-await': 'warn',
    // Q: Why warn if async function has no await?
    // A: Probably a mistake:
    //    async function getUser(id) {  // Returns Promise for no reason
    //      return db.query(...);       // Forgot 'await' here!
    //    }
    // Should be:
    //    function getUser(id) { ... }  // Remove 'async' if no 'await'

    // Consistent type imports
    '@typescript-eslint/consistent-type-imports': ['error', {
      prefer: 'type-imports'
    }],
    // Q: What are type imports?
    // A: import type { User } from './User';  // Only used for types
    //    import { createUser } from './User'; // Used at runtime
    // Why separate?
    // - Bundle size: Type imports are removed at compile-time
    // - Clear intent: Obvious what's used where
    // Interview Tip: "I use 'import type' for types only - keeps runtime
    //                 bundle smaller (types are erased at compile-time)"

    /* ============================================
     * General JavaScript/Node.js Rules
     * ============================================ */

    // Warn on console.log (should use logger instead)
    'no-console': ['warn', {
      allow: ['warn', 'error']  // console.warn and console.error are OK
    }],
    // Q: Why ban console.log?
    // A: Production issues:
    //    - console.log blocks event loop (synchronous)
    //    - No log levels (can't filter)
    //    - Hard to search/aggregate logs
    // Use logger instead:
    //    logger.info('User logged in', { userId, ip });  // Structured logging

    // Require const instead of let when possible
    'prefer-const': 'error',
    // Q: Why prefer const?
    // A: Immutability signals intent:
    //    let user = getUser();  // Might reassign later?
    //    const user = getUser(); // Never reassigned, easier to reason about

    // Ban 'var' (use let/const)
    'no-var': 'error',
    // Q: Why ban var?
    // A: 'var' has function scope (confusing):
    //    if (true) { var x = 1; }
    //    console.log(x);  // Works! (hoisted to function scope)
    //    'let/const' have block scope (expected behavior)

    // Require === instead of ==
    'eqeqeq': ['error', 'always'],
    // Q: Why ban ==?
    // A: Type coercion surprises:
    //    0 == '0'   // true (wat?)
    //    0 === '0'  // false (expected)
    // Interview Tip: "I always use === to avoid JavaScript's type coercion"

    // Require curly braces for all control statements
    'curly': ['error', 'all'],
    // Q: Why require braces?
    // A: Prevents bugs:
    //    if (user)
    //      delete user.password;
    //      return user;  // ALWAYS executes! (not in 'if')
    //    Should be:
    //    if (user) {
    //      delete user.password;
    //      return user;
    //    }

    // Ban == null (use === null)
    'no-eq-null': 'error',

    // Ban implicit type coercion
    'no-implicit-coercion': 'error',
    // Examples:
    //   !!value     // Bad: Coerce to boolean
    //   +strNum     // Bad: Coerce to number
    //   Boolean(value) // Good: Explicit
    //   Number(strNum) // Good: Explicit

    // Require return in Array methods
    'array-callback-return': 'error',
    // Bug example:
    //   const ids = users.map(user => { user.id });  // Missing 'return'!
    //   // Result: [undefined, undefined, ...]
    // Should be:
    //   const ids = users.map(user => user.id);  // Implicit return

    // Ban alert/confirm/prompt
    'no-alert': 'error',
    // Q: Why ban alert?
    // A: Server-side code (no window.alert).
    //    If it appears, probably a mistake from client-side code.

    // Ban eval (security risk)
    'no-eval': 'error',
    // Q: Why ban eval?
    // A: Code injection vulnerability:
    //    eval(userInput);  // User sends: "require('fs').readFileSync('/etc/passwd')"
    // Interview Tip: "eval is a security risk - never use it in production"
  },

  // Environment: Global variables available
  env: {
    node: true,   // Node.js globals (process, __dirname, etc.)
    es2022: true, // ES2022 globals
    jest: true    // Jest globals (describe, it, expect, etc.)
  },

  // Ignore patterns
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'build/',
    'coverage/',
    '*.min.js'
  ]
};

/**
 * MAANG Interview Talking Points:
 *
 * Q: Why ESLint AND TypeScript?
 * A: "TypeScript catches type errors. ESLint catches logic errors and
 *     enforces best practices. Example: TypeScript won't catch division
 *     by zero, but ESLint can warn about it."
 *
 * Q: How do you handle ESLint disagreements in team?
 * A: "We vote on rules, document WHY in comments, and use 'warn' for
 *     contentious rules. Example: Some devs prefer explicit return types,
 *     others find them verbose. We use 'warn' so it reminds but doesn't block."
 *
 * Q: What's your opinion on no-console rule?
 * A: "I warn on console.log but allow console.error. In production, we use
 *     structured logging (Winston, Pino) for aggregation and search. Console
 *     statements should be caught in code review."
 *
 * Q: How would you enforce ESLint in a large team?
 * A: "Three layers:
 *     1. Pre-commit hooks (Husky) - Block bad code locally
 *     2. CI pipeline - Block bad PRs
 *     3. Editor integration (VSCode) - Show errors while typing
 *     This way, issues are caught BEFORE code review."
 *
 * Q: What ESLint plugins would you add for production?
 * A: "Depends on tech stack:
 *     - eslint-plugin-security (security vulnerabilities)
 *     - eslint-plugin-promise (promise handling)
 *     - eslint-plugin-import (import/export best practices)
 *     - eslint-plugin-jest (Jest best practices)"
 */
