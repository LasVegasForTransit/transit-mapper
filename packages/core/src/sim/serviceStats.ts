// What a line amounts to: how long a round trip takes, and therefore how many
// vehicles it takes to run at a given headway.
//
// This is the middle of the model, and until now it was computed on every
// animation frame and thrown away — the editor showed the inputs (a headway,
// a stop, a dwell time) and the outputs (dots moving), with the chain between
// them invisible. Add a station and the fleet silently grew; assign a faster
// vehicle and it silently shrank.
//
// THE RULE: time and distance are measured on the route's centerline; geometry
// comes from the view. patternStats is the only place a Timetable is built, and
// both the inspector and the animation call it — so the number a planner reads
// and the number the map runs are the same number, not two that agree. The
// animation used to build its own off the LANE path while this measured the
// centerline, under a comment in each file claiming they could not drift.
// Infrastructure view still draws vehicles on real lanes; it places them by
// FRACTION along a leg rather than re-measuring one, which is also what keeps
// widening a road from changing a line's round trip.
//
// Pure, like the rest of packages/core/src/sim.

import {
  cumulativeLengths,
  nearestOnPath,
  patternCoversWayAt,
  patternPath,
  patternLegs,
} from '../model/geo';
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

/** A station this pattern calls at, and how far into the run it is reached. */
export interface PatternStop {
  station: Station;
  distMeters: number;
  dwellMs: number;
}

/**
 * Every station this pattern calls at, in the order a rider reaches them.
 *
 * The single derivation of a line's stop list: the Service inspector's
 * "calls at" sequence and the dwells the simulation holds for are the same
 * answer. They used to be two, and disagreed about extents — the inspector
 * filtered on way id alone, so a station past where a line terminates stayed
 * in the panel's list while the vehicle correctly drove past it.
 *
 * Ordered by arc-length along the pattern's resolved path rather than by
 * `anchor.t`, which is way-relative: on a way the line travels backwards, t
 * descends as the ride progresses.
 *
 * Riding a way is not the same as reaching every point on it, hence the
 * extent test — without it a station beyond the terminus projects onto the
 * nearest end of the trimmed path and stacks a phantom dwell there. That test
 * needs no geometry (`anchor.t` and a leg's range are both way-relative), so
 * the caller's already-resolved `path` stays the only projection here.
 */
export function patternStops(
  stations: Station[],
  pattern: Pattern,
  path: LngLat[],
  totalMeters: number,
): PatternStop[] {
  const byWay = stationsByWay(stations);
  const stops: PatternStop[] = [];
  for (const { wayId } of patternLegs(pattern)) {
    for (const st of byWay.get(wayId) ?? []) {
      if (st.anchor && !patternCoversWayAt(pattern, wayId, st.anchor.t)) continue;
      const near = nearestOnPath(path, st.coord);
      if (!near) continue;
      stops.push({
        station: st,
        distMeters: near.t * totalMeters,
        dwellMs: (st.dwellSeconds ?? DEFAULT_DWELL_SECONDS) * 1000,
      });
    }
  }
  return stops.sort((a, b) => a.distMeters - b.distMeters);
}

/** `patternStops` reduced to what the motion kernel needs. */
export function dwellStopsForPattern(
  stations: Station[],
  pattern: Pattern,
  path: LngLat[],
  totalMeters: number,
): DwellStop[] {
  return patternStops(stations, pattern, path, totalMeters).map(({ distMeters, dwellMs }) => ({
    distMeters,
    dwellMs,
  }));
}

export interface PatternStats {
  pattern: Pattern;
  /** The centerline path this was measured on, and the one every caller places
   *  positions along by fraction. */
  path: LngLat[];
  /** Prefix-sum arc lengths for `path`, so a caller resolving a position every
   *  frame does not re-walk it. */
  cumLengths: Float64Array;
  /** One-way path length. */
  meters: number;
  /** The stations this pattern calls at, in the order a rider reaches them. */
  stops: PatternStop[];
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
  const cumLengths = cumulativeLengths(path);
  const meters = cumLengths[cumLengths.length - 1];
  if (meters === 0) return null;
  const stops = patternStops(stations, pattern, path, meters);
  const timetable = buildTimetable(
    meters,
    stops.map(({ distMeters, dwellMs }) => ({ distMeters, dwellMs })),
    speedMps,
  );
  const roundTripMs = 2 * timetable.oneWayMs;
  return {
    pattern,
    path,
    cumLengths,
    meters,
    stops,
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
