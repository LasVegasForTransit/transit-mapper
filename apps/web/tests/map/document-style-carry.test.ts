import { describe, expect, it } from 'vitest';
import type { StyleSpecification } from 'maplibre-gl';
import {
  carryDocumentStyle,
  editorDocumentLayersForScheme,
} from '../../src/map/document-style-carry';

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
});
