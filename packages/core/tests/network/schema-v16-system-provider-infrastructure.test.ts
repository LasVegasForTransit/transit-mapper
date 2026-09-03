import { describe, expect, it } from 'vitest';
import { wholeLeg } from '../../src/model/geo/servicePaths';
import type { LngLat, TransitSystem } from '../../src/model/system';
import type { NetworkQuery } from '../../src/network/query';
import { createSchemaV16SystemProvider } from '../../src/network/schema-v16-system-provider';
import { boundedPhysicalWayIds } from '../../src/network/schema-v16-system/infrastructure';
import { aRoad, aService, aStation, aStop, aSystem } from '../support/fixtures.test';

const worldQuery: NetworkQuery = {
  serviceTime: { kind: 'live' },
  modes: { kind: 'all' },
  filters: {},
  bounds: { kind: 'ordinary', west: -180, south: -90, east: 180, north: 90 },
  detailBand: 'district',
};

async function resolvedInfrastructure(system: TransitSystem, query = worldQuery) {
  const provider = createSchemaV16SystemProvider(system);
  const descriptor = await provider.describe({
    kind: 'transit-system',
    id: system.id,
    revision: { kind: 'latest' },
  });
  const result = await provider.resolve(descriptor.content, query);
  return result.chunks[0].infrastructure;
}

describe('schema-v16 system infrastructure provider', () => {
  it('selects physical Ways by viewport without requiring Service membership', () => {
    const inside = aRoad('inside', [
      [-0.25, 0],
      [0.25, 0],
    ]);
    const crossing = aRoad('crossing', [
      [-2, 0],
      [2, 0],
    ]);
    const outside = aRoad('outside', [
      [2, 2],
      [3, 3],
    ]);
    const invalid = aRoad('invalid', [
      [181, 0],
      [182, 0],
    ]);

    const selected = boundedPhysicalWayIds(
      aSystem({ ways: [inside, crossing, outside, invalid] }),
      { kind: 'ordinary', west: -0.5, south: -0.5, east: 0.5, north: 0.5 },
    );

    expect(selected.has(inside.id)).toBe(true);
    expect(selected.has(crossing.id)).toBe(true);
    expect(selected.has(outside.id)).toBe(false);
    expect(selected.has(invalid.id)).toBe(false);
  });

  it('treats an antimeridian path as a short geographic segment', () => {
    const crossing = aRoad('date-line', [
      [179, 0],
      [-179, 0],
    ]);
    const system = aSystem({ ways: [crossing] });

    expect(
      boundedPhysicalWayIds(system, {
        kind: 'crosses-antimeridian',
        west: 178,
        south: -1,
        east: -178,
        north: 1,
      }).has(crossing.id),
    ).toBe(true);
    expect(
      boundedPhysicalWayIds(system, {
        kind: 'ordinary',
        west: -1,
        south: -1,
        east: 1,
        north: 1,
      }).has(crossing.id),
    ).toBe(false);
  });

  it('clips valid area facts to the query and rejects invalid target geometry', async () => {
    const boundary: LngLat[] = [
      [-2, -2],
      [2, -2],
      [2, 2],
      [-2, 2],
    ];
    const station = aStation('station', [0, 0], { footprint: [...boundary] });
    const system = aSystem({
      stations: [station],
      facilities: [
        { id: 'district-facility', typeId: 'district', geometry: [...boundary] },
        {
          id: 'degenerate-facility',
          typeId: 'district',
          geometry: [
            [-1, 0],
            [0, 0],
            [1, 0],
          ],
        },
      ],
      groups: [{ id: 'district-group', memberIds: [], footprint: [...boundary] }],
    });
    const bounds = { kind: 'ordinary', west: -0.5, south: -0.5, east: 0.5, north: 0.5 } as const;
    const infrastructure = await resolvedInfrastructure(system, { ...worldQuery, bounds });

    expect(infrastructure.facilities.map(({ id }) => id)).toEqual(['district-facility']);
    expect(infrastructure.groups.map(({ id }) => id)).toEqual(['district-group']);
    expect(new Set(infrastructure.areas.map(({ owner }) => owner.kind))).toEqual(
      new Set(['station', 'facility', 'group']),
    );
    for (const area of infrastructure.areas) {
      expect(area.polygon.outer.at(-1)).toEqual(area.polygon.outer[0]);
      for (const [longitude, latitude] of area.polygon.outer) {
        expect(longitude).toBeGreaterThanOrEqual(bounds.west);
        expect(longitude).toBeLessThanOrEqual(bounds.east);
        expect(latitude).toBeGreaterThanOrEqual(bounds.south);
        expect(latitude).toBeLessThanOrEqual(bounds.north);
      }
    }
  });

  it('keeps antimeridian areas out of distant ordinary queries', async () => {
    const system = aSystem({
      groups: [
        {
          id: 'date-line-area',
          memberIds: [],
          footprint: [
            [179, -1],
            [-179, -1],
            [-179, 1],
            [179, 1],
          ],
        },
      ],
    });
    const crossing = await resolvedInfrastructure(system, {
      ...worldQuery,
      bounds: {
        kind: 'crosses-antimeridian',
        west: 178,
        south: -2,
        east: -178,
        north: 2,
      },
    });
    const distant = await resolvedInfrastructure(system, {
      ...worldQuery,
      bounds: { kind: 'ordinary', west: -1, south: -0.5, east: 1, north: 0.5 },
    });

    expect(crossing.groups.map(({ id }) => id)).toEqual(['date-line-area']);
    expect(crossing.areas).toHaveLength(2);
    expect(distant.groups).toEqual([]);
    expect(distant.areas).toEqual([]);
  });

  it('transfers exact approach controls and the prohibited complement of legacy turns', async () => {
    const incoming = aRoad(
      'incoming',
      [
        [-1, 0],
        [0, 0],
      ],
      {
        profile: {
          lanes: [{ id: 'through-lane', kindId: 'bus', widthM: 3.5, direction: 'forward' }],
        },
      },
    );
    const outgoing = aRoad('outgoing', [
      [0, 0],
      [1, 0],
    ]);
    const service = aService('service', [
      {
        id: 'service',
        sections: [{ kind: 'shared', legs: [wholeLeg(incoming.id), wholeLeg(outgoing.id)] }],
      },
    ]);
    const infrastructure = await resolvedInfrastructure(
      aSystem({
        ways: [incoming, outgoing],
        services: [service],
        nodes: [
          {
            id: 'junction',
            coord: [0, 0],
            refs: [
              { wayId: incoming.id, pointIndex: 1 },
              { wayId: outgoing.id, pointIndex: 0 },
            ],
          },
        ],
        approachControls: { 'incoming:end': { control: 'stop' } },
        turnRestrictions: { 'incoming:through-lane': { allowedTargets: [] } },
      }),
      // Street is the only band that carries carriageway facts, and this case
      // asserts how they transfer rather than which band asks for them.
      { ...worldQuery, detailBand: 'street' },
    );

    expect(infrastructure.approachControls).toEqual([
      expect.objectContaining({
        nodeId: 'junction',
        wayId: incoming.id,
        end: 'end',
        controlId: 'stop',
      }),
    ]);
    expect(infrastructure.turnRestrictions).toEqual([
      expect.objectContaining({
        from: {
          wayId: incoming.id,
          laneIds: { kind: 'only', values: ['through-lane'] },
        },
        to: { wayId: outgoing.id, laneIds: { kind: 'all' } },
        via: { kind: 'node', nodeId: 'junction' },
        movement: 'prohibited',
        modeIds: { kind: 'unknown' },
      }),
    ]);
  });

  it('does not pull offscreen Nodes through a long Way', async () => {
    const crossing = aRoad('crossing', [
      [-2, 0],
      [2, 0],
    ]);
    const bounds = { kind: 'ordinary', west: -0.5, south: -0.5, east: 0.5, north: 0.5 } as const;
    const infrastructure = await resolvedInfrastructure(
      aSystem({
        ways: [crossing],
        nodes: [
          { id: 'inside', coord: [0, 0], refs: [] },
          {
            id: 'outside',
            coord: [2, 0],
            refs: [{ wayId: crossing.id, pointIndex: 1 }],
          },
        ],
      }),
      { ...worldQuery, bounds },
    );

    expect(infrastructure.nodes.map(({ id }) => id)).toEqual(['inside']);
  });

  it('omits ambiguous untyped Group members', async () => {
    const way = aRoad('way', [
      [-1, 0],
      [1, 0],
    ]);
    const service = aService('service', [
      { id: 'service', sections: [{ kind: 'shared', legs: [wholeLeg(way.id)] }] },
    ]);
    const lineId = 'shared-id';
    const system = aSystem({
      ways: [way],
      services: [service],
      lines: [{ id: lineId, name: 'Shared', color: '#111', serviceIds: [service.id] }],
      stops: [aStop(lineId, [0, 0], { wayId: way.id, t: 0.5 })],
      groups: [
        {
          id: 'group',
          memberIds: [lineId],
          footprint: [
            [-0.25, -0.25],
            [0.25, -0.25],
            [0.25, 0.25],
            [-0.25, 0.25],
          ],
        },
      ],
    });
    const infrastructure = await resolvedInfrastructure(system);

    expect(infrastructure.groups.map(({ id }) => id)).toEqual(['group']);
    expect(infrastructure.groupMembers).toEqual([]);
  });

  it('rejects duplicate infrastructure identities before transfer', async () => {
    const system = aSystem({
      facilities: [
        { id: 'duplicate', typeId: 'first', geometry: [0, 0] },
        { id: 'duplicate', typeId: 'second', geometry: [1, 1] },
      ],
    });

    await expect(resolvedInfrastructure(system)).rejects.toThrow(/duplicate ID duplicate/i);
  });
});
