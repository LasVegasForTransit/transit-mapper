#!/usr/bin/env node
/**
 * The commands every LVBT repository runs the same way.
 *
 *   lvbt bootstrap  install, wire git hooks, run preflight; with --production,
 *                   also set up everything the platform manifest declares
 *   lvbt preflight  confirm this machine can build and deploy the repository;
 *                   with --production, also report production's readiness
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
  lvbt bootstrap [--production [--filter <app>] [--rotate <SECRET>[,<SECRET>...]]]
  lvbt preflight [--production [--filter <app>]]
  lvbt check [filenames|contract|debt|platform ...] [--staged]
  lvbt deploy [--filter <app>] [--dry-run]

Options:
  --production  For bootstrap: set up what platform.json declares. For preflight:
                report whether production has it, without changing anything
  --staged      For check filenames: check the staged tree instead of the working tree
  --filter      For deploy and --production: only the app directory named (apps/site)
  --rotate      For bootstrap --production: replace the named secrets' stored values
                on every target. Without it, a value that is already set is kept
  --dry-run     For deploy: build, then run wrangler deploy --dry-run
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
