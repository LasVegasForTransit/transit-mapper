import { describe, expect, it } from 'vitest';
import { aRoad, aStation } from '../testing/fixtures';
import { nearWaysForStations } from './featureMemo';

describe('station proximity memoization', () => {
  it('reuses proximity results for station objects retained in a new array', () => {
    const ways = [
      aRoad('road', [
        [-115.2, 36.1],
        [-115.1, 36.1],
      ]),
    ];
    const retained = aStation('retained', [-115.15, 36.1]);
    const changed = aStation('changed', [-115.14, 36.1]);
    const first = nearWaysForStations([retained, changed], ways);
    const moved = { ...changed, coord: [-115.14, 36.2] as [number, number] };

    const next = nearWaysForStations([retained, moved], ways);

    expect(next[0]).toBe(first[0]);
    expect(next[1]).not.toBe(first[1]);
    expect(next).toEqual([['road'], []]);
  });

  it('recomputes station proximity when the visible ways array changes', () => {
    const station = aStation('station', [-115.15, 36.1]);
    const nearbyWays = [
      aRoad('road', [
        [-115.2, 36.1],
        [-115.1, 36.1],
      ]),
    ];
    const distantWays = [
      aRoad('road', [
        [-115.2, 36.2],
        [-115.1, 36.2],
      ]),
    ];
    const first = nearWaysForStations([station], nearbyWays);

    const next = nearWaysForStations([station], distantWays);

    expect(next[0]).not.toBe(first[0]);
    expect(first).toEqual([['road']]);
    expect(next).toEqual([[]]);
  });
});
