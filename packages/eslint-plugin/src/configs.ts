// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- an import cannot reach a global declaration script, and every package that compiles this module needs it
/// <reference path="../../../lvbt-eslint-config.d.ts" />
// The configurations each package's eslint.config.ts starts from: the
// organization's baseline, plus what is true of every package in this
// repository and of no other. A package adds only the rules about itself.
//
// This module has no relative imports on purpose. Every package typechecks
// its eslint.config.ts, and so compiles whatever that file imports; a
// relative `.ts` import here would make every package opt in to
// `allowImportingTsExtensions` just to read its lint config.
import { config as base } from '@lasvegasfortransit/eslint-config/base';
import type { ESLint, Linter } from 'eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// `import { type X } from './m'` erases the specifier but keeps the
// statement, so under the shared config's `verbatimModuleSyntax` it emits
// `import './m'` — a side-effect import that pulls the whole module into the
// bundle. One of these put React into the embed's graph, which the embed
// delivery boundary forbids; nothing but a production build could see it,
// because the types are correct either way.
const repository: Linter.Config[] = [
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-import-type-side-effects': 'error',
    },
  },
];

// The organization also ships `browser` and `react-internal` entry points,
// but only `base` has a type declaration here (lvbt-eslint-config.d.ts), so
// the other two are composed from it: the same browser and service-worker
// globals, and the same two hook rules.
const browserGlobals: Linter.Config = {
  languageOptions: {
    globals: {
      ...globals.serviceworker,
      ...globals.browser,
    },
  },
};

// eslint-plugin-react-hooks 7 exposes its presets as `configs.flat.recommended`
// — a config object nested one level deeper than ESLint's `Plugin` type allows,
// which is a `Record<string, ConfigObject | ConfigObject[]>`. The rules used
// here are typed correctly; only the presets they do not touch are not.
// Asserting the shape is narrower than widening `Plugin`, and it fails loudly
// if the plugin ever stops being a plugin.
const reactHooksPlugin = reactHooks as unknown as ESLint.Plugin;

// The two classic hook rules only, listed explicitly rather than spreading one
// of the plugin's presets. As of version 7, every preset — `recommended`
// included — carries the React Compiler rule set (purity, immutability,
// set-state-in-effect, manual memoization). Those are a real decision about
// how this app is written, and belong in their own change. Plain `.ts` files
// are included because hooks such as useListboxKeyboardNav.ts live in them.
const hookRules: Linter.Config = {
  files: ['**/*.{ts,tsx}'],
  plugins: { 'react-hooks': reactHooksPlugin },
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'error',
  },
};

/** Named so a package that emits declarations can refer to its config's type. */
export type PackageConfig = Linter.Config[];

export const configs: Record<'base' | 'browser' | 'react', PackageConfig> = {
  /** A package with no DOM: core, views, the Worker, and repository tooling. */
  base: [...base, ...repository],
  /** A package that runs in the browser without React. */
  browser: [...base, browserGlobals, ...repository],
  /** A package that renders React. */
  react: [...base, browserGlobals, hookRules, ...repository],
};
