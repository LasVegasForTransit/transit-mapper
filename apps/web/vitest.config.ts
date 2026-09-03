import { defineConfig } from 'vitest/config';

import { sharedConfig } from '@lvbt/vitest-config';

export default defineConfig({
  ...sharedConfig,
  test: {
    ...sharedConfig.test,
    environment: 'node',
    // Turbo already schedules package suites. Keep this 306-file suite from
    // multiplying that package concurrency by every available CPU.
    maxWorkers: 2,
  },
});
