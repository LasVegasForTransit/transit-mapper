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
import { spawnSync } from 'node:child_process';
import {
  rmSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

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
  // Captured rather than inherited so a passing run stays quiet, then attached
  // to the error so a failing one is diagnosable. Reporting only the exit
  // status left CI saying "Command failed: pnpm check" and nothing else, which
  // is unactionable for whoever has to fix it.
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} exited ${result.status}\n${result.stdout}${result.stderr}`,
    );
  }
}

function cleanUp(paths: string[], originals: Map<string, string>): void {
  for (const p of paths) rmSync(resolve(ROOT, p), { recursive: true, force: true });
  for (const [p, contents] of originals) writeFileSync(resolve(ROOT, p), contents, 'utf8');
}

function restoreTree(created: string[], originals: Map<string, string>): void {
  // Reported rather than thrown: a failure here would replace the diagnosis
  // that sent us into the failure path with an unrelated one.
  try {
    cleanUp(created, originals);
    run('pnpm', ['install', '--no-frozen-lockfile']);
  } catch (restoreError) {
    if (restoreError instanceof Error) {
      console.error(`\ngenerators: restoring the tree also failed.\n${restoreError.message}`);
    }
  }
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

function checkFilenames(): ContractResult {
  const result = spawnSync('pnpm', ['check:filenames'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function assertFilenamesReject(expected: string): void {
  const result = checkFilenames();
  if (result.status === 0 || !result.output.includes(expected)) {
    throw new Error(`check:filenames did not reject ${expected}\n${result.output}`);
  }
}

function assertFilenamesAccept(description: string): void {
  const result = checkFilenames();
  if (result.status !== 0) {
    throw new Error(`check:filenames rejected ${description}\n${result.output}`);
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

function assertTestFilenameGuard(): void {
  const source = resolve(ROOT, 'packages/gencheck/src');
  const tests = resolve(ROOT, 'packages/gencheck/tests');
  const e2e = resolve(tests, 'e2e');
  const supportFixture = resolve(tests, 'support/fixture.test.ts');
  const allowed = [
    resolve(source, 'worker.ts'),
    resolve(tests, 'component.test.ts'),
    resolve(tests, 'component.test.tsx'),
    resolve(tests, 'verify.test.ts'),
    supportFixture,
    resolve(e2e, 'journey.spec.ts'),
    resolve(e2e, 'journey.spec.tsx'),
  ];
  const rejected = [
    resolve(source, 'worker.thread.ts'),
    resolve(tests, 'README.md'),
    resolve(tests, 'component.test.js'),
    resolve(tests, 'verify.ts'),
    resolve(tests, 'component.partial.test.ts'),
    resolve(tests, 'journey.spec.ts'),
    resolve(e2e, 'journey.test.ts'),
    resolve(tests, 'artifacts/report.json'),
  ];

  mkdirSync(e2e, { recursive: true });
  try {
    mkdirSync(dirname(supportFixture), { recursive: true });
    writeFileSync(supportFixture, 'export {};\n', 'utf8');
    run('pnpm', ['--filter', '@transitmapper/gencheck', 'verify']);

    for (const path of allowed) {
      if (path === supportFixture) continue;
      mkdirSync(dirname(path), { recursive: true });
      const contents = path.includes('.test.')
        ? "import { expect, it } from 'vitest';\nit('runs a generated test', () => expect(true).toBe(true));\n"
        : 'export {};\n';
      writeFileSync(path, contents, 'utf8');
    }
    assertFilenamesAccept('two-part source and three-part test filenames');
    run('pnpm', ['--filter', '@transitmapper/gencheck', 'verify']);

    for (const path of rejected) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, 'export {};\n', 'utf8');
      try {
        assertFilenamesReject(relative(ROOT, path).replaceAll('\\', '/'));
      } finally {
        rmSync(path, { force: true });
      }
    }
  } finally {
    for (const path of allowed) rmSync(path, { force: true });
    rmSync(e2e, { recursive: true, force: true });
    rmSync(resolve(tests, 'support'), { recursive: true, force: true });
    rmSync(resolve(tests, 'artifacts'), { recursive: true, force: true });
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

    const bypasses = [
      {
        description: 'a grouped direct verifier',
        command: '(tsx scripts/verify.ts)',
        expected: 'packages/gencheck/scripts/verify.ts',
      },
      {
        description: 'a direct verifier after a newline',
        command: 'tsx tests/verify.ts\ntsx scripts/second-verifier.ts',
        expected: 'packages/gencheck/scripts/second-verifier.ts',
      },
      {
        description: 'an expansion-bearing direct verifier',
        command: 'tsx tests/$ENTRY.ts',
        expected: 'unverifiable direct tsx command',
      },
    ];
    const missed = bypasses.flatMap(({ description, command, expected }) => {
      setGeneratedVerify(manifest, command);
      const result = checkContract();
      return result.status !== 0 && result.output.includes(expected) ? [] : [description];
    });
    if (missed.length > 0) {
      throw new Error(`check:contract did not reject ${missed.join(', ')}`);
    }
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
    assertTestFilenameGuard();
    assertDirectVerifierLayoutGuard();

    console.log(`generators: ${SCENARIOS.length} scenarios, output passes pnpm check unmodified.`);
  } catch (err) {
    console.error('\ngenerators: output does not pass pnpm check.\n');
    console.error(
      '  fix:  run the generator by hand, run pnpm check, and repair the' +
        '\n        template in turbo/generators/templates/\n',
    );
    if (err instanceof Error) console.error(err.message);
    restoreTree(created, originals);
    process.exit(1);
  }

  cleanUp(created, originals);
  run('pnpm', ['install', '--no-frozen-lockfile']);
}

main();
