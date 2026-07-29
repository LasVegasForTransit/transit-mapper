import {
  INTERCHANGE_METERS,
  serviceWayIds,
  servedWaysByDistance,
  type ServedWayDistance,
} from '../model/geo';
import type { Service, Station, Way } from '../model/system';

// Memoized sub-computations of buildFeatures, keyed on the IDENTITY of the
// immutable arrays/sets they derive from. Station proximity also follows
// retained immutable Way objects from one visible-way array to the next, so a
// one-way edit can reuse the rest of the prior result without treating equal
// ids as proof that a mutable object is unchanged.
//
// This is what makes a SELECTION-only or (residual) viewport-only rebuild cheap:
// none of these inputs changed on such a rebuild, so the expensive per-station
// interchange scan (servedWaysByDistance × ~3787 at RTC scale) and the derived
// service-by-way / visible-way sets are reused instead of recomputed. It also
// keeps the 121k-segment spatial grid warm for a full query; incremental queries
// build only the changed-way grid.

const visibleWaysCache = new WeakMap<Way[], WeakMap<Set<string>, Way[]>>();

/** `ways` filtered to the currently-visible way types — a stable reference
 *  while `ways` and `visibleWayTypes` are unchanged (so downstream caches keyed
 *  on it, notably servedWayIds' segment grid, stay warm). */
export function visibleWaysFor(ways: Way[], visibleWayTypes: Set<string>): Way[] {
  let byTypes = visibleWaysCache.get(ways);
  if (!byTypes) {
    byTypes = new WeakMap();
    visibleWaysCache.set(ways, byTypes);
  }
  let result = byTypes.get(visibleWayTypes);
  if (!result) {
    result = ways.filter((w) => visibleWayTypes.has(w.typeId));
    byTypes.set(visibleWayTypes, result);
  }
  return result;
}

const byWayCache = new WeakMap<Service[], WeakMap<Set<string>, Map<string, Service[]>>>();

/** Visible-mode services riding each way id, in stable (creation) order and
 *  deduplicated across a service's own patterns (a trunk shared by two branches
 *  still counts the service once). Cached on (services, visibleModes). */
export function servicesByWay(
  services: Service[],
  visibleModes: Set<string>,
): Map<string, Service[]> {
  let byModes = byWayCache.get(services);
  if (!byModes) {
    byModes = new WeakMap();
    byWayCache.set(services, byModes);
  }
  let result = byModes.get(visibleModes);
  if (!result) {
    result = new Map<string, Service[]>();
    for (const svc of services) {
      if (!visibleModes.has(svc.modeId)) continue;
      for (const wid of serviceWayIds(svc)) {
        const arr = result.get(wid);
        if (arr) arr.push(svc);
        else result.set(wid, [svc]);
      }
    }
    byModes.set(visibleModes, result);
  }
  return result;
}

const nearWaysCache = new WeakMap<Station[], WeakMap<Way[], string[][]>>();

interface StationProximity {
  ids: string[];
  ranked: ServedWayDistance[];
}

interface IncrementalWays {
  priorByStation: WeakMap<Station, StationProximity>;
  changedIds: Set<string>;
  changedWays: Way[];
}

interface NearWaysState {
  visibleWays: Way[];
  waysById: Map<string, Way> | null;
  byStation: WeakMap<Station, StationProximity>;
  incremental?: IncrementalWays;
}

const nearWaysStateCache = new WeakMap<Way[], NearWaysState>();
let latestState: NearWaysState | undefined;

function uniqueWaysById(ways: Way[]): Map<string, Way> | null {
  const byId = new Map<string, Way>();
  for (const way of ways) {
    if (byId.has(way.id)) return null;
    byId.set(way.id, way);
  }
  return byId;
}

function incrementalSourceFor(visibleWays: Way[]): NearWaysState | null {
  const state = latestState;
  if (!state?.waysById) return null;
  for (const way of visibleWays) {
    if (state.waysById.get(way.id) === way) return state;
  }
  return null;
}

function stateFor(visibleWays: Way[]): NearWaysState {
  const cached = nearWaysStateCache.get(visibleWays);
  if (cached) return cached;

  const waysById = uniqueWaysById(visibleWays);
  // A duplicate id makes "changed versus retained" ambiguous. It is invalid
  // system data, but the full query still has deterministic behavior, so use
  // that safe path rather than trying to infer a delta.
  const source = waysById ? incrementalSourceFor(visibleWays) : null;
  let incremental: IncrementalWays | undefined;
  if (waysById && source?.waysById) {
    const changedIds = new Set<string>();
    const changedWays: Way[] = [];
    for (const [id, previous] of source.waysById) {
      if (waysById.get(id) !== previous) changedIds.add(id);
    }
    for (const way of visibleWays) {
      if (source.waysById.get(way.id) !== way) {
        changedIds.add(way.id);
        changedWays.push(way);
      }
    }
    incremental = {
      priorByStation: source.byStation,
      changedIds,
      // One stable array is shared by every station query, so the changed-way
      // segment grid is built once rather than once per station.
      changedWays,
    };
  }

  const state: NearWaysState = {
    visibleWays,
    waysById,
    byStation: new WeakMap(),
    ...(incremental ? { incremental } : {}),
  };
  nearWaysStateCache.set(visibleWays, state);
  if (waysById) latestState = state;
  return state;
}

function sameIds(left: string[], right: ServedWayDistance[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]?.wayId);
}

function proximityFor(state: NearWaysState, station: Station): StationProximity {
  const cached = state.byStation.get(station);
  if (cached) return cached;

  const incremental = state.incremental;
  const prior = incremental?.priorByStation.get(station);
  let proximity: StationProximity;
  if (prior && incremental) {
    const retained = prior.ranked.filter(({ wayId }) => !incremental.changedIds.has(wayId));
    const changed = servedWaysByDistance(
      station.coord,
      incremental.changedWays,
      INTERCHANGE_METERS,
    );
    const ranked = retained.concat(changed);
    ranked.sort(
      (left, right) =>
        left.distMeters - right.distMeters ||
        (left.wayId < right.wayId ? -1 : left.wayId > right.wayId ? 1 : 0),
    );
    proximity = {
      // Preserve the observable result reference when a delta does not change
      // membership or order. Keep the freshly-ranked distances internally:
      // a moved way can retain the same ids while changing where a later
      // addition belongs.
      ids: sameIds(prior.ids, ranked) ? prior.ids : ranked.map(({ wayId }) => wayId),
      ranked,
    };
  } else {
    const ranked = servedWaysByDistance(station.coord, state.visibleWays, INTERCHANGE_METERS);
    proximity = { ids: ranked.map(({ wayId }) => wayId), ranked };
  }

  state.byStation.set(station, proximity);
  return proximity;
}

/** For each station (aligned to `stations` order), the ids of visible ways whose
 *  path passes within INTERCHANGE_METERS — the interchange-detection scan. This
 *  is the single most expensive part of buildFeatures at RTC scale. The exact
 *  array pair remains the fast path for selection-only rebuilds; when an
 *  immutable edit replaces `stations`, unchanged station objects retain their
 *  individual results. When a new visible-way array retains most immutable Way
 *  objects, only changed/new ways are spatially queried: removed/replaced ids
 *  are dropped from each prior station result, then the two exact distance-
 *  ranked lists are merged. Unrelated arrays and ambiguous duplicate ids take
 *  the full-query path. */
export function nearWaysForStations(stations: Station[], visibleWays: Way[]): string[][] {
  let byWays = nearWaysCache.get(stations);
  if (!byWays) {
    byWays = new WeakMap();
    nearWaysCache.set(stations, byWays);
  }
  let result = byWays.get(visibleWays);
  if (!result) {
    const state = stateFor(visibleWays);
    result = stations.map((station) => proximityFor(state, station).ids);
    byWays.set(visibleWays, result);
  }
  return result;
}
