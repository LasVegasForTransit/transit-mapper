import { describe, expect, it } from 'vitest';
import { LAYER_SPECS } from '../../src/map/layers';
import {
  sourceBankLayerSpecs,
  physicalRenderSourceIds,
  renderOverlayNeedsHealing,
} from '../../src/map/source-bank-layers';
import { ALL_SYSTEM_FEATURE_SOURCES } from '../../src/map/system-feature-sources';

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
