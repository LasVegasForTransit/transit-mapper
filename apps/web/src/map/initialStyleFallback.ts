import type { Map as MLMap } from 'maplibre-gl';
import type { ColorScheme } from '../theme/systemColorScheme';
import { basemapStyleForScheme, localBlankStyleForScheme } from './mapTheme';

/**
 * The editor owns every interactive layer, so a slow street style must never
 * hold the canvas past the smallest first-map budget. This leaves roughly two
 * seconds for the local overlay to build and paint on the small fixture.
 *
 * Reaching it means the basemap is slow, which is not the same as absent. The
 * deadline therefore buys a usable canvas and nothing else: it never reports a
 * failure, and it never stops the basemap from arriving.
 */
export const INITIAL_STYLE_FALLBACK_TIMEOUT_MS = 1_500;

export interface InitialStyleFallbackOptions {
  scheme: ColorScheme;
  timeoutMs: number;
  /** The basemap is genuinely unreachable, not merely slower than the budget. */
  onFallback: () => void;
  /** A late basemap replaced the interim drafting grid. */
  onAdopted?: () => void;
  /** Overridable so a test can resolve or reject without a network. */
  probeBasemap?: (styleUrl: string) => Promise<boolean>;
}

async function basemapIsReachable(styleUrl: string): Promise<boolean> {
  try {
    const response = await fetch(styleUrl, { credentials: 'omit' });
    return response.ok;
  } catch {
    return false;
  }
}

/** Replace a failed initial remote style with the local blank canvas. */
export function attachInitialStyleFallback(
  map: MLMap,
  options: InitialStyleFallbackOptions,
): () => void {
  let settled = false;
  let fallbackRequested = false;
  let detached = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const probe = options.probeBasemap ?? basemapIsReachable;

  const clearTimer = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };
  const showInterimGrid = () => {
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
    showInterimGrid();
  };
  /**
   * The deadline elapsed. Show the grid so the editor is usable now, then ask
   * whether the basemap was ever actually unavailable. Reporting a failure
   * here, as this once did, told people their network had broken while every
   * tile request was returning 200, and the swap was permanent for the
   * session because nothing ever reconsidered it.
   */
  const deadlineElapsed = () => {
    if (settled || fallbackRequested) return;
    fallbackRequested = true;
    showInterimGrid();
    const styleUrl = basemapStyleForScheme(options.scheme);
    void probe(styleUrl).then((reachable) => {
      if (detached) return;
      if (!reachable) {
        options.onFallback();
        return;
      }
      map.setStyle(styleUrl, { diff: false });
      options.onAdopted?.();
    });
  };
  const onMapLoad = () => {
    settled = true;
    clearTimer();
  };
  const onInitialError = () => fallback();

  // A style.load event proves only that the style JSON parsed. The map's load
  // event is the first point at which its initial sources and tiles have
  // produced a usable frame; failures between the two still need the local
  // fallback, while later individual tile errors remain MapLibre's to retry.
  map.on('load', onMapLoad);
  map.on('error', onInitialError);
  timer = setTimeout(deadlineElapsed, options.timeoutMs);

  return () => {
    detached = true;
    clearTimer();
    map.off('load', onMapLoad);
    map.off('error', onInitialError);
  };
}
