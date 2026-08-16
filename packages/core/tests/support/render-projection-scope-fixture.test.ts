import type { Feature } from 'geojson';
import { expect } from 'vitest';
import { MODE_ORDER, WAY_TYPE_ORDER } from '../../src/model/catalog';
import { defaultProfileFor, profileWidthM } from '../../src/model/profile';
import type { TransitSystem } from '../../src/model/system';
import type { RenderViewOptions, SystemFeatureName } from '../../src/render/buildFeatures';
import { widthPxAtZ14 } from '../../src/render/constants';
import {
  planRenderProjectionScope,
  type PlanRenderProjectionScopeOptions,
  type RenderProjectionScope,
} from '../../src/render/render-projection-scope';
import { aPattern, aRoad, aService, aStation, aStop, aSystem } from './fixtures.test';

export function projectionFixture(): TransitSystem {
  const west = aRoad('west', [
    [-115.2, 36.14],
    [-115.18, 36.14],
  ]);
  const east = aRoad('east', [
    [-115.18, 36.14],
    [-115.16, 36.15],
  ]);
  const unrelated = aRoad('unrelated', [
    [-115.2, 36.18],
    [-115.16, 36.18],
  ]);
  const mainService = aService('main-service', [
    aPattern('main-pattern', [west, east], [west.id, east.id]),
  ]);
  const unrelatedService = aService('unrelated-service', [
    aPattern('unrelated-pattern', [unrelated], [unrelated.id]),
  ]);
  return aSystem({
    ways: [west, east, unrelated],
    services: [mainService, unrelatedService],
    nodes: [
      {
        id: 'main-junction',
        coord: west.points[1],
        refs: [
          { wayId: west.id, pointIndex: 1 },
          { wayId: east.id, pointIndex: 0 },
        ],
      },
      {
        id: 'unrelated-junction',
        coord: unrelated.points[0],
        refs: [{ wayId: unrelated.id, pointIndex: 0 }],
      },
    ],
    stops: [
      aStop('main-stop', [-115.19, 36.14005], { wayId: west.id, t: 0.5 }),
      aStop('unrelated-stop', [-115.18, 36.18], {
        wayId: unrelated.id,
        t: 0.5,
      }),
    ],
    stations: [
      aStation('main-station', [-115.19, 36.14005], {
        footprint: [
          [-115.1902, 36.1399],
          [-115.1898, 36.1399],
          [-115.1898, 36.1401],
        ],
        platforms: [
          {
            id: 'main-platform',
            points: [
              [-115.1901, 36.13995],
              [-115.1899, 36.13995],
              [-115.1899, 36.14005],
            ],
          },
        ],
      }),
    ],
    namedWays: [
      { id: 'main-name', name: 'Main Street', wayIds: [west.id, east.id] },
      { id: 'unrelated-name', name: 'Unrelated Street', wayIds: [unrelated.id] },
    ],
  });
}

function presentationAtCorridorWidth(displayedWidthPx: number): RenderViewOptions['presentation'] {
  const corridorWidthAtZ14 = widthPxAtZ14(profileWidthM(defaultProfileFor('road')), 36.14);
  return {
    bounds: {
      southwest: [-115.25, 36.1],
      northeast: [-115.1, 36.22],
    },
    zoom: 14 + Math.log2(displayedWidthPx / corridorWidthAtZ14),
    viewportWidthPx: 1_440,
    viewportHeightPx: 900,
    displayedWidthPx: 1_440,
    displayedHeightPx: 900,
    pixelRatio: 1,
  };
}

export const DISTRICT_VIEW: RenderViewOptions = {
  viewMode: 'infrastructure',
  visibleModes: new Set(MODE_ORDER),
  visibleWayTypes: new Set(WAY_TYPE_ORDER),
  presentation: presentationAtCorridorWidth(4),
};

export const STREET_VIEW: RenderViewOptions = {
  ...DISTRICT_VIEW,
  presentation: presentationAtCorridorWidth(12.5),
};

export function scopedProjection(
  previous: TransitSystem,
  next: TransitSystem,
  options?: PlanRenderProjectionScopeOptions,
): RenderProjectionScope {
  const plan = planRenderProjectionScope(previous, next, options);
  expect(plan.kind).toBe('scoped');
  if (plan.kind !== 'scoped')
    throw new Error(`expected scoped projection, received ${plan.reason}`);
  return plan.scope;
}

export const SCOPED_FEATURES: readonly SystemFeatureName[] = [
  'ways',
  'services',
  'stops',
  'serviceTermini',
  'footprints',
  'platforms',
  'lanes',
  'laneMarkings',
  'laneArrows',
  'serviceArrows',
  'junctions',
  'connectors',
  'wayLabels',
];

export function featureProperty(feature: Feature, name: string): unknown {
  return feature.properties?.[name];
}
