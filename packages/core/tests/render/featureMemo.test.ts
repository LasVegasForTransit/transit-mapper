import { describe, expect, it } from 'vitest';
import { aRoad, aStation } from '../support/fixtures.test';
import { nearWaysForStations } from '../../src/render/featureMemo';

function horizontalRoad(id: string, latitude: number) {
  return aRoad(id, [
    [-115.2, latitude],
    [-115.1, latitude],
  ]);
}

describe('station proximity memoization', () => {
  it('reuses proximity results for station objects retained in a new array', () => {
    const ways = [horizontalRoad('road', 36.1)];
    const retained = aStation('retained', [-115.15, 36.1]);
    const changed = aStation('changed', [-115.14, 36.1]);
    const first = nearWaysForStations([retained, changed], ways);
    const moved = { ...changed, coord: [-115.14, 36.2] as [number, number] };

    const next = nearWaysForStations([retained, moved], ways);

    expect(next[0]).toBe(first[0]);
    expect(next[1]).not.toBe(first[1]);
    expect(next).toEqual([['road'], []]);
  });

  it('falls back when a new visible ways array retains no way objects', () => {
    const station = aStation('station', [-115.15, 36.1]);
    const nearbyWays = [horizontalRoad('road', 36.1)];
    const distantWays = [horizontalRoad('road', 36.2)];
    const first = nearWaysForStations([station], nearbyWays);

    const next = nearWaysForStations([station], distantWays);

    expect(next[0]).not.toBe(first[0]);
    expect(first).toEqual([['road']]);
    expect(next).toEqual([[]]);
  });

  it('adds a nearby way without replacing an unaffected station result', () => {
    const retained = horizontalRoad('retained', 36.1004);
    const added = horizontalRoad('added', 36.1001);
    const affected = aStation('affected', [-115.15, 36.1]);
    const unaffected = aStation('unaffected', [-115.15, 36.2]);
    const first = nearWaysForStations([affected, unaffected], [retained]);

    const next = nearWaysForStations([affected, unaffected], [retained, added]);

    expect(next[0]).not.toBe(first[0]);
    expect(next[1]).toBe(first[1]);
    expect(next).toEqual([['added', 'retained'], []]);
  });

  it('keeps the prior result when an added way is outside interchange range', () => {
    const retained = horizontalRoad('retained', 36.1);
    const addedFarAway = horizontalRoad('far-away', 36.2);
    const station = aStation('station', [-115.15, 36.1]);
    const first = nearWaysForStations([station], [retained]);

    const next = nearWaysForStations([station], [retained, addedFarAway]);

    expect(next[0]).toBe(first[0]);
    expect(next).toEqual([['retained']]);
  });

  it('removes a moved-away way without replacing an unaffected station result', () => {
    const moved = horizontalRoad('moved', 36.1);
    const retained = horizontalRoad('retained', 36.2);
    const firstStation = aStation('first', [-115.15, 36.1]);
    const secondStation = aStation('second', [-115.15, 36.2]);
    const first = nearWaysForStations([firstStation, secondStation], [moved, retained]);
    const movedAway = horizontalRoad('moved', 36.3);

    const next = nearWaysForStations([firstStation, secondStation], [movedAway, retained]);

    expect(next[0]).not.toBe(first[0]);
    expect(next[1]).toBe(first[1]);
    expect(next).toEqual([[], ['retained']]);
  });

  it('removes a way excluded by visibility without replacing unrelated results', () => {
    const hidden = horizontalRoad('hidden', 36.1);
    const retained = horizontalRoad('retained', 36.2);
    const hiddenStation = aStation('hidden-station', [-115.15, 36.1]);
    const retainedStation = aStation('retained-station', [-115.15, 36.2]);
    const first = nearWaysForStations([hiddenStation, retainedStation], [hidden, retained]);

    const next = nearWaysForStations([hiddenStation, retainedStation], [retained]);

    expect(next[0]).not.toBe(first[0]);
    expect(next[1]).toBe(first[1]);
    expect(next).toEqual([[], ['retained']]);
  });

  it('merges added ways by exact distance and then id', () => {
    const farther = horizontalRoad('farther', 36.1004);
    const tiedZ = horizontalRoad('z-tied', 36.1001);
    const tiedA = horizontalRoad('a-tied', 36.1001);
    const station = aStation('station', [-115.15, 36.1]);
    nearWaysForStations([station], [farther, tiedZ]);

    const next = nearWaysForStations([station], [farther, tiedZ, tiedA]);

    expect(next).toEqual([['a-tied', 'z-tied', 'farther']]);
  });
});
