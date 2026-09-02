import { config } from '@lvbt/eslint-config/base';
import transitmapper from '@transitmapper/eslint-plugin';

export default [
  ...config,
  {
    files: ['**/*.ts'],
    plugins: { transitmapper },
    // core is typechecked against the browser and workerd: a browser global
    // compiles and then throws in production.
    rules: { 'transitmapper/core-runtime-purity': 'error' },
  },
];
