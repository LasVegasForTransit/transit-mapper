// Generic component-map helpers — the smallest possible "ECS core" for
// capabilities that don't belong on any single record's own interface
// (turn restrictions, medians, per-approach control). A component is just a
// Record<string, T> keyed by some entity/sub-entity reference string, stored
// alongside the entity arrays on TransitSystem (see system.ts), and updated
// with the same copy-on-write convention the store already uses everywhere.
// Not a framework: existing fields (Way.profile, Way.geometry, …) are not
// migrated into components — only genuinely new capabilities go through
// this registry.

export type EntityId = string;
export type ComponentMap<T> = Record<string, T>;

export function getComponent<T>(map: ComponentMap<T>, key: EntityId): T | undefined {
  return map[key];
}

export function withComponent<T>(map: ComponentMap<T>, key: EntityId, value: T): ComponentMap<T> {
  return { ...map, [key]: value };
}

export function withoutComponent<T>(map: ComponentMap<T>, key: EntityId): ComponentMap<T> {
  if (!(key in map)) return map;
  const next = { ...map };
  delete next[key];
  return next;
}

/** A lane ref key, stable for TurnRestriction — matches LaneConnector's own
 *  {wayId, laneId} shape so the two concepts key identically. */
export function laneRefKey(wayId: string, laneId: string): EntityId {
  return `${wayId}:${laneId}`;
}

/** An arm ref key (one way-end meeting a junction), for ApproachControl. */
export function armRefKey(wayId: string, end: 'start' | 'end'): EntityId {
  return `${wayId}:${end}`;
}

/**
 * Drop every component whose key names a lane that no longer exists.
 *
 * Lane-keyed components (TurnRestriction) outlive the lanes they describe:
 * deleting a way, merging two, or applying a preset all leave keys behind,
 * because `laneRefKey` names a way and a lane and nothing checks either is
 * still real. The entries are invisible — no UI lists them — but a later lane
 * that happens to reuse an id inherits a restriction nobody set, and
 * serialize keeps them across a save because it only validates ids it can
 * see. Rebuilding against the live lanes is cheap and has no false positives.
 */
export function prunedToLiveLanes<T>(
  map: ComponentMap<T>,
  ways: { id: string; profile: { lanes: { id: string }[] } }[],
): ComponentMap<T> {
  const live = new Set<string>();
  for (const way of ways)
    for (const lane of way.profile.lanes) live.add(laneRefKey(way.id, lane.id));
  const keys = Object.keys(map);
  if (keys.every((k) => live.has(k))) return map;
  const next: ComponentMap<T> = {};
  for (const k of keys) if (live.has(k)) next[k] = map[k];
  return next;
}
