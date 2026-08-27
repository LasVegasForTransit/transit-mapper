import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { sourceBankLayerSpecs } from '@transitmapper/renderer/layers';
import { layerSpecsForScheme } from './mapTheme';
import type { ColorScheme } from '../theme/color-scheme';

function documentLayersForScheme(scheme: ColorScheme): LayerSpecification[] {
  return sourceBankLayerSpecs(layerSpecsForScheme(scheme));
}

export const editorDocumentLayersForScheme = documentLayersForScheme;

export function documentOverlayIsRetained(
  style: StyleSpecification,
  sourceIds: Iterable<string>,
  documentLayers: readonly LayerSpecification[],
): boolean {
  const retainedLayerIds = new Set(style.layers.map((layer) => layer.id));
  for (const sourceId of sourceIds) {
    if (!(sourceId in style.sources)) return false;
  }
  return documentLayers.every((layer) => retainedLayerIds.has(layer.id));
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
