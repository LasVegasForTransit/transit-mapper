import js from '@eslint/js';
import comments from '@eslint-community/eslint-plugin-eslint-comments';
import eslintConfigPrettier from 'eslint-config-prettier';
import turboPlugin from 'eslint-plugin-turbo';
import sonarjs from 'eslint-plugin-sonarjs';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Paths no LVBT repository lints: build output, caches, dependencies, agent
 * worktrees (full checkouts of the same repository), and typings that
 * `wrangler types` generates from configuration.
 */
const ignores = {
  ignores: [
    '**/.astro/**',
    '**/.turbo/**',
    '**/.wrangler/**',
    '**/coverage/**',
    '**/dist/**',
    '**/dist-archive/**',
    '**/node_modules/**',
    '**/playwright-report/**',
    '**/test-results/**',
    '.claude/worktrees/**',
    '**/worker-configuration.d.ts',
  ],
};

/**
 * Rules about the escape hatch itself. Every rule below can be switched off
 * one line at a time, so the suppressions have to be as accountable as the
 * code: a disable that no longer suppresses anything is an error, a bare
 * `eslint-disable` is an error, and every disable says why.
 */
const suppressionHygiene = {
  linterOptions: {
    reportUnusedDisableDirectives: 'error',
  },
  plugins: { '@eslint-community/eslint-comments': comments },
  rules: {
    '@eslint-community/eslint-comments/no-unlimited-disable': 'error',
    '@eslint-community/eslint-comments/no-duplicate-disable': 'error',
    '@eslint-community/eslint-comments/require-description': 'error',
  },
};

/**
 * Type-aware rules for TypeScript, from the nearest tsconfig.json (run ESLint
 * from the package directory, as `turbo run lint` does). The four departures
 * from the strict presets are measured, not guessed: each reported hundreds of
 * findings on real LVBT code that named a style the code chose on purpose
 * rather than something that could be wrong at runtime.
 */
const typescript = {
  files: ['**/*.{ts,tsx,mts,cts}'],
  languageOptions: {
    parserOptions: {
      projectService: true,
    },
  },
  rules: {
    '@typescript-eslint/consistent-type-imports': 'error',
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': 'error',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
    '@typescript-eslint/no-confusing-void-expression': [
      'error',
      { ignoreArrowShorthand: true, ignoreVoidOperator: true },
    ],
    '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    '@typescript-eslint/no-empty-function': 'off',
    '@typescript-eslint/array-type': 'off',
  },
};

/**
 * Plain JavaScript has no type information, so the type-aware rules are off
 * and `no-undef` needs to know the runtime. Node covers every script and
 * config file a repository keeps in JavaScript.
 */
const javascript = {
  files: ['**/*.{js,mjs,cjs,jsx}'],
  ...tseslint.configs.disableTypeChecked,
  languageOptions: { globals: globals.node },
};

/**
 * Caps on the shape of code. A length cap does not produce good structure on
 * its own; it produces a moment where somebody has to decide where the seam
 * goes. Blank lines and comments are excluded, because comments explaining
 * why code is the way it is are required, not charged for.
 */
const shape = {
  rules: {
    'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
    'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }],
    'max-depth': ['error', 4],
    'max-params': ['error', 4],
    'max-nested-callbacks': ['error', 3],
    complexity: ['error', 15],
  },
};

/**
 * Four rules from eslint-plugin-sonarjs. Its `recommended` preset enables
 * over two hundred, including ones that fail a build on a TODO comment.
 */
const sonar = {
  plugins: { sonarjs },
  rules: {
    'sonarjs/cognitive-complexity': ['error', 15],
    'sonarjs/no-identical-functions': 'error',
    'sonarjs/no-duplicated-branches': 'error',
    'sonarjs/no-collapsible-if': 'error',
  },
};

/**
 * A test file is one describe callback holding the suite, so the
 * per-function length and nesting caps measure how the author organised it,
 * not its quality. The per-file cap still applies.
 */
const tests = {
  files: ['**/tests/**', '**/*.{test,spec}.{ts,tsx,js,mjs}'],
  rules: {
    'max-lines-per-function': 'off',
    'max-nested-callbacks': 'off',
  },
};

const turbo = {
  plugins: { turbo: turboPlugin },
  rules: {
    'turbo/no-undeclared-env-vars': 'error',
  },
};

/**
 * A shared ESLint configuration for every LVBT repository. Prettier's config
 * is last so formatting is never a lint error.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const config = [
  ignores,
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  typescript,
  javascript,
  suppressionHygiene,
  shape,
  sonar,
  tests,
  turbo,
  eslintConfigPrettier,
];
