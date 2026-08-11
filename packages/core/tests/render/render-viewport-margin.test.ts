import { describe, expect, it } from 'vitest';
import type { RenderPresentation } from '../../src/render/render-presentation';
import {
  renderViewportTransitionMarginDegrees,
  renderViewportTransitionMarginPx,
} from '../../src/render/render-viewport-margin';

function presentation(width: number, height: number): RenderPresentation {
  return {
    bounds: { southwest: [0, 0], northeast: [1, 1] },
    zoom: 12,
    viewportWidthPx: width,
    viewportHeightPx: height,
    displayedWidthPx: width,
    displayedHeightPx: height,
    pixelRatio: 1,
  };
}

describe('renderer viewport transition margin', () => {
  it('uses a viewport-relative guard band bounded between 256 and 512 pixels', () => {
    expect(renderViewportTransitionMarginPx(presentation(320, 240))).toBe(256);
    expect(renderViewportTransitionMarginPx(presentation(390, 844))).toBe(422);
    expect(renderViewportTransitionMarginPx(presentation(1_440, 900))).toBe(512);
  });

  it('converts the shared pixel guard through the larger degree-per-pixel axis', () => {
    expect(renderViewportTransitionMarginDegrees(presentation(1_000, 500))).toBeCloseTo(1);
  });
});
