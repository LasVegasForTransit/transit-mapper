import { minify, type MinifyOptions } from 'terser';
import type { Plugin } from 'vite';

/**
 * Minifies each dedicated Worker bundle with the same terser settings as the
 * page bundles.
 *
 * Vite 8 builds every Worker as its own Rolldown bundle, and its terser pass
 * only runs on the page chunks. Left alone, `build.minify: 'terser'` ships
 * every Worker unminified: MapLibre's Worker grew from 499 kB to 664 kB, past
 * the 500 kB chunk budget, and the other Workers by about a third. Oxc's
 * minifier (`worker.rolldownOptions.output.minify`) closes most of that gap but
 * lands MapLibre's Worker just over the budget, so the Workers get the pass
 * they had under Vite 6 instead.
 *
 * The Worker build must also set `output.minify: false`. Rolldown's default
 * `'dce-only'` pass runs after this hook and reprints the result with
 * whitespace.
 */
export function terserWorkerBundles(options: MinifyOptions): Plugin {
  return {
    name: 'transitmapper:terser-worker-bundles',
    async renderChunk(code, _chunk, outputOptions) {
      const result = await minify(code, {
        safari10: true,
        ...options,
        sourceMap: Boolean(outputOptions.sourcemap),
        module: outputOptions.format.startsWith('es'),
        toplevel: outputOptions.format === 'cjs',
      });
      if (result.code === undefined) return null;
      if (result.map === undefined) return { code: result.code };
      return {
        code: result.code,
        map: typeof result.map === 'string' ? result.map : JSON.stringify(result.map),
      };
    },
  };
}
