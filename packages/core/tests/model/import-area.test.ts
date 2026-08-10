import { describe, expect, it } from 'vitest';
import {
  appendImportedNetworks,
  importAreaKm2,
  normalizeImportBounds,
  subdivideImportTile,
  tileImportArea,
} from '../../src/model/import-area';
import {
  osmElementsToNetwork,
  withoutAlreadyImported,
  type OsmWayElement,
} from '../../src/model/import';

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

describe('normalizeImportBounds', () => {
  it('preserves already-canonical bounds', () => {
    const bounds = { west: -115.4, south: 35.8, east: -114.7, north: 36.4 };

    expect(normalizeImportBounds(bounds)).toBe(bounds);
  });

  it('normalizes MapLibre world-copy bounds into an antimeridian-spanning area', () => {
    const normalized = normalizeImportBounds({
      west: 170,
      south: -10,
      east: 190,
      north: 10,
    });

    expect(normalized).toEqual({ west: 170, south: -10, east: -170, north: 10 });
    expect(normalized && importAreaKm2(normalized)).toBeGreaterThan(0);
  });

  it('normalizes a negative MapLibre world copy', () => {
    expect(normalizeImportBounds({ west: -190, south: -10, east: -170, north: 10 })).toEqual({
      west: 170,
      south: -10,
      east: -170,
      north: 10,
    });
  });

  it('rejects malformed latitude bounds', () => {
    expect(normalizeImportBounds({ west: -115, south: 91, east: -114, north: 92 })).toBeUndefined();
  });

  it('rejects wrapped bounds spanning more than one world copy', () => {
    expect(normalizeImportBounds({ west: -200, south: -10, east: 200, north: 10 })).toBeUndefined();
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

  it('preserves a junction first discovered after both ways were committed', () => {
    const horizontal: OsmWayElement = {
      type: 'way',
      id: 20,
      tags: { highway: 'primary' },
      nodes: [1, 100, 2],
      geometry: [
        { lat: 36, lon: -115.2 },
        { lat: 36, lon: -115.1 },
        { lat: 36, lon: -115 },
      ],
    };
    const vertical: OsmWayElement = {
      type: 'way',
      id: 21,
      tags: { highway: 'primary' },
      nodes: [3, 100, 4],
      geometry: [
        { lat: 35.9, lon: -115.1 },
        { lat: 36, lon: -115.1 },
        { lat: 36.1, lon: -115.1 },
      ],
    };

    const result = appendImportedNetworks([
      osmElementsToNetwork([horizontal]),
      osmElementsToNetwork([vertical]),
      osmElementsToNetwork([horizontal, vertical]),
    ]);

    expect(result.network.ways).toHaveLength(2);
    expect(result.network.nodes).toHaveLength(1);
    expect(result.network.nodes[0]?.refs).toHaveLength(2);
  });

  it('re-points a turn restriction first discovered after its ways were committed', () => {
    const from: OsmWayElement = {
      type: 'way',
      id: 30,
      tags: { highway: 'primary' },
      nodes: [1, 100],
      geometry: [
        { lat: 36, lon: -115.2 },
        { lat: 36, lon: -115.1 },
      ],
    };
    const forbidden: OsmWayElement = {
      type: 'way',
      id: 31,
      tags: { highway: 'primary' },
      nodes: [100, 2],
      geometry: [
        { lat: 36, lon: -115.1 },
        { lat: 36.1, lon: -115.1 },
      ],
    };
    const allowed: OsmWayElement = {
      type: 'way',
      id: 32,
      tags: { highway: 'primary' },
      nodes: [100, 3],
      geometry: [
        { lat: 36, lon: -115.1 },
        { lat: 36, lon: -115 },
      ],
    };
    const relation: OsmWayElement = {
      type: 'relation',
      id: 300,
      tags: { type: 'restriction', restriction: 'no_left_turn' },
      members: [
        { type: 'way', ref: 30, role: 'from' },
        { type: 'node', ref: 100, role: 'via' },
        { type: 'way', ref: 31, role: 'to' },
      ],
    };

    const result = appendImportedNetworks([
      osmElementsToNetwork([from]),
      osmElementsToNetwork([forbidden]),
      osmElementsToNetwork([allowed]),
      osmElementsToNetwork([from, forbidden, allowed, relation]),
      osmElementsToNetwork([]),
    ]);
    const wayIds = new Set(result.network.ways.map((way) => way.id));

    expect(result.network.turnRestrictions).not.toHaveLength(0);
    expect(
      result.network.turnRestrictions.every((entry) =>
        wayIds.has(entry.key.slice(0, entry.key.indexOf(':'))),
      ),
    ).toBe(true);
    expect(
      result.network.turnRestrictions.every((entry) =>
        entry.restriction.allowedTargets.every((wayId) => wayIds.has(wayId)),
      ),
    ).toBe(true);
  });

  it('keeps unrelated same-named carriageway pairs and their medians separate', () => {
    const dividedStreet = (firstId: number, latitude: number): OsmWayElement[] => [
      {
        type: 'way',
        id: firstId,
        tags: { highway: 'primary', name: 'Main Street', oneway: 'yes', lanes: '2' },
        nodes: [firstId * 10, firstId * 10 + 1],
        geometry: [
          { lat: latitude, lon: -115.2 },
          { lat: latitude, lon: -115.1 },
        ],
      },
      {
        type: 'way',
        id: firstId + 1,
        tags: { highway: 'primary', name: 'Main Street', oneway: 'yes', lanes: '2' },
        nodes: [firstId * 10 + 2, firstId * 10 + 3],
        geometry: [
          { lat: latitude + 0.0002, lon: -115.1 },
          { lat: latitude + 0.0002, lon: -115.2 },
        ],
      },
    ];

    const result = appendImportedNetworks([
      osmElementsToNetwork(dividedStreet(40, 36)),
      osmElementsToNetwork(dividedStreet(50, 37)),
    ]);

    expect(result.network.namedWays).toHaveLength(2);
    expect(result.network.namedWays.every((namedWay) => namedWay.wayIds.length === 2)).toBe(true);
    expect(result.network.medians).toHaveLength(2);
  });

  it('extends a renamed street identity through shared membership without duplicating it', () => {
    const firstElements: OsmWayElement[] = [
      {
        type: 'way',
        id: 60,
        tags: { highway: 'primary', name: 'Main Street' },
        nodes: [1, 2],
        geometry: [
          { lat: 36, lon: -115.2 },
          { lat: 36, lon: -115.1 },
        ],
      },
      {
        type: 'way',
        id: 61,
        tags: { highway: 'primary', name: 'Main Street' },
        nodes: [2, 3],
        geometry: [
          { lat: 36, lon: -115.1 },
          { lat: 36, lon: -115 },
        ],
      },
    ];
    const first = osmElementsToNetwork(firstElements);
    const renamed = first.namedWays.map((namedWay) => ({ ...namedWay, name: 'Community Way' }));
    const incoming = osmElementsToNetwork([
      firstElements[1],
      {
        type: 'way',
        id: 62,
        tags: { highway: 'primary', name: 'Main Street' },
        nodes: [3, 4],
        geometry: [
          { lat: 36, lon: -115 },
          { lat: 36, lon: -114.9 },
        ],
      },
    ]);

    const result = withoutAlreadyImported(incoming, first.ways, renamed, first.nodes);

    expect(result.network.namedWays).toHaveLength(0);
    expect(result.identityAdditions).toEqual([
      { id: renamed[0]?.id, wayIds: [result.network.ways[0]?.id] },
    ]);
  });
});
