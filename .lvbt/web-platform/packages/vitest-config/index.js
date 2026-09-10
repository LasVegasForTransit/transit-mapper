/**
 * The shared Vitest configuration for every LVBT repository. Unit tests live
 * under `tests/` and end in `.test.ts` or `.test.tsx`. End-to-end tests under
 * `tests/e2e/` end in `.spec.ts` and belong to Playwright, so Vitest never
 * collects them. A suite with no tests fails, so a mis-glob cannot pass CI
 * silently.
 *
 * Spread it into a package's vitest.config.ts:
 *
 *   import { defineConfig } from 'vitest/config';
 *   import { sharedConfig } from '@lvbt/vitest-config';
 *   export default defineConfig({ ...sharedConfig });
 *
 * @type {import("vitest/config").UserConfig}
 */
export const sharedConfig = {
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**', 'tests/support/**'],
    passWithNoTests: false,
  },
};
