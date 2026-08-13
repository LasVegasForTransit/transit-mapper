import type { Feature } from 'geojson';
import { describe, expect, it } from 'vitest';
import { MODE_ORDER, WAY_TYPE_ORDER } from '../../src/model/catalog';
import { defaultProfileFor, profileWidthM } from '../../src/model/profile';
import type { CrossSection, LngLat, Way } from '../../src/model/system';
import {
  buildFeatures,
  createFeatureBuildOperationCounts,
  type RenderViewOptions,
  type SystemFeatures,
} from '../../src/render/buildFeatures';
import { widthPxAtZ14 } from '../../src/render/constants';
import { featureCollectionStats } from '../../src/render/feature-stats';
import type { RenderPresentation } from '../../src/render/render-presentation';
import { createRenderTierStateResolver } from '../../src/render/render-presentation';
import { aPattern, aRoad, aService, aSystem } from '../support/fixtures.test';

const BOUNDS = {
  southwest: [-115.3, 36] as LngLat,
  northeast: [-115, 36.3] as LngLat,
};

function presentation(zoom: number): RenderPresentation {
  return {
    bounds: BOUNDS,
    zoom,
    viewportWidthPx: 1_440,
    viewportHeightPx: 900,
    displayedWidthPx: 1_440,
    displayedHeightPx: 900,
    pixelRatio: 1,
  };
}

function infrastructureView(zoom: number): RenderViewOptions {
  return {
    viewMode: 'infrastructure',
    visibleModes: new Set(MODE_ORDER),
    visibleWayTypes: new Set(WAY_TYPE_ORDER),
    presentation: presentation(zoom),
  };
}

function infrastructureViewAtWidth(
  way: Way,
  displayedWidthPx: number,
  overrides: Partial<RenderViewOptions> = {},
): RenderViewOptions {
  const corridorWidthAtZ14 = widthPxAtZ14(profileWidthM(way.profile), way.points[0]?.[1] ?? 0);
  return {
    ...infrastructureView(14 + Math.log2(displayedWidthPx / corridorWidthAtZ14)),
    ...overrides,
  };
}

function featureProperty(feature: Feature, name: string): unknown {
  return feature.properties?.[name];
}

function paintedServiceFeatures(features: SystemFeatures): Feature[] {
  return features.services.features.filter(
    (feature) => featureProperty(feature, 'hitTarget') !== true,
  );
}

function hitServiceIds(features: SystemFeatures): string[] {
  return features.services.features
    .filter((feature) => featureProperty(feature, 'hitTarget') === true)
    .map((feature) => String(feature.id))
    .sort();
}

const SYSTEM_FEATURE_NAMES: readonly (keyof SystemFeatures)[] = [
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

describe('screen-space corridor detail', () => {
  it('emits one overview silhouette regardless of lane count', () => {
    const points: LngLat[] = [
      [-115.2, 36.14],
      [-115.16, 36.14],
    ];
    const twoLane = aRoad('road', points, { profile: defaultProfileFor('road', 2) });
    const eightLane = aRoad('road', points, { profile: defaultProfileFor('road', 8) });

    const twoLaneFeatures = buildFeatures(
      aSystem({ ways: [twoLane] }),
      null,
      [],
      infrastructureView(8),
    );
    const eightLaneFeatures = buildFeatures(
      aSystem({ ways: [eightLane] }),
      null,
      [],
      infrastructureView(8),
    );

    expect(twoLaneFeatures.ways.features).toHaveLength(1);
    expect(eightLaneFeatures.ways.features).toHaveLength(1);
    expect(eightLaneFeatures.ways.features[0]?.properties).toMatchObject({
      renderTier: 'overview',
      offset: 0,
      hasOverviewTier: true,
      hasDistrictTier: false,
      hasStreetTier: false,
    });
    expect(typeof eightLaneFeatures.ways.features[0]?.properties?.projectedWidthPx).toBe('number');
    expect(eightLaneFeatures.lanes.features).toEqual([]);
  });

  it('keeps complete Overview output constant across lanes, medians, and tracks', () => {
    const points: LngLat[] = [
      [-115.2, 36.14],
      [-115.16, 36.14],
    ];
    const mixedProfile: CrossSection = {
      lanes: [
        { id: 'walk-west', kindId: 'sidewalk', widthM: 1.8, direction: 'both' },
        { id: 'track-west', kindId: 'track', widthM: 4, direction: 'backward' },
        { id: 'median', kindId: 'median', widthM: 3, direction: 'both' },
        { id: 'bus-east', kindId: 'bus', widthM: 3.6, direction: 'forward' },
        { id: 'parking-east', kindId: 'parking', widthM: 2.4, direction: 'both' },
        { id: 'walk-east', kindId: 'sidewalk', widthM: 1.8, direction: 'both' },
      ],
    };
    const variants = [
      { typeId: 'road', modeId: 'bus', profile: defaultProfileFor('road', 1) },
      { typeId: 'road', modeId: 'bus', profile: defaultProfileFor('road', 8) },
      { typeId: 'road', modeId: 'bus', profile: mixedProfile },
      { typeId: 'heavyRail', modeId: 'subway', profile: defaultProfileFor('heavyRail', 1) },
      { typeId: 'heavyRail', modeId: 'subway', profile: defaultProfileFor('heavyRail', 8) },
    ];

    const statsFor = (served: boolean) =>
      variants.map(({ typeId, modeId, profile }) => {
        const way = aRoad('corridor', points, { typeId, profile });
        const services = served
          ? [
              aService('service', [aPattern('pattern', [way], [way.id])], {
                modeId,
              }),
            ]
          : [];
        const features = buildFeatures(
          aSystem({ ways: [way], services }),
          null,
          [],
          infrastructureViewAtWidth(way, 1),
        );
        expect(features.ways.features).toHaveLength(1);
        expect(features.lanes.features).toEqual([]);
        return featureCollectionStats(SYSTEM_FEATURE_NAMES.map((name) => features[name]));
      });

    for (const served of [false, true]) {
      const stats = statsFor(served);
      expect(new Set(stats.map(({ featureCount }) => featureCount))).toEqual(
        new Set([stats[0]?.featureCount]),
      );
      expect(new Set(stats.map(({ vertexCount }) => vertexCount))).toEqual(
        new Set([stats[0]?.vertexCount]),
      );
    }
  });

  it('enters district and street geometry from projected CSS width', () => {
    const road = aRoad('road', [
      [-115.2, 36.14],
      [-115.16, 36.14],
    ]);
    const system = aSystem({ ways: [road] });

    const district = buildFeatures(system, null, [], infrastructureView(14));
    const street = buildFeatures(system, null, [], infrastructureView(19));

    expect(
      district.ways.features.some((feature) => feature.properties?.renderTier === 'district'),
    ).toBe(true);
    expect(district.lanes.features).toEqual([]);
    expect(street.lanes.features.length).toBeGreaterThan(0);
    expect(
      street.lanes.features.every((feature) => feature.properties?.renderTier === 'street'),
    ).toBe(true);
  });

  it('tessellates physical curves more finely only when the display can resolve them', () => {
    const road = aRoad(
      'curve',
      [
        [-115.2, 36.14],
        [-115.19, 36.14],
        [-115.19, 36.15],
      ],
      {
        geometry: 'curved',
        curveControls: [{ pointIndex: 1, radiusM: 80 }],
        profile: defaultProfileFor('road', 8),
      },
    );
    const system = aSystem({ ways: [road] });
    const far = buildFeatures(system, null, [], infrastructureView(8));
    const near = buildFeatures(system, null, [], infrastructureView(20));
    expect(near.lanes.features[0].geometry.type).toBe('Polygon');
    expect(near.lanes.features[0].geometry.coordinates[0].length).toBeGreaterThan(
      far.ways.features[0].geometry.coordinates.length,
    );
  });

  it('emits twin rails and one compact tie collection for each visible track', () => {
    const railway = aRoad(
      'railway',
      [
        [-115.2, 36.14],
        [-115.16, 36.14],
      ],
      { typeId: 'lightRail', profile: defaultProfileFor('lightRail') },
    );
    const features = buildFeatures(
      aSystem({ ways: [railway] }),
      null,
      [],
      infrastructureViewAtWidth(railway, 12),
    );
    const rails = features.laneMarkings.features.filter(
      (feature) => feature.properties?.kind === 'rail',
    );
    const ties = features.laneMarkings.features.filter(
      (feature) => feature.properties?.kind === 'railTie',
    );

    expect(rails).toHaveLength(2);
    expect(rails.every((feature) => feature.geometry.type === 'LineString')).toBe(true);
    expect(ties).toHaveLength(1);
    expect(ties[0]?.geometry.type).toBe('MultiLineString');
  });

  it('stamps the z14 corridor width at the final displayed scale', () => {
    const road = aRoad(
      'scaled-road',
      [
        [-115.2, 36.14],
        [-115.16, 36.14],
      ],
      { profile: defaultProfileFor('road', 8) },
    );
    const view = infrastructureView(14);
    view.presentation = {
      ...view.presentation,
      displayedWidthPx: view.presentation.viewportWidthPx / 2,
      displayedHeightPx: view.presentation.viewportHeightPx / 2,
    };
    const feature = buildFeatures(aSystem({ ways: [road] }), null, [], view).ways.features[0];
    const corridorW14 = widthPxAtZ14(profileWidthM(road.profile), road.points[0]?.[1] ?? 0);

    expect(featureProperty(feature, 'corridorW14')).toBeCloseTo(corridorW14, 8);
    expect(featureProperty(feature, 'corridorDisplayW14')).toBeCloseTo(corridorW14 / 2, 8);
    expect(featureProperty(feature, 'projectedWidthPx')).toBeCloseTo(corridorW14 / 2, 8);
  });

  it('cross-fades service centerlines into lane geometry with stable tier-qualified IDs', () => {
    const road = aRoad('road', [
      [-115.2, 36.14],
      [-115.16, 36.14],
    ]);
    const service = aService('service', [aPattern('pattern', [road], [road.id])]);
    const system = aSystem({ ways: [road], services: [service] });

    const overviewOverlap = buildFeatures(system, null, [], infrastructureViewAtWidth(road, 3));
    const overlap = buildFeatures(system, null, [], infrastructureViewAtWidth(road, 10.5));
    const settledStreet = buildFeatures(system, null, [], infrastructureViewAtWidth(road, 12));
    const overlapPaint = paintedServiceFeatures(overlap);

    expect(overlap.ways.features.map((feature) => featureProperty(feature, 'renderTier'))).toEqual([
      'district',
      'street',
    ]);
    const serviceTierOrder = overlapPaint.map((feature) => featureProperty(feature, 'renderTier'));
    expect(serviceTierOrder[0]).toBe('district');
    expect(serviceTierOrder.slice(1).every((tier) => tier === 'street')).toBe(true);
    expect(new Set(overlapPaint.map((feature) => featureProperty(feature, 'renderTier')))).toEqual(
      new Set(['district', 'street']),
    );
    expect(
      new Set(
        paintedServiceFeatures(overviewOverlap).map((feature) =>
          featureProperty(feature, 'renderTier'),
        ),
      ),
    ).toEqual(new Set(['overview', 'district']));
    for (const feature of overlapPaint) {
      const opacity = featureProperty(feature, 'tierOpacity');
      expect(typeof opacity).toBe('number');
      if (typeof opacity === 'number') expect(opacity).toBeCloseTo(0.5, 8);
      const projectedWidth = featureProperty(feature, 'projectedWidthPx');
      expect(typeof projectedWidth).toBe('number');
      if (typeof projectedWidth === 'number') expect(projectedWidth).toBeCloseTo(10.5, 8);
      expect(featureProperty(feature, 'hasOverviewTier')).toBe(false);
      expect(featureProperty(feature, 'hasDistrictTier')).toBe(true);
      expect(featureProperty(feature, 'hasStreetTier')).toBe(true);
    }
    expect(
      overlapPaint.some(
        (feature) =>
          featureProperty(feature, 'renderTier') === 'district' &&
          JSON.stringify(feature.geometry) ===
            JSON.stringify({ type: 'LineString', coordinates: road.points }),
      ),
    ).toBe(true);
    expect(new Set(overlapPaint.map((feature) => feature.id)).size).toBe(overlapPaint.length);
    expect(
      paintedServiceFeatures(settledStreet).every(
        (feature) => featureProperty(feature, 'renderTier') === 'street',
      ),
    ).toBe(true);
    expect(hitServiceIds(overlap)).toEqual(hitServiceIds(settledStreet));
    expect(new Set(hitServiceIds(overlap)).size).toBe(hitServiceIds(overlap).length);
  });

  it('keeps served exclusive guideways visible in Infrastructure Overview', () => {
    const rail = aRoad(
      'rail',
      [
        [-115.2, 36.14],
        [-115.16, 36.14],
      ],
      { typeId: 'heavyRail', profile: defaultProfileFor('heavyRail') },
    );
    const service = aService('subway', [aPattern('subway-pattern', [rail], [rail.id])], {
      modeId: 'subway',
    });
    const features = buildFeatures(
      aSystem({ ways: [rail], services: [service] }),
      null,
      [],
      infrastructureViewAtWidth(rail, 1),
    );

    const overviewGuideway = features.ways.features.find(
      (feature) =>
        featureProperty(feature, 'id') === rail.id &&
        featureProperty(feature, 'renderTier') === 'overview',
    );
    expect(overviewGuideway).toBeDefined();
    if (!overviewGuideway) throw new Error('expected the served guideway overview feature');
    expect(featureProperty(overviewGuideway, 'typeId')).toBe('heavyRail');
  });

  it('wires per-document hysteresis into projection and counts logical transitions', () => {
    const road = aRoad('road', [
      [-115.2, 36.14],
      [-115.16, 36.14],
    ]);
    const system = aSystem({ ways: [road] });
    const tierStateResolver = createRenderTierStateResolver();
    const viewAt = (width: number): RenderViewOptions =>
      infrastructureViewAtWidth(road, width, { tierStateResolver });

    buildFeatures(system, null, [], viewAt(12));
    const retainedCounts = createFeatureBuildOperationCounts();
    const retained = buildFeatures(system, null, [], viewAt(9), null, null, {
      counts: retainedCounts,
    });
    expect(retained.lanes.features).toEqual([]);
    expect(retainedCounts.featureTierTransitionCount).toBe(0);

    const leavingCounts = createFeatureBuildOperationCounts();
    const leaving = buildFeatures(system, null, [], viewAt(8.999), null, null, {
      counts: leavingCounts,
    });
    expect(leaving.lanes.features).toEqual([]);
    expect(leavingCounts.featureTierTransitionCount).toBe(1);
  });

  it('keeps underground corridors visible when Street geometry is unavailable', () => {
    const tunnel = aRoad(
      'tunnel',
      [
        [-115.2, 36.14],
        [-115.16, 36.14],
      ],
      { grade: 'underground' },
    );
    const system = aSystem({ ways: [tunnel] });

    for (const width of [11.999, 12, 12.001]) {
      const features = buildFeatures(system, null, [], infrastructureViewAtWidth(tunnel, width));
      expect(features.lanes.features).toEqual([]);
      expect(
        features.ways.features.some(
          (feature) =>
            featureProperty(feature, 'renderTier') === 'district' &&
            featureProperty(feature, 'underground') === true,
        ),
      ).toBe(true);
    }
  });
});
