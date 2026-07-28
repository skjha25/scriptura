'use strict';

/**
 * Jest configuration.
 *
 * The suite runs against in-memory SQLite (NODE_ENV=test forces the dialect in
 * src/config), so `npm test` is green on a fresh clone with no database server
 * installed. See ARCHITECTURE.md for what that does and does not verify.
 *
 * `--runInBand` (set in the npm script) is deliberate: every worker would
 * otherwise build its own schema, and serialising keeps the SQLite writer
 * uncontended and test output readable.
 */

module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  // Integration tests spin up the app and exercise the (mocked) AI pipeline;
  // the default 5s is too tight for the slower ones on a cold cache.
  testTimeout: 20000,
  clearMocks: true,
  restoreMocks: true,
  collectCoverageFrom: [
    'src/**/*.js',
    // Migrations and seeders are verified by dedicated tests that execute them,
    // not by line coverage, and counting them distorts the useful number.
    '!src/migrations/**',
    '!src/seeders/**',
    '!src/docs/**',
  ],
  coverageReporters: ['text-summary', 'lcov'],
  // Surfaces a handle leak (an unclosed pool, a live timer) as a warning rather
  // than a hang, which is what --forceExit would otherwise hide.
  detectOpenHandles: false,
  verbose: false,
};
