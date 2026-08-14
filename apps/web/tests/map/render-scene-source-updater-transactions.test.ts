import { describe, expect, it } from 'vitest';
import { renderFeatureId, systemFeatureSourceId } from '@transitmapper/core/render/render-identity';
import { diffRenderScenes } from '@transitmapper/core/render/render-scene-diff';
import type { RenderScene } from '@transitmapper/core/render/render-scene';
import { createRenderSceneSourceUpdater } from '../../src/map/render-scene-source-updater';
import { mergedRenderFeatureCollection } from '../../src/map/persistent-render-source-state';
import {
  RecordingRenderSource,
  renderPointFeature,
  renderScene,
  renderSourceFixture,
} from '../support/render-scene-source-updater.test';

describe('render scene source transactions', () => {
  it('materializes a persistent full-upload collection in bounded CPU units before MapLibre', () => {
    const ways = systemFeatureSourceId('ways');
    const fixture = renderSourceFixture([ways]);
    const updater = createRenderSceneSourceUpdater({ resolveSource: fixture.source });
    const wayIds = Array.from({ length: 128 }, (_, index) =>
      renderFeatureId(ways, 'overview', [`way-${index}`]),
    );
    const features = wayIds.map((id, index) => renderPointFeature(id, index));
    const previous = renderScene('materialize-before', [{ sourceId: ways, features }]);
    updater.apply(previous);
    fixture.source(ways).calls.length = 0;
    const changed = renderPointFeature(wayIds[0], 999);
    const partial = renderScene('materialize-partial', [
      { sourceId: ways, features: [changed] },
    ]).featuresBySource.get(ways);
    const stable = previous.featuresBySource.get(ways);
    if (!partial || !stable) throw new Error('Expected materialization fixture collections.');
    const lazy = mergedRenderFeatureCollection(
      stable,
      partial,
      new Set(),
      new Set(stable.features.map((feature) => feature.id)),
    );
    const nextBase = renderScene('materialize-after', [{ sourceId: ways, features }]);
    const next = {
      ...nextBase,
      featuresBySource: new Map([[ways, lazy]]),
    };
    const plan = updater.prepare(next, { intent: 'reset', preparationBatchSize: 1 });

    expect(() => plan.units[0]?.run()).toThrow('preparation must complete');
    let preparationUnitCount = 0;
    for (let index = 0; ; index += 1) {
      const unit = plan.preparationUnits?.unitAt(index);
      if (!unit) break;
      unit.run();
      preparationUnitCount += 1;
      expect(fixture.source(ways).calls).toEqual([]);
    }
    expect(preparationUnitCount).toBeGreaterThan(2);

    plan.units[0]?.run();
    plan.commit();
    expect(fixture.source(ways).calls).toHaveLength(1);
  });

  it('promotes a large scoped patch only after bounded retained collection materialization', () => {
    const ways = systemFeatureSourceId('ways');
    const fixture = renderSourceFixture([ways]);
    const updater = createRenderSceneSourceUpdater({ resolveSource: fixture.source });
    const wayIds = Array.from({ length: 256 }, (_, index) =>
      renderFeatureId(ways, 'overview', [`retained-way-${index}`]),
    );
    const features = wayIds.map((id, index) => renderPointFeature(id, index));
    const previous = renderScene('promoted-materialize-before', [{ sourceId: ways, features }]);
    updater.apply(previous);
    fixture.source(ways).calls.length = 0;
    const stable = previous.featuresBySource.get(ways);
    if (!stable) throw new Error('Expected a retained source collection.');
    let stableFeatureReads = 0;
    stable.features = new Proxy(stable.features, {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property)) stableFeatureReads += 1;
        return Reflect.get(target, property, receiver) as (typeof target)[number];
      },
    });
    const changed = wayIds.slice(0, 65).map((id, index) => renderPointFeature(id, 10_000 + index));
    const partial = renderScene('promoted-materialize-partial', [
      { sourceId: ways, features: changed },
    ]).featuresBySource.get(ways);
    if (!partial) throw new Error('Expected a scoped changed collection.');
    const lazy = mergedRenderFeatureCollection(stable, partial, new Set(), new Set(wayIds));
    const nextBase = renderScene('promoted-materialize-after', [{ sourceId: ways, features }]);
    const next: RenderScene = { ...nextBase, featuresBySource: new Map([[ways, lazy]]) };
    const plan = updater.prepare(next, {
      preparationBatchSize: 1,
      patch: {
        revision: next.revision,
        add: new Map([[ways, changed]]),
        remove: new Map(),
        hitFeatures: { add: [], remove: [] },
        stats: { addedFeatureCount: 0, changedFeatureCount: 65, removedFeatureCount: 0 },
      },
    });

    expect(plan.strategy).toBe('full');
    for (let index = 0; ; index += 1) {
      const unit = plan.preparationUnits?.unitAt(index);
      if (!unit) break;
      const before = stableFeatureReads;
      unit.run();
      expect(stableFeatureReads - before).toBeLessThanOrEqual(1);
      expect(fixture.source(ways).calls).toEqual([]);
    }
    stableFeatureReads = 0;

    plan.units[0]?.run();

    expect(stableFeatureReads).toBe(0);
    plan.commit();
    expect(fixture.source(ways).calls).toHaveLength(1);
  });

  it('stages each full source separately and publishes only after every source', () => {
    const stations = systemFeatureSourceId('stations');
    const ways = systemFeatureSourceId('ways');
    const fixture = renderSourceFixture([stations, ways]);
    const hitSource = new RecordingRenderSource();
    const updater = createRenderSceneSourceUpdater({
      resolveSource: fixture.source,
      resolveHitSource: () => hitSource,
      hitSourceId: 'tm-hit-features',
    });
    const stationFeatures = Array.from({ length: 3_800 }, (_, index) =>
      renderPointFeature(renderFeatureId(stations, 'marker', [`station-${index}`]), index),
    );
    const hitFeatures = Array.from({ length: 570 }, (_, index) =>
      renderPointFeature(renderFeatureId(stations, 'hit', [`station-${index}`]), index),
    );
    const next = renderScene(
      'large-initial',
      [
        { sourceId: stations, features: stationFeatures },
        { sourceId: ways, features: [] },
      ],
      hitFeatures,
    );

    const staged = updater.prepare(next);
    expect(staged.strategy).toBe('full');
    expect(staged.sourceIds).toEqual([stations, ways, 'tm-hit-features']);
    expect(staged.units.map((unit) => unit.id)).toEqual([
      `render-source:full:${stations}`,
      `render-source:full:${ways}`,
      'render-source:full:tm-hit-features',
    ]);
    expect(fixture.source(stations).calls).toEqual([]);
    expect(fixture.source(ways).calls).toEqual([]);
    expect(hitSource.calls).toEqual([]);

    staged.units[0].run();
    const stationCall = fixture.source(stations).calls[0];
    if (stationCall.method !== 'setData') {
      throw new Error('Expected a complete source upload.');
    }
    expect(stationCall.data.features).toHaveLength(3_800);
    expect(stationCall.data.features.map((feature) => feature.id)).toEqual(
      stationFeatures.map((feature) => feature.id).sort(),
    );
    expect(updater.currentScene()).toBeNull();
    staged.units[1].run();
    staged.units[2].run();
    const hitCall = hitSource.calls[0];
    if (hitCall.method !== 'setData') {
      throw new Error('Expected a complete hit upload.');
    }
    expect(hitCall.data.features).toHaveLength(570);
    expect(updater.currentScene()).toBeNull();

    const result = staged.commit();
    expect(result).toMatchObject({
      strategy: 'full',
      sourceUploadCount: 3,
      uploadedFeatureCount: 4_370,
    });
    expect(updater.currentScene()).toBe(next);
  });

  it('promotes a large patch to independently staged complete source uploads', () => {
    const stations = systemFeatureSourceId('stations');
    const fixture = renderSourceFixture([stations]);
    const hitSource = new RecordingRenderSource();
    const updater = createRenderSceneSourceUpdater({
      resolveSource: fixture.source,
      resolveHitSource: () => hitSource,
      hitSourceId: 'tm-hit-features',
    });
    updater.apply(renderScene('empty', [{ sourceId: stations, features: [] }]));
    fixture.source(stations).calls.length = 0;
    hitSource.calls.length = 0;
    const stationFeatures = Array.from({ length: 3_800 }, (_, index) =>
      renderPointFeature(renderFeatureId(stations, 'marker', [`station-${index}`]), index),
    );
    const hitFeatures = Array.from({ length: 570 }, (_, index) =>
      renderPointFeature(renderFeatureId(stations, 'hit', [`station-${index}`]), index),
    );
    const next = renderScene(
      'large-patch',
      [{ sourceId: stations, features: stationFeatures }],
      hitFeatures,
    );

    const previous = updater.currentScene();
    if (!previous) throw new Error('Expected the initial scene to be retained.');
    const staged = updater.prepare(next, { patch: diffRenderScenes(previous, next) });
    expect(staged.strategy).toBe('full');
    expect(staged.units.map((unit) => unit.id)).toEqual([
      `render-source:promoted-full:${stations}`,
      'render-source:promoted-full:tm-hit-features',
    ]);
    expect(fixture.source(stations).calls).toEqual([]);
    expect(hitSource.calls).toEqual([]);
    staged.units[0]?.run();
    expect(hitSource.calls).toEqual([]);
    staged.units[1]?.run();
    expect(updater.currentScene()?.revision).toBe('empty');
    const result = staged.commit();

    const stationCalls = fixture.source(stations).calls;
    const hitCalls = hitSource.calls;
    expect(stationCalls).toHaveLength(1);
    expect(hitCalls).toHaveLength(1);
    for (const call of [...stationCalls, ...hitCalls]) {
      if (call.method !== 'setData') throw new Error('Expected a complete source upload.');
    }
    expect(stationCalls[0]).toEqual({
      method: 'setData',
      data: next.featuresBySource.get(stations),
    });
    expect(result).toMatchObject({
      strategy: 'full',
      sourceUploadCount: 2,
      fullSourceUploadCount: 2,
      fallbackSourceUploadCount: 2,
      uploadedFeatureCount: 4_370,
    });
    expect(updater.currentScene()).toBe(next);
  });

  it('retains the prior scene and forces a full recovery after a staged source fails', () => {
    const stations = systemFeatureSourceId('stations');
    const ways = systemFeatureSourceId('ways');
    const fixture = renderSourceFixture([stations, ways]);
    const updater = createRenderSceneSourceUpdater({ resolveSource: fixture.source });
    const previous = renderScene('before-staged-failure', [
      {
        sourceId: ways,
        features: [renderPointFeature(renderFeatureId(ways, 'overview', ['way-a']), 1)],
      },
      {
        sourceId: stations,
        features: [renderPointFeature(renderFeatureId(stations, 'marker', ['station-a']), 1)],
      },
    ]);
    updater.apply(previous);
    fixture.source(stations).calls.length = 0;
    fixture.source(ways).calls.length = 0;
    fixture.source(ways).failNextSet = true;
    const staged = updater.prepare(
      renderScene('failed-reset', [
        {
          sourceId: ways,
          features: [renderPointFeature(renderFeatureId(ways, 'overview', ['way-a']), 2)],
        },
        {
          sourceId: stations,
          features: [renderPointFeature(renderFeatureId(stations, 'marker', ['station-a']), 2)],
        },
      ]),
      { intent: 'reset' },
    );

    staged.units[0]?.run();
    expect(() => staged.units[1]?.run()).toThrow('MapLibre rejected the full source');
    expect(updater.currentScene()).toBe(previous);
    expect(() => staged.commit()).toThrow('source transaction failed');

    const healed = updater.healCurrentScene();
    expect(healed.strategy).toBe('full');
    expect(updater.currentScene()).toBe(previous);
    const recoveredWayCall = fixture.source(ways).calls.at(-1);
    if (recoveredWayCall?.method !== 'setData') {
      throw new Error('Expected recovery to replace the retained way source.');
    }
    expect(
      recoveredWayCall.data.features.some(
        (feature) => typeof feature.id === 'string' && feature.id.includes('way-a'),
      ),
    ).toBe(true);
  });

  it('rejects a stale source transaction until it is explicitly abandoned', () => {
    const ways = systemFeatureSourceId('ways');
    const fixture = renderSourceFixture([ways]);
    const updater = createRenderSceneSourceUpdater({ resolveSource: fixture.source });
    const first = updater.prepare(renderScene('first', [{ sourceId: ways, features: [] }]));

    expect(() =>
      updater.prepare(renderScene('stale-successor', [{ sourceId: ways, features: [] }])),
    ).toThrow('source transaction is already active');

    first.abort();
    const successor = updater.prepare(renderScene('successor', [{ sourceId: ways, features: [] }]));
    expect(successor.strategy).toBe('full');
  });
});
