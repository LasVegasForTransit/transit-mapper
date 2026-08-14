import type { RenderPresentation } from '@transitmapper/core/render/render-presentation';
import { renderPresentationFromMap, type MapBoundsLike } from './render-presentation';

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

/**
 * Reads a settled MapLibre camera without importing any feature projection.
 * SVG needs this same presentation calculation, but it must not pull the
 * geometry builder into the editor's main bundle just to fit an export.
 */
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
