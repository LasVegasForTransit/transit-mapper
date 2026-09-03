import type { GeographicBounds } from '../../geography/bounds';
import { resolveWayPath } from '../../model/geo/wayPath';
import type { Way } from '../../model/system';
import {
  clippedCarrierGeometry,
  normalizedPositionKey,
  topologyCarrierGeometry,
  type CarrierFragmentRole,
  type CarrierGeometryPiece,
  type CarrierGeometrySource,
} from '../carrier-geometry';
import { legacyDerivedId } from './identity';

export type CarrierPiece = CarrierGeometryPiece;

function geometrySource(way: Way, laneId: string | undefined): CarrierGeometrySource {
  return {
    carrier:
      laneId === undefined ? { kind: 'way', id: way.id } : { kind: 'way', id: way.id, laneId },
    alignmentId: way.id,
    alignmentExtent: [0, 1],
    points: resolveWayPath(way),
    geometry: way.geometry,
  };
}

function carrierId(
  role: CarrierFragmentRole,
  way: Way,
  laneId: string | undefined,
  range: readonly [number, number],
): string {
  return legacyDerivedId(
    `${role}-carrier-fragment`,
    way.id,
    ...(laneId === undefined ? ['auto'] : ['lane', laneId]),
    normalizedPositionKey(range[0]),
    normalizedPositionKey(range[1]),
  );
}

export function clippedCarrierPieces(
  way: Way,
  laneId: string | undefined,
  range: readonly [number, number],
  bounds: GeographicBounds,
): CarrierPiece[] {
  return clippedCarrierGeometry(geometrySource(way, laneId), range, bounds, (role, pieceRange) =>
    carrierId(role, way, laneId, pieceRange),
  );
}

export function topologyCarrierPiece(
  way: Way,
  laneId: string | undefined,
  range: readonly [number, number],
): CarrierPiece | undefined {
  return topologyCarrierGeometry(geometrySource(way, laneId), range, (role, pieceRange) =>
    carrierId(role, way, laneId, pieceRange),
  );
}

export function patternLegFragmentId(
  role: CarrierFragmentRole,
  parentId: string,
  range: readonly [number, number],
): string {
  return legacyDerivedId(
    `${role}-pattern-leg-fragment`,
    parentId,
    normalizedPositionKey(range[0]),
    normalizedPositionKey(range[1]),
  );
}
