import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { describe, it } from 'vitest';
import { coreRuntimePurity } from '../src/core-runtime-purity';

// RuleTester drives its own describe/it. Handing it Vitest's means failures
// report as ordinary test failures rather than as thrown assertions.
RuleTester.describe = describe;
RuleTester.it = it;

// The TypeScript parser, not the default espree — the code this rule guards
// is TypeScript, and several cases below turn on type annotations, which
// espree cannot parse at all.
const ruleTester = new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: 'module' },
});

ruleTester.run('core-runtime-purity', coreRuntimePurity, {
  valid: [
    // The globals both runtimes actually provide, which is why core's
    // tsconfig pulls in the DOM lib at all.
    { code: 'export const r = await fetch("https://example.com");' },
    { code: 'export const id = crypto.randomUUID();' },
    { code: 'export const copy = structuredClone({ a: 1 });' },

    // A local binding that happens to share the name is the author's own
    // variable. Reporting it would be a false positive that teaches people
    // to disable the rule.
    { code: 'export function draw(document: string) { return document.length; }' },
    { code: 'const window = { width: 10 }; export const w = window.width;' },
    { code: 'export function f() { const localStorage = new Map(); return localStorage.size; }' },

    // A property named `document` is not the global.
    { code: 'export const meta = { document: "spec.pdf" };' },
    { code: 'export function read(o: { document: string }) { return o.document; }' },
  ],

  invalid: [
    {
      code: 'export const w = window.innerWidth;',
      errors: [{ messageId: 'forbidden' }],
    },
    {
      code: 'export function mount() { return document.body; }',
      errors: [{ messageId: 'forbidden' }],
    },
    {
      code: 'export const saved = localStorage.getItem("system");',
      errors: [{ messageId: 'forbidden' }],
    },
    {
      // Two distinct globals, two distinct reports.
      code: 'export const x = window.scrollY + document.body.clientHeight;',
      errors: [{ messageId: 'forbidden' }, { messageId: 'forbidden' }],
    },
  ],
});
