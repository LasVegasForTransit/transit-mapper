import type { LngLat } from '@transitmapper/core/model/system';
import type { ScreenPoint } from '@transitmapper/core/render/project';

const MAX_MERCATOR_LATITUDE = 85.051129;
const MATRIX_SIZE = 8;

export interface GroundPlaneProjectionAnchor {
  readonly coordinate: LngLat;
  readonly point: ScreenPoint;
}

export interface GroundPlaneProjection {
  readonly centerLongitude: number;
  readonly anchors: readonly [
    GroundPlaneProjectionAnchor,
    GroundPlaneProjectionAnchor,
    GroundPlaneProjectionAnchor,
    GroundPlaneProjectionAnchor,
  ];
}

function longitudeAroundCenter(longitude: number, centerLongitude: number): number {
  let unwrapped = longitude;
  while (unwrapped - centerLongitude > 180) unwrapped -= 360;
  while (unwrapped - centerLongitude < -180) unwrapped += 360;
  return unwrapped;
}

function mercator(coordinate: LngLat, centerLongitude: number): readonly [number, number] {
  const latitude = Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, coordinate[1]));
  const radians = (latitude * Math.PI) / 180;
  return [
    (longitudeAroundCenter(coordinate[0], centerLongitude) + 180) / 360,
    0.5 - Math.log(Math.tan(Math.PI / 4 + radians / 2)) / (2 * Math.PI),
  ];
}

function pivotRowFor(rows: readonly number[][], column: number): number {
  let pivot = column;
  for (let row = column + 1; row < MATRIX_SIZE; row++) {
    if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
  }
  return pivot;
}

function normalizePivot(rows: number[][], column: number): void {
  const pivot = pivotRowFor(rows, column);
  const pivotRow = rows[pivot];
  rows[pivot] = rows[column];
  rows[column] = pivotRow;
  const divisor = rows[column][column];
  if (Math.abs(divisor) < Number.EPSILON) {
    throw new Error('The live map camera could not be projected for SVG export.');
  }
  for (let index = column; index <= MATRIX_SIZE; index++) rows[column][index] /= divisor;
}

function eliminateColumn(rows: number[][], column: number): void {
  for (let row = 0; row < MATRIX_SIZE; row++) {
    if (row === column) continue;
    const multiplier = rows[row][column];
    for (let index = column; index <= MATRIX_SIZE; index++) {
      rows[row][index] -= multiplier * rows[column][index];
    }
  }
}

/** Solves the eight coefficients of a plane-to-screen homography. MapLibre's
 * pitched Mercator camera projects the z=0 ground plane through exactly this
 * transform, so four live-map samples preserve its camera without shipping
 * MapLibre or the complete SVG renderer in the editor bundle. */
function homographyFor(projection: GroundPlaneProjection): readonly number[] {
  const rows: number[][] = [];
  for (const anchor of projection.anchors) {
    const [x, y] = mercator(anchor.coordinate, projection.centerLongitude);
    const { x: screenX, y: screenY } = anchor.point;
    rows.push([x, y, 1, 0, 0, 0, -screenX * x, -screenX * y, screenX]);
    rows.push([0, 0, 0, x, y, 1, -screenY * x, -screenY * y, screenY]);
  }

  for (let column = 0; column < MATRIX_SIZE; column++) {
    normalizePivot(rows, column);
    eliminateColumn(rows, column);
  }
  return rows.map((row) => row[MATRIX_SIZE]);
}

export function groundPlaneProjector(
  projection: GroundPlaneProjection,
): (coordinate: LngLat) => ScreenPoint {
  const coefficients = homographyFor(projection);
  return (coordinate) => {
    const [x, y] = mercator(coordinate, projection.centerLongitude);
    const denominator = coefficients[6] * x + coefficients[7] * y + 1;
    return {
      x: (coefficients[0] * x + coefficients[1] * y + coefficients[2]) / denominator,
      y: (coefficients[3] * x + coefficients[4] * y + coefficients[5]) / denominator,
    };
  };
}
