import {
  tessellateMetricCenterline,
  resolveMetricCenterline,
} from '@transitmapper/core/geometry/metric-curves';
import {
  cumulativeLengths,
  pathLengthMeters,
  pointAtDistance,
} from '@transitmapper/core/model/geo';
import type { LngLat } from '@transitmapper/core/model/system';
import { mapNormalizedRange } from '@transitmapper/core/network/carrier-alignment';
import type { ResolvedCarrierFragment } from '@transitmapper/core/network/resolved-network-chunk';
import type { LineString } from 'geojson';
import type { VisibleFragmentPartition } from './line-visible-partitions';
import type { VisibleFragmentRejection } from './line-visible-sources';

type CachedCarrierPath =
  | {
      readonly kind: 'ready';
      readonly points: readonly (readonly [number, number])[];
      readonly lengths: Float64Array;
    }
  | { readonly kind: 'invalid' };

export interface VisibleFragmentGeometryResolver {
  geometryForPartition(partition: VisibleFragmentPartition): LineString | VisibleFragmentRejection;
}

const MAXIMUM_CARRIER_SAGITTA_METERS = 0.25;

function normalizeLongitudes(
  points: readonly (readonly [number, number])[],
): readonly (readonly [number, number])[] {
  const normalized: (readonly [number, number])[] = [];
  let previous: number | undefined;
  for (const [rawLongitude, latitude] of points) {
    let longitude = rawLongitude;
    while (previous !== undefined && longitude - previous > 180) longitude -= 360;
    while (previous !== undefined && longitude - previous < -180) longitude += 360;
    normalized.push([longitude, latitude]);
    previous = longitude;
  }
  return normalized;
}

function resolvedCarrierPath(
  carrier: ResolvedCarrierFragment,
): readonly (readonly [number, number])[] | undefined {
  try {
    const points = normalizeLongitudes(carrier.points);
    if (carrier.geometry !== 'curved') return points;
    return tessellateMetricCenterline(
      resolveMetricCenterline(
        points.map(([longitude, latitude]) => [longitude, latitude]),
        {
          curveControls: carrier.curveControls.map(({ pointIndex, radiusMeters }) => ({
            pointIndex,
            radiusM: radiusMeters,
          })),
        },
      ),
      MAXIMUM_CARRIER_SAGITTA_METERS,
    );
  } catch {
    return undefined;
  }
}

function cachedPath(
  sourceShardId: string,
  carrier: ResolvedCarrierFragment,
  cache: Map<string, CachedCarrierPath>,
): CachedCarrierPath {
  const existing = cache.get(sourceShardId);
  if (existing !== undefined) return existing;
  const points = resolvedCarrierPath(carrier);
  const result: CachedCarrierPath =
    points === undefined
      ? { kind: 'invalid' }
      : {
          kind: 'ready',
          points,
          lengths: cumulativeLengths(points.map(([longitude, latitude]) => [longitude, latitude])),
        };
  cache.set(sourceShardId, result);
  return result;
}

function sliceCachedPath(
  path: Extract<CachedCarrierPath, { readonly kind: 'ready' }>,
  t0: number,
  t1: number,
): readonly (readonly [number, number])[] {
  if (path.points.length < 2) return path.points;
  const start = Math.max(0, Math.min(1, Math.min(t0, t1)));
  const end = Math.max(0, Math.min(1, Math.max(t0, t1)));
  if (start <= 0 && end >= 1) return path.points;
  const total = path.lengths.at(-1);
  if (total === undefined || total === 0) return [path.points[0]];
  const startMeters = start * total;
  const endMeters = end * total;
  const points: (readonly [number, number])[] = [
    pointAtDistance(path.points as LngLat[], path.lengths, startMeters),
  ];
  for (let index = 0; index < path.points.length; index += 1) {
    const distance = path.lengths[index];
    if (distance > startMeters && distance < endMeters) points.push(path.points[index]);
  }
  if (endMeters > startMeters)
    points.push(pointAtDistance(path.points as LngLat[], path.lengths, endMeters));
  return points;
}

function lineString(points: readonly (readonly [number, number])[]): LineString | undefined {
  const path = points.map(([longitude, latitude]) => [longitude, latitude]) as LngLat[];
  return path.length >= 2 && pathLengthMeters(path) > 0
    ? { type: 'LineString', coordinates: path }
    : undefined;
}

export function createVisibleFragmentGeometryResolver(): VisibleFragmentGeometryResolver {
  const cache = new Map<string, CachedCarrierPath>();
  return {
    geometryForPartition(partition): LineString | VisibleFragmentRejection {
      const { piece } = partition;
      // One chosen shard often covers adjacent partitions, so cache its curve work for the bundle.
      const path = cachedPath(piece.sourceShardId, piece.sourceCarrier, cache);
      if (path.kind === 'invalid') {
        return {
          kind: 'rejected',
          reason: 'invalid-visible-carrier-geometry',
          recordId: piece.sourceShardId,
        };
      }
      const localRange = mapNormalizedRange(
        partition.canonicalCarrierRange,
        piece.sourceCanonicalCarrierRange,
        [0, 1],
      );
      const geometry = lineString(sliceCachedPath(path, localRange[0], localRange[1]));
      return (
        geometry ?? {
          kind: 'rejected',
          reason: 'degenerate-visible-carrier-geometry',
          recordId: piece.sourceShardId,
        }
      );
    },
  };
}
