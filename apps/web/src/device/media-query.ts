import { useSyncExternalStore } from 'react';

/**
 * The one way this app reads a media query.
 *
 * Two hand-rolled copies of this existed before it: `theme/systemColorScheme.ts`
 * for the OS color preference, and the capability module beside this one. They
 * were the same four pieces — a guarded `matchMedia`, a subscribe, a snapshot,
 * a `useSyncExternalStore` hook — and only one of them carried the fallback for
 * browsers without `addEventListener` on a MediaQueryList.
 */
export interface MediaQueryStore {
  subscribe: (listener: () => void) => () => void;
  snapshot: () => boolean;
}

/**
 * Cached per query string.
 *
 * `useSyncExternalStore` compares `subscribe` by identity and resubscribes
 * whenever it changes, so minting a fresh closure per call would tear down and
 * rebuild the listener on every commit.
 */
const stores = new Map<string, MediaQueryStore>();

export function mediaQuery(query: string): MediaQueryStore {
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
      // costs nothing and makes the subscription safe in older embedded
      // browsers.
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
 * serves as the server snapshot: a static render test then represents the media
 * environment it installs instead of a second hardcoded default.
 */
export function useMediaQuery(query: string): boolean {
  const store = mediaQuery(query);
  return useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
}
