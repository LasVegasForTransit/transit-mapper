import { describe, expect, it } from 'vitest';
import type { ViewOptions } from '../../src/map/layers';
import { svgViewForFittedMap, svgViewForViewport } from '../../src/share/svg-render-view';

const view: ViewOptions = {
  viewMode: 'infrastructure',
  visibleModes: new Set(['bus']),
  visibleWayTypes: new Set(['road']),
};

describe('SVG render presentation', () => {
  it('resolves one DPR-independent view from the final fitted map camera', () => {
    const resolved = svgViewForFittedMap(view, {
      getBounds: () => ({
        getSouthWest: () => ({ lng: -115.2, lat: 36.1 }),
        getNorthEast: () => ({ lng: -115.1, lat: 36.2 }),
      }),
      getZoom: () => 16.25,
      getCanvas: () => ({ clientWidth: 1_600, clientHeight: 1_000 }),
      getContainer: () => ({ clientWidth: 800, clientHeight: 500 }),
      getPixelRatio: () => 3,
    });

    expect(resolved).not.toBe(view);
    expect(view.presentation).toBeUndefined();
    expect(resolved.presentation).toEqual({
      bounds: {
        southwest: [-115.2, 36.1],
        northeast: [-115.1, 36.2],
      },
      zoom: 16.25,
      viewportWidthPx: 1_600,
      viewportHeightPx: 1_000,
      displayedWidthPx: 800,
      displayedHeightPx: 500,
      pixelRatio: 1,
    });
  });

  it('resolves the quick-export view from its pure fitted viewport', () => {
    const resolved = svgViewForViewport(
      view,
      { center: [-115.15, 36.15], zoom: 12, width: 1_200, height: 630 },
      { displayedWidthPx: 600, displayedHeightPx: 315 },
    );

    expect(resolved.presentation).toMatchObject({
      zoom: 12,
      viewportWidthPx: 1_200,
      viewportHeightPx: 630,
      displayedWidthPx: 600,
      displayedHeightPx: 315,
      pixelRatio: 1,
    });
  });
});
