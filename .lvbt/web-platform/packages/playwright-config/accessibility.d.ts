import type { Page } from '@playwright/test';

/** Analyze the current page against the organization WCAG A/AA baseline. */
export declare function expectNoAccessibilityViolations(page: Page): Promise<void>;
