import { nudgeSelection } from '../../src/model/selection-nudge';
import { aRoad, aStation, aSystem } from '../support/fixtures.test';
import { describe, expect, it } from 'vitest';

describe('multi-selection nudging', () => {
  it('preserves the system reference when the selection has no movable geometry', () => {
    const system = aSystem();

    expect(nudgeSelection(system, [], 1, 1)).toBe(system);
    expect(nudgeSelection(system, [{ kind: 'service', id: 'missing' }], 1, 1)).toBe(system);
    expect(nudgeSelection(system, [{ kind: 'way', id: 'missing' }], 1, 1)).toBe(system);
    expect(nudgeSelection(system, [{ kind: 'way', id: 'missing' }], 0, 0)).toBe(system);
  });

  it('moves selected ways once and carries their anchored stations with them', () => {
    const way = aRoad('way', [
      [0, 0],
      [1, 0],
    ]);
    const anchored = aStation('anchored', [0.5, 0], { wayId: 'way', t: 0.5 });
    const directlySelected = aStation('direct', [4, 5]);
    const untouched = aStation('untouched', [8, 9]);
    const system = aSystem({ ways: [way], stations: [anchored, directlySelected, untouched] });

    const next = nudgeSelection(
      system,
      [
        { kind: 'way', id: 'way' },
        { kind: 'station', id: 'anchored' },
        { kind: 'station', id: 'direct' },
      ],
      2,
      3,
    );

    expect(next.ways[0].points).toEqual([
      [2, 3],
      [3, 3],
    ]);
    expect(next.stations[0].coord[0]).toBeCloseTo(2.5);
    expect(next.stations[0].coord[1]).toBeCloseTo(3);
    expect(next.stations[1].coord).toEqual([6, 8]);
    expect(next.stations[2]).toBe(untouched);
    expect(next.facilities).toBe(system.facilities);
    expect(next.updatedAt).toBe(system.updatedAt);
  });

  it('moves both point and polygon facilities without touching other records', () => {
    const point = { id: 'point', typeId: 'entrance', geometry: [1, 2] as [number, number] };
    const area = {
      id: 'area',
      typeId: 'depot',
      geometry: [
        [0, 0],
        [1, 0],
      ] as [number, number][],
    };
    const system = aSystem({ facilities: [point, area] });

    const next = nudgeSelection(
      system,
      [
        { kind: 'facility', id: 'point' },
        { kind: 'facility', id: 'area' },
      ],
      -1,
      4,
    );

    expect(next.facilities).toEqual([
      { ...point, geometry: [0, 6] },
      {
        ...area,
        geometry: [
          [-1, 4],
          [0, 4],
        ],
      },
    ]);
    expect(next.stations).toBe(system.stations);
  });

  it('follows the first moved anchor even when it is not the primary anchor', () => {
    const stationary = aRoad('stationary', [
      [0, 1],
      [1, 1],
    ]);
    const moved = aRoad('moved', [
      [0, 0],
      [1, 0],
    ]);
    const station = {
      ...aStation('station', [0.25, 0]),
      anchors: [
        { wayId: 'stationary', t: 0.25 },
        { wayId: 'moved', t: 0.25 },
      ],
    };
    const system = aSystem({ ways: [stationary, moved], stations: [station] });

    const next = nudgeSelection(system, [{ kind: 'way', id: 'moved' }], 2, 3);

    expect(next.stations[0].coord[0]).toBeCloseTo(2.25);
    expect(next.stations[0].coord[1]).toBeCloseTo(3);
  });
});
