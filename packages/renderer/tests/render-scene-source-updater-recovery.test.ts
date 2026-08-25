import { describe, expect, it } from 'vitest';
import { renderFeatureId, systemFeatureSourceId } from '@transitmapper/core/render/render-identity';
import { diffRenderScenes } from '@transitmapper/core/render/render-scene-diff';
import type { RenderScene } from '@transitmapper/core/render/render-scene';
import { createRenderSceneSourceUpdater } from '../src/render-scene-source-updater';
import {
  renderPointFeature as pointFeature,
  renderScene as scene,
  renderSourceFixture as sourceFixture,
} from './support/render-scene-source-updater.test';

function acceptedScene(updater: { currentScene(): RenderScene | null }): RenderScene {
  const current = updater.currentScene();
  if (!current) throw new Error('Expected a submitted render scene.');
  return current;
}

describe('render scene source recovery', () => {
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
      updater.apply(next, { patch: diffRenderScenes(acceptedScene(updater), next) }),
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

    updater.apply(latest, { patch: diffRenderScenes(acceptedScene(updater), latest) });
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
