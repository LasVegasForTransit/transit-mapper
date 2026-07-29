import { describe, expect, it } from 'vitest';
import type { FilterSpecification } from 'maplibre-gl';
import {
  LYR_STATIONS,
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
  type GestureLayerMaskMap,
} from '../../src/map/gestureLayerMask';

interface StatefulMaskMapFixture {
  map: GestureLayerMaskMap;
  originalWayFilter: FilterSpecification;
  originalStationFilter: FilterSpecification;
  filters: Map<string, FilterSpecification>;
  visibility: Map<string, unknown>;
  filterCalls: Array<{ layerId: string; filter: FilterSpecification | null }>;
  visibilityCalls: Array<{ layerId: string; value: unknown }>;
}

function createStatefulMaskMap(): StatefulMaskMapFixture {
  const visibleLayers = new Set([LYR_WAYS_SOLID, LYR_WAY_LABELS, LYR_STATIONS]);
  const originalWayFilter = ['get', 'way-visible'] as FilterSpecification;
  const originalStationFilter = ['get', 'station-visible'] as FilterSpecification;
  const filters = new Map<string, FilterSpecification>([
    [LYR_WAYS_SOLID, originalWayFilter],
    [LYR_STATIONS, originalStationFilter],
  ]);
  const visibility = new Map<string, unknown>([[LYR_WAY_LABELS, 'visible']]);
  const filterCalls: Array<{ layerId: string; filter: FilterSpecification | null }> = [];
  const visibilityCalls: Array<{ layerId: string; value: unknown }> = [];
  const map: GestureLayerMaskMap = {
    getLayer: (layerId) => (visibleLayers.has(layerId) ? {} : undefined),
    getFilter: (layerId) => filters.get(layerId),
    setFilter: (layerId, filter) => {
      filterCalls.push({ layerId, filter });
      if (filter) filters.set(layerId, filter);
      else filters.delete(layerId);
    },
    getLayoutProperty: (layerId) => visibility.get(layerId),
    setLayoutProperty: (layerId, _property, value) => {
      visibilityCalls.push({ layerId, value });
      visibility.set(layerId, value);
    },
  };
  return {
    map,
    originalWayFilter,
    originalStationFilter,
    filters,
    visibility,
    filterCalls,
    visibilityCalls,
  };
}

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

  it('retains only the station mask after an overlapping way gesture ends', () => {
    const fixture = createStatefulMaskMap();
    const {
      map,
      originalWayFilter,
      originalStationFilter,
      filters,
      visibility,
      filterCalls,
      visibilityCalls,
    } = fixture;
    const controller = createGestureLayerMaskController(map);

    controller.apply({
      wayIds: ['way-a'],
      stationIds: ['station-a'],
      facilityIds: [],
      groupIds: [],
      nodeIds: [],
    });
    controller.apply({
      wayIds: [],
      stationIds: ['station-a'],
      facilityIds: [],
      groupIds: [],
      nodeIds: [],
    });

    expect(filters.get(LYR_WAYS_SOLID)).toBe(originalWayFilter);
    expect(visibility.get(LYR_WAY_LABELS)).toBe('visible');
    expect(filters.get(LYR_STATIONS)).toEqual([
      'all',
      originalStationFilter,
      ['!', ['in', ['get', 'id'], ['literal', ['station-a']]]],
    ]);

    filterCalls.length = 0;
    visibilityCalls.length = 0;
    controller.restore();

    expect(filterCalls).toEqual([{ layerId: LYR_STATIONS, filter: originalStationFilter }]);
    expect(visibilityCalls).toEqual([]);
  });

  it('leaves an active way mask untouched when station settlement ends', () => {
    const { map, originalWayFilter, originalStationFilter, filterCalls, visibilityCalls } =
      createStatefulMaskMap();
    const controller = createGestureLayerMaskController(map);
    const wayAndStation = {
      wayIds: ['way-a'],
      stationIds: ['station-a'],
      facilityIds: [],
      groupIds: [],
      nodeIds: [],
    };

    controller.apply(wayAndStation);
    filterCalls.length = 0;
    visibilityCalls.length = 0;
    controller.apply({ ...wayAndStation, stationIds: [] });

    expect(filterCalls).toEqual([{ layerId: LYR_STATIONS, filter: originalStationFilter }]);
    expect(visibilityCalls).toEqual([]);

    filterCalls.length = 0;
    controller.restore();
    expect(filterCalls).toEqual([{ layerId: LYR_WAYS_SOLID, filter: originalWayFilter }]);
    expect(visibilityCalls).toEqual([{ layerId: LYR_WAY_LABELS, value: 'visible' }]);
  });

  it('rebuilds the same mask from replacement style layers', () => {
    const fixture = createStatefulMaskMap();
    const controller = createGestureLayerMaskController(fixture.map);
    const affected = {
      wayIds: [],
      stationIds: ['station-a'],
      facilityIds: [],
      groupIds: [],
      nodeIds: [],
    };

    controller.apply(affected);

    const replacementFilter = ['get', 'station-visible-dark'] as FilterSpecification;
    fixture.filters.set(LYR_STATIONS, replacementFilter);
    fixture.filterCalls.length = 0;

    controller.invalidate();
    controller.apply(affected);

    expect(fixture.filterCalls).toEqual([
      {
        layerId: LYR_STATIONS,
        filter: [
          'all',
          replacementFilter,
          ['!', ['in', ['get', 'id'], ['literal', ['station-a']]]],
        ],
      },
    ]);

    controller.restore();
    expect(fixture.filterCalls.at(-1)).toEqual({
      layerId: LYR_STATIONS,
      filter: replacementFilter,
    });
  });
});
