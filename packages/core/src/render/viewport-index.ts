import type {
  Facility,
  Group,
  LngLat,
  NamedWay,
  Node,
  Service,
  Station,
  TransitSystem,
  Way,
} from '../model/system';
import {
  createRenderIndexCacheDiagnosticCounter,
  type RenderIndexCacheDiagnostics,
} from './render-cache-diagnostics';
import {
  corridorViewportEntries,
  facilityViewportEntries,
  groupViewportEntries,
  junctionViewportEntries,
  labelViewportEntries,
  physicalHandleViewportEntries,
  serviceTerminusViewportEntries,
  stationViewportEntries,
  wayHandleViewportEntries,
} from './viewport-index-entries';
import {
  buildViewportSpatialGrid,
  queryViewportSpatialGrid,
  type ViewportGridBuildBudget,
  type ViewportSpatialGrid,
} from './viewport-spatial-grid';

export { MAX_VIEWPORT_GRID_ENTRIES } from './viewport-spatial-grid';

/**
 * A coarse screen-neighborhood index for presentation projection.
 *
 * The grid is intentionally degree-based: it only rejects definitely
 * offscreen domain objects. Exact segment/box checks below remain authoritative,
 * so projection never inherits an approximation from the index.
 */
export type RenderViewportCategory =
  | 'corridor'
  | 'junction'
  | 'station'
  | 'label'
  | 'way-handle'
  | 'service-terminus'
  | 'facility'
  | 'group'
  | 'physical-handle';

export interface ViewportCandidateQuery {
  bounds: [LngLat, LngLat];
  /**
   * Halo around the visible bounds. The caller converts its screen-space LOD
   * transition margin into degrees for the current camera before querying.
   */
  transitionMarginDegrees?: number;
  /** Omit unrequested presentation passes without even performing exact checks. */
  categories?: readonly RenderViewportCategory[];
}

export interface ViewportCategoryCounts {
  corridor: number;
  junction: number;
  station: number;
  label: number;
  wayHandle: number;
  serviceTerminus: number;
  facility: number;
  group: number;
  physicalHandle: number;
}

export interface ViewportCandidateCounts {
  /** Logical domain objects admitted by the coarse grid. */
  coarseCandidates: ViewportCategoryCounts;
  /** Logical objects checked against the expanded bounds exactly. */
  exactChecks: ViewportCategoryCounts;
  /** Exact visible objects returned to presentation projection. */
  visible: ViewportCategoryCounts;
}

export interface ViewportCandidates {
  corridorIds: readonly string[];
  junctionIds: readonly string[];
  stationIds: readonly string[];
  labelIds: readonly string[];
  wayHandleIds: readonly string[];
  serviceTerminusIds: readonly string[];
  facilityIds: readonly string[];
  groupIds: readonly string[];
  physicalHandleIds: readonly string[];
  counts: ViewportCandidateCounts;
}

export interface ViewportIndexStats {
  corridors: number;
  junctions: number;
  stations: number;
  labels: number;
  wayHandles: number;
  serviceTermini: number;
  facilities: number;
  groups: number;
  physicalHandles: number;
  gridCells: number;
  gridEntries: number;
  /** Logical objects held out of grid expansion and checked on every query. */
  oversizeEntries: number;
}

/** Process-local evidence for immutable viewport-index reuse. Resetting these
 * counters never clears the WeakMap cache or changes projection behavior. */
export type ViewportIndexCacheDiagnostics = RenderIndexCacheDiagnostics;

/** Opaque because mutating grid internals would invalidate cache correctness. */
export interface RenderViewportIndex {
  readonly kind: 'render-viewport-index';
}

interface ViewportIndexData {
  corridor: ViewportSpatialGrid;
  junction: ViewportSpatialGrid;
  station: ViewportSpatialGrid;
  label: ViewportSpatialGrid;
  wayHandle: ViewportSpatialGrid;
  serviceTerminus: ViewportSpatialGrid;
  facility: ViewportSpatialGrid;
  group: ViewportSpatialGrid;
  physicalHandle: ViewportSpatialGrid;
}

type ServiceIndexCache = WeakMap<Service[], RenderViewportIndex>;
type GroupIndexCache = WeakMap<Group[], ServiceIndexCache>;
type FacilityIndexCache = WeakMap<Facility[], GroupIndexCache>;
type NamedWayIndexCache = WeakMap<NamedWay[], FacilityIndexCache>;
type StationIndexCache = WeakMap<Station[], NamedWayIndexCache>;
type NodeIndexCache = WeakMap<Node[], StationIndexCache>;

const indexData = new WeakMap<RenderViewportIndex, ViewportIndexData>();
const indexCache = new WeakMap<Way[], NodeIndexCache>();
const viewportIndexDiagnostics = createRenderIndexCacheDiagnosticCounter();
export const snapshotViewportIndexCacheDiagnostics = viewportIndexDiagnostics.snapshot;

/** Resets observation only. Keeping cached indexes alive makes diagnostics
 * suitable for measuring a warmed pan/zoom sequence. */
export const resetViewportIndexCacheDiagnostics = viewportIndexDiagnostics.reset;

function createIndex(system: TransitSystem): RenderViewportIndex {
  const index = Object.freeze({ kind: 'render-viewport-index' as const });
  const budget: ViewportGridBuildBudget = { totalEntries: 0 };
  indexData.set(index, {
    corridor: buildViewportSpatialGrid(corridorViewportEntries(system.ways), budget),
    junction: buildViewportSpatialGrid(junctionViewportEntries(system.nodes), budget),
    station: buildViewportSpatialGrid(stationViewportEntries(system.stations), budget),
    wayHandle: buildViewportSpatialGrid(wayHandleViewportEntries(system.ways), budget),
    serviceTerminus: buildViewportSpatialGrid(
      serviceTerminusViewportEntries(system.services, system.ways),
      budget,
    ),
    facility: buildViewportSpatialGrid(facilityViewportEntries(system.facilities), budget),
    group: buildViewportSpatialGrid(groupViewportEntries(system.groups), budget),
    physicalHandle: buildViewportSpatialGrid(
      physicalHandleViewportEntries(system.stations, system.groups),
      budget,
    ),
    label: buildViewportSpatialGrid(labelViewportEntries(system.namedWays, system.ways), budget),
  });
  viewportIndexDiagnostics.recordBuild();
  return index;
}

/**
 * Returns the immutable spatial index for the exact render collection
 * identities. A metadata-only document copy therefore performs no rebuild.
 */
export function viewportIndexFor(system: TransitSystem): RenderViewportIndex {
  let byNode = indexCache.get(system.ways);
  if (!byNode) indexCache.set(system.ways, (byNode = new WeakMap()));
  let byStation = byNode.get(system.nodes);
  if (!byStation) byNode.set(system.nodes, (byStation = new WeakMap()));
  let byNamedWay = byStation.get(system.stations);
  if (!byNamedWay) byStation.set(system.stations, (byNamedWay = new WeakMap()));
  let byFacility = byNamedWay.get(system.namedWays);
  if (!byFacility) byNamedWay.set(system.namedWays, (byFacility = new WeakMap()));
  let byGroup = byFacility.get(system.facilities);
  if (!byGroup) byFacility.set(system.facilities, (byGroup = new WeakMap()));
  let byService = byGroup.get(system.groups);
  if (!byService) byGroup.set(system.groups, (byService = new WeakMap()));
  const cached = byService.get(system.services);
  if (cached) {
    viewportIndexDiagnostics.recordCacheHit();
    return cached;
  }
  const index = createIndex(system);
  byService.set(system.services, index);
  return index;
}

function emptyCategoryCounts(): ViewportCategoryCounts {
  return {
    corridor: 0,
    junction: 0,
    station: 0,
    label: 0,
    wayHandle: 0,
    serviceTerminus: 0,
    facility: 0,
    group: 0,
    physicalHandle: 0,
  };
}

interface ViewportCategoryBinding {
  dataKey: keyof ViewportIndexData;
  countKey: keyof ViewportCategoryCounts;
}

const VIEWPORT_CATEGORY_BINDINGS: Readonly<
  Record<RenderViewportCategory, ViewportCategoryBinding>
> = {
  corridor: { dataKey: 'corridor', countKey: 'corridor' },
  junction: { dataKey: 'junction', countKey: 'junction' },
  station: { dataKey: 'station', countKey: 'station' },
  label: { dataKey: 'label', countKey: 'label' },
  'way-handle': { dataKey: 'wayHandle', countKey: 'wayHandle' },
  'service-terminus': { dataKey: 'serviceTerminus', countKey: 'serviceTerminus' },
  facility: { dataKey: 'facility', countKey: 'facility' },
  group: { dataKey: 'group', countKey: 'group' },
  'physical-handle': { dataKey: 'physicalHandle', countKey: 'physicalHandle' },
};

/** Query visible candidates plus the caller-specified LOD transition halo. */
export function queryViewportCandidates(
  index: RenderViewportIndex,
  query: ViewportCandidateQuery,
): ViewportCandidates {
  const data = indexData.get(index);
  if (!data) throw new Error('Unknown renderer viewport index');
  const resolvedData = data;
  const transitionMarginDegrees = query.transitionMarginDegrees ?? 0;
  const requested = new Set<RenderViewportCategory>(
    query.categories ?? [
      'corridor',
      'junction',
      'station',
      'label',
      'way-handle',
      'service-terminus',
      'facility',
      'group',
      'physical-handle',
    ],
  );
  const coarseCandidates = emptyCategoryCounts();
  const exactChecks = emptyCategoryCounts();
  const visible = emptyCategoryCounts();

  function run(category: RenderViewportCategory): readonly string[] {
    if (!requested.has(category)) return [];
    const binding = VIEWPORT_CATEGORY_BINDINGS[category];
    const result = queryViewportSpatialGrid(
      resolvedData[binding.dataKey],
      query.bounds,
      transitionMarginDegrees,
    );
    coarseCandidates[binding.countKey] = result.coarseCandidates;
    exactChecks[binding.countKey] = result.exactChecks;
    visible[binding.countKey] = result.ids.length;
    return result.ids;
  }

  return {
    corridorIds: run('corridor'),
    junctionIds: run('junction'),
    stationIds: run('station'),
    labelIds: run('label'),
    wayHandleIds: run('way-handle'),
    serviceTerminusIds: run('service-terminus'),
    facilityIds: run('facility'),
    groupIds: run('group'),
    physicalHandleIds: run('physical-handle'),
    counts: { coarseCandidates, exactChecks, visible },
  };
}

export function viewportIndexStats(index: RenderViewportIndex): ViewportIndexStats {
  const data = indexData.get(index);
  if (!data) throw new Error('Unknown renderer viewport index');
  const grids = [
    data.corridor,
    data.junction,
    data.station,
    data.label,
    data.wayHandle,
    data.serviceTerminus,
    data.facility,
    data.group,
    data.physicalHandle,
  ];
  return {
    corridors: data.corridor.entries.length,
    junctions: data.junction.entries.length,
    stations: data.station.entries.length,
    labels: data.label.entries.length,
    wayHandles: data.wayHandle.entries.length,
    serviceTermini: data.serviceTerminus.entries.length,
    facilities: data.facility.entries.length,
    groups: data.group.entries.length,
    physicalHandles: data.physicalHandle.entries.length,
    gridCells: grids.reduce((total, grid) => total + grid.cells.size, 0),
    gridEntries: grids.reduce((total, grid) => total + grid.gridEntryCount, 0),
    oversizeEntries: grids.reduce((total, grid) => total + grid.oversize.size, 0),
  };
}
