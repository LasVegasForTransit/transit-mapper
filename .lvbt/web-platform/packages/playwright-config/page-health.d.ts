import type { Page } from '@playwright/test';

export interface PageHealthMonitor {
  readonly errors: readonly string[];
  assertNoErrors(): void;
}

export declare function monitorPageHealth(page: Page): PageHealthMonitor;
