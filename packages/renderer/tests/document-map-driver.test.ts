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
import { LYR_WAYS_SOLID, SRC_STATIONS, SRC_WAYS } from '../src/layers/constants';
import {
  DocumentDriverClock,
  TestDocumentMap,
  TestDocumentSource,
  advanceUntil,
  createAttachOptions,
  createProjectionWorker,
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
      selection: null,
    });
    expect(milestones).toEqual(['content', 'interactive']);
    expect(errors).toEqual([]);

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

  it('updates filters and schedules representation and camera work without replacing its session', async () => {
    const source = new TestDocumentSource(readySnapshot(createReadySystem()));
    const map = new TestDocumentMap();
    const clock = new DocumentDriverClock();
    const worker = createProjectionWorker();
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

    source.publish(readySnapshot({ ...initial, name: 'Replacement' }));
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

    source.publish(readySnapshot({ ...initial, name: 'Replacement' }));
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
