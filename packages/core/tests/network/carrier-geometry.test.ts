import { describe, expect, it } from 'vitest';
import {
  clippedCarrierGeometry,
  type CarrierGeometrySource,
} from '../../src/network/carrier-geometry';

describe('schema-neutral carrier geometry', () => {
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
