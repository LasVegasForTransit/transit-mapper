import { defineConfig } from '@playwright/test';

import { sharedConfig } from '@lasvegasfortransit/playwright-config';

const remote = process.env.PLAYWRIGHT_BASE_URL;
const url = remote ?? 'http://127.0.0.1:4173';

export default defineConfig({
  ...sharedConfig,
  use: { ...sharedConfig.use, baseURL: url },
  ...(remote
    ? {}
    : { webServer: { command: 'pnpm preview', url, reuseExistingServer: !process.env.CI } }),
});
