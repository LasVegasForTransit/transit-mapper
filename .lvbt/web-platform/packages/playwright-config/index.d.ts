import type { PlaywrightTestConfig } from '@playwright/test';

/** Environment for a framework preview process that Playwright owns and shuts down. */
export declare const foregroundServerEnvironment: Record<string, string>;

/** The shared Playwright configuration; spread it into `defineConfig({ ...sharedConfig, webServer })`. */
export declare const sharedConfig: PlaywrightTestConfig;
