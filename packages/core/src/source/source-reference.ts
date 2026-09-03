import {
  parseAttribution,
  parseLicenseRef,
  parsePublisherRef,
  type Attribution,
  type IdentityStability,
  type LicenseRef,
  type PublisherRef,
} from './value-types';

export interface ExternalRef {
  sourceId: string;
  kind: string;
  id: string;
}

export type ExternalRecordRef =
  | (ExternalRef & { stability: 'source-stable' })
  | (ExternalRef & {
      stability: 'revision-local';
      sourceRevisionId: string;
    });

export type ExternalFactRef = ExternalRef & {
  sourceRevisionId: string;
  stability: IdentityStability;
};

export interface SourceCitation {
  sourceId: string;
  name: string;
  publisher?: PublisherRef;
  attribution: Attribution;
  license?: LicenseRef;
}

function valueRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must not be empty.`);
  }
  return value;
}

function identityStability(value: unknown): IdentityStability {
  if (value !== 'source-stable' && value !== 'revision-local') {
    throw new Error('External identity stability is invalid.');
  }
  return value;
}

export function parseExternalRef(value: unknown): ExternalRef {
  const record = valueRecord(value, 'External reference');
  return {
    sourceId: requiredText(record.sourceId, 'External source ID'),
    kind: requiredText(record.kind, 'External kind'),
    id: requiredText(record.id, 'External ID'),
  };
}

export function parseExternalRecordRef(value: unknown): ExternalRecordRef {
  const record = valueRecord(value, 'External record reference');
  const external = parseExternalRef(record);
  const stability = identityStability(record.stability);
  if (stability === 'source-stable') {
    if ('sourceRevisionId' in record) {
      throw new Error('A source-stable record reference must not include a source revision ID.');
    }
    return { ...external, stability };
  }
  return {
    ...external,
    sourceRevisionId: requiredText(record.sourceRevisionId, 'External source revision ID'),
    stability,
  };
}

export function parseExternalFactRef(value: unknown): ExternalFactRef {
  const record = valueRecord(value, 'External fact reference');
  return {
    ...parseExternalRef(record),
    sourceRevisionId: requiredText(record.sourceRevisionId, 'External source revision ID'),
    stability: identityStability(record.stability),
  };
}

export function parseSourceCitation(value: unknown): SourceCitation {
  const record = valueRecord(value, 'Source citation');
  const citation: SourceCitation = {
    sourceId: requiredText(record.sourceId, 'Citation source ID'),
    name: requiredText(record.name, 'Citation name'),
    attribution: parseAttribution(record.attribution),
  };
  if (record.publisher !== undefined) citation.publisher = parsePublisherRef(record.publisher);
  if (record.license !== undefined) citation.license = parseLicenseRef(record.license);
  return citation;
}
