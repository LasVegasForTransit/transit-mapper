import { preparedSnapshotInternals, type RenderPreparedSnapshot } from './render-preparation';
import type {
  RenderProjectionPlan,
  RenderProjectionFullReason,
  RenderProjectionScope,
} from './render-projection-scope';
import type { RenderDependencyClosure } from './dependency-index';

export interface PlanPreparedRenderProjectionScopeOptions {
  readonly viewMode?: 'network' | 'infrastructure' | 'diagram';
  /** Authoritative accumulated closure since the last accepted live scene. */
  readonly invalidation?: RenderDependencyClosure;
  /** Authoritative accumulated full requirement since the last accepted scene. */
  readonly fullProjectionReason?: RenderProjectionFullReason;
}

function existing(ids: readonly string[], values: ReadonlyMap<string, unknown>): readonly string[] {
  return ids.filter((id) => values.has(id));
}

function orderedUnion(...groups: readonly (readonly string[])[]): readonly string[] {
  return [...new Set(groups.flat())];
}

export function mergePreparedRenderInvalidations(
  ...closures: readonly RenderDependencyClosure[]
): RenderDependencyClosure {
  return {
    corridorIds: orderedUnion(...closures.map(({ corridorIds }) => corridorIds)),
    junctionIds: orderedUnion(...closures.map(({ junctionIds }) => junctionIds)),
    connectorJunctionIds: orderedUnion(
      ...closures.map(({ connectorJunctionIds }) => connectorJunctionIds),
    ),
    serviceSpanIds: orderedUnion(...closures.map(({ serviceSpanIds }) => serviceSpanIds)),
    stopIds: orderedUnion(...closures.map(({ stopIds }) => stopIds)),
    stationIds: orderedUnion(...closures.map(({ stationIds }) => stationIds)),
    labelIds: orderedUnion(...closures.map(({ labelIds }) => labelIds)),
  };
}

interface PreparedOwnerCandidates {
  readonly serviceWayIds: readonly string[];
  readonly serviceIds: readonly string[];
  readonly labelWayIds: readonly string[];
  readonly namedWayIds: readonly string[];
}

function ownersForClosure(
  snapshot: RenderPreparedSnapshot,
  corridorIds: readonly string[],
  labelIds: ReadonlySet<string>,
): PreparedOwnerCandidates {
  const dependency = preparedSnapshotInternals(snapshot).dependency;
  const serviceWayIds: string[] = [];
  const serviceIds = new Set<string>();
  const labelWayIds: string[] = [];
  const namedWayIds = new Set<string>();
  for (const wayId of corridorIds) {
    const wayServiceIds = dependency.serviceIdsByWay.get(wayId) ?? [];
    if (wayServiceIds.length > 0) serviceWayIds.push(wayId);
    for (const serviceId of wayServiceIds) serviceIds.add(serviceId);
    if ((dependency.labelsByWay.get(wayId) ?? []).some((labelId) => labelIds.has(labelId))) {
      labelWayIds.push(wayId);
      for (const namedWayId of dependency.namedWayIdsByWay.get(wayId) ?? []) {
        namedWayIds.add(namedWayId);
      }
    }
  }
  return { serviceWayIds, serviceIds: [...serviceIds], labelWayIds, namedWayIds: [...namedWayIds] };
}

/** Converts a committed preparation delta into the same projection contract
 * as the legacy whole-document dependency planner. No collection is scanned:
 * every lookup is bounded by the already-measured invalidation closure. */
export function planPreparedRenderProjectionScope(
  previous: RenderPreparedSnapshot,
  next: RenderPreparedSnapshot,
  options: PlanPreparedRenderProjectionScopeOptions = {},
): RenderProjectionPlan {
  if (previous.system.id !== next.system.id) return { kind: 'full', reason: 'document-change' };
  if (options.viewMode === 'diagram') return { kind: 'full', reason: 'diagram' };
  const fullProjectionReason = options.fullProjectionReason ?? next.fullProjectionReason;
  if (fullProjectionReason) return { kind: 'full', reason: fullProjectionReason };
  const closure = options.invalidation ?? next.invalidation;
  const labelIds = new Set(closure.labelIds);
  const previousOwners = ownersForClosure(previous, closure.corridorIds, labelIds);
  const nextOwners = ownersForClosure(next, closure.corridorIds, labelIds);
  const affectedServiceIds = orderedUnion(previousOwners.serviceIds, nextOwners.serviceIds);
  const physicalWayIds = existing(closure.corridorIds, next.waysById);
  const serviceWayIds = existing(nextOwners.serviceWayIds, next.waysById);
  const junctionNodeIds = existing(closure.junctionIds, next.nodesById);
  const connectorNodeIds = existing(closure.connectorJunctionIds, next.nodesById);
  const stopIds = existing(closure.stopIds, next.stopsById);
  const stationIds = existing(closure.stationIds, next.stationsById);
  const labelWayIds = existing(nextOwners.labelWayIds, next.waysById);
  const namedWayIds = existing(nextOwners.namedWayIds, next.namedWaysById);
  const scope: RenderProjectionScope = {
    closure,
    changedServiceIds: [],
    affectedServiceIds,
    candidates: {
      physicalWayIds,
      serviceWayIds,
      topologyWayIds: orderedUnion(physicalWayIds, serviceWayIds),
      junctionNodeIds,
      connectorNodeIds,
      geometryNodeIds: orderedUnion(junctionNodeIds, connectorNodeIds),
      stopIds,
      stationIds,
      labelDependencyIds: closure.labelIds,
      labelWayIds,
      namedWayIds,
      affectedServiceIds,
    },
    replacement: {
      physicalWayIds: closure.corridorIds,
      serviceWayIds: orderedUnion(previousOwners.serviceWayIds, nextOwners.serviceWayIds),
      serviceIds: affectedServiceIds,
      junctionNodeIds: closure.junctionIds,
      connectorNodeIds: closure.connectorJunctionIds,
      stopIds: closure.stopIds,
      stationIds: closure.stationIds,
      labelDependencyIds: closure.labelIds,
      labelWayIds: orderedUnion(previousOwners.labelWayIds, nextOwners.labelWayIds),
      namedWayIds: orderedUnion(previousOwners.namedWayIds, nextOwners.namedWayIds),
    },
  };
  return { kind: 'scoped', scope };
}
