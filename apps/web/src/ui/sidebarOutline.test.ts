import { describe, expect, it } from 'vitest';
import { aPattern, aRoad, aService, aStation, aSystem } from '@transitmapper/core/testing/fixtures';
import {
  limitSidebarItems,
  limitSidebarPatterns,
  lineStopsForService,
  networkCorridors,
  sidebarTabStopKey,
} from './sidebarOutline';

describe('sidebar list limits', () => {
  it('applies one shared row budget to a combined section', () => {
    const items = Array.from({ length: 300 }, (_, index) => index);

    expect(limitSidebarItems(items, false, 150)).toEqual({
      items: items.slice(0, 150),
      hiddenCount: 150,
    });
    expect(limitSidebarItems(items, true, 150)).toEqual({ items, hiddenCount: 0 });
  });

  it('applies one stop budget across every pattern of an expanded line', () => {
    const patterns = [
      {
        patternId: 'main',
        name: undefined,
        stops: Array.from({ length: 100 }, (_, index) => ({
          stationId: `main-${index}`,
          name: `Main ${index}`,
        })),
      },
      {
        patternId: 'branch',
        name: 'Branch',
        stops: Array.from({ length: 100 }, (_, index) => ({
          stationId: `branch-${index}`,
          name: `Branch ${index}`,
        })),
      },
    ];

    const limited = limitSidebarPatterns(patterns, false, 150);

    expect(limited.items[0].stops).toHaveLength(100);
    expect(limited.items[1].stops).toHaveLength(50);
    expect(limited.hiddenCount).toBe(50);
  });
});

describe('sidebar keyboard entry', () => {
  it('resumes at a visible selection and falls back when that selection is hidden', () => {
    expect(sidebarTabStopKey('service:first', 'service:selected', true)).toBe('service:selected');
    expect(sidebarTabStopKey('service:first', 'station:hidden', false)).toBe('service:first');
  });
});

describe('lineStopsForService', () => {
  it('orders a line’s stops by outbound travel rather than station storage order', () => {
    const road = aRoad('charleston', [
      [-115.2, 36.15],
      [-115.1, 36.15],
    ]);
    const system = aSystem({
      ways: [road],
      services: [
        aService('red', [aPattern('main', [road], [road.id])], {
          name: 'Red Line',
          modeId: 'lightRail',
        }),
      ],
      stations: [
        aStation('west', [-115.18, 36.15], { wayId: road.id, t: 0.2 }, { name: 'West' }),
        aStation('east', [-115.12, 36.15], { wayId: road.id, t: 0.8 }, { name: 'East' }),
      ].reverse(),
    });

    expect(lineStopsForService(system, 'red')).toEqual([
      {
        patternId: 'main',
        name: undefined,
        stops: [
          { stationId: 'west', name: 'West' },
          { stationId: 'east', name: 'East' },
        ],
      },
    ]);
  });
});

describe('networkCorridors', () => {
  it('aggregates named infrastructure and excludes roads with no service', () => {
    const trunkA = aRoad('trunk-a', [
      [-115.2, 36.15],
      [-115.15, 36.15],
    ]);
    const trunkB = aRoad('trunk-b', [
      [-115.15, 36.15],
      [-115.1, 36.15],
    ]);
    const unrelated = aRoad('unrelated', [
      [-115.2, 36.2],
      [-115.1, 36.2],
    ]);
    const system = aSystem({
      ways: [trunkA, trunkB, unrelated],
      namedWays: [
        { id: 'charleston', name: 'Charleston Boulevard', wayIds: ['trunk-a', 'trunk-b'] },
      ],
      services: [
        aService('red', [aPattern('main', [trunkA, trunkB], ['trunk-a', 'trunk-b'])], {
          name: 'Red Line',
        }),
      ],
      stations: [aStation('hub', [-115.15, 36.15], { wayId: 'trunk-a', t: 1 }, { name: 'Hub' })],
    });

    expect(networkCorridors(system)).toEqual([
      {
        id: 'named:charleston',
        label: 'Charleston Boulevard',
        typeId: 'road',
        wayIds: ['trunk-a', 'trunk-b'],
        serviceIds: ['red'],
        stationIds: ['hub'],
      },
    ]);
  });

  it('keeps a service-carrying way without a named identity as a fallback corridor', () => {
    const track = aRoad(
      'airport-track',
      [
        [-115.16, 36.1],
        [-115.14, 36.08],
      ],
      { typeId: 'lightRail' },
    );
    const system = aSystem({
      ways: [track],
      services: [aService('airport', [aPattern('main', [track], [track.id])])],
    });

    expect(networkCorridors(system)).toEqual([
      {
        id: 'way:airport-track',
        label: 'Light rail / tram',
        typeId: 'lightRail',
        wayIds: ['airport-track'],
        serviceIds: ['airport'],
        stationIds: [],
      },
    ]);
  });
});
