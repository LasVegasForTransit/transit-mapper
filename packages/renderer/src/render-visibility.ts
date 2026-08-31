/**
 * Maps user-visible mode and infrastructure filters to MapLibre layer filters.
 *
 * Visibility changes do not rebuild committed geometry. This module owns the
 * classification metadata that makes that paint-only path possible and tells
 * the caller when a view-mode change genuinely requires reprojection.
 */
import type { FilterSpecification, LayerSpecification } from 'maplibre-gl';
import type { ViewOptions } from '@transitmapper/core/render/buildFeatures';
import {
  LYR_CENTER_LINES,
  LYR_CONNECTORS,
  LYR_EDGE_LINES,
  LYR_JUNCTION_SELECTED,
  LYR_JUNCTIONS,
  LYR_LANE_ARROWS,
  LYR_LANE_LINES,
  LYR_LANE_SURFACES,
  LYR_LANE_TRACKS,
  LYR_RAIL_TIES,
  LYR_SERVICE_ARROWS,
  LYR_SERVICE_SELECTED,
  LYR_SERVICE_TERMINI,
  LYR_SERVICE_TERMINI_HIT,
  LYR_SERVICES_ELEVATED,
  LYR_SERVICES_HIT,
  LYR_SERVICES_SOLID,
  LYR_SERVICES_SOLID_CASING,
  LYR_SERVICES_UNDERGROUND,
  LYR_SERVICES_UNDERGROUND_CASING,
  LYR_STATION_LABELS,
  LYR_STATION_LABELS_MAJOR,
  LYR_STATION_SELECTED,
  LYR_STATIONS,
  LYR_WAY_LABELS,
  LYR_WAY_SELECTED,
  LYR_WAYS_DASHED,
  LYR_WAYS_DASHED_CASING,
  LYR_WAYS_SOLID,
  LYR_WAYS_SOLID_CASING,
} from './layers';
import { logicalRenderLayerId } from './layers';

type VisibilityKind = 'mode' | 'mode-and-type' | 'served-modes' | 'type' | 'type-array';

export interface RendererVisibilityMap {
  getLayer(id: string): unknown;
  setFilter(
    id: string,
    filter: FilterSpecification | null,
    options?: { validate?: boolean },
  ): unknown;
}

export interface ViewRenderUpdatePlan {
  reproject: boolean;
  updateFilters: boolean;
  notifyVehicles: boolean;
}

const VISIBILITY_KIND_BY_LAYER: Readonly<Partial<Record<string, VisibilityKind>>> = {
  [LYR_WAYS_SOLID]: 'type',
  [LYR_WAYS_DASHED]: 'type',
  [LYR_WAYS_SOLID_CASING]: 'type',
  [LYR_WAYS_DASHED_CASING]: 'type',
  [LYR_WAY_SELECTED]: 'type',
  [LYR_LANE_SURFACES]: 'type',
  [LYR_LANE_LINES]: 'type',
  [LYR_CENTER_LINES]: 'type',
  [LYR_EDGE_LINES]: 'type',
  [LYR_LANE_TRACKS]: 'type',
  [LYR_RAIL_TIES]: 'type',
  [LYR_LANE_ARROWS]: 'type',
  [LYR_WAY_LABELS]: 'type',
  [LYR_JUNCTIONS]: 'type-array',
  [LYR_JUNCTION_SELECTED]: 'type-array',
  [LYR_CONNECTORS]: 'type-array',
  [LYR_SERVICES_ELEVATED]: 'mode-and-type',
  [LYR_SERVICE_SELECTED]: 'mode-and-type',
  [LYR_SERVICES_SOLID_CASING]: 'mode-and-type',
  [LYR_SERVICES_SOLID]: 'mode-and-type',
  [LYR_SERVICES_UNDERGROUND_CASING]: 'mode-and-type',
  [LYR_SERVICES_UNDERGROUND]: 'mode-and-type',
  [LYR_SERVICES_HIT]: 'mode-and-type',
  [LYR_SERVICE_ARROWS]: 'mode-and-type',
  [LYR_SERVICE_TERMINI]: 'mode',
  [LYR_SERVICE_TERMINI_HIT]: 'mode',
  [LYR_STATIONS]: 'served-modes',
  [LYR_STATION_SELECTED]: 'served-modes',
  [LYR_STATION_LABELS]: 'served-modes',
  [LYR_STATION_LABELS_MAJOR]: 'served-modes',
};

function scalarMembership(property: string, values: ReadonlySet<string>): FilterSpecification {
  return ['in', ['get', property], ['literal', [...values]]] as FilterSpecification;
}

function arrayOverlap(property: string, values: ReadonlySet<string>): FilterSpecification {
  if (values.size === 0) return ['==', 1, 0] as FilterSpecification;
  return [
    'any',
    ...[...values].map((value) => ['in', value, ['get', property]]),
  ] as FilterSpecification;
}

/** Combines immutable feature classification with a layer's semantic filter. */
export function rendererVisibilityFilter(
  layerId: string,
  baseFilter: FilterSpecification | undefined,
  visibleModes: ReadonlySet<string>,
  visibleWayTypes: ReadonlySet<string>,
): FilterSpecification | null {
  const kind = VISIBILITY_KIND_BY_LAYER[logicalRenderLayerId(layerId)];
  if (!kind) return baseFilter ?? null;
  const terms: FilterSpecification[] = [];
  if (baseFilter) terms.push(baseFilter);
  if (kind === 'mode-and-type') {
    terms.push(scalarMembership('modeId', visibleModes));
    terms.push(scalarMembership('typeId', visibleWayTypes));
  } else if (kind === 'mode') {
    terms.push(scalarMembership('modeId', visibleModes));
  } else if (kind === 'served-modes') {
    terms.push(arrayOverlap('servedModeIds', visibleModes));
  } else if (kind === 'type-array') {
    terms.push(arrayOverlap('typeIds', visibleWayTypes));
  } else {
    terms.push(scalarMembership('typeId', visibleWayTypes));
  }
  return ['all', ...terms] as FilterSpecification;
}

function baseLayerFilter(layer: LayerSpecification): FilterSpecification | undefined {
  const candidate: unknown = 'filter' in layer ? layer.filter : undefined;
  return Array.isArray(candidate) ? (candidate as FilterSpecification) : undefined;
}

/** Applies semantic visibility through layer filters, never source mutation. */
export function applyRendererVisibilityFilters(
  map: RendererVisibilityMap,
  layerSpecs: readonly LayerSpecification[],
  visibleModes: ReadonlySet<string>,
  visibleWayTypes: ReadonlySet<string>,
): void {
  for (const layer of layerSpecs) {
    if (!(logicalRenderLayerId(layer.id) in VISIBILITY_KIND_BY_LAYER) || !map.getLayer(layer.id)) {
      continue;
    }
    map.setFilter(
      layer.id,
      rendererVisibilityFilter(layer.id, baseLayerFilter(layer), visibleModes, visibleWayTypes),
      { validate: false },
    );
  }
}

/** Separates semantic view changes from paint-only visibility changes. */
export function planViewRenderUpdate(
  before: ViewOptions,
  after: ViewOptions,
): ViewRenderUpdatePlan {
  const modeChanged = before.viewMode !== after.viewMode;
  const modesChanged = before.visibleModes !== after.visibleModes;
  const wayTypesChanged = before.visibleWayTypes !== after.visibleWayTypes;
  const passengerLinesVisible =
    before.viewMode === 'network' ||
    before.viewMode === 'diagram' ||
    after.viewMode === 'network' ||
    after.viewMode === 'diagram';
  return {
    // Line geometry has no one scalar mode. The worker rebuilds its selected
    // Line spans when a passenger-mode filter changes, so paint filters never
    // leave an excluded Service inside a visible Line stripe.
    reproject: modeChanged || (passengerLinesVisible && modesChanged),
    updateFilters: modeChanged || modesChanged || wayTypesChanged,
    notifyVehicles: modeChanged || modesChanged,
  };
}
