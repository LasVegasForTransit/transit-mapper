export class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

const flags = new Set([
  '--dry-run',
  '--staged',
  '--production',
  '--help',
  '--json',
  '--protected',
  '--public',
  '--wait-for-propagation',
]);
const valued = new Set([
  '--action',
  '--pr',
  '--publication-mode',
  '--protection',
  '--app',
  '--filter',
  '--rotate',
  '--target',
  '--output',
  '--input',
  '--run-id',
  '--expected-version',
  '--directory',
  '--commit',
  '--release-id',
  '--version',
  '--repository',
  '--run-file',
  '--artifact-hash',
  '--attestation-directory',
  '--candidate-directory',
  '--activation',
  '--verification',
  '--url',
]);

/** `<command> [positional...] [--flag] [--option value]`. Unknown options are an error. */
export function parseArguments(argv) {
  const [first, ...rest] = argv;
  const command = first === '--help' ? 'help' : first;
  const options = { dryRun: false, staged: false, production: false, positional: [] };

  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === '--help') return { command: 'help', options };
    if (flags.has(argument)) {
      const key = { '--dry-run': 'dryRun' }[argument] ?? argument.slice(2);
      options[key] = true;
    } else if (valued.has(argument)) {
      const value = rest[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new CliError(`Missing value for ${argument}.`, 2);
      }
      options[argument.slice(2)] = value;
      index += 1;
    } else if (argument.startsWith('--') && !flags.has(argument)) {
      throw new CliError(`Unexpected option: ${argument}`, 2);
    } else options.positional.push(argument);
  }

  return { command, options };
}
