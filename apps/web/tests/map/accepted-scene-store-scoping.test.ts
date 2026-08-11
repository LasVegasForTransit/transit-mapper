import type { Feature, FeatureCollection, LineString } from 'geojson';
import { describe, expect, it } from 'vitest';
import {
  renderDomainIdentity,
  renderFeatureId,
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
  emptySystemFeatures,
  SYSTEM_FEATURE_SOURCE_BY_NAME,
} from '../../src/map/system-feature-sources';
import { SRC_SERVICES, SRC_STATIONS, SRC_WAYS } from '../../src/map/layers';

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

function serviceFeature(
  id: string,
  serviceId: string,
  wayId: string,
  x: number,
): Feature<LineString> {
  return {
    type: 'Feature',
    id,
    properties: { serviceId, wayId },
    geometry: {
      type: 'LineString',
      coordinates: [
        [x, 1],
        [x + 1, 1],
      ],
    },
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

describe('live render scene controller domain scoping', () => {
  it('replaces one way and one service domain while retaining every unrelated feature', () => {
    const fixture = controllerFixture();
    const waysSource = SYSTEM_FEATURE_SOURCE_BY_NAME.ways;
    const servicesSource = SYSTEM_FEATURE_SOURCE_BY_NAME.services;
    const wayAId = renderFeatureId(waysSource, 'overview', ['way-a']);
    const wayBId = renderFeatureId(waysSource, 'overview', ['way-b']);
    const serviceAId = renderFeatureId(servicesSource, 'overview', ['service-a', 'way-a']);
    const serviceBId = renderFeatureId(servicesSource, 'overview', ['service-b', 'way-b']);
    const initial = emptySystemFeatures();
    initial.ways.features.push(lineFeature(wayAId, 'way-a', 0), lineFeature(wayBId, 'way-b', 10));
    initial.services.features.push(
      serviceFeature(serviceAId, 'service-a', 'way-a', 0),
      serviceFeature(serviceBId, 'service-b', 'way-b', 10),
    );
    const first = fixture.controller.applySynchronously({
      revision: 'revision-1',
      features: initial,
      sourceIds: [SRC_WAYS, SRC_SERVICES],
    });
    const retainedWay = first.scene.featuresBySource
      .get(waysSource)
      ?.features.find((feature) => feature.id === wayBId);
    const retainedService = first.scene.featuresBySource
      .get(servicesSource)
      ?.features.find((feature) => feature.id === serviceBId);
    const retainedStations = first.scene.featuresBySource.get(
      SYSTEM_FEATURE_SOURCE_BY_NAME.stations,
    );
    const retainedServiceIdentity = first.scene.identityIndex.renderFeatureIdsByDomain.get(
      renderDomainIdentity('service', 'service-b'),
    );
    fixture.clearCalls();

    const partial = emptySystemFeatures();
    partial.ways.features.push(lineFeature(wayAId, 'way-a', 2));
    partial.services.features.push(serviceFeature(serviceAId, 'service-a', 'way-a', 2));
    const result = fixture.controller.applySynchronously({
      revision: 'revision-2',
      features: partial,
      sourceIds: [SRC_WAYS, SRC_SERVICES],
      replacementDomainsBySource: new Map([
        [SRC_WAYS, [renderDomainIdentity('way', 'way-a')]],
        [SRC_SERVICES, [renderDomainIdentity('service', 'service-a')]],
      ]),
    });

    expect(result.strategy).toBe('patch');
    expect(result.patchSourceUploadCount).toBe(2);
    expect(result.changedFeatureCount).toBe(2);
    expect(result.addedFeatureCount).toBe(0);
    expect(result.removedFeatureCount).toBe(0);
    expect(fixture.source(waysSource).calls).toEqual([
      { method: 'updateData', data: { add: [expect.objectContaining({ id: wayAId })] } },
    ]);
    expect(fixture.source(servicesSource).calls).toEqual([
      { method: 'updateData', data: { add: [expect.objectContaining({ id: serviceAId })] } },
    ]);
    expect(result.scene.featuresBySource.get(waysSource)?.features).toEqual([
      expect.objectContaining({ id: wayAId }),
      retainedWay,
    ]);
    expect(result.scene.featuresBySource.get(servicesSource)?.features).toEqual([
      expect.objectContaining({ id: serviceAId }),
      retainedService,
    ]);
    expect(
      result.scene.featuresBySource.get(waysSource)?.features.find(({ id }) => id === wayBId),
    ).toBe(retainedWay);
    expect(
      result.scene.featuresBySource
        .get(servicesSource)
        ?.features.find(({ id }) => id === serviceBId),
    ).toBe(retainedService);
    expect(result.scene.featuresBySource.get(SYSTEM_FEATURE_SOURCE_BY_NAME.stations)).toBe(
      retainedStations,
    );
    expect(
      result.scene.identityIndex.renderFeatureIdsByDomain.get(
        renderDomainIdentity('service', 'service-b'),
      ),
    ).toBe(retainedServiceIdentity);
  });

  it('removes the scoped visual and hit features when a partial source is empty', () => {
    const fixture = controllerFixture();
    const waysSource = SYSTEM_FEATURE_SOURCE_BY_NAME.ways;
    const visualAId = renderFeatureId(waysSource, 'overview', ['way-a']);
    const hitAId = renderFeatureId(waysSource, 'hit', ['way-a']);
    const visualBId = renderFeatureId(waysSource, 'overview', ['way-b']);
    const initial = emptySystemFeatures();
    initial.ways.features.push(
      lineFeature(visualAId, 'way-a', 0),
      lineFeature(hitAId, 'way-a', 0, true),
      lineFeature(visualBId, 'way-b', 10),
    );
    fixture.controller.applySynchronously({
      revision: 'revision-1',
      features: initial,
      sourceIds: [SRC_WAYS],
    });
    fixture.clearCalls();

    const result = fixture.controller.applySynchronously({
      revision: 'revision-2',
      features: emptySystemFeatures(),
      sourceIds: [SRC_WAYS],
      replacementDomainsBySource: new Map([[SRC_WAYS, [renderDomainIdentity('way', 'way-a')]]]),
    });

    expect(result.removedFeatureCount).toBe(2);
    expect(fixture.source(waysSource).calls).toEqual([
      { method: 'updateData', data: { remove: [visualAId] } },
    ]);
    expect(fixture.hitSource.calls).toEqual([{ method: 'updateData', data: { remove: [hitAId] } }]);
    expect(result.scene.featuresBySource.get(waysSource)?.features).toEqual([
      expect.objectContaining({ id: visualBId }),
    ]);
    expect(result.scene.hitFeatures.features).toEqual([]);
  });

  it('removes a many-to-many feature when any one of its replacement domains owns it', () => {
    const fixture = controllerFixture();
    const servicesSource = SYSTEM_FEATURE_SOURCE_BY_NAME.services;
    const sharedId = renderFeatureId(servicesSource, 'shared', ['service-a', 'way-a']);
    const initial = emptySystemFeatures();
    initial.services.features.push(serviceFeature(sharedId, 'service-a', 'way-a', 0));
    fixture.controller.applySynchronously({
      revision: 'revision-1',
      features: initial,
      sourceIds: [SRC_SERVICES],
    });
    fixture.clearCalls();

    const result = fixture.controller.applySynchronously({
      revision: 'revision-2',
      features: emptySystemFeatures(),
      sourceIds: [SRC_SERVICES],
      replacementDomainsBySource: new Map([
        [SRC_SERVICES, [renderDomainIdentity('service', 'service-a')]],
      ]),
    });

    expect(result.removedFeatureCount).toBe(1);
    expect(fixture.source(servicesSource).calls).toEqual([
      { method: 'updateData', data: { remove: [sharedId] } },
    ]);
    expect(
      fixture.controller.targetsForDomainIdentity(renderDomainIdentity('service', 'service-a')),
    ).toEqual([]);
    expect(
      fixture.controller.targetsForDomainIdentity(renderDomainIdentity('way', 'way-a')),
    ).toEqual([]);
  });

  it('keeps scoped operation counts independent of unrelated features in the same source', () => {
    const measureOneWayPatch = (unrelatedWayCount: number) => {
      const counts = createSceneDraftOperationCounts();
      const fixture = controllerFixture(counts);
      const waysSource = SYSTEM_FEATURE_SOURCE_BY_NAME.ways;
      const initial = emptySystemFeatures();
      initial.ways.features.push(
        lineFeature(renderFeatureId(waysSource, 'overview', ['way-a']), 'way-a', 0),
      );
      for (let index = 0; index < unrelatedWayCount; index += 1) {
        const wayId = `unrelated-${index}`;
        initial.ways.features.push(
          lineFeature(renderFeatureId(waysSource, 'overview', [wayId]), wayId, index + 10),
        );
      }
      fixture.controller.applySynchronously({
        revision: 'revision-1',
        features: initial,
        sourceIds: [SRC_WAYS],
      });
      const before = { ...counts };

      const partial = emptySystemFeatures();
      partial.ways.features.push(
        lineFeature(renderFeatureId(waysSource, 'overview', ['way-a']), 'way-a', 2),
      );
      fixture.controller.applySynchronously({
        revision: 'revision-2',
        features: partial,
        sourceIds: [SRC_WAYS],
        replacementDomainsBySource: new Map([[SRC_WAYS, [renderDomainIdentity('way', 'way-a')]]]),
      });
      return {
        normalizedSourceCount: counts.normalizedSourceCount - before.normalizedSourceCount,
        normalizedFeatureCount: counts.normalizedFeatureCount - before.normalizedFeatureCount,
        indexedFeatureCount: counts.indexedFeatureCount - before.indexedFeatureCount,
        diffedSourceCount: counts.diffedSourceCount - before.diffedSourceCount,
        diffedFeatureCount: counts.diffedFeatureCount - before.diffedFeatureCount,
      };
    };

    expect(measureOneWayPatch(1)).toEqual(measureOneWayPatch(2_000));
    expect(measureOneWayPatch(2_000)).toEqual({
      normalizedSourceCount: 1,
      normalizedFeatureCount: 1,
      indexedFeatureCount: 1,
      diffedSourceCount: 1,
      diffedFeatureCount: 2,
    });
  });

  it('rejects invalid scoped ownership without changing retained source state', () => {
    const fixture = controllerFixture();
    const waysSource = SYSTEM_FEATURE_SOURCE_BY_NAME.ways;
    const servicesSource = SYSTEM_FEATURE_SOURCE_BY_NAME.services;
    const stationSource = SYSTEM_FEATURE_SOURCE_BY_NAME.stations;
    const wayAId = renderFeatureId(waysSource, 'overview', ['way-a']);
    const serviceBId = renderFeatureId(servicesSource, 'overview', ['service-b', 'way-b']);
    const initial = emptySystemFeatures();
    initial.ways.features.push(lineFeature(wayAId, 'way-a', 0));
    initial.services.features.push(serviceFeature(serviceBId, 'service-b', 'way-b', 8));
    const first = fixture.controller.applySynchronously({
      revision: 'revision-1',
      features: initial,
      sourceIds: [SRC_WAYS, SRC_SERVICES],
    });
    const retainedWays = first.scene.featuresBySource.get(waysSource);
    fixture.clearCalls();

    const wrongDomain = emptySystemFeatures();
    wrongDomain.ways.features.push(
      lineFeature(renderFeatureId(waysSource, 'overview', ['way-b']), 'way-b', 4),
    );
    expect(() =>
      fixture.controller.applySynchronously({
        revision: 'revision-2',
        features: wrongDomain,
        sourceIds: [SRC_WAYS],
        replacementDomainsBySource: new Map([[SRC_WAYS, [renderDomainIdentity('way', 'way-a')]]]),
      }),
    ).toThrow('outside its replacement domain scope');

    expect(() =>
      fixture.controller.applySynchronously({
        revision: 'revision-2',
        features: emptySystemFeatures(),
        sourceIds: [SRC_WAYS],
        replacementDomainsBySource: new Map([
          [SRC_STATIONS, [renderDomainIdentity('station', 'station-a')]],
        ]),
      }),
    ).toThrow('must match the requested renderer sources');

    const collidingId = emptySystemFeatures();
    collidingId.ways.features.push(lineFeature(serviceBId, 'way-a', 2));
    expect(() =>
      fixture.controller.applySynchronously({
        revision: 'revision-2',
        features: collidingId,
        sourceIds: [SRC_WAYS],
        replacementDomainsBySource: new Map([[SRC_WAYS, [renderDomainIdentity('way', 'way-a')]]]),
      }),
    ).toThrow('Duplicate render feature ID across scene');
    expect(fixture.source(waysSource).calls).toEqual([]);
    expect(fixture.source(servicesSource).calls).toEqual([]);
    expect(fixture.source(stationSource).calls).toEqual([]);
    expect(fixture.controller.acceptedScene()?.revision).toBe('revision-1');
    expect(fixture.controller.acceptedScene()?.featuresBySource.get(waysSource)).toBe(retainedWays);
  });
});
