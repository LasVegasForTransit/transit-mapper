import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FIRST_SYSTEM_MAP_PAINT_MARK,
  acceptedSystemScenePaintReady,
  systemInteractiveReady,
  markFirstSystemMapPaint,
  systemPaintReady,
} from '../../src/perf/mapPaintMark';

afterEach(() => {
  performance.clearMarks(FIRST_SYSTEM_MAP_PAINT_MARK);
  vi.restoreAllMocks();
});

describe('first system map paint mark', () => {
  it('uses the canonical production first-system-paint milestone', () => {
    expect(FIRST_SYSTEM_MAP_PAINT_MARK).toBe('tm:first-system-paint');
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
        documentReady: false,
        systemDataUploaded: true,
        systemDataMatchesDocument: true,
        representativeSourceExists: true,
        representativeSourceLoaded: true,
      }),
    ).toBe(false);
    expect(
      systemPaintReady({
        documentReady: true,
        systemDataUploaded: false,
        systemDataMatchesDocument: false,
        representativeSourceExists: true,
        representativeSourceLoaded: true,
      }),
    ).toBe(false);
    expect(
      systemPaintReady({
        documentReady: true,
        systemDataUploaded: true,
        systemDataMatchesDocument: false,
        representativeSourceExists: true,
        representativeSourceLoaded: true,
      }),
    ).toBe(false);
    expect(
      systemPaintReady({
        documentReady: true,
        systemDataUploaded: true,
        systemDataMatchesDocument: true,
        representativeSourceExists: true,
        representativeSourceLoaded: false,
      }),
    ).toBe(false);
    expect(
      systemPaintReady({
        documentReady: true,
        systemDataUploaded: true,
        systemDataMatchesDocument: true,
        representativeSourceExists: true,
        representativeSourceLoaded: true,
      }),
    ).toBe(true);
  });

  it('accepts the source-publication paint barrier as first-paint evidence', () => {
    expect(
      acceptedSystemScenePaintReady({
        documentReady: true,
        systemDataUploaded: true,
        systemDataMatchesDocument: true,
        acceptedScenePainted: false,
      }),
    ).toBe(false);
    expect(
      acceptedSystemScenePaintReady({
        documentReady: true,
        systemDataUploaded: true,
        systemDataMatchesDocument: true,
        acceptedScenePainted: true,
      }),
    ).toBe(true);
  });

  it('requires both a committed document and attached interactions', () => {
    expect(systemInteractiveReady({ documentCommitted: false, interactionsAttached: true })).toBe(
      false,
    );
    expect(systemInteractiveReady({ documentCommitted: true, interactionsAttached: false })).toBe(
      false,
    );
    expect(systemInteractiveReady({ documentCommitted: true, interactionsAttached: true })).toBe(
      true,
    );
  });
});
