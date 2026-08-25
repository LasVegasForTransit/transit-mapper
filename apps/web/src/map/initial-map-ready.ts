import type { DocumentStatus } from '../editor/store/state';
import type { MapStartupMilestones } from '@transitmapper/map';

export interface InitialMapReadyMap {
  isStyleLoaded(): unknown;
  getStyle(): unknown;
  once(event: 'style.load' | 'idle', listener: () => void): unknown;
}

/** The loading document is a disposable shell. Projecting it races the first
 * durable document for renderer ownership and can leave the empty bank live. */
export function shouldProjectInitialDocument(documentStatus: DocumentStatus): boolean {
  return documentStatus === 'ready';
}

/** Map setup and document bootstrap run independently. When setup installs its
 * subscription after the ready transition, it must still request the one
 * initial scene that has not reached a renderer bank or its work queue. */
export function shouldScheduleInitialReadyDocument(
  documentStatus: DocumentStatus,
  hasRenderedSystem: boolean,
): boolean {
  return documentStatus === 'ready' && !hasRenderedSystem;
}

interface PublishAcceptedMapStartupOptions {
  hasAcceptedScene: boolean;
  interactionsAttached: boolean;
  milestones: MapStartupMilestones;
  flushTheme(): void;
}

/** An accepted scene can settle through an empty follow-up batch. Publish the
 * startup state from both paths so a style request deferred during renderer
 * publication does not remain queued until the next editor gesture. */
export function publishAcceptedMapStartup(options: PublishAcceptedMapStartupOptions): void {
  if (!options.hasAcceptedScene) return;
  options.milestones.contentCommitted();
  if (options.interactionsAttached) options.milestones.interactive();
  options.flushTheme();
}

/**
 * The first usable style may be the remote basemap or the local fallback.
 * MapLibre fires `load` only for its original style, so editor setup waits
 * for the first `style.load` instead.
 */
export function attachInitialMapReady(map: InitialMapReadyMap, startEditor: () => boolean): void {
  const startOrRetry = () => {
    // A queued event from the style being replaced can arrive after setStyle.
    // MapLibre rejects source mutation in that gap. Its next idle event proves
    // the replacement style has finished the transition.
    if (!startEditor()) map.once('idle', startEditor);
  };
  // A cached style can finish while MapCanvas registers controls and renderer
  // callbacks. In that case `style.load` has already fired, so waiting for a
  // later event leaves the editor without a canvas on its warm reload.
  // getStyle() becomes non-null while MapLibre still rejects addSource(). The
  // initial scene has no later retry, so starting there can leave a cold map
  // blank forever. style.load is the first event after style mutation is legal.
  if (map.isStyleLoaded() === true) {
    startOrRetry();
    return;
  }
  // MapLibre can expose the parsed local style before it updates
  // isStyleLoaded(). Starting here either installs the overlay immediately or
  // uses startOrRetry's idle listener once source mutation becomes legal.
  if (map.getStyle()) {
    startOrRetry();
    return;
  }
  map.once('style.load', startOrRetry);
}
