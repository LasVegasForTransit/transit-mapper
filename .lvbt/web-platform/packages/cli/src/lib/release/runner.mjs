import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CliError } from '../arguments.mjs';
import { readTooling } from '../tooling.mjs';

export async function releaseEntry(cwd) {
  try {
    const entry = createRequire(path.join(cwd, 'package.json')).resolve(
      '@lasvegasfortransit/web-platform/release',
    );
    return path.join(path.dirname(entry), 'release-command.ts');
  } catch {
    const candidates = [
      fileURLToPath(new URL('../../../../web-platform/src/release-command.ts', import.meta.url)),
      path.join(cwd, '.lvbt/web-platform/packages/web-platform/src/release-command.ts'),
    ];
    for (const file of candidates)
      if (
        await access(file).then(
          () => true,
          () => false,
        )
      )
        return file;
    throw new CliError(
      'Install the pinned @lasvegasfortransit/web-platform package or apply the vendored repository standard before releasing.',
      2,
    );
  }
}

export async function runRelease({ cwd, mode, args = [] }) {
  if (!(mode === 'attestation' && args[0] === 'manifest') && !readTooling(cwd).release)
    throw new CliError('Configure release in .lvbt/tooling.json before releasing.', 2);
  const entry = await releaseEntry(cwd);
  await new Promise((resolve, reject) => {
    const runtime = createRequire(import.meta.url).resolve('tsx');
    const child = spawn(
      process.execPath,
      ['--import', pathToFileURL(runtime).href, entry, mode, cwd, ...args],
      {
        cwd,
        stdio: 'inherit',
      },
    );
    child.once('error', reject);
    child.once('exit', (code, signal) =>
      code === 0
        ? resolve()
        : reject(
            new CliError(
              `Release stopped (${signal ?? code}). Reconcile any reported Actions request before dispatching again.`,
              code ?? 1,
            ),
          ),
    );
  });
  return 0;
}
