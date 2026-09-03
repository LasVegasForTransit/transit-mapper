import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: [...configDefaults.exclude, 'tests/verify.test.ts', 'tests/support/**'],
    // Turbo already schedules package suites. Keep this 306-file suite from
    // multiplying that package concurrency by every available CPU.
    maxWorkers: 2,
  },
});
