import type { TransitSystem } from '@transitmapper/core/model/system';
import {
  buildFeatures,
  type Highlight,
  type RenderViewOptions,
  type SystemFeatures,
  type ViewOptions,
} from '@transitmapper/core/render/buildFeatures';
import type { RenderPresentation } from '@transitmapper/core/render/render-presentation';
import { createOrderedSystemRenderVisuals } from '@transitmapper/core/render/system-render-scene';
import { renderPresentationFromMap, type MapBoundsLike } from './render-presentation';
import { SYSTEM_FEATURE_SOURCE_BY_NAME } from './system-feature-sources';

export interface CssSizeLike {
  readonly clientWidth: number;
  readonly clientHeight: number;
}

/** Camera subset shared by read-only MapLibre surfaces after resize/fitting. */
export interface FittedMapLike {
  getBounds(): MapBoundsLike;
  getZoom(): number;
  getCanvas(): CssSizeLike;
  getContainer(): CssSizeLike;
  getPixelRatio(): number;
}

export interface StaticDisplaySize {
  readonly displayedWidthPx?: number;
  readonly displayedHeightPx?: number;
}

export type StaticFeatureBuilder = (
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

/** Reads MapLibre only after the caller has resized and fitted its camera.
 * Canvas dimensions are the CSS-pixel projection space; container dimensions
 * are the final footprint in which that projection is seen. */
export function renderPresentationForFittedMap(
  map: FittedMapLike,
  display: StaticDisplaySize = {},
): RenderPresentation {
  const canvas = map.getCanvas();
  const container = map.getContainer();
  return renderPresentationFromMap({
    bounds: map.getBounds(),
    zoom: map.getZoom(),
    viewportWidthPx: canvas.clientWidth,
    viewportHeightPx: canvas.clientHeight,
    displayedWidthPx: display.displayedWidthPx ?? container.clientWidth,
    displayedHeightPx: display.displayedHeightPx ?? container.clientHeight,
    pixelRatio: map.getPixelRatio(),
  });
}

/** Projects a static/read-only map from its settled camera rather than from a
 * document viewport or a guessed zoom. The original view remains immutable so
 * another surface cannot accidentally retain this map's presentation. */
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
