import { describe, expect, it } from 'vitest';
import type { NetworkQuery } from '../../../src/network/query';
import type { TransitSystem } from '../../../src/transit/authored-system';
import { migrateSchemaV16System } from '../../../src/model/schema-v17-system/migrate-v16';
import {
  createSchemaV17SystemProvider,
  SchemaV17SystemProviderError,
} from '../../../src/network/schema-v17-system-provider';
import { aPattern, aRoad, aService, aStop, aSystem } from '../../support/fixtures.test';

function v17System(): TransitSystem {
  const way = aRoad('provider-way', [
    [-115.2, 36.14],
    [-115.16, 36.14],
  ]);
  const result = migrateSchemaV16System(
    aSystem({
      ways: [way],
      stops: [aStop('provider-stop', [-115.18, 36.14], { wayId: way.id, t: 0.5 })],
      services: [aService('provider-plan', [aPattern('provider-pattern', [way], [way.id])])],
    }),
  );
  if (result.kind !== 'migrated') throw new Error('Provider fixture did not migrate.');
  return result.system;
}

function query(overrides: Partial<NetworkQuery> = {}): NetworkQuery {
  return {
    bounds: { kind: 'ordinary', west: -116, south: 35.5, east: -114, north: 36.9 },
    detailBand: 'district',
    modes: { kind: 'all' },
    filters: {},
    ...overrides,
  } as NetworkQuery;
}

describe('schema-v17 system provider', () => {
  it('describes the latest revision of its own document', async () => {
    const system = v17System();
    const provider = createSchemaV17SystemProvider(system);
    const descriptor = await provider.describe({
      kind: 'transit-system',
      id: system.id,
      revision: { kind: 'latest' },
    });

    expect(descriptor.content.kind).toBe('transit-system');
    expect(descriptor.map.representationIds).toContain('network');
  });

  it('refuses a pinned revision it cannot honour', async () => {
    const system = v17System();
    const provider = createSchemaV17SystemProvider(system);

    await expect(
      provider.describe({
        kind: 'transit-system',
        id: system.id,
        revision: { kind: 'pinned', systemRevisionId: 'rev-1' },
      }),
    ).rejects.toThrow(SchemaV17SystemProviderError);
  });

  it('resolves one bounded page whose visible legs authorise paint', async () => {
    const system = v17System();
    const provider = createSchemaV17SystemProvider(system);
    const descriptor = await provider.describe({
      kind: 'transit-system',
      id: system.id,
      revision: { kind: 'latest' },
    });
    const result = await provider.resolve(descriptor.content, query());

    expect(result.chunks).toHaveLength(1);
    const chunk = result.chunks[0];
    expect(chunk.geometry.visiblePatternLegFragmentIds.length).toBeGreaterThan(0);
    const emitted = new Set(chunk.geometry.patternLegs.map((leg) => leg.id));
    for (const id of chunk.geometry.visiblePatternLegFragmentIds) {
      expect(emitted.has(id)).toBe(true);
    }
  });

  it('emits no visible geometry for a viewport the system never reaches', async () => {
    const system = v17System();
    const provider = createSchemaV17SystemProvider(system);
    const descriptor = await provider.describe({
      kind: 'transit-system',
      id: system.id,
      revision: { kind: 'latest' },
    });
    const result = await provider.resolve(
      descriptor.content,
      query({ bounds: { kind: 'ordinary', west: 10, south: 50, east: 11, north: 51 } }),
    );

    expect(result.chunks[0].geometry.visiblePatternLegFragmentIds).toHaveLength(0);
  });

  it('rejects a cursor it does not page with', async () => {
    const system = v17System();
    const provider = createSchemaV17SystemProvider(system);
    const descriptor = await provider.describe({
      kind: 'transit-system',
      id: system.id,
      revision: { kind: 'latest' },
    });

    await expect(provider.resolve(descriptor.content, query({ cursor: 'page-2' }))).rejects.toThrow(
      /does not accept cursors/,
    );
  });

  it('does not observe a mutation made to the caller-supplied document', async () => {
    const system = v17System();
    const provider = createSchemaV17SystemProvider(system);
    system.lines.length = 0;

    const descriptor = await provider.describe({
      kind: 'transit-system',
      id: system.id,
      revision: { kind: 'latest' },
    });
    const result = await provider.resolve(descriptor.content, query());

    expect(result.lineOrder.length).toBeGreaterThan(0);
  });

  it('carries the optional entity fields a document does supply', async () => {
    const base = v17System();
    const system: TransitSystem = {
      ...base,
      lines: base.lines.map((line) => ({ ...line, name: 'Red Line', color: '#e4572e' })),
      servicePlans: base.servicePlans.map((plan) => ({
        ...plan,
        name: 'Weekday',
        vehicleKindId: 'lrv-1',
      })),
      stops: base.stops.map((stop) => ({ ...stop, name: 'Downtown', majorStop: true })),
      ways: base.ways.map((way) => ({ ...way, classId: 'arterial' })),
    };
    const provider = createSchemaV17SystemProvider(system);
    const descriptor = await provider.describe({
      kind: 'transit-system',
      id: system.id,
      revision: { kind: 'latest' },
    });
    const chunk = (await provider.resolve(descriptor.content, query())).chunks[0];

    expect(chunk.entities.lines[0]).toMatchObject({ name: 'Red Line', color: '#e4572e' });
    expect(chunk.entities.servicePlans[0]).toMatchObject({
      name: 'Weekday',
      vehicleKindId: 'lrv-1',
      mode: { kind: 'known' },
    });
    expect(chunk.entities.stops[0]).toMatchObject({ name: 'Downtown', major: true });
    expect(chunk.entities.ways[0]).toMatchObject({ classId: 'arterial' });
  });

  it('links Lines to plans and plans to patterns with stable identities', async () => {
    const system = v17System();
    const provider = createSchemaV17SystemProvider(system);
    const descriptor = await provider.describe({
      kind: 'transit-system',
      id: system.id,
      revision: { kind: 'latest' },
    });
    const chunk = (await provider.resolve(descriptor.content, query())).chunks[0];

    const planIds = new Set(chunk.entities.servicePlans.map(({ id }) => id));
    for (const link of chunk.relationships.lineServicePlans) {
      expect(planIds.has(link.servicePlanId)).toBe(true);
      expect(link.id).toContain('v17:');
    }
    const patternIds = new Set(chunk.entities.patterns.map(({ id }) => id));
    for (const link of chunk.relationships.servicePlanPatterns) {
      expect(patternIds.has(link.patternId)).toBe(true);
    }
  });

  it('excludes a mode the query filtered out', async () => {
    const system = v17System();
    const provider = createSchemaV17SystemProvider(system);
    const descriptor = await provider.describe({
      kind: 'transit-system',
      id: system.id,
      revision: { kind: 'latest' },
    });
    const present = system.servicePlans[0].modeId;

    const included = (
      await provider.resolve(descriptor.content, query({ modes: { kind: 'only', ids: [present] } }))
    ).chunks[0];
    const excluded = (
      await provider.resolve(
        descriptor.content,
        query({ modes: { kind: 'only', ids: ['a-mode-nothing-runs'] } }),
      )
    ).chunks[0];

    expect(included.geometry.visiblePatternLegFragmentIds.length).toBeGreaterThan(0);
    // Excluding the only mode must remove its transit geometry, not merely
    // hide it: the closure would otherwise still seed carriers through a Line
    // the two share. The street network is band-driven, not mode-driven, so it
    // is deliberately not asserted away here.
    expect(excluded.geometry.visiblePatternLegFragmentIds).toHaveLength(0);
    expect(excluded.entities.patterns).toHaveLength(0);
    expect(excluded.geometry.patternLegs).toHaveLength(0);
  });

  it('carries the street network only above the overview band', async () => {
    const base = v17System();
    // A Way in the bounds that carries no Pattern: street network, not transit.
    const extraAlignment = {
      id: 'plain-alignment',
      points: [
        [-115.19, 36.16],
        [-115.17, 36.16],
      ] as [number, number][],
      geometry: 'straight' as const,
    };
    const system: TransitSystem = {
      ...base,
      alignments: [...base.alignments, extraAlignment],
      ways: [...base.ways, { ...base.ways[0], id: 'plain-way', alignmentId: extraAlignment.id }],
    };
    const provider = createSchemaV17SystemProvider(system);
    const descriptor = await provider.describe({
      kind: 'transit-system',
      id: system.id,
      revision: { kind: 'latest' },
    });

    const overview = (await provider.resolve(descriptor.content, query({ detailBand: 'overview' })))
      .chunks[0];
    const district = (await provider.resolve(descriptor.content, query({ detailBand: 'district' })))
      .chunks[0];

    const carries = (chunk: typeof overview) =>
      chunk.entities.ways.some((way) => way.id === 'plain-way');
    expect(carries(overview)).toBe(false);
    expect(carries(district)).toBe(true);
    // The band narrows physical detail only: the transit facts are identical.
    expect(district.entities.patterns).toEqual(overview.entities.patterns);
    expect(district.geometry.visiblePatternLegFragmentIds).toEqual(
      overview.geometry.visiblePatternLegFragmentIds,
    );
  });

  it('refuses a resolved reference whose digest no longer matches', async () => {
    const system = v17System();
    const provider = createSchemaV17SystemProvider(system);
    const descriptor = await provider.describe({
      kind: 'transit-system',
      id: system.id,
      revision: { kind: 'latest' },
    });
    if (descriptor.content.kind !== 'transit-system') throw new Error('Expected a system.');

    await expect(
      provider.resolve(
        {
          kind: 'transit-system',
          id: descriptor.content.id,
          revision: {
            kind: 'working',
            contentDigest: { algorithm: 'sha-256', value: 'c'.repeat(64) },
          },
        },
        query(),
      ),
    ).rejects.toThrow(/no longer matches/);
  });
});
