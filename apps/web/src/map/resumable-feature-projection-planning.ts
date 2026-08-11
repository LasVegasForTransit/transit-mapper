import type { RenderFeatureProjectionUnitScope } from '@transitmapper/core/render/render-feature-projection-unit';
import type { SystemFeatures } from '@transitmapper/core/render/buildFeatures';
import type { RenderProjectionScope } from '@transitmapper/core/render/render-projection-scope';
import { renderNodesById } from '@transitmapper/core/render/render-domain-indexes';
import {
  renderViewportCandidateSets,
  type RenderViewportCandidateSets,
} from '@transitmapper/core/render/render-viewport-candidates';
import {
  SRC_CONNECTORS,
  SRC_FACILITIES,
  SRC_FOOTPRINTS,
  SRC_HANDLES,
  SRC_JUNCTIONS,
  SRC_LANE_ARROWS,
  SRC_LANE_MARKINGS,
  SRC_LANES,
  SRC_PHYSICAL_HANDLES,
  SRC_PLATFORMS,
  SRC_SERVICE_ARROWS,
  SRC_SERVICE_TERMINI,
  SRC_SERVICES,
  SRC_STATIONS,
  SRC_WAY_LABELS,
  SRC_WAYS,
} from './layers';
import {
  buildFeaturesForSources,
  type BuildFeaturesForSourcesOptions,
  type SourceFeatureProjectionCounts,
} from './sourceFeatureProjection';
import {
  ALL_SYSTEM_FEATURE_SOURCES,
  type MapSystemFeatureSourceId,
} from './system-feature-sources';

export interface GeographicFeatureProjectionBatchSizes {
  readonly corridors?: number;
  readonly junctions?: number;
  readonly stations?: number;
  readonly labels?: number;
  readonly services?: number;
}

export interface PlanResumableGeographicFeatureProjectionOptions extends Omit<
  BuildFeaturesForSourcesOptions,
  'counts' | 'unitScope'
> {
  readonly batchSizes?: GeographicFeatureProjectionBatchSizes;
}

export type GeographicFeatureProjectionPrimaryKind =
  | 'corridor'
  | 'junction'
  | 'station'
  | 'label'
  | 'service'
  | 'handle'
  | 'physical-station-handle'
  | 'physical-group-handle'
  | 'facility'
  | 'group';

export interface GeographicFeatureProjectionUnit {
  readonly id: string;
  readonly primary: {
    readonly kind: GeographicFeatureProjectionPrimaryKind;
    readonly ids: readonly string[];
  };
  readonly sourceIds: readonly MapSystemFeatureSourceId[];
  /** Produces detached source collections; live MapLibre state remains
   * untouched until every result has passed aggregation. */
  run(counts?: SourceFeatureProjectionCounts): SystemFeatures;
}

export interface ReadyResumableGeographicFeatureProjectionPlan {
  readonly kind: 'ready';
  readonly sourceIds: readonly MapSystemFeatureSourceId[];
  readonly units: readonly GeographicFeatureProjectionUnit[];
  aggregate(parts: readonly SystemFeatures[]): SystemFeatures;
  refineAfterUnitBudgetExceeded?(
    unitId: string,
  ): ReadyResumableGeographicFeatureProjectionPlan | null;
}

export type ResumableGeographicFeatureProjectionPlan =
  | { readonly kind: 'deferred'; readonly reason: 'diagram-layout-phase-6' }
  | ReadyResumableGeographicFeatureProjectionPlan;

export const CORRIDOR_SOURCES = new Set<MapSystemFeatureSourceId>([
  SRC_WAYS,
  SRC_SERVICES,
  SRC_LANES,
  SRC_LANE_MARKINGS,
  SRC_LANE_ARROWS,
  SRC_SERVICE_ARROWS,
]);
export const PHYSICAL_CORRIDOR_SOURCES = new Set<MapSystemFeatureSourceId>([
  SRC_WAYS,
  SRC_LANES,
  SRC_LANE_MARKINGS,
  SRC_LANE_ARROWS,
]);
export const SERVICE_CORRIDOR_SOURCES = new Set<MapSystemFeatureSourceId>([
  SRC_SERVICES,
  SRC_SERVICE_ARROWS,
]);
export const JUNCTION_SOURCES = new Set<MapSystemFeatureSourceId>([SRC_JUNCTIONS, SRC_CONNECTORS]);
export const STATION_SOURCES = new Set<MapSystemFeatureSourceId>([
  SRC_STATIONS,
  SRC_FOOTPRINTS,
  SRC_PLATFORMS,
]);

export interface ResolvedBatchSizes {
  corridors: number;
  junctions: number;
  stations: number;
  labels: number;
  services: number;
}

export interface ProjectionPlanningContext {
  options: BuildFeaturesForSourcesOptions;
  sourceIds: readonly MapSystemFeatureSourceId[];
  batchSizes: ResolvedBatchSizes;
  scope: RenderProjectionScope | undefined;
  visibleWayIds: readonly string[];
  visibleJunctionIds: readonly string[];
  visibleStationIds: readonly string[];
  visibleLabelIds: readonly string[];
  visibleWayHandleIds: readonly string[];
  visibleServiceTerminusIds: readonly string[];
  visibleFacilityIds: readonly string[];
  visibleGroupIds: readonly string[];
  visiblePhysicalHandleIds: readonly string[];
  incidentJunctionIdsByWay: ReadonlyMap<string, readonly string[]>;
  incidentWayIdsByJunction: ReadonlyMap<string, readonly string[]>;
  visibleWayOrderById: ReadonlyMap<string, number>;
  visibleJunctionOrderById: ReadonlyMap<string, number>;
  units: GeographicFeatureProjectionUnit[];
}

export interface AddProjectionUnitOptions {
  kind: GeographicFeatureProjectionPrimaryKind;
  primaryIds: readonly string[];
  sourceIds: readonly MapSystemFeatureSourceId[];
  unitScope: RenderFeatureProjectionUnitScope;
  viewportCandidates: RenderViewportCandidateSets;
  handleWayIds?: string[];
}

function positiveBatchSize(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new RangeError(`${name} projection batch size must be a positive integer.`);
  }
  return resolved;
}

function resolveBatchSizes(sizes: GeographicFeatureProjectionBatchSizes = {}): ResolvedBatchSizes {
  return {
    corridors: positiveBatchSize(sizes.corridors, 8, 'Corridor'),
    junctions: positiveBatchSize(sizes.junctions, 8, 'Junction'),
    stations: positiveBatchSize(sizes.stations, 16, 'Station'),
    labels: positiveBatchSize(sizes.labels, 8, 'Label'),
    services: positiveBatchSize(sizes.services, 8, 'Service'),
  };
}

export function chunks(values: readonly string[], size: number): readonly (readonly string[])[] {
  const result: string[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export function sourceSubset(
  requested: readonly MapSystemFeatureSourceId[],
  group: ReadonlySet<MapSystemFeatureSourceId>,
): readonly MapSystemFeatureSourceId[] {
  return requested.filter((sourceId) => group.has(sourceId));
}

export function intersectIds(
  orderedIds: readonly string[],
  constraint: readonly string[] | undefined,
): readonly string[] {
  if (!constraint) return orderedIds;
  const allowed = new Set(constraint);
  return orderedIds.filter((id) => allowed.has(id));
}

export function orderedUnion(
  order: readonly string[],
  ...groups: readonly (readonly string[])[]
): string[] {
  const included = new Set(groups.flat());
  return order.filter((id) => included.has(id));
}

export function addProjectionUnit(
  context: ProjectionPlanningContext,
  specification: AddProjectionUnitOptions,
): void {
  const id = `${specification.kind}:${context.units.length}`;
  const stablePrimaryIds = [...specification.primaryIds];
  const stableSourceIds = [...specification.sourceIds];
  const handleWayIds = specification.handleWayIds ?? context.options.handleWayIds;
  context.units.push({
    id,
    primary: { kind: specification.kind, ids: stablePrimaryIds },
    sourceIds: stableSourceIds,
    run: (counts) =>
      buildFeaturesForSources({
        ...context.options,
        handleWayIds,
        sourceIds: stableSourceIds,
        unitScope: specification.unitScope,
        precomputedViewportCandidates: specification.viewportCandidates,
        ...(counts ? { counts } : {}),
      }),
  });
}

function canonicalSources(
  requested: readonly MapSystemFeatureSourceId[],
): readonly MapSystemFeatureSourceId[] {
  const requestedSet = new Set(requested);
  return ALL_SYSTEM_FEATURE_SOURCES.filter((sourceId) => requestedSet.has(sourceId));
}

interface VisibleTopologyAdjacency {
  incidentJunctionIdsByWay: ReadonlyMap<string, readonly string[]>;
  incidentWayIdsByJunction: ReadonlyMap<string, readonly string[]>;
  visibleWayOrderById: ReadonlyMap<string, number>;
  visibleJunctionOrderById: ReadonlyMap<string, number>;
}

function visibleTopologyAdjacency(
  options: PlanResumableGeographicFeatureProjectionOptions,
  visibleWayIds: readonly string[],
  visibleJunctionIds: readonly string[],
): VisibleTopologyAdjacency {
  const visibleWayOrderById = new Map(visibleWayIds.map((id, index) => [id, index] as const));
  const visibleJunctionOrderById = new Map(
    visibleJunctionIds.map((id, index) => [id, index] as const),
  );
  const junctionsByWay = new Map<string, string[]>();
  const waysByJunction = new Map<string, readonly string[]>();
  if (visibleWayIds.length === 0 || visibleJunctionIds.length === 0) {
    return {
      incidentJunctionIdsByWay: junctionsByWay,
      incidentWayIdsByJunction: waysByJunction,
      visibleWayOrderById,
      visibleJunctionOrderById,
    };
  }
  const nodesById = options.preparedSnapshot?.nodesById ?? renderNodesById(options.system.nodes);
  for (const junctionId of visibleJunctionIds) {
    const wayIds = [
      ...new Set(
        (nodesById.get(junctionId)?.refs ?? [])
          .map(({ wayId }) => wayId)
          .filter((wayId) => visibleWayOrderById.has(wayId)),
      ),
    ];
    wayIds.sort(
      (left, right) =>
        (visibleWayOrderById.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (visibleWayOrderById.get(right) ?? Number.MAX_SAFE_INTEGER),
    );
    waysByJunction.set(junctionId, wayIds);
    for (const wayId of wayIds) {
      const junctionIds = junctionsByWay.get(wayId);
      if (junctionIds) junctionIds.push(junctionId);
      else junctionsByWay.set(wayId, [junctionId]);
    }
  }
  return {
    incidentJunctionIdsByWay: junctionsByWay,
    incidentWayIdsByJunction: waysByJunction,
    visibleWayOrderById,
    visibleJunctionOrderById,
  };
}

function viewportCategories(sourceIds: readonly MapSystemFeatureSourceId[]) {
  const categories = [] as Parameters<typeof renderViewportCandidateSets>[2][number][];
  const needsTopology = sourceIds.some(
    (sourceId) => CORRIDOR_SOURCES.has(sourceId) || JUNCTION_SOURCES.has(sourceId),
  );
  if (needsTopology) categories.push('corridor', 'junction');
  else if (sourceIds.includes(SRC_WAY_LABELS)) categories.push('corridor');
  const needsStations = sourceIds.some((sourceId) => STATION_SOURCES.has(sourceId));
  if (needsStations || sourceIds.includes(SRC_PHYSICAL_HANDLES)) categories.push('station');
  if (sourceIds.includes(SRC_WAY_LABELS)) categories.push('label');
  if (sourceIds.includes(SRC_HANDLES)) categories.push('way-handle');
  if (sourceIds.includes(SRC_SERVICE_TERMINI)) categories.push('service-terminus');
  if (sourceIds.includes(SRC_FACILITIES)) categories.push('facility');
  if (sourceIds.includes(SRC_FOOTPRINTS) || sourceIds.includes(SRC_PHYSICAL_HANDLES)) {
    categories.push('group');
  }
  if (sourceIds.includes(SRC_PHYSICAL_HANDLES)) categories.push('physical-handle');
  return categories;
}

export function createProjectionPlanningContext(
  options: PlanResumableGeographicFeatureProjectionOptions,
): ProjectionPlanningContext {
  const { batchSizes: requestedBatchSizes, ...projectionOptions } = options;
  const sourceIds = canonicalSources(options.sourceIds);
  const viewport =
    options.preparedSnapshot?.candidates ??
    renderViewportCandidateSets(
      options.system,
      options.view.presentation,
      viewportCategories(sourceIds),
    );
  const visibleWayIds = viewport.wayIds ?? [];
  const visibleJunctionIds = viewport.junctionIds ?? [];
  const adjacency = visibleTopologyAdjacency(options, visibleWayIds, visibleJunctionIds);
  return {
    options: projectionOptions,
    sourceIds,
    batchSizes: resolveBatchSizes(requestedBatchSizes),
    scope: options.projectionScope,
    visibleWayIds,
    visibleJunctionIds,
    visibleStationIds: viewport.stationIds ?? [],
    visibleLabelIds: viewport.labelIds ?? [],
    visibleWayHandleIds: viewport.wayHandleIds ?? [],
    visibleServiceTerminusIds: viewport.serviceTerminusIds ?? [],
    visibleFacilityIds: viewport.facilityIds ?? [],
    visibleGroupIds: viewport.groupIds ?? [],
    visiblePhysicalHandleIds: viewport.physicalHandleIds ?? [],
    ...adjacency,
    units: [],
  };
}
