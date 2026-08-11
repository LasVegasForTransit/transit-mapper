import { serviceWayIds } from '../model/geo';
import type { Service, TransitSystem } from '../model/system';
import {
  dependencyClosure,
  projectionCandidatesForDependencyClosure,
  renderDependencyIndexFor,
  type RenderDependencyClosure,
} from './dependency-index';
import { changedRenderDependencies } from './dependency-invalidation';

export interface RenderProjectionCandidates {
  readonly physicalWayIds: readonly string[];
  readonly serviceWayIds: readonly string[];
  readonly topologyWayIds: readonly string[];
  readonly junctionNodeIds: readonly string[];
  readonly connectorNodeIds: readonly string[];
  /** Nodes projection may inspect for trims even when their source features are not emitted. */
  readonly geometryNodeIds: readonly string[];
  readonly stationIds: readonly string[];
  readonly labelDependencyIds: readonly string[];
  readonly labelWayIds: readonly string[];
  readonly namedWayIds: readonly string[];
  readonly affectedServiceIds: readonly string[];
}

/** Prior+next domain owners whose existing source features may be replaced or
 * removed. These are intentionally distinct from next-only projection
 * candidates: a deleted entity must be removed without pretending it can be
 * visited in the next snapshot. */
export interface RenderProjectionReplacementScope {
  readonly physicalWayIds: readonly string[];
  readonly serviceWayIds: readonly string[];
  readonly serviceIds: readonly string[];
  readonly junctionNodeIds: readonly string[];
  readonly connectorNodeIds: readonly string[];
  readonly stationIds: readonly string[];
  readonly labelDependencyIds: readonly string[];
  readonly labelWayIds: readonly string[];
  readonly namedWayIds: readonly string[];
}

/** Exact prior+next dependency closure plus the concrete model IDs each core
 * projection pass needs. Raw IDs are intentional: adapters can qualify them
 * with `renderDomainIdentity` for their own source replacement maps. */
export interface RenderProjectionScope {
  readonly closure: RenderDependencyClosure;
  readonly candidates: RenderProjectionCandidates;
  readonly replacement: RenderProjectionReplacementScope;
  readonly changedServiceIds: readonly string[];
  readonly affectedServiceIds: readonly string[];
}

export type RenderProjectionFullReason =
  'document-change' | 'diagram' | 'service-bundle-allocation' | 'unsupported-prepared-delta';

export type RenderProjectionPlan =
  | { readonly kind: 'scoped'; readonly scope: RenderProjectionScope }
  | { readonly kind: 'full'; readonly reason: RenderProjectionFullReason };

export interface PlanRenderProjectionScopeOptions {
  viewMode?: 'network' | 'infrastructure' | 'diagram';
}

function orderedUnion(...groups: readonly (readonly string[])[]): readonly string[] {
  return [...new Set(groups.flat())];
}

function orderedExisting(
  values: readonly { id: string }[],
  members: readonly string[],
): readonly string[] {
  const memberSet = new Set(members);
  return values.map(({ id }) => id).filter((id) => memberSet.has(id));
}

function mergeClosures(
  previous: RenderDependencyClosure,
  next: RenderDependencyClosure,
): RenderDependencyClosure {
  return {
    corridorIds: orderedUnion(previous.corridorIds, next.corridorIds),
    junctionIds: orderedUnion(previous.junctionIds, next.junctionIds),
    connectorJunctionIds: orderedUnion(previous.connectorJunctionIds, next.connectorJunctionIds),
    serviceSpanIds: orderedUnion(previous.serviceSpanIds, next.serviceSpanIds),
    stationIds: orderedUnion(previous.stationIds, next.stationIds),
    labelIds: orderedUnion(previous.labelIds, next.labelIds),
  };
}

function sameOrderedMembers(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function serviceBundleSignatureChanged(previous: Service, next: Service): boolean {
  return (
    previous.id !== next.id ||
    previous.modeId !== next.modeId ||
    !sameOrderedMembers(serviceWayIds(previous), serviceWayIds(next))
  );
}

function serviceBundleAllocationChanged(previous: TransitSystem, next: TransitSystem): boolean {
  return (
    previous.services.length !== next.services.length ||
    previous.services.some((service, index) =>
      serviceBundleSignatureChanged(service, next.services[index]),
    )
  );
}

/** Plan entity-scoped projection from immutable document snapshots. A full
 * result is explicit whenever core cannot promise an exact incremental patch. */
export function planRenderProjectionScope(
  previous: TransitSystem,
  next: TransitSystem,
  options: PlanRenderProjectionScopeOptions = {},
): RenderProjectionPlan {
  if (previous.id !== next.id) return { kind: 'full', reason: 'document-change' };
  if (options.viewMode === 'diagram') return { kind: 'full', reason: 'diagram' };
  if (serviceBundleAllocationChanged(previous, next)) {
    return { kind: 'full', reason: 'service-bundle-allocation' };
  }

  const changes = changedRenderDependencies(previous, next);
  const previousIndex = renderDependencyIndexFor(previous);
  const nextIndex = renderDependencyIndexFor(next);
  const previousClosure = dependencyClosure(previousIndex, changes);
  const nextClosure = dependencyClosure(nextIndex, changes);
  const closure = mergeClosures(previousClosure, nextClosure);
  const previousOwners = projectionCandidatesForDependencyClosure(previousIndex, previousClosure);
  const nextOwners = projectionCandidatesForDependencyClosure(nextIndex, nextClosure);
  const changedServiceIds = changes.serviceIds ?? [];
  const affectedServiceIds = orderedUnion(
    previousOwners.serviceIds,
    nextOwners.serviceIds,
    changedServiceIds,
  );
  const physicalWayIds = nextClosure.corridorIds;
  const serviceWayIds = orderedExisting(next.ways, nextOwners.serviceWayIds);

  return {
    kind: 'scoped',
    scope: {
      closure,
      changedServiceIds,
      affectedServiceIds,
      candidates: {
        physicalWayIds,
        serviceWayIds,
        topologyWayIds: orderedExisting(next.ways, orderedUnion(physicalWayIds, serviceWayIds)),
        junctionNodeIds: nextClosure.junctionIds,
        connectorNodeIds: nextClosure.connectorJunctionIds,
        geometryNodeIds: orderedExisting(
          next.nodes,
          orderedUnion(
            nextClosure.junctionIds,
            nextClosure.connectorJunctionIds,
            nextOwners.serviceNodeIds,
          ),
        ),
        stationIds: nextClosure.stationIds,
        labelDependencyIds: nextClosure.labelIds,
        labelWayIds: orderedExisting(next.ways, nextOwners.labelWayIds),
        namedWayIds: orderedExisting(next.namedWays, nextOwners.namedWayIds),
        affectedServiceIds: orderedExisting(next.services, affectedServiceIds),
      },
      replacement: {
        physicalWayIds: closure.corridorIds,
        serviceWayIds: orderedUnion(previousOwners.serviceWayIds, nextOwners.serviceWayIds),
        serviceIds: affectedServiceIds,
        junctionNodeIds: closure.junctionIds,
        connectorNodeIds: closure.connectorJunctionIds,
        stationIds: closure.stationIds,
        labelDependencyIds: closure.labelIds,
        labelWayIds: orderedUnion(previousOwners.labelWayIds, nextOwners.labelWayIds),
        namedWayIds: orderedUnion(previousOwners.namedWayIds, nextOwners.namedWayIds),
      },
    },
  };
}
