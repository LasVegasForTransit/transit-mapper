import { Resvg } from "@cf-wasm/resvg";
import publicSansRegular from "@fontsource/public-sans/files/public-sans-latin-400-normal.woff2";
import publicSansBold from "@fontsource/public-sans/files/public-sans-latin-700-normal.woff2";
import type { TransitSystem } from "@transitmapper/core/model/system";
import { PREVIEW_FONT_FAMILY, PREVIEW_WIDTH, previewSvg } from "@transitmapper/core/render/preview";

// The rasterizing half of preview images. The share page used to advertise a
// single static og:image for every system, because drawing a system needed a
// map and the Worker has no map. It doesn't need one any more: core/render
// draws the same schematic the app's SVG export does, through a pure mercator
// projection instead of MapLibre's, and resvg turns that into the PNG that
// link unfurlers actually accept (Slack, Discord, iMessage and Twitter all
// refuse SVG for og:image).

// Public Sans — the org's brand face (lasvegasfortransit.org/brand) — latin
// subset, regular + bold.
// resvg has no system fonts to fall back on inside a Worker, so whatever we
// hand it here is the entire universe of glyphs a preview can draw. A system
// named in a non-latin script therefore renders any text as blank boxes; the
// map itself is unaffected, and the fix when it matters is another subset here,
// not a different architecture. (Only woff2 works: resvg silently draws
// nothing at all for plain woff.)
const FONT_BUFFERS = [new Uint8Array(publicSansRegular), new Uint8Array(publicSansBold)];

/** Rasterizes a system to PNG bytes at Open Graph card size.
 *
 *  `Resvg.async` rather than `new Resvg`: the wasm compiles once per isolate,
 *  kicked off by the package's own workerd entry at import time, and this is
 *  what waits for it. Calling initResvg() ourselves throws — it's already been
 *  called by the time this module loads. */
export async function renderPreviewPng(system: TransitSystem): Promise<Uint8Array> {
  const resvg = await Resvg.async(previewSvg(system), {
    // The card is composed at half this width and scaled up here, which is
    // what makes its type read at unfurl size (see core's render/preview.ts).
    // Vector in, vector out — scaling up costs no sharpness.
    fitTo: { mode: "width", value: PREVIEW_WIDTH },
    font: {
      fontBuffers: FONT_BUFFERS,
      defaultFontFamily: PREVIEW_FONT_FAMILY,
      loadSystemFonts: false,
    },
  });
  return resvg.render().asPng();
}
