import type { StyleSpecification } from 'maplibre-gl';
import type { ColorScheme } from '../theme/systemColorScheme';
import { createLayerSpecs } from './layers/layerSpecs';
import { MAP_THEMES } from './mapThemePalette';

export { MAP_THEMES, type MapTheme } from './mapThemePalette';

export function basemapStyleForScheme(scheme: ColorScheme): string {
  return MAP_THEMES[scheme].basemapStyle;
}

/**
 * A remote style failure can leave MapLibre's first style transition unable to
 * initialize the editor overlay. When the browser already knows it is
 * offline, begin with the local drafting style instead of making that request.
 */
export function initialEditorStyleForScheme(
  scheme: ColorScheme,
  online: boolean = navigator.onLine,
): string | StyleSpecification {
  return online ? basemapStyleForScheme(scheme) : localBlankStyleForScheme(scheme);
}

export function layerSpecsForScheme(scheme: ColorScheme) {
  return createLayerSpecs(MAP_THEMES[scheme]);
}

const BROWSER_FREE_RENDERER_ORIGIN = 'http://127.0.0.1:4173';
const LOCAL_BACKGROUND_LAYER_ID = 'transitmapper-local-background';

function localGlyphsUrl(): string {
  const runtime: { readonly location?: { readonly origin?: string } } = globalThis;
  const origin = runtime.location?.origin ?? BROWSER_FREE_RENDERER_ORIGIN;
  return `${origin}/glyphs/noto-sans-v1/{fontstack}/{range}.pbf`;
}

export function localBlankStyleForScheme(scheme: ColorScheme): StyleSpecification {
  return {
    version: 8,
    // MapLibre 4 rejects every text symbol layer when a style has no glyph
    // template. The versioned same-origin endpoint keeps fallback and capture
    // labels deterministic without depending on the unavailable basemap host.
    glyphs: localGlyphsUrl(),
    sources: {},
    layers: [
      {
        id: LOCAL_BACKGROUND_LAYER_ID,
        type: 'background',
        // Keep the MapLibre canvas transparent here. The editor container
        // supplies the local drafting surface beneath it, which gives an
        // offline or capture map orientation without masking a real basemap.
        paint: {
          'background-color': MAP_THEMES[scheme].background,
          'background-opacity': 0,
        },
      },
    ],
  };
}
