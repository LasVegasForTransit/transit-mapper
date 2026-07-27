#!/usr/bin/env tsx
/**
 * Every generator emits something that already passes `pnpm check`.
 *
 * That is the whole promise of `turbo gen`: scaffolding is right by
 * construction rather than corrected afterwards from a failure message. A
 * generator whose output no longer satisfies the checks silently breaks that
 * promise, and the person who finds out is the one using it.
 *
 * Not wired into `pnpm check` itself — it generates into the working tree and
 * then removes what it made, which is rude to do underneath someone's
 * uncommitted work. CI runs it, where the tree is disposable.
 */
import { execFileSync } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

interface Scenario {
  generator: string;
  args: string[];
  /** Removed afterwards, whether the run passed or failed. */
  creates: string[];
}

const SCENARIOS: Scenario[] = [
  {
    generator: 'package',
    args: ['gencheck', 'A package generated to verify the generator'],
    creates: ['packages/gencheck'],
  },
  {
    generator: 'lint-rule',
    args: ['no-gencheck-placeholder', 'A rule generated to verify the generator'],
    creates: [
      'packages/eslint-plugin/src/no-gencheck-placeholder.ts',
      'packages/eslint-plugin/src/no-gencheck-placeholder.test.ts',
    ],
  },
];

function run(command: string, args: string[]): void {
  execFileSync(command, args, { cwd: ROOT, stdio: 'pipe' });
}

function cleanUp(paths: string[]): void {
  for (const p of paths) rmSync(resolve(ROOT, p), { recursive: true, force: true });
}

function main(): void {
  const created: string[] = [];
  try {
    for (const scenario of SCENARIOS) {
      run('npx', ['turbo', 'gen', scenario.generator, '--args', ...scenario.args]);
      created.push(...scenario.creates);
      for (const p of scenario.creates) {
        if (!existsSync(resolve(ROOT, p))) {
          throw new Error(`generator "${scenario.generator}" did not create ${p}`);
        }
      }
    }

    // A generated package is only linked into the workspace after an install.
    run('pnpm', ['install', '--no-frozen-lockfile']);
    run('pnpm', ['check']);

    console.log(`generators: ${SCENARIOS.length} scenarios, output passes pnpm check unmodified.`);
  } catch (err) {
    console.error('\ngenerators: output does not pass pnpm check.\n');
    console.error(
      '  A generator exists so scaffolding is correct without being corrected.' +
        '\n  Output that fails the checks breaks that promise silently.\n' +
        '\n  fix:  run the generator by hand, run pnpm check, and repair the' +
        '\n        template in turbo/generators/templates/\n',
    );
    if (err instanceof Error) console.error(err.message);
    cleanUp(created);
    run('pnpm', ['install', '--no-frozen-lockfile']);
    process.exit(1);
  }

  cleanUp(created);
  run('pnpm', ['install', '--no-frozen-lockfile']);
}

main();
