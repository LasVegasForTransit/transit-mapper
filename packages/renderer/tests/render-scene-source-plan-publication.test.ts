import { describe, expect, it } from 'vitest';
import { renderFeatureId, systemFeatureSourceId } from '@transitmapper/core/render/render-identity';
import { diffRenderScenes } from '@transitmapper/core/render/render-scene-diff';
import { createRenderSceneSourceUpdater } from '../src/sources/render-scene-source-updater';
import {
  renderPointFeature,
  renderScene,
  renderSourceFixture,
} from './support/render-scene-source-updater.test';

describe('render scene source plan publication', () => {
  it('retains the accepted CPU scene after source submission until publication', () => {
    const ways = systemFeatureSourceId('ways');
    const fixture = renderSourceFixture([ways]);
    const updater = createRenderSceneSourceUpdater({ resolveSource: fixture.source });
    const first = renderScene('first', [{ sourceId: ways, features: [] }]);
    updater.apply(first);
    const next = renderScene('next', [
      {
        sourceId: ways,
        features: [renderPointFeature(renderFeatureId(ways, 'overview', ['a']), 1)],
      },
    ]);
    const plan = updater.prepare(next, { patch: diffRenderScenes(first, next) });

    plan.units[0]?.run();
    const result = plan.stage();
    expect(result.strategy).toBe('patch');
    expect(updater.currentScene()).toBe(first);

    plan.publish();
    expect(updater.currentScene()).toBe(next);
  });

  it('abandons a staged but unpublished source revision without advancing CPU state', () => {
    const ways = systemFeatureSourceId('ways');
    const fixture = renderSourceFixture([ways]);
    const updater = createRenderSceneSourceUpdater({ resolveSource: fixture.source });
    const first = renderScene('first', [{ sourceId: ways, features: [] }]);
    updater.apply(first);
    const next = renderScene('next', [
      {
        sourceId: ways,
        features: [renderPointFeature(renderFeatureId(ways, 'overview', ['a']), 1)],
      },
    ]);
    const plan = updater.prepare(next, { patch: diffRenderScenes(first, next) });

    plan.units[0]?.run();
    plan.stage();
    plan.abort();

    expect(updater.currentScene()).toBe(first);
    expect(updater.prepare(next).strategy).toBe('full');
  });
});
