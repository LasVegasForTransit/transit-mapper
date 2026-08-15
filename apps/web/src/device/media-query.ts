import { useSyncExternalStore } from 'react';
import { mediaQuery } from './media-query-store';

/**
 * The one way this app reads a media query.
 *
 * Two hand-rolled copies of this existed before it: `theme/systemColorScheme.ts`
 * for the OS color preference, and the capability module beside this one. They
 * were the same four pieces — a guarded `matchMedia`, a subscribe, a snapshot,
 * a `useSyncExternalStore` hook — and only one of them carried the fallback for
 * browsers without `addEventListener` on a MediaQueryList.
 */
export { mediaQuery } from './media-query-store';

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
