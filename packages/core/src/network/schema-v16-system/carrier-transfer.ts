import type { NetworkQuery } from '../query';
import type {
  ResolvedCarrierFragment,
  ResolvedPatternLegFragment,
} from '../resolved-network-chunk';
import {
  clippedCarrierPieces,
  patternLegFragmentId,
  topologyCarrierPiece,
  type CarrierPiece,
} from './carrier-geometry';
import type { DerivedLegFragment } from './patterns';

export interface TransferredLegFragment {
  carrier: ResolvedCarrierFragment;
  fragment: ResolvedPatternLegFragment;
  source: DerivedLegFragment;
}

function transferFragment(
  source: DerivedLegFragment,
  piece: CarrierPiece,
  role: 'topology' | 'visible',
): TransferredLegFragment {
  return {
    source,
    carrier: piece.carrier,
    fragment: {
      id: patternLegFragmentId(role, source.id, piece.range),
      logicalPatternLegFragmentId: source.id,
      patternId: source.patternId,
      legIndex: source.legIndex,
      carrierFragmentId: piece.carrier.id,
      carrierRange: piece.range,
      logicalCarrierRange: source.carrierRange,
      logicalAlignmentRange: source.carrierRange,
      direction: source.direction,
    },
  };
}

export function visibleFragmentPieces(
  fragment: DerivedLegFragment,
  query: NetworkQuery,
): TransferredLegFragment[] {
  const pieces = clippedCarrierPieces(
    fragment.way,
    fragment.laneId,
    fragment.carrierRange,
    query.bounds,
  );
  if (fragment.direction === 'reverse') pieces.reverse();
  return pieces.map((piece) => transferFragment(fragment, piece, 'visible'));
}

export function topologyFragment(fragment: DerivedLegFragment): TransferredLegFragment | undefined {
  const piece = topologyCarrierPiece(fragment.way, fragment.laneId, fragment.carrierRange);
  return piece ? transferFragment(fragment, piece, 'topology') : undefined;
}
