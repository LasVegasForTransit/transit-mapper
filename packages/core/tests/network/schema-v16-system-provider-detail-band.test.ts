import { describe, expect, it } from 'vitest';
import { stretchLeg, wholeLeg } from '../../src/model/geo/servicePaths';
import type { TransitSystem, Way } from '../../src/model/system';
import type { DetailBand, NetworkQuery } from '../../src/network/query';
import type { ResolvedNetworkChunk } from '../../src/network/resolved-network-chunk';
import { createSchemaV16SystemProvider } from '../../src/network/schema-v16-system-provider';
import { aRoad, aService, aStation, aStop, aSystem } from '../support/fixtures.test';

const regionQuery: NetworkQuery = {
  serviceTime: { kind: 'live' },
  modes: { kind: 'all' },
  filters: {},
  bounds: { kind: 'ordinary', west: -2, south: -2, east: 2, north: 2 },
  detailBand: 'district',
};

function oneLaneProfile(laneId: string): Way['profile'] {
  return { lanes: [{ id: laneId, kindId: 'bus', widthM: 3.5, direction: 'forward' }] };
}

/** Two served Ways meeting at a junction, one unserved Way beside them, and
 *  every carriageway fact the mapper knows how to transfer. */
function aCorridorSystem(): TransitSystem {
  const incoming = aRoad(
    'incoming',
    [
      [-1, 0],
      [0, 0],
    ],
    { profile: oneLaneProfile('incoming-lane') },
  );
  const outgoing = aRoad(
    'outgoing',
    [
      [0, 0],
      [1, 0],
    ],
    { profile: oneLaneProfile('outgoing-lane') },
  );
  const sideStreet = aRoad('side-street', [
    [-1, 1],
    [1, 1],
  ]);
  const service = aService('service', [
    {
      id: 'service',
      sections: [{ kind: 'shared', legs: [wholeLeg(incoming.id), wholeLeg(outgoing.id)] }],
    },
  ]);
  return aSystem({
    ways: [incoming, outgoing, sideStreet],
    services: [service],
    lines: [{ id: 'line', name: 'Line', color: '#123456', serviceIds: [service.id] }],
    stops: [
      aStop('served-stop', [-0.5, 0], { wayId: incoming.id, t: 0.5 }),
      aStop('kerb-stop', [1.5, 1.5]),
    ],
    stations: [aStation('station', [1.6, 1.6])],
    nodes: [
      {
        id: 'junction',
        coord: [0, 0],
        refs: [
          { wayId: incoming.id, pointIndex: 1 },
          { wayId: outgoing.id, pointIndex: 0 },
        ],
        connectors: [
          {
            from: { wayId: incoming.id, laneId: 'incoming-lane' },
            to: { wayId: outgoing.id, laneId: 'outgoing-lane' },
          },
        ],
      },
    ],
    namedWays: [{ id: 'corridor', name: 'Main Street', wayIds: [incoming.id, outgoing.id] }],
    medians: { corridor: { widthM: 2, kindId: 'raised' } },
    approachControls: { 'incoming:end': { control: 'stop' } },
    turnRestrictions: { 'incoming:incoming-lane': { allowedTargets: [] } },
  });
}

async function resolveBands(
  system: TransitSystem,
  query: NetworkQuery = regionQuery,
): Promise<Record<DetailBand, ResolvedNetworkChunk>> {
  const provider = createSchemaV16SystemProvider(system);
  const descriptor = await provider.describe({
    kind: 'transit-system',
    id: system.id,
    revision: { kind: 'latest' },
  });
  const bands = ['overview', 'district', 'street'] as const;
  const chunks = await Promise.all(
    bands.map(async (detailBand) => {
      const result = await provider.resolve(descriptor.content, { ...query, detailBand });
      return [detailBand, result.chunks[0]] as const;
    }),
  );
  return Object.fromEntries(chunks) as Record<DetailBand, ResolvedNetworkChunk>;
}

function ids(records: readonly { id: string }[]): string[] {
  return records.map(({ id }) => id).sort();
}

describe('schema-v16 system detail band', () => {
  it('shows the same Lines, ServicePlans and Patterns at every band', async () => {
    const bands = await resolveBands(aCorridorSystem());

    expect(ids(bands.overview.entities.lines)).toEqual(['line']);
    expect(ids(bands.overview.entities.lines)).toEqual(ids(bands.district.entities.lines));
    expect(ids(bands.overview.entities.lines)).toEqual(ids(bands.street.entities.lines));
    expect(ids(bands.overview.entities.servicePlans)).toEqual(
      ids(bands.district.entities.servicePlans),
    );
    expect(ids(bands.overview.entities.patterns)).toEqual(ids(bands.district.entities.patterns));
    expect(bands.overview.relationships.lineServicePlans).toEqual(
      bands.district.relationships.lineServicePlans,
    );
  });

  it('paints the same Line geometry at overview as at street', async () => {
    const bands = await resolveBands(aCorridorSystem());

    expect(bands.overview.geometry.visiblePatternLegFragmentIds.length).toBeGreaterThan(0);
    expect(ids(bands.overview.geometry.patternLegs)).toEqual(
      ids(bands.street.geometry.patternLegs),
    );
    expect([...bands.overview.geometry.visiblePatternLegFragmentIds].sort()).toEqual(
      [...bands.street.geometry.visiblePatternLegFragmentIds].sort(),
    );
    expect(bands.overview.relationships.topologyWindows).toEqual(
      bands.street.relationships.topologyWindows,
    );
    expect(bands.overview.relationships.patternStopCalls).toEqual(
      bands.street.relationships.patternStopCalls,
    );
  });

  it('drops Ways at overview that carry no selected Pattern and keeps the ones that do', async () => {
    const bands = await resolveBands(aCorridorSystem());

    expect(ids(bands.overview.entities.ways)).toEqual(['incoming', 'outgoing']);
    expect(ids(bands.district.entities.ways)).toEqual(['incoming', 'outgoing', 'side-street']);
    expect(ids(bands.street.entities.ways)).toEqual(ids(bands.district.entities.ways));
  });

  it('leaves no carrier at overview whose Alignment the chunk dropped', async () => {
    const bands = await resolveBands(aCorridorSystem());
    const alignmentIds = new Set(bands.overview.entities.alignments.map(({ id }) => id));
    const referenced = new Set(
      bands.overview.geometry.patternLegs.map(({ carrierFragmentId }) => carrierFragmentId),
    );

    expect(bands.overview.geometry.carriers.length).toBeGreaterThan(0);
    expect(bands.overview.geometry.carriers.every(({ id }) => referenced.has(id))).toBe(true);
    expect(
      bands.overview.geometry.carriers.every((carrier) => alignmentIds.has(carrier.alignmentId)),
    ).toBe(true);
    expect(bands.district.geometry.carriers.some(({ id }) => !referenced.has(id))).toBe(true);
  });

  it('carries every Stop and Station at overview that district carries', async () => {
    const bands = await resolveBands(aCorridorSystem());

    expect(ids(bands.overview.entities.stops)).toEqual(['kerb-stop', 'served-stop']);
    expect(ids(bands.overview.entities.stops)).toEqual(ids(bands.district.entities.stops));
    expect(ids(bands.overview.entities.stations)).toEqual(ids(bands.district.entities.stations));
  });

  it('carries lane connectors, turn restrictions, approach controls and medians only at street', async () => {
    const bands = await resolveBands(aCorridorSystem());

    for (const band of ['overview', 'district'] as const) {
      expect(bands[band].infrastructure.laneConnectors).toEqual([]);
      expect(bands[band].infrastructure.turnRestrictions).toEqual([]);
      expect(bands[band].infrastructure.approachControls).toEqual([]);
      expect(bands[band].infrastructure.medians).toEqual([]);
    }
    expect(bands.street.infrastructure.laneConnectors.length).toBeGreaterThan(0);
    expect(bands.street.infrastructure.turnRestrictions.length).toBeGreaterThan(0);
    expect(bands.street.infrastructure.approachControls.length).toBeGreaterThan(0);
    expect(bands.street.infrastructure.medians.length).toBeGreaterThan(0);
  });

  it('drops Nodes at overview and keeps them from district upward', async () => {
    const bands = await resolveBands(aCorridorSystem());

    expect(bands.overview.infrastructure.nodes).toEqual([]);
    expect(ids(bands.district.infrastructure.nodes)).toEqual(['junction']);
    expect(ids(bands.street.infrastructure.nodes)).toEqual(['junction']);
  });

  it('keeps the same-Line carrier closure whole at overview without authorizing paint', async () => {
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
    const system = aSystem({
      ways: [shared, branch],
      services: [full, short],
      lines: [{ id: 'line', name: 'Line', color: '#123456', serviceIds: [full.id, short.id] }],
    });
    const bands = await resolveBands(system, {
      ...regionQuery,
      bounds: { kind: 'ordinary', west: -1, south: -1, east: 1, north: 1 },
    });
    const shortPatternIds = new Set(
      bands.overview.relationships.servicePlanPatterns
        .filter(({ servicePlanId }) => servicePlanId === short.id)
        .map(({ patternId }) => patternId),
    );
    const closureFragments = (chunk: ResolvedNetworkChunk) =>
      ids(chunk.geometry.patternLegs.filter(({ patternId }) => shortPatternIds.has(patternId)));

    expect(shortPatternIds.size).toBe(2);
    expect(closureFragments(bands.overview).length).toBeGreaterThan(0);
    expect(closureFragments(bands.overview)).toEqual(closureFragments(bands.district));
    expect(
      bands.overview.geometry.visiblePatternLegFragmentIds.some((id) =>
        closureFragments(bands.overview).includes(id),
      ),
    ).toBe(false);
  });
});
