// The device descriptors come from playwright-core rather than @playwright/test so
// this package never loads the test runner: a consumer that links this package
// from another checkout would otherwise load @playwright/test twice, which it refuses.
import { devices } from 'playwright-core';

/**
 * The shared Playwright configuration for every LVBT repository. End-to-end
 * tests live under `tests/e2e/` and end in `.spec.ts`; every suite runs on one
 * desktop and one mobile Chromium profile; a failing test keeps its trace.
 *
 * Spread it into a package's playwright.config.ts and add the web server:
 *
 *   import { defineConfig } from '@playwright/test';
 *   import { sharedConfig } from '@lvbt/playwright-config';
 *   export default defineConfig({
 *     ...sharedConfig,
 *     webServer: { command: 'pnpm preview', url: 'http://127.0.0.1:4321' },
 *     use: { ...sharedConfig.use, baseURL: 'http://127.0.0.1:4321' },
 *   });
 *
 * @type {import("@playwright/test").PlaywrightTestConfig}
 */
export const sharedConfig = {
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  testIgnore: '**/support/**',
  snapshotPathTemplate:
    '{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}{-projectName}{-snapshotSuffix}{ext}',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // A Chromium phone profile, so CI installs one browser. iPhone profiles run WebKit.
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
};
