import { describe, expect, it } from 'vitest';
import { MODE_ORDER, WAY_TYPE_ORDER } from '../../src/model/catalog';
import { wholeLeg, oneSection } from '../../src/model/geo';
import type { LngLat } from '../../src/model/system';
import {
  buildFeatures,
  type RenderViewOptions,
  type SystemFeatureName,
} from '../../src/render/buildFeatures';
import { namedWayLabelDependencyId } from '../../src/render/dependency-index';
import { renderDomainIdentity, systemFeatureSourceId } from '../../src/render/render-identity';
import { createSystemRenderScene } from '../../src/render/system-render-scene';
import { aRoad, aService, aSystem } from '../support/fixtures.test';
import {
  OVERVIEW_TEST_PRESENTATION,
  STREET_TEST_PRESENTATION,
} from '../support/render-presentation.test';

const NETWORK_VIEW: RenderViewOptions = {
  viewMode: 'network',
  visibleModes: new Set(MODE_ORDER),
  visibleWayTypes: new Set(WAY_TYPE_ORDER),
  presentation: OVERVIEW_TEST_PRESENTATION,
};

const INFRASTRUCTURE_VIEW: RenderViewOptions = {
  ...NETWORK_VIEW,
  viewMode: 'infrastructure',
  presentation: STREET_TEST_PRESENTATION,
};

const NAMED_WAY_VIEW: RenderViewOptions = {
  ...INFRASTRUCTURE_VIEW,
  presentation: {
    ...STREET_TEST_PRESENTATION,
    bounds: {
      southwest: [-115.21, 36.13],
      northeast: [-115.15, 36.15],
    },
  },
};

const FEATURE_NAMES: readonly SystemFeatureName[] = [
  'ways',
  'services',
  'stations',
  'handles',
  'serviceTermini',
  'footprints',
  'platforms',
  'facilities',
  'physicalHandles',
  'lanes',
  'laneMarkings',
  'laneArrows',
  'serviceArrows',
  'junctions',
  'connectors',
  'wayLabels',
];

const SOURCE_IDS = Object.fromEntries(
  FEATURE_NAMES.map((name) => [name, systemFeatureSourceId(`test-${name}`)]),
) as Record<SystemFeatureName, ReturnType<typeof systemFeatureSourceId>>;

function fixture() {
  const way = aRoad('way', [
    [-115.2, 36.14],
    [-115.16, 36.14],
  ]);
  const service = aService('service', [
    { id: 'pattern', sections: oneSection([wholeLeg(way.id)]) },
  ]);
  return aSystem({ ways: [way], services: [service] });
}

describe('system render scene', () => {
  it('separates invisible hit geometry while preserving source identity', () => {
    const features = buildFeatures(fixture(), null, [], NETWORK_VIEW);
    const scene = createSystemRenderScene({
      revision: 'revision-1',
      features,
      sourceIds: SOURCE_IDS,
    });

    expect(scene.featuresBySource.get(SOURCE_IDS.services)?.features).not.toHaveLength(0);
    expect(
      scene.featuresBySource
        .get(SOURCE_IDS.services)
        ?.features.every((feature) => feature.properties?.hitTarget !== true),
    ).toBe(true);
    expect(scene.hitFeatures.features).not.toHaveLength(0);
    expect(
      scene.hitFeatures.features.every(
        (feature) => feature.properties?.renderSourceId === SOURCE_IDS.services,
      ),
    ).toBe(true);
  });

  it('maps one domain entity to every visual and hit fragment it owns', () => {
    const scene = createSystemRenderScene({
      revision: 'revision-1',
      features: buildFeatures(fixture(), null, [], NETWORK_VIEW),
      sourceIds: SOURCE_IDS,
    });
    const serviceIds = scene.identityIndex.renderFeatureIdsByDomain.get(
      renderDomainIdentity('service', 'service'),
    );
    const wayIds = scene.identityIndex.renderFeatureIdsByDomain.get(
      renderDomainIdentity('way', 'way'),
    );

    expect(serviceIds?.length).toBeGreaterThan(1);
    expect(wayIds?.length).toBeGreaterThan(0);
    expect(serviceIds?.some((id) => scene.hitFeatures.features.some((hit) => hit.id === id))).toBe(
      true,
    );
  });

  it('keeps scene identities stable when settled coordinates change', () => {
    const system = fixture();
    const before = createSystemRenderScene({
      revision: 'before',
      features: buildFeatures(system, null, [], NETWORK_VIEW),
      sourceIds: SOURCE_IDS,
    });
    const changed = {
      ...system,
      ways: system.ways.map((way) => ({
        ...way,
        points: [way.points[0], [-115.15, 36.16] as LngLat],
      })),
    };
    const after = createSystemRenderScene({
      revision: 'after',
      features: buildFeatures(changed, null, [], NETWORK_VIEW),
      sourceIds: SOURCE_IDS,
    });
    const ids = (scene: typeof before) =>
      [
        ...[...scene.featuresBySource.values()].flatMap((collection) =>
          collection.features.map((feature) => feature.id),
        ),
        ...scene.hitFeatures.features.map((feature) => feature.id),
      ].sort();

    expect(ids(after)).toEqual(ids(before));
  });

  it('binds each named-way member to its exact label dependency for removal', () => {
    const west = aRoad('west', [
      [-115.2, 36.14],
      [-115.18, 36.14],
    ]);
    const east = aRoad('east', [
      [-115.18, 36.14],
      [-115.16, 36.14],
    ]);
    const system = aSystem({
      ways: [west, east],
      services: [],
      namedWays: [{ id: 'main-name', name: 'Main Street', wayIds: [west.id, east.id] }],
    });
    const scene = createSystemRenderScene({
      revision: 'before-removal',
      features: buildFeatures(system, null, [], NAMED_WAY_VIEW),
      sourceIds: SOURCE_IDS,
    });
    const westDependency = renderDomainIdentity(
      'labelDependency',
      namedWayLabelDependencyId('main-name', west.id),
    );
    const eastDependency = renderDomainIdentity(
      'labelDependency',
      namedWayLabelDependencyId('main-name', east.id),
    );
    const westIds = scene.identityIndex.renderFeatureIdsByDomain.get(westDependency);
    const eastIds = scene.identityIndex.renderFeatureIdsByDomain.get(eastDependency);

    expect(westIds).toHaveLength(1);
    expect(eastIds).toHaveLength(1);
    expect(westIds).not.toEqual(eastIds);

    const afterRemoval = createSystemRenderScene({
      revision: 'after-removal',
      features: buildFeatures(
        {
          ...system,
          namedWays: [{ ...system.namedWays[0], wayIds: [west.id] }],
        },
        null,
        [],
        NAMED_WAY_VIEW,
      ),
      sourceIds: SOURCE_IDS,
    });

    expect(afterRemoval.identityIndex.renderFeatureIdsByDomain.get(westDependency)).toEqual(
      westIds,
    );
    expect(afterRemoval.identityIndex.renderFeatureIdsByDomain.has(eastDependency)).toBe(false);
  });
});
