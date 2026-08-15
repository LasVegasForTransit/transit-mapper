/**
 * Browser-only media-query state without a framework dependency. Vanilla
 * entry points (notably the embed) use this directly, so reading an OS color
 * preference cannot pull React into their payload.
 */
export interface MediaQueryStore {
  subscribe: (listener: () => void) => () => void;
  snapshot: () => boolean;
}

/** Cached per query because `useSyncExternalStore` compares subscriptions by
 * identity, and because repeated vanilla reads should share one listener. */
const stores = new Map<string, MediaQueryStore>();

export function mediaQuery(query: string): MediaQueryStore {
  const existing = stores.get(query);
  if (existing) return existing;

  const store: MediaQueryStore = {
    subscribe(listener) {
      try {
        const list = window.matchMedia(query);
        const onChange = () => listener();
        list.addEventListener('change', onChange);
        return () => list.removeEventListener('change', onChange);
      } catch {
        // The product targets modern engines, but a constrained embedded
        // browser still gets a stable default rather than a startup failure.
        return () => {};
      }
    },
    snapshot() {
      try {
        return window.matchMedia(query).matches;
      } catch {
        return false;
      }
    },
  };
  stores.set(query, store);
  return store;
}
