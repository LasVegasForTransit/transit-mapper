import type { BrowserContext, Page } from 'playwright-core';
import sharp from 'sharp';

const BASEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/**';

/** Magenta is absent from every palette in `mapThemePalette`, so finding it on
 * the canvas can only mean the proof style painted it. The test is a hue test
 * rather than an exact match because the surface composites the basemap under
 * its own overlays, which darkens the fill without changing its character. */
const PROOF_CHANNEL_MARGIN = 40;
const PROOF_MINIMUM_COVERAGE = 0.3;
const PROOF_SETTLE_TIMEOUT_MS = 20_000;
const PROOF_POLL_INTERVAL_MS = 500;

/**
 * A basemap whose only visible content comes from a source rather than a paint
 * constant. MapLibre tessellates GeoJSON in its worker, so a dead worker paints
 * the background and nothing else — which is exactly the failure that shipped a
 * blank map while every style, sprite and attribution request returned 200.
 *
 * The polygon spans the whole world so the assertion holds at any camera the
 * surface under test happens to open at.
 */
export const BASEMAP_PROOF_STYLE = {
  version: 8 as const,
  sources: {
    'basemap-proof': {
      type: 'geojson' as const,
      data: {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            properties: {},
            geometry: {
              type: 'Polygon' as const,
              coordinates: [
                [
                  [-180, -85],
                  [180, -85],
                  [180, 85],
                  [-180, 85],
                  [-180, -85],
                ],
              ],
            },
          },
        ],
      },
    },
  },
  layers: [
    {
      id: 'basemap-proof-background',
      type: 'background' as const,
      paint: { 'background-color': '#ffffff' },
    },
    {
      id: 'basemap-proof-fill',
      type: 'fill' as const,
      source: 'basemap-proof',
      paint: { 'fill-color': '#ff00ff' },
    },
  ],
};

/** Serves the proof style wherever the app would ask for the real basemap. */
export async function routeBasemapProof(context: BrowserContext): Promise<void> {
  await context.route(BASEMAP_STYLE_URL, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(BASEMAP_PROOF_STYLE),
    }),
  );
}

/**
 * The middle of the map surface, with the map's own controls cropped away.
 *
 * Playwright renders the whole page and clips to the element box, so a
 * screenshot of the canvas still contains every control sitting over it — the
 * zoom buttons, the attribution bar, the drawing toolbar. Those alone carry
 * enough non-backdrop pixels to satisfy a content check on a map that painted
 * nothing, which is how the first version of this gate passed against a
 * deliberately broken worker.
 */
async function canvasImage(page: Page): Promise<Buffer> {
  const canvas = page.locator('.maplibregl-canvas').first();
  await canvas.waitFor({ state: 'visible', timeout: 30_000 });
  const full = await canvas.screenshot();
  const { width, height } = await sharp(full).metadata();
  if (!width || !height) return full;
  return sharp(full)
    .extract({
      left: Math.round(width * 0.2),
      top: Math.round(height * 0.2),
      width: Math.round(width * 0.6),
      height: Math.round(height * 0.6),
    })
    .png()
    .toBuffer();
}

/**
 * Fails when nothing of the system reached the map surface.
 *
 * `assertRendererCaptureHasSceneContent` cannot be reused here. It counts
 * pixels more than 24 per channel from the dominant colour and requires
 * area/2000 of them, which suits a renderer capture over a deterministic flat
 * backdrop. This surface is not that: measured against a deliberately broken
 * MapLibre worker, a map that painted nothing still produced 708 such pixels
 * against a 234 minimum, and passed.
 *
 * The separation is in the tail. Same crop, same fixture:
 *
 * | delta | blank map | painted map |
 * | ----- | --------- | ----------- |
 * | >= 24 |       708 |       2,170 |
 * | >= 40 |         6 |       1,145 |
 * | >= 60 |         0 |         832 |
 *
 * Faint backdrop gradient dies out by 60; transit ink does not. The minimum
 * scales with area so the gate survives a viewport change, and at the measured
 * crop it is 116 against 832 actually painted.
 */
const PAINT_CHANNEL_DELTA = 60;

export async function assertMapSurfacePainted(page: Page, subject: string): Promise<void> {
  const deadline = Date.now() + PROOF_SETTLE_TIMEOUT_MS;
  // A ready document is not a painted map. Projection, source upload and the
  // first frame all land after `data-document-status="ready"`, so an immediate
  // assertion measures an empty canvas on a perfectly healthy build.
  let { painted, minimum } = await paintedPixels(page);
  while (painted < minimum && Date.now() < deadline) {
    await page.waitForTimeout(PROOF_POLL_INTERVAL_MS);
    ({ painted, minimum } = await paintedPixels(page));
  }
  if (painted < minimum) {
    throw new Error(
      `The map painted nothing on ${subject}: ${painted} pixels differ from the ` +
        `backdrop by ${PAINT_CHANNEL_DELTA} or more within ` +
        `${PROOF_SETTLE_TIMEOUT_MS / 1_000}s, and at least ${minimum} are required. ` +
        'A canvas with correct geometry and no content is the blank-map failure ' +
        'this gate exists to catch.',
    );
  }
}

async function paintedPixels(page: Page): Promise<{ painted: number; minimum: number }> {
  const { data, info } = await sharp(await canvasImage(page))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const backdrop = dominantBackdrop(data);
  let painted = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    const delta = Math.max(
      Math.abs((data[offset] ?? 0) - backdrop[0]),
      Math.abs((data[offset + 1] ?? 0) - backdrop[1]),
      Math.abs((data[offset + 2] ?? 0) - backdrop[2]),
    );
    if (delta >= PAINT_CHANNEL_DELTA) painted += 1;
  }
  return { painted, minimum: Math.max(100, Math.ceil((info.width * info.height) / 4_000)) };
}

/** The most common colour, quantised, so a surface can be judged against its
 * own backdrop rather than an assumed one. */
function dominantBackdrop(data: Buffer): readonly [number, number, number] {
  const buckets = new Map<number, number>();
  for (let offset = 0; offset < data.length; offset += 4) {
    const bucket =
      (Math.floor((data[offset] ?? 0) / 8) << 10) |
      (Math.floor((data[offset + 1] ?? 0) / 8) << 5) |
      Math.floor((data[offset + 2] ?? 0) / 8);
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  let dominant = 0;
  let largest = -1;
  for (const [bucket, count] of buckets) {
    if (count > largest) {
      dominant = bucket;
      largest = count;
    }
  }
  return [((dominant >> 10) & 31) * 8 + 4, ((dominant >> 5) & 31) * 8 + 4, (dominant & 31) * 8 + 4];
}

/**
 * Fails unless the basemap's own source data reached the canvas. Distinct from
 * `assertMapSurfacePainted`, which a surface can satisfy on transit content
 * alone while the basemap beneath it is blank.
 */
export async function assertBasemapPainted(page: Page, subject: string): Promise<void> {
  const deadline = Date.now() + PROOF_SETTLE_TIMEOUT_MS;
  // The editor opens on its local drafting style and swaps to the basemap once
  // the remote style resolves, so the first frame after the document is ready
  // legitimately has no basemap on it yet.
  let coverage = await basemapCoverage(page);
  while (coverage < PROOF_MINIMUM_COVERAGE && Date.now() < deadline) {
    await page.waitForTimeout(PROOF_POLL_INTERVAL_MS);
    coverage = await basemapCoverage(page);
  }
  if (coverage < PROOF_MINIMUM_COVERAGE) {
    throw new Error(
      `The basemap did not paint on ${subject}: ` +
        `${(coverage * 100).toFixed(1)}% of the map surface carried basemap source data ` +
        `within ${PROOF_SETTLE_TIMEOUT_MS / 1_000}s, and at least ` +
        `${PROOF_MINIMUM_COVERAGE * 100}% is required. ` +
        'A style that loads while its sources never reach the canvas is the ' +
        'blank-basemap failure this gate exists to catch.',
    );
  }
}

/** The share of the map surface showing the proof fill, by hue rather than by
 * exact colour: both red and blue well above green is magenta at any
 * brightness, and nothing else on this surface has that signature. */
async function basemapCoverage(page: Page): Promise<number> {
  const { data, info } = await sharp(await canvasImage(page))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let matched = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    const red = data[offset] ?? 0;
    const green = data[offset + 1] ?? 0;
    const blue = data[offset + 2] ?? 0;
    if (red - green >= PROOF_CHANNEL_MARGIN && blue - green >= PROOF_CHANNEL_MARGIN) matched += 1;
  }
  return matched / (info.width * info.height);
}
