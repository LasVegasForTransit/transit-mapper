import { describe, expect, it } from 'vitest';
import { positionFloatingSurface } from '../../src/ui/floating-position';

const viewport = { width: 800, height: 600, padding: 12 };

describe('floating surface positioning', () => {
  it('honors the preferred side and alignment when they fit', () => {
    expect(
      positionFloatingSurface({
        anchor: { top: 100, right: 300, bottom: 140, left: 200 },
        surface: { width: 120, height: 80 },
        viewport,
        preference: { side: 'bottom', align: 'end', gap: 8 },
      }),
    ).toEqual({ left: 180, top: 148, side: 'bottom' });
  });

  it('flips away from a blocked edge', () => {
    expect(
      positionFloatingSurface({
        anchor: { top: 550, right: 300, bottom: 590, left: 200 },
        surface: { width: 120, height: 100 },
        viewport,
        preference: { side: 'bottom', align: 'start', gap: 8 },
      }),
    ).toEqual({ left: 200, top: 442, side: 'top' });
  });

  it('clamps the cross axis inside the phone edge', () => {
    expect(
      positionFloatingSurface({
        anchor: { top: 40, right: 790, bottom: 80, left: 760 },
        surface: { width: 220, height: 80 },
        viewport,
        preference: { side: 'bottom', align: 'start', gap: 8 },
      }),
    ).toEqual({ left: 568, top: 88, side: 'bottom' });
  });
});
