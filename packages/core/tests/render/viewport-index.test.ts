import { describe, expect, it } from 'vitest';
import {
  MAX_VIEWPORT_GRID_ENTRIES,
  queryViewportCandidates,
  viewportIndexFor,
  viewportIndexStats,
} from '../../src/render/viewport-index';
import { aPattern, aRoad, aService, aStation, aSystem } from '../support/fixtures.test';

describe('renderer viewport index', () => {
  it('returns a corridor whose segment crosses the viewport with both endpoints outside', () => {
    const crossing = aRoad('crossing', [
      [-2, 0],
      [2, 0],
    ]);
    const offscreen = aRoad('offscreen', [
      [5, 5],
      [6, 5],
    ]);
    const system = aSystem({
      ways: [offscreen, crossing],
      nodes: [
        { id: 'inside-node', coord: [0, 0], refs: [] },
        { id: 'outside-node', coord: [4, 4], refs: [] },
      ],
      stations: [aStation('inside-station', [0.25, 0.25]), aStation('outside-station', [4, 4])],
      namedWays: [
        { id: 'outside-label', name: 'Outside', wayIds: ['offscreen'] },
        { id: 'crossing-label', name: 'Crossing', wayIds: ['crossing'] },
      ],
    });

    const result = queryViewportCandidates(viewportIndexFor(system), {
      bounds: [
        [-0.5, -0.5],
        [0.5, 0.5],
      ],
    });

    expect(result.corridorIds).toEqual(['crossing']);
    expect(result.junctionIds).toEqual(['inside-node']);
    expect(result.stationIds).toEqual(['inside-station']);
    expect(result.labelIds).toEqual(['crossing-label']);
    expect(result.counts.coarseCandidates.corridor).toBeLessThan(system.ways.length);
  });

  it('uses the transition margin without admitting geometry beyond it', () => {
    const system = aSystem({
      ways: [
        aRoad('inside-margin', [
          [1.1, 0],
          [1.15, 0],
        ]),
        aRoad('outside-margin', [
          [1.3, 0],
          [1.35, 0],
        ]),
      ],
      nodes: [
        { id: 'inside-node', coord: [1.19, 0], refs: [] },
        { id: 'outside-node', coord: [1.21, 0], refs: [] },
      ],
      stations: [aStation('inside-station', [1.19, 0]), aStation('outside-station', [1.21, 0])],
      namedWays: [
        { id: 'inside-label', name: 'Inside', wayIds: ['inside-margin'] },
        { id: 'outside-label', name: 'Outside', wayIds: ['outside-margin'] },
      ],
    });

    const result = queryViewportCandidates(viewportIndexFor(system), {
      bounds: [
        [-1, -1],
        [1, 1],
      ],
      transitionMarginDegrees: 0.2,
    });

    expect(result.corridorIds).toEqual(['inside-margin']);
    expect(result.junctionIds).toEqual(['inside-node']);
    expect(result.stationIds).toEqual(['inside-station']);
    expect(result.labelIds).toEqual(['inside-label']);
  });

  it('retains a station whose physical footprint crosses the viewport', () => {
    const system = aSystem({
      stations: [
        aStation('crossing-station', [2, 0], {
          footprint: [
            [0.5, -0.5],
            [2, -0.5],
            [2, 0.5],
            [0.5, 0.5],
          ],
        }),
      ],
    });

    const result = queryViewportCandidates(viewportIndexFor(system), {
      bounds: [
        [-1, -1],
        [1, 1],
      ],
      categories: ['station'],
    });

    expect(result.stationIds).toEqual(['crossing-station']);
  });

  it('retains filled station and group footprints that contain the viewport', () => {
    const surrounding = [
      [-2, -2],
      [2, -2],
      [2, 2],
      [-2, 2],
    ] as const;
    const system = aSystem({
      stations: [
        aStation('surrounding-station', [3, 3], {
          footprint: surrounding.map((point) => [...point]),
        }),
      ],
      groups: [
        {
          id: 'surrounding-group',
          memberIds: [],
          footprint: surrounding.map((point) => [...point]),
        },
      ],
    });

    const result = queryViewportCandidates(viewportIndexFor(system), {
      bounds: [
        [-1, -1],
        [1, 1],
      ],
      categories: ['station', 'group'],
    });

    expect(result.stationIds).toEqual(['surrounding-station']);
    expect(result.groupIds).toEqual(['surrounding-group']);
  });

  it('preserves system order and skips exact work for unrequested projection passes', () => {
    const system = aSystem({
      ways: [
        aRoad('first', [
          [0.8, 0],
          [0.9, 0],
        ]),
        aRoad('second', [
          [-0.9, 0],
          [-0.8, 0],
        ]),
      ],
      nodes: [{ id: 'node', coord: [0, 0], refs: [] }],
      stations: [aStation('station', [0, 0])],
      namedWays: [{ id: 'label', name: 'Label', wayIds: ['first'] }],
    });

    const result = queryViewportCandidates(viewportIndexFor(system), {
      bounds: [
        [-1, -1],
        [1, 1],
      ],
      categories: ['corridor'],
    });

    expect(result.corridorIds).toEqual(['first', 'second']);
    expect(result.junctionIds).toEqual([]);
    expect(result.stationIds).toEqual([]);
    expect(result.labelIds).toEqual([]);
    expect(result.counts.exactChecks).toEqual({
      corridor: 2,
      junction: 0,
      stop: 0,
      station: 0,
      label: 0,
      wayHandle: 0,
      serviceTerminus: 0,
      facility: 0,
      group: 0,
      physicalHandle: 0,
    });
  });

  it('indexes independent presentation features and their interaction points exactly', () => {
    const visibleWay = aRoad('visible-way', [
      [-0.5, 0],
      [0.5, 0],
    ]);
    const remoteWay = aRoad('remote-way', [
      [4, 4],
      [5, 4],
    ]);
    const system = aSystem({
      ways: [visibleWay, remoteWay],
      services: [
        aService('visible-service', [aPattern('visible-pattern', [visibleWay], [visibleWay.id])]),
        aService('remote-service', [aPattern('remote-pattern', [remoteWay], [remoteWay.id])]),
      ],
      stations: [
        aStation('visible-station', [0, 0], {
          footprint: [
            [-0.25, -0.25],
            [0.25, -0.25],
            [0.25, 0.25],
          ],
        }),
        aStation('remote-station', [4, 4], {
          footprint: [
            [3.9, 3.9],
            [4.1, 3.9],
            [4.1, 4.1],
          ],
        }),
      ],
      facilities: [
        { id: 'visible-facility', typeId: 'entrance', geometry: [0, 0.25] },
        { id: 'remote-facility', typeId: 'entrance', geometry: [4, 4.25] },
      ],
      groups: [
        {
          id: 'visible-group',
          memberIds: [],
          footprint: [
            [-0.4, -0.4],
            [0.4, -0.4],
            [0.4, 0.4],
          ],
        },
        {
          id: 'remote-group',
          memberIds: [],
          footprint: [
            [3.8, 3.8],
            [4.2, 3.8],
            [4.2, 4.2],
          ],
        },
      ],
    });

    const result = queryViewportCandidates(viewportIndexFor(system), {
      bounds: [
        [-1, -1],
        [1, 1],
      ],
      categories: ['way-handle', 'service-terminus', 'facility', 'group', 'physical-handle'],
    });

    expect(result.wayHandleIds).toHaveLength(2);
    expect(result.serviceTerminusIds).toHaveLength(2);
    expect(result.facilityIds).toEqual(['visible-facility']);
    expect(result.groupIds).toEqual(['visible-group']);
    expect(result.physicalHandleIds).toHaveLength(6);
    expect(result.counts.visible).toMatchObject({
      wayHandle: 2,
      serviceTerminus: 2,
      facility: 1,
      group: 1,
      physicalHandle: 6,
    });
  });

  it('reuses the immutable index when only document metadata changes', () => {
    const system = aSystem({
      ways: [
        aRoad('way', [
          [0, 0],
          [1, 0],
        ]),
      ],
    });

    const first = viewportIndexFor(system);
    const second = viewportIndexFor({ ...system, name: 'Renamed system' });

    expect(second).toBe(first);
  });

  it('bounds grid expansion while keeping an oversize crossing exact', () => {
    const worldSpanning = Array.from({ length: 8 }, (_, index) =>
      aRoad(`world-${index}`, [
        [-170, index * 0.01],
        [170, index * 0.01],
      ]),
    );
    const index = viewportIndexFor(aSystem({ ways: worldSpanning }));

    const stats = viewportIndexStats(index);
    const result = queryViewportCandidates(index, {
      bounds: [
        [-0.1, -0.1],
        [0.1, 0.1],
      ],
      categories: ['corridor'],
    });

    expect(stats.gridEntries).toBeLessThanOrEqual(MAX_VIEWPORT_GRID_ENTRIES);
    expect(stats.oversizeEntries).toBeGreaterThan(0);
    expect(result.corridorIds).toEqual(worldSpanning.map(({ id }) => id));
  });
});
