import { describe, expect, it } from 'vitest';
import { createMetricPlane } from '../../src/geometry/metric-plane';
import {
  resolveMetricCenterline,
  tessellateMetricCenterline,
  type MetricArc,
  type MetricLine,
} from '../../src/geometry/metric-curves';

function rightAngleAt(latitude: number) {
  const plane = createMetricPlane([0, latitude]);
  return {
    plane,
    points: [
      plane.unproject({ x: 0, y: 0 }),
      plane.unproject({ x: 1_000, y: 0 }),
      plane.unproject({ x: 1_000, y: 1_000 }),
    ],
  };
}

function arcOf(centerline: ReturnType<typeof resolveMetricCenterline>): MetricArc {
  const arc = centerline.primitives.find(
    (primitive): primitive is MetricArc => primitive.kind === 'arc',
  );
  if (!arc) throw new Error('Expected a rounded corner.');
  return arc;
}

function tangent(arc: MetricArc, angle: number) {
  const direction = arc.sweepRad >= 0 ? 1 : -1;
  return { x: -Math.sin(angle) * direction, y: Math.cos(angle) * direction };
}

function direction(from: { x: number; y: number }, to: { x: number; y: number }) {
  const x = to.x - from.x;
  const y = to.y - from.y;
  const length = Math.hypot(x, y);
  return { x: x / length, y: y / length };
}

describe('metric corner curves', () => {
  it('joins straight approach and departure with a tangent circular arc', () => {
    const { points } = rightAngleAt(36);
    const centerline = resolveMetricCenterline(points);
    expect(centerline.primitives.map((primitive) => primitive.kind)).toEqual([
      'line',
      'arc',
      'line',
    ]);
    const [approach, arc, departure] = centerline.primitives as readonly [
      MetricLine,
      MetricArc,
      MetricLine,
    ];

    expect(arc.effectiveRadiusM).toBeCloseTo(250, 6);
    expect(arc.sweepRad).toBeCloseTo(Math.PI / 2, 6);
    expect(approach.end).toEqual(arc.start);
    expect(arc.end).toEqual(departure.start);

    const approachTangent = direction(approach.start, approach.end);
    const departureTangent = direction(departure.start, departure.end);
    const arcStartTangent = tangent(arc, arc.startAngleRad);
    const arcEndTangent = tangent(arc, arc.startAngleRad + arc.sweepRad);

    expect(
      approachTangent.x * arcStartTangent.x + approachTangent.y * arcStartTangent.y,
    ).toBeCloseTo(1, 8);
    expect(departureTangent.x * arcEndTangent.x + departureTangent.y * arcEndTangent.y).toBeCloseTo(
      1,
      8,
    );
  });

  it('resolves the same physical curve at different latitudes', () => {
    const equatorial = arcOf(resolveMetricCenterline(rightAngleAt(0).points));
    const highLatitude = arcOf(resolveMetricCenterline(rightAngleAt(60).points));

    expect(highLatitude.effectiveRadiusM).toBeCloseTo(equatorial.effectiveRadiusM, 6);
    expect(highLatitude.sweepRad).toBeCloseTo(equatorial.sweepRad, 9);
  });

  it('clamps an oversized requested radius before neighboring arcs consume a segment', () => {
    const { points } = rightAngleAt(36);
    const arc = arcOf(
      resolveMetricCenterline(points, { curveControls: [{ pointIndex: 1, radiusM: 1_000 }] }),
    );

    expect(arc.effectiveRadiusM).toBeLessThan(1_000);
    expect(arc.wasClamped).toBe(true);
  });

  it('tessellates arc chords within the requested sagitta error', () => {
    const { plane, points } = rightAngleAt(36);
    const centerline = resolveMetricCenterline(points);
    const arc = arcOf(centerline);
    const path = tessellateMetricCenterline(centerline, 0.25).map((coord) => plane.project(coord));
    const arcPoints = path.filter(
      (point) =>
        Math.abs(Math.hypot(point.x - arc.center.x, point.y - arc.center.y) - arc.radiusM) < 1e-6,
    );

    expect(arcPoints.length).toBeGreaterThan(2);
    for (let index = 1; index < arcPoints.length; index += 1) {
      const a = arcPoints[index - 1];
      const b = arcPoints[index];
      const chord = Math.hypot(b.x - a.x, b.y - a.y);
      const sagitta = arc.radiusM - Math.sqrt(arc.radiusM ** 2 - (chord / 2) ** 2);
      expect(sagitta).toBeLessThanOrEqual(0.25 + 1e-9);
    }
  });
});
