/**
 * Resolves a corridor's authored control points into local-meter primitives.
 *
 * A curve is described as a line/arc sequence instead of a pre-sampled path so
 * every consumer can choose its own screen-error bound. The geometry stays
 * local to the corridor: latitude, camera zoom, and the number of consumers
 * never change the physical radius or tangent points.
 */
import type { CurveControl, LngLat } from '../model/system';
import { createMetricPlane, type MetricPlane, type MetricPoint } from './metric-plane';

const STRAIGHT_ANGLE_EPSILON_RAD = 1e-6;
const AUTOMATIC_TANGENT_FRACTION = 0.25;

export interface MetricLine {
  readonly kind: 'line';
  readonly start: MetricPoint;
  readonly end: MetricPoint;
}

export interface MetricArc {
  readonly kind: 'arc';
  readonly start: MetricPoint;
  readonly end: MetricPoint;
  readonly center: MetricPoint;
  readonly radiusM: number;
  /** Radius after protecting neighboring corners from consuming a segment. */
  readonly effectiveRadiusM: number;
  readonly wasClamped: boolean;
  readonly startAngleRad: number;
  /** Signed sweep: positive for a left turn, negative for a right turn. */
  readonly sweepRad: number;
}

export type MetricCenterlinePrimitive = MetricLine | MetricArc;

export interface MetricCenterline {
  readonly plane: MetricPlane;
  readonly primitives: readonly MetricCenterlinePrimitive[];
}

export interface ResolveMetricCenterlineOptions {
  readonly curveControls?: readonly CurveControl[];
}

interface Vector {
  readonly x: number;
  readonly y: number;
}

interface Corner {
  readonly pointIndex: number;
  readonly incoming: Vector;
  readonly outgoing: Vector;
  readonly incomingLengthM: number;
  readonly outgoingLengthM: number;
  readonly turnRad: number;
  readonly turnDirection: 1 | -1;
}

function subtract(left: MetricPoint, right: MetricPoint): Vector {
  return { x: left.x - right.x, y: left.y - right.y };
}

function add(point: MetricPoint, vector: Vector): MetricPoint {
  return { x: point.x + vector.x, y: point.y + vector.y };
}

function scale(vector: Vector, factor: number): Vector {
  return { x: vector.x * factor, y: vector.y * factor };
}

function length(vector: Vector): number {
  return Math.hypot(vector.x, vector.y);
}

function normalized(vector: Vector): Vector | null {
  const magnitude = length(vector);
  return magnitude > 0 ? scale(vector, 1 / magnitude) : null;
}

function dot(left: Vector, right: Vector): number {
  return left.x * right.x + left.y * right.y;
}

function cross(left: Vector, right: Vector): number {
  return left.x * right.y - left.y * right.x;
}

function leftNormal(vector: Vector): Vector {
  return { x: -vector.y, y: vector.x };
}

function samePoint(left: MetricPoint, right: MetricPoint): boolean {
  return left.x === right.x && left.y === right.y;
}

function clampUnit(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function directedSweep(startAngleRad: number, endAngleRad: number, direction: 1 | -1): number {
  let sweep = endAngleRad - startAngleRad;
  if (direction > 0 && sweep < 0) sweep += Math.PI * 2;
  if (direction < 0 && sweep > 0) sweep -= Math.PI * 2;
  return sweep;
}

function controlsByPoint(
  controls: readonly CurveControl[] | undefined,
  pointCount: number,
): ReadonlyMap<number, number> {
  const radii = new Map<number, number>();
  for (const control of controls ?? []) {
    if (
      !Number.isInteger(control.pointIndex) ||
      control.pointIndex <= 0 ||
      control.pointIndex >= pointCount - 1
    ) {
      throw new RangeError('Metric curve controls must name an interior control point.');
    }
    if (!Number.isFinite(control.radiusM) || control.radiusM <= 0) {
      throw new RangeError('Metric curve control radii must be finite positive meters.');
    }
    if (radii.has(control.pointIndex)) {
      throw new RangeError(`Metric curve control repeats point ${control.pointIndex}.`);
    }
    radii.set(control.pointIndex, control.radiusM);
  }
  return radii;
}

function cornerAt(points: readonly MetricPoint[], pointIndex: number): Corner | null {
  const incomingVector = subtract(points[pointIndex], points[pointIndex - 1]);
  const outgoingVector = subtract(points[pointIndex + 1], points[pointIndex]);
  const incomingLengthM = length(incomingVector);
  const outgoingLengthM = length(outgoingVector);
  const incoming = normalized(incomingVector);
  const outgoing = normalized(outgoingVector);
  if (!incoming || !outgoing) return null;
  const turnRad = Math.acos(clampUnit(dot(incoming, outgoing)));
  const turnCross = cross(incoming, outgoing);
  if (turnRad <= STRAIGHT_ANGLE_EPSILON_RAD || Math.abs(turnCross) <= STRAIGHT_ANGLE_EPSILON_RAD) {
    return null;
  }
  return {
    pointIndex,
    incoming,
    outgoing,
    incomingLengthM,
    outgoingLengthM,
    turnRad,
    turnDirection: turnCross > 0 ? 1 : -1,
  };
}

function arcForCorner(
  corner: Corner,
  point: MetricPoint,
  requestedRadiusM: number | undefined,
): MetricArc {
  const tangentFactor = Math.tan(corner.turnRad / 2);
  // A quarter of each incident segment leaves at least half of every segment
  // for its neighboring corner. That local constraint is why a control point
  // edit has bounded geometric influence rather than reshaping a whole way.
  const maximumTangentM =
    Math.min(corner.incomingLengthM, corner.outgoingLengthM) * AUTOMATIC_TANGENT_FRACTION;
  const automaticRadiusM = maximumTangentM / tangentFactor;
  const requested = requestedRadiusM ?? automaticRadiusM;
  const requestedTangentM = requested * tangentFactor;
  const tangentM = Math.min(requestedTangentM, maximumTangentM);
  const effectiveRadiusM = tangentM / tangentFactor;
  const wasClamped = requestedTangentM > maximumTangentM;
  const start = add(point, scale(corner.incoming, -tangentM));
  const end = add(point, scale(corner.outgoing, tangentM));
  const normal = scale(leftNormal(corner.incoming), corner.turnDirection * effectiveRadiusM);
  const center = add(start, normal);
  const startAngleRad = Math.atan2(start.y - center.y, start.x - center.x);
  const endAngleRad = Math.atan2(end.y - center.y, end.x - center.x);
  return {
    kind: 'arc',
    start,
    end,
    center,
    radiusM: requested,
    effectiveRadiusM,
    wasClamped,
    startAngleRad,
    sweepRad: directedSweep(startAngleRad, endAngleRad, corner.turnDirection),
  };
}

function appendLine(
  primitives: MetricCenterlinePrimitive[],
  start: MetricPoint,
  end: MetricPoint,
): void {
  if (!samePoint(start, end)) primitives.push({ kind: 'line', start, end });
}

/** Resolve authored geographic points into tangent-continuous metric arcs.
 * Two points remain a single straight primitive; duplicate or collinear
 * interior points remain on that straight path rather than inventing a curve. */
export function resolveMetricCenterline(
  points: readonly LngLat[],
  options: ResolveMetricCenterlineOptions = {},
): MetricCenterline {
  if (points.length === 0) {
    throw new RangeError('A metric centerline needs at least one control point.');
  }
  const plane = createMetricPlane(points[0]);
  const metricPoints = points.map((point) => plane.project(point));
  const controls = controlsByPoint(options.curveControls, metricPoints.length);
  if (metricPoints.length === 1) return { plane, primitives: [] };

  const primitives: MetricCenterlinePrimitive[] = [];
  let cursor = metricPoints[0];
  for (let pointIndex = 1; pointIndex < metricPoints.length - 1; pointIndex += 1) {
    const corner = cornerAt(metricPoints, pointIndex);
    if (!corner) continue;
    const arc = arcForCorner(corner, metricPoints[pointIndex], controls.get(pointIndex));
    appendLine(primitives, cursor, arc.start);
    primitives.push(arc);
    cursor = arc.end;
  }
  const finalPoint = metricPoints.at(-1);
  if (!finalPoint) throw new Error('Metric centerline lost its final control point.');
  appendLine(primitives, cursor, finalPoint);
  return { plane, primitives };
}

function appendPoint(output: LngLat[], point: LngLat): void {
  if (
    output.length === 0 ||
    output[output.length - 1][0] !== point[0] ||
    output[output.length - 1][1] !== point[1]
  ) {
    output.push(point);
  }
}

function segmentsForSagitta(radiusM: number, sweepRad: number, maxSagittaM: number): number {
  if (!Number.isFinite(maxSagittaM) || maxSagittaM <= 0) {
    throw new RangeError('Metric arc tessellation error must be finite positive meters.');
  }
  if (maxSagittaM >= radiusM) return 1;
  const maximumHalfAngle = Math.acos(1 - maxSagittaM / radiusM);
  return Math.max(1, Math.ceil(Math.abs(sweepRad) / (2 * maximumHalfAngle)));
}

/** Tessellates only at the final consumer's requested error. A street canvas
 * may ask for sub-meter chords while a far-away overview keeps the same arc
 * with fewer vertices. */
export function tessellateMetricCenterline(
  centerline: MetricCenterline,
  maxSagittaM: number,
): LngLat[] {
  const output: LngLat[] = [];
  for (const primitive of centerline.primitives) {
    if (primitive.kind === 'line') {
      appendPoint(output, centerline.plane.unproject(primitive.start));
      appendPoint(output, centerline.plane.unproject(primitive.end));
      continue;
    }
    const segments = segmentsForSagitta(
      primitive.effectiveRadiusM,
      primitive.sweepRad,
      maxSagittaM,
    );
    for (let index = 0; index <= segments; index += 1) {
      const angle = primitive.startAngleRad + (primitive.sweepRad * index) / segments;
      appendPoint(
        output,
        centerline.plane.unproject({
          x: primitive.center.x + Math.cos(angle) * primitive.effectiveRadiusM,
          y: primitive.center.y + Math.sin(angle) * primitive.effectiveRadiusM,
        }),
      );
    }
  }
  return output;
}
