import { describe, expect, it } from 'vitest';
import { wholeLeg } from '../../src/model/geo/servicePaths';
import type { TransitSystem } from '../../src/model/system';
import type { NetworkQuery } from '../../src/network/query';
import { createSchemaV16SystemProvider } from '../../src/network/schema-v16-system-provider';
import { aRoad, aService, aStop, aSystem } from '../support/fixtures.test';

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

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

describe('schema-v16 system logical Pattern leg fragments', () => {
  it('keeps logical identity while query bounds change transferred shards', async () => {
    const way = aRoad(
      'bounded-curve',
      [
        [-4, 0],
        [-2, 0],
        [0, 0],
        [2, 0],
        [4, 0],
      ],
      {
        geometry: 'curved',
        curveControls: [{ pointIndex: 2, radiusM: 14 }],
      },
    );
    const service = aService('bounded-service', [
      {
        id: 'bounded-service',
        sections: [{ kind: 'shared', legs: [wholeLeg(way.id)] }],
      },
    ]);
    const system = aSystem({
      ways: [way],
      services: [service],
      stops: [
        aStop('west-call', [-2, 0], { wayId: way.id, t: 0.25 }),
        aStop('east-call', [2, 0], { wayId: way.id, t: 0.75 }),
      ],
    });
    const { provider, descriptor } = await describedProvider(system);
    const result = await provider.resolve(descriptor.content, {
      ...worldQuery,
      bounds: { kind: 'ordinary', west: -1, south: -1, east: 1, north: 1 },
    });
    const chunk = result.chunks[0];
    const outboundId = required(
      chunk.entities.patterns.find((pattern) => pattern.direction?.key === 'outbound'),
      'Expected an outbound Pattern.',
    ).id;
    const visibleLeg = required(
      chunk.geometry.patternLegs.find(
        (leg) =>
          leg.patternId === outboundId &&
          chunk.geometry.visiblePatternLegFragmentIds.includes(leg.id),
      ),
      'Expected a visible Pattern-leg shard.',
    );
    const visibleCarrier = required(
      chunk.geometry.carriers.find((carrier) => carrier.id === visibleLeg.carrierFragmentId),
      'Expected the visible carrier shard.',
    );
    const window = required(
      chunk.relationships.topologyWindows.find((candidate) => candidate.patternId === outboundId),
      'Expected a topology window.',
    );
    const topologyLeg = required(
      chunk.geometry.patternLegs.find((leg) => leg.id === window.patternLegFragmentIds[0]),
      'Expected the topology Pattern-leg shard.',
    );
    const topologyCarrier = required(
      chunk.geometry.carriers.find((carrier) => carrier.id === topologyLeg.carrierFragmentId),
      'Expected the topology carrier shard.',
    );

    expect(visibleLeg).toMatchObject({
      carrierRange: [0.375, 0.625],
      logicalCarrierRange: [0.25, 0.75],
      logicalAlignmentRange: [0.25, 0.75],
    });
    expect(visibleCarrier).toMatchObject({
      alignmentRange: [0.375, 0.625],
      points: [
        [-1, 0],
        [1, 0],
      ],
      geometry: 'freeform',
      curveControls: [],
    });
    expect(topologyLeg).toMatchObject({
      carrierRange: [0.25, 0.75],
      logicalCarrierRange: [0.25, 0.75],
      logicalAlignmentRange: [0.25, 0.75],
    });
    expect(topologyCarrier).toMatchObject({
      alignmentRange: [0.25, 0.75],
      points: [
        [-2, 0],
        [2, 0],
      ],
      geometry: 'freeform',
      curveControls: [],
    });
    expect(window.patternLegFragmentIds).not.toContain(visibleLeg.id);
    expect(chunk.geometry.visiblePatternLegFragmentIds).not.toContain(topologyLeg.id);
    expect(visibleLeg.logicalPatternLegFragmentId).toBe(topologyLeg.logicalPatternLegFragmentId);
    expect(visibleLeg.logicalPatternLegFragmentId).not.toBe(visibleLeg.id);

    const narrower = await provider.resolve(descriptor.content, {
      ...worldQuery,
      bounds: { kind: 'ordinary', west: -0.5, south: -1, east: 0.5, north: 1 },
    });
    const narrowerChunk = narrower.chunks[0];
    const narrowerWindow = required(
      narrowerChunk.relationships.topologyWindows.find(
        (candidate) => candidate.patternId === outboundId,
      ),
      'Expected the narrower topology window.',
    );
    const narrowerTopologyLeg = required(
      narrowerChunk.geometry.patternLegs.find(
        (leg) => leg.id === narrowerWindow.patternLegFragmentIds[0],
      ),
      'Expected the narrower topology Pattern-leg shard.',
    );
    const narrowerTopologyCarrier = required(
      narrowerChunk.geometry.carriers.find(
        (carrier) => carrier.id === narrowerTopologyLeg.carrierFragmentId,
      ),
      'Expected the narrower topology carrier shard.',
    );
    const narrowerVisibleLeg = required(
      narrowerChunk.geometry.patternLegs.find(
        (leg) =>
          leg.patternId === outboundId &&
          narrowerChunk.geometry.visiblePatternLegFragmentIds.includes(leg.id),
      ),
      'Expected the narrower visible Pattern-leg shard.',
    );

    expect(narrowerTopologyLeg).toEqual(topologyLeg);
    expect(narrowerTopologyCarrier).toEqual(topologyCarrier);
    expect(narrowerVisibleLeg.id).not.toBe(visibleLeg.id);
    expect(narrowerVisibleLeg.carrierRange).toEqual([0.4375, 0.5625]);
    expect(narrowerVisibleLeg.logicalPatternLegFragmentId).toBe(
      visibleLeg.logicalPatternLegFragmentId,
    );
    expect(narrowerVisibleLeg.logicalCarrierRange).toEqual(visibleLeg.logicalCarrierRange);
    expect(narrowerVisibleLeg.logicalAlignmentRange).toEqual(visibleLeg.logicalAlignmentRange);
  });

  it('keeps exact-anchor pieces from one Pattern leg logically distinct', async () => {
    const way = aRoad('split-carrier', [
      [-1, 0],
      [0, 0],
      [1, 0],
    ]);
    const service = aService('split-service', [
      {
        id: 'split-service',
        sections: [{ kind: 'shared', legs: [wholeLeg(way.id)] }],
      },
    ]);
    const system = aSystem({
      ways: [way],
      services: [service],
      stops: [aStop('split-call', [0, 0], { wayId: way.id, t: 0.5 })],
    });
    const { provider, descriptor } = await describedProvider(system);
    const result = await provider.resolve(descriptor.content, worldQuery);
    const chunk = result.chunks[0];
    const outboundId = required(
      chunk.entities.patterns.find((pattern) => pattern.direction?.key === 'outbound'),
      'Expected an outbound Pattern.',
    ).id;
    const visibleIds = new Set(chunk.geometry.visiblePatternLegFragmentIds);
    const pieces = chunk.geometry.patternLegs.filter(
      (fragment) => fragment.patternId === outboundId && visibleIds.has(fragment.id),
    );

    expect(pieces.map(({ legIndex }) => legIndex)).toEqual([0, 0]);
    expect(pieces.map(({ logicalCarrierRange }) => logicalCarrierRange)).toEqual([
      [0, 0.5],
      [0.5, 1],
    ]);
    expect(pieces.map(({ logicalAlignmentRange }) => logicalAlignmentRange)).toEqual([
      [0, 0.5],
      [0.5, 1],
    ]);
    expect(
      new Set(pieces.map(({ logicalPatternLegFragmentId }) => logicalPatternLegFragmentId)).size,
    ).toBe(2);
  });

  it('keeps simultaneous query shards under one logical Pattern leg piece', async () => {
    const way = aRoad('reentrant-carrier', [
      [-2, 0],
      [0, 0],
      [0, 2],
      [2, 2],
      [0, 0],
      [2, 0],
    ]);
    const service = aService('reentrant-service', [
      {
        id: 'reentrant-service',
        sections: [{ kind: 'shared', legs: [wholeLeg(way.id)] }],
      },
    ]);
    const system = aSystem({ ways: [way], services: [service] });
    const { provider, descriptor } = await describedProvider(system);
    const result = await provider.resolve(descriptor.content, {
      ...worldQuery,
      bounds: { kind: 'ordinary', west: -1, south: -0.5, east: 1, north: 0.5 },
    });
    const chunk = result.chunks[0];
    const outboundId = required(
      chunk.entities.patterns.find((pattern) => pattern.direction?.key === 'outbound'),
      'Expected an outbound Pattern.',
    ).id;
    const visibleIds = new Set(chunk.geometry.visiblePatternLegFragmentIds);
    const shards = chunk.geometry.patternLegs.filter(
      (fragment) => fragment.patternId === outboundId && visibleIds.has(fragment.id),
    );

    expect(shards).toHaveLength(2);
    expect(new Set(shards.map(({ id }) => id)).size).toBe(2);
    expect(new Set(shards.map(({ carrierRange }) => JSON.stringify(carrierRange))).size).toBe(2);
    expect(
      new Set(shards.map(({ logicalPatternLegFragmentId }) => logicalPatternLegFragmentId)).size,
    ).toBe(1);
    expect(shards.map(({ logicalCarrierRange }) => logicalCarrierRange)).toEqual([
      [0, 1],
      [0, 1],
    ]);
    expect(shards.map(({ logicalAlignmentRange }) => logicalAlignmentRange)).toEqual([
      [0, 1],
      [0, 1],
    ]);
    for (const shard of shards) expect(visibleIds.has(shard.id)).toBe(true);
  });
});
