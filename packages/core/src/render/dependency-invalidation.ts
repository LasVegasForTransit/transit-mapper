import type { TransitSystem } from '../model/system';
import {
  dependencyClosure,
  renderDependencyIndexFor,
  type RenderDependencyChanges,
  type RenderDependencyClosure,
} from './dependency-index';

function changedEntityIds<T>(
  previous: readonly T[],
  next: readonly T[],
  idFor: (value: T) => string,
): readonly string[] {
  const previousById = new Map(previous.map((value) => [idFor(value), value] as const));
  const nextById = new Map(next.map((value) => [idFor(value), value] as const));
  const changed = new Set<string>();
  for (const [id, value] of previousById) if (nextById.get(id) !== value) changed.add(id);
  for (const [id, value] of nextById) if (previousById.get(id) !== value) changed.add(id);
  return [
    ...previous.map(idFor).filter((id) => changed.has(id)),
    ...next.map(idFor).filter((id) => changed.has(id) && !previousById.has(id)),
  ];
}

function changedComponentKeys<T>(
  previous: Readonly<Record<string, T>>,
  next: Readonly<Record<string, T>>,
): readonly string[] {
  const changed = new Set<string>();
  for (const key of Object.keys(previous)) if (next[key] !== previous[key]) changed.add(key);
  for (const key of Object.keys(next)) if (previous[key] !== next[key]) changed.add(key);
  return [
    ...Object.keys(previous).filter((key) => changed.has(key)),
    ...Object.keys(next).filter((key) => changed.has(key) && !(key in previous)),
  ];
}

/** Find immutable entity changes without treating a copied-but-equal array as an edit. */
export function changedRenderDependencies(
  previous: TransitSystem,
  next: TransitSystem,
): RenderDependencyChanges {
  return {
    wayIds: changedEntityIds(previous.ways, next.ways, ({ id }) => id),
    nodeIds: changedEntityIds(previous.nodes, next.nodes, ({ id }) => id),
    serviceIds: changedEntityIds(previous.services, next.services, ({ id }) => id),
    stopIds: changedEntityIds(previous.stops, next.stops, ({ id }) => id),
    stationIds: changedEntityIds(previous.stations, next.stations, ({ id }) => id),
    namedWayIds: changedEntityIds(previous.namedWays, next.namedWays, ({ id }) => id),
    turnRestrictionKeys: changedComponentKeys(previous.turnRestrictions, next.turnRestrictions),
    approachControlKeys: changedComponentKeys(previous.approachControls, next.approachControls),
    medianKeys: changedComponentKeys(previous.medians, next.medians),
  };
}

function mergeClosures(
  previous: RenderDependencyClosure,
  next: RenderDependencyClosure,
): RenderDependencyClosure {
  function merge(left: readonly string[], right: readonly string[]): readonly string[] {
    return [...new Set([...left, ...right])];
  }
  return {
    corridorIds: merge(previous.corridorIds, next.corridorIds),
    junctionIds: merge(previous.junctionIds, next.junctionIds),
    connectorJunctionIds: merge(previous.connectorJunctionIds, next.connectorJunctionIds),
    serviceSpanIds: merge(previous.serviceSpanIds, next.serviceSpanIds),
    stopIds: merge(previous.stopIds, next.stopIds),
    stationIds: merge(previous.stationIds, next.stationIds),
    labelIds: merge(previous.labelIds, next.labelIds),
  };
}

/** Include both sides so removed render identities are never lost from a patch. */
export function dependencyInvalidationBetween(
  previous: TransitSystem,
  next: TransitSystem,
): RenderDependencyClosure {
  const changes = changedRenderDependencies(previous, next);
  return mergeClosures(
    dependencyClosure(renderDependencyIndexFor(previous), changes),
    dependencyClosure(renderDependencyIndexFor(next), changes),
  );
}
