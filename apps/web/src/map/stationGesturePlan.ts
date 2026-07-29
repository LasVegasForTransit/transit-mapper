import type { GestureAffectedEntities } from './gestureProjection';
import { SRC_FOOTPRINTS, SRC_PHYSICAL_HANDLES, SRC_PLATFORMS, SRC_STATIONS } from './layers';
import type { SystemFeatureSourceId } from './sourceUploadPlan';

const NETWORK_STATION_SOURCES: readonly SystemFeatureSourceId[] = [
  SRC_STATIONS,
  SRC_FOOTPRINTS,
  SRC_PLATFORMS,
  SRC_PHYSICAL_HANDLES,
];

export interface StationGestureSettlementOptions {
  viewMode: 'network' | 'infrastructure' | 'diagram';
  affected: GestureAffectedEntities;
  pendingSources: readonly SystemFeatureSourceId[];
  /** True after the initial station collection loaded, or while a prior
   * controller-owned station diff is already queued on that collection. */
  stationSourceReady: boolean;
  overlayHealthy: boolean;
  projectionAborted: boolean;
}

export type StationGestureSettlementPlan =
  | { kind: 'diff'; stationIds: readonly string[] }
  | { kind: 'full'; preserveStationPreview: boolean };

/**
 * Network hides every physical station collection, so an isolated station
 * move can replace only its visible point feature. Every ambiguous state
 * falls back to the complete source plan; a missed diff would leave the map
 * stale, while a conservative rebuild costs only that exceptional gesture.
 */
export function planStationGestureSettlement({
  viewMode,
  affected,
  pendingSources,
  stationSourceReady,
  overlayHealthy,
  projectionAborted,
}: StationGestureSettlementOptions): StationGestureSettlementPlan {
  const stationSourcesOnly =
    pendingSources.length === NETWORK_STATION_SOURCES.length &&
    pendingSources.every((sourceId, index) => sourceId === NETWORK_STATION_SOURCES[index]);
  const isolatedStationMove =
    affected.stationIds.length > 0 &&
    affected.wayIds.length === 0 &&
    affected.facilityIds.length === 0 &&
    affected.groupIds.length === 0 &&
    affected.nodeIds.length === 0;

  const isolatedNetworkStation =
    viewMode === 'network' && isolatedStationMove && !projectionAborted;
  if (isolatedNetworkStation && stationSourcesOnly && stationSourceReady && overlayHealthy) {
    return { kind: 'diff', stationIds: [...affected.stationIds] };
  }
  return { kind: 'full', preserveStationPreview: isolatedNetworkStation };
}
