export type RouteIntent = { kind: 'editor' } | { kind: 'shared-system'; shareId: string };

const SHARED_SYSTEM_PATH = /^\/s\/([a-z0-9]{1,32})\/?$/;

/** Classify the pathname without reading browser state. Unknown and malformed
 * paths keep the editor fallback that the application has always used. */
export function parseRouteIntent(pathname: string): RouteIntent {
  const match = SHARED_SYSTEM_PATH.exec(pathname);
  return match?.[1] ? { kind: 'shared-system', shareId: match[1] } : { kind: 'editor' };
}
