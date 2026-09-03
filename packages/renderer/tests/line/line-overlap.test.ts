import { describe, expect, it } from 'vitest';
import type { LngLat } from '@transitmapper/core/geography/bounds';
import { transitEntityKey } from '@transitmapper/core/model/transit-entity-ref';
import { EARTH_RADIUS_M } from '@transitmapper/core/model/geo/spherical';
import {
  createTopologyCandidateComparison,
  quantizeOverlapMetres,
  retainNearestTopologyTangent,
  type CompareTopologyCandidateInput,
  type TopologyCandidateResult,
  type TopologyMetricPath,
} from '../../src/line/line-overlap';

const radiansToDegrees = 180 / Math.PI;

function pointAtMeters(eastM: number, northM: number): LngLat {
  const distanceM = Math.hypot(eastM, northM);
  if (distanceM === 0) return [0, 0];
  const angularDistance = distanceM / EARTH_RADIUS_M;
  const latitude = Math.asin((northM * Math.sin(angularDistance)) / distanceM);
  const longitude = Math.atan2(
    eastM * Math.sin(angularDistance),
    distanceM * Math.cos(angularDistance),
  );
  return [longitude * radiansToDegrees, latitude * radiansToDegrees];
}

interface MetricPathOptions {
  readonly identity: string;
  readonly points: readonly [LngLat, LngLat, ...LngLat[]];
  readonly reversedAnchors?: boolean;
}

function metricPath(options: MetricPathOptions): TopologyMetricPath {
  const west = transitEntityKey({ kind: 'stop', id: 'west' });
  const east = transitEntityKey({ kind: 'stop', id: 'east' });
  return {
    identityOrderKey: new TextEncoder().encode(options.identity),
    startAnchorKey: options.reversedAnchors ? east : west,
    endAnchorKey: options.reversedAnchors ? west : east,
    points: options.points,
  };
}

function straightPath(identity: string, lengthM: number, northM = 0): TopologyMetricPath {
  return metricPath({
    identity,
    points: [pointAtMeters(0, northM), pointAtMeters(lengthM, northM)],
  });
}

function compareTopologyCandidate(input: CompareTopologyCandidateInput): TopologyCandidateResult {
  const comparison = createTopologyCandidateComparison(input);
  let progress = comparison.advance(1_000);
  while (progress.kind === 'pending') progress = comparison.advance(1_000);
  return progress;
}

describe('line overlap metric boundaries', () => {
  it('rounds positive and negative half millimetres away from zero', () => {
    expect(quantizeOverlapMetres(0.0005)).toBe(0.001);
    expect(quantizeOverlapMetres(-0.0005)).toBe(-0.001);
    expect(quantizeOverlapMetres(0.000499)).toBe(0);
    expect(quantizeOverlapMetres(-0.000499)).toBe(-0);
  });

  it('keeps every heading whose raw distance ties after millimetre rounding', () => {
    const nearerRawCandidate = retainNearestTopologyTangent(undefined, 0.0006, false);
    const fartherRawCandidate = retainNearestTopologyTangent(nearerRawCandidate, 0.0014, true);

    expect(fartherRawCandidate).toEqual({ distanceM: 0.001, hasMatchingHeading: true });
  });

  it('accepts 25 metres and rejects the first millimetre below it', () => {
    const accepted = compareTopologyCandidate({
      left: straightPath('left', 25),
      right: straightPath('right', 25),
    });
    const rejected = compareTopologyCandidate({
      left: metricPath({
        identity: 'left',
        points: [pointAtMeters(0, 0), pointAtMeters(24.999, 0)],
      }),
      right: metricPath({
        identity: 'right',
        points: [pointAtMeters(0.001, 0), pointAtMeters(25, 0)],
      }),
    });

    expect(accepted).toMatchObject({ kind: 'accepted', shorterLengthM: 25 });
    expect(rejected).toEqual({ kind: 'rejected', reason: 'too-short' });
  });

  it('accepts 20 metres of separation and rejects the next millimetre', () => {
    const accepted = compareTopologyCandidate({
      left: straightPath('left', 30),
      right: straightPath('right', 30, 20),
    });
    const rejected = compareTopologyCandidate({
      left: straightPath('left', 30),
      right: straightPath('right', 30, 20.001),
    });

    expect(accepted).toMatchObject({ kind: 'accepted', maximumDistanceM: 20 });
    expect(rejected).toEqual({ kind: 'rejected', reason: 'too-far' });
  });

  it('accepts 40 degrees of undirected heading and rejects an angle beyond it', () => {
    const angledPath = (identity: string, degrees: number): TopologyMetricPath => {
      const radians = (degrees * Math.PI) / 180;
      const halfLengthM = 15;
      return metricPath({
        identity,
        points: [
          pointAtMeters(-Math.cos(radians) * halfLengthM, -Math.sin(radians) * halfLengthM),
          pointAtMeters(Math.cos(radians) * halfLengthM, Math.sin(radians) * halfLengthM),
        ],
      });
    };
    const accepted = compareTopologyCandidate({
      left: metricPath({
        identity: 'left',
        points: [pointAtMeters(-15, 0), pointAtMeters(15, 0)],
      }),
      right: angledPath('right', 40),
    });
    const rejected = compareTopologyCandidate({
      left: metricPath({
        identity: 'left',
        points: [pointAtMeters(-15, 0), pointAtMeters(15, 0)],
      }),
      right: angledPath('right', 40.001),
    });

    expect(accepted.kind).toBe('accepted');
    expect(rejected).toEqual({ kind: 'rejected', reason: 'heading-conflict' });
  });
});

describe('line overlap metric correspondence', () => {
  it('yields comparison work at a caller-controlled operation boundary', () => {
    const points: [LngLat, LngLat, ...LngLat[]] = [pointAtMeters(0, 0), pointAtMeters(0.5, 0)];
    for (let index = 2; index <= 200; index += 1) {
      points.push(pointAtMeters(index * 0.5, 0));
    }
    const left = metricPath({ identity: 'left', points });
    const right = metricPath({ identity: 'right', points });
    const comparison = createTopologyCandidateComparison({ left, right });

    expect(comparison.advance(32)).toEqual({ kind: 'pending' });
    let progress = comparison.advance(128);
    while (progress.kind === 'pending') progress = comparison.advance(128);
    expect(progress.kind).toBe('accepted');
  });

  it('accepts opposite travel directions', () => {
    const result = compareTopologyCandidate({
      left: straightPath('left', 60),
      right: metricPath({
        identity: 'right',
        reversedAnchors: true,
        points: [pointAtMeters(60, 0), pointAtMeters(0, 0)],
      }),
    });

    expect(result.kind).toBe('accepted');
  });

  it('accepts the same centerline with different vertex density', () => {
    const result = compareTopologyCandidate({
      left: straightPath('left', 80),
      right: metricPath({
        identity: 'right',
        points: [
          pointAtMeters(0, 0),
          pointAtMeters(10, 0),
          pointAtMeters(30, 0),
          pointAtMeters(80, 0),
        ],
      }),
    });

    expect(result).toMatchObject({ kind: 'accepted', maximumDistanceM: 0 });
  });

  it('returns the same decision and maximum distance when the paths swap sides', () => {
    const left = straightPath('left', 80);
    const right = straightPath('right', 80, 7);
    const forward = compareTopologyCandidate({ left, right });
    const swapped = compareTopologyCandidate({ left: right, right: left });

    expect(forward).toMatchObject({ kind: 'accepted', maximumDistanceM: 7 });
    expect(swapped).toMatchObject({ kind: 'accepted', maximumDistanceM: 7 });
  });

  it('removes consecutive points that quantize to the same millimetre', () => {
    const result = compareTopologyCandidate({
      left: straightPath('left', 25),
      right: metricPath({
        identity: 'right',
        points: [pointAtMeters(0, 0), pointAtMeters(0.0004, 0), pointAtMeters(25, 0)],
      }),
    });

    expect(result.kind).toBe('accepted');
  });

  it('keeps all equally nearest corner tangents eligible', () => {
    const result = compareTopologyCandidate({
      left: metricPath({
        identity: 'left',
        points: [pointAtMeters(-25, 0), pointAtMeters(0, 0), pointAtMeters(0, 25)],
      }),
      right: metricPath({
        identity: 'right',
        points: [pointAtMeters(-25, 0), pointAtMeters(0, 0), pointAtMeters(0, 25)],
      }),
    });

    expect(result.kind).toBe('accepted');
  });

  it('wraps longitude when a candidate crosses the antimeridian', () => {
    const crossing = metricPath({
      identity: 'crossing',
      points: [
        [179.9998, 0],
        [-179.9998, 0],
      ],
    });
    const result = compareTopologyCandidate({
      left: crossing,
      right: { ...crossing, identityOrderKey: new TextEncoder().encode('other') },
    });

    expect(result.kind).toBe('accepted');
  });

  it('rejects nonfinite coordinates, antipodal points, and a zero-vector origin', () => {
    const nonfinite = compareTopologyCandidate({
      left: metricPath({
        identity: 'left',
        points: [
          [Number.POSITIVE_INFINITY, 0],
          [0, 0],
        ],
      }),
      right: straightPath('right', 25),
    });
    const antipodal = compareTopologyCandidate({
      left: metricPath({
        identity: 'left',
        points: [pointAtMeters(0, 0), [180, 0]],
      }),
      right: metricPath({
        identity: 'right',
        points: [pointAtMeters(0, 0), [-180, 0]],
      }),
    });
    const antipodalInteriorPoint = compareTopologyCandidate({
      left: metricPath({
        identity: 'left',
        points: [
          [0, 0],
          [180.0005, 0],
          [0.001, 0],
        ],
      }),
      right: metricPath({
        identity: 'right',
        points: [
          [0, 0],
          [0.001, 0],
        ],
      }),
    });

    expect(nonfinite).toEqual({ kind: 'rejected', reason: 'invalid-coordinate' });
    expect(antipodal).toEqual({ kind: 'rejected', reason: 'invalid-origin' });
    expect(antipodalInteriorPoint).toEqual({
      kind: 'rejected',
      reason: 'invalid-coordinate',
    });
  });
});
