import { describe, expect, it } from 'vitest';
import { wholeLeg } from '../../src/model/geo/servicePaths';
import type { TransitSystem } from '../../src/model/system';
import type { NetworkQuery } from '../../src/network/query';
import { createSchemaV16SystemProvider } from '../../src/network/schema-v16-system-provider';
import { aRoad, aService, aStation, aStop, aSystem } from '../support/fixtures.test';

const worldQuery: NetworkQuery = {
  serviceTime: { kind: 'live' },
  modes: { kind: 'all' },
  filters: {},
  bounds: { kind: 'ordinary', west: -180, south: -90, east: 180, north: 90 },
  detailBand: 'district',
};

async function describedProvider(system: TransitSystem) {
  const provider = createSchemaV16SystemProvider(system);
  const descriptor = await provider.describe({
    kind: 'transit-system',
    id: system.id,
    revision: { kind: 'latest' },
  });
  return { provider, descriptor };
}

describe('schema-v16 system geometry provider', () => {
  it('maps real Way values and orders reverse calls without proximity guesses', async () => {
    const way = aRoad(
      'carrier',
      [
        [-1, 0],
        [0, 1],
        [1, 0],
      ],
      {
        geometry: 'curved',
        curveControls: [{ pointIndex: 1, radiusM: 14 }],
        profile: {
          lanes: [{ id: 'reverse-lane', kindId: 'bus', widthM: 3.25, direction: 'backward' }],
        },
        source: 'opaque-import-marker',
      },
    );
    const leg = {
      ...wholeLeg(way.id, 'againstPoints'),
      lane: { kind: 'pinned' as const, laneId: 'reverse-lane' },
    };
    const service = aService('reverse-service', [
      { id: 'reverse-service', sections: [{ kind: 'shared', legs: [leg] }] },
    ]);
    const system = aSystem({
      ways: [way],
      services: [service],
      stops: [
        aStop('low', [-0.6, 0.4], { wayId: way.id, t: 0.2 }),
        aStop('high', [0.6, 0.4], { wayId: way.id, t: 0.8 }),
        aStop('near-but-unanchored', [0, 0.99]),
      ],
    });
    const { provider, descriptor } = await describedProvider(system);
    const result = await provider.resolve(descriptor.content, worldQuery);
    const chunk = result.chunks[0];

    expect(chunk.entities.alignments).toEqual([{ id: way.id }]);
    expect(chunk.entities.ways).toEqual([
      expect.objectContaining({
        id: way.id,
        alignmentId: way.id,
        alignmentExtent: [0, 1],
        profile: {
          lanes: [
            {
              id: 'reverse-lane',
              kindId: 'bus',
              widthMeters: 3.25,
              direction: 'reverse',
            },
          ],
        },
      }),
    ]);
    const resolvedCurve = chunk.geometry.carriers.find(
      (carrier) => carrier.carrier.kind === 'way' && carrier.carrier.laneId === 'reverse-lane',
    );
    expect(resolvedCurve).toMatchObject({
      carrier: { kind: 'way', id: way.id, laneId: 'reverse-lane' },
      geometry: 'freeform',
      curveControls: [],
    });
    const outbound = chunk.entities.patterns.find(
      (pattern) => pattern.direction?.key === 'outbound',
    );
    expect(
      chunk.relationships.patternStopCalls
        .filter((call) => call.patternId === outbound?.id)
        .map(({ stopId }) => stopId),
    ).toEqual(['high', 'low']);
    expect(
      chunk.relationships.patternStopCalls.some((call) => call.stopId === 'near-but-unanchored'),
    ).toBe(false);
    expect(descriptor.sources).toEqual([]);
    expect(descriptor.attributions).toEqual([]);
  });

  it('binds resolution to the semantic working digest and rejects cursors', async () => {
    const system = aSystem({ id: 'digest-system', name: 'First name' });
    const changed = { ...system, name: 'Second name' };
    const first = await describedProvider(system);
    const second = await describedProvider(changed);

    expect(first.descriptor.content).not.toEqual(second.descriptor.content);
    if (
      first.descriptor.content.kind !== 'transit-system' ||
      first.descriptor.content.revision.kind !== 'working'
    ) {
      throw new Error('Expected a working system reference.');
    }
    await expect(
      first.provider.resolve(
        {
          kind: 'transit-system',
          id: system.id,
          revision: {
            kind: 'working',
            contentDigest: { algorithm: 'sha-256', value: '0'.repeat(64) },
          },
        },
        worldQuery,
      ),
    ).rejects.toThrow(/no longer matches/i);
    await expect(
      first.provider.resolve(first.descriptor.content, { ...worldQuery, cursor: 'another-page' }),
    ).rejects.toThrow(/does not accept cursors/i);

    const controller = new AbortController();
    controller.abort();
    await expect(
      first.provider.describe(
        { kind: 'transit-system', id: system.id, revision: { kind: 'latest' } },
        { signal: controller.signal },
      ),
    ).rejects.toThrow(/aborted/i);
  });

  it('selects geometry inside an antimeridian-crossing query', async () => {
    const way = aRoad('date-line', [
      [179, 0],
      [-179, 0],
    ]);
    const service = aService('date-line-service', [
      {
        id: 'date-line-service',
        sections: [{ kind: 'shared', legs: [wholeLeg(way.id)] }],
      },
    ]);
    const system = aSystem({ ways: [way], services: [service] });
    const { provider, descriptor } = await describedProvider(system);
    const result = await provider.resolve(descriptor.content, {
      ...worldQuery,
      bounds: {
        kind: 'crosses-antimeridian',
        west: 178,
        south: -1,
        east: -178,
        north: 1,
      },
    });

    const chunk = result.chunks[0];
    expect(chunk.geometry.visiblePatternLegFragmentIds).not.toHaveLength(0);
    const visibleLegIds = new Set(chunk.geometry.visiblePatternLegFragmentIds);
    const visibleCarrierIds = new Set(
      chunk.geometry.patternLegs
        .filter(({ id }) => visibleLegIds.has(id))
        .map(({ carrierFragmentId }) => carrierFragmentId),
    );
    expect(
      chunk.geometry.carriers
        .filter(
          (carrier) =>
            visibleCarrierIds.has(carrier.id) &&
            carrier.carrier.kind === 'way' &&
            carrier.carrier.id === way.id,
        )
        .map(({ alignmentRange, points }) => ({ alignmentRange, points })),
    ).toEqual([
      {
        alignmentRange: [0, 0.5],
        points: [
          [179, 0],
          [180, 0],
        ],
      },
      {
        alignmentRange: [0.5, 1],
        points: [
          [-180, 0],
          [-179, 0],
        ],
      },
    ]);
  });

  it('carries bounded schema-v16 infrastructure without reviving Service references', async () => {
    const way = aRoad(
      'street',
      [
        [-0.5, 0],
        [0.5, 0],
      ],
      {
        profile: {
          lanes: [{ id: 'bus-lane', kindId: 'bus', widthM: 3.5, direction: 'both' }],
        },
      },
    );
    const service = aService('service', [
      { id: 'service', sections: [{ kind: 'shared', legs: [wholeLeg(way.id)] }] },
    ]);
    const station = aStation('station', [0, 0], {
      name: 'Central',
      footprint: [
        [-0.1, -0.1],
        [0.1, -0.1],
        [0.1, 0.1],
      ],
    });
    const stop = aStop('stop', [0, 0], { wayId: way.id, t: 0.5 }, { stationId: station.id });
    const system = aSystem({
      ways: [way],
      lines: [{ id: 'line', name: 'Line', color: '#123456', serviceIds: [service.id] }],
      services: [service],
      stops: [stop],
      stations: [station],
      nodes: [
        {
          id: 'node',
          coord: way.points[0],
          refs: [{ wayId: way.id, pointIndex: 0 }],
          control: 'signal',
          connectors: [
            {
              from: { wayId: way.id, laneId: 'bus-lane' },
              to: { wayId: way.id, laneId: 'bus-lane' },
            },
          ],
        },
      ],
      namedWays: [{ id: 'corridor', name: 'Main Street', wayIds: [way.id] }],
      medians: { corridor: { widthM: 2, kindId: 'raised' } },
      facilities: [
        { id: 'entrance', typeId: 'entrance', name: 'Main entrance', geometry: [0, 0] },
        {
          id: 'depot',
          typeId: 'depot',
          geometry: [
            [-0.2, -0.2],
            [-0.1, -0.2],
            [-0.1, -0.1],
          ],
        },
      ],
      groups: [
        {
          id: 'complex',
          name: 'Central complex',
          color: '#123456',
          memberIds: [stop.id, service.id, 'entrance'],
          footprint: [
            [-0.3, -0.3],
            [0.3, -0.3],
            [0.3, 0.3],
          ],
        },
      ],
    });
    const { provider, descriptor } = await describedProvider(system);
    // Street is the only band that carries carriageway facts, and this case
    // asserts the complete transfer rather than what one camera can resolve.
    const result = await provider.resolve(descriptor.content, {
      ...worldQuery,
      detailBand: 'street',
    });
    const infrastructure = result.chunks[0].infrastructure;

    expect(infrastructure.nodes.map(({ id }) => id)).toEqual(['node']);
    expect(infrastructure.laneConnectors).toHaveLength(1);
    expect(infrastructure.namedWays.map(({ id }) => id)).toEqual(['corridor']);
    expect(infrastructure.medians).toHaveLength(1);
    expect(infrastructure.facilities.map(({ id }) => id)).toEqual(['entrance', 'depot']);
    expect(infrastructure.groups.map(({ id }) => id)).toEqual(['complex']);
    expect(infrastructure.groupMembers.map(({ member }) => member.kind)).toEqual([
      'stop',
      'service-plan',
      'facility',
    ]);
    expect(new Set(infrastructure.areas.map(({ owner }) => owner.kind))).toEqual(
      new Set(['station', 'facility', 'group']),
    );
    expect(infrastructure.turnRestrictions).toEqual([]);
  });
});
