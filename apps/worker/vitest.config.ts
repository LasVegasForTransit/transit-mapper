import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { resolve } from 'node:path';

// API note for anyone following older documentation: as of
// @cloudflare/vitest-pool-workers 0.18, there is no `/config` subpath and no
// `defineWorkersConfig`. The pool is a Vite plugin — `cloudflareTest()` —
// applied alongside a normal Vitest config.
//
// Migrations are read here, at config time, and handed to the test
// environment as a binding, so tests apply the same .sql files production
// gets rather than a hand-maintained copy that drifts.
const migrations = await readD1Migrations(resolve(import.meta.dirname, 'src/migrations'));

export default defineConfig({
  plugins: [
    cloudflareTest({
      // Real workerd with the real bindings from wrangler.toml, so a test
      // exercises the same D1 the deployed Worker does.
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: { TEST_MIGRATIONS: migrations },
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts'],
  },
});
