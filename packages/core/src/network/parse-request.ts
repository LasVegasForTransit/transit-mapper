import {
  exactRecord,
  parseArray,
  parseBoolean,
  parseString,
  parseText,
} from '../model/schema-v17-system/parse-values';
import type { GeographicBounds } from '../geography/bounds';
import type { ContentRef } from './content-reference';
import type { DetailBand, ModeSelection, NetworkQuery, ViewFilterValue } from './query';
import type { ResolvedContentRef } from './resolved-content-reference';

/**
 * Strict parsers for the values an API request carries across the wire.
 *
 * A provider trusts what it is handed: it reads `revision.kind` and branches,
 * and a missing discriminant would take a default path rather than fail. These
 * parsers exist so unvalidated JSON never reaches that decision, and so a
 * rejected request names the field that was wrong instead of surfacing a
 * `TypeError` from somewhere deeper.
 *
 * They reject unknown fields. A client sending a field this version does not
 * understand is a client expecting behaviour it will not get, and a silent
 * drop turns that into a wrong map rather than an error.
 */

const DETAIL_BANDS: readonly DetailBand[] = ['overview', 'district', 'street'];

function parseDetailBand(value: unknown, label: string): DetailBand {
  const text = parseString(value, label);
  const band = DETAIL_BANDS.find((candidate) => candidate === text);
  if (!band) throw new Error(`${label} must be one of ${DETAIL_BANDS.join(', ')}.`);
  return band;
}

function parseFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function parseLongitude(value: unknown, label: string): number {
  const degrees = parseFiniteNumber(value, label);
  if (degrees < -180 || degrees > 180) throw new Error(`${label} must be within -180 and 180.`);
  return degrees;
}

function parseLatitude(value: unknown, label: string): number {
  const degrees = parseFiniteNumber(value, label);
  if (degrees < -90 || degrees > 90) throw new Error(`${label} must be within -90 and 90.`);
  return degrees;
}

export function parseGeographicBounds(value: unknown, label: string): GeographicBounds {
  const record = exactRecord(value, label, ['kind', 'west', 'south', 'east', 'north']);
  const kind = parseString(record.kind, `${label}.kind`);
  if (kind !== 'ordinary' && kind !== 'crosses-antimeridian') {
    throw new Error(`${label}.kind must be ordinary or crosses-antimeridian.`);
  }
  const west = parseLongitude(record.west, `${label}.west`);
  const south = parseLatitude(record.south, `${label}.south`);
  const east = parseLongitude(record.east, `${label}.east`);
  const north = parseLatitude(record.north, `${label}.north`);
  if (south > north) throw new Error(`${label}.south must not be north of ${label}.north.`);
  // An ordinary box that reads east-of-west is the antimeridian case written
  // without its discriminant. Accepting it would silently query the complement
  // of what the caller drew.
  if (kind === 'ordinary' && west > east) {
    throw new Error(`${label}.west must not be east of ${label}.east for ordinary bounds.`);
  }
  if (kind === 'crosses-antimeridian' && west <= east) {
    throw new Error(`${label} does not cross the antimeridian.`);
  }
  return { kind, west, south, east, north };
}

function parseModeSelection(value: unknown, label: string): ModeSelection {
  const record = exactRecord(value, label, ['kind'], ['ids']);
  const kind = parseString(record.kind, `${label}.kind`);
  if (kind === 'all') {
    if ('ids' in record) throw new Error(`${label} must not list ids when it selects all modes.`);
    return { kind: 'all' };
  }
  if (kind !== 'only') throw new Error(`${label}.kind must be all or only.`);
  return { kind: 'only', ids: parseArray(record.ids, `${label}.ids`, parseText) };
}

function parseFilterValue(value: unknown, label: string): ViewFilterValue {
  if (typeof value === 'boolean') return parseBoolean(value, label);
  if (Array.isArray(value)) return parseArray(value, label, parseText);
  return parseText(value, label);
}

function parseFilters(value: unknown, label: string): Record<string, ViewFilterValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const filters: Record<string, ViewFilterValue> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    filters[key] = parseFilterValue(entry, `${label}.${key}`);
  }
  return filters;
}

function parseServiceTime(value: unknown, label: string): NetworkQuery['serviceTime'] {
  const record = exactRecord(value, label, ['kind'], ['value']);
  const kind = parseString(record.kind, `${label}.kind`);
  if (kind === 'live') {
    if ('value' in record) throw new Error(`${label} must not carry an instant when it is live.`);
    return { kind: 'live' };
  }
  if (kind !== 'instant') throw new Error(`${label}.kind must be live or instant.`);
  return { kind: 'instant', value: parseText(record.value, `${label}.value`) };
}

export function parseNetworkQuery(value: unknown, label = 'query'): NetworkQuery {
  const record = exactRecord(
    value,
    label,
    ['serviceTime', 'modes', 'filters', 'bounds', 'detailBand'],
    ['cursor'],
  );
  const query: NetworkQuery = {
    serviceTime: parseServiceTime(record.serviceTime, `${label}.serviceTime`),
    modes: parseModeSelection(record.modes, `${label}.modes`),
    filters: parseFilters(record.filters, `${label}.filters`),
    bounds: parseGeographicBounds(record.bounds, `${label}.bounds`),
    detailBand: parseDetailBand(record.detailBand, `${label}.detailBand`),
  };
  if (!('cursor' in record)) return query;
  return { ...query, cursor: parseText(record.cursor, `${label}.cursor`) };
}

function parseSystemContentRef(
  record: Record<string, unknown>,
  label: string,
): Extract<ContentRef, { kind: 'transit-system' }> {
  const id = parseText(record.id, `${label}.id`);
  const revisionLabel = `${label}.revision`;
  const revision = exactRecord(record.revision, revisionLabel, ['kind'], ['systemRevisionId']);
  const kind = parseString(revision.kind, `${revisionLabel}.kind`);
  if (kind === 'latest') {
    if ('systemRevisionId' in revision) {
      throw new Error(`${revisionLabel} must not name a revision when it asks for the latest.`);
    }
    return { kind: 'transit-system', id, revision: { kind: 'latest' } };
  }
  if (kind !== 'pinned') throw new Error(`${revisionLabel}.kind must be latest or pinned.`);
  return {
    kind: 'transit-system',
    id,
    revision: {
      kind: 'pinned',
      systemRevisionId: parseText(revision.systemRevisionId, `${revisionLabel}.systemRevisionId`),
    },
  };
}

export function parseContentRef(value: unknown, label = 'reference'): ContentRef {
  const record = exactRecord(value, label, ['kind', 'id', 'revision']);
  const kind = parseString(record.kind, `${label}.kind`);
  if (kind === 'transit-system') return parseSystemContentRef(record, label);
  // Datasets are a storage root this Worker does not serve yet. Naming the
  // reason beats a generic shape error, which would read as a malformed
  // request rather than an unbuilt feature.
  if (kind === 'transit-dataset') {
    throw new Error(`${label} names a TransitDataset, and Dataset content is not served yet.`);
  }
  throw new Error(`${label}.kind must be transit-system.`);
}

export function parseResolvedContentRef(value: unknown, label = 'content'): ResolvedContentRef {
  const record = exactRecord(value, label, ['kind', 'id', 'revision']);
  const kind = parseString(record.kind, `${label}.kind`);
  if (kind !== 'transit-system') {
    throw new Error(`${label}.kind must be transit-system.`);
  }
  const id = parseText(record.id, `${label}.id`);
  const revisionLabel = `${label}.revision`;
  const revision = exactRecord(
    record.revision,
    revisionLabel,
    ['kind'],
    ['contentDigest', 'systemRevisionId'],
  );
  const revisionKind = parseString(revision.kind, `${revisionLabel}.kind`);
  if (revisionKind === 'published') {
    return {
      kind: 'transit-system',
      id,
      revision: {
        kind: 'published',
        systemRevisionId: parseText(revision.systemRevisionId, `${revisionLabel}.systemRevisionId`),
      },
    };
  }
  if (revisionKind !== 'working') {
    throw new Error(`${revisionLabel}.kind must be working or published.`);
  }
  const digestLabel = `${revisionLabel}.contentDigest`;
  const digest = exactRecord(revision.contentDigest, digestLabel, ['algorithm', 'value']);
  const algorithm = parseString(digest.algorithm, `${digestLabel}.algorithm`);
  if (algorithm !== 'sha-256') throw new Error(`${digestLabel}.algorithm must be sha-256.`);
  const digestValue = parseString(digest.value, `${digestLabel}.value`);
  if (!/^[0-9a-f]{64}$/.test(digestValue)) {
    throw new Error(`${digestLabel}.value must be a lowercase SHA-256 digest.`);
  }
  return {
    kind: 'transit-system',
    id,
    revision: { kind: 'working', contentDigest: { algorithm, value: digestValue } },
  };
}
