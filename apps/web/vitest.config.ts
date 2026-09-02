import { configDefaults, defineConfig } from 'vitest/config';

import { sharedConfig } from '@lvbt/vitest-config';

export default defineConfig({
  ...sharedConfig,
  test: {
    ...sharedConfig.test,
    environment: 'node',
    // The sequential verifier runs under tsx from the test script, and support
    // files are fixtures rather than suites.
    exclude: [...configDefaults.exclude, 'tests/verify.test.ts', 'tests/support/**'],
  },
});
