import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { ownedFileDrift } from './owned-files.ts';
import { applyPreset, verifyPreset, type WebPreset } from './web-platform.ts';
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

/**
 * Applies a preset with the updater it carries, so a release's own consumer migrations run in the
 * update that installs it rather than in the next one. A preset without an updater uses this one.
 */
async function applyIncoming(root: string, bundle: WebPreset, dryRun: boolean) {
  const names = Object.keys(bundle.files).filter((name) => name.startsWith('standards/'));
  if (!names.includes('standards/web-platform.ts')) return applyPreset(root, bundle, dryRun);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lvbt-updater-'));
  try {
    for (const name of names) {
      await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
      await writeFile(path.join(directory, name), bundle.files[name] ?? '');
    }
    const incoming = (await import(
      pathToFileURL(path.join(directory, 'standards/web-platform.ts')).href
    )) as { applyPreset: typeof applyPreset };
    return await incoming.applyPreset(root, bundle, dryRun);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function update(
  root: string,
  identity: SourceIdentity,
  source: string | undefined,
  dryRun: boolean,
) {
  if (source) return applyIncoming(root, readSource(source, identity), dryRun);
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
    return await applyIncoming(root, readSource(directory, identity), dryRun);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Verifies the vendored preset and the files the standard owns in the repository. */
async function check(root: string, json: boolean | undefined) {
  const metadata = await verifyPreset(root);
  // Warnings until v0.6.0, when these fail and the update restores the standard's copies.
  for (const problem of await ownedFileDrift(root, metadata.release))
    process.stderr.write(
      `warning: ${problem} This file belongs to the standard; from v0.6.0 \`pnpm standards:check\` fails on it. Make the change in repository-tooling instead.\n`,
    );
  process.stdout.write(`${JSON.stringify({ ok: true, metadata }, null, json ? 0 : 2)}\n`);
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
      await check(root, values.json);
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

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  await main(process.argv.slice(2));
}
