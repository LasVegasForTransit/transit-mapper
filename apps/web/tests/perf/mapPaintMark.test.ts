import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FIRST_SYSTEM_MAP_PAINT_MARK,
  mapPaintInstrumentationEnabled,
  markFirstSystemMapPaint,
  systemPaintReady,
} from '../../src/perf/mapPaintMark';

afterEach(() => {
  performance.clearMarks(FIRST_SYSTEM_MAP_PAINT_MARK);
  vi.restoreAllMocks();
});

describe('first system map paint mark', () => {
  it('is disabled for ordinary production and enabled only for development or a perf run', () => {
    expect(mapPaintInstrumentationEnabled({ development: false, automatedPerfRun: false })).toBe(
      false,
    );
    expect(mapPaintInstrumentationEnabled({ development: true, automatedPerfRun: false })).toBe(
      true,
    );
    expect(mapPaintInstrumentationEnabled({ development: false, automatedPerfRun: true })).toBe(
      true,
    );
  });

  it('records the first proven system paint only once', () => {
    const mark = vi.spyOn(performance, 'mark');

    markFirstSystemMapPaint();
    markFirstSystemMapPaint();

    expect(mark).toHaveBeenCalledTimes(1);
    expect(mark).toHaveBeenCalledWith(FIRST_SYSTEM_MAP_PAINT_MARK);
  });

  it('requires uploaded system data and one completed representative source', () => {
    expect(
      systemPaintReady({
        systemDataUploaded: false,
        representativeSourceExists: true,
        representativeSourceLoaded: true,
      }),
    ).toBe(false);
    expect(
      systemPaintReady({
        systemDataUploaded: true,
        representativeSourceExists: true,
        representativeSourceLoaded: false,
      }),
    ).toBe(false);
    expect(
      systemPaintReady({
        systemDataUploaded: true,
        representativeSourceExists: true,
        representativeSourceLoaded: true,
      }),
    ).toBe(true);
  });
});
