/**
 * The organization's Prettier settings. A repository that needs a plugin (for
 * example prettier-plugin-astro on an Astro site) spreads this object and adds
 * `plugins` and `overrides` in its own prettier.config.mjs.
 *
 * @type {import('prettier').Config}
 */
const config = {
  printWidth: 100,
  proseWrap: 'always',
  singleQuote: true,
  trailingComma: 'all',
};

export default config;
