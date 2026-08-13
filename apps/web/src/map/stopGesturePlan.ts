import type { GestureAffectedEntities } from './gestureProjection';
import { SRC_FOOTPRINTS, SRC_PHYSICAL_HANDLES, SRC_PLATFORMS, SRC_STATIONS } from './layers';
import type { SystemFeatureSourceId } from './sourceUploadPlan';

const NETWORK_STATION_SOURCES: readonly SystemFeatureSourceId[] = [
  SRC_STATIONS,
  SRC_FOOTPRINTS,
  SRC_PLATFORMS,
  SRC_PHYSICAL_HANDLES,
];

export interface StopGestureSettlementOptions {
  viewMode: 'network' | 'infrastructure' | 'diagram';
  affected: GestureAffectedEntities;
  pendingSources: readonly SystemFeatureSourceId[];
  /** True after the initial stop collection loaded, or while a prior
   * controller-owned stop diff is already queued on that collection. */
  stopSourceReady: boolean;
  overlayHealthy: boolean;
  projectionAborted: boolean;
}

export type StopGestureSettlementPlan =
  { kind: 'diff'; stopIds: readonly string[] } | { kind: 'full'; preserveStopPreview: boolean };

/**
 * Network hides every physical stop collection, so an isolated stop
 * move can replace only its visible point feature. Every ambiguous state
 * falls back to the complete source plan; a missed diff would leave the map
 * stale, while a conservative rebuild costs only that exceptional gesture.
 */
export function planStopGestureSettlement({
  viewMode,
  affected,
  pendingSources,
  stopSourceReady,
  overlayHealthy,
  projectionAborted,
}: StopGestureSettlementOptions): StopGestureSettlementPlan {
  const stopSourcesOnly =
    pendingSources.length === NETWORK_STATION_SOURCES.length &&
    pendingSources.every((sourceId, index) => sourceId === NETWORK_STATION_SOURCES[index]);
  const isolatedStopMove =
    affected.stopIds.length > 0 &&
    affected.wayIds.length === 0 &&
    affected.facilityIds.length === 0 &&
    affected.groupIds.length === 0 &&
    affected.nodeIds.length === 0;

  const isolatedNetworkStop = viewMode === 'network' && isolatedStopMove && !projectionAborted;
  if (isolatedNetworkStop && stopSourcesOnly && stopSourceReady && overlayHealthy) {
    return { kind: 'diff', stopIds: [...affected.stopIds] };
  }
  return { kind: 'full', preserveStopPreview: isolatedNetworkStop };
}
