import type { TransitEntityKey } from '@transitmapper/core/model/transit-entity-ref';
import type { PreparedTopologyWindowCall } from './line-topology-window-types';

interface TopologyAnchorMatch {
  readonly kind: 'stop' | 'station';
  readonly anchorKey: TransitEntityKey;
}

interface TopologyAnchorMatchPair {
  readonly leftCallIndex: number;
  readonly rightCallIndex: number;
  readonly match: TopologyAnchorMatch;
}

/**
 * Resolves authored interchange identity before geometric comparison. A parent
 * Station can connect distinct boarding Stops, but an exact Stop remains the
 * stronger match for repeated-anchor selection.
 */
export function matchTopologyAnchor(
  left: PreparedTopologyWindowCall,
  right: PreparedTopologyWindowCall,
): TopologyAnchorMatch | undefined {
  if (left.stopKey === right.stopKey) return { kind: 'stop', anchorKey: left.stopKey };
  if (left.stationKey !== undefined && left.stationKey === right.stationKey) {
    return { kind: 'station', anchorKey: left.stationKey };
  }
  return undefined;
}

/**
 * Retains every authored occurrence. Metric acceptance, rather than array
 * position, must settle repeated-anchor correspondence.
 */
export function enumerateTopologyAnchorMatches(
  leftCalls: readonly PreparedTopologyWindowCall[],
  rightCalls: readonly PreparedTopologyWindowCall[],
): readonly TopologyAnchorMatchPair[] {
  const matches: TopologyAnchorMatchPair[] = [];
  for (const [leftCallIndex, left] of leftCalls.entries()) {
    for (const [rightCallIndex, right] of rightCalls.entries()) {
      const match = matchTopologyAnchor(left, right);
      if (match !== undefined) matches.push({ leftCallIndex, rightCallIndex, match });
    }
  }
  return matches;
}
