import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { applyPreset, verifyPreset } from './web-platform.ts';
import { readRelease } from './web-platform-source.ts';

const upstream = 'https://github.com/LasVegasForTransit/repository-tooling.git';

async function update(root: string, release: string, source: string | undefined, dryRun: boolean) {
  if (source) return applyPreset(root, readRelease(source, release), dryRun);
  if (!/^v\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(release))
    throw new Error('An explicit version tag is required.');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lvbt-standards-'));
  try {
    execFileSync(
      'git',
      ['clone', '--depth', '1', '--branch', release, '--single-branch', '--', upstream, directory],
      { stdio: 'pipe' },
    );
    return await applyPreset(root, readRelease(directory, release), dryRun);
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
    if (command !== 'update' || !values.release)
      throw new Error('Usage: standards:update --release <tag> [--apply] [--json]');
    const plan = await update(root, values.release, values.source, !values.apply);
    process.stdout.write(
      `${JSON.stringify({ ok: true, applied: !!values.apply, release: values.release, plan }, null, values.json ? 0 : 2)}\n`,
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
