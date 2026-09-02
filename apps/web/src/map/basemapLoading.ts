import type { TransitSystem } from '@transitmapper/core/model/system';
import { systemBounds } from '@transitmapper/core/model/geo';

export interface RemoteBasemapLoadInput {
  documentReady: boolean;
  remoteBasemapRequested: boolean;
}

/**
 * The placeholder document exists only while storage resolves the real one.
 * Loading a remote map beneath it fetches tiles for a camera nobody will see.
 */
export function shouldRequestRemoteBasemap(input: RemoteBasemapLoadInput): boolean {
  return input.documentReady && !input.remoteBasemapRequested;
}

/**
 * A document with transit paints its own content before the basemap replaces
 * the local bootstrap style, so the network is not spent on tiles the user has
 * not asked to see yet. An empty document has nothing to paint first: deferring
 * there buys no ordering and leaves a new user — onboarding included — looking
 * at the bootstrap grid until the map reaches its interactive milestone.
 */
export function initialBaseStyleTiming(system: TransitSystem): 'before-content' | 'after-content' {
  return systemBounds(system) === null ? 'before-content' : 'after-content';
}
