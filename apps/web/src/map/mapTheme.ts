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

export function localBlankStyleForScheme(scheme: ColorScheme): StyleSpecification {
  return {
    version: 8,
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
