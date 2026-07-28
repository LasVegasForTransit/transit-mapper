import type { FilterSpecification } from 'maplibre-gl';
import type { GestureAffectedEntities } from './gestureProjection';
import {
  LAYER_SPECS,
  SRC_CONNECTORS,
  SRC_FACILITIES,
  SRC_FOOTPRINTS,
  SRC_HANDLES,
  SRC_JUNCTIONS,
  SRC_LANES,
  SRC_LANE_ARROWS,
  SRC_LANE_MARKINGS,
  SRC_PHYSICAL_HANDLES,
  SRC_PLATFORMS,
  SRC_SERVICES,
  SRC_SERVICE_ARROWS,
  SRC_STATIONS,
  SRC_WAYS,
  SRC_WAY_LABELS,
} from './layers';

export interface GestureFilterExclusion {
  property: string;
  ids: string[];
}

export interface GestureFilterRule {
  layerId: string;
  sourceId: string;
  exclusions: GestureFilterExclusion[];
}

export interface GestureLayerMaskPlan {
  filterRules: GestureFilterRule[];
  hiddenLayerIds: string[];
}

export function buildGestureLayerMaskPlan(affected: GestureAffectedEntities): GestureLayerMaskPlan {
  const exclusionsBySource = new Map<string, GestureFilterExclusion[]>();
  const add = (sourceId: string, property: string, ids: string[]) => {
    if (ids.length === 0) return;
    const exclusions = exclusionsBySource.get(sourceId) ?? [];
    exclusions.push({ property, ids: [...ids] });
    exclusionsBySource.set(sourceId, exclusions);
  };

  add(SRC_WAYS, 'id', affected.wayIds);
  add(SRC_SERVICES, 'wayId', affected.wayIds);
  add(SRC_LANES, 'id', affected.wayIds);
  add(SRC_LANE_ARROWS, 'id', affected.wayIds);
  add(SRC_SERVICE_ARROWS, 'id', affected.wayIds);
  add(SRC_HANDLES, 'wayId', affected.wayIds);
  add(SRC_STATIONS, 'id', affected.stationIds);
  add(SRC_FOOTPRINTS, 'stationId', affected.stationIds);
  add(SRC_FOOTPRINTS, 'groupId', affected.groupIds);
  add(SRC_PLATFORMS, 'stationId', affected.stationIds);
  add(SRC_PHYSICAL_HANDLES, 'stationId', affected.stationIds);
  add(SRC_PHYSICAL_HANDLES, 'groupId', affected.groupIds);
  add(SRC_FACILITIES, 'id', affected.facilityIds);
  add(SRC_JUNCTIONS, 'nodeId', affected.nodeIds);
  add(SRC_CONNECTORS, 'nodeId', affected.nodeIds);

  const hiddenSources = new Set<string>();
  if (affected.wayIds.length > 0) {
    // These derived collections do not currently carry a stable owner id.
    // Hiding their layers for the short gesture is safer than leaving stale
    // markings/labels behind beside the direct-manipulation preview.
    hiddenSources.add(SRC_LANE_MARKINGS);
    hiddenSources.add(SRC_WAY_LABELS);
  }

  const filterRules: GestureFilterRule[] = [];
  const hiddenLayerIds: string[] = [];
  for (const layer of LAYER_SPECS) {
    if (!('source' in layer) || typeof layer.source !== 'string') continue;
    if (hiddenSources.has(layer.source)) hiddenLayerIds.push(layer.id);
    const exclusions = exclusionsBySource.get(layer.source);
    if (exclusions) filterRules.push({ layerId: layer.id, sourceId: layer.source, exclusions });
  }
  return { filterRules, hiddenLayerIds };
}

export function maskedGestureFilter(
  original: FilterSpecification | undefined,
  exclusions: GestureFilterExclusion[],
): FilterSpecification {
  return [
    'all',
    ...(original ? [original] : []),
    ...exclusions.map(
      ({ property, ids }) =>
        ['!', ['in', ['get', property], ['literal', ids]]] as FilterSpecification,
    ),
  ] as FilterSpecification;
}
