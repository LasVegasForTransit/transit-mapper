// The org's baseline lives in @lvbt/eslint-config, so this file holds only
// what is true of this repository and nothing that would be true of any
// other. Each block below is scoped to the package it is about.
//
// One file rather than one per package: ESLint's flat config resolves by
// walking up from the linted file to the nearest eslint.config.*, so every
// package's `eslint .` already reaches this file. @lvbt/eslint-config ships
// separate `base`/`browser`/`react-internal` entry points for repositories
// that give each package its own config file; this repository instead layers
// the same globals and rules those entry points add, scoped to the packages
// that need them, onto the one shared `base`.
import { config as baseConfig } from '@lvbt/eslint-config/base';
import transitmapper from '@transitmapper/eslint-plugin';
import type { ESLint } from 'eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

// eslint-plugin-react-hooks 7 exposes its presets as `configs.flat.recommended`
// — a config object nested one level deeper than ESLint's `Plugin` type allows,
// which is a `Record<string, ConfigObject | ConfigObject[]>`. The rules this
// file actually uses are typed correctly; only the presets it does not touch
// are not. Asserting the shape is narrower than widening `Plugin`, and it fails
// loudly if the plugin ever stops being a plugin.
const reactHooksPlugin = reactHooks as unknown as ESLint.Plugin;

// Packages whose src touches the DOM (own tsconfig admits the DOM lib), so
// `no-undef`-style resolution needs the browser and service-worker globals
// @lvbt/eslint-config/browser would add. packages/core deliberately stays
// out of this list: it also includes the DOM lib, for ambient fetch/crypto
// typings only, and giving it real browser globals would blur the boundary
// the transitmapper/core-runtime-purity rule below exists to enforce.
const BROWSER_PACKAGES = [
  'apps/web/**',
  'packages/map/**',
  'packages/renderer/**',
  'packages/workspace/**',
  'packages/pwa-updater/**',
];

export default [
  ...baseConfig,
  {
    files: BROWSER_PACKAGES,
    languageOptions: {
      globals: {
        ...globals.serviceworker,
        ...globals.browser,
      },
    },
  },
  {
    // The performance runner creates this private alternate Vite artifact for
    // browser-only seams. It is generated code, never application source.
    ignores: ['apps/web/.perf-harness-dist/**'],
  },
  // The two classic hook rules only, listed explicitly rather than spreading
  // one of eslint-plugin-react-hooks's presets. As of version 7, every preset
  // — `recommended` included — carries the React Compiler rule set (purity,
  // immutability, set-state-in-effect, manual memoization), which reports
  // findings here. Those are a real decision about how this app is written,
  // and belong in their own change rather than riding along.
  {
    files: ['apps/web/**/*.{ts,tsx}', 'packages/workspace/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooksPlugin },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      // MapLibre declares `once(type, listener?): this | Promise<any>` — one
      // signature, optional listener, union return. Passing a listener returns
      // `this` at runtime and nothing is ever pending, but the declared union
      // makes every such call look like an unawaited promise. That was 18 of
      // the 19 findings this rule reported here, and it would report one more
      // for every new file that touches the map. Freezing them in the ledger
      // would keep a false positive alive forever, so the call is allowed
      // instead.
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          allowForKnownSafeCalls: [{ from: 'package', package: 'maplibre-gl', name: 'once' }],
        },
      ],
    },
  },
  {
    files: ['packages/core/**/*.ts'],
    plugins: { transitmapper },
    rules: {
      'transitmapper/core-runtime-purity': 'error',
    },
  },
];
