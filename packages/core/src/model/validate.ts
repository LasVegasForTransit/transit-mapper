import type { Grade } from './catalog';
import {
  haversineMeters,
  patternHasSplit,
  patternRunSegments,
  serviceWayIds,
  wayById,
  wrongWayLegs,
} from './geo';
import type { LngLat, Pattern, PatternSection, RunDirection, TransitSystem, Way } from './system';

/** How a direction of service reads in a sentence a planner will see. */
const RUN_NOUN: Record<RunDirection, string> = {
  outbound: 'outward',
  inbound: 'return',
};

/** How far apart two consecutive legs' join coordinates may sit before the
 *  route counts as broken. Junctions are formed from exactly-coincident
 *  control points, and mergeWays already refuses a join looser than 0.75 m, so
 *  a metre is generous — it absorbs the float drift of a coordinate round-trip
 *  without accepting a gap anyone would notice. */
export const LEG_JOIN_TOLERANCE_M = 1;

export interface Issue {
  id: string;
  message: string;
  /** What clicking this issue should select, if anything. */
  target?:
    { kind: 'way'; id: string } | { kind: 'station'; id: string } | { kind: 'service'; id: string };
}

/**
 * A line running against the traffic on a street it rides.
 *
 * The router refuses to DRAW one, so this is not about drawing: it is about a
 * street that became one-way after a line was already on it. Nothing re-routes
 * an existing line when its infrastructure changes under it, so without this
 * the map simply shows a bus going the wrong way up a street and says nothing.
 *
 * Recomputed from the profile rather than stored, which is the whole point —
 * a stored flag would go stale the moment the street changed again, in either
 * direction.
 */
function wrongWayIssues(
  waysById: Map<string, Way>,
  service: { id: string; name: string },
  pattern: Pattern,
): Issue[] {
  const runs: RunDirection[] = patternHasSplit(pattern) ? ['outbound', 'inbound'] : ['outbound'];
  const offending = new Set<string>();
  for (const run of runs) {
    for (const leg of wrongWayLegs(waysById, pattern, run)) offending.add(leg.wayId);
  }
  if (offending.size === 0) return [];
  const n = offending.size;
  return [
    {
      id: `wrong-way-${service.id}-${pattern.id}`,
      message: `"${service.name}" runs against the traffic on ${n} one-way ${n === 1 ? 'street' : 'streets'}.`,
      target: { kind: 'service', id: service.id },
    },
  ];
}

/** How far apart the two halves of a one-way couplet may sit where they meet.
 *
 *  Deliberately NOT LEG_JOIN_TOLERANCE_M: that measures a join meant to be
 *  exact, and these two ends are meant NOT to touch — a couplet loops round a
 *  block at each end. This only has to catch the case where a line was split
 *  against a path that was never beside it, which is a mistake measured in
 *  kilometres, not metres. A long block is the right order of magnitude. */
const SPLIT_FACING_TOLERANCE_M = 600;

/** A split section whose two directions do not actually run beside each other.
 *  The failure it catches: a return path attached against the wrong stretch of
 *  a line, which leaves a "couplet" whose halves are miles apart and which
 *  every other check would accept, because each half is continuous on its own. */
function splitGapIssues(
  waysById: Map<string, Way>,
  service: { id: string; name: string },
  pattern: Pattern,
): Issue[] {
  const out: Issue[] = [];
  pattern.sections.forEach((section, i) => {
    if (section.kind !== 'split') return;
    const forward = sectionRunPath(waysById, pattern, section, 'outbound');
    const back = sectionRunPath(waysById, pattern, section, 'inbound');
    if (forward.length < 2 || back.length < 2) return;
    // Outbound ends where inbound begins, and inbound ends where outbound
    // begins — the two ends of the couplet.
    const far = haversineMeters(forward[forward.length - 1], back[0]);
    const near = haversineMeters(back[back.length - 1], forward[0]);
    if (Math.max(far, near) <= SPLIT_FACING_TOLERANCE_M) return;
    out.push({
      id: `split-too-far-${service.id}-${pattern.id}-${i}`,
      message: `"${service.name}" has an outward and a return trip that never meet — they were split against stretches that are nowhere near each other.`,
      target: { kind: 'service', id: service.id },
    });
  });
  return out;
}

/** One section's path for one direction. Resolved through the pattern so leg
 *  extents and orientation are honoured exactly as the real render does. */
function sectionRunPath(
  waysById: Map<string, Way>,
  pattern: Pattern,
  section: PatternSection,
  run: RunDirection,
): LngLat[] {
  const legs = new Set(
    section.kind === 'split'
      ? run === 'outbound'
        ? section.outbound
        : section.inbound
      : section.legs,
  );
  return patternRunSegments(waysById, pattern, run)
    .filter((seg) => legs.has(seg.leg))
    .flatMap((seg) => seg.path);
}

/**
 * The cheap half of validateSystem: ghost/orphan record checks, all a single
 * O(n) pass (the orphan-station check used to be O(stations × ways) via
 * `.some()` per station — fixed to a Set lookup). Safe to run reactively on
 * every store change, unlike crossing detection below — see validateSystem's
 * own note on why that one is NOT in this cheap tier.
 */
export function validateSystemQuick(system: TransitSystem): Issue[] {
  const issues: Issue[] = [];

  for (const way of system.ways) {
    if (way.points.length < 2) {
      issues.push({
        id: `ghost-way-${way.id}`,
        message: `A ${way.typeId} way has fewer than 2 points and won't render.`,
        target: { kind: 'way', id: way.id },
      });
    }
  }

  const waysById = wayById(system.ways);
  for (const service of system.services) {
    if (serviceWayIds(service).length === 0) {
      issues.push({
        id: `ghost-service-${service.id}`,
        message: `"${service.name}" doesn't run over any way.`,
        target: { kind: 'service', id: service.id },
      });
    }
    // A pattern used to be a bare list of way ids, and consecutive ways met by
    // construction — a service could not describe a path with a hole in it.
    // Legs can, so the check that used to be structural has to be an explicit
    // one. A break here means some edit rewrote the legs without keeping them
    // joined, and the line will render as two disconnected pieces.
    //
    // Continuity is per DIRECTION. A couplet's outbound and inbound halves are
    // two different streets a block apart, so asking one walk to cover both
    // would report every couplet as broken forever.
    for (const pattern of service.patterns) {
      // An unsplit pattern's inbound run is its outbound run reversed — same
      // joins, same coordinates, same answer — so it is walked once. This runs
      // reactively on every store change, and doubling that for every system
      // that has never seen a couplet buys nothing.
      const runs: RunDirection[] = patternHasSplit(pattern)
        ? ['outbound', 'inbound']
        : ['outbound'];
      for (const run of runs) {
        const segments = patternRunSegments(waysById, pattern, run);
        if (segments.length === 0 && patternHasSplit(pattern)) {
          issues.push({
            id: `empty-run-${service.id}-${pattern.id}-${run}`,
            message: `"${service.name}" has no ${RUN_NOUN[run]} path — it goes out and never comes back.`,
            target: { kind: 'service', id: service.id },
          });
          continue;
        }
        for (let i = 1; i < segments.length; i++) {
          const prevEnd = segments[i - 1].path[segments[i - 1].path.length - 1];
          const nextStart = segments[i].path[0];
          if (haversineMeters(prevEnd, nextStart) <= LEG_JOIN_TOLERANCE_M) continue;
          issues.push({
            // An unsplit pattern keeps the id it had before directions
            // existed: these are React keys and selection targets in
            // IssuesPopover, so preserving them makes this a pure addition.
            id: patternHasSplit(pattern)
              ? `broken-pattern-${service.id}-${pattern.id}-${run}-${i}`
              : `broken-pattern-${service.id}-${pattern.id}-${i}`,
            message: patternHasSplit(pattern)
              ? `"${service.name}" has a gap in its ${RUN_NOUN[run]} route where it leaves one way and joins the next.`
              : `"${service.name}" has a gap in its route where it leaves one way and joins the next.`,
            target: { kind: 'service', id: service.id },
          });
          break; // one report per direction; the first break is the useful one
        }
      }
      issues.push(...splitGapIssues(waysById, service, pattern));
      issues.push(...wrongWayIssues(waysById, service, pattern));
    }
  }

  const wayIds = new Set(system.ways.map((w) => w.id));
  for (const station of system.stations) {
    if (station.anchor && !wayIds.has(station.anchor.wayId)) {
      issues.push({
        id: `orphan-station-${station.id}`,
        message: `"${station.name || 'A station'}" is anchored to a way that no longer exists.`,
        target: { kind: 'station', id: station.id },
      });
    }
  }

  return issues;
}

/**
 * The full check: validateSystemQuick's cheap ghost/orphan checks, plus one
 * structural check — two ways whose alignments visibly cross without
 * actually meeting, which the junction primitive (Node) makes cheap to spot:
 * a genuine interior crossing between two ways that share no Node.
 *
 * Crossing detection is NOT part of validateSystemQuick because, even with
 * the spatial grid below, it's fundamentally expensive on a real transit
 * network: many routes genuinely run along the same shared street corridors,
 * so a real GTFS import's ~285 ways produced ~9-16 million candidate segment
 * pairs no amount of cell-size tuning got under a few million (confirmed by
 * benchmarking cell sizes from 1km down to 200m against RTC Southern
 * Nevada's real feed) — a multi-second cost inherent to the DATA, not an
 * implementation bug. Running that reactively on every store update (this
 * used to feed an always-mounted toolbar badge) is what froze the app during
 * normal use; see IssuesPopover for how this is now called explicitly
 * on-demand instead.
 */
export function validateSystem(system: TransitSystem): Issue[] {
  return [...validateSystemQuick(system), ...findCrossingsWithoutJoining(system)];
}

// Two ways sharing a Node are joined on purpose — never flagged, regardless
// of how their segments happen to fall.
function jointWayPairs(system: TransitSystem): Set<string> {
  const pairs = new Set<string>();
  for (const node of system.nodes) {
    const wayIds = [...new Set(node.refs.map((r) => r.wayId))];
    for (let i = 0; i < wayIds.length; i++) {
      for (let j = i + 1; j < wayIds.length; j++) pairs.add(pairKey(wayIds[i], wayIds[j]));
    }
  }
  return pairs;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// ~100m at Vegas's latitude. Unlike geo.ts's INTERCHANGE grid (a fixed
// real-world proximity radius), this only needs to bound bbox-overlap tests:
// two segments can only cross if their bounding boxes overlap, and inserting
// each segment into every cell its bbox spans guarantees any truly
// overlapping pair shares at least one cell — no distance margin needed.
// Empirically the best of {1km, 300m, 100m, 50m, 20m} tried against RTC
// Southern Nevada's real feed — candidate pairs bottom out around here
// (finer cells add grid overhead without shrinking the candidate set
// further, since real routes densely share the same street corridors).
const CROSS_CELL_DEG = 0.001;

interface CrossSegment {
  wayId: string;
  typeId: string;
  /** Vertical alignment, so two ways at different grades aren't reported as
   *  needing a junction — see crossingIssuesForSegment. */
  grade: Grade;
  a: LngLat;
  b: LngLat;
}

function crossCellKey(cx: number, cy: number): string {
  return `${cx}:${cy}`;
}

function crossBboxCells(
  a: LngLat,
  b: LngLat,
): { cx0: number; cx1: number; cy0: number; cy1: number } {
  return {
    cx0: Math.floor(Math.min(a[0], b[0]) / CROSS_CELL_DEG),
    cx1: Math.floor(Math.max(a[0], b[0]) / CROSS_CELL_DEG),
    cy0: Math.floor(Math.min(a[1], b[1]) / CROSS_CELL_DEG),
    cy1: Math.floor(Math.max(a[1], b[1]) / CROSS_CELL_DEG),
  };
}

/**
 * Most cells one segment may occupy before it is held aside instead. See
 * MAX_SEGMENT_CELLS in geo/snapIndex.ts for the full reasoning; the short
 * version is that a segment's indexing cost is the area of its bounding box
 * in cells, which depends on how far apart its endpoints are and not on how
 * much data there is. CROSS_CELL_DEG is 3× finer than the snap grid, so the
 * same span costs 9× more here.
 */
const MAX_CROSS_SEGMENT_CELLS = 4096;

/** Aggregate and held-aside ceilings, for the reasons spelled out against
 *  MAX_GRID_CELLS and MAX_OVERSIZE_SEGMENTS in geo/snapIndex.ts: capping one
 *  segment does not cap a grid, and an unbounded held-aside list turns every
 *  query back into a full scan. This grid's cells are 3× finer per axis, so
 *  genuine data uses more of the budget here. */
const MAX_CROSS_GRID_CELLS = 2_000_000;
const MAX_CROSS_OVERSIZE_SEGMENTS = 512;

interface CrossGrid {
  cells: Map<string, CrossSegment[]>;
  /** Segments too wide to expand; every query must consider these. */
  oversize: CrossSegment[];
  /** Every segment, for when the *query* segment is itself too wide to walk
   *  cell by cell. Holding the references costs nothing — they are the same
   *  objects already in `cells`. */
  all: CrossSegment[];
  /** Remaining full-scan allowances. Mutable, and deliberately shared across
   *  one whole pass so the cost is bounded per document rather than per
   *  segment. See crossingIssuesForSegment. */
  wideScansLeft: number;
}

function cellSpan(a: LngLat, b: LngLat): number {
  const { cx0, cx1, cy0, cy1 } = crossBboxCells(a, b);
  return (cx1 - cx0 + 1) * (cy1 - cy0 + 1);
}

function buildCrossGrid(ways: Way[]): CrossGrid {
  const cells = new Map<string, CrossSegment[]>();
  const oversize: CrossSegment[] = [];
  const all: CrossSegment[] = [];
  let cellsUsed = 0;
  for (const way of ways) {
    for (let i = 0; i < way.points.length - 1; i++) {
      const seg: CrossSegment = {
        wayId: way.id,
        typeId: way.typeId,
        grade: way.grade,
        a: way.points[i],
        b: way.points[i + 1],
      };
      all.push(seg);
      const { cx0, cx1, cy0, cy1 } = crossBboxCells(seg.a, seg.b);
      const span = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);
      if (span > MAX_CROSS_SEGMENT_CELLS || cellsUsed + span > MAX_CROSS_GRID_CELLS) {
        if (oversize.length < MAX_CROSS_OVERSIZE_SEGMENTS) oversize.push(seg);
        continue;
      }
      cellsUsed += span;
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const key = crossCellKey(cx, cy);
          const bucket = cells.get(key);
          if (bucket) bucket.push(seg);
          else cells.set(key, [seg]);
        }
      }
    }
  }
  return { cells, oversize, all, wideScansLeft: MAX_CROSS_OVERSIZE_SEGMENTS };
}

function crossingIssuesForSegment(
  way: Way,
  a1: LngLat,
  a2: LngLat,
  grid: CrossGrid,
  joined: Set<string>,
  flagged: Set<string>,
): Issue[] {
  const issues: Issue[] = [];
  const consider = (other: CrossSegment) => {
    if (other.wayId === way.id) return;
    const key = pairKey(way.id, other.wayId);
    if (flagged.has(key) || joined.has(key)) return;
    // Different grades don't meet: an elevated way passing over a surface
    // street is a bridge, not a missing junction. Without this every
    // overpass reads as an error the user can never resolve, since joining
    // them would be wrong.
    if (other.grade !== way.grade) return;
    if (!segmentsCross(a1, a2, other.a, other.b)) return;
    flagged.add(key);
    issues.push({
      id: `crossing-${key}`,
      message: `A ${way.typeId} way crosses a ${other.typeId} way without joining — check whether they should share a junction.`,
      target: { kind: 'way', id: way.id },
    });
  };

  // The query side amplifies exactly like the build side did: walking the
  // cells a segment spans is only cheap while that span is small. A segment
  // too wide to walk checks every segment instead — O(n) rather than
  // O(cells).
  //
  // But O(n) per wide segment is O(n²) when everything is wide, which is a
  // document away. `wideScansLeft` bounds how many segments may buy that
  // fallback; past it, a wide segment is compared only against the other
  // held-aside ones. Crossings involving it can then be missed, which is a
  // real loss — the issues list is advisory, and a wrong entry in it is worth
  // far less than a pegged core. A genuine system has a handful of wide
  // segments at most and never reaches this.
  if (cellSpan(a1, a2) > MAX_CROSS_SEGMENT_CELLS) {
    if (grid.wideScansLeft > 0) {
      grid.wideScansLeft--;
      for (const other of grid.all) consider(other);
    } else {
      for (const other of grid.oversize) consider(other);
    }
    return issues;
  }

  const { cx0, cx1, cy0, cy1 } = crossBboxCells(a1, a2);
  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cy = cy0; cy <= cy1; cy++) {
      const bucket = grid.cells.get(crossCellKey(cx, cy));
      if (!bucket) continue;
      for (const other of bucket) consider(other);
    }
  }
  // Segments held out of the grid are in no cell, so a normal query would
  // never see them. Checking them here is what keeps the result exact.
  for (const other of grid.oversize) consider(other);
  return issues;
}

function crossingIssuesForWay(
  way: Way,
  grid: CrossGrid,
  joined: Set<string>,
  flagged: Set<string>,
): Issue[] {
  const issues: Issue[] = [];
  for (let i = 0; i < way.points.length - 1; i++) {
    issues.push(
      ...crossingIssuesForSegment(way, way.points[i], way.points[i + 1], grid, joined, flagged),
    );
  }
  return issues;
}

/**
 * A real GTFS/OSM import's ways are long, dense, street-following polylines
 * — hundreds of ways with hundreds of points each. The naive version here
 * (every way pair × every segment pair) is O(ways² × segments²), which
 * turned a few hundred real ways into ~100 million segment checks. A spatial
 * grid bounds each segment's candidate set to whatever shares its own
 * bounding-box cells, the same technique geo.ts uses for servedWayIds
 * against the identical class of problem — but even so, real routes sharing
 * street corridors keep the candidate-pair count in the millions (see the
 * CROSS_CELL_DEG note): a multi-second cost inherent to the data, not this
 * function. Synchronous, so only for tests (tiny fixture systems) and
 * validateSystem's own full-check contract — the live UI never calls this
 * directly, see crossingsWithoutJoiningChunked below for that.
 */
export function findCrossingsWithoutJoining(system: TransitSystem): Issue[] {
  const joined = jointWayPairs(system);
  const ways = system.ways.filter((w) => w.points.length >= 2);
  const grid = buildCrossGrid(ways);
  const flagged = new Set<string>();
  const issues: Issue[] = [];
  for (const way of ways) issues.push(...crossingIssuesForWay(way, grid, joined, flagged));
  return issues;
}

// Wall-clock budget per chunk, not a fixed way/segment count — a fixed
// count still let one chunk land entirely inside a dense shared-corridor
// hotspot (see findCrossingsWithoutJoining's note) and block for hundreds of
// ms; checking elapsed time between individual SEGMENTS instead bounds every
// chunk to roughly this budget regardless of how the work is distributed.
// Confirmed against RTC Southern Nevada's real feed: a fixed 6-ways-per-
// chunk version still produced a ~400ms chunk on a busy downtown corridor.
const CROSSING_CHUNK_BUDGET_MS = 8;

/**
 * Same crossing detection as findCrossingsWithoutJoining, but split into
 * time-budgeted chunks with a `setTimeout(0)` yield between them (not
 * `requestAnimationFrame` — rAF pauses indefinitely on a backgrounded tab,
 * the same reasoning as gtfsImport.ts's streamRtcGtfsBatches) — so
 * IssuesPopover's live badge stays accurate WITHOUT ever blocking a frame,
 * on a check that can otherwise run several seconds straight on a large real
 * import.
 *
 * Already Worker-shaped: an async generator yielding per-chunk is exactly
 * the pattern a Web Worker would use too (post a progress message per yield
 * instead of yielding to the event loop) — moving this off the main thread
 * later is a transport change around this same generator, not a rewrite of
 * the algorithm.
 */
export async function* crossingsWithoutJoiningChunked(
  system: TransitSystem,
): AsyncGenerator<Issue[]> {
  const joined = jointWayPairs(system);
  const ways = system.ways.filter((w) => w.points.length >= 2);
  const grid = buildCrossGrid(ways);
  const flagged = new Set<string>();
  let chunkIssues: Issue[] = [];
  let chunkStart = performance.now();
  for (const way of ways) {
    for (let i = 0; i < way.points.length - 1; i++) {
      chunkIssues.push(
        ...crossingIssuesForSegment(way, way.points[i], way.points[i + 1], grid, joined, flagged),
      );
      if (performance.now() - chunkStart < CROSSING_CHUNK_BUDGET_MS) continue;
      if (chunkIssues.length > 0) {
        yield chunkIssues;
        chunkIssues = [];
      }
      await new Promise((r) => setTimeout(r, 0));
      chunkStart = performance.now();
    }
  }
  if (chunkIssues.length > 0) yield chunkIssues;
}

/** One genuine interior crossing between two ways' control polylines. The
 *  indices are INSERTION points: splicing `coord` into a.points at `aIndex`
 *  (and b.points at `bIndex`) puts a real shared vertex at the crossing —
 *  the input formCrossingJunctions needs to form a junction there. */
export interface WayCrossing {
  coord: LngLat;
  aIndex: number;
  bIndex: number;
}

/** Every interior crossing between two ways, ordered along way `a`.
 *  Endpoint touches (already-joined junction vertices) are not crossings —
 *  same rule as the validation pass above. */
export function wayCrossings(a: Way, b: Way): WayCrossing[] {
  return polylineCrossings(a.points, b.points);
}

/** wayCrossings over bare polylines — for paths that are not a way's own
 *  control points, such as the resolved path a service rides. */
export function polylineCrossings(a: LngLat[], b: LngLat[]): WayCrossing[] {
  const crossings: WayCrossing[] = [];
  for (let i = 0; i < a.length - 1; i++) {
    for (let j = 0; j < b.length - 1; j++) {
      const hit = segmentCrossingPoint(a[i], a[i + 1], b[j], b[j + 1]);
      if (hit) crossings.push({ coord: hit, aIndex: i + 1, bIndex: j + 1 });
    }
  }
  return crossings;
}

/** The interior crossing point of two segments, or null. Same interior-only
 *  rule as segmentsCross. */
function segmentCrossingPoint(p1: LngLat, p2: LngLat, p3: LngLat, p4: LngLat): LngLat | null {
  const d1x = p2[0] - p1[0];
  const d1y = p2[1] - p1[1];
  const d2x = p4[0] - p3[0];
  const d2y = p4[1] - p3[1];
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-15) return null;
  const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / denom;
  const u = ((p3[0] - p1[0]) * d1y - (p3[1] - p1[1]) * d1x) / denom;
  const EPS = 1e-9;
  if (t <= EPS || t >= 1 - EPS || u <= EPS || u >= 1 - EPS) return null;
  return [p1[0] + t * d1x, p1[1] + t * d1y];
}

// True for a genuine interior crossing only — segments that merely touch at
// an endpoint (t or u exactly 0/1, which is what a real shared junction
// vertex looks like) are deliberately NOT a crossing.
function segmentsCross(p1: LngLat, p2: LngLat, p3: LngLat, p4: LngLat): boolean {
  const d1x = p2[0] - p1[0];
  const d1y = p2[1] - p1[1];
  const d2x = p4[0] - p3[0];
  const d2y = p4[1] - p3[1];
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-15) return false; // parallel or collinear — not treated as a crossing
  const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / denom;
  const u = ((p3[0] - p1[0]) * d1y - (p3[1] - p1[1]) * d1x) / denom;
  const EPS = 1e-9;
  return t > EPS && t < 1 - EPS && u > EPS && u < 1 - EPS;
}
