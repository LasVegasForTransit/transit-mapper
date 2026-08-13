import { describe, expect, it } from 'vitest';
import { aPattern, aRoad, aService, aStop, aSystem } from '@transitmapper/core/testing/fixtures';
import {
  infrastructureSections,
  limitSidebarItems,
  servicesForSidebarLine,
  sidebarSectionsForView,
  sidebarTabStopKey,
  stopsForService,
} from '../../src/ui/sidebarOutline';

describe('sidebar outline information architecture', () => {
  it('caps large collections without changing their logical count', () => {
    const items = Array.from({ length: 300 }, (_, index) => index);

    expect(limitSidebarItems(items, false, 150)).toEqual({
      items: items.slice(0, 150),
      hiddenCount: 150,
    });
    expect(limitSidebarItems(items, true, 150)).toEqual({ items, hiddenCount: 0 });
  });

  it('uses concrete nouns for each top-level view and does not expose corridors', () => {
    expect(sidebarSectionsForView('network')).toEqual(['Lines', 'Stops', 'Stations']);
    expect(sidebarSectionsForView('diagram')).toEqual(['Lines', 'Stops', 'Stations']);
    expect(sidebarSectionsForView('infrastructure')).toEqual([
      'Roads',
      'Railways and guideways',
      'Trails',
      'Waterways',
      'Other infrastructure',
      'Stops',
      'Stations',
      'Facilities',
    ]);
  });

  it('resumes keyboard entry at a visible selection and falls back when hidden', () => {
    expect(sidebarTabStopKey('line:first', 'service:selected', true)).toBe('service:selected');
    expect(sidebarTabStopKey('line:first', 'stop:hidden', false)).toBe('line:first');
  });

  it('orders a service’s stops by outbound travel rather than stop storage order', () => {
    const road = aRoad('charleston', [
      [-115.2, 36.15],
      [-115.1, 36.15],
    ]);
    const system = aSystem({
      ways: [road],
      services: [aService('red-service', [aPattern('red-service', [road], [road.id])])],
      lines: [
        {
          id: 'red',
          name: 'Red Line',
          color: '#e5252a',
          serviceIds: ['red-service'],
        },
      ],
      stops: [
        aStop('west', [-115.18, 36.15], { wayId: road.id, t: 0.2 }, { name: 'West' }),
        aStop('east', [-115.12, 36.15], { wayId: road.id, t: 0.8 }, { name: 'East' }),
      ].reverse(),
    });

    expect(stopsForService(system, 'red-service')).toEqual([
      { stopId: 'west', name: 'West' },
      { stopId: 'east', name: 'East' },
    ]);
    expect(servicesForSidebarLine(system, 'red')).toEqual([
      {
        serviceId: 'red-service',
        name: 'red-service',
        explicitName: 'red-service',
        modeId: 'bus',
        stops: [
          { stopId: 'west', name: 'West' },
          { stopId: 'east', name: 'East' },
        ],
      },
    ]);
  });

  it('includes calls served only by a split return path', () => {
    const outward = aRoad('outward', [
      [-115.2, 36.15],
      [-115.1, 36.15],
    ]);
    const inbound = aRoad('inbound', [
      [-115.1, 36.151],
      [-115.2, 36.151],
    ]);
    const system = aSystem({
      ways: [outward, inbound],
      services: [
        aService('red-service', [
          {
            id: 'red-service',
            sections: [
              {
                kind: 'split',
                outbound: [
                  {
                    wayId: outward.id,
                    direction: 'withPoints',
                    extent: { kind: 'whole' },
                    lane: { kind: 'auto' },
                  },
                ],
                inbound: [
                  {
                    wayId: inbound.id,
                    direction: 'withPoints',
                    extent: { kind: 'whole' },
                    lane: { kind: 'auto' },
                  },
                ],
              },
            ],
          },
        ]),
      ],
      lines: [{ id: 'red', name: 'Red', color: '#e5252a', serviceIds: ['red-service'] }],
      stops: [
        aStop('out-stop', [-115.18, 36.15], { wayId: outward.id, t: 0.2 }, { name: 'Out' }),
        aStop('return-stop', [-115.18, 36.151], { wayId: inbound.id, t: 0.8 }, { name: 'Return' }),
      ],
    });

    expect(stopsForService(system, 'red-service').map((stop) => stop.name)).toEqual([
      'Out',
      'Return',
    ]);
  });

  it('includes an inbound call skipped only on the outbound run of a shared path', () => {
    const road = aRoad('shared', [
      [-115.2, 36.15],
      [-115.1, 36.15],
    ]);
    const service = aService('red-service', [aPattern('red-service', [road], [road.id])]);
    service.path.skippedStops = { outbound: ['middle'] };
    const system = aSystem({
      ways: [road],
      services: [service],
      lines: [{ id: 'red', name: 'Red', color: '#e5252a', serviceIds: ['red-service'] }],
      stops: [aStop('middle', [-115.15, 36.15], { wayId: road.id, t: 0.5 }, { name: 'Middle' })],
    });

    expect(stopsForService(system, 'red-service')).toEqual([{ stopId: 'middle', name: 'Middle' }]);
  });

  it('groups physical ways into infrastructure families without inventing corridors', () => {
    const road = aRoad('road', [
      [-115.2, 36.1],
      [-115.1, 36.1],
    ]);
    const rail = aRoad(
      'rail',
      [
        [-115.2, 36.2],
        [-115.1, 36.2],
      ],
      { typeId: 'lightRail' },
    );
    const sections = infrastructureSections(
      aSystem({
        ways: [road, rail],
        namedWays: [
          { id: 'road-name', name: 'Main Street', wayIds: [road.id] },
          { id: 'rail-name', name: 'Silver Track', wayIds: [rail.id] },
        ],
      }),
    );

    expect(
      sections.map((section) => [
        section.title,
        section.items.map((item) => [item.name, item.wayIds]),
      ]),
    ).toEqual([
      ['Roads', [['Main Street', ['road']]]],
      ['Railways and guideways', [['Silver Track', ['rail']]]],
    ]);
  });
});
