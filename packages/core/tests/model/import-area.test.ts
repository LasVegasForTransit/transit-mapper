import { describe, expect, it } from 'vitest';
import {
  appendImportedNetworks,
  importAreaKm2,
  subdivideImportTile,
  tileImportArea,
} from '../../src/model/import-area';
import { osmElementsToNetwork, type OsmWayElement } from '../../src/model/import';

describe('tileImportArea', () => {
  it('covers a metro boundary with deterministic tiles no larger than 100 square kilometres', () => {
    const boundary = {
      west: -115.3428978,
      south: 35.9090772,
      east: -114.7699227,
      north: 36.3361856,
    };

    const first = tileImportArea(boundary);
    const second = tileImportArea(boundary);

    expect(first).toEqual(second);
    expect(first.length).toBe(30);
    expect(first[0]).toEqual({
      west: -115.3428978,
      south: 35.9090772,
      east: -115.24740195,
      north: 35.99449888,
    });
    expect(first.every((tile) => importAreaKm2(tile) <= 100.000001)).toBe(true);
    expect(
      Math.abs(first.reduce((sum, tile) => sum + importAreaKm2(tile), 0) - importAreaKm2(boundary)),
    ).toBeLessThan(0.01);
  });

  it('splits an antimeridian-spanning area without producing inverted requests', () => {
    const tiles = tileImportArea({ west: 179.9, south: -0.1, east: -179.9, north: 0.1 });

    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every((tile) => tile.west < tile.east)).toBe(true);
    expect(tiles.some((tile) => tile.east === 180)).toBe(true);
    expect(tiles.some((tile) => tile.west === -180)).toBe(true);
  });
});

describe('subdivideImportTile', () => {
  it('quarters a failed tile and stops once a tile is one square kilometre or smaller', () => {
    const tile = { west: -115.2, south: 36.1, east: -115.1, north: 36.2 };
    const children = subdivideImportTile(tile);

    expect(children).toHaveLength(4);
    expect(children[0]).toEqual({
      west: -115.2,
      south: 36.1,
      east: -115.15,
      north: 36.150000000000006,
    });
    expect(children.reduce((sum, child) => sum + importAreaKm2(child), 0)).toBeCloseTo(
      importAreaKm2(tile),
      6,
    );
    expect(
      subdivideImportTile({ west: -115.2, south: 36.1, east: -115.195, north: 36.105 }),
    ).toEqual([]);
  });
});

describe('appendImportedNetworks', () => {
  it('deduplicates OSM ways and preserves topology and names across tile seams', () => {
    const first: OsmWayElement[] = [
      {
        type: 'way',
        id: 10,
        tags: { highway: 'primary', name: 'Main Street' },
        nodes: [1, 2],
        geometry: [
          { lat: 36, lon: -115.2 },
          { lat: 36, lon: -115.1 },
        ],
      },
      {
        type: 'way',
        id: 11,
        tags: { highway: 'primary', name: 'Main Street' },
        nodes: [2, 3],
        geometry: [
          { lat: 36, lon: -115.1 },
          { lat: 36, lon: -115 },
        ],
      },
    ];
    const sharedWay = first[1];
    const neighbour: OsmWayElement[] = [
      sharedWay,
      {
        type: 'way',
        id: 12,
        tags: { highway: 'primary', name: 'Main Street' },
        nodes: [3, 4],
        geometry: [
          { lat: 36, lon: -115 },
          { lat: 36, lon: -114.9 },
        ],
      },
    ];

    const result = appendImportedNetworks([
      osmElementsToNetwork(first),
      osmElementsToNetwork(neighbour),
    ]);

    expect(result.network.ways.map((way) => way.source)).toEqual(['osm:10', 'osm:11', 'osm:12']);
    expect(result.network.nodes).toHaveLength(2);
    expect(result.network.namedWays).toHaveLength(1);
    expect(result.network.namedWays[0]?.wayIds).toHaveLength(3);
    expect(result.addedWays).toBe(3);
    expect(result.duplicateWays).toBe(1);
  });
});
