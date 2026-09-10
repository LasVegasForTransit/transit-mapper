import type { PlaywrightTestConfig } from '@playwright/test';

/** The shared Playwright configuration; spread it into `defineConfig({ ...sharedConfig, webServer })`. */
export declare const sharedConfig: PlaywrightTestConfig;
