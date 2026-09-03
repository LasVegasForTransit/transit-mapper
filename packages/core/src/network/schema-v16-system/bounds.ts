import type { GeographicBounds, LngLat } from '../../geography/bounds';
import type { GeographicPolygon } from '../../geography/coverage';
import type { ResolvedAreaFragment } from '../resolved-network-chunk';
import { legacyDerivedId } from './identity';

type BoundsWindow = readonly [west: number, south: number, east: number, north: number];

function boundsWindows(bounds: GeographicBounds): readonly BoundsWindow[] {
  if (bounds.kind === 'ordinary') return [[bounds.west, bounds.south, bounds.east, bounds.north]];
  return [
    [bounds.west, bounds.south, 180, bounds.north],
    [-180, bounds.south, bounds.east, bounds.north],
  ];
}

function pointInWindow(point: LngLat, [west, south, east, north]: BoundsWindow): boolean {
  return point[0] >= west && point[0] <= east && point[1] >= south && point[1] <= north;
}

function linearSegmentIntersectsWindow(a: LngLat, b: LngLat, window: BoundsWindow): boolean {
  if (pointInWindow(a, window) || pointInWindow(b, window)) return true;
  const [west, south, east, north] = window;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let lower = 0;
  let upper = 1;
  for (const [p, q] of [
    [-dx, a[0] - west],
    [dx, east - a[0]],
    [-dy, a[1] - south],
    [dy, north - a[1]],
  ] as const) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const ratio = q / p;
    if (p < 0) lower = Math.max(lower, ratio);
    else upper = Math.min(upper, ratio);
    if (lower > upper) return false;
  }
  return true;
}

function nearestLongitude(longitude: number, reference: number): number {
  return longitude + Math.round((reference - longitude) / 360) * 360;
}

function shiftedWindow(window: BoundsWindow, shift: number): BoundsWindow {
  return [window[0] + shift, window[1], window[2] + shift, window[3]];
}

function segmentIntersectsWindow(start: LngLat, end: LngLat, window: BoundsWindow): boolean {
  const unwrappedEnd: LngLat = [nearestLongitude(end[0], start[0]), end[1]];
  const segmentCenter = (start[0] + unwrappedEnd[0]) / 2;
  const windowCenter = (window[0] + window[2]) / 2;
  const nearestShift = Math.round((segmentCenter - windowCenter) / 360) * 360;
  return [-360, 0, 360].some((offset) =>
    linearSegmentIntersectsWindow(
      start,
      unwrappedEnd,
      shiftedWindow(window, nearestShift + offset),
    ),
  );
}

export function pathIntersectsBounds(path: readonly LngLat[], bounds: GeographicBounds): boolean {
  if (path.length === 0) return false;
  return boundsWindows(bounds).some((window) => pathIntersectsWindow(path, window));
}

function pathIntersectsWindow(path: readonly LngLat[], window: BoundsWindow): boolean {
  if (path.some((point) => pointInWindow(point, window))) return true;
  for (let index = 1; index < path.length; index += 1) {
    if (segmentIntersectsWindow(path[index - 1], path[index], window)) return true;
  }
  return false;
}

export function pointInBounds(point: LngLat, bounds: GeographicBounds): boolean {
  return boundsWindows(bounds).some((window) => pointInWindow(point, window));
}

export function validCoordinate(point: readonly number[]): point is [number, number] {
  return (
    point.length === 2 &&
    Number.isFinite(point[0]) &&
    Number.isFinite(point[1]) &&
    point[0] >= -180 &&
    point[0] <= 180 &&
    point[1] >= -90 &&
    point[1] <= 90
  );
}

function samePoint(left: LngLat, right: LngLat): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function openRing(points: readonly LngLat[]): LngLat[] {
  if (points.length < 2 || !samePoint(points[0], points.at(-1) ?? points[0])) {
    return [...points];
  }
  return points.slice(0, -1);
}

function unwrapRing(points: readonly LngLat[]): LngLat[] {
  const source = openRing(points);
  if (source.length === 0) return [];
  const unwrapped: LngLat[] = [source[0]];
  for (const point of source.slice(1)) {
    const previous = unwrapped.at(-1) ?? source[0];
    unwrapped.push([nearestLongitude(point[0], previous[0]), point[1]]);
  }
  return unwrapped;
}

function longitudeRange(points: readonly LngLat[]): readonly [number, number] {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const [longitude] of points) {
    minimum = Math.min(minimum, longitude);
    maximum = Math.max(maximum, longitude);
  }
  return [minimum, maximum];
}

function ringAreaTwice(points: readonly LngLat[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current[0] * next[1] - next[0] * current[1];
  }
  return area;
}

export function mappedPolygon(points: readonly LngLat[]): GeographicPolygon | undefined {
  if (points.length < 3 || !points.every(validCoordinate)) return undefined;
  const vertices = openRing(points);
  if (vertices.length < 3) return undefined;
  const distinct = new Set(vertices.map(([longitude, latitude]) => `${longitude}\0${latitude}`));
  const unwrapped = unwrapRing(vertices);
  const [minimum, maximum] = longitudeRange(unwrapped);
  if (distinct.size < 3 || maximum - minimum >= 360 || ringAreaTwice(unwrapped) === 0) {
    return undefined;
  }
  const outer = [...vertices, vertices[0]];
  return {
    outer: [outer[0], outer[1], outer[2], outer[3], ...outer.slice(4)],
    holes: [],
  };
}

function pointOnSegment(point: LngLat, start: LngLat, end: LngLat): boolean {
  const cross =
    (point[1] - start[1]) * (end[0] - start[0]) - (point[0] - start[0]) * (end[1] - start[1]);
  if (Math.abs(cross) > Number.EPSILON * 16) return false;
  return (
    point[0] >= Math.min(start[0], end[0]) &&
    point[0] <= Math.max(start[0], end[0]) &&
    point[1] >= Math.min(start[1], end[1]) &&
    point[1] <= Math.max(start[1], end[1])
  );
}

function pointInRing(point: LngLat, ring: readonly LngLat[]): boolean {
  const vertices = unwrapRing(ring);
  const [minimum, maximum] = longitudeRange(vertices);
  const center = (minimum + maximum) / 2;
  const unwrappedPoint: LngLat = [nearestLongitude(point[0], center), point[1]];
  let inside = false;
  for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index++) {
    const start = vertices[previous];
    const end = vertices[index];
    if (pointOnSegment(unwrappedPoint, start, end)) return true;
    const crossesLatitude = start[1] > unwrappedPoint[1] !== end[1] > unwrappedPoint[1];
    if (!crossesLatitude) continue;
    const crossingLongitude =
      ((end[0] - start[0]) * (unwrappedPoint[1] - start[1])) / (end[1] - start[1]) + start[0];
    if (unwrappedPoint[0] < crossingLongitude) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point: LngLat, polygon: GeographicPolygon): boolean {
  if (!pointInRing(point, polygon.outer)) return false;
  return !polygon.holes.some((hole) => pointInRing(point, hole));
}

function windowCorners([west, south, east, north]: BoundsWindow): readonly LngLat[] {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
  ];
}

function polygonIntersectsWindow(polygon: GeographicPolygon, window: BoundsWindow): boolean {
  if (pathIntersectsWindow(polygon.outer, window)) return true;
  if (polygon.holes.some((hole) => pathIntersectsWindow(hole, window))) return true;
  return windowCorners(window).some((corner) => pointInPolygon(corner, polygon));
}

export function polygonIntersectsBounds(
  polygon: GeographicPolygon,
  bounds: GeographicBounds,
): boolean {
  return boundsWindows(bounds).some((window) => polygonIntersectsWindow(polygon, window));
}

function clipAgainstBoundary(
  input: readonly LngLat[],
  inside: (point: LngLat) => boolean,
  intersection: (start: LngLat, end: LngLat) => LngLat,
): LngLat[] {
  if (input.length === 0) return [];
  const output: LngLat[] = [];
  let start = input.at(-1) ?? input[0];
  let startInside = inside(start);
  for (const end of input) {
    const endInside = inside(end);
    if (endInside !== startInside) output.push(intersection(start, end));
    if (endInside) output.push(end);
    start = end;
    startInside = endInside;
  }
  return output;
}

function verticalIntersection(start: LngLat, end: LngLat, longitude: number): LngLat {
  const progress = (longitude - start[0]) / (end[0] - start[0]);
  return [longitude, start[1] + (end[1] - start[1]) * progress];
}

function horizontalIntersection(start: LngLat, end: LngLat, latitude: number): LngLat {
  const progress = (latitude - start[1]) / (end[1] - start[1]);
  return [start[0] + (end[0] - start[0]) * progress, latitude];
}

function clipRingToWindow(ring: readonly LngLat[], window: BoundsWindow): LngLat[] {
  const [west, south, east, north] = window;
  let clipped = openRing(ring);
  clipped = clipAgainstBoundary(
    clipped,
    ([longitude]) => longitude >= west,
    (start, end) => verticalIntersection(start, end, west),
  );
  clipped = clipAgainstBoundary(
    clipped,
    ([longitude]) => longitude <= east,
    (start, end) => verticalIntersection(start, end, east),
  );
  clipped = clipAgainstBoundary(
    clipped,
    ([, latitude]) => latitude >= south,
    (start, end) => horizontalIntersection(start, end, south),
  );
  return clipAgainstBoundary(
    clipped,
    ([, latitude]) => latitude <= north,
    (start, end) => horizontalIntersection(start, end, north),
  );
}

function windowShiftsForRing(ring: readonly LngLat[], window: BoundsWindow): number[] {
  const [minimum, maximum] = longitudeRange(ring);
  const first = Math.ceil((minimum - window[2]) / 360);
  const last = Math.floor((maximum - window[0]) / 360);
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => (first + index) * 360);
}

export function clipPolygonToBounds(
  polygon: GeographicPolygon,
  bounds: GeographicBounds,
): GeographicPolygon[] {
  const ring = unwrapRing(polygon.outer);
  return boundsWindows(bounds).flatMap((window) => {
    return windowShiftsForRing(ring, window).flatMap((shift) => {
      const clipped = clipRingToWindow(ring, shiftedWindow(window, shift)).map(
        ([longitude, latitude]) => [longitude - shift, latitude] as LngLat,
      );
      const mapped = mappedPolygon(clipped);
      return mapped ? [mapped] : [];
    });
  });
}

function polygonIdentity(polygon: GeographicPolygon): string {
  return polygon.outer
    .map(([longitude, latitude]) => `${String(longitude)},${String(latitude)}`)
    .join(';');
}

export function clipAreaFragments(
  owner: ResolvedAreaFragment['owner'],
  polygon: GeographicPolygon,
  bounds: GeographicBounds,
): ResolvedAreaFragment[] {
  return clipPolygonToBounds(polygon, bounds).map((clipped) => ({
    id: legacyDerivedId('area', owner.kind, owner.id, polygonIdentity(clipped)),
    owner,
    polygon: clipped,
  }));
}
