# Module Test Directories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every test and test-only support file out of production source
trees and into a mirrored `tests/` tree at the root of its owning workspace
module.

**Architecture:** A "module" is a pnpm workspace package such as `apps/web`,
`apps/worker`, or `packages/core`. Each module owns one `tests/` directory
whose children mirror the relevant `src/` areas; production code remains in
`src/`, and test imports cross that boundary explicitly. Vitest, TypeScript,
Turborepo, generators, documentation, and the workspace contract all learn
the same layout so a misplaced test fails instead of being silently skipped.

**Tech Stack:** pnpm 11, Turborepo 2.10, TypeScript 6, Vitest 4, Cloudflare
Vitest Pool Workers, tsx.

## Global Constraints

- Treat each pnpm workspace package as one module. The only valid test roots
  are `<workspace-package>/tests/`.
- Mirror the former source area below `tests/`: for example,
  `apps/web/src/map/interactions.test.ts` becomes
  `apps/web/tests/map/interactions.test.ts`.
- Do not use `src/<area>/tests/`, `src/__tests__/`, or a flat package-wide
  test directory. The first two still colocate test and production trees; the
  last loses the existing area ownership and invites filename collisions.
- Preserve every test body, case name, assertion, execution environment, and
  suite order. This is a filesystem refactor, not a test rewrite.
- Move `apps/web/scripts/verify.ts` and `apps/worker/scripts/verify.ts`
  wholesale. They build state at module scope and mutate it sequentially;
  splitting either file changes what it tests.
- Move `apps/web/scripts/verify-maskable-icon.ts` as a standalone test program.
  Commit `32f46b7` deliberately moved it out of Vitest, so this refactor
  changes its location but not its execution mode.
- Move the test-only `packages/core/src/testing/fixtures.ts` support module
  into `packages/core/tests/support/fixtures.ts`. Keep the existing
  `@transitmapper/core/testing/fixtures` import stable through an explicit
  package export.
- Do not move `apps/web/src/perf/fixtures.ts` or
  `apps/web/src/ui/onboarding/fixtureSystem.ts`; both are runtime source.
- Keep repository tooling under `scripts/`: `apps/web/scripts/perf/**`,
  `apps/web/scripts/perf/verify-pwa-output.ts`,
  `apps/worker/scripts/check-generated-types.ts`, and root
  `scripts/check-*.ts` validate builds or repository state rather than test
  implementation behavior.
- Do not move, edit, rename, or delete any Worker migration.
- Do not add an alias merely to shorten the new relative imports. Explicit
  `../../src/...` imports make the test/production boundary visible without
  adding another resolution system.
- Retarget a relative module specifier by resolving it from the test's old
  `src/` directory and then computing the relative path from its new mirrored
  `tests/` directory. Most tests move one area deep and use `../../src/...`;
  nested tests such as `tests/editor/actions/` use `../../../src/...`.
- Remove `passWithNoTests` once every package has an explicit test glob. A bad
  glob must fail loudly.
- Keep production runtime type boundaries intact. Web Node tests stay in the
  Node-aware config, and the Worker workerd test stays in the Worker-aware
  config.
- Update Turborepo inputs before relying on cached commands. A test-only
  change must invalidate `lint`, `typecheck`, and `verify`.
- Historical files under `docs/superpowers/specs/` and older plans remain
  historical records. Update normative documentation only.
- Use narrow staging commands. Never use `git add -A`, blanket-restage, or
  include unrelated work.

## Execution Precondition

The repository changed while this plan was being written. The first inventory
found 72 Vitest files on a dirty branch; the final inventory found 83 files on
clean commit `60e8f6c`, including the now-committed sidebar work and 11 newer
tests. Start execution from a clean worktree containing the final inventory
below. Re-run the inventory before moving anything and extend Appendix A if a
later commit adds another test.

Commit this plan document before beginning execution, or copy it outside the
execution worktree. The closeout requires a genuinely clean worktree, not one
whose only untracked file is its own plan.

The observed green baseline was:

- 83 Vitest files and 517 Vitest cases
- web: 58 files and 310 cases
- core: 22 files and 186 cases
- worker: 1 file and 8 cases
- ESLint plugin: 1 file and 12 cases
- PWA updater: 1 file and 1 case
- `pnpm verify`: pass

---

### Task 1: Move the core suite and make test changes cache-visible

**Files:**

- Move: every `packages/core` path in Appendix A
- Modify: `turbo.json`
- Modify: `packages/core/package.json`
- Modify: `packages/core/tsconfig.json`
- Modify: `packages/core/vitest.config.ts`
- Modify: `docs/development/reference/project-structure.md`

**Interfaces:**

- Produces: `packages/core/tests/**`, including
  `packages/core/tests/support/fixtures.ts`
- Produces: the unchanged test-support import
  `@transitmapper/core/testing/fixtures`
- Produces: Turbo task inputs that include `tests/**`

- [ ] **Step 1: Reconfirm the baseline and working-tree boundary**

Run:

```bash
git status --porcelain=v1 -b
pnpm --filter @transitmapper/core typecheck
pnpm --filter @transitmapper/core verify
```

Expected: the status is understood and preserved; core reports 22 passing
files and 186 passing cases.

- [ ] **Step 2: Add test trees to Turborepo inputs**

Update the three explicit task input lists in `turbo.json`:

```json
"typecheck": {
  "dependsOn": ["^typecheck"],
  "inputs": ["src/**", "scripts/**", "tests/**", "tsconfig*.json"],
  "outputs": ["*.tsbuildinfo"]
},
"lint": {
  "inputs": [
    "src/**",
    "scripts/**",
    "tests/**",
    "vitest.config.ts",
    "$TURBO_ROOT$/eslint.config.js"
  ],
  "outputs": []
},
"verify": {
  "dependsOn": ["^typecheck"],
  "inputs": [
    "src/**",
    "scripts/**",
    "tests/**",
    "public/**",
    "vitest.config.ts",
    "tsconfig*.json",
    "wrangler.toml"
  ],
  "outputs": []
}
```

`public/**` keeps the web maskable-icon check cache-correct.
`wrangler.toml` keeps the Worker pool configuration cache-correct.

- [ ] **Step 3: Move the 22 core test files**

Create the destination directories, then perform the exact core moves in
Appendix A. Use rename-preserving moves; do not edit test bodies.

```bash
mkdir -p packages/core/tests/{geometry,model,render,share,sim,support}
```

- [ ] **Step 4: Move the shared test fixture**

Move:

```text
packages/core/src/testing/fixtures.ts
  -> packages/core/tests/support/fixtures.ts
```

Remove the now-empty `packages/core/src/testing/` directory.

- [ ] **Step 5: Retarget core relative imports**

Apply this exact rule to each moved test:

- `./thing` becomes `../../src/<area>/thing`
- `../other/thing` becomes `../../src/other/thing`
- `../testing/fixtures` becomes `../support/fixtures`

Inside the moved support module, retarget its own four production imports:

```ts
// packages/core/tests/support/fixtures.ts
import { wayById, wholeLegs, oneSection } from '../../src/model/geo';
import { defaultProfileFor } from '../../src/model/profile';
import { createEmptySystem } from '../../src/model/serialize';
import type { LngLat, Pattern, Service, Station, TransitSystem, Way } from '../../src/model/system';
```

Examples:

```ts
// packages/core/tests/model/profile.test.ts
import { defaultProfileFor } from '../../src/model/profile';
import { aRoad } from '../support/fixtures';

// packages/core/tests/geometry/vehicleLane.test.ts
import { patternLanePath } from '../../src/geometry/vehicleLane';
import { buildTimetable } from '../../src/sim/timetable';
import { aPattern, aRoad } from '../support/fixtures';
```

Package imports and test bodies remain unchanged.

- [ ] **Step 6: Preserve the cross-package fixture import**

Put the specific test-support export before the existing wildcard in
`packages/core/package.json`:

```json
"exports": {
  "./testing/fixtures": "./tests/support/fixtures.ts",
  "./*": "./src/*.ts"
}
```

This keeps the web test import
`@transitmapper/core/testing/fixtures` stable while taking the implementation
out of `src/`.

- [ ] **Step 7: Point TypeScript and Vitest at the new tree**

In `packages/core/tsconfig.json`:

```json
"include": ["src", "tests"]
```

Replace the `test` block in `packages/core/vitest.config.ts` with:

```ts
test: {
  environment: 'node',
  include: ['tests/**/*.test.ts'],
},
```

Delete the stale "No tests here yet" comment and `passWithNoTests`.

- [ ] **Step 8: Keep the project map synchronized**

In `docs/development/reference/project-structure.md`, replace the
`packages/core/src/testing/` tree entry and section with
`packages/core/tests/support/`. Explain that module-root test trees mirror
their production areas and that the explicit test-support export is separate
from the production wildcard.

Run:

```bash
pnpm check:structure
```

Expected: the removed source directory is no longer documented as present.

- [ ] **Step 9: Prove the old tree is empty and the new imports resolve**

Run:

```bash
test ! -d packages/core/src/testing
! rg --files packages/core/src | rg -q '\.(test|spec)\.'
pnpm --filter @transitmapper/core typecheck
pnpm --filter @transitmapper/core verify
```

Expected: no test files remain in core `src`; typecheck passes; Vitest still
reports 22 files and 186 cases.

- [ ] **Step 10: Review rename detection**

Run:

```bash
git diff HEAD --summary --find-renames -- packages/core turbo.json
git diff HEAD --check -- packages/core turbo.json
```

Expected: test files are detected as renames plus import-only edits; no
production behavior changed.

- [ ] **Step 11: Commit only the core migration**

```bash
git add turbo.json packages/core/package.json packages/core/tsconfig.json \
  packages/core/vitest.config.ts packages/core/tests \
  docs/development/reference/project-structure.md
git commit -m "refactor(test): move core tests out of source"
```

---

### Task 2: Move the ESLint-plugin and PWA-updater suites

**Files:**

- Move:
  `packages/eslint-plugin/src/core-runtime-purity.test.ts` to
  `packages/eslint-plugin/tests/core-runtime-purity.test.ts`
- Move:
  `packages/pwa-updater/src/reloadAfterFlush.test.ts` to
  `packages/pwa-updater/tests/reloadAfterFlush.test.ts`
- Create: `packages/pwa-updater/vitest.config.ts`
- Modify: `packages/eslint-plugin/tsconfig.json`
- Modify: `packages/eslint-plugin/vitest.config.ts`
- Modify: `packages/pwa-updater/package.json`
- Modify: `packages/pwa-updater/tsconfig.json`

**Interfaces:**

- Produces: explicit `tests/**/*.test.ts` discovery in both packages
- Removes: all `passWithNoTests` behavior from packages that own tests

- [ ] **Step 1: Move both tests**

```bash
mkdir -p packages/eslint-plugin/tests packages/pwa-updater/tests
git mv packages/eslint-plugin/src/core-runtime-purity.test.ts \
  packages/eslint-plugin/tests/core-runtime-purity.test.ts
git mv packages/pwa-updater/src/reloadAfterFlush.test.ts \
  packages/pwa-updater/tests/reloadAfterFlush.test.ts
```

- [ ] **Step 2: Retarget the two source imports**

```ts
// packages/eslint-plugin/tests/core-runtime-purity.test.ts
import { coreRuntimePurity } from '../src/core-runtime-purity';

// packages/pwa-updater/tests/reloadAfterFlush.test.ts
import { reloadAfterFlush } from '../src/reloadAfterFlush';
```

Keep all cases unchanged.

- [ ] **Step 3: Update the ESLint-plugin configs**

In `packages/eslint-plugin/tsconfig.json`:

```json
"include": ["src", "tests"]
```

In `packages/eslint-plugin/vitest.config.ts`:

```ts
test: { environment: 'node', include: ['tests/**/*.test.ts'] },
```

- [ ] **Step 4: Make PWA-updater discovery explicit**

Create `packages/pwa-updater/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

In `packages/pwa-updater/tsconfig.json`:

```json
"include": ["src", "tests"]
```

Change its package script from `vitest run --passWithNoTests` to:

```json
"verify": "vitest run"
```

- [ ] **Step 5: Verify both modules**

Run:

```bash
pnpm --filter @transitmapper/eslint-plugin typecheck
pnpm --filter @transitmapper/eslint-plugin verify
pnpm --filter @transitmapper/pwa-updater typecheck
pnpm --filter @transitmapper/pwa-updater verify
```

Expected: ESLint plugin reports 1 file and 12 cases; PWA updater reports 1
file and 1 case.

- [ ] **Step 6: Commit only these package moves**

```bash
git add packages/eslint-plugin/tsconfig.json \
  packages/eslint-plugin/vitest.config.ts \
  packages/eslint-plugin/tests \
  packages/pwa-updater/package.json \
  packages/pwa-updater/tsconfig.json \
  packages/pwa-updater/vitest.config.ts \
  packages/pwa-updater/tests
git commit -m "refactor(test): move package tests out of source"
```

---

### Task 3: Move both Worker test programs without changing workerd

**Files:**

- Move: `apps/worker/src/shares.test.ts` to
  `apps/worker/tests/shares.test.ts`
- Move: `apps/worker/scripts/verify.ts` to
  `apps/worker/tests/verify.ts`
- Modify: `apps/worker/package.json`
- Modify: `apps/worker/tsconfig.json`
- Modify: `apps/worker/tsconfig.scripts.json`
- Modify: `apps/worker/vitest.config.ts`

**Interfaces:**

- Preserves: real workerd, the real D1 binding, and production migrations
- Produces: `tsx tests/verify.ts && vitest run`

- [ ] **Step 1: Move both Worker test entries intact**

```bash
mkdir -p apps/worker/tests
git mv apps/worker/src/shares.test.ts apps/worker/tests/shares.test.ts
git mv apps/worker/scripts/verify.ts apps/worker/tests/verify.ts
```

Do not split or reorder either file.

- [ ] **Step 2: Retarget only the Vitest source import**

In `apps/worker/tests/shares.test.ts`, change `./index` to `../src/index`.
The sequential verifier already imports `../src/index`, and that path remains
correct because `scripts/` and `tests/` are at the same depth.

In `apps/worker/tests/verify.ts`, change the comparison comment from
`apps/web/scripts/verify.ts` to `apps/web/tests/verify.ts`.

- [ ] **Step 3: Update Worker discovery and package execution**

In `apps/worker/vitest.config.ts`, change only:

```ts
include: ['tests/**/*.test.ts'],
```

Keep `readD1Migrations(resolve(import.meta.dirname, 'src/migrations'))`,
`cloudflareTest()`, Wrangler configuration, and `TEST_MIGRATIONS` unchanged.

In `apps/worker/package.json`:

```json
"verify": "tsx tests/verify.ts && vitest run"
```

- [ ] **Step 4: Keep Node and workerd typings separate**

In `apps/worker/tsconfig.json`:

```json
"include": [
  "src",
  "tests/**/*.test.ts",
  "vitest.config.ts",
  "worker-configuration.d.ts"
]
```

In `apps/worker/tsconfig.scripts.json`:

```json
"include": ["scripts", "tests/verify.ts"]
```

Update its opening comment to say the config covers Node-run Worker tooling
and the sequential verifier. Do not add Node globals to the workerd Vitest
file.

- [ ] **Step 5: Verify the Worker boundary**

Run:

```bash
pnpm --filter @transitmapper/worker typecheck
pnpm --filter @transitmapper/worker verify
```

Expected: the sequential suite still passes; Vitest reports 1 file and 8
cases running in real workerd against D1 with the production migrations.

- [ ] **Step 6: Confirm migrations are untouched**

Run:

```bash
git diff --exit-code -- apps/worker/src/migrations
pnpm check:migrations
```

Expected: no migration diff; append-only check passes.

- [ ] **Step 7: Commit only the Worker migration**

```bash
git add apps/worker/package.json apps/worker/tsconfig.json \
  apps/worker/tsconfig.scripts.json apps/worker/vitest.config.ts \
  apps/worker/tests
git commit -m "refactor(test): move worker tests out of source"
```

---

### Task 4: Move all web test programs

**Files:**

- Move: every `apps/web` path in Appendix A
- Modify: `apps/web/package.json`
- Modify: `apps/web/tsconfig.json`
- Modify: `apps/web/tsconfig.scripts.json`
- Modify: `apps/web/vitest.config.ts`

**Interfaces:**

- Produces: 58 mirrored Vitest files under `apps/web/tests/**`
- Produces: `apps/web/tests/verify.ts`
- Produces: `apps/web/tests/verify-maskable-icon.ts`

- [ ] **Step 1: Re-scan before moving**

Run:

```bash
git status --porcelain=v1
rg --files apps/web/src | rg '\.(test|spec)\.(ts|tsx)$' | sort
```

Expected at the final plan baseline: 58 files.
If execution finds more, extend the same mirrored mapping before continuing.

- [ ] **Step 2: Create the mirrored area directories**

```bash
mkdir -p apps/web/tests/{editor/actions,embed,import,map/layers,network,perf,pwa,services,share,sim,storage,ui/inspector}
```

- [ ] **Step 3: Move all 58 Vitest files**

Perform every web Vitest move in Appendix A. Use `git mv` for tracked files.
If the execution inventory finds an untracked test, first carry its complete
feature change into the execution branch; do not commit a test that depends
on uncommitted implementation.

- [ ] **Step 4: Move both standalone test programs whole**

```bash
git mv apps/web/scripts/verify.ts apps/web/tests/verify.ts
git mv apps/web/scripts/verify-maskable-icon.ts \
  apps/web/tests/verify-maskable-icon.ts
```

Both files retain their current relative imports and URLs because their
directory depth does not change.

Update the opening run comment in `apps/web/tests/verify.ts` to:

```ts
// Run with: pnpm --filter @transitmapper/web verify
```

- [ ] **Step 5: Retarget web Vitest relative imports mechanically**

For every moved test, resolve each relative import from its old location and
point it at the same absolute source file from the new location:

- `tests/map/interactions.test.ts`: `./interactions` becomes
  `../../src/map/interactions`
- `tests/editor/actions/pointActions.test.ts`: `./pointActions` becomes
  `../../../src/editor/actions/pointActions`
- `tests/editor/actions/pointActions.test.ts`: `../store` becomes
  `../../../src/editor/store`
- package imports such as `@transitmapper/core/...` stay unchanged

Examples:

```ts
// apps/web/tests/map/interactions.test.ts
import { createEditorStore } from '../../src/editor/store';
import { LYR_HANDLES } from '../../src/map/layers';
import { attachInteractions } from '../../src/map/interactions';

// apps/web/tests/ui/Workbench.test.tsx
import { Workbench } from '../../src/ui/Workbench';
```

Do not alter user-facing strings, test names, assertions, or fixtures.

- [ ] **Step 6: Update the `ExportPreviewMap` mock as one unit**

`apps/web/tests/ui/ExportPreviewMap.test.ts` is the only test with a relative
`vi.mock`. Update all three references to the same new source path:

```ts
vi.mock('../../src/map/layers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/map/layers')>();
  return { ...actual, registerMapIcons: vi.fn() };
});

import { LAYER_SPECS } from '../../src/map/layers';
import { ExportPreviewMap } from '../../src/ui/ExportPreviewMap';
```

The `vi.mock` string, `importOriginal` type, and `LAYER_SPECS` import must all
resolve to the same `src/map/layers` module.

- [ ] **Step 7: Update web discovery, typing, and execution**

In `apps/web/vitest.config.ts`:

```ts
include: ['tests/**/*.test.{ts,tsx}'],
```

In `apps/web/package.json`:

```json
"verify": "tsx tests/verify.ts && tsx tests/verify-maskable-icon.ts && vitest run"
```

Keep `apps/web/tsconfig.json` source-only. Update its comment to point at
`tsconfig.scripts.json` for Node tooling and tests.

In `apps/web/tsconfig.scripts.json`, keep the Node and Vite type sets and use:

```json
"include": ["scripts", "tests"]
```

Update its opening comment to explain that it typechecks Node-run tooling,
the sequential suite, the asset verifier, and Vitest files without admitting
Node globals into the production browser config.

- [ ] **Step 8: Verify the web suite and exact discovery count**

Run:

```bash
pnpm --filter @transitmapper/web typecheck
pnpm --filter @transitmapper/web verify
```

Expected:

- sequential verifier: all pass
- maskable icon verifier: pass
- Vitest: 58 files and 310 cases

- [ ] **Step 9: Check for missed source imports and old files**

Run:

```bash
! rg --files apps/web/src | rg -q '\.(test|spec)\.'
rg -n "from ['\"]\\.|vi\\.mock\\(['\"]\\." apps/web/tests \
  -g '*.test.ts' -g '*.test.tsx'
git diff HEAD --summary --find-renames -- apps/web
git diff HEAD --check -- apps/web
```

Review every reported relative specifier and confirm it resolves into the
module's `src/` tree or intentionally targets test support. No Vitest file may
still resolve as though it lived under `src/`.

- [ ] **Step 10: Commit only the web migration**

```bash
git add apps/web/package.json apps/web/tsconfig.json \
  apps/web/tsconfig.scripts.json apps/web/vitest.config.ts \
  apps/web/tests
git commit -m "refactor(test): move web tests out of source"
```

---

### Task 5: Make generators and the workspace contract enforce the layout

**Files:**

- Modify: `scripts/check-workspace-contract.ts`
- Modify: `scripts/check-generators.ts`
- Modify: `scripts/generate-checks-reference.ts`
- Modify: `turbo/generators/config.ts`
- Modify: `turbo/generators/templates/package/index.test.ts.hbs`
- Modify: `turbo/generators/templates/package/tsconfig.json.hbs`
- Modify: `turbo/generators/templates/package/vitest.config.ts.hbs`
- Modify: `turbo/generators/templates/lint-rule/rule.test.ts.hbs`
- Modify, generated: `docs/development/reference/checks.md`

**Interfaces:**

- Produces: `check:contract` failures for test material outside a package's
  root `tests/` directory
- Produces: package and lint-rule generators that emit the new layout

- [ ] **Step 1: Extend the workspace contract's failure model**

In `scripts/check-workspace-contract.ts`, add `relative` to the
`node:path` import and extend `Failure`:

```ts
interface Failure {
  kind: 'task' | 'catalog' | 'test-layout';
  message: string;
}
```

Add this remediation:

```ts
'test-layout':
  "  Tests and test-only support belong under the owning package's tests/ directory.\n" +
  '  fix:  move each path to <package>/tests/, mirror its source area, and update imports',
```

- [ ] **Step 2: Add deterministic test-material discovery**

Add these helpers beside `shipsCode`:

```ts
const TEST_FILE = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/;
const TEST_DIRECTORIES = new Set(['test', 'tests', 'testing', '__tests__']);
const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', '.turbo', '.wrangler', 'artifacts']);

function packageRelativePath(packagePath: string, parentPath: string, name: string): string {
  return relative(resolve(ROOT, packagePath), resolve(parentPath, name)).replaceAll('\\', '/');
}

async function misplacedTestMaterial(packagePath: string): Promise<string[]> {
  const entries = await readdir(resolve(ROOT, packagePath), {
    recursive: true,
    withFileTypes: true,
  });

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => packageRelativePath(packagePath, entry.parentPath, entry.name))
    .filter((path) => {
      const parts = path.split('/');
      if (parts.some((part) => IGNORED_DIRECTORIES.has(part))) return false;
      const directoryLooksLikeTests = parts.slice(0, -1).some((part) => TEST_DIRECTORIES.has(part));
      return (
        (TEST_FILE.test(parts.at(-1) ?? '') || directoryLooksLikeTests) && parts[0] !== 'tests'
      );
    })
    .sort();
}

function directVerifyEntries(command: string): string[] {
  return [...command.matchAll(/\btsx\s+([^\s;&|]+)/g)]
    .map((match) => match[1].replace(/^['"]|['"]$/g, ''))
    .filter((path) => /\.[cm]?[jt]sx?$/.test(path));
}
```

This deliberately scans tracked and untracked package files. It ignores
build output, and it recognizes test filenames, conventional test
directories, test-support directories, and direct tsx programs invoked by a
package's `verify` script.

- [ ] **Step 3: Collect layout failures for every code package**

Inside the non-root package branch in `main()`, after checking required
tasks, collect the filesystem and script findings into one set so a direct
`*.test.ts` entry produces one failure:

```ts
const misplacedTests = new Set(await misplacedTestMaterial(path));

for (const entry of directVerifyEntries(scripts.verify ?? '')) {
  const normalized = entry.replace(/^\.\//, '');
  if (normalized === 'tests' || normalized.startsWith('tests/')) continue;
  misplacedTests.add(normalized);
}

for (const misplaced of [...misplacedTests].sort()) {
  failures.push({
    kind: 'test-layout',
    message: `${name} keeps test material outside ${path}/tests/: ${path}/${misplaced}`,
  });
}
```

Include `test-layout` in the ordered failure-kind loop:

```ts
for (const kind of ['task', 'catalog', 'test-layout'] as const) {
```

Change the success line to:

```ts
console.log('workspace contract: package tasks, dependency versions, and test layouts are valid.');
```

- [ ] **Step 4: Exercise the failure path with a real misplaced file**

Temporarily move one already-passing test back under source:

```bash
mv apps/web/tests/network/cancelableFlight.test.ts \
  apps/web/src/network/cancelableFlight.test.ts
pnpm check:contract
```

Expected: FAIL naming
`apps/web/src/network/cancelableFlight.test.ts` and the `tests/` remediation.

Restore it immediately:

```bash
mv apps/web/src/network/cancelableFlight.test.ts \
  apps/web/tests/network/cancelableFlight.test.ts
pnpm check:contract
```

Expected: PASS with the new success line.

- [ ] **Step 5: Make the package generator emit `tests/`**

In `turbo/generators/config.ts`, change:

```ts
path: 'packages/{{name}}/tests/index.test.ts',
```

In `turbo/generators/templates/package/index.test.ts.hbs`:

```ts
import { placeholder } from '../src/index.ts';
```

In `turbo/generators/templates/package/tsconfig.json.hbs`:

```json
"include": ["src", "tests"]
```

In `turbo/generators/templates/package/vitest.config.ts.hbs`:

```ts
test: { environment: 'node', include: ['tests/**/*.test.ts'] },
```

Update `documentPackage()` in `turbo/generators/config.ts` so the generated
project-structure section describes both paths:

```md
- `src/index.ts` — replace this line with what the package holds.
- `tests/index.test.ts` — the package's initial contract test.
```

- [ ] **Step 6: Make the lint-rule generator emit `tests/`**

In `turbo/generators/config.ts`, change:

```ts
path: 'packages/eslint-plugin/tests/{{name}}.test.ts',
```

In `turbo/generators/templates/lint-rule/rule.test.ts.hbs`:

```ts
import { {{camelCase name}} } from '../src/{{name}}.ts';
```

In `scripts/check-generators.ts`, change the lint-rule scenario's expected
test path to:

```ts
'packages/eslint-plugin/tests/no-gencheck-placeholder.test.ts',
```

- [ ] **Step 7: Persist a negative layout scenario in generator validation**

Add `spawnSync` to the `node:child_process` import and `renameSync` to the
`node:fs` import in `scripts/check-generators.ts`. Add:

```ts
function assertTestLayoutGuard(): void {
  const allowed = resolve(ROOT, 'packages/gencheck/tests/index.test.ts');
  const misplaced = resolve(ROOT, 'packages/gencheck/src/index.test.ts');

  renameSync(allowed, misplaced);
  try {
    const result = spawnSync('pnpm', ['check:contract'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    if (result.error) throw result.error;

    const output = `${result.stdout}${result.stderr}`;
    if (result.status === 0 || !output.includes('packages/gencheck/src/index.test.ts')) {
      throw new Error('check:contract did not reject packages/gencheck/src/index.test.ts');
    }
  } finally {
    renameSync(misplaced, allowed);
  }
}
```

Call `assertTestLayoutGuard()` immediately after the generated package first
passes `pnpm check`. The function temporarily violates the rule, requires
`check:contract` to name the misplaced test, and restores the generated tree
even when the assertion fails.

- [ ] **Step 8: Update the generated checks registry**

In `scripts/generate-checks-reference.ts`, change the `check:contract`
description to:

```ts
fails:
  'a package is missing a required task, pins a version outside the catalog, or keeps test material outside its tests/ directory',
fix:
  'add the script, use the catalog, or move the test under the owning package tests/ tree',
```

Regenerate:

```bash
pnpm gen:checks
pnpm check:reference
```

Expected: `docs/development/reference/checks.md` names the expanded workspace
contract and is current.

- [ ] **Step 9: Commit tooling separately**

```bash
git add scripts/check-workspace-contract.ts scripts/check-generators.ts \
  scripts/generate-checks-reference.ts turbo/generators/config.ts \
  turbo/generators/templates/package/index.test.ts.hbs \
  turbo/generators/templates/package/tsconfig.json.hbs \
  turbo/generators/templates/package/vitest.config.ts.hbs \
  turbo/generators/templates/lint-rule/rule.test.ts.hbs \
  docs/development/reference/checks.md
git commit -m "chore(test): enforce module test directories"
```

---

### Task 6: Document the test architecture and repair path references

**Files:**

- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `apps/web/src/share/singleFlight.ts`
- Modify: `apps/web/src/map/export/visibilityAwareTimeout.ts`
- Modify: `packages/core/src/render/featureInputs.ts`
- Modify: `apps/web/src/ui/onboarding/fixtureSystem.ts`
- Modify: `docs/development/explanation/enforcement-model.md`
- Modify: `docs/development/how-to/add-a-lint-rule.md`
- Modify: `docs/development/how-to/add-a-migration.md`
- Modify: `docs/development/how-to/add-a-package.md`
- Modify: `docs/development/how-to/local-development.md`
- Modify: `docs/development/how-to/run-the-checks.md`
- Modify: `docs/development/how-to/write-a-test.md`
- Modify: `docs/development/reference/project-structure.md`
- Modify: `docs/product/reference/catalogs.md`

**Interfaces:**

- Produces: one normative description of module-root test trees
- Preserves: historical plans/specifications as records

- [ ] **Step 1: Make `AGENTS.md` state and enforce the rule**

Add an invariant row:

```md
| Tests and test-only support live under the owning module's root `tests/` tree | Production trees stay navigable, and runner globs cannot silently omit a colocated test | `check:contract` |
```

Update the "Add a test" section:

- sequential suites are `apps/web/tests/verify.ts` and
  `apps/worker/tests/verify.ts`
- new Vitest files go under `<module>/tests/`, mirroring `src/`
- Worker integration tests live at `apps/worker/tests/shares.test.ts`
- the sequential suites must still not be split piecemeal

- [ ] **Step 2: Rewrite the test guide around the new boundary**

In `docs/development/how-to/write-a-test.md`, document:

```text
<module>/
  src/
    map/interactions.ts
  tests/
    map/interactions.test.ts
```

State that web discovers `tests/**/*.test.{ts,tsx}`, the TypeScript-only
modules discover `tests/**/*.test.ts`, test support belongs under
`tests/support/`, and source-relative imports cross explicitly into `src/`.
Keep the stateful-suite and real-workerd/D1 explanations.

- [ ] **Step 3: Update the project map**

In `docs/development/reference/project-structure.md`:

- add module-root `tests/` trees to the top-level map
- retain and refine the `packages/core/tests/support/` entry added in Task 1
- replace every `apps/web/scripts/verify.ts` reference with
  `apps/web/tests/verify.ts`
- describe `apps/web/scripts/` as performance/build tooling rather than a test
  location
- describe `apps/worker/scripts/` as generated-types tooling rather than a
  test location
- describe the mirrored suite layout in `## Testing`

Preserve any concurrent sidebar documentation already present in this file.

- [ ] **Step 4: Explain the enforcement choice**

In `docs/development/explanation/enforcement-model.md`, add a
`test-layout` subsection explaining:

- Vitest globs alone are unsafe because a misplaced test is silently skipped
- `check:contract` already knows the workspace package boundaries and verify
  scripts
- the check covers test/spec filenames, test directories, test-support
  directories, and direct tsx verifier entries
- the fix is to mirror the source area under the owning package's `tests/`

- [ ] **Step 5: Update contributor and command guides**

Repair current references and examples in:

- `README.md`
- `docs/development/how-to/add-a-migration.md`
- `docs/development/how-to/add-a-package.md`
- `docs/development/how-to/add-a-lint-rule.md`
- `docs/development/how-to/local-development.md`
- `docs/development/how-to/run-the-checks.md`
- `docs/product/reference/catalogs.md`

The package and lint-rule guides must show generated tests under `tests/`.
The migration guide must point at `apps/worker/tests/shares.test.ts`.
The checks guide must say `check:contract` also rejects misplaced tests.

- [ ] **Step 6: Repair live code comments**

Update only path wording, not behavior, in:

- `apps/web/src/share/singleFlight.ts`
- `apps/web/src/map/export/visibilityAwareTimeout.ts`
- `packages/core/src/render/featureInputs.ts`
- `apps/web/src/ui/onboarding/fixtureSystem.ts`

Use `apps/web/tests/verify.ts` and
`@transitmapper/core/testing/fixtures` or
`packages/core/tests/support/fixtures.ts` as appropriate.

- [ ] **Step 7: Prove no current documentation points at the old layout**

Run:

```bash
rg -n "scripts/verify\.ts|apps/worker/src/shares\.test\.ts|packages/core/src/testing|src/\*\*/\*\.test" \
  . \
  --glob '!docs/superpowers/plans/**' \
  --glob '!docs/superpowers/specs/**' \
  --glob '!node_modules/**' \
  --glob '!dist/**'
```

Expected: no current normative reference to the old layout. Historical plans
and specs are intentionally excluded.

- [ ] **Step 8: Verify documentation and commit**

Run:

```bash
pnpm check:docs
pnpm check:structure
pnpm check:documents
pnpm format:check
git diff --check
```

Expected: all pass.

Commit only the documentation and live comment changes:

```bash
git add AGENTS.md README.md apps/web/src/share/singleFlight.ts \
  apps/web/src/map/export/visibilityAwareTimeout.ts \
  packages/core/src/render/featureInputs.ts \
  apps/web/src/ui/onboarding/fixtureSystem.ts \
  docs/development/explanation/enforcement-model.md \
  docs/development/how-to/add-a-lint-rule.md \
  docs/development/how-to/add-a-migration.md \
  docs/development/how-to/add-a-package.md \
  docs/development/how-to/local-development.md \
  docs/development/how-to/run-the-checks.md \
  docs/development/how-to/write-a-test.md \
  docs/development/reference/project-structure.md \
  docs/product/reference/catalogs.md
git commit -m "docs(test): document module test directories"
```

---

### Task 7: Run the complete closeout

**Files:**

- Verify only; no new files expected

**Interfaces:**

- Proves: all 86 test entry files live under module-root `tests/`
- Proves: Vitest still discovers exactly 83 files and 517 cases
- Proves: all repository invariants and generators accept the final tree

- [ ] **Step 1: Audit every workspace test path**

Run:

```bash
pnpm check:contract
rg --files apps packages | rg '\.(test|spec)\.[cm]?[jt]sx?$' | sort
```

Expected: every printed test path contains exactly one module-root
`/tests/` segment; no test/spec file remains under `src/` or `scripts/`.

- [ ] **Step 2: Confirm all direct verifiers moved**

Run:

```bash
rg -n '"verify":' apps/*/package.json packages/*/package.json
```

Expected: every direct tsx entry used as a test starts with `tests/`.

- [ ] **Step 3: Run every affected module directly**

Run:

```bash
pnpm --filter @transitmapper/core typecheck
pnpm --filter @transitmapper/core verify
pnpm --filter @transitmapper/eslint-plugin typecheck
pnpm --filter @transitmapper/eslint-plugin verify
pnpm --filter @transitmapper/pwa-updater typecheck
pnpm --filter @transitmapper/pwa-updater verify
pnpm --filter @transitmapper/worker typecheck
pnpm --filter @transitmapper/worker verify
pnpm --filter @transitmapper/web typecheck
pnpm --filter @transitmapper/web verify
```

Expected Vitest totals: 83 files and 517 cases, with the per-module counts
recorded in the execution precondition. Both sequential suites and the
maskable-icon verifier also pass.

- [ ] **Step 4: Run the complete repository bar**

Run:

```bash
pnpm check
```

Expected: formatting, lint, typecheck, tests, generated references,
migrations, structure, documents, and workspace contracts all pass without
a browser or network.

- [ ] **Step 5: Re-run generators from the clean final tree**

Run:

```bash
test -z "$(git status --porcelain=v1)"
pnpm check:generators
test -z "$(git status --porcelain=v1)"
```

Expected: generated package and lint-rule output use module-root `tests/`,
pass `pnpm check`, and leave the worktree clean.

- [ ] **Step 6: Verify history and handoff**

Run:

```bash
git log --oneline --decorate -8
git status --porcelain=v1 -b
```

Expected: the narrow refactor commits are present, unrelated work is absent,
and the final worktree is clean.

## Appendix A: Exact Move Map

### `apps/web`

```text
apps/web/src/editor/actions/pointActions.test.ts -> apps/web/tests/editor/actions/pointActions.test.ts
apps/web/src/editor/actions/serviceActions.test.ts -> apps/web/tests/editor/actions/serviceActions.test.ts
apps/web/src/editor/gtfsImportTarget.test.ts -> apps/web/tests/editor/gtfsImportTarget.test.ts
apps/web/src/editor/historyCheckpoint.test.ts -> apps/web/tests/editor/historyCheckpoint.test.ts
apps/web/src/editor/networkGestureStore.test.ts -> apps/web/tests/editor/networkGestureStore.test.ts
apps/web/src/editor/pointerIntent.test.ts -> apps/web/tests/editor/pointerIntent.test.ts
apps/web/src/editor/storePatternFocus.test.ts -> apps/web/tests/editor/storePatternFocus.test.ts
apps/web/src/embed/config.test.ts -> apps/web/tests/embed/config.test.ts
apps/web/src/import/reconcileRtcGtfs.test.ts -> apps/web/tests/import/reconcileRtcGtfs.test.ts
apps/web/src/import/streamRtcGtfs.test.ts -> apps/web/tests/import/streamRtcGtfs.test.ts
apps/web/src/import/waitForQuiet.test.ts -> apps/web/tests/import/waitForQuiet.test.ts
apps/web/src/map/gestureLayerMask.test.ts -> apps/web/tests/map/gestureLayerMask.test.ts
apps/web/src/map/gestureProjection.test.ts -> apps/web/tests/map/gestureProjection.test.ts
apps/web/src/map/initialStyleFallback.test.ts -> apps/web/tests/map/initialStyleFallback.test.ts
apps/web/src/map/interactions.test.ts -> apps/web/tests/map/interactions.test.ts
apps/web/src/map/layers/layerSpecs.test.ts -> apps/web/tests/map/layers/layerSpecs.test.ts
apps/web/src/map/sourceFeatureProjection.test.ts -> apps/web/tests/map/sourceFeatureProjection.test.ts
apps/web/src/map/sourceUploadPlan.test.ts -> apps/web/tests/map/sourceUploadPlan.test.ts
apps/web/src/map/viewEditorState.test.ts -> apps/web/tests/map/viewEditorState.test.ts
apps/web/src/network/cancelableFlight.test.ts -> apps/web/tests/network/cancelableFlight.test.ts
apps/web/src/network/fetchWithTimeout.test.ts -> apps/web/tests/network/fetchWithTimeout.test.ts
apps/web/src/perf/budget.test.ts -> apps/web/tests/perf/budget.test.ts
apps/web/src/perf/bundleBudget.test.ts -> apps/web/tests/perf/bundleBudget.test.ts
apps/web/src/perf/calibration.test.ts -> apps/web/tests/perf/calibration.test.ts
apps/web/src/perf/fixtures.test.ts -> apps/web/tests/perf/fixtures.test.ts
apps/web/src/perf/gestureGate.test.ts -> apps/web/tests/perf/gestureGate.test.ts
apps/web/src/perf/gestureStats.test.ts -> apps/web/tests/perf/gestureStats.test.ts
apps/web/src/perf/journeyProof.test.ts -> apps/web/tests/perf/journeyProof.test.ts
apps/web/src/perf/mapPaintMark.test.ts -> apps/web/tests/perf/mapPaintMark.test.ts
apps/web/src/perf/paintedFrameCapture.test.ts -> apps/web/tests/perf/paintedFrameCapture.test.ts
apps/web/src/perf/persistencePolicy.test.ts -> apps/web/tests/perf/persistencePolicy.test.ts
apps/web/src/perf/pwaPrecache.test.ts -> apps/web/tests/perf/pwaPrecache.test.ts
apps/web/src/perf/report.test.ts -> apps/web/tests/perf/report.test.ts
apps/web/src/perf/soakPolicy.test.ts -> apps/web/tests/perf/soakPolicy.test.ts
apps/web/src/pwa/install.test.ts -> apps/web/tests/pwa/install.test.ts
apps/web/src/pwa/persistence.test.ts -> apps/web/tests/pwa/persistence.test.ts
apps/web/src/pwa/settings.test.ts -> apps/web/tests/pwa/settings.test.ts
apps/web/src/services/userPreferences.test.ts -> apps/web/tests/services/userPreferences.test.ts
apps/web/src/share/exportOperation.test.ts -> apps/web/tests/share/exportOperation.test.ts
apps/web/src/share/previewImage.test.ts -> apps/web/tests/share/previewImage.test.ts
apps/web/src/share/previewWorker.test.ts -> apps/web/tests/share/previewWorker.test.ts
apps/web/src/share/publish.test.ts -> apps/web/tests/share/publish.test.ts
apps/web/src/share/svgWorker.test.ts -> apps/web/tests/share/svgWorker.test.ts
apps/web/src/sim/vehicles.test.ts -> apps/web/tests/sim/vehicles.test.ts
apps/web/src/storage/bootstrapLibrary.test.ts -> apps/web/tests/storage/bootstrapLibrary.test.ts
apps/web/src/storage/deleteAfterFlush.test.ts -> apps/web/tests/storage/deleteAfterFlush.test.ts
apps/web/src/storage/indexedDbLibrary.test.ts -> apps/web/tests/storage/indexedDbLibrary.test.ts
apps/web/src/storage/libraryStore.test.ts -> apps/web/tests/storage/libraryStore.test.ts
apps/web/src/storage/localStoreAvailability.test.ts -> apps/web/tests/storage/localStoreAvailability.test.ts
apps/web/src/storage/localStoreMeasurement.test.ts -> apps/web/tests/storage/localStoreMeasurement.test.ts
apps/web/src/storage/persistenceCoordinator.test.ts -> apps/web/tests/storage/persistenceCoordinator.test.ts
apps/web/src/storage/serializeSystem.test.ts -> apps/web/tests/storage/serializeSystem.test.ts
apps/web/src/ui/ExportPreviewMap.test.ts -> apps/web/tests/ui/ExportPreviewMap.test.ts
apps/web/src/ui/SidebarPanel.test.tsx -> apps/web/tests/ui/SidebarPanel.test.tsx
apps/web/src/ui/Workbench.test.tsx -> apps/web/tests/ui/Workbench.test.tsx
apps/web/src/ui/inspector/ServiceInspector.test.ts -> apps/web/tests/ui/inspector/ServiceInspector.test.ts
apps/web/src/ui/mapContextMenuLifecycle.test.ts -> apps/web/tests/ui/mapContextMenuLifecycle.test.ts
apps/web/src/ui/sidebarOutline.test.ts -> apps/web/tests/ui/sidebarOutline.test.ts
apps/web/scripts/verify.ts -> apps/web/tests/verify.ts
apps/web/scripts/verify-maskable-icon.ts -> apps/web/tests/verify-maskable-icon.ts
```

### `apps/worker`

```text
apps/worker/src/shares.test.ts -> apps/worker/tests/shares.test.ts
apps/worker/scripts/verify.ts -> apps/worker/tests/verify.ts
```

### `packages/core`

```text
packages/core/src/geometry/vehicleLane.test.ts -> packages/core/tests/geometry/vehicleLane.test.ts
packages/core/src/model/diagramLayout.test.ts -> packages/core/tests/model/diagramLayout.test.ts
packages/core/src/model/gtfsArchive.test.ts -> packages/core/tests/model/gtfsArchive.test.ts
packages/core/src/model/gtfsPairing.test.ts -> packages/core/tests/model/gtfsPairing.test.ts
packages/core/src/model/importNetwork.test.ts -> packages/core/tests/model/importNetwork.test.ts
packages/core/src/model/patternRuns.test.ts -> packages/core/tests/model/patternRuns.test.ts
packages/core/src/model/profile.test.ts -> packages/core/tests/model/profile.test.ts
packages/core/src/model/routeGraph.test.ts -> packages/core/tests/model/routeGraph.test.ts
packages/core/src/model/selectionActions.test.ts -> packages/core/tests/model/selectionActions.test.ts
packages/core/src/model/selectionRelations.test.ts -> packages/core/tests/model/selectionRelations.test.ts
packages/core/src/model/serviceEdits.test.ts -> packages/core/tests/model/serviceEdits.test.ts
packages/core/src/model/serviceGestures.test.ts -> packages/core/tests/model/serviceGestures.test.ts
packages/core/src/model/throughRoute.test.ts -> packages/core/tests/model/throughRoute.test.ts
packages/core/src/model/units.test.ts -> packages/core/tests/model/units.test.ts
packages/core/src/model/validate.test.ts -> packages/core/tests/model/validate.test.ts
packages/core/src/model/wrongWay.test.ts -> packages/core/tests/model/wrongWay.test.ts
packages/core/src/render/buildFeatures.partial.test.ts -> packages/core/tests/render/buildFeatures.partial.test.ts
packages/core/src/render/buildFeatures.test.ts -> packages/core/tests/render/buildFeatures.test.ts
packages/core/src/render/mergeServiceLines.test.ts -> packages/core/tests/render/mergeServiceLines.test.ts
packages/core/src/share/contract.test.ts -> packages/core/tests/share/contract.test.ts
packages/core/src/sim/runTimetables.test.ts -> packages/core/tests/sim/runTimetables.test.ts
packages/core/src/sim/serviceStats.test.ts -> packages/core/tests/sim/serviceStats.test.ts
packages/core/src/testing/fixtures.ts -> packages/core/tests/support/fixtures.ts
```

### Other packages

```text
packages/eslint-plugin/src/core-runtime-purity.test.ts -> packages/eslint-plugin/tests/core-runtime-purity.test.ts
packages/pwa-updater/src/reloadAfterFlush.test.ts -> packages/pwa-updater/tests/reloadAfterFlush.test.ts
```
