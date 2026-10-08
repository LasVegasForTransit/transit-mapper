import { CliError } from '../arguments.mjs';
import { runRelease } from './runner.mjs';
export { promote } from './promote.mjs';
const flags = [
  'action',
  'pr',
  'publication-mode',
  'protection',
  'app',
  'directory',
  'commit',
  'release-id',
  'target',
  'version',
  'repository',
  'run-id',
  'expected-version',
  'run-file',
  'artifact-hash',
  'attestation-directory',
  'candidate-directory',
  'activation',
  'verification',
  'url',
];

export async function release({ cwd, options = {} }) {
  if (options.dryRun || options.production || options.staged)
    throw new CliError('Select an explicit release operation and target.', 2);
  const positionals = options.positional ?? [];
  const mode = ['publication', 'smoke', 'migrate', 'attestation', 'pr-preview'].includes(
    positionals[0],
  )
    ? positionals[0]
    : 'worker-release';
  const args = mode !== 'worker-release' ? positionals.slice(1) : [...positionals];
  for (const key of flags) if (options[key] !== undefined) args.push(`--${key}`, options[key]);
  for (const flag of ['protected', 'public', 'wait-for-propagation'])
    if (options[flag]) args.push(`--${flag}`);
  return await runRelease({ cwd, mode, args });
}
