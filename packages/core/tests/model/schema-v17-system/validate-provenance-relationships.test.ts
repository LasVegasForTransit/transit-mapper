import { describe, expect, it } from 'vitest';
import type {
  ImportHistoryEntry,
  SourceBinding,
  TransitSystem,
} from '../../../src/transit/authored-system';
import type { SourceCitation } from '../../../src/source/source-reference';
import { migrateSchemaV16System } from '../../../src/model/schema-v17-system/migrate-v16';
import {
  assertSourceBindingBaseline,
  recomputeSourceBindingBaseline,
  validateAuthoredProvenanceRelationships,
} from '../../../src/model/schema-v17-system/validate-provenance-relationships';
import { aPattern, aRoad, aService, aStop, aSystem } from '../../support/fixtures.test';

const DIGEST = 'a'.repeat(64);

function boundSystem(): TransitSystem {
  const way = aRoad('bound-way', [
    [-115.2, 36.14],
    [-115.16, 36.14],
  ]);
  const result = migrateSchemaV16System(
    aSystem({
      ways: [way],
      stops: [aStop('bound-stop', [-115.18, 36.14], { wayId: way.id, t: 0.5 })],
      services: [aService('bound-plan', [aPattern('bound-pattern', [way], [way.id])])],
    }),
  );
  if (result.kind !== 'migrated') throw new Error('Provenance fixture did not migrate.');
  return result.system;
}

function citation(sourceId: string): SourceCitation {
  return { sourceId, name: `${sourceId} feed`, attribution: { text: 'Agency' } };
}

function binding(overrides: Partial<SourceBinding> = {}): SourceBinding {
  return {
    external: { sourceId: 'rtc', kind: 'route', id: 'r-1' },
    target: { kind: 'way', id: 'bound-way' },
    lastAppliedRevisionId: 'rev-1',
    baseline: {
      sourceHash: DIGEST,
      targetHash: DIGEST,
      schemaVersion: '17',
      normalizerVersion: 'reviewed-import-v1',
    },
    ...overrides,
  };
}

function managedImport(id: string, datasetRevisionId: string): ImportHistoryEntry {
  return {
    id,
    importedAt: '2026-09-02T00:00:00.000Z',
    origin: { kind: 'managed-dataset', datasetRevisionId },
  };
}

function oneTimeUpload(id: string): ImportHistoryEntry {
  return {
    id,
    importedAt: '2026-09-02T00:00:00.000Z',
    origin: {
      kind: 'one-time-upload',
      artifactDigest: { algorithm: 'sha-256', value: DIGEST },
      mediaType: 'application/zip',
    },
  };
}

function bound(
  bindings: readonly SourceBinding[],
  extra: Partial<TransitSystem> = {},
): TransitSystem {
  return {
    ...boundSystem(),
    sourceCitations: [citation('rtc')],
    sourceBindings: [...bindings],
    importHistory: [managedImport('import-1', 'rev-1')],
    ...extra,
  };
}

describe('schema-v17 provenance relationships', () => {
  it('accepts a document binding two Sources to two different targets', () => {
    const system = bound(
      [
        binding(),
        binding({
          external: { sourceId: 'agency', kind: 'stop', id: 's-1' },
          target: { kind: 'stop', id: 'bound-stop' },
        }),
      ],
      { sourceCitations: [citation('rtc'), citation('agency')] },
    );

    expect(() => validateAuthoredProvenanceRelationships(system)).not.toThrow();
  });

  it('rejects a binding whose target does not exist', () => {
    const system = bound([binding({ target: { kind: 'way', id: 'absent-way' } })]);

    expect(() => validateAuthoredProvenanceRelationships(system)).toThrow(/does not exist/);
  });

  it('rejects a binding onto a kind the authored System never carries', () => {
    const system = bound([binding({ target: { kind: 'agency', id: 'rtc' } })]);

    expect(() => validateAuthoredProvenanceRelationships(system)).toThrow(/not carried/);
  });

  it('rejects a second active binding for one external reference', () => {
    const system = bound([binding(), binding({ target: { kind: 'stop', id: 'bound-stop' } })]);

    expect(() => validateAuthoredProvenanceRelationships(system)).toThrow(/external reference/);
  });

  it('rejects two Sources binding the same authored target', () => {
    const system = bound(
      [binding(), binding({ external: { sourceId: 'agency', kind: 'route', id: 'r-9' } })],
      { sourceCitations: [citation('rtc'), citation('agency')] },
    );

    expect(() => validateAuthoredProvenanceRelationships(system)).toThrow(
      /Duplicate active Source binding for target/,
    );
  });

  it('requires a citation for every bound Source', () => {
    const system = bound([binding()], { sourceCitations: [] });

    expect(() => validateAuthoredProvenanceRelationships(system)).toThrow(/no Source citation/);
  });

  it('rejects a binding that claims a one-time upload as its applied revision', () => {
    const system = bound([binding({ lastAppliedRevisionId: 'upload-1' })], {
      importHistory: [oneTimeUpload('upload-1')],
    });

    expect(() => validateAuthoredProvenanceRelationships(system)).toThrow(/one-time upload/);
  });

  it('recomputes both baseline hashes from the supplied record and entity', async () => {
    const recomputed = await recomputeSourceBindingBaseline({
      external: { sourceId: 'rtc', kind: 'route', id: 'r-1' },
      target: { kind: 'way', id: 'bound-way' },
      record: { routeId: 'r-1', name: 'Route 1' },
      entity: { id: 'bound-way', kind: 'way' },
    });

    expect(recomputed.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(recomputed.targetHash).toMatch(/^[0-9a-f]{64}$/);
    expect(recomputed.sourceHash).not.toBe(recomputed.targetHash);
  });

  it('rejects a baseline whose recorded hash does not match the supplied inputs', async () => {
    const inputs = { record: { routeId: 'r-1' }, entity: { id: 'bound-way' } };
    const recomputed = await recomputeSourceBindingBaseline({
      external: { sourceId: 'rtc', kind: 'route', id: 'r-1' },
      target: { kind: 'way', id: 'bound-way' },
      ...inputs,
    });

    await expect(assertSourceBindingBaseline(binding(), inputs)).rejects.toThrow(
      /source hash does not match/,
    );
    await expect(
      assertSourceBindingBaseline(
        binding({
          baseline: {
            sourceHash: recomputed.sourceHash,
            targetHash: DIGEST,
            schemaVersion: '17',
            normalizerVersion: 'reviewed-import-v1',
          },
        }),
        inputs,
      ),
    ).rejects.toThrow(/target hash does not match/);
  });
});
