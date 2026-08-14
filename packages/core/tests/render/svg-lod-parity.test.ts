import { describe, expect, it } from 'vitest';
import { MODE_ORDER, WAY_TYPE_ORDER } from '../../src/model/catalog';
import { defaultProfileFor, profileWidthM } from '../../src/model/profile';
import type { LngLat, TransitSystem, Way } from '../../src/model/system';
import { widthPxAtZ14 } from '../../src/render/constants';
import { buildFeatures, type RenderViewOptions } from '../../src/render/buildFeatures';
import {
  resolveStaticVisualScene,
  type ResolvedStaticPolygon,
} from '../../src/render/static-visual-scene';
import { systemSvg } from '../../src/render/svg';
import { aPattern, aRoad, aService, aSystem } from '../support/fixtures.test';

const BOUNDS = {
  southwest: [-115.3, 36] as LngLat,
  northeast: [-115, 36.3] as LngLat,
};

function viewAtWidth(way: Way, displayedWidthPx: number): RenderViewOptions {
  const corridorWidthAtZ14 = widthPxAtZ14(profileWidthM(way.profile), way.points[0]?.[1] ?? 0);
  return {
    viewMode: 'infrastructure',
    visibleModes: new Set(MODE_ORDER),
    visibleWayTypes: new Set(WAY_TYPE_ORDER),
    presentation: {
      bounds: BOUNDS,
      zoom: 14 + Math.log2(displayedWidthPx / corridorWidthAtZ14),
      viewportWidthPx: 1_000,
      viewportHeightPx: 700,
      displayedWidthPx: 1_000,
      displayedHeightPx: 700,
      pixelRatio: 1,
    },
  };
}

function junctionFixture(): { system: TransitSystem; referenceWay: Way } {
  const west = aRoad('west', [
    [-115.22, 36.14],
    [-115.18, 36.14],
  ]);
  const east = aRoad('east', [
    [-115.18, 36.14],
    [-115.14, 36.14],
  ]);
  const north = aRoad('north', [
    [-115.18, 36.14],
    [-115.18, 36.18],
  ]);
  const service = aService('service', [aPattern('pattern', [west, east], [west.id, east.id])]);
  return {
    referenceWay: west,
    system: aSystem({
      ways: [west, east, north],
      services: [service],
      nodes: [
        {
          id: 'junction',
          coord: west.points[1],
          control: 'signal',
          refs: [
            { wayId: west.id, pointIndex: 1 },
            { wayId: east.id, pointIndex: 0 },
            { wayId: north.id, pointIndex: 0 },
          ],
        },
      ],
    }),
  };
}

function svgAtWidth(displayedWidthPx: number): string {
  const { system, referenceWay } = junctionFixture();
  return systemSvg(
    system,
    viewAtWidth(referenceWay, displayedWidthPx),
    ([lng, lat]) => ({ x: (lng + 115.3) * 2_500, y: (36.3 - lat) * 2_000 }),
    {
      title: '',
      legend: [],
      width: 1_000,
      height: 700,
      captionedExternally: true,
    },
  );
}

describe('SVG screen-space LOD parity', () => {
  it('renders one Overview silhouette without Street physical geometry', () => {
    const svg = svgAtWidth(1);

    expect(svg).toContain('data-render-source="ways"');
    expect(svg).toContain('data-render-tier="overview"');
    expect(svg).not.toContain('data-render-tier="district"');
    expect(svg).not.toContain('data-render-tier="street"');
    expect(svg).not.toContain('data-render-source="lanes"');
  });

  it('lets a public surface replace editor casing ink without changing geometry', () => {
    const { system, referenceWay } = junctionFixture();
    const svg = systemSvg(
      system,
      viewAtWidth(referenceWay, 1),
      ([lng, lat]) => ({ x: (lng + 115.3) * 2_500, y: (36.3 - lat) * 2_000 }),
      {
        title: '',
        legend: [],
        width: 1_000,
        height: 700,
        captionedExternally: true,
        cartographyCasingColor: '#0F1115',
      },
    );

    expect(svg).toContain('stroke="#0F1115"');
    expect(svg).not.toContain('stroke="#191a17"');
  });

  it('uses the deterministic half-opacity blend at the Overview-District midpoint', () => {
    const svg = svgAtWidth(3);

    expect(svg).toContain('data-render-tier="overview"');
    expect(svg).toContain('data-render-tier="district"');
    expect(svg).toContain('data-resolved-width="3.000"');
    expect(svg).toMatch(/data-render-tier="overview"[^>]+opacity="0\.8182"/);
    expect(svg).toMatch(/data-render-tier="district"[^>]+opacity="0\.4500"/);
    expect(svg).toMatch(/data-render-tier="district"[^>]+stroke="#191a17"/);
    expect(svg.indexOf('render:ways:overview:west')).toBeLessThan(
      svg.indexOf('render:ways:district:west'),
    );
    expect(svg).not.toContain('data-render-tier="street"');
  });

  it('resolves District corridors as closed physical carriageway footprints', () => {
    const { system, referenceWay } = junctionFixture();
    const resolved = resolveStaticVisualScene({
      revision: 'district-carriageway',
      features: buildFeatures(system, null, [], viewAtWidth(referenceWay, 3)),
      presentation: viewAtWidth(referenceWay, 3).presentation,
    });
    const districtWays = resolved.visuals.filter(
      (visual) => visual.source === 'ways' && visual.renderTier === 'district',
    );

    expect(districtWays.length).toBeGreaterThan(0);
    expect(districtWays.every((visual) => visual.kind === 'polygon')).toBe(true);
    const footprint = districtWays.find(
      (visual): visual is ResolvedStaticPolygon => visual.kind === 'polygon',
    );
    expect(footprint?.rings[0]?.[0]).toEqual(footprint?.rings[0]?.at(-1));
    expect(footprint?.outlineColor).toBe('#191a17');
  });

  it('renders District and physical Street sources at the upper midpoint in paint order', () => {
    const svg = svgAtWidth(10.5);
    const sourceOrder = ['junctions', 'ways', 'lanes', 'lane-markings', 'services'];
    const positions = sourceOrder.map((source) => svg.indexOf(`data-render-source="${source}"`));

    expect(svg).toContain('data-render-tier="district"');
    expect(svg).toContain('data-render-tier="street"');
    expect(svg).toContain('data-render-source="junctions"');
    expect(svg).toContain('data-render-source="lanes"');
    expect(svg).toContain('data-render-source="lane-markings"');
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(svg).toMatch(/data-render-tier="district"[^>]+opacity="0\.8182"/);
    expect(svg).toMatch(/data-render-tier="street"[^>]+opacity="0\.4500"/);
  });

  it('keeps selection-owned junction guides out of the settled SVG scene', () => {
    const { system, referenceWay } = junctionFixture();
    const view = viewAtWidth(referenceWay, 10.5);
    const resolved = resolveStaticVisualScene({
      revision: 'selected-junction',
      features: buildFeatures(system, { kind: 'node', id: 'junction' }, [], view),
      presentation: view.presentation,
    });
    const sources = resolved.visuals.map((visual) => visual.source);

    expect(sources).not.toContain('connectors');
    expect(sources.indexOf('ways')).toBeLessThan(sources.indexOf('lane-markings'));
  });

  it('holds a District-only tunnel at full opacity beyond the Street threshold', () => {
    const tunnel = {
      ...aRoad('tunnel', [
        [-115.22, 36.14],
        [-115.14, 36.14],
      ]),
      grade: 'underground' as const,
    };
    const svg = systemSvg(
      aSystem({ ways: [tunnel] }),
      viewAtWidth(tunnel, 12),
      ([lng, lat]) => ({ x: (lng + 115.3) * 2_500, y: (36.3 - lat) * 2_000 }),
      { title: '', legend: [], width: 1_000, height: 700, captionedExternally: true },
    );

    expect(svg).toMatch(/data-render-tier="district"[^>]+opacity="0\.9000"/);
    expect(svg).not.toContain('data-render-tier="street"');
  });

  it('settles on physical Street geometry without painting the selection-only halo or hits', () => {
    const svg = svgAtWidth(12);

    expect(svg).toContain('data-render-source="lanes"');
    expect(svg).toContain('data-render-source="lane-markings"');
    expect(svg).toContain('data-render-source="junctions"');
    expect(svg).toContain('data-render-tier="street"');
    expect(svg).not.toContain('data-render-tier="district"');
    expect(svg).not.toContain('street-halo');
    expect(svg).not.toContain('data-halo-only');
    expect(svg).not.toContain('data-hit-target');
    expect(svg).not.toContain('stroke-width="10"');
  });

  it('serializes an explicit signal as the opaque junction control painted by the live map', () => {
    const svg = svgAtWidth(12);

    expect(svg).toMatch(
      /<circle data-render-source="junctions"[^>]+data-feature-id="render:junctions:control:junction"[^>]+fill="#b23b2e"[^>]+opacity="1\.0000"\/>/,
    );
  });

  it('serializes signal-controlled crosswalk stripes from the settled lane-marking source', () => {
    const svg = svgAtWidth(12);

    expect(svg).toContain('data-feature-id="render:lane-markings:crosswalk:junction:west:end"');
    expect(svg).toContain('data-render-source="lane-markings"');
  });

  it('serializes signal-controlled stop bars from the settled lane-marking source', () => {
    const svg = svgAtWidth(12);

    expect(svg).toContain('data-feature-id="render:lane-markings:stop-bar:junction:west:end"');
    expect(svg).toContain('data-resolved-width="2.500"');
  });

  it('serializes Street lane surfaces as the same closed polygons MapLibre fills', () => {
    const { system, referenceWay } = junctionFixture();
    const view = viewAtWidth(referenceWay, 12);
    const resolved = resolveStaticVisualScene({
      revision: 'street-lane-polygons',
      features: buildFeatures(system, null, [], view),
      presentation: view.presentation,
    });
    const lanes = resolved.visuals.filter((visual) => visual.source === 'lanes');

    expect(lanes.length).toBeGreaterThan(0);
    expect(lanes.every((visual) => visual.kind === 'polygon')).toBe(true);
  });

  it('serializes the compact rail tie collection as individual physical ties', () => {
    const railway = aRoad(
      'railway',
      [
        [-115.2, 36.14],
        [-115.1995, 36.14],
      ],
      { typeId: 'lightRail', profile: defaultProfileFor('lightRail') },
    );
    const view = viewAtWidth(railway, 12);
    const resolved = resolveStaticVisualScene({
      revision: 'rail-detail',
      features: buildFeatures(aSystem({ ways: [railway] }), null, [], view),
      presentation: view.presentation,
    });
    const railVisuals = resolved.visuals.filter((visual) => visual.source === 'lane-markings');

    expect(railVisuals.length).toBeGreaterThan(2);
    expect(railVisuals.every((visual) => visual.kind === 'line')).toBe(true);
  });
});
