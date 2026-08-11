import type { LngLat } from '../model/system';
import { EARTH_RADIUS_M, toRad } from '../model/geo/spherical';

/** A point in the local east/north coordinate system used by one corridor. */
export interface MetricPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * A fixed local projection for geometry that is authored in longitude and
 * latitude but resolved in meters. Its origin is part of the geometry input,
 * never a camera value, so panning or changing zoom cannot change a curve or
 * a corridor boundary.
 */
export interface MetricPlane {
  readonly origin: LngLat;
  project(coord: LngLat): MetricPoint;
  unproject(point: MetricPoint): LngLat;
}

function assertCoordinate(coord: LngLat, role: string): void {
  const [lng, lat] = coord;
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || lat <= -90 || lat >= 90) {
    throw new RangeError(`${role} must be a finite longitude and a latitude inside (-90, 90).`);
  }
}

function assertMetricPoint(point: MetricPoint): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new RangeError('Metric coordinates must be finite.');
  }
}

/**
 * Creates one equirectangular metric plane around an immutable geographic
 * origin. The approximation is deliberately local: curve and cross-section
 * builders use one plane per corridor, where its meter accuracy is stable and
 * its inverse is cheap. Global/routing geometry continues to use spherical
 * helpers instead.
 */
export function createMetricPlane(originInput: LngLat): MetricPlane {
  assertCoordinate(originInput, 'A metric plane origin');
  const origin: LngLat = [originInput[0], originInput[1]];
  const metersPerRadianLongitude = EARTH_RADIUS_M * Math.cos(toRad(origin[1]));

  return {
    origin,
    project(coord) {
      assertCoordinate(coord, 'A metric plane coordinate');
      return {
        x: toRad(coord[0] - origin[0]) * metersPerRadianLongitude,
        y: toRad(coord[1] - origin[1]) * EARTH_RADIUS_M,
      };
    },
    unproject(point) {
      assertMetricPoint(point);
      const coord: LngLat = [
        origin[0] + (point.x / metersPerRadianLongitude) * (180 / Math.PI),
        origin[1] + (point.y / EARTH_RADIUS_M) * (180 / Math.PI),
      ];
      assertCoordinate(coord, 'An unprojected metric plane coordinate');
      return coord;
    },
  };
}
