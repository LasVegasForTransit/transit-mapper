import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Map as MLMap, MapGeoJSONFeature } from 'maplibre-gl';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { defaultProfileFor } from '@transitmapper/core/model/profile';
import type { Way } from '@transitmapper/core/model/system';
import { createEditorStore } from '../editor/store';
import {
  LYR_FACILITIES,
  LYR_HANDLES,
  LYR_SERVICES_HIT,
  LYR_STATIONS,
  LYR_WAYS_SOLID,
  SRC_ENDPOINT_HINT,
} from './layers';
import { attachInteractions } from './interactions';
import type { PointerIntent } from '../editor/pointerIntent';
import type { EditGestureTargets } from './gestureProjection';

interface Point {
  x: number;
  y: number;
}

interface FrameScheduler {
  pending: () => number;
  pump: () => void;
  fireKey: (type: 'keydown' | 'keyup', event: Partial<KeyboardEvent>) => void;
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
    fireKey(type, event) {
      for (const listener of listeners.get(type) ?? []) listener(event as KeyboardEvent);
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

function wayFeature(wayId: string): MapGeoJSONFeature {
  return {
    type: 'Feature',
    id: `way-${wayId}`,
    properties: { id: wayId },
    geometry: { type: 'LineString', coordinates: [] },
    source: 'tm-ways',
    sourceLayer: '',
    layer: { id: LYR_WAYS_SOLID, type: 'line', source: 'tm-ways' },
    state: {},
  } as unknown as MapGeoJSONFeature;
}

function serviceFeature(wayId: string): MapGeoJSONFeature {
  return {
    type: 'Feature',
    id: `service-${wayId}`,
    properties: { serviceId: 'service', wayId },
    geometry: { type: 'LineString', coordinates: [] },
    source: 'tm-services',
    sourceLayer: '',
    layer: { id: LYR_SERVICES_HIT, type: 'line', source: 'tm-services' },
    state: {},
  } as unknown as MapGeoJSONFeature;
}

function stationFeature(id: string): MapGeoJSONFeature {
  return {
    type: 'Feature',
    id: `station-${id}`,
    properties: { id },
    geometry: { type: 'Point', coordinates: [-115.2, 36.1] },
    source: 'tm-stations',
    sourceLayer: '',
    layer: { id: LYR_STATIONS, type: 'circle', source: 'tm-stations' },
    state: {},
  } as unknown as MapGeoJSONFeature;
}

function facilityFeature(id: string): MapGeoJSONFeature {
  return {
    type: 'Feature',
    id: `facility-${id}`,
    properties: { id },
    geometry: { type: 'Point', coordinates: [-115.2, 36.1] },
    source: 'tm-facilities',
    sourceLayer: '',
    layer: { id: LYR_FACILITIES, type: 'circle', source: 'tm-facilities' },
    state: {},
  } as unknown as MapGeoJSONFeature;
}

function createMap(initialFeatures: MapGeoJSONFeature | MapGeoJSONFeature[] | null = null) {
  const features = initialFeatures
    ? Array.isArray(initialFeatures)
      ? initialFeatures
      : [initialFeatures]
    : [];
  const handlers = new Map<string, Set<(event: unknown) => void>>();
  const sourceData = new Map<string, unknown>();
  const panCalls: unknown[][] = [];
  const canvas = {
    style: { cursor: '' },
    addEventListener() {},
    removeEventListener() {},
  };
  const map = {
    getCanvas: () => canvas,
    getCenter: () => ({ lng: -115.2, lat: 36.1 }),
    getZoom: () => 14,
    getLayer: (id: string) =>
      features.some((feature) => feature.layer.id === id) ? { id } : undefined,
    getSource: (id: string) => ({
      setData(data: unknown) {
        sourceData.set(id, data);
      },
    }),
    sourceData,
    panCalls,
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
      return features.filter((feature) => options.layers.includes(feature.layer.id));
    },
    project: (coord: [number, number]): Point => ({
      x: (coord[0] + 115.3) * 10_000,
      y: (36.2 - coord[1]) * 10_000,
    }),
    unproject: (point: Point) => ({
      lng: -115.3 + point.x / 10_000,
      lat: 36.2 - point.y / 10_000,
    }),
    panBy(...args: unknown[]) {
      panCalls.push(args);
    },
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

function mouseEvent(
  map: ReturnType<typeof createMap>,
  point: Point,
  modifiers: Partial<{
    altKey: boolean;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
  }> = {},
) {
  return {
    point,
    lngLat: map.unproject(point),
    originalEvent: {
      button: 0,
      buttons: 1,
      detail: 1,
      altKey: modifiers.altKey ?? false,
      shiftKey: modifiers.shiftKey ?? false,
      ctrlKey: modifiers.ctrlKey ?? false,
      metaKey: modifiers.metaKey ?? false,
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
  onPointerIntent?: (intent: PointerIntent | null) => void,
  networkMode = true,
  isContextMenuOpen?: () => boolean,
) {
  return attachInteractions(map as unknown as MLMap, store, {
    openShortcuts() {},
    toggleUi() {},
    sim: { togglePaused() {}, stepSpeed() {} },
    isDiagramMode: () => false,
    isNetworkMode: () => networkMode,
    focusFootprint() {},
    openContextMenu() {},
    onEditGestureStart: gesture?.onStart,
    onEditGestureEnd: gesture?.onEnd,
    onDirectManipulationStart: directManipulation?.onStart,
    onDirectManipulationEnd: directManipulation?.onEnd,
    onPointerIntent: onPointerIntent ? (intent) => onPointerIntent(intent) : undefined,
    isContextMenuOpen,
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
  it('splits an interior control point through the resolved Ctrl intent', () => {
    installBrowserGlobals();
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [erasableWay()];
    store.getState().setSystem(system);
    const map = createMap(handleFeature(2));
    const detach = attach(map, store, undefined, undefined, undefined, false);

    map.fire('mousedown', mouseEvent(map, { x: 100, y: 100 }, { ctrlKey: true }));

    expect(store.getState().system.ways).toHaveLength(2);
    detach();
  });

  it('starts a Shift-constrained control-point drag instead of extending selection', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [erasableWay()];
    store.getState().setSystem(system);
    const map = createMap(handleFeature(1));
    const detach = attach(map, store, undefined, undefined, undefined, false);

    map.fire('mousedown', mouseEvent(map, { x: 100, y: 100 }, { shiftKey: true }));
    map.fire('mousemove', mouseEvent(map, { x: 140, y: 120 }, { shiftKey: true }));
    scheduler.pump();

    const moved = store.getState().system.ways[0].points[1];
    expect(moved).toEqual([-115.25, 36.192682741422644]);
    expect(store.getState().multiSelection).toEqual([]);
    detach();
  });

  it('keeps a point drag operation locked while controller key transitions toggle its constraint', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [erasableWay()];
    store.getState().setSystem(system);
    const map = createMap(handleFeature(1));
    const shown: Array<PointerIntent | null> = [];
    const detach = attach(map, store, undefined, undefined, (intent) => shown.push(intent), false);

    map.fire('mousedown', mouseEvent(map, { x: 100, y: 100 }));
    scheduler.fireKey('keydown', { key: 'Shift', shiftKey: true });
    expect(shown.at(-1)).toMatchObject({
      primaryOperation: 'move-point',
      constraint: 'constrain',
    });

    scheduler.fireKey('keyup', { key: 'Shift', shiftKey: false });
    expect(shown.at(-1)).toMatchObject({
      primaryOperation: 'move-point',
      constraint: 'none',
    });
    detach();
  });

  it('classifies a compatible corridor beneath a service overlay as a route target', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [erasableWay()];
    store.getState().setSystem(system);
    store.getState().setTool('way');
    const map = createMap([serviceFeature('erasable'), wayFeature('erasable')]);
    const shown: Array<PointerIntent | null> = [];
    const detach = attach(map, store, undefined, undefined, (intent) => shown.push(intent));

    map.fire('mousemove', mouseEvent(map, { x: 700, y: 1000 }));
    scheduler.pump();

    expect(shown.at(-1)).toMatchObject({
      primaryOperation: 'route-service',
      anchor: 'target',
    });
    map.fire('mousedown', mouseEvent(map, { x: 700, y: 1000 }));
    expect(store.getState().routeDraft).not.toBeNull();
    detach();
  });

  it('publishes and dispatches a compatible open endpoint as a resume target', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [erasableWay()];
    store.getState().setSystem(system);
    store.getState().setTool('way');
    const map = createMap(wayFeature('erasable'));
    const shown: Array<PointerIntent | null> = [];
    const detach = attach(map, store, undefined, undefined, (intent) => shown.push(intent));
    const endpoint = map.project([-115.2, 36.1]);

    map.fire('mousemove', mouseEvent(map, endpoint));
    scheduler.pump();
    expect(shown.at(-1)).toMatchObject({
      primaryOperation: 'resume-service-and-corridor',
      anchor: 'target',
    });

    map.fire('mousedown', mouseEvent(map, endpoint));
    expect(store.getState().routeDraft).toBeNull();
    expect(store.getState().activeWayId).toBe('erasable');
    detach();
  });

  it('continues a route draft through a compatible open endpoint instead of resuming the way', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [erasableWay()];
    store.getState().setSystem(system);
    store.getState().setTool('way');
    store.getState().startRouteDraft({ wayId: 'erasable', insertIndex: 1, coord: [-115.24, 36.1] });
    const map = createMap(wayFeature('erasable'));
    const shown: Array<PointerIntent | null> = [];
    const detach = attach(map, store, undefined, undefined, (intent) => shown.push(intent));
    const endpoint = map.project([-115.2, 36.1]);

    map.fire('mousemove', mouseEvent(map, endpoint));
    scheduler.pump();
    expect(shown.at(-1)).toMatchObject({
      primaryOperation: 'route-service',
      anchor: 'target',
    });

    map.fire('mousedown', mouseEvent(map, endpoint));
    expect(store.getState().activeWayId).toBeNull();
    expect(store.getState().routeDraft?.lastAnchor.coord).toEqual([-115.2, 36.1]);
    detach();
  });

  it('continues an active route through an Alt compatible endpoint without starting a way', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [erasableWay()];
    store.getState().setSystem(system);
    store.getState().setTool('way');
    store.getState().startRouteDraft({ wayId: 'erasable', insertIndex: 1, coord: [-115.24, 36.1] });
    const map = createMap(wayFeature('erasable'));
    const shown: Array<PointerIntent | null> = [];
    const detach = attach(map, store, undefined, undefined, (intent) => shown.push(intent));
    const endpoint = map.project([-115.2, 36.1]);

    map.fire('mousemove', mouseEvent(map, endpoint, { altKey: true }));
    scheduler.pump();
    expect(shown.at(-1)).toMatchObject({
      primaryOperation: 'route-service',
      badge: 'connect',
      anchor: 'target',
    });

    map.fire('mousedown', mouseEvent(map, endpoint, { altKey: true }));
    expect(store.getState().activeWayId).toBeNull();
    expect(store.getState().routeDraft?.lastAnchor.coord).toEqual([-115.2, 36.1]);

    map.fire('dblclick', mouseEvent(map, endpoint));
    expect(store.getState().routeDraft).toBeNull();
    expect(store.getState().activeWayId).toBeNull();
    detach();
  });

  it('starts an existing Network station drag instead of panning the map', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const stationId = store.getState().addStation([-115.2, 36.1]);
    const map = createMap(stationFeature(stationId));
    const lifecycle: string[] = [];
    const detach = attach(
      map,
      store,
      {
        onStart: (targets) => lifecycle.push(`edit:${targets.stationIds?.[0]}`),
        onEnd() {},
      },
      { onStart: () => lifecycle.push('direct'), onEnd() {} },
    );

    map.fire('mousedown', mouseEvent(map, { x: 100, y: 100 }));
    map.fire('mousemove', mouseEvent(map, { x: 140, y: 100 }));
    scheduler.pump();

    expect(lifecycle).toEqual(['direct', `edit:${stationId}`]);
    expect(map.panCalls).toEqual([]);
    detach();
  });

  it('starts an existing Network facility drag instead of panning the map', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const facilityId = store.getState().addFacility('entrance', [-115.2, 36.1]);
    const map = createMap(facilityFeature(facilityId));
    const lifecycle: string[] = [];
    const detach = attach(
      map,
      store,
      {
        onStart: (targets) => lifecycle.push(`edit:${targets.facilityIds?.[0]}`),
        onEnd() {},
      },
      { onStart: () => lifecycle.push('direct'), onEnd() {} },
    );

    map.fire('mousedown', mouseEvent(map, { x: 100, y: 100 }));
    map.fire('mousemove', mouseEvent(map, { x: 140, y: 100 }));
    scheduler.pump();

    expect(lifecycle).toEqual(['direct', `edit:${facilityId}`]);
    expect(map.panCalls).toEqual([]);
    detach();
  });

  it('publishes erase and deletes an Alt-clicked Network station', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const stationId = store.getState().addStation([-115.2, 36.1]);
    const map = createMap(stationFeature(stationId));
    const shown: Array<PointerIntent | null> = [];
    const detach = attach(map, store, undefined, undefined, (intent) => shown.push(intent));

    map.fire('mousemove', mouseEvent(map, { x: 100, y: 100 }, { altKey: true }));
    scheduler.pump();
    expect(shown.at(-1)).toMatchObject({
      primaryOperation: 'delete-station',
      cursor: 'grab',
      badge: 'erase',
      anchor: 'target',
    });

    map.fire('mousedown', mouseEvent(map, { x: 100, y: 100 }, { altKey: true }));
    expect(store.getState().system.stations).toHaveLength(0);
    expect(map.panCalls).toEqual([]);
    detach();
  });

  it('publishes erase and deletes an Alt-clicked Network facility', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const facilityId = store.getState().addFacility('entrance', [-115.2, 36.1]);
    const map = createMap(facilityFeature(facilityId));
    const shown: Array<PointerIntent | null> = [];
    const detach = attach(map, store, undefined, undefined, (intent) => shown.push(intent));

    map.fire('mousemove', mouseEvent(map, { x: 100, y: 100 }, { altKey: true }));
    scheduler.pump();
    expect(shown.at(-1)).toMatchObject({
      primaryOperation: 'delete-facility',
      cursor: 'grab',
      badge: 'erase',
      anchor: 'target',
    });

    map.fire('mousedown', mouseEvent(map, { x: 100, y: 100 }, { altKey: true }));
    expect(store.getState().system.facilities).toHaveLength(0);
    expect(map.panCalls).toEqual([]);
    detach();
  });

  it('keeps Shift-click on a Network station as multi-selection instead of a drag', () => {
    installBrowserGlobals();
    const store = createEditorStore();
    const stationId = store.getState().addStation([-115.2, 36.1]);
    const map = createMap(stationFeature(stationId));
    const detach = attach(map, store);

    map.fire('mousedown', mouseEvent(map, { x: 100, y: 100 }, { shiftKey: true }));

    expect(store.getState().multiSelection).toEqual([{ kind: 'station', id: stationId }]);
    expect(map.panCalls).toEqual([]);
    detach();
  });

  it('drags all selected Network items when starting from a station', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const stationId = store.getState().addStation([-115.2, 36.1]);
    const facilityId = store.getState().addFacility('entrance', [-115.21, 36.1]);
    store.getState().addMultiSelection([
      { kind: 'station', id: stationId },
      { kind: 'facility', id: facilityId },
    ]);
    const originalFacility = structuredClone(
      store.getState().system.facilities.find((facility) => facility.id === facilityId)?.geometry,
    );
    const map = createMap(stationFeature(stationId));
    const detach = attach(map, store);

    map.fire('mousedown', mouseEvent(map, { x: 100, y: 100 }));
    map.fire('mousemove', mouseEvent(map, { x: 140, y: 100 }));
    scheduler.pump();

    expect(
      store.getState().system.facilities.find((facility) => facility.id === facilityId)?.geometry,
    ).not.toEqual(originalFacility);
    expect(map.panCalls).toEqual([]);
    detach();
  });

  it('drags all selected Network items when starting from a facility', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const stationId = store.getState().addStation([-115.21, 36.1]);
    const facilityId = store.getState().addFacility('entrance', [-115.2, 36.1]);
    store.getState().addMultiSelection([
      { kind: 'station', id: stationId },
      { kind: 'facility', id: facilityId },
    ]);
    const originalStation = structuredClone(
      store.getState().system.stations.find((station) => station.id === stationId)?.coord,
    );
    const map = createMap(facilityFeature(facilityId));
    const detach = attach(map, store);

    map.fire('mousedown', mouseEvent(map, { x: 100, y: 100 }));
    map.fire('mousemove', mouseEvent(map, { x: 140, y: 100 }));
    scheduler.pump();

    expect(
      store.getState().system.stations.find((station) => station.id === stationId)?.coord,
    ).not.toEqual(originalStation);
    expect(map.panCalls).toEqual([]);
    detach();
  });

  it('treats an incompatible raw corridor as a new service draw and does not route it', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [{ ...erasableWay(), typeId: 'heavyRail' }];
    store.getState().setSystem(system);
    store.getState().setTool('way');
    const map = createMap(wayFeature('erasable'));
    const shown: Array<PointerIntent | null> = [];
    const detach = attach(map, store, undefined, undefined, (intent) => shown.push(intent));

    map.fire('mousemove', mouseEvent(map, { x: 700, y: 1000 }));
    scheduler.pump();
    expect(shown.at(-1)).toMatchObject({ primaryOperation: 'draw-service-and-corridor' });

    map.fire('mousedown', mouseEvent(map, { x: 700, y: 1000 }));
    expect(store.getState().routeDraft).toBeNull();
    expect(store.getState().activeWayId).not.toBeNull();
    detach();
  });

  it('honors the separate-corridor intent over a compatible route target', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [erasableWay()];
    store.getState().setSystem(system);
    store.getState().setTool('way');
    const map = createMap(wayFeature('erasable'));
    const shown: Array<PointerIntent | null> = [];
    const detach = attach(map, store, undefined, undefined, (intent) => shown.push(intent));

    map.fire('mousemove', mouseEvent(map, { x: 700, y: 1000 }, { altKey: true }));
    scheduler.pump();
    expect(shown.at(-1)).toMatchObject({ primaryOperation: 'draw-separate-corridor' });

    map.fire('mousedown', mouseEvent(map, { x: 700, y: 1000 }, { altKey: true }));
    expect(store.getState().routeDraft).toBeNull();
    expect(store.getState().activeWayId).not.toBeNull();
    expect(store.getState().draftSeparate).toBe(true);
    detach();
  });

  it('uses a route target intent to place the existing endpoint marker on the compatible corridor', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [erasableWay()];
    store.getState().setSystem(system);
    store.getState().setTool('way');
    const map = createMap(serviceFeature('erasable'));
    const detach = attach(map, store);

    map.fire('mousemove', mouseEvent(map, { x: 700, y: 1000 }));
    scheduler.pump();

    expect(map.sourceData.get(SRC_ENDPOINT_HINT)).toEqual({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Point', coordinates: [-115.23, 36.1] },
        },
      ],
    });
    detach();
  });

  it('lets a network line-selection intent wait for its click instead of starting a pan', () => {
    installBrowserGlobals();
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [erasableWay()];
    store.getState().setSystem(system);
    const map = createMap(wayFeature('erasable'));
    const lifecycle: string[] = [];
    const detach = attach(map, store, undefined, {
      onStart: () => lifecycle.push('start'),
      onEnd: () => lifecycle.push('end'),
    });

    map.fire('mousedown', mouseEvent(map, { x: 700, y: 1000 }));
    expect(lifecycle).toEqual([]);
    map.fire('click', mouseEvent(map, { x: 700, y: 1000 }));
    expect(store.getState().selection).toEqual({ kind: 'way', id: 'erasable' });
    detach();
  });

  it('updates a stationary cursor on keydown and keyup without a mouse move', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [erasableWay()];
    store.getState().setSystem(system);
    const map = createMap(handleFeature(1));
    const shown: Array<PointerIntent | null> = [];
    const detach = attach(map, store, undefined, undefined, (intent) => shown.push(intent), false);

    map.fire('mousemove', mouseEvent(map, { x: 100, y: 100 }));
    scheduler.pump();
    scheduler.fireKey('keydown', { key: 'Shift', shiftKey: true });
    expect(shown.at(-1)).toMatchObject({
      badge: 'constrain',
      primaryOperation: 'constrained-move',
    });

    scheduler.fireKey('keyup', { key: 'Shift', shiftKey: false });
    expect(shown.at(-1)).toMatchObject({ badge: 'move', primaryOperation: 'move-point' });
    detach();
  });

  it('publishes the resolver anchor and preview for a supported network draw', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    store.getState().setSystem(createEmptySystem());
    store.getState().setTool('way');
    const map = createMap();
    const shown: Array<PointerIntent | null> = [];
    const detach = attach(map, store, undefined, undefined, (intent) => shown.push(intent));

    map.fire('mousemove', mouseEvent(map, { x: 100, y: 100 }));
    scheduler.pump();

    expect(shown.at(-1)).toMatchObject({
      primaryOperation: 'draw-service-and-corridor',
      anchor: 'preview',
      badge: 'new',
    });
    detach();
  });

  it('keeps an active point drag locked when later modifiers request other operations', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [erasableWay()];
    store.getState().setSystem(system);
    const map = createMap(handleFeature(1));
    const detach = attach(map, store, undefined, undefined, undefined, false);

    map.fire('mousedown', mouseEvent(map, { x: 100, y: 100 }));
    map.fire('mousemove', mouseEvent(map, { x: 140, y: 100 }, { altKey: true, ctrlKey: true }));
    scheduler.pump();

    expect(store.getState().system.ways).toHaveLength(1);
    expect(store.getState().system.ways[0].points).toHaveLength(6);
    expect(store.getState().system.ways[0].points[1][0]).not.toBe(-115.24);
    detach();
  });

  it('refreshes a read-only target to its refusal cursor', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [erasableWay()];
    store.getState().setSystem(system);
    const map = createMap(handleFeature(1));
    const detach = attach(map, store, undefined, undefined, undefined, false);

    map.fire('mousemove', mouseEvent(map, { x: 100, y: 100 }));
    scheduler.pump();
    store.getState().setSystem(store.getState().system, { readOnly: true });

    expect(map.getCanvas().style.cursor).toBe('not-allowed');
    detach();
  });

  it('clears and gates stationary intent while the action menu is open', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [erasableWay()];
    store.getState().setSystem(system);
    const map = createMap(handleFeature(1));
    const shown: Array<PointerIntent | null> = [];
    let menuOpen = false;
    const detach = attach(
      map,
      store,
      undefined,
      undefined,
      (intent) => shown.push(intent),
      false,
      () => menuOpen,
    );

    map.fire('mousemove', mouseEvent(map, { x: 100, y: 100 }));
    scheduler.pump();
    menuOpen = true;
    scheduler.fireKey('keydown', { key: 'Shift', shiftKey: true });
    expect(shown.at(-1)).toBeNull();

    menuOpen = false;
    scheduler.fireKey('keyup', { key: 'Shift', shiftKey: false });
    expect(shown.at(-1)).toBeNull();
    detach();
  });

  it('clears the cursor badge when the target leaves or the tool changes', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [erasableWay()];
    store.getState().setSystem(system);
    const map = createMap(handleFeature(1));
    const shown: Array<PointerIntent | null> = [];
    const detach = attach(map, store, undefined, undefined, (intent) => shown.push(intent), false);

    map.fire('mousemove', mouseEvent(map, { x: 100, y: 100 }));
    scheduler.pump();
    expect(shown.at(-1)).toMatchObject({ badge: 'move', primaryOperation: 'move-point' });

    map.fire('mousedown', mouseEvent(map, { x: 100, y: 100 }));
    map.fire('mouseup', mouseEvent(map, { x: 100, y: 100 }));
    expect(shown.at(-1)).toBeNull();

    map.fire('mousemove', mouseEvent(map, { x: 100, y: 100 }));
    scheduler.pump();
    map.fire('mouseout', {});
    expect(shown.at(-1)).toBeNull();

    map.fire('mousemove', mouseEvent(map, { x: 100, y: 100 }));
    scheduler.pump();
    store.getState().setTool('way');
    expect(shown.at(-1)).toBeNull();

    store.getState().setTool('select');
    map.fire('mousemove', mouseEvent(map, { x: 100, y: 100 }));
    scheduler.pump();
    store.getState().setSystem(store.getState().system, { readOnly: true });
    expect(shown.at(-1)).toBeNull();

    detach();
  });

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
    const map = createMap(handleFeature(1));
    const detach = attach(map, store);

    map.fire('mousedown', mouseEvent(map, { x: 100, y: 100 }, { altKey: true }));
    expect(store.getState().system.ways[0].points).toHaveLength(5);

    map.fire('mousemove', mouseEvent(map, { x: 200, y: 100 }, { altKey: true }));
    map.fire('mousemove', mouseEvent(map, { x: 300, y: 100 }, { altKey: true }));
    map.fire('mousemove', mouseEvent(map, { x: 400, y: 100 }, { altKey: true }));
    expect(store.getState().system.ways[0].points).toHaveLength(5);

    scheduler.pump();
    expect(store.getState().system.ways[0].points).toHaveLength(4);

    map.fire('mouseup', mouseEvent(map, { x: 500, y: 100 }, { altKey: true }));
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
    const map = createMap(handleFeature(1));
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
