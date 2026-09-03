import type { LngLat } from '../model/system';
import type { ViewportSpatialEntry } from './viewport-index-entries';

const VIEWPORT_CELL_DEGREES = 0.02;
const MAX_ENTRY_GRID_CELLS = 1024;
const MAX_VIEWPORT_QUERY_CELLS = 4_096;

/** Maximum segment-in-cell references an immutable index may allocate. */
export const MAX_VIEWPORT_GRID_ENTRIES = 250_000;

export interface ViewportSpatialGrid {
  entries: readonly ViewportSpatialEntry[];
  cells: ReadonlyMap<number, readonly number[]>;
  oversize: ReadonlySet<number>;
  gridEntryCount: number;
}

export interface ViewportSpatialGridDraft {
  readonly entries: ViewportSpatialEntry[];
  entryCount: number;
  readonly cells: Map<number, number[]>;
  readonly oversize: Set<number>;
  gridEntryCount: number;
  readonly budget: ViewportGridBuildBudget;
}

export interface ViewportGridBuildBudget {
  totalEntries: number;
}

export interface ViewportSpatialQueryResult {
  ids: readonly string[];
  coarseCandidates: number;
  exactChecks: number;
}

export interface NormalizedViewportBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface SegmentIndexTarget {
  cells: Map<number, number[]>;
  oversize: Set<number>;
  gridEntryCount: number;
  budget: ViewportGridBuildBudget;
}

function cellKey(x: number, y: number): number {
  // Valid longitude/latitude coordinates occupy far less than 16 bits per
  // axis at the viewport grid resolution. Packing both signed coordinates
  // avoids allocating a short-lived string for every indexed segment and
  // camera query while remaining collision-free over the geographic domain.
  return ((x & 0xffff) << 16) | (y & 0xffff);
}

function cellCoordinate(value: number): number {
  return Math.floor(value / VIEWPORT_CELL_DEGREES);
}

export function normalizeViewportSpatialBounds(
  bounds: [LngLat, LngLat],
  margin: number,
): NormalizedViewportBounds {
  const safeMargin = Number.isFinite(margin) ? Math.max(0, margin) : 0;
  return {
    minX: Math.min(bounds[0][0], bounds[1][0]) - safeMargin,
    minY: Math.min(bounds[0][1], bounds[1][1]) - safeMargin,
    maxX: Math.max(bounds[0][0], bounds[1][0]) + safeMargin,
    maxY: Math.max(bounds[0][1], bounds[1][1]) + safeMargin,
  };
}

function addCellEntry(cells: Map<number, number[]>, key: number, entryIndex: number): void {
  const bucket = cells.get(key);
  if (bucket) bucket.push(entryIndex);
  else cells.set(key, [entryIndex]);
}

function indexSegment(
  target: SegmentIndexTarget,
  entryIndex: number,
  a: LngLat,
  b: LngLat,
): boolean {
  const x0 = cellCoordinate(Math.min(a[0], b[0]));
  const x1 = cellCoordinate(Math.max(a[0], b[0]));
  const y0 = cellCoordinate(Math.min(a[1], b[1]));
  const y1 = cellCoordinate(Math.max(a[1], b[1]));
  const span = (x1 - x0 + 1) * (y1 - y0 + 1);
  if (
    !Number.isSafeInteger(span) ||
    span > MAX_ENTRY_GRID_CELLS ||
    target.budget.totalEntries + span > MAX_VIEWPORT_GRID_ENTRIES
  ) {
    target.oversize.add(entryIndex);
    return false;
  }
  target.gridEntryCount += span;
  target.budget.totalEntries += span;
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) addCellEntry(target.cells, cellKey(x, y), entryIndex);
  }
  return true;
}

function pathBounds(path: readonly LngLat[]): [LngLat, LngLat] | null {
  if (path.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of path) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [
    [minX, minY],
    [maxX, maxY],
  ];
}

function indexSpatialPath(
  target: SegmentIndexTarget,
  entryIndex: number,
  path: readonly LngLat[],
  filled: boolean,
): boolean {
  if (filled) {
    const bounds = pathBounds(path);
    return bounds ? indexSegment(target, entryIndex, bounds[0], bounds[1]) : false;
  }
  if (path.length === 1) return indexSegment(target, entryIndex, path[0], path[0]);
  let indexed = false;
  for (let pointIndex = 1; pointIndex < path.length; pointIndex++) {
    indexed = indexSegment(target, entryIndex, path[pointIndex - 1], path[pointIndex]) || indexed;
  }
  return indexed;
}

export function buildViewportSpatialGrid(
  entries: ViewportSpatialEntry[],
  budget: ViewportGridBuildBudget,
): ViewportSpatialGrid {
  const draft = createViewportSpatialGridDraft(budget);
  addViewportSpatialEntries(draft, entries);
  return finalizeViewportSpatialGrid(draft);
}

export function createViewportSpatialGridDraft(
  budget: ViewportGridBuildBudget = { totalEntries: 0 },
): ViewportSpatialGridDraft {
  return {
    entries: [],
    entryCount: 0,
    cells: new Map(),
    oversize: new Set(),
    gridEntryCount: 0,
    budget,
  };
}

export function addViewportSpatialEntries(
  draft: ViewportSpatialGridDraft,
  entries: readonly ViewportSpatialEntry[],
): void {
  const start = draft.entryCount;
  appendUnindexedViewportSpatialEntries(draft, entries);
  for (let entryIndex = start; entryIndex < draft.entryCount; entryIndex++) {
    indexViewportSpatialEntry(draft, entryIndex);
  }
}

/** Records immutable entry geometry without indexing it. Cold preparation
 * uses this to keep metadata-map growth and spatial-map growth in separate
 * measured units instead of paying both resize costs in one scheduler slice. */
export function appendUnindexedViewportSpatialEntries(
  draft: ViewportSpatialGridDraft,
  entries: readonly ViewportSpatialEntry[],
): void {
  for (const entry of entries) appendUnindexedViewportSpatialEntry(draft, entry);
}

export function appendUnindexedViewportSpatialEntry(
  draft: ViewportSpatialGridDraft,
  entry: ViewportSpatialEntry,
): void {
  draft.entries[draft.entryCount++] = entry;
}

export function reserveViewportSpatialEntryCapacity(
  draft: ViewportSpatialGridDraft,
  additionalEntries: number,
): void {
  draft.entries.length = Math.max(draft.entries.length, draft.entryCount + additionalEntries);
}

export function indexViewportSpatialEntry(
  draft: ViewportSpatialGridDraft,
  entryIndex: number,
): void {
  const entry = draft.entries[entryIndex];
  let indexedAnyGeometry = false;
  for (const path of entry.paths) {
    indexedAnyGeometry =
      indexSpatialPath(draft, entryIndex, path, entry.filledPaths?.includes(path) ?? false) ||
      indexedAnyGeometry;
  }
  // Empty label/group paths never become visible. Non-empty entries that
  // exceed the shared budget remain authoritative through the exact scan.
  if (!indexedAnyGeometry && entry.paths.some((path) => path.length > 0)) {
    draft.oversize.add(entryIndex);
  }
}

export interface ViewportSpatialEntryPathRange {
  readonly entry: ViewportSpatialEntry;
  readonly pathIndex: number;
  readonly segmentStart: number;
  readonly segmentEnd: number;
}

export interface IndexViewportSpatialEntryPathRangeOptions extends Omit<
  ViewportSpatialEntryPathRange,
  'entry'
> {
  readonly draft: ViewportSpatialGridDraft;
  readonly entryIndex: number;
}

export function indexViewportSpatialEntryPathRange({
  draft,
  entryIndex,
  pathIndex,
  segmentStart,
  segmentEnd,
}: IndexViewportSpatialEntryPathRangeOptions): void {
  const path = draft.entries[entryIndex].paths[pathIndex] ?? [];
  if (path.length === 1 && segmentStart === 0) {
    indexSegment(draft, entryIndex, path[0], path[0]);
    return;
  }
  const end = Math.min(segmentEnd, Math.max(0, path.length - 1));
  for (let segment = Math.max(0, segmentStart); segment < end; segment++) {
    indexSegment(draft, entryIndex, path[segment], path[segment + 1]);
  }
}

export function finalizeViewportSpatialGrid(draft: ViewportSpatialGridDraft): ViewportSpatialGrid {
  draft.entries.length = draft.entryCount;
  return {
    entries: draft.entries,
    cells: draft.cells,
    oversize: draft.oversize,
    gridEntryCount: draft.gridEntryCount,
  };
}

function segmentIntersectsBounds(a: LngLat, b: LngLat, bounds: NormalizedViewportBounds): boolean {
  const ax = a[0];
  const ay = a[1];
  const dx = b[0] - ax;
  const dy = b[1] - ay;
  let start = 0;
  let end = 1;
  // Parallel number arrays rather than an array of pairs: this is the hottest
  // leaf in candidate selection, and the pair form allocated five objects per
  // call to compare four edges.
  const directions = [-dx, dx, -dy, dy];
  const distances = [ax - bounds.minX, bounds.maxX - ax, ay - bounds.minY, bounds.maxY - ay];
  for (let edge = 0; edge < 4; edge += 1) {
    const direction = directions[edge];
    const distance = distances[edge];
    if (direction === 0) {
      if (distance < 0) return false;
      continue;
    }
    const ratio = distance / direction;
    if (direction < 0) start = Math.max(start, ratio);
    else end = Math.min(end, ratio);
    if (start > end) return false;
  }
  return true;
}

function pathContainsPoint(path: readonly LngLat[], point: LngLat): boolean {
  let inside = false;
  for (let current = 0, previous = path.length - 1; current < path.length; previous = current++) {
    const [currentX, currentY] = path[current];
    const [previousX, previousY] = path[previous];
    const crosses = currentY > point[1] !== previousY > point[1];
    if (!crosses) continue;
    const edgeX =
      ((previousX - currentX) * (point[1] - currentY)) / (previousY - currentY) + currentX;
    if (point[0] < edgeX) inside = !inside;
  }
  return inside;
}

function entryIntersectsBounds(
  entry: ViewportSpatialEntry,
  bounds: NormalizedViewportBounds,
): boolean {
  for (const path of entry.paths) {
    if (path.length === 1) {
      const [x, y] = path[0];
      if (x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY) {
        return true;
      }
    }
    for (let index = 1; index < path.length; index++) {
      if (segmentIntersectsBounds(path[index - 1], path[index], bounds)) return true;
    }
  }
  const viewportCenter: LngLat = [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2];
  if (entry.filledPaths?.some((path) => pathContainsPoint(path, viewportCenter))) return true;
  return false;
}

export function viewportSpatialEntryIntersectsBounds(
  entry: ViewportSpatialEntry,
  bounds: [LngLat, LngLat],
  transitionMarginDegrees: number,
): boolean {
  return entryIntersectsBounds(
    entry,
    normalizeViewportSpatialBounds(bounds, transitionMarginDegrees),
  );
}

export function viewportSpatialEntryIntersectsNormalizedBounds(
  entry: ViewportSpatialEntry,
  bounds: NormalizedViewportBounds,
): boolean {
  return entryIntersectsBounds(entry, bounds);
}

export interface ViewportSpatialEntryPathRangeIntersectionOptions extends ViewportSpatialEntryPathRange {
  readonly bounds: NormalizedViewportBounds;
}

export function viewportSpatialEntryPathRangeIntersectsNormalizedBounds({
  entry,
  pathIndex,
  segmentStart,
  segmentEnd,
  bounds,
}: ViewportSpatialEntryPathRangeIntersectionOptions): boolean {
  const path = entry.paths[pathIndex] ?? [];
  if (path.length === 1 && segmentStart === 0) {
    const [x, y] = path[0];
    return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
  }
  const end = Math.min(segmentEnd, Math.max(0, path.length - 1));
  for (let segment = Math.max(0, segmentStart); segment < end; segment++) {
    if (segmentIntersectsBounds(path[segment], path[segment + 1], bounds)) return true;
  }
  return false;
}

function indexedCandidates(
  grid: ViewportSpatialGrid,
  bounds: NormalizedViewportBounds,
): Set<number> | null {
  const minCellX = cellCoordinate(bounds.minX);
  const maxCellX = cellCoordinate(bounds.maxX);
  const minCellY = cellCoordinate(bounds.minY);
  const maxCellY = cellCoordinate(bounds.maxY);
  const cellCount = (maxCellX - minCellX + 1) * (maxCellY - minCellY + 1);
  if (!Number.isSafeInteger(cellCount) || cellCount > MAX_VIEWPORT_QUERY_CELLS) {
    // Exact range units will still test every entry. Avoid allocating and
    // filling a city-sized identity Set merely to express "all candidates".
    return null;
  }
  const candidates = new Set<number>();
  for (let x = minCellX; x <= maxCellX; x++) {
    for (let y = minCellY; y <= maxCellY; y++) {
      const bucket = grid.cells.get(cellKey(x, y));
      if (bucket) for (const index of bucket) candidates.add(index);
    }
  }
  for (const index of grid.oversize) candidates.add(index);
  return candidates;
}

function queryIndexedViewportSpatialGrid(query: ViewportSpatialQuery): readonly string[] {
  const indexes = [...(query.candidates ?? [])].sort((left, right) => left - right);
  const ids: string[] = [];
  for (const index of indexes) {
    const entry = query.grid.entries[index];
    if (entryIntersectsBounds(entry, query.bounds)) ids.push(entry.id);
  }
  return ids;
}

export function queryViewportSpatialGrid(
  grid: ViewportSpatialGrid,
  bounds: [LngLat, LngLat],
  transitionMarginDegrees: number,
): ViewportSpatialQueryResult {
  const query = beginViewportSpatialQuery(grid, bounds, transitionMarginDegrees);
  const ids = query.candidates
    ? queryIndexedViewportSpatialGrid(query)
    : queryViewportSpatialGridRange(query, 0, grid.entries.length);
  const candidateCount = query.candidates?.size ?? grid.entries.length;
  return { ids, coarseCandidates: candidateCount, exactChecks: candidateCount };
}

export interface ViewportSpatialQuery {
  readonly grid: ViewportSpatialGrid;
  readonly bounds: NormalizedViewportBounds;
  /** Null means exact-check every entry without allocating an identity Set. */
  readonly candidates: ReadonlySet<number> | null;
}

export function beginViewportSpatialQuery(
  grid: ViewportSpatialGrid,
  bounds: [LngLat, LngLat],
  transitionMarginDegrees: number,
): ViewportSpatialQuery {
  const normalized = normalizeViewportSpatialBounds(bounds, transitionMarginDegrees);
  return { grid, bounds: normalized, candidates: indexedCandidates(grid, normalized) };
}

export function queryViewportSpatialGridRange(
  query: ViewportSpatialQuery,
  start: number,
  end: number,
): readonly string[] {
  const ids: string[] = [];
  const upperBound = Math.min(end, query.grid.entries.length);
  for (let index = Math.max(0, start); index < upperBound; index++) {
    if (query.candidates && !query.candidates.has(index)) continue;
    const entry = query.grid.entries[index];
    if (entryIntersectsBounds(entry, query.bounds)) ids.push(entry.id);
  }
  return ids;
}
