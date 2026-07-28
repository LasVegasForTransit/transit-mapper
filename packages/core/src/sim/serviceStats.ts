// What a line amounts to: how long a round trip takes, and therefore how many
// vehicles it takes to run at a given headway.
//
// This is the middle of the model, and until now it was computed on every
// animation frame and thrown away — the editor showed the inputs (a headway,
// a stop, a dwell time) and the outputs (dots moving), with the chain between
// them invisible. Add a station and the fleet silently grew; assign a faster
// vehicle and it silently shrank.
//
// The animation and the inspector both resolve through here, so the number a
// planner reads and the number the map runs cannot drift apart.
//
// Pure, like the rest of packages/core/src/sim.

import { cumulativeLengths, nearestOnPath, patternCoversWayAt, patternPath } from '../model/geo';
import type { LngLat, Pattern, Service, Station, VehicleKind, Way } from '../model/system';
import { vehicleFootprint } from '../model/catalog';
import { planService, type ServicePlan } from './fleet';
import { buildTimetable, VEHICLE_SPEED_MPS, type DwellStop, type Timetable } from './timetable';

/** Doors open, board/alight, doors close — a plausible light-rail/bus dwell
 *  when a station doesn't specify its own (Station.dwellSeconds). */
export const DEFAULT_DWELL_SECONDS = 20;

export interface ResolvedVehicle {
  widthM: number;
  lengthM: number;
  speedMps: number;
}

/** Which real vehicle a service runs: its assigned VehicleKind if it has one
 *  and that kind still exists, else the mode's plain default at the app's
 *  ambient default speed — the exact behavior every service had before vehicle
 *  kinds existed, so an unassigned service is never affected by the feature. */
export function effectiveVehicleKind(
  vehicleKinds: VehicleKind[],
  service: Service,
): ResolvedVehicle {
  const kind = service.vehicleKindId
    ? vehicleKinds.find((k) => k.id === service.vehicleKindId)
    : undefined;
  if (kind) {
    return {
      widthM: kind.widthM,
      lengthM: kind.lengthM,
      speedMps: kind.topSpeedKmh !== undefined ? kind.topSpeedKmh / 3.6 : VEHICLE_SPEED_MPS,
    };
  }
  return { ...vehicleFootprint(service.modeId), speedMps: VEHICLE_SPEED_MPS };
}

// Stations grouped by their anchor way id, cached by the stations array's own
// reference — safe because the store replaces `system.stations` immutably on
// every mutation (same convention as geo.ts's wayPathCache), so a stale index
// is simply never looked up again. Without this, dwellStopsForPattern did a
// full linear scan of every station in the system for every pattern on every
// animation frame — fine for a few dozen hand-drawn stations, but for a real
// GTFS import (thousands of stations, hundreds of patterns) that's hundreds of
// thousands of comparisons *per frame*, continuously, for as long as the tab
// stays open — confirmed live against RTC Southern Nevada's real feed as a
// sustained freeze, not just a one-time slow render.
const stationsByWayCache = new WeakMap<Station[], Map<string, Station[]>>();

function stationsByWay(stations: Station[]): Map<string, Station[]> {
  let index = stationsByWayCache.get(stations);
  if (index) return index;
  index = new Map();
  for (const st of stations) {
    if (!st.anchor) continue;
    const arr = index.get(st.anchor.wayId);
    if (arr) arr.push(st);
    else index.set(st.anchor.wayId, [st]);
  }
  stationsByWayCache.set(stations, index);
  return index;
}

/** Every station actually anchored to one of this pattern's ways (the same
 *  "is this a stop on this branch" test the Route tab's stop-sequence list
 *  uses), positioned by arc-length along the pattern's full resolved path
 *  (via nearestOnPath) rather than by way-index — the more useful measure
 *  here, since a vehicle walks the path by distance, not by way.
 *
 *  Riding a way is not the same as reaching every point on it: a station past
 *  where the line terminates would otherwise project onto the nearest end of
 *  the trimmed path and stack a phantom dwell on the terminus. The extent test
 *  needs no geometry — `anchor.t` and a leg's range are both way-relative — so
 *  the caller's already-resolved `path` stays the only projection here. */
export function dwellStopsForPattern(
  stations: Station[],
  pattern: Pattern,
  path: LngLat[],
  totalMeters: number,
): DwellStop[] {
  const byWay = stationsByWay(stations);
  const stops: DwellStop[] = [];
  for (const { wayId } of pattern.legs) {
    for (const st of byWay.get(wayId) ?? []) {
      if (st.anchor && !patternCoversWayAt(pattern, wayId, st.anchor.t)) continue;
      const near = nearestOnPath(path, st.coord);
      if (!near) continue;
      stops.push({
        distMeters: near.t * totalMeters,
        dwellMs: (st.dwellSeconds ?? DEFAULT_DWELL_SECONDS) * 1000,
      });
    }
  }
  return stops.sort((a, b) => a.distMeters - b.distMeters);
}

export interface PatternStats {
  pattern: Pattern;
  /** One-way path length. */
  meters: number;
  /** Stops served on this pattern's own ways. */
  stopCount: number;
  /** Total time standing still at those stops, one way. */
  dwellMs: number;
  /** One way, travel plus dwell. */
  oneWayMs: number;
  /** Out and back. What fleet size is computed against. */
  roundTripMs: number;
  timetable: Timetable;
  /** Null when this pattern has no usable path (fewer than two points, or
   *  zero length) — nothing runs on it and nothing should be claimed about it. */
  plan: ServicePlan | null;
}

/**
 * Measure one pattern and, given a headway, size its fleet.
 *
 * `headwayMinutes` undefined means the service has no frequency set, which
 * plans a single vehicle — see planService.
 */
export function patternStats(
  ways: Way[],
  stations: Station[],
  pattern: Pattern,
  speedMps: number,
  headwayMinutes?: number,
): PatternStats | null {
  const path = patternPath(ways, pattern);
  if (path.length < 2) return null;
  const lengths = cumulativeLengths(path);
  const meters = lengths[lengths.length - 1];
  if (meters === 0) return null;
  const stops = dwellStopsForPattern(stations, pattern, path, meters);
  const timetable = buildTimetable(meters, stops, speedMps);
  const roundTripMs = 2 * timetable.oneWayMs;
  return {
    pattern,
    meters,
    stopCount: stops.length,
    dwellMs: stops.reduce((sum, s) => sum + s.dwellMs, 0),
    oneWayMs: timetable.oneWayMs,
    roundTripMs,
    timetable,
    plan: planService(
      roundTripMs,
      headwayMinutes === undefined ? undefined : headwayMinutes * 60_000,
    ),
  };
}

export interface ServiceStats {
  patterns: PatternStats[];
  /** Vehicles across every pattern — a branch runs its own, so a two-branch
   *  service needs both fleets at once. */
  fleet: number;
  /** The longest round trip among this service's patterns; what someone means
   *  by "how long does this line take end to end". */
  longestRoundTripMs: number;
  /** Recovery time at each terminal on the pattern that sets the round trip. */
  layoverMs: number;
}

/**
 * Measure a whole service. Returns null when nothing about it can be measured
 * yet (a line drawn over ways that resolve to no path).
 */
export function serviceStats(
  ways: Way[],
  stations: Station[],
  vehicleKinds: VehicleKind[],
  service: Service,
  headwayMinutes?: number,
): ServiceStats | null {
  const { speedMps } = effectiveVehicleKind(vehicleKinds, service);
  const patterns = service.patterns
    .map((pattern) => patternStats(ways, stations, pattern, speedMps, headwayMinutes))
    .filter((stats): stats is PatternStats => stats !== null);
  if (patterns.length === 0) return null;
  const longest = patterns.reduce((a, b) => (b.roundTripMs > a.roundTripMs ? b : a));
  return {
    patterns,
    fleet: patterns.reduce((sum, p) => sum + (p.plan?.fleet ?? 0), 0),
    longestRoundTripMs: longest.roundTripMs,
    layoverMs: longest.plan?.layoverMs ?? 0,
  };
}
