import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { applyPreset, verifyPreset } from './web-platform.ts';
import { readCommit, readRelease } from './web-platform-source.ts';

const upstream = 'https://github.com/LasVegasForTransit/repository-tooling.git';

type SourceIdentity = { release: string; commit?: never } | { release?: never; commit: string };

function sourceIdentity(release: string | undefined, commit: string | undefined): SourceIdentity {
  if (Boolean(release) === Boolean(commit)) {
    throw new Error(
      'Usage: standards:update (--release <tag> | --commit <sha>) [--apply] [--json]. Provide either --release or --commit.',
    );
  }
  return release ? { release } : { commit: commit ?? '' };
}

function readSource(repository: string, identity: SourceIdentity) {
  return identity.release
    ? readRelease(repository, identity.release)
    : readCommit(repository, identity.commit ?? '');
}

async function update(
  root: string,
  identity: SourceIdentity,
  source: string | undefined,
  dryRun: boolean,
) {
  if (source) return applyPreset(root, readSource(source, identity), dryRun);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lvbt-standards-'));
  try {
    if (identity.release) {
      execFileSync(
        'git',
        [
          'clone',
          '--depth',
          '1',
          '--branch',
          identity.release,
          '--single-branch',
          '--',
          upstream,
          directory,
        ],
        { stdio: 'pipe' },
      );
    } else {
      execFileSync('git', ['init', '--quiet', directory], { stdio: 'pipe' });
      execFileSync('git', ['-C', directory, 'remote', 'add', 'origin', upstream], {
        stdio: 'pipe',
      });
      execFileSync(
        'git',
        ['-C', directory, 'fetch', '--quiet', '--depth', '1', 'origin', identity.commit ?? ''],
        { stdio: 'pipe' },
      );
    }
    return await applyPreset(root, readSource(directory, identity), dryRun);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function main(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      release: { type: 'string' },
      commit: { type: 'string' },
      source: { type: 'string' },
      root: { type: 'string' },
      apply: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      json: { type: 'boolean' },
    },
  });
  try {
    const root = path.resolve(values.root ?? process.cwd());
    const [command] = positionals;
    if (positionals.length !== 1 || (values.apply && values['dry-run']))
      throw new Error('Choose one command and either --apply or --dry-run.');
    if (command === 'check') {
      const metadata = await verifyPreset(root);
      process.stdout.write(
        `${JSON.stringify({ ok: true, metadata }, null, values.json ? 0 : 2)}\n`,
      );
      return;
    }
    if (command !== 'update') throw new Error('Choose check or update.');
    const identity = sourceIdentity(values.release, values.commit);
    const plan = await update(root, identity, values.source, !values.apply);
    process.stdout.write(
      `${JSON.stringify({ ok: true, applied: !!values.apply, release: values.release ?? null, commit: values.commit, plan }, null, values.json ? 0 : 2)}\n`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `${values.json ? JSON.stringify({ ok: false, error: message }) : message}\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
