import { describe, expect, it } from 'vitest';
import { stretchLeg, wholeLeg } from '../../src/model/geo/servicePaths';
import type { NetworkQuery } from '../../src/network/query';
import type { ResolvedNetworkChunk } from '../../src/network/resolved-network-chunk';
import { createSchemaV16SystemProvider } from '../../src/network/schema-v16-system-provider';
import { aRoad, aService, aSystem } from '../support/fixtures.test';

const worldQuery: NetworkQuery = {
  serviceTime: { kind: 'live' },
  modes: { kind: 'all' },
  filters: {},
  bounds: { kind: 'ordinary', west: -180, south: -90, east: 180, north: 90 },
  detailBand: 'district',
};

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

function patternIdsForService(chunk: ResolvedNetworkChunk, servicePlanId: string): Set<string> {
  return new Set(
    chunk.relationships.servicePlanPatterns
      .filter((relationship) => relationship.servicePlanId === servicePlanId)
      .map(({ patternId }) => patternId),
  );
}

function semanticCarrierLegs(chunk: ResolvedNetworkChunk, servicePlanId: string, wayId: string) {
  const patternIds = patternIdsForService(chunk, servicePlanId);
  const patternDirectionById = new Map(
    chunk.entities.patterns.map((pattern) => [pattern.id, pattern.direction?.key]),
  );
  const carrierById = new Map(chunk.geometry.carriers.map((carrier) => [carrier.id, carrier]));
  return chunk.geometry.patternLegs
    .flatMap((fragment) => {
      const carrier = carrierById.get(fragment.carrierFragmentId)?.carrier;
      if (!patternIds.has(fragment.patternId) || carrier?.id !== wayId) return [];
      return [
        {
          patternDirection: patternDirectionById.get(fragment.patternId),
          carrier,
          logicalCarrierRange: fragment.logicalCarrierRange,
          logicalAlignmentRange: fragment.logicalAlignmentRange,
          direction: fragment.direction,
        },
      ];
    })
    .sort((left, right) =>
      (left.patternDirection ?? '').localeCompare(right.patternDirection ?? ''),
    );
}

function visibleCarrierGeometry(chunk: ResolvedNetworkChunk, servicePlanId: string) {
  const patternIds = patternIdsForService(chunk, servicePlanId);
  const visibleIds = new Set(chunk.geometry.visiblePatternLegFragmentIds);
  const carrierById = new Map(chunk.geometry.carriers.map((carrier) => [carrier.id, carrier]));
  return chunk.geometry.patternLegs
    .filter((fragment) => patternIds.has(fragment.patternId) && visibleIds.has(fragment.id))
    .map((fragment) => {
      const carrier = required(
        carrierById.get(fragment.carrierFragmentId),
        'Expected visible carrier geometry.',
      );
      return { carrierRange: fragment.carrierRange, points: carrier.points };
    });
}

describe('schema-v16 system same-Line carrier closure', () => {
  it('returns same-Line semantic carrier closure without authorizing offscreen paint', async () => {
    const shared = aRoad('shared', [
      [-4, 0],
      [4, 0],
    ]);
    const branch = aRoad('branch', [
      [-4, 0.5],
      [4, 0.5],
    ]);
    const full = aService('full', [
      { id: 'full', sections: [{ kind: 'shared', legs: [wholeLeg(shared.id)] }] },
    ]);
    const short = aService('short', [
      {
        id: 'short',
        sections: [
          {
            kind: 'shared',
            legs: [
              stretchLeg(wholeLeg(shared.id), 0, 0.25),
              stretchLeg(wholeLeg(branch.id), 0, 0.25),
            ],
          },
        ],
      },
    ]);
    const otherLineShort = aService('other-line-short', [
      {
        id: 'other-line-short',
        sections: [{ kind: 'shared', legs: [stretchLeg(wholeLeg(shared.id), 0, 0.25)] }],
      },
    ]);
    const excludedSameLine = aService(
      'excluded-same-line',
      [
        {
          id: 'excluded-same-line',
          sections: [{ kind: 'shared', legs: [wholeLeg(shared.id)] }],
        },
      ],
      { modeId: 'rail' },
    );
    const system = aSystem({
      ways: [shared, branch],
      services: [full, short, otherLineShort, excludedSameLine],
      lines: [
        {
          id: 'line',
          name: 'Line',
          color: '#123456',
          serviceIds: [full.id, short.id, excludedSameLine.id],
        },
        {
          id: 'other-line',
          name: 'Other line',
          color: '#654321',
          serviceIds: [otherLineShort.id],
        },
      ],
    });
    const provider = createSchemaV16SystemProvider(system);
    const descriptor = await provider.describe({
      kind: 'transit-system',
      id: system.id,
      revision: { kind: 'latest' },
    });
    const resolve = (west: number, east: number) =>
      provider.resolve(descriptor.content, {
        ...worldQuery,
        modes: { kind: 'only' as const, ids: ['bus'] },
        bounds: { kind: 'ordinary' as const, west, south: -1, east, north: 1 },
      });
    const result = await resolve(-1, 1);
    const chunk = result.chunks[0];
    const shortPatternIds = patternIdsForService(chunk, short.id);
    const carrierById = new Map(chunk.geometry.carriers.map((carrier) => [carrier.id, carrier]));
    const shortSharedLegs = semanticCarrierLegs(chunk, short.id, shared.id);

    expect(chunk.entities.servicePlans.map(({ id }) => id)).toContain(short.id);
    expect(shortPatternIds.size).toBe(2);
    expect(shortSharedLegs).toHaveLength(2);
    expect(shortSharedLegs.map(({ patternDirection }) => patternDirection)).toEqual([
      'inbound',
      'outbound',
    ]);
    expect(shortSharedLegs.map(({ logicalCarrierRange }) => logicalCarrierRange)).toEqual([
      [0, 0.25],
      [0, 0.25],
    ]);
    expect(
      chunk.geometry.patternLegs
        .filter((fragment) => shortPatternIds.has(fragment.patternId))
        .every(({ id }) => !chunk.geometry.visiblePatternLegFragmentIds.includes(id)),
    ).toBe(true);
    expect(
      chunk.geometry.patternLegs.some((fragment) => {
        const carrier = carrierById.get(fragment.carrierFragmentId)?.carrier;
        return shortPatternIds.has(fragment.patternId) && carrier?.id === branch.id;
      }),
    ).toBe(false);
    expect(chunk.entities.servicePlans.map(({ id }) => id)).not.toContain(otherLineShort.id);
    expect(chunk.entities.servicePlans.map(({ id }) => id)).not.toContain(excludedSameLine.id);
    expect(
      chunk.relationships.servicePlanPatterns.some(
        ({ servicePlanId }) => servicePlanId === excludedSameLine.id,
      ),
    ).toBe(false);

    const narrower = await resolve(-0.5, 0.5);
    const narrowerChunk = narrower.chunks[0];
    expect(semanticCarrierLegs(narrowerChunk, short.id, shared.id)).toEqual(shortSharedLegs);
    expect(visibleCarrierGeometry(narrowerChunk, full.id)).not.toEqual(
      visibleCarrierGeometry(chunk, full.id),
    );
  });
});
