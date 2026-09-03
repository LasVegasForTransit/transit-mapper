import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';
import {
  LYR_GESTURE_POINT,
  LYR_LANE_SURFACES,
  LYR_STATIONS,
  SRC_GESTURE,
  SRC_LANES,
  SRC_STATIONS,
  bankedLayerId,
  bankedSourceId,
} from '@transitmapper/map/layers';
import * as rendererLayers from '@transitmapper/map/layers';
import { documentLayerSpecsForViewMode } from '@transitmapper/map/driver';
import { LAYER_SPECS } from '../../src/map/layers';
import {
  editorMapSurfaceLayerSpecs,
  installEditorMapLayers,
} from '../../src/editor/editor-map-layers';

const CATALOG: readonly LayerSpecification[] = [
  { id: LYR_STATIONS, type: 'circle', source: SRC_STATIONS },
  { id: LYR_LANE_SURFACES, type: 'fill', source: SRC_LANES },
  { id: LYR_GESTURE_POINT, type: 'circle', source: SRC_GESTURE },
];

describe('editor map layers', () => {
  it('keeps the Pattern overlay out of document map compositions', () => {
    const sourceKeys = [
      'SRC_PATTERN_OVERLAY',
      'SRC_PATTERN_OVERLAY_ARROWS',
      'SRC_PATTERN_OVERLAY_TERMINI',
    ];
    const overlaySources = sourceKeys.map(
      (key) => (rendererLayers as Record<string, unknown>)[key],
    );

    expect(overlaySources.every((source) => typeof source === 'string')).toBe(true);
    const sources = new Set(
      overlaySources.filter((source): source is string => typeof source === 'string'),
    );
    const catalog = LAYER_SPECS;
    const overlayLayers = catalog.filter(
      (spec) => 'source' in spec && typeof spec.source === 'string' && sources.has(spec.source),
    );
    const documentLayers = documentLayerSpecsForViewMode(catalog, 'network');

    expect(overlayLayers).not.toHaveLength(0);
    expect(editorMapSurfaceLayerSpecs(catalog, documentLayers)).toEqual(
      expect.arrayContaining(overlayLayers),
    );
    expect(documentLayers).not.toEqual(expect.arrayContaining(overlayLayers));
  });

  it('composes document and editor layers in catalog order', () => {
    expect(editorMapSurfaceLayerSpecs(CATALOG, [CATALOG[0]])).toEqual([CATALOG[0], CATALOG[2]]);
  });

  it('does not rebuild a surface that already contains the composed editor layers', () => {
    const style: StyleSpecification = {
      version: 8,
      sources: {},
      layers: [
        { id: 'basemap', type: 'background' },
        {
          id: bankedLayerId(LYR_STATIONS, 'a'),
          type: 'circle',
          source: bankedSourceId(SRC_STATIONS, 'a'),
        },
        {
          id: bankedLayerId(LYR_STATIONS, 'b'),
          type: 'circle',
          source: bankedSourceId(SRC_STATIONS, 'b'),
        },
        { id: LYR_GESTURE_POINT, type: 'circle', source: SRC_GESTURE },
      ],
    };
    const setStyle = vi.fn();
    const map = {
      getLayer: (id: string) => style.layers.find((layer) => layer.id === id),
      getStyle: () => style,
      setStyle,
    };

    installEditorMapLayers(map as never, CATALOG);

    expect(setStyle).not.toHaveBeenCalled();
  });

  it('adds editor-owned layers without installing document layers from another representation', () => {
    let style: StyleSpecification = {
      version: 8,
      sources: {},
      layers: [
        { id: 'basemap', type: 'background' },
        {
          id: bankedLayerId(LYR_STATIONS, 'a'),
          type: 'circle',
          source: bankedSourceId(SRC_STATIONS, 'a'),
        },
        {
          id: bankedLayerId(LYR_STATIONS, 'b'),
          type: 'circle',
          source: bankedSourceId(SRC_STATIONS, 'b'),
        },
      ],
    };
    const setStyle = vi.fn((next: StyleSpecification) => {
      style = next;
    });
    const map = {
      getLayer: (id: string) => style.layers.find((layer) => layer.id === id),
      getStyle: () => style,
      setStyle,
    };

    installEditorMapLayers(map as never, CATALOG);

    expect(style.layers.map((layer) => layer.id)).toEqual([
      'basemap',
      bankedLayerId(LYR_STATIONS, 'a'),
      bankedLayerId(LYR_STATIONS, 'b'),
      LYR_GESTURE_POINT,
    ]);
    expect(setStyle).toHaveBeenCalledWith(style, { diff: true, validate: false });
  });
});
