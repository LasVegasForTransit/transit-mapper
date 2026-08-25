import { describe, expect, it } from 'vitest';
import { renderFeatureId, systemFeatureSourceId } from '@transitmapper/core/render/render-identity';
import { diffRenderScenes } from '@transitmapper/core/render/render-scene-diff';
import {
  composeRenderScenePatches,
  filterRenderScenePatch,
  renderScenePatchEntryCount,
  renderScenePatchSourceCount,
} from '../src/render-scene-patch-journal';
import { renderPointFeature, renderScene } from './support/render-scene-source-updater.test';

describe('render scene patch journal', () => {
  it('composes every disjoint transition after one bank resident revision', () => {
    const ways = systemFeatureSourceId('ways');
    const services = systemFeatureSourceId('services');
    const stations = systemFeatureSourceId('stations');
    const way = renderPointFeature(renderFeatureId(ways, 'overview', ['way']), 1);
    const service = renderPointFeature(renderFeatureId(services, 'line', ['service']), 2);
    const station = renderPointFeature(renderFeatureId(stations, 'marker', ['station']), 3);
    const first = renderScene('one', [
      { sourceId: ways, features: [way] },
      { sourceId: services, features: [] },
      { sourceId: stations, features: [] },
    ]);
    const second = renderScene('two', [
      { sourceId: ways, features: [way] },
      { sourceId: services, features: [service] },
      { sourceId: stations, features: [] },
    ]);
    const third = renderScene('three', [
      { sourceId: ways, features: [way] },
      { sourceId: services, features: [service] },
      { sourceId: stations, features: [station] },
    ]);

    const composed = composeRenderScenePatches(third.revision, [
      diffRenderScenes(first, second),
      diffRenderScenes(second, third),
    ]);

    expect(composed.add.get(services)?.map((feature) => feature.id)).toEqual([service.id]);
    expect(composed.add.get(stations)?.map((feature) => feature.id)).toEqual([station.id]);
    expect(composed.add.has(ways)).toBe(false);
    expect(renderScenePatchSourceCount(composed)).toBe(2);
    expect(renderScenePatchEntryCount(composed)).toBe(2);
  });

  it('filters editor sources without dropping committed hit changes', () => {
    const ways = systemFeatureSourceId('ways');
    const handles = systemFeatureSourceId('handles');
    const way = renderPointFeature(renderFeatureId(ways, 'overview', ['way']), 1);
    const handle = renderPointFeature(renderFeatureId(handles, 'point', ['handle']), 2);
    const hit = renderPointFeature(renderFeatureId(ways, 'hit', ['way']), 3);
    const before = renderScene('before', [
      { sourceId: ways, features: [] },
      { sourceId: handles, features: [] },
    ]);
    const after = renderScene(
      'after',
      [
        { sourceId: ways, features: [way] },
        { sourceId: handles, features: [handle] },
      ],
      [hit],
    );

    const filtered = filterRenderScenePatch(diffRenderScenes(before, after), new Set([ways]), true);

    expect([...filtered.add.keys()]).toEqual([ways]);
    expect(filtered.hitFeatures.add).toEqual([hit]);
    expect(renderScenePatchSourceCount(filtered)).toBe(2);
  });
});
