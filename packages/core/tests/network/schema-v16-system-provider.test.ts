import { describe, expect, it } from 'vitest';
import { wholeLeg } from '../../src/model/geo/servicePaths';
import type { Pattern, TransitSystem } from '../../src/model/system';
import type { ContentRef } from '../../src/network/content-reference';
import type { NetworkQuery } from '../../src/network/query';
import {
  createSchemaV16SystemProvider,
  legacyDerivedId,
} from '../../src/network/schema-v16-system-provider';
import { aRoad, aService, aStop, aSystem } from '../support/fixtures.test';

const allModesQuery: NetworkQuery = {
  serviceTime: { kind: 'live' },
  modes: { kind: 'all' },
  filters: {},
  bounds: { kind: 'ordinary', west: -116, south: 35, east: -114, north: 37 },
  detailBand: 'district',
};

function latestReference(system: TransitSystem): ContentRef {
  return {
    kind: 'transit-system',
    id: system.id,
    revision: { kind: 'latest' },
  };
}

async function resolveSystem(system: TransitSystem, query: NetworkQuery = allModesQuery) {
  const provider = createSchemaV16SystemProvider(system);
  const descriptor = await provider.describe(latestReference(system));
  const result = await provider.resolve(descriptor.content, query);
  return { descriptor, result };
}

describe('schema-v16 system provider', () => {
  it('resolves only the matching working system revision', async () => {
    const system = aSystem({ id: 'working-system', name: 'Working system' });
    const provider = createSchemaV16SystemProvider(system);
    const first = await provider.describe(latestReference(system));
    const second = await provider.describe(latestReference(structuredClone(system)));

    expect(first.content).toEqual(second.content);
    expect(first.content).toMatchObject({
      kind: 'transit-system',
      id: system.id,
      revision: {
        kind: 'working',
        contentDigest: { algorithm: 'sha-256' },
      },
    });
    if (first.content.kind !== 'transit-system' || first.content.revision.kind !== 'working') {
      throw new Error('Expected a working system reference.');
    }
    expect(first.content.revision.contentDigest.value).toMatch(/^[0-9a-f]{64}$/);
    await expect(
      provider.describe({
        kind: 'transit-system',
        id: system.id,
        revision: { kind: 'pinned', systemRevisionId: 'not-stored-yet' },
      }),
    ).rejects.toThrow(/pinned system revisions are unavailable/i);
    await expect(
      provider.describe({
        kind: 'transit-system',
        id: 'another-system',
        revision: { kind: 'latest' },
      }),
    ).rejects.toThrow(/does not match/i);
  });

  it('expands a bidirectional service into stable directional patterns and exact calls', async () => {
    const west = aRoad('west', [
      [-115.3, 36.1],
      [-115.2, 36.1],
    ]);
    const east = aRoad('east', [
      [-115.2, 36.1],
      [-115.1, 36.1],
    ]);
    const service = aService('service', [
      {
        id: 'ignored-path-id',
        sections: [{ kind: 'shared', legs: [wholeLeg(west.id), wholeLeg(east.id)] }],
      },
    ]);
    const system = aSystem({
      ways: [west, east],
      services: [service],
      stops: [
        aStop('west-stop', [-115.25, 36.1], { wayId: west.id, t: 0.5 }),
        aStop('east-stop', [-115.15, 36.1], { wayId: east.id, t: 0.5 }),
      ],
    });
    const { result } = await resolveSystem(system);
    const chunk = result.chunks[0];

    expect(chunk.entities.servicePlans).toEqual([
      expect.objectContaining({ id: service.id, mode: { kind: 'known', value: 'bus' } }),
    ]);
    expect(chunk.entities.patterns).toEqual([
      {
        id: legacyDerivedId('pattern', service.id, 'outbound'),
        direction: { key: 'outbound' },
        path: 'known',
      },
      {
        id: legacyDerivedId('pattern', service.id, 'inbound'),
        direction: { key: 'inbound' },
        path: 'known',
      },
    ]);
    expect(
      new Set(
        chunk.geometry.patternLegs
          .filter((leg) => leg.patternId.endsWith('8:outbound'))
          .map(({ legIndex, direction }) => `${legIndex}:${direction}`),
      ),
    ).toEqual(new Set(['0:forward', '1:forward']));
    expect(
      new Set(
        chunk.geometry.patternLegs
          .filter((leg) => leg.patternId.endsWith('7:inbound'))
          .map(({ legIndex, direction }) => `${legIndex}:${direction}`),
      ),
    ).toEqual(new Set(['0:reverse', '1:reverse']));
    expect(
      chunk.relationships.patternStopCalls
        .filter((call) => call.patternId.endsWith('8:outbound'))
        .map(({ stopId, pathAnchor }) => ({ stopId, pathAnchor })),
    ).toEqual([
      { stopId: 'west-stop', pathAnchor: { legIndex: 0, carrierPosition: 0.5 } },
      { stopId: 'east-stop', pathAnchor: { legIndex: 1, carrierPosition: 0.5 } },
    ]);
  });

  it('omits an empty inbound run without treating a turnaround as return service', async () => {
    const way = aRoad('terminus-loop', [
      [-115.2, 36.1],
      [-115.19, 36.1],
    ]);
    const path: Pattern = {
      id: 'one-way-path',
      sections: [{ kind: 'turnaround', legs: [wholeLeg(way.id)] }],
    };
    const system = aSystem({ ways: [way], services: [aService('one-way', [path])] });
    const { result } = await resolveSystem(system);

    expect(result.chunks[0].entities.patterns.map((pattern) => pattern.direction?.key)).toEqual([
      'outbound',
    ]);
  });

  it('keeps short turns and repeated circle visits as distinct service facts', async () => {
    const south = aRoad('south', [
      [-115.2, 36.0],
      [-115.2, 36.1],
    ]);
    const north = aRoad('north', [
      [-115.2, 36.1],
      [-115.2, 36.2],
    ]);
    const full = aService('full', [
      {
        id: 'full',
        sections: [{ kind: 'shared', legs: [wholeLeg(south.id), wholeLeg(north.id)] }],
      },
    ]);
    const short = aService('short', [
      { id: 'short', sections: [{ kind: 'shared', legs: [wholeLeg(south.id)] }] },
    ]);
    const circle = aService('circle', [
      {
        id: 'circle',
        sections: [{ kind: 'shared', legs: [wholeLeg(south.id), wholeLeg(south.id)] }],
      },
    ]);
    const system = aSystem({
      ways: [south, north],
      lines: [
        { id: 'line', name: 'Line', color: '#112233', serviceIds: [full.id, short.id, circle.id] },
      ],
      services: [full, short, circle],
      stops: [aStop('loop-stop', [-115.2, 36.05], { wayId: south.id, t: 0.5 })],
    });
    const { result } = await resolveSystem(system);
    const chunk = result.chunks[0];
    const circlePatternId = legacyDerivedId('pattern', circle.id, 'outbound');

    expect(chunk.entities.servicePlans.map(({ id }) => id)).toEqual(['full', 'short', 'circle']);
    expect(
      chunk.relationships.patternStopCalls
        .filter((call) => call.patternId === circlePatternId)
        .map(({ id, stopId, sequence }) => ({ id, stopId, sequence })),
    ).toEqual([
      {
        id: legacyDerivedId('stop-call', circle.id, 'outbound', 0, 'loop-stop'),
        stopId: 'loop-stop',
        sequence: 0,
      },
      {
        id: legacyDerivedId('stop-call', circle.id, 'outbound', 1, 'loop-stop'),
        stopId: 'loop-stop',
        sequence: 1,
      },
    ]);
  });

  it('keeps line order fixed while mode filtering removes service facts', async () => {
    const way = aRoad('shared-way', [
      [-115.3, 36.1],
      [-115.1, 36.1],
    ]);
    const rail = aService(
      'rail-service',
      [{ id: 'rail', sections: [{ kind: 'shared', legs: [wholeLeg(way.id)] }] }],
      {
        modeId: 'subway',
      },
    );
    const bus = aService('bus-service', [
      { id: 'bus', sections: [{ kind: 'shared', legs: [wholeLeg(way.id)] }] },
    ]);
    const system = aSystem({
      ways: [way],
      lines: [
        { id: 'rail-line', name: 'Rail', color: '#f00', serviceIds: [rail.id] },
        { id: 'bus-line', name: 'Bus', color: '#00f', serviceIds: [bus.id] },
      ],
      services: [rail, bus],
    });
    const query: NetworkQuery = {
      ...allModesQuery,
      modes: { kind: 'only', ids: ['bus'] },
    };
    const { result } = await resolveSystem(system, query);

    expect(result.lineOrder).toEqual([
      { lineId: 'rail-line', rank: 0 },
      { lineId: 'bus-line', rank: 1 },
    ]);
    expect(result.chunks[0].entities.lines.map(({ id }) => id)).toEqual(['bus-line']);
    expect(result.chunks[0].entities.servicePlans.map(({ id }) => id)).toEqual(['bus-service']);

    const { result: filteredOut } = await resolveSystem(system, {
      ...allModesQuery,
      modes: { kind: 'only', ids: [] },
    });
    expect(filteredOut.chunks[0].entities.servicePlans).toEqual([]);
    expect(filteredOut.coverage[0]).toMatchObject({
      serviceEvidence: 'present',
      filterEffect: 'excluded',
    });
    expect(filteredOut.lineOrder).toEqual(result.lineOrder);
  });

  it('returns only visible route paint plus complete anchored topology around it', async () => {
    const west = aRoad('west', [
      [-3, 0],
      [-2, 0],
    ]);
    const center = aRoad('center', [
      [-2, 0],
      [2, 0],
    ]);
    const east = aRoad('east', [
      [2, 0],
      [3, 0],
    ]);
    const service = aService('bounded', [
      {
        id: 'bounded',
        sections: [
          { kind: 'shared', legs: [wholeLeg(west.id), wholeLeg(center.id), wholeLeg(east.id)] },
        ],
      },
    ]);
    const system = aSystem({
      ways: [west, center, east],
      services: [service],
      stops: [
        aStop('west-call', [-2.5, 0], { wayId: west.id, t: 0.5 }),
        aStop('center-call', [0, 0], { wayId: center.id, t: 0.5 }),
        aStop('east-call', [2.5, 0], { wayId: east.id, t: 0.5 }),
      ],
    });
    const { result } = await resolveSystem(system, {
      ...allModesQuery,
      bounds: { kind: 'ordinary', west: -0.25, south: -0.25, east: 0.25, north: 0.25 },
    });
    const chunk = result.chunks[0];
    const visibleLegs = chunk.geometry.patternLegs.filter((leg) =>
      chunk.geometry.visiblePatternLegFragmentIds.includes(leg.id),
    );

    expect(new Set(visibleLegs.map(({ legIndex }) => legIndex))).toEqual(new Set([1]));
    expect(new Set(chunk.relationships.patternStopCalls.map(({ stopId }) => stopId))).toEqual(
      new Set(['west-call', 'center-call', 'east-call']),
    );
    expect(chunk.relationships.topologyWindows).not.toHaveLength(0);
    for (const window of chunk.relationships.topologyWindows) {
      expect(
        window.patternLegFragmentIds.every((id) =>
          chunk.geometry.patternLegs.some((leg) => leg.id === id),
        ),
      ).toBe(true);
    }
  });

  it('does not expand services that have no query-intersecting Way', async () => {
    const visibleWay = aRoad('visible-way', [
      [-0.5, 0],
      [0.5, 0],
    ]);
    const offscreenWay = aRoad('offscreen-way', [
      [10, 10],
      [11, 10],
    ]);
    const visibleService = aService('visible-service', [
      {
        id: 'visible-service',
        sections: [{ kind: 'shared', legs: [wholeLeg(visibleWay.id)] }],
      },
    ]);
    const offscreenService = aService('offscreen-service', [
      {
        id: 'offscreen-service',
        sections: [{ kind: 'shared', legs: [wholeLeg(offscreenWay.id)] }],
      },
    ]);
    const system = aSystem({
      ways: [visibleWay, offscreenWay],
      lines: [
        { id: 'visible-line', name: 'Visible', color: '#111111', serviceIds: [visibleService.id] },
        {
          id: 'offscreen-line',
          name: 'Offscreen',
          color: '#222222',
          serviceIds: [offscreenService.id],
        },
      ],
      services: [visibleService, offscreenService],
      stops: [aStop('bare-stop', [0, 0])],
    });
    const { result } = await resolveSystem(system, {
      ...allModesQuery,
      bounds: { kind: 'ordinary', west: -1, south: -1, east: 1, north: 1 },
    });
    const chunk = result.chunks[0];

    expect(chunk.entities.lines.map(({ id }) => id)).toEqual(['visible-line']);
    expect(chunk.entities.servicePlans.map(({ id }) => id)).toEqual(['visible-service']);
    expect(new Set(chunk.entities.patterns.map(({ id }) => id))).toEqual(
      new Set([
        legacyDerivedId('pattern', visibleService.id, 'outbound'),
        legacyDerivedId('pattern', visibleService.id, 'inbound'),
      ]),
    );
    expect(chunk.entities.stops.map(({ id }) => id)).toContain('bare-stop');
  });

  it('omits a service when its legacy path has no physical carrier', async () => {
    const service = aService('missing-geometry', [
      {
        id: 'missing-geometry',
        sections: [{ kind: 'shared', legs: [wholeLeg('missing-way')] }],
      },
    ]);
    const system = aSystem({ services: [service] });
    const { result } = await resolveSystem(system);
    const chunk = result.chunks[0];

    expect(chunk.entities.servicePlans).toEqual([]);
    expect(chunk.entities.patterns).toEqual([]);
    expect(chunk.entities.alignments).toEqual([]);
    expect(chunk.entities.ways).toEqual([]);
    expect(chunk.geometry.carriers).toEqual([]);
    expect(chunk.geometry.patternLegs).toEqual([]);
  });

  it('rejects ambiguous legacy Line-to-Service ownership', async () => {
    const service = aService('service', []);
    const system = aSystem({
      lines: [
        { id: 'first', name: 'First', color: '#111', serviceIds: [service.id] },
        { id: 'second', name: 'Second', color: '#222', serviceIds: [service.id] },
      ],
      services: [service],
    });
    const provider = createSchemaV16SystemProvider(system);

    await expect(provider.describe(latestReference(system))).rejects.toThrow(
      /duplicate-membership/i,
    );
  });
});
