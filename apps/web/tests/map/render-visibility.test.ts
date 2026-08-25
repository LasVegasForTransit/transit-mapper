import type { FilterSpecification, LayerSpecification } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';
import {
  applyRendererVisibilityFilters,
  rendererVisibilityFilter,
} from '@transitmapper/renderer/driver';
import {
  LYR_JUNCTIONS,
  LYR_LANE_SURFACES,
  LYR_SERVICES_HIT,
  LYR_SERVICES_SOLID,
  LYR_SERVICE_TERMINI,
  LYR_STATIONS,
  LYR_WAYS_SOLID,
} from '@transitmapper/renderer/layers';

const BASE_SERVICE_FILTER: FilterSpecification = [
  'all',
  ['!', ['get', 'hitTarget']],
  ['!', ['get', 'underground']],
];

describe('renderer visibility filters', () => {
  it('combines source-independent mode and way-type visibility with a layer base filter', () => {
    expect(
      rendererVisibilityFilter(
        LYR_SERVICES_SOLID,
        BASE_SERVICE_FILTER,
        new Set(['bus', 'lightRail']),
        new Set(['road']),
      ),
    ).toEqual([
      'all',
      BASE_SERVICE_FILTER,
      ['in', ['get', 'modeId'], ['literal', ['bus', 'lightRail']]],
      ['in', ['get', 'typeId'], ['literal', ['road']]],
    ]);
  });

  it('hides an entire scalar category when its visible set is empty', () => {
    expect(
      rendererVisibilityFilter(LYR_WAYS_SOLID, undefined, new Set(['bus']), new Set()),
    ).toEqual(['all', ['in', ['get', 'typeId'], ['literal', []]]]);
  });

  it('keeps a station when any served mode remains visible', () => {
    expect(
      rendererVisibilityFilter(
        LYR_STATIONS,
        undefined,
        new Set(['bus', 'ferry']),
        new Set(['road']),
      ),
    ).toEqual([
      'all',
      ['any', ['in', 'bus', ['get', 'servedModeIds']], ['in', 'ferry', ['get', 'servedModeIds']]],
    ]);
    expect(rendererVisibilityFilter(LYR_STATIONS, undefined, new Set(), new Set(['road']))).toEqual(
      ['all', ['==', 1, 0]],
    );
  });

  it('filters a terminus by mode without requiring a way classification', () => {
    expect(
      rendererVisibilityFilter(LYR_SERVICE_TERMINI, undefined, new Set(['bus']), new Set()),
    ).toEqual(['all', ['in', ['get', 'modeId'], ['literal', ['bus']]]]);
  });

  it('keeps a junction when any incident way type remains visible', () => {
    expect(
      rendererVisibilityFilter(
        LYR_JUNCTIONS,
        undefined,
        new Set(['bus']),
        new Set(['road', 'rail']),
      ),
    ).toEqual([
      'all',
      ['any', ['in', 'road', ['get', 'typeIds']], ['in', 'rail', ['get', 'typeIds']]],
    ]);
  });

  it('uses scalar way types for Street surfaces and mode/type rules for hit geometry', () => {
    expect(
      rendererVisibilityFilter(LYR_LANE_SURFACES, undefined, new Set(['bus']), new Set(['road'])),
    ).toEqual(['all', ['in', ['get', 'typeId'], ['literal', ['road']]]]);
    expect(
      rendererVisibilityFilter(
        LYR_SERVICES_HIT,
        ['get', 'hitTarget'],
        new Set(['bus']),
        new Set(['road']),
      ),
    ).toEqual([
      'all',
      ['get', 'hitTarget'],
      ['in', ['get', 'modeId'], ['literal', ['bus']]],
      ['in', ['get', 'typeId'], ['literal', ['road']]],
    ]);
  });

  it('changes only layer filters and never mutates renderer sources', () => {
    const setFilter = vi.fn();
    const map = {
      getLayer: vi.fn(() => ({ id: 'present' })),
      setFilter,
    };
    const layers: LayerSpecification[] = [
      {
        id: LYR_SERVICES_SOLID,
        type: 'line',
        source: 'services',
        filter: BASE_SERVICE_FILTER,
      },
      { id: LYR_WAYS_SOLID, type: 'line', source: 'ways' },
    ];

    applyRendererVisibilityFilters(map, layers, new Set(['bus']), new Set(['road']));

    expect(setFilter).toHaveBeenCalledTimes(2);
    expect(setFilter).toHaveBeenNthCalledWith(
      1,
      LYR_SERVICES_SOLID,
      rendererVisibilityFilter(
        LYR_SERVICES_SOLID,
        BASE_SERVICE_FILTER,
        new Set(['bus']),
        new Set(['road']),
      ),
    );
    expect(setFilter).toHaveBeenNthCalledWith(
      2,
      LYR_WAYS_SOLID,
      rendererVisibilityFilter(LYR_WAYS_SOLID, undefined, new Set(['bus']), new Set(['road'])),
    );
  });

  it('applies the logical visibility rule to both physical bank layers', () => {
    const setFilter = vi.fn();
    const layers: LayerSpecification[] = ['a', 'b'].map((bank) => ({
      id: `${LYR_WAYS_SOLID}--bank-${bank}`,
      type: 'line',
      source: `ways--bank-${bank}`,
    }));

    applyRendererVisibilityFilters(
      { getLayer: () => ({}), setFilter },
      layers,
      new Set(['bus']),
      new Set(['road']),
    );

    expect(setFilter).toHaveBeenCalledTimes(2);
    expect(setFilter).toHaveBeenNthCalledWith(
      1,
      `${LYR_WAYS_SOLID}--bank-a`,
      rendererVisibilityFilter(LYR_WAYS_SOLID, undefined, new Set(['bus']), new Set(['road'])),
    );
    expect(setFilter).toHaveBeenNthCalledWith(
      2,
      `${LYR_WAYS_SOLID}--bank-b`,
      rendererVisibilityFilter(LYR_WAYS_SOLID, undefined, new Set(['bus']), new Set(['road'])),
    );
  });
});
