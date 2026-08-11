import type { StyleSpecification } from 'maplibre-gl';
import type { ColorScheme } from '../theme/systemColorScheme';
import { createLayerSpecs } from './layers/layerSpecs';
import { MAP_THEMES } from './mapThemePalette';

export { MAP_THEMES, type MapTheme } from './mapThemePalette';

export function basemapStyleForScheme(scheme: ColorScheme): string {
  return MAP_THEMES[scheme].basemapStyle;
}

export function layerSpecsForScheme(scheme: ColorScheme) {
  return createLayerSpecs(MAP_THEMES[scheme]);
}

const BROWSER_FREE_RENDERER_ORIGIN = 'http://127.0.0.1:4173';

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
        id: 'transitmapper-local-background',
        type: 'background',
        paint: { 'background-color': MAP_THEMES[scheme].background },
      },
    ],
  };
}
