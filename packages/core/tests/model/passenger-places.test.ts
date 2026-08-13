import { describe, expect, it } from 'vitest';
import { createEmptySystem, parseSystem } from '../../src/model/serialize';

function savedV15Station(overrides: Record<string, unknown> = {}) {
  return {
    id: 'central-platform',
    name: 'Central',
    coord: [-115.17, 36.12],
    anchors: [],
    ...overrides,
  };
}

function savedV15(stations: Record<string, unknown>[]) {
  return { ...createEmptySystem(1), version: 15, stops: undefined, stations };
}

describe('schema v15 passenger-place migration', () => {
  it('migrates a plain boarding point to a Stop without inventing a Station', () => {
    const loaded = parseSystem(savedV15([savedV15Station()]));

    expect(loaded.version).toBe(16);
    expect(loaded.stops).toEqual([
      expect.objectContaining({ id: 'central-platform', name: 'Central', anchors: [] }),
    ]);
    expect(loaded.stations).toEqual([]);
  });

  it('migrates station-scale infrastructure to a Station containing the Stop', () => {
    const footprint = [
      [-115.171, 36.119],
      [-115.169, 36.119],
      [-115.169, 36.121],
    ];
    const loaded = parseSystem(savedV15([savedV15Station({ footprint })]));

    expect(loaded.stops).toEqual([
      expect.objectContaining({ id: 'central-platform', stationId: 'central-platform-station' }),
    ]);
    expect(loaded.stations).toEqual([
      expect.objectContaining({ id: 'central-platform-station', name: 'Central' }),
    ]);
    expect(loaded.stations[0].footprint).toHaveLength(footprint.length);
    expect(loaded.stations[0].footprint?.[0][0]).toBeCloseTo(footprint[0][0], 9);
  });

  it('uses a stable collision-safe Station id', () => {
    const loaded = parseSystem(
      savedV15([
        savedV15Station({ footprint: [[-115.17, 36.12]] }),
        savedV15Station({
          id: 'central-platform-station',
          footprint: [[-115.18, 36.12]],
        }),
      ]),
    );

    expect(loaded.stations.map((station) => station.id)).toEqual([
      'central-platform-station',
      'central-platform-station-station',
    ]);
  });
});

describe('schema v16 passenger-place repair', () => {
  it('keeps a Stop usable when its Station no longer exists', () => {
    const loaded = parseSystem({
      ...createEmptySystem(1),
      version: 16,
      stops: [
        {
          id: 'orphan-platform',
          coord: [-115.17, 36.12],
          anchors: [],
          stationId: 'missing-station',
        },
      ],
      stations: [],
    });

    expect(loaded.stops).toEqual([
      expect.objectContaining({ id: 'orphan-platform', stationId: undefined }),
    ]);
  });

  it('rejects duplicate Stop ids at the document boundary', () => {
    const stop = { id: 'duplicate', coord: [-115.17, 36.12], anchors: [] };
    expect(() =>
      parseSystem({
        ...createEmptySystem(1),
        version: 16,
        stops: [stop, stop],
        stations: [],
      }),
    ).toThrow(/duplicate Stop id/i);
  });

  it('rejects duplicate Station ids at the document boundary', () => {
    const station = { id: 'duplicate', name: 'Central', coord: [-115.17, 36.12] };
    expect(() =>
      parseSystem({
        ...createEmptySystem(1),
        version: 16,
        stops: [],
        stations: [station, station],
      }),
    ).toThrow(/duplicate Station id/i);
  });
});
