// @vitest-environment jsdom
/**
 * What happens when a reader pans an embed off the camera it was saved at.
 *
 * A Line scene is clipped to the camera bounds it was resolved for, so the
 * network disappears the moment a reader leaves that frame unless the embed
 * asks for another one. `startEmbedMap` asks on `moveend` and on `resize`, and
 * it decides between replies by request order rather than arrival order: a
 * projection for a camera the reader has already left must not overwrite the
 * one they are looking at. Neither the asking nor the deciding had a test.
 *
 * This is the only file that drives `startEmbedMap` itself, and it cannot give
 * it a real map, because a MapLibre map wants WebGL. So the map is a stand-in
 * carrying exactly what the runtime asks of it, and the projection Worker is
 * one this file answers by hand, which is what makes reply order its to
 * choose. Everything between the two is the real runtime: its listeners, its
 * generation counter, and the source writes it makes. `tests/render/line-parity`
 * covers the scene those writes carry; this covers when they happen.
 */
import type { FeatureCollection } from 'geojson';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemFeatures } from '@transitmapper/core/render/buildFeatures';
import { aPattern, aRoad, aService, aSystem } from '@transitmapper/core/testing/fixtures';
import { emptySystemFeatures, SRC_SERVICES } from '@transitmapper/renderer/layers';
// The projection Worker protocol is not on the package's export map, and a
// hand-answered Worker has to speak it exactly.
import type {
  FeatureProjectionWorkerEvent,
  FeatureProjectionWorkerRequest,
} from '../../../../packages/renderer/src/workers/feature-projection-worker-protocol';
import type { EmbedContent } from '../../src/embed/embed-bootstrap';

interface CameraFrame {
  readonly southwest: readonly [number, number];
  readonly northeast: readonly [number, number];
  readonly zoom: number;
}

/** The frame the share was saved at, and two a reader could pan to. Every one
 *  of them is a different rectangle, so a scene resolved for one is visibly
 *  the wrong scene for another. */
const SAVED_FRAME: CameraFrame = {
  southwest: [-115.24, 36.12],
  northeast: [-115.14, 36.16],
  zoom: 12,
};
const PANNED_FRAME: CameraFrame = {
  southwest: [-115.34, 36.12],
  northeast: [-115.24, 36.16],
  zoom: 12,
};
const FARTHER_FRAME: CameraFrame = {
  southwest: [-115.44, 36.12],
  northeast: [-115.34, 36.16],
  zoom: 12,
};

type MapListener = (event?: unknown) => void;

class FakeEmbedSource {
  constructor(public data: FeatureCollection) {}

  setData(data: FeatureCollection): void {
    this.data = data;
  }
}

/**
 * The slice of MapLibre the embed runtime uses, and nothing else.
 *
 * It reports a camera the test moves, because the runtime reads the camera off
 * the map at the moment it projects rather than being handed one, and that
 * read is half of what is under test here.
 */
class FakeEmbedMap {
  readonly sources = new Map<string, FakeEmbedSource>();
  readonly touchZoomRotate = { disableRotation: () => {} };
  private readonly layerIds = new Set<string>();
  private readonly listeners = new Map<string, Set<MapListener>>();
  private frame: CameraFrame = SAVED_FRAME;

  constructor() {
    createdMaps.push(this);
  }

  /** One reader gesture: the camera lands somewhere new, and MapLibre says so
   *  once it settles. */
  settleAt(frame: CameraFrame): void {
    this.frame = frame;
    this.emit('moveend');
  }

  on(type: string, listener: MapListener): this {
    const listeners = this.listeners.get(type) ?? new Set<MapListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
    return this;
  }

  once(type: string, listener: MapListener): this {
    const wrapped: MapListener = (event) => {
      this.off(type, wrapped);
      listener(event);
    };
    return this.on(type, wrapped);
  }

  off(type: string, listener: MapListener): this {
    this.listeners.get(type)?.delete(listener);
    return this;
  }

  emit(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }

  addControl(): this {
    return this;
  }

  loaded(): boolean {
    return true;
  }

  resize(): void {}

  jumpTo(): void {}

  getBounds(): {
    getSouthWest(): { lng: number; lat: number };
    getNorthEast(): { lng: number; lat: number };
  } {
    const [westLng, southLat] = this.frame.southwest;
    const [eastLng, northLat] = this.frame.northeast;
    return {
      getSouthWest: () => ({ lng: westLng, lat: southLat }),
      getNorthEast: () => ({ lng: eastLng, lat: northLat }),
    };
  }

  getZoom(): number {
    return this.frame.zoom;
  }

  getCanvas(): { clientWidth: number; clientHeight: number } {
    return { clientWidth: 800, clientHeight: 500 };
  }

  getContainer(): { clientWidth: number; clientHeight: number } {
    return { clientWidth: 800, clientHeight: 500 };
  }

  getPixelRatio(): number {
    return 1;
  }

  /** Rasterizing a facility pictogram needs a canvas, and registration is
   *  skipped for an image the map already holds. Nothing here draws a symbol. */
  hasImage(): boolean {
    return true;
  }

  removeImage(): void {}

  getSource(id: string): FakeEmbedSource | undefined {
    return this.sources.get(id);
  }

  addSource(id: string, source: { data: FeatureCollection }): void {
    this.sources.set(id, new FakeEmbedSource(source.data));
  }

  getLayer(id: string): { id: string } | undefined {
    return this.layerIds.has(id) ? { id } : undefined;
  }

  addLayer(spec: { id: string }): void {
    this.layerIds.add(spec.id);
  }

  getStyle(): { version: number; sources: Record<string, never>; layers: never[] } {
    return { version: 8, sources: {}, layers: [] };
  }

  isSourceLoaded(): boolean {
    return true;
  }

  /** The runtime waits for a paint before it calls the system committed, and
   *  a repaint is the only thing that can end that wait. */
  triggerRepaint(): void {
    this.emit('render');
  }

  remove(): void {
    this.emit('remove');
  }
}

/** Holds every request instead of answering it, so a test decides both what
 *  each projection returns and the order the replies arrive in. */
class FakeProjectionWorker {
  onmessage: ((event: MessageEvent<FeatureProjectionWorkerEvent>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly requests: FeatureProjectionWorkerRequest[] = [];

  constructor() {
    createdWorkers.push(this);
  }

  postMessage(request: FeatureProjectionWorkerRequest): void {
    this.requests.push(request);
  }

  answer(index: number, label: string): void {
    if (index >= this.requests.length) {
      throw new Error(`The embed made no projection request ${index}.`);
    }
    const request = this.requests[index];
    this.onmessage?.({
      data: {
        kind: 'done',
        requestId: request.requestId,
        features: labelledScene(label),
        counts: null,
      },
    } as MessageEvent<FeatureProjectionWorkerEvent>);
  }

  terminate(): void {}
}

/** `addControl` here adds nothing, so the runtime only needs the constructor
 *  to exist and the control to answer the one call MapLibre would make. */
class FakeNavigationControl {
  onAdd(): HTMLElement {
    return document.createElement('div');
  }
}

class FakeResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const createdMaps: FakeEmbedMap[] = [];
const createdWorkers: FakeProjectionWorker[] = [];

// The factory runs when the runtime is imported, which this file defers to a
// dynamic import so these classes exist by then.
vi.mock('maplibre-gl', () => ({
  default: { Map: FakeEmbedMap, NavigationControl: FakeNavigationControl },
}));

/** A scene nothing but this test can have produced, so the source data names
 *  the projection that wrote it. */
function labelledScene(label: string): SystemFeatures {
  const features = emptySystemFeatures();
  features.services = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: `render:tm-services:line-stripe:${label}`,
        properties: { routeRole: 'stripe', lineId: 'route-109', label },
        geometry: {
          type: 'LineString',
          coordinates: [
            [-115.22, 36.14],
            [-115.16, 36.14],
          ],
        },
      },
    ],
  };
  return features;
}

/** Names whichever projection last wrote the service source. */
function paintedLabel(map: FakeEmbedMap): string | undefined {
  const features = map.getSource(SRC_SERVICES)?.data.features ?? [];
  if (features.length === 0) return undefined;
  const label: unknown = features[0].properties?.label;
  return typeof label === 'string' ? label : undefined;
}

function requestedBounds(request: FeatureProjectionWorkerRequest | undefined): unknown {
  if (request?.kind !== 'project') throw new Error('The embed asked for no projection.');
  return request.input.view.presentation.bounds;
}

function boundsOf(frame: CameraFrame): unknown {
  return { southwest: frame.southwest, northeast: frame.northeast };
}

function embedContent(): EmbedContent {
  const corridor = aRoad('resort-corridor', [
    [-115.22, 36.14],
    [-115.16, 36.14],
  ]);
  const plan = aService('weekday-plan', [aPattern('weekday-pattern', [corridor], [corridor.id])]);
  return {
    system: aSystem({ name: 'Parity Valley', ways: [corridor], services: [plan] }),
    title: 'Parity Valley',
    openPath: '/v/view-1',
    state: {
      schemaVersion: 1,
      camera: { center: [-115.19, 36.14], zoom: SAVED_FRAME.zoom },
      representationId: 'network',
      filters: { modes: ['bus'], 'way-types': ['road'] },
    },
  };
}

interface StartedEmbed {
  readonly map: FakeEmbedMap;
  readonly worker: FakeProjectionWorker;
}

/** Runs the embed up to the point a reader can pan it: one projection asked
 *  for, answered, and painted. */
async function startEmbed(): Promise<StartedEmbed> {
  const { startEmbedMap } = await import('../../src/embed/embed-map-runtime');
  const container = document.createElement('div');
  document.body.append(container);
  const started = startEmbedMap({
    reference: { kind: 'shared-system', id: 'share1' },
    container,
    content: Promise.resolve(embedContent()),
    milestones: {
      bootstrapStarted: () => undefined,
      shellMounted: () => undefined,
      mapStyleReady: () => undefined,
      systemCommitted: () => undefined,
      interactive: () => undefined,
    },
  });
  if (createdMaps.length !== 1 || createdWorkers.length !== 1) {
    throw new Error(
      `The embed built ${createdMaps.length} maps and ${createdWorkers.length} Workers.`,
    );
  }
  const [map] = createdMaps;
  const [worker] = createdWorkers;
  await vi.waitFor(() => expect(worker.requests).toHaveLength(1));
  worker.answer(0, 'saved-camera');
  await started;
  return { map, worker };
}

describe('an embed reprojects when its reader moves the camera', () => {
  beforeEach(() => {
    createdMaps.length = 0;
    createdWorkers.length = 0;
    vi.stubGlobal('Worker', FakeProjectionWorker);
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('paints the scene resolved for the camera the share was saved at', async () => {
    const { map, worker } = await startEmbed();

    expect(requestedBounds(worker.requests[0])).toEqual(boundsOf(SAVED_FRAME));
    expect(paintedLabel(map)).toBe('saved-camera');
  });

  it('asks for a new scene at the camera a settled pan left behind', async () => {
    const { map, worker } = await startEmbed();

    map.settleAt(PANNED_FRAME);

    await vi.waitFor(() => expect(worker.requests).toHaveLength(2));
    expect(requestedBounds(worker.requests[1])).toEqual(boundsOf(PANNED_FRAME));
  });

  it('asks for a new scene when the host page resizes the frame', async () => {
    const { map, worker } = await startEmbed();

    map.emit('resize');

    await vi.waitFor(() => expect(worker.requests).toHaveLength(2));
  });

  it('paints the scene the newer camera asked for', async () => {
    const { map, worker } = await startEmbed();

    map.settleAt(PANNED_FRAME);
    await vi.waitFor(() => expect(worker.requests).toHaveLength(2));
    worker.answer(1, 'panned-camera');

    await vi.waitFor(() => expect(paintedLabel(map)).toBe('panned-camera'));
  });

  it('keeps the newer scene when a superseded projection answers late', async () => {
    const { map, worker } = await startEmbed();

    map.settleAt(PANNED_FRAME);
    await vi.waitFor(() => expect(worker.requests).toHaveLength(2));
    map.settleAt(FARTHER_FRAME);
    await vi.waitFor(() => expect(worker.requests).toHaveLength(3));
    worker.answer(2, 'farther-camera');
    await vi.waitFor(() => expect(paintedLabel(map)).toBe('farther-camera'));

    worker.answer(1, 'panned-camera');

    // Two turns is what the reprojection's own `then` needs to run, so this
    // asserts the stale scene was refused rather than merely not arrived.
    await Promise.resolve();
    await Promise.resolve();
    expect(paintedLabel(map)).toBe('farther-camera');
  });
});
