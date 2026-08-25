import { describe, expect, it, vi } from 'vitest';
import type { LayerSpecification, Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import { createBaseStyleController } from '@transitmapper/map';
import {
  carryDocumentStyle,
  documentOverlayIsRetained,
  editorDocumentLayersForScheme,
} from '../../src/map/document-style-carry';

class SynchronousStyleMap {
  constructor(private current: StyleSpecification) {}

  getStyle(): StyleSpecification {
    return this.current;
  }

  setStyle(
    next: StyleSpecification,
    options?: {
      transformStyle?: (
        previous: StyleSpecification | undefined,
        incoming: StyleSpecification,
      ) => StyleSpecification;
    },
  ): this {
    this.current = options?.transformStyle?.(this.current, next) ?? next;
    return this;
  }

  on(): this {
    return this;
  }

  off(): this {
    return this;
  }
}

describe('carryDocumentStyle', () => {
  it('carries live document sources and replaces document layers with themed specs', () => {
    const previous: StyleSpecification = {
      version: 8,
      sources: {
        streets: { type: 'vector', url: 'map://streets' },
        'tm-routes': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      },
      layers: [
        { id: 'street', type: 'line', source: 'streets' },
        { id: 'tm-old', type: 'line', source: 'tm-routes' },
      ],
    };
    const next: StyleSpecification = {
      version: 8,
      sources: {},
      layers: [{ id: 'new-basemap', type: 'background' }],
    };
    const themed = [{ id: 'tm-new', type: 'line' as const, source: 'tm-routes' }];

    const carried = carryDocumentStyle(previous, next, themed);

    expect(carried.sources['tm-routes']).toEqual(previous.sources['tm-routes']);
    expect(carried.layers.map((layer) => layer.id)).toEqual(['new-basemap', 'tm-new']);
  });

  it('expands committed editor layers onto their physical source banks', () => {
    const layers = editorDocumentLayersForScheme('light');

    expect(layers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'tm-ways-solid--bank-a', source: 'tm-ways--bank-a' }),
        expect.objectContaining({ id: 'tm-ways-solid--bank-b', source: 'tm-ways--bank-b' }),
      ]),
    );
    expect(layers).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'tm-ways-solid', source: 'tm-ways' })]),
    );
  });

  it('does not install editor layers before their document sources exist', () => {
    const localLight: StyleSpecification = {
      version: 8,
      sources: {},
      layers: [{ id: 'local-light', type: 'background' }],
    };
    const localDark: StyleSpecification = {
      version: 8,
      sources: {},
      layers: [{ id: 'local-dark', type: 'background' }],
    };

    const carried = carryDocumentStyle(
      localLight,
      localDark,
      editorDocumentLayersForScheme('dark'),
    );

    expect(carried.sources).toEqual({});
    expect(carried.layers).toEqual([{ id: 'local-dark', type: 'background' }]);
  });

  it('does not request full recovery for an empty retained document diff', async () => {
    const sourceId = 'tm-empty';
    const documentLayer: LayerSpecification = {
      id: 'tm-empty-layer',
      type: 'circle',
      source: sourceId,
    };
    const emptyDocumentStyle: StyleSpecification = {
      version: 8,
      sources: {
        [sourceId]: {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        },
      },
      layers: [{ id: 'local-light', type: 'background' }, documentLayer],
    };
    const map = new SynchronousStyleMap(emptyDocumentStyle);
    const recoverDocumentLayers = vi.fn();
    const controller = createBaseStyleController({
      map: map as unknown as MapLibreMap,
      initialTheme: 'light' as const,
      local: () => emptyDocumentStyle,
      remoteUrl: () => 'https://styles.test/light.json',
      fetch: () =>
        Promise.resolve<StyleSpecification>({
          version: 8,
          sources: {},
          layers: [{ id: 'remote-light', type: 'background' }],
        }),
      carry: (previous, next) => carryDocumentStyle(previous, next, [documentLayer]),
      isDocumentStateRetained: () =>
        documentOverlayIsRetained(map.getStyle(), [sourceId], [documentLayer]),
      recoverDocumentLayers,
      timeoutMs: 250,
      online: () => true,
      isInteractionActive: () => false,
      onUnavailable: vi.fn(),
    });

    await controller.request('light');

    expect(map.getStyle().sources).toHaveProperty(sourceId);
    expect(map.getStyle().layers.map((layer) => layer.id)).toContain(documentLayer.id);
    expect(recoverDocumentLayers).toHaveBeenCalledWith('light', false);
  });
});
