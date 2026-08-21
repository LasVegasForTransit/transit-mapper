import type { Map as MLMap } from 'maplibre-gl';
import type { ColorScheme } from '../theme/systemColorScheme';
import { LOCAL_BACKGROUND_LAYER_ID, localBlankStyleForScheme } from './mapTheme';

/**
 * Eight seconds separates a slow first map from an unusable editor without
 * penalizing ordinary cold tile loads. Once this expires, the local style owns
 * the MapLibre instance for the rest of its lifetime.
 */
export const INITIAL_STYLE_FALLBACK_TIMEOUT_MS = 8_000;

export interface InitialStyleFallbackOptions {
  scheme: ColorScheme;
  timeoutMs: number;
  /** The editor switched to its local drafting context. */
  onFallback: () => void;
  /** The remote frame or the replacement local style is ready for editor data. */
  onSettled?: () => void;
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
  const showLocalContext = () => {
    // A fired browser timeout can have its numeric handle reused before the
    // local style emits style.load. Clear our reference now so that later
    // cleanup cannot cancel an unrelated renderer task with the same handle.
    clearTimer();
    map.setStyle(localBlankStyleForScheme(options.scheme), { diff: false });
  };
  const fallback = () => {
    if (settled || fallbackRequested) return;
    fallbackRequested = true;
    options.onFallback();
    showLocalContext();
  };
  const settle = () => {
    if (settled) return;
    settled = true;
    clearTimer();
    options.onSettled?.();
  };
  const onMapLoad = () => settle();
  const onStyleLoad = () => {
    // MapLibre can deliver a queued style.load from the abandoned remote
    // style after setStyle() has requested the fallback. That event does not
    // make the replacement safe to mutate. Wait until the committed style
    // contains the local layer that only our fallback defines.
    if (fallbackRequested && map.getLayer(LOCAL_BACKGROUND_LAYER_ID)) settle();
  };
  const onInitialError = () => fallback();

  // A style.load event proves only that the style JSON parsed. The map's load
  // event is the first point at which its initial sources and tiles have
  // produced a usable frame; failures between the two still need the local
  // fallback, while later individual tile errors remain MapLibre's to retry.
  map.on('load', onMapLoad);
  map.on('style.load', onStyleLoad);
  map.on('error', onInitialError);
  timer = setTimeout(fallback, options.timeoutMs);

  return () => {
    clearTimer();
    map.off('load', onMapLoad);
    map.off('style.load', onStyleLoad);
    map.off('error', onInitialError);
  };
}
