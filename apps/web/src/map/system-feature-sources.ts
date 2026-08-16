import type { FeatureCollection, Geometry } from 'geojson';
import type { SystemFeatureName, SystemFeatures } from '@transitmapper/core/render/buildFeatures';
import { systemFeatureSourceId } from '@transitmapper/core/render/render-identity';
import type { SystemFeatureSourceMap } from '@transitmapper/core/render/system-render-scene';
import {
  SRC_CONNECTORS,
  SRC_FACILITIES,
  SRC_FOOTPRINTS,
  SRC_HANDLES,
  SRC_SERVICE_TERMINI,
  SRC_JUNCTIONS,
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
} from './layers/constants';

/** Stable upload order for every system-derived MapLibre source. Transient
 * gesture, draft, vehicle, and marquee sources deliberately stay outside this
 * renderer-owned set. */
export const ALL_SYSTEM_FEATURE_SOURCES = [
  SRC_WAYS,
  SRC_SERVICES,
  SRC_STATIONS,
  SRC_HANDLES,
  SRC_SERVICE_TERMINI,
  SRC_FOOTPRINTS,
  SRC_PLATFORMS,
  SRC_FACILITIES,
  SRC_PHYSICAL_HANDLES,
  SRC_LANES,
  SRC_LANE_MARKINGS,
  SRC_LANE_ARROWS,
  SRC_SERVICE_ARROWS,
  SRC_JUNCTIONS,
  SRC_CONNECTORS,
  SRC_WAY_LABELS,
] as const;

export type MapSystemFeatureSourceId = (typeof ALL_SYSTEM_FEATURE_SOURCES)[number];

/** Selection-owned collections update through the small editor controller,
 * never through a committed city-scale generation. Keeping ownership disjoint
 * prevents an older projection from replaying stale selection geometry. */
export const EDITOR_SYSTEM_FEATURE_SOURCES = [
  SRC_HANDLES,
  SRC_SERVICE_TERMINI,
  SRC_PHYSICAL_HANDLES,
] as const satisfies readonly MapSystemFeatureSourceId[];

const EDITOR_SYSTEM_FEATURE_SOURCE_SET = new Set<MapSystemFeatureSourceId>(
  EDITOR_SYSTEM_FEATURE_SOURCES,
);

export const COMMITTED_SYSTEM_FEATURE_SOURCES = ALL_SYSTEM_FEATURE_SOURCES.filter(
  (sourceId) => !EDITOR_SYSTEM_FEATURE_SOURCE_SET.has(sourceId),
);

export function committedSystemFeatureSources(
  sourceIds: readonly MapSystemFeatureSourceId[],
): readonly MapSystemFeatureSourceId[] {
  return sourceIds.filter((sourceId) => !EDITOR_SYSTEM_FEATURE_SOURCE_SET.has(sourceId));
}

function emptyCollection<G extends Geometry>(): FeatureCollection<G> {
  return { type: 'FeatureCollection', features: [] };
}

/** Creates a complete source-shaped shell for a small partial live-scene
 * update. Callers fill only the collections named in their source request. */
export function emptySystemFeatures(): SystemFeatures {
  return {
    ways: emptyCollection(),
    services: emptyCollection(),
    stops: emptyCollection(),
    handles: emptyCollection(),
    serviceTermini: emptyCollection(),
    footprints: emptyCollection(),
    platforms: emptyCollection(),
    facilities: emptyCollection(),
    physicalHandles: emptyCollection(),
    lanes: emptyCollection(),
    laneMarkings: emptyCollection(),
    laneArrows: emptyCollection(),
    serviceArrows: emptyCollection(),
    junctions: emptyCollection(),
    connectors: emptyCollection(),
    wayLabels: emptyCollection(),
  };
}

/** One authoritative translation between MapLibre source names and the core
 * projection collections they display. */
export const SYSTEM_FEATURE_NAME_BY_SOURCE: Readonly<
  Record<MapSystemFeatureSourceId, SystemFeatureName>
> = {
  [SRC_WAYS]: 'ways',
  [SRC_SERVICES]: 'services',
  [SRC_STATIONS]: 'stops',
  [SRC_HANDLES]: 'handles',
  [SRC_SERVICE_TERMINI]: 'serviceTermini',
  [SRC_FOOTPRINTS]: 'footprints',
  [SRC_PLATFORMS]: 'platforms',
  [SRC_FACILITIES]: 'facilities',
  [SRC_PHYSICAL_HANDLES]: 'physicalHandles',
  [SRC_LANES]: 'lanes',
  [SRC_LANE_MARKINGS]: 'laneMarkings',
  [SRC_LANE_ARROWS]: 'laneArrows',
  [SRC_SERVICE_ARROWS]: 'serviceArrows',
  [SRC_JUNCTIONS]: 'junctions',
  [SRC_CONNECTORS]: 'connectors',
  [SRC_WAY_LABELS]: 'wayLabels',
};

export const SYSTEM_FEATURE_SOURCE_BY_NAME: SystemFeatureSourceMap = {
  ways: systemFeatureSourceId(SRC_WAYS),
  services: systemFeatureSourceId(SRC_SERVICES),
  stops: systemFeatureSourceId(SRC_STATIONS),
  handles: systemFeatureSourceId(SRC_HANDLES),
  serviceTermini: systemFeatureSourceId(SRC_SERVICE_TERMINI),
  footprints: systemFeatureSourceId(SRC_FOOTPRINTS),
  platforms: systemFeatureSourceId(SRC_PLATFORMS),
  facilities: systemFeatureSourceId(SRC_FACILITIES),
  physicalHandles: systemFeatureSourceId(SRC_PHYSICAL_HANDLES),
  lanes: systemFeatureSourceId(SRC_LANES),
  laneMarkings: systemFeatureSourceId(SRC_LANE_MARKINGS),
  laneArrows: systemFeatureSourceId(SRC_LANE_ARROWS),
  serviceArrows: systemFeatureSourceId(SRC_SERVICE_ARROWS),
  junctions: systemFeatureSourceId(SRC_JUNCTIONS),
  connectors: systemFeatureSourceId(SRC_CONNECTORS),
  wayLabels: systemFeatureSourceId(SRC_WAY_LABELS),
};
