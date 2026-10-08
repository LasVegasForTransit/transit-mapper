import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import rootConfig from '../../vitest.config.js';

const root = resolve(import.meta.dirname, '../..');
interface ResolvedConfiguration {
  compilerOptions: Record<string, unknown>;
  files: string[];
}

test('root tooling inherits the shared compiler baseline while preserving its Node execution and strict ambient checks', () => {
  const config = JSON.parse(
    execFileSync('pnpm', ['exec', 'tsc', '--showConfig', '-p', 'tsconfig.json'], {
      cwd: root,
      encoding: 'utf8',
    }),
  ) as ResolvedConfiguration;
  expect(config.compilerOptions).toMatchObject({
    isolatedModules: true,
    verbatimModuleSyntax: true,
    noFallthroughCasesInSwitch: true,
    noUncheckedIndexedAccess: true,
    strict: true,
    module: 'nodenext',
    moduleResolution: 'nodenext',
    target: 'es2022',
    skipLibCheck: false,
    exactOptionalPropertyTypes: true,
    allowImportingTsExtensions: true,
    types: ['node'],
  });
  expect(config.files).toContain('./eslint.config.ts');
  expect(config.files).toContain('./turbo/generators/config.ts');
  expect(config.files.some((file) => file.startsWith('./scripts/tests/'))).toBe(true);
  expect(config.files.some((file) => file.startsWith('./apps/'))).toBe(false);
});

test('root fixture suites retain their timeout and scope while shared collection rejects empty suites and generated support', () => {
  expect(rootConfig.test).toMatchObject({
    passWithNoTests: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    include: ['scripts/tests/**/*.test.{ts,tsx}'],
  });
  expect(rootConfig.test?.exclude).toEqual(
    expect.arrayContaining([
      '**/dist/**',
      'tests/e2e/**',
      'tests/support/**',
      'scripts/tests/support/**',
    ]),
  );
});
