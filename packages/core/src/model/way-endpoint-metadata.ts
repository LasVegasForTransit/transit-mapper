import { armRefKey, laneRefKey, type ComponentMap } from './components';
import type {
  ApproachControl,
  LaneDirection,
  LaneSpec,
  TransitSystem,
  TurnRestriction,
  Way,
  WayPointRef,
} from './system';

type WayEnd = 'start' | 'end';

export interface WayEndpoint {
  way: Way;
  end: WayEnd;
}

export interface WayEndpointRemap {
  source: Way;
  start: WayEndpoint | null;
  end: WayEndpoint | null;
  /** Maps source lane identities when the destination keeps an equivalent
   *  profile under different lane ids. */
  laneIds?: ReadonlyMap<string, string>;
}

export interface WaySplitTargetRemap {
  sourceWayId: string;
  splitIndex: number;
  newWayId: string;
}

interface EndpointMetadata {
  approachControls: TransitSystem['approachControls'];
  turnRestrictions: TransitSystem['turnRestrictions'];
}

function restrictionEnd(direction: LaneDirection): WayEnd | null {
  if (direction === 'backward') return 'start';
  if (direction === 'forward' || direction === 'both') return 'end';
  return null;
}

function sameMap<Value>(left: ComponentMap<Value>, right: ComponentMap<Value>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && rightKeys.every((key) => left[key] === right[key]);
}

function remapApproachControls(
  controls: ComponentMap<ApproachControl>,
  remaps: WayEndpointRemap[],
): ComponentMap<ApproachControl> {
  const destinations = new Map<string, string | null>();
  for (const remap of remaps) {
    for (const end of ['start', 'end'] as const) {
      const destination = remap[end];
      destinations.set(
        armRefKey(remap.source.id, end),
        destination ? armRefKey(destination.way.id, destination.end) : null,
      );
    }
  }

  const next: ComponentMap<ApproachControl> = {};
  for (const [key, control] of Object.entries(controls)) {
    if (!destinations.has(key)) {
      next[key] = control;
      continue;
    }
    const destination = destinations.get(key);
    if (destination !== null && destination !== undefined) next[destination] = control;
  }
  return sameMap(controls, next) ? controls : next;
}

function remappedRestriction(
  restriction: TurnRestriction,
  targetWayIds: ReadonlyMap<string, string>,
): TurnRestriction {
  if (!restriction.allowedTargets.some((target) => targetWayIds.has(target))) return restriction;
  const mapped = restriction.allowedTargets.map((target) => targetWayIds.get(target) ?? target);
  return { ...restriction, allowedTargets: [...new Set(mapped)] };
}

function remappedLaneKey(remap: WayEndpointRemap, lane: LaneSpec): string | null {
  const end = restrictionEnd(lane.direction);
  if (!end) return null;
  const destination = remap[end];
  const targetLaneId = remap.laneIds?.get(lane.id) ?? lane.id;
  const targetLane = destination?.way.profile.lanes.find(
    (candidate) => candidate.id === targetLaneId,
  );
  if (!destination || !targetLane || restrictionEnd(targetLane.direction) !== destination.end) {
    return null;
  }
  return laneRefKey(destination.way.id, targetLane.id);
}

function remapTurnRestrictions(
  restrictions: ComponentMap<TurnRestriction>,
  remaps: WayEndpointRemap[],
  targetWayIds: ReadonlyMap<string, string>,
): ComponentMap<TurnRestriction> {
  const destinations = new Map<string, string | null>();
  for (const remap of remaps) {
    for (const lane of remap.source.profile.lanes) {
      destinations.set(laneRefKey(remap.source.id, lane.id), remappedLaneKey(remap, lane));
    }
  }

  const next: ComponentMap<TurnRestriction> = {};
  for (const [key, restriction] of Object.entries(restrictions)) {
    if (destinations.get(key) === null) continue;
    const destination = destinations.get(key) ?? key;
    if (Object.hasOwn(next, destination)) continue;
    next[destination] = remappedRestriction(restriction, targetWayIds);
  }
  return sameMap(restrictions, next) ? restrictions : next;
}

/** Remaps metadata whose meaning is tied to the outer endpoint of a way. */
export function remapWayEndpointMetadata(
  metadata: EndpointMetadata,
  remaps: WayEndpointRemap[],
  targetWayIds: ReadonlyMap<string, string> = new Map(),
): EndpointMetadata {
  const approachControls = remapApproachControls(metadata.approachControls, remaps);
  const turnRestrictions = remapTurnRestrictions(metadata.turnRestrictions, remaps, targetWayIds);
  return { approachControls, turnRestrictions };
}

function refEnd(way: Way, ref: WayPointRef): WayEnd | null {
  if (ref.pointIndex === 0) return 'start';
  return ref.pointIndex === way.points.length - 1 ? 'end' : null;
}

function restrictionKeysAtRef(
  ways: ReadonlyMap<string, Way>,
  sourceWayId: string,
  ref: WayPointRef,
): string[] {
  if (ref.wayId === sourceWayId) return [];
  const way = ways.get(ref.wayId);
  if (!way) return [];
  const end = refEnd(way, ref);
  if (!end) return [];
  return way.profile.lanes
    .filter((lane) => restrictionEnd(lane.direction) === end)
    .map((lane) => laneRefKey(way.id, lane.id));
}

function affectedSplitRestrictionKeys(
  system: TransitSystem,
  remap: WaySplitTargetRemap,
): Set<string> {
  const ways = new Map(system.ways.map((way) => [way.id, way]));
  const nodes = system.nodes.filter((node) =>
    node.refs.some((ref) => ref.wayId === remap.sourceWayId && ref.pointIndex > remap.splitIndex),
  );
  return new Set(
    nodes.flatMap((node) =>
      node.refs.flatMap((ref) => restrictionKeysAtRef(ways, remap.sourceWayId, ref)),
    ),
  );
}

/**
 * A split changes the target Way identity only at nodes moved onto the new
 * half. Restrictions on neighboring approaches therefore need endpoint-local
 * remapping rather than the global target remap used by a merge.
 */
export function remapWaySplitTurnTargets(
  system: TransitSystem,
  restrictions: TransitSystem['turnRestrictions'],
  remap: WaySplitTargetRemap,
): TransitSystem['turnRestrictions'] {
  const affectedKeys = affectedSplitRestrictionKeys(system, remap);
  const targetWayIds = new Map([[remap.sourceWayId, remap.newWayId]]);
  let next = restrictions;
  for (const key of affectedKeys) {
    if (!Object.hasOwn(restrictions, key)) continue;
    const restriction = restrictions[key];
    const remapped = remappedRestriction(restriction, targetWayIds);
    if (remapped === restriction) continue;
    if (next === restrictions) next = { ...restrictions };
    next[key] = remapped;
  }
  return next;
}
