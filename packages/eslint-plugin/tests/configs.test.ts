import path from 'node:path';
import { ESLint } from 'eslint';
import type { Linter } from 'eslint';
import { expect, test } from 'vitest';
import { configs } from '../src/configs.js';

async function resolved(kind: keyof typeof configs, extension = 'ts') {
  const eslint = new ESLint({
    cwd: path.resolve(import.meta.dirname, '..'),
    overrideConfigFile: true,
    overrideConfig: configs[kind],
  });
  const config = (await eslint.calculateConfigForFile(`src/policy-fixture.${extension}`)) as
    Linter.Config | undefined;
  if (!config) throw new Error('The package configuration did not match its TypeScript source.');
  return config;
}

test('shared browser and service worker globals remain absent from runtime-neutral packages', async () => {
  const base = await resolved('base');
  const browser = await resolved('browser');
  expect(base.languageOptions?.globals ?? {}).not.toHaveProperty('document');
  expect(base.languageOptions?.globals ?? {}).not.toHaveProperty('clients');
  expect(browser.languageOptions?.globals).toHaveProperty('document');
  expect(browser.languageOptions?.globals).toHaveProperty('clients');
});

test('React packages retain classic hooks in plain TypeScript and TSX with the product import boundary', async () => {
  for (const extension of ['ts', 'tsx']) {
    const react = await resolved('react', extension);
    expect(react.rules?.['react-hooks/rules-of-hooks']).toEqual([2]);
    expect(react.rules?.['react-hooks/exhaustive-deps']).toEqual([2]);
    expect(react.rules?.['@typescript-eslint/no-import-type-side-effects']).toEqual([2]);
  }
  const base = await resolved('base');
  expect(base.rules?.['react-hooks/rules-of-hooks']).toBeUndefined();
  expect(base.rules?.['@typescript-eslint/no-import-type-side-effects']).toEqual([2]);
});
