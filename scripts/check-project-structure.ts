#!/usr/bin/env tsx
/**
 * Every source directory is described in docs/reference/project-structure.md,
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
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DOC = resolve(ROOT, 'docs/reference/project-structure.md');

/** Workspace roots whose immediate `src/` children are subsystems. */
const SOURCE_ROOTS = ['apps/web/src', 'apps/worker/src', 'packages/core/src'];

/**
 * Directories that are deliberately not described as subsystems.
 * `migrations/` is data rather than code, and the Worker section already
 * explains how Wrangler consumes it.
 */
const EXEMPT = new Set(['apps/worker/src/migrations']);

function sourceDirectories(): string[] {
  const found: string[] = [];
  for (const root of SOURCE_ROOTS) {
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

  if (undocumented.length === 0 && missing.length === 0) {
    console.log(`project structure: ${actual.length} source directories, all described.`);
    return;
  }

  console.error(`\n${docRelative} no longer matches the source tree.\n`);

  if (undocumented.length > 0) {
    console.error('  Directories with nothing written about them:');
    for (const d of undocumented) console.error(`    ${d}`);
    console.error(
      '\n  A subsystem nobody wrote down can only be understood by reading' +
        '\n  every file that touches it.' +
        `\n    fix:  add a section for it to ${docRelative}\n`,
    );
  }

  if (missing.length > 0) {
    console.error('  Described, but no longer present:');
    for (const p of missing) console.error(`    ${p}`);
    console.error(
      '\n  A map of a place that does not exist is worse than no map.' +
        `\n    fix:  remove or update the entry in ${docRelative}\n`,
    );
  }

  process.exit(1);
}

main();
