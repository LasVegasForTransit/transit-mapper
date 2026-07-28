import type { Map as MLMap, StyleSpecification } from 'maplibre-gl';

/**
 * The editor owns every interactive layer, so a slow street style must never
 * hold the canvas past the smallest first-map budget. This leaves roughly two
 * seconds for the local overlay to build and paint on the small fixture.
 */
export const INITIAL_STYLE_FALLBACK_TIMEOUT_MS = 1_500;

export const LOCAL_BLANK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    {
      id: 'transitmapper-local-background',
      type: 'background',
      paint: { 'background-color': '#f7f4ec' },
    },
  ],
};

export interface InitialStyleFallbackOptions {
  timeoutMs: number;
  onFallback: () => void;
}

/** Replace a failed initial remote style with the local blank canvas. */
export function attachInitialStyleFallback(
  map: MLMap,
  options: InitialStyleFallbackOptions,
): () => void {
  let settled = false;
  let fallbackRequested = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clearTimer = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };
  const fallback = () => {
    if (settled || fallbackRequested) return;
    fallbackRequested = true;
    options.onFallback();
    map.setStyle(LOCAL_BLANK_STYLE, { diff: false });
  };
  const onStyleLoad = () => {
    settled = true;
    clearTimer();
  };
  const onInitialError = () => fallback();

  map.on('style.load', onStyleLoad);
  map.on('error', onInitialError);
  timer = setTimeout(fallback, options.timeoutMs);

  return () => {
    clearTimer();
    map.off('style.load', onStyleLoad);
    map.off('error', onInitialError);
  };
}
