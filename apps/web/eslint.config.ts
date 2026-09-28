import { configs } from '@transitmapper/eslint-plugin/configs';

export default [
  ...configs.react,
  {
    // The performance runner creates this private alternate Vite artifact for
    // browser-only seams. It is generated code, never application source.
    ignores: ['.perf-harness-dist/**'],
  },
  {
    files: ['**/*.{ts,tsx}'],
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
];
