import type { ResolvedNetworkProjection } from '../network/resolved-network-projection';
import type { PreparedPatternLegIndex } from './pattern-leg-index';
import type {
  PrepareTopologyWindowResult,
  TopologyWindowPreparationFailure,
  TopologyWindowRejectionReason,
} from './line-topology-window-types';
import {
  prepareTopologyWindowCalls,
  prepareTopologyWindowFragments,
} from './line-topology-window-validation';

function rejected(
  reason: TopologyWindowRejectionReason,
  recordId: string,
): PrepareTopologyWindowResult {
  return { kind: 'rejected', reason, recordId };
}

function missing(
  projection: ResolvedNetworkProjection,
  reason: TopologyWindowRejectionReason,
  recordId: string,
): TopologyWindowPreparationFailure {
  return projection.result.nextCursor === undefined
    ? { kind: 'rejected', reason, recordId }
    : { kind: 'pending', reason: 'more-pages' };
}

/**
 * Resolves one complete topology window through canonical records and the
 * validated Pattern-leg index. Boundary placement comes from the window,
 * never from geometry or a Stop-call anchor.
 */
export function prepareTopologyWindow(
  projection: ResolvedNetworkProjection,
  patternLegIndex: PreparedPatternLegIndex,
  topologyWindowId: string,
): PrepareTopologyWindowResult {
  if (patternLegIndex.sourceResult !== projection.result) {
    return rejected('pattern-leg-index-source-mismatch', topologyWindowId);
  }
  const window = projection.index.topologyWindowsById.get(topologyWindowId);
  if (window === undefined) return missing(projection, 'missing-topology-window', topologyWindowId);
  const pattern = projection.index.patternsById.get(window.patternId);
  if (pattern === undefined)
    return missing(projection, 'missing-topology-pattern', window.patternId);
  if (pattern.path !== 'known') return rejected('unknown-topology-pattern-path', pattern.id);
  const fragments = prepareTopologyWindowFragments(projection, patternLegIndex, window);
  if (fragments.kind !== 'ready') return fragments;
  const calls = prepareTopologyWindowCalls(
    projection,
    window.patternId,
    window.anchoredCalls,
    fragments.fragments.length,
  );
  if (calls.kind !== 'ready') return calls;
  return {
    kind: 'ready',
    window: {
      id: window.id,
      patternId: window.patternId,
      anchoredCalls: calls.calls,
      fragments: fragments.fragments,
    },
  };
}
