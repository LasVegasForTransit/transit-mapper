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
import { execFileSync, spawnSync } from 'node:child_process';
import {
  rmSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

interface Scenario {
  generator: string;
  args: string[];
  /** Removed afterwards, whether the run passed or failed. */
  creates: string[];
  /**
   * Existing files the generator edits rather than creates. Their contents
   * are captured before the run and written back after.
   *
   * Deleting a path is not enough once a generator edits something that was
   * already tracked: the `package` generator adds the new package to the
   * project map, and without this the check left that entry behind on every
   * run, so the repository came back dirty from a command that only reads.
   */
  modifies?: string[];
}

const SCENARIOS: Scenario[] = [
  {
    generator: 'package',
    args: ['gencheck', 'A package generated to verify the generator'],
    creates: ['packages/gencheck'],
    modifies: ['docs/development/reference/project-structure.md'],
  },
  {
    generator: 'lint-rule',
    args: ['no-gencheck-placeholder', 'A rule generated to verify the generator'],
    creates: [
      'packages/eslint-plugin/src/no-gencheck-placeholder.ts',
      'packages/eslint-plugin/tests/no-gencheck-placeholder.test.ts',
    ],
  },
];

function run(command: string, args: string[]): void {
  execFileSync(command, args, { cwd: ROOT, stdio: 'pipe' });
}

function cleanUp(paths: string[], originals: Map<string, string>): void {
  for (const p of paths) rmSync(resolve(ROOT, p), { recursive: true, force: true });
  for (const [p, contents] of originals) writeFileSync(resolve(ROOT, p), contents, 'utf8');
}

interface ContractResult {
  status: number | null;
  output: string;
}

function checkContract(): ContractResult {
  const result = spawnSync('pnpm', ['check:contract'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function assertContractRejects(expected: string): string {
  const result = checkContract();
  if (result.status === 0 || !result.output.includes(expected)) {
    throw new Error(`check:contract did not reject ${expected}`);
  }
  return result.output;
}

function assertContractAccepts(description: string): void {
  const result = checkContract();
  if (result.status !== 0) {
    throw new Error(`check:contract rejected ${description}\n${result.output}`);
  }
}

function assertTestLayoutGuard(): void {
  const allowed = resolve(ROOT, 'packages/gencheck/tests/index.test.ts');
  const misplaced = resolve(ROOT, 'packages/gencheck/src/index.test.ts');

  renameSync(allowed, misplaced);
  try {
    assertContractRejects('packages/gencheck/src/index.test.ts');
  } finally {
    renameSync(misplaced, allowed);
  }
}

function assertNonCodePackageLayoutGuard(): void {
  const directory = resolve(ROOT, 'packages/tsconfig/testing');
  const fixture = resolve(directory, 'gencheck-fixture.json');
  const directoryExisted = existsSync(directory);

  mkdirSync(directory, { recursive: true });
  writeFileSync(fixture, '{}\n', 'utf8');
  try {
    assertContractRejects('packages/tsconfig/testing/gencheck-fixture.json');
  } finally {
    rmSync(fixture, { force: true });
    if (!directoryExisted) rmdirSync(directory);
  }
}

function setGeneratedVerify(manifest: string, command: string): void {
  const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as {
    scripts: Record<string, string>;
  };
  parsed.scripts.verify = command;
  writeFileSync(manifest, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
}

function assertDirectVerifierLayoutGuard(): void {
  const manifest = resolve(ROOT, 'packages/gencheck/package.json');
  const original = readFileSync(manifest, 'utf8');

  try {
    setGeneratedVerify(manifest, 'tsx src/index.ts && tsx tests/../src/index.ts');
    const duplicateOutput = assertContractRejects('packages/gencheck/src/index.ts');
    if (duplicateOutput.split('packages/gencheck/src/index.ts').length - 1 !== 1) {
      throw new Error('check:contract did not de-duplicate canonical direct verifier paths');
    }

    setGeneratedVerify(manifest, 'tsx ././tests/index.test.ts');
    assertContractAccepts('the canonical tests/ verifier path');

    setGeneratedVerify(manifest, 'tsx --tsconfig "tsconfig.json" "src/index.ts"');
    assertContractRejects('packages/gencheck/src/index.ts');

    setGeneratedVerify(manifest, 'tsx --watch src/index.ts');
    assertContractRejects('unverifiable direct tsx command');
  } finally {
    writeFileSync(manifest, original, 'utf8');
  }
}

function main(): void {
  const created: string[] = [];
  const originals = new Map<string, string>();
  try {
    for (const scenario of SCENARIOS) {
      // Captured before the generator runs, and only once, so a scenario
      // listed twice cannot record already-modified contents as the original.
      for (const p of scenario.modifies ?? []) {
        if (!originals.has(p)) originals.set(p, readFileSync(resolve(ROOT, p), 'utf8'));
      }
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
    assertTestLayoutGuard();
    assertNonCodePackageLayoutGuard();
    assertDirectVerifierLayoutGuard();

    console.log(`generators: ${SCENARIOS.length} scenarios, output passes pnpm check unmodified.`);
  } catch (err) {
    console.error('\ngenerators: output does not pass pnpm check.\n');
    console.error(
      '  fix:  run the generator by hand, run pnpm check, and repair the' +
        '\n        template in turbo/generators/templates/\n',
    );
    if (err instanceof Error) console.error(err.message);
    cleanUp(created, originals);
    run('pnpm', ['install', '--no-frozen-lockfile']);
    process.exit(1);
  }

  cleanUp(created, originals);
  run('pnpm', ['install', '--no-frozen-lockfile']);
}

main();
