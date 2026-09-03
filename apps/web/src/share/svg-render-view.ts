import type { Viewport } from '@transitmapper/core/render/project';
import { renderPresentationForViewport } from '@transitmapper/core/render/render-presentation';
import type { RenderViewOptions, ViewOptions } from '@transitmapper/core/render/buildFeatures';
import {
  renderPresentationForFittedMap,
  type FittedMapLike,
  type StaticDisplaySize,
} from '../map/fitted-map-presentation';

// The one view an SVG export is resolved against. Its presentation decides
// vector LOD *and* the bounds the passenger Line scene is clipped to (see
// share/svgWorkerEntry.ts), so a caller that derives a second view for either
// half hands the drawing a network framed for a camera it never used.

/** Resolves vector LOD from the same final MapLibre camera a PNG export uses.
 * SVG has no backing-store density, so DPR is always one even on a Retina
 * editor; authored versus displayed CSS size remains authoritative. */
export function svgViewForFittedMap(
  view: ViewOptions,
  map: FittedMapLike,
  display: StaticDisplaySize = {},
): RenderViewOptions {
  const presentation = renderPresentationForFittedMap(map, display);
  return { ...view, presentation: { ...presentation, pixelRatio: 1 } };
}

/** Pure-viewport counterpart used by quick SVG export and its Worker. */
export function svgViewForViewport(
  view: ViewOptions,
  viewport: Viewport,
  display: StaticDisplaySize = {},
): RenderViewOptions {
  return {
    ...view,
    presentation: renderPresentationForViewport(viewport, display),
  };
}
