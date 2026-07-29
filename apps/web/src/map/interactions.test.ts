import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Map as MLMap, MapGeoJSONFeature } from 'maplibre-gl';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { wholeLeg } from '@transitmapper/core/model/geo';
import { defaultProfileFor } from '@transitmapper/core/model/profile';
import type { Way } from '@transitmapper/core/model/system';
import { aPattern, aRoad, aService, aSystem } from '@transitmapper/core/testing/fixtures';
import type {
  CorridorActionHit,
  ServiceActionHit,
} from '@transitmapper/core/model/selectionActions';
import { createEditorStore } from '../editor/store';
import { createSelectionActions } from '../editor/actions';
import {
  LYR_FACILITIES,
  LYR_HANDLES,
  LYR_SERVICE_TERMINI_HIT,
  LYR_SERVICES_HIT,
  LYR_STATIONS,
  LYR_WAYS_SOLID,
  SRC_ENDPOINT_HINT,
} from './layers';
import { attachInteractions, type AttachInteractionsOptions } from './interactions';
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
      const keyboardEvent = {
        preventDefault() {},
        stopImmediatePropagation() {},
        ...event,
      } as KeyboardEvent;
      for (const listener of listeners.get(type) ?? []) listener(keyboardEvent);
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
    properties: { serviceId: 'service', wayId, patternId: 'branch', run: 'outbound', legIndex: 0 },
    geometry: {
      type: 'LineString',
      coordinates: [
        [-115.25, 36.1],
        [-115.2, 36.1],
      ],
    },
    source: 'tm-services',
    sourceLayer: '',
    layer: { id: LYR_SERVICES_HIT, type: 'line', source: 'tm-services' },
    state: {},
  } as unknown as MapGeoJSONFeature;
}

function serviceFeatureFor(patternId: string, coordinates: [number, number][]): MapGeoJSONFeature {
  const feature = serviceFeature('erasable');
  feature.id = `service-${patternId}`;
  feature.properties = { ...feature.properties, patternId };
  feature.geometry = { type: 'LineString', coordinates };
  return feature;
}

function serviceOccurrenceFeature(
  serviceId: string,
  patternId: string,
  wayId: string,
  legIndex: number,
  coordinates: [number, number][],
): MapGeoJSONFeature {
  const feature = serviceFeatureFor(patternId, coordinates);
  feature.properties = {
    ...feature.properties,
    serviceId,
    patternId,
    wayId,
    run: 'outbound',
    legIndex,
  };
  return feature;
}

function terminusFeature(
  patternId: string,
  side: 'start' | 'end',
  at: [number, number],
): MapGeoJSONFeature {
  return {
    type: 'Feature',
    id: `terminus-${patternId}-${side}`,
    properties: { serviceId: 'service', patternId, side },
    geometry: { type: 'Point', coordinates: at },
    source: 'tm-service-termini',
    sourceLayer: '',
    layer: { id: LYR_SERVICE_TERMINI_HIT, type: 'circle', source: 'tm-service-termini' },
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
  let features = initialFeatures
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
    setFeatures(next: MapGeoJSONFeature | MapGeoJSONFeature[] | null) {
      features = next ? (Array.isArray(next) ? next : [next]) : [];
    },
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

interface ContextMenuProbe {
  open: (
    x: number,
    y: number,
    at: [number, number],
    serviceHit?: ServiceActionHit,
    corridorHit?: CorridorActionHit,
  ) => void;
  setAnchor: (at: [number, number] | null) => void;
  close?: () => void;
}

function attach(
  map: ReturnType<typeof createMap>,
  store: ReturnType<typeof createEditorStore>,
  gesture?: GestureLifecycleProbe,
  directManipulation?: DirectManipulationLifecycleProbe,
  onPointerIntent?: (intent: PointerIntent | null) => void,
  networkMode = true,
  isContextMenuOpen?: () => boolean,
  contextMenu?: ContextMenuProbe,
  onPointerRefresh?: (refresh: () => void) => void,
  openTerminusConnectionChoice?: NonNullable<
    AttachInteractionsOptions['openTerminusConnectionChoice']
  >,
) {
  return attachInteractions(map as unknown as MLMap, store, {
    openShortcuts() {},
    toggleUi() {},
    sim: { togglePaused() {}, stepSpeed() {} },
    isDiagramMode: () => false,
    isNetworkMode: () => networkMode,
    focusFootprint() {},
    openContextMenu: contextMenu?.open ?? (() => {}),
    closeContextMenu: contextMenu?.close,
    setActionAnchor: contextMenu?.setAnchor,
    onEditGestureStart: gesture?.onStart,
    onEditGestureEnd: gesture?.onEnd,
    onDirectManipulationStart: directManipulation?.onStart,
    onDirectManipulationEnd: directManipulation?.onEnd,
    onPointerIntent: onPointerIntent ? (intent) => onPointerIntent(intent) : undefined,
    isContextMenuOpen,
    registerPointerIntentRefresh: onPointerRefresh
      ? (refresh) => {
          onPointerRefresh(refresh);
          return () => {};
        }
      : undefined,
    openTerminusConnectionChoice,
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
  it('dispatches a selected service terminus drag through the resolved extension intent', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const trunk = erasableWay();
    trunk.id = 'trunk';
    trunk.points = [
      [-115.25, 36.1],
      [-115.23, 36.1],
    ];
    const extension = erasableWay();
    extension.id = 'extension';
    extension.points = [
      [-115.23, 36.1],
      [-115.2, 36.1],
    ];
    const system = createEmptySystem();
    system.ways = [trunk, extension];
    system.nodes = [
      {
        id: 'joint',
        coord: [-115.23, 36.1],
        refs: [
          { wayId: 'trunk', pointIndex: 1 },
          { wayId: 'extension', pointIndex: 0 },
        ],
      },
    ];
    system.services = [
      {
        id: 'service',
        name: 'Service',
        modeId: 'bus',
        color: '#e4572e',
        patterns: [{ id: 'branch', sections: [{ kind: 'shared', legs: [wholeLeg('trunk')] }] }],
      },
    ];
    store.getState().setSystem(system);
    store.getState().select({ kind: 'service', id: 'service' });
    store.getState().setActivePattern('branch');
    const map = createMap(terminusFeature('branch', 'end', [-115.23, 36.1]));
    const shown: Array<PointerIntent | null> = [];
    const detach = attach(map, store, undefined, undefined, (intent) => shown.push(intent));

    map.fire('mousedown', mouseEvent(map, map.project([-115.23, 36.1])));
    map.setFeatures(wayFeature('extension'));
    map.fire('mousemove', mouseEvent(map, map.project([-115.2, 36.1])));
    scheduler.pump();

    expect(shown.at(-1)).toMatchObject({
      primaryOperation: 'extend-branch',
      cursor: 'grabbing',
      anchor: 'preview',
    });
    expect(map.sourceData.get('tm-preview')).toMatchObject({
      features: [{ geometry: { type: 'LineString' } }],
    });

    map.fire('mouseup', mouseEvent(map, map.project([-115.2, 36.1])));
    expect(store.getState().system.services[0].patterns[0].sections).toHaveLength(2);
    store.getState().undo();
    expect(store.getState().system).toBe(system);
    detach();
  });

  it('keeps Select active while an armed terminus draws and commits a one-way return', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const a = erasableWay();
    a.id = 'a-b';
    a.points = [
      [-115.25, 36.1],
      [-115.23, 36.1],
    ];
    const b = erasableWay();
    b.id = 'b-c';
    b.points = [
      [-115.23, 36.1],
      [-115.21, 36.1],
    ];
    const c = erasableWay();
    c.id = 'c-d';
    c.points = [
      [-115.21, 36.1],
      [-115.22, 36.11],
    ];
    const d = erasableWay();
    d.id = 'd-b';
    d.points = [
      [-115.22, 36.11],
      [-115.23, 36.1],
    ];
    const system = createEmptySystem();
    system.ways = [a, b, c, d];
    system.nodes = [
      {
        id: 'b',
        coord: [-115.23, 36.1],
        refs: [
          { wayId: 'a-b', pointIndex: 1 },
          { wayId: 'b-c', pointIndex: 0 },
          { wayId: 'd-b', pointIndex: 1 },
        ],
      },
      {
        id: 'c',
        coord: [-115.21, 36.1],
        refs: [
          { wayId: 'b-c', pointIndex: 1 },
          { wayId: 'c-d', pointIndex: 0 },
        ],
      },
      {
        id: 'd',
        coord: [-115.22, 36.11],
        refs: [
          { wayId: 'c-d', pointIndex: 1 },
          { wayId: 'd-b', pointIndex: 0 },
        ],
      },
    ];
    system.services = [
      {
        id: 'service',
        name: 'Service',
        modeId: 'bus',
        color: '#e4572e',
        patterns: [
          {
            id: 'branch',
            sections: [{ kind: 'shared', legs: [wholeLeg('a-b'), wholeLeg('b-c')] }],
          },
        ],
      },
    ];
    store.getState().setSystem(system);
    store.getState().select({ kind: 'service', id: 'service' });
    const position = {
      patternId: 'branch',
      run: 'outbound' as const,
      legIndex: 1,
      wayId: 'b-c',
      t: 1,
      distanceMeters: 1,
    };
    store.getState().armTerminus({
      serviceId: 'service',
      patternId: 'branch',
      side: 'end',
      position,
    });
    const map = createMap(terminusFeature('branch', 'end', [-115.21, 36.1]));
    const shown: Array<PointerIntent | null> = [];
    const detach = attach(map, store, undefined, undefined, (intent) => shown.push(intent));

    map.fire('mousemove', mouseEvent(map, map.project([-115.21, 36.1])));
    scheduler.pump();
    expect(shown.at(-1)).toMatchObject({
      primaryOperation: 'draw-inbound-side',
      badge: 'one-way-return',
    });
    expect(store.getState().tool).toBe('select');

    map.fire('mousedown', mouseEvent(map, map.project([-115.21, 36.1])));
    map.setFeatures(
      serviceOccurrenceFeature('service', 'branch', 'a-b', 0, [
        [-115.25, 36.1],
        [-115.23, 36.1],
      ]),
    );
    map.fire('mousemove', mouseEvent(map, map.project([-115.23, 36.1])));
    scheduler.pump();
    expect(shown.at(-1)).toMatchObject({
      primaryOperation: 'draw-inbound-side',
      badge: 'one-way-return',
      anchor: 'preview',
    });
    expect(map.sourceData.get('tm-preview')).toMatchObject({
      features: [{ properties: { oneWayReturn: true } }],
    });

    map.fire('mouseup', mouseEvent(map, map.project([-115.23, 36.1])));
    expect(store.getState().armedTerminus).toBeNull();
    expect(store.getState().system.services[0].patterns[0].sections).toMatchObject([
      { kind: 'shared' },
      { kind: 'split' },
    ]);
    detach();
  });

  it('dispatches an exact same-branch interior drop as a directional loop', () => {
    const scheduler = installBrowserGlobals();
    const a: [number, number] = [-115.25, 36.1];
    const b: [number, number] = [-115.23, 36.1];
    const c: [number, number] = [-115.21, 36.1];
    const d: [number, number] = [-115.22, 36.11];
    const ways = [
      aRoad('a-b', [a, b]),
      aRoad('b-c', [b, c]),
      aRoad('c-d', [c, d]),
      aRoad('d-b', [d, b]),
    ];
    const pattern = aPattern('branch', ways, ['a-b', 'b-c']);
    const system = aSystem({
      ways,
      services: [aService('service', [pattern])],
      nodes: [
        {
          id: 'b',
          coord: b,
          refs: [
            { wayId: 'a-b', pointIndex: 1 },
            { wayId: 'b-c', pointIndex: 0 },
            { wayId: 'd-b', pointIndex: 1 },
          ],
        },
        {
          id: 'c',
          coord: c,
          refs: [
            { wayId: 'b-c', pointIndex: 1 },
            { wayId: 'c-d', pointIndex: 0 },
          ],
        },
        {
          id: 'd',
          coord: d,
          refs: [
            { wayId: 'c-d', pointIndex: 1 },
            { wayId: 'd-b', pointIndex: 0 },
          ],
        },
      ],
    });
    const store = createEditorStore();
    store.getState().setSystem(system);
    store.getState().select({ kind: 'service', id: 'service' });
    const map = createMap(terminusFeature('branch', 'end', c));
    const shown: Array<PointerIntent | null> = [];
    const detach = attach(map, store, undefined, undefined, (intent) => shown.push(intent));

    map.fire('mousedown', mouseEvent(map, map.project(c)));
    map.setFeatures(serviceOccurrenceFeature('service', 'branch', 'a-b', 0, [a, b]));
    map.fire('mousemove', mouseEvent(map, map.project(b)));
    scheduler.pump();

    expect(shown.at(-1)).toMatchObject({
      primaryOperation: 'close-directional-loop',
      badge: 'loop',
      anchor: 'target',
    });
    map.fire('mouseup', mouseEvent(map, map.project(b)));
    expect(store.getState().system.services[0].patterns[0].sections).toMatchObject([
      { kind: 'shared' },
      { kind: 'split' },
    ]);
    detach();
  });

  it('cancels an armed return gesture with Escape without changing the system', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [erasableWay()];
    system.services = [
      {
        id: 'service',
        name: 'Service',
        modeId: 'bus',
        color: '#e4572e',
        patterns: [{ id: 'branch', sections: [{ kind: 'shared', legs: [wholeLeg('erasable')] }] }],
      },
    ];
    store.getState().setSystem(system);
    store.getState().armTerminus({
      serviceId: 'service',
      patternId: 'branch',
      side: 'end',
      position: {
        patternId: 'branch',
        run: 'outbound',
        legIndex: 0,
        wayId: 'erasable',
        t: 1,
        distanceMeters: 1,
      },
    });
    const map = createMap(terminusFeature('branch', 'end', [-115.2, 36.1]));
    const detach = attach(map, store);

    map.fire('mousedown', mouseEvent(map, map.project([-115.2, 36.1])));
    scheduler.fireKey('keydown', { key: 'Escape' });

    expect(store.getState().system).toBe(system);
    expect(store.getState().armedTerminus).toBeNull();
    expect(store.getState().canUndo).toBe(false);
    detach();
  });

  it('clears an idle armed return with Escape before a drag starts', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [erasableWay()];
    system.services = [
      {
        id: 'service',
        name: 'Service',
        modeId: 'bus',
        color: '#e4572e',
        patterns: [{ id: 'branch', sections: [{ kind: 'shared', legs: [wholeLeg('erasable')] }] }],
      },
    ];
    store.getState().setSystem(system);
    store.getState().armTerminus({
      serviceId: 'service',
      patternId: 'branch',
      side: 'end',
      position: {
        patternId: 'branch',
        run: 'outbound',
        legIndex: 0,
        wayId: 'erasable',
        t: 1,
        distanceMeters: 1,
      },
    });
    const detach = attach(createMap(), store);

    scheduler.fireKey('keydown', { key: 'Escape' });

    expect(store.getState().armedTerminus).toBeNull();
    expect(store.getState().system).toBe(system);
    expect(store.getState().canUndo).toBe(false);
    detach();
  });

  it('opens an inert terminus chooser and commits Connect paths as one undo step', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const first = erasableWay();
    first.id = 'first';
    first.points = [
      [-115.25, 36.1],
      [-115.23, 36.1],
    ];
    const second = erasableWay();
    second.id = 'second';
    second.points = [
      [-115.23, 36.1],
      [-115.2, 36.1],
    ];
    const system = createEmptySystem();
    system.ways = [first, second];
    system.services = [
      {
        id: 'service',
        name: 'Dragged',
        modeId: 'bus',
        color: '#e4572e',
        patterns: [{ id: 'branch', sections: [{ kind: 'shared', legs: [wholeLeg('first')] }] }],
      },
      {
        id: 'target',
        name: 'Target',
        modeId: 'bus',
        color: '#167d9a',
        patterns: [
          { id: 'target-branch', sections: [{ kind: 'shared', legs: [wholeLeg('second')] }] },
        ],
      },
    ];
    store.getState().setSystem(system);
    store.getState().select({ kind: 'service', id: 'service' });
    const sourceTerminus = terminusFeature('branch', 'end', [-115.23, 36.1]);
    const targetTerminus = terminusFeature('target-branch', 'start', [-115.23, 36.1]);
    targetTerminus.properties = {
      ...targetTerminus.properties,
      serviceId: 'target',
      modeId: 'bus',
    };
    const map = createMap(sourceTerminus);
    let chooser:
      | Parameters<NonNullable<AttachInteractionsOptions['openTerminusConnectionChoice']>>[0]
      | undefined;
    const detach = attach(
      map,
      store,
      undefined,
      undefined,
      undefined,
      true,
      undefined,
      undefined,
      undefined,
      (next) => {
        chooser = next;
      },
    );

    map.fire('mousedown', mouseEvent(map, map.project([-115.23, 36.1])));
    map.setFeatures(targetTerminus);
    map.fire('mousemove', mouseEvent(map, map.project([-115.23, 36.1])));
    scheduler.pump();
    map.fire('mouseup', mouseEvent(map, map.project([-115.23, 36.1])));

    expect(chooser).toBeDefined();
    expect(store.getState().system).toBe(system);
    expect(store.getState().canUndo).toBe(false);

    chooser!.connectPaths();
    expect(store.getState().system.services).toHaveLength(2);
    expect(store.getState().system.nodes).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().system).toBe(system);
    detach();
  });

  it('presents and commits no mutation for a different-mode terminus drop', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const road = erasableWay();
    road.id = 'road';
    road.points = [
      [-115.25, 36.1],
      [-115.23, 36.1],
    ];
    const rail = erasableWay();
    rail.id = 'rail';
    rail.typeId = 'heavyRail';
    rail.profile = defaultProfileFor('heavyRail');
    rail.points = [
      [-115.23, 36.1],
      [-115.2, 36.1],
    ];
    const system = createEmptySystem();
    system.ways = [road, rail];
    system.services = [
      {
        id: 'service',
        name: 'Bus',
        modeId: 'bus',
        color: '#e4572e',
        patterns: [{ id: 'branch', sections: [{ kind: 'shared', legs: [wholeLeg('road')] }] }],
      },
      {
        id: 'rail-service',
        name: 'Rail',
        modeId: 'subway',
        color: '#167d9a',
        patterns: [{ id: 'rail-branch', sections: [{ kind: 'shared', legs: [wholeLeg('rail')] }] }],
      },
    ];
    store.getState().setSystem(system);
    store.getState().select({ kind: 'service', id: 'service' });
    const sourceTerminus = terminusFeature('branch', 'end', [-115.23, 36.1]);
    const targetTerminus = terminusFeature('rail-branch', 'start', [-115.23, 36.1]);
    targetTerminus.properties = {
      ...targetTerminus.properties,
      serviceId: 'rail-service',
      modeId: 'subway',
    };
    const map = createMap(sourceTerminus);
    const shown: Array<PointerIntent | null> = [];
    const detach = attach(map, store, undefined, undefined, (intent) => shown.push(intent));

    map.fire('mousedown', mouseEvent(map, map.project([-115.23, 36.1])));
    map.setFeatures(targetTerminus);
    map.fire('mousemove', mouseEvent(map, map.project([-115.23, 36.1])));
    scheduler.pump();
    expect(shown.at(-1)).toMatchObject({
      primaryOperation: 'refuse',
      cursor: 'not-allowed',
      allowed: false,
    });

    map.fire('mouseup', mouseEvent(map, map.project([-115.23, 36.1])));
    expect(store.getState().system).toBe(system);
    expect(store.getState().canUndo).toBe(false);
    detach();
  });

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

  it('focuses the clicked Network service occurrence without inserting a corridor point', () => {
    installBrowserGlobals();
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [erasableWay()];
    system.services = [
      {
        id: 'service',
        name: 'Service',
        modeId: 'bus',
        color: '#e4572e',
        patterns: [
          {
            id: 'branch',
            sections: [{ kind: 'shared', legs: [wholeLeg('erasable')] }],
          },
        ],
      },
    ];
    store.getState().setSystem(system);
    store.getState().select({ kind: 'service', id: 'service' });
    const before = store.getState().system;
    const map = createMap(serviceFeature('erasable'));
    const detach = attach(map, store);

    map.fire('click', mouseEvent(map, map.project([-115.23, 36.1])));

    expect(store.getState().system).toEqual(before);
    expect(store.getState().selection).toEqual({ kind: 'service', id: 'service' });
    expect(store.getState().activePatternId).toBe('branch');
    detach();
  });

  it('focuses the nearest rendered branch among same-layer service hits', () => {
    installBrowserGlobals();
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [erasableWay()];
    system.services = [
      {
        id: 'service',
        name: 'Service',
        modeId: 'bus',
        color: '#e4572e',
        patterns: [
          { id: 'near', sections: [{ kind: 'shared', legs: [wholeLeg('erasable')] }] },
          { id: 'far', sections: [{ kind: 'shared', legs: [wholeLeg('erasable')] }] },
        ],
      },
    ];
    store.getState().setSystem(system);
    const map = createMap([
      serviceFeatureFor('far', [
        [-115.25, 36.11],
        [-115.2, 36.11],
      ]),
      serviceFeatureFor('near', [
        [-115.25, 36.1],
        [-115.2, 36.1],
      ]),
    ]);
    const detach = attach(map, store);

    map.fire('click', mouseEvent(map, map.project([-115.23, 36.1002])));

    expect(store.getState().activePatternId).toBe('near');
    detach();
  });

  it('gives a service terminus priority over overlapping service and corridor hits', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [erasableWay()];
    system.services = [
      {
        id: 'service',
        name: 'Service',
        modeId: 'bus',
        color: '#e4572e',
        patterns: [{ id: 'branch', sections: [{ kind: 'shared', legs: [wholeLeg('erasable')] }] }],
      },
    ];
    store.getState().setSystem(system);
    const at: [number, number] = [-115.23, 36.1];
    const map = createMap([
      terminusFeature('branch', 'end', at),
      serviceFeature('erasable'),
      wayFeature('erasable'),
    ]);
    const opened: unknown[] = [];
    const detach = attach(map, store, undefined, undefined, undefined, true, undefined, {
      open: (_x, _y, anchor, serviceHit) => opened.push({ anchor, serviceHit }),
      setAnchor() {},
    });
    const right = mouseEvent(map, map.project(at));
    right.originalEvent.button = 2;
    map.fire('mousedown', right);
    map.fire('mouseup', right);

    expect(opened).toMatchObject([
      { anchor: at, serviceHit: { terminusSide: 'end', patternId: 'branch', position: { t: 1 } } },
    ]);
    scheduler.fireKey('keydown', { key: 'Escape' });
    detach();
  });

  it('collapses a service multi-selection to a terminus before building its real action registry', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [erasableWay()];
    system.services = ['service', 'other'].map((id) => ({
      id,
      name: id,
      modeId: 'bus',
      color: '#e4572e',
      patterns: [
        { id: `${id}-branch`, sections: [{ kind: 'shared', legs: [wholeLeg('erasable')] }] },
      ],
    }));
    store.getState().setSystem(system);
    store.getState().addMultiSelection([
      { kind: 'service', id: 'service' },
      { kind: 'service', id: 'other' },
    ]);
    const at: [number, number] = [-115.23, 36.1];
    const map = createMap([
      terminusFeature('service-branch', 'end', at),
      serviceFeature('erasable'),
    ]);
    const opened: Array<{ serviceHit?: ServiceActionHit }> = [];
    const detach = attach(map, store, undefined, undefined, undefined, true, undefined, {
      open: (_x, _y, _anchor, serviceHit) => opened.push({ serviceHit }),
      setAnchor() {},
    });
    const right = mouseEvent(map, map.project(at));
    right.originalEvent.button = 2;
    map.fire('mousedown', right);
    map.fire('mouseup', right);

    expect(store.getState().multiSelection).toEqual([]);
    expect(store.getState().selection).toEqual({ kind: 'service', id: 'service' });
    expect(
      createSelectionActions(store)
        .actionsFor({
          system: store.getState().system,
          refs: [{ kind: 'service', id: 'service' }],
          serviceHit: opened[0].serviceHit,
        })
        .map((action) => action.id),
    ).toEqual(['service.convertTerminus']);
    scheduler.fireKey('keydown', { key: 'Escape' });
    detach();
  });

  it('re-publishes a stationary pointer immediately after the menu releases focus', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [erasableWay()];
    store.getState().setSystem(system);
    const map = createMap(wayFeature('erasable'));
    const shown: Array<PointerIntent | null> = [];
    let menuOpen = false;
    let refresh: (() => void) | undefined;
    const detach = attach(
      map,
      store,
      undefined,
      undefined,
      (intent) => shown.push(intent),
      true,
      () => menuOpen,
      undefined,
      (registered) => {
        refresh = registered;
      },
    );
    map.fire('mousemove', mouseEvent(map, map.project([-115.23, 36.1])));
    scheduler.pump();
    expect(shown.at(-1)).toMatchObject({ primaryOperation: 'select-line-and-branch' });

    menuOpen = true;
    refresh!();
    expect(shown.at(-1)).toBeNull();
    menuOpen = false;
    refresh!();
    expect(shown.at(-1)).toMatchObject({ primaryOperation: 'select-line-and-branch' });
    detach();
  });

  it('uses the one projected off-center service hit for both menu anchor and line edit', () => {
    installBrowserGlobals();
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [erasableWay()];
    system.services = [
      {
        id: 'service',
        name: 'Service',
        modeId: 'bus',
        color: '#e4572e',
        patterns: [{ id: 'branch', sections: [{ kind: 'shared', legs: [wholeLeg('erasable')] }] }],
      },
    ];
    store.getState().setSystem(system);
    const map = createMap(serviceFeature('erasable'));
    const opened: Array<{ anchor: [number, number]; serviceHit?: ServiceActionHit }> = [];
    const detach = attach(map, store, undefined, undefined, undefined, true, undefined, {
      open: (_x, _y, anchor, serviceHit) => opened.push({ anchor, serviceHit }),
      setAnchor() {},
    });
    const offCenter = map.project([-115.24, 36.1008]);
    const right = mouseEvent(map, offCenter);
    right.originalEvent.button = 2;
    map.fire('mousedown', right);
    map.fire('mouseup', right);

    expect(opened[0].anchor).toEqual([-115.24, 36.1]);
    const action = createSelectionActions(store)
      .actionsFor({
        system: store.getState().system,
        refs: [{ kind: 'service', id: 'service' }],
        at: opened[0].anchor,
        serviceHit: opened[0].serviceHit,
      })
      .find((candidate) => candidate.id === 'service.endHere')!;
    action.run();
    const leg = store.getState().system.services[0].patterns[0].sections[0];
    expect(leg.kind === 'shared' && leg.legs[0].extent).toMatchObject({
      kind: 'stretch',
      toT: 1,
    });
    if (leg.kind === 'shared' && leg.legs[0].extent.kind === 'stretch')
      expect(leg.legs[0].extent.fromT).toBeCloseTo(0.2, 9);
    detach();
  });

  it('uses the one projected off-center corridor hit for both menu anchor and split', () => {
    installBrowserGlobals();
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [erasableWay()];
    store.getState().setSystem(system);
    const map = createMap(wayFeature('erasable'));
    const opened: Array<{ anchor: [number, number]; corridorHit?: { wayId: string; t: number } }> =
      [];
    const detach = attach(map, store, undefined, undefined, undefined, true, undefined, {
      open: (_x, _y, anchor, _serviceHit, corridorHit) => {
        opened.push({ anchor, corridorHit });
      },
      setAnchor() {},
    });
    const right = mouseEvent(map, map.project([-115.24, 36.1008]));
    right.originalEvent.button = 2;
    map.fire('mousedown', right);
    map.fire('mouseup', right);

    expect(opened[0].anchor).toEqual([-115.24, 36.1]);
    const action = createSelectionActions(store)
      .actionsFor({
        system: store.getState().system,
        refs: [{ kind: 'way', id: 'erasable' }],
        at: opened[0].anchor,
        corridorHit: opened[0].corridorHit,
      })
      .find((candidate) => candidate.id === 'way.splitHere')!;
    action.run();
    expect(store.getState().system.ways).toHaveLength(2);
    expect(store.getState().system.ways[0].points).toContainEqual([-115.24, 36.1]);
    detach();
  });

  it('anchors a service menu to its resolved occurrence and clears it on Escape', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [erasableWay()];
    system.services = [
      {
        id: 'service',
        name: 'Service',
        modeId: 'bus',
        color: '#e4572e',
        patterns: [
          {
            id: 'branch',
            sections: [{ kind: 'shared', legs: [wholeLeg('erasable')] }],
          },
        ],
      },
    ];
    store.getState().setSystem(system);
    const map = createMap(serviceFeature('erasable'));
    const anchors: Array<[number, number] | null> = [];
    const opened: unknown[] = [];
    const closed: string[] = [];
    const detach = attach(map, store, undefined, undefined, undefined, true, undefined, {
      open: (_x, _y, at, serviceHit) => opened.push({ at, serviceHit }),
      setAnchor: (at) => anchors.push(at),
      close: () => closed.push('close'),
    });
    const point = map.project([-115.23, 36.1]);
    const right = mouseEvent(map, point);
    right.originalEvent.button = 2;
    map.fire('mousedown', right);
    map.fire('mouseup', right);

    expect(opened).toMatchObject([
      {
        at: [-115.23, 36.1],
        serviceHit: { serviceId: 'service', patternId: 'branch', run: 'outbound', legIndex: 0 },
      },
    ]);
    expect(anchors.at(-1)).toEqual([-115.23, 36.1]);
    scheduler.fireKey('keydown', { key: 'Escape' });
    expect(anchors.at(-1)).toBeNull();
    expect(closed).toEqual(['close']);
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
    expect(shown.at(-1)).toMatchObject({ primaryOperation: 'move-point' });
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
