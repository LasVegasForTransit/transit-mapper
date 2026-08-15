import { describe, expect, it } from 'vitest';
import { renderFeatureId, systemFeatureSourceId } from '@transitmapper/core/render/render-identity';
import { diffRenderScenes } from '@transitmapper/core/render/render-scene-diff';
import type { RenderScene } from '@transitmapper/core/render/render-scene';
import { createRenderSceneSourceUpdater } from '../../src/map/render-scene-source-updater';
import {
  RecordingRenderSource as RecordingSource,
  renderPointFeature as pointFeature,
  renderScene as scene,
  renderSourceFixture as sourceFixture,
} from '../support/render-scene-source-updater.test';

function acceptedScene(updater: { currentScene(): RenderScene | null }): RenderScene {
  const current = updater.currentScene();
  if (!current) throw new Error('Expected a submitted render scene.');
  return current;
}

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

  it('does not mutate an already-empty source during the first full upload', () => {
    const ways = systemFeatureSourceId('ways');
    const stations = systemFeatureSourceId('stations');
    const way = pointFeature(renderFeatureId(ways, 'overview', ['way-a']), 1);
    const fixture = sourceFixture([ways, stations]);
    const updater = createRenderSceneSourceUpdater({ resolveSource: fixture.source });

    const result = updater.apply(
      scene('revision-1', [
        { sourceId: ways, features: [way] },
        { sourceId: stations, features: [] },
      ]),
    );

    expect(fixture.source(ways).calls).toEqual([
      { method: 'setData', data: { type: 'FeatureCollection', features: [way] } },
    ]);
    expect(fixture.source(stations).calls).toEqual([]);
    expect(result.sourceUploadCount).toBe(1);
  });

  it('marks cleared visual and hit sources as absent from the incoming revision', () => {
    const ways = systemFeatureSourceId('ways');
    const way = pointFeature(renderFeatureId(ways, 'overview', ['way-a']), 1);
    const hit = pointFeature(renderFeatureId(ways, 'hit', ['way-a']), 1);
    const fixture = sourceFixture([ways]);
    const hitSource = new RecordingSource();
    const updater = createRenderSceneSourceUpdater({
      resolveSource: fixture.source,
      resolveHitSource: () => hitSource,
      hitSourceId: 'tm-hit-features',
    });
    const first = scene('revision-1', [{ sourceId: ways, features: [way] }], [hit]);
    const next = scene('revision-2', [{ sourceId: ways, features: [] }]);

    updater.apply(first);
    const plan = updater.prepare(next, { intent: 'reset' });

    expect(plan.sourceIds).toEqual([String(ways), 'tm-hit-features']);
    expect(plan.clearedSourceIds).toEqual([String(ways), 'tm-hit-features']);
    plan.abort();
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

    const result = updater.apply(next, { patch: diffRenderScenes(acceptedScene(updater), next) });

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

    const result = updater.apply(next, { patch: diffRenderScenes(acceptedScene(updater), next) });

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
      patch: diffRenderScenes(acceptedScene(updater), next),
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

  it('does not mutate an already-empty hit source during the first full upload', () => {
    const ways = systemFeatureSourceId('ways');
    const fixture = sourceFixture([ways]);
    const hitSource = new RecordingSource();
    const updater = createRenderSceneSourceUpdater({
      resolveSource: fixture.source,
      resolveHitSource: () => hitSource,
      hitSourceId: 'tm-hit-features',
    });

    const result = updater.apply(scene('revision-1', [{ sourceId: ways, features: [] }]));

    expect(fixture.source(ways).calls).toEqual([]);
    expect(hitSource.calls).toEqual([]);
    expect(result.sourceUploadCount).toBe(0);
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
});
