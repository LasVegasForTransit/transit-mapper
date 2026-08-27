import type { FeatureCollection } from 'geojson';
import { describe, expect, it } from 'vitest';
import { renderFeatureId, systemFeatureSourceId } from '@transitmapper/core/render/render-identity';
import { diffRenderScenes } from '@transitmapper/core/render/render-scene-diff';
import { createSourceBankDataStore } from '../src/sources/source-bank-data';
import { createSourceBankController } from '../src/sources/source-bank';
import type {
  GeoJsonSourceTarget,
  GeoJsonSourceUpdate,
} from '../src/sources/render-scene-source-updater';
import { renderPointFeature, renderScene } from './support/render-scene-source-updater.test';

class MaterializedSource implements GeoJsonSourceTarget {
  readonly features = new Map<string | number, FeatureCollection['features'][number]>();

  setData(collection: FeatureCollection): void {
    this.features.clear();
    for (const feature of collection.features) {
      if (feature.id !== undefined) this.features.set(feature.id, feature);
    }
  }

  updateData(update: GeoJsonSourceUpdate): void {
    for (const id of update.remove ?? []) this.features.delete(id);
    for (const feature of update.add ?? []) {
      if (feature.id !== undefined) this.features.set(feature.id, feature);
    }
  }

  ids(): string[] {
    return [...this.features.keys()].map(String).sort();
  }
}

function applyPlan(
  plan: ReturnType<ReturnType<typeof createSourceBankDataStore>['prepare']>,
): void {
  for (const unit of plan.units) unit.run();
  plan.stage();
  plan.markSourcesLoaded();
  plan.activate?.();
  plan.publish();
}

describe('banked render scene source updater', () => {
  it('activates physical ownership before publishing the incoming CPU scene', () => {
    const ways = systemFeatureSourceId('tm-ways');
    const controller = createSourceBankController();
    const updater = createSourceBankDataStore({
      controller,
      sourceIds: [ways],
      hitSourceId: 'tm-hit-features',
      resolveSource: () => new MaterializedSource(),
      resolveHitSource: () => new MaterializedSource(),
    });
    const next = renderScene('one', [{ sourceId: ways, features: [] }]);
    const plan = updater.prepare(next);
    for (const unit of plan.units) unit.run();
    plan.stage();
    plan.markSourcesLoaded();

    expect(controller.activeBank()).toBeNull();
    expect(updater.currentScene()).toBeNull();

    plan.activate?.();
    expect(controller.activeBank()).toBe('a');
    expect(updater.currentScene()).toBeNull();

    plan.publish();
    expect(updater.currentScene()).toBe(next);
  });

  it('rolls provisional ownership back when the activated render is rejected', () => {
    const ways = systemFeatureSourceId('tm-ways');
    const controller = createSourceBankController();
    const updater = createSourceBankDataStore({
      controller,
      sourceIds: [ways],
      hitSourceId: 'tm-hit-features',
      resolveSource: () => new MaterializedSource(),
      resolveHitSource: () => new MaterializedSource(),
    });
    const first = renderScene('one', [{ sourceId: ways, features: [] }]);
    applyPlan(updater.prepare(first));
    const second = renderScene('two', [
      {
        sourceId: ways,
        features: [renderPointFeature(renderFeatureId(ways, 'overview', ['two']), 2)],
      },
    ]);
    const failed = updater.prepare(second, { intent: 'reset' });
    for (const unit of failed.units) unit.run();
    failed.stage();
    failed.markSourcesLoaded();
    failed.activate?.();

    expect(controller.activeBank()).toBe('b');
    expect(controller.activeRevision()).toBe('two');
    expect(updater.currentScene()).toBe(first);

    failed.abort();
    expect(controller.activeBank()).toBe('a');
    expect(controller.activeRevision()).toBe('one');
    expect(controller.residentRevision('b')).toBeNull();
    expect(controller.snapshot().residentFeatureCountByBank.b).toBe(0);
    expect(updater.currentScene()).toBe(first);

    const retry = updater.prepare(second, { intent: 'reset' });
    applyPlan(retry);
    expect(controller.activeBank()).toBe('b');
    expect(controller.activeRevision()).toBe('two');
    expect(updater.currentScene()).toBe(second);
  });

  it('replays every transition since the inactive bank resident revision', () => {
    const ways = systemFeatureSourceId('tm-ways');
    const services = systemFeatureSourceId('tm-services');
    const stations = systemFeatureSourceId('tm-stations');
    const hitSourceId = 'tm-hit-features';
    const logicalSourceIds = [ways, services, stations];
    const controller = createSourceBankController();
    const physical = new Map<string, MaterializedSource>();
    const source = (id: string) => {
      let target = physical.get(id);
      if (!target) {
        target = new MaterializedSource();
        physical.set(id, target);
      }
      return target;
    };
    const updater = createSourceBankDataStore({
      controller,
      sourceIds: logicalSourceIds,
      hitSourceId,
      resolveSource: (sourceId, bank) => source(`${sourceId}--bank-${bank}`),
      resolveHitSource: (bank) => source(`${hitSourceId}--bank-${bank}`),
    });
    const way1 = renderPointFeature(renderFeatureId(ways, 'overview', ['one']), 1);
    const way2 = renderPointFeature(renderFeatureId(ways, 'overview', ['two']), 2);
    const service = renderPointFeature(renderFeatureId(services, 'line', ['one']), 3);
    const station = renderPointFeature(renderFeatureId(stations, 'marker', ['one']), 4);
    const hit = renderPointFeature(renderFeatureId(services, 'hit', ['one']), 5);
    const first = renderScene('one', [
      { sourceId: ways, features: [way1] },
      { sourceId: services, features: [] },
      { sourceId: stations, features: [] },
    ]);
    const second = renderScene('two', [
      { sourceId: ways, features: [way1, way2] },
      { sourceId: services, features: [service] },
      { sourceId: stations, features: [] },
    ]);
    const third = renderScene(
      'three',
      [
        { sourceId: ways, features: [way1, way2] },
        { sourceId: services, features: [service] },
        { sourceId: stations, features: [station] },
      ],
      [hit],
    );

    applyPlan(updater.prepare(first));
    const seed = updater.prepareInactiveSeed();
    if (!seed) throw new Error('Expected inactive bank preseed plan.');
    expect(seed.mode).toBe('seed');
    applyPlan(seed);
    expect(controller.activeBank()).toBe('a');
    const secondPlan = updater.prepare(second, { patch: diffRenderScenes(first, second) });
    expect(secondPlan.mode).toBe('hidden');
    expect(secondPlan.bank).toBe('b');
    expect(secondPlan.strategy).toBe('patch');
    applyPlan(secondPlan);
    const thirdPlan = updater.prepare(third, { patch: diffRenderScenes(second, third) });
    expect(thirdPlan.mode).toBe('hidden');
    expect(thirdPlan.bank).toBe('a');
    applyPlan(thirdPlan);

    for (const [sourceId, collection] of third.featuresBySource) {
      expect(source(`${sourceId}--bank-a`).ids()).toEqual(
        collection.features.map((feature) => feature.id).sort(),
      );
    }
    expect(source(`${hitSourceId}--bank-a`).ids()).toEqual(
      third.hitFeatures.features.map((feature) => feature.id).sort(),
    );
    expect(updater.residentScene('a')?.revision).toBe(third.revision);
    expect(updater.residentScene('b')?.revision).toBe(second.revision);
  });

  it('keeps a small one-source patch on the active bank without a flip', () => {
    const ways = systemFeatureSourceId('tm-ways');
    const controller = createSourceBankController();
    const sources = { a: new MaterializedSource(), b: new MaterializedSource() };
    const updater = createSourceBankDataStore({
      controller,
      sourceIds: [ways],
      hitSourceId: 'tm-hit-features',
      resolveSource: (_sourceId, bank) => sources[bank],
      resolveHitSource: () => new MaterializedSource(),
    });
    const first = renderScene('one', [{ sourceId: ways, features: [] }]);
    applyPlan(updater.prepare(first));
    const way = renderPointFeature(renderFeatureId(ways, 'overview', ['one']), 1);
    const second = renderScene('two', [{ sourceId: ways, features: [way] }]);
    const plan = updater.prepare(second, { patch: diffRenderScenes(first, second) });

    expect(plan.mode).toBe('active');
    expect(plan.bank).toBe('a');
    applyPlan(plan);
    expect(controller.snapshot().flipCount).toBe(1);
    expect(sources.a.ids()).toEqual([way.id]);
    expect(sources.b.ids()).toEqual([]);
  });

  it('requires the staged exact patch after the first banked scene', () => {
    const ways = systemFeatureSourceId('tm-ways');
    const controller = createSourceBankController();
    const updater = createSourceBankDataStore({
      controller,
      sourceIds: [ways],
      hitSourceId: 'tm-hit-features',
      resolveSource: () => new MaterializedSource(),
      resolveHitSource: () => new MaterializedSource(),
    });
    applyPlan(updater.prepare(renderScene('one', [{ sourceId: ways, features: [] }])));

    expect(() => updater.prepare(renderScene('two', [{ sourceId: ways, features: [] }]))).toThrow(
      'exact staged render scene patch',
    );
  });

  it('forces the other resident bank through a full seed after a reset barrier', () => {
    const ways = systemFeatureSourceId('tm-ways');
    const controller = createSourceBankController();
    const sources = { a: new MaterializedSource(), b: new MaterializedSource() };
    const updater = createSourceBankDataStore({
      controller,
      sourceIds: [ways],
      hitSourceId: 'tm-hit-features',
      resolveSource: (_sourceId, bank) => sources[bank],
      resolveHitSource: () => new MaterializedSource(),
    });
    const firstFeature = renderPointFeature(renderFeatureId(ways, 'overview', ['one']), 1);
    const first = renderScene('one', [{ sourceId: ways, features: [firstFeature] }]);
    applyPlan(updater.prepare(first));
    const initialSeed = updater.prepareInactiveSeed();
    if (!initialSeed) throw new Error('Expected initial inactive seed.');
    applyPlan(initialSeed);

    const resetFeature = renderPointFeature(renderFeatureId(ways, 'overview', ['reset']), 2);
    const reset = renderScene('reset', [{ sourceId: ways, features: [resetFeature] }]);
    const resetPlan = updater.prepare(reset, { intent: 'reset' });
    expect(resetPlan.strategy).toBe('full');
    applyPlan(resetPlan);
    expect(controller.activeRevision()).toBe('reset');

    const resetSeed = updater.prepareInactiveSeed();
    if (!resetSeed) throw new Error('Expected reset barrier to stale the outgoing bank.');
    expect(resetSeed.strategy).toBe('full');
    applyPlan(resetSeed);
    expect(updater.residentScene('a')?.revision).toBe('reset');
    expect(updater.residentScene('b')?.revision).toBe('reset');
    expect(sources.a.ids()).toEqual([resetFeature.id]);
    expect(sources.b.ids()).toEqual([resetFeature.id]);
  });

  it('records resident counts from exact scene stats without rematerializing hits', () => {
    const ways = systemFeatureSourceId('tm-ways');
    const controller = createSourceBankController();
    const updater = createSourceBankDataStore({
      controller,
      sourceIds: [ways],
      hitSourceId: 'tm-hit-features',
      resolveSource: () => new MaterializedSource(),
      resolveHitSource: () => new MaterializedSource(),
    });
    const hit = renderPointFeature(renderFeatureId(ways, 'hit', ['one']), 1);
    const next = renderScene('one', [{ sourceId: ways, features: [] }], [hit]);
    const features = next.hitFeatures.features;
    let featureReads = 0;
    Object.defineProperty(next.hitFeatures, 'features', {
      configurable: true,
      get: () => {
        featureReads += 1;
        return features;
      },
    });
    const plan = updater.prepare(next, { intent: 'reset' });
    for (const unit of plan.units) unit.run();
    plan.stage();
    plan.markSourcesLoaded();
    featureReads = 0;

    plan.activate?.();

    expect(featureReads).toBe(0);
    expect(controller.snapshot().residentFeatureCountByBank.a).toBe(1);
    plan.publish();
  });

  it('leaves the active scene untouched when a hidden-bank unit fails', () => {
    const ways = systemFeatureSourceId('tm-ways');
    const stations = systemFeatureSourceId('tm-stations');
    const controller = createSourceBankController();
    const sources = new Map<string, MaterializedSource>();
    const resolve = (id: string) => {
      const source = sources.get(id) ?? new MaterializedSource();
      sources.set(id, source);
      return source;
    };
    const updater = createSourceBankDataStore({
      controller,
      sourceIds: [ways, stations],
      hitSourceId: 'tm-hit-features',
      resolveSource: (sourceId, bank) => resolve(`${sourceId}--bank-${bank}`),
      resolveHitSource: (bank) => resolve(`tm-hit-features--bank-${bank}`),
    });
    const first = renderScene('one', [
      { sourceId: ways, features: [] },
      { sourceId: stations, features: [] },
    ]);
    applyPlan(updater.prepare(first));
    const second = renderScene('two', [
      {
        sourceId: ways,
        features: [renderPointFeature(renderFeatureId(ways, 'overview', ['one']), 1)],
      },
      {
        sourceId: stations,
        features: [renderPointFeature(renderFeatureId(stations, 'marker', ['one']), 2)],
      },
    ]);
    const plan = updater.prepare(second, { patch: diffRenderScenes(first, second) });
    plan.units[0]?.run();
    plan.abort();

    expect(controller.activeBank()).toBe('a');
    expect(updater.currentScene()).toBe(first);
    expect(controller.snapshot().abortCount).toBe(1);
  });

  it('keeps editor sources unbanked without changing active bank ownership', () => {
    const ways = systemFeatureSourceId('tm-ways');
    const handles = systemFeatureSourceId('tm-handles');
    const controller = createSourceBankController();
    const banked = { a: new MaterializedSource(), b: new MaterializedSource() };
    const editor = new MaterializedSource();
    const updater = createSourceBankDataStore({
      controller,
      sourceIds: [ways],
      unbankedSourceIds: [handles],
      hitSourceId: 'tm-hit-features',
      resolveSource: (_sourceId, bank) => banked[bank],
      resolveHitSource: () => new MaterializedSource(),
      resolveUnbankedSource: () => editor,
    });
    const first = renderScene(
      'one',
      [
        { sourceId: ways, features: [] },
        { sourceId: handles, features: [] },
      ],
      [renderPointFeature(renderFeatureId(ways, 'hit', ['one']), 1)],
    );
    applyPlan(updater.prepare(first, { requestedSourceIds: [ways] }));
    const handle = renderPointFeature(renderFeatureId(handles, 'point', ['one']), 1);
    const second = renderScene(
      'two',
      [
        { sourceId: ways, features: [] },
        { sourceId: handles, features: [handle] },
      ],
      [renderPointFeature(renderFeatureId(ways, 'hit', ['one']), 1)],
    );
    const plan = updater.prepare(second, {
      requestedSourceIds: [handles],
      patch: diffRenderScenes(first, second),
    });

    expect(plan.mode).toBe('unbanked');
    applyPlan(plan);
    expect(controller.activeBank()).toBe('a');
    expect(editor.ids()).toEqual([handle.id]);
    expect(banked.a.ids()).toEqual([]);
  });
});
