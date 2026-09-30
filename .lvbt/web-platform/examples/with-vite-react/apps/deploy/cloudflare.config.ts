import { defineConfig } from 'cf/config';

// Set CLOUDFLARE_ACCOUNT_ID in the deploy environment before publishing.
export default defineConfig({
  worker: {
    name: 'lvbt-app',
    compatibilityDate: '2026-08-31',
    previewUrls: true,
    assets: {
      notFoundHandling: 'single-page-application',
    },
    observability: {
      enabled: true,
    },
  },
});
