import { describe, expect, it } from 'vitest';
import { featureCollectionStats } from '../../src/render/feature-stats';

describe('render feature statistics', () => {
  it('counts vertices from collection dimensions without visiting line positions', () => {
    let positionReads = 0;
    const coordinates = new Array<GeoJSON.Position>(250_000);
    Object.defineProperty(coordinates, 0, {
      get: () => {
        positionReads += 1;
        return [0, 0];
      },
    });

    expect(
      featureCollectionStats([
        {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates },
            },
          ],
        },
      ]),
    ).toEqual({ featureCount: 1, vertexCount: 250_000 });
    expect(positionReads).toBe(0);
  });

  it('counts points, line parts, polygon rings, and geometry collections exactly', () => {
    expect(
      featureCollectionStats([
        {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {},
              geometry: { type: 'Point', coordinates: [0, 0] },
            },
            {
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'MultiLineString',
                coordinates: [
                  [
                    [0, 0],
                    [1, 1],
                  ],
                  [
                    [2, 2],
                    [3, 3],
                    [4, 4],
                  ],
                ],
              },
            },
            {
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'GeometryCollection',
                geometries: [
                  {
                    type: 'Polygon',
                    coordinates: [
                      [
                        [0, 0],
                        [1, 0],
                        [1, 1],
                        [0, 0],
                      ],
                    ],
                  },
                  {
                    type: 'MultiPoint',
                    coordinates: [
                      [0, 0],
                      [1, 1],
                    ],
                  },
                ],
              },
            },
          ],
        },
      ]),
    ).toEqual({ featureCount: 3, vertexCount: 12 });
  });
});
