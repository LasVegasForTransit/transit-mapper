#!/usr/bin/env node
/**
 * The commands every LVBT repository runs the same way.
 *
 *   lvbt bootstrap  install, wire git hooks, run preflight
 *   lvbt preflight  confirm this machine can build and deploy the repository
 *   lvbt check      the shared repository-shape rules (filenames, contract, debt)
 *   lvbt deploy     build, then `wrangler deploy` for every app that has a config
 *
 * A repository's package.json maps its standard scripts to these, so
 * `pnpm bootstrap`, `pnpm preflight`, `pnpm check`, and `pnpm run deploy` behave
 * identically across the organization. Everything else a repository needs is
 * an ordinary dependency or an ordinary file it owns.
 */
import { CliError, parseArguments } from './lib/arguments.mjs';
import { check } from './lib/check/index.mjs';
import { bootstrap, deploy, preflight } from './lib/operate.mjs';

const usage = `Usage:
  lvbt bootstrap
  lvbt preflight
  lvbt check [filenames|contract|debt ...] [--staged]
  lvbt deploy [--filter <app>] [--dry-run]

Options:
  --staged    For check filenames: check the staged tree instead of the working tree
  --filter    For deploy: only the app directory named (for example apps/worker)
  --dry-run   For deploy: build, then run wrangler deploy --dry-run
`;

const commands = { bootstrap, preflight, check, deploy };

try {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (command === undefined || command === 'help') {
    process.stdout.write(usage);
  } else if (command in commands) {
    await commands[command]({ cwd: process.cwd(), options });
  } else {
    throw new CliError(`Unknown command "${command}".\n${usage}`, 2);
  }
} catch (error) {
  if (error instanceof CliError) {
    if (error.message) process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode;
  } else {
    throw error;
  }
}
