import { describe, expect, it } from 'vitest';
import {
  addStationFootprint,
  addStationPlatform,
  createStation,
  deleteStationFootprint,
  deleteStationPlatform,
  moveStationFootprintPoint,
  moveStationPlatformPoint,
  setStationDwellSeconds,
  setStationMajorStop,
  setStationName,
  withSuggestedStationName,
} from '../../src/model/system';
import type { Platform } from '../../src/model/system';
import { aStation, aSystem } from '../support/fixtures.test';

describe('station record transform identity', () => {
  it('creates an anchored station with the complete plural anchor shape', () => {
    const anchor = { wayId: 'way', t: 0.25 };

    const station = createStation([0, 0], anchor);

    expect(station.id).toEqual(expect.any(String));
    expect(station.coord).toEqual([0, 0]);
    expect(station.anchors).toEqual([anchor]);
    expect(station).not.toHaveProperty('anchor');
  });

  it('preserves the station when no automatic name was suggested', () => {
    const station = aStation('station', [0, 0], undefined, { name: 'Central' });

    expect(withSuggestedStationName(station, null)).toBe(station);
    expect(withSuggestedStationName(station, undefined)).toBe(station);
    expect(withSuggestedStationName(station, '')).toBe(station);
  });

  it('marks a suggested station name as safe for later automatic updates', () => {
    const station = aStation('station', [0, 0]);

    const next = withSuggestedStationName(station, 'Main & First');

    expect(next).toEqual({ ...station, name: 'Main & First', autoNamed: true });
    expect(next).not.toBe(station);
  });

  it('preserves a station when the same automatic suggestion repeats', () => {
    const station = aStation('station', [0, 0], undefined, {
      name: 'Main & First',
      autoNamed: true,
    });

    expect(withSuggestedStationName(station, 'Main & First')).toBe(station);
  });

  it('preserves the input for missing stations and equal metadata', () => {
    const station = aStation('station', [0, 0], undefined, {
      name: 'Central',
      autoNamed: false,
      dwellSeconds: 30,
      majorStop: true,
    });
    const system = aSystem({ stations: [station] });

    expect(setStationName(system, 'missing', 'Ghost', false)).toBe(system);
    expect(setStationDwellSeconds(system, 'missing', 20)).toBe(system);
    expect(setStationMajorStop(system, 'missing', true)).toBe(system);
    expect(setStationName(system, station.id, 'Central', false)).toBe(system);
    expect(setStationDwellSeconds(system, station.id, 30)).toBe(system);
    expect(setStationMajorStop(system, station.id, true)).toBe(system);
  });

  it('replaces only the station whose dwell and major-stop metadata changes', () => {
    const station = aStation('station', [0, 0]);
    const untouched = aStation('untouched', [1, 1]);
    const system = aSystem({ updatedAt: 222, stations: [station, untouched] });

    const withDwell = setStationDwellSeconds(system, station.id, 45);
    expect(withDwell.stations[0]).toEqual({ ...station, dwellSeconds: 45 });
    expect(withDwell.stations[1]).toBe(untouched);
    expect(withDwell.updatedAt).toBe(222);

    const major = setStationMajorStop(withDwell, station.id, true);
    expect(major.stations[0].majorStop).toBe(true);
    expect(major.stations[1]).toBe(untouched);

    const cleared = setStationMajorStop(major, station.id, false);
    expect(cleared.stations[0]).toHaveProperty('majorStop', undefined);
  });

  it('adds and moves a footprint without replacing equal or existing geometry', () => {
    const station = aStation('station', [0, 0]);
    const footprint: [number, number][] = [
      [0, 0],
      [0.001, 0],
      [0.001, 0.001],
    ];
    const system = aSystem({ stations: [station] });

    const added = addStationFootprint(system, station.id, footprint);
    expect(added.stations[0].footprint).toBe(footprint);
    expect(addStationFootprint(added, station.id, [[2, 2]])).toBe(added);
    expect(moveStationFootprintPoint(added, station.id, 0, footprint[0])).toBe(added);
    expect(moveStationFootprintPoint(added, station.id, 10, [2, 2])).toBe(added);

    const moved = moveStationFootprintPoint(added, station.id, 1, [0.002, 0]);
    expect(moved.stations[0].footprint).toEqual([footprint[0], [0.002, 0], footprint[2]]);
    expect(moved.stations[0].footprint?.[0]).toBe(footprint[0]);
  });

  it('deleting a footprint also cleans its footprint-owned platforms', () => {
    const platform: Platform = {
      id: 'platform',
      points: [
        [0, 0],
        [0.001, 0],
      ],
    };
    const station = aStation('station', [0, 0], undefined, {
      footprint: [
        [0, 0],
        [0.001, 0],
        [0.001, 0.001],
      ],
      platforms: [platform],
    });
    const system = aSystem({ stations: [station] });

    const next = deleteStationFootprint(system, station.id);

    expect(next.stations[0]).toEqual({
      ...station,
      footprint: undefined,
      platforms: undefined,
    });
    expect(deleteStationFootprint(next, station.id)).toBe(next);
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
    const station = aStation('station', [0, 0], undefined, { platforms: [first] });
    const system = aSystem({ stations: [station] });

    const added = addStationPlatform(system, station.id, second);
    expect(added.stations[0].platforms).toEqual([first, second]);
    expect(
      moveStationPlatformPoint(added, {
        stationId: station.id,
        platformId: first.id,
        index: 0,
        coord: first.points[0],
      }),
    ).toBe(added);

    const moved = moveStationPlatformPoint(added, {
      stationId: station.id,
      platformId: first.id,
      index: 1,
      coord: [0.002, 0],
    });
    expect(moved.stations[0].platforms?.[0].points).toEqual([first.points[0], [0.002, 0]]);
    expect(moved.stations[0].platforms?.[1]).toBe(second);

    const deleted = deleteStationPlatform(moved, station.id, first.id);
    expect(deleted.stations[0].platforms).toEqual([second]);
    expect(deleteStationPlatform(deleted, station.id, 'missing')).toBe(deleted);
  });
});
