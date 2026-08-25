import type { GeoJSONSource, Map as MLMap } from 'maplibre-gl';
import type { SystemFeatures } from '@transitmapper/core/render/buildFeatures';
import { landmarksFeatureCollection } from '../landmarks';
import {
  SRC_CONNECTORS,
  SRC_FACILITIES,
  SRC_FOOTPRINTS,
  SRC_HANDLES,
  SRC_JUNCTIONS,
  SRC_LANDMARKS,
  SRC_LANE_ARROWS,
  SRC_LANE_MARKINGS,
  SRC_LANES,
  SRC_PHYSICAL_HANDLES,
  SRC_PLATFORMS,
  SRC_SERVICE_ARROWS,
  SRC_SERVICES,
  SRC_STATIONS,
  SRC_WAY_LABELS,
  SRC_WAYS,
} from '@transitmapper/renderer/layers';
import { LIGHT_LAYER_SPECS } from '../layers';
const EMPTY_FEATURE_COLLECTION: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

/**
 * Install the complete export overlay in dependency order: every GeoJSON
 * source referenced by the shared layer catalog first, then every layer.
 *
 * Deriving this list from LIGHT_LAYER_SPECS is deliberate. Export maps are
 * short-lived and do not need the editor's hand-maintained source inventory;
 * deriving it here means a new layer/source pair cannot silently break one
 * export surface while working in another.
 */
export function addExportSourcesAndLayers(map: MLMap): void {
  for (const spec of LIGHT_LAYER_SPECS) {
    const sourceId = 'source' in spec ? spec.source : undefined;
    if (typeof sourceId !== 'string' || map.getSource(sourceId)) continue;
    map.addSource(sourceId, {
      type: 'geojson',
      data: sourceId === SRC_LANDMARKS ? landmarksFeatureCollection() : EMPTY_FEATURE_COLLECTION,
    });
  }

  for (const spec of LIGHT_LAYER_SPECS) map.addLayer(spec);
}

/** Populate every source derived by buildFeatures. Sources used only for live
 * editor state (drafts, gestures, vehicles, marquee) intentionally retain the
 * empty collection installed above. */
export function setExportFeatureData(map: MLMap, features: SystemFeatures): void {
  const sourceData: Readonly<Record<string, GeoJSON.FeatureCollection>> = {
    [SRC_WAYS]: features.ways,
    [SRC_SERVICES]: features.services,
    [SRC_STATIONS]: features.stops,
    [SRC_HANDLES]: features.handles,
    [SRC_FOOTPRINTS]: features.footprints,
    [SRC_PLATFORMS]: features.platforms,
    [SRC_FACILITIES]: features.facilities,
    [SRC_PHYSICAL_HANDLES]: features.physicalHandles,
    [SRC_LANES]: features.lanes,
    [SRC_LANE_MARKINGS]: features.laneMarkings,
    [SRC_LANE_ARROWS]: features.laneArrows,
    [SRC_SERVICE_ARROWS]: features.serviceArrows,
    [SRC_JUNCTIONS]: features.junctions,
    [SRC_CONNECTORS]: features.connectors,
    [SRC_WAY_LABELS]: features.wayLabels,
  };

  for (const [sourceId, data] of Object.entries(sourceData)) {
    map.getSource<GeoJSONSource>(sourceId)?.setData(data);
  }
}
