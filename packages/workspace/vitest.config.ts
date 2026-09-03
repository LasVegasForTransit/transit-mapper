import { defineConfig } from 'vitest/config';

import { sharedConfig } from '@lvbt/vitest-config';

export default defineConfig({
  ...sharedConfig,
  test: {
    ...sharedConfig.test,
    environment: 'node',
    passWithNoTests: true,
  },
});
