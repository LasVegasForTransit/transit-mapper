import type { Feature } from 'geojson';
import { describe, expect, it } from 'vitest';
import { MODE_ORDER, WAY_TYPE_ORDER } from '../../src/model/catalog';
import { profileWidthM } from '../../src/model/profile';
import type { LngLat, Way } from '../../src/model/system';
import {
  buildFeatures,
  createFeatureBuildOperationCounts,
  type RenderViewOptions,
  type SystemFeatures,
} from '../../src/render/buildFeatures';
import { widthPxAtZ14 } from '../../src/render/constants';
import type { RenderPresentation } from '../../src/render/render-presentation';
import { renderViewportTransitionMarginDegrees } from '../../src/render/render-viewport-margin';
import { aPattern, aRoad, aService, aStation, aStop, aSystem } from '../support/fixtures.test';

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

const SYSTEM_FEATURE_NAMES: readonly (keyof SystemFeatures)[] = [
  'ways',
  'services',
  'stops',
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

function allFeatures(features: SystemFeatures): Feature[] {
  return SYSTEM_FEATURE_NAMES.flatMap((name) => features[name].features as readonly Feature[]);
}

describe('screen-space corridor projection contracts', () => {
  it('preloads Street geometry inside the viewport transition margin', () => {
    const longitudePerPixel =
      (BOUNDS.northeast[0] - BOUNDS.southwest[0]) / presentation(19).viewportWidthPx;
    const roadOutsideBy = (id: string, pixels: number) =>
      aRoad(id, [
        [BOUNDS.southwest[0] - longitudePerPixel * pixels, 36.14],
        [BOUNDS.southwest[0] - longitudePerPixel * pixels, 36.16],
      ]);
    const preloaded = roadOutsideBy('preloaded', 32);
    const transitionMarginPixels = Math.ceil(
      renderViewportTransitionMarginDegrees(presentation(19)) / longitudePerPixel,
    );
    const excluded = roadOutsideBy('excluded', transitionMarginPixels + 1);

    const features = buildFeatures(
      aSystem({ ways: [preloaded, excluded] }),
      null,
      [],
      infrastructureView(19),
    );
    const laneWayIds = new Set(
      features.lanes.features.map((feature) => featureProperty(feature, 'wayId')),
    );

    expect(laneWayIds.has(preloaded.id)).toBe(true);
    expect(laneWayIds.has(excluded.id)).toBe(false);
  });

  it.each([3, 4, 5])(
    'keeps Street service paint connected through a %s-arm junction',
    (armCount) => {
      const nodeCoord: LngLat = [-115.18, 36.14];
      const west = aRoad('west', [[-115.2, 36.14], nodeCoord]);
      const east = aRoad('east', [nodeCoord, [-115.16, 36.14]]);
      const extraArms = [
        aRoad('north', [nodeCoord, [-115.18, 36.16]]),
        aRoad('south', [nodeCoord, [-115.18, 36.12]]),
        aRoad('northeast', [nodeCoord, [-115.16, 36.16]]),
      ].slice(0, armCount - 2);
      const ways = [west, east, ...extraArms];
      const node = {
        id: 'junction',
        coord: nodeCoord,
        refs: ways.map((way, index) => ({
          wayId: way.id,
          pointIndex: index === 0 ? 1 : 0,
        })),
      };
      const service = aService('service', [aPattern('pattern', ways, [west.id, east.id])]);
      const system = aSystem({ ways, nodes: [node], services: [service] });

      for (const width of [9, 10.5, 12]) {
        const features = buildFeatures(system, null, [], infrastructureViewAtWidth(west, width));
        const streetPaint = paintedServiceFeatures(features).filter(
          (feature) => featureProperty(feature, 'renderTier') === 'street',
        );
        const streetHits = features.services.features.filter(
          (feature) =>
            featureProperty(feature, 'hitTarget') === true &&
            featureProperty(feature, 'renderTier') === 'street',
        );
        if (width === 9) {
          expect(streetPaint).toEqual([]);
          expect(streetHits).toEqual([]);
          continue;
        }
        expect(streetPaint.length).toBeGreaterThan(0);
        expect(streetHits.length).toBeGreaterThan(0);
        expect(
          [...streetPaint, ...streetHits].every(
            (feature) =>
              feature.geometry.type === 'LineString' &&
              feature.geometry.coordinates.some(
                (coordinate) => coordinate[0] === nodeCoord[0] && coordinate[1] === nodeCoord[1],
              ),
          ),
        ).toBe(true);
      }
    },
  );

  it('defers mode and way visibility to immutable feature properties when requested', () => {
    const west = aRoad('west', [
      [-115.2, 36.14],
      [-115.18, 36.14],
    ]);
    const east = aRoad('east', [
      [-115.18, 36.14],
      [-115.16, 36.14],
    ]);
    const north = aRoad('north', [
      [-115.18, 36.14],
      [-115.18, 36.16],
    ]);
    const service = aService('service', [aPattern('pattern', [west], [west.id])]);
    const stop = aStop('stop', [-115.19, 36.14], { wayId: west.id, t: 0.5 });
    const node = {
      id: 'junction',
      coord: west.points[1],
      refs: [
        { wayId: west.id, pointIndex: 1 },
        { wayId: east.id, pointIndex: 0 },
        { wayId: north.id, pointIndex: 0 },
      ],
    };
    const system = aSystem({
      ways: [west, east, north],
      services: [service],
      stops: [stop],
      nodes: [node],
    });
    const deferred = (visible: boolean): RenderViewOptions =>
      infrastructureViewAtWidth(west, 12, {
        visibleModes: new Set(visible ? MODE_ORDER : []),
        visibleWayTypes: new Set(visible ? WAY_TYPE_ORDER : []),
        styleDeferredVisibility: true,
      });

    const hiddenByStyle = buildFeatures(system, { kind: 'node', id: node.id }, [], deferred(false));
    const shownByStyle = buildFeatures(system, { kind: 'node', id: node.id }, [], deferred(true));
    expect(hiddenByStyle).toEqual(shownByStyle);
    expect(featureProperty(hiddenByStyle.ways.features[0], 'typeId')).toBe('road');
    expect(featureProperty(paintedServiceFeatures(hiddenByStyle)[0], 'modeId')).toBe('bus');
    expect(featureProperty(hiddenByStyle.stops.features[0], 'servedModeIds')).toEqual(['bus']);
    expect(featureProperty(hiddenByStyle.junctions.features[0], 'typeIds')).toEqual(['road']);
    expect(
      hiddenByStyle.connectors.features.every((feature) =>
        Array.isArray(featureProperty(feature, 'typeIds')),
      ),
    ).toBe(true);

    const sourceFiltered = buildFeatures(system, null, [], {
      ...deferred(false),
      styleDeferredVisibility: false,
    });
    expect(sourceFiltered.ways.features).toEqual([]);
    expect(paintedServiceFeatures(sourceFiltered)).toEqual([]);
  });

  it('gives every settled feature a unique stable top-level string ID', () => {
    const road = aRoad('road', [
      [-115.2, 36.14],
      [-115.16, 36.14],
    ]);
    const before = buildFeatures(aSystem({ ways: [road] }), null, ['road'], infrastructureView(19));
    const changedGeometry = buildFeatures(
      aSystem({ ways: [{ ...road, points: [road.points[0], [-115.15, 36.15]] }] }),
      null,
      ['road'],
      infrastructureView(19),
    );
    const beforeIds = allFeatures(before).map((feature) => feature.id);
    const changedIds = allFeatures(changedGeometry).map((feature) => feature.id);

    expect(beforeIds.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(beforeIds).size).toBe(beforeIds.length);
    expect(changedIds).toEqual(beforeIds);
  });

  it('visits only ordered viewport candidates across topology, junction, and station passes', () => {
    const visible = aRoad('visible', [
      [-115.2, 36.14],
      [-115.16, 36.14],
    ]);
    const offscreen = aRoad('offscreen', [
      [-114.2, 36.14],
      [-114.16, 36.14],
    ]);
    const counts = createFeatureBuildOperationCounts();
    const system = aSystem({
      ways: [visible, offscreen],
      nodes: [
        {
          id: 'visible-node',
          coord: visible.points[0],
          refs: [{ wayId: visible.id, pointIndex: 0 }],
        },
        {
          id: 'offscreen-node',
          coord: offscreen.points[0],
          refs: [{ wayId: offscreen.id, pointIndex: 0 }],
        },
      ],
      stations: [
        aStation('visible-station', [-115.18, 36.14]),
        aStation('offscreen-station', [-114.18, 36.14]),
      ],
    });

    // Warm every immutable ID/spatial index before the measured camera-only
    // projection. The second pass must remain proportional to visible IDs.
    buildFeatures(system, null, [], infrastructureView(19));

    const features = buildFeatures(system, null, [], infrastructureView(19), null, null, {
      counts,
    });

    const renderedWayIds = features.lanes.features.flatMap((feature) => {
      const wayId: unknown = feature.properties?.wayId;
      return typeof wayId === 'string' ? [wayId] : [];
    });
    expect(new Set(renderedWayIds)).toEqual(new Set(['visible']));
    expect(counts).toMatchObject({
      featureTopologyWayVisitCount: 1,
      featureJunctionNodeVisitCount: 1,
      featurePhysicalStationVisitCount: 1,
    });
  });

  it('reuses settled metric lane geometry during pure camera movement', () => {
    const road = aRoad('road', [
      [-115.2, 36.14],
      [-115.16, 36.14],
    ]);
    const system = aSystem({ ways: [road] });
    buildFeatures(system, null, [], infrastructureView(19));
    const counts = createFeatureBuildOperationCounts();

    buildFeatures(system, null, [], infrastructureView(19), null, null, { counts });

    expect(counts).toMatchObject({
      featureLaneGeometryBuildCount: 0,
      featureLaneGeometryCacheHitCount: 1,
    });
  });
});
