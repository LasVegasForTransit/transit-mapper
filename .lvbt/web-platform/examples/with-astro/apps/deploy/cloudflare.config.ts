import { defineConfig } from 'cf/config';

// Set CLOUDFLARE_ACCOUNT_ID in the deploy environment before publishing.
export default defineConfig({
  worker: {
    name: 'lvbt-site',
    compatibilityDate: '2026-08-31',
    previewUrls: true,
    assets: {
      notFoundHandling: '404-page',
    },
    observability: {
      enabled: true,
    },
  },
});
