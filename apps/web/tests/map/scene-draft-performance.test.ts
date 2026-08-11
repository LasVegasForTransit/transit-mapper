import { describe, expect, it } from 'vitest';
import type {
  Feature,
  Geometry,
  GeometryCollection,
  LineString,
  MultiPolygon,
  Polygon,
} from 'geojson';
import type { RenderViewOptions } from '@transitmapper/core/render/buildFeatures';
import {
  renderDomainIdentity,
  renderFeatureId,
  type RenderFeatureId,
} from '@transitmapper/core/render/render-identity';
import { renderPresentationForViewport } from '@transitmapper/core/render/render-presentation';
import {
  createCooperativeRenderJobScheduler,
  type CooperativeRenderJobSchedulerStats,
} from '../../src/map/cooperative-render-job-scheduler';
import { SRC_FOOTPRINTS, SRC_STATIONS, SRC_WAYS } from '../../src/map/layers';
import { persistentRenderOverlayDiagnostics } from '../../src/map/persistent-render-source-state';
import { buildFeaturesForSources } from '../../src/map/sourceFeatureProjection';
import { publishSceneDraft } from '../../src/map/scene-publication';
import {
  COMMITTED_SYSTEM_FEATURE_SOURCES,
  SYSTEM_FEATURE_NAME_BY_SOURCE,
  SYSTEM_FEATURE_SOURCE_BY_NAME,
} from '../../src/map/system-feature-sources';
import { generatePerfFixture } from '../../src/perf/fixtures';
import {
  controllerFixture,
  emptySystemFeatures,
  lineFeature,
  runUnits,
} from '../support/scene-draft.test';

class RealTimeFrameQueue {
  private nextHandle = 1;
  private readonly frames = new Map<number, () => void>();

  schedule = (callback: () => void): number => {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.frames.set(handle, callback);
    return handle;
  };

  cancel = (handle: number): void => {
    this.frames.delete(handle);
  };

  flushOne(): void {
    const entry = this.frames.entries().next();
    if (entry.done) return;
    this.frames.delete(entry.value[0]);
    entry.value[1]();
  }
}

async function flushUntilSettled(queue: RealTimeFrameQueue, settled: Promise<void>): Promise<void> {
  const state = { complete: false };
  const observed = settled.finally(() => {
    state.complete = true;
  });
  for (let frame = 0; !state.complete && frame < 10_000; frame += 1) {
    queue.flushOne();
    await Promise.resolve();
  }
  if (!state.complete) throw new Error('The staged RTC renderer did not settle.');
  await observed;
}

// Vitest files share CPU with package/Turbo workers, so performance.now()
// includes unrelated preemption and cannot be a deterministic correctness
// assertion here. Fake-clock scheduler tests enforce the 2/4 ms policy; the
// isolated browser perf protocol owns real wall-clock acceptance. These cases
// instead constrain work and allocation shape on production-sized inputs.
describe('scene draft performance', () => {
  it.each(['incremental', 'reset'] as const)(
    'compares a freshly cloned 200,000-point same-ID replacement in bounded units for %s',
    (intent) => {
      const fixture = controllerFixture();
      const waysSource = SYSTEM_FEATURE_SOURCE_BY_NAME.ways;
      const featureId = renderFeatureId(waysSource, 'overview', ['huge-replacement']);
      const originalCoordinates = Array.from(
        { length: 200_000 },
        (_, index) => [index / 10_000, index % 2] as [number, number],
      );
      const initial = emptySystemFeatures();
      initial.ways.features.push({
        type: 'Feature',
        id: featureId,
        properties: { id: 'huge-replacement', renderTier: 'overview' },
        geometry: { type: 'LineString', coordinates: originalCoordinates },
      });
      fixture.controller.applySynchronously({
        revision: 'huge-before',
        features: initial,
        sourceIds: [SRC_WAYS],
      });
      fixture.source(waysSource).calls.length = 0;

      let coordinateReads = 0;
      const clonedCoordinates = new Proxy(
        originalCoordinates.map(([x, y], index) =>
          index === originalCoordinates.length - 1 ? ([x + 1, y] as [number, number]) : [x, y],
        ),
        {
          get(target, property, receiver) {
            if (typeof property === 'string' && /^\d+$/.test(property)) coordinateReads += 1;
            return Reflect.get(target, property, receiver) as unknown;
          },
        },
      );
      const changed = emptySystemFeatures();
      changed.ways.features.push({
        type: 'Feature',
        id: featureId,
        properties: { id: 'huge-replacement', renderTier: 'overview' },
        geometry: { type: 'LineString', coordinates: clonedCoordinates },
      });
      const plan = fixture.controller.draft(
        {
          revision: `huge-${intent}`,
          features: changed,
          sourceIds: [SRC_WAYS],
          intent,
        },
        { batchSize: 1 },
      );
      const unitIds: string[] = [];
      let maxCoordinateReadsPerUnit = 0;
      for (let index = 0; ; index += 1) {
        const unit = plan.units.unitAt(index);
        if (!unit) break;
        coordinateReads = 0;
        unit.run();
        unitIds.push(unit.id);
        maxCoordinateReadsPerUnit = Math.max(maxCoordinateReadsPerUnit, coordinateReads);
      }

      const update = fixture.controller.publishDraftSynchronously(plan.result());

      expect(maxCoordinateReadsPerUnit).toBeLessThanOrEqual(4_096);
      if (intent === 'incremental') {
        expect(unitIds.filter((id) => id.includes(':compare:')).length).toBeGreaterThan(1);
        expect(update.changedFeatureCount).toBe(1);
        expect(fixture.source(waysSource).calls.at(-1)).toMatchObject({
          method: 'updateData',
          data: { add: [expect.objectContaining({ id: featureId })] },
        });
      } else {
        expect(unitIds.some((id) => id.includes(':compare:'))).toBe(false);
        expect(fixture.source(waysSource).calls.at(-1)).toMatchObject({
          method: 'setData',
          data: { features: [expect.objectContaining({ id: featureId })] },
        });
      }
      expect(
        fixture.controller.acceptedScene()?.featuresBySource.get(waysSource)?.features[0]?.geometry,
      ).toEqual({ type: 'LineString', coordinates: clonedCoordinates });
    },
    30_000,
  );

  it('leaves an equal freshly cloned 200,000-point same-ID source untouched', () => {
    const fixture = controllerFixture();
    const waysSource = SYSTEM_FEATURE_SOURCE_BY_NAME.ways;
    const featureId = renderFeatureId(waysSource, 'overview', ['huge-equal']);
    const coordinates = Array.from(
      { length: 200_000 },
      (_, index) => [index / 10_000, index % 2] as [number, number],
    );
    const initial = emptySystemFeatures();
    initial.ways.features.push({
      type: 'Feature',
      id: featureId,
      properties: { id: 'huge-equal', renderTier: 'overview' },
      geometry: { type: 'LineString', coordinates },
    });
    fixture.controller.applySynchronously({
      revision: 'equal-before',
      features: initial,
      sourceIds: [SRC_WAYS],
    });
    fixture.source(waysSource).calls.length = 0;
    let coordinateReads = 0;
    const clonedCoordinates = new Proxy(
      coordinates.map(([x, y]) => [x, y] as [number, number]),
      {
        get(target, property, receiver) {
          if (typeof property === 'string' && /^\d+$/.test(property)) coordinateReads += 1;
          return Reflect.get(target, property, receiver) as unknown;
        },
      },
    );
    const cloned = emptySystemFeatures();
    cloned.ways.features.push({
      type: 'Feature',
      id: featureId,
      properties: { id: 'huge-equal', renderTier: 'overview' },
      geometry: { type: 'LineString', coordinates: clonedCoordinates },
    });
    const plan = fixture.controller.draft(
      { revision: 'equal-after', features: cloned, sourceIds: [SRC_WAYS] },
      { batchSize: 1 },
    );
    let maxCoordinateReadsPerUnit = 0;
    let comparisonUnitCount = 0;
    for (let index = 0; ; index += 1) {
      const unit = plan.units.unitAt(index);
      if (!unit) break;
      coordinateReads = 0;
      unit.run();
      maxCoordinateReadsPerUnit = Math.max(maxCoordinateReadsPerUnit, coordinateReads);
      if (unit.id.includes(':compare:')) comparisonUnitCount += 1;
    }

    const update = fixture.controller.publishDraftSynchronously(plan.result());

    expect(maxCoordinateReadsPerUnit).toBeLessThanOrEqual(4_096);
    expect(comparisonUnitCount).toBeGreaterThan(1);
    expect(update.strategy).toBe('none');
    expect(fixture.source(waysSource).calls).toEqual([]);
  }, 30_000);

  it('stages single huge paths without coordinate-proportional work units', async () => {
    const fixture = controllerFixture();
    const waysSource = SYSTEM_FEATURE_SOURCE_BY_NAME.ways;
    const footprintsSource = SYSTEM_FEATURE_SOURCE_BY_NAME.footprints;
    const lineId = renderFeatureId(waysSource, 'overview', ['huge-line']);
    const polygonId = renderFeatureId(footprintsSource, 'overview', ['huge-polygon']);
    const coordinates = Array.from(
      { length: 200_000 },
      (_, index) => [index / 10_000, index % 2] as [number, number],
    );
    const hugeLine: Feature<LineString> = {
      type: 'Feature',
      id: lineId,
      properties: { id: 'huge-line', renderTier: 'overview' },
      geometry: { type: 'LineString', coordinates },
    };
    const hugePolygon: Feature<Polygon> = {
      type: 'Feature',
      id: polygonId,
      properties: { stationId: 'huge-polygon', renderTier: 'overview' },
      geometry: { type: 'Polygon', coordinates: [coordinates] },
    };
    const initial = emptySystemFeatures();
    initial.ways.features.push(hugeLine);
    initial.footprints.features.push(hugePolygon);
    const frames = new RealTimeFrameQueue();
    const scheduler = createCooperativeRenderJobScheduler({
      now: () => performance.now(),
      scheduleFrame: frames.schedule,
      cancelFrame: frames.cancel,
    });
    const initialAttempts: CooperativeRenderJobSchedulerStats[] = [];
    const initialSubmission = publishSceneDraft({
      scheduler,
      controller: fixture.controller,
      input: {
        revision: 'huge-initial',
        features: initial,
        sourceIds: [SRC_WAYS, SRC_FOOTPRINTS],
      },
      batchSize: 1,
      recordScheduling: (stats) => initialAttempts.push(stats),
    });
    await flushUntilSettled(frames, initialSubmission.settled);

    const changed = emptySystemFeatures();
    changed.ways.features.push({
      ...hugeLine,
      properties: { ...hugeLine.properties, changed: true },
    });
    changed.footprints.features.push({
      ...hugePolygon,
      properties: { ...hugePolygon.properties, changed: true },
    });
    const scopedAttempts: CooperativeRenderJobSchedulerStats[] = [];
    const scopedSubmission = publishSceneDraft({
      scheduler,
      controller: fixture.controller,
      input: {
        revision: 'huge-scoped',
        features: changed,
        sourceIds: [SRC_WAYS, SRC_FOOTPRINTS],
        replacementDomainsBySource: new Map([
          [SRC_WAYS, [renderDomainIdentity('way', 'huge-line')]],
          [SRC_FOOTPRINTS, [renderDomainIdentity('station', 'huge-polygon')]],
        ]),
      },
      batchSize: 1,
      recordScheduling: (stats) => scopedAttempts.push(stats),
    });
    await flushUntilSettled(frames, scopedSubmission.settled);

    for (const attempt of [initialAttempts.at(-1), scopedAttempts.at(-1)]) {
      expect(attempt?.committedJobCount).toBe(1);
      expect(attempt?.unitRunCount).toBeLessThan(100);
      expect(attempt?.maxUnitDurationMs).toBeGreaterThanOrEqual(0);
    }
  }, 30_000);

  it.each([
    {
      geometryType: 'MultiPolygon',
      createGeometry: (recordRead: () => void): Geometry => {
        const coordinates: MultiPolygon['coordinates'] = Array.from({ length: 2_000 }, () => [
          [
            [0, 0],
            [1, 0],
            [0, 0],
          ],
        ]);
        return {
          type: 'MultiPolygon',
          coordinates: new Proxy(coordinates, {
            get(target, property, receiver) {
              if (typeof property === 'string' && /^\d+$/.test(property)) recordRead();
              return Reflect.get(target, property, receiver) as unknown;
            },
          }),
        };
      },
    },
    {
      geometryType: 'GeometryCollection',
      createGeometry: (recordRead: () => void): Geometry => {
        const geometries: GeometryCollection['geometries'] = Array.from(
          { length: 2_000 },
          (_, index): Geometry => ({
            type: 'LineString',
            coordinates: [
              [index, 0],
              [index + 1, 0],
            ],
          }),
        );
        return {
          type: 'GeometryCollection',
          geometries: new Proxy(geometries, {
            get(target, property, receiver) {
              if (typeof property === 'string' && /^\d+$/.test(property)) recordRead();
              return Reflect.get(target, property, receiver) as unknown;
            },
          }),
        };
      },
    },
  ])('counts one $geometryType across bounded normalization units', ({ createGeometry }) => {
    const fixture = controllerFixture();
    const waysSource = SYSTEM_FEATURE_SOURCE_BY_NAME.ways;
    let aggregateReads = 0;
    const features = emptySystemFeatures();
    features.ways.features.push({
      type: 'Feature',
      id: renderFeatureId(waysSource, 'overview', ['aggregate']),
      properties: { id: 'aggregate', renderTier: 'overview' },
      geometry: createGeometry(() => {
        aggregateReads += 1;
      }),
    } as Feature<LineString>);
    const plan = fixture.controller.draft(
      { revision: 'aggregate-normalization', features, sourceIds: [SRC_WAYS] },
      { batchSize: 1 },
    );
    let descriptorReads = 0;
    let maxUnitReads = 0;
    const ids: string[] = [];
    for (let index = 0; ; index += 1) {
      aggregateReads = 0;
      const unit = plan.units.unitAt(index);
      descriptorReads += aggregateReads;
      if (!unit) break;
      aggregateReads = 0;
      unit.run();
      maxUnitReads = Math.max(maxUnitReads, aggregateReads);
      ids.push(unit.id);
    }

    expect(descriptorReads).toBe(0);
    expect(maxUnitReads).toBeLessThanOrEqual(512);
    expect(ids.filter((id) => id.includes(':stats:')).length).toBeGreaterThan(1);
  });

  it('removes aggregate geometry from cached stats without revisiting its parts', () => {
    const fixture = controllerFixture();
    const waysSource = SYSTEM_FEATURE_SOURCE_BY_NAME.ways;
    let polygonReads = 0;
    const polygons = new Proxy(
      Array.from({ length: 2_000 }, () => [
        [
          [0, 0],
          [1, 0],
          [0, 0],
        ],
      ]),
      {
        get(target, property, receiver) {
          if (typeof property === 'string' && /^\d+$/.test(property)) polygonReads += 1;
          return Reflect.get(target, property, receiver) as unknown;
        },
      },
    );
    const initial = emptySystemFeatures();
    initial.ways.features.push({
      type: 'Feature',
      id: renderFeatureId(waysSource, 'overview', ['removed-aggregate']),
      properties: { id: 'removed-aggregate', renderTier: 'overview' },
      geometry: { type: 'MultiPolygon', coordinates: polygons },
    } as unknown as Feature<LineString>);
    fixture.controller.applySynchronously({
      revision: 'aggregate-before-removal',
      features: initial,
      sourceIds: [SRC_WAYS],
    });
    polygonReads = 0;
    const plan = fixture.controller.draft(
      {
        revision: 'aggregate-after-removal',
        features: emptySystemFeatures(),
        sourceIds: [SRC_WAYS],
        replacementDomainsBySource: new Map([
          [SRC_WAYS, [renderDomainIdentity('way', 'removed-aggregate')]],
        ]),
      },
      { batchSize: 1 },
    );
    let maxUnitReads = 0;
    for (let index = 0; ; index += 1) {
      const unit = plan.units.unitAt(index);
      if (!unit) break;
      polygonReads = 0;
      unit.run();
      maxUnitReads = Math.max(maxUnitReads, polygonReads);
    }

    expect(maxUnitReads).toBe(0);
  });

  it('stages a scoped edit in work proportional to the replacement closure', () => {
    const fixture = controllerFixture();
    const waysSource = SYSTEM_FEATURE_SOURCE_BY_NAME.ways;
    const initial = emptySystemFeatures();
    for (let index = 0; index < 2_000; index += 1) {
      const wayId = `way-${String(index).padStart(4, '0')}`;
      initial.ways.features.push(
        lineFeature(renderFeatureId(waysSource, 'overview', [wayId]), wayId, index * 2),
      );
    }
    fixture.controller.applySynchronously({
      revision: 'large-source',
      features: initial,
      sourceIds: [SRC_WAYS],
    });

    const changedWayId = 'way-1000';
    const changedFeatureId = renderFeatureId(waysSource, 'overview', [changedWayId]);
    const partial = emptySystemFeatures();
    partial.ways.features.push(lineFeature(changedFeatureId, changedWayId, 99_000));
    const plan = fixture.controller.draft(
      {
        revision: 'one-domain-edit',
        features: partial,
        sourceIds: [SRC_WAYS],
        replacementDomainsBySource: new Map([
          [SRC_WAYS, [renderDomainIdentity('way', changedWayId)]],
        ]),
      },
      { batchSize: 1 },
    );

    const { ids } = runUnits(plan.units);

    expect(ids.length).toBeLessThan(100);
    expect(ids).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining('scope:filter-visual'),
        expect.stringContaining('scope:copy-domains'),
      ]),
    );
  });

  it('rebuilds scoped hit collections without materializing retained hits in a descriptor', () => {
    const fixture = controllerFixture();
    const waysSource = SYSTEM_FEATURE_SOURCE_BY_NAME.ways;
    const initial = emptySystemFeatures();
    for (let index = 0; index < 2_000; index += 1) {
      const wayId = `hit-way-${String(index).padStart(4, '0')}`;
      initial.ways.features.push(
        lineFeature(renderFeatureId(waysSource, 'hit', [wayId]), wayId, index * 2, {
          hitTarget: true,
        }),
      );
    }
    const warm = fixture.controller.draft(
      { revision: 'large-hit-source', features: initial, sourceIds: [SRC_WAYS] },
      { batchSize: 1 },
    );
    runUnits(warm.units);
    const warmPrepared = warm.result();
    fixture.controller.publishDraftSynchronously(warmPrepared);
    const retainedState = warmPrepared.state.sourceStates.get(waysSource);
    if (!retainedState) throw new Error('Large hit source has no retained state.');
    const retainedHits = retainedState.hits.features;
    let retainedFeatureReads = 0;
    const observedHits = new Proxy(retainedHits, {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property)) retainedFeatureReads += 1;
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    Object.defineProperty(retainedState.hits, 'features', {
      configurable: true,
      get: () => observedHits,
    });

    const changedWayId = 'hit-way-1000';
    const partial = emptySystemFeatures();
    partial.ways.features.push(
      lineFeature(renderFeatureId(waysSource, 'hit', [changedWayId]), changedWayId, 99_000, {
        hitTarget: true,
      }),
    );
    const plan = fixture.controller.draft(
      {
        revision: 'one-hit-domain-edit',
        features: partial,
        sourceIds: [SRC_WAYS],
        replacementDomainsBySource: new Map([
          [SRC_WAYS, [renderDomainIdentity('way', changedWayId)]],
        ]),
      },
      { batchSize: 1 },
    );
    let descriptorReads = 0;
    let maxUnitReads = 0;
    for (let index = 0; ; index += 1) {
      retainedFeatureReads = 0;
      const unit = plan.units.unitAt(index);
      descriptorReads += retainedFeatureReads;
      if (!unit) break;
      retainedFeatureReads = 0;
      unit.run();
      maxUnitReads = Math.max(maxUnitReads, retainedFeatureReads);
    }

    expect(descriptorReads).toBe(0);
    expect(maxUnitReads).toBeLessThanOrEqual(1);
    expect(plan.result().scene.hitFeatures.features).toHaveLength(2_000);
  });

  it('composes repeated scoped edits against one stable base with exact array materialization', () => {
    const fixture = controllerFixture();
    const waysSource = SYSTEM_FEATURE_SOURCE_BY_NAME.ways;
    const editedWayId = 'way-050';
    const editedFeatureId = renderFeatureId(waysSource, 'overview', [editedWayId]);
    const initial = emptySystemFeatures();
    for (let index = 0; index < 100; index += 1) {
      const wayId = `way-${String(index).padStart(3, '0')}`;
      initial.ways.features.push(
        lineFeature(renderFeatureId(waysSource, 'overview', [wayId]), wayId, index * 2),
      );
    }
    fixture.controller.applySynchronously({
      revision: 'base',
      features: initial,
      sourceIds: [SRC_WAYS],
    });

    for (let revision = 1; revision <= 200; revision += 1) {
      const partial = emptySystemFeatures();
      partial.ways.features.push(lineFeature(editedFeatureId, editedWayId, revision * 3));
      fixture.controller.applySynchronously({
        revision: `edit-${revision}`,
        features: partial,
        sourceIds: [SRC_WAYS],
        replacementDomainsBySource: new Map([
          [SRC_WAYS, [renderDomainIdentity('way', editedWayId)]],
        ]),
      });
    }

    for (let revision = 1; revision <= 50; revision += 1) {
      const transientWayId = `transient-${revision}`;
      const transientDomain = renderDomainIdentity('way', transientWayId);
      const addition = emptySystemFeatures();
      addition.ways.features.push(
        lineFeature(
          renderFeatureId(waysSource, 'overview', [transientWayId]),
          transientWayId,
          revision,
        ),
      );
      fixture.controller.applySynchronously({
        revision: `transient-add-${revision}`,
        features: addition,
        sourceIds: [SRC_WAYS],
        replacementDomainsBySource: new Map([[SRC_WAYS, [transientDomain]]]),
      });
      fixture.controller.applySynchronously({
        revision: `transient-remove-${revision}`,
        features: emptySystemFeatures(),
        sourceIds: [SRC_WAYS],
        replacementDomainsBySource: new Map([[SRC_WAYS, [transientDomain]]]),
      });
    }

    const collection = fixture.controller.acceptedScene()?.featuresBySource.get(waysSource);
    if (!collection) throw new Error('Repeated scoped scene has no way collection.');
    expect(persistentRenderOverlayDiagnostics(collection)).toEqual({
      depth: 1,
      deltaEntryCount: 1,
      lazy: true,
    });

    const ids = collection.features.map((feature) => feature.id);
    expect(Array.isArray(collection.features)).toBe(true);
    expect(ids).toHaveLength(100);
    expect(collection.features.filter((feature) => feature.id === editedFeatureId)).toHaveLength(1);
    expect([...collection.features].map((feature) => feature.id)).toEqual(ids);
    expect(
      JSON.parse(JSON.stringify(collection.features)) as Array<{ readonly id: string }>,
    ).toHaveLength(100);
    expect(collection.features.find((feature) => feature.id === editedFeatureId)?.geometry).toEqual(
      {
        type: 'LineString',
        coordinates: [
          [600, 0],
          [601, 0],
        ],
      },
    );

    const parityPartial = emptySystemFeatures();
    parityPartial.ways.features.push(lineFeature(editedFeatureId, editedWayId, 600));
    const parityPlan = fixture.controller.draft({
      revision: 'feature-id-array-parity',
      features: parityPartial,
      sourceIds: [SRC_WAYS],
      replacementDomainsBySource: new Map([[SRC_WAYS, [renderDomainIdentity('way', editedWayId)]]]),
    });
    runUnits(parityPlan.units);
    const featureIds = parityPlan.result().state.sourceStates.get(waysSource)?.featureIds;
    if (!featureIds) throw new Error('Scoped state has no feature ID array.');
    expect(Array.isArray(featureIds)).toBe(true);
    expect(featureIds.map((featureId) => featureId)).toEqual(ids);
    expect(featureIds.filter((featureId) => featureId === editedFeatureId)).toEqual([
      editedFeatureId,
    ]);
    expect([...featureIds]).toEqual(ids);
    expect(JSON.parse(JSON.stringify(featureIds)) as RenderFeatureId[]).toEqual(ids);
  });

  it('bounds committed RTC staging and one-station replacement structurally', async () => {
    const fixture = controllerFixture();
    const system = generatePerfFixture('rtc');
    const view: RenderViewOptions = {
      viewMode: 'network',
      visibleModes: new Set(['bus']),
      visibleWayTypes: new Set(['road']),
      presentation: renderPresentationForViewport({
        center: system.viewport.center,
        zoom: system.viewport.zoom,
        width: 1_440,
        height: 900,
      }),
    };
    const features = buildFeaturesForSources({
      system,
      selection: null,
      handleWayIds: [],
      view,
      sourceIds: COMMITTED_SYSTEM_FEATURE_SOURCES,
      selectionOwnedConnectors: false,
    });
    const warm = emptySystemFeatures();
    const firstSource = COMMITTED_SYSTEM_FEATURE_SOURCES.find(
      (sourceId) => features[SYSTEM_FEATURE_NAME_BY_SOURCE[sourceId]].features.length > 0,
    );
    if (!firstSource) throw new Error('RTC fixture projected no committed renderer features.');
    const firstName = SYSTEM_FEATURE_NAME_BY_SOURCE[firstSource];
    Object.assign(warm[firstName], { features: features[firstName].features.slice(0, 1) });
    fixture.controller.applySynchronously({
      revision: 'rtc-warm',
      features: warm,
      sourceIds: [firstSource],
    });

    const frames = new RealTimeFrameQueue();
    const attempts: CooperativeRenderJobSchedulerStats[] = [];
    const scheduler = createCooperativeRenderJobScheduler({
      now: () => performance.now(),
      scheduleFrame: frames.schedule,
      cancelFrame: frames.cancel,
    });
    const submission = publishSceneDraft({
      scheduler,
      controller: fixture.controller,
      input: {
        revision: 'rtc-staged',
        features,
        sourceIds: COMMITTED_SYSTEM_FEATURE_SOURCES,
      },
      batchSize: 8,
      recordScheduling: (stats) => attempts.push(stats),
    });
    await flushUntilSettled(frames, submission.settled);

    const committedAttempt = attempts.at(-1);
    const committedFeatureCount = COMMITTED_SYSTEM_FEATURE_SOURCES.reduce(
      (total, sourceId) =>
        total + features[SYSTEM_FEATURE_NAME_BY_SOURCE[sourceId]].features.length,
      0,
    );
    expect(committedAttempt?.committedJobCount).toBe(1);
    expect(committedAttempt?.unitRunCount).toBeLessThan(committedFeatureCount * 10 + 1_000);
    expect(attempts.length).toBeLessThanOrEqual(9);
    const committedScene = fixture.controller.acceptedScene();
    expect(committedScene?.revision).toBe('rtc-staged');

    const stationIds = new Set<RenderFeatureId>(
      features.stations.features.map((feature) => {
        if (typeof feature.id !== 'string') {
          throw new Error('RTC station projection has no stable string ID.');
        }
        return feature.id as RenderFeatureId;
      }),
    );
    const stationDomain = [...(committedScene?.identityIndex.renderFeatureIdsByDomain ?? [])].find(
      ([, featureIds]) => featureIds.some((featureId) => stationIds.has(featureId)),
    );
    if (!stationDomain) throw new Error('RTC fixture retained no station identity domain.');
    const scopedIds = new Set(stationDomain[1].filter((featureId) => stationIds.has(featureId)));
    const partial = emptySystemFeatures();
    partial.stations.features.push(
      ...features.stations.features
        .filter(
          (feature) =>
            typeof feature.id === 'string' && scopedIds.has(feature.id as RenderFeatureId),
        )
        .map((feature, index) =>
          index === 0
            ? { ...feature, properties: { ...feature.properties, scopedProbe: true } }
            : feature,
        ),
    );
    const scopedAttempts: CooperativeRenderJobSchedulerStats[] = [];
    const scopedSubmission = publishSceneDraft({
      scheduler,
      controller: fixture.controller,
      input: {
        revision: 'rtc-one-station',
        features: partial,
        sourceIds: [SRC_STATIONS],
        replacementDomainsBySource: new Map([[SRC_STATIONS, [stationDomain[0]]]]),
      },
      batchSize: 1,
      recordScheduling: (stats) => scopedAttempts.push(stats),
    });
    await flushUntilSettled(frames, scopedSubmission.settled);
    const scopedAttempt = scopedAttempts.at(-1);
    expect(scopedAttempt?.committedJobCount).toBe(1);
    expect(scopedAttempt?.unitRunCount).toBeLessThan(250);
    expect(scopedAttempts.length).toBeLessThanOrEqual(9);
  }, 30_000);
});
