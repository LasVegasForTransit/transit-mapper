import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

/**
 * MapLibre 6 finds its own worker by resolving `./maplibre-gl-worker.mjs`
 * against `import.meta.url`. That reference is a runtime string rather than an
 * import a bundler can see, so once Rollup has folded MapLibre into a hashed
 * chunk it points at `/assets/maplibre-gl-worker.mjs`, which nothing emits.
 * The SPA fallback answers that path with `index.html`, the Worker constructor
 * is handed HTML, and MapLibre swallows the failure — the map then paints
 * nothing while the style, sprite, and attribution all load normally, with no
 * error on the console to say why.
 *
 * `?worker&url` is what fixes it: Vite bundles the worker and hands back the
 * emitted URL. Plain `?url` is not enough — it copies the file unprocessed, so
 * the worker's own `./maplibre-gl-shared.mjs` import then resolves to another
 * path the SPA fallback answers with HTML, and the worker dies loading its own
 * dependency instead.
 *
 * This runs on import rather than behind a function, and `mapTheme` imports it,
 * because every module that constructs a map takes a style from there. The app
 * shell must not reach MapLibre eagerly (`app-root-eager-closure-is-shell-only`),
 * so it cannot be called from an entry point.
 */
setWorkerUrl(workerUrl);
