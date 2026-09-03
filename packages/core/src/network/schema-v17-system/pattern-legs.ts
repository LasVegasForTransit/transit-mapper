import type { GeographicBounds } from '../../geography/bounds';
import { derivedId } from '../../model/derived-id';
import type { Pattern, PatternLeg, TransitSystem } from '../../transit/authored-system';
import {
  clippedCarrierGeometry,
  normalizedPositionKey,
  type CarrierGeometrySource,
} from '../carrier-geometry';
import type {
  ResolvedCarrierFragment,
  ResolvedPatternLegFragment,
} from '../resolved-network-chunk';
import {
  alignmentGeometrySource,
  alignmentIndex,
  wayGeometrySource,
  type AlignmentIndex,
} from './carrier-geometry';

export interface ProjectedPatternGeometry {
  readonly carriers: readonly ResolvedCarrierFragment[];
  readonly patternLegs: readonly ResolvedPatternLegFragment[];
}

/** Stable across every query: it names the semantic piece, never the shard a
 * particular viewport happened to cut from it. A host caches against this. */
function logicalFragmentId(patternId: string, legIndex: number): string {
  return derivedId('v17', 'pattern-leg-fragment', patternId, legIndex);
}

/** Query-local: two viewports clipping one logical piece differently must not
 * share an ID, or a chunk would carry two records claiming one identity. */
function shardFragmentId(logicalId: string, range: readonly [number, number]): string {
  return derivedId(
    'v17',
    'pattern-leg-shard',
    logicalId,
    normalizedPositionKey(range[0]),
    normalizedPositionKey(range[1]),
  );
}

function legSource(
  leg: PatternLeg,
  system: TransitSystem,
  alignments: AlignmentIndex,
): CarrierGeometrySource | undefined {
  if (leg.kind === 'alignment') {
    const alignment = alignments.get(leg.alignmentId);
    return alignment ? alignmentGeometrySource(alignment) : undefined;
  }
  const way = system.ways.find((candidate) => candidate.id === leg.wayId);
  if (!way) return undefined;
  return wayGeometrySource(
    way,
    alignments,
    leg.lane.kind === 'pinned' ? leg.lane.laneId : undefined,
  );
}

export interface PatternGeometryOptions {
  readonly system: TransitSystem;
  readonly bounds: GeographicBounds;
}

/**
 * Projects one Pattern's legs into carrier fragments and the leg fragments
 * that reference them.
 *
 * A leg whose carrier is missing contributes nothing rather than a fragment
 * with no geometry: only `visiblePatternLegFragmentIds` authorizes paint, and
 * a fragment that names an absent carrier would be a record the renderer must
 * then decide about.
 */
export function projectPatternGeometry(
  pattern: Pattern,
  { system, bounds }: PatternGeometryOptions,
  alignments: AlignmentIndex = alignmentIndex(system),
): ProjectedPatternGeometry {
  if (pattern.path.kind !== 'known') return { carriers: [], patternLegs: [] };
  const carriers: ResolvedCarrierFragment[] = [];
  const patternLegs: ResolvedPatternLegFragment[] = [];
  pattern.path.legs.forEach((leg, legIndex) => {
    const source = legSource(leg, system, alignments);
    if (!source) return;
    const logicalRange: readonly [number, number] = [leg.extent.start, leg.extent.end];
    const logicalId = logicalFragmentId(pattern.id, legIndex);
    const pieces = clippedCarrierGeometry(source, logicalRange, bounds, (role, range) =>
      derivedId(
        'v17',
        `${role}-carrier-fragment`,
        logicalId,
        normalizedPositionKey(range[0]),
        normalizedPositionKey(range[1]),
      ),
    );
    for (const piece of pieces) {
      carriers.push(piece.carrier);
      patternLegs.push({
        id: shardFragmentId(logicalId, piece.range),
        logicalPatternLegFragmentId: logicalId,
        patternId: pattern.id,
        legIndex,
        carrierFragmentId: piece.carrier.id,
        carrierRange: piece.range,
        logicalCarrierRange: logicalRange,
        logicalAlignmentRange: logicalRange,
        direction: leg.direction,
      });
    }
  });
  return { carriers, patternLegs };
}
