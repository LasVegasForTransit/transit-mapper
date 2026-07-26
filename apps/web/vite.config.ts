import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
