/**
 * A `package#task` entry in turbo.json REPLACES the generic task of the same
 * name. Turbo does not merge the two, and it reports nothing when the override
 * drops a key.
 *
 * `@transitmapper/web#build` was added to carry release env vars and, in doing
 * so, silently lost `dependsOn: ["^build"]` and `outputs: ["dist/**"]`. Both
 * losses are invisible and both ship:
 *
 *   - Without `dependsOn`, the web build's hash excludes every workspace
 *     package's build hash, so editing `packages/*` stops invalidating the
 *     bundle and `pnpm build` reports a cache hit for a bundle that predates
 *     the change. It also stops ordering the web build behind the packages
 *     whose `dist/` it imports.
 *   - Without `outputs`, a cache hit restores no files at all. On a clean
 *     runner that leaves `apps/web/dist` empty and the deploy ships whatever
 *     is — or is not — already there.
 *
 * So the rule is not "the override looks right", it is "the override gives up
 * nothing the generic task declared". Asserting the override's `env` alone,
 * which is what this file used to do, passes in exactly the broken state.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type TurboTask = Record<string, unknown>;

interface TurboConfig {
  tasks: Record<string, TurboTask | undefined>;
}

const root = resolve(import.meta.dirname, '../..');
const config = JSON.parse(readFileSync(resolve(root, 'turbo.json'), 'utf8')) as TurboConfig;

/** `//#task` entries are root-package tasks, not overrides of a generic task
 *  of the same name, so they inherit nothing and are not subject to the rule. */
function packageOverrides(): [string, TurboTask][] {
  return Object.entries(config.tasks)
    .filter(([id]) => id.includes('#') && !id.startsWith('//'))
    .map(([id, task]) => [id, task ?? {}]);
}

describe('Turbo task overrides', () => {
  it('gives up nothing the generic task declared', () => {
    const overrides = packageOverrides();
    // A rule with nothing to check is a rule nobody notices has stopped
    // working, so prove the override this file exists for is still here.
    expect(overrides.map(([id]) => id)).toContain('@transitmapper/web#build');

    for (const [id, override] of overrides) {
      const taskName = id.slice(id.indexOf('#') + 1);
      const generic = config.tasks[taskName];
      if (generic === undefined) continue;
      for (const key of Object.keys(generic)) {
        expect(
          Object.hasOwn(override, key),
          `${id} drops "${key}" from the generic task, which Turbo will not restore`,
        ).toBe(true);
      }
    }
  });

  it('orders the web bundle behind the packages it imports and caches what it emits', () => {
    const web = config.tasks['@transitmapper/web#build'];
    expect(web?.dependsOn).toEqual(['^build']);
    // The production build resolves `@transitmapper/*` to each package's
    // `dist/`, so both directories the app can emit into have to be restorable.
    expect(web?.outputs).toEqual(['dist/**', '.perf-harness-dist/**', '*.tsbuildinfo']);
  });

  it('keeps web release metadata out of shared package build hashes', () => {
    expect(config.tasks.build).toEqual({
      dependsOn: ['^build'],
      outputs: ['dist/**', '*.tsbuildinfo'],
    });
    expect(config.tasks['@transitmapper/web#build']?.env).toEqual([
      'GITHUB_SHA',
      'TRANSITMAPPER_BUILD_COMMIT',
      'TRANSITMAPPER_BUILD_DIRTY',
      'TRANSITMAPPER_RELEASE_TAG',
      'TRANSITMAPPER_PERFORMANCE_SAMPLING_ENABLED',
      'TRANSITMAPPER_PERFORMANCE_ORDINARY_BASIS_POINTS',
      'TRANSITMAPPER_PERFORMANCE_RELEASE_BASIS_POINTS',
      'VITE_PERF_BUILD',
    ]);
  });
});
