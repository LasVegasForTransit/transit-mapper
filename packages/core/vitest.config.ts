import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: [...configDefaults.exclude, 'tests/support/**'],
    // Only this package has a coverage floor. It is where the logic that can be
    // tested without a browser lives; the two applications run their own
    // sequential verifiers through `tsx`, which reports no coverage at all.
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      reporter: ['text-summary'],
      thresholds: {
        // Not hand-picked. `autoUpdate` below wrote them from a local run, so
        // they sit exactly at where the package is rather than where somebody
        // hoped it was, and any regression fails. They are low, and that is the
        // honest starting point: a floor set above the floor fails every branch
        // until somebody deletes it.
        statements: 58.5,
        branches: 46.36,
        functions: 61.53,
        lines: 62.64,
        // Raises a threshold that has been beaten and rewrites this file, so
        // coverage ratchets without anybody choosing a number. Never in CI,
        // where the rewrite would land in a worktree that gets thrown away —
        // there it only ever compares.
        autoUpdate: process.env.CI !== 'true',
      },
      // `perFile` is deliberately off. 21 of 72 source files have no test at
      // all, so a per-file threshold would have to be 0 to pass, which enforces
      // nothing. It becomes worth turning on once those 21 are covered, and it
      // is the better rule then: an aggregate hides a whole untested module
      // behind a well-tested neighbour.
    },
  },
});
