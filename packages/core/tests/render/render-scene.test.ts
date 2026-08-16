import type { Feature, FeatureCollection, Point } from 'geojson';
import { describe, expect, it } from 'vitest';
import {
  createRenderIdentityIndex,
  renderDomainIdentity,
  renderFeatureId,
  systemFeatureSourceId,
  type RenderFeatureId,
  type SystemFeatureSourceId,
} from '../../src/render/render-identity';
import {
  createRenderScene,
  emptyRenderSceneStats,
  renderSceneRevision,
} from '../../src/render/render-scene';

function pointFeature(id: RenderFeatureId, x: number): Feature<Point> {
  return {
    type: 'Feature',
    id,
    properties: { x },
    geometry: { type: 'Point', coordinates: [x, 0] },
  };
}

function collection(features: Feature[]): FeatureCollection {
  return { type: 'FeatureCollection', features };
}

describe('render scene', () => {
  it('normalizes sources and features into deterministic stable-ID order', () => {
    const ways = systemFeatureSourceId('ways');
    const services = systemFeatureSourceId('services');
    const wayA = renderFeatureId(ways, 'line', ['a']);
    const wayB = renderFeatureId(ways, 'line', ['b']);
    const serviceA = renderFeatureId(services, 'line', ['a']);
    const hitA = renderFeatureId(ways, 'domain-hit', ['a']);

    const scene = createRenderScene({
      revision: renderSceneRevision('revision-1'),
      featuresBySource: new Map<SystemFeatureSourceId, FeatureCollection>([
        [ways, collection([pointFeature(wayB, 2), pointFeature(wayA, 1)])],
        [services, collection([pointFeature(serviceA, 3)])],
      ]),
      hitFeatures: collection([pointFeature(hitA, 4)]),
      identityIndex: createRenderIdentityIndex([
        {
          domainIdentity: renderDomainIdentity('way', 'a'),
          renderFeatureIds: [wayA],
        },
      ]),
      stats: emptyRenderSceneStats(),
    });

    expect([...scene.featuresBySource.keys()]).toEqual([services, ways]);
    expect(scene.featuresBySource.get(ways)?.features.map((feature) => feature.id)).toEqual([
      wayA,
      wayB,
    ]);
    expect(scene.hitFeatures.features.map((feature) => feature.id)).toEqual([hitA]);
    expect(scene.revision).toBe('revision-1');
  });

  it('keeps lower LOD paint tiers before higher tiers regardless of ID text', () => {
    const ways = systemFeatureSourceId('ways');
    const overview = pointFeature(renderFeatureId(ways, 'z-role', ['overview']), 1);
    const districtA = pointFeature(renderFeatureId(ways, 'a-role', ['district-a']), 2);
    const districtB = pointFeature(renderFeatureId(ways, 'b-role', ['district-b']), 3);
    const street = pointFeature(renderFeatureId(ways, '0-role', ['street']), 4);
    overview.properties = { renderTier: 'overview' };
    districtA.properties = { renderTier: 'district' };
    districtB.properties = { renderTier: 'district' };
    street.properties = { renderTier: 'street' };

    const scene = createRenderScene({
      revision: renderSceneRevision('tier-order'),
      featuresBySource: new Map([[ways, collection([street, districtB, overview, districtA])]]),
      hitFeatures: collection([]),
      stats: emptyRenderSceneStats(),
    });

    expect(scene.featuresBySource.get(ways)?.features.map((feature) => feature.id)).toEqual([
      overview.id,
      districtA.id,
      districtB.id,
      street.id,
    ]);
  });

  it('rejects missing top-level string feature IDs', () => {
    const ways = systemFeatureSourceId('ways');
    const missingId: Feature<Point> = {
      type: 'Feature',
      properties: { wayId: 'way-a' },
      geometry: { type: 'Point', coordinates: [0, 0] },
    };

    expect(() =>
      createRenderScene({
        revision: renderSceneRevision('revision-1'),
        featuresBySource: new Map([[ways, collection([missingId])]]),
        hitFeatures: collection([]),
        stats: emptyRenderSceneStats(),
      }),
    ).toThrow(/top-level string ID.*ways/i);
  });

  it('rejects duplicate feature IDs within a visual source', () => {
    const ways = systemFeatureSourceId('ways');
    const duplicateId = renderFeatureId(ways, 'line', ['way-a']);

    expect(() =>
      createRenderScene({
        revision: renderSceneRevision('revision-1'),
        featuresBySource: new Map([
          [ways, collection([pointFeature(duplicateId, 1), pointFeature(duplicateId, 2)])],
        ]),
        hitFeatures: collection([]),
        stats: emptyRenderSceneStats(),
      }),
    ).toThrow(/duplicate.*ways/i);
  });

  it('rejects an identity index that references a feature outside the scene', () => {
    const ways = systemFeatureSourceId('ways');
    const absent = renderFeatureId(ways, 'line', ['absent']);

    expect(() =>
      createRenderScene({
        revision: renderSceneRevision('revision-1'),
        featuresBySource: new Map([[ways, collection([])]]),
        hitFeatures: collection([]),
        identityIndex: createRenderIdentityIndex([
          {
            domainIdentity: renderDomainIdentity('way', 'absent'),
            renderFeatureIds: [absent],
          },
        ]),
        stats: emptyRenderSceneStats(),
      }),
    ).toThrow(/identity index.*absent/i);
  });

  it('keeps batched visual geometry separate from per-domain hit geometry', () => {
    const services = systemFeatureSourceId('services');
    const visualId = renderFeatureId(services, 'shared-run', ['run-a']);
    const hitA = renderFeatureId(services, 'domain-hit', ['service-a']);
    const hitB = renderFeatureId(services, 'domain-hit', ['service-b']);
    const domainA = renderDomainIdentity('service', 'service-a');
    const domainB = renderDomainIdentity('service', 'service-b');

    const scene = createRenderScene({
      revision: renderSceneRevision('revision-1'),
      featuresBySource: new Map([[services, collection([pointFeature(visualId, 1)])]]),
      hitFeatures: collection([pointFeature(hitB, 2), pointFeature(hitA, 3)]),
      identityIndex: createRenderIdentityIndex([
        { domainIdentity: domainA, renderFeatureIds: [visualId] },
        { domainIdentity: domainB, renderFeatureIds: [visualId] },
      ]),
      stats: {
        ...emptyRenderSceneStats(),
        candidateFeatureCount: 2,
        visibleFeatureCount: 2,
        generatedVisualFeatureCount: 1,
        generatedHitFeatureCount: 2,
      },
    });

    expect(scene.featuresBySource.get(services)?.features).toHaveLength(1);
    expect(scene.hitFeatures.features).toHaveLength(2);
    expect(scene.identityIndex.renderFeatureIdsByDomain.get(domainA)).toEqual([visualId]);
    expect(scene.identityIndex.renderFeatureIdsByDomain.get(domainB)).toEqual([visualId]);
  });

  it('rejects empty scene revisions', () => {
    expect(() => renderSceneRevision('')).toThrow(/revision/i);
  });
});
