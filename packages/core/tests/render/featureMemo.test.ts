import { describe, expect, it } from 'vitest';
import { aRoad, aStop } from '../support/fixtures.test';
import { nearWaysForStops } from '../../src/render/featureMemo';

function horizontalRoad(id: string, latitude: number) {
  return aRoad(id, [
    [-115.2, latitude],
    [-115.1, latitude],
  ]);
}

describe('stop proximity memoization', () => {
  it('reuses proximity results for stop objects retained in a new array', () => {
    const ways = [horizontalRoad('road', 36.1)];
    const retained = aStop('retained', [-115.15, 36.1]);
    const changed = aStop('changed', [-115.14, 36.1]);
    const first = nearWaysForStops([retained, changed], ways);
    const moved = { ...changed, coord: [-115.14, 36.2] as [number, number] };

    const next = nearWaysForStops([retained, moved], ways);

    expect(next[0]).toBe(first[0]);
    expect(next[1]).not.toBe(first[1]);
    expect(next).toEqual([['road'], []]);
  });

  it('falls back when a new visible ways array retains no way objects', () => {
    const stop = aStop('stop', [-115.15, 36.1]);
    const nearbyWays = [horizontalRoad('road', 36.1)];
    const distantWays = [horizontalRoad('road', 36.2)];
    const first = nearWaysForStops([stop], nearbyWays);

    const next = nearWaysForStops([stop], distantWays);

    expect(next[0]).not.toBe(first[0]);
    expect(first).toEqual([['road']]);
    expect(next).toEqual([[]]);
  });

  it('adds a nearby way without replacing an unaffected stop result', () => {
    const retained = horizontalRoad('retained', 36.1004);
    const added = horizontalRoad('added', 36.1001);
    const affected = aStop('affected', [-115.15, 36.1]);
    const unaffected = aStop('unaffected', [-115.15, 36.2]);
    const first = nearWaysForStops([affected, unaffected], [retained]);

    const next = nearWaysForStops([affected, unaffected], [retained, added]);

    expect(next[0]).not.toBe(first[0]);
    expect(next[1]).toBe(first[1]);
    expect(next).toEqual([['added', 'retained'], []]);
  });

  it('keeps the prior result when an added way is outside interchange range', () => {
    const retained = horizontalRoad('retained', 36.1);
    const addedFarAway = horizontalRoad('far-away', 36.2);
    const stop = aStop('stop', [-115.15, 36.1]);
    const first = nearWaysForStops([stop], [retained]);

    const next = nearWaysForStops([stop], [retained, addedFarAway]);

    expect(next[0]).toBe(first[0]);
    expect(next).toEqual([['retained']]);
  });

  it('removes a moved-away way without replacing an unaffected stop result', () => {
    const moved = horizontalRoad('moved', 36.1);
    const retained = horizontalRoad('retained', 36.2);
    const firstStop = aStop('first', [-115.15, 36.1]);
    const secondStop = aStop('second', [-115.15, 36.2]);
    const first = nearWaysForStops([firstStop, secondStop], [moved, retained]);
    const movedAway = horizontalRoad('moved', 36.3);

    const next = nearWaysForStops([firstStop, secondStop], [movedAway, retained]);

    expect(next[0]).not.toBe(first[0]);
    expect(next[1]).toBe(first[1]);
    expect(next).toEqual([[], ['retained']]);
  });

  it('removes a way excluded by visibility without replacing unrelated results', () => {
    const hidden = horizontalRoad('hidden', 36.1);
    const retained = horizontalRoad('retained', 36.2);
    const hiddenStop = aStop('hidden-stop', [-115.15, 36.1]);
    const retainedStop = aStop('retained-stop', [-115.15, 36.2]);
    const first = nearWaysForStops([hiddenStop, retainedStop], [hidden, retained]);

    const next = nearWaysForStops([hiddenStop, retainedStop], [retained]);

    expect(next[0]).not.toBe(first[0]);
    expect(next[1]).toBe(first[1]);
    expect(next).toEqual([[], ['retained']]);
  });

  it('merges added ways by exact distance and then id', () => {
    const farther = horizontalRoad('farther', 36.1004);
    const tiedZ = horizontalRoad('z-tied', 36.1001);
    const tiedA = horizontalRoad('a-tied', 36.1001);
    const stop = aStop('stop', [-115.15, 36.1]);
    nearWaysForStops([stop], [farther, tiedZ]);

    const next = nearWaysForStops([stop], [farther, tiedZ, tiedA]);

    expect(next).toEqual([['a-tied', 'z-tied', 'farther']]);
  });
});
