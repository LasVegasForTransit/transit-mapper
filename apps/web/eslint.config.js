import { config } from '@lvbt/eslint-config/react-internal';

export default [
  ...config,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // MapLibre declares `once(type, listener?): this | Promise<any>`: one
      // signature, optional listener, union return. Passing a listener returns
      // `this` at runtime and nothing is ever pending, but the declared union
      // makes every such call look like an unawaited promise.
      '@typescript-eslint/no-floating-promises': [
        'error',
        { allowForKnownSafeCalls: [{ from: 'package', package: 'maplibre-gl', name: 'once' }] },
      ],
    },
  },
];
