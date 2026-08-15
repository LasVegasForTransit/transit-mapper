// Street-geometry engine, stages 2–3: real junction footprints and lane
// connector curves. Follows the A/B Street approach: thicken each arm of a
// junction to its full cross-section width, intersect adjacent arms' edges
// to find how far each carriageway must TRIM BACK from the shared vertex,
// and fill the area between the trim lines as the junction polygon. Lane
// connectors (stored on the Node, or derived by heuristic) then become
// Bézier curves from each incoming lane's trimmed endpoint to its outgoing
// lane's start — the drawable turn guides and, later, routing edges.
//
// Pure and network-free like streets.ts. Junction geometry is cheap (a few
// µs per node) and viewport-scoped by the caller, so it recomputes per
// render rather than caching across frames.

import { laneKind } from '../model/catalog';
import {
  metersFromOrigin,
  offsetMeters,
  resolveWayPath,
  resolveWayPathAtError,
} from '../model/geo';
import { profileWidthM } from '../model/profile';
import { laneRefKey, type ComponentMap } from '../model/components';
import type { LaneConnector, LaneSpec, LngLat, Node, TurnRestriction, Way } from '../model/system';
import { trimPath, wayLaneGeometry, type LanePath } from './streets';

type Vec = [number, number];

interface JunctionCorner {
  /** The point where the two unrounded approach edges would meet. */
  readonly control: Vec;
  /** Distances to that intersection before the curb return pulls back. */
  readonly firstDistanceM: number;
  readonly secondDistanceM: number;
}

const rot90ccw = (v: Vec): Vec => [-v[1], v[0]];
const rot90cw = (v: Vec): Vec => [v[1], -v[0]];

/** One way-end meeting a junction. `dir` points AWAY from the node along the
 *  way, in local meters. */
export interface JunctionArm {
  wayId: string;
  /** Which end of the way meets the node. */
  end: 'start' | 'end';
  dir: Vec;
  halfWidthM: number;
  /** How far this way's lane geometry pulls back from the shared vertex. */
  trimM: number;
}

export interface JunctionGeometry {
  nodeId: string;
  coord: LngLat;
  arms: JunctionArm[];
  /** Footprint ring (closed by the renderer); empty for a seamless 2-arm
   *  straight-through joint, which needs no visible junction at all. */
  polygon: LngLat[];
}

/** Trims per way end, aggregated across every junction in view — what
 *  stage 1 (wayLaneGeometry) consumes so carriageways stop at footprints. */
export type WayTrims = Map<string, { start: number; end: number }>;

const MIN_ANGLE_SIN = 0.15; // arms within ~9° of collinear don't trim each other
const TRIM_CAP_FRACTION = 0.45; // a trim never eats more than 45% of its way
const CURB_RETURN_SEGMENTS = 4;

function add(left: Vec, right: Vec): Vec {
  return [left[0] + right[0], left[1] + right[1]];
}

function scaled(vector: Vec, scale: number): Vec {
  return [vector[0] * scale, vector[1] * scale];
}

function approachEdge(arm: JunctionArm, side: 'left' | 'right', trimM = arm.trimM): Vec {
  const normal = side === 'left' ? rot90ccw(arm.dir) : rot90cw(arm.dir);
  return add(scaled(normal, arm.halfWidthM), scaled(arm.dir, Math.max(trimM, 0.5)));
}

function quadraticPoint(start: Vec, control: Vec, end: Vec, progress: number): Vec {
  const remaining = 1 - progress;
  return [
    remaining * remaining * start[0] +
      2 * remaining * progress * control[0] +
      progress * progress * end[0],
    remaining * remaining * start[1] +
      2 * remaining * progress * control[1] +
      progress * progress * end[1],
  ];
}

function curbReturnInset(a: JunctionArm, b: JunctionArm, t: number, s: number): number {
  return Math.min(a.halfWidthM, b.halfWidthM, t * 0.35, s * 0.35);
}

function junctionArms(node: Node, waysById: Map<string, Way>): JunctionArm[] {
  const arms: JunctionArm[] = [];
  const seen = new Set<string>();
  for (const ref of node.refs) {
    const way = waysById.get(ref.wayId);
    if (!way || way.points.length < 2) continue;
    const isStart = ref.pointIndex === 0;
    const isEnd = ref.pointIndex === way.points.length - 1;
    if (!isStart && !isEnd) continue;
    const key = `${way.id}:${isStart ? 'start' : 'end'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const neighbor = way.points[isStart ? 1 : way.points.length - 2];
    const direction = metersFromOrigin(node.coord, neighbor);
    const length = Math.hypot(direction[0], direction[1]);
    if (length < 0.01) continue;
    arms.push({
      wayId: way.id,
      end: isStart ? 'start' : 'end',
      dir: [direction[0] / length, direction[1] / length],
      halfWidthM: profileWidthM(way.profile) / 2,
      trimM: 0,
    });
  }
  return arms.sort((a, b) => Math.atan2(a.dir[1], a.dir[0]) - Math.atan2(b.dir[1], b.dir[0]));
}

function resolveCurbReturnCorners(arms: JunctionArm[]): Array<JunctionCorner | null> {
  const corners: Array<JunctionCorner | null> = Array.from({ length: arms.length }, () => null);
  for (let index = 0; index < arms.length; index += 1) {
    const nextIndex = (index + 1) % arms.length;
    const first = arms[index];
    const second = arms[nextIndex];
    const cross = first.dir[0] * second.dir[1] - first.dir[1] * second.dir[0];
    if (Math.abs(cross) < MIN_ANGLE_SIN) continue;
    const firstEdge = scaled(rot90ccw(first.dir), first.halfWidthM);
    const secondEdge = scaled(rot90cw(second.dir), second.halfWidthM);
    const delta = add(secondEdge, scaled(firstEdge, -1));
    const firstDistance = (delta[0] * second.dir[1] - delta[1] * second.dir[0]) / cross;
    const secondDistance = (delta[0] * first.dir[1] - delta[1] * first.dir[0]) / cross;
    if (firstDistance <= 0 || secondDistance <= 0) {
      if (firstDistance > 0) first.trimM = Math.max(first.trimM, firstDistance);
      if (secondDistance > 0) second.trimM = Math.max(second.trimM, secondDistance);
      continue;
    }
    const inset = curbReturnInset(first, second, firstDistance, secondDistance);
    first.trimM = Math.max(first.trimM, firstDistance - inset);
    second.trimM = Math.max(second.trimM, secondDistance - inset);
    corners[index] = {
      control: add(firstEdge, scaled(first.dir, firstDistance)),
      firstDistanceM: firstDistance,
      secondDistanceM: secondDistance,
    };
  }
  return corners;
}

function capJunctionTrims(
  arms: JunctionArm[],
  waysById: Map<string, Way>,
  curveErrorM: number | undefined,
): void {
  for (const arm of arms) {
    const way = waysById.get(arm.wayId);
    if (!way) continue;
    const path =
      curveErrorM === undefined ? resolveWayPath(way) : resolveWayPathAtError(way, curveErrorM);
    let lengthM = 0;
    for (let index = 1; index < path.length; index += 1) {
      const segment = metersFromOrigin(path[index - 1], path[index]);
      lengthM += Math.hypot(segment[0], segment[1]);
    }
    arm.trimM = Math.min(arm.trimM, lengthM * TRIM_CAP_FRACTION);
  }
}

function junctionPolygon(
  node: Node,
  arms: readonly JunctionArm[],
  corners: readonly (JunctionCorner | null)[],
): LngLat[] {
  const polygon: LngLat[] = [];
  for (let index = 0; index < arms.length; index += 1) {
    const arm = arms[index];
    const next = arms[(index + 1) % arms.length];
    const right = approachEdge(arm, 'right');
    const left = approachEdge(arm, 'left');
    polygon.push(offsetMeters(node.coord, right[0], right[1]));
    polygon.push(offsetMeters(node.coord, left[0], left[1]));
    const corner = corners[index];
    if (!corner || arm.trimM >= corner.firstDistanceM || next.trimM >= corner.secondDistanceM) {
      continue;
    }
    const nextRight = approachEdge(next, 'right');
    for (let segment = 1; segment < CURB_RETURN_SEGMENTS; segment += 1) {
      const point = quadraticPoint(left, corner.control, nextRight, segment / CURB_RETURN_SEGMENTS);
      polygon.push(offsetMeters(node.coord, point[0], point[1]));
    }
  }
  return polygon;
}

/** Derive one junction's arms, trim distances, and footprint polygon.
 *  Returns null when fewer than 2 way-ends actually meet the node (e.g. a
 *  node whose refs are all interior pass-throughs). */
export function junctionGeometry(
  node: Node,
  waysById: Map<string, Way>,
  curveErrorM?: number,
): JunctionGeometry | null {
  const arms = junctionArms(node, waysById);
  if (arms.length < 2) return null;
  const corners = resolveCurbReturnCorners(arms);
  capJunctionTrims(arms, waysById, curveErrorM);

  // A plain 2-arm straight-through joint (a way resumed/merged mid-street)
  // needs no visible junction.
  if (arms.length === 2) {
    const dot = arms[0].dir[0] * arms[1].dir[0] + arms[0].dir[1] * arms[1].dir[1];
    if (dot < -0.98) return { nodeId: node.id, coord: node.coord, arms, polygon: [] };
  }

  return {
    nodeId: node.id,
    coord: node.coord,
    arms,
    polygon: junctionPolygon(node, arms, corners),
  };
}

/** Aggregate junction trims into per-way-end trim distances for stage 1. */
export function collectWayTrims(junctions: JunctionGeometry[]): WayTrims {
  const trims: WayTrims = new Map();
  for (const j of junctions) {
    for (const arm of j.arms) {
      const t = trims.get(arm.wayId) ?? { start: 0, end: 0 };
      if (arm.end === 'start') t.start = Math.max(t.start, arm.trimM);
      else t.end = Math.max(t.end, arm.trimM);
      trims.set(arm.wayId, t);
    }
  }
  return trims;
}

// ---- Lane connectors --------------------------------------------------------

/** Signed turn angle (radians, CCW-positive = left) from an incoming arm to
 *  an outgoing arm. Incoming heading is INTO the node (-in.dir). */
function turnAngle(inArm: JunctionArm, outArm: JunctionArm): number {
  const hx = -inArm.dir[0];
  const hy = -inArm.dir[1];
  return Math.atan2(
    hx * outArm.dir[1] - hy * outArm.dir[0],
    hx * outArm.dir[0] + hy * outArm.dir[1],
  );
}

export type TurnClass = 'left' | 'straight' | 'right' | 'uturn';

export function classifyTurn(angleRad: number): TurnClass {
  const deg = (angleRad * 180) / Math.PI;
  if (Math.abs(deg) <= 35) return 'straight';
  if (Math.abs(deg) >= 150) return 'uturn';
  return deg > 0 ? 'left' : 'right';
}

/** A way-end's directional lanes that travel INTO the node ("end" arm →
 *  forward lanes; "start" arm → backward lanes; "both" counts either way),
 *  ordered left-to-right in TRAVEL frame (start arms reverse the profile). */
export function incomingLanes(way: Way, end: 'start' | 'end'): LaneSpec[] {
  const lanes = way.profile.lanes.filter((l) => {
    if (!laneKind(l.kindId).directional) return false;
    if (l.direction === 'both') return true;
    return end === 'end' ? l.direction === 'forward' : l.direction === 'backward';
  });
  return end === 'end' ? lanes : [...lanes].reverse();
}

/** Same, for lanes traveling OUT of the node. */
export function outgoingLanes(way: Way, end: 'start' | 'end'): LaneSpec[] {
  const lanes = way.profile.lanes.filter((l) => {
    if (!laneKind(l.kindId).directional) return false;
    if (l.direction === 'both') return true;
    return end === 'end' ? l.direction === 'backward' : l.direction === 'forward';
  });
  return end === 'end' ? [...lanes].reverse() : lanes;
}

/** Pair inbound and outbound lanes for a straight-through connector,
 *  preferring same-kind matches (so a lane that changes position across a
 *  profile change — e.g. a bus lane moving from center-running to
 *  curbside — still defaults to connecting to the same-kind lane on the far
 *  side, not whatever happens to share its numeric index) before falling
 *  back to positional pairing, right-aligned, for whatever's left over. */
function pairStraightLanes(
  inbound: LaneSpec[],
  outbound: LaneSpec[],
): { src: LaneSpec; dst: LaneSpec }[] {
  const outLeft = [...outbound];
  const pairs: { src: LaneSpec; dst: LaneSpec }[] = [];
  const unmatchedIn: LaneSpec[] = [];
  for (let i = inbound.length - 1; i >= 0; i--) {
    const src = inbound[i];
    const idx = outLeft.map((l) => l.kindId).lastIndexOf(src.kindId);
    if (idx >= 0) {
      pairs.unshift({ src, dst: outLeft[idx] });
      outLeft.splice(idx, 1);
    } else {
      unmatchedIn.unshift(src);
    }
  }
  const n = Math.min(unmatchedIn.length, outLeft.length);
  for (let i = 0; i < n; i++) {
    pairs.push({
      src: unmatchedIn[unmatchedIn.length - n + i],
      dst: outLeft[outLeft.length - n + i],
    });
  }
  return pairs;
}

/** True when `laneId` on `wayId` is allowed (by an explicit TurnRestriction)
 *  to feed `targetWayId`. Absent restriction = unrestricted. */
function turnAllowed(
  turnRestrictions: ComponentMap<TurnRestriction> | undefined,
  wayId: string,
  laneId: string,
  targetWayId: string,
): boolean {
  const r = turnRestrictions?.[laneRefKey(wayId, laneId)];
  return !r || r.allowedTargets.includes(targetWayId);
}

/**
 * Default lane connectivity for a junction, derived when the user hasn't
 * customized it: every incoming approach connects straight-through by lane
 * kind/index where a straight arm exists, its leftmost lane additionally
 * turns left, and its rightmost lane turns right. Deliberately simple — the
 * junction editor's explicit connectors override all of this. Candidates
 * whose source lane carries a TurnRestriction that excludes the target way
 * are skipped entirely — this is also how a modal filter is expressed: a
 * lane restricted to an empty allow-list gets no connector at all.
 */
export function defaultConnectors(
  node: Node,
  waysById: Map<string, Way>,
  turnRestrictions?: ComponentMap<TurnRestriction>,
): LaneConnector[] {
  // A level crossing's arms are two different junction groups by design (see
  // formCrossingJunctions) — this function has no group guard of its own, so
  // without this it would pair a rail lane against a road lane by position
  // and produce a turn curve nothing can actually drive. There's also
  // genuinely nothing to connect: a train doesn't turn onto a street lane.
  if (node.control === 'levelCrossing') return [];
  const g = junctionGeometry(node, waysById);
  if (!g) return [];
  const out: LaneConnector[] = [];
  for (const inArm of g.arms) {
    const inWay = waysById.get(inArm.wayId)!;
    const inbound = incomingLanes(inWay, inArm.end);
    if (inbound.length === 0) continue;
    for (const outArm of g.arms) {
      if (outArm === inArm) continue;
      const outWay = waysById.get(outArm.wayId)!;
      const outbound = outgoingLanes(outWay, outArm.end);
      if (outbound.length === 0) continue;
      const turn = classifyTurn(turnAngle(inArm, outArm));
      const push = (src: LaneSpec, dst: LaneSpec) => {
        if (!turnAllowed(turnRestrictions, inWay.id, src.id, outWay.id)) return;
        out.push({
          from: { wayId: inWay.id, laneId: src.id },
          to: { wayId: outWay.id, laneId: dst.id },
        });
      };
      if (turn === 'straight') {
        for (const { src, dst } of pairStraightLanes(inbound, outbound)) push(src, dst);
      } else if (turn === 'left') {
        push(inbound[0], outbound[0]);
      } else if (turn === 'right') {
        push(inbound[inbound.length - 1], outbound[outbound.length - 1]);
      }
      // u-turns are never defaulted; the junction editor can add them.
    }
  }
  return out;
}

/** The connectors in effect at a node: stored ones if the user customized
 *  the junction, else the derived defaults — either way, filtered by any
 *  active TurnRestriction, so a restriction always holds even against an
 *  explicit user-set connector added before the restriction existed. */
export function effectiveConnectors(
  node: Node,
  waysById: Map<string, Way>,
  turnRestrictions?: ComponentMap<TurnRestriction>,
): LaneConnector[] {
  const raw = node.connectors ?? defaultConnectors(node, waysById, turnRestrictions);
  if (!turnRestrictions) return raw;
  return raw.filter((c) => turnAllowed(turnRestrictions, c.from.wayId, c.from.laneId, c.to.wayId));
}

// ---- Connector curves -------------------------------------------------------

export interface ConnectorCurve {
  nodeId: string;
  from: { wayId: string; laneId: string };
  to: { wayId: string; laneId: string };
  path: LngLat[];
}

const CURVE_SAMPLES = 10;

/** The node-side endpoint (and inward tangent) of one lane's trimmed path. */
function laneEndAt(
  lane: LanePath,
  end: 'start' | 'end',
  trimM: number,
): { p: LngLat; tangent: Vec } | null {
  const path = end === 'start' ? trimPath(lane.path, trimM, 0) : trimPath(lane.path, 0, trimM);
  if (path.length < 2) return null;
  const p = end === 'start' ? path[0] : path[path.length - 1];
  const q = end === 'start' ? path[1] : path[path.length - 2];
  const d = metersFromOrigin(p, q); // points AWAY from the node
  const len = Math.hypot(d[0], d[1]) || 1;
  return { p, tangent: [-d[0] / len, -d[1] / len] }; // toward the node
}

/** Bézier turn guides through a junction, one per effective lane connector. */
export function connectorCurves(
  node: Node,
  waysById: Map<string, Way>,
  trims: WayTrims,
  turnRestrictions?: ComponentMap<TurnRestriction>,
): ConnectorCurve[] {
  const g = junctionGeometry(node, waysById);
  if (!g) return [];
  const curves: ConnectorCurve[] = [];
  for (const c of effectiveConnectors(node, waysById, turnRestrictions)) {
    const fromWay = waysById.get(c.from.wayId);
    const toWay = waysById.get(c.to.wayId);
    if (!fromWay || !toWay) continue;
    // A way with both ends on one node (a loop) has two arms — pick the arm
    // where this specific lane actually travels the right direction.
    const fromArm =
      g.arms.find(
        (a) =>
          a.wayId === c.from.wayId &&
          incomingLanes(fromWay, a.end).some((l) => l.id === c.from.laneId),
      ) ?? g.arms.find((a) => a.wayId === c.from.wayId);
    const toArm =
      g.arms.find(
        (a) =>
          a.wayId === c.to.wayId && outgoingLanes(toWay, a.end).some((l) => l.id === c.to.laneId),
      ) ?? g.arms.find((a) => a.wayId === c.to.wayId);
    if (!fromArm || !toArm) continue;
    const fromLane = wayLaneGeometry(fromWay).lanes.find((lane) => lane.laneId === c.from.laneId);
    const toLane = wayLaneGeometry(toWay).lanes.find((lane) => lane.laneId === c.to.laneId);
    if (!fromLane || !toLane) continue;
    const fromTrims = trims.get(fromWay.id) ?? { start: 0, end: 0 };
    const toTrims = trims.get(toWay.id) ?? { start: 0, end: 0 };
    const a = laneEndAt(
      fromLane,
      fromArm.end,
      fromArm.end === 'start' ? fromTrims.start : fromTrims.end,
    );
    const b = laneEndAt(toLane, toArm.end, toArm.end === 'start' ? toTrims.start : toTrims.end);
    if (!a || !b) continue;
    const [dx, dy] = metersFromOrigin(a.p, b.p);
    const k = Math.max(Math.hypot(dx, dy) / 3, 1);
    const p1 = offsetMeters(a.p, a.tangent[0] * k, a.tangent[1] * k);
    const p2 = offsetMeters(b.p, b.tangent[0] * k, b.tangent[1] * k);
    const path: LngLat[] = [];
    for (let i = 0; i <= CURVE_SAMPLES; i++) {
      const t = i / CURVE_SAMPLES;
      const mt = 1 - t;
      path.push([
        mt * mt * mt * a.p[0] +
          3 * mt * mt * t * p1[0] +
          3 * mt * t * t * p2[0] +
          t * t * t * b.p[0],
        mt * mt * mt * a.p[1] +
          3 * mt * mt * t * p1[1] +
          3 * mt * t * t * p2[1] +
          t * t * t * b.p[1],
      ]);
    }
    curves.push({ nodeId: node.id, from: c.from, to: c.to, path });
  }
  return curves;
}
