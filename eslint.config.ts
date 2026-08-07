// The org's baseline lives in @transitmapper/config-eslint, so this file holds
// only what is true of this repository and nothing that would be true of any
// other. Each block below is scoped to the package it is about.
import { defineTypeAwareConfig } from '@transitmapper/config-eslint';
import transitmapper from '@transitmapper/eslint-plugin';
import type { ESLint } from 'eslint';
import reactHooks from 'eslint-plugin-react-hooks';

// eslint-plugin-react-hooks 7 exposes its presets as `configs.flat.recommended`
// — a config object nested one level deeper than ESLint's `Plugin` type allows,
// which is a `Record<string, ConfigObject | ConfigObject[]>`. The rules this
// file actually uses are typed correctly; only the presets it does not touch
// are not. Asserting the shape is narrower than widening `Plugin`, and it fails
// loudly if the plugin ever stops being a plugin.
const reactHooksPlugin = reactHooks as unknown as ESLint.Plugin;

export default defineTypeAwareConfig(
  import.meta.dirname,
  // The two classic hook rules only, listed explicitly rather than spreading
  // one of the plugin's presets. As of eslint-plugin-react-hooks 7, every
  // preset — `recommended` included — carries the React Compiler rule set
  // (purity, immutability, set-state-in-effect, manual memoization), which
  // reports 14 findings here. Those are a real decision about how this app is
  // written, and belong in their own change rather than riding along.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooksPlugin },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    files: ['packages/core/**/*.ts'],
    plugins: { transitmapper },
    rules: {
      'transitmapper/core-runtime-purity': 'error',
    },
  },
);
