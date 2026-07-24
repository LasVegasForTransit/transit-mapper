import { DEFAULT_VIEWPORT, type Viewport } from "@transitmapper/core/model/system";

// The LIVE map camera, held OUTSIDE the immutable domain `system` object.
//
// Camera position used to live inside `system` (system.viewport), so every
// pan/zoom called store.setViewport, which did set((s)=>({system:{...s.system,
// viewport}})) — minting a brand-new `system` reference on every drag frame.
// That new reference made the renderer subscription, the whole-system
// buildFeatures + 13x setData rebuild, every mounted Zustand selector, and the
// autosave all treat a pure camera move as a content edit. At RTC scale that
// was the dominant per-frame pan cost.
//
// Live camera is PRESENTATION state, not domain data (the same reason
// ui/ViewProvider is React context, not the domain store). It lives here: a
// small non-reactive holder the imperative map layer writes on move and other
// non-map code (footprint placement, camera persistence, export) reads without
// reaching into MapLibre — and so a sensible value exists before the map has
// emitted its first move. The saved `system.viewport` becomes the PERSISTED
// camera, synced from this holder only at serialize points (see
// camera/cameraPersistence.ts and currentCameraViewport below).
//
// A module-level holder (not a store/context) is the right shape here: there is
// exactly one live map per session (same rationale as map/mapRef.ts), and the
// value is inherently a mirror of that single map's camera.

function clone(v: Viewport): Viewport {
  return { center: [v.center[0], v.center[1]], zoom: v.zoom };
}

let current: Viewport = clone(DEFAULT_VIEWPORT);

type Listener = (viewport: Viewport) => void;
const listeners = new Set<Listener>();

/** Seed the live camera (e.g. from a loaded system's saved viewport) WITHOUT
 *  notifying persistence listeners — this is a load, not a user camera move. */
export function initLiveCamera(viewport: Viewport): void {
  current = clone(viewport);
}

/** Record a user/programmatic camera move. Notifies listeners (camera
 *  persistence) but never touches the domain store, so no rebuild is triggered. */
export function setLiveCamera(viewport: Viewport): void {
  current = clone(viewport);
  for (const listener of listeners) listener(current);
}

/** The current live camera. Returns a defensive copy so callers can't mutate
 *  the holder's state in place. */
export function liveCamera(): Viewport {
  return clone(current);
}

/** Fold the live camera into a system snapshot for serialization (save/share/
 *  export), so the persisted `viewport` always reflects where the user is —
 *  even though live moves no longer flow through the domain store. */
export function withLiveCamera<T extends { viewport: Viewport }>(system: T): T {
  return { ...system, viewport: liveCamera() };
}

export function subscribeLiveCamera(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
