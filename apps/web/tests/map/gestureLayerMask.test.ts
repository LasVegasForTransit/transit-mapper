import { describe, expect, it } from 'vitest';
import {
  LYR_SERVICES_SOLID,
  LYR_WAY_LABELS,
  LYR_WAYS_SOLID,
  SRC_SERVICES,
  SRC_WAYS,
} from '../../src/map/layers';
import { buildGestureLayerMaskPlan, maskedGestureFilter } from '../../src/map/gestureLayerMask';

describe('gesture settled-layer mask', () => {
  it('excludes the moved way and its old service geometry while hiding unaddressable labels', () => {
    const plan = buildGestureLayerMaskPlan({
      wayIds: ['way-a'],
      stationIds: [],
      facilityIds: [],
      groupIds: [],
      nodeIds: [],
    });

    expect(plan.filterRules.find((rule) => rule.layerId === LYR_WAYS_SOLID)).toEqual({
      layerId: LYR_WAYS_SOLID,
      sourceId: SRC_WAYS,
      exclusions: [{ property: 'id', ids: ['way-a'] }],
    });
    expect(plan.filterRules.find((rule) => rule.layerId === LYR_SERVICES_SOLID)).toEqual({
      layerId: LYR_SERVICES_SOLID,
      sourceId: SRC_SERVICES,
      exclusions: [{ property: 'wayId', ids: ['way-a'] }],
    });
    expect(plan.hiddenLayerIds).toContain(LYR_WAY_LABELS);
  });

  it('combines gesture exclusions with the exact settled layer filter', () => {
    expect(
      maskedGestureFilter(['get', 'elevated'], [{ property: 'wayId', ids: ['way-a', 'way-b'] }]),
    ).toEqual([
      'all',
      ['get', 'elevated'],
      ['!', ['in', ['get', 'wayId'], ['literal', ['way-a', 'way-b']]]],
    ]);
  });
});
