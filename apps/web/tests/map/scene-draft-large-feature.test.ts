import type { Feature, LineString, Polygon } from 'geojson';
import { describe, expect, it } from 'vitest';
import { renderDomainIdentity, renderFeatureId } from '@transitmapper/core/render/render-identity';
import {
  createCooperativeRenderJobScheduler,
  type CooperativeRenderJobSchedulerStats,
} from '../../src/map/cooperative-render-job-scheduler';
import { SRC_FOOTPRINTS, SRC_WAYS } from '../../src/map/layers';
import { publishSceneDraft } from '../../src/map/scene-publication';
import { SYSTEM_FEATURE_SOURCE_BY_NAME } from '../../src/map/system-feature-sources';
import { controllerFixture, emptySystemFeatures } from '../support/scene-draft.test';

class RealTimeFrameQueue {
  private nextHandle = 1;
  private readonly frames = new Map<number, () => void>();

  schedule = (callback: () => void): number => {
    const handle = this.nextHandle++;
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
  if (!state.complete) throw new Error('The staged large-feature renderer did not settle.');
  await observed;
}

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
      input: { revision: 'huge-initial', features: initial, sourceIds: [SRC_WAYS, SRC_FOOTPRINTS] },
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
});
