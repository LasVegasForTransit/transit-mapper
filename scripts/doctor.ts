#!/usr/bin/env tsx
/**
 * Environment doctor. Reports problems that make a local checkout behave
 * differently from CI, and names the command that repairs each one.
 *
 * The lockfile check exists because pnpm offers no way to ask "does my
 * node_modules match pnpm-lock.yaml?". It matters: this repository was
 * found with the lockfile pinning wrangler 4.114.0 while the installed
 * tree was 3.114.17. CI installs with --frozen-lockfile, so CI and a
 * developer were one command away from running different toolchains with
 * nothing reporting it. `postinstall` records the hash of the lockfile
 * that produced the current tree; if the lockfile has since changed, the
 * tree is stale.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const LOCKFILE = resolve(ROOT, 'pnpm-lock.yaml');
const STAMP = resolve(ROOT, 'node_modules/.lvbt-lockfile-hash');

export interface DoctorResult {
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
  const results: DoctorResult[] = [await checkLockfileSync()];
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

// Only run when invoked directly, so the exports above stay importable.
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
