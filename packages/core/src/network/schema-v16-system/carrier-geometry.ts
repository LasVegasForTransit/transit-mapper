import type { GeographicBounds, LngLat } from '../../geography/bounds';
import { cumulativeLengths } from '../../model/geo/measurement';
import { resolveWayPath } from '../../model/geo/wayPath';
import type { Way } from '../../model/system';
import type { ResolvedCarrierFragment } from '../resolved-network-chunk';
import { legacyDerivedId } from './identity';

type BoundsWindow = readonly [west: number, south: number, east: number, north: number];
type FragmentRole = 'topology' | 'visible';
const POSITION_EPSILON = 1e-12;

interface PositionedPoint {
  point: LngLat;
  position: number;
}

export interface CarrierPiece {
  carrier: ResolvedCarrierFragment;
  range: readonly [number, number];
}

function boundsWindows(bounds: GeographicBounds): readonly BoundsWindow[] {
  if (bounds.kind === 'ordinary') return [[bounds.west, bounds.south, bounds.east, bounds.north]];
  return [
    [bounds.west, bounds.south, 180, bounds.north],
    [-180, bounds.south, bounds.east, bounds.north],
  ];
}

function shiftedWindow([west, south, east, north]: BoundsWindow, shift: number): BoundsWindow {
  return [west + shift, south, east + shift, north];
}

function clippingWindows(
  path: readonly PositionedPoint[],
  bounds: GeographicBounds,
): BoundsWindow[] {
  const longitudes = path.map(({ point }) => point[0]);
  const west = Math.min(...longitudes);
  const east = Math.max(...longitudes);
  const center = (west + east) / 2;
  const result = new Map<string, BoundsWindow>();
  for (const window of boundsWindows(bounds)) {
    const windowCenter = (window[0] + window[2]) / 2;
    const nearestShift = Math.round((center - windowCenter) / 360) * 360;
    for (const offset of [-360, 0, 360]) {
      const shift = nearestShift + offset;
      const shifted = shiftedWindow(window, shift);
      if (shifted[2] < west || shifted[0] > east) continue;
      result.set(`${shift}:${window.join(':')}`, shifted);
    }
  }
  return [...result.values()];
}

function normalized(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return Object.is(clamped, -0) ? 0 : clamped;
}

function positionKey(value: number): string {
  return String(normalized(value));
}

function samePoint(left: LngLat, right: LngLat): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function interpolate(
  start: PositionedPoint,
  end: PositionedPoint,
  progress: number,
): PositionedPoint {
  if (progress === 0) return start;
  if (progress === 1) return end;
  return {
    point: [
      start.point[0] + (end.point[0] - start.point[0]) * progress,
      start.point[1] + (end.point[1] - start.point[1]) * progress,
    ],
    position: normalized(start.position + (end.position - start.position) * progress),
  };
}

function positionedPath(way: Way): PositionedPoint[] {
  const points = resolveWayPath(way);
  const lengths = cumulativeLengths(points);
  const total = lengths.at(-1) ?? 0;
  const denominator = Math.max(1, points.length - 1);
  const result: PositionedPoint[] = [];
  for (let sourceIndex = 0; sourceIndex < points.length; sourceIndex += 1) {
    const point = points[sourceIndex];
    const previousLongitude = result.at(-1)?.point[0];
    const longitude =
      previousLongitude === undefined
        ? point[0]
        : point[0] + Math.round((previousLongitude - point[0]) / 360) * 360;
    result.push({
      point: [longitude, point[1]],
      position: total === 0 ? sourceIndex / denominator : lengths[sourceIndex] / total,
    });
  }
  return result;
}

function pointAtPosition(path: readonly PositionedPoint[], position: number): PositionedPoint {
  const target = normalized(position);
  const exact = path.find((candidate) => Math.abs(candidate.position - target) <= POSITION_EPSILON);
  if (exact) return { ...exact, position: target };
  for (let index = 1; index < path.length; index += 1) {
    const start = path[index - 1];
    const end = path[index];
    if (target < start.position || target > end.position) continue;
    const span = end.position - start.position;
    return interpolate(start, end, span === 0 ? 0 : (target - start.position) / span);
  }
  return target <= 0 ? path[0] : path[path.length - 1];
}

function appendPoint(target: PositionedPoint[], point: PositionedPoint): void {
  const previous = target.at(-1);
  if (
    !previous ||
    !samePoint(previous.point, point.point) ||
    previous.position !== point.position
  ) {
    target.push(point);
    return;
  }
}

function slicePositionedPath(
  path: readonly PositionedPoint[],
  range: readonly [number, number],
): PositionedPoint[] {
  const startPosition = normalized(Math.min(range[0], range[1]));
  const endPosition = normalized(Math.max(range[0], range[1]));
  const result: PositionedPoint[] = [];
  appendPoint(result, pointAtPosition(path, startPosition));
  for (const point of path) {
    if (
      point.position > startPosition + POSITION_EPSILON &&
      point.position < endPosition - POSITION_EPSILON
    ) {
      appendPoint(result, point);
    }
  }
  appendPoint(result, pointAtPosition(path, endPosition));
  return result;
}

function clippedSegment(
  start: PositionedPoint,
  end: PositionedPoint,
  [west, south, east, north]: BoundsWindow,
): readonly [PositionedPoint, PositionedPoint] | undefined {
  const dx = end.point[0] - start.point[0];
  const dy = end.point[1] - start.point[1];
  let lower = 0;
  let upper = 1;
  for (const [p, q] of [
    [-dx, start.point[0] - west],
    [dx, east - start.point[0]],
    [-dy, start.point[1] - south],
    [dy, north - start.point[1]],
  ] as const) {
    if (p === 0) {
      if (q < 0) return undefined;
      continue;
    }
    const ratio = q / p;
    if (p < 0) lower = Math.max(lower, ratio);
    else upper = Math.min(upper, ratio);
    if (lower > upper) return undefined;
  }
  return [interpolate(start, end, lower), interpolate(start, end, upper)];
}

function clipPathToWindow(
  path: readonly PositionedPoint[],
  window: BoundsWindow,
): PositionedPoint[][] {
  const pieces: PositionedPoint[][] = [];
  let current: PositionedPoint[] = [];
  const finish = () => {
    if (current.length >= 2) pieces.push(current);
    current = [];
  };
  for (let index = 1; index < path.length; index += 1) {
    const segment = clippedSegment(path[index - 1], path[index], window);
    if (!segment) {
      finish();
      continue;
    }
    const [start, end] = segment;
    const previous = current.at(-1);
    if (
      previous &&
      (!samePoint(previous.point, start.point) || previous.position !== start.position)
    ) {
      finish();
    }
    appendPoint(current, start);
    appendPoint(current, end);
  }
  finish();
  return pieces;
}

function carrierId(
  role: FragmentRole,
  way: Way,
  laneId: string | undefined,
  range: readonly [number, number],
): string {
  return legacyDerivedId(
    `${role}-carrier-fragment`,
    way.id,
    ...(laneId === undefined ? ['auto'] : ['lane', laneId]),
    positionKey(range[0]),
    positionKey(range[1]),
  );
}

function canonicalizeVisiblePath(path: readonly PositionedPoint[]): PositionedPoint[] {
  const longitudes = path.map(({ point }) => point[0]);
  const center = (Math.min(...longitudes) + Math.max(...longitudes)) / 2;
  const shift = Math.floor((center + 180) / 360) * 360;
  if (shift === 0) return [...path];
  return path.map((point) => ({
    ...point,
    point: [point.point[0] - shift, point.point[1]],
  }));
}

function wrappedLongitude(longitude: number): number {
  if (longitude >= -180 && longitude <= 180) return longitude;
  const wrapped = ((((longitude + 180) % 360) + 360) % 360) - 180;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

function wrapPath(path: readonly PositionedPoint[]): PositionedPoint[] {
  return path.map((point) => ({
    ...point,
    point: [wrappedLongitude(point.point[0]), point.point[1]],
  }));
}

function mapCarrierPiece(
  way: Way,
  laneId: string | undefined,
  role: FragmentRole,
  path: readonly PositionedPoint[],
): CarrierPiece | undefined {
  if (path.length < 2) return undefined;
  const range = [normalized(path[0].position), normalized(path[path.length - 1].position)] as const;
  if (range[0] === range[1]) return undefined;
  const points = path.map(({ point }) => point);
  return {
    range,
    carrier: {
      id: carrierId(role, way, laneId, range),
      carrier:
        laneId === undefined ? { kind: 'way', id: way.id } : { kind: 'way', id: way.id, laneId },
      alignmentId: way.id,
      alignmentRange: range,
      points: [points[0], points[1], ...points.slice(2)],
      // Clipping a curved control polygon cannot preserve the source arc at
      // an interpolated boundary. The resolved path is already tessellated to
      // the model error bound, so transfer that evidence without claiming the
      // fragment still owns the omitted curve controls.
      geometry: way.geometry === 'curved' ? 'freeform' : way.geometry,
      curveControls: [],
    },
  };
}

export function clippedCarrierPieces(
  way: Way,
  laneId: string | undefined,
  range: readonly [number, number],
  bounds: GeographicBounds,
): CarrierPiece[] {
  const sliced = slicePositionedPath(positionedPath(way), range);
  const byRange = new Map<string, CarrierPiece>();
  for (const window of clippingWindows(sliced, bounds)) {
    for (const path of clipPathToWindow(sliced, window)) {
      const piece = mapCarrierPiece(way, laneId, 'visible', canonicalizeVisiblePath(path));
      if (piece)
        byRange.set(`${positionKey(piece.range[0])}:${positionKey(piece.range[1])}`, piece);
    }
  }
  return [...byRange.values()].sort((left, right) =>
    left.range[0] === right.range[0]
      ? left.range[1] - right.range[1]
      : left.range[0] - right.range[0],
  );
}

export function topologyCarrierPiece(
  way: Way,
  laneId: string | undefined,
  range: readonly [number, number],
): CarrierPiece | undefined {
  return mapCarrierPiece(
    way,
    laneId,
    'topology',
    wrapPath(slicePositionedPath(positionedPath(way), range)),
  );
}

export function patternLegFragmentId(
  role: FragmentRole,
  parentId: string,
  range: readonly [number, number],
): string {
  return legacyDerivedId(
    `${role}-pattern-leg-fragment`,
    parentId,
    positionKey(range[0]),
    positionKey(range[1]),
  );
}
