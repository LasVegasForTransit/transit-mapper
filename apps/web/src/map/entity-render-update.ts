/**
 * Converts immutable document changes into the smallest safe render closure.
 * Candidate IDs refer to the next snapshot; replacement domains cover prior
 * and next ownership so deleted features cannot survive a scoped update.
 */
import type { TransitSystem } from '@transitmapper/core/model/system';
import type { RenderDependencyClosure } from '@transitmapper/core/render/dependency-index';
import {
  renderDomainIdentity,
  type RenderDomainIdentity,
} from '@transitmapper/core/render/render-identity';
import {
  planRenderProjectionScope,
  type RenderProjectionFullReason,
  type RenderProjectionScope,
} from '@transitmapper/core/render/render-projection-scope';
import {
  mergePreparedRenderInvalidations,
  planPreparedRenderProjectionScope,
} from '@transitmapper/core/render/render-preparation-scope';
import type { RenderPreparedSnapshot } from '@transitmapper/core/render/render-preparation';
import {
  SRC_CONNECTORS,
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
import type { MapSystemFeatureSourceId } from './system-feature-sources';

type EntityRenderFullReason = RenderProjectionFullReason | 'unsupported-domain';

interface FullEntityRenderUpdate {
  readonly kind: 'full';
  readonly reason: EntityRenderFullReason;
  readonly sourceIds: readonly MapSystemFeatureSourceId[];
}

interface ScopedEntityRenderUpdate {
  readonly kind: 'scoped';
  readonly sourceIds: readonly MapSystemFeatureSourceId[];
  readonly projectionScope: RenderProjectionScope;
  readonly replacementDomainsBySource: ReadonlyMap<
    MapSystemFeatureSourceId,
    readonly RenderDomainIdentity[]
  >;
}

export type EntityRenderUpdate = FullEntityRenderUpdate | ScopedEntityRenderUpdate;

interface PendingPreparedLiveInvalidation {
  readonly invalidation?: RenderDependencyClosure;
  readonly fullProjectionReason?: RenderProjectionFullReason;
}

export interface PreparedLiveInvalidationTracker {
  record(snapshot: RenderPreparedSnapshot): PendingPreparedLiveInvalidation;
  accept(snapshot: RenderPreparedSnapshot): void;
  current(): PendingPreparedLiveInvalidation;
  reset(): void;
}

export interface PlanEntityRenderUpdateInput {
  readonly previous: TransitSystem;
  readonly next: TransitSystem;
  readonly viewMode: 'network' | 'infrastructure' | 'diagram';
  readonly requestedSourceIds: readonly MapSystemFeatureSourceId[];
  readonly previousPreparedSnapshot?: RenderPreparedSnapshot;
  readonly nextPreparedSnapshot?: RenderPreparedSnapshot;
  readonly preparedInvalidation?: RenderDependencyClosure;
  readonly preparedFullProjectionReason?: RenderProjectionFullReason;
}

export interface PlanPreparedLiveEntityRenderUpdateInput {
  readonly intent: 'incremental' | 'reset' | 'style-heal';
  readonly transition: { readonly previous: TransitSystem; readonly next: TransitSystem } | null;
  readonly system: TransitSystem;
  readonly viewMode: 'network' | 'infrastructure' | 'diagram';
  readonly requestedSourceIds: readonly MapSystemFeatureSourceId[];
  /** Snapshot that produced the scene MapLibre actually accepted. This must
   * not be substituted with the preparation coordinator's newer draft. */
  readonly lastLivePreparedSnapshot: RenderPreparedSnapshot | null;
  readonly nextPreparedSnapshot: RenderPreparedSnapshot;
  readonly preparedInvalidation?: RenderDependencyClosure;
  readonly preparedFullProjectionReason?: RenderProjectionFullReason;
}

function domains(kind: string, ids: readonly string[]): readonly RenderDomainIdentity[] {
  return ids.map((id) => renderDomainIdentity(kind, id));
}

function serviceFragmentDomains(
  previous: TransitSystem,
  next: TransitSystem,
  scope: RenderProjectionScope,
): readonly RenderDomainIdentity[] {
  const directServices = domains('service', scope.changedServiceIds);
  const replacesWayFragments =
    scope.replacement.physicalWayIds.length > 0 ||
    previous.turnRestrictions !== next.turnRestrictions;
  return [
    ...directServices,
    ...(replacesWayFragments ? domains('way', scope.replacement.serviceWayIds) : []),
  ];
}

interface SourceDomainsInput {
  sourceId: MapSystemFeatureSourceId;
  previous: TransitSystem;
  next: TransitSystem;
  scope: RenderProjectionScope;
}

const PHYSICAL_WAY_SOURCES = new Set<MapSystemFeatureSourceId>([
  SRC_WAYS,
  SRC_HANDLES,
  SRC_LANES,
  SRC_LANE_MARKINGS,
  SRC_LANE_ARROWS,
]);
const SERVICE_FRAGMENT_SOURCES = new Set<MapSystemFeatureSourceId>([
  SRC_SERVICES,
  SRC_SERVICE_ARROWS,
]);
const STATION_SOURCES = new Set<MapSystemFeatureSourceId>([
  SRC_STATIONS,
  SRC_FOOTPRINTS,
  SRC_PLATFORMS,
  SRC_PHYSICAL_HANDLES,
]);

function sourceDomains({
  sourceId,
  previous,
  next,
  scope,
}: SourceDomainsInput): readonly RenderDomainIdentity[] {
  const physicalWays = domains('way', scope.replacement.physicalWayIds);
  const stations = domains('station', scope.replacement.stationIds);
  if (PHYSICAL_WAY_SOURCES.has(sourceId)) return physicalWays;
  if (SERVICE_FRAGMENT_SOURCES.has(sourceId)) {
    return serviceFragmentDomains(previous, next, scope);
  }
  if (STATION_SOURCES.has(sourceId)) return stations;
  if (sourceId === SRC_SERVICE_TERMINI) return domains('service', scope.replacement.serviceIds);
  if (sourceId === SRC_JUNCTIONS) return domains('node', scope.replacement.junctionNodeIds);
  if (sourceId === SRC_CONNECTORS) return domains('node', scope.replacement.connectorNodeIds);
  if (sourceId === SRC_WAY_LABELS) {
    return domains('labelDependency', scope.replacement.labelDependencyIds);
  }
  return [];
}

function unsupportedDomainChanged(previous: TransitSystem, next: TransitSystem): boolean {
  return (
    previous.facilities !== next.facilities ||
    previous.groups !== next.groups ||
    previous.drivingSide !== next.drivingSide
  );
}

/** Converts core's model dependency closure into the semantic owners each
 * retained MapLibre source must replace. Empty source scopes are omitted: a
 * safe service style edit, for example, cannot wake physical lane geometry. */
export function planEntityRenderUpdate({
  previous,
  next,
  viewMode,
  requestedSourceIds,
  previousPreparedSnapshot,
  nextPreparedSnapshot,
  preparedInvalidation,
  preparedFullProjectionReason,
}: PlanEntityRenderUpdateInput): EntityRenderUpdate {
  if (unsupportedDomainChanged(previous, next)) {
    return { kind: 'full', reason: 'unsupported-domain', sourceIds: requestedSourceIds };
  }
  const preparedPairIsExact =
    previousPreparedSnapshot?.system === previous && nextPreparedSnapshot?.system === next;
  const projection = preparedPairIsExact
    ? planPreparedRenderProjectionScope(previousPreparedSnapshot, nextPreparedSnapshot, {
        viewMode,
        ...(preparedInvalidation ? { invalidation: preparedInvalidation } : {}),
        ...(preparedFullProjectionReason
          ? { fullProjectionReason: preparedFullProjectionReason }
          : {}),
      })
    : planRenderProjectionScope(previous, next, { viewMode });
  if (projection.kind === 'full') {
    return { kind: 'full', reason: projection.reason, sourceIds: requestedSourceIds };
  }

  const replacementDomainsBySource = new Map<
    MapSystemFeatureSourceId,
    readonly RenderDomainIdentity[]
  >();
  for (const sourceId of requestedSourceIds) {
    const replacementDomains = sourceDomains({
      sourceId,
      previous,
      next,
      scope: projection.scope,
    });
    if (replacementDomains.length > 0) {
      replacementDomainsBySource.set(sourceId, [...new Set(replacementDomains)]);
    }
  }
  return {
    kind: 'scoped',
    sourceIds: requestedSourceIds.filter((sourceId) => replacementDomainsBySource.has(sourceId)),
    projectionScope: projection.scope,
    replacementDomainsBySource,
  };
}

/** Selects the prepared O(delta) path only when its invalidation starts at the
 * scene that is really live. Callers may supply the closure accumulated across
 * canceled continuations; cold service/import preparation carries an explicit
 * full reason instead of an empty closure. */
export function planPreparedLiveEntityRenderUpdate({
  intent,
  transition,
  system,
  viewMode,
  requestedSourceIds,
  lastLivePreparedSnapshot,
  nextPreparedSnapshot,
  preparedInvalidation,
  preparedFullProjectionReason,
}: PlanPreparedLiveEntityRenderUpdateInput): EntityRenderUpdate | null {
  const hasPreparedChange =
    nextPreparedSnapshot.diagnostics.kind === 'incremental' ||
    preparedInvalidation !== undefined ||
    preparedFullProjectionReason !== undefined ||
    nextPreparedSnapshot.fullProjectionReason !== undefined;
  const exactIncrementalPair =
    intent === 'incremental' &&
    transition?.next === system &&
    lastLivePreparedSnapshot?.system === transition.previous &&
    nextPreparedSnapshot.system === system &&
    hasPreparedChange;
  if (!exactIncrementalPair) return null;
  return planEntityRenderUpdate({
    previous: transition.previous,
    next: system,
    viewMode,
    requestedSourceIds,
    previousPreparedSnapshot: lastLivePreparedSnapshot,
    nextPreparedSnapshot,
    ...(preparedInvalidation ? { preparedInvalidation } : {}),
    ...(preparedFullProjectionReason ? { preparedFullProjectionReason } : {}),
  });
}

function hasInvalidation(closure: RenderDependencyClosure): boolean {
  return (
    closure.corridorIds.length > 0 ||
    closure.junctionIds.length > 0 ||
    closure.connectorJunctionIds.length > 0 ||
    closure.serviceSpanIds.length > 0 ||
    closure.stationIds.length > 0 ||
    closure.labelIds.length > 0
  );
}

function pendingInvalidationState(
  snapshots: readonly RenderPreparedSnapshot[],
): PendingPreparedLiveInvalidation {
  const closures = snapshots.map(({ invalidation }) => invalidation).filter(hasInvalidation);
  const invalidation =
    closures.length > 0 ? mergePreparedRenderInvalidations(...closures) : undefined;
  const fullProjectionReason = snapshots.find(
    ({ fullProjectionReason }) => fullProjectionReason,
  )?.fullProjectionReason;
  return {
    ...(invalidation ? { invalidation } : {}),
    ...(fullProjectionReason ? { fullProjectionReason } : {}),
  };
}

/** Tracks coordinator commits that have not reached the live renderer. Empty
 * camera snapshots remain as acceptance markers, but cannot erase older model
 * invalidation until that camera generation is actually painted. */
export function createPreparedLiveInvalidationTracker(): PreparedLiveInvalidationTracker {
  const pending: RenderPreparedSnapshot[] = [];
  return {
    record(snapshot) {
      if (!pending.includes(snapshot)) pending.push(snapshot);
      return pendingInvalidationState(pending);
    },
    accept(snapshot) {
      const acceptedIndex = pending.indexOf(snapshot);
      if (acceptedIndex >= 0) pending.splice(0, acceptedIndex + 1);
    },
    current: () => pendingInvalidationState(pending),
    reset: () => {
      pending.length = 0;
    },
  };
}
