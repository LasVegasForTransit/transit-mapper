import { defineWranglerConfig } from 'wrangler/experimental-config';

// cf uses Wrangler to bundle this Worker; the Vite app is already built into
// apps/web/dist before cf runs. This only controls bundling and asset input.
export default defineWranglerConfig({
  types: { generate: false },
  assetsDirectory: '../web/dist',
});
