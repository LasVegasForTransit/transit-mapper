# Enforcement Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `pnpm check` the complete, single definition of a valid working tree, enforced locally by git hooks and authoritatively by CI.

**Architecture:** Every check becomes a Turborepo task with declared inputs, composed into one `check` task. Four enforcement layers wrap it: an agent hook that formats on edit, a pre-commit hook that auto-fixes staged files, a pre-push hook that runs everything, and CI that runs everything authoritatively. Hook shell scripts are ported from the sibling `website` repository rather than written fresh.

**Tech Stack:** Turborepo 2.10.5, pnpm 11.15.1, TypeScript 7.0.2, Prettier 3, ESLint 9 flat config with typescript-eslint, gitleaks, lint-staged.

This is track 1 of `docs/superpowers/specs/2026-07-26-repo-harness-design.md`, plus the three secret-scanning nets that spec's Sequencing section pulls forward into track 1. Track 2 (Vitest) is a separate plan; here `test` wraps the existing `apps/web/scripts/verify.ts` so this track ships on its own.

## Global Constraints

- Line width for Markdown prose: 76 characters. Prettier does not reflow prose; wrap by hand.
- Prettier config is copied verbatim from `website/.prettierrc.json`: `printWidth: 100`, `singleQuote: true`, `trailingComma: "all"`. Do not add the `prettier-plugin-astro` plugin — there is no Astro here.
- Never add `composite: true` or `references` to any tsconfig. `tsc -b --noEmit` raises TS6310 once a project has outgoing references; this repository already hit it. Every tsconfig stays an independent leaf with its own `noEmit: true`.
- pnpm build-script approval lives in `pnpm-workspace.yaml` under `allowBuilds`, not in `package.json`. pnpm 11 ignores the old location.
- Turborepo tasks must share the exact name of the package script they wrap.
- `dev`, `preview`, and `worker:dev` stay off the Turborepo graph.
- Every failure message ends with the exact command that fixes it.
- Do not fix any type error by adding `any`, `@ts-ignore`, or `@ts-expect-error`. Widening with an explicit annotation is fine; a cast is not.

---

### Task 1: Prettier and the `format` task

**Files:**

- Create: `.prettierrc.json`, `.prettierignore`
- Modify: `package.json` (devDependency + scripts), `turbo.json`

**Interfaces:**

- Produces: root scripts `format` (writes) and `format:check` (verifies); turbo tasks of the same names.

- [ ] **Step 1: Install Prettier**

```bash
pnpm add -Dw prettier@^3
```

- [ ] **Step 2: Create `.prettierrc.json`**

Copied from `website/.prettierrc.json`, minus the Astro plugin and override.

```json
{
  "printWidth": 100,
  "singleQuote": true,
  "trailingComma": "all"
}
```

- [ ] **Step 3: Create `.prettierignore`**

```
node_modules/
dist/
.turbo/
.wrangler/
.claude/worktrees/
pnpm-lock.yaml
*.tsbuildinfo
.env*
```

- [ ] **Step 4: Add root scripts**

In `package.json` `scripts`:

```json
"format": "prettier --write .",
"format:check": "prettier --check ."
```

- [ ] **Step 5: Verify it fails before formatting**

Run: `pnpm format:check`
Expected: FAIL, listing many files. This confirms the check is live.

- [ ] **Step 6: Format the repository**

Run: `pnpm format`

- [ ] **Step 7: Verify it now passes**

Run: `pnpm format:check`
Expected: `All matched files use Prettier code style!`

- [ ] **Step 8: Confirm nothing broke**

Run: `pnpm typecheck --force && pnpm verify --force`
Expected: both pass. `--force` matters — a cache replay would not re-check the reformatted files.

- [ ] **Step 9: Commit**

The formatting diff is large and mechanical. Keep it in its own commit so later diffs stay readable.

```bash
git add -A
git commit -m "style: adopt prettier, and format the repository

Copied from website/.prettierrc.json so both repositories share one
formatter configuration ahead of the track 9 extraction. This commit is
entirely mechanical; typecheck and verify were re-run with --force
afterwards to confirm a cache replay was not hiding a break."
```

---

### Task 2: `pnpm preflight` — detect a stale `node_modules`

**Files:**

- Create: `scripts/doctor.ts`
- Modify: `package.json` (scripts: `doctor`, `postinstall`)

**Interfaces:**

- Produces: `scripts/doctor.ts` exporting `checkLockfileSync(): Promise<DoctorResult>`; root script `pnpm preflight`.

**Why this exists:** while writing the spec, `pnpm-lock.yaml` pinned wrangler 4.114.0 while the installed tree was 3.114.17. CI installs with `--frozen-lockfile` and would have used 4.x while a developer used 3.x. Nothing reported it. pnpm has no built-in "is my tree in sync" command, so we record the lockfile hash at install time and compare.

- [ ] **Step 1: Write `scripts/doctor.ts`**

```ts
#!/usr/bin/env tsx
/**
 * Environment doctor. Reports problems that make a local checkout behave
 * differently from CI, and repairs the ones that can be repaired.
 *
 * The lockfile check exists because pnpm offers no way to ask "does my
 * node_modules match pnpm-lock.yaml?". `postinstall` records the hash of
 * the lockfile that produced the current tree; if the lockfile has since
 * changed, the tree is stale.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const LOCKFILE = resolve(ROOT, 'pnpm-lock.yaml');
const STAMP = resolve(ROOT, 'node_modules/.lvbt-lockfile-hash');

interface DoctorResult {
  ok: boolean;
  problem?: string;
  fix?: string;
}

async function lockfileHash(): Promise<string> {
  const contents = await readFile(LOCKFILE);
  return createHash('sha256').update(contents).digest('hex');
}

export async function recordLockfileHash(): Promise<void> {
  await mkdir(dirname(STAMP), { recursive: true });
  await writeFile(STAMP, await lockfileHash(), 'utf8');
}

export async function checkLockfileSync(): Promise<DoctorResult> {
  const expected = await lockfileHash();
  let recorded: string;
  try {
    recorded = (await readFile(STAMP, 'utf8')).trim();
  } catch {
    return {
      ok: false,
      problem: 'node_modules has no install stamp, so it may predate the lockfile.',
      fix: 'pnpm install --frozen-lockfile',
    };
  }
  if (recorded !== expected) {
    return {
      ok: false,
      problem: 'node_modules was installed from a different pnpm-lock.yaml than the one on disk.',
      fix: 'pnpm install --frozen-lockfile',
    };
  }
  return { ok: true };
}

async function main(): Promise<void> {
  const results = [await checkLockfileSync()];
  const failures = results.filter((r) => !r.ok);

  if (failures.length === 0) {
    console.log('doctor: environment is healthy.');
    return;
  }

  for (const f of failures) {
    console.error(`\ndoctor: ${f.problem}`);
    console.error(`  fix:  ${f.fix}`);
  }
  console.error('');
  process.exit(1);
}

// Only run when invoked directly, so `recordLockfileHash` can be imported.
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 2: Write the stamp-recording entry point**

Create `scripts/record-install.ts`:

```ts
#!/usr/bin/env tsx
import { recordLockfileHash } from './doctor.js';

await recordLockfileHash();
```

- [ ] **Step 3: Wire both into `package.json` scripts**

```json
"preflight": "tsx scripts/doctor.ts",
"postinstall": "tsx scripts/record-install.ts"
```

- [ ] **Step 4: Verify the healthy path**

Run: `pnpm install --frozen-lockfile && pnpm preflight`
Expected: `doctor: environment is healthy.`, exit 0.

- [ ] **Step 5: Verify the drift path**

```bash
printf '\n# drift probe\n' >> pnpm-lock.yaml
pnpm preflight; echo "exit=$?"
git checkout pnpm-lock.yaml
```

Expected: exit 1, with the problem line and `fix:  pnpm install --frozen-lockfile`.

- [ ] **Step 6: Restore and confirm green**

Run: `pnpm preflight`
Expected: healthy, exit 0.

- [ ] **Step 7: Commit**

```bash
git add scripts/doctor.ts scripts/record-install.ts package.json
git commit -m "feat: add pnpm preflight, which catches a stale node_modules

The lockfile pinned wrangler 4.114.0 while the installed tree was
3.114.17, and nothing anywhere reported it. CI installs with
--frozen-lockfile, so a developer and CI can silently run different
toolchains. pnpm has no built-in way to ask whether the tree matches the
lockfile, so postinstall records the lockfile hash and doctor compares."
```

---

### Task 3: Close the typecheck blind spot

**Files:**

- Create: `apps/web/tsconfig.node.json`
- Modify: `apps/web/package.json` (typecheck script), `apps/web/scripts/verify.ts` (nine errors)

**Interfaces:**

- Produces: `pnpm typecheck` covers `apps/web/scripts/` as well as `apps/web/src/`.

**Context:** `apps/web/tsconfig.json` has `"include": ["src"]`, so the 3,202-line test suite has never been typechecked. Under a correct node leaf it surfaces nine real errors. Widening the existing config instead reports 28, but 18 of those are artefacts of `"types": ["vite/client"]` disabling automatic `@types` resolution; the node config must not inherit that narrowing.

- [ ] **Step 1: Create `apps/web/tsconfig.node.json`**

A fully independent leaf. No `composite`, no `references`.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["scripts", "vite.config.ts"]
}
```

- [ ] **Step 2: Point the package's typecheck at both leaves**

In `apps/web/package.json`:

```json
"typecheck": "tsc -b --noEmit && tsc -p tsconfig.node.json --noEmit"
```

- [ ] **Step 3: Run it and capture the full error list**

Run: `pnpm --filter @transitmapper/web typecheck`
Expected: FAIL with **nine** errors, all in `scripts/verify.ts`.

Not 28. Widening the _existing_ config's include reports 28, but 18 of
those are artefacts of `"types": ["vite/client"]` disabling automatic
`@types` resolution — 2 × TS2307 for a missing `geojson` module, and 16 ×
TS7006 where callback parameters lose their contextual type as a
consequence. The node leaf created in Step 1 does not set `types` at all,
so all 18 never appear. If you see them, Step 1's config is wrong; fix the
config rather than the code.

- [ ] **Step 4: Fix the four duplicate identifiers**

`snap` and `squareFootprint` are each imported twice from
`@transitmapper/core/model/geo`. Delete the second import block's
specifiers for both, leaving `bearingDegrees`, `formatBearing`, and
`haversineMeters`.

- [ ] **Step 5: Fix the two unused locals**

`patternPath` is an unused import specifier — delete it. `groupId` binds
the result of `createGroup(...)`; **keep the call**, which has the side
effect the case depends on, and drop only the binding.

- [ ] **Step 6: Fix the `TS2345` OSM fixture mismatch**

TypeScript unions the four object literals and gives `tags` a shape like
`{ highway: string; railway?: undefined }`, which is not assignable to
`OsmWayElement["tags"]` (`Record<string, string>`). Annotate at the
declaration, and add the type import:

```ts
import type { OsmWayElement } from '@transitmapper/core/model/import';
// ...
const elements: OsmWayElement[] = [/* ...existing fixture... */];
```

- [ ] **Step 7: Fix the `TS2531` selection read**

`store.getState().selection?.kind === 'station' && store.getState().selection.id === sid`
calls `getState()` twice, so narrowing the first tells TypeScript nothing
about the second. Read it once into a local and narrow that.

- [ ] **Step 8: Fix the `TS2367` brand-token comparison**

`LVBT.light.surfaceContainer !== LVBT.light.surface` compares two `as const`
literals, which TypeScript can decide statically. Do not delete the check —
it is what fails if someone edits the two tokens to the same value. Widen
one side with an annotation, not a cast:

```ts
const raisedSurface: string = LVBT.light.surfaceContainer;
check('the panel and the ground are different tokens', raisedSurface !== LVBT.light.surface);
```

- [ ] **Step 9: Verify zero errors**

Run: `pnpm --filter @transitmapper/web typecheck`
Expected: PASS, no output.

- [ ] **Step 10: Confirm the suite still runs**

Run: `pnpm verify --force`
Expected: `ALL PASS`.

- [ ] **Step 11: Commit**

```bash
git add apps/web/tsconfig.node.json apps/web/package.json apps/web/scripts/verify.ts
git commit -m "fix: typecheck the test suite, which never had been

apps/web/tsconfig.json includes only \"src\", so the 3,202-line
verify.ts had never been typechecked and had drifted into nine errors:
four duplicate identifiers from snap and squareFootprint being imported
twice, two unused locals, a type mismatch in the OSM fixtures, an unsafe
selection read, and a brand-token comparison TypeScript can decide
statically.

A further 18 errors appear if you widen the existing config instead of
adding a new leaf, but they are artefacts of types: [vite/client]
disabling automatic @types resolution, not defects. The new leaf does not
inherit that narrowing, so the two configurations now agree about core's
source.

A second independent tsconfig rather than project references: tsc -b
--noEmit raises TS6310 once a project has outgoing references."
```

---

### Task 4: ESLint baseline

**Files:**

- Create: `eslint.config.js`
- Modify: `package.json`, `turbo.json`, each workspace `package.json` (add `lint` script)

**Interfaces:**

- Produces: root scripts `lint` and `lint:fix`; a `lint` script in every workspace package.

Custom repo-specific rules are **track 3**, not this task. This establishes the mechanism only.

- [ ] **Step 1: Install**

```bash
pnpm add -Dw eslint@^9 typescript-eslint@^8 eslint-config-prettier@^10
```

- [ ] **Step 2: Create `eslint.config.js`**

`eslint-config-prettier` goes last so it disables every stylistic rule that would fight Prettier. No repository-specific paths appear here, so track 9 can extract it unchanged.

```js
// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/.wrangler/**',
      '.claude/worktrees/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Track 3 replaces this with type-aware repo-specific rules. Until
      // then, keep the baseline quiet enough that a real violation stands out.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  prettier,
);
```

- [ ] **Step 3: Add root scripts**

```json
"lint": "eslint .",
"lint:fix": "eslint . --fix"
```

- [ ] **Step 4: Run it and see what it reports**

Run: `pnpm lint`
Expected: some findings. Record the count.

- [ ] **Step 5: Auto-fix what is fixable**

Run: `pnpm lint:fix && pnpm lint`

- [ ] **Step 6: Fix the remainder by hand**

Do not silence anything with `eslint-disable` unless you write the reason on the same line. If a rule is genuinely wrong for this codebase, turn it off in `eslint.config.js` with a comment saying why.

- [ ] **Step 7: Verify clean**

Run: `pnpm lint`
Expected: exit 0, no output.

- [ ] **Step 8: Verify nothing broke**

Run: `pnpm typecheck --force && pnpm verify --force`

- [ ] **Step 9: Commit**

```bash
git add eslint.config.js package.json
git commit -m "feat: add an eslint baseline

The repository had no linter at all. This is the mechanism only; the
repo-specific type-aware rules that encode AGENTS.md land in track 3.

eslint-config-prettier is last so it disables everything that would
fight the formatter. No repository-specific paths appear in the config,
so the track 9 extraction can move it unchanged. website has no ESLint,
which makes this the org's first and therefore the shared baseline."
```

---

### Task 5: The `check` composite task

**Files:**

- Modify: `turbo.json`, `package.json`, `apps/web/package.json`, `apps/worker/package.json`, `packages/core/package.json`
- Modify: `README.md`, `AGENTS.md`, `docs/development/how-to/local-development.md`, `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: `format:check` (Task 1), `lint` (Task 4), `typecheck` (Task 3).
- Produces: `pnpm check` and `pnpm check --fix`; the `verify` task renamed to `test` everywhere.

- [ ] **Step 1: Rename the `verify` script to `test`**

In `apps/web/package.json`, rename `"verify": "tsx scripts/verify.ts"` to `"test": "tsx scripts/verify.ts"`. Track 2 replaces the command; the task name is what matters now.

- [ ] **Step 2: Add a `lint` script to every workspace package**

Each of `apps/web`, `apps/worker`, `packages/core` gets:

```json
"lint": "eslint ."
```

- [ ] **Step 3: Rewrite `turbo.json` with declared inputs**

Inputs are what make the cache correct: editing `eslint.config.js` must invalidate `lint` and nothing else.

```json
{
  "$schema": "https://turborepo.com/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", "*.tsbuildinfo"]
    },
    "typecheck": {
      "dependsOn": ["^typecheck"],
      "inputs": ["src/**", "scripts/**", "tsconfig*.json"],
      "outputs": ["*.tsbuildinfo"]
    },
    "lint": {
      "inputs": ["src/**", "scripts/**", "$TURBO_ROOT$/eslint.config.js"],
      "outputs": []
    },
    "test": {
      "dependsOn": ["^typecheck"],
      "inputs": ["src/**", "scripts/**"],
      "outputs": []
    },
    "check": {
      "dependsOn": ["lint", "typecheck", "test"],
      "outputs": []
    }
  }
}
```

- [ ] **Step 4: Add the root `check` scripts**

`format:check` and `contract` are root-level (they span the repo, not one package), so `check` runs them directly and then fans out through turbo.

```json
"check": "pnpm format:check && turbo run check",
"check:fix": "pnpm format && pnpm lint:fix && turbo run check"
```

- [ ] **Step 5: Run it**

Run: `pnpm check`
Expected: PASS across all three packages.

- [ ] **Step 6: Verify the cache is scoped correctly**

```bash
pnpm check                      # populate
pnpm check                      # expect FULL TURBO
touch eslint.config.js
pnpm check                      # lint re-runs; typecheck and test replay
```

Expected: the third run shows `lint` executing and `typecheck`/`test` as cache hits. If typecheck also re-runs, the `inputs` globs are wrong — fix them before moving on.

- [ ] **Step 7: Verify a real failure is caught**

```bash
echo 'const unusedOnPurpose: number = "not a number";' >> packages/core/src/model/geo.ts
pnpm check; echo "exit=$?"
git checkout packages/core/src/model/geo.ts
```

Expected: non-zero exit naming the file.

- [ ] **Step 8: Update every reference to `verify`**

Search and replace across `README.md`, `AGENTS.md`, `docs/development/how-to/local-development.md`, and `.github/workflows/ci.yml`. `pnpm typecheck && pnpm verify` becomes `pnpm check` everywhere it appears as the pull-request bar.

Run: `grep -rn "pnpm verify\|pnpm run verify" --include='*.md' --include='*.yml' --include='*.json' . | grep -v node_modules`
Expected: no results.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: pnpm check is now the definition of a valid tree

One command runs format, lint, typecheck and test, so a red CI run maps
to exactly one local command and nobody has to know which of four tools
complained. pnpm check --fix repairs everything a machine can.

Every task declares its inputs, so editing eslint.config.js invalidates
the lint cache and only the lint cache. Verified by touching the config
and confirming typecheck and test still replayed from cache.

The verify task is renamed test, matching what track 2 will put behind
it, and every reference to the old two-command bar is updated."
```

---

### Task 6: The workspace contract check

**Files:**

- Create: `scripts/check-workspace-contract.ts`
- Modify: `package.json` (script + fold into `check`)

**Interfaces:**

- Consumes: `turbo query`, which returns `{ data: { packages: { items: [{ name, path }] } } }` and includes the root package as `name: "//"`.
- Produces: root script `check:contract`.

**Why:** `apps/worker` declares no test script today, so it is skipped without an error and CI stays green. The Worker — the only component touching D1, cookies, and untrusted input — is untested and invisibly so.

- [ ] **Step 1: Write the failing check**

Create `scripts/check-workspace-contract.ts`:

```ts
#!/usr/bin/env tsx
/**
 * Every workspace package must declare every task the repository's
 * enforcement depends on. A package missing one is skipped by Turborepo
 * without an error, so CI stays green while the package goes unchecked —
 * which is exactly how apps/worker ended up with no tests at all.
 *
 * The package list comes from `turbo query` rather than from parsing
 * pnpm-workspace.yaml, so this agrees with the build graph by construction.
 */
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

/** Tasks every package must define. `build` is deliberately absent: a
 *  package that ships raw TypeScript source has nothing to build. */
const REQUIRED_TASKS = ['lint', 'typecheck', 'test'] as const;

interface TurboPackage {
  name: string;
  path: string;
}

function listPackages(): TurboPackage[] {
  const raw = execFileSync(
    'npx',
    ['turbo', 'query', 'query { packages { items { name path } } }'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  const parsed = JSON.parse(raw.slice(raw.indexOf('{'))) as {
    data: { packages: { items: TurboPackage[] } };
  };
  // "//" is the workspace root, which is not a package and defines the
  // orchestrating scripts rather than the tasks being orchestrated.
  return parsed.data.packages.items.filter((p) => p.name !== '//');
}

async function main(): Promise<void> {
  const failures: string[] = [];

  for (const pkg of listPackages()) {
    const manifestPath = resolve(ROOT, pkg.path, 'package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const scripts = manifest.scripts ?? {};
    for (const task of REQUIRED_TASKS) {
      if (!scripts[task]) {
        failures.push(`${pkg.name} (${pkg.path}/package.json) has no "${task}" script`);
      }
    }
  }

  if (failures.length > 0) {
    console.error('\nworkspace contract: packages are missing required scripts.\n');
    for (const f of failures) console.error(`  ${f}`);
    console.error(
      '\nA package without one of these is skipped by Turborepo without an' +
        '\nerror, so CI passes while the package goes unchecked.' +
        `\n  fix:  add the missing script, or scaffold the package with \`turbo gen\`\n`,
    );
    process.exit(1);
  }

  console.log('workspace contract: all packages declare every required task.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Wire it up**

In root `package.json`:

```json
"check:contract": "tsx scripts/check-workspace-contract.ts",
"check": "pnpm format:check && pnpm check:contract && turbo run check"
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm check:contract`
Expected: FAIL. `@transitmapper/worker` and `@transitmapper/core` have no `test` script; the worker also has no `lint` script until Task 4 Step 2 added it.

- [ ] **Step 4: Add the missing scripts**

`apps/worker/package.json` and `packages/core/package.json` each need a `test` script. Neither has tests yet — track 2 adds them. Until then, declare the task honestly rather than falsely:

```json
"test": "echo 'no tests yet — see docs/superpowers/plans (track 2)' && exit 0"
```

This is deliberately visible in CI output. Track 2 replaces both with `vitest run`.

- [ ] **Step 5: Verify it passes**

Run: `pnpm check:contract`
Expected: `workspace contract: all packages declare every required task.`

- [ ] **Step 6: Verify it catches a regression**

```bash
node -e "const p=require('./apps/worker/package.json');delete p.scripts.test;require('fs').writeFileSync('./apps/worker/package.json',JSON.stringify(p,null,2)+'\n')"
pnpm check:contract; echo "exit=$?"
git checkout apps/worker/package.json
```

Expected: exit 1, naming `@transitmapper/worker` and the missing `test` script.

- [ ] **Step 7: Commit**

```bash
git add scripts/check-workspace-contract.ts package.json apps/worker/package.json packages/core/package.json
git commit -m "feat: fail when a package skips a required task

apps/worker declared no verify script, so Turborepo skipped it without
an error and CI stayed green. The Worker is the only component touching
D1, cookies and untrusted input, and it was untested — invisibly.

The package list comes from turbo query rather than from parsing
pnpm-workspace.yaml, so the check agrees with the build graph by
construction. The root package is excluded; it orchestrates tasks rather
than defining them.

core and worker get placeholder test scripts that say so out loud. Track
2 replaces both with vitest run."
```

---

### Task 7: Git hooks

**Files:**

- Create: `.githooks/pre-commit`, `.githooks/pre-push`, `.githooks/commit-msg`
- Create: `docs/development/reference/commit-messages.md`
- Modify: `package.json` (`prepare` script, `lint-staged` config)

**Interfaces:**

- Consumes: `pnpm check` (Task 5), `pnpm preflight` (Task 2).
- Produces: hooks installed via `core.hooksPath`.

Port the structure from `website/.githooks/`. Its pre-push has the DX this repository wants: numbered steps, timings, and an explicit `Fix:` block naming the command. Adapt rather than copy line-for-line — this repo has no Astro, no LFS, and no `allowed-scopes.txt`.

- [ ] **Step 1: Install lint-staged**

```bash
pnpm add -Dw lint-staged@^17
```

- [ ] **Step 2: Add the `lint-staged` config and `prepare` script**

In root `package.json`:

```json
"prepare": "git config --local core.hooksPath .githooks 2>/dev/null || true",
"lint-staged": {
  "*": "prettier --write --ignore-unknown",
  "*.{ts,tsx}": "eslint --fix"
}
```

- [ ] **Step 3: Write `.githooks/pre-commit`**

Layer 1 auto-fixes and blocks on nothing fixable. Target under two seconds.

```sh
#!/usr/bin/env sh
# Layer 1: auto-fix staged files. This hook must never block on anything a
# machine can repair — a hook that is slow or scolds gets bypassed with
# --no-verify, and a bypassed hook enforces nothing. CI is the guarantee.
set -e
cd "$(git rev-parse --show-toplevel)"

STAGED="$(git diff --cached --name-only --diff-filter=ACMR)"
[ -z "$STAGED" ] && exit 0

if ! pnpm --silent exec lint-staged; then
  printf '\n❌ Commit blocked: lint-staged failed.\n'
  printf '   fix:  pnpm check --fix\n\n' >&2
  exit 1
fi

# Secret scanning, net 1 of 3. Nets 2 and 3 are CI and GitHub push
# protection, because this one is bypassable by design.
if command -v gitleaks >/dev/null 2>&1; then
  if ! gitleaks protect --staged --redact --no-banner; then
    printf '\n❌ Commit blocked: a secret was detected in the staged changes.\n'
    printf '   Remove it, then rotate it — assume anything written down is burned.\n'
    printf '   See docs/development/reference/checks.md\n\n' >&2
    exit 1
  fi
else
  printf 'warn: gitleaks not installed; skipping secret scan. Run `pnpm bootstrap`.\n' >&2
fi
```

- [ ] **Step 4: Write `.githooks/pre-push`**

Layer 2 runs everything. Adapted from `website/.githooks/pre-push`, minus the LFS and build steps.

```sh
#!/usr/bin/env bash
# Layer 2: run the full bar before anything leaves the laptop. Layer 3 (CI)
# is still the authority; this exists so a red CI run is rare rather than
# routine.
set -e
cd "$(git rev-parse --show-toplevel)"

BOLD='\033[1m'; DIM='\033[2m'; RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; RESET='\033[0m'
[ -t 1 ] || { BOLD=''; DIM=''; RED=''; GREEN=''; CYAN=''; RESET=''; }

TOTAL_STEPS=2
step() { printf "\n${CYAN}${BOLD}[%s/%s]${RESET} %s\n" "$1" "$TOTAL_STEPS" "$2"; }
fail() { printf "\n  ${RED}${BOLD}Push blocked${RESET} -- %s\n" "$1"; }
cmd()  { printf "    ${BOLD}%s${RESET}\n" "$1"; }

BRANCH=$(git rev-parse --abbrev-ref HEAD)
UPSTREAM=$(git rev-parse --abbrev-ref "@{u}" 2>/dev/null || echo "")
BASE=${UPSTREAM:-main}
[ -n "$UPSTREAM" ] && BASE="@{u}"

if [ "$(git rev-list --count "${BASE}..HEAD" 2>/dev/null || echo 0)" -eq 0 ]; then
  printf "  ${DIM}No commits to push${RESET}\n"
  exit 0
fi

step 1 "Checking the local environment"
if ! pnpm --silent preflight; then
  fail "Local environment disagrees with the lockfile"
  cmd "pnpm install --frozen-lockfile"
  echo ""
  exit 1
fi

step 2 "Running pnpm check"
if ! pnpm check; then
  fail "pnpm check failed"
  echo ""
  cmd "pnpm check --fix   # repairs everything a machine can"
  cmd "pnpm check         # then re-run to see what is left"
  echo ""
  exit 1
fi

printf "\n${GREEN}${BOLD}All checks passed${RESET} ${DIM}(%ss)${RESET} -- pushing\n\n" "$SECONDS"
```

- [ ] **Step 5: Write `.githooks/commit-msg`**

`website` validates conventional-commit format against a written standard. Principle 7 says the standard has to exist, so this task writes it.

```sh
#!/usr/bin/env sh
# Commit messages follow conventional commits. The standard lives in
# docs/development/reference/commit-messages.md.
set -e
MSG_FILE="$1"
SUBJECT=$(head -1 "$MSG_FILE")

# Ignore merge and fixup commits, which git generates itself.
case "$SUBJECT" in
  "Merge "*|"fixup!"*|"squash!"*|"Revert "*) exit 0 ;;
esac

if ! printf '%s' "$SUBJECT" | grep -qE '^[a-z]+(\([a-z0-9._-]+\))?!?: .+'; then
  printf '\n❌ Commit blocked: subject is not a conventional commit.\n\n'
  printf '   got:      %s\n' "$SUBJECT"
  printf '   expected: type(optional-scope): description\n'
  printf '   example:  feat: add pnpm preflight\n\n'
  printf '   See docs/development/reference/commit-messages.md\n\n' >&2
  exit 1
fi

if [ "${#SUBJECT}" -gt 72 ]; then
  printf '\n❌ Commit blocked: subject is %s characters; the limit is 72.\n\n' "${#SUBJECT}" >&2
  exit 1
fi
```

- [ ] **Step 6: Write the standard the hook cites**

Create `docs/development/reference/commit-messages.md` documenting: allowed types (`feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `ci`, `chore`), the 72-character subject limit, when a body is required (`feat` and `fix` always), and the 72-column body wrap. Include two real examples taken from this repository's history.

- [ ] **Step 7: Make the hooks executable and install them**

```bash
chmod +x .githooks/pre-commit .githooks/pre-push .githooks/commit-msg
pnpm run prepare
git config --get core.hooksPath
```

Expected: `.githooks`

- [ ] **Step 8: Verify the commit-msg hook rejects and accepts**

```bash
git commit --allow-empty -m "bad subject with no type"; echo "exit=$?"
git commit --allow-empty -m "chore: verify the commit-msg hook accepts this"
git reset --hard HEAD~1
```

Expected: the first is rejected with the standard's path; the second succeeds.

- [ ] **Step 9: Verify pre-commit auto-formats**

```bash
printf 'export const x   =    1\n' > packages/core/src/probe.ts
git add packages/core/src/probe.ts
git commit -m "chore: probe the pre-commit formatter"
git show --stat HEAD
```

Expected: the committed file is Prettier-formatted. Then: `git reset --hard HEAD~1 && rm -f packages/core/src/probe.ts`

- [ ] **Step 10: Commit**

```bash
git add .githooks package.json docs/development/reference/commit-messages.md
git commit -m "feat: install the local enforcement layers

Layer 1 (pre-commit) auto-fixes staged files and blocks on nothing a
machine can repair, because a hook that is slow or scolds gets bypassed
with --no-verify and then enforces nothing. Layer 2 (pre-push) runs the
full bar. CI remains the authority.

Ported from website/.githooks, which already had the shape this needs:
numbered steps and an explicit Fix block naming the command. Trimmed to
this stack — no Astro, no LFS, no allowed-scopes file.

The commit-msg hook cites a written standard, so this adds the standard
rather than encoding the rules only in the hook."
```

---

### Task 8: Secret scanning and the agent gitignore gap

**Files:**

- Create: `.gitleaks.toml`
- Modify: `.gitignore`, `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: the pre-commit hook from Task 7.
- Produces: net 2 of 3 (CI). Net 3 (GitHub push protection) is a repository setting, documented here and enabled in track 5.

**The gap:** `.claude/settings.local.json` is currently ignored only by the maintainer's personal global gitignore, and `.claude/worktrees/` only by `.git/info/exclude`. Neither rule travels with the repository, so a fresh clone has no protection and a new contributor would commit personal agent settings on a first pull request.

- [ ] **Step 1: Close the gitignore gap**

Append to `.gitignore`:

```
# Agent configuration. settings.json is committed team policy;
# settings.local.json is personal and must never be. Both of these were
# previously covered only by machine-local git config, which does not
# travel with a clone.
.claude/settings.local.json
.claude/worktrees/
```

- [ ] **Step 2: Verify the rules now come from the repository**

```bash
git check-ignore -v .claude/settings.local.json .claude/worktrees/x
```

Expected: both attributed to `.gitignore`, not to `~/.config/git/ignore` or `.git/info/exclude`.

- [ ] **Step 3: Create `.gitleaks.toml`**

```toml
# Secret scanning configuration. Extends the upstream default ruleset;
# additions here are for values specific to this project.
[extend]
useDefault = true

[allowlist]
description = "Paths that contain no secrets but trip generic entropy rules."
paths = [
  '''pnpm-lock\.yaml''',
  '''docs/superpowers/.*\.md''',
]
```

- [ ] **Step 4: Add the CI job (net 2)**

In `.github/workflows/ci.yml`, add a step to the `validate` job. Full history is required so the scan covers the whole diff.

```yaml
- name: Scan for secrets
  uses: gitleaks/gitleaks-action@ff98106e4c7b2bc287b24eaf42907196329070c7 # v2.3.9
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Pin the SHA by resolving the current release tag yourself; do not copy the SHA above without verifying it, since an unverified pinned SHA is worse than a tag.

- [ ] **Step 5: Verify the scanner catches a planted secret**

```bash
printf 'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\n' > /tmp/leak-probe.env
cp /tmp/leak-probe.env ./leak-probe.env
git add leak-probe.env
git commit -m "chore: probe the secret scanner"; echo "exit=$?"
```

Expected: the commit is blocked by the pre-commit hook. Then: `git restore --staged leak-probe.env && rm -f leak-probe.env /tmp/leak-probe.env`

- [ ] **Step 6: Document net 3**

GitHub push protection is a repository setting, free on public repositories, and cannot be enabled from the repo tree. Note it in `docs/development/reference/checks.md` as a required setting, and add it to track 5's governance task where the rest of the repository settings are configured.

- [ ] **Step 7: Commit**

```bash
git add .gitignore .gitleaks.toml .github/workflows/ci.yml
git commit -m "feat: three nets against a committed secret

Pre-commit catches it locally, CI catches it when the hook is bypassed,
and GitHub push protection catches it at the remote. Three because the
first is bypassable by design and the second only runs once a branch is
pushed.

Also closes a gap that would have hit the first new contributor:
.claude/settings.local.json was ignored only by the maintainer's personal
global gitignore, and .claude/worktrees/ only by .git/info/exclude.
Neither travels with a clone, so a fresh checkout had no protection and
personal agent settings would have landed in a pull request."
```

---

### Task 9: Layer 0 — the agent hook

**Files:**

- Create: `.claude/settings.json`
- Create: `CLAUDE.md` (symlink to `AGENTS.md`)

**Interfaces:**

- Consumes: `prettier`, `eslint` from Tasks 1 and 4.
- Produces: committed team-policy agent configuration.

Layer 0 introduces **no new rules**. It only makes an agent hit the bar the repository already enforces, which is what keeps enforcement agent-agnostic: deleting `.claude/` must not change what CI accepts.

- [ ] **Step 1: Create `.claude/settings.json`**

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "pnpm exec prettier --write --ignore-unknown \"$CLAUDE_FILE_PATHS\" 2>/dev/null || true"
          }
        ]
      }
    ]
  },
  "permissions": {
    "deny": [
      "Read(**/.dev.vars)",
      "Read(**/.env)",
      "Read(**/.env.*)",
      "Read(**/*.pem)",
      "Read(**/*.key)",
      "Read(~/.wrangler/**)",
      "Read(~/.config/.wrangler/**)"
    ]
  }
}
```

The `|| true` matters: the hook is an accelerator, and an accelerator that fails must never block the agent's work.

- [ ] **Step 2: Symlink `CLAUDE.md` to `AGENTS.md`**

```bash
ln -s AGENTS.md CLAUDE.md
git add CLAUDE.md
git check-ignore CLAUDE.md || echo "not ignored, good"
```

- [ ] **Step 3: Verify the deny rules hold**

In a Claude Code session in this repository, attempt to read `apps/worker/.dev.vars`. Expected: refused by the harness. If `.dev.vars` does not exist locally, create one with a dummy value first, confirm the refusal, then delete it.

- [ ] **Step 4: Verify agent-agnosticism**

```bash
mv .claude /tmp/claude-hidden
pnpm check; echo "exit=$?"
mv /tmp/claude-hidden .claude
```

Expected: `pnpm check` passes identically. Any correctness rule that disappears was in the wrong layer.

- [ ] **Step 5: Commit**

```bash
git add .claude/settings.json CLAUDE.md
git commit -m "feat: agent configuration as committed team policy

Layer 0 formats a file right after an agent edits it, so the agent's
output is already conformant before it reaches a commit and never spends
a round trip on formatting. It introduces no rule of its own; deleting
.claude/ entirely leaves pnpm check accepting exactly the same trees,
which is the test that keeps enforcement agent-agnostic. Verified by
moving the directory aside and re-running.

The deny entries stop secret-bearing files from entering model context
at all, which no repository check could ever catch after the fact.

settings.json is committed and reviewed like any other rule;
settings.local.json is personal and gitignored. CLAUDE.md is a symlink so
the two files cannot drift."
```

---

### Task 10: CI runs the same bar

**Files:**

- Modify: `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: `pnpm check` (Task 5).

- [ ] **Step 1: Replace the separate steps with `pnpm check`**

In `.github/workflows/ci.yml`, replace the `Typecheck` and `Verify` steps with one:

```yaml
- name: Check
  run: pnpm check
```

Keep the existing `Dependency audit` step and the secret scan from Task 8.

- [ ] **Step 2: Add `--affected` support without breaking the first run**

`--affected` compares against `main`, which needs history. Set `fetch-depth: 0` on the checkout step. Do **not** enable `--affected` for the `workflow_call` path used by the production deploy — a deploy must validate everything, not only what changed.

```yaml
- name: Checkout
  uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
  with:
    persist-credentials: false
    fetch-depth: 0
```

- [ ] **Step 3: Verify locally what CI will run**

```bash
pnpm install --frozen-lockfile
pnpm check
```

Expected: PASS.

- [ ] **Step 4: Push and confirm CI is green**

```bash
git push -u origin HEAD
gh run watch
```

Expected: the `Validate` job passes, running `pnpm check` as its single gate.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run the same command developers run

CI ran typecheck and verify as separate steps, which meant the local bar
and the CI bar were two different lists that could drift. Both are now
pnpm check, so a red run maps to exactly one local command.

fetch-depth: 0 because --affected compares against main and needs the
history to do it. --affected is deliberately not used on the
workflow_call path the production deploy uses: a deploy validates
everything, not only what changed."
```

---

## Self-Review

**Spec coverage.** Track 1 of the spec lists: one command defining validity (Task 5), four enforcement layers (Tasks 7, 9, 10), the workspace contract check (Task 6), and closing the typecheck blind spot (Task 3). The Sequencing section pulls the three secret nets forward into track 1 (Task 8). `pnpm preflight` is named in the spec's First-class commands table (Task 2). Prettier and ESLint come from the Cross-cutting decisions section (Tasks 1, 4).

Deliberately deferred, with the spec section that owns each: custom type-aware lint rules and the `AGENTS.md` rewrite (track 3); `turbo boundaries` wiring (track 3); generators (track 4); rulesets, merge queue, CODEOWNERS, migration automation and `pnpm ship` (track 5); the documentation domain reorganization and the seventeen new pages (track 3); Vitest (track 2).

**Known gap carried forward:** Task 7's commit-msg hook writes `docs/development/reference/commit-messages.md`, which is the first page in the new domain layout, but the rest of the reorganization happens in track 3. Until then that page is the only occupant of `docs/development/`. This is intentional — the hook must cite a standard that exists.

**Type consistency.** `checkLockfileSync` and `recordLockfileHash` are defined in Task 2 and consumed by Task 7's pre-push. `REQUIRED_TASKS` in Task 6 is `["lint", "typecheck", "test"]`, matching the task names created in Tasks 4 and 5 — `format:check` and `check:contract` are root-level and correctly absent from the per-package list. The `turbo query` response shape in Task 6 was verified against turbo 2.10.5 rather than assumed.

**Ordering.** Task 6 depends on Task 4 having added `lint` scripts and Task 5 having renamed `verify` to `test`; running it earlier reports failures the plan has not reached yet. Task 10 depends on Task 5. Tasks 1, 2, and 3 are independent and can run in any order.
