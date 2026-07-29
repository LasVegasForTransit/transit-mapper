import type { LngLat, Way } from '../system';
import { haversineMeters } from './spherical';
import { nearestOnPath, projectOnSegment } from './measurement';
import { resolveWayPath, wayById } from './wayPath';

export interface InsertionPoint {
  /** Index in the RAW `points` array to splice the new control point into. */
  index: number;
  coord: LngLat;
  distMeters: number;
}

/**
 * Where to splice a new control point into a way's RAW `points` array so it
 * lands on the segment nearest `coord` — unlike `nearestOnPath`/`snap`, which
 * operate on the curve-RESOLVED path, this always returns a real control-
 * point index, since forming a genuine junction requires inserting an actual
 * point into the target way, not just a coordinate that happens to sit on its
 * rendered curve.
 */
export function nearestInsertionPoint(points: LngLat[], coord: LngLat): InsertionPoint | null {
  if (points.length < 2) return null;
  let best: InsertionPoint | null = null;
  for (let i = 0; i < points.length - 1; i++) {
    const { point } = projectOnSegment(coord, points[i], points[i + 1]);
    const d = haversineMeters(coord, point);
    if (best === null || d < best.distMeters) best = { index: i + 1, coord: point, distMeters: d };
  }
  return best;
}

export interface Snap {
  wayId: string;
  t: number;
  coord: LngLat;
  distMeters: number;
}

/**
 * The best snap target across a set of ways: the nearest way whose path comes
 * within maxMeters of coord. The generalized snap engine everything routes
 * through — track↔station, way↔way endpoints, and so on — so snapping is the
 * default UX. An optional `exclude` set skips a way (e.g. the one being
 * drawn). An optional `typeId` restricts candidates to that exact way type —
 * used while drawing new geometry, since a shared node only makes physical
 * sense between ways of the same type (mirrors nearestOpenEndpoint's own
 * typeId filter below; a road has no business snapping onto a rail track a
 * screen's-width away). Left unset for station-anchoring snaps, where any
 * way type is a valid stop.
 *
 * Candidates are narrowed via the same segment grid servedWayIds uses
 * (below) before the exact nearestOnPath check runs — a brute-force scan of
 * every way here was the same class of problem servedWayIds already had to
 * solve at real-GTFS scale (station drag, way-endpoint join-detection while
 * drawing, and "adopt existing infrastructure" all route through this).
 */
export function snap(
  ways: Way[],
  coord: LngLat,
  maxMeters: number,
  exclude?: Set<string>,
  typeId?: string,
): Snap | null {
  const byId = wayById(ways);
  let best: Snap | null = null;
  for (const id of candidateWayIdsNear(coord, ways, maxMeters)) {
    if (exclude?.has(id)) continue;
    const way = byId.get(id);
    if (!way) continue;
    if (typeId && way.typeId !== typeId) continue;
    const near = nearestOnPath(resolveWayPath(way), coord);
    if (!near || near.distMeters > maxMeters) continue;
    // Ties break on id rather than on which candidate the grid yielded first.
    // Exactly-equidistant ways are reachable with real data — conflated or
    // duplicated GTFS shapes lie on top of each other — and without this the
    // way you snap to depends on the index's iteration order, which an
    // incremental grid update is free to change.
    const better =
      best === null ||
      near.distMeters < best.distMeters ||
      (near.distMeters === best.distMeters && way.id < best.wayId);
    if (better) {
      best = { wayId: way.id, t: near.t, coord: near.coord, distMeters: near.distMeters };
    }
  }
  return best;
}

// A uniform lat/lng grid over every SEGMENT (not whole way) of a given ways
// array, cached by that array's own reference — safe because buildFeatures
// recomputes `visibleWays` as a fresh array on every rebuild, so an old
// index is simply never looked up again and falls out of the WeakMap.
// Per-WAY bounding boxes turned out not to help here: a real bus route's
// Way can span the whole city, so its bbox rejects almost nothing. Bucketing
// by segment does — a station only ever needs the handful of segments in
// its own neighborhood, not the other ~120,000 points somewhere else on the
// map. Without this, buildFeatures's per-station interchange check (every
// station × every segment of every way) was O(stations × total way points):
// fine for a few dozen hand-drawn stations, but a real GTFS import
// (thousands of stations, hundreds of detailed street-following shapes,
// ~120,000 points total) turned that into ~460 million segment checks and
// froze the tab. Confirmed live against RTC Southern Nevada's real feed.
const CELL_DEG = 0.003; // ~300m at Vegas's latitude — a few INTERCHANGE_METERS-widths per cell keeps neighborhoods small without so many cells that a segment spanning a boundary gets missed.

interface GridSegment {
  wayId: string;
  a: LngLat;
  b: LngLat;
}

function cellKey(cx: number, cy: number): string {
  return `${cx}:${cy}`;
}

// A degree of longitude covers cos(latitude) as many meters as a degree of
// latitude — 111,320m is only correct on the equator. Using it unadjusted for
// the longitude (dx) axis UNDERCOUNTS how many cells maxMeters actually spans
// east-west away from the equator (at Vegas's ~36°N, a longitude cell is only
// ~81% as wide in meters as a latitude cell), so a candidate segment within
// maxMeters could sit just outside the scanned dx range and never be found.
// Clamped so a near-pole latitude (cos → 0) can't blow this up into scanning
// an unbounded number of cells.
function lngCellRadius(maxMeters: number, latDeg: number): number {
  const metersPerDegLng = 111_320 * Math.max(Math.cos((latDeg * Math.PI) / 180), 0.01);
  return Math.ceil(maxMeters / metersPerDegLng / CELL_DEG) + 1;
}

/**
 * Most cells a single segment may be expanded into before it is held aside
 * instead.
 *
 * The cost of indexing a segment is the area of its bounding box in cells,
 * which is driven by coordinate magnitude and not by how much data there is.
 * At CELL_DEG a segment spanning 10° of longitude and 5° of latitude asks for
 * ~5.5 million cells; the whole world asks for 7.2 billion and exceeds V8's
 * Map size limit outright. Measured on this tree, before this bound: ±5°
 * froze for 4.2 seconds and ±10° crashed after 13.
 *
 * That is reachable from any two-point way with ordinary in-range
 * coordinates, so validating coordinates cannot fix it — the amplification is
 * here, in the expansion, and so is the fix. It is not only a hostile-input
 * concern: a long-distance GTFS shape or a way drawn across a continent is
 * legitimate data that hits the same wall.
 *
 * 4096 cells is a ~0.2° box, far larger than any segment real editing
 * produces and small enough that a few thousand of them cost nothing.
 */
const MAX_SEGMENT_CELLS = 4096;

/**
 * Ceiling on cells across the WHOLE grid, not one segment.
 *
 * The per-segment cap above is necessary and not sufficient, which an earlier
 * version of this file got wrong: N segments each sitting just under the cap
 * multiply out to N×4096 cells, and nothing bounded N. Measured with that
 * version in place, a 0.10 MB document of segments all just inside the
 * per-segment limit took 4.5 seconds and 690 MB — the same freeze the cap was
 * added to prevent, reassembled out of individually-legal pieces.
 *
 * Real data sits far below this: RTC Southern Nevada's whole feed is ~120,000
 * short street-following segments spanning a cell or two each, so a few
 * hundred thousand cells. Two million is generous headroom for anything
 * genuine and still a hard stop for anything constructed.
 */
export const MAX_GRID_CELLS = 2_000_000;

/**
 * Ceiling on segments held aside.
 *
 * Every query scans this list in full, so its length is a per-query cost paid
 * once per station on the render path. Unbounded, it reintroduces exactly the
 * O(stations × segments) quadratic this grid exists to remove — measured at
 * ~2 seconds of blocking work for a 0.29 MB document, on the embed path,
 * from a document a stranger supplied.
 *
 * Past this point segments stop being indexed at all. That is a real loss of
 * function — a way beyond the limit won't be found by snapping or counted as
 * serving a station — chosen deliberately over freezing the page. It takes a
 * document with hundreds of continent-spanning segments to reach, which no
 * amount of ordinary editing or importing produces.
 */
export const MAX_OVERSIZE_SEGMENTS = 512;

interface SegmentGrid {
  cells: Map<string, GridSegment[]>;
  /**
   * Segments too large to expand. Every query scans these in full, so results
   * stay exact for everything that makes it in — this bounds the index rather
   * than approximating it, up to MAX_OVERSIZE_SEGMENTS.
   */
  oversize: GridSegment[];
}

function buildSegmentGrid(ways: Way[]): SegmentGrid {
  const cells = new Map<string, GridSegment[]>();
  const oversize: GridSegment[] = [];
  let cellsUsed = 0;
  for (const way of ways) {
    const path = resolveWayPath(way);
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      const cx0 = Math.floor(Math.min(a[0], b[0]) / CELL_DEG);
      const cx1 = Math.floor(Math.max(a[0], b[0]) / CELL_DEG);
      const cy0 = Math.floor(Math.min(a[1], b[1]) / CELL_DEG);
      const cy1 = Math.floor(Math.max(a[1], b[1]) / CELL_DEG);
      const seg: GridSegment = { wayId: way.id, a, b };
      // Counted before expanding, not while: the point is never to run the
      // loop at all for a segment the index can't afford.
      const span = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);
      if (span > MAX_SEGMENT_CELLS || cellsUsed + span > MAX_GRID_CELLS) {
        if (oversize.length < MAX_OVERSIZE_SEGMENTS) oversize.push(seg);
        continue;
      }
      cellsUsed += span;
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const key = cellKey(cx, cy);
          const bucket = cells.get(key);
          if (bucket) bucket.push(seg);
          else cells.set(key, [seg]);
        }
      }
    }
  }
  return { cells, oversize };
}

const segmentGridCache = new WeakMap<Way[], SegmentGrid>();

function gridFor(ways: Way[]): SegmentGrid {
  let grid = segmentGridCache.get(ways);
  if (!grid) {
    grid = buildSegmentGrid(ways);
    segmentGridCache.set(ways, grid);
  }
  return grid;
}

/** What indexing a ways array actually cost. See `segmentGridStats`. */
export interface SegmentGridStats {
  /** Grid cells occupied. */
  cells: number;
  /**
   * Segment-in-cell entries: one per cell each indexed segment was expanded
   * into. This is the grid's real memory footprint and the work a build does,
   * and it is what MAX_GRID_CELLS bounds.
   */
  entries: number;
  /** Segments held out of the grid, which every query then scans in full. */
  oversize: number;
}

/**
 * The size of the index built for `ways` — measured from the finished grid,
 * not read back off the counters that enforce the bounds.
 *
 * This exists so the bounds above can be asserted directly. They are guards
 * against an O(n) blowup, and the blowup's visible symptom is elapsed time,
 * but timing a build is a measurement of the machine as much as of the code:
 * on a loaded laptop the same build has been seen to take 366ms and 3972ms.
 * These counts are what actually went wrong in the cases the bounds were
 * added for — millions of cells expanded from a handful of segments — and
 * they are identical on every run.
 */
export function segmentGridStats(ways: Way[]): SegmentGridStats {
  const grid = gridFor(ways);
  let entries = 0;
  for (const bucket of grid.cells.values()) entries += bucket.length;
  return { cells: grid.cells.size, entries, oversize: grid.oversize.length };
}

// Candidate way IDs for snap(): every way with a segment inside coord's
// cell-radius, reusing the same grid buildSegmentGrid/segmentGridCache
// already maintain for servedWayIds — no exact distance computed here (that
// happens once, per candidate, in snap()'s own nearestOnPath call below),
// just cheap cell-bucket membership.
export function candidateWayIdsNear(coord: LngLat, ways: Way[], maxMeters: number): Set<string> {
  const grid = gridFor(ways);
  const cellRadiusLat = Math.ceil(maxMeters / 111_320 / CELL_DEG) + 1;
  const cellRadiusLng = lngCellRadius(maxMeters, coord[1]);
  const cx = Math.floor(coord[0] / CELL_DEG);
  const cy = Math.floor(coord[1] / CELL_DEG);
  const ids = new Set<string>();
  for (let dx = -cellRadiusLng; dx <= cellRadiusLng; dx++) {
    for (let dy = -cellRadiusLat; dy <= cellRadiusLat; dy++) {
      const bucket = grid.cells.get(cellKey(cx + dx, cy + dy));
      if (!bucket) continue;
      for (const seg of bucket) ids.add(seg.wayId);
    }
  }
  // Segments held out of the grid are candidates for every query — that's what
  // keeps this exact rather than merely fast.
  for (const seg of grid.oversize) ids.add(seg.wayId);
  return ids;
}

/**
 * Candidate way ids for "what could this whole path touch" — every way with a
 * segment sharing a grid cell with one of `path`'s own segments.
 *
 * The single-coordinate query above cannot answer this: sampling a long
 * segment only at its endpoints misses everything crossing the middle of it.
 * This walks exactly the cells the segment's bounding box spans, which is the
 * same expansion buildSegmentGrid used to insert, so any segment that really
 * does cross `path` is in the result.
 *
 * `path` itself is not in `ways`' grid unless the caller put it there, and its
 * own id (if any) is not filtered out — the caller knows whether it is
 * comparing a way against itself.
 */
export function candidateWayIdsAlong(path: LngLat[], ways: Way[]): Set<string> {
  const grid = gridFor(ways);
  const ids = new Set<string>();
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const cx0 = Math.floor(Math.min(a[0], b[0]) / CELL_DEG);
    const cx1 = Math.floor(Math.max(a[0], b[0]) / CELL_DEG);
    const cy0 = Math.floor(Math.min(a[1], b[1]) / CELL_DEG);
    const cy1 = Math.floor(Math.max(a[1], b[1]) / CELL_DEG);
    // A segment too big to have been indexed is too big to expand here
    // either; the oversize sweep below covers what it might meet.
    if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > MAX_SEGMENT_CELLS) continue;
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const bucket = grid.cells.get(cellKey(cx, cy));
        if (!bucket) continue;
        for (const seg of bucket) ids.add(seg.wayId);
      }
    }
  }
  // Segments held out of the grid are candidates for every query — that's what
  // keeps this exact rather than merely fast.
  for (const seg of grid.oversize) ids.add(seg.wayId);
  return ids;
}

export interface ServedWayDistance {
  wayId: string;
  distMeters: number;
}

/** Every way whose path passes within maxMeters of a coordinate, ranked by
 *  exact nearest distance and then id. Returning the distance with the id lets
 *  an incremental caller merge a small changed-way query into a prior result
 *  without walking every retained way again. */
export function servedWaysByDistance(
  coord: LngLat,
  ways: Way[],
  maxMeters: number,
): ServedWayDistance[] {
  const grid = gridFor(ways);
  const cellRadiusLat = Math.ceil(maxMeters / 111_320 / CELL_DEG) + 1; // +1 cell of margin for anything straddling a boundary
  const cellRadiusLng = lngCellRadius(maxMeters, coord[1]);
  const cx = Math.floor(coord[0] / CELL_DEG);
  const cy = Math.floor(coord[1] / CELL_DEG);
  const bestByWay = new Map<string, number>();
  const consider = (seg: GridSegment) => {
    const { point } = projectOnSegment(coord, seg.a, seg.b);
    const d = haversineMeters(coord, point);
    const prev = bestByWay.get(seg.wayId);
    if (prev === undefined || d < prev) bestByWay.set(seg.wayId, d);
  };
  for (let dx = -cellRadiusLng; dx <= cellRadiusLng; dx++) {
    for (let dy = -cellRadiusLat; dy <= cellRadiusLat; dy++) {
      const bucket = grid.cells.get(cellKey(cx + dx, cy + dy));
      if (!bucket) continue;
      for (const seg of bucket) consider(seg);
    }
  }
  // Held-aside segments are measured exactly like any other candidate, so a
  // way that legitimately spans a continent still reports the right distance.
  for (const seg of grid.oversize) consider(seg);
  // Nearest first, ties broken by id — NOT grid-scan order.
  //
  // This order is observable: buildFeatures colors a station from the first
  // service riding the first way in this list, so returning ids in whatever
  // order the cell buckets happened to be walked in meant a station's color
  // was a function of the index's internal layout. That was already latent,
  // and it becomes a live flicker the moment the grid is maintained
  // incrementally (updating a way in place necessarily changes bucket order),
  // so the ordering has to be pinned to something intrinsic first.
  // "The nearest way's service colors the station" is also simply the more
  // defensible rule than "whichever the scan reached first".
  const ranked: ServedWayDistance[] = [];
  for (const [wayId, distMeters] of bestByWay) {
    if (distMeters <= maxMeters) ranked.push({ wayId, distMeters });
  }
  ranked.sort(
    (x, y) => x.distMeters - y.distMeters || (x.wayId < y.wayId ? -1 : x.wayId > y.wayId ? 1 : 0),
  );
  return ranked;
}

/** IDs of every way whose path passes within maxMeters of a coordinate. */
export function servedWayIds(coord: LngLat, ways: Way[], maxMeters: number): string[] {
  return servedWaysByDistance(coord, ways, maxMeters).map(({ wayId }) => wayId);
}

// A station within this distance of a way's path counts as served by it, so a
// station where services meet reads as a multimodal interchange.
export const INTERCHANGE_METERS = 90;

export interface OpenEndpoint {
  wayId: string;
  end: 'start' | 'end';
  coord: LngLat;
  distMeters: number;
}

/**
 * The nearest OPEN endpoint (a way's first or last control point) within
 * maxMeters of coord, optionally restricted to one way type. This is what
 * lets pressing near an already-drawn line's end continue that same line
 * (turnkey, SimCity-style) instead of always starting an unrelated new one —
 * distinct from `snap()`, which matches anywhere along a path, not just ends.
 */
export function nearestOpenEndpoint(
  ways: Way[],
  coord: LngLat,
  maxMeters: number,
  typeId?: string,
): OpenEndpoint | null {
  let best: OpenEndpoint | null = null;
  for (const way of ways) {
    if (typeId && way.typeId !== typeId) continue;
    if (way.points.length === 0) continue;
    const candidates: ['start' | 'end', LngLat][] = [
      ['start', way.points[0]],
      ['end', way.points[way.points.length - 1]],
    ];
    for (const [end, pt] of candidates) {
      const distMeters = haversineMeters(coord, pt);
      if (distMeters <= maxMeters && (best === null || distMeters < best.distMeters)) {
        best = { wayId: way.id, end, coord: pt, distMeters };
      }
    }
  }
  return best;
}
