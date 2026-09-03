import { describe, expect, it } from 'vitest';
import type { ContentRef } from '../../../src/network/content-reference';
import type {
  ResolvedContentRef,
  ResolvedContentDescriptor,
  ResolvedSourceStatus,
} from '../../../src/network/resolved-content-reference';

const digest = {
  algorithm: 'sha-256',
  value: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
} as const;

describe('content references', () => {
  it('represents both content roots and every mutable revision selector', () => {
    const references = [
      { kind: 'transit-system', id: 'local-system', revision: { kind: 'latest' } },
      {
        kind: 'transit-system',
        id: 'published-system',
        revision: { kind: 'pinned', systemRevisionId: 'system-revision-1' },
      },
      {
        kind: 'transit-dataset',
        id: 'national-network',
        revision: { kind: 'latest', operational: { kind: 'planned' } },
      },
      {
        kind: 'transit-dataset',
        id: 'national-network',
        revision: { kind: 'latest', operational: { kind: 'latest' } },
      },
      {
        kind: 'transit-dataset',
        id: 'regional-network',
        revision: {
          kind: 'pinned',
          datasetRevisionId: 'dataset-revision-1',
          operational: { kind: 'planned' },
        },
      },
      {
        kind: 'transit-dataset',
        id: 'regional-network',
        revision: {
          kind: 'pinned',
          datasetRevisionId: 'dataset-revision-1',
          operational: { kind: 'latest' },
        },
      },
      {
        kind: 'transit-dataset',
        id: 'regional-network',
        revision: {
          kind: 'pinned',
          datasetRevisionId: 'dataset-revision-1',
          operational: { kind: 'pinned', operationalSnapshotId: 'snapshot-1' },
        },
      },
    ] as const satisfies readonly ContentRef[];

    expect(references.filter((reference) => reference.kind === 'transit-system')).toHaveLength(2);
    expect(references.filter((reference) => reference.kind === 'transit-dataset')).toHaveLength(5);
  });

  it('uses concrete revision identities after content resolution', () => {
    const references = [
      {
        kind: 'transit-system',
        id: 'working-system',
        revision: { kind: 'working', contentDigest: digest },
      },
      {
        kind: 'transit-system',
        id: 'published-system',
        revision: { kind: 'published', systemRevisionId: 'system-revision-1' },
      },
      {
        kind: 'transit-dataset',
        id: 'planned-network',
        datasetRevisionId: 'dataset-revision-1',
        operational: { kind: 'planned' },
      },
      {
        kind: 'transit-dataset',
        id: 'live-network',
        datasetRevisionId: 'dataset-revision-1',
        operational: { kind: 'snapshot', operationalSnapshotId: 'snapshot-1' },
      },
    ] as const satisfies readonly ResolvedContentRef[];

    expect(references.every((reference) => reference.id.length > 0)).toBe(true);
  });

  it('describes generic map controls and bounded source status without provider copy', () => {
    const freshnessStates = [
      'fresh',
      'stale',
      'not-applicable',
      'unknown',
    ] as const satisfies readonly ResolvedSourceStatus['freshness'][];
    const descriptor = {
      content: {
        kind: 'transit-dataset',
        id: 'network',
        datasetRevisionId: 'dataset-revision-1',
        operational: { kind: 'planned' },
      },
      map: {
        defaultRepresentationId: 'network',
        representationIds: ['network', 'infrastructure'],
        modeIds: ['bus', 'rail'],
        defaultModeIds: ['bus', 'rail'],
        filters: [
          { kind: 'boolean', id: 'accessible', label: 'Accessible', defaultValue: false },
          {
            kind: 'single',
            id: 'frequency',
            label: 'Frequency',
            options: [
              { value: 'all', label: 'All service' },
              { value: 'frequent', label: 'Frequent service' },
            ],
            defaultValue: 'all',
          },
          {
            kind: 'multiple',
            id: 'operators',
            label: 'Operators',
            options: [{ value: 'rtc', label: 'RTC' }],
            defaultValue: [],
          },
        ],
      },
      attributions: [{ text: 'Open transit data', url: 'https://example.com/attribution' }],
      licenses: [{ id: 'open-data', name: 'Open Data License' }],
      sources: [
        {
          sourceId: 'rtc',
          name: 'RTC schedule',
          attribution: { text: 'RTC' },
          lastUpdatedAt: '2026-08-28T12:00:00Z',
          freshness: 'fresh',
        },
        {
          sourceId: 'regional-static',
          name: 'Regional infrastructure',
          attribution: { text: 'Regional planning agency' },
          freshness: 'not-applicable',
        },
      ],
    } as const satisfies ResolvedContentDescriptor;

    expect(descriptor.map.filters.every((filter) => filter.label.length > 0)).toBe(true);
    expect(descriptor.sources.map((source) => source.freshness)).toEqual([
      'fresh',
      'not-applicable',
    ]);
    expect(freshnessStates).toHaveLength(4);
  });
});
