// Auto-naming a newly placed stop from the real street names already in the
// document — "14th St & Broadway" for a rail-style stop at an intersection,
// "Main St @ 5th Ave" / "Main St before 5th Ave" for a bus-style stop along
// a block. Computed entirely from existing street geometry (NamedWay +
// Node), never from landmark/POI data — none exists in this model yet.
import { mode, type StopNamingStyle } from '../catalog';
import { laneCapacity } from '../profile';
import { servicesAtStation } from '../../sim/frequency';
import type { LngLat, NamedWay, StationAnchor, TransitSystem, Way } from '../system';
import { pathLengthMeters } from './measurement';
import { resolveWayPath } from './wayPath';
import { servedWaysByDistance } from './snapIndex';

export type { StopNamingStyle };

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
   *  as-is (the "Unnamed station" placeholder keeps showing). */
  name: string | null;
}

export interface CrossStreetQuery {
  system: TransitSystem;
  coord: LngLat;
  anchors: StationAnchor[];
}

function namedWayByWayId(namedWays: NamedWay[]): Map<string, NamedWay> {
  const index = new Map<string, NamedWay>();
  for (const nw of namedWays) for (const wayId of nw.wayIds) index.set(wayId, nw);
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
  anchors: StationAnchor[],
): StopNamingStyle {
  const services = servicesAtStation(system.ways, system.services, {
    id: '',
    coord,
    anchors,
  });
  if (services.length > 0) {
    const styles = new Set(
      services.map((sv) => mode(sv.modeId).stopNamingStyleId ?? 'intersection'),
    );
    return styles.has('intersection') ? 'intersection' : 'alongStreet';
  }
  if (anchors.length === 0) return 'intersection';
  const waysById = new Map(system.ways.map((w) => [w.id, w]));
  const anchoredWays = anchors
    .map((a) => waysById.get(a.wayId))
    .filter((w): w is Way => w !== undefined);
  if (anchoredWays.length > 0 && anchoredWays.every((w) => w.typeId === 'road')) {
    return 'alongStreet';
  }
  return 'intersection';
}

/** Distinct NamedWay names carried by the stop's own anchored way(s). */
function homeStreetNames(anchors: StationAnchor[], namedWayIndex: Map<string, NamedWay>): string[] {
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
  let best: { node: (typeof system.nodes)[number]; distM: number } | null = null;
  for (const node of system.nodes) {
    if (!node.refs.some((r) => homeWayIds.has(r.wayId))) continue;
    const distM = haversineApproxM(node.coord, coord);
    if (distM > CROSS_STREET_AT_JUNCTION_M) continue;
    if (!best || distM < best.distM) best = { node, distM };
  }
  if (!best) return null;
  const candidates = new Map<string, NamedWay>(); // name -> representative NamedWay
  for (const ref of best.node.refs) {
    if (homeWayIds.has(ref.wayId)) continue;
    const nw = namedWayIndex.get(ref.wayId);
    if (!nw || nw.name.trim() === '' || homeNames.has(nw.name)) continue;
    candidates.set(nw.name, nw);
  }
  if (candidates.size === 0) return null;
  const ranked = [...candidates.values()].sort((a, b) => {
    const diff = namedWayImportance(b, waysById) - namedWayImportance(a, waysById);
    return diff !== 0 ? diff : a.name.localeCompare(b.name);
  });
  return { crossNames: ranked.map((nw) => nw.name) };
}

// A plain equirectangular approximation is plenty accurate at the block
// scale this function operates at, and avoids pulling in the full
// great-circle helper for a threshold comparison.
function haversineApproxM(a: LngLat, b: LngLat): number {
  const latRad = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dLng = (b[0] - a[0]) * Math.cos(latRad) * 111_320;
  const dLat = (b[1] - a[1]) * 111_320;
  return Math.hypot(dLng, dLat);
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
  const visited = new Set<string>();
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
    const endNode = system.nodes.find((n) =>
      n.refs.some(
        (r) => r.wayId === wayId && haversineApproxM(way.points[r.pointIndex], endCoord) < 1,
      ),
    );
    if (!endNode) return null; // open endpoint — the street just ends here
    const others = endNode.refs.filter((r) => r.wayId !== wayId);
    let sameNameContinuation: string | null = null;
    for (const ref of others) {
      const nw = namedWayIndex.get(ref.wayId);
      if (!nw || nw.name.trim() === '') continue;
      if (homeNames.has(nw.name)) {
        if (!visited.has(ref.wayId)) sameNameContinuation = ref.wayId;
        continue;
      }
      return { name: nw.name, distM, direction };
    }
    if (!sameNameContinuation) return null;
    visited.add(wayId);
    wayId = sameNameContinuation;
    const nextWay = waysById.get(wayId);
    if (!nextWay) return null;
    // Resume from whichever end of the next way sits at endNode.
    const atStart = haversineApproxM(nextWay.points[0], endCoord) < 1;
    t = atStart ? 0 : 1;
    direction = atStart ? 'ahead' : 'behind';
  }
  return null;
}

function formatName(
  style: StopNamingStyle,
  home: string,
  cross: string | null,
  atJunction: boolean,
  direction: 'ahead' | 'behind' | null,
): string {
  if (!cross) return home;
  if (style === 'intersection') return `${home} & ${cross}`;
  if (atJunction) return `${home} @ ${cross}`;
  return direction === 'behind' ? `${home} after ${cross}` : `${home} before ${cross}`;
}

/** Suggests a name for a station or stop from the real street names already
 *  in the document. Never throws, never guesses past what the data actually
 *  supports — a system with no named streets nearby returns `name: null`,
 *  which the caller leaves alone rather than showing a partial guess. */
export function suggestStopName(query: CrossStreetQuery): SuggestedStopName {
  const { system, coord, anchors } = query;
  const style = resolveNamingStyle(system, coord, anchors);
  const namedWayIndex = namedWayByWayId(system.namedWays);
  const waysById = new Map(system.ways.map((w) => [w.id, w]));
  const homeNames = new Set(homeStreetNames(anchors, namedWayIndex));

  if (anchors.length === 0) {
    const nearby = servedWaysByDistance(coord, system.ways, CROSS_STREET_SEARCH_RADIUS_M);
    const names: string[] = [];
    const seen = new Set<string>();
    for (const { wayId } of nearby) {
      const nw = namedWayIndex.get(wayId);
      if (!nw || nw.name.trim() === '' || seen.has(nw.name)) continue;
      seen.add(nw.name);
      names.push(nw.name);
      if (names.length === 2) break;
    }
    if (names.length === 0) return { style, name: null };
    if (names.length === 1) return { style, name: names[0] };
    return { style, name: formatName(style, names[0], names[1], true, null) };
  }

  if (homeNames.size === 0) return { style, name: null };
  const home = [...homeNames][0];
  const homeWayIds = new Set(anchors.map((a) => a.wayId));

  const atNode = crossStreetsAtNode(system, coord, homeWayIds, homeNames, namedWayIndex, waysById);
  if (atNode) return { style, name: formatName(style, home, atNode.crossNames[0], true, null) };

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
  return { style, name: formatName(style, home, winner.name, false, winner.direction) };
}
