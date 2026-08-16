import type { RenderPresentation } from './render-presentation';

/** Viewport-relative guard band shared by cold, warm, and legacy candidate
 * queries. It is large enough for one active camera settlement to finish while
 * the next camera is queued, but capped so offscreen work cannot scale without
 * bound on very large displays. */
export function renderViewportTransitionMarginPx(presentation: RenderPresentation): number {
  return Math.max(
    256,
    Math.min(512, Math.max(presentation.viewportWidthPx, presentation.viewportHeightPx) * 0.5),
  );
}

export function renderViewportTransitionMarginDegrees(presentation: RenderPresentation): number {
  const longitudePerPixel =
    Math.abs(presentation.bounds.northeast[0] - presentation.bounds.southwest[0]) /
    presentation.viewportWidthPx;
  const latitudePerPixel =
    Math.abs(presentation.bounds.northeast[1] - presentation.bounds.southwest[1]) /
    presentation.viewportHeightPx;
  return (
    Math.max(longitudePerPixel, latitudePerPixel) * renderViewportTransitionMarginPx(presentation)
  );
}
