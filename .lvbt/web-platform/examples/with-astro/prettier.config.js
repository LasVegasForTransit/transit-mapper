import lvbt from '@lvbt/prettier-config';

export default {
  ...lvbt,
  plugins: ['prettier-plugin-astro'],
  overrides: [{ files: '*.astro', options: { parser: 'astro' } }],
};
