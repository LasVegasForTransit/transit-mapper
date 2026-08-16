import { describe, expect, test } from 'vitest';
import type { RenderPresentation } from '../../src/render/render-presentation';
import { screenDensity } from '../../src/render/screen-density';

interface Candidate {
  readonly id: string;
  readonly coordinate: readonly [number, number];
  readonly priority: number;
}

function presentation(overrides: Partial<RenderPresentation> = {}): RenderPresentation {
  return {
    bounds: {
      southwest: [-115.3, 36.1],
      northeast: [-115.2, 36.2],
    },
    zoom: 14,
    viewportWidthPx: 800,
    viewportHeightPx: 600,
    displayedWidthPx: 800,
    displayedHeightPx: 600,
    pixelRatio: 1,
    ...overrides,
  };
}

function candidate(id: string, coordinate: readonly [number, number], priority = 0): Candidate {
  return { id, coordinate, priority };
}

describe('screenDensity', () => {
  test('keeps the highest-priority marker in each displayed-pixel cell', () => {
    const markers = [
      candidate('ordinary-stop', [-115.25, 36.15]),
      candidate('interchange', [-115.25001, 36.15001], 2),
      candidate('other-stop', [-115.23, 36.15]),
    ];

    expect(screenDensity(markers, presentation(), 32).map(({ id }) => id)).toEqual([
      'interchange',
      'other-stop',
    ]);
  });

  test('uses stable ids to break a density tie', () => {
    const markers = [
      candidate('zeta', [-115.25, 36.15]),
      candidate('alpha', [-115.25001, 36.15001]),
    ];

    expect(screenDensity(markers, presentation(), 32).map(({ id }) => id)).toEqual(['alpha']);
  });

  test('uses final display size and world-aligned cells instead of viewport position', () => {
    const markers = [candidate('west', [-115.25, 36.15]), candidate('east', [-115.251, 36.15])];
    const full = presentation();
    const halfSize = presentation({ displayedWidthPx: 400, displayedHeightPx: 300 });
    const panned = presentation({
      bounds: {
        southwest: [-115.29, 36.1],
        northeast: [-115.19, 36.2],
      },
    });

    expect(screenDensity(markers, full, 32).map(({ id }) => id)).toEqual(['west', 'east']);
    expect(screenDensity(markers, halfSize, 32).map(({ id }) => id)).toEqual(['east']);
    expect(screenDensity(markers, full, 32).map(({ id }) => id)).toEqual(
      screenDensity(markers, panned, 32).map(({ id }) => id),
    );
  });
});
