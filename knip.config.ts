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
 * by `turbo gen`, and `apps/worker/tests/verify.test.ts` is run directly by
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
        // Vite owns these inputs outside the TypeScript import graph. The embed
        // starts from embed.html, while the service worker follows the named
        // offline editor entry through the generated manifest.
        'src/embed/main.ts',
        'src/pwa/offline-editor.ts',
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
  ignoreDependencies: [
    // `cloudflare:test` is a virtual module @cloudflare/vitest-pool-workers
    // provides inside workerd. knip reads the scheme as a package name.
    'cloudflare',
    // Run by .githooks/pre-commit, which is a shell script outside the import
    // graph. knip resolves dependencies by import, so a tool invoked by a hook
    // reads as unused.
    'lint-staged',
    // Its `lvbt` binary and the lvbt-contributions plugin it ships are run by
    // path from .githooks/*, .codex/hooks.json, and AGENTS.md's contribution
    // helper — never imported, so knip cannot see the usage.
    '@lvbt/cli',
  ],
};

export default config;
