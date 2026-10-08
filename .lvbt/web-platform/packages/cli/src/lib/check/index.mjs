import { CliError } from '../arguments.mjs';
import { checkContract } from './contract.mjs';
import { checkDebt } from './debt.mjs';
import { checkFilenames } from './filenames.mjs';
import { checkPlatform } from './platform.mjs';
import { checkStandard } from './standard.mjs';
import { checkSecrets } from './secrets.mjs';

const checks = {
  standard: checkStandard,
  filenames: checkFilenames,
  contract: checkContract,
  debt: checkDebt,
  platform: checkPlatform,
  secrets: checkSecrets,
};

/**
 * `lvbt check [name...]`: the repository-shape rules every LVBT repository
 * shares, run together by `pnpm check`. Each result names its fix.
 */
export async function check({ cwd, options }) {
  const names =
    options.positional.length > 0
      ? options.positional
      : Object.keys(checks).filter((name) => name !== 'secrets');
  const unknown = names.filter((name) => !(name in checks));
  if (unknown.length > 0) {
    throw new CliError(
      `Unknown check "${unknown[0]}". Known: ${Object.keys(checks).join(', ')}.`,
      2,
    );
  }

  let failed = 0;
  for (const name of names) {
    const result = await checks[name]({ cwd, staged: options.staged });
    process.stdout.write(`  ${result.ok ? 'ok  ' : 'FAIL'}  ${name}\n`);
    for (const line of result.lines) process.stdout.write(`        ${line}\n`);
    if (!result.ok) {
      process.stdout.write(`        fix: ${result.fix}\n`);
      failed += 1;
    }
  }
  if (failed > 0) throw new CliError(`check: ${failed} of ${names.length} checks failed`, 1);
}
