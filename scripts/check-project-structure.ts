#!/usr/bin/env tsx
/**
 * Every source directory is described in docs/development/reference/project-structure.md,
 * and every directory that document describes still exists.
 *
 * AGENTS.md asks that a change adding a subsystem write down how it works and
 * where it lives. That instruction had no teeth: four directories —
 * apps/web/src/share, apps/web/src/sim, apps/web/src/storage and
 * packages/core/src/share — existed with nothing said about any of them, and
 * nothing reported it.
 *
 * The check runs in both directions on purpose. A directory with no entry is
 * a subsystem whose design can only be recovered by reading every file that
 * touches it. An entry with no directory is a map of a place that no longer
 * exists, which is worse than no map.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DOC = resolve(ROOT, 'docs/development/reference/project-structure.md');

interface TurboPackage {
  name: string;
  path: string;
}

interface TurboQueryResponse {
  data: { packages: { items: TurboPackage[] } };
}

/**
 * Workspace roots whose immediate `src/` children are subsystems.
 *
 * Asked of the build graph, not hardcoded. The list used to be three literal
 * paths, and a package added afterwards was invisible to this check for as
 * long as nobody remembered to extend the constant — which is how
 * `packages/pwa-updater` and `packages/tsconfig` both arrived with nothing
 * written about them while the check reported the tree fully described.
 *
 * A check whose coverage is a constant stops covering the repository the
 * moment the repository grows, and says nothing when it does.
 */
function listPackagePaths(): string[] {
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
  // "//" is the workspace root, which is not a package anyone documents.
  return parsed.data.packages.items.filter((p) => p.name !== '//').map((p) => p.path);
}

function sourceRoots(): string[] {
  return listPackagePaths()
    .map((p) => `${p}/src`)
    .filter((p) => existsSync(resolve(ROOT, p)))
    .sort();
}

/**
 * Directories that are deliberately not described as subsystems.
 * `migrations/` is data rather than code, and the Worker section already
 * explains how Wrangler consumes it.
 */
const EXEMPT = new Set(['apps/worker/src/migrations']);

function sourceDirectories(): string[] {
  const found: string[] = [];
  for (const root of sourceRoots()) {
    const abs = resolve(ROOT, root);
    if (!existsSync(abs)) continue;
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const rel = `${root}/${entry.name}`;
      if (!EXEMPT.has(rel)) found.push(rel);
    }
  }
  return found.sort();
}

/** Paths the document names anywhere, not only in headings — a directory
 *  described inside a neighbouring section still counts as documented. */
function documentedPaths(source: string): Set<string> {
  const paths = new Set<string>();
  for (const match of source.matchAll(
    /\b((?:apps|packages)\/[A-Za-z0-9_.-]+\/src\/[A-Za-z0-9_.-]+)/g,
  )) {
    paths.add(match[1]);
  }
  return paths;
}

/** Workspace package paths the document names. */
function documentedPackages(source: string): Set<string> {
  return new Set([...source.matchAll(/\b((?:apps|packages)\/[A-Za-z0-9_.-]+)/g)].map((m) => m[1]));
}

/**
 * Every workspace package is named somewhere in the document.
 *
 * Checking directories under `src/` is not enough on its own: a package whose
 * `src/` holds files and no subdirectories contributes no directories to
 * check, so an entire package can be added without the check noticing.
 * `packages/pwa-updater` did exactly that.
 */
function undocumentedPackages(source: string): string[] {
  const documented = documentedPackages(source);
  return listPackagePaths()
    .filter((p) => !documented.has(p))
    .sort();
}

function main(): void {
  const source = readFileSync(DOC, 'utf8');
  const documented = documentedPaths(source);
  const actual = sourceDirectories();
  const docRelative = relative(ROOT, DOC);

  const undocumented = actual.filter((d) => !documented.has(d));

  // A documented path that looks like a directory but is not one. File paths
  // are filtered out: the document cites individual modules constantly.
  const missing = [...documented]
    .filter((p) => !p.includes('.'))
    .filter((p) => !existsSync(resolve(ROOT, p)))
    .sort();

  const orphanPackages = undocumentedPackages(source);

  if (undocumented.length === 0 && missing.length === 0 && orphanPackages.length === 0) {
    console.log(`project structure: ${actual.length} source directories, all described.`);
    return;
  }

  console.error(`\n${docRelative} no longer matches the source tree.\n`);

  if (orphanPackages.length > 0) {
    console.error('  Workspace packages not mentioned in the document:');
    for (const p of orphanPackages) console.error(`    ${p}`);
    console.error(`\n    fix:  add each to the tree and give it a section in ${docRelative}\n`);
  }

  if (undocumented.length > 0) {
    console.error('  Source directories not mentioned in the document:');
    for (const d of undocumented) console.error(`    ${d}`);
    console.error(`\n    fix:  add a section for each to ${docRelative}\n`);
  }

  if (missing.length > 0) {
    console.error('  Described in the document, but not present on disk:');
    for (const p of missing) console.error(`    ${p}`);
    console.error(`\n    fix:  remove or update each entry in ${docRelative}\n`);
  }

  process.exit(1);
}

main();
