import type { Feature, FeatureCollection, Point } from 'geojson';
import { describe, expect, it } from 'vitest';
import {
  renderFeatureId,
  systemFeatureSourceId,
  type RenderFeatureId,
  type SystemFeatureSourceId,
} from '../../src/render/render-identity';
import {
  createRenderScene,
  emptyRenderSceneStats,
  renderSceneRevision,
  type RenderScene,
} from '../../src/render/render-scene';
import { diffRenderScenes } from '../../src/render/render-scene-diff';

function pointFeature(id: RenderFeatureId, x: number, properties = {}): Feature<Point> {
  return {
    type: 'Feature',
    id,
    properties,
    geometry: { type: 'Point', coordinates: [x, 0] },
  };
}

function collection(features: Feature[]): FeatureCollection {
  return { type: 'FeatureCollection', features };
}

interface SceneSource {
  sourceId: SystemFeatureSourceId;
  features: Feature[];
}

function scene(
  revision: string,
  sources: readonly SceneSource[],
  hitFeatures: Feature[] = [],
): RenderScene {
  return createRenderScene({
    revision: renderSceneRevision(revision),
    featuresBySource: new Map(
      sources.map(({ sourceId, features }) => [sourceId, collection(features)]),
    ),
    hitFeatures: collection(hitFeatures),
    stats: emptyRenderSceneStats(),
  });
}

describe('render scene diff', () => {
  it('emits an empty patch for semantically identical scenes', () => {
    const ways = systemFeatureSourceId('ways');
    const wayA = renderFeatureId(ways, 'line', ['way-a']);
    const previous = scene('revision-1', [
      { sourceId: ways, features: [pointFeature(wayA, 1, { hierarchy: 'primary' })] },
    ]);
    const next = scene('revision-2', [
      { sourceId: ways, features: [pointFeature(wayA, 1, { hierarchy: 'primary' })] },
    ]);

    const patch = diffRenderScenes(previous, next);

    expect(patch.revision).toBe('revision-2');
    expect([...patch.add]).toEqual([]);
    expect([...patch.remove]).toEqual([]);
    expect(patch.hitFeatures).toEqual({ add: [], remove: [] });
    expect(patch.stats).toEqual({
      addedFeatureCount: 0,
      changedFeatureCount: 0,
      removedFeatureCount: 0,
    });
  });

  it('replaces a changed stable feature through add without clearing its source', () => {
    const ways = systemFeatureSourceId('ways');
    const wayA = renderFeatureId(ways, 'line', ['way-a']);
    const previous = scene('revision-1', [{ sourceId: ways, features: [pointFeature(wayA, 1)] }]);
    const changed = pointFeature(wayA, 2);
    const next = scene('revision-2', [{ sourceId: ways, features: [changed] }]);

    const patch = diffRenderScenes(previous, next);

    expect(patch.add.get(ways)).toEqual([changed]);
    expect(patch.remove.has(ways)).toBe(false);
    expect(patch.stats).toEqual({
      addedFeatureCount: 0,
      changedFeatureCount: 1,
      removedFeatureCount: 0,
    });
  });

  it('orders source patches and feature payloads deterministically', () => {
    const ways = systemFeatureSourceId('ways');
    const services = systemFeatureSourceId('services');
    const wayA = renderFeatureId(ways, 'line', ['a']);
    const wayB = renderFeatureId(ways, 'line', ['b']);
    const wayC = renderFeatureId(ways, 'line', ['c']);
    const serviceA = renderFeatureId(services, 'line', ['a']);
    const serviceB = renderFeatureId(services, 'line', ['b']);
    const previous = scene('revision-1', [
      { sourceId: ways, features: [pointFeature(wayC, 3), pointFeature(wayA, 1)] },
      { sourceId: services, features: [pointFeature(serviceB, 5)] },
    ]);
    const next = scene('revision-2', [
      { sourceId: ways, features: [pointFeature(wayB, 2)] },
      { sourceId: services, features: [pointFeature(serviceA, 4)] },
    ]);

    const patch = diffRenderScenes(previous, next);

    expect([...patch.add.keys()]).toEqual([services, ways]);
    expect(patch.add.get(ways)?.map((feature) => feature.id)).toEqual([wayB]);
    expect(patch.remove.get(ways)).toEqual([wayA, wayC]);
    expect(patch.stats).toEqual({
      addedFeatureCount: 2,
      changedFeatureCount: 0,
      removedFeatureCount: 3,
    });
  });

  it('diffs hit features independently from batched visual sources', () => {
    const services = systemFeatureSourceId('services');
    const visual = renderFeatureId(services, 'shared-run', ['run-a']);
    const hitA = renderFeatureId(services, 'domain-hit', ['service-a']);
    const hitB = renderFeatureId(services, 'domain-hit', ['service-b']);
    const previous = scene(
      'revision-1',
      [{ sourceId: services, features: [pointFeature(visual, 1)] }],
      [pointFeature(hitA, 2)],
    );
    const next = scene(
      'revision-2',
      [{ sourceId: services, features: [pointFeature(visual, 1)] }],
      [pointFeature(hitB, 3)],
    );

    const patch = diffRenderScenes(previous, next);

    expect([...patch.add]).toEqual([]);
    expect([...patch.remove]).toEqual([]);
    expect(patch.hitFeatures.add.map((feature) => feature.id)).toEqual([hitB]);
    expect(patch.hitFeatures.remove).toEqual([hitA]);
    expect(patch.stats).toEqual({
      addedFeatureCount: 1,
      changedFeatureCount: 0,
      removedFeatureCount: 1,
    });
  });
});
