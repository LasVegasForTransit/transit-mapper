export type RouteIntent =
  | { kind: 'editor' }
  | { kind: 'shared-system'; shareId: string }
  | { kind: 'published-view'; viewId: string };

const SHARED_SYSTEM_PATH = /^\/s\/([a-z0-9]{1,32})\/?$/;
const PUBLISHED_VIEW_PATH = /^\/v\/([a-z0-9]{1,32})\/?$/;

/** Classify the pathname without reading browser state. Unknown and malformed
 * paths keep the editor fallback that the application has always used. */
export function parseRouteIntent(pathname: string): RouteIntent {
  const sharedSystem = SHARED_SYSTEM_PATH.exec(pathname)?.[1];
  if (sharedSystem) return { kind: 'shared-system', shareId: sharedSystem };
  const publishedView = PUBLISHED_VIEW_PATH.exec(pathname)?.[1];
  return publishedView ? { kind: 'published-view', viewId: publishedView } : { kind: 'editor' };
}
