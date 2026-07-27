import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // `prompt`, not `autoUpdate`: the whole point is a visible "a new
      // version is available" banner the user acts on, not a version swapped
      // out from under them. See @transitmapper/pwa-updater's useAppUpdate for
      // the React side (used from App.tsx).
      registerType: "prompt",
      // Registration happens by hand, only from App.tsx (via
      // virtual:pwa-register/react) — never auto-injected, which would
      // otherwise land in embed.html too (see the two-entry note below).
      injectRegister: false,
      // manifest.json below is already hand-written and linked from
      // index.html; don't let the plugin generate or inject its own.
      manifest: false,
      strategies: "generateSW",
      workbox: {
        // Precache ONLY the editor's own entry. The default globPatterns
        // would glob this whole dist/ output, including embed.html and its
        // bundle (MapLibre included) — exactly the cross-contamination the
        // two-entry build below exists to avoid. index.html's own hashed
        // script src already changes on every deploy, which is all Workbox
        // needs to detect a new build; nothing else needs precaching for that.
        globPatterns: ["index.html"],
        globIgnores: ["embed.html", "**/embed-*"],
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
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      // Two entries, not one. embed.html is the read-only map that gets
      // iframed into other people's pages (/e/:id) — it deliberately shares
      // no bundle with the editor, so an embed downloads MapLibre and the
      // feature builder and none of the editing UI.
      input: {
        main: "index.html",
        embed: "embed.html",
      },
    },
  },
});
