import type { FeatureCollection } from 'geojson';
import type {
  GeoJSONSource,
  LayerSpecification,
  Map as MapLibreMap,
  MapEventType,
  MapSourceDataEvent,
  StyleSpecification,
} from 'maplibre-gl';
import { vi } from 'vitest';
import { aSystem } from '@transitmapper/core/testing/fixtures';
import { renderFeatureId, systemFeatureSourceId } from '@transitmapper/core/render/render-identity';
import { createMapViewStore, createSelectionController } from '@transitmapper/map';
import type {
  MapDriverAttachOptions,
  MapStartupMilestones,
  MapViewStore,
  SelectionController,
} from '@transitmapper/map';
import { emptySystemFeatures } from '../../src/system-feature-sources';
import type {
  DocumentMapSnapshot,
  DocumentMapSnapshotListener,
  DocumentMapSnapshotSource,
  DocumentMapScheduler,
} from '../../src/document-map-driver';
import type {
  FeatureProjectionClient,
  FeatureProjectionClientInput,
  FeatureProjectionResult,
} from '../../src/feature-projection-worker';

type MapListener = (event?: unknown) => void;

class TestGeoJsonSource {
  constructor(
    readonly id: string,
    private readonly map: TestDocumentMap,
  ) {}

  setData(_data: FeatureCollection): void {
    this.map.sourceOperations.push({ id: this.id, method: 'setData' });
    this.map.completeSource(this.id);
  }

  updateData(_data: unknown): void {
    this.map.sourceOperations.push({ id: this.id, method: 'updateData' });
    this.map.completeSource(this.id);
  }
}

export class TestDocumentMap {
  private readonly sources = new Map<string, TestGeoJsonSource>();
  private readonly layers = new Map<string, LayerSpecification>();
  private readonly listeners = new Map<string, Set<MapListener>>();
  readonly filters = new Map<string, unknown>();
  readonly sourceMutations: string[] = [];
  readonly sourceOperations: Array<{ id: string; method: 'setData' | 'updateData' }> = [];
  readonly layerAdds: string[] = [];
  readonly styleUpdates: Array<{
    style: StyleSpecification;
    options: { diff?: boolean; validate?: boolean } | undefined;
  }> = [];
  failNextSourceMutation = false;
  failNextOverlaySetup = false;
  private bounds = {
    southwest: [-116, 35] as [number, number],
    northeast: [-114, 37] as [number, number],
  };

  addSource(id: string): void {
    if (this.failNextOverlaySetup) {
      this.failNextOverlaySetup = false;
      throw new Error('Style is not done loading.');
    }
    if (!this.sources.has(id)) this.sources.set(id, new TestGeoJsonSource(id, this));
  }

  getSource(id: string): GeoJSONSource | undefined {
    return this.sources.get(id) as unknown as GeoJSONSource | undefined;
  }

  isSourceLoaded(id: string): boolean {
    return this.sourceMutations.includes(id);
  }

  addLayer(layer: LayerSpecification): void {
    this.layerAdds.push(layer.id);
    this.layers.set(layer.id, layer);
  }

  getStyle(): StyleSpecification {
    return {
      version: 8,
      sources: Object.fromEntries(
        [...this.sources.keys()].map((id) => [
          id,
          { type: 'geojson' as const, data: { type: 'FeatureCollection' as const, features: [] } },
        ]),
      ),
      layers: [...this.layers.values()],
    };
  }

  setStyle(style: StyleSpecification, options?: { diff?: boolean; validate?: boolean }): void {
    this.styleUpdates.push({ style, options });
    this.layers.clear();
    for (const layer of style.layers) this.layers.set(layer.id, layer);
  }

  getLayer(id: string): LayerSpecification | undefined {
    return this.layers.get(id);
  }

  setLayoutProperty(): void {}

  setPaintProperty(): void {}

  setFilter(id: string, filter: unknown): void {
    this.filters.set(id, filter);
  }

  triggerRepaint(): void {}

  getBounds() {
    return {
      getSouthWest: () => ({ lng: this.bounds.southwest[0], lat: this.bounds.southwest[1] }),
      getNorthEast: () => ({ lng: this.bounds.northeast[0], lat: this.bounds.northeast[1] }),
    };
  }

  setBounds(southwest: [number, number], northeast: [number, number]): void {
    this.bounds = { southwest, northeast };
  }

  getZoom(): number {
    return 10;
  }

  getPixelRatio(): number {
    return 1;
  }

  getCanvas(): Pick<HTMLCanvasElement, 'clientWidth' | 'clientHeight'> {
    return { clientWidth: 1_280, clientHeight: 720 };
  }

  getContainer(): Pick<HTMLElement, 'clientWidth' | 'clientHeight'> {
    return { clientWidth: 1_280, clientHeight: 720 };
  }

  on(type: keyof MapEventType, listener: MapListener): this {
    let listeners = this.listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener);
    return this;
  }

  off(type: keyof MapEventType, listener: MapListener): this {
    this.listeners.get(type)?.delete(listener);
    return this;
  }

  emit(type: string, event?: unknown): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }

  completeSource(id: string): void {
    if (this.failNextSourceMutation) {
      this.failNextSourceMutation = false;
      throw new Error('replacement projection failed');
    }
    this.sourceMutations.push(id);
    this.emit('sourcedata', { sourceId: id } satisfies Partial<MapSourceDataEvent>);
  }

  sourceCount(): number {
    return this.sources.size;
  }

  listenerCount(): number {
    let count = 0;
    for (const listeners of this.listeners.values()) count += listeners.size;
    return count;
  }

  replaceStyle(): void {
    this.sources.clear();
    this.layers.clear();
    this.sourceMutations.length = 0;
    this.sourceOperations.length = 0;
    this.emit('style.load');
  }
}

export class DocumentDriverClock implements DocumentMapScheduler {
  private nextHandle = 1;
  private nowMs = 0;
  readonly frames = new Map<number, () => void>();
  readonly timers = new Map<number, () => void>();

  now = (): number => this.nowMs;

  scheduleFrame = (callback: () => void): number => {
    const handle = this.nextHandle++;
    this.frames.set(handle, callback);
    return handle;
  };

  cancelFrame = (handle: number): void => {
    this.frames.delete(handle);
  };

  scheduleTimer = (callback: () => void): number => {
    const handle = this.nextHandle++;
    this.timers.set(handle, callback);
    return handle;
  };

  cancelTimer = (handle: number): void => {
    this.timers.delete(handle);
  };

  scheduleTask = this.scheduleFrame;
  cancelTask = this.cancelFrame;

  advanceBy(durationMs: number): void {
    this.nowMs += durationMs;
  }

  flushOne(map: TestDocumentMap): void {
    const entry = this.frames.entries().next();
    if (!entry.done) {
      const [handle, callback] = entry.value;
      this.frames.delete(handle);
      this.nowMs += 1;
      callback();
    }
    map.emit('render');
  }
}

export class TestDocumentSource implements DocumentMapSnapshotSource {
  private readonly listeners = new Set<DocumentMapSnapshotListener>();

  constructor(private snapshot: DocumentMapSnapshot) {}

  getSnapshot = (): DocumentMapSnapshot => this.snapshot;

  subscribe = (listener: DocumentMapSnapshotListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  publish(snapshot: DocumentMapSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

export function readySnapshot(system = aSystem()): DocumentMapSnapshot {
  return Object.freeze({ status: 'ready', system });
}

export function createProjectionWorker(
  implementation: (
    input: FeatureProjectionClientInput,
    signal?: AbortSignal,
  ) => Promise<FeatureProjectionResult> = () =>
    Promise.resolve({ features: emptySystemFeatures(), counts: null }),
): FeatureProjectionClient & {
  project: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
} {
  const project = vi.fn(implementation);
  const dispose = vi.fn();
  return { project, dispose };
}

export function projectedWayFeatures(id: string) {
  const features = emptySystemFeatures();
  features.ways = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: renderFeatureId(systemFeatureSourceId('ways'), 'overview', [id]),
        properties: { id },
        geometry: {
          type: 'LineString',
          coordinates: [
            [-115.2, 36.1],
            [-115.1, 36.2],
          ],
        },
      },
    ],
  };
  return features;
}

export function createAttachOptions(
  map: TestDocumentMap,
  milestones: string[],
  errors: unknown[],
  options: {
    signal?: AbortSignal;
    viewStore?: MapViewStore;
    selection?: SelectionController;
  } = {},
): MapDriverAttachOptions {
  const startup: MapStartupMilestones = {
    contentCommitted: () => milestones.push('content'),
    interactive: () => milestones.push('interactive'),
  };
  return {
    host: {
      map: map as unknown as MapLibreMap,
      reportError: (error) => errors.push(error),
    },
    viewStore:
      options.viewStore ??
      createMapViewStore({
        schemaVersion: 1,
        camera: { center: [-115.18, 36.14], zoom: 10 },
        representationId: 'network',
        filters: { modes: ['bus'], 'way-types': ['road'] },
      }),
    selection: options.selection ?? createSelectionController(),
    milestones: startup,
    signal: options.signal ?? new AbortController().signal,
  };
}

export async function advanceUntil(
  clock: DocumentDriverClock,
  map: TestDocumentMap,
  predicate: () => boolean,
  limit = 300,
): Promise<void> {
  for (let step = 0; step < limit && !predicate(); step += 1) {
    clock.flushOne(map);
    await Promise.resolve();
    await Promise.resolve();
  }
  if (!predicate()) throw new Error('Document driver did not settle.');
}

export async function drainDocumentDriver(
  clock: DocumentDriverClock,
  map: TestDocumentMap,
  limit = 300,
): Promise<void> {
  let idleTurns = 0;
  for (let step = 0; step < limit && idleTurns < 3; step += 1) {
    if (clock.frames.size > 0) {
      clock.flushOne(map);
      idleTurns = 0;
    } else {
      idleTurns += 1;
    }
    await Promise.resolve();
    await Promise.resolve();
    if (clock.frames.size > 0) idleTurns = 0;
  }
  if (clock.frames.size > 0 || idleTurns < 3) {
    throw new Error('Document driver frame queue did not drain.');
  }
}
