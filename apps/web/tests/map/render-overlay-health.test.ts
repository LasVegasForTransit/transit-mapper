import { describe, expect, it } from 'vitest';
import type { LayerSpecification } from 'maplibre-gl';
import {
  ALL_SYSTEM_FEATURE_SOURCES,
  sourceBankLayerSpecs,
  physicalRenderSourceIds,
  renderOverlayNeedsHealing,
} from '@transitmapper/map/layers';

const layerSpecsModulePath = '../../src/map/layers/layerSpecs.ts';
const { LAYER_SPECS } = (await import(/* @vite-ignore */ layerSpecsModulePath)) as {
  LAYER_SPECS: readonly LayerSpecification[];
};

describe('render overlay health', () => {
  it('recognizes the complete physical bank overlay without logical committed layer IDs', () => {
    const physicalLayers = sourceBankLayerSpecs(LAYER_SPECS);
    const layerIds = new Set(physicalLayers.map((layer) => layer.id));
    const sourceIds = physicalRenderSourceIds(ALL_SYSTEM_FEATURE_SOURCES);
    const sources = new Set(sourceIds);

    expect(
      renderOverlayNeedsHealing({
        sourceIds,
        layerIds: physicalLayers.map((layer) => layer.id),
        hasSource: (sourceId) => sources.has(sourceId),
        hasLayer: (layerId) => layerIds.has(layerId),
      }),
    ).toBe(false);
    expect(
      LAYER_SPECS.filter((layer) => !layerIds.has(layer.id)).some(
        (layer) => 'source' in layer && typeof layer.source === 'string',
      ),
    ).toBe(true);
  });
});
