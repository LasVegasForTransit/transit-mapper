#!/usr/bin/env tsx
/**
 * Every workspace package must declare every task the repository's
 * enforcement depends on.
 *
 * A package missing one is skipped by Turborepo without an error, so CI
 * stays green while the package goes unchecked. That is not hypothetical:
 * apps/worker declared no test script, and the Worker — the only component
 * touching D1, cookies and untrusted input — reached production with zero
 * coverage and nothing reporting it.
 *
 * The package list comes from `turbo query` rather than from parsing
 * pnpm-workspace.yaml, so this agrees with the build graph by construction
 * instead of by coincidence.
 */
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * Whether a package ships code at all.
 *
 * A package of pure configuration — `packages/tsconfig` holds only JSON — has
 * nothing to lint, typecheck, or run. Demanding the three scripts anyway gets
 * answered with three scripts that do nothing, and the reasoning that keeps
 * `build` off the required list applies unchanged: a task written to satisfy
 * a check is a lie, and the next reader cannot tell it from a real one.
 *
 * Detected rather than declared. A field in package.json saying "the contract
 * does not apply to me" would be reached for by any package that found the
 * contract inconvenient; adding one source file here re-imposes it with no
 * decision required.
 */
async function shipsCode(path: string): Promise<boolean> {
  const entries = await readdir(resolve(ROOT, path), { recursive: true, withFileTypes: true });
  return entries.some(
    (e) =>
      e.isFile() &&
      !e.parentPath.includes('node_modules') &&
      !e.parentPath.includes('dist') &&
      SOURCE_EXTENSIONS.some((ext) => e.name.endsWith(ext)),
  );
}

/**
 * Tasks every package must define. `build` is deliberately absent: a
 * package that ships raw TypeScript source has nothing to build, and
 * requiring an empty build script would teach people to write lies.
 */
const REQUIRED_TASKS = ['lint', 'typecheck', 'verify'] as const;

interface TurboPackage {
  name: string;
  path: string;
}

interface TurboQueryResponse {
  data: { packages: { items: TurboPackage[] } };
}

function listPackages(): TurboPackage[] {
  const raw = execFileSync(
    'npx',
    ['turbo', 'query', 'query { packages { items { name path } } }'],
    {
      cwd: ROOT,
      encoding: 'utf8',
    },
  );
  // turbo prints a version banner before the JSON body.
  const parsed = JSON.parse(raw.slice(raw.indexOf('{'))) as TurboQueryResponse;
  // "//" is the workspace root. It orchestrates tasks rather than defining
  // them, so the contract does not apply to it.
  return parsed.data.packages.items.filter((p) => p.name !== '//');
}

interface Manifest {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface Failure {
  /** Groups failures so each kind prints its own remediation. */
  kind: 'task' | 'catalog';
  message: string;
}

/** What to tell someone for each kind of failure. Every failure names the
 *  fix for *that* failure; a generic footer sends people down the wrong path. */
const REMEDIATION: Record<Failure['kind'], string> = {
  task:
    'A package without one of these is skipped by Turborepo without an error,\n' +
    'so CI passes while the package goes unchecked.\n' +
    '  fix:  add the missing script to that package.json',
  catalog:
    'Versions live in one place so two packages cannot drift apart unnoticed.\n' +
    '  fix:  set the range to "catalog:" and add it under `catalog:` in\n' +
    '        pnpm-workspace.yaml, then run `pnpm install`',
};

async function main(): Promise<void> {
  const failures: Failure[] = [];

  // The root package is checked for dependency declarations but not for
  // tasks: it orchestrates them rather than defining them.
  const manifests: { name: string; path: string; manifest: Manifest }[] = [];
  for (const pkg of [{ name: 'the workspace root', path: '.' }, ...listPackages()]) {
    manifests.push({
      ...pkg,
      manifest: JSON.parse(
        await readFile(resolve(ROOT, pkg.path, 'package.json'), 'utf8'),
      ) as Manifest,
    });
  }

  for (const { name, path, manifest } of manifests) {
    if (path !== '.' && (await shipsCode(path))) {
      const scripts = manifest.scripts ?? {};
      for (const task of REQUIRED_TASKS) {
        if (!scripts[task]) {
          failures.push({
            kind: 'task',
            message: `${name} (${path}/package.json) has no "${task}" script`,
          });
        }
      }
    }

    // Every external dependency resolves through the catalog in
    // pnpm-workspace.yaml, so two packages cannot drift onto different
    // versions of the same library without that showing up as a change to
    // one shared file.
    for (const field of ['dependencies', 'devDependencies'] as const) {
      for (const [dep, range] of Object.entries(manifest[field] ?? {})) {
        if (range.startsWith('catalog:') || range.startsWith('workspace:')) continue;
        failures.push({
          kind: 'catalog',
          message: `${name} (${path}/package.json) pins "${dep}" to "${range}" instead of "catalog:"`,
        });
      }
    }
  }

  if (failures.length > 0) {
    console.error('\nworkspace contract: the repository is out of contract.');
    for (const kind of ['task', 'catalog'] as const) {
      const group = failures.filter((f) => f.kind === kind);
      if (group.length === 0) continue;
      console.error('');
      for (const f of group) console.error(`  ${f.message}`);
      console.error('');
      console.error(REMEDIATION[kind]);
    }
    console.error('');
    process.exit(1);
  }

  console.log('workspace contract: all packages declare every required task.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
