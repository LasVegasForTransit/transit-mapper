import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Map as MLMap } from 'maplibre-gl';
import { defaultProfileFor } from '@transitmapper/core/model/profile';
import type { Way } from '@transitmapper/core/model/system';
import { createEditorStore } from '../../src/editor/store';
import { attachInteractions, type AttachInteractionsOptions } from '../../src/map/interactions';
import { FINE_POINTER_TUNING } from '../../src/editor/input-tuning';

interface Point {
  x: number;
  y: number;
}

// The drag's per-move preview update goes through the same rafThrottle every
// other drag handler in interactions.ts uses — each mousemove only queues a
// sample, and it isn't actually recorded until the scheduled frame runs. A
// real browser interleaves those frames between move events; this pumps them
// the same way interactions.test.ts's installBrowserGlobals does, so a test
// that fires several mousemoves and pumps between them accumulates a real
// [lo,hi] range per way, the same as an actual drag would.
let pumpFrames: () => void = () => {};
beforeEach(() => {
  let nextId = 0;
  let frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++nextId;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames.delete(id);
  });
  pumpFrames = () => {
    const due = frames;
    frames = new Map();
    for (const callback of due.values()) callback(0);
  };
  // attachInteractions also registers a capture-phase Escape listener on
  // window directly (unrelated to this gesture, but present for every tool).
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
});

// A minimal MapLibre stand-in — the Demolish gesture only needs unproject
// (screen point -> lngLat) and the on/once/off/getBounds/getCanvas surface;
// it never hit-tests DOM features the way Select's erase/handle gestures do,
// since it snaps directly against system.ways by coordinate.
function createMap() {
  const handlers = new Map<string, Set<(event: unknown) => void>>();
  const canvas = { style: { cursor: '' }, addEventListener() {}, removeEventListener() {} };
  const map = {
    getCanvas: () => canvas,
    getCenter: () => ({ lng: -115.2, lat: 36.1 }),
    getZoom: () => 14,
    getLayer: () => undefined,
    getSource: () => ({ setData() {} }),
    getBounds: () => ({
      getWest: () => -116,
      getEast: () => -114,
      getSouth: () => 35,
      getNorth: () => 37,
    }),
    queryRenderedFeatures: () => [],
    project: (coord: [number, number]): Point => ({
      x: (coord[0] + 115.3) * 10_000,
      y: (36.2 - coord[1]) * 10_000,
    }),
    unproject: (point: Point) => ({
      lng: -115.3 + point.x / 10_000,
      lat: 36.2 - point.y / 10_000,
    }),
    panBy() {},
    on(type: string, first: unknown) {
      if (typeof first !== 'function') return;
      const listener = first as (event: unknown) => void;
      const current = handlers.get(type) ?? new Set();
      current.add(listener);
      handlers.set(type, current);
    },
    once(type: string, listener: (event: unknown) => void) {
      const wrapped = (event: unknown) => {
        handlers.get(type)?.delete(wrapped);
        listener(event);
      };
      map.on(type, wrapped);
    },
    off(type: string, first: unknown) {
      if (typeof first === 'function')
        handlers.get(type)?.delete(first as (event: unknown) => void);
    },
    fire(type: string, event: unknown) {
      for (const listener of [...(handlers.get(type) ?? [])]) listener(event);
    },
  };
  return map;
}

function mouseEvent(map: ReturnType<typeof createMap>, point: Point) {
  return {
    point,
    lngLat: map.unproject(point),
    originalEvent: {
      button: 0,
      buttons: 1,
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

function straightRoad(id: string): Way {
  return {
    id,
    typeId: 'road',
    geometry: 'straight',
    grade: 'atGrade',
    profile: defaultProfileFor('road'),
    points: [
      [-115.25, 36.1],
      [-115.2, 36.1],
    ],
  };
}

function attach(map: ReturnType<typeof createMap>, store: ReturnType<typeof createEditorStore>) {
  const noop: AttachInteractionsOptions = {
    openShortcuts() {},
    toggleUi() {},
    sim: { togglePaused() {}, stepSpeed() {} },
    isDiagramMode: () => false,
    isNetworkMode: () => false, // Demolish only ever runs in Infrastructure view
    focusFootprint() {},
    openContextMenu() {},
    tuning: FINE_POINTER_TUNING,
  };
  return attachInteractions(map as unknown as MLMap, store, noop);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the Demolish tool', () => {
  it('removes a whole way on a plain click', () => {
    const store = createEditorStore();
    store.commands.document.setSystem({
      ...store.getState().system,
      ways: [straightRoad('r1')],
    });
    store.commands.tools.setTool('demolish');
    const map = createMap();
    const detach = attach(map, store);

    // Press exactly on the way's start point and release with no movement.
    map.fire('mousedown', mouseEvent(map, { x: 500, y: 1000 }));
    map.fire('mouseup', mouseEvent(map, { x: 500, y: 1000 }));

    expect(store.getState().system.ways).toHaveLength(0);
    detach();
  });

  it('removes only the swept stretch on a drag', () => {
    const store = createEditorStore();
    store.commands.document.setSystem({
      ...store.getState().system,
      ways: [straightRoad('r1')],
    });
    store.commands.tools.setTool('demolish');
    const map = createMap();
    const detach = attach(map, store);

    // Press near the start, drag to the midpoint, release — sweeps roughly
    // the first half of the way, leaving the back half behind.
    map.fire('mousedown', mouseEvent(map, { x: 500, y: 1000 }));
    map.fire('mousemove', mouseEvent(map, { x: 625, y: 1000 }));
    map.fire('mouseup', mouseEvent(map, { x: 625, y: 1000 }));

    const after = store.getState().system.ways;
    expect(after.length).toBeGreaterThan(0);
    expect(after.find((w) => w.id === 'r1')).toBeUndefined(); // original id consumed by the cut
    const totalPoints = after.reduce((sum, w) => sum + w.points.length, 0);
    expect(totalPoints).toBeGreaterThan(0);
    detach();
  });

  it('touching two ways in one drag removes from both as a single undo step', () => {
    const store = createEditorStore();
    const second: Way = {
      ...straightRoad('r2'),
      points: [
        [-115.2, 36.1],
        [-115.15, 36.1],
      ],
    };
    store.commands.document.setSystem({
      ...store.getState().system,
      ways: [straightRoad('r1'), second],
    });
    store.commands.tools.setTool('demolish');
    const map = createMap();
    const detach = attach(map, store);

    const before = store.getState().canUndo;
    // A real drag samples many intermediate points, not just start and end,
    // with a frame pumped between them — each gives its way a non-zero
    // [lo,hi] range (a single unpumped sample per way is a zero-width range,
    // which deleteWayStretch's own MIN_STRETCH_T guard correctly no-ops).
    map.fire('mousedown', mouseEvent(map, { x: 500, y: 1000 })); // r1 start
    map.fire('mousemove', mouseEvent(map, { x: 750, y: 1000 })); // r1 midpoint
    pumpFrames();
    map.fire('mousemove', mouseEvent(map, { x: 1250, y: 1000 })); // r2 midpoint
    pumpFrames();
    map.fire('mousemove', mouseEvent(map, { x: 1500, y: 1000 })); // r2 end
    map.fire('mouseup', mouseEvent(map, { x: 1500, y: 1000 }));

    expect(before).toBe(false);
    expect(store.getState().canUndo).toBe(true);
    store.commands.history.undo();
    expect(
      store
        .getState()
        .system.ways.map((w) => w.id)
        .sort(),
    ).toEqual(['r1', 'r2']);
    detach();
  });

  it('does nothing on empty ground', () => {
    const store = createEditorStore();
    store.commands.document.setSystem({ ...store.getState().system, ways: [straightRoad('r1')] });
    store.commands.tools.setTool('demolish');
    const map = createMap();
    const detach = attach(map, store);

    map.fire('mousedown', mouseEvent(map, { x: 9000, y: 9000 }));
    map.fire('mouseup', mouseEvent(map, { x: 9000, y: 9000 }));

    expect(store.getState().system.ways).toHaveLength(1);
    detach();
  });

  it('is inert in Network view', () => {
    const store = createEditorStore();
    store.commands.document.setSystem({ ...store.getState().system, ways: [straightRoad('r1')] });
    store.commands.tools.setTool('demolish');
    const map = createMap();
    const noop: AttachInteractionsOptions = {
      openShortcuts() {},
      toggleUi() {},
      sim: { togglePaused() {}, stepSpeed() {} },
      isDiagramMode: () => false,
      isNetworkMode: () => true,
      focusFootprint() {},
      openContextMenu() {},
      tuning: FINE_POINTER_TUNING,
    };
    const detach = attachInteractions(map as unknown as MLMap, store, noop);

    map.fire('mousedown', mouseEvent(map, { x: 500, y: 1000 }));
    map.fire('mouseup', mouseEvent(map, { x: 500, y: 1000 }));

    expect(store.getState().system.ways).toHaveLength(1);
    detach();
  });
});
