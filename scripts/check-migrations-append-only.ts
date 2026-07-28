#!/usr/bin/env tsx
/**
 * Migrations are append-only. Editing one that has already run corrupts
 * production silently.
 *
 * Wrangler records which migrations it has applied by *name*. A file whose
 * name it has already seen is never run again, no matter what the contents
 * now say — so an edited migration runs on nothing that already exists, and
 * runs in full on anything created later. The two diverge permanently, and
 * nothing reports it: the deploy is green, the schema is wrong, and the
 * damage only surfaces when some query hits a column that exists in one
 * environment and not the other.
 *
 * The rule is therefore mechanical: relative to the base branch, a file
 * under a migrations directory may be added. It may not be modified,
 * deleted, or renamed.
 *
 * Comparing against the merge base rather than the tip means a branch is
 * judged on what it changed, not on what has landed on main meanwhile.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

/** Any path segment named `migrations` — this is not worker-specific. */
const MIGRATION_PATH = /(^|\/)migrations\//;

/** What the base branch is called. Overridable for a fork or a release line. */
const BASE = process.env.MIGRATION_BASE_REF ?? 'main';

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

interface Offence {
  status: string;
  path: string;
}

function describe(status: string): string {
  if (status.startsWith('M')) return 'modified';
  if (status.startsWith('D')) return 'deleted';
  if (status.startsWith('R')) return 'renamed';
  return `changed (${status})`;
}

function main(): void {
  let base: string;
  try {
    base = git(['merge-base', BASE, 'HEAD']);
  } catch {
    // A shallow clone, a detached build, or a repository with no `main` yet.
    // Skipping loudly beats failing a build for a reason nobody can act on;
    // CI checks out full history, which is where this matters.
    console.log(`migrations: no merge base with "${BASE}", skipping the append-only check.`);
    return;
  }

  // Against the working tree, not against HEAD. `base...HEAD` compares
  // commits, so an edit that has not been committed yet passes — which is
  // precisely the moment the developer is standing there able to fix it.
  // `base` is already the merge base, so this is still "what this branch
  // changed", now including what is merely on disk.
  const raw = git(['diff', '--name-status', '--find-renames', base]);
  if (raw.length === 0) {
    console.log('migrations: no changes against the base branch.');
    return;
  }

  const offences: Offence[] = [];
  for (const line of raw.split('\n')) {
    const [status, ...paths] = line.split('\t');
    // A rename reports both the old and the new path; the old one is the
    // migration that stopped existing under the name Wrangler recorded.
    const path = paths[0];
    if (!path || !MIGRATION_PATH.test(path)) continue;
    if (status.startsWith('A')) continue;
    offences.push({ status, path });
  }

  if (offences.length > 0) {
    console.error('\nmigrations: a migration that already exists was changed.\n');
    for (const o of offences) console.error(`  ${describe(o.status)}: ${o.path}`);
    console.error(
      '\n  Wrangler records applied migrations by name and never re-runs one it' +
        '\n  has seen. An edit therefore applies to no existing environment and' +
        '\n  in full to every new one.' +
        '\n\n  fix:  restore the file and add a new migration with the change\n',
    );
    process.exit(1);
  }

  console.log('migrations: append-only, nothing existing was changed.');
}

main();
