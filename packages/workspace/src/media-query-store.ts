export interface MediaQueryStore {
  subscribe: (listener: () => void) => () => void;
  snapshot: () => boolean;
}

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
