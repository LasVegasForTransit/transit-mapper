import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import {
  MAP_ENGINE_MAXIMUM_RAW_BYTES,
  performanceChunkFileName,
  performanceChunkName,
} from './src/perf/chunkPolicy';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // `prompt`, not `autoUpdate`: the whole point is a visible "a new
      // version is available" banner the user acts on, not a version swapped
      // out from under them. See @transitmapper/pwa-updater's useAppUpdate for
      // the React side (used from App.tsx).
      registerType: 'prompt',
      // Registration happens by hand, only from App.tsx (via
      // virtual:pwa-register/react) — never auto-injected, which would
      // otherwise land in embed.html too (see the two-entry note below).
      injectRegister: false,
      // manifest.json below is already hand-written and linked from
      // index.html; don't let the plugin generate or inject its own.
      manifest: false,
      strategies: 'generateSW',
      workbox: {
        // A person can reopen the installed editor after the HTTP cache has
        // been evicted. Cache the editor's eager and lazy chunks plus the
        // locally hosted install assets, not merely its HTML shell. The
        // deterministic post-build verifier walks Vite's manifest and proves
        // this glob still covers the complete editor graph.
        globPatterns: [
          'index.html',
          'manifest.json',
          'favicon.svg',
          'favicon-*.png',
          'icons/*.{png,svg}',
          'apple-touch-icon.png',
          'assets/**/*.{js,css,png,svg,webp,woff,woff2}',
        ],
        // embed.html is a separate product surface. Its entry remains
        // network-fetched, while chunks shared with the editor are naturally
        // cached because the editor needs them too.
        globIgnores: ['embed.html', '**/embed-*'],
        directoryIndex: null,
        // generateSW registers an offline navigateFallback to the precached
        // document automatically (confirmed against the actual build output —
        // it does this even with no navigateFallback option set at all), and
        // by default it's unrestricted: a NavigationRoute matching every
        // full-page navigation on the origin. Left alone, an offline hit on
        // /s/:id or /e/:id would silently get served the cached EDITOR shell
        // instead of failing the way those Worker-routed paths actually
        // should (see run_worker_first in apps/worker/wrangler.toml). This
        // isn't an offline-capable-app feature, so those three prefixes are
        // excluded from the fallback rather than trying to disable it outright.
        navigateFallbackDenylist: [/^\/api\//, /^\/s\//, /^\/e\//],
      },
    }),
  ],
  server: {
    // Honour PORT so a second checkout of this repo can run its own dev
    // server alongside the first instead of losing the race for 5173. Unset
    // (the normal case) leaves Vite on its own default.
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Terser costs a little more build time than Vite's default esbuild
    // minifier, but keeps the complete editor graph within its transfer
    // budget without hiding lazy features from the entrypoint report.
    minify: 'terser',
    // Additional compression passes recover size exposed by the stable vendor
    // boundaries below. It is deterministic and avoids unsafe transforms.
    terserOptions: { compress: { passes: 4 } },
    // The post-build performance reporter walks each entry's full import
    // closure from this manifest. Console chunk warnings cannot tell whether
    // a byte is paid by the editor, the embed, or both.
    manifest: true,
    // MapLibre 4 is one prebundled module and cannot be divided by Rollup.
    // report-bundle.ts gives it a narrow 810 kB exception while failing every
    // other emitted JavaScript chunk above 500 kB.
    chunkSizeWarningLimit: MAP_ENGINE_MAXIMUM_RAW_BYTES / 1_000,
    rollupOptions: {
      // Two entries, not one. embed.html is the read-only map that gets
      // iframed into other people's pages (/e/:id) — it deliberately shares
      // no bundle with the editor, so an embed downloads MapLibre and the
      // feature builder and none of the editing UI.
      input: {
        main: 'index.html',
        embed: 'embed.html',
      },
      output: {
        // Keep slow-changing runtimes cacheable across frequent editor
        // releases. Vite module-preloads these static imports in parallel.
        manualChunks: performanceChunkName,
        chunkFileNames: (chunk) => performanceChunkFileName(chunk.moduleIds),
      },
    },
  },
});
