/**
 * Jest Configuration for User Service
 */

module.exports = {
  displayName: 'user-service',

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
    '^@services/(.*)$': '<rootDir>/src/services/$1',
    '^@controllers/(.*)$': '<rootDir>/src/controllers/$1',
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
