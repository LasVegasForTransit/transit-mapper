import { defineConfig } from 'vitest/config';

/**
 * The root suite is `scripts/tests`, and those cases are unlike ordinary unit
 * tests: each one writes a fixture tree to a temporary directory and spawns
 * `dependency-cruiser` or `tsc` over it to prove a package boundary holds.
 * One crawl costs seconds rather than milliseconds, so the 5 s default fails
 * them on timing rather than on the boundary they exist to check — and a
 * boundary test that flakes is one people start ignoring.
 */
export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
