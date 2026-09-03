import type { LayerSpecification } from 'maplibre-gl';
import { MAP_THEMES, type MapTheme } from '../mapThemePalette';
import { patternOverlayLayerSpecs } from './pattern-overlay-layer-specs';
import {
  lineSceneLayerSpecs,
  serviceHitLayerSpecs,
  serviceLineLayerSpecs,
  servicePaintLayerSpecs,
} from './service-layer-specs';
import {
  contextLayerSpecs,
  physicalPlaceLayerSpecs,
  streetDetailLayerSpecs,
  streetGuidanceLayerSpecs,
} from './street-layer-specs';
import { corridorLayerSpecs, corridorPaintLayerSpecs } from './corridor-layer-specs';
import { serviceControlLayerSpecs } from './service-layer-specs';
import { labelLayerSpecs, stationLayerSpecs, vehicleLayerSpecs } from './place-layer-specs';
import {
  drawingPreviewLayerSpecs,
  editorPointLayerSpecs,
  facilityLayerSpecs,
  gestureLayerSpecs,
} from './editor-layer-specs';

export function createLayerSpecs(theme: MapTheme): LayerSpecification[] {
  return [
    ...contextLayerSpecs(theme),
    // The lower-detail corridor is the underlay during a District/Street
    // cross-fade. Street surfaces paint above it, then selection halos paint
    // above both so neither the physical fill nor the fading silhouette can
    // bury interaction feedback.
    ...corridorPaintLayerSpecs(theme),
    ...streetDetailLayerSpecs(theme),
    ...streetGuidanceLayerSpecs(theme),
    ...physicalPlaceLayerSpecs(theme),
    ...corridorLayerSpecs(theme),
    ...serviceLineLayerSpecs(theme),
    ...servicePaintLayerSpecs(theme),
    ...serviceHitLayerSpecs(theme),
    ...lineSceneLayerSpecs(theme),
    ...patternOverlayLayerSpecs(theme),
    ...serviceControlLayerSpecs(theme),
    ...stationLayerSpecs(theme),
    ...vehicleLayerSpecs(theme),
    ...labelLayerSpecs(theme),
    ...drawingPreviewLayerSpecs(theme),
    ...editorPointLayerSpecs(theme),
    ...facilityLayerSpecs(theme),
    ...gestureLayerSpecs(theme),
  ];
}

/** Deterministic light rendering for portable exports. */
export const LIGHT_LAYER_SPECS = createLayerSpecs(MAP_THEMES.light);

/** Compatibility alias for logic whose result is scheme-invariant (layer
 * identity, source discovery, gesture masking, and tests). */
export const LAYER_SPECS = LIGHT_LAYER_SPECS;
