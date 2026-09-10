import globals from 'globals';

import { config as baseConfig } from './base.js';

/**
 * The shared ESLint configuration for packages that ship browser code without
 * React: an Astro site's client scripts, a Worker's static-asset app, a DOM
 * library. Adds the browser and service-worker globals to the base.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const config = [
  ...baseConfig,
  {
    languageOptions: {
      globals: {
        ...globals.serviceworker,
        ...globals.browser,
      },
    },
  },
];
