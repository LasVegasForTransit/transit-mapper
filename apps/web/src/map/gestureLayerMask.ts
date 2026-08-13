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

interface GestureFilterRule {
  layerId: string;
  sourceId: string;
  exclusions: GestureFilterExclusion[];
}

export interface GestureLayerMaskPlan {
  filterRules: GestureFilterRule[];
  hiddenLayerIds: string[];
}

export interface GestureLayerMaskMap {
  getLayer: (layerId: string) => unknown;
  getFilter: (layerId: string) => FilterSpecification | undefined | void;
  setFilter: (layerId: string, filter: FilterSpecification | null) => void;
  getLayoutProperty: (layerId: string, property: string) => unknown;
  setLayoutProperty: (layerId: string, property: string, value: unknown) => void;
}

export interface GestureLayerMaskController {
  apply: (affected: GestureAffectedEntities) => void;
  invalidate: () => void;
  restore: () => void;
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
  add(SRC_STATIONS, 'id', affected.stopIds);
  add(SRC_FOOTPRINTS, 'stopId', affected.stopIds);
  add(SRC_FOOTPRINTS, 'groupId', affected.groupIds);
  add(SRC_PLATFORMS, 'stopId', affected.stopIds);
  add(SRC_PHYSICAL_HANDLES, 'stopId', affected.stopIds);
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

/**
 * Masks settled features beneath the live gesture preview without asking
 * MapLibre to recalculate the same style filters on every pointer frame.
 * Gesture projections return fresh arrays, so the key compares their values
 * rather than their references. A target set can grow or shrink as gestures
 * overlap settlement; each changed plan retains only the masks it owns.
 */
export function createGestureLayerMaskController(
  map: GestureLayerMaskMap,
): GestureLayerMaskController {
  const filterRestores = new Map<string, FilterSpecification | undefined>();
  const appliedFilterKeys = new Map<string, string>();
  const visibilityRestores = new Map<string, unknown>();
  let appliedKey: string | null = null;

  return {
    apply(affected) {
      const key = JSON.stringify([
        affected.wayIds,
        affected.stopIds,
        affected.facilityIds,
        affected.groupIds,
        affected.nodeIds,
      ]);
      if (key === appliedKey) return;

      const plan = buildGestureLayerMaskPlan(affected);
      const nextFilteredLayers = new Set(plan.filterRules.map((rule) => rule.layerId));
      for (const [layerId, filter] of filterRestores) {
        const layerExists = Boolean(map.getLayer(layerId));
        if (layerExists && nextFilteredLayers.has(layerId)) continue;
        if (layerExists) map.setFilter(layerId, filter ?? null);
        filterRestores.delete(layerId);
        appliedFilterKeys.delete(layerId);
      }
      const nextHiddenLayers = new Set(plan.hiddenLayerIds);
      for (const [layerId, visibility] of visibilityRestores) {
        const layerExists = Boolean(map.getLayer(layerId));
        if (layerExists && nextHiddenLayers.has(layerId)) continue;
        if (layerExists) map.setLayoutProperty(layerId, 'visibility', visibility ?? 'visible');
        visibilityRestores.delete(layerId);
      }

      for (const rule of plan.filterRules) {
        if (!map.getLayer(rule.layerId)) continue;
        if (!filterRestores.has(rule.layerId))
          filterRestores.set(rule.layerId, map.getFilter(rule.layerId) || undefined);
        const filterKey = JSON.stringify(rule.exclusions);
        if (appliedFilterKeys.get(rule.layerId) === filterKey) continue;
        map.setFilter(
          rule.layerId,
          maskedGestureFilter(filterRestores.get(rule.layerId), rule.exclusions),
        );
        appliedFilterKeys.set(rule.layerId, filterKey);
      }
      for (const layerId of plan.hiddenLayerIds) {
        if (!map.getLayer(layerId)) continue;
        if (visibilityRestores.has(layerId)) continue;
        visibilityRestores.set(layerId, map.getLayoutProperty(layerId, 'visibility'));
        map.setLayoutProperty(layerId, 'visibility', 'none');
      }
      appliedKey = key;
    },

    invalidate() {
      // A style replacement creates new layer objects. Forget the old
      // ownership without writing its filters into the replacement style;
      // the next apply captures that style's own filters as its baseline.
      filterRestores.clear();
      appliedFilterKeys.clear();
      visibilityRestores.clear();
      appliedKey = null;
    },

    restore() {
      for (const [layerId, filter] of filterRestores) {
        if (map.getLayer(layerId)) map.setFilter(layerId, filter ?? null);
      }
      filterRestores.clear();
      appliedFilterKeys.clear();
      for (const [layerId, visibility] of visibilityRestores) {
        if (map.getLayer(layerId))
          map.setLayoutProperty(layerId, 'visibility', visibility ?? 'visible');
      }
      visibilityRestores.clear();
      appliedKey = null;
    },
  };
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
