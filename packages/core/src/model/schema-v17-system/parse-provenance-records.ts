import { parseExternalRef, parseSourceCitation } from '../../source/source-reference';
import {
  parseArtifactDescriptor,
  parseAttribution,
  parseLicenseRef,
} from '../../source/value-types';
import type {
  ImportHistoryEntry,
  LegacyServiceAlias,
  LegacySourceReference,
  SourceBinding,
} from '../../transit/authored-system';
import { parseTransitEntityRef } from '../../transit/entity-ref';
import { exactRecord, parseInstant, parseSha256, parseString, parseText } from './parse-values';

function parseExactExternalRef(value: unknown, label: string) {
  exactRecord(value, label, ['sourceId', 'kind', 'id']);
  return parseExternalRef(value);
}

function parseExactEntityRef(value: unknown, label: string) {
  exactRecord(value, label, ['kind', 'id']);
  return parseTransitEntityRef(value);
}

function parseExactCitation(value: unknown, label: string) {
  const record = exactRecord(
    value,
    label,
    ['sourceId', 'name', 'attribution'],
    ['publisher', 'license'],
  );
  if ('publisher' in record) {
    exactRecord(record.publisher, `${label} publisher`, ['id', 'name'], ['url']);
  }
  exactRecord(record.attribution, `${label} attribution`, ['text'], ['url']);
  if ('license' in record) {
    exactRecord(record.license, `${label} license`, ['id', 'name'], ['url']);
  }
  return parseSourceCitation(value);
}

export const parseSourceCitationRecord = parseExactCitation;

export function parseSourceBinding(value: unknown, label: string): SourceBinding {
  const record = exactRecord(value, label, [
    'external',
    'target',
    'lastAppliedRevisionId',
    'baseline',
  ]);
  const baseline = exactRecord(record.baseline, `${label} baseline`, [
    'sourceHash',
    'targetHash',
    'schemaVersion',
    'normalizerVersion',
  ]);
  if (baseline.schemaVersion !== '17') {
    throw new Error(`${label} baseline schema version must be 17.`);
  }
  if (baseline.normalizerVersion !== 'reviewed-import-v1') {
    throw new Error(`${label} baseline normalizer version is invalid.`);
  }
  return {
    external: parseExactExternalRef(record.external, `${label} external reference`),
    target: parseExactEntityRef(record.target, `${label} target`),
    lastAppliedRevisionId: parseText(
      record.lastAppliedRevisionId,
      `${label} last applied revision ID`,
    ),
    baseline: {
      sourceHash: parseSha256(baseline.sourceHash, `${label} source hash`),
      targetHash: parseSha256(baseline.targetHash, `${label} target hash`),
      schemaVersion: '17',
      normalizerVersion: 'reviewed-import-v1',
    },
  };
}

export function parseLegacyServiceAlias(value: unknown, label: string): LegacyServiceAlias {
  const record = exactRecord(value, label, [
    'legacyServiceId',
    'lineId',
    'servicePlanId',
    'patternIds',
  ]);
  const patternIds = exactRecord(
    record.patternIds,
    `${label} Pattern IDs`,
    ['outbound'],
    ['inbound'],
  );
  const alias: LegacyServiceAlias = {
    legacyServiceId: parseText(record.legacyServiceId, `${label} legacy Service ID`),
    lineId: parseText(record.lineId, `${label} Line ID`),
    servicePlanId: parseText(record.servicePlanId, `${label} ServicePlan ID`),
    patternIds: { outbound: parseText(patternIds.outbound, `${label} outbound Pattern ID`) },
  };
  if ('inbound' in patternIds) {
    alias.patternIds.inbound = parseText(patternIds.inbound, `${label} inbound Pattern ID`);
  }
  return alias;
}

export function parseLegacySourceReference(value: unknown, label: string): LegacySourceReference {
  const record = exactRecord(value, label, ['target', 'value']);
  const target = exactRecord(record.target, `${label} target`, ['kind', 'id']);
  if (target.kind !== 'way') throw new Error(`${label} target must be a Way reference.`);
  return {
    target: { kind: 'way', id: parseText(target.id, `${label} target ID`) },
    value: parseString(record.value, `${label} value`),
  };
}

function parseExactAttribution(value: unknown, label: string) {
  exactRecord(value, label, ['text'], ['url']);
  return parseAttribution(value);
}

function parseExactLicense(value: unknown, label: string) {
  exactRecord(value, label, ['id', 'name'], ['url']);
  return parseLicenseRef(value);
}

export function parseImportHistoryEntry(value: unknown, label: string): ImportHistoryEntry {
  const record = exactRecord(value, label, ['id', 'importedAt', 'origin']);
  const origin = exactRecord(
    record.origin,
    `${label} origin`,
    ['kind'],
    ['datasetRevisionId', 'artifactDigest', 'mediaType', 'label', 'attribution', 'license'],
  );
  const common = {
    id: parseText(record.id, `${label} ID`),
    importedAt: parseInstant(record.importedAt, `${label} imported timestamp`),
  };
  if (origin.kind === 'managed-dataset') {
    const managed = exactRecord(record.origin, `${label} origin`, ['kind', 'datasetRevisionId']);
    return {
      ...common,
      origin: {
        kind: 'managed-dataset',
        datasetRevisionId: parseText(managed.datasetRevisionId, `${label} Dataset revision ID`),
      },
    };
  }
  if (origin.kind !== 'one-time-upload') throw new Error(`${label} origin kind is invalid.`);
  const upload = exactRecord(
    record.origin,
    `${label} origin`,
    ['kind', 'artifactDigest', 'mediaType'],
    ['label', 'attribution', 'license'],
  );
  exactRecord(upload.artifactDigest, `${label} artifact digest`, ['algorithm', 'value']);
  const descriptor = parseArtifactDescriptor({
    digest: upload.artifactDigest,
    mediaType: upload.mediaType,
    byteLength: 0,
  });
  const parsedOrigin: Extract<ImportHistoryEntry['origin'], { kind: 'one-time-upload' }> = {
    kind: 'one-time-upload',
    artifactDigest: descriptor.digest,
    mediaType: descriptor.mediaType,
  };
  if ('label' in upload) parsedOrigin.label = parseText(upload.label, `${label} upload label`);
  if ('attribution' in upload) {
    parsedOrigin.attribution = parseExactAttribution(
      upload.attribution,
      `${label} upload attribution`,
    );
  }
  if ('license' in upload) {
    parsedOrigin.license = parseExactLicense(upload.license, `${label} upload license`);
  }
  return { ...common, origin: parsedOrigin };
}
