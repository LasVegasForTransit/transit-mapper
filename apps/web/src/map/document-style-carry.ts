import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { sourceBankLayerSpecs } from '@transitmapper/renderer/layers';
import { layerSpecsForScheme } from './mapTheme';
import type { ColorScheme } from '../theme/systemColorScheme';

export function editorDocumentLayersForScheme(scheme: ColorScheme): LayerSpecification[] {
  return sourceBankLayerSpecs(layerSpecsForScheme(scheme));
}

/** Preserve the accepted document scene while replacing only the base map. */
export function carryDocumentStyle(
  previous: StyleSpecification | undefined,
  next: StyleSpecification,
  documentLayers: readonly LayerSpecification[],
): StyleSpecification {
  const sources = { ...next.sources };
  for (const [id, source] of Object.entries(previous?.sources ?? {})) {
    if (id.startsWith('tm-')) sources[id] = source;
  }
  const availableDocumentLayers = documentLayers.filter(
    (layer) => !('source' in layer) || typeof layer.source !== 'string' || layer.source in sources,
  );
  return {
    ...next,
    sources,
    layers: [
      ...next.layers.filter((layer) => !layer.id.startsWith('tm-')),
      ...availableDocumentLayers,
    ],
  };
}
