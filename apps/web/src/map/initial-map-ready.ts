export interface InitialMapReadyMap {
  isStyleLoaded(): unknown;
  once(event: 'style.load', listener: () => void): unknown;
}

/**
 * The first usable style may be the remote basemap or the local fallback.
 * MapLibre fires `load` only for its original style, so editor setup waits
 * for the first `style.load` instead.
 */
export function attachInitialMapReady(map: InitialMapReadyMap, startEditor: () => void): void {
  // A cached style can finish while MapCanvas registers controls and renderer
  // callbacks. In that case `style.load` has already fired, so waiting for a
  // later event leaves the editor without a canvas on its warm reload.
  // getStyle() becomes non-null while MapLibre still rejects addSource(). The
  // initial scene has no later retry, so starting there can leave a cold map
  // blank forever. style.load is the first event after style mutation is legal.
  if (map.isStyleLoaded() === true) {
    startEditor();
    return;
  }
  map.once('style.load', startEditor);
}
