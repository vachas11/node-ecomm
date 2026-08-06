/**
 * Jest Configuration for API Gateway
 */

module.exports = {
  displayName: 'api-gateway',

  // Use ts-jest to handle TypeScript
  preset: 'ts-jest',
  testEnvironment: 'node',

  // Test file patterns
  testMatch: [
    '<rootDir>/src/**/*.test.ts',
    '<rootDir>/tests/**/*.test.ts'
  ],

  // Module resolution (matches tsconfig paths)
  moduleNameMapper: {
    '^@models/(.*)$': '<rootDir>/src/models/$1',
    '^@repositories/(.*)$': '<rootDir>/src/repositories/$1',
    '^@middleware/(.*)$': '<rootDir>/src/middleware/$1',
    '^@config$': '<rootDir>/src/config/index',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1'
  },

  // Coverage
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts'
  ],

  // Clear mocks between tests
  clearMocks: true
};
