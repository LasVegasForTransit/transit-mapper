import type { TransitEntityKey } from '@transitmapper/core/model/transit-entity-ref';
import type { PreparedPatternLeg } from './pattern-leg-index';
import type { PreparedLineSpanShard } from './line-spans';

export interface PreparedTopologyWindowCall {
  readonly stopCallId: string;
  readonly sequence: number;
  readonly patternLegBoundaryIndex: number;
  readonly pathAnchor: { readonly legIndex: number; readonly carrierPosition: number };
  readonly stopKey: TransitEntityKey;
  readonly stationKey?: TransitEntityKey;
}

export interface PreparedTopologyWindowFragment {
  readonly fragmentId: string;
  readonly patternLeg: PreparedPatternLeg;
  readonly shard: PreparedLineSpanShard;
}

export interface PreparedTopologyWindow {
  readonly id: string;
  readonly patternId: string;
  readonly anchoredCalls: readonly [
    PreparedTopologyWindowCall,
    PreparedTopologyWindowCall,
    ...PreparedTopologyWindowCall[],
  ];
  readonly fragments: readonly [
    PreparedTopologyWindowFragment,
    ...PreparedTopologyWindowFragment[],
  ];
}

export type TopologyWindowRejectionReason =
  | 'pattern-leg-index-source-mismatch'
  | 'missing-topology-window'
  | 'missing-topology-pattern'
  | 'unknown-topology-pattern-path'
  | 'invalid-topology-window'
  | 'missing-topology-fragment'
  | 'duplicate-topology-fragment'
  | 'mismatched-topology-fragment-pattern'
  | 'nonmonotonic-topology-fragment-order'
  | 'conflicting-topology-fragment-leg'
  | 'topology-fragment-discontinuity'
  | 'missing-topology-call'
  | 'duplicate-topology-call'
  | 'mismatched-topology-call-pattern'
  | 'missing-topology-call-anchor'
  | 'invalid-topology-call-anchor'
  | 'missing-topology-stop'
  | 'invalid-topology-stop-id'
  | 'missing-topology-station'
  | 'invalid-topology-station-id'
  | 'invalid-topology-boundary'
  | 'nonmonotonic-topology-call-sequence';

export type PrepareTopologyWindowResult =
  | { readonly kind: 'ready'; readonly window: PreparedTopologyWindow }
  | { readonly kind: 'pending'; readonly reason: 'more-pages' }
  | {
      readonly kind: 'rejected';
      readonly reason: TopologyWindowRejectionReason;
      readonly recordId: string;
    };

export type TopologyWindowPreparationFailure = Exclude<
  PrepareTopologyWindowResult,
  { readonly kind: 'ready' }
>;
