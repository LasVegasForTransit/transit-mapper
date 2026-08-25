import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Map as MLMap, MapGeoJSONFeature } from 'maplibre-gl';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { haversineMeters, patternLegs, wholeLeg } from '@transitmapper/core/model/geo';
import { defaultProfileFor } from '@transitmapper/core/model/profile';
import type { Way } from '@transitmapper/core/model/system';
import { aPattern, aRoad, aService, aSystem } from '@transitmapper/core/testing/fixtures';
import type {
  CorridorActionHit,
  ServiceActionHit,
} from '@transitmapper/core/model/selectionActions';
import { createEditorStore } from '../../src/editor/store';
import { createSelectionActions } from '../../src/editor/actions';
import {
  LYR_FACILITIES,
  LYR_GESTURE_POINT,
  LYR_HANDLES,
  LYR_SERVICE_TERMINI_HIT,
  LYR_SERVICES_HIT,
  LYR_STATIONS,
  LYR_WAYS_SOLID,
  SRC_ENDPOINT_HINT,
} from '@transitmapper/renderer/layers';
import { attachInteractions, type AttachInteractionsOptions } from '../../src/map/interactions';
import {
  COARSE_POINTER_TUNING,
  FINE_POINTER_TUNING,
  type InputTuning,
} from '../../src/editor/input-tuning';
import type { PointerIntent } from '../../src/editor/pointerIntent';
import type { EditGestureTargets } from '../../src/map/gestureProjection';
import { required } from '../support/required.test';

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
    properties: { serviceId: 'service', wayId, patternId: 'service', run: 'outbound', legIndex: 0 },
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

function stopFeature(
  id: string,
  coordinates: [number, number] = [-115.2, 36.1],
): MapGeoJSONFeature {
  return {
    type: 'Feature',
    id: `stop-${id}`,
    properties: { id },
    geometry: { type: 'Point', coordinates },
    source: 'tm-stops',
    sourceLayer: '',
    layer: { id: LYR_STATIONS, type: 'circle', source: 'tm-stops' },
    state: {},
  } as unknown as MapGeoJSONFeature;
}

function settlingStopFeature(
  id: string,
  coordinates: [number, number] = [-115.2, 36.1],
): MapGeoJSONFeature {
  return {
    ...stopFeature(id, coordinates),
    properties: { kind: 'stop', ownerId: id, id },
    source: 'tm-gesture',
    layer: { id: LYR_GESTURE_POINT, type: 'circle', source: 'tm-gesture' },
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
  let renderedFeatureQueries = 0;
  let projectedCoordinates = 0;
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
      renderedFeatureQueries++;
      return features.filter((feature) => options.layers.includes(feature.layer.id));
    },
    renderedFeatureQueryCount: () => renderedFeatureQueries,
    projectedCoordinateCount: () => projectedCoordinates,
    resetProjectedCoordinateCount() {
      projectedCoordinates = 0;
    },
    project: (coord: [number, number]): Point => {
      projectedCoordinates++;
      return {
        x: (coord[0] + 115.3) * 10_000,
        y: (36.2 - coord[1]) * 10_000,
      };
    },
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

/**
 * A MapTouchEvent as MapLibre delivers one: `point` is the centroid of the
 * active touches and `points` is every one of them, which is how the adapter
 * tells a one-finger gesture from a pinch.
 */
function touchEvent(map: ReturnType<typeof createMap>, points: Point[], timeStamp?: number) {
  const centroid =
    points.length > 0
      ? {
          x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
          y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
        }
      : { x: 0, y: 0 };
  return {
    point: centroid,
    points,
    lngLat: map.unproject(centroid),
    lngLats: points.map((p) => map.unproject(p)),
    // The adapter reads timeStamp, not the clock: dispatching a tap blocks the
    // main thread long enough to swallow the double-tap window otherwise.
    originalEvent: { preventDefault() {}, timeStamp },
    preventDefault() {},
  };
}

/**
 * A tap, as a browser actually delivers one: the touch pair, then the
 * compatibility mouse events every browser emits afterwards for a motionless
 * touch. The adapter deliberately does NOT synthesize these — doing so made
 * every tap land twice — so a test that fires only touchstart/touchend is
 * modelling a browser that does not exist.
 */
function tap(map: ReturnType<typeof createMap>, point: Point, at?: number) {
  map.fire('touchstart', touchEvent(map, [point], at));
  map.fire('touchend', touchEvent(map, [], at));
  map.fire('mousedown', mouseEvent(map, point));
  map.fire('mouseup', mouseEvent(map, point));
  map.fire('click', mouseEvent(map, point));
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

interface AttachOptions {
  gesture?: GestureLifecycleProbe;
  directManipulation?: DirectManipulationLifecycleProbe;
  onPointerIntent?: (intent: PointerIntent | null) => void;
  onSelectionIntent?: () => void;
  /** Defaults to the Network view, which most cases exercise. */
  networkMode?: boolean;
  isContextMenuOpen?: () => boolean;
  contextMenu?: ContextMenuProbe;
  onPointerRefresh?: (refresh: () => void) => void;
  openTerminusConnectionChoice?: NonNullable<
    AttachInteractionsOptions['openTerminusConnectionChoice']
  >;
  /** Defaults to the fine profile, matching a mouse. */
  tuning?: InputTuning;
}

/**
 * Named rather than positional. This took eleven positional parameters once,
 * and its call sites were long runs of `undefined` counted by hand.
 */
function attach(
  map: ReturnType<typeof createMap>,
  store: ReturnType<typeof createEditorStore>,
  options: AttachOptions = {},
) {
  const {
    gesture,
    directManipulation,
    onPointerIntent,
    onSelectionIntent,
    networkMode = true,
    isContextMenuOpen,
    contextMenu,
    onPointerRefresh,
    openTerminusConnectionChoice,
    tuning = FINE_POINTER_TUNING,
  } = options;
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
    onSelectionIntent,
    isContextMenuOpen,
    registerPointerIntentRefresh: onPointerRefresh
      ? (refresh) => {
          onPointerRefresh(refresh);
          return () => {};
        }
      : undefined,
    openTerminusConnectionChoice,
    tuning,
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
  it('preloads selection details on a Select-tool press, not an unrelated drawing press', () => {
    installBrowserGlobals();
    const store = createEditorStore();
    const map = createMap(stopFeature('stop'));
    const onSelectionIntent = vi.fn();
    const detach = attach(map, store, { onSelectionIntent });

    store.commands.tools.setTool('select');
    map.fire('mousedown', mouseEvent(map, { x: 100, y: 100 }));
    store.commands.tools.setTool('stop');
    map.fire('mousedown', mouseEvent(map, { x: 100, y: 100 }));

    expect(onSelectionIntent).toHaveBeenCalledOnce();
    detach();
  });

  it('queries the rendered hit stack once for one pointer event', () => {
    installBrowserGlobals();
    const store = createEditorStore();
    store.commands.tools.setTool('select');
    const map = createMap(stopFeature('stop'));
    const detach = attach(map, store);

    map.fire('mousedown', mouseEvent(map, { x: 100, y: 100 }));

    expect(map.renderedFeatureQueryCount()).toBe(1);
    detach();
  });

  it('projects each rendered segment once when one press classifies and dispatches it', () => {
    installBrowserGlobals();
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [erasableWay()];
    system.services = [
      {
        id: 'service',
        name: 'Service',
        modeId: 'bus',

        path: { id: 'service', sections: [{ kind: 'shared', legs: [wholeLeg('erasable')] }] },
      },
    ];
    store.commands.document.setSystem(system);
    const map = createMap([
      serviceFeatureFor('far', [
        [-115.25, 36.1005],
        [-115.2, 36.1005],
      ]),
      serviceFeatureFor('service', [
        [-115.25, 36.1],
        [-115.2, 36.1],
      ]),
    ]);
    const detach = attach(map, store, {
      networkMode: false,
    });
    const event = mouseEvent(map, { x: 700, y: 1000 }, { shiftKey: true });
    map.resetProjectedCoordinateCount();

    map.fire('mousedown', event);

    expect(map.projectedCoordinateCount()).toBe(4);
    expect(store.getState().multiSelection).toEqual([{ kind: 'service', id: 'service' }]);
    detach();
  });

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

        path: { id: 'service', sections: [{ kind: 'shared', legs: [wholeLeg('trunk')] }] },
      },
    ];
    store.commands.document.setSystem(system);
    store.commands.selection.select({ kind: 'service', id: 'service' });
    store.commands.selection.setActivePattern('service');
    const map = createMap(terminusFeature('service', 'end', [-115.23, 36.1]));
    const shown: Array<PointerIntent | null> = [];
    const detach = attach(map, store, {
      onPointerIntent: (intent) => shown.push(intent),
    });

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
    expect(store.getState().system.services[0].path.sections).toHaveLength(2);
    store.commands.history.undo();
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

        path: {
          id: 'service',
          sections: [{ kind: 'shared', legs: [wholeLeg('a-b'), wholeLeg('b-c')] }],
        },
      },
    ];
    store.commands.document.setSystem(system);
    store.commands.selection.select({ kind: 'service', id: 'service' });
    const position = {
      patternId: 'service',
      run: 'outbound' as const,
      legIndex: 1,
      wayId: 'b-c',
      t: 1,
      distanceMeters: 1,
    };
    store.commands.selection.armTerminus({
      serviceId: 'service',
      patternId: 'service',
      side: 'end',
      position,
    });
    const map = createMap(terminusFeature('service', 'end', [-115.21, 36.1]));
    const shown: Array<PointerIntent | null> = [];
    const detach = attach(map, store, {
      onPointerIntent: (intent) => shown.push(intent),
    });

    map.fire('mousemove', mouseEvent(map, map.project([-115.21, 36.1])));
    scheduler.pump();
    expect(shown.at(-1)).toMatchObject({
      primaryOperation: 'draw-inbound-side',
      badge: 'one-way-return',
    });
    expect(store.getState().tool).toBe('select');

    map.fire('mousedown', mouseEvent(map, map.project([-115.21, 36.1])));
    map.setFeatures(
      serviceOccurrenceFeature('service', 'service', 'a-b', 0, [
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
    expect(store.getState().system.services[0].path.sections).toMatchObject([
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
    const pattern = aPattern('service', ways, ['a-b', 'b-c']);
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
    store.commands.document.setSystem(system);
    store.commands.selection.select({ kind: 'service', id: 'service' });
    const map = createMap(terminusFeature('service', 'end', c));
    const shown: Array<PointerIntent | null> = [];
    const detach = attach(map, store, {
      onPointerIntent: (intent) => shown.push(intent),
    });

    map.fire('mousedown', mouseEvent(map, map.project(c)));
    map.setFeatures(serviceOccurrenceFeature('service', 'service', 'a-b', 0, [a, b]));
    map.fire('mousemove', mouseEvent(map, map.project(b)));
    scheduler.pump();

    expect(shown.at(-1)).toMatchObject({
      primaryOperation: 'close-directional-loop',
      badge: 'loop',
      anchor: 'target',
    });
    map.fire('mouseup', mouseEvent(map, map.project(b)));
    expect(store.getState().system.services[0].path.sections).toMatchObject([
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

        path: { id: 'service', sections: [{ kind: 'shared', legs: [wholeLeg('erasable')] }] },
      },
    ];
    store.commands.document.setSystem(system);
    store.commands.selection.armTerminus({
      serviceId: 'service',
      patternId: 'service',
      side: 'end',
      position: {
        patternId: 'service',
        run: 'outbound',
        legIndex: 0,
        wayId: 'erasable',
        t: 1,
        distanceMeters: 1,
      },
    });
    const map = createMap(terminusFeature('service', 'end', [-115.2, 36.1]));
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

        path: { id: 'service', sections: [{ kind: 'shared', legs: [wholeLeg('erasable')] }] },
      },
    ];
    store.commands.document.setSystem(system);
    store.commands.selection.armTerminus({
      serviceId: 'service',
      patternId: 'service',
      side: 'end',
      position: {
        patternId: 'service',
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

        path: { id: 'service', sections: [{ kind: 'shared', legs: [wholeLeg('first')] }] },
      },
      {
        id: 'target',
        name: 'Target',
        modeId: 'bus',

        path: { id: 'target', sections: [{ kind: 'shared', legs: [wholeLeg('second')] }] },
      },
    ];
    store.commands.document.setSystem(system);
    store.commands.selection.select({ kind: 'service', id: 'service' });
    const sourceTerminus = terminusFeature('service', 'end', [-115.23, 36.1]);
    const targetTerminus = terminusFeature('target', 'start', [-115.23, 36.1]);
    targetTerminus.properties = {
      ...targetTerminus.properties,
      serviceId: 'target',
      modeId: 'bus',
    };
    const map = createMap(sourceTerminus);
    let chooser:
      | Parameters<NonNullable<AttachInteractionsOptions['openTerminusConnectionChoice']>>[0]
      | undefined;
    const detach = attach(map, store, {
      openTerminusConnectionChoice: (next) => {
        chooser = next;
      },
    });

    map.fire('mousedown', mouseEvent(map, map.project([-115.23, 36.1])));
    map.setFeatures(targetTerminus);
    map.fire('mousemove', mouseEvent(map, map.project([-115.23, 36.1])));
    scheduler.pump();
    map.fire('mouseup', mouseEvent(map, map.project([-115.23, 36.1])));

    expect(chooser).toBeDefined();
    expect(store.getState().system).toBe(system);
    expect(store.getState().canUndo).toBe(false);

    if (!chooser) throw new Error('Expected terminus connection chooser');
    chooser.connectPaths();
    expect(store.getState().system.services).toHaveLength(2);
    expect(store.getState().system.nodes).toHaveLength(1);
    store.commands.history.undo();
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

        path: { id: 'service', sections: [{ kind: 'shared', legs: [wholeLeg('road')] }] },
      },
      {
        id: 'rail-service',
        name: 'Rail',
        modeId: 'subway',

        path: { id: 'rail-service', sections: [{ kind: 'shared', legs: [wholeLeg('rail')] }] },
      },
    ];
    store.commands.document.setSystem(system);
    store.commands.selection.select({ kind: 'service', id: 'service' });
    const sourceTerminus = terminusFeature('service', 'end', [-115.23, 36.1]);
    const targetTerminus = terminusFeature('rail-service', 'start', [-115.23, 36.1]);
    targetTerminus.properties = {
      ...targetTerminus.properties,
      serviceId: 'rail-service',
      modeId: 'subway',
    };
    const map = createMap(sourceTerminus);
    const shown: Array<PointerIntent | null> = [];
    const detach = attach(map, store, {
      onPointerIntent: (intent) => shown.push(intent),
    });

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
    store.commands.document.setSystem(system);
    const map = createMap(handleFeature(2));
    const detach = attach(map, store, {
      networkMode: false,
    });

    map.fire('mousedown', mouseEvent(map, { x: 100, y: 100 }, { ctrlKey: true }));

    expect(store.getState().system.ways).toHaveLength(2);
    detach();
  });

  it('starts a Shift-constrained control-point drag instead of extending selection', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [erasableWay()];
    store.commands.document.setSystem(system);
    const map = createMap(handleFeature(1));
    const detach = attach(map, store, {
      networkMode: false,
    });

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
    store.commands.document.setSystem(system);
    const map = createMap(handleFeature(1));
    const shown: Array<PointerIntent | null> = [];
    const detach = attach(map, store, {
      onPointerIntent: (intent) => shown.push(intent),
      networkMode: false,
    });

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
    store.commands.document.setSystem(system);
    store.commands.tools.setTool('way');
    const map = createMap([serviceFeature('erasable'), wayFeature('erasable')]);
    const shown: Array<PointerIntent | null> = [];
    const detach = attach(map, store, {
      onPointerIntent: (intent) => shown.push(intent),
    });

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
    store.commands.document.setSystem(system);
    store.commands.tools.setTool('way');
    const map = createMap(wayFeature('erasable'));
    const shown: Array<PointerIntent | null> = [];
    const detach = attach(map, store, {
      onPointerIntent: (intent) => shown.push(intent),
    });
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
    store.commands.document.setSystem(system);
    store.commands.tools.setTool('way');
    store.commands.routing.startRouteDraft({
      wayId: 'erasable',
      insertIndex: 1,
      coord: [-115.24, 36.1],
    });
    const map = createMap(wayFeature('erasable'));
    const shown: Array<PointerIntent | null> = [];
    const detach = attach(map, store, {
      onPointerIntent: (intent) => shown.push(intent),
    });
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
    store.commands.document.setSystem(system);
    store.commands.tools.setTool('way');
    store.commands.routing.startRouteDraft({
      wayId: 'erasable',
      insertIndex: 1,
      coord: [-115.24, 36.1],
    });
    const map = createMap(wayFeature('erasable'));
    const shown: Array<PointerIntent | null> = [];
    const detach = attach(map, store, {
      onPointerIntent: (intent) => shown.push(intent),
    });
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

  it('starts an existing Network stop drag instead of panning the map', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const stopId = required(store.commands.stops.addStop([-115.2, 36.1]));
    const map = createMap(stopFeature(stopId));
    const lifecycle: string[] = [];
    const detach = attach(map, store, {
      gesture: {
        onStart: (targets) => lifecycle.push(`edit:${targets.stopIds?.[0]}`),
        onEnd() {},
      },
      directManipulation: { onStart: () => lifecycle.push('direct'), onEnd() {} },
    });

    map.fire('mousedown', mouseEvent(map, { x: 100, y: 100 }));
    map.fire('mousemove', mouseEvent(map, { x: 140, y: 100 }));
    scheduler.pump();

    expect(lifecycle).toEqual(['direct', `edit:${stopId}`]);
    expect(map.panCalls).toEqual([]);
    detach();
  });

  it('lets a settling stop preview start the next drag immediately', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const stopId = required(store.commands.stops.addStop([-115.2, 36.1]));
    const map = createMap(settlingStopFeature(stopId));
    const lifecycle: string[] = [];
    const detach = attach(map, store, {
      gesture: {
        onStart: (targets) => lifecycle.push(`edit:${targets.stopIds?.[0]}`),
        onEnd() {},
      },
      directManipulation: { onStart: () => lifecycle.push('direct'), onEnd() {} },
    });

    map.fire('mousedown', mouseEvent(map, { x: 100, y: 100 }));
    map.fire('mousemove', mouseEvent(map, { x: 140, y: 100 }));
    scheduler.pump();

    expect(lifecycle).toEqual(['direct', `edit:${stopId}`]);
    expect(map.panCalls).toEqual([]);
    detach();
  });

  it('starts an existing Network facility drag instead of panning the map', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const facilityId = required(store.commands.facilities.addFacility('entrance', [-115.2, 36.1]));
    const map = createMap(facilityFeature(facilityId));
    const lifecycle: string[] = [];
    const detach = attach(map, store, {
      gesture: {
        onStart: (targets) => lifecycle.push(`edit:${targets.facilityIds?.[0]}`),
        onEnd() {},
      },
      directManipulation: { onStart: () => lifecycle.push('direct'), onEnd() {} },
    });

    map.fire('mousedown', mouseEvent(map, { x: 100, y: 100 }));
    map.fire('mousemove', mouseEvent(map, { x: 140, y: 100 }));
    scheduler.pump();

    expect(lifecycle).toEqual(['direct', `edit:${facilityId}`]);
    expect(map.panCalls).toEqual([]);
    detach();
  });

  it('publishes erase and deletes an Alt-clicked Network stop', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const stopId = required(store.commands.stops.addStop([-115.2, 36.1]));
    const map = createMap(stopFeature(stopId));
    const shown: Array<PointerIntent | null> = [];
    const detach = attach(map, store, {
      onPointerIntent: (intent) => shown.push(intent),
    });

    map.fire('mousemove', mouseEvent(map, { x: 100, y: 100 }, { altKey: true }));
    scheduler.pump();
    expect(shown.at(-1)).toMatchObject({
      primaryOperation: 'delete-stop',
      cursor: 'grab',
      badge: 'erase',
      anchor: 'target',
    });

    map.fire('mousedown', mouseEvent(map, { x: 100, y: 100 }, { altKey: true }));
    expect(store.getState().system.stops).toHaveLength(0);
    expect(map.panCalls).toEqual([]);
    detach();
  });

  it('reaches the same erase through the Select variant with no key held', () => {
    // The equivalence the channel rename exists for. A touchscreen cannot
    // hold Alt, so the Select tool's Erase variant supplies the same channel;
    // the published intent and the dispatch must both be identical to the
    // Alt-click above, which fires the same events WITHOUT altKey.
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const stopId = required(store.commands.stops.addStop([-115.2, 36.1]));
    store.commands.tools.setSelectVariant('erase');
    const map = createMap(stopFeature(stopId));
    const shown: Array<PointerIntent | null> = [];
    const detach = attach(map, store, {
      onPointerIntent: (intent) => shown.push(intent),
    });

    map.fire('mousemove', mouseEvent(map, { x: 100, y: 100 }));
    scheduler.pump();
    expect(shown.at(-1)).toMatchObject({
      primaryOperation: 'delete-stop',
      cursor: 'grab',
      badge: 'erase',
      anchor: 'target',
    });

    map.fire('mousedown', mouseEvent(map, { x: 100, y: 100 }));
    expect(store.getState().system.stops).toHaveLength(0);
    expect(map.panCalls).toEqual([]);
    detach();
  });

  it('erases by finger with the Erase variant picked', () => {
    // End to end: no keyboard, no mouse, and the tap still deletes.
    vi.useFakeTimers();
    installBrowserGlobals();
    const store = createEditorStore();
    const stopId = required(store.commands.stops.addStop([-115.2, 36.1]));
    store.commands.tools.setSelectVariant('erase');
    const map = createMap(stopFeature(stopId));
    const detach = attach(map, store);

    tap(map, { x: 100, y: 100 });

    expect(store.getState().system.stops).toHaveLength(0);
    detach();
    vi.useRealTimers();
  });

  it('publishes erase and deletes an Alt-clicked Network facility', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const facilityId = required(store.commands.facilities.addFacility('entrance', [-115.2, 36.1]));
    const map = createMap(facilityFeature(facilityId));
    const shown: Array<PointerIntent | null> = [];
    const detach = attach(map, store, {
      onPointerIntent: (intent) => shown.push(intent),
    });

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

  it('keeps Shift-click on a Network stop as multi-selection instead of a drag', () => {
    installBrowserGlobals();
    const store = createEditorStore();
    const stopId = required(store.commands.stops.addStop([-115.2, 36.1]));
    const map = createMap(stopFeature(stopId));
    const detach = attach(map, store);

    map.fire('mousedown', mouseEvent(map, { x: 100, y: 100 }, { shiftKey: true }));

    expect(store.getState().multiSelection).toEqual([{ kind: 'stop', id: stopId }]);
    expect(map.panCalls).toEqual([]);
    detach();
  });

  it('drags all selected Network items when starting from a stop', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const stopId = required(store.commands.stops.addStop([-115.2, 36.1]));
    const facilityId = required(store.commands.facilities.addFacility('entrance', [-115.21, 36.1]));
    store.commands.selection.addMultiSelection([
      { kind: 'stop', id: stopId },
      { kind: 'facility', id: facilityId },
    ]);
    const originalFacility = structuredClone(
      store.getState().system.facilities.find((facility) => facility.id === facilityId)?.geometry,
    );
    const map = createMap(stopFeature(stopId));
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
    const stopId = required(store.commands.stops.addStop([-115.21, 36.1]));
    const facilityId = required(store.commands.facilities.addFacility('entrance', [-115.2, 36.1]));
    store.commands.selection.addMultiSelection([
      { kind: 'stop', id: stopId },
      { kind: 'facility', id: facilityId },
    ]);
    const originalStop = structuredClone(
      store.getState().system.stops.find((stop) => stop.id === stopId)?.coord,
    );
    const map = createMap(facilityFeature(facilityId));
    const detach = attach(map, store);

    map.fire('mousedown', mouseEvent(map, { x: 100, y: 100 }));
    map.fire('mousemove', mouseEvent(map, { x: 140, y: 100 }));
    scheduler.pump();

    expect(store.getState().system.stops.find((stop) => stop.id === stopId)?.coord).not.toEqual(
      originalStop,
    );
    expect(map.panCalls).toEqual([]);
    detach();
  });

  it('treats an incompatible raw corridor as a new service draw and does not route it', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [{ ...erasableWay(), typeId: 'heavyRail' }];
    store.commands.document.setSystem(system);
    store.commands.tools.setTool('way');
    const map = createMap(wayFeature('erasable'));
    const shown: Array<PointerIntent | null> = [];
    const detach = attach(map, store, {
      onPointerIntent: (intent) => shown.push(intent),
    });

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
    store.commands.document.setSystem(system);
    store.commands.tools.setTool('way');
    const map = createMap(wayFeature('erasable'));
    const shown: Array<PointerIntent | null> = [];
    const detach = attach(map, store, {
      onPointerIntent: (intent) => shown.push(intent),
    });

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
    store.commands.document.setSystem(system);
    store.commands.tools.setTool('way');
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
    store.commands.document.setSystem(system);
    const map = createMap(wayFeature('erasable'));
    const lifecycle: string[] = [];
    const detach = attach(map, store, {
      directManipulation: {
        onStart: () => lifecycle.push('start'),
        onEnd: () => lifecycle.push('end'),
      },
    });

    map.fire('mousedown', mouseEvent(map, { x: 700, y: 1000 }));
    expect(lifecycle).toEqual([]);
    map.fire('click', mouseEvent(map, { x: 700, y: 1000 }));
    expect(store.getState().selection).toEqual({ kind: 'way', id: 'erasable' });
    detach();
  });

  it('selects the public Line first and descends to its Service on a second click', () => {
    installBrowserGlobals();
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [erasableWay()];
    system.services = [
      {
        id: 'service',
        name: 'Service',
        modeId: 'bus',

        path: {
          id: 'service',
          sections: [{ kind: 'shared', legs: [wholeLeg('erasable')] }],
        },
      },
    ];
    system.lines = [
      { id: 'public-line', name: 'Public Line', color: '#e5252a', serviceIds: ['service'] },
    ];
    store.commands.document.setSystem(system);
    const before = store.getState().system;
    const map = createMap(serviceFeature('erasable'));
    const detach = attach(map, store);

    map.fire('click', mouseEvent(map, map.project([-115.23, 36.1])));

    expect(store.getState().system).toEqual(before);
    expect(store.getState().selection).toEqual({ kind: 'line', id: 'public-line' });

    map.fire('click', mouseEvent(map, map.project([-115.23, 36.1])));

    expect(store.getState().selection).toEqual({ kind: 'service', id: 'service' });
    expect(store.getState().activePatternId).toBe('service');
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

        path: { id: 'service', sections: [{ kind: 'shared', legs: [wholeLeg('erasable')] }] },
      },
    ];
    store.commands.document.setSystem(system);
    const map = createMap([
      serviceFeatureFor('far', [
        [-115.25, 36.11],
        [-115.2, 36.11],
      ]),
      serviceFeatureFor('service', [
        [-115.25, 36.1],
        [-115.2, 36.1],
      ]),
    ]);
    const detach = attach(map, store);

    map.fire('click', mouseEvent(map, map.project([-115.23, 36.1002])));

    expect(store.getState().activePatternId).toBe('service');
    detach();
  });

  it('keeps point-layer priority over a geometrically nearer line', () => {
    installBrowserGlobals();
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [erasableWay()];
    system.services = [
      {
        id: 'service',
        name: 'Service',
        modeId: 'bus',

        path: { id: 'service', sections: [{ kind: 'shared', legs: [wholeLeg('erasable')] }] },
      },
    ];
    store.commands.document.setSystem(system);
    const stopId = required(store.commands.stops.addStop([-115.23, 36.1008]));
    const map = createMap([serviceFeature('erasable'), stopFeature(stopId, [-115.23, 36.1008])]);
    const detach = attach(map, store);

    map.fire('click', mouseEvent(map, map.project([-115.23, 36.1])));

    expect(store.getState().selection).toEqual({ kind: 'stop', id: stopId });
    detach();
  });

  it('keeps the first rendered line when same-layer distances tie', () => {
    installBrowserGlobals();
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [erasableWay()];
    system.services = [
      {
        id: 'service',
        name: 'Service',
        modeId: 'bus',

        path: { id: 'service', sections: [{ kind: 'shared', legs: [wholeLeg('erasable')] }] },
      },
    ];
    store.commands.document.setSystem(system);
    const coordinates: [number, number][] = [
      [-115.25, 36.1],
      [-115.2, 36.1],
    ];
    const map = createMap([
      serviceFeatureFor('service', coordinates),
      serviceFeatureFor('second', coordinates),
    ]);
    const detach = attach(map, store);

    map.fire('click', mouseEvent(map, map.project([-115.23, 36.1])));

    expect(store.getState().activePatternId).toBe('service');
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

        path: { id: 'service', sections: [{ kind: 'shared', legs: [wholeLeg('erasable')] }] },
      },
    ];
    store.commands.document.setSystem(system);
    const at: [number, number] = [-115.23, 36.1];
    const map = createMap([
      terminusFeature('service', 'end', at),
      serviceFeature('erasable'),
      wayFeature('erasable'),
    ]);
    const opened: unknown[] = [];
    const detach = attach(map, store, {
      contextMenu: {
        open: (_x, _y, anchor, serviceHit) => opened.push({ anchor, serviceHit }),
        setAnchor() {},
      },
    });
    const right = mouseEvent(map, map.project(at));
    right.originalEvent.button = 2;
    map.fire('mousedown', right);
    map.fire('mouseup', right);

    expect(opened).toMatchObject([
      { anchor: at, serviceHit: { terminusSide: 'end', patternId: 'service', position: { t: 1 } } },
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

      path: { id, sections: [{ kind: 'shared', legs: [wholeLeg('erasable')] }] },
    }));
    store.commands.document.setSystem(system);
    store.commands.selection.addMultiSelection([
      { kind: 'service', id: 'service' },
      { kind: 'service', id: 'other' },
    ]);
    const at: [number, number] = [-115.23, 36.1];
    const map = createMap([terminusFeature('service', 'end', at), serviceFeature('erasable')]);
    const opened: Array<{ serviceHit?: ServiceActionHit }> = [];
    const detach = attach(map, store, {
      contextMenu: {
        open: (_x, _y, _anchor, serviceHit) => opened.push({ serviceHit }),
        setAnchor() {},
      },
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
    store.commands.document.setSystem(system);
    const map = createMap(wayFeature('erasable'));
    const shown: Array<PointerIntent | null> = [];
    let menuOpen = false;
    let refresh: (() => void) | undefined;
    const detach = attach(map, store, {
      onPointerIntent: (intent) => shown.push(intent),
      isContextMenuOpen: () => menuOpen,
      onPointerRefresh: (registered) => {
        refresh = registered;
      },
    });
    map.fire('mousemove', mouseEvent(map, map.project([-115.23, 36.1])));
    scheduler.pump();
    expect(shown.at(-1)).toMatchObject({ primaryOperation: 'select-line-and-branch' });

    menuOpen = true;
    if (!refresh) throw new Error('expected a pointer intent refresh callback');
    refresh();
    expect(shown.at(-1)).toBeNull();
    menuOpen = false;
    refresh();
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

        path: { id: 'service', sections: [{ kind: 'shared', legs: [wholeLeg('erasable')] }] },
      },
    ];
    store.commands.document.setSystem(system);
    const map = createMap(serviceFeature('erasable'));
    const opened: Array<{ anchor: [number, number]; serviceHit?: ServiceActionHit }> = [];
    const detach = attach(map, store, {
      contextMenu: {
        open: (_x, _y, anchor, serviceHit) => opened.push({ anchor, serviceHit }),
        setAnchor() {},
      },
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
    const leg = store.getState().system.services[0].path.sections[0];
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
    store.commands.document.setSystem(system);
    const map = createMap(wayFeature('erasable'));
    const opened: Array<{ anchor: [number, number]; corridorHit?: { wayId: string; t: number } }> =
      [];
    const detach = attach(map, store, {
      contextMenu: {
        open: (_x, _y, anchor, _serviceHit, corridorHit) => {
          opened.push({ anchor, corridorHit });
        },
        setAnchor() {},
      },
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

        path: {
          id: 'service',
          sections: [{ kind: 'shared', legs: [wholeLeg('erasable')] }],
        },
      },
    ];
    store.commands.document.setSystem(system);
    const map = createMap(serviceFeature('erasable'));
    const anchors: Array<[number, number] | null> = [];
    const opened: unknown[] = [];
    const closed: string[] = [];
    const detach = attach(map, store, {
      contextMenu: {
        open: (_x, _y, at, serviceHit) => opened.push({ at, serviceHit }),
        setAnchor: (at) => anchors.push(at),
        close: () => closed.push('close'),
      },
    });
    const point = map.project([-115.23, 36.1]);
    const right = mouseEvent(map, point);
    right.originalEvent.button = 2;
    map.fire('mousedown', right);
    map.fire('mouseup', right);

    expect(opened).toMatchObject([
      {
        at: [-115.23, 36.1],
        serviceHit: { serviceId: 'service', patternId: 'service', run: 'outbound', legIndex: 0 },
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
    store.commands.document.setSystem(system);
    const map = createMap(handleFeature(1));
    const shown: Array<PointerIntent | null> = [];
    const detach = attach(map, store, {
      onPointerIntent: (intent) => shown.push(intent),
      networkMode: false,
    });

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
    store.commands.document.setSystem(createEmptySystem());
    store.commands.tools.setTool('way');
    const map = createMap();
    const shown: Array<PointerIntent | null> = [];
    const detach = attach(map, store, {
      onPointerIntent: (intent) => shown.push(intent),
    });

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
    store.commands.document.setSystem(system);
    const map = createMap(handleFeature(1));
    const detach = attach(map, store, {
      networkMode: false,
    });

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
    store.commands.document.setSystem(system);
    const map = createMap(handleFeature(1));
    const detach = attach(map, store, {
      networkMode: false,
    });

    map.fire('mousemove', mouseEvent(map, { x: 100, y: 100 }));
    scheduler.pump();
    store.commands.document.setSystem(store.getState().system, { readOnly: true });

    expect(map.getCanvas().style.cursor).toBe('not-allowed');
    detach();
  });

  it('clears and gates stationary intent while the action menu is open', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [erasableWay()];
    store.commands.document.setSystem(system);
    const map = createMap(handleFeature(1));
    const shown: Array<PointerIntent | null> = [];
    let menuOpen = false;
    const detach = attach(map, store, {
      onPointerIntent: (intent) => shown.push(intent),
      networkMode: false,
      isContextMenuOpen: () => menuOpen,
    });

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
    store.commands.document.setSystem(system);
    const map = createMap(handleFeature(1));
    const shown: Array<PointerIntent | null> = [];
    const detach = attach(map, store, {
      onPointerIntent: (intent) => shown.push(intent),
      networkMode: false,
    });

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
    store.commands.tools.setTool('way');
    expect(shown.at(-1)).toBeNull();

    store.commands.tools.setTool('select');
    map.fire('mousemove', mouseEvent(map, { x: 100, y: 100 }));
    scheduler.pump();
    store.commands.document.setSystem(store.getState().system, { readOnly: true });
    expect(shown.at(-1)).toBeNull();

    detach();
  });

  it('freehand drawing samples raw movement once per frame and keeps the release point', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    store.commands.document.setSystem(createEmptySystem());
    store.commands.tools.setTool('way');
    store.commands.tools.setDraftGeometry('freeform');
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

  it('starts a freehand draw at the fine threshold but not the coarse one', () => {
    // 6px: past the fine profile's 4px drag threshold, short of the coarse
    // profile's 10px. A fingertip wobbles about this much just resting on the
    // glass, so at the fine threshold a phone starts drawing a way whenever
    // someone means to tap. Same events, same map, only the tolerance differs.
    const move = 6;
    expect(FINE_POINTER_TUNING.dragPx).toBeLessThan(move);
    expect(COARSE_POINTER_TUNING.dragPx).toBeGreaterThan(move);

    const waysAfterNudge = (tuning: InputTuning): number => {
      const scheduler = installBrowserGlobals();
      const store = createEditorStore();
      store.commands.document.setSystem(createEmptySystem());
      store.commands.tools.setTool('way');
      store.commands.tools.setDraftGeometry('freeform');
      const map = createMap();
      const detach = attach(map, store, {
        tuning,
      });

      map.fire('mousedown', mouseEvent(map, { x: 100, y: 100 }));
      map.fire('mousemove', mouseEvent(map, { x: 100 + move, y: 100 }));
      scheduler.pump();
      const count = store.getState().system.ways.length;
      detach();
      return count;
    };

    expect(waysAfterNudge(FINE_POINTER_TUNING)).toBe(1);
    expect(waysAfterNudge(COARSE_POINTER_TUNING)).toBe(0);
  });

  it('erase hit-testing runs once per frame and includes the release position', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [erasableWay()];
    store.commands.document.setSystem(system);
    store.commands.tools.setTool('select');
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
    store.commands.document.setSystem(system);
    store.commands.tools.setTool('select');
    const map = createMap(handleFeature(1));
    const lifecycle: string[] = [];
    const detach = attach(map, store, {
      gesture: {
        onStart: (targets) =>
          lifecycle.push(
            `edit-start:${targets.wayPoints?.[0]?.wayId}:${targets.wayPoints?.[0]?.pointIndex}`,
          ),
        onEnd: () => lifecycle.push('edit-end'),
      },
      directManipulation: {
        onStart: () => lifecycle.push('direct-start'),
        onEnd: () => lifecycle.push('direct-end'),
      },
    });

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
    store.commands.document.setSystem(createEmptySystem());
    store.commands.tools.setTool('select');
    const map = createMap();
    const lifecycle: string[] = [];
    const detach = attach(map, store, {
      directManipulation: {
        onStart: () => lifecycle.push('start'),
        onEnd: () => lifecycle.push('end'),
      },
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

describe('touch gestures', () => {
  it('draws with one finger, using the tool rather than the camera', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    store.commands.document.setSystem(createEmptySystem());
    store.commands.tools.setTool('way');
    store.commands.tools.setDraftGeometry('freeform');
    const map = createMap();
    const detach = attach(map, store);

    map.fire('touchstart', touchEvent(map, [{ x: 100, y: 100 }]));
    map.fire('touchmove', touchEvent(map, [{ x: 160, y: 100 }]));
    scheduler.pump();
    map.fire('touchend', touchEvent(map, []));

    expect(store.getState().system.ways).toHaveLength(1);
    expect(map.panCalls).toEqual([]);
    detach();
  });

  it('reads the double-tap gap from the event, not the clock', () => {
    // Committing a tap runs a store mutation and a MapLibre repaint, and that
    // work blocks the main thread. Measured against Date.now(), two taps 80ms
    // apart came out 549ms apart and no double tap ever registered — lines
    // could not be finished by finger at all. The browser stamps each touch
    // with when it actually happened, which is the only interval a person
    // controls. These taps carry timestamps 90ms apart while the clock, under
    // fake timers, does not advance between them at all.
    vi.useFakeTimers();
    installBrowserGlobals();
    const store = createEditorStore();
    store.commands.document.setSystem(createEmptySystem());
    store.commands.tools.setTool('way');
    const map = createMap();
    const detach = attach(map, store);

    tap(map, { x: 100, y: 100 }, 1000);
    tap(map, { x: 200, y: 140 }, 2000);
    expect(store.getState().activeWayId).not.toBeNull();

    tap(map, { x: 260, y: 180 }, 3000);
    tap(map, { x: 260, y: 180 }, 3090);

    expect(store.getState().activeWayId).toBeNull();
    expect(store.getState().system.ways[0].points).toHaveLength(3);
    detach();
    vi.useRealTimers();
  });

  it('keeps two deliberate taps apart even when they are quick', () => {
    // The distance check, not the interval, is what prevents a fast pair of
    // real points from being read as a finish.
    vi.useFakeTimers();
    installBrowserGlobals();
    const store = createEditorStore();
    store.commands.document.setSystem(createEmptySystem());
    store.commands.tools.setTool('way');
    const map = createMap();
    const detach = attach(map, store);

    tap(map, { x: 100, y: 100 }, 1000);
    tap(map, { x: 200, y: 140 }, 1050);
    tap(map, { x: 300, y: 190 }, 1100);

    expect(store.getState().activeWayId).not.toBeNull();
    expect(store.getState().system.ways[0].points).toHaveLength(3);
    detach();
    vi.useRealTimers();
  });

  it('places one point per tap, not two', () => {
    // The regression this exists for. A browser already emits compatibility
    // mousedown/mouseup/click after a motionless touch, so an adapter that
    // synthesizes them too runs every tap twice. Confirmed live on a phone
    // profile before this was fixed: three taps produced four control points
    // and a double tap produced eight and never finished the line.
    vi.useFakeTimers();
    installBrowserGlobals();
    const store = createEditorStore();
    store.commands.document.setSystem(createEmptySystem());
    store.commands.tools.setTool('way');
    const map = createMap();
    const detach = attach(map, store);

    tap(map, { x: 100, y: 100 });
    tap(map, { x: 200, y: 140 });
    tap(map, { x: 260, y: 180 });

    expect(store.getState().system.ways).toHaveLength(1);
    expect(store.getState().system.ways[0].points).toHaveLength(3);
    detach();
    vi.useRealTimers();
  });

  it('ignores the compatibility tap that follows a long press', () => {
    // A motionless touch still produces compatibility mouse events after the
    // adapter has already driven the press. Without the guard, a long press
    // opens the action menu and then starts a draw underneath it.
    vi.useFakeTimers();
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    store.commands.document.setSystem(createEmptySystem());
    store.commands.tools.setTool('way');
    const map = createMap();
    const detach = attach(map, store);

    map.fire('touchstart', touchEvent(map, [{ x: 120, y: 140 }]));
    vi.advanceTimersByTime(600);
    scheduler.pump();
    map.fire('touchend', touchEvent(map, []));
    // The browser's compatibility tail, arriving after the gesture is over.
    map.fire('mousedown', mouseEvent(map, { x: 120, y: 140 }));
    map.fire('mouseup', mouseEvent(map, { x: 120, y: 140 }));
    map.fire('click', mouseEvent(map, { x: 120, y: 140 }));

    expect(store.getState().system.ways).toHaveLength(0);
    detach();
    vi.useRealTimers();
  });

  it('publishes the intent at touchstart, before the press commits', () => {
    // A mouse answers "what will this press do" from an idle hover. A finger
    // has no idle state, so the answer has to arrive inside the gesture,
    // while the press is still undecided and can be lifted.
    vi.useFakeTimers();
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    const stopId = required(store.commands.stops.addStop([-115.2, 36.1]));
    store.commands.tools.setSelectVariant('erase');
    const map = createMap(stopFeature(stopId));
    const shown: Array<PointerIntent | null> = [];
    const detach = attach(map, store, {
      onPointerIntent: (intent) => shown.push(intent),
    });

    map.fire('touchstart', touchEvent(map, [{ x: 100, y: 100 }]));
    scheduler.pump();

    expect(shown.at(-1)).toMatchObject({ primaryOperation: 'delete-stop', badge: 'erase' });
    detach();
    vi.useRealTimers();
  });

  it('pans with two fingers and draws nothing', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    store.commands.document.setSystem(createEmptySystem());
    store.commands.tools.setTool('way');
    store.commands.tools.setDraftGeometry('freeform');
    const map = createMap();
    const detach = attach(map, store);

    map.fire(
      'touchstart',
      touchEvent(map, [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
      ]),
    );
    map.fire(
      'touchmove',
      touchEvent(map, [
        { x: 140, y: 130 },
        { x: 240, y: 130 },
      ]),
    );
    scheduler.pump();
    map.fire('touchend', touchEvent(map, []));

    expect(map.panCalls.length).toBeGreaterThan(0);
    expect(store.getState().system.ways).toHaveLength(0);
    detach();
  });

  it('keeps a pinch a camera gesture when one finger lifts early', () => {
    // The regression this guards: latching at touchstart. If the gesture were
    // re-derived per event, lifting one finger mid-pinch would leave a single
    // touch dragging across the map and start drawing on it.
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    store.commands.document.setSystem(createEmptySystem());
    store.commands.tools.setTool('way');
    store.commands.tools.setDraftGeometry('freeform');
    const map = createMap();
    const detach = attach(map, store);

    map.fire(
      'touchstart',
      touchEvent(map, [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
      ]),
    );
    map.fire('touchmove', touchEvent(map, [{ x: 180, y: 160 }]));
    scheduler.pump();
    map.fire('touchend', touchEvent(map, []));

    expect(store.getState().system.ways).toHaveLength(0);
    detach();
  });

  it('holds a still finger below the drag threshold as a tap, not a draw', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    store.commands.document.setSystem(createEmptySystem());
    store.commands.tools.setTool('way');
    store.commands.tools.setDraftGeometry('freeform');
    const map = createMap();
    const detach = attach(map, store, {
      tuning: COARSE_POINTER_TUNING,
    });

    map.fire('touchstart', touchEvent(map, [{ x: 100, y: 100 }]));
    // 6px of finger tremor, inside the coarse profile's 10px threshold.
    map.fire('touchmove', touchEvent(map, [{ x: 106, y: 100 }]));
    scheduler.pump();

    expect(map.panCalls).toEqual([]);
    detach();
  });

  it('finishes a live draw on a long press, as right-click does', () => {
    // Long press is the whole right-button family in one gesture, so it
    // inherits startPan's release path: finish the draw, branch a one-way, or
    // open the action menu, whichever the state calls for.
    vi.useFakeTimers();
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    store.commands.document.setSystem(createEmptySystem());
    store.commands.tools.setTool('way');
    const map = createMap();
    const detach = attach(map, store);

    tap(map, { x: 100, y: 100 });
    tap(map, { x: 200, y: 140 });
    expect(store.getState().activeWayId).not.toBeNull();

    map.fire('touchstart', touchEvent(map, [{ x: 260, y: 180 }]));
    vi.advanceTimersByTime(600);
    scheduler.pump();
    map.fire('touchend', touchEvent(map, []));

    expect(store.getState().activeWayId).toBeNull();
    expect(store.getState().system.ways).toHaveLength(1);
    detach();
    vi.useRealTimers();
  });

  it('finishes a line on a double tap', () => {
    vi.useFakeTimers();
    installBrowserGlobals();
    const store = createEditorStore();
    store.commands.document.setSystem(createEmptySystem());
    store.commands.tools.setTool('way');
    const map = createMap();
    const detach = attach(map, store);

    tap(map, { x: 100, y: 100 });
    tap(map, { x: 200, y: 140 });
    expect(store.getState().activeWayId).not.toBeNull();

    // Two taps in the same spot inside the double-tap window.
    tap(map, { x: 260, y: 180 });
    tap(map, { x: 260, y: 180 });

    expect(store.getState().activeWayId).toBeNull();
    expect(store.getState().system.ways).toHaveLength(1);
    detach();
    vi.useRealTimers();
  });

  it('cancels a long press once the finger moves past the drag threshold', () => {
    vi.useFakeTimers();
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    store.commands.document.setSystem(createEmptySystem());
    store.commands.tools.setTool('select');
    const map = createMap();
    const opened: number[] = [];
    const detach = attach(map, store, {
      contextMenu: {
        open: (x) => opened.push(x),
        setAnchor() {},
        close() {},
      },
    });

    map.fire('touchstart', touchEvent(map, [{ x: 120, y: 140 }]));
    map.fire('touchmove', touchEvent(map, [{ x: 200, y: 140 }]));
    vi.advanceTimersByTime(600);
    scheduler.pump();
    map.fire('touchend', touchEvent(map, []));

    expect(opened).toEqual([]);
    detach();
    vi.useRealTimers();
  });
});

describe('closing a way back onto its own start', () => {
  it("shows the endpoint-hint ring over a way's own start vertex once it has 3 points", () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    store.commands.document.setSystem(createEmptySystem());
    store.commands.tools.setTool('way');
    const map = createMap();
    const detach = attach(map, store);

    tap(map, { x: 100, y: 100 });
    tap(map, { x: 300, y: 100 });
    tap(map, { x: 300, y: 300 });
    expect(store.getState().system.ways[0].points).toHaveLength(3);

    map.fire('mousemove', mouseEvent(map, { x: 100, y: 100 }));
    scheduler.pump();

    expect(map.sourceData.get(SRC_ENDPOINT_HINT)).toEqual({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Point',
            coordinates: (() => {
              const { lng, lat } = map.unproject({ x: 100, y: 100 });
              return [lng, lat];
            })(),
          },
        },
      ],
    });
    detach();
  });

  it('does not offer to close a loop with only 2 committed points', () => {
    const scheduler = installBrowserGlobals();
    const store = createEditorStore();
    store.commands.document.setSystem(createEmptySystem());
    store.commands.tools.setTool('way');
    const map = createMap();
    const detach = attach(map, store);

    tap(map, { x: 100, y: 100 });
    tap(map, { x: 300, y: 100 });
    expect(store.getState().system.ways[0].points).toHaveLength(2);

    map.fire('mousemove', mouseEvent(map, { x: 100, y: 100 }));
    scheduler.pump();

    expect(map.sourceData.get(SRC_ENDPOINT_HINT)).toEqual({
      type: 'FeatureCollection',
      features: [],
    });
    detach();
  });

  it("closes a ring by clicking back on a way's own start vertex, forming a real junction", () => {
    installBrowserGlobals();
    const store = createEditorStore();
    store.commands.document.setSystem(createEmptySystem());
    store.commands.tools.setTool('way');
    const map = createMap();
    const detach = attach(map, store);

    tap(map, { x: 100, y: 100 });
    tap(map, { x: 300, y: 100 });
    tap(map, { x: 300, y: 300 });
    tap(map, { x: 100, y: 100 }); // back onto the way's own start

    const wayId = store.getState().activeWayId!;
    const way = store.getState().system.ways.find((w) => w.id === wayId)!;
    expect(way.points).toHaveLength(4);
    expect(way.points[3]).toEqual(way.points[0]);
    expect(
      store.getState().activeWayId,
      'drawing continues after closing the loop, same as any other placed point',
    ).toBe(wayId);
    expect(
      store.getState().system.nodes.some((n) => {
        const refs = n.refs.filter((r) => r.wayId === wayId);
        return refs.some((r) => r.pointIndex === 0) && refs.some((r) => r.pointIndex === 3);
      }),
    ).toBe(true);
    detach();
  });
});

describe('corridor-following an incompatible-type way', () => {
  it('bends a rail line dragged close to and parallel with an existing road, offset from it', () => {
    installBrowserGlobals();
    const store = createEditorStore();
    store.commands.document.setSystem(
      aSystem({
        ways: [
          aRoad('road1', [
            [-115.3, 36.1],
            [-115.0, 36.1],
          ]),
        ],
      }),
    );
    // heavyRail can't merge with a road (disjoint wayTypeIds) — the exact-
    // type snap in resolveEnd can never match this candidate, so any bend
    // toward it has to be followCorridor's doing.
    store.commands.tools.setDraftWayType('heavyRail');
    store.commands.tools.setTool('way');
    const map = createMap();
    const detach = attach(map, store, { networkMode: false });

    // Three points a few meters south of, and running parallel to, road1 —
    // close enough and aligned enough for the third placement to trigger
    // corridor-following.
    tap(map, { x: 800, y: 1000.4 }); // seed
    tap(map, { x: 1000, y: 1000.4 });
    tap(map, { x: 1200, y: 1000.4 }); // corridor-follow should apply here

    const wayId = store.getState().activeWayId!;
    const way = store.getState().system.ways.find((w) => w.id === wayId)!;
    expect(way.points.length).toBeGreaterThanOrEqual(3);
    const placed = way.points[2];

    // road1 is a straight east-west line at lat 36.1 spanning this point's
    // longitude, so the nearest point on it is directly north — this is an
    // exact perpendicular-distance measure, not an approximation.
    const distToRoadM = haversineMeters([placed[0], 36.1], placed);
    expect(placed[1], 'stays on the same (south) side raw was dragged on').toBeLessThan(36.1);
    expect(
      distToRoadM,
      'offset well clear of the road, not landed on its centerline',
    ).toBeGreaterThan(7);
    expect(distToRoadM, 'not implausibly far from where the drag actually was').toBeLessThan(30);
    expect(placed[0], 'stays near where the drag actually was, longitude-wise').toBeCloseTo(
      -115.18,
      2,
    );

    store.commands.ways.finishWay();
    const after = store.getState().system;
    expect(
      after.ways.some((w) => w.id === wayId),
      'the rail line stays its own way',
    ).toBe(true);
    expect(
      after.services
        .flatMap((service) => patternLegs(service.path))
        .some((l) => l.wayId === 'road1'),
      'finishWay does not reabsorb it onto the road it was kept offset from',
    ).toBe(false);
    detach();
  });

  it('does not bend a line dragged nowhere near an existing way', () => {
    installBrowserGlobals();
    const store = createEditorStore();
    store.commands.document.setSystem(
      aSystem({
        ways: [
          aRoad('road1', [
            [-115.3, 36.1],
            [-115.0, 36.1],
          ]),
        ],
      }),
    );
    store.commands.tools.setDraftWayType('heavyRail');
    store.commands.tools.setTool('way');
    const map = createMap();
    const detach = attach(map, store, { networkMode: false });

    // Same shape as above, but ~110m south — well outside the follow radius.
    tap(map, { x: 800, y: 1100 });
    tap(map, { x: 1000, y: 1100 });
    tap(map, { x: 1200, y: 1100 });

    const wayId = store.getState().activeWayId!;
    const way = store.getState().system.ways.find((w) => w.id === wayId)!;
    const placed = way.points[2];
    const { lat } = map.unproject({ x: 1200, y: 1100 });
    expect(placed[1]).toBeCloseTo(lat, 6);
    detach();
  });

  it('does not bend a way toward another way of the SAME type', () => {
    installBrowserGlobals();
    const store = createEditorStore();
    store.commands.document.setSystem(
      aSystem({
        ways: [
          aRoad('road1', [
            [-115.3, 36.1],
            [-115.0, 36.1],
          ]),
        ],
      }),
    );
    store.commands.tools.setDraftWayType('road');
    store.commands.tools.setDraftMode('bus'); // corridorToleranceM unset -> 20m base
    store.commands.tools.setTool('way');
    const map = createMap();
    // A tighter zoom than the mock's default z14, matching real street-
    // editing zoom, where the exact-type snap's pixel-derived radius shrinks
    // below followCorridor's fixed-meters radius — the gap the bug lived in.
    map.getZoom = () => 18;
    const detach = attach(map, store, { networkMode: false });

    // ~15m south of, and parallel to, road1: past the exact-type snap's
    // tight radius (~8.7m at this zoom) but comfortably inside
    // followCorridor's wider one (base 20m * 1.75 = 35m) — road1 is the
    // SAME type as the draft, so followCorridor must leave this alone
    // rather than treat it as an incompatible corridor to hug. The mock
    // map's own project/unproject is a fixed 1px = 1/10000° scale
    // (independent of zoom), so this y is computed from that scale
    // directly, not from the zoom-dependent metersPerPixel() the app uses
    // for its own tolerance thresholds.
    tap(map, { x: 800, y: 1001.3475 });
    tap(map, { x: 1000, y: 1001.3475 });
    tap(map, { x: 1200, y: 1001.3475 });

    const wayId = store.getState().activeWayId!;
    const way = store.getState().system.ways.find((w) => w.id === wayId)!;
    const placed = way.points[2];
    const distToRoadM = haversineMeters([placed[0], 36.1], placed);
    expect(
      distToRoadM,
      "stays near the raw ~15m drag, not pulled out to followCorridor's ~23m offset",
    ).toBeLessThan(18);
    detach();
  });

  it('does not bend toward a corridor when the drag turns sharply away from the established heading', () => {
    installBrowserGlobals();
    const store = createEditorStore();
    store.commands.document.setSystem(
      aSystem({
        ways: [
          aRoad('road1', [
            [-115.3, 36.1],
            [-115.0, 36.1],
          ]),
        ],
      }),
    );
    store.commands.tools.setDraftWayType('heavyRail');
    store.commands.tools.setTool('way');
    const map = createMap();
    const detach = attach(map, store, { networkMode: false });

    // First two points establish an EAST heading, far south of road1 (well
    // outside any follow radius, so nothing bends yet). The third point then
    // turns sharply NORTH, landing a few meters south of road1 — close
    // enough to trigger corridor-following IF it (wrongly) judged the angle
    // against the way's already-committed EAST heading, which happens to be
    // parallel to road1. It must instead judge the angle against the LIVE
    // drag direction (north, perpendicular to road1) and reject.
    tap(map, { x: 1000, y: 1500 }); // seed
    tap(map, { x: 1500, y: 1500 }); // heading due east
    tap(map, { x: 1500, y: 1000.449 }); // sharp turn north, ~5m south of road1

    const wayId = store.getState().activeWayId!;
    const way = store.getState().system.ways.find((w) => w.id === wayId)!;
    const placed = way.points[2];
    const raw = map.unproject({ x: 1500, y: 1000.449 });
    expect(placed, 'lands at the raw cursor position, not bent sideways toward road1').toEqual([
      raw.lng,
      raw.lat,
    ]);
    detach();
  });
});
