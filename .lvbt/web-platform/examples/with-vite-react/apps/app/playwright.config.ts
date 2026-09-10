import { defineConfig } from '@playwright/test';

import { sharedConfig } from '@lvbt/playwright-config';

const url = 'http://127.0.0.1:4173';

export default defineConfig({
  ...sharedConfig,
  use: { ...sharedConfig.use, baseURL: url },
  webServer: { command: 'pnpm preview', url, reuseExistingServer: !process.env.CI },
});
