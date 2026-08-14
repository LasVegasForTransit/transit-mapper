import type { TransitSystem } from '@transitmapper/core/model/system';
import {
  buildFeatures,
  type Highlight,
  type RenderViewOptions,
  type SystemFeatures,
  type ViewOptions,
} from '@transitmapper/core/render/buildFeatures';
import { createOrderedSystemRenderVisuals } from '@transitmapper/core/render/system-render-scene';
import {
  renderPresentationForFittedMap,
  type FittedMapLike,
  type StaticDisplaySize,
} from './fitted-map-presentation';
import { SYSTEM_FEATURE_SOURCE_BY_NAME } from './system-feature-sources';

type StaticFeatureBuilder = (
  system: TransitSystem,
  selection: Highlight,
  handleWayIds: string[],
  view: RenderViewOptions,
) => SystemFeatures;

export interface BuildFeaturesForFittedMapOptions extends StaticDisplaySize {
  /** Test seam for proving the exact presentation passed across the core
   * boundary without constructing MapLibre or WebGL. */
  readonly build?: StaticFeatureBuilder;
}

/**
 * Browser-free fitted-map projection for unit tests and the performance
 * harness. Interactive static maps use `projectFeaturesForFittedMap` instead
 * so this core builder never joins the editor delivery graph.
 */
export function buildFeaturesForFittedMap(
  system: TransitSystem,
  view: ViewOptions,
  map: FittedMapLike,
  options: BuildFeaturesForFittedMapOptions = {},
): SystemFeatures {
  const { build = buildFeatures, ...display } = options;
  const features = build(system, null, [], {
    ...view,
    presentation: renderPresentationForFittedMap(map, display),
  });
  return createOrderedSystemRenderVisuals({
    revision: `static:${system.id}`,
    features,
    sourceIds: SYSTEM_FEATURE_SOURCE_BY_NAME,
  }).features;
}
