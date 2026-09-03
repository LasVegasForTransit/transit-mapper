import type { FeatureCollection, LineString } from 'geojson';
import { describe, expect, it } from 'vitest';
import { MODE_ORDER, WAY_TYPE_ORDER } from '../../src/model/catalog';
import type { LngLat } from '../../src/model/system';
import type { RenderViewOptions } from '../../src/render/buildFeatures';
import { systemSvg } from '../../src/render/svg';
import { aPattern, aRoad, aService, aStop, aSystem } from '../support/fixtures.test';

const CORRIDOR: LngLat[] = [
  [-115.22, 36.14],
  [-115.16, 36.14],
];
const SERVICE_COLOR = '#e4572e';
const STRIPE_COLOR = '#123456';

const VIEW: RenderViewOptions = {
  viewMode: 'network',
  visibleModes: new Set(MODE_ORDER),
  visibleWayTypes: new Set(WAY_TYPE_ORDER),
  presentation: {
    bounds: { southwest: [-115.3, 36], northeast: [-115, 36.3] },
    zoom: 14,
    viewportWidthPx: 1_000,
    viewportHeightPx: 700,
    displayedWidthPx: 1_000,
    displayedHeightPx: 700,
    pixelRatio: 1,
  },
};

function project([lng, lat]: LngLat): { x: number; y: number } {
  return { x: (lng + 115.3) * 2_500, y: (36.3 - lat) * 2_000 };
}

function corridorSystem() {
  const way = aRoad('carrier', CORRIDOR);
  const service = aService('service', [aPattern('pattern', [way], [way.id])]);
  const stop = aStop('stop', [-115.19, 36.14], undefined, { name: 'Midtown' });
  return aSystem({ ways: [way], services: [service], stops: [stop] });
}

/** One resolved corridor in the shape `projectResolvedLineScene` emits: a
 *  shared casing plus one stripe per Line, carrying no operational identity. */
const passengerLines: FeatureCollection<LineString> = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'render:services:line-casing:corridor',
      properties: {
        routeRole: 'casing',
        width: 5,
        offset: 0,
        renderTier: 'overview',
        renderOrder: -1,
        tierOpacity: 1,
      },
      geometry: { type: 'LineString', coordinates: CORRIDOR },
    },
    {
      type: 'Feature',
      id: 'render:services:line-stripe:corridor',
      properties: {
        routeRole: 'stripe',
        lineId: 'line-a',
        color: STRIPE_COLOR,
        width: 4,
        offset: 0,
        renderTier: 'overview',
        renderOrder: 0,
        tierOpacity: 1,
      },
      geometry: { type: 'LineString', coordinates: CORRIDOR },
    },
  ],
};

/** Distinct route feature identities in paint order. Each identity is drawn
 *  once per paint pass, so the raw attribute occurrences over-count. */
function routeFeatureIds(svg: string): string[] {
  const ids = [...svg.matchAll(/data-render-source="services" data-feature-id="([^"]+)"/g)].map(
    (match) => match[1],
  );
  return [...new Set(ids)];
}

/** Stroke colours of the drawn paths. A stop circle carries its serving Line's
 *  colour too, so a bare substring search cannot tell a route from a marker. */
function pathStrokes(svg: string): string[] {
  return [...svg.matchAll(/<path[^>]*stroke="([^"]+)"/g)].map((match) => match[1]);
}

function svgFor(options: { passengerLines?: FeatureCollection<LineString> } = {}): string {
  return systemSvg(corridorSystem(), VIEW, project, {
    title: '',
    legend: [],
    width: 1_000,
    height: 700,
    captionedExternally: true,
    ...options,
  });
}

describe('static passenger Line geometry', () => {
  it('draws per-Service stripes when no Line scene is supplied', () => {
    const svg = svgFor();

    expect(routeFeatureIds(svg).length).toBeGreaterThan(0);
    expect(pathStrokes(svg)).toContain(SERVICE_COLOR);
  });

  it('replaces the per-Service stripes with the supplied Line scene', () => {
    const svg = svgFor({ passengerLines });

    expect(routeFeatureIds(svg)).toEqual([
      'render:services:line-casing:corridor',
      'render:services:line-stripe:corridor',
    ]);
    expect(pathStrokes(svg)).toContain(STRIPE_COLOR);
    expect(pathStrokes(svg)).not.toContain(SERVICE_COLOR);
  });

  it('leaves everything but the routes on the document projection', () => {
    const svg = svgFor({ passengerLines });

    expect(svg).toContain('Midtown');
  });
});
