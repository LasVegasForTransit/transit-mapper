import type { LayerSpecification } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import {
  LYR_CENTER_LINES,
  LYR_CARRIAGEWAYS,
  LYR_CONNECTORS,
  LYR_CROSSWALKS,
  LYR_EDGE_LINES,
  LYR_JUNCTIONS,
  LYR_JUNCTION_CONTROLS,
  LYR_JUNCTION_SELECTED,
  LYR_LANE_ARROWS,
  LYR_LANE_LINES,
  LYR_LANE_SURFACES,
  LYR_LANE_TRACKS,
  LYR_RAIL_TIES,
  LYR_SERVICES_ELEVATED,
  LYR_SERVICES_SOLID,
  LYR_SERVICES_SOLID_CASING,
  LYR_SERVICES_UNDERGROUND,
  LYR_SERVICES_UNDERGROUND_CASING,
  LYR_STOP_BARS,
  LYR_WAYS_DASHED,
  LYR_WAYS_DASHED_CASING,
  LYR_WAYS_SOLID,
  LYR_WAYS_SOLID_CASING,
  LYR_WAY_SELECTED,
  LYR_SERVICE_SELECTED,
  serviceFocusOpacityExpr,
  tierOpacityExpr,
} from '../../src/map/layers/constants';
import { createLayerSpecs } from '../../src/map/layers/layerSpecs';
import { MAP_THEMES } from '../../src/map/mapThemePalette';

function layer(id: string): LayerSpecification {
  const found = createLayerSpecs(MAP_THEMES.light).find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing layer ${id}`);
  return found;
}

function paint(id: string, property: string): unknown {
  const properties = layer(id).paint;
  return Object.entries(properties ?? {}).find(([name]) => name === property)?.[1];
}

function filter(id: string): unknown {
  const specification = layer(id);
  return 'filter' in specification ? specification.filter : undefined;
}

function layout(id: string, property: string): unknown {
  const properties = layer(id).layout;
  return Object.entries(properties ?? {}).find(([name]) => name === property)?.[1];
}

function expectCameraTierOpacity(id: string, property: string, baseOpacity: unknown): void {
  const expression = paint(id, property);
  expect(Array.isArray(expression)).toBe(true);
  if (!Array.isArray(expression)) return;
  const expressionValues: unknown[] = expression;

  expect(expressionValues.slice(0, 3)).toEqual(['interpolate', ['exponential', 2], ['zoom']]);
  const stops = expressionValues.filter((_, index) => index >= 3 && index % 2 === 1);
  expect(stops).toEqual(expect.arrayContaining([13.75, 14, 14.25]));

  const z14Index = expressionValues.findIndex((value, index) => index >= 3 && value === 14);
  const z14Output = expressionValues[z14Index + 1];
  expect(Array.isArray(z14Output) && z14Output[0]).toBe('case');

  const serialized = JSON.stringify(z14Output);
  const projectedWidth = [
    '*',
    ['coalesce', ['get', 'corridorDisplayW14'], ['get', 'corridorW14']],
    1,
  ];
  expect(serialized).toContain(JSON.stringify(baseOpacity));
  expect(serialized).toContain(JSON.stringify(['get', 'renderTier']));
  expect(serialized).toContain(
    JSON.stringify(['interpolate', ['linear'], projectedWidth, 2, 0, 4, 1]),
  );
  expect(serialized).toContain(
    JSON.stringify(['interpolate', ['linear'], projectedWidth, 9, 0, 12, 1]),
  );
  expect(serialized).toContain('"/"');
  expect(serialized).toContain(JSON.stringify(['coalesce', ['get', 'tierOpacity'], 1]));
}

describe('screen-space LOD layer specifications', () => {
  it('keeps Overview widths fixed while District uses physical corridor width', () => {
    const district = ['==', ['get', 'renderTier'], 'district'];

    expect(paint(LYR_WAYS_SOLID, 'line-width')).toEqual([
      'interpolate',
      ['exponential', 2],
      ['zoom'],
      14,
      ['case', district, ['get', 'corridorW14'], ['get', 'width']],
      22,
      ['case', district, ['*', 256, ['get', 'corridorW14']], ['get', 'width']],
    ]);
    expect(paint(LYR_WAYS_SOLID_CASING, 'line-width')).toEqual([
      'interpolate',
      ['exponential', 2],
      ['zoom'],
      14,
      ['case', district, ['+', ['get', 'corridorW14'], 2], ['+', ['get', 'width'], 2]],
      22,
      ['case', district, ['+', ['*', 256, ['get', 'corridorW14']], 2], ['+', ['get', 'width'], 2]],
    ]);
    expect(paint(LYR_WAYS_DASHED, 'line-width')).toEqual(paint(LYR_WAYS_SOLID, 'line-width'));
    expect(paint(LYR_WAYS_DASHED_CASING, 'line-width')).toEqual(
      paint(LYR_WAYS_SOLID_CASING, 'line-width'),
    );
  });

  it('derives corridor opacity continuously from fractional zoom and projected width', () => {
    expectCameraTierOpacity(LYR_WAYS_SOLID, 'line-opacity', 0.9);
    expectCameraTierOpacity(LYR_WAYS_DASHED, 'line-opacity', 0.9);
    expectCameraTierOpacity(LYR_WAYS_SOLID_CASING, 'line-opacity', 0.62);
    expectCameraTierOpacity(LYR_WAYS_DASHED_CASING, 'line-opacity', 0.62);
  });

  it('fills the physical District carriageway instead of inflating a line', () => {
    expect(layer(LYR_CARRIAGEWAYS).type).toBe('fill');
    expectCameraTierOpacity(LYR_CARRIAGEWAYS, 'fill-opacity', 0.9);
    expect(paint(LYR_CARRIAGEWAYS, 'fill-outline-color')).toBe(MAP_THEMES.light.routeCasing);
  });

  it('cross-fades Street surfaces, markings, arrows, connectors, and junctions', () => {
    expectCameraTierOpacity(LYR_LANE_SURFACES, 'fill-opacity', 0.9);
    expectCameraTierOpacity(LYR_LANE_TRACKS, 'line-opacity', 1);
    expectCameraTierOpacity(LYR_RAIL_TIES, 'line-opacity', 0.78);
    expectCameraTierOpacity(LYR_LANE_LINES, 'line-opacity', 0.9);
    expectCameraTierOpacity(LYR_EDGE_LINES, 'line-opacity', 0.75);
    expectCameraTierOpacity(LYR_CENTER_LINES, 'line-opacity', 0.95);
    expectCameraTierOpacity(LYR_CONNECTORS, 'line-opacity', 0.55);
    expectCameraTierOpacity(LYR_LANE_ARROWS, 'text-opacity', 0.9);
    expectCameraTierOpacity(LYR_JUNCTIONS, 'fill-opacity', 0.9);
    expectCameraTierOpacity(LYR_JUNCTION_CONTROLS, 'circle-opacity', 1);
    expect(layer(LYR_JUNCTION_CONTROLS).type).toBe('circle');
    expect(filter(LYR_JUNCTION_CONTROLS)).toEqual(['has', 'control']);
    expect(paint(LYR_JUNCTION_CONTROLS, 'circle-radius')).toEqual(
      expect.arrayContaining(['yield', 3.5]),
    );
    expectCameraTierOpacity(LYR_CROSSWALKS, 'line-opacity', 0.9);
    expect(layer(LYR_CROSSWALKS).type).toBe('line');
    expect(filter(LYR_CROSSWALKS)).toEqual(['==', ['get', 'kind'], 'crosswalk']);
    expectCameraTierOpacity(LYR_STOP_BARS, 'line-opacity', 0.95);
    expect(layer(LYR_STOP_BARS).type).toBe('line');
    expect(filter(LYR_STOP_BARS)).toEqual(['==', ['get', 'kind'], 'stopBar']);
  });

  it('cross-fades service centerlines and lane paths through the same tier bands', () => {
    expectCameraTierOpacity(LYR_SERVICES_ELEVATED, 'line-opacity', 0.32);
    expectCameraTierOpacity(LYR_SERVICES_SOLID_CASING, 'line-opacity', 0.72);
    expectCameraTierOpacity(LYR_SERVICES_SOLID, 'line-opacity', 1);
    expectCameraTierOpacity(LYR_SERVICES_UNDERGROUND_CASING, 'line-opacity', 0.72);
    expectCameraTierOpacity(LYR_SERVICES_UNDERGROUND, 'line-opacity', 1);
    expectCameraTierOpacity(LYR_SERVICE_SELECTED, 'line-opacity', [
      'case',
      ['boolean', ['feature-state', 'selected'], false],
      0.18,
      ['boolean', ['feature-state', 'hover'], false],
      0.1,
      0,
    ]);
  });

  it('does not use a fixed zoom gate for physical LOD layers', () => {
    for (const id of [
      LYR_WAYS_SOLID,
      LYR_WAYS_DASHED,
      LYR_LANE_SURFACES,
      LYR_LANE_TRACKS,
      LYR_RAIL_TIES,
      LYR_LANE_LINES,
      LYR_EDGE_LINES,
      LYR_CENTER_LINES,
      LYR_CONNECTORS,
      LYR_LANE_ARROWS,
      LYR_JUNCTIONS,
    ]) {
      expect(layer(id).minzoom, id).toBeUndefined();
    }
  });

  it('cross-fades selection and hover halos with their owned geometry', () => {
    const selectionOpacity = [
      'case',
      ['boolean', ['feature-state', 'selected'], false],
      0.18,
      ['boolean', ['feature-state', 'hover'], false],
      0.1,
      0,
    ];
    expectCameraTierOpacity(LYR_WAY_SELECTED, 'line-opacity', selectionOpacity);
    expectCameraTierOpacity(LYR_SERVICE_SELECTED, 'line-opacity', selectionOpacity);
    expectCameraTierOpacity(LYR_JUNCTION_SELECTED, 'line-opacity', [
      'case',
      ['boolean', ['feature-state', 'selected'], false],
      0.7,
      ['boolean', ['feature-state', 'hover'], false],
      0.35,
      0,
    ]);
    expect(filter(LYR_JUNCTION_SELECTED)).toBeUndefined();
  });

  it('uses the full physical corridor width for Street selection halos', () => {
    const haloWidth = JSON.stringify(paint(LYR_WAY_SELECTED, 'line-width'));
    expect(haloWidth).toContain(JSON.stringify(['get', 'corridorW14']));
    expect(haloWidth).toContain(JSON.stringify(['get', 'renderTier']));
    expect(haloWidth).not.toContain(JSON.stringify(['has', 'w14']));
  });

  it('paints physical Street surfaces above the fading District silhouette', () => {
    const ids = createLayerSpecs(MAP_THEMES.light).map((specification) => specification.id);
    expect(ids.indexOf(LYR_WAYS_SOLID)).toBeLessThan(ids.indexOf(LYR_LANE_SURFACES));
    expect(ids.indexOf(LYR_WAYS_DASHED)).toBeLessThan(ids.indexOf(LYR_LANE_SURFACES));
    expect(ids.indexOf(LYR_WAY_SELECTED)).toBeGreaterThan(ids.indexOf(LYR_LANE_SURFACES));
  });

  it('uses an explicit tier sort key so differential patches cannot reverse blends', () => {
    const sortKey = ['match', ['get', 'renderTier'], 'overview', 1, 'district', 2, 'street', 3, 0];
    for (const id of [
      LYR_WAY_SELECTED,
      LYR_WAYS_SOLID_CASING,
      LYR_WAYS_SOLID,
      LYR_WAYS_DASHED_CASING,
      LYR_WAYS_DASHED,
      LYR_SERVICES_ELEVATED,
      LYR_SERVICE_SELECTED,
      LYR_SERVICES_SOLID_CASING,
      LYR_SERVICES_SOLID,
      LYR_SERVICES_UNDERGROUND_CASING,
      LYR_SERVICES_UNDERGROUND,
    ]) {
      expect(layout(id, 'line-sort-key'), id).toEqual(sortKey);
    }
  });

  it('keeps route focus inside the tier-opacity expression', () => {
    expect(serviceFocusOpacityExpr(0.72, false)).toBe(tierOpacityExpr(0.72));

    const focused = serviceFocusOpacityExpr(1, true);
    const serialized = JSON.stringify(focused);
    expect(serialized).toContain(JSON.stringify(['feature-state', 'selected']));
    expect(serialized).toContain(JSON.stringify(['get', 'renderTier']));
    expect(serialized).toContain(JSON.stringify(['get', 'corridorW14']));
  });

  it('preserves dashed, elevated, and underground grade styling', () => {
    expect(filter(LYR_WAYS_DASHED)).toEqual(['get', 'dashed']);
    expect(paint(LYR_WAYS_DASHED, 'line-dasharray')).toEqual([2, 2]);
    expect(filter(LYR_SERVICES_ELEVATED)).toEqual([
      'all',
      ['!', ['get', 'hitTarget']],
      ['get', 'elevated'],
    ]);
    expectCameraTierOpacity(LYR_SERVICES_ELEVATED, 'line-opacity', 0.32);
    expect(filter(LYR_SERVICES_UNDERGROUND)).toEqual([
      'all',
      ['!', ['get', 'hitTarget']],
      ['get', 'underground'],
    ]);
    expect(paint(LYR_SERVICES_UNDERGROUND_CASING, 'line-dasharray')).toEqual([2.5, 2]);
    expectCameraTierOpacity(LYR_SERVICES_UNDERGROUND_CASING, 'line-opacity', 0.72);
  });
});
