import { describe, expect, it } from 'vitest';
import { renderDomainIdentity, renderFeatureId } from '@transitmapper/core/render/render-identity';
import {
  EDITOR_SYSTEM_FEATURE_SOURCES,
  SYSTEM_FEATURE_SOURCE_BY_NAME,
} from '../../src/map/system-feature-sources';
import { normalizedRequestedStates } from '../../src/map/scene-source-state';
import { SRC_SERVICES, SRC_STATIONS, SRC_WAYS } from '../../src/map/layers';
import {
  controllerFixture,
  emptySystemFeatures,
  lineFeature,
  pointFeature,
  runUnits,
} from '../support/scene-draft.test';

describe('scene draft', () => {
  it('does not enumerate projected features until a private work unit runs', () => {
    const fixture = controllerFixture();
    const waysSource = SYSTEM_FEATURE_SOURCE_BY_NAME.ways;
    const features = emptySystemFeatures();
    const values = [lineFeature(renderFeatureId(waysSource, 'overview', ['way-a']), 'way-a', 0)];
    let reads = 0;
    features.ways.features = new Proxy(values, {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property)) reads += 1;
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

    const plan = fixture.controller.draft(
      { revision: 'lazy', features, sourceIds: [SRC_WAYS] },
      { batchSize: 1 },
    );
    const first = plan.units.unitAt(0);

    expect(reads).toBe(0);
    expect(first).toBeDefined();
    first?.run();
    expect(reads).toBeGreaterThan(0);
  });

  it('prepares canonical tier order, hit separation, and identity without publishing early', () => {
    const fixture = controllerFixture();
    const waysSource = SYSTEM_FEATURE_SOURCE_BY_NAME.ways;
    const overviewId = renderFeatureId(waysSource, 'z-overview', ['way-a']);
    const districtId = renderFeatureId(waysSource, 'a-district', ['way-a']);
    const streetId = renderFeatureId(waysSource, 'a-street', ['way-a']);
    const hitId = renderFeatureId(waysSource, 'hit', ['way-a']);
    const features = emptySystemFeatures();
    features.ways.features.push(
      lineFeature(streetId, 'way-a', 0, { renderTier: 'street' }),
      lineFeature(hitId, 'way-a', 0, { renderTier: 'overview', hitTarget: true }),
      lineFeature(districtId, 'way-a', 0, { renderTier: 'district' }),
      lineFeature(overviewId, 'way-a', 0, { renderTier: 'overview' }),
    );

    const plan = fixture.controller.draft(
      { revision: 'prepared', features, sourceIds: [SRC_WAYS] },
      { batchSize: 1 },
    );
    expect(fixture.controller.acceptedScene()).toBeNull();
    expect(() => plan.result()).toThrow('incomplete');

    const { ids } = runUnits(plan.units);
    const prepared = plan.result();
    expect(prepared.batchSize).toBe(1);
    expect(ids.length).toBeGreaterThan(features.ways.features.length);
    expect(fixture.controller.acceptedScene()).toBeNull();
    expect(prepared.scene.featuresBySource.get(waysSource)?.features.map(({ id }) => id)).toEqual([
      overviewId,
      districtId,
      streetId,
    ]);
    expect(prepared.scene.hitFeatures.features.map(({ id }) => id)).toEqual([hitId]);
    expect(
      prepared.scene.identityIndex.renderFeatureIdsByDomain.get(
        renderDomainIdentity('way', 'way-a'),
      ),
    ).toEqual([districtId, hitId, overviewId, streetId].sort());
    expect(plan.result()).toBe(prepared);

    const committed = fixture.controller.publishDraftSynchronously(prepared);
    expect(committed.scene).toBe(prepared.scene);
    expect(fixture.controller.acceptedScene()).toBe(prepared.scene);
  });

  it('matches synchronous normalization for visual hits and multi-domain service identity', () => {
    const fixture = controllerFixture();
    const servicesSource = SYSTEM_FEATURE_SOURCE_BY_NAME.services;
    const overviewId = renderFeatureId(servicesSource, 'overview', ['service-a', 'way-a']);
    const districtId = renderFeatureId(servicesSource, 'district', ['service-a', 'way-a']);
    const hitId = renderFeatureId(servicesSource, 'hit', ['service-a', 'way-a']);
    const features = emptySystemFeatures();
    features.services.features.push(
      {
        ...lineFeature(districtId, 'unused', 2, { renderTier: 'district' }),
        properties: {
          serviceId: 'service-a',
          wayId: 'way-a',
          renderTier: 'district',
        },
      },
      {
        ...lineFeature(hitId, 'unused', 0, { hitTarget: true }),
        properties: { serviceId: 'service-a', wayId: 'way-a', hitTarget: true },
      },
      {
        ...lineFeature(overviewId, 'unused', 0),
        properties: { serviceId: 'service-a', wayId: 'way-a', renderTier: 'overview' },
      },
    );
    const expected = normalizedRequestedStates({ revision: 'synchronous', features }, [
      SRC_SERVICES,
    ]).get(servicesSource);
    const plan = fixture.controller.draft(
      { revision: 'staged', features, sourceIds: [SRC_SERVICES] },
      { batchSize: 1 },
    );

    runUnits(plan.units);

    expect(plan.result().state.sourceStates.get(servicesSource)).toEqual(expected);
  });

  it('reuses fixed sorted runs when one feature is normalized per work unit', () => {
    const fixture = controllerFixture();
    const waysSource = SYSTEM_FEATURE_SOURCE_BY_NAME.ways;
    const features = emptySystemFeatures();
    for (let index = 129; index >= 0; index -= 1) {
      const wayId = `way-${String(index).padStart(3, '0')}`;
      features.ways.features.push(
        lineFeature(renderFeatureId(waysSource, 'overview', [wayId]), wayId, index),
      );
    }
    const plan = fixture.controller.draft(
      { revision: 'fixed-normalization-runs', features, sourceIds: [SRC_WAYS] },
      { batchSize: 1 },
    );

    const { ids } = runUnits(plan.units);
    const visualInitializationUnits = ids.filter((id) =>
      id.includes(`${waysSource}:visual:initialize`),
    );

    expect(visualInitializationUnits).toHaveLength(3);
    expect(
      plan
        .result()
        .scene.featuresBySource.get(waysSource)
        ?.features.map((feature) => feature.id),
    ).toEqual([...features.ways.features.map((feature) => feature.id)].sort());
  });

  it('rebuilds exact hit geometry across a reset without running an incremental diff', () => {
    const fixture = controllerFixture();
    const waysSource = SYSTEM_FEATURE_SOURCE_BY_NAME.ways;
    const visualId = renderFeatureId(waysSource, 'overview', ['way-a']);
    const hitId = renderFeatureId(waysSource, 'hit', ['way-a']);
    const initial = emptySystemFeatures();
    initial.ways.features.push(
      lineFeature(visualId, 'way-a', 0),
      lineFeature(hitId, 'way-a', 0, { hitTarget: true }),
    );
    fixture.controller.applySynchronously({
      revision: 'before-reset',
      features: initial,
      sourceIds: [SRC_WAYS],
    });
    const reset = emptySystemFeatures();
    const changedHit = lineFeature(hitId, 'way-a', 50, { hitTarget: true });
    reset.ways.features.push(lineFeature(visualId, 'way-a', 50), changedHit);
    const plan = fixture.controller.draft(
      { revision: 'after-reset', features: reset, sourceIds: [SRC_WAYS], intent: 'reset' },
      { batchSize: 1 },
    );

    const { ids } = runUnits(plan.units);
    const update = fixture.controller.publishDraftSynchronously(plan.result());

    expect(ids.some((id) => id.includes(':diff:'))).toBe(false);
    expect(update.scene.hitFeatures.features).toEqual([
      expect.objectContaining({ id: hitId, geometry: changedHit.geometry }),
    ]);
    expect(fixture.hitSource.calls.at(-1)).toMatchObject({
      method: 'setData',
      data: { features: [expect.objectContaining({ id: hitId, geometry: changedHit.geometry })] },
    });
  });

  it('adds hit geometry across a reset without running an incremental diff', () => {
    const fixture = controllerFixture();
    const waysSource = SYSTEM_FEATURE_SOURCE_BY_NAME.ways;
    const visualId = renderFeatureId(waysSource, 'overview', ['way-a']);
    const hitId = renderFeatureId(waysSource, 'hit', ['way-a']);
    const initial = emptySystemFeatures();
    initial.ways.features.push(lineFeature(visualId, 'way-a', 0));
    fixture.controller.applySynchronously({
      revision: 'before-hit-add',
      features: initial,
      sourceIds: [SRC_WAYS],
    });
    const reset = emptySystemFeatures();
    const addedHit = lineFeature(hitId, 'way-a', 0, { hitTarget: true });
    reset.ways.features.push(lineFeature(visualId, 'way-a', 0), addedHit);
    const plan = fixture.controller.draft(
      { revision: 'after-hit-add', features: reset, sourceIds: [SRC_WAYS], intent: 'reset' },
      { batchSize: 1 },
    );

    const { ids } = runUnits(plan.units);
    const update = fixture.controller.publishDraftSynchronously(plan.result());

    expect(ids.some((id) => id.includes(':diff:'))).toBe(false);
    expect(update.scene.hitFeatures.features).toEqual([
      expect.objectContaining({ id: hitId, geometry: addedHit.geometry }),
    ]);
    expect(fixture.hitSource.calls.at(-1)).toMatchObject({
      method: 'setData',
      data: { features: [expect.objectContaining({ id: hitId })] },
    });
  });

  it('removes hit geometry across a reset without running an incremental diff', () => {
    const fixture = controllerFixture();
    const waysSource = SYSTEM_FEATURE_SOURCE_BY_NAME.ways;
    const visualId = renderFeatureId(waysSource, 'overview', ['way-a']);
    const hitId = renderFeatureId(waysSource, 'hit', ['way-a']);
    const initial = emptySystemFeatures();
    initial.ways.features.push(
      lineFeature(visualId, 'way-a', 0),
      lineFeature(hitId, 'way-a', 0, { hitTarget: true }),
    );
    fixture.controller.applySynchronously({
      revision: 'before-hit-remove',
      features: initial,
      sourceIds: [SRC_WAYS],
    });
    const reset = emptySystemFeatures();
    reset.ways.features.push(lineFeature(visualId, 'way-a', 0));
    const plan = fixture.controller.draft(
      { revision: 'after-hit-remove', features: reset, sourceIds: [SRC_WAYS], intent: 'reset' },
      { batchSize: 1 },
    );

    const { ids } = runUnits(plan.units);
    const update = fixture.controller.publishDraftSynchronously(plan.result());

    expect(ids.some((id) => id.includes(':diff:'))).toBe(false);
    expect(update.scene.hitFeatures.features).toEqual([]);
    expect(fixture.hitSource.calls.at(-1)).toEqual({
      method: 'setData',
      data: { type: 'FeatureCollection', features: [] },
    });
  });

  it('uses bounded collection offsets instead of feature IDs in comparison unit IDs', () => {
    const fixture = controllerFixture();
    const waysSource = SYSTEM_FEATURE_SOURCE_BY_NAME.ways;
    const featureId = renderFeatureId(waysSource, 'overview', ['untrusted-user-feature-id']);
    const initial = emptySystemFeatures();
    initial.ways.features.push(lineFeature(featureId, 'untrusted-user-feature-id', 0));
    fixture.controller.applySynchronously({
      revision: 'unit-id-before',
      features: initial,
      sourceIds: [SRC_WAYS],
    });
    const cloned = structuredClone(initial);
    const plan = fixture.controller.draft(
      { revision: 'unit-id-after', features: cloned, sourceIds: [SRC_WAYS] },
      { batchSize: 1 },
    );

    const { ids } = runUnits(plan.units);
    const comparisonIds = ids.filter((id) => id.includes(':compare:'));

    expect(comparisonIds[0]).toBe(`scene-draft:${waysSource}:diff:visual:compare:0:0`);
    expect(comparisonIds.every((id) => !id.includes(String(featureId)))).toBe(true);
  });

  it('rejects duplicate IDs split across normalization units without changing live state', () => {
    const fixture = controllerFixture();
    const waysSource = SYSTEM_FEATURE_SOURCE_BY_NAME.ways;
    const duplicateId = renderFeatureId(waysSource, 'overview', ['way-a']);
    const features = emptySystemFeatures();
    features.ways.features.push(
      lineFeature(duplicateId, 'way-a', 0),
      lineFeature(duplicateId, 'way-b', 2),
    );
    const plan = fixture.controller.draft(
      { revision: 'duplicate', features, sourceIds: [SRC_WAYS] },
      { batchSize: 1 },
    );

    expect(() => runUnits(plan.units)).toThrow('Duplicate render feature ID');
    expect(fixture.controller.acceptedScene()).toBeNull();
    expect(fixture.source(waysSource).calls).toEqual([]);
  });

  it('replaces an exact scoped domain and retains unrelated feature identity', () => {
    const fixture = controllerFixture();
    const waysSource = SYSTEM_FEATURE_SOURCE_BY_NAME.ways;
    const wayAId = renderFeatureId(waysSource, 'overview', ['way-a']);
    const wayBId = renderFeatureId(waysSource, 'overview', ['way-b']);
    const initial = emptySystemFeatures();
    initial.ways.features.push(lineFeature(wayAId, 'way-a', 0), lineFeature(wayBId, 'way-b', 4));
    const first = fixture.controller.applySynchronously({
      revision: 'before-scope',
      features: initial,
      sourceIds: [SRC_WAYS],
    });
    const retained = first.scene.featuresBySource
      .get(waysSource)
      ?.features.find(({ id }) => id === wayBId);

    const partial = emptySystemFeatures();
    partial.ways.features.push(lineFeature(wayAId, 'way-a', 2));
    const plan = fixture.controller.draft(
      {
        revision: 'after-scope',
        features: partial,
        sourceIds: [SRC_WAYS],
        replacementDomainsBySource: new Map([[SRC_WAYS, [renderDomainIdentity('way', 'way-a')]]]),
      },
      { batchSize: 1 },
    );
    runUnits(plan.units);
    const result = fixture.controller.publishDraftSynchronously(plan.result());

    expect(result.scene.featuresBySource.get(waysSource)?.features).toEqual([
      expect.objectContaining({ id: wayAId }),
      retained,
    ]);
    expect(
      result.scene.featuresBySource.get(waysSource)?.features.find(({ id }) => id === wayBId),
    ).toBe(retained);
    expect(result.changedFeatureCount).toBe(1);
  });

  it('rebases an editor-source update but rejects drift in a requested source', () => {
    const fixture = controllerFixture();
    const waysSource = SYSTEM_FEATURE_SOURCE_BY_NAME.ways;
    const stationsSource = SYSTEM_FEATURE_SOURCE_BY_NAME.stations;
    const handlesSource = SYSTEM_FEATURE_SOURCE_BY_NAME.handles;
    const initial = emptySystemFeatures();
    initial.ways.features.push(
      lineFeature(renderFeatureId(waysSource, 'overview', ['way-a']), 'way-a', 0),
    );
    fixture.controller.applySynchronously({
      revision: 'initial',
      features: initial,
      sourceIds: [SRC_WAYS],
    });

    const stationAId = renderFeatureId(stationsSource, 'marker', ['station-a']);
    const stationProjection = emptySystemFeatures();
    stationProjection.stations.features.push(pointFeature(stationAId, 'id', 'station-a', 2));
    const committedPlan = fixture.controller.draft(
      {
        revision: 'committed-prepared',
        features: stationProjection,
        sourceIds: [SRC_STATIONS],
      },
      { batchSize: 1 },
    );
    runUnits(committedPlan.units);

    const handleId = renderFeatureId(handlesSource, 'way-control', ['way-a', 0]);
    const editorFeatures = emptySystemFeatures();
    editorFeatures.handles.features.push(pointFeature(handleId, 'wayId', 'way-a', 0));
    fixture.controller.applySynchronously({
      revision: 'editor-update',
      features: editorFeatures,
      sourceIds: EDITOR_SYSTEM_FEATURE_SOURCES,
    });

    const rebased = fixture.controller.publishDraftSynchronously(committedPlan.result());
    expect(
      rebased.scene.featuresBySource.get(stationsSource)?.features.map(({ id }) => id),
    ).toEqual([stationAId]);
    expect(rebased.scene.featuresBySource.get(handlesSource)?.features.map(({ id }) => id)).toEqual(
      [handleId],
    );
    expect(rebased.scene.stats.generatedVisualFeatureCount).toBe(3);

    const stationBId = renderFeatureId(stationsSource, 'marker', ['station-b']);
    const staleFeatures = emptySystemFeatures();
    staleFeatures.stations.features.push(pointFeature(stationBId, 'id', 'station-b', 3));
    const stalePlan = fixture.controller.draft(
      {
        revision: 'stale-prepared',
        features: staleFeatures,
        sourceIds: [SRC_STATIONS],
      },
      { batchSize: 1 },
    );
    runUnits(stalePlan.units);

    const newerFeatures = emptySystemFeatures();
    newerFeatures.stations.features.push(pointFeature(stationAId, 'id', 'station-a', 4));
    const newer = fixture.controller.applySynchronously({
      revision: 'newer-requested-source',
      features: newerFeatures,
      sourceIds: [SRC_STATIONS],
    });

    expect(() => fixture.controller.publishDraftSynchronously(stalePlan.result())).toThrow(
      'requested source changed',
    );
    expect(fixture.controller.acceptedScene()).toBe(newer.scene);
  });

  it('retains the prior scene when source submission throws synchronously', () => {
    const fixture = controllerFixture();
    const waysSource = SYSTEM_FEATURE_SOURCE_BY_NAME.ways;
    const initial = emptySystemFeatures();
    const wayId = renderFeatureId(waysSource, 'overview', ['way-a']);
    initial.ways.features.push(lineFeature(wayId, 'way-a', 0));
    const before = fixture.controller.applySynchronously({
      revision: 'before-failure',
      features: initial,
      sourceIds: [SRC_WAYS],
    });

    const changed = emptySystemFeatures();
    changed.ways.features.push(lineFeature(wayId, 'way-a', 3));
    const plan = fixture.controller.draft(
      { revision: 'failed-scene', features: changed, sourceIds: [SRC_WAYS] },
      { batchSize: 1 },
    );
    runUnits(plan.units);
    fixture.source(waysSource).failNext = true;

    expect(() => fixture.controller.publishDraftSynchronously(plan.result())).toThrow(
      'source submission failed',
    );
    expect(fixture.controller.acceptedScene()).toBe(before.scene);
    expect(
      fixture.controller.targetsForDomainIdentity(renderDomainIdentity('way', 'way-a')),
    ).toEqual([{ sourceId: waysSource, featureId: wayId }]);
  });
});
