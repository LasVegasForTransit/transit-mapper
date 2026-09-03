/* eslint-disable max-lines -- One driver fixture keeps lifecycle assertions on the same fake MapLibre boundary. */
/* eslint-disable @typescript-eslint/unbound-method -- Vitest inspects method spies without invoking them. */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- Vitest exposes mock call tuples as any. */
import type { LayerSpecification } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';
import { aRoad, aSystem } from '@transitmapper/core/testing/fixtures';
import {
  createMapViewStore,
  createSelectionController,
  type MapDefinition,
} from '@transitmapper/map';
import {
  createDocumentMapDriver,
  type DocumentMapDriverOptions,
  type DocumentMapSession,
} from '../src/document-map-driver';
import { createSourceFeatureProjectionAccounting } from '@transitmapper/renderer/projection';
import { LYR_WAYS_SOLID, SRC_STATIONS, SRC_WAYS } from '@transitmapper/renderer/layers';
import type { RendererStatsCollector } from '@transitmapper/renderer/stats';
import { createSourceFeatureProjectionCounts } from '@transitmapper/renderer/projection';
import { COMMITTED_SYSTEM_FEATURE_SOURCES } from '@transitmapper/renderer/layers';
import {
  DocumentDriverClock,
  TestDocumentMap,
  TestDocumentSource,
  advanceUntil,
  createAttachOptions,
  createProjectionWorker,
  drainDocumentDriver,
  projectedWayFeatures,
  readySnapshot,
} from './support/document-map-driver.test';

const definition: MapDefinition = {
  id: 'document',
  title: 'Transit system',
  representations: [
    { id: 'network', label: 'Network' },
    { id: 'infrastructure', label: 'Infrastructure' },
    { id: 'diagram', label: 'Diagram' },
  ],
  filters: [],
  attribution: [],
};

function createReadySystem(id = 'system') {
  return aSystem({
    id,
    ways: [
      aRoad('road', [
        [-115.2, 36.1],
        [-115.1, 36.2],
      ]),
    ],
  });
}

function requireSession(session: DocumentMapSession | null): DocumentMapSession {
  if (!session) throw new Error('The driver did not attach a document map session.');
  return session;
}

function resolvePresentation(
  state: ReturnType<ReturnType<typeof createMapViewStore>['getSnapshot']>,
) {
  const modes = state.filters.modes;
  const wayTypes = state.filters['way-types'];
  return {
    viewMode: state.representationId as 'network' | 'infrastructure' | 'diagram',
    visibleModes: new Set(Array.isArray(modes) ? modes : []),
    visibleWayTypes: new Set(Array.isArray(wayTypes) ? wayTypes : []),
  };
}

function driverOptions(
  source: TestDocumentSource,
  clock: DocumentDriverClock,
  worker: ReturnType<typeof createProjectionWorker>,
  overrides: Partial<DocumentMapDriverOptions> = {},
): DocumentMapDriverOptions {
  return {
    definition,
    source,
    layerSpecs: () => [],
    resolvePresentation,
    createFeatureProjectionWorker: () => worker,
    scheduler: clock,
    ...overrides,
  };
}

describe('document map driver', () => {
  it('waits for a ready document before installing the map overlay', async () => {
    const source = new TestDocumentSource({
      status: 'loading',
      system: aSystem({ id: 'loading' }),
    });
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const worker = createProjectionWorker();
    const attachSession = vi.fn();
    const driver = createDocumentMapDriver(driverOptions(source, clock, worker, { attachSession }));
    const attachment = await driver.attach(createAttachOptions(map, [], []));

    expect(map.sourceCount()).toBe(0);
    expect(map.styleUpdates).toHaveLength(0);
    expect(attachSession).not.toHaveBeenCalled();

    source.publish(readySnapshot(createReadySystem()));

    expect(map.sourceCount()).toBeGreaterThan(0);
    expect(attachSession).toHaveBeenCalledOnce();
    attachment.dispose();
  });

  it('installs only the layers required by the current representation', async () => {
    const source = new TestDocumentSource(readySnapshot(aSystem({ id: 'empty' })));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const layers: LayerSpecification[] = [
      { id: 'document-lines', type: 'line', source: SRC_WAYS },
      { id: 'document-stops', type: 'circle', source: SRC_STATIONS },
    ];
    const viewStore = createMapViewStore({
      schemaVersion: 1,
      camera: { center: [-115.18, 36.14], zoom: 10 },
      representationId: 'network',
      filters: { modes: ['bus'], 'way-types': ['road'] },
    });
    const driver = createDocumentMapDriver(
      driverOptions(source, clock, createProjectionWorker(), {
        layerSpecs: () => layers,
        layerSpecsForPresentation: (_catalog, presentation) =>
          presentation.viewMode === 'network' ? layers.slice(0, 1) : layers,
      }),
    );

    const attachment = await driver.attach(createAttachOptions(map, [], [], { viewStore }));

    expect(map.styleUpdates).toHaveLength(1);
    expect(map.styleUpdates[0]?.options).toEqual({ diff: true, validate: false });
    expect(map.styleUpdates[0]?.style.layers.map((layer) => layer.id)).toEqual([
      'document-lines--bank-a',
      'document-lines--bank-b',
    ]);
    expect(map.layerAdds).toEqual([]);

    viewStore.setRepresentationId('infrastructure');

    expect(map.styleUpdates).toHaveLength(2);
    expect(map.styleUpdates[1]?.style.layers.map((layer) => layer.id)).toEqual([
      'document-lines--bank-a',
      'document-lines--bank-b',
      'document-stops--bank-a',
      'document-stops--bank-b',
    ]);
    attachment.dispose();
  });

  it('installs one composed surface plan without giving extension layers to the renderer', async () => {
    const source = new TestDocumentSource(readySnapshot(aSystem({ id: 'empty' })));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const layers: LayerSpecification[] = [
      { id: 'document-lines', type: 'line', source: SRC_WAYS },
      { id: 'editor-handles', type: 'circle', source: 'tm-handles' },
      { id: 'document-stops', type: 'circle', source: SRC_STATIONS },
    ];
    const documentLayersFor = (
      _catalog: readonly LayerSpecification[],
      presentation: ReturnType<typeof resolvePresentation>,
    ) => (presentation.viewMode === 'network' ? [layers[0]] : [layers[0], layers[2]]);
    const surfaceLayersFor = (
      catalog: readonly LayerSpecification[],
      presentation: ReturnType<typeof resolvePresentation>,
    ) => {
      const documentIds = new Set(
        documentLayersFor(catalog, presentation).map((layer) => layer.id),
      );
      return catalog.filter((layer) => documentIds.has(layer.id) || layer.id === 'editor-handles');
    };
    const viewStore = createMapViewStore({
      schemaVersion: 1,
      camera: { center: [-115.18, 36.14], zoom: 10 },
      representationId: 'network',
      filters: { modes: ['bus'], 'way-types': ['road'] },
    });
    const driver = createDocumentMapDriver(
      driverOptions(source, clock, createProjectionWorker(), {
        layerSpecs: () => layers,
        layerSpecsForPresentation: documentLayersFor,
        surfaceLayerSpecsForPresentation: surfaceLayersFor,
      }),
    );

    const attachment = await driver.attach(createAttachOptions(map, [], [], { viewStore }));

    expect(map.styleUpdates).toHaveLength(1);
    expect(map.styleUpdates[0]?.style.layers.map((layer) => layer.id)).toEqual([
      'document-lines--bank-a',
      'document-lines--bank-b',
      'editor-handles',
    ]);

    viewStore.setRepresentationId('infrastructure');

    expect(map.styleUpdates).toHaveLength(2);
    expect(map.styleUpdates[1]?.style.layers.map((layer) => layer.id)).toEqual([
      'document-lines--bank-a',
      'document-lines--bank-b',
      'editor-handles',
      'document-stops--bank-a',
      'document-stops--bank-b',
    ]);
    attachment.dispose();
  });

  it('renders an initial ready document before it publishes startup milestones', async () => {
    const source = new TestDocumentSource(readySnapshot(createReadySystem()));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const worker = createProjectionWorker((input) =>
      Promise.resolve({ features: projectedWayFeatures(input.system.id), counts: null }),
    );
    const milestones: string[] = [];
    const errors: unknown[] = [];
    const driver = createDocumentMapDriver(driverOptions(source, clock, worker));

    const attachment = await driver.attach(
      createAttachOptions(map, milestones, errors, {
        selection: createSelectionController({
          source: 'document',
          kind: 'way',
          id: 'road',
        }),
      }),
    );
    await advanceUntil(clock, map, () => milestones.length === 2);

    expect(worker.project).toHaveBeenCalledOnce();
    expect(worker.project.mock.calls[0]?.[0]).toMatchObject({
      system: source.getSnapshot().system,
      sourceIds: expect.arrayContaining([SRC_WAYS]),
      selection: { kind: 'way', id: 'road' },
    });
    expect(milestones).toEqual(['content', 'interactive']);
    expect(errors).toEqual([]);

    attachment.dispose();
  });

  it('reprojects the document when the portable selection changes', async () => {
    const source = new TestDocumentSource(readySnapshot(createReadySystem()));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const worker = createProjectionWorker((input) =>
      Promise.resolve({ features: projectedWayFeatures(input.system.id), counts: null }),
    );
    const selection = createSelectionController();
    const driver = createDocumentMapDriver(driverOptions(source, clock, worker));

    const attachment = await driver.attach(createAttachOptions(map, [], [], { selection }));
    await advanceUntil(clock, map, () => worker.project.mock.calls.length === 1);

    selection.select({ source: 'document', kind: 'way', id: 'road' });
    await advanceUntil(clock, map, () => worker.project.mock.calls.length === 2);

    expect(worker.project.mock.calls[1]?.[0]).toMatchObject({
      selection: { kind: 'way', id: 'road' },
    });
    attachment.dispose();
  });

  it('publishes both milestones for an empty ready document without projecting it', async () => {
    const source = new TestDocumentSource(readySnapshot(aSystem({ id: 'empty' })));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const worker = createProjectionWorker();
    const milestones: string[] = [];
    const errors: unknown[] = [];
    const driver = createDocumentMapDriver(driverOptions(source, clock, worker));

    const attachment = await driver.attach(createAttachOptions(map, milestones, errors));

    expect(milestones).toEqual(['content', 'interactive']);
    expect(worker.project).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
    attachment.dispose();
  });

  it('attaches the document session before an empty document becomes interactive', async () => {
    const source = new TestDocumentSource(readySnapshot(aSystem({ id: 'empty' })));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const order: string[] = [];
    const driver = createDocumentMapDriver(
      driverOptions(source, clock, createProjectionWorker(), {
        attachSession: () => {
          order.push('session');
        },
      }),
    );

    const attachment = await driver.attach(createAttachOptions(map, order, []));

    expect(order).toEqual(['session', 'content', 'interactive']);
    attachment.dispose();
  });

  it('waits for a usable overlay before it attaches the document session', async () => {
    const source = new TestDocumentSource(readySnapshot(aSystem({ id: 'empty' })));
    const map = new TestDocumentMap();
    map.failNextOverlaySetup = true;
    const clock = new DocumentDriverClock();
    const milestones: string[] = [];
    const attachSession = vi.fn();
    const driver = createDocumentMapDriver(
      driverOptions(source, clock, createProjectionWorker(), { attachSession }),
    );

    const attachment = await driver.attach(createAttachOptions(map, milestones, []));

    expect(attachSession).not.toHaveBeenCalled();
    expect(milestones).toEqual([]);

    map.emit('style.load');
    await advanceUntil(clock, map, () => milestones.length === 2);

    expect(attachSession).toHaveBeenCalledOnce();
    expect(milestones).toEqual(['content', 'interactive']);
    attachment.dispose();
  });

  it('attaches the document session exactly once across later style loads', async () => {
    const source = new TestDocumentSource(readySnapshot(aSystem({ id: 'empty' })));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const attachSession = vi.fn(() => ({ dispose: vi.fn() }));
    const driver = createDocumentMapDriver(
      driverOptions(source, clock, createProjectionWorker(), { attachSession }),
    );

    const attachment = await driver.attach(createAttachOptions(map, [], []));
    map.replaceStyle();
    await drainDocumentDriver(clock, map);
    map.replaceStyle();
    await drainDocumentDriver(clock, map);

    expect(attachSession).toHaveBeenCalledOnce();
    attachment.dispose();
  });

  it('does not publish interactive when content commitment aborts the attachment', async () => {
    const source = new TestDocumentSource(readySnapshot(aSystem({ id: 'empty' })));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const worker = createProjectionWorker();
    const controller = new AbortController();
    const milestones: string[] = [];
    const baseOptions = createAttachOptions(map, [], [], { signal: controller.signal });
    const driver = createDocumentMapDriver(driverOptions(source, clock, worker));

    const attachment = await driver.attach({
      ...baseOptions,
      milestones: {
        contentCommitted: () => {
          milestones.push('content');
          controller.abort();
        },
        interactive: () => milestones.push('interactive'),
      },
    });

    expect(milestones).toEqual(['content']);
    expect(worker.dispose).toHaveBeenCalledOnce();
    attachment.dispose();
  });

  it('coalesces document updates and projects the latest immutable snapshot', async () => {
    const source = new TestDocumentSource({
      status: 'loading',
      system: aSystem({ id: 'loading' }),
    });
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const worker = createProjectionWorker();
    const milestones: string[] = [];
    const errors: unknown[] = [];
    const driver = createDocumentMapDriver(driverOptions(source, clock, worker));
    const attachment = await driver.attach(createAttachOptions(map, milestones, errors));
    const first = createReadySystem('same');
    const latest = { ...first, name: 'Latest', ways: [...first.ways] };

    source.publish(readySnapshot(first));
    source.publish(readySnapshot(latest));
    await advanceUntil(clock, map, () => milestones.length === 2);

    expect(worker.project).toHaveBeenCalledOnce();
    expect(worker.project.mock.calls[0]?.[0].system).toBe(latest);
    expect(errors).toEqual([]);
    attachment.dispose();
  });

  it('projects all sources when an unchanged loading snapshot becomes ready', async () => {
    const system = createReadySystem();
    const source = new TestDocumentSource({ status: 'loading', system });
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const worker = createProjectionWorker();
    const driver = createDocumentMapDriver(driverOptions(source, clock, worker));
    const attachment = await driver.attach(createAttachOptions(map, [], []));

    source.publish(readySnapshot(system));
    await advanceUntil(clock, map, () => worker.project.mock.calls.length === 1);

    expect(worker.project.mock.calls[0]?.[0].sourceIds).toEqual(
      expect.arrayContaining([SRC_WAYS, SRC_STATIONS]),
    );
    attachment.dispose();
  });

  it('discards an older initial projection when the ready document is empty', async () => {
    const initial = createReadySystem();
    const source = new TestDocumentSource(readySnapshot(initial));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const worker = createProjectionWorker();
    const driver = createDocumentMapDriver(driverOptions(source, clock, worker));
    const attachment = await driver.attach(createAttachOptions(map, [], []));

    source.publish(readySnapshot(aSystem({ id: initial.id })));
    await drainDocumentDriver(clock, map);

    expect(worker.project).not.toHaveBeenCalled();
    attachment.dispose();
  });

  it('resets camera preload when the first ready document identity is empty', async () => {
    const source = new TestDocumentSource({
      status: 'loading',
      system: createReadySystem('old'),
    });
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const worker = createProjectionWorker();
    const driver = createDocumentMapDriver(driverOptions(source, clock, worker));
    const attachment = await driver.attach(createAttachOptions(map, [], []));
    clock.advanceBy(100);
    map.setBounds([-115, 35], [-113, 37]);
    map.emit('move');

    source.publish(readySnapshot(aSystem({ id: 'new' })));
    source.publish(readySnapshot(createReadySystem('new')));
    await advanceUntil(clock, map, () => worker.project.mock.calls.length === 1);

    expect(worker.project.mock.calls[0]?.[0].preparedSnapshot.candidateEnvelope).toEqual({
      bounds: { southwest: [-115, 35], northeast: [-113, 37] },
    });
    attachment.dispose();
  });

  it('keeps a same-document update scoped to the changed renderer sources', async () => {
    const initial = createReadySystem();
    const source = new TestDocumentSource(readySnapshot(initial));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const worker = createProjectionWorker();
    const milestones: string[] = [];
    const errors: unknown[] = [];
    let session: DocumentMapSession | null = null;
    const driver = createDocumentMapDriver(
      driverOptions(source, clock, worker, {
        attachSession: (attached) => {
          session = attached;
        },
      }),
    );
    const attachment = await driver.attach(createAttachOptions(map, milestones, errors));
    await advanceUntil(clock, map, () => session?.renderer.snapshot().acceptedRevision != null);

    source.publish(
      readySnapshot({
        ...initial,
        stops: [{ id: 'stop', name: 'Stop', coord: [-115.15, 36.15], anchors: [] }],
      }),
    );
    await advanceUntil(clock, map, () => worker.project.mock.calls.length === 2);

    expect(worker.project.mock.calls[1]?.[0].sourceIds).toEqual([SRC_STATIONS]);
    expect(errors).toEqual([]);
    attachment.dispose();
  });

  it('uses injected projection accounting and renderer instrumentation', async () => {
    const source = new TestDocumentSource(readySnapshot(createReadySystem()));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const counts = createSourceFeatureProjectionCounts();
    counts.featureStopVisitCount = 7;
    const worker = createProjectionWorker(() =>
      Promise.resolve({ features: projectedWayFeatures('system'), counts }),
    );
    const projectionAccounting = createSourceFeatureProjectionAccounting();
    const rendererStats: RendererStatsCollector = {
      recordProjection: vi.fn(),
      recordEditorProjection: vi.fn(),
      recordPatch: vi.fn(),
      recordFullUpload: vi.fn(),
      recordScheduling: vi.fn(),
      recordPreparation: vi.fn(),
      snapshot: vi.fn(() => {
        throw new Error('The test does not read a statistics snapshot.');
      }),
    };
    const driver = createDocumentMapDriver(
      driverOptions(source, clock, worker, {
        projectionAccounting,
        rendererStats,
        instrumentationEnabled: true,
      }),
    );

    const attachment = await driver.attach(createAttachOptions(map, [], []));
    await advanceUntil(clock, map, () => projectionAccounting.snapshot().featureStopVisitCount > 0);

    expect(projectionAccounting.snapshot().featureStopVisitCount).toBe(7);
    expect(rendererStats.recordProjection).toHaveBeenCalledOnce();
    expect(rendererStats.recordScheduling).toHaveBeenCalled();
    expect(rendererStats.recordPreparation).toHaveBeenCalled();
    attachment.dispose();
  });

  it('synchronizes extension interaction state when a scene becomes accepted', async () => {
    const source = new TestDocumentSource(readySnapshot(createReadySystem()));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const synchronizeInteractionState = vi.fn();
    const refreshInteractionPreviews = vi.fn();
    let session: DocumentMapSession | null = null;
    const driver = createDocumentMapDriver(
      driverOptions(source, clock, createProjectionWorker(), {
        attachSession: (attached) => {
          session = attached;
          return {
            dispose() {},
            synchronizeInteractionState,
            refreshInteractionPreviews,
          };
        },
      }),
    );

    const attachment = await driver.attach(createAttachOptions(map, [], []));
    await advanceUntil(clock, map, () => session?.renderer.snapshot().acceptedRevision != null);

    expect(synchronizeInteractionState.mock.calls[0]?.[0]).toEqual(expect.any(Function));
    expect(synchronizeInteractionState).toHaveBeenCalledWith();
    expect(refreshInteractionPreviews).toHaveBeenCalled();
    attachment.dispose();
  });

  it('does not project a metadata-only document snapshot', async () => {
    const initial = createReadySystem();
    const source = new TestDocumentSource(readySnapshot(initial));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const worker = createProjectionWorker();
    let session: DocumentMapSession | null = null;
    const driver = createDocumentMapDriver(
      driverOptions(source, clock, worker, {
        attachSession: (attached) => {
          session = attached;
        },
      }),
    );
    const attachment = await driver.attach(createAttachOptions(map, [], []));
    await advanceUntil(clock, map, () => session?.renderer.snapshot().acceptedRevision != null);
    await drainDocumentDriver(clock, map);

    source.publish(readySnapshot({ ...initial, name: 'Renamed system' }));
    await drainDocumentDriver(clock, map);

    expect(worker.project).toHaveBeenCalledOnce();
    attachment.dispose();
  });

  it('does not project an identical document snapshot', async () => {
    const snapshot = readySnapshot(createReadySystem());
    const source = new TestDocumentSource(snapshot);
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const worker = createProjectionWorker();
    let session: DocumentMapSession | null = null;
    const driver = createDocumentMapDriver(
      driverOptions(source, clock, worker, {
        attachSession: (attached) => {
          session = attached;
        },
      }),
    );
    const attachment = await driver.attach(createAttachOptions(map, [], []));
    await advanceUntil(clock, map, () => session?.renderer.snapshot().acceptedRevision != null);
    await drainDocumentDriver(clock, map);

    source.publish(snapshot);
    await drainDocumentDriver(clock, map);

    expect(worker.project).toHaveBeenCalledOnce();
    attachment.dispose();
  });

  it('uses a full source reset when the document identity changes', async () => {
    const source = new TestDocumentSource(readySnapshot(createReadySystem('first')));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const worker = createProjectionWorker((input) =>
      Promise.resolve({ features: projectedWayFeatures(input.system.id), counts: null }),
    );
    const milestones: string[] = [];
    const errors: unknown[] = [];
    let session: DocumentMapSession | null = null;
    const driver = createDocumentMapDriver(
      driverOptions(source, clock, worker, {
        attachSession: (attached) => {
          session = attached;
        },
      }),
    );
    const attachment = await driver.attach(createAttachOptions(map, milestones, errors));
    await advanceUntil(clock, map, () => session?.renderer.snapshot().acceptedRevision != null);
    const operationCount = map.sourceOperations.length;

    source.publish(readySnapshot(createReadySystem('second')));
    await advanceUntil(
      clock,
      map,
      () => session?.renderer.snapshot().acceptedRevision?.startsWith('second:') === true,
    );

    const replacementOperations = map.sourceOperations.slice(operationCount);
    expect(replacementOperations.some((operation) => operation.method === 'setData')).toBe(true);
    expect(errors).toEqual([]);
    attachment.dispose();
  });

  it('retains a document identity change across a loading snapshot', async () => {
    const source = new TestDocumentSource(readySnapshot(createReadySystem('first')));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const worker = createProjectionWorker();
    let session: DocumentMapSession | null = null;
    const driver = createDocumentMapDriver(
      driverOptions(source, clock, worker, {
        attachSession: (attached) => {
          session = attached;
        },
      }),
    );
    const attachment = await driver.attach(createAttachOptions(map, [], []));
    await advanceUntil(clock, map, () => session?.renderer.snapshot().acceptedRevision != null);
    const replacement = createReadySystem('second');

    source.publish({ status: 'loading', system: replacement });
    source.publish(readySnapshot(replacement));
    await advanceUntil(clock, map, () => worker.project.mock.calls.length === 2);

    expect(worker.project.mock.calls[1]?.[0].sourceIds).toEqual(COMMITTED_SYSTEM_FEATURE_SOURCES);
    attachment.dispose();
  });

  it('clears an accepted document when a loading identity becomes ready and empty', async () => {
    const source = new TestDocumentSource(readySnapshot(createReadySystem('first')));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const worker = createProjectionWorker((input) =>
      Promise.resolve({ features: projectedWayFeatures(input.system.id), counts: null }),
    );
    let session: DocumentMapSession | null = null;
    const driver = createDocumentMapDriver(
      driverOptions(source, clock, worker, {
        attachSession: (attached) => {
          session = attached;
        },
      }),
    );
    const attachment = await driver.attach(createAttachOptions(map, [], []));
    await advanceUntil(clock, map, () => session?.renderer.snapshot().acceptedRevision != null);
    const replacement = aSystem({ id: 'second' });

    source.publish({ status: 'loading', system: replacement });
    source.publish(readySnapshot(replacement));
    await advanceUntil(
      clock,
      map,
      () => session?.renderer.snapshot().acceptedRevision?.startsWith('second:') === true,
    );

    expect(worker.project.mock.calls[1]?.[0].sourceIds).toEqual(COMMITTED_SYSTEM_FEATURE_SOURCES);
    attachment.dispose();
  });

  it('updates filters and schedules representation and camera work without replacing its session', async () => {
    const source = new TestDocumentSource(readySnapshot(createReadySystem()));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const worker = createProjectionWorker((input) =>
      Promise.resolve({ features: projectedWayFeatures(input.system.id), counts: null }),
    );
    const milestones: string[] = [];
    const errors: unknown[] = [];
    const viewStore = createMapViewStore({
      schemaVersion: 1,
      camera: { center: [-115.18, 36.14], zoom: 10 },
      representationId: 'network',
      filters: { modes: ['bus'], 'way-types': ['road'] },
    });
    const layerSpecs: LayerSpecification[] = [
      { id: LYR_WAYS_SOLID, type: 'line', source: SRC_WAYS, paint: { 'line-width': 2 } },
    ];
    let sessionCount = 0;
    const driver = createDocumentMapDriver(
      driverOptions(source, clock, worker, {
        layerSpecs: () => layerSpecs,
        attachSession: () => {
          sessionCount += 1;
        },
      }),
    );
    const attachment = await driver.attach(
      createAttachOptions(map, milestones, errors, { viewStore }),
    );
    await advanceUntil(clock, map, () => milestones.length === 2);
    const initialProjectionCount = worker.project.mock.calls.length;

    viewStore.setFilter('modes', []);
    expect(map.filters.size).toBeGreaterThan(0);
    expect(worker.project).toHaveBeenCalledTimes(initialProjectionCount);

    viewStore.setRepresentationId('infrastructure');
    await advanceUntil(clock, map, () => worker.project.mock.calls.length > initialProjectionCount);
    const representationProjectionCount = worker.project.mock.calls.length;

    map.emit('move');
    await advanceUntil(
      clock,
      map,
      () => worker.project.mock.calls.length > representationProjectionCount,
    );

    expect(sessionCount).toBe(1);
    expect(errors).toEqual([]);
    attachment.dispose();
  });

  it('reuses committed camera coverage until the viewport leaves its envelope', async () => {
    const source = new TestDocumentSource(readySnapshot(createReadySystem()));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const worker = createProjectionWorker();
    let session: DocumentMapSession | null = null;
    const driver = createDocumentMapDriver(
      driverOptions(source, clock, worker, {
        attachSession: (attached) => {
          session = attached;
        },
      }),
    );
    const attachment = await driver.attach(createAttachOptions(map, [], []));
    await advanceUntil(clock, map, () => session?.renderer.snapshot().acceptedRevision != null);
    await drainDocumentDriver(clock, map);

    map.emit('move');
    await drainDocumentDriver(clock, map);
    expect(worker.project).toHaveBeenCalledOnce();

    clock.advanceBy(100);
    map.setBounds([-105, 30], [-103, 32]);
    map.emit('move');
    await advanceUntil(clock, map, () => worker.project.mock.calls.length === 2);

    expect(worker.project.mock.calls[1]?.[0].sourceIds).toEqual(
      expect.arrayContaining([SRC_WAYS, SRC_STATIONS]),
    );
    attachment.dispose();
  });

  it('publishes startup milestones once across later accepted scenes', async () => {
    const initial = createReadySystem();
    const source = new TestDocumentSource(readySnapshot(initial));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const worker = createProjectionWorker();
    const milestones: string[] = [];
    const viewStore = createMapViewStore({
      schemaVersion: 1,
      camera: { center: [-115.18, 36.14], zoom: 10 },
      representationId: 'network',
      filters: { modes: ['bus'], 'way-types': ['road'] },
    });
    const driver = createDocumentMapDriver(driverOptions(source, clock, worker));
    const attachment = await driver.attach(createAttachOptions(map, milestones, [], { viewStore }));
    await advanceUntil(clock, map, () => milestones.length === 2);
    await drainDocumentDriver(clock, map);

    source.publish(readySnapshot({ ...initial, ways: [...initial.ways] }));
    await advanceUntil(clock, map, () => worker.project.mock.calls.length === 2);
    await drainDocumentDriver(clock, map);
    viewStore.setRepresentationId('infrastructure');
    await advanceUntil(clock, map, () => worker.project.mock.calls.length === 3);
    await drainDocumentDriver(clock, map);
    clock.advanceBy(100);
    map.setBounds([-105, 30], [-103, 32]);
    map.emit('move');
    await advanceUntil(clock, map, () => worker.project.mock.calls.length === 4);
    await drainDocumentDriver(clock, map);

    expect(milestones).toEqual(['content', 'interactive']);
    attachment.dispose();
  });

  it('keeps the accepted scene and reports one error when a replacement projection fails', async () => {
    const source = new TestDocumentSource(readySnapshot(createReadySystem()));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    let request = 0;
    const worker = createProjectionWorker((input) => {
      request += 1;
      return request === 1
        ? Promise.resolve({ features: projectedWayFeatures(input.system.id), counts: null })
        : Promise.reject(new Error('replacement failed'));
    });
    const milestones: string[] = [];
    const errors: unknown[] = [];
    let session: DocumentMapSession | null = null;
    const driver = createDocumentMapDriver(
      driverOptions(source, clock, worker, {
        attachSession: (attached) => {
          session = attached;
        },
      }),
    );
    const attachment = await driver.attach(createAttachOptions(map, milestones, errors));
    await advanceUntil(clock, map, () => session?.renderer.snapshot().acceptedRevision != null);
    const acceptedRevision = requireSession(session).renderer.snapshot().acceptedRevision;
    const current = source.getSnapshot().system;

    source.publish(readySnapshot({ ...current, ways: [...current.ways] }));
    await advanceUntil(clock, map, () => errors.length > 0);

    expect(errors).toHaveLength(1);
    expect(requireSession(session).renderer.snapshot().acceptedRevision).toBe(acceptedRevision);
    attachment.dispose();
  });

  it('carries failed source work into the next document snapshot', async () => {
    const initial = createReadySystem();
    const source = new TestDocumentSource(readySnapshot(initial));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    let request = 0;
    const worker = createProjectionWorker((input) => {
      request += 1;
      return request === 2
        ? Promise.reject(new Error('way replacement failed'))
        : Promise.resolve({ features: projectedWayFeatures(input.system.id), counts: null });
    });
    const errors: unknown[] = [];
    let session: DocumentMapSession | null = null;
    const driver = createDocumentMapDriver(
      driverOptions(source, clock, worker, {
        attachSession: (attached) => {
          session = attached;
        },
      }),
    );
    const attachment = await driver.attach(createAttachOptions(map, [], errors));
    await advanceUntil(clock, map, () => session?.renderer.snapshot().acceptedRevision != null);

    source.publish(
      readySnapshot({
        ...initial,
        ways: [
          aRoad('replacement-road', [
            [-115.3, 36.1],
            [-115.1, 36.2],
          ]),
        ],
      }),
    );
    await advanceUntil(clock, map, () => errors.length === 1);
    source.publish(
      readySnapshot({
        ...source.getSnapshot().system,
        stops: [{ id: 'stop', name: 'Stop', coord: [-115.15, 36.15], anchors: [] }],
      }),
    );
    await advanceUntil(clock, map, () => worker.project.mock.calls.length === 3);

    expect(worker.project.mock.calls[2]?.[0].sourceIds).toEqual(
      expect.arrayContaining([SRC_WAYS, SRC_STATIONS]),
    );
    attachment.dispose();
  });

  it('restores the accepted scene after MapLibre replaces the style', async () => {
    const source = new TestDocumentSource(readySnapshot(createReadySystem()));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const worker = createProjectionWorker((input) =>
      Promise.resolve({ features: projectedWayFeatures(input.system.id), counts: null }),
    );
    const errors: unknown[] = [];
    let session: DocumentMapSession | null = null;
    const driver = createDocumentMapDriver(
      driverOptions(source, clock, worker, {
        attachSession: (attached) => {
          session = attached;
        },
      }),
    );
    const attachment = await driver.attach(createAttachOptions(map, [], errors));
    await advanceUntil(clock, map, () => session?.renderer.snapshot().acceptedRevision != null);
    map.replaceStyle();
    expect(errors).toEqual([]);
    expect(map.sourceCount()).toBeGreaterThan(0);
    await advanceUntil(clock, map, () => map.sourceOperations.length > 0);

    expect(requireSession(session).renderer.snapshot().acceptedRevision).toMatch(/^system:/);
    expect(worker.project).toHaveBeenCalledOnce();
    attachment.dispose();
  });

  it('restores extension style state before the recovered scene requests its first paint', async () => {
    const source = new TestDocumentSource(readySnapshot(createReadySystem()));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const events: string[] = [];
    const refreshInteractionPreviews = vi.fn();
    const restoreAfterStyle = vi.fn(() => events.push('restore'));
    vi.spyOn(map, 'triggerRepaint').mockImplementation(() => events.push('paint'));
    let session: DocumentMapSession | null = null;
    const driver = createDocumentMapDriver(
      driverOptions(source, clock, createProjectionWorker(), {
        attachSession: (attached) => {
          session = attached;
          return { dispose() {}, refreshInteractionPreviews, restoreAfterStyle };
        },
      }),
    );
    const attachment = await driver.attach(createAttachOptions(map, [], []));
    await advanceUntil(clock, map, () => session?.renderer.snapshot().acceptedRevision != null);
    expect(restoreAfterStyle).not.toHaveBeenCalled();
    refreshInteractionPreviews.mockClear();
    const renderer = requireSession(session).renderer;
    const requestRecovery = renderer.requestRecovery.bind(renderer);
    vi.spyOn(renderer, 'requestRecovery').mockImplementation(() => {
      events.push('recovery');
      requestRecovery();
    });
    events.length = 0;
    const recoveryVersion = renderer.recoveryVersion();

    map.replaceStyle();
    await advanceUntil(
      clock,
      map,
      () => requireSession(session).renderer.recoveryVersion() > recoveryVersion + 1,
    );

    expect(restoreAfterStyle).toHaveBeenCalledOnce();
    const restoreIndex = events.indexOf('restore');
    const recoveryIndex = events.indexOf('recovery');
    expect(restoreIndex).toBeLessThan(recoveryIndex);
    expect(events.slice(recoveryIndex + 1)).toContain('paint');
    expect(refreshInteractionPreviews).not.toHaveBeenCalled();
    attachment.dispose();
  });

  it('recovers the accepted scene when a host applies a style without a style load event', async () => {
    const source = new TestDocumentSource(readySnapshot(createReadySystem()));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const errors: unknown[] = [];
    let session: DocumentMapSession | null = null;
    const driver = createDocumentMapDriver(
      driverOptions(source, clock, createProjectionWorker(), {
        attachSession: (attached) => {
          session = attached;
        },
      }),
    );
    const attachment = await driver.attach(createAttachOptions(map, [], errors));
    await advanceUntil(clock, map, () => session?.renderer.snapshot().acceptedRevision != null);
    const renderer = requireSession(session).renderer;
    const recoveryVersion = renderer.recoveryVersion();
    const events: string[] = [];
    const restoreActiveLayers = renderer.restoreActiveLayers.bind(renderer);
    vi.spyOn(renderer, 'restoreActiveLayers').mockImplementation(() => {
      events.push('restore');
      restoreActiveLayers();
    });
    vi.spyOn(map, 'triggerRepaint').mockImplementation(() => events.push('paint'));
    requireSession(session).recoverStyle();
    await advanceUntil(clock, map, () => renderer.recoveryVersion() > recoveryVersion + 1);

    expect(errors).toEqual([]);
    expect(events.lastIndexOf('restore')).toBeLessThan(events.lastIndexOf('paint'));
    attachment.dispose();
  });

  it('retries retained-scene recovery when a style changes during an active projection', async () => {
    const initial = createReadySystem();
    const source = new TestDocumentSource(readySnapshot(initial));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const worker = createProjectionWorker((input) =>
      Promise.resolve({ features: projectedWayFeatures(input.system.id), counts: null }),
    );
    const errors: unknown[] = [];
    let session: DocumentMapSession | null = null;
    const driver = createDocumentMapDriver(
      driverOptions(source, clock, worker, {
        attachSession: (attached) => {
          session = attached;
        },
      }),
    );
    const attachment = await driver.attach(createAttachOptions(map, [], errors));
    await advanceUntil(clock, map, () => session?.renderer.snapshot().acceptedRevision != null);

    source.publish(readySnapshot({ ...initial, ways: [...initial.ways] }));
    await advanceUntil(clock, map, () => session?.renderer.publicationInProgress() === true);
    map.replaceStyle();
    const recoveryVersion = requireSession(session).renderer.recoveryVersion();
    await advanceUntil(
      clock,
      map,
      () => requireSession(session).renderer.recoveryVersion() > recoveryVersion + 1,
    );

    expect(errors).toEqual([]);
    expect(map.sourceOperations.length).toBeGreaterThan(0);
    attachment.dispose();
  });

  it('recovers a replaced style when the active projection rejects', async () => {
    const initial = createReadySystem();
    const source = new TestDocumentSource(readySnapshot(initial));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    let request = 0;
    let rejectReplacement: (error: Error) => void = () => {
      throw new Error('Replacement projection did not start.');
    };
    const worker = createProjectionWorker((input) => {
      request += 1;
      if (request === 2) {
        return new Promise((_, reject) => {
          rejectReplacement = reject;
        });
      }
      return Promise.resolve({ features: projectedWayFeatures(input.system.id), counts: null });
    });
    const errors: unknown[] = [];
    let session: DocumentMapSession | null = null;
    const driver = createDocumentMapDriver(
      driverOptions(source, clock, worker, {
        attachSession: (attached) => {
          session = attached;
        },
      }),
    );
    const attachment = await driver.attach(createAttachOptions(map, [], errors));
    await advanceUntil(clock, map, () => session?.renderer.snapshot().acceptedRevision != null);

    source.publish(readySnapshot({ ...initial, ways: [...initial.ways] }));
    await advanceUntil(clock, map, () => worker.project.mock.calls.length === 2);
    map.replaceStyle();
    const recoveryVersion = requireSession(session).renderer.recoveryVersion();
    rejectReplacement(new Error('replacement rejected'));
    await advanceUntil(
      clock,
      map,
      () => requireSession(session).renderer.recoveryVersion() > recoveryVersion + 1,
    );

    expect(errors).toEqual([]);
    expect(map.sourceOperations.length).toBeGreaterThan(0);
    attachment.dispose();
  });

  it('contains retained-style layer restoration failures', async () => {
    const source = new TestDocumentSource(readySnapshot(createReadySystem()));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const worker = createProjectionWorker();
    const errors: unknown[] = [];
    let session: DocumentMapSession | null = null;
    const driver = createDocumentMapDriver(
      driverOptions(source, clock, worker, {
        attachSession: (attached) => {
          session = attached;
        },
      }),
    );
    const attachment = await driver.attach(createAttachOptions(map, [], errors));
    await advanceUntil(clock, map, () => session?.renderer.snapshot().acceptedRevision != null);
    vi.spyOn(requireSession(session).renderer, 'restoreActiveLayers').mockImplementation(() => {
      throw new Error('layer restoration failed');
    });

    map.replaceStyle();
    await advanceUntil(clock, map, () => errors.length === 1);

    expect(errors[0]).toEqual(new Error('layer restoration failed'));
    attachment.dispose();
  });

  it('retries a transient overlay setup refusal without another style load event', async () => {
    const source = new TestDocumentSource(readySnapshot(createReadySystem()));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const worker = createProjectionWorker();
    const errors: unknown[] = [];
    let session: DocumentMapSession | null = null;
    const driver = createDocumentMapDriver(
      driverOptions(source, clock, worker, {
        attachSession: (attached) => {
          session = attached;
        },
      }),
    );
    const attachment = await driver.attach(createAttachOptions(map, [], errors));
    await advanceUntil(clock, map, () => session?.renderer.snapshot().acceptedRevision != null);
    await drainDocumentDriver(clock, map);
    map.failNextOverlaySetup = true;
    const recoveryVersion = requireSession(session).renderer.recoveryVersion();

    map.replaceStyle();
    await advanceUntil(
      clock,
      map,
      () => requireSession(session).renderer.recoveryVersion() > recoveryVersion + 1,
    );

    expect(errors).toEqual([]);
    expect(map.sourceCount()).toBeGreaterThan(0);
    await expect(requireSession(session).renderer.whenRecoverySettled()).resolves.toBeUndefined();
    attachment.dispose();
  });

  it('contains retained-style rescheduling failures', async () => {
    const initial = createReadySystem();
    const source = new TestDocumentSource(readySnapshot(initial));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    let request = 0;
    const worker = createProjectionWorker(() => {
      request += 1;
      return request === 2
        ? Promise.reject(new Error('replacement failed'))
        : Promise.resolve({ features: projectedWayFeatures('system'), counts: null });
    });
    const errors: unknown[] = [];
    let session: DocumentMapSession | null = null;
    const driver = createDocumentMapDriver(
      driverOptions(source, clock, worker, {
        attachSession: (attached) => {
          session = attached;
        },
      }),
    );
    const attachment = await driver.attach(createAttachOptions(map, [], errors));
    await advanceUntil(clock, map, () => session?.renderer.snapshot().acceptedRevision != null);
    source.publish(readySnapshot({ ...initial, ways: [...initial.ways] }));
    await advanceUntil(clock, map, () => errors.length === 1);
    const scheduleFrame = clock.scheduleFrame;
    vi.spyOn(requireSession(session).renderer, 'restoreActiveLayers').mockImplementation(() => {
      vi.spyOn(clock, 'scheduleFrame').mockImplementationOnce(() => {
        throw new Error('requeue failed');
      });
    });

    map.replaceStyle();
    await advanceUntil(clock, map, () => errors.length === 2);

    expect(errors[1]).toEqual(new Error('requeue failed'));
    clock.scheduleFrame = scheduleFrame;
    attachment.dispose();
  });

  it('rolls back renderer resources when the source subscription throws', async () => {
    const source = new TestDocumentSource(readySnapshot(createReadySystem()));
    vi.spyOn(source, 'subscribe').mockImplementation(() => {
      throw new Error('source subscription failed');
    });
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const worker = createProjectionWorker();
    const driver = createDocumentMapDriver(driverOptions(source, clock, worker));

    await expect(driver.attach(createAttachOptions(map, [], []))).rejects.toThrow(
      'source subscription failed',
    );

    expect(map.listenerCount()).toBe(0);
    expect(worker.dispose).toHaveBeenCalledOnce();
  });

  it('rejects early host setup failures before it creates a projection worker', async () => {
    const source = new TestDocumentSource(readySnapshot(createReadySystem()));
    const map = new TestDocumentMap();
    vi.spyOn(map, 'getBounds').mockImplementation(() => {
      throw new Error('map presentation failed');
    });
    const clock = new DocumentDriverClock();
    const worker = createProjectionWorker();
    const createWorker = vi.fn(() => worker);
    const driver = createDocumentMapDriver(
      driverOptions(source, clock, worker, { createFeatureProjectionWorker: createWorker }),
    );

    await expect(driver.attach(createAttachOptions(map, [], []))).rejects.toThrow(
      'map presentation failed',
    );

    expect(createWorker).not.toHaveBeenCalled();
    expect(map.listenerCount()).toBe(0);
  });

  it('rolls back the source subscription when the view subscription throws', async () => {
    const source = new TestDocumentSource(readySnapshot(createReadySystem()));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const worker = createProjectionWorker();
    const viewStore = createMapViewStore({
      schemaVersion: 1,
      camera: { center: [-115.18, 36.14], zoom: 10 },
      representationId: 'network',
      filters: {},
    });
    vi.spyOn(viewStore, 'subscribe').mockImplementation(() => {
      throw new Error('view subscription failed');
    });
    const driver = createDocumentMapDriver(driverOptions(source, clock, worker));

    await expect(driver.attach(createAttachOptions(map, [], [], { viewStore }))).rejects.toThrow(
      'view subscription failed',
    );

    expect(source.listenerCount()).toBe(0);
    expect(map.listenerCount()).toBe(0);
    expect(worker.dispose).toHaveBeenCalledOnce();
  });

  it('suppresses stale subscription, projection, callback, and error work after abort', async () => {
    const source = new TestDocumentSource({
      status: 'loading',
      system: aSystem({ id: 'loading' }),
    });
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const worker = createProjectionWorker();
    const milestones: string[] = [];
    const errors: unknown[] = [];
    const controller = new AbortController();
    const callback = vi.fn();
    const driver = createDocumentMapDriver(
      driverOptions(source, clock, worker, { attachSession: callback }),
    );
    const attachment = await driver.attach(
      createAttachOptions(map, milestones, errors, { signal: controller.signal }),
    );

    source.publish(readySnapshot(createReadySystem()));
    controller.abort();
    clock.flushOne(map);
    await Promise.resolve();
    source.publish(readySnapshot(createReadySystem('late')));

    expect(worker.project).not.toHaveBeenCalled();
    expect(worker.dispose).toHaveBeenCalledOnce();
    expect(source.listenerCount()).toBe(0);
    expect(milestones).toEqual([]);
    expect(errors).toEqual([]);
    expect(callback).toHaveBeenCalledOnce();
    attachment.dispose();
    expect(worker.dispose).toHaveBeenCalledOnce();
  });

  it('does not create renderer resources when attach receives an aborted signal', async () => {
    const source = new TestDocumentSource(readySnapshot(createReadySystem()));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const worker = createProjectionWorker();
    const controller = new AbortController();
    controller.abort();
    const driver = createDocumentMapDriver(driverOptions(source, clock, worker));

    const attachment = await driver.attach(
      createAttachOptions(map, [], [], { signal: controller.signal }),
    );

    expect(source.listenerCount()).toBe(0);
    expect(map.sourceCount()).toBe(0);
    expect(worker.project).not.toHaveBeenCalled();
    expect(worker.dispose).not.toHaveBeenCalled();
    await expect(
      attachment.resolveFeature(
        { source: 'document', kind: 'way', id: 'road' },
        new AbortController().signal,
      ),
    ).resolves.toBeNull();
    attachment.dispose();
  });

  it('disposes resources when the extension aborts during attachment', async () => {
    const source = new TestDocumentSource(readySnapshot(aSystem({ id: 'empty' })));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const worker = createProjectionWorker();
    const controller = new AbortController();
    const extensionDispose = vi.fn();
    const driver = createDocumentMapDriver(
      driverOptions(source, clock, worker, {
        attachSession: () => {
          controller.abort();
          return { dispose: extensionDispose };
        },
      }),
    );

    const attachment = await driver.attach(
      createAttachOptions(map, [], [], { signal: controller.signal }),
    );

    expect(source.listenerCount()).toBe(0);
    expect(extensionDispose).toHaveBeenCalledOnce();
    expect(worker.dispose).toHaveBeenCalledOnce();
    attachment.dispose();
    expect(extensionDispose).toHaveBeenCalledOnce();
  });

  it('ignores a projection rejection that settles after its attachment aborts', async () => {
    const source = new TestDocumentSource(readySnapshot(createReadySystem()));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    let rejectProjection: (error: Error) => void = () => {
      throw new Error('Projection did not start.');
    };
    const worker = createProjectionWorker(
      () =>
        new Promise((_, reject) => {
          rejectProjection = reject;
        }),
    );
    const errors: unknown[] = [];
    const controller = new AbortController();
    const driver = createDocumentMapDriver(driverOptions(source, clock, worker));
    const attachment = await driver.attach(
      createAttachOptions(map, [], errors, { signal: controller.signal }),
    );
    await advanceUntil(clock, map, () => worker.project.mock.calls.length === 1);

    controller.abort();
    rejectProjection(new Error('stale projection failed'));
    await Promise.resolve();
    await Promise.resolve();

    expect(errors).toEqual([]);
    expect(worker.dispose).toHaveBeenCalledOnce();
    attachment.dispose();
  });

  it('contains an accepted-scene listener failure without rolling back the scene', async () => {
    const source = new TestDocumentSource(readySnapshot(createReadySystem()));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const worker = createProjectionWorker((input) =>
      Promise.resolve({ features: projectedWayFeatures(input.system.id), counts: null }),
    );
    const errors: unknown[] = [];
    let session: DocumentMapSession | null = null;
    const driver = createDocumentMapDriver(
      driverOptions(source, clock, worker, {
        attachSession: (attached) => {
          session = attached;
          attached.subscribeAcceptedScene(() => {
            throw new Error('host listener failed');
          });
        },
      }),
    );
    const attachment = await driver.attach(createAttachOptions(map, [], errors));
    await advanceUntil(clock, map, () => session?.renderer.snapshot().acceptedRevision != null);

    expect(errors).toHaveLength(1);
    expect(requireSession(session).renderer.snapshot().acceptedRevision).toMatch(/^system:/);
    attachment.dispose();
  });

  it('disposes its extension exactly once before it disposes the renderer', async () => {
    const source = new TestDocumentSource(readySnapshot(aSystem({ id: 'empty' })));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const worker = createProjectionWorker();
    const milestones: string[] = [];
    const errors: unknown[] = [];
    const order: string[] = [];
    const extensionDispose = vi.fn(() => order.push('extension'));
    const driver = createDocumentMapDriver(
      driverOptions(source, clock, worker, {
        attachSession: (session) => {
          const disposeRenderer = session.renderer.dispose.bind(session.renderer);
          vi.spyOn(session.renderer, 'dispose').mockImplementation(() => {
            order.push('renderer');
            disposeRenderer();
          });
          return { dispose: extensionDispose };
        },
      }),
    );
    const attachment = await driver.attach(createAttachOptions(map, milestones, errors));

    attachment.dispose();
    attachment.dispose();

    expect(order.slice(0, 2)).toEqual(['extension', 'renderer']);
    expect(extensionDispose).toHaveBeenCalledOnce();
    expect(worker.dispose).toHaveBeenCalledOnce();
  });

  it('contains every cleanup failure and continues in lifecycle order exactly once', async () => {
    const source = new TestDocumentSource(readySnapshot(createReadySystem()));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const worker = createProjectionWorker();
    const errors: unknown[] = [];
    const order: string[] = [];
    const viewStore = createMapViewStore({
      schemaVersion: 1,
      camera: { center: [-115.18, 36.14], zoom: 10 },
      representationId: 'network',
      filters: {},
    });
    const subscribeSource = source.subscribe;
    vi.spyOn(source, 'subscribe').mockImplementation((listener) => {
      const unsubscribe = subscribeSource(listener);
      return () => {
        unsubscribe();
        order.push('source');
        throw new Error('source cleanup failed');
      };
    });
    const subscribeView = viewStore.subscribe.bind(viewStore);
    vi.spyOn(viewStore, 'subscribe').mockImplementation((listener) => {
      const unsubscribe = subscribeView(listener);
      return () => {
        unsubscribe();
        order.push('view');
        throw new Error('view cleanup failed');
      };
    });
    const mapOff = map.off.bind(map);
    vi.spyOn(map, 'off').mockImplementation((type, listener) => {
      const result = mapOff(type, listener);
      if (type === 'move') {
        order.push('map');
        throw new Error('map cleanup failed');
      }
      return result;
    });
    const cancelFrame = clock.cancelFrame;
    vi.spyOn(clock, 'cancelFrame').mockImplementation((handle) => {
      cancelFrame(handle);
      order.push('scheduler');
      throw new Error('scheduler cleanup failed');
    });
    worker.dispose.mockImplementation(() => {
      order.push('worker');
      throw new Error('worker cleanup failed');
    });
    let session: DocumentMapSession | null = null;
    const driver = createDocumentMapDriver(
      driverOptions(source, clock, worker, {
        attachSession: (attached) => {
          session = attached;
          return {
            dispose: () => {
              order.push('extension');
              throw new Error('extension cleanup failed');
            },
          };
        },
      }),
    );
    const attachment = await driver.attach(createAttachOptions(map, [], errors, { viewStore }));
    await advanceUntil(clock, map, () => session?.renderer.snapshot().acceptedRevision != null);
    const disposeRenderer = requireSession(session).renderer.dispose.bind(
      requireSession(session).renderer,
    );
    vi.spyOn(requireSession(session).renderer, 'dispose').mockImplementation(() => {
      disposeRenderer();
      order.push('renderer');
      throw new Error('renderer cleanup failed');
    });
    map.emit('move');

    attachment.dispose();
    attachment.dispose();

    expect(order).toEqual([
      'source',
      'view',
      'map',
      'scheduler',
      'extension',
      'renderer',
      'worker',
    ]);
    expect(errors).toHaveLength(7);
    expect(source.listenerCount()).toBe(0);
    expect(map.listenerCount()).toBe(0);
    expect(clock.frames.size).toBe(0);
    expect(worker.dispose).toHaveBeenCalledOnce();
  });

  it('resolves reader-safe details from the current immutable document or returns null', async () => {
    const system = aSystem({
      id: 'details',
      stops: [
        { id: 'stop-1', name: 'Bonneville Transit Center', coord: [-115.15, 36.17], anchors: [] },
      ],
    });
    const source = new TestDocumentSource(readySnapshot(system));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const worker = createProjectionWorker();
    const driver = createDocumentMapDriver(driverOptions(source, clock, worker));
    const attachment = await driver.attach(createAttachOptions(map, [], []));

    await expect(
      attachment.resolveFeature(
        { source: 'document', kind: 'stop', id: 'stop-1' },
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      reference: { source: 'document', kind: 'stop', id: 'stop-1' },
      title: 'Bonneville Transit Center',
      fields: [],
    });
    await expect(
      attachment.resolveFeature(
        { source: 'document', kind: 'stop', id: 'missing' },
        new AbortController().signal,
      ),
    ).resolves.toBeNull();
    await expect(
      attachment.resolveFeature(
        { source: 'published', kind: 'stop', id: 'stop-1' },
        new AbortController().signal,
      ),
    ).resolves.toBeNull();
    await expect(
      attachment.resolveFeature(
        { source: 'document', kind: 'future-kind', id: 'stop-1' },
        new AbortController().signal,
      ),
    ).resolves.toBeNull();
    attachment.dispose();
  });
});
