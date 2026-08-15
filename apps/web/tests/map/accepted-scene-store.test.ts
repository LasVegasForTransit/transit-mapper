import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import { describe, expect, it } from 'vitest';
import {
  renderDomainIdentity,
  renderFeatureId,
  systemFeatureSourceId,
  type SystemFeatureSourceId,
} from '@transitmapper/core/render/render-identity';
import {
  createSceneDraftOperationCounts,
  createAcceptedSceneStore,
  type AcceptedSceneStore,
  type SceneDraftOperationCounts,
} from '../../src/map/accepted-scene-store';
import type {
  GeoJsonSourceTarget,
  GeoJsonSourceUpdate,
} from '../../src/map/render-scene-source-updater';
import {
  ALL_SYSTEM_FEATURE_SOURCES,
  emptySystemFeatures,
  SYSTEM_FEATURE_SOURCE_BY_NAME,
} from '../../src/map/system-feature-sources';
import { SRC_STATIONS, SRC_WAYS } from '../../src/map/layers';

type SourceCall =
  | { method: 'setData'; data: FeatureCollection }
  | { method: 'updateData'; data: GeoJsonSourceUpdate };

class RecordingSource implements GeoJsonSourceTarget {
  readonly calls: SourceCall[] = [];

  setData(data: FeatureCollection): void {
    this.calls.push({ method: 'setData', data });
  }

  updateData(data: GeoJsonSourceUpdate): void {
    this.calls.push({ method: 'updateData', data });
  }
}

function lineFeature(
  id: string,
  domainId: string,
  x: number,
  hitTarget = false,
): Feature<LineString> {
  return {
    type: 'Feature',
    id,
    properties: { id: domainId, hitTarget },
    geometry: {
      type: 'LineString',
      coordinates: [
        [x, 0],
        [x + 1, 0],
      ],
    },
  };
}

function isLineFeature(feature: Feature): feature is Feature<LineString> {
  return feature.geometry.type === 'LineString';
}

function stopFeature(id: string, stopId: string, x: number): Feature<Point> {
  return {
    type: 'Feature',
    id,
    properties: { id: stopId },
    geometry: { type: 'Point', coordinates: [x, 0] },
  };
}

interface ControllerFixture {
  controller: AcceptedSceneStore;
  source: (sourceId: SystemFeatureSourceId) => RecordingSource;
  hitSource: RecordingSource;
  clearCalls: () => void;
}

function controllerFixture(counts?: SceneDraftOperationCounts): ControllerFixture {
  const sources = new Map<SystemFeatureSourceId, RecordingSource>(
    Object.values(SYSTEM_FEATURE_SOURCE_BY_NAME).map((sourceId) => [
      sourceId,
      new RecordingSource(),
    ]),
  );
  const hitSource = new RecordingSource();
  const source = (sourceId: SystemFeatureSourceId): RecordingSource => {
    const target = sources.get(sourceId);
    if (!target) throw new Error(`Missing fixture source: ${sourceId}`);
    return target;
  };
  return {
    controller: createAcceptedSceneStore({
      resolveSource: source,
      resolveHitSource: () => hitSource,
      hitSourceId: 'tm-hit-features',
      ...(counts ? { counts } : {}),
    }),
    source,
    hitSource,
    clearCalls: () => {
      for (const target of sources.values()) target.calls.length = 0;
      hitSource.calls.length = 0;
    },
  };
}

describe('live render scene controller', () => {
  it('centralizes the complete web source map used by scene projection', () => {
    expect(ALL_SYSTEM_FEATURE_SOURCES).toHaveLength(16);
    expect(new Set(ALL_SYSTEM_FEATURE_SOURCES).size).toBe(16);
    expect(SYSTEM_FEATURE_SOURCE_BY_NAME.ways).toBe(systemFeatureSourceId(SRC_WAYS));
    expect(SYSTEM_FEATURE_SOURCE_BY_NAME.stops).toBe(systemFeatureSourceId(SRC_STATIONS));
  });

  it('uploads only nonempty sources for an initial partial projection and excludes hit-only IDs from state targets', () => {
    const fixture = controllerFixture();
    const partial = emptySystemFeatures();
    const waysSource = systemFeatureSourceId('ways');
    const visualId = renderFeatureId(waysSource, 'overview', ['way-a']);
    const hitId = renderFeatureId(waysSource, 'hit', ['way-a']);
    partial.ways.features.push(
      lineFeature(visualId, 'way-a', 0),
      lineFeature(hitId, 'way-a', 0, true),
    );

    const result = fixture.controller.applySynchronously({
      revision: 'revision-1',
      features: partial,
      sourceIds: [SRC_WAYS],
    });

    expect(result.strategy).toBe('full');
    expect(result.fullSourceUploadCount).toBe(2);
    expect(fixture.source(SYSTEM_FEATURE_SOURCE_BY_NAME.stops).calls).toEqual([]);
    expect(result.scene.featuresBySource).toHaveLength(16);
    expect(result.scene.featuresBySource.get(SYSTEM_FEATURE_SOURCE_BY_NAME.ways)?.features).toEqual(
      [expect.objectContaining({ id: visualId })],
    );
    expect(result.scene.hitFeatures.features).toHaveLength(1);
    expect(result.scene.hitFeatures.features[0]?.id).toBe(hitId);
    expect(result.scene.hitFeatures.features[0]?.properties).toMatchObject({ hitTarget: true });
    expect(
      fixture.controller.targetsForDomainIdentity(renderDomainIdentity('way', 'way-a')),
    ).toEqual([{ sourceId: SYSTEM_FEATURE_SOURCE_BY_NAME.ways, featureId: visualId }]);
  });

  it('retains unrequested collections and patches only the replaced source', () => {
    const fixture = controllerFixture();
    const waysSource = systemFeatureSourceId('ways');
    const stopsSource = systemFeatureSourceId('stops');
    const wayId = renderFeatureId(waysSource, 'overview', ['way-a']);
    const initial = emptySystemFeatures();
    initial.ways.features.push(lineFeature(wayId, 'way-a', 0));
    fixture.controller.applySynchronously({
      revision: 'revision-1',
      features: initial,
      sourceIds: [SRC_WAYS],
    });
    fixture.clearCalls();

    const stopId = renderFeatureId(stopsSource, 'marker', ['stop-a']);
    const partial = emptySystemFeatures();
    partial.stops.features.push(stopFeature(stopId, 'stop-a', 2));
    const result = fixture.controller.applySynchronously({
      revision: 'revision-2',
      features: partial,
      sourceIds: [SRC_STATIONS],
    });

    expect(result.strategy).toBe('patch');
    expect(result.patchSourceUploadCount).toBe(1);
    expect(result.addedFeatureCount).toBe(1);
    expect(result.removedFeatureCount).toBe(0);
    expect(fixture.source(SYSTEM_FEATURE_SOURCE_BY_NAME.ways).calls).toEqual([]);
    expect(fixture.source(SYSTEM_FEATURE_SOURCE_BY_NAME.stops).calls).toEqual([
      {
        method: 'updateData',
        data: { add: [expect.objectContaining({ id: stopId })] },
      },
    ]);
    expect(result.scene.featuresBySource.get(SYSTEM_FEATURE_SOURCE_BY_NAME.ways)?.features).toEqual(
      [expect.objectContaining({ id: wayId })],
    );
    expect(
      fixture.controller.targetsForDomainIdentity(renderDomainIdentity('way', 'way-a')),
    ).toEqual([{ sourceId: SYSTEM_FEATURE_SOURCE_BY_NAME.ways, featureId: wayId }]);
    expect(
      fixture.controller.targetsForDomainIdentity(renderDomainIdentity('stop', 'stop-a')),
    ).toEqual([{ sourceId: SYSTEM_FEATURE_SOURCE_BY_NAME.stops, featureId: stopId }]);
  });

  it('treats an empty requested collection as a removal without clearing retained sources', () => {
    const fixture = controllerFixture();
    const waysSource = systemFeatureSourceId('ways');
    const stopsSource = systemFeatureSourceId('stops');
    const wayId = renderFeatureId(waysSource, 'overview', ['way-a']);
    const stopId = renderFeatureId(stopsSource, 'marker', ['stop-a']);
    const initial = emptySystemFeatures();
    initial.ways.features.push(lineFeature(wayId, 'way-a', 0));
    initial.stops.features.push(stopFeature(stopId, 'stop-a', 2));
    fixture.controller.applySynchronously({
      revision: 'revision-1',
      features: initial,
      sourceIds: [SRC_WAYS, SRC_STATIONS],
    });
    fixture.clearCalls();

    const result = fixture.controller.applySynchronously({
      revision: 'revision-2',
      features: emptySystemFeatures(),
      sourceIds: [SRC_STATIONS],
    });

    expect(result.removedFeatureCount).toBe(1);
    expect(fixture.source(SYSTEM_FEATURE_SOURCE_BY_NAME.ways).calls).toEqual([]);
    expect(fixture.source(SYSTEM_FEATURE_SOURCE_BY_NAME.stops).calls).toEqual([
      { method: 'updateData', data: { remove: [stopId] } },
    ]);
    expect(
      fixture.controller.targetsForDomainIdentity(renderDomainIdentity('stop', 'stop-a')),
    ).toEqual([]);
  });

  it.each(['reset', 'style-heal'] as const)(
    'reuploads every nonempty retained source for the %s intent without losing retained collections',
    (intent) => {
      const fixture = controllerFixture();
      const waysSource = systemFeatureSourceId('ways');
      const wayId = renderFeatureId(waysSource, 'overview', ['way-a']);
      const initial = emptySystemFeatures();
      initial.ways.features.push(lineFeature(wayId, 'way-a', 0));
      fixture.controller.applySynchronously({
        revision: 'revision-1',
        features: initial,
        sourceIds: [SRC_WAYS],
      });
      fixture.clearCalls();

      const result = fixture.controller.applySynchronously({
        revision: 'revision-2',
        features: emptySystemFeatures(),
        sourceIds: [],
        intent,
      });

      expect(result.strategy).toBe('full');
      expect(result.fullSourceUploadCount).toBe(1);
      expect(fixture.source(SYSTEM_FEATURE_SOURCE_BY_NAME.stops).calls).toEqual([]);
      expect(fixture.source(SYSTEM_FEATURE_SOURCE_BY_NAME.ways).calls).toEqual([
        {
          method: 'setData',
          data: {
            type: 'FeatureCollection',
            features: [expect.objectContaining({ id: wayId })],
          },
        },
      ]);
      expect(
        result.scene.featuresBySource.get(SYSTEM_FEATURE_SOURCE_BY_NAME.ways)?.features,
      ).toEqual([expect.objectContaining({ id: wayId })]);
    },
  );

  it('normalizes, indexes, and diffs one requested source independently of unrelated retained features', () => {
    const measureStationPatch = (unrelatedWayCount: number) => {
      const counts = createSceneDraftOperationCounts();
      const fixture = controllerFixture(counts);
      const waysSource = systemFeatureSourceId('ways');
      const initial = emptySystemFeatures();
      for (let index = 0; index < unrelatedWayCount; index += 1) {
        const wayId = `way-${index}`;
        initial.ways.features.push(
          lineFeature(renderFeatureId(waysSource, 'overview', [wayId]), wayId, index),
        );
      }
      fixture.controller.applySynchronously({
        revision: 'revision-1',
        features: initial,
        sourceIds: [SRC_WAYS],
      });
      const before = { ...counts };

      const stopsSource = systemFeatureSourceId('stops');
      const partial = emptySystemFeatures();
      partial.stops.features.push(
        stopFeature(renderFeatureId(stopsSource, 'marker', ['stop-a']), 'stop-a', 2),
      );
      const result = fixture.controller.applySynchronously({
        revision: 'revision-2',
        features: partial,
        sourceIds: [SRC_STATIONS],
      });

      expect(
        result.scene.featuresBySource.get(SYSTEM_FEATURE_SOURCE_BY_NAME.ways)?.features,
      ).toHaveLength(unrelatedWayCount);
      return {
        normalizedSourceCount: counts.normalizedSourceCount - before.normalizedSourceCount,
        normalizedFeatureCount: counts.normalizedFeatureCount - before.normalizedFeatureCount,
        indexedFeatureCount: counts.indexedFeatureCount - before.indexedFeatureCount,
        diffedSourceCount: counts.diffedSourceCount - before.diffedSourceCount,
        diffedFeatureCount: counts.diffedFeatureCount - before.diffedFeatureCount,
      };
    };

    expect(measureStationPatch(1)).toEqual(measureStationPatch(2_000));
    expect(measureStationPatch(2_000)).toEqual({
      normalizedSourceCount: 1,
      normalizedFeatureCount: 1,
      indexedFeatureCount: 1,
      diffedSourceCount: 1,
      diffedFeatureCount: 1,
    });
  });

  it('reports exact comparison, identity, authoritative, and bypass decisions', () => {
    const counts = createSceneDraftOperationCounts();
    const diagnostics = counts as SceneDraftOperationCounts & {
      comparedFeatureCount?: number;
      comparisonStepCount?: number;
      referenceEqualFeatureCount?: number;
      authoritativeChangedFeatureCount?: number;
      diffBypassedSourceCount?: number;
    };
    const fixture = controllerFixture(counts);
    const waysSource = SYSTEM_FEATURE_SOURCE_BY_NAME.ways;
    const wayId = renderFeatureId(waysSource, 'overview', ['way-a']);
    const initial = emptySystemFeatures();
    initial.ways.features.push(lineFeature(wayId, 'way-a', 0));
    fixture.controller.applySynchronously({
      revision: 'count-initial',
      features: initial,
      sourceIds: [SRC_WAYS],
    });

    const cloned = structuredClone(initial);
    fixture.controller.applySynchronously({
      revision: 'count-clone',
      features: cloned,
      sourceIds: [SRC_WAYS],
    });

    const retained = emptySystemFeatures();
    const retainedFeature = fixture.controller
      .acceptedScene()
      ?.featuresBySource.get(waysSource)
      ?.features.find((feature) => feature.id === wayId);
    if (!retainedFeature || !isLineFeature(retainedFeature)) {
      throw new Error('Count fixture has no retained line feature.');
    }
    retained.ways.features.push(retainedFeature);
    fixture.controller.applySynchronously({
      revision: 'count-reference',
      features: retained,
      sourceIds: [SRC_WAYS],
    });

    const scoped = emptySystemFeatures();
    scoped.ways.features.push(lineFeature(wayId, 'way-a', 2));
    fixture.controller.applySynchronously({
      revision: 'count-scoped',
      features: scoped,
      sourceIds: [SRC_WAYS],
      replacementDomainsBySource: new Map([[SRC_WAYS, [renderDomainIdentity('way', 'way-a')]]]),
    });
    fixture.controller.applySynchronously({
      revision: 'count-reset',
      features: scoped,
      sourceIds: [SRC_WAYS],
      intent: 'reset',
    });

    expect(diagnostics.comparedFeatureCount).toBe(1);
    expect(diagnostics.comparisonStepCount).toBeGreaterThan(0);
    expect(diagnostics.referenceEqualFeatureCount).toBe(1);
    expect(diagnostics.authoritativeChangedFeatureCount).toBe(1);
    expect(diagnostics.diffBypassedSourceCount).toBe(1);
    expect(counts.comparedValueCount).toBe(diagnostics.comparisonStepCount);
  });
});
