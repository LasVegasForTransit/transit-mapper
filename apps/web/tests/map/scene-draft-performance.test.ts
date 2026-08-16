import { describe, expect, it } from 'vitest';
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
import { SRC_STATIONS, SRC_WAYS } from '../../src/map/layers';
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
  flushFrameQueueUntilSettled,
  lineFeature,
  ManualFrameQueue,
  runUnits,
} from '../support/scene-draft.test';

// Scheduler timing is covered with a fake clock. These production-sized cases
// instead constrain bounded work shape independently of machine contention.
describe('scene draft scoped performance', () => {
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

    const frames = new ManualFrameQueue();
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
    await flushFrameQueueUntilSettled(frames, submission.settled);

    const committedAttempt = attempts.at(-1);
    const committedFeatureCount = COMMITTED_SYSTEM_FEATURE_SOURCES.reduce(
      (total, sourceId) =>
        total + features[SYSTEM_FEATURE_NAME_BY_SOURCE[sourceId]].features.length,
      0,
    );
    expect(committedAttempt?.committedJobCount).toBe(1);
    // A full scene passes each feature through a fixed set of bounded stages:
    // normalization, source-local state, visual/hit assembly, and the banked
    // upload plan. The exact stage count may change, but it must stay linear
    // in submitted features rather than scale with retained scene history.
    expect(committedAttempt?.unitRunCount).toBeLessThan(committedFeatureCount * 12 + 1_000);
    expect(attempts.length).toBeLessThanOrEqual(9);
    const committedScene = fixture.controller.acceptedScene();
    expect(committedScene?.revision).toBe('rtc-staged');

    const stopIds = new Set<RenderFeatureId>(
      features.stops.features.map((feature) => {
        if (typeof feature.id !== 'string') {
          throw new Error('RTC stop projection has no stable string ID.');
        }
        return feature.id as RenderFeatureId;
      }),
    );
    const stopDomain = [...(committedScene?.identityIndex.renderFeatureIdsByDomain ?? [])].find(
      ([, featureIds]) => featureIds.some((featureId) => stopIds.has(featureId)),
    );
    if (!stopDomain) throw new Error('RTC fixture retained no stop identity domain.');
    const scopedIds = new Set(stopDomain[1].filter((featureId) => stopIds.has(featureId)));
    const partial = emptySystemFeatures();
    partial.stops.features.push(
      ...features.stops.features
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
        replacementDomainsBySource: new Map([[SRC_STATIONS, [stopDomain[0]]]]),
      },
      batchSize: 1,
      recordScheduling: (stats) => scopedAttempts.push(stats),
    });
    await flushFrameQueueUntilSettled(frames, scopedSubmission.settled);
    const scopedAttempt = scopedAttempts.at(-1);
    expect(scopedAttempt?.committedJobCount).toBe(1);
    expect(scopedAttempt?.unitRunCount).toBeLessThan(250);
    expect(scopedAttempts.length).toBeLessThanOrEqual(9);
  }, 30_000);
});
