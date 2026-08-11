import type { TransitSystem } from '@transitmapper/core/model/system';
import {
  SRC_CONNECTORS,
  SRC_FACILITIES,
  SRC_FOOTPRINTS,
  SRC_HANDLES,
  SRC_SERVICE_TERMINI,
  SRC_JUNCTIONS,
  SRC_LANE_ARROWS,
  SRC_LANE_MARKINGS,
  SRC_LANES,
  SRC_PHYSICAL_HANDLES,
  SRC_PLATFORMS,
  SRC_SERVICE_ARROWS,
  SRC_SERVICES,
  SRC_STATIONS,
  SRC_WAY_LABELS,
  SRC_WAYS,
} from './layers';
import {
  ALL_SYSTEM_FEATURE_SOURCES,
  type MapSystemFeatureSourceId,
} from './system-feature-sources';

export { ALL_SYSTEM_FEATURE_SOURCES } from './system-feature-sources';
export type SystemFeatureSourceId = MapSystemFeatureSourceId;
export type SourceUploadRequest = 'all' | readonly SystemFeatureSourceId[];

export interface SourceUploadTransition {
  previous: TransitSystem;
  next: TransitSystem;
}

export interface SourceUploadBatch {
  sourceIds: readonly SystemFeatureSourceId[];
  /** Present only when every coalesced request belongs to one continuous
   * immutable document transition. Camera, view, and style requests have no
   * model baseline and deliberately force source-authoritative projection. */
  transition: SourceUploadTransition | null;
}

export interface SourceUploadPlanOptions {
  /** View changes and repaired styles can invalidate every derived collection
   * even when the TransitSystem references themselves did not change. */
  forceAll?: boolean;
}

export interface SourceUploadQueue {
  add: (request: SourceUploadRequest, transition?: SourceUploadTransition) => void;
  hasPending: () => boolean;
  take: () => readonly SystemFeatureSourceId[];
  takeBatch: () => SourceUploadBatch;
}

const NO_SOURCES: readonly SystemFeatureSourceId[] = [];
const TOPOLOGY_SOURCES: readonly SystemFeatureSourceId[] = [
  SRC_WAYS,
  SRC_SERVICES,
  SRC_LANES,
  SRC_LANE_MARKINGS,
  SRC_LANE_ARROWS,
  SRC_SERVICE_ARROWS,
  SRC_JUNCTIONS,
  SRC_CONNECTORS,
];

/** Every TransitSystem field is classified here so a newly-added field cannot
 * silently leave MapLibre stale. Dependencies are deliberately conservative
 * for topology: a way, node, or service can feed several derived collections. */
const SOURCE_DEPENDENCIES: Record<keyof TransitSystem, readonly SystemFeatureSourceId[]> = {
  ways: [
    SRC_WAYS,
    SRC_SERVICES,
    SRC_STATIONS,
    SRC_HANDLES,
    SRC_SERVICE_TERMINI,
    SRC_LANES,
    SRC_LANE_MARKINGS,
    SRC_LANE_ARROWS,
    SRC_SERVICE_ARROWS,
    SRC_JUNCTIONS,
    SRC_CONNECTORS,
    SRC_WAY_LABELS,
  ],
  lines: [SRC_SERVICES, SRC_STATIONS, SRC_SERVICE_ARROWS],
  services: [
    SRC_WAYS,
    SRC_SERVICES,
    SRC_STATIONS,
    SRC_HANDLES,
    SRC_SERVICE_TERMINI,
    SRC_LANE_ARROWS,
    SRC_SERVICE_ARROWS,
  ],
  stations: [SRC_FOOTPRINTS, SRC_PLATFORMS, SRC_PHYSICAL_HANDLES],
  stops: [SRC_STATIONS],
  facilities: [SRC_FACILITIES],
  groups: [SRC_FOOTPRINTS, SRC_PHYSICAL_HANDLES],
  nodes: [
    // Diagram layout consumes node membership when projecting every connected
    // way, so node edits can also move schematic ways, their handles,
    // services, arrows, and anchored stops.
    SRC_WAYS,
    SRC_SERVICES,
    SRC_STATIONS,
    SRC_HANDLES,
    SRC_SERVICE_TERMINI,
    SRC_LANES,
    SRC_LANE_MARKINGS,
    SRC_LANE_ARROWS,
    SRC_SERVICE_ARROWS,
    SRC_JUNCTIONS,
    SRC_CONNECTORS,
  ],
  namedWays: [SRC_WAY_LABELS],
  turnRestrictions: [SRC_SERVICES, SRC_CONNECTORS],

  version: NO_SOURCES,
  id: NO_SOURCES,
  name: NO_SOURCES,
  description: NO_SOURCES,
  viewport: NO_SOURCES,
  createdAt: NO_SOURCES,
  updatedAt: NO_SOURCES,
  vehicleKinds: NO_SOURCES,
  palette: NO_SOURCES,
  // These values are currently normalized into Way profiles during import,
  // but they describe topology/lane semantics. Keeping their refresh mapping
  // conservative prevents a future renderer read from silently retaining old
  // geometry at the MapLibre boundary.
  drivingSide: TOPOLOGY_SOURCES,
  medians: TOPOLOGY_SOURCES,
  approachControls: [SRC_LANES, SRC_LANE_MARKINGS, SRC_LANE_ARROWS, SRC_JUNCTIONS, SRC_CONNECTORS],
};

const SYSTEM_KEYS = Object.keys(SOURCE_DEPENDENCIES) as (keyof TransitSystem)[];

/** Return only sources whose derived GeoJSON can differ between two immutable
 * system snapshots. Reference comparison is sufficient because store actions
 * replace every changed collection while preserving untouched references. */
export function sourceUploadsForSystemChange(
  before: TransitSystem | null,
  after: TransitSystem,
  options: SourceUploadPlanOptions = {},
): readonly SystemFeatureSourceId[] {
  if (before === null || options.forceAll) return ALL_SYSTEM_FEATURE_SOURCES;
  if (before === after) return NO_SOURCES;

  const changedSources = new Set<SystemFeatureSourceId>();
  for (const key of SYSTEM_KEYS) {
    if (before[key] === after[key]) continue;
    for (const sourceId of SOURCE_DEPENDENCIES[key]) changedSources.add(sourceId);
  }

  // Return canonical order rather than mutation order so operation-count tests
  // and trace annotations stay deterministic across combined store commits.
  return ALL_SYSTEM_FEATURE_SOURCES.filter((sourceId) => changedSources.has(sourceId));
}

/** Accumulate dependency plans across coalesced commits or an active gesture.
 * Calling `take` is the only operation that clears the queue. */
export function createSourceUploadQueue(): SourceUploadQueue {
  const pending = new Set<SystemFeatureSourceId>();
  let allPending = false;
  let transition: SourceUploadTransition | null = null;
  let transitionEligible = true;

  const sourceIds = () =>
    allPending
      ? ALL_SYSTEM_FEATURE_SOURCES
      : ALL_SYSTEM_FEATURE_SOURCES.filter((sourceId) => pending.has(sourceId));

  const reset = () => {
    allPending = false;
    pending.clear();
    transition = null;
    transitionEligible = true;
  };

  const takeBatch = (): SourceUploadBatch => {
    const batch = {
      sourceIds: sourceIds(),
      transition: transitionEligible ? transition : null,
    };
    reset();
    return batch;
  };

  return {
    add: (request, nextTransition) => {
      if (request !== 'all' && request.length === 0) return;
      if (request === 'all') {
        allPending = true;
        pending.clear();
      } else if (!allPending) {
        for (const sourceId of request) pending.add(sourceId);
      }

      if (!nextTransition) {
        transition = null;
        transitionEligible = false;
        return;
      }
      if (!transitionEligible) return;
      if (!transition) {
        transition = nextTransition;
        return;
      }
      if (transition.next !== nextTransition.previous) {
        transition = null;
        transitionEligible = false;
        return;
      }
      transition = { previous: transition.previous, next: nextTransition.next };
    },
    hasPending: () => allPending || pending.size > 0,
    take: () => takeBatch().sourceIds,
    takeBatch,
  };
}
