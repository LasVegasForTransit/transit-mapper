import { describe, expect, it } from 'vitest';
import { haversineMeters } from '../../src/model/geo';
import { createMetricPlane } from '../../src/geometry/metric-plane';

describe('metric plane', () => {
  it('round-trips local meter coordinates around a fixed geographic origin', () => {
    const plane = createMetricPlane([-115.1728, 36.1147]);
    const origin = plane.project([-115.1728, 36.1147]);
    const target = plane.unproject({ x: 1250, y: -375 });
    const roundTrip = plane.project(target);

    expect(origin).toEqual({ x: 0, y: 0 });
    expect(roundTrip.x).toBeCloseTo(1250);
    expect(roundTrip.y).toBeCloseTo(-375);
    expect(haversineMeters([-115.1728, 36.1147], target)).toBeCloseTo(Math.hypot(1250, 375), 0);
  });

  it('uses its origin latitude consistently for every point in the local plane', () => {
    const nearEquator = createMetricPlane([0, 0]);
    const nearSixtyDegrees = createMetricPlane([0, 60]);

    const equatorialEast = nearEquator.project([0.01, 0]).x;
    const highLatitudeEast = nearSixtyDegrees.project([0.01, 60]).x;

    expect(highLatitudeEast / equatorialEast).toBeCloseTo(0.5, 3);
  });

  it('rejects invalid origins instead of creating geometry with NaN coordinates', () => {
    expect(() => createMetricPlane([Number.NaN, 36])).toThrow(RangeError);
    expect(() => createMetricPlane([-115, 91])).toThrow(RangeError);
  });
});
