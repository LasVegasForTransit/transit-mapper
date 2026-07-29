import { describe, expect, it } from 'vitest';
import {
  SRC_FOOTPRINTS,
  SRC_PHYSICAL_HANDLES,
  SRC_PLATFORMS,
  SRC_STATIONS,
  SRC_WAYS,
} from './layers';
import type { SystemFeatureSourceId } from './sourceUploadPlan';
import {
  planStationGestureSettlement,
  type StationGestureSettlementOptions,
} from './stationGesturePlan';

const stationSources = [
  SRC_STATIONS,
  SRC_FOOTPRINTS,
  SRC_PLATFORMS,
  SRC_PHYSICAL_HANDLES,
] satisfies readonly SystemFeatureSourceId[];
const stationOnly = {
  wayIds: [],
  stationIds: ['station-a'],
  facilityIds: [],
  groupIds: [],
  nodeIds: [],
};

describe('station gesture settlement planning', () => {
  it('uses one station diff for an isolated Network station move', () => {
    expect(
      planStationGestureSettlement({
        viewMode: 'network',
        affected: stationOnly,
        pendingSources: stationSources,
        stationSourceReady: true,
        overlayHealthy: true,
        projectionAborted: false,
      }),
    ).toEqual({ kind: 'diff', stationIds: ['station-a'] });
  });

  it('falls back when settled physical detail or another mutation may differ', () => {
    const unsafeCases: Array<Partial<StationGestureSettlementOptions>> = [
      { viewMode: 'infrastructure' as const },
      { affected: { ...stationOnly, wayIds: ['way-a'] } },
      { projectionAborted: true },
    ];

    for (const unsafe of unsafeCases) {
      expect(
        planStationGestureSettlement({
          viewMode: 'network',
          affected: stationOnly,
          pendingSources: stationSources,
          stationSourceReady: true,
          overlayHealthy: true,
          projectionAborted: false,
          ...unsafe,
        }),
      ).toEqual({ kind: 'full', preserveStationPreview: false });
    }
  });

  it('preserves the station preview whenever an isolated Network move needs a full refresh', () => {
    for (const unavailable of [
      { stationSourceReady: false },
      { overlayHealthy: false },
      { pendingSources: [...stationSources, SRC_WAYS] },
    ] satisfies Array<Partial<StationGestureSettlementOptions>>) {
      expect(
        planStationGestureSettlement({
          viewMode: 'network',
          affected: stationOnly,
          pendingSources: stationSources,
          stationSourceReady: true,
          overlayHealthy: true,
          projectionAborted: false,
          ...unavailable,
        }),
      ).toEqual({ kind: 'full', preserveStationPreview: true });
    }
  });
});
