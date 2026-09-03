import type { GeographicCoverage } from '../geography/coverage';
import type { LineOrderEntry } from '../transit/value-types';
import type { ResolvedContentDescriptor } from './resolved-content-reference';
import type { ResolvedNetworkChunk } from './resolved-network-chunk';

export interface CoverageAssessment {
  area: GeographicCoverage;
  sourceIds: readonly string[];
  coverage: 'inside' | 'outside' | 'unknown';
  availability: 'available' | 'unavailable' | 'unknown';
  freshness: 'fresh' | 'stale' | 'not-applicable' | 'unknown';
  serviceEvidence: 'present' | 'known-none' | 'unknown';
  filterEffect: 'included' | 'excluded' | 'partial' | 'not-applied';
}

export interface NetworkQueryResult {
  descriptor: ResolvedContentDescriptor;
  coverage: readonly CoverageAssessment[];
  lineOrder: readonly LineOrderEntry[];
  chunks: readonly ResolvedNetworkChunk[];
  nextCursor?: string;
}
