/**
 * Dead code is the failure mode nothing else here catches.
 *
 * `noUnusedLocals` stops at a file boundary by definition: an `export` is
 * reachable from outside, so the compiler says nothing about one nobody
 * imports. Lint sees one file at a time and cannot know either. So a helper
 * that was written, exported, and never wired up is invisible to every other
 * check in this repository — and writing one is the single most reliable thing
 * an agent does when it loses the thread mid-task.
 *
 * knip reads `pnpm-workspace.yaml` and each package's manifest itself, so the
 * only thing declared here is what it cannot infer: which files are entry
 * points because something outside the import graph runs them. Everything
 * under `scripts/` is invoked by a package script, `turbo/generators` is loaded
 * by `turbo gen`, and the two `tests/verify.test.ts` files are run directly by
 * `tsx` rather than by Vitest.
 *
 * It also reports catalog entries no workspace references, which extends the
 * dependency invariant `check:contract` already holds from "versions come from
 * the catalog" to "the catalog has nothing spare in it".
 */
import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  workspaces: {
    '.': {
      entry: ['scripts/**/*.ts', 'turbo/generators/config.ts'],
      project: ['scripts/**/*.ts', 'turbo/**/*.ts'],
    },
    'apps/web': {
      entry: [
        // Two products, two HTML entries, two bundles — see the rollup input
        // in vite.config.ts. The embed deliberately shares no bundle with the
        // editor, so its entry is reachable only through embed.html.
        'src/embed/main.ts',
        'perf.config.ts',
        'scripts/**/*.ts',
      ],
    },
    'apps/worker': {
      entry: ['scripts/**/*.ts'],
    },
  },
  rules: {
    // Both instances in this repository are deliberate: `LAYER_SPECS` names the
    // scheme-invariant reading of `LIGHT_LAYER_SPECS`, and
    // `saveEmergencyToLibrary` names the close-time reading of
    // `saveAuthoritativeToLibrary`. Each alias carries meaning the name it
    // points at does not, each is documented where it is declared, and between
    // them they have 25 callers. A rule that only ever fires on the intentional
    // case is a rule somebody switches off in a hurry, so it is off here with
    // the reason attached.
    duplicates: 'off',
  },
  ignore: [
    // A triple-slash reference and nothing else, so it has no imports and no
    // exports and reads as an unused file. Deleting it breaks
    // `virtual:pwa-register/react` two packages away — knip's `--fix` did
    // exactly that, which is the case its own documentation warns about.
    'apps/web/src/pwaEnv.ts',
  ],
  ignoreDependencies: [
    // `cloudflare:test` is a virtual module @cloudflare/vitest-pool-workers
    // provides inside workerd. knip reads the scheme as a package name.
    'cloudflare',
    // Run by .githooks/pre-commit, which is a shell script outside the import
    // graph. knip resolves dependencies by import, so a tool invoked by a hook
    // reads as unused.
    'lint-staged',
    // Declared at the root so every package resolves one version through the
    // catalog. Nothing at the root imports it, by design.
    'vitest',
  ],
};

export default config;
