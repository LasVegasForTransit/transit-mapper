import { spawnSync } from 'node:child_process';
import { CliError } from './arguments.mjs';

/** Protect a fresh checkout even when dependency installation never finishes. */
export function installGitHooks(cwd) {
  const installed = spawnSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], {
    cwd,
    encoding: 'utf8',
  });
  if (installed.status !== 0)
    throw new CliError('bootstrap: cannot install Git hooks; run inside a Git checkout.', 1);
  const effective = spawnSync('git', ['config', '--get', 'core.hooksPath'], {
    cwd,
    encoding: 'utf8',
  });
  if (effective.status !== 0 || effective.stdout.trim() !== '.githooks')
    throw new CliError(
      'bootstrap: another Git configuration overrides .githooks. Remove the override shown by git config --show-origin --get core.hooksPath, then rerun pnpm bootstrap.',
      1,
    );
}
