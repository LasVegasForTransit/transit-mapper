import { describe, expect, it } from 'vitest';
import {
  LYR_SERVICES_SOLID_CASING,
  LYR_SERVICES_UNDERGROUND_CASING,
  LYR_WAYS_DASHED_CASING,
  LYR_WAYS_SOLID_CASING,
} from '@transitmapper/renderer/layers';
import { createLayerSpecs } from '../../src/map/layers/layerSpecs';
import {
  MAP_THEMES,
  type MapTheme,
  basemapStyleForScheme,
  initialEditorStyleForScheme,
  layerSpecsForScheme,
  localBlankStyleForScheme,
} from '../../src/map/mapTheme';

function containsUserColorExpression(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  if (value[0] === 'get' && value[1] === 'color') return true;
  return value.some(containsUserColorExpression);
}

describe('map themes', () => {
  it('uses the paired OpenFreeMap styles and a scheme-aware local canvas', () => {
    expect(basemapStyleForScheme('light')).toContain('/styles/positron');
    expect(basemapStyleForScheme('dark')).toContain('/styles/dark');

    const lightBackground = localBlankStyleForScheme('light').layers[0];
    const darkBackground = localBlankStyleForScheme('dark').layers[0];
    expect(lightBackground).toMatchObject({
      id: 'transitmapper-local-background',
      paint: { 'background-color': MAP_THEMES.light.background },
    });
    expect(darkBackground).toMatchObject({
      id: 'transitmapper-local-background',
      paint: { 'background-color': MAP_THEMES.dark.background },
    });
  });

  it('starts on the local drafting style when the editor opens offline', () => {
    expect(initialEditorStyleForScheme('dark', false)).toEqual(localBlankStyleForScheme('dark'));
  });

  it('leaves the local canvas transparent so the editor drafting surface remains visible', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const background = localBlankStyleForScheme(scheme).layers[0];
      expect(background).toMatchObject({
        id: 'transitmapper-local-background',
        paint: { 'background-opacity': 0 },
      });
    }
  });

  it('gives the deterministic local canvas a same-origin glyph endpoint for text layers', () => {
    const style = localBlankStyleForScheme('light');

    expect(style.glyphs).toMatch(/^https?:\/\/[^/]+\/glyphs\/noto-sans-v1\//);
    expect(style.glyphs).toContain('{fontstack}');
    expect(style.glyphs).toContain('{range}');
    expect(layerSpecsForScheme('light').some((layer) => layer.type === 'symbol')).toBe(true);
  });

  it('keeps layer identity, source, filter, and order stable between schemes', () => {
    const identity = (scheme: 'light' | 'dark') =>
      layerSpecsForScheme(scheme).map((layer) => ({
        id: layer.id,
        type: layer.type,
        source: 'source' in layer ? layer.source : undefined,
        sourceLayer: 'source-layer' in layer ? layer['source-layer'] : undefined,
        filter: 'filter' in layer ? layer.filter : undefined,
      }));

    expect(identity('dark')).toEqual(identity('light'));
  });

  it('preserves every expression that renders user-authored colors', () => {
    const light = layerSpecsForScheme('light');
    const dark = layerSpecsForScheme('dark');
    const lightLayers = light.filter((layer) => containsUserColorExpression(layer.paint));
    const darkLayers = dark.filter((layer) => containsUserColorExpression(layer.paint));

    expect(lightLayers.map((layer) => layer.id)).toEqual(darkLayers.map((layer) => layer.id));
    for (let index = 0; index < lightLayers.length; index += 1) {
      expect(containsUserColorExpression(lightLayers[index]?.paint)).toBe(true);
      expect(containsUserColorExpression(darkLayers[index]?.paint)).toBe(true);
    }
  });

  it('places neutral contrast casings immediately beneath user-colored routes', () => {
    const ids = layerSpecsForScheme('dark').map((layer) => layer.id);
    const pairs = [
      [LYR_WAYS_SOLID_CASING, 'tm-ways-solid'],
      [LYR_WAYS_DASHED_CASING, 'tm-ways-dashed'],
      [LYR_SERVICES_SOLID_CASING, 'tm-services-solid'],
      [LYR_SERVICES_UNDERGROUND_CASING, 'tm-services-underground'],
    ];

    for (const [casing, route] of pairs) {
      expect(ids.indexOf(casing)).toBe(ids.indexOf(route) - 1);
    }
  });

  it('reverses neutral contrast without transforming domain colors', () => {
    expect(MAP_THEMES.light.routeCasing).toBe(MAP_THEMES.light.ink);
    expect(MAP_THEMES.dark.routeCasing).toBe(MAP_THEMES.dark.ink);
    expect(MAP_THEMES.light.routeCasing).not.toBe(MAP_THEMES.dark.routeCasing);
  });

  it('binds every semantic cartographic role to a rendered layer or icon', () => {
    const uniqueTheme = Object.fromEntries(
      Object.keys(MAP_THEMES.dark).map((role) => [role, `role:${role}`]),
    ) as unknown as MapTheme;
    const renderedLayerColors = JSON.stringify(createLayerSpecs(uniqueTheme));
    const rolesRenderedByLayers = [
      'ink',
      'mutedContext',
      'paper',
      'labelHalo',
      'selection',
      'hover',
      'gesturePreview',
      'footprint',
      'footprintStroke',
      'laneMarking',
      'landmark',
      'danger',
      'vehicleStroke',
      'routeCasing',
    ] satisfies (keyof MapTheme)[];

    for (const role of rolesRenderedByLayers) {
      expect(renderedLayerColors).toContain(`role:${role}`);
    }
  });
});
