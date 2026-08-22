import type { Map as MLMap } from 'maplibre-gl';
import type { ColorScheme } from '../theme/systemColorScheme';
import {
  basemapStyleForScheme,
  LOCAL_BACKGROUND_LAYER_ID,
  localBlankStyleForScheme,
} from './mapTheme';

/**
 * The editor owns every interactive layer, so a slow street style must never
 * hold the canvas past the smallest first-map budget. This leaves roughly two
 * seconds for the local overlay to build and paint on the small fixture.
 *
 * Reaching it means the basemap is slow, which is not the same as absent. The
 * deadline therefore buys a usable canvas and nothing else: it never reports a
 * failure for a slow host, and the local grid remains for this map session.
 */
export const INITIAL_STYLE_FALLBACK_TIMEOUT_MS = 1_500;

export interface InitialStyleFallbackOptions {
  scheme: ColorScheme;
  timeoutMs: number;
  /** MapCanvas begins on the local style so a stalled remote fetch cannot
   * prevent the first source-ready transition. */
  startsWithLocalStyle?: boolean;
  /** The basemap is genuinely unreachable, not merely slower than the budget. */
  onFallback: () => void;
  /** The local style now owns this map session, regardless of reachability. */
  onLocalStyleSelected?: () => void;
  /** The remote frame is ready, or the local fallback owns startup. */
  onSettled?: () => void;
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

interface InitialStyleEventHandlerOptions {
  map: MLMap;
  startsWithLocalStyle: boolean | undefined;
  isFallbackRequested: () => boolean;
  isRemoteStyleRequested: () => boolean;
  settle: () => void;
  fallback: () => void;
}

function createInitialStyleEventHandlers(options: InitialStyleEventHandlerOptions) {
  const onMapLoad = () => {
    if (options.startsWithLocalStyle) return;
    if (!options.isFallbackRequested() || options.map.getLayer(LOCAL_BACKGROUND_LAYER_ID)) {
      options.settle();
    }
  };
  const onStyleLoad = () => {
    if (
      options.startsWithLocalStyle &&
      options.isRemoteStyleRequested() &&
      !options.isFallbackRequested() &&
      !options.map.getLayer(LOCAL_BACKGROUND_LAYER_ID)
    ) {
      options.settle();
      return;
    }
    if (options.isFallbackRequested() && options.map.getLayer(LOCAL_BACKGROUND_LAYER_ID)) {
      options.settle();
    }
  };

  return { onInitialError: options.fallback, onMapLoad, onStyleLoad };
}

/** Replace a failed initial remote style with the local blank canvas. */
export function attachInitialStyleFallback(
  map: MLMap,
  options: InitialStyleFallbackOptions,
): () => void {
  let settled = false;
  let fallbackRequested = false;
  let remoteStyleRequested = false;
  let detached = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const probe = options.probeBasemap ?? basemapIsReachable;

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
    options.onLocalStyleSelected?.();
    // MapLibre can retain the abandoned style request until its transport
    // times out. Mark the fallback before replacing it so no later remote
    // event can reclaim this map session.
    settle();
    if (!options.startsWithLocalStyle || remoteStyleRequested) {
      map.setStyle(localBlankStyleForScheme(options.scheme), { diff: false });
    }
  };
  const fallback = () => {
    if (settled || fallbackRequested) return;
    fallbackRequested = true;
    options.onFallback();
    showLocalContext();
  };
  /**
   * The deadline elapsed. Show the grid so the editor is usable now, then ask
   * whether the basemap was ever actually unavailable. Reporting a failure
   * here, as this once did, told people their network had broken while every
   * tile request was returning 200. The probe decides only whether to show
   * that existing failure message because the grid already owns this session.
   */
  const deadlineElapsed = () => {
    if (settled || fallbackRequested) return;
    fallbackRequested = true;
    showLocalContext();
    const styleUrl = basemapStyleForScheme(options.scheme);
    void probe(styleUrl).then((reachable) => {
      if (detached) return;
      if (!reachable) {
        options.onFallback();
      }
    });
  };
  const settle = () => {
    if (settled) return;
    settled = true;
    clearTimer();
    options.onSettled?.();
  };
  const { onInitialError, onMapLoad, onStyleLoad } = createInitialStyleEventHandlers({
    map,
    startsWithLocalStyle: options.startsWithLocalStyle,
    isFallbackRequested: () => fallbackRequested,
    isRemoteStyleRequested: () => remoteStyleRequested,
    settle,
    fallback,
  });

  // A style.load event proves only that the style JSON parsed. The map's load
  // event is the first point at which its initial sources and tiles have
  // produced a usable frame; failures between the two still need the local
  // fallback, while later individual tile errors remain MapLibre's to retry.
  map.on('load', onMapLoad);
  map.on('style.load', onStyleLoad);
  map.on('error', onInitialError);
  timer = setTimeout(deadlineElapsed, options.timeoutMs);
  if (options.startsWithLocalStyle) {
    const styleUrl = basemapStyleForScheme(options.scheme);
    void probe(styleUrl).then((reachable) => {
      if (detached || fallbackRequested) return;
      if (!reachable) {
        fallback();
        return;
      }
      remoteStyleRequested = true;
      map.setStyle(styleUrl, { diff: false });
    });
  }

  return () => {
    detached = true;
    clearTimer();
    map.off('load', onMapLoad);
    map.off('style.load', onStyleLoad);
    map.off('error', onInitialError);
  };
}
