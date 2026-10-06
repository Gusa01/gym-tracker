// Integration tests hit a real Supabase (the hosted project locally, a throwaway
// local stack in CI): everything under tests/db/ plus any *.integration.test.ts.
// Everything else is pure logic and must run with no env vars or network.
// Regexes accept both path separators so the split also works on Windows.
const DB_DIR = '[\\\\/]tests[\\\\/]db[\\\\/].*\\.test\\.ts$';
const INTEGRATION_SUFFIX = '\\.integration\\.test\\.ts$';
// .claude/ holds git worktrees: full copies of the repo whose tests must not run twice.
const IGNORED = ['/node_modules/', '/.expo/', '[\\\\/]\\.claude[\\\\/]'];

const base = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/jest.setup.js'],
};

module.exports = {
  projects: [
    {
      ...base,
      displayName: 'unit',
      testPathIgnorePatterns: [...IGNORED, DB_DIR, INTEGRATION_SUFFIX],
    },
    {
      ...base,
      displayName: 'integration',
      testRegex: [DB_DIR, INTEGRATION_SUFFIX],
      testPathIgnorePatterns: IGNORED,
      testTimeout: 30000,
    },
  ],
};
