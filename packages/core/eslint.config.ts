// No browser globals, although this package's tsconfig includes the DOM lib:
// that is for the ambient fetch and crypto typings only, and real browser
// globals would blur the boundary core-runtime-purity exists to enforce.
import transitmapper from '@transitmapper/eslint-plugin';
import { configs } from '@transitmapper/eslint-plugin/configs';

export default [
  ...configs.base,
  {
    files: ['**/*.ts'],
    plugins: { transitmapper },
    rules: {
      'transitmapper/core-runtime-purity': 'error',
    },
  },
];
