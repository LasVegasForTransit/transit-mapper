// Auto-naming a newly placed stop from the real street names already in the
// document — "14th St & Broadway" for a rail-style stop at an intersection,
// "Main St @ 5th Ave" / "Main St before 5th Ave" for a bus-style stop along
// a block. Computed entirely from existing street geometry (NamedWay +
// Node), never from landmark/POI data — none exists in this model yet.
import { modesForWayType } from '../catalog';
import { laneCapacity } from '../profile';
import { servicesAtStop } from '../../sim/frequency';
import type { LngLat, NamedWay, Node, Stop, StopAnchor, TransitSystem, Way } from '../system';
import { haversineMeters } from './spherical';
import { pathLengthMeters } from './measurement';
import { nodesByWayId, resolveWayPath, wayById } from './wayPath';
import { servedWaysByDistance } from './snapIndex';
/** Which cross-street naming convention a stop reads as. 'intersection'
 *  ("14th St & Broadway") reads as a fixed-platform rail stop; 'alongStreet'
 *  ("Main St @ 5th Ave" / "Main St before 5th Ave") reads as a curb stop
 *  positioned along one street. Kept local to this feature rather than on
 *  the shared Mode catalog type — nothing outside this file needs to know a
 *  mode's naming convention, the same reasoning that keeps MODE_RENDER
 *  (style/catalogStyle.ts) off Mode too. */
export type StopNamingStyle = 'intersection' | 'alongStreet';

/** Naming convention by mode id. Unset means 'intersection', the safer
 *  default for a mode that's always at a fixed platform. */
const STOP_NAMING_STYLE: Partial<Record<string, StopNamingStyle>> = {
  bus: 'alongStreet',
  brt: 'alongStreet',
};

function stopNamingStyle(modeId: string): StopNamingStyle {
  return STOP_NAMING_STYLE[modeId] ?? 'intersection';
}

/** Intersection wins over along-street whenever the modes in play disagree —
 *  matches an interchange keeping its rail-derived "&" name even once a bus
 *  also calls there. Shared by resolveNamingStyle's two branches (modes
 *  actually serving the stop, and modes that could plausibly serve it once
 *  one does), which otherwise differ only in what they map to a mode id. */
function styleFromModeIds(modeIds: string[]): StopNamingStyle {
  const styles = new Set(modeIds.map(stopNamingStyle));
  return styles.has('intersection') ? 'intersection' : 'alongStreet';
}

/** How close a stop's coordinate must be to a Node to read as "at" that
 *  junction rather than mid-block. */
const CROSS_STREET_AT_JUNCTION_M = 20;
/** Search radius for a free-floating (unanchored) stop's nearest named ways. */
const CROSS_STREET_SEARCH_RADIUS_M = 90;
/** How far to walk a corridor, either direction, before giving up on finding
 *  a genuinely different-named cross street — a few urban blocks. */
const CROSS_STREET_WALK_MAX_M = 400;
/** Hard stop on same-named block-split hops, far above any real grid. */
const MAX_WALK_HOPS = 200;

export interface SuggestedStopName {
  style: StopNamingStyle;
  /** null when nothing useful was found — the caller leaves the name field
   *  as-is (the "Unnamed stop" placeholder keeps showing). */
  name: string | null;
}

export interface CrossStreetQuery {
  system: TransitSystem;
  coord: LngLat;
  anchors: StopAnchor[];
}

// Cached by the namedWays array's own reference, same convention as
// nodesByWayId below and wayById (wayPath.ts) — suggestStopName rebuilds
// this on every call otherwise, and resyncAutoNamedStops calls it once
// per autoNamed stop against the same namedWays array each time.
const namedWayByWayIdCache = new WeakMap<NamedWay[], Map<string, NamedWay>>();

function namedWayByWayId(namedWays: NamedWay[]): Map<string, NamedWay> {
  let index = namedWayByWayIdCache.get(namedWays);
  if (index) return index;
  index = new Map();
  for (const nw of namedWays) for (const wayId of nw.wayIds) index.set(wayId, nw);
  namedWayByWayIdCache.set(namedWays, index);
  return index;
}

/** Which naming convention this stop should read as. Prefers what's already
 *  serving it (an interchange keeps its rail-derived "&" name even once a
 *  bus also calls there); falls back to the anchored way's own type when no
 *  service has been drawn through it yet, the common case right after
 *  placement. */
function resolveNamingStyle(
  system: TransitSystem,
  coord: LngLat,
  anchors: StopAnchor[],
): StopNamingStyle {
  const services = servicesAtStop(system.ways, system.services, {
    id: '',
    coord,
    anchors,
  });
  if (services.length > 0) {
    return styleFromModeIds(services.map((sv) => sv.modeId));
  }
  const waysById = wayById(system.ways);
  const anchoredWays = anchors
    .map((a) => waysById.get(a.wayId))
    .filter((w): w is Way => w !== undefined);
  // No service rides this stop yet, so guess from which mode(s) treat the
  // anchored way's type as their OWN primary type (wayTypeIds[0]) rather
  // than a secondary one — e.g. tram lists ['lightRail', 'road'] because it
  // can street-run, but 'lightRail' is what it actually is; a plain
  // road-typed way should read as a bus stop by default, not a tram one.
  // This is still a best-effort guess, not a guarantee: the catalog
  // deliberately allows a tram to run on a 'road'-typed way, so a stop
  // placed there can still go stale in naming convention if a tram service
  // is drawn through it later. Kept deliberately, rather than defaulting to
  // 'intersection' until a service exists: each editor command or shared
  // internal operation that can newly serve a stop calls
  // resyncAutoNamedStops (service metadata and gesture commands, routing,
  // and Way finishing), so the tram-on-road case corrects itself the moment a
  // real service actually proves the guess wrong. That leaves this heuristic
  // giving correct, immediate UX for the common case, with resync as the
  // safety net for the rest — not two independent guesses that can drift.
  // The Inspector's "Suggest name" button remains the manual recourse for
  // whatever's left (a moved stop, a stop named before this code
  // existed, etc).
  const nativeModes = anchoredWays.flatMap((w) =>
    modesForWayType(w.typeId).filter((m) => m.wayTypeIds[0] === w.typeId),
  );
  if (nativeModes.length === 0) return 'intersection';
  return styleFromModeIds(nativeModes.map((m) => m.id));
}

/** Distinct NamedWay names carried by the stop's own anchored way(s). */
function homeStreetNames(anchors: StopAnchor[], namedWayIndex: Map<string, NamedWay>): string[] {
  const names = new Set<string>();
  for (const anchor of anchors) {
    const nw = namedWayIndex.get(anchor.wayId);
    if (nw && nw.name.trim() !== '') names.add(nw.name);
  }
  return [...names];
}

/** Total travel-lane capacity of every way in a NamedWay — the only
 *  deterministic "which street is more important" signal the model has. */
function namedWayImportance(nw: NamedWay, waysById: Map<string, Way>): number {
  let total = 0;
  for (const wayId of nw.wayIds) {
    const way = waysById.get(wayId);
    if (way) total += laneCapacity(way.profile);
  }
  return total;
}

/** Resolves a way ref's NamedWay, skipping unnamed and home-named arms.
 *  Shared by crossStreetsAtNode's junction scan and walkOneDirection's
 *  pass-through check — both need exactly this filter before deciding what
 *  to do with a genuinely different name. */
function nonHomeName(
  wayId: string,
  namedWayIndex: Map<string, NamedWay>,
  homeNames: Set<string>,
): string | null {
  const nw = namedWayIndex.get(wayId);
  if (!nw || nw.name.trim() === '' || homeNames.has(nw.name)) return null;
  return nw.name;
}

interface JunctionCrossStreets {
  crossNames: string[];
}

/** If `coord` sits at (or very near) an existing Node on one of `homeWayIds`,
 *  the other arms' distinct, non-home names — ranked by importance, most
 *  important first. Null when no such node, or every arm shares a home name
 *  (a pure pass-through with nothing to name against). */
function crossStreetsAtNode(
  system: TransitSystem,
  coord: LngLat,
  homeWayIds: Set<string>,
  homeNames: Set<string>,
  namedWayIndex: Map<string, NamedWay>,
  waysById: Map<string, Way>,
): JunctionCrossStreets | null {
  const index = nodesByWayId(system.nodes);
  let best: { node: Node; distM: number } | null = null;
  for (const homeWayId of homeWayIds) {
    for (const node of index.get(homeWayId) ?? []) {
      const distM = haversineMeters(node.coord, coord);
      if (distM > CROSS_STREET_AT_JUNCTION_M) continue;
      if (!best || distM < best.distM) best = { node, distM };
    }
  }
  if (!best) return null;
  const candidates = new Map<string, NamedWay>(); // name -> representative NamedWay
  for (const ref of best.node.refs) {
    const name = nonHomeName(ref.wayId, namedWayIndex, homeNames);
    if (name) candidates.set(name, namedWayIndex.get(ref.wayId)!);
  }
  if (candidates.size === 0) return null;
  const ranked = [...candidates.values()].sort((a, b) => {
    const diff = namedWayImportance(b, waysById) - namedWayImportance(a, waysById);
    return diff !== 0 ? diff : a.name.localeCompare(b.name);
  });
  return { crossNames: ranked.map((nw) => nw.name) };
}

/** Whether any Node within the at-junction tolerance of `coord` links `a` and
 *  `b` directly — i.e. the two ways actually cross near here, not merely
 *  both happen to pass nearby. */
function waysCrossNear(system: TransitSystem, coord: LngLat, a: string, b: string): boolean {
  const index = nodesByWayId(system.nodes);
  for (const node of index.get(a) ?? []) {
    if (haversineMeters(node.coord, coord) > CROSS_STREET_AT_JUNCTION_M) continue;
    if (node.refs.some((r) => r.wayId === b)) return true;
  }
  return false;
}

interface CorridorHit {
  name: string;
  distM: number;
  /** Which direction along the way's own point order the hit was found —
   *  "ahead" (increasing arc-length) or "behind" (decreasing). This is the
   *  before/after reference frame: intrinsic to the way's own authored point
   *  order, not a compass direction or a service's travel direction (which
   *  usually doesn't exist yet at naming time — see resolveNamingStyle). */
  direction: 'ahead' | 'behind';
}

/** Walks the stop's own corridor in one direction from its projection point,
 *  hopping across further same-named ways at pass-through nodes, until a
 *  genuinely different-named arm or the distance cap is reached. */
function walkOneDirection(
  system: TransitSystem,
  startWayId: string,
  startT: number,
  direction: 'ahead' | 'behind',
  homeNames: Set<string>,
  namedWayIndex: Map<string, NamedWay>,
  waysById: Map<string, Way>,
): CorridorHit | null {
  let wayId = startWayId;
  let t = startT;
  let distM = 0;
  // Same-named arms already left behind, so a loop back to one of them
  // (e.g. two same-named ways meeting again at a later node) can't be
  // re-picked as the "unexplored" continuation and ping-pong forever.
  const visited = new Set<string>();
  const nodeIndex = nodesByWayId(system.nodes);
  for (let hop = 0; hop < MAX_WALK_HOPS; hop++) {
    const way = waysById.get(wayId);
    if (!way) return null;
    const path = resolveWayPath(way);
    const totalM = pathLengthMeters(path);
    if (totalM <= 0) return null;
    const remainingM = direction === 'ahead' ? (1 - t) * totalM : t * totalM;
    if (distM + remainingM > CROSS_STREET_WALK_MAX_M) return null;
    distM += remainingM;
    const endCoord = direction === 'ahead' ? path[path.length - 1] : path[0];
    const endNode = (nodeIndex.get(wayId) ?? []).find((n) =>
      n.refs.some(
        (r) => r.wayId === wayId && haversineMeters(way.points[r.pointIndex], endCoord) < 1,
      ),
    );
    if (!endNode) return null; // open endpoint — the street just ends here
    const others = endNode.refs.filter((r) => r.wayId !== wayId);
    let sameNameContinuation: string | null = null;
    for (const ref of others) {
      const name = nonHomeName(ref.wayId, namedWayIndex, homeNames);
      if (name) return { name, distM, direction };
      const nw = namedWayIndex.get(ref.wayId);
      if (nw && nw.name.trim() !== '' && !visited.has(ref.wayId)) {
        sameNameContinuation = ref.wayId;
      }
    }
    if (!sameNameContinuation) return null;
    visited.add(wayId);
    wayId = sameNameContinuation;
    const nextWay = waysById.get(wayId);
    if (!nextWay) return null;
    // Resume from whichever end of the next way sits at endNode.
    const atStart = haversineMeters(nextWay.points[0], endCoord) < 1;
    t = atStart ? 0 : 1;
    direction = atStart ? 'ahead' : 'behind';
  }
  return null;
}

// Where the cross street was found, relative to home — collapses what were
// separate atJunction/direction params into one, since the two were never
// independent: a junction hit never carries a direction, and a corridor-walk
// hit always does.
type CrossStreetPosition = 'junction' | 'ahead' | 'behind';

function formatName(
  style: StopNamingStyle,
  home: string,
  cross: string | null,
  position: CrossStreetPosition,
): string {
  if (!cross) return home;
  if (style === 'intersection') return `${home} & ${cross}`;
  if (position === 'junction') return `${home} @ ${cross}`;
  return position === 'behind' ? `${home} after ${cross}` : `${home} before ${cross}`;
}

/** Suggests a name for a stop or stop from the real street names already
 *  in the document. Never throws, never guesses past what the data actually
 *  supports — a system with no named streets nearby returns `name: null`,
 *  which the caller leaves alone rather than showing a partial guess. */
export function suggestStopName(query: CrossStreetQuery): SuggestedStopName {
  const { system, coord, anchors } = query;
  const style = resolveNamingStyle(system, coord, anchors);
  const namedWayIndex = namedWayByWayId(system.namedWays);
  const waysById = wayById(system.ways);
  const homeNames = new Set(homeStreetNames(anchors, namedWayIndex));

  if (anchors.length === 0) {
    const nearby = servedWaysByDistance(coord, system.ways, CROSS_STREET_SEARCH_RADIUS_M);
    const named: { wayId: string; name: string }[] = [];
    const seen = new Set<string>();
    for (const { wayId } of nearby) {
      const nw = namedWayIndex.get(wayId);
      if (!nw || nw.name.trim() === '' || seen.has(nw.name)) continue;
      seen.add(nw.name);
      named.push({ wayId, name: nw.name });
    }
    if (named.length === 0) return { style, name: null };
    const [first, ...rest] = named;
    // Only the nearest named way is guaranteed nearby — a second name only
    // becomes a cross street if it actually meets the first one near here,
    // not merely because it's also nearby (two parallel streets a block
    // apart are not an intersection).
    const cross = rest.find((candidate) =>
      waysCrossNear(system, coord, first.wayId, candidate.wayId),
    );
    if (!cross) return { style, name: first.name };
    return { style, name: formatName(style, first.name, cross.name, 'junction') };
  }

  if (homeNames.size === 0) return { style, name: null };
  const home = [...homeNames][0];
  const homeWayIds = new Set(anchors.map((a) => a.wayId));

  const atNode = crossStreetsAtNode(system, coord, homeWayIds, homeNames, namedWayIndex, waysById);
  if (atNode) return { style, name: formatName(style, home, atNode.crossNames[0], 'junction') };

  const anchor = anchors[0];
  const way = waysById.get(anchor.wayId);
  if (!way) return { style, name: home };
  const ahead = walkOneDirection(
    system,
    anchor.wayId,
    anchor.t,
    'ahead',
    homeNames,
    namedWayIndex,
    waysById,
  );
  const behind = walkOneDirection(
    system,
    anchor.wayId,
    anchor.t,
    'behind',
    homeNames,
    namedWayIndex,
    waysById,
  );
  const winner = ahead && (!behind || ahead.distM <= behind.distM) ? ahead : (behind ?? null);
  if (!winner) return { style, name: home };
  return { style, name: formatName(style, home, winner.name, winner.direction) };
}

/** Whether `stop` could plausibly be affected by a change touching
 *  `affectedWayIds` — anchored to one of them, or within the same search
 *  radius suggestStopName itself uses to find a free-floating stop's
 *  nearest streets. A stop anywhere else in the document can't have its
 *  suggested name change as a result of that specific change. */
function mayBeAffectedBy(
  system: TransitSystem,
  stop: Pick<Stop, 'coord' | 'anchors'>,
  affectedWayIds: Set<string>,
): boolean {
  if (stop.anchors.some((a) => affectedWayIds.has(a.wayId))) return true;
  const nearby = servedWaysByDistance(stop.coord, system.ways, CROSS_STREET_SEARCH_RADIUS_M);
  return nearby.some((n) => affectedWayIds.has(n.wayId));
}

/**
 * Re-suggests every still-`autoNamed` stop's name against the current
 * document. A name is only ever computed automatically at two moments: when
 * a stop is first placed, and here — called after an action that could
 * newly serve a previously-unserved stop (drawing a service through it,
 * attaching a return path), the case resolveNamingStyle's own fallback
 * can't get right in advance, since it has to guess a style before any
 * service exists.
 *
 * `affectedWayIds`, when given, narrows the pass to stops that could
 * plausibly be affected by whatever just changed (see mayBeAffectedBy) —
 * the normal case, since a new service or return path only ever changes
 * what serves the ways it actually rides. Omit it for a full document
 * rescan; nothing in this module needs one today, but it keeps the
 * function honest about what it does when given no scope to narrow by.
 *
 * A user's own typed text is never touched: `autoNamed` clears the moment
 * anyone sets a stop's name directly, and only stops where it's still
 * set are eligible here. Returns `system` unchanged (same reference) when
 * nothing needed updating, so callers can cheaply skip a store update.
 */
export function resyncAutoNamedStops(
  system: TransitSystem,
  affectedWayIds?: Set<string>,
): TransitSystem {
  let changed = false;
  const stops = system.stops.map((st) => {
    if (!st.autoNamed) return st;
    if (affectedWayIds && !mayBeAffectedBy(system, st, affectedWayIds)) return st;
    const suggested = suggestStopName({ system, coord: st.coord, anchors: st.anchors });
    if (!suggested.name || suggested.name === st.name) return st;
    changed = true;
    return { ...st, name: suggested.name };
  });
  return changed ? { ...system, stops } : system;
}
