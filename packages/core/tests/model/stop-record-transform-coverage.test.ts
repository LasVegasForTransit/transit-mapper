import { describe, expect, it } from 'vitest';
import {
  addStopFootprint,
  addStopPlatform,
  createStop,
  deleteStopFootprint,
  deleteStopPlatform,
  moveStopFootprintPoint,
  moveStopPlatformPoint,
  setStopDwellSeconds,
  setStopMajorStop,
  setStopName,
  withSuggestedStopName,
} from '../../src/model/system';
import type { Platform } from '../../src/model/system';
import { aStop, aSystem } from '../support/fixtures.test';

describe('stop record transform identity', () => {
  it('creates an anchored stop with the complete plural anchor shape', () => {
    const anchor = { wayId: 'way', t: 0.25 };

    const stop = createStop([0, 0], anchor);

    expect(stop.id).toEqual(expect.any(String));
    expect(stop.coord).toEqual([0, 0]);
    expect(stop.anchors).toEqual([anchor]);
    expect(stop).not.toHaveProperty('anchor');
  });

  it('preserves the stop when no automatic name was suggested', () => {
    const stop = aStop('stop', [0, 0], undefined, { name: 'Central' });

    expect(withSuggestedStopName(stop, null)).toBe(stop);
    expect(withSuggestedStopName(stop, undefined)).toBe(stop);
    expect(withSuggestedStopName(stop, '')).toBe(stop);
  });

  it('marks a suggested stop name as safe for later automatic updates', () => {
    const stop = aStop('stop', [0, 0]);

    const next = withSuggestedStopName(stop, 'Main & First');

    expect(next).toEqual({ ...stop, name: 'Main & First', autoNamed: true });
    expect(next).not.toBe(stop);
  });

  it('preserves a stop when the same automatic suggestion repeats', () => {
    const stop = aStop('stop', [0, 0], undefined, {
      name: 'Main & First',
      autoNamed: true,
    });

    expect(withSuggestedStopName(stop, 'Main & First')).toBe(stop);
  });

  it('preserves the input for missing stops and equal metadata', () => {
    const stop = aStop('stop', [0, 0], undefined, {
      name: 'Central',
      autoNamed: false,
      dwellSeconds: 30,
      majorStop: true,
    });
    const system = aSystem({ stops: [stop] });

    expect(setStopName(system, 'missing', 'Ghost', false)).toBe(system);
    expect(setStopDwellSeconds(system, 'missing', 20)).toBe(system);
    expect(setStopMajorStop(system, 'missing', true)).toBe(system);
    expect(setStopName(system, stop.id, 'Central', false)).toBe(system);
    expect(setStopDwellSeconds(system, stop.id, 30)).toBe(system);
    expect(setStopMajorStop(system, stop.id, true)).toBe(system);
  });

  it('replaces only the stop whose dwell and major-stop metadata changes', () => {
    const stop = aStop('stop', [0, 0]);
    const untouched = aStop('untouched', [1, 1]);
    const system = aSystem({ updatedAt: 222, stops: [stop, untouched] });

    const withDwell = setStopDwellSeconds(system, stop.id, 45);
    expect(withDwell.stops[0]).toEqual({ ...stop, dwellSeconds: 45 });
    expect(withDwell.stops[1]).toBe(untouched);
    expect(withDwell.updatedAt).toBe(222);

    const major = setStopMajorStop(withDwell, stop.id, true);
    expect(major.stops[0].majorStop).toBe(true);
    expect(major.stops[1]).toBe(untouched);

    const cleared = setStopMajorStop(major, stop.id, false);
    expect(cleared.stops[0]).toHaveProperty('majorStop', undefined);
  });

  it('adds and moves a footprint without replacing equal or existing geometry', () => {
    const stop = aStop('stop', [0, 0]);
    const footprint: [number, number][] = [
      [0, 0],
      [0.001, 0],
      [0.001, 0.001],
    ];
    const system = aSystem({ stops: [stop] });

    const added = addStopFootprint(system, stop.id, footprint);
    expect(added.stops[0].footprint).toBe(footprint);
    expect(addStopFootprint(added, stop.id, [[2, 2]])).toBe(added);
    expect(moveStopFootprintPoint(added, stop.id, 0, footprint[0])).toBe(added);
    expect(moveStopFootprintPoint(added, stop.id, 10, [2, 2])).toBe(added);

    const moved = moveStopFootprintPoint(added, stop.id, 1, [0.002, 0]);
    expect(moved.stops[0].footprint).toEqual([footprint[0], [0.002, 0], footprint[2]]);
    expect(moved.stops[0].footprint?.[0]).toBe(footprint[0]);
  });

  it('deleting a footprint also cleans its footprint-owned platforms', () => {
    const platform: Platform = {
      id: 'platform',
      points: [
        [0, 0],
        [0.001, 0],
      ],
    };
    const stop = aStop('stop', [0, 0], undefined, {
      footprint: [
        [0, 0],
        [0.001, 0],
        [0.001, 0.001],
      ],
      platforms: [platform],
    });
    const system = aSystem({ stops: [stop] });

    const next = deleteStopFootprint(system, stop.id);

    expect(next.stops[0]).toEqual({
      ...stop,
      footprint: undefined,
      platforms: undefined,
    });
    expect(deleteStopFootprint(next, stop.id)).toBe(next);
  });

  it('adds, moves, and deletes one platform with structural sharing', () => {
    const first: Platform = {
      id: 'first',
      points: [
        [0, 0],
        [0.001, 0],
      ],
    };
    const second: Platform = {
      id: 'second',
      points: [
        [0, 0.001],
        [0.001, 0.001],
      ],
    };
    const stop = aStop('stop', [0, 0], undefined, { platforms: [first] });
    const system = aSystem({ stops: [stop] });

    const added = addStopPlatform(system, stop.id, second);
    expect(added.stops[0].platforms).toEqual([first, second]);
    expect(
      moveStopPlatformPoint(added, {
        stopId: stop.id,
        platformId: first.id,
        index: 0,
        coord: first.points[0],
      }),
    ).toBe(added);

    const moved = moveStopPlatformPoint(added, {
      stopId: stop.id,
      platformId: first.id,
      index: 1,
      coord: [0.002, 0],
    });
    expect(moved.stops[0].platforms?.[0].points).toEqual([first.points[0], [0.002, 0]]);
    expect(moved.stops[0].platforms?.[1]).toBe(second);

    const deleted = deleteStopPlatform(moved, stop.id, first.id);
    expect(deleted.stops[0].platforms).toEqual([second]);
    expect(deleteStopPlatform(deleted, stop.id, 'missing')).toBe(deleted);
  });
});
