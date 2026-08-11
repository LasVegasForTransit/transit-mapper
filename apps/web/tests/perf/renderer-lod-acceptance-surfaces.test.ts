import { describe, expect, it } from 'vitest';
import { createPortMason } from '../../src/perf/renderer-port-mason-fixture';
import {
  rendererLodAcceptanceSvgMarkup,
  rendererLodAcceptanceView,
} from '../../src/perf/renderer-lod-acceptance-surfaces';

describe('renderer LOD acceptance static surfaces', () => {
  it('renders SVG from the exact requested camera and display viewport', () => {
    const request = {
      camera: {
        center: [-122.446, 37.758] as [number, number],
        zoom: 15.25,
        viewport: { width: 960, height: 600, pixelRatio: 1 },
        targetCorridorWidthPx: 10.5,
      },
      viewMode: 'infrastructure' as const,
    };

    const markup = rendererLodAcceptanceSvgMarkup(createPortMason(), request);

    expect(markup).toContain('<svg');
    expect(markup).toContain('width="960"');
    expect(markup).toContain('height="600"');
    expect(markup).toContain('<path');
    expect(rendererLodAcceptanceView(request).presentation).toMatchObject({
      zoom: 15.25,
      viewportWidthPx: 960,
      viewportHeightPx: 600,
      displayedWidthPx: 960,
      displayedHeightPx: 600,
      pixelRatio: 1,
    });
  });
});
