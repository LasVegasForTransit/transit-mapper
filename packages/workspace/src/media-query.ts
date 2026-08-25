import { useSyncExternalStore } from 'react';
import { mediaQuery } from './media-query-store';

export { mediaQuery } from './media-query-store';
export type { MediaQueryStore } from './media-query-store';

export function useMediaQuery(query: string): boolean {
  const store = mediaQuery(query);
  return useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
}

export const COMPACT_LAYOUT_QUERY = '(max-width: 767px), (max-height: 500px)';

export function useCompactLayout(): boolean {
  return useMediaQuery(COMPACT_LAYOUT_QUERY);
}

export function compactLayoutSnapshot(): boolean {
  return mediaQuery(COMPACT_LAYOUT_QUERY).snapshot();
}
