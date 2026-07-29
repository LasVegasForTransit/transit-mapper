import { INTERCHANGE_METERS, serviceWayIds, servedWayIds } from '../model/geo';
import type { Service, Station, Way } from '../model/system';

// Memoized sub-computations of buildFeatures, each keyed on the IDENTITY of the
// immutable arrays/sets it derives from. The store replaces system.ways/
// stations/services with a fresh array on every mutation, and the view replaces
// visibleWayTypes/visibleModes on every toggle, so a stale entry is simply never
// looked up again and falls out of the WeakMap (same convention as geo's caches
// and sim/vehicles.ts).
//
// This is what makes a SELECTION-only or (residual) viewport-only rebuild cheap:
// none of these inputs changed on such a rebuild, so the expensive per-station
// interchange scan (servedWayIds × ~3787 at RTC scale) and the derived
// service-by-way / visible-way sets are reused instead of recomputed. It also
// keeps the 121k-segment spatial grid warm: servedWayIds caches that grid on the
// `visibleWays` array reference, which was a guaranteed miss when buildFeatures
// re-`filter`ed a fresh array every call — now the array is memoized, so the grid
// is built once per genuine ways/filter change, not once per rebuild.

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
const nearWaysByStationCache = new WeakMap<Way[], WeakMap<Station, string[]>>();

/** For each station (aligned to `stations` order), the ids of visible ways whose
 *  path passes within INTERCHANGE_METERS — the interchange-detection scan. This
 *  is the single most expensive part of buildFeatures at RTC scale. The exact
 *  array pair remains the fast path for selection-only rebuilds; when an
 *  immutable edit replaces `stations`, unchanged station objects retain their
 *  individual results. A new `visibleWays` array gets a separate per-station
 *  cache, so any ways or visibility change safely recomputes every result. */
export function nearWaysForStations(stations: Station[], visibleWays: Way[]): string[][] {
  let byWays = nearWaysCache.get(stations);
  if (!byWays) {
    byWays = new WeakMap();
    nearWaysCache.set(stations, byWays);
  }
  let result = byWays.get(visibleWays);
  if (!result) {
    let byStation = nearWaysByStationCache.get(visibleWays);
    if (!byStation) {
      byStation = new WeakMap();
      nearWaysByStationCache.set(visibleWays, byStation);
    }
    result = stations.map((station) => {
      let nearWays = byStation.get(station);
      if (!nearWays) {
        nearWays = servedWayIds(station.coord, visibleWays, INTERCHANGE_METERS);
        byStation.set(station, nearWays);
      }
      return nearWays;
    });
    byWays.set(visibleWays, result);
  }
  return result;
}
