import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'node:path';
import { loadBuildInfo } from './scripts/build-metadata';
import { resolveBuildOutputDirectory } from './scripts/build-output';
import {
  adaptiveAssetManifestPlugin,
  createEssentialPrecacheTransform,
} from './scripts/adaptive-assets';
import { ADAPTIVE_CACHE_NAME } from './src/pwa/adaptive-cache-contract';
import {
  MAP_ENGINE_MAXIMUM_RAW_BYTES,
  performanceChunkFileName,
  performanceChunkName,
} from './src/perf/chunkPolicy';
import { OFFLINE_EDITOR_ENTRY_NAME, OFFLINE_GLYPH_RANGE_FILES } from './src/perf/pwaPrecache';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const distDirectory = resolveBuildOutputDirectory(
  import.meta.dirname,
  process.env.VITE_PERF_BUILD === '1',
);
const buildInfo = loadBuildInfo({ repositoryRoot });

export default defineConfig({
  define: {
    __TRANSITMAPPER_BUILD_INFO__: JSON.stringify(buildInfo),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // `prompt`, not `autoUpdate`: the whole point is a visible "a new
      // version is available" banner the user acts on, not a version swapped
      // out from under them. See @transitmapper/pwa-updater's useAppUpdate for
      // the React side (used from App.tsx's provider-dependent editor session).
      registerType: 'prompt',
      // Registration happens with the native Service Worker API, only from
      // the editor startup lifecycle — never auto-injected, which would
      // otherwise land in embed.html too (see the multi-entry note below).
      injectRegister: false,
      // manifest.json below is already hand-written and linked from
      // index.html; don't let the plugin generate or inject its own.
      manifest: false,
      strategies: 'generateSW',
      workbox: {
        // Discover every possible local runtime asset, then reduce that list
        // to Vite's exact static editor graph. This keeps first install useful
        // offline without automatically downloading lazy tools, Workers, or
        // install artwork. The post-build verifier independently proves both
        // sides of that boundary.
        globPatterns: [
          'index.html',
          'manifest.json',
          'favicon.svg',
          'favicon-*.png',
          'icons/*.{png,svg}',
          'apple-touch-icon.png',
          'assets/**/*.{js,css,png,svg,webp,woff,woff2}',
          ...OFFLINE_GLYPH_RANGE_FILES,
        ],
        // embed.html is a separate product surface. Its entry remains
        // network-fetched, while chunks shared with the editor are naturally
        // cached because the editor needs them too.
        // Privacy is a small online policy document, not an installed-editor
        // dependency. Keeping it out also proves it cannot enter the eager
        // editor graph through the broad asset glob.
        globIgnores: ['adaptive-assets.json', 'privacy.html', 'embed.html', '**/embed-*'],
        manifestTransforms: [
          createEssentialPrecacheTransform(resolve(distDirectory, '.vite/manifest.json')),
        ],
        runtimeCaching: [
          {
            // A lazy feature or Worker becomes offline-capable after it is
            // actually used. Returning/installed sessions may fill this same
            // bounded cache gradually; a brand-new session never prefetches it.
            urlPattern: ({ sameOrigin, url }) =>
              sameOrigin &&
              (url.pathname.startsWith('/assets/') ||
                url.pathname.startsWith('/icons/') ||
                /^\/(?:apple-touch-icon|favicon-(?:dark-)?(?:16x16|32x32))\.png$/.test(
                  url.pathname,
                )),
            handler: 'CacheFirst',
            options: {
              cacheName: ADAPTIVE_CACHE_NAME,
              cacheableResponse: { statuses: [200] },
              expiration: {
                maxEntries: 256,
                maxAgeSeconds: 30 * 24 * 60 * 60,
                purgeOnQuotaError: true,
              },
            },
          },
        ],
        directoryIndex: null,
        // generateSW registers an offline navigateFallback to the precached
        // document automatically (confirmed against the actual build output —
        // it does this even with no navigateFallback option set at all), and
        // by default it's unrestricted: a NavigationRoute matching every
        // full-page navigation on the origin. Left alone, an offline hit on
        // /s/:id, /v/:id, /e/:id, or /embed/:id would silently get served the cached editor shell
        // instead of failing the way those Worker-routed paths actually
        // should (see run_worker_first in apps/worker/wrangler.toml). This
        // isn't an offline-capable-app feature, so those five prefixes are
        // excluded from the fallback rather than trying to disable it outright.
        navigateFallbackDenylist: [/^\/api\//, /^\/s\//, /^\/e\//, /^\/v\//, /^\/embed\//],
      },
    }),
    adaptiveAssetManifestPlugin({
      buildId: buildInfo.commitSha ?? buildInfo.releaseTag ?? buildInfo.version,
      distDirectory,
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
    outDir: distDirectory,
    sourcemap: true,
    // The product contract is the current and previous stable releases of the
    // evergreen engines. Emit the same ES2022 boundary TypeScript checks and
    // let those browsers use their native module-preload implementation.
    target: 'es2022',
    modulePreload: { polyfill: false },
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
      // Four entries, not one. embed.html is the read-only map that gets
      // iframed into other people's pages (/e/:id) — it deliberately shares
      // no bundle with the editor, so an embed downloads MapLibre and the
      // feature builder and none of the editing UI. privacy.html is semantic
      // HTML with no script at all and cannot join either JavaScript graph.
      // The offline editor entry gives Workbox a semantic root for the runtime
      // it must install without coupling the precache policy to a source file.
      input: {
        main: 'index.html',
        embed: 'embed.html',
        privacy: 'privacy.html',
        [OFFLINE_EDITOR_ENTRY_NAME]: resolve(import.meta.dirname, 'src/pwa/offline-editor.ts'),
      },
      output: {
        // Assign only modules owned by each stable package to that package's
        // cache boundary. Shared dependencies keep Rollup's normal ownership,
        // so a package chunk cannot drag editor-only code into the embed.
        onlyExplicitManualChunks: true,
        // Keep slow-changing runtimes cacheable across frequent editor
        // releases. Vite module-preloads these static imports in parallel.
        manualChunks: performanceChunkName,
        chunkFileNames: (chunk) => performanceChunkFileName(chunk.moduleIds),
      },
    },
  },
});
