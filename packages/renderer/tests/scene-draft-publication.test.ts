import { describe, expect, it } from 'vitest';
import { renderDomainIdentity, renderFeatureId } from '@transitmapper/core/render/render-identity';
import {
  EDITOR_SYSTEM_FEATURE_SOURCES,
  SYSTEM_FEATURE_SOURCE_BY_NAME,
} from '../src/system-feature-sources';
import { SRC_STATIONS, SRC_WAYS } from '../src/layers/constants';
import {
  controllerFixture,
  emptySystemFeatures,
  lineFeature,
  pointFeature,
  runUnits,
} from './support/scene-draft.test';

/** Publication tests stay separate from scene construction so the two failure
 * boundaries are reviewable: a draft can be valid yet stale, and a valid draft
 * must leave the accepted scene untouched when source submission fails. */
describe('scene draft publication', () => {
  it('rebases an editor-source update but rejects drift in a requested source', () => {
    const fixture = controllerFixture();
    const waysSource = SYSTEM_FEATURE_SOURCE_BY_NAME.ways;
    const stopsSource = SYSTEM_FEATURE_SOURCE_BY_NAME.stops;
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

    const stopAId = renderFeatureId(stopsSource, 'marker', ['stop-a']);
    const stopProjection = emptySystemFeatures();
    stopProjection.stops.features.push(pointFeature(stopAId, 'id', 'stop-a', 2));
    const committedPlan = fixture.controller.draft(
      {
        revision: 'committed-prepared',
        features: stopProjection,
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
    expect(rebased.scene.featuresBySource.get(stopsSource)?.features.map(({ id }) => id)).toEqual([
      stopAId,
    ]);
    expect(rebased.scene.featuresBySource.get(handlesSource)?.features.map(({ id }) => id)).toEqual(
      [handleId],
    );
    expect(rebased.scene.stats.generatedVisualFeatureCount).toBe(3);

    const stopBId = renderFeatureId(stopsSource, 'marker', ['stop-b']);
    const staleFeatures = emptySystemFeatures();
    staleFeatures.stops.features.push(pointFeature(stopBId, 'id', 'stop-b', 3));
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
    newerFeatures.stops.features.push(pointFeature(stopAId, 'id', 'stop-a', 4));
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
