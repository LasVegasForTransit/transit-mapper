import { describe, expect, it } from 'vitest';
import type { FeatureCollection } from 'geojson';
import { renderPresentationForViewport } from '@transitmapper/core/render/render-presentation';
import type { TransitSystem } from '@transitmapper/core/model/system';
import {
  aPattern,
  aRoad,
  aService,
  aStation,
  aStop,
  aSystem,
} from '@transitmapper/core/testing/fixtures';
import type { RenderViewOptions, SystemFeatures } from '@transitmapper/core/render/buildFeatures';
import { planRenderProjectionScope } from '@transitmapper/core/render/render-projection-scope';
import { ALL_SYSTEM_FEATURE_SOURCES } from '../../src/map/system-feature-sources';
import { SRC_CONNECTORS, SRC_WAYS, SRC_WAY_LABELS } from '../../src/map/layers';
import {
  buildFeaturesForSources,
  createSourceFeatureProjectionCounts,
} from '../../src/map/sourceFeatureProjection';
import {
  planResumableGeographicFeatureProjection,
  type ResumableGeographicFeatureProjectionPlan,
} from '../../src/map/resumable-feature-projection';

const view: RenderViewOptions = {
  viewMode: 'infrastructure',
  visibleModes: new Set(['bus']),
  visibleWayTypes: new Set(['road']),
  presentation: renderPresentationForViewport({
    center: [-115.18, 36.14],
    zoom: 18,
    width: 1_440,
    height: 900,
  }),
};

function portMasonLikeFixture(): TransitSystem {
  const west = aRoad('west-market', [
    [-115.182, 36.14],
    [-115.18, 36.14],
  ]);
  const east = aRoad('downtown', [
    [-115.18, 36.14],
    [-115.178, 36.14],
  ]);
  const north = aRoad('airport-spur', [
    [-115.18, 36.14],
    [-115.18, 36.142],
  ]);
  const main = aService('mason-main', [
    aPattern('main-pattern', [west, east, north], [west.id, east.id]),
  ]);
  const branch = aService(
    'airport-branch',
    [aPattern('branch-pattern', [west, east, north], [west.id, north.id])],
    { color: '#315de8' },
  );
  const stop = aStop('downtown-stop', [-115.1808, 36.14], { wayId: west.id, t: 0.6 });
  const station = aStation('downtown-station', [-115.1808, 36.14], {
    name: 'Downtown',
    footprint: [
      [-115.181, 36.13985],
      [-115.1806, 36.13985],
      [-115.1806, 36.14015],
    ],
    platforms: [
      {
        id: 'downtown-platform',
        points: [
          [-115.18095, 36.1399],
          [-115.18065, 36.1399],
          [-115.18065, 36.1401],
        ],
      },
    ],
  });
  return aSystem({
    id: 'port-mason',
    ways: [west, east, north],
    services: [main, branch],
    nodes: [
      {
        id: 'downtown-junction',
        coord: [-115.18, 36.14],
        refs: [
          { wayId: west.id, pointIndex: 1 },
          { wayId: east.id, pointIndex: 0 },
          { wayId: north.id, pointIndex: 0 },
        ],
      },
    ],
    stops: [stop],
    stations: [station],
    namedWays: [
      { id: 'mason-river', name: 'Mason River', wayIds: [west.id, east.id] },
      { id: 'airport-road', name: 'Airport Road', wayIds: [north.id] },
    ],
    facilities: [
      {
        id: 'downtown-entrance',
        typeId: 'entrance',
        name: 'Downtown entrance',
        geometry: [-115.18075, 36.1401],
      },
    ],
    groups: [
      {
        id: 'downtown-complex',
        memberIds: [station.id, 'downtown-entrance'],
        footprint: [
          [-115.1811, 36.13975],
          [-115.1805, 36.13975],
          [-115.1805, 36.14025],
        ],
      },
    ],
  });
}

function readyPlan(
  plan: ResumableGeographicFeatureProjectionPlan,
): Extract<ResumableGeographicFeatureProjectionPlan, { kind: 'ready' }> {
  expect(plan.kind).toBe('ready');
  if (plan.kind !== 'ready') throw new Error(plan.reason);
  return plan;
}

function featureIdsAreUnique(features: SystemFeatures): boolean {
  const unique = (collection: FeatureCollection): boolean => {
    const ids = collection.features.map((feature) => feature.id);
    return ids.every((id) => id !== undefined) && new Set(ids).size === ids.length;
  };
  const collections: readonly FeatureCollection[] = [
    features.ways,
    features.services,
    features.stops,
    features.handles,
    features.serviceTermini,
    features.footprints,
    features.platforms,
    features.facilities,
    features.physicalHandles,
    features.lanes,
    features.laneMarkings,
    features.laneArrows,
    features.serviceArrows,
    features.junctions,
    features.connectors,
    features.wayLabels,
  ];
  return collections.every(unique);
}

/** Source collections are assembled in bounded unit order. The published
 * RenderScene applies its own paint ordering, so this projection contract is
 * about the stable feature each source contains rather than incidental array
 * ordering from the scheduler. */
function featureEntriesByStableId(
  features: SystemFeatures,
): readonly (readonly [string, unknown])[] {
  const collections: readonly [string, FeatureCollection][] = [
    ['ways', features.ways],
    ['services', features.services],
    ['stops', features.stops],
    ['handles', features.handles],
    ['serviceTermini', features.serviceTermini],
    ['footprints', features.footprints],
    ['platforms', features.platforms],
    ['facilities', features.facilities],
    ['physicalHandles', features.physicalHandles],
    ['lanes', features.lanes],
    ['laneMarkings', features.laneMarkings],
    ['laneArrows', features.laneArrows],
    ['serviceArrows', features.serviceArrows],
    ['junctions', features.junctions],
    ['connectors', features.connectors],
    ['wayLabels', features.wayLabels],
  ];
  return collections
    .flatMap(([name, collection]) =>
      collection.features.map((feature) => [`${name}:${String(feature.id)}`, feature] as const),
    )
    .sort(([left], [right]) => left.localeCompare(right));
}

describe('resumable geographic feature projection', () => {
  it('reproduces the settled synchronous source projection by stable feature identity', () => {
    const system = portMasonLikeFixture();
    const options = {
      system,
      selection: { kind: 'service' as const, id: 'mason-main' },
      handleWayIds: ['west-market'],
      view,
      sourceIds: ALL_SYSTEM_FEATURE_SOURCES,
      physicalHandleStationId: 'downtown-station',
      physicalHandleGroupId: 'downtown-complex',
      activePatternId: 'main-pattern',
    };
    const full = buildFeaturesForSources(options);
    const plan = readyPlan(
      planResumableGeographicFeatureProjection({
        ...options,
        batchSizes: { corridors: 1, junctions: 1, stops: 1, stations: 1, labels: 1, services: 1 },
      }),
    );

    const chunked = plan.aggregate(plan.units.map((unit) => unit.run()));

    expect(featureEntriesByStableId(chunked)).toEqual(featureEntriesByStableId(full));
    expect(featureIdsAreUnique(chunked)).toBe(true);
    expect(chunked.services.features.length).toBeGreaterThan(0);
    expect(chunked.stops.features.length).toBe(1);
    expect(chunked.junctions.features.length).toBe(1);
    expect(chunked.serviceTermini.features.length).toBe(2);
    expect(
      chunked.services.features.some(
        (feature) => feature.properties?.pathRole === 'junction:downtown-junction',
      ),
    ).toBe(true);
    expect(chunked.wayLabels.features.length).toBe(3);
    expect(chunked.facilities.features.length).toBe(1);
  });

  it('attributes geographic unit work to the supplied generation-local counters', () => {
    const plan = readyPlan(
      planResumableGeographicFeatureProjection({
        system: portMasonLikeFixture(),
        selection: null,
        handleWayIds: [],
        view,
        sourceIds: [SRC_WAYS],
        batchSizes: { corridors: 1 },
      }),
    );
    const counts = createSourceFeatureProjectionCounts();

    for (const unit of plan.units) unit.run(counts);

    expect(counts.featureTopologyWayVisitCount).toBeGreaterThan(0);
    expect(counts.rendererCandidateFeatureCount).toBeGreaterThan(0);
    expect(counts.rendererGeneratedFeatureCount).toBeGreaterThan(0);
  });

  it('returns an explicit Phase 6 deferral instead of chunking Diagram layout', () => {
    const plan = planResumableGeographicFeatureProjection({
      system: portMasonLikeFixture(),
      selection: null,
      handleWayIds: [],
      view: { ...view, viewMode: 'diagram' },
      sourceIds: ALL_SYSTEM_FEATURE_SOURCES,
    });

    expect(plan).toEqual({
      kind: 'deferred',
      reason: 'diagram-layout-phase-6',
    });
  });

  it('keeps an entity dependency scope authoritative in every unit', () => {
    const previous = portMasonLikeFixture();
    const system = {
      ...previous,
      stations: previous.stations.map((station) => ({ ...station, name: 'Downtown Central' })),
    };
    const scopePlan = planRenderProjectionScope(previous, system, {
      viewMode: 'infrastructure',
    });
    expect(scopePlan.kind).toBe('scoped');
    if (scopePlan.kind !== 'scoped') throw new Error(scopePlan.reason);
    const options = {
      system,
      selection: null,
      handleWayIds: [],
      view,
      sourceIds: ALL_SYSTEM_FEATURE_SOURCES,
      projectionScope: scopePlan.scope,
    };
    const full = buildFeaturesForSources(options);
    const plan = readyPlan(
      planResumableGeographicFeatureProjection({
        ...options,
        batchSizes: { corridors: 1, junctions: 1, stations: 1, labels: 1 },
      }),
    );

    expect(plan.aggregate(plan.units.map((unit) => unit.run()))).toEqual(full);
    expect(plan.units.filter((unit) => unit.primary.kind === 'station')).toHaveLength(1);
    expect(plan.units.some((unit) => unit.primary.kind === 'group')).toBe(false);
  });

  it('keeps selection-owned connector geometry out of the settled live source', () => {
    const options = {
      system: portMasonLikeFixture(),
      selection: { kind: 'node' as const, id: 'downtown-junction' },
      handleWayIds: [],
      view,
      sourceIds: [SRC_CONNECTORS] as const,
      selectionOwnedConnectors: false,
    };

    const full = buildFeaturesForSources(options);
    const plan = readyPlan(planResumableGeographicFeatureProjection(options));

    expect(full.connectors.features).toEqual([]);
    expect(plan.aggregate(plan.units.map((unit) => unit.run()))).toEqual(full);
  });

  it('keeps corridor culling available to a labels-only source request', () => {
    const options = {
      system: portMasonLikeFixture(),
      selection: null,
      handleWayIds: [],
      view,
      sourceIds: [SRC_WAY_LABELS] as const,
    };
    const full = buildFeaturesForSources(options);
    const plan = readyPlan(
      planResumableGeographicFeatureProjection({ ...options, batchSizes: { labels: 1 } }),
    );

    expect(full.wayLabels.features).toHaveLength(3);
    expect(plan.aggregate(plan.units.map((unit) => unit.run()))).toEqual(full);
  });

  it('refines only an oversized primary batch down to singleton units', () => {
    const plan = readyPlan(
      planResumableGeographicFeatureProjection({
        system: portMasonLikeFixture(),
        selection: null,
        handleWayIds: [],
        view,
        sourceIds: [SRC_WAYS],
      }),
    );
    const firstRefinement = plan.refineAfterUnitBudgetExceeded?.('corridor:0');
    const secondRefinement = firstRefinement?.refineAfterUnitBudgetExceeded?.('corridor:0');
    const singletonPlan = secondRefinement?.refineAfterUnitBudgetExceeded?.('corridor:0');

    expect(firstRefinement?.units.map((unit) => unit.primary.ids.length)).toEqual([3]);
    expect(secondRefinement?.units.map((unit) => unit.primary.ids.length)).toEqual([2, 1]);
    expect(singletonPlan?.units.map((unit) => unit.primary.ids.length)).toEqual([1, 1, 1]);
    expect(singletonPlan?.refineAfterUnitBudgetExceeded?.('corridor:0')).toBeNull();
  });
});
