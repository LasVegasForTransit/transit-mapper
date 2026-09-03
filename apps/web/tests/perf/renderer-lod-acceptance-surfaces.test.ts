import { describe, expect, it } from 'vitest';
import { createPortMason } from '../../src/perf/renderer-port-mason-fixture';
import { createRendererFixture } from '../../src/perf/renderer-fixtures';
import {
  rendererLodAcceptanceSvgMarkup,
  rendererLodAcceptanceView,
  type RendererLodAcceptanceSurfaceRequest,
} from '../../src/perf/renderer-lod-acceptance-surfaces';

const PORT_MASON_REQUEST: RendererLodAcceptanceSurfaceRequest = {
  camera: {
    center: [-122.446, 37.758],
    zoom: 15.25,
    viewport: { width: 960, height: 600, pixelRatio: 1 },
    targetCorridorWidthPx: 10.5,
  },
  viewMode: 'infrastructure',
};

const SHARED_TRUNK_REQUEST: RendererLodAcceptanceSurfaceRequest = {
  camera: {
    center: [-115.176, 36.13],
    zoom: 16,
    viewport: { width: 960, height: 600, pixelRatio: 1 },
  },
  viewMode: 'network',
};

/** Distinct route identities. Every identity paints once per pass, so the raw
 *  attribute occurrences say nothing about how many stripes the drawing has. */
function routeFeatureIds(markup: string): string[] {
  return [
    ...new Set(
      [...markup.matchAll(/data-render-source="services" data-feature-id="([^"]+)"/g)].map(
        (match) => match[1],
      ),
    ),
  ];
}

/** Stroke colours of the drawn paths. A stop marker carries its serving Line's
 *  colour too, so a bare substring search cannot tell a route from a marker. */
function pathStrokes(markup: string): string[] {
  return [...markup.matchAll(/<path[^>]*stroke="([^"]+)"/g)].map((match) => match[1]);
}

describe('renderer LOD acceptance static surfaces', () => {
  it('renders SVG from the exact requested camera and display viewport', async () => {
    const markup = await rendererLodAcceptanceSvgMarkup(createPortMason(), PORT_MASON_REQUEST);

    expect(markup).toContain('<svg');
    expect(markup).toContain('width="960"');
    expect(markup).toContain('height="600"');
    expect(markup).toContain('<path');
    expect(rendererLodAcceptanceView(PORT_MASON_REQUEST).presentation).toMatchObject({
      zoom: 15.25,
      viewportWidthPx: 960,
      viewportHeightPx: 600,
      displayedWidthPx: 960,
      displayedHeightPx: 600,
      pixelRatio: 1,
    });
  });

  it('paints a passenger view from Lines and drops the per-ServicePlan stripes', async () => {
    const system = createRendererFixture('shared-service-trunk');

    const markup = await rendererLodAcceptanceSvgMarkup(system, SHARED_TRUNK_REQUEST);

    for (const line of system.lines) expect(pathStrokes(markup)).toContain(line.color);
    expect(markup).not.toContain('paint-fragment');
  });

  it('shares one casing between the Lines bundled on a corridor', async () => {
    const markup = await rendererLodAcceptanceSvgMarkup(
      createRendererFixture('shared-service-trunk'),
      SHARED_TRUNK_REQUEST,
    );

    const ids = routeFeatureIds(markup);
    const casings = ids.filter((id) => id.includes('line-casing')).length;
    const stripes = ids.filter((id) => id.includes('line-stripe')).length;
    expect(casings).toBeGreaterThan(0);
    expect(casings).toBeLessThan(stripes);
  });

  it('leaves an infrastructure view on its per-Service geometry', async () => {
    const markup = await rendererLodAcceptanceSvgMarkup(
      createRendererFixture('shared-service-trunk'),
      { ...SHARED_TRUNK_REQUEST, viewMode: 'infrastructure' },
    );

    expect(markup).not.toContain('line-stripe');
  });
});
