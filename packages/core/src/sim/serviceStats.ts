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
  patternRunLegs,
  patternRunPath,
  anchorOnWayId,
} from '../model/geo';
import { servicePattern } from '../model/line-service';
import type {
  LngLat,
  Pattern,
  RunDirection,
  Service,
  Station,
  VehicleKind,
  Way,
} from '../model/system';
import { vehicleFootprint } from '../model/catalog';
import { planService, type ServicePlan } from './fleet';
import {
  buildTimetable,
  DEFAULT_MOTION_PROFILE,
  roundTripMs,
  type DwellStop,
  type RunTimetables,
  type VehicleMotionProfile,
} from './timetable';

/** Doors open, board/alight, doors close — a plausible light-rail/bus dwell
 *  when a station doesn't specify its own (Station.dwellSeconds). */
export const DEFAULT_DWELL_SECONDS = 20;

export interface ResolvedVehicle {
  widthM: number;
  lengthM: number;
  profile: VehicleMotionProfile;
}

/** Which real vehicle a service runs: its assigned VehicleKind if it has one
 *  and that kind still exists, else the mode's plain default at the app's
 *  ambient default motion profile — the exact behavior every service had
 *  before vehicle kinds existed, so an unassigned service is never affected
 *  by the feature. Each of a kind's motion fields (top speed, acceleration,
 *  deceleration) falls back independently — a kind can pin one and leave the
 *  others at the plausible default. */
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
      profile: {
        speedMps:
          kind.topSpeedKmh !== undefined ? kind.topSpeedKmh / 3.6 : DEFAULT_MOTION_PROFILE.speedMps,
        accelMps2: kind.accelMps2 ?? DEFAULT_MOTION_PROFILE.accelMps2,
        decelMps2: kind.decelMps2 ?? DEFAULT_MOTION_PROFILE.decelMps2,
      },
    };
  }
  return { ...vehicleFootprint(service.modeId), profile: DEFAULT_MOTION_PROFILE };
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
    // Indexed under EVERY way it rides. A platform shared between two ways is
    // a stop on the lines using either — which is what the proximity rule
    // below used to approximate, and now does not have to.
    for (const anchor of st.anchors) {
      const arr = index.get(anchor.wayId);
      if (arr) arr.push(st);
      else index.set(anchor.wayId, [st]);
    }
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
  run: RunDirection = 'outbound',
): PatternStop[] {
  const byWay = stationsByWay(stations);
  const stops: PatternStop[] = [];
  // Only the ways THIS direction rides. A couplet's outward street and return
  // street are different ways, so asking the flat leg list would offer every
  // station on both to be projected onto whichever path is in hand — and a
  // station a block east would land on the outward line at whatever point sits
  // nearest it.
  const ridden = new Set(patternRunLegs(pattern, run).map((r) => r.leg.wayId));
  const called = new Set<string>();
  // Stops this direction passes without calling. Only ever set for a stop on
  // a stretch both directions ride — see Pattern.skippedStops.
  const skipped = new Set(pattern.skippedStops?.[run] ?? []);
  for (const wayId of ridden) {
    for (const st of byWay.get(wayId) ?? []) {
      if (skipped.has(st.id)) continue;
      const onThisWay = anchorOnWayId(st, wayId);
      if (onThisWay && !patternCoversWayAt(pattern, wayId, onThisWay.t)) continue;
      const near = nearestOnPath(path, st.coord);
      if (!near) continue;
      called.add(st.id);
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
  run: RunDirection = 'outbound',
): DwellStop[] {
  return patternStops(stations, pattern, path, totalMeters, run).map(({ distMeters, dwellMs }) => ({
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
  /** OUTBOUND path length — what "how long is this line" has always meant.
   *  A couplet whose return is longer under-reports here, which is the right
   *  trade against a number that describes neither direction. */
  meters: number;
  /** The stations this pattern calls at outbound, in the order a rider reaches
   *  them. See `inboundStops` for the return trip, which on a couplet is a
   *  different set at different distances. */
  stops: PatternStop[];
  inboundStops: PatternStop[];
  /** Total time standing still at those stops, one way. */
  dwellMs: number;
  /** One way, travel plus dwell. */
  oneWayMs: number;
  /** Outward plus return — NOT twice either. Identical to the old `2 ×` for a
   *  line that comes back the way it went, so no existing system's fleet or
   *  layover moves by a millisecond. */
  roundTripMs: number;
  /** The return trip's own geometry. Equal to `path` reversed for a plain
   *  line; a different street for a couplet. */
  inboundPath: LngLat[];
  timetables: RunTimetables;
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
  profile: VehicleMotionProfile,
  headwayMinutes?: number,
): PatternStats | null {
  const path = patternRunPath(ways, pattern, 'outbound');
  if (path.length < 2) return null;
  const cumLengths = cumulativeLengths(path);
  const meters = cumLengths[cumLengths.length - 1];
  if (meters === 0) return null;
  const stops = patternStops(stations, pattern, path, meters, 'outbound');
  const outbound = buildTimetable(
    meters,
    stops.map(({ distMeters, dwellMs }) => ({ distMeters, dwellMs })),
    profile,
  );

  const inboundPath = patternRunPath(ways, pattern, 'inbound');
  const inboundCum = cumulativeLengths(inboundPath);
  const inboundMeters = inboundPath.length >= 2 ? inboundCum[inboundCum.length - 1] : 0;
  const inboundStops =
    inboundMeters > 0 ? patternStops(stations, pattern, inboundPath, inboundMeters, 'inbound') : [];
  // A line that goes out and never comes back is a real thing to have drawn
  // (validate.ts reports it), so measure the return as zero rather than
  // refusing to measure the line at all.
  const inbound = buildTimetable(
    inboundMeters,
    inboundStops.map(({ distMeters, dwellMs }) => ({ distMeters, dwellMs })),
    profile,
  );

  const timetables = { outbound, inbound };
  const cycle = roundTripMs(timetables);
  return {
    pattern,
    path,
    cumLengths,
    meters,
    stops,
    inboundStops,
    dwellMs: stops.reduce((sum, s) => sum + s.dwellMs, 0),
    oneWayMs: outbound.oneWayMs,
    roundTripMs: cycle,
    inboundPath,
    timetables,
    plan: planService(cycle, headwayMinutes === undefined ? undefined : headwayMinutes * 60_000),
  };
}

export interface ServiceStats {
  /** Measurements for this Service's one path. */
  path: PatternStats;
  fleet: number;
  roundTripMs: number;
  /** Recovery time at each terminal. */
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
  const { profile } = effectiveVehicleKind(vehicleKinds, service);
  const measured = patternStats(ways, stations, servicePattern(service), profile, headwayMinutes);
  if (!measured) return null;
  return {
    path: measured,
    fleet: measured.plan?.fleet ?? 0,
    roundTripMs: measured.roundTripMs,
    layoverMs: measured.plan?.layoverMs ?? 0,
  };
}
