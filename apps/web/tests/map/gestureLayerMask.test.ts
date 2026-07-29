import { describe, expect, it } from 'vitest';
import type { FilterSpecification } from 'maplibre-gl';
import {
  LYR_SERVICES_SOLID,
  LYR_WAY_LABELS,
  LYR_WAYS_SOLID,
  SRC_SERVICES,
  SRC_WAYS,
} from '../../src/map/layers';
import {
  buildGestureLayerMaskPlan,
  createGestureLayerMaskController,
  maskedGestureFilter,
} from '../../src/map/gestureLayerMask';

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

  it('applies an unchanged mask once while restoring the settled style exactly', () => {
    const visibleLayers = new Set([LYR_WAYS_SOLID, LYR_WAY_LABELS]);
    const filterCalls: Array<{ layerId: string; filter: unknown }> = [];
    const visibilityCalls: Array<{ layerId: string; visibility: unknown }> = [];
    const map = {
      getLayer: (layerId: string) => (visibleLayers.has(layerId) ? {} : undefined),
      getFilter: () => ['get', 'visible'] as FilterSpecification,
      setFilter: (layerId: string, filter: unknown) => {
        filterCalls.push({ layerId, filter });
      },
      getLayoutProperty: () => 'visible',
      setLayoutProperty: (layerId: string, _property: string, visibility: unknown) => {
        visibilityCalls.push({ layerId, visibility });
      },
    };
    const controller = createGestureLayerMaskController(map);
    const affected = {
      wayIds: ['way-a'],
      stationIds: [],
      facilityIds: [],
      groupIds: [],
      nodeIds: [],
    };

    controller.apply(affected);
    controller.apply({ ...affected, wayIds: [...affected.wayIds] });

    expect(filterCalls).toEqual([
      {
        layerId: LYR_WAYS_SOLID,
        filter: ['all', ['get', 'visible'], ['!', ['in', ['get', 'id'], ['literal', ['way-a']]]]],
      },
    ]);
    expect(visibilityCalls).toEqual([{ layerId: LYR_WAY_LABELS, visibility: 'none' }]);

    controller.restore();

    expect(filterCalls.at(-1)).toEqual({
      layerId: LYR_WAYS_SOLID,
      filter: ['get', 'visible'],
    });
    expect(visibilityCalls.at(-1)).toEqual({
      layerId: LYR_WAY_LABELS,
      visibility: 'visible',
    });
  });
});
