import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Map as MLMap, MapGeoJSONFeature } from 'maplibre-gl';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { defaultProfileFor } from '@transitmapper/core/model/profile';
import type { Way } from '@transitmapper/core/model/system';
import { createEditorStore } from '../editor/store';
import { LYR_HANDLES } from './layers';
import { attachInteractions } from './interactions';
import type { EditGestureTargets } from './gestureProjection';

interface Point {
  x: number;
  y: number;
}

interface FrameScheduler {
  pending: () => number;
  pump: () => void;
}

function installBrowserGlobals(): FrameScheduler {
  let nextId = 0;
  let frames = new Map<number, FrameRequestCallback>();
  const listeners = new Map<string, Set<EventListener>>();
  vi.stubGlobal('window', {
    addEventListener(type: string, listener: EventListener) {
      const current = listeners.get(type) ?? new Set();
      current.add(listener);
      listeners.set(type, current);
    },
    removeEventListener(type: string, listener: EventListener) {
      listeners.get(type)?.delete(listener);
    },
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++nextId;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames.delete(id);
  });
  return {
    pending: () => frames.size,
    pump() {
      const due = frames;
      frames = new Map();
      for (const callback of due.values()) callback(0);
    },
  };
}

function handleFeature(index: number): MapGeoJSONFeature {
  return {
    type: 'Feature',
    id: `handle-${index}`,
    properties: { wayId: 'erasable', index },
    geometry: { type: 'Point', coordinates: [-115.2, 36.1] },
    source: 'tm-handles',
    sourceLayer: '',
    layer: { id: LYR_HANDLES, type: 'circle', source: 'tm-handles' },
    state: {},
  } as unknown as MapGeoJSONFeature;
}

function createMap(withHandles = false) {
  const handlers = new Map<string, Set<(event: unknown) => void>>();
  const canvas = {
    style: { cursor: '' },
    addEventListener() {},
    removeEventListener() {},
  };
  const map = {
    getCanvas: () => canvas,
    getCenter: () => ({ lng: -115.2, lat: 36.1 }),
    getZoom: () => 14,
    getLayer: (id: string) => (withHandles && id === LYR_HANDLES ? { id } : undefined),
    getSource: () => ({ setData() {} }),
    getBounds: () => ({
      getWest: () => -116,
      getEast: () => -114,
      getSouth: () => 35,
      getNorth: () => 37,
    }),
    queryRenderedFeatures(
      _box: [[number, number], [number, number]],
      options: { layers: string[] },
    ) {
      return withHandles && options.layers.includes(LYR_HANDLES) ? [handleFeature(1)] : [];
    },
    project: (coord: [number, number]): Point => ({
      x: (coord[0] + 115.3) * 10_000,
      y: (36.2 - coord[1]) * 10_000,
    }),
    unproject: (point: Point) => ({
      lng: -115.3 + point.x / 10_000,
      lat: 36.2 - point.y / 10_000,
    }),
    panBy() {},
    on(type: string, first: unknown, second?: unknown) {
      if (typeof first !== 'function') return;
      const listener = first as (event: unknown) => void;
      const current = handlers.get(type) ?? new Set();
      current.add(listener);
      handlers.set(type, current);
      void second;
    },
    once(type: string, listener: (event: unknown) => void) {
      const wrapped = (event: unknown) => {
        handlers.get(type)?.delete(wrapped);
        listener(event);
      };
      map.on(type, wrapped);
    },
    off(type: string, first: unknown, second?: unknown) {
      if (typeof first === 'function')
        handlers.get(type)?.delete(first as (event: unknown) => void);
      void second;
    },
    fire(type: string, event: unknown) {
      for (const listener of [...(handlers.get(type) ?? [])]) listener(event);
    },
  };
  return map;
}

function mouseEvent(map: ReturnType<typeof createMap>, point: Point, altKey = false) {
  return {
    point,
    lngLat: map.unproject(point),
    originalEvent: {
      button: 0,
      buttons: 1,
      detail: 1,
      altKey,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      preventDefault() {},
    },
    preventDefault() {},
  };
}

interface GestureLifecycleProbe {
  onStart: (targets: EditGestureTargets) => void;
  onEnd: () => void;
}

interface DirectManipulationLifecycleProbe {
  onStart: () => void;
  onEnd: () => void;
}

function attach(
  map: ReturnType<typeof createMap>,
  store: ReturnType<typeof createEditorStore>,
  gesture?: GestureLifecycleProbe,
  directManipulation?: DirectManipulationLifecycleProbe,
) {
  return attachInteractions(map as unknown as MLMap, store, {
    openShortcuts() {},
    toggleUi() {},
    sim: { togglePaused() {}, stepSpeed() {} },
    isDiagramMode: () => false,
    isNetworkMode: () => true,
    focusFootprint() {},
    openContextMenu() {},
    onEditGestureStart: gesture?.onStart,
    onEditGestureEnd: gesture?.onEnd,
    onDirectManipulationStart: directManipulation?.onStart,
    onDirectManipulationEnd: directManipulation?.onEnd,
  });
}

function erasableWay(): Way {
  return {
    id: 'erasable',
    typeId: 'road',
    geometry: 'straight',
    grade: 'atGrade',
    profile: defaultProfileFor('road'),
    points: [
      [-115.25, 36.1],
      [-115.24, 36.1],
      [-115.23, 36.1],
      [-115.22, 36.1],
      [-115.21, 36.1],
      [-115.2, 36.1],
    ],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pointer work coalescing', () => {
  it('freehand drawing samples raw movement once per frame and keeps the release point', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    store.getState().setSystem(createEmptySystem());
    store.getState().setTool('way');
    store.getState().setDraftGeometry('freeform');
    const map = createMap();
    const detach = attach(map, store);

    map.fire('mousedown', mouseEvent(map, { x: 100, y: 100 }));
    map.fire('mousemove', mouseEvent(map, { x: 120, y: 100 }));
    map.fire('mousemove', mouseEvent(map, { x: 140, y: 100 }));
    map.fire('mousemove', mouseEvent(map, { x: 180, y: 100 }));

    expect(store.getState().system.ways).toHaveLength(0);
    expect(scheduler.pending()).toBeGreaterThan(0);

    scheduler.pump();
    expect(store.getState().system.ways[0].points).toHaveLength(2);

    map.fire('mousemove', mouseEvent(map, { x: 220, y: 100 }));
    map.fire('mouseup', mouseEvent(map, { x: 230, y: 100 }));

    const points = store.getState().system.ways[0].points;
    expect(points).toHaveLength(4);
    expect(points.at(-1)).toEqual([-115.277, 36.190000000000005]);

    detach();
  });

  it('erase hit-testing runs once per frame and includes the release position', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [erasableWay()];
    store.getState().setSystem(system);
    store.getState().setTool('select');
    const map = createMap(true);
    const detach = attach(map, store);

    map.fire('mousedown', mouseEvent(map, { x: 100, y: 100 }, true));
    expect(store.getState().system.ways[0].points).toHaveLength(5);

    map.fire('mousemove', mouseEvent(map, { x: 200, y: 100 }, true));
    map.fire('mousemove', mouseEvent(map, { x: 300, y: 100 }, true));
    map.fire('mousemove', mouseEvent(map, { x: 400, y: 100 }, true));
    expect(store.getState().system.ways[0].points).toHaveLength(5);

    scheduler.pump();
    expect(store.getState().system.ways[0].points).toHaveLength(4);

    map.fire('mouseup', mouseEvent(map, { x: 500, y: 100 }, true));
    expect(store.getState().system.ways[0].points).toHaveLength(3);

    detach();
  });

  it('reports the exact boundary around a direct-manipulation drag', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [erasableWay()];
    store.getState().setSystem(system);
    store.getState().setTool('select');
    const map = createMap(true);
    const lifecycle: string[] = [];
    const detach = attach(
      map,
      store,
      {
        onStart: (targets) =>
          lifecycle.push(
            `edit-start:${targets.wayPoints?.[0]?.wayId}:${targets.wayPoints?.[0]?.pointIndex}`,
          ),
        onEnd: () => lifecycle.push('edit-end'),
      },
      {
        onStart: () => lifecycle.push('direct-start'),
        onEnd: () => lifecycle.push('direct-end'),
      },
    );

    map.fire('mousedown', mouseEvent(map, { x: 100, y: 100 }));
    map.fire('mousemove', mouseEvent(map, { x: 140, y: 110 }));
    scheduler.pump();

    expect(lifecycle).toEqual(['direct-start', 'edit-start:erasable:1']);

    map.fire('mouseup', mouseEvent(map, { x: 140, y: 110 }));

    expect(lifecycle).toEqual(['direct-start', 'edit-start:erasable:1', 'edit-end', 'direct-end']);
    detach();
  });

  it('reports the exact boundary around a camera drag', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    store.getState().setSystem(createEmptySystem());
    store.getState().setTool('select');
    const map = createMap();
    const lifecycle: string[] = [];
    const detach = attach(map, store, undefined, {
      onStart: () => lifecycle.push('start'),
      onEnd: () => lifecycle.push('end'),
    });

    map.fire('mousedown', mouseEvent(map, { x: 100, y: 100 }));
    map.fire('mousemove', mouseEvent(map, { x: 140, y: 110 }));
    scheduler.pump();

    expect(lifecycle).toEqual(['start']);

    map.fire('mouseup', mouseEvent(map, { x: 140, y: 110 }));

    expect(lifecycle).toEqual(['start', 'end']);
    detach();
  });
});
