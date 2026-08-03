import { useSyncExternalStore } from 'react';

/**
 * The device questions this app asks, and the media queries that answer them.
 *
 * These are two independent axes, not one "is mobile" boolean, because a
 * device can be wide and coarse (a touchscreen laptop, an iPad in landscape)
 * or narrow and fine (a small window with a mouse). Deciding hit tolerance
 * from viewport width gives a finger the precision budget of a mouse, and
 * deciding layout from pointer type puts a phone's docked cards on a tablet.
 *
 * Widths in one place, so the CSS and the component tree cannot drift apart.
 * app.css's `@theme --breakpoint-md` carries the same 768px boundary; the two
 * are a matched pair and changing one alone is a bug.
 */
const COMPACT_LAYOUT_QUERY = '(max-width: 767px)';
const COARSE_POINTER_QUERY = '(pointer: coarse)';
/**
 * Asked as `hover: none` and negated, not as `hover: hover`, so that every
 * capability here defaults to the desktop answer when the query cannot be
 * evaluated. A browser too old for `matchMedia` reports no match for
 * everything; under `hover: hover` that would read as "cannot hover" and hand
 * a 2013 desktop browser the touch affordances.
 */
const NO_HOVER_QUERY = '(hover: none)';

export interface DeviceCapabilities {
  /** Viewport width. Decides docked cards against the bottom sheet. */
  compactLayout: boolean;
  /**
   * The primary pointer cannot be precise. Decides hit tolerance (see
   * editor/input-tuning.ts) and which gesture grammar is in play.
   */
  coarsePointer: boolean;
  /**
   * The primary pointer can rest over a target without committing. Decides
   * whether an idle-state affordance — a cursor shape, a hover badge — can
   * carry meaning at all, or whether that meaning has to move inside the
   * gesture (see map/PointerBadge.tsx).
   */
  hoverCapable: boolean;
}

/**
 * A `useSyncExternalStore` pair for one media query, cached per query string.
 *
 * Cached because `useSyncExternalStore` compares the subscribe function by
 * identity and resubscribes whenever it changes: minting a new closure per
 * render would tear down and rebuild the listener on every commit.
 */
const stores = new Map<string, MediaQueryStore>();

interface MediaQueryStore {
  subscribe: (listener: () => void) => () => void;
  snapshot: () => boolean;
}

function mediaQueryStore(query: string): MediaQueryStore {
  const existing = stores.get(query);
  if (existing) return existing;

  const store: MediaQueryStore = {
    subscribe(listener) {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const list = window.matchMedia(query);
      const onChange = () => listener();
      if (list.addEventListener) {
        list.addEventListener('change', onChange);
        return () => list.removeEventListener('change', onChange);
      }
      // Safari before 14. The app does not target it deliberately, but this
      // fallback costs nothing and makes the subscription safe in older
      // embedded browsers.
      list.addListener(onChange);
      return () => list.removeListener(onChange);
    },
    snapshot() {
      return typeof window !== 'undefined' && window.matchMedia?.(query).matches === true;
    },
  };
  stores.set(query, store);
  return store;
}

/**
 * Read one media query as React state.
 *
 * This app is client-rendered rather than hydrated, so the live snapshot also
 * serves as the server snapshot: static render tests then represent the media
 * environment they install instead of a second hardcoded default.
 */
function useMediaQuery(query: string): boolean {
  const store = mediaQueryStore(query);
  return useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
}

/** Viewport width alone. Layout's question, and only layout's. */
export function useCompactLayout(): boolean {
  return useMediaQuery(COMPACT_LAYOUT_QUERY);
}

/** Pointer precision alone. Input's question, and only input's. */
export function useCoarsePointer(): boolean {
  return useMediaQuery(COARSE_POINTER_QUERY);
}

export function useHoverCapable(): boolean {
  return !useMediaQuery(NO_HOVER_QUERY);
}

export function useDeviceCapabilities(): DeviceCapabilities {
  return {
    compactLayout: useCompactLayout(),
    coarsePointer: useCoarsePointer(),
    hoverCapable: useHoverCapable(),
  };
}

/**
 * The same three answers outside React, for imperative callers: the map's
 * interaction layer and the PWA install controller both run before or beside
 * the component tree and cannot use a hook.
 *
 * A snapshot, not a subscription. Both callers re-read on the events they
 * already handle rather than reacting to a pointer change mid-gesture, which
 * would swap tolerances underneath a drag in progress.
 */
export function deviceCapabilitiesSnapshot(): DeviceCapabilities {
  return {
    compactLayout: mediaQueryStore(COMPACT_LAYOUT_QUERY).snapshot(),
    coarsePointer: mediaQueryStore(COARSE_POINTER_QUERY).snapshot(),
    hoverCapable: !mediaQueryStore(NO_HOVER_QUERY).snapshot(),
  };
}
