import { describe, expect, it } from 'vitest';
import { renderFeatureId, systemFeatureSourceId } from '@transitmapper/core/render/render-identity';
import { diffRenderScenes } from '@transitmapper/core/render/render-scene-diff';
import { createRenderSceneSourceUpdater } from '../../src/map/render-scene-source-updater';
import {
  RecordingRenderSource as RecordingSource,
  renderPointFeature as pointFeature,
  renderScene as scene,
  renderSourceFixture as sourceFixture,
} from '../support/render-scene-source-updater.test';

describe('render scene source updater', () => {
  it('uploads the initial scene in full', () => {
    const ways = systemFeatureSourceId('ways');
    const stations = systemFeatureSourceId('stations');
    const way = pointFeature(renderFeatureId(ways, 'overview', ['way-a']), 1);
    const station = pointFeature(renderFeatureId(stations, 'marker', ['station-a']), 2);
    const fixture = sourceFixture([ways, stations]);
    const updater = createRenderSceneSourceUpdater({ resolveSource: fixture.source });
    const next = scene('revision-1', [
      { sourceId: stations, features: [station] },
      { sourceId: ways, features: [way] },
    ]);

    const result = updater.apply(next);

    expect(fixture.source(ways).calls).toEqual([
      {
        method: 'setData',
        data: { type: 'FeatureCollection', features: [way] },
      },
    ]);
    expect(fixture.source(stations).calls).toEqual([
      {
        method: 'setData',
        data: { type: 'FeatureCollection', features: [station] },
      },
    ]);
    expect(result).toEqual({
      strategy: 'full',
      sourceUploadCount: 2,
      fullSourceUploadCount: 2,
      patchSourceUploadCount: 0,
      fallbackSourceUploadCount: 0,
      uploadedFeatureCount: 2,
      addedFeatureCount: 0,
      changedFeatureCount: 0,
      removedFeatureCount: 0,
    });
    expect(updater.currentScene()).toBe(next);
  });

  it('uploads only changed sources through a stable-ID patch', () => {
    const ways = systemFeatureSourceId('ways');
    const stations = systemFeatureSourceId('stations');
    const wayA = renderFeatureId(ways, 'overview', ['way-a']);
    const wayB = renderFeatureId(ways, 'overview', ['way-b']);
    const wayC = renderFeatureId(ways, 'overview', ['way-c']);
    const stationA = renderFeatureId(stations, 'marker', ['station-a']);
    const fixture = sourceFixture([ways, stations]);
    const updater = createRenderSceneSourceUpdater({ resolveSource: fixture.source });
    updater.apply(
      scene('revision-1', [
        { sourceId: ways, features: [pointFeature(wayA, 1), pointFeature(wayC, 4)] },
        { sourceId: stations, features: [pointFeature(stationA, 5)] },
      ]),
    );
    fixture.source(ways).calls.length = 0;
    fixture.source(stations).calls.length = 0;
    const changedWay = pointFeature(wayA, 2);
    const addedWay = pointFeature(wayB, 3);
    const next = scene('revision-2', [
      { sourceId: ways, features: [changedWay, addedWay] },
      { sourceId: stations, features: [pointFeature(stationA, 5)] },
    ]);

    const result = updater.apply(next, { patch: diffRenderScenes(updater.currentScene()!, next) });

    expect(fixture.source(ways).calls).toEqual([
      { method: 'updateData', data: { add: [changedWay, addedWay], remove: [wayC] } },
    ]);
    expect(fixture.source(stations).calls).toEqual([]);
    expect(result).toEqual({
      strategy: 'patch',
      sourceUploadCount: 1,
      fullSourceUploadCount: 0,
      patchSourceUploadCount: 1,
      fallbackSourceUploadCount: 0,
      uploadedFeatureCount: 3,
      addedFeatureCount: 1,
      changedFeatureCount: 1,
      removedFeatureCount: 1,
    });
    expect(updater.currentScene()).toBe(next);
  });

  it('does not upload semantically identical scenes', () => {
    const ways = systemFeatureSourceId('ways');
    const wayA = renderFeatureId(ways, 'overview', ['way-a']);
    const fixture = sourceFixture([ways]);
    const updater = createRenderSceneSourceUpdater({ resolveSource: fixture.source });
    updater.apply(scene('revision-1', [{ sourceId: ways, features: [pointFeature(wayA, 1)] }]));
    fixture.source(ways).calls.length = 0;
    const next = scene('revision-2', [{ sourceId: ways, features: [pointFeature(wayA, 1)] }]);

    const result = updater.apply(next, { patch: diffRenderScenes(updater.currentScene()!, next) });

    expect(fixture.source(ways).calls).toEqual([]);
    expect(result).toEqual({
      strategy: 'none',
      sourceUploadCount: 0,
      fullSourceUploadCount: 0,
      patchSourceUploadCount: 0,
      fallbackSourceUploadCount: 0,
      uploadedFeatureCount: 0,
      addedFeatureCount: 0,
      changedFeatureCount: 0,
      removedFeatureCount: 0,
    });
    expect(updater.currentScene()).toBe(next);
  });

  it('requires the staged exact patch after an initial scene', () => {
    const ways = systemFeatureSourceId('ways');
    const fixture = sourceFixture([ways]);
    const updater = createRenderSceneSourceUpdater({ resolveSource: fixture.source });
    updater.apply(scene('revision-1', [{ sourceId: ways, features: [] }]));

    expect(() => updater.prepare(scene('revision-2', [{ sourceId: ways, features: [] }]))).toThrow(
      'exact staged render scene patch',
    );
  });

  it.each(['reset', 'style-heal'] as const)(
    'uploads every next source in full for a %s intent',
    (intent) => {
      const ways = systemFeatureSourceId('ways');
      const wayA = renderFeatureId(ways, 'overview', ['way-a']);
      const fixture = sourceFixture([ways]);
      const updater = createRenderSceneSourceUpdater({ resolveSource: fixture.source });
      updater.apply(scene('revision-1', [{ sourceId: ways, features: [pointFeature(wayA, 1)] }]));
      fixture.source(ways).calls.length = 0;
      const unchangedWay = pointFeature(wayA, 1);

      const result = updater.apply(
        scene('revision-2', [{ sourceId: ways, features: [unchangedWay] }]),
        { intent },
      );

      expect(fixture.source(ways).calls).toEqual([
        {
          method: 'setData',
          data: { type: 'FeatureCollection', features: [unchangedWay] },
        },
      ]);
      expect(result.strategy).toBe('full');
      expect(result.fullSourceUploadCount).toBe(1);
      expect(result.uploadedFeatureCount).toBe(1);
    },
  );

  it('clears a source removed from a reset scene', () => {
    const ways = systemFeatureSourceId('ways');
    const stations = systemFeatureSourceId('stations');
    const fixture = sourceFixture([ways, stations]);
    const updater = createRenderSceneSourceUpdater({ resolveSource: fixture.source });
    updater.apply(
      scene('revision-1', [
        {
          sourceId: ways,
          features: [pointFeature(renderFeatureId(ways, 'overview', ['way-a']), 1)],
        },
        {
          sourceId: stations,
          features: [pointFeature(renderFeatureId(stations, 'marker', ['station-a']), 2)],
        },
      ]),
    );
    fixture.source(ways).calls.length = 0;
    fixture.source(stations).calls.length = 0;

    updater.apply(scene('revision-2', [{ sourceId: ways, features: [] }]), {
      intent: 'reset',
    });

    expect(fixture.source(stations).calls).toEqual([
      { method: 'setData', data: { type: 'FeatureCollection', features: [] } },
    ]);
  });

  it('invalidates submitted source state when a target throws synchronously', () => {
    const ways = systemFeatureSourceId('ways');
    const wayA = renderFeatureId(ways, 'overview', ['way-a']);
    const fixture = sourceFixture([ways]);
    const updater = createRenderSceneSourceUpdater({ resolveSource: fixture.source });
    updater.apply(scene('revision-1', [{ sourceId: ways, features: [pointFeature(wayA, 1)] }]));
    fixture.source(ways).calls.length = 0;
    fixture.source(ways).failNextUpdate = true;
    const changedWay = pointFeature(wayA, 2);
    const next = scene('revision-2', [{ sourceId: ways, features: [changedWay] }]);

    expect(() =>
      updater.apply(next, { patch: diffRenderScenes(updater.currentScene()!, next) }),
    ).toThrow('MapLibre rejected the patch');
    expect(fixture.source(ways).calls).toEqual([
      { method: 'updateData', data: { add: [changedWay] } },
    ]);
    expect(updater.currentScene()?.revision).toBe('revision-1');

    const healed = updater.healCurrentScene();
    expect(healed.strategy).toBe('full');
    expect(fixture.source(ways).calls.at(-1)).toEqual({
      method: 'setData',
      data: { type: 'FeatureCollection', features: [expect.objectContaining({ id: wayA })] },
    });
  });

  it('explicitly invalidates and reapplies the latest submitted scene after an asynchronous source error', () => {
    const ways = systemFeatureSourceId('ways');
    const wayA = renderFeatureId(ways, 'overview', ['way-a']);
    const fixture = sourceFixture([ways]);
    const updater = createRenderSceneSourceUpdater({ resolveSource: fixture.source });
    updater.apply(scene('revision-1', [{ sourceId: ways, features: [pointFeature(wayA, 1)] }]));
    fixture.source(ways).calls.length = 0;
    const latest = scene('revision-2', [{ sourceId: ways, features: [pointFeature(wayA, 2)] }]);

    updater.apply(latest, { patch: diffRenderScenes(updater.currentScene()!, latest) });
    // Real MapLibre worker rejection is reported later through an error event;
    // updateData itself does not throw. The map adapter invalidates explicitly.
    updater.invalidateSourceState();
    const healed = updater.healCurrentScene();

    expect(updater.currentScene()).toBe(latest);
    expect(fixture.source(ways).calls).toEqual([
      { method: 'updateData', data: { add: [expect.objectContaining({ id: wayA })] } },
      {
        method: 'setData',
        data: { type: 'FeatureCollection', features: [expect.objectContaining({ id: wayA })] },
      },
    ]);
    expect(healed).toMatchObject({
      strategy: 'full',
      sourceUploadCount: 1,
      fullSourceUploadCount: 1,
      patchSourceUploadCount: 0,
      fallbackSourceUploadCount: 0,
    });
  });

  it('returns a no-op when asked to heal before any scene was submitted', () => {
    const updater = createRenderSceneSourceUpdater({ resolveSource: () => undefined });

    expect(updater.healCurrentScene()).toEqual({
      strategy: 'none',
      sourceUploadCount: 0,
      fullSourceUploadCount: 0,
      patchSourceUploadCount: 0,
      fallbackSourceUploadCount: 0,
      uploadedFeatureCount: 0,
      addedFeatureCount: 0,
      changedFeatureCount: 0,
      removedFeatureCount: 0,
    });
  });

  it('updates hit geometry through its dedicated source target', () => {
    const ways = systemFeatureSourceId('ways');
    const hitSource = new RecordingSource();
    const fixture = sourceFixture([ways]);
    const updater = createRenderSceneSourceUpdater({
      resolveSource: fixture.source,
      resolveHitSource: () => hitSource,
      hitSourceId: 'tm-hit-features',
    });
    const visual = pointFeature(renderFeatureId(ways, 'overview', ['way-a']), 1);
    const hitId = renderFeatureId(ways, 'hit', ['way-a']);
    updater.apply(
      scene('revision-1', [{ sourceId: ways, features: [visual] }], [pointFeature(hitId, 1)]),
    );
    fixture.source(ways).calls.length = 0;
    hitSource.calls.length = 0;
    const changedHit = pointFeature(hitId, 2);

    const next = scene('revision-2', [{ sourceId: ways, features: [visual] }], [changedHit]);
    const result = updater.apply(next, {
      patch: diffRenderScenes(updater.currentScene()!, next),
    });

    expect(fixture.source(ways).calls).toEqual([]);
    expect(hitSource.calls).toEqual([{ method: 'updateData', data: { add: [changedHit] } }]);
    expect(result).toEqual({
      strategy: 'patch',
      sourceUploadCount: 1,
      fullSourceUploadCount: 0,
      patchSourceUploadCount: 1,
      fallbackSourceUploadCount: 0,
      uploadedFeatureCount: 1,
      addedFeatureCount: 0,
      changedFeatureCount: 1,
      removedFeatureCount: 0,
    });
  });

  it('plans a full hit upload from exact scene stats without materializing hit features', () => {
    const ways = systemFeatureSourceId('ways');
    const fixture = sourceFixture([ways]);
    const hitSource = new RecordingSource();
    const updater = createRenderSceneSourceUpdater({
      resolveSource: fixture.source,
      resolveHitSource: () => hitSource,
      hitSourceId: 'tm-hit-features',
    });
    const hit = pointFeature(renderFeatureId(ways, 'hit', ['way-a']), 1);
    const next = scene('revision-1', [{ sourceId: ways, features: [] }], [hit]);
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

    expect(featureReads).toBe(0);
    expect(plan.sourceIds).toContain('tm-hit-features');
    plan.abort();
  });

  it('rejects nonempty hit geometry before uploading when no hit target exists', () => {
    const ways = systemFeatureSourceId('ways');
    const fixture = sourceFixture([ways]);
    const updater = createRenderSceneSourceUpdater({ resolveSource: fixture.source });

    expect(() =>
      updater.apply(
        scene(
          'revision-1',
          [
            {
              sourceId: ways,
              features: [pointFeature(renderFeatureId(ways, 'overview', ['way-a']), 1)],
            },
          ],
          [pointFeature(renderFeatureId(ways, 'hit', ['way-a']), 1)],
        ),
      ),
    ).toThrow('Render scene has hit features but no hit source target is available.');
    expect(fixture.source(ways).calls).toEqual([]);
    expect(updater.currentScene()).toBeNull();
  });

  it('resolves a required hit target once before uploading', () => {
    const ways = systemFeatureSourceId('ways');
    const fixture = sourceFixture([ways]);
    const laterHitSource = new RecordingSource();
    let resolutionCount = 0;
    const updater = createRenderSceneSourceUpdater({
      resolveSource: fixture.source,
      resolveHitSource: () => {
        resolutionCount += 1;
        return resolutionCount === 1 ? undefined : laterHitSource;
      },
      hitSourceId: 'tm-hit-features',
    });

    expect(() =>
      updater.apply(
        scene(
          'revision-1',
          [{ sourceId: ways, features: [] }],
          [pointFeature(renderFeatureId(ways, 'hit', ['way-a']), 1)],
        ),
      ),
    ).toThrow('Render scene has hit features but no hit source target is available.');
    expect(resolutionCount).toBe(1);
    expect(fixture.source(ways).calls).toEqual([]);
    expect(laterHitSource.calls).toEqual([]);
  });

  it('does not advance the retained scene when a full upload fails', () => {
    const ways = systemFeatureSourceId('ways');
    const wayA = renderFeatureId(ways, 'overview', ['way-a']);
    const fixture = sourceFixture([ways]);
    const updater = createRenderSceneSourceUpdater({ resolveSource: fixture.source });
    const previous = scene('revision-1', [{ sourceId: ways, features: [pointFeature(wayA, 1)] }]);
    updater.apply(previous);
    const source = fixture.source(ways);
    source.setData = () => {
      throw new Error('MapLibre source is unavailable');
    };

    expect(() =>
      updater.apply(scene('revision-2', [{ sourceId: ways, features: [pointFeature(wayA, 2)] }]), {
        intent: 'reset',
      }),
    ).toThrow('MapLibre source is unavailable');
    expect(updater.currentScene()).toBe(previous);
  });
});
