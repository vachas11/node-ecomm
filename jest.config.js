/**
 * Jest Configuration for TypeScript Monorepo
 *
 * MAANG Interview: Why Jest?
 * "Jest is the industry standard for Node.js testing:
 *  - Zero config for most cases
 *  - Built-in coverage, mocking, snapshots
 *  - Fast parallel execution
 *  - Great TypeScript support via ts-jest"
 *
 * Q: What's the difference between unit and integration tests?
 * A: Unit tests = Test single function in isolation (mock dependencies)
 *    Integration tests = Test multiple components together (real database)
 *
 * Example:
 *    Unit: Test UserRepository.create() with mocked database
 *    Integration: Test full auth flow (controller → service → repository → DB)
 */

module.exports = {
  // Run tests from all service workspaces
  // Q: What's a monorepo?
  // A: Multiple services in one repository.
  //    - services/user-service/
  //    - services/api-gateway/
  //    Each has its own jest.config.js, this root config runs them all.
  projects: [
    '<rootDir>/services/*/jest.config.js'
  ],
  // Q: Why not list services explicitly?
  // A: Wildcard pattern scales automatically.
  //    Add services/order-service/ → Tests auto-included.

  // Coverage collection
  collectCoverageFrom: [
    'services/*/src/**/*.ts',       // All TypeScript source files
    '!services/*/src/**/*.test.ts', // Exclude test files
    '!services/*/src/**/*.spec.ts', // Exclude spec files
    '!**/node_modules/**',          // Exclude dependencies
    '!**/dist/**'                   // Exclude compiled output
  ],
  // Q: Why exclude test files from coverage?
  // A: Test files test OTHER code. Testing test files is redundant.

  // Coverage thresholds (ENFORCED in CI)
  // Q: Why 80%? Why not 100%?
  // A: Balance between safety and pragmatism:
  //    - < 70% = Too many untested code paths
  //    - 80% = Industry standard (MAANG companies)
  //    - 100% = Diminishing returns (testing getters/setters wastes time)
  coverageThreshold: {
    global: {
      branches: 80,    // 80% of if/else branches covered
      functions: 80,   // 80% of functions called in tests
      lines: 80,       // 80% of code lines executed
      statements: 80   // 80% of statements executed
    }
  },
  // Q: What if coverage drops below 80%?
  // A: CI fails → PR blocked → Developer must add tests or justify exception

  // Interview Tip: "I set 80% coverage globally but 100% for critical code
  //                 like authentication and payment processing"

  // Coverage output
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: [
    'text',          // Console output (CI logs)
    'lcov',          // For Codecov/Coveralls
    'html',          // Local viewing (coverage/index.html)
    'json-summary'   // For badges/automation
  ],
  // Q: Which reporter would you use in CI?
  // A: 'text' for logs, 'lcov' for Codecov upload

  // Test environment
  testEnvironment: 'node',
  // Q: What's testEnvironment?
  // A: Jest runs tests in a simulated environment:
  //    - 'node' = Node.js globals (process, Buffer, __dirname)
  //    - 'jsdom' = Browser globals (window, document, localStorage)
  //    Backend tests use 'node'.

  // Test timeout (milliseconds)
  testTimeout: 10000,
  // Q: Why 10 seconds?
  // A: Integration tests hit real database (slower than unit tests).
  //    - Unit tests: < 1 second
  //    - Integration tests: 1-5 seconds
  //    - E2E tests: 5-10 seconds
  //    10 seconds is generous for integration tests.

  // Verbose output (show each test)
  verbose: true
};

/**
 * MAANG Interview Talking Points:
 *
 * Q: What's your testing strategy?
 * A: "Testing pyramid:
 *     1. Unit tests (70%) - Fast, test individual functions
 *     2. Integration tests (20%) - Test service interactions
 *     3. E2E tests (10%) - Test full user flows
 *     Most code is unit-tested, critical flows are integration-tested."
 *
 * Q: How do you decide what to test?
 * A: "Risk-based approach:
 *     - Authentication: 100% coverage (security-critical)
 *     - Payment: 100% coverage (money-critical)
 *     - Utility functions: 60-80% coverage (low-risk)
 *     - Getters/setters: Often skip (trivial code)"
 *
 * Q: What's the difference between .test.ts and .spec.ts?
 * A: "Convention only:
 *     - .test.ts = Unit tests (my preference)
 *     - .spec.ts = Integration/E2E tests
 *     Some teams use .spec.ts for everything. I distinguish for clarity."
 *
 * Q: How do you handle flaky tests?
 * A: "Three steps:
 *     1. Identify: Track flaky tests over time
 *     2. Fix: Usually timing issues, race conditions, shared state
 *     3. Quarantine: jest.retryTimes(3) or skip() until fixed
 *     Flaky tests erode trust - fix immediately."
 *
 * Q: What's your opinion on snapshot testing?
 * A: "Useful for UI components (React) but dangerous for APIs.
 *     Snapshots hide regressions - developers blindly update them.
 *     For APIs, I prefer explicit assertions:
 *       expect(response.status).toBe(200);  ← Clear intent
 *       vs
 *       expect(response).toMatchSnapshot(); ← What changed?"
 *
 * Q: How do you test async code?
 * A: "Jest handles promises natively:
 *     test('async', async () => {
 *       const user = await userService.create(data);
 *       expect(user.id).toBeDefined();
 *     });
 *     Common mistake: Forgetting 'await' → Test passes even if function fails!"
 *
 * Q: How do you mock external dependencies?
 * A: "Three approaches:
 *     1. jest.mock() - Automatic mocking (easy but inflexible)
 *     2. Manual mocks - Create __mocks__/module.ts (more control)
 *     3. Dependency injection - Pass mock in constructor (best for services)
 *     I prefer DI for testability."
 */
