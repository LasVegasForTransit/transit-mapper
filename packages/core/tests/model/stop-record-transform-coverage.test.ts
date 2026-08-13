import { describe, expect, it } from 'vitest';
import {
  createStop,
  setStopDwellSeconds,
  setStopMajorStop,
  setStopName,
  withSuggestedStopName,
} from '../../src/model/system';
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
});
