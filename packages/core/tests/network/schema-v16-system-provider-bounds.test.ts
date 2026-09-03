import { describe, expect, it } from 'vitest';
import type { TransitSystem } from '../../src/model/system';
import type { NetworkQuery } from '../../src/network/query';
import { createSchemaV16SystemProvider } from '../../src/network/schema-v16-system-provider';
import { aRoad, aSystem } from '../support/fixtures.test';

const query: NetworkQuery = {
  serviceTime: { kind: 'live' },
  modes: { kind: 'all' },
  filters: {},
  bounds: { kind: 'ordinary', west: -0.5, south: -0.5, east: 0.5, north: 0.5 },
  detailBand: 'district',
};

async function resolveSystem(system: TransitSystem, networkQuery: NetworkQuery = query) {
  const provider = createSchemaV16SystemProvider(system);
  const descriptor = await provider.describe({
    kind: 'transit-system',
    id: system.id,
    revision: { kind: 'latest' },
  });
  return provider.resolve(descriptor.content, networkQuery);
}

describe('schema-v16 system bounded carrier provider', () => {
  it('transfers clipped physical carriers without Service membership', async () => {
    const inside = aRoad('inside', [
      [-2, 0],
      [2, 0],
    ]);
    const outside = aRoad('outside', [
      [2, 2],
      [3, 3],
    ]);
    const result = await resolveSystem(aSystem({ ways: [inside, outside] }));
    const chunk = result.chunks[0];

    expect(chunk.entities.alignments).toEqual([{ id: inside.id }]);
    expect(chunk.entities.ways.map(({ id }) => id)).toEqual([inside.id]);
    expect(chunk.entities.servicePlans).toEqual([]);
    expect(chunk.entities.patterns).toEqual([]);
    expect(chunk.geometry.carriers).toEqual([
      expect.objectContaining({
        carrier: { kind: 'way', id: inside.id },
        alignmentRange: [0.375, 0.625],
        points: [
          [-0.5, 0],
          [0.5, 0],
        ],
      }),
    ]);
    expect(chunk.geometry.visiblePatternLegFragmentIds).toEqual([]);
  });

  it('clips curved carriers from the resolved physical path', async () => {
    const curve = aRoad(
      'curve',
      [
        [0, 0],
        [0.001, 0.001],
        [0.002, 0],
      ],
      {
        geometry: 'curved',
        curveControls: [{ pointIndex: 1, radiusM: 40 }],
      },
    );
    const bounds = {
      kind: 'ordinary',
      west: 0.00095,
      south: 0.00084,
      east: 0.00105,
      north: 0.00086,
    } as const;
    const result = await resolveSystem(aSystem({ ways: [curve] }), { ...query, bounds });
    const carriers = result.chunks[0].geometry.carriers.filter(
      ({ carrier }) => carrier.kind === 'way' && carrier.id === curve.id,
    );

    expect(carriers).toHaveLength(1);
    expect(carriers[0]).toMatchObject({
      carrier: { kind: 'way', id: curve.id },
      geometry: 'freeform',
      curveControls: [],
    });
    expect(carriers[0]?.alignmentRange[0]).toBeGreaterThan(0);
    expect(carriers[0]?.alignmentRange[1]).toBeLessThan(1);
    for (const [longitude, latitude] of carriers[0]?.points ?? []) {
      expect(longitude).toBeGreaterThanOrEqual(bounds.west);
      expect(longitude).toBeLessThanOrEqual(bounds.east);
      expect(latitude).toBeGreaterThanOrEqual(bounds.south);
      expect(latitude).toBeLessThanOrEqual(bounds.north);
    }
  });

  it('keeps antimeridian carrier records byte-stable across equivalent bounds', async () => {
    const meridian = aRoad('meridian', [
      [180, -1],
      [180, 1],
    ]);
    const system = aSystem({ ways: [meridian] });
    const crossing = await resolveSystem(system, {
      ...query,
      bounds: {
        kind: 'crosses-antimeridian',
        west: 179,
        south: -0.5,
        east: -179,
        north: 0.5,
      },
    });
    const eastSide = await resolveSystem(system, {
      ...query,
      bounds: { kind: 'ordinary', west: 179, south: -0.5, east: 180, north: 0.5 },
    });
    const crossingCarrier = crossing.chunks[0].geometry.carriers[0];
    const eastSideCarrier = eastSide.chunks[0].geometry.carriers[0];

    expect(crossingCarrier.id).toBe(eastSideCarrier.id);
    expect(crossingCarrier).toEqual(eastSideCarrier);
    expect(crossingCarrier.points).toEqual([
      [-180, -0.5],
      [-180, 0.5],
    ]);
  });
});
