import type { LayerSpecification } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import { documentLayerSpecsForViewMode } from '../src/document-layer-plan';
import {
  SRC_FACILITIES,
  SRC_HANDLES,
  SRC_HIT_FEATURES,
  SRC_LANDMARKS,
  SRC_LANES,
  SRC_PREVIEW,
  SRC_SERVICES,
  SRC_STATIONS,
  SRC_VEHICLES,
  SRC_WAYS,
} from '../src/layers/constants';

function layer(id: string, source: string): LayerSpecification {
  return { id, type: 'line', source };
}

const catalog = [
  layer('ways', SRC_WAYS),
  layer('services', SRC_SERVICES),
  layer('hits', SRC_HIT_FEATURES),
  layer('stations', SRC_STATIONS),
  layer('lanes', SRC_LANES),
  layer('facilities', SRC_FACILITIES),
  layer('landmarks', SRC_LANDMARKS),
  layer('handles', SRC_HANDLES),
  layer('preview', SRC_PREVIEW),
  layer('vehicles', SRC_VEHICLES),
];

function ids(viewMode: 'network' | 'infrastructure' | 'diagram'): string[] {
  return documentLayerSpecsForViewMode(catalog, viewMode).map((spec) => spec.id);
}

describe('document layer plan', () => {
  it('keeps the network representation free of infrastructure and editor layers', () => {
    expect(ids('network')).toEqual(['ways', 'services', 'hits', 'stations', 'landmarks']);
  });

  it('adds physical document layers without adding editor or simulation layers', () => {
    expect(ids('infrastructure')).toEqual([
      'ways',
      'services',
      'hits',
      'stations',
      'lanes',
      'facilities',
      'landmarks',
    ]);
  });

  it('keeps diagram rendering independent from geographic context layers', () => {
    expect(ids('diagram')).toEqual(['ways', 'services', 'hits', 'stations']);
  });
});
