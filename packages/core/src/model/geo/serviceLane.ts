// Which physical lane a service rides on a given way — the domain logic behind
// lane-accurate rendering in the Infrastructure view (a bus on the curb lane, a
// train on its track) versus the schematic centerline bundle of the Network
// view. Pure and data-oriented like the rest of geo/: no store, no style. A
// committed Pattern stores only ordered wayIds and NO travel direction
// (materializeRouteSpans discards it), so the traversal direction is DERIVED
// from geometry here and fed to profile.ts's defaultLaneFor.

import { defaultLaneFor } from "../profile";
import type { LngLat, Pattern, Way } from "../system";
import { haversineMeters } from "./spherical";

/** The lane kinds a mode prefers, most-preferred first — a bus wants a
 *  dedicated bus lane then a drive lane; rail wants its track. Fed to
 *  defaultLaneFor's `preferKindIds`. No such field exists on the mode catalog,
 *  so the mapping lives here. */
export function preferredLaneKinds(modeId: string): readonly string[] {
  switch (modeId) {
    case "bus":
    case "brt":
      return ["bus", "drive"];
    case "subway":
    case "commuterRail":
    case "lightRail":
    case "tram":
    case "monorail":
      return ["track"];
    case "gondola":
    case "ferry":
      return ["channel"];
    default:
      return ["drive"];
  }
}

// Two endpoints within this distance are the same junction. Junctions form at
// coincident raw control points (joinWayPointToWay / route materialization make
// them exactly equal), so a sub-meter tolerance is generous — it only guards
// against float drift.
const COINCIDENT_M = 1;

const coincide = (a: LngLat, b: LngLat): boolean => haversineMeters(a, b) <= COINCIDENT_M;

/**
 * Which direction `pattern.wayIds[wayIndex]` is traversed in — "forward"
 * (increasing point index) or "backward" — derived from which endpoint it
 * shares with the neighbouring way in the pattern. The pattern EXITS this way
 * into the next one (or, for the last way, ENTERS it from the previous one) at a
 * shared junction: exit at the way's last point → forward, exit at its first
 * point → backward. A single-way or ambiguous pattern defaults to "forward".
 */
export function patternWayDirection(pattern: Pattern, wayIndex: number, waysById: Map<string, Way>): "forward" | "backward" {
  const way = waysById.get(pattern.wayIds[wayIndex]);
  if (!way || way.points.length < 2) return "forward";
  const first = way.points[0];
  const last = way.points[way.points.length - 1];

  // Prefer the NEXT way (this way exits into it); fall back to the previous.
  const next = waysById.get(pattern.wayIds[wayIndex + 1]);
  if (next && next.points.length >= 2) {
    const ends = [next.points[0], next.points[next.points.length - 1]];
    const exitLast = ends.some((p) => coincide(last, p));
    const exitFirst = ends.some((p) => coincide(first, p));
    if (exitLast && !exitFirst) return "forward";
    if (exitFirst && !exitLast) return "backward";
  }
  const prev = waysById.get(pattern.wayIds[wayIndex - 1]);
  if (prev && prev.points.length >= 2) {
    const ends = [prev.points[0], prev.points[prev.points.length - 1]];
    const enterFirst = ends.some((p) => coincide(first, p));
    const enterLast = ends.some((p) => coincide(last, p));
    if (enterFirst && !enterLast) return "forward";
    if (enterLast && !enterFirst) return "backward";
  }
  return "forward";
}

/**
 * The LaneSpec id a service of mode `modeId` rides on `pattern.wayIds[wayIndex]`:
 * an explicit `pattern.lanes` pin if set, else the default resolved from the
 * way's cross-section, the pattern's derived travel direction, and the mode's
 * preferred lane kinds. Null only for a lane-less profile.
 */
export function serviceLaneOnWay(pattern: Pattern, wayIndex: number, waysById: Map<string, Way>, modeId: string): string | null {
  const way = waysById.get(pattern.wayIds[wayIndex]);
  if (!way) return null;
  const pinned = pattern.lanes?.[way.id];
  if (pinned) return pinned;
  return defaultLaneFor(way.profile, patternWayDirection(pattern, wayIndex, waysById), preferredLaneKinds(modeId));
}
