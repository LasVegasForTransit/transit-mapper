export interface InitialMapReadyMap {
  isStyleLoaded(): unknown;
  once(event: 'style.load', listener: () => void): unknown;
}

/**
 * The first usable style may be the remote basemap or the local fallback.
 * MapLibre fires `load` only for its original style, so editor setup must
 * wait for the first `style.load` instead.
 */
export function attachInitialMapReady(map: InitialMapReadyMap, startEditor: () => void): void {
  // A cached style can finish while MapCanvas registers controls and renderer
  // callbacks. In that case `style.load` has already fired, so waiting for a
  // later event leaves the editor without a canvas on its warm reload.
  if (map.isStyleLoaded() === true) {
    startEditor();
    return;
  }
  map.once('style.load', startEditor);
}
