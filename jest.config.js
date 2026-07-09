/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  globalSetup: '<rootDir>/test/global-setup.ts',
  // Race-condition suites need a real Postgres and can run a bit long.
  testTimeout: 60000,
};
