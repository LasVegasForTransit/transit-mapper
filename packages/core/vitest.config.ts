import { configDefaults, defineConfig } from 'vitest/config';

import { sharedConfig } from '@lvbt/vitest-config';

export default defineConfig({
  ...sharedConfig,
  test: {
    ...sharedConfig.test,
    exclude: [...configDefaults.exclude, 'tests/support/**'],
  },
});
