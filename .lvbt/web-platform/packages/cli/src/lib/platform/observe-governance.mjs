import path from 'node:path';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
export function observeGovernance(run, directory, manifest) {
  if (!manifest.github?.governance) return { ok: true, value: [] };
  let root = directory;
  while (!existsSync(path.join(root, '.lvbt/web-platform.json'))) {
    const parent = path.dirname(root);
    if (parent === root)
      return {
        ok: false,
        reason: 'Apply the reviewed repository standard before checking governance.',
      };
    root = parent;
  }
  try {
    const require = createRequire(path.join(root, 'package.json'));
    const entry = require.resolve('@lasvegasfortransit/web-platform/github');
    const result = run(
      process.execPath,
      [
        '--import',
        require.resolve('tsx'),
        path.join(path.dirname(entry), 'github-governance-command.ts'),
        root,
        manifest.github.repository,
      ],
      { cwd: root },
    );
    if (result.status !== 0)
      return {
        ok: false,
        reason:
          'Shared governance inventory failed; check GitHub read permissions and the adopted release.',
      };
    const checks = JSON.parse(result.stdout);
    if (
      !Array.isArray(checks) ||
      checks.some(
        (check) =>
          typeof check.id !== 'string' ||
          typeof check.requirement !== 'string' ||
          !['pass', 'fail', 'unknown'].includes(check.status),
      )
    )
      throw new Error('Invalid governance inventory');
    return { ok: true, value: checks };
  } catch {
    return {
      ok: false,
      reason: 'Install the adopted web-platform package and tsx before checking governance.',
    };
  }
}
