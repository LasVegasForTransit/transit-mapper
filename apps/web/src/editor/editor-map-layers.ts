import type { LayerSpecification, Map as MLMap } from 'maplibre-gl';
import {
  EDITOR_SYSTEM_FEATURE_SOURCES,
  SRC_ACTION_ANCHOR,
  SRC_ENDPOINT_HINT,
  SRC_GESTURE,
  SRC_JUNCTION_GUIDES,
  SRC_MARQUEE,
  SRC_PREVIEW,
  SRC_SHARING,
  SRC_VEHICLES,
  SRC_VEHICLES_INFRA,
  sourceBankLayerSpecs,
} from '@transitmapper/renderer/layers';

const EDITOR_MAP_LAYER_SOURCES: ReadonlySet<string> = new Set([
  ...EDITOR_SYSTEM_FEATURE_SOURCES,
  SRC_ACTION_ANCHOR,
  SRC_ENDPOINT_HINT,
  SRC_GESTURE,
  SRC_JUNCTION_GUIDES,
  SRC_MARQUEE,
  SRC_PREVIEW,
  SRC_SHARING,
  SRC_VEHICLES,
  SRC_VEHICLES_INFRA,
]);

function layerSource(spec: LayerSpecification): string | null {
  return 'source' in spec && typeof spec.source === 'string' ? spec.source : null;
}

export function editorMapLayerSpecs(catalog: readonly LayerSpecification[]): LayerSpecification[] {
  return catalog.filter((spec) => {
    const source = layerSource(spec);
    return source !== null && EDITOR_MAP_LAYER_SOURCES.has(source);
  });
}

/** Keeps the catalog's paint order while composing renderer-owned document
 * layers with the editor extension. Ownership stays disjoint even though
 * MapLibre receives one style transaction. */
export function editorMapSurfaceLayerSpecs(
  catalog: readonly LayerSpecification[],
  documentSpecs: readonly LayerSpecification[],
): LayerSpecification[] {
  const included = new Set([
    ...documentSpecs.map((spec) => spec.id),
    ...editorMapLayerSpecs(catalog).map((spec) => spec.id),
  ]);
  return catalog.filter((spec) => included.has(spec.id));
}

function sameLayerOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

/** Adds the editor extension around the document driver's current layer set.
 * The complete catalog supplies one paint order, while the existing style
 * decides which representation-specific document layers remain installed. */
export function installEditorMapLayers(map: MLMap, catalog: readonly LayerSpecification[]): void {
  const expandedCatalog = sourceBankLayerSpecs(catalog);
  const catalogLayerIds = new Set(expandedCatalog.map((spec) => spec.id));
  const editorLayerIds = new Set(editorMapLayerSpecs(catalog).map((spec) => spec.id));
  const installedCatalog = expandedCatalog.filter(
    (spec) => editorLayerIds.has(spec.id) || map.getLayer(spec.id) !== undefined,
  );
  const style = map.getStyle();
  const installedIds = style.layers
    .filter((layer) => catalogLayerIds.has(layer.id))
    .map((layer) => layer.id);
  if (
    sameLayerOrder(
      installedIds,
      installedCatalog.map((layer) => layer.id),
    )
  )
    return;
  map.setStyle(
    {
      ...style,
      layers: [
        ...style.layers.filter((layer) => !catalogLayerIds.has(layer.id)),
        ...installedCatalog,
      ],
    },
    { diff: true, validate: false },
  );
}
