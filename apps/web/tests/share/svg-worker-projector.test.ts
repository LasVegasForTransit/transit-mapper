import { describe, expect, it } from 'vitest';
import type { LngLat } from '@transitmapper/core/model/system';
import {
  groundPlaneProjector,
  type GroundPlaneProjectionAnchor,
  type GroundPlaneProjection,
} from '../../src/share/svg-worker-projector';

function mercator([lng, lat]: LngLat): readonly [number, number] {
  const radians = (lat * Math.PI) / 180;
  return [(lng + 180) / 360, 0.5 - Math.log(Math.tan(Math.PI / 4 + radians / 2)) / (2 * Math.PI)];
}

function syntheticProject(coordinate: LngLat): { x: number; y: number } {
  const [x, y] = mercator(coordinate);
  const denominator = 1 + x * 0.08 - y * 0.04;
  return {
    x: (700 * x + 90 * y + 15) / denominator,
    y: (-55 * x + 620 * y + 28) / denominator,
  };
}

function anchorsFor(
  coordinates: readonly [LngLat, LngLat, LngLat, LngLat],
  project: (coordinate: LngLat) => { x: number; y: number },
): GroundPlaneProjection['anchors'] {
  const anchorAt = (coordinate: LngLat): GroundPlaneProjectionAnchor => ({
    coordinate,
    point: project(coordinate),
  });
  return [
    anchorAt(coordinates[0]),
    anchorAt(coordinates[1]),
    anchorAt(coordinates[2]),
    anchorAt(coordinates[3]),
  ];
}

describe('SVG Worker ground-plane projection', () => {
  it('reconstructs the live camera projective transform between samples', () => {
    const coordinates: readonly [LngLat, LngLat, LngLat, LngLat] = [
      [-115.3, 36.05],
      [-115.0, 36.05],
      [-115.3, 36.3],
      [-115.0, 36.3],
    ];
    const projection: GroundPlaneProjection = {
      centerLongitude: -115.15,
      anchors: anchorsFor(coordinates, syntheticProject),
    };
    const project = groundPlaneProjector(projection);

    for (const coordinate of coordinates) {
      expect(project(coordinate).x).toBeCloseTo(syntheticProject(coordinate).x, 7);
      expect(project(coordinate).y).toBeCloseTo(syntheticProject(coordinate).y, 7);
    }

    const interior: LngLat = [-115.17, 36.18];
    expect(project(interior).x).toBeCloseTo(syntheticProject(interior).x, 7);
    expect(project(interior).y).toBeCloseTo(syntheticProject(interior).y, 7);
  });

  it('unwraps longitudes around the live camera at the antimeridian', () => {
    const coordinates: readonly [LngLat, LngLat, LngLat, LngLat] = [
      [179.7, -0.2],
      [-179.7, -0.2],
      [179.7, 0.2],
      [-179.7, 0.2],
    ];
    const unwrappedProject = ([lng, lat]: LngLat) => ({
      x: lng < 0 ? lng + 360 : lng,
      y: lat,
    });
    const projection: GroundPlaneProjection = {
      centerLongitude: 180,
      anchors: anchorsFor(coordinates, unwrappedProject),
    };
    const project = groundPlaneProjector(projection);

    expect(project([-179.9, 0]).x).toBeCloseTo(180.1, 7);
    expect(project([-179.9, 0]).y).toBeCloseTo(0, 7);
  });
});
