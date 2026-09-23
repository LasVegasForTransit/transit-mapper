import { defineConfig } from '@playwright/test';

import { foregroundServerEnvironment, sharedConfig } from '@lasvegasfortransit/playwright-config';

const url = 'http://127.0.0.1:4321';

export default defineConfig({
  ...sharedConfig,
  use: { ...sharedConfig.use, baseURL: url },
  webServer: {
    command: 'pnpm preview',
    env: foregroundServerEnvironment,
    url,
    reuseExistingServer: !process.env.CI,
  },
});
