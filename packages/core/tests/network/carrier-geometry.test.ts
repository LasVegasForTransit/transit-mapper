import { describe, expect, it } from 'vitest';
import {
  clippedCarrierGeometry,
  type CarrierGeometrySource,
} from '../../src/network/carrier-geometry';

describe('schema-neutral carrier geometry', () => {
  // Clipping walks the whole source before it can find nothing, so a carrier
  // the camera cannot be showing is rejected on its bounding box first. The
  // risk of that shortcut is over-rejection, which would silently drop route
  // geometry, so these pin both directions.
  describe('rejecting a carrier the bounds cannot contain', () => {
    const eastWest = (points: CarrierGeometrySource['points']): CarrierGeometrySource => ({
      carrier: { kind: 'way', id: 'way', laneId: undefined },
      alignmentId: 'centerline',
      alignmentExtent: [0, 1],
      points,
      geometry: 'straight',
    });
    const clip = (
      source: CarrierGeometrySource,
      bounds: Parameters<typeof clippedCarrierGeometry>[2],
    ) =>
      clippedCarrierGeometry(
        source,
        [0, 1],
        bounds,
        (role, range) => `${role}:${range[0]}:${range[1]}`,
      );

    it('drops a carrier whose bounding box misses the visible bounds', () => {
      const away = eastWest([
        [50, 50],
        [51, 50],
      ]);
      expect(clip(away, { kind: 'ordinary', west: -1, south: -1, east: 1, north: 1 })).toEqual([]);
    });

    it('keeps a carrier that only passes through the visible bounds', () => {
      // Neither endpoint is inside the window; rejecting on endpoints rather
      // than on the box would lose this one.
      const crossing = eastWest([
        [-2, 0],
        [2, 0],
      ]);
      expect(
        clip(crossing, { kind: 'ordinary', west: -1, south: -1, east: 1, north: 1 }),
      ).toHaveLength(1);
    });

    it('keeps every carrier when the bounds cross the antimeridian', () => {
      // A wrapped window is two windows, and the raw longitudes of a path that
      // spans the seam do not describe where it is drawn, so the shortcut
      // declines to judge.
      const nearSeam = eastWest([
        [179, 0],
        [-179, 0],
      ]);
      expect(
        clip(nearSeam, {
          kind: 'crosses-antimeridian',
          west: 178,
          south: -1,
          east: -178,
          north: 1,
        }),
      ).not.toEqual([]);
    });
  });

  it('clips one carrier and maps its visible range onto the Alignment', () => {
    const source: CarrierGeometrySource = {
      carrier: { kind: 'way', id: 'main-street', laneId: 'through' },
      alignmentId: 'main-street-centerline',
      alignmentExtent: [0.2, 0.8],
      points: [
        [-2, 0],
        [2, 0],
      ],
      geometry: 'straight',
    };

    const pieces = clippedCarrierGeometry(
      source,
      [0, 1],
      { kind: 'ordinary', west: -1, south: -1, east: 1, north: 1 },
      (role, range) => `${role}:${range[0]}:${range[1]}`,
    );

    expect(pieces).toEqual([
      {
        range: [0.25, 0.75],
        carrier: {
          id: 'visible:0.25:0.75',
          carrier: source.carrier,
          alignmentId: source.alignmentId,
          alignmentRange: [0.35000000000000003, 0.6500000000000001],
          points: [
            [-1, 0],
            [1, 0],
          ],
          geometry: 'straight',
          curveControls: [],
        },
      },
    ]);
  });
});
