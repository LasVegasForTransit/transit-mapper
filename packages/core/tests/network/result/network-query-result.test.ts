import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ResolvedNetworkChunk } from '../../../src/network/resolved-network-chunk';
import type { CoverageAssessment, NetworkQueryResult } from '../../../src/network/result';

const emptyChunk: ResolvedNetworkChunk = {
  id: 'empty-west',
  entities: {
    lines: [],
    servicePlans: [],
    patterns: [],
    stops: [],
    stations: [],
    alignments: [],
    ways: [],
  },
  relationships: {
    lineServicePlans: [],
    servicePlanPatterns: [],
    patternStopCalls: [],
    topologyWindows: [],
    replacements: [],
  },
  geometry: {
    carriers: [],
    patternLegs: [],
    visiblePatternLegFragmentIds: [],
  },
  operationalChanges: [],
  advisories: [],
  infrastructure: {
    nodes: [],
    namedWays: [],
    medians: [],
    laneConnectors: [],
    turnRestrictions: [],
    approachControls: [],
    facilities: [],
    groups: [],
    groupMembers: [],
    areas: [],
  },
};

const result: NetworkQueryResult = {
  descriptor: {
    content: {
      kind: 'transit-dataset',
      id: 'southern-nevada',
      datasetRevisionId: 'revision-7',
      operational: { kind: 'planned' },
    },
    map: {
      defaultRepresentationId: 'network',
      representationIds: ['network'],
      modeIds: ['bus'],
      defaultModeIds: ['bus'],
      filters: [],
    },
    attributions: [{ text: 'Regional Transportation Commission of Southern Nevada' }],
    licenses: [],
    sources: [
      {
        sourceId: 'rtc-schedule',
        name: 'RTC schedule',
        attribution: { text: 'RTC' },
        freshness: 'fresh',
      },
    ],
  },
  coverage: [
    {
      area: { kind: 'unknown' },
      sourceIds: ['rtc-schedule'],
      coverage: 'unknown',
      availability: 'available',
      freshness: 'unknown',
      serviceEvidence: 'unknown',
      filterEffect: 'included',
    },
  ],
  lineOrder: [
    { lineId: 'line-101', rank: 0 },
    { lineId: 'line-220', rank: 1 },
  ],
  chunks: [emptyChunk],
  nextCursor: 'opaque-page-2',
};

const knownNoServiceResult: NetworkQueryResult = {
  descriptor: result.descriptor,
  coverage: result.coverage.map((assessment) => ({
    ...assessment,
    serviceEvidence: 'known-none',
  })),
  lineOrder: result.lineOrder,
  chunks: result.chunks,
};

describe('bounded network query results', () => {
  it('keeps all five coverage axes independent and complete', () => {
    expectTypeOf<CoverageAssessment['coverage']>().toEqualTypeOf<
      'inside' | 'outside' | 'unknown'
    >();
    expectTypeOf<CoverageAssessment['availability']>().toEqualTypeOf<
      'available' | 'unavailable' | 'unknown'
    >();
    expectTypeOf<CoverageAssessment['freshness']>().toEqualTypeOf<
      'fresh' | 'stale' | 'not-applicable' | 'unknown'
    >();
    expectTypeOf<CoverageAssessment['serviceEvidence']>().toEqualTypeOf<
      'present' | 'known-none' | 'unknown'
    >();
    expectTypeOf<CoverageAssessment['filterEffect']>().toEqualTypeOf<
      'included' | 'excluded' | 'partial' | 'not-applied'
    >();
  });

  it('keeps an empty chunk distinct from evidence that an area has no service', () => {
    expect(result.chunks[0]?.entities.lines).toEqual([]);
    expect(result.coverage[0]?.serviceEvidence).toBe('unknown');
    expect(knownNoServiceResult.chunks[0]?.entities.lines).toEqual([]);
    expect(knownNoServiceResult.coverage[0]?.serviceEvidence).toBe('known-none');
  });

  it('keeps coverage conclusions independent from availability and filters', () => {
    const assessment: CoverageAssessment = {
      ...result.coverage[0],
      coverage: 'inside' as const,
      availability: 'unavailable' as const,
      freshness: 'stale' as const,
      serviceEvidence: 'present' as const,
      filterEffect: 'excluded' as const,
    };

    expect(assessment).toMatchObject({
      coverage: 'inside',
      availability: 'unavailable',
      freshness: 'stale',
      serviceEvidence: 'present',
      filterEffect: 'excluded',
    });
  });

  it('carries Line order and the continuation cursor outside chunk arrival order', () => {
    expect(result.lineOrder.map(({ lineId }) => lineId)).toEqual(['line-101', 'line-220']);
    expect(result.chunks.map(({ id }) => id)).toEqual(['empty-west']);
    expect(result.nextCursor).toBe('opaque-page-2');
    expect('nextCursor' in knownNoServiceResult).toBe(false);
  });
});
