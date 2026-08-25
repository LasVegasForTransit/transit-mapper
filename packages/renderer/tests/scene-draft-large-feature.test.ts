import type {
  Feature,
  Geometry,
  GeometryCollection,
  LineString,
  MultiPolygon,
  Polygon,
} from 'geojson';
import { describe, expect, it } from 'vitest';
import { renderDomainIdentity, renderFeatureId } from '@transitmapper/core/render/render-identity';
import {
  createCooperativeRenderJobScheduler,
  type CooperativeRenderJobSchedulerStats,
} from '../src/cooperative-render-job-scheduler';
import { SRC_FOOTPRINTS, SRC_WAYS } from '../src/layers/constants';
import { publishSceneDraft } from '../src/scene-publication';
import { SYSTEM_FEATURE_SOURCE_BY_NAME } from '../src/system-feature-sources';
import {
  controllerFixture,
  emptySystemFeatures,
  flushFrameQueueUntilSettled,
  ManualFrameQueue,
} from './support/scene-draft.test';

function hugeCoordinates(): [number, number][] {
  return Array.from(
    { length: 200_000 },
    (_, index) => [index / 10_000, index % 2] as [number, number],
  );
}

describe('scene draft large features', () => {
  it.each(['incremental', 'reset'] as const)(
    'compares a freshly cloned 200,000-point same-ID replacement in bounded units for %s',
    (intent) => {
      const fixture = controllerFixture();
      const waysSource = SYSTEM_FEATURE_SOURCE_BY_NAME.ways;
      const featureId = renderFeatureId(waysSource, 'overview', ['huge-replacement']);
      const originalCoordinates = hugeCoordinates();
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
    const coordinates = hugeCoordinates();
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
    const coordinates = hugeCoordinates();
    const hugeLine: Feature<LineString> = {
      type: 'Feature',
      id: renderFeatureId(waysSource, 'overview', ['huge-line']),
      properties: { id: 'huge-line', renderTier: 'overview' },
      geometry: { type: 'LineString', coordinates },
    };
    const hugePolygon: Feature<Polygon> = {
      type: 'Feature',
      id: renderFeatureId(footprintsSource, 'overview', ['huge-polygon']),
      properties: { stationId: 'huge-polygon', renderTier: 'overview' },
      geometry: { type: 'Polygon', coordinates: [coordinates] },
    };
    const initial = emptySystemFeatures();
    initial.ways.features.push(hugeLine);
    initial.footprints.features.push(hugePolygon);
    const frames = new ManualFrameQueue();
    const scheduler = createCooperativeRenderJobScheduler({
      now: () => performance.now(),
      scheduleFrame: frames.schedule,
      cancelFrame: frames.cancel,
    });
    const initialAttempts: CooperativeRenderJobSchedulerStats[] = [];
    const initialSubmission = publishSceneDraft({
      scheduler,
      controller: fixture.controller,
      input: { revision: 'huge-initial', features: initial, sourceIds: [SRC_WAYS, SRC_FOOTPRINTS] },
      batchSize: 1,
      recordScheduling: (stats) => initialAttempts.push(stats),
    });
    await flushFrameQueueUntilSettled(frames, initialSubmission.settled);

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
    await flushFrameQueueUntilSettled(frames, scopedSubmission.settled);

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
});
