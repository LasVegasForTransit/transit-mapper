import { describe, expect, it } from 'vitest';
import {
  SRC_FOOTPRINTS,
  SRC_PHYSICAL_HANDLES,
  SRC_PLATFORMS,
  SRC_STATIONS,
  SRC_WAYS,
} from '../../src/map/layers';
import type { SystemFeatureSourceId } from '../../src/map/sourceUploadPlan';
import {
  planStopGestureSettlement,
  type StopGestureSettlementOptions,
} from '../../src/map/stopGesturePlan';

const stopSources = [
  SRC_STATIONS,
  SRC_FOOTPRINTS,
  SRC_PLATFORMS,
  SRC_PHYSICAL_HANDLES,
] satisfies readonly SystemFeatureSourceId[];
const stopOnly = {
  wayIds: [],
  stopIds: ['stop-a'],
  stationIds: [],
  facilityIds: [],
  groupIds: [],
  nodeIds: [],
};

describe('stop gesture settlement planning', () => {
  it('uses one stop diff for an isolated Network stop move', () => {
    expect(
      planStopGestureSettlement({
        viewMode: 'network',
        affected: stopOnly,
        pendingSources: stopSources,
        stopSourceReady: true,
        overlayHealthy: true,
        projectionAborted: false,
      }),
    ).toEqual({ kind: 'diff', stopIds: ['stop-a'] });
  });

  it('falls back when settled physical detail or another mutation may differ', () => {
    const unsafeCases: Array<Partial<StopGestureSettlementOptions>> = [
      { viewMode: 'infrastructure' as const },
      { affected: { ...stopOnly, wayIds: ['way-a'] } },
      { projectionAborted: true },
    ];

    for (const unsafe of unsafeCases) {
      expect(
        planStopGestureSettlement({
          viewMode: 'network',
          affected: stopOnly,
          pendingSources: stopSources,
          stopSourceReady: true,
          overlayHealthy: true,
          projectionAborted: false,
          ...unsafe,
        }),
      ).toEqual({ kind: 'full', preserveStopPreview: false });
    }
  });

  it('preserves the stop preview whenever an isolated Network move needs a full refresh', () => {
    for (const unavailable of [
      { stopSourceReady: false },
      { overlayHealthy: false },
      { pendingSources: [...stopSources, SRC_WAYS] },
    ] satisfies Array<Partial<StopGestureSettlementOptions>>) {
      expect(
        planStopGestureSettlement({
          viewMode: 'network',
          affected: stopOnly,
          pendingSources: stopSources,
          stopSourceReady: true,
          overlayHealthy: true,
          projectionAborted: false,
          ...unavailable,
        }),
      ).toEqual({ kind: 'full', preserveStopPreview: true });
    }
  });
});
