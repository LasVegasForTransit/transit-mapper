import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // No tests here yet. Declaring the task honestly — rather than omitting
    // it and being silently skipped — is the whole point of the workspace
    // contract check; this passes until real tests land.
    passWithNoTests: true,
  },
});
