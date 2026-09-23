import { defineConfig } from 'vitest/config';

import { sharedConfig } from '@lasvegasfortransit/vitest-config';

export default defineConfig({
  ...sharedConfig,
  test: {
    ...sharedConfig.test,
    environment: 'node',
    passWithNoTests: true,
  },
});
