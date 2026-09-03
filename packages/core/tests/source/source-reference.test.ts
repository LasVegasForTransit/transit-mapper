import { describe, expect, it } from 'vitest';
import {
  parseArtifactDescriptor,
  parseExternalFactRef,
  parseExternalRecordRef,
  parseExternalRef,
  parseSourceCitation,
} from '../../src/source';

const digest = {
  algorithm: 'sha-256',
  value: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
} as const;

describe('portable source references', () => {
  it('preserves delimiter-bearing portable identity without interpreting it', () => {
    const reference = {
      sourceId: 'publisher:feed/west',
      kind: 'route:pattern',
      id: 'blue/east:weekday',
    };

    expect(parseExternalRef(reference)).toEqual(reference);
    expect(parseExternalRecordRef({ ...reference, stability: 'source-stable' })).toEqual({
      ...reference,
      stability: 'source-stable',
    });
  });

  it('requires exact revision lineage for revision-local records and all facts', () => {
    const revisionLocalRecord = {
      sourceId: 'rtc',
      sourceRevisionId: 'rtc-2026-08-28',
      kind: 'trip',
      id: 'trip-101',
      stability: 'revision-local',
    } as const;
    const stableFact = {
      sourceId: 'rtc',
      sourceRevisionId: 'rtc-2026-08-28',
      kind: 'route',
      id: '101',
      stability: 'source-stable',
    } as const;
    const revisionLocalFact = {
      ...revisionLocalRecord,
      stability: 'revision-local',
    } as const;

    expect(parseExternalRecordRef(revisionLocalRecord)).toEqual(revisionLocalRecord);
    expect(parseExternalFactRef(stableFact)).toEqual(stableFact);
    expect(parseExternalFactRef(revisionLocalFact)).toEqual(revisionLocalFact);
    expect(() =>
      parseExternalRecordRef({
        sourceId: 'rtc',
        kind: 'trip',
        id: 'trip-101',
        stability: 'revision-local',
      }),
    ).toThrow();
    expect(() =>
      parseExternalRecordRef({
        sourceId: 'rtc',
        sourceRevisionId: 'rtc-2026-08-28',
        kind: 'route',
        id: '101',
        stability: 'source-stable',
      }),
    ).toThrow();
  });

  it('keeps attribution while allowing publisher and license citations to be absent', () => {
    expect(
      parseSourceCitation({
        sourceId: 'rtc',
        name: 'RTC schedule',
        attribution: { text: 'Regional Transportation Commission of Southern Nevada' },
      }),
    ).toEqual({
      sourceId: 'rtc',
      name: 'RTC schedule',
      attribution: { text: 'Regional Transportation Commission of Southern Nevada' },
    });

    const citation = {
      sourceId: 'mbta',
      name: 'MBTA schedule',
      publisher: { id: 'mbta', name: 'MBTA', url: 'https://www.mbta.com/' },
      attribution: {
        text: 'Massachusetts Bay Transportation Authority',
        url: 'https://www.mbta.com/',
      },
      license: {
        id: 'developer-license',
        name: 'Developer Portal Terms',
        url: 'http://example.com/developer-terms',
      },
    };

    expect(parseSourceCitation(citation)).toEqual(citation);
  });

  it('validates artifact metadata and citation URLs', () => {
    expect(
      parseArtifactDescriptor({
        digest,
        mediaType: 'application/json; charset=utf-8',
        byteLength: 0,
      }),
    ).toEqual({ digest, mediaType: 'application/json; charset=utf-8', byteLength: 0 });

    expect(() =>
      parseArtifactDescriptor({ digest, mediaType: 'not-a-media-type', byteLength: 10 }),
    ).toThrow();
    expect(() =>
      parseArtifactDescriptor({ digest, mediaType: 'application/json', byteLength: -1 }),
    ).toThrow();
    expect(() =>
      parseArtifactDescriptor({ digest, mediaType: 'application/json', byteLength: 1.5 }),
    ).toThrow();
    expect(() =>
      parseArtifactDescriptor({ digest, mediaType: 'application/json', byteLength: Number.NaN }),
    ).toThrow();
    expect(() =>
      parseArtifactDescriptor({
        digest: { algorithm: 'sha-256', value: digest.value.toUpperCase() },
        mediaType: 'application/json',
        byteLength: 10,
      }),
    ).toThrow();
    expect(() =>
      parseArtifactDescriptor({
        digest: { algorithm: 'sha512', value: digest.value },
        mediaType: 'application/json',
        byteLength: 10,
      }),
    ).toThrow();
    expect(() =>
      parseSourceCitation({
        sourceId: 'rtc',
        name: 'RTC schedule',
        attribution: { text: 'RTC', url: 'ftp://example.com/rtc' },
      }),
    ).toThrow();
    expect(() =>
      parseSourceCitation({
        sourceId: 'rtc',
        name: 'RTC schedule',
        publisher: { id: 'rtc', name: 'RTC', url: '/publishers/rtc' },
        attribution: { text: 'RTC' },
      }),
    ).toThrow();
  });

  it('rejects blank identity fields and drops connector configuration', () => {
    expect(() => parseExternalRef({ sourceId: ' ', kind: 'route', id: '101' })).toThrow();
    expect(
      parseSourceCitation({
        sourceId: 'rtc',
        name: 'RTC schedule',
        attribution: { text: 'RTC' },
        endpoint: 'https://example.com/feed.zip',
      }),
    ).toEqual({
      sourceId: 'rtc',
      name: 'RTC schedule',
      attribution: { text: 'RTC' },
    });
  });
});
