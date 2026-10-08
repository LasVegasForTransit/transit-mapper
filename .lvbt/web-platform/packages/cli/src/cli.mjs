#!/usr/bin/env node
/**
 * The commands every LVBT repository runs the same way.
 *
 *   lvbt bootstrap  install, wire git hooks, run preflight; with --production,
 *                   also set up everything the platform manifest declares
 *   lvbt preflight  confirm this machine can build and deploy the repository;
 *                   with --production, also report production's readiness
 *   lvbt check      the shared repository-shape rules (filenames, contract, debt)
 *   lvbt deploy     build, then deploy every configured Cloudflare app
 *
 * A repository's package.json maps its standard scripts to these, so
 * `pnpm bootstrap`, `pnpm preflight`, `pnpm check`, and `pnpm run deploy` behave
 * identically across the organization. Everything else a repository needs is
 * an ordinary dependency or an ordinary file it owns.
 */
import { CliError, parseArguments } from './lib/arguments.mjs';
import { check } from './lib/check/index.mjs';
import { bootstrap, deploy, preflight, setupRecord } from './lib/operate.mjs';
import { audit } from './lib/audit/index.mjs';
import { release } from './lib/release/index.mjs';
import { promote } from './lib/release/promote.mjs';

const usage = `Usage:
  lvbt bootstrap [--production [--filter <app>] [--rotate <SECRET>[,<SECRET>...]]]
  lvbt preflight [--production [--filter <app>]]
  lvbt setup-record (pnpm postinstall only)
  lvbt check [standard|filenames|contract|debt|platform ...] [--staged]
  lvbt audit [links|lighthouse|dependencies] [--target local|production] [--json] [--output file]
  lvbt audit report --input file [--dry-run]
  lvbt release <source|package|verify|upload|migrate|activate|publication|smoke> [--app name] [options]
  lvbt promote [--app name] [--run-id id]
  lvbt deploy [--filter <app>] [--dry-run]

Options:
  --production  For bootstrap: set up what platform.json declares. For preflight:
                report whether production has it, without changing anything
  --staged      For check filenames: check the staged tree instead of the working tree
  --filter      For deploy and --production: only the app directory named (apps/site)
  --rotate      For bootstrap --production: replace the named secrets' stored values
                on every target. Without it, a value that is already set is kept
  --dry-run     For deploy: build, then run each Cloudflare CLI with --dry-run
`;

const commands = {
  bootstrap,
  preflight,
  check,
  deploy,
  audit,
  promote,
  release,
  'setup-record': setupRecord,
};

try {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (command === undefined || command === 'help') {
    process.stdout.write(usage);
  } else if (command in commands) {
    const result = await commands[command]({ cwd: process.cwd(), options });
    if (Number.isInteger(result)) process.exitCode = result;
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
