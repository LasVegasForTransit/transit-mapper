// Excluded from the test run by vitest.config.ts (`tests/support/**`). Shared
// fixtures for the hand-rolled MapLibre stand-in used by map/*.test.ts files
// that exercise attachInteractions directly, without a real MapLibre map or
// DOM.
import { vi } from 'vitest';
import { FINE_POINTER_TUNING } from '../../src/editor/input-tuning';

export interface FakePoint {
  x: number;
  y: number;
}

// MapLibre's default; the exact value doesn't matter here, only that a press
// past it produces no `click` at all.
export const CLICK_TOLERANCE_PX = 3;

const CENTER_LNG = -115.17;
const CENTER_LAT = 36.1;
const CENTER_PX = { x: 640, y: 360 };
// Matches getZoom() === 14 at CENTER_LAT: 156543.03392 * cos(lat) / 2**14.
const M_PER_PX = (156543.03392 * Math.cos((CENTER_LAT * Math.PI) / 180)) / 2 ** 14;
const DEG_PER_PX_LAT = M_PER_PX / 111_320;
const DEG_PER_PX_LNG = M_PER_PX / (111_320 * Math.cos((CENTER_LAT * Math.PI) / 180));

/**
 * The slice of the MapLibre map surface attachInteractions actually uses, a
 * flat local projection centered on Las Vegas and scaled to agree with the
 * metersPerPixel() the code computes from getCenter()/getZoom(). It has to be
 * geographically faithful, not merely invertible: the draw assists work in
 * meters, so a projection that (say) lands every test point up near the pole
 * makes cos(latitude) collapse and the geometry it measures meaningless.
 */
export function createFakeMap() {
  const handlers = new Map<string, Set<(e: unknown) => void>>();
  // Layer-scoped registrations (map.on(type, layer, fn)) are hover cursor
  // plumbing; they never participate in click dispatch, so they're dropped.
  const key = (type: string) => type;
  const canvas = {
    style: { cursor: '' },
    addEventListener() {},
    removeEventListener() {},
  };
  // Records what each GeoJSON source was last given, so a test can read the
  // rubber band back out exactly as the map would draw it.
  const sourceData = new Map<
    string,
    { features: { geometry: { coordinates: [number, number][] } }[] }
  >();
  const map = {
    sourceData,
    getCanvas: () => canvas,
    getCenter: () => ({ lat: 36.1, lng: -115.17 }),
    getZoom: () => 14,
    getLayer: () => undefined,
    getSource: (id: string) => ({ setData: (d: never) => sourceData.set(id, d) }),
    queryRenderedFeatures: () => [],
    project: (c: [number, number]): FakePoint => ({
      x: CENTER_PX.x + (c[0] - CENTER_LNG) / DEG_PER_PX_LNG,
      y: CENTER_PX.y - (c[1] - CENTER_LAT) / DEG_PER_PX_LAT,
    }),
    unproject: (p: FakePoint): { lng: number; lat: number } => ({
      lng: CENTER_LNG + (p.x - CENTER_PX.x) * DEG_PER_PX_LNG,
      lat: CENTER_LAT - (p.y - CENTER_PX.y) * DEG_PER_PX_LAT,
    }),
    panBy() {},
    on(type: string, a: unknown, b?: unknown) {
      const fn = (typeof a === 'function' ? a : b) as (e: unknown) => void;
      if (typeof a !== 'function') return; // layer-scoped hover handler
      const set = handlers.get(key(type)) ?? new Set();
      set.add(fn);
      handlers.set(key(type), set);
    },
    once(type: string, fn: (e: unknown) => void) {
      const wrapped = (e: unknown) => {
        handlers.get(key(type))?.delete(wrapped);
        fn(e);
      };
      map.on(type, wrapped);
    },
    off(type: string, a: unknown, b?: unknown) {
      if (typeof a !== 'function') return;
      handlers.get(key(type))?.delete(a as (e: unknown) => void);
      void b;
    },
    fire(type: string, e: unknown) {
      for (const fn of [...(handlers.get(key(type)) ?? [])]) fn(e);
    },
  };
  return map;
}

export function mouseEvent(pt: FakePoint, map: ReturnType<typeof createFakeMap>) {
  return {
    point: pt,
    lngLat: map.unproject(pt),
    originalEvent: {
      button: 0,
      detail: 1,
      altKey: false,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      preventDefault() {},
    },
    preventDefault() {},
  };
}

/**
 * One press, dispatched the way the browser and MapLibre actually dispatch
 * it: mousedown and mouseup always, `click` only when the pointer stayed
 * inside the tolerance (see maplibre-gl's own ui/handler/map_event.ts,
 * `click()`).
 */
export function press(map: ReturnType<typeof createFakeMap>, from: FakePoint, dx = 0, dy = 0) {
  const to = { x: from.x + dx, y: from.y + dy };
  map.fire('mousedown', mouseEvent(from, map));
  if (dx !== 0 || dy !== 0) map.fire('mousemove', mouseEvent(to, map));
  map.fire('mouseup', mouseEvent(to, map));
  if (Math.hypot(dx, dy) < CLICK_TOLERANCE_PX) map.fire('click', mouseEvent(to, map));
}

/** The options attachInteractions needs, varying only by network/diagram mode. */
export function attachOpts(networkMode: boolean) {
  return {
    tuning: FINE_POINTER_TUNING,
    openShortcuts() {},
    toggleUi() {},
    sim: { togglePaused() {}, stepSpeed() {} },
    isDiagramMode: () => false,
    isNetworkMode: () => networkMode,
    focusFootprint() {},
    openContextMenu() {},
  };
}

/**
 * Hover/preview work is rAF-throttled, so tests need frames to exist. The
 * callback must NOT run before requestAnimationFrame returns: rafThrottle
 * stores the id it hands back and treats a non-null id as "a flush is
 * already scheduled". Running the callback inline meant that assignment
 * happened after the flush, leaving the throttle permanently convinced a
 * frame was pending — it flushed once and then silently swallowed every
 * later call. Stubs `window`/rAF/cancelAF and queues callbacks instead,
 * letting a test pump frames explicitly. Callers are responsible for
 * `vi.unstubAllGlobals()` in their own `afterEach`.
 */
export function installFrameScheduler() {
  let frameId = 0;
  let frames = new Map<number, () => void>();
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => {
    const id = ++frameId;
    frames.set(id, fn);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  return {
    /** Run everything currently scheduled, as one frame boundary. */
    pump() {
      const due = frames;
      frames = new Map();
      for (const fn of due.values()) fn();
    },
  };
}
