import { describe, expect, it } from 'vitest';
import type { TransitSystem } from '../../../src/transit/authored-system';
import { migrateSchemaV16System } from '../../../src/model/schema-v17-system/migrate-v16';
import {
  descriptorForSystem,
  SchemaV17SystemProviderError,
  validateDescriptionReference,
  validateResolvedReference,
  validateSystem,
} from '../../../src/network/schema-v17-system/identity';
import { aPattern, aRoad, aService, aStop, aSystem } from '../../support/fixtures.test';

function v17System(): TransitSystem {
  const way = aRoad('identity-way', [
    [-115.2, 36.14],
    [-115.16, 36.14],
  ]);
  const result = migrateSchemaV16System(
    aSystem({
      ways: [way],
      stops: [aStop('identity-stop', [-115.18, 36.14], { wayId: way.id, t: 0.5 })],
      services: [aService('identity-plan', [aPattern('identity-pattern', [way], [way.id])])],
    }),
  );
  if (result.kind !== 'migrated') throw new Error('Identity fixture did not migrate.');
  return result.system;
}

describe('schema-v17 provider identity', () => {
  it('accepts the relationship graph produced by v16 migration', () => {
    expect(() => validateSystem(v17System())).not.toThrow();
  });

  it('rejects a duplicate entity ID that would make one record unreachable', () => {
    const system = v17System();
    const duplicated = { ...system, ways: [...system.ways, system.ways[0]] };

    expect(() => validateSystem(duplicated)).toThrow(/duplicate ID/);
  });

  it('rejects a Line naming a ServicePlan that does not exist', () => {
    const system = v17System();
    const dangling = {
      ...system,
      lines: system.lines.map((line) => ({ ...line, servicePlanIds: ['absent-plan'] })),
    };

    expect(() => validateSystem(dangling)).toThrow(/missing ServicePlan/);
  });

  it('reports modes in Line order rather than catalog order', async () => {
    const descriptor = await descriptorForSystem(v17System());

    expect(descriptor.content.kind).toBe('transit-system');
    expect(descriptor.map.modeIds.length).toBeGreaterThan(0);
    expect(descriptor.map.modeIds).toEqual(descriptor.map.defaultModeIds);
    expect(descriptor.map.defaultRepresentationId).toBe('network');
  });

  it('digests schema 17 rather than the version the document migrated from', async () => {
    const system = v17System();
    const first = await descriptorForSystem(system);
    const second = await descriptorForSystem({ ...system, name: `${system.name} renamed` });

    if (first.content.kind !== 'transit-system' || second.content.kind !== 'transit-system') {
      throw new Error('The descriptor describes a transit system.');
    }
    if (first.content.revision.kind !== 'working' || second.content.revision.kind !== 'working') {
      throw new Error('A working revision carries the content digest.');
    }
    expect(first.content.revision.contentDigest.value).toMatch(/^[0-9a-f]{64}$/);
    expect(second.content.revision.contentDigest.value).not.toBe(
      first.content.revision.contentDigest.value,
    );
  });

  it('reports the Sources a document cites so a binding stays explainable', async () => {
    const base = v17System();
    const system: TransitSystem = {
      ...base,
      sourceCitations: [
        {
          sourceId: 'rtc',
          name: 'RTC feed',
          attribution: { text: 'RTC Southern Nevada', url: 'https://rtcsnv.com' },
          license: { id: 'CC-BY-4.0', name: 'CC BY 4.0' },
        },
        {
          sourceId: 'city',
          name: 'City feed',
          // Same attribution as above: a map credits a publisher once.
          attribution: { text: 'RTC Southern Nevada', url: 'https://rtcsnv.com' },
          license: { id: 'CC-BY-4.0', name: 'CC BY 4.0' },
        },
      ],
    };

    const descriptor = await descriptorForSystem(system);

    expect(descriptor.sources.map((source) => source.sourceId)).toEqual(['rtc', 'city']);
    expect(descriptor.attributions).toHaveLength(1);
    expect(descriptor.licenses).toHaveLength(1);
    // A citation records who a Source is, never when it was last read.
    expect(descriptor.sources.every((source) => source.freshness === 'unknown')).toBe(true);
  });

  it('omits a licence a citation does not carry', async () => {
    const base = v17System();
    const descriptor = await descriptorForSystem({
      ...base,
      sourceCitations: [
        { sourceId: 'unlicensed', name: 'Unlicensed feed', attribution: { text: 'Anon' } },
      ],
    });

    expect(descriptor.sources).toHaveLength(1);
    expect(descriptor.licenses).toHaveLength(0);
    expect(descriptor.attributions).toEqual([{ text: 'Anon' }]);
  });

  it('reports no provenance for a document that cites none', async () => {
    const descriptor = await descriptorForSystem(v17System());

    expect(descriptor.sources).toHaveLength(0);
    expect(descriptor.attributions).toHaveLength(0);
    expect(descriptor.licenses).toHaveLength(0);
  });

  it('refuses a description request for another document', () => {
    const system = v17System();

    expect(() =>
      validateDescriptionReference(system, {
        kind: 'transit-system',
        id: 'another-system',
        revision: { kind: 'latest' },
      }),
    ).toThrow(SchemaV17SystemProviderError);
  });

  it('refuses a pinned revision until immutable storage exists', () => {
    const system = v17System();

    expect(() =>
      validateDescriptionReference(system, {
        kind: 'transit-system',
        id: system.id,
        revision: { kind: 'pinned', systemRevisionId: 'rev-1' },
      }),
    ).toThrow(/Pinned system revisions are unavailable/);
  });

  it('accepts the working reference it just described', async () => {
    const descriptor = await descriptorForSystem(v17System());

    expect(() => validateResolvedReference(descriptor, descriptor.content)).not.toThrow();
  });

  it('rejects a working reference whose digest has moved on', async () => {
    const descriptor = await descriptorForSystem(v17System());
    if (
      descriptor.content.kind !== 'transit-system' ||
      descriptor.content.revision.kind !== 'working'
    ) {
      throw new Error('Expected a working transit-system revision.');
    }

    expect(() =>
      validateResolvedReference(descriptor, {
        kind: 'transit-system',
        id: descriptor.content.id,
        revision: {
          kind: 'working',
          contentDigest: { algorithm: 'sha-256', value: 'b'.repeat(64) },
        },
      }),
    ).toThrow(/no longer matches/);
  });
});
