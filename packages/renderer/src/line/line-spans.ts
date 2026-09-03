import { canonicalValueBytes } from '@transitmapper/core/encoding/canonical-value';
import { sameNormalizedRange } from '@transitmapper/core/network/carrier-alignment';
import type {
  ResolvedCarrierFragment,
  ResolvedNetworkChunk,
  ResolvedPatternLegFragment,
} from '@transitmapper/core/network/resolved-network-chunk';
import {
  sameTransitCarrier,
  type LegDirection,
  type TransitCarrierRef,
} from '@transitmapper/core/transit/value-types';

export interface PreparedLineSpanShard {
  readonly fragment: ResolvedPatternLegFragment;
  readonly carrier: ResolvedCarrierFragment;
  readonly visible: boolean;
}

export interface PreparedLogicalPatternLeg {
  readonly id: string;
  readonly patternId: string;
  readonly legIndex: number;
  readonly direction: LegDirection;
  readonly carrier: TransitCarrierRef;
  readonly alignmentId: string;
  readonly logicalCarrierRange: readonly [number, number];
  readonly logicalAlignmentRange: readonly [number, number];
  readonly shards: readonly PreparedLineSpanShard[];
}

export interface PreparedLineSpanInput {
  readonly shardsById: ReadonlyMap<string, PreparedLineSpanShard>;
  readonly logicalPatternLegsById: ReadonlyMap<string, PreparedLogicalPatternLeg>;
}

type LineSpanInputRejectionReason =
  | 'mismatched-carrier-fragment'
  | 'mismatched-pattern-leg-fragment'
  | 'noncanonical-carrier-fragment'
  | 'noncanonical-pattern-leg-fragment'
  | 'missing-visible-pattern-leg-fragment'
  | 'missing-carrier-fragment'
  | 'invalid-shard-range'
  | 'invalid-logical-range'
  | 'invalid-alignment-shard-range'
  | 'invalid-logical-alignment-range'
  | 'shard-outside-logical-range'
  | 'alignment-shard-outside-logical-range'
  | 'alignment-carrier-range-conflict'
  | 'logical-pattern-leg-conflict';

export type PrepareLineSpanInputResult =
  | { readonly kind: 'ready'; readonly input: PreparedLineSpanInput }
  | {
      readonly kind: 'rejected';
      readonly reason: LineSpanInputRejectionReason;
      readonly recordId: string;
    };

type RejectedLineSpanInput = Extract<PrepareLineSpanInputResult, { readonly kind: 'rejected' }>;

interface CanonicalRecord<RecordType> {
  readonly value: RecordType;
  readonly bytes: Uint8Array;
  readonly idBytes: Uint8Array;
}

interface InsertRecordOptions<RecordType extends { readonly id: string }> {
  readonly recordsById: Map<string, CanonicalRecord<RecordType>>;
  readonly record: RecordType;
  readonly mismatchReason: LineSpanInputRejectionReason;
  readonly noncanonicalReason: LineSpanInputRejectionReason;
  readonly cache: Map<string, Uint8Array>;
}

interface CollectedGeometry {
  readonly carriersById: Map<string, CanonicalRecord<ResolvedCarrierFragment>>;
  readonly patternLegsById: Map<string, CanonicalRecord<ResolvedPatternLegFragment>>;
  readonly visiblePatternLegIds: Set<string>;
  readonly requiredCarrierIds: Set<string>;
  readonly idBytesById: Map<string, Uint8Array>;
}

type GeometryCollectionResult =
  { readonly kind: 'ready'; readonly geometry: CollectedGeometry } | RejectedLineSpanInput;

interface MutableLogicalPatternLeg {
  readonly id: string;
  readonly patternId: string;
  readonly legIndex: number;
  readonly direction: LegDirection;
  readonly carrier: TransitCarrierRef;
  readonly alignmentId: string;
  readonly logicalCarrierRange: readonly [number, number];
  readonly logicalAlignmentRange: readonly [number, number];
  readonly shards: PreparedLineSpanShard[];
}

const textEncoder = new TextEncoder();

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function rejection(reason: LineSpanInputRejectionReason, recordId: string): RejectedLineSpanInput {
  return { kind: 'rejected', reason, recordId };
}

function idBytes(id: string, cache: Map<string, Uint8Array>): Uint8Array {
  const existing = cache.get(id);
  if (existing !== undefined) return existing;
  const encoded = textEncoder.encode(id);
  cache.set(id, encoded);
  return encoded;
}

function canonicalRecord<RecordType extends { readonly id: string }>(
  record: RecordType,
  reason: LineSpanInputRejectionReason,
  cache: Map<string, Uint8Array>,
): CanonicalRecord<RecordType> | RejectedLineSpanInput {
  try {
    return {
      value: record,
      bytes: canonicalValueBytes(record),
      idBytes: idBytes(record.id, cache),
    };
  } catch {
    return rejection(reason, record.id);
  }
}

function insertRecord<RecordType extends { readonly id: string }>(
  options: InsertRecordOptions<RecordType>,
): RejectedLineSpanInput | undefined {
  const { recordsById, record, mismatchReason, noncanonicalReason, cache } = options;
  const incoming = canonicalRecord(record, noncanonicalReason, cache);
  if ('kind' in incoming) return incoming;
  const existing = recordsById.get(record.id);
  if (existing === undefined) {
    recordsById.set(record.id, incoming);
    return undefined;
  }
  return compareBytes(existing.bytes, incoming.bytes) === 0
    ? undefined
    : rejection(mismatchReason, record.id);
}

function validNormalizedRange(range: readonly [number, number]): boolean {
  const [start, end] = range;
  return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && start < end && end <= 1;
}

function invalidPatternLegRange(
  fragment: ResolvedPatternLegFragment,
): RejectedLineSpanInput | undefined {
  if (!validNormalizedRange(fragment.logicalCarrierRange)) {
    return rejection('invalid-logical-range', fragment.id);
  }
  if (!validNormalizedRange(fragment.carrierRange)) {
    return rejection('invalid-shard-range', fragment.id);
  }
  if (!validNormalizedRange(fragment.logicalAlignmentRange)) {
    return rejection('invalid-logical-alignment-range', fragment.id);
  }
  if (
    fragment.carrierRange[0] < fragment.logicalCarrierRange[0] ||
    fragment.carrierRange[1] > fragment.logicalCarrierRange[1]
  ) {
    return rejection('shard-outside-logical-range', fragment.id);
  }
  return undefined;
}

function invalidAlignmentShardRange(
  fragment: ResolvedPatternLegFragment,
  carrier: ResolvedCarrierFragment,
): RejectedLineSpanInput | undefined {
  if (!validNormalizedRange(carrier.alignmentRange)) {
    return rejection('invalid-alignment-shard-range', fragment.id);
  }
  if (
    carrier.alignmentRange[0] < fragment.logicalAlignmentRange[0] ||
    carrier.alignmentRange[1] > fragment.logicalAlignmentRange[1]
  ) {
    return rejection('alignment-shard-outside-logical-range', fragment.id);
  }
  if (
    carrier.carrier.kind === 'alignment' &&
    (!sameNormalizedRange(fragment.carrierRange, carrier.alignmentRange) ||
      !sameNormalizedRange(fragment.logicalCarrierRange, fragment.logicalAlignmentRange))
  ) {
    return rejection('alignment-carrier-range-conflict', fragment.id);
  }
  return undefined;
}

function collectPatternLeg(
  geometry: CollectedGeometry,
  patternLeg: ResolvedPatternLegFragment,
): RejectedLineSpanInput | undefined {
  const invalidRange = invalidPatternLegRange(patternLeg);
  if (invalidRange) return invalidRange;
  geometry.requiredCarrierIds.add(patternLeg.carrierFragmentId);
  return insertRecord({
    recordsById: geometry.patternLegsById,
    record: patternLeg,
    mismatchReason: 'mismatched-pattern-leg-fragment',
    noncanonicalReason: 'noncanonical-pattern-leg-fragment',
    cache: geometry.idBytesById,
  });
}

function collectPatternLegs(
  geometry: CollectedGeometry,
  chunks: readonly ResolvedNetworkChunk[],
): RejectedLineSpanInput | undefined {
  for (const chunk of chunks) {
    for (const patternLeg of chunk.geometry.patternLegs) {
      const result = collectPatternLeg(geometry, patternLeg);
      if (result) return result;
    }
    for (const id of chunk.geometry.visiblePatternLegFragmentIds) {
      geometry.visiblePatternLegIds.add(id);
      idBytes(id, geometry.idBytesById);
    }
  }
  return undefined;
}

function collectRequiredCarriers(
  geometry: CollectedGeometry,
  chunks: readonly ResolvedNetworkChunk[],
): RejectedLineSpanInput | undefined {
  // Pattern-leg references define the exact carrier closure for Line assembly.
  for (const chunk of chunks) {
    for (const carrier of chunk.geometry.carriers) {
      if (!geometry.requiredCarrierIds.has(carrier.id)) continue;
      const result = insertRecord({
        recordsById: geometry.carriersById,
        record: carrier,
        mismatchReason: 'mismatched-carrier-fragment',
        noncanonicalReason: 'noncanonical-carrier-fragment',
        cache: geometry.idBytesById,
      });
      if (result) return result;
    }
  }
  return undefined;
}

function collectGeometry(chunks: readonly ResolvedNetworkChunk[]): GeometryCollectionResult {
  const geometry: CollectedGeometry = {
    carriersById: new Map(),
    patternLegsById: new Map(),
    visiblePatternLegIds: new Set(),
    requiredCarrierIds: new Set(),
    idBytesById: new Map(),
  };
  const patternLegResult = collectPatternLegs(geometry, chunks);
  if (patternLegResult) return patternLegResult;
  const carrierResult = collectRequiredCarriers(geometry, chunks);
  return carrierResult ?? { kind: 'ready', geometry };
}

function sameLogicalLeg(logical: MutableLogicalPatternLeg, shard: PreparedLineSpanShard): boolean {
  const { fragment, carrier } = shard;
  return (
    logical.patternId === fragment.patternId &&
    logical.legIndex === fragment.legIndex &&
    logical.direction === fragment.direction &&
    sameNormalizedRange(logical.logicalCarrierRange, fragment.logicalCarrierRange) &&
    sameNormalizedRange(logical.logicalAlignmentRange, fragment.logicalAlignmentRange) &&
    sameTransitCarrier(logical.carrier, carrier.carrier) &&
    logical.alignmentId === carrier.alignmentId
  );
}

function preparedShard(
  fragment: ResolvedPatternLegFragment,
  geometry: CollectedGeometry,
): PreparedLineSpanShard | RejectedLineSpanInput {
  const carrier = geometry.carriersById.get(fragment.carrierFragmentId)?.value;
  if (carrier === undefined) {
    return rejection('missing-carrier-fragment', fragment.carrierFragmentId);
  }
  const invalidRange = invalidAlignmentShardRange(fragment, carrier);
  if (invalidRange) return invalidRange;
  return { fragment, carrier, visible: geometry.visiblePatternLegIds.has(fragment.id) };
}

function firstLogicalLeg(shard: PreparedLineSpanShard): MutableLogicalPatternLeg {
  const { fragment, carrier } = shard;
  return {
    id: fragment.logicalPatternLegFragmentId,
    patternId: fragment.patternId,
    legIndex: fragment.legIndex,
    direction: fragment.direction,
    carrier: carrier.carrier,
    alignmentId: carrier.alignmentId,
    logicalCarrierRange: fragment.logicalCarrierRange,
    logicalAlignmentRange: fragment.logicalAlignmentRange,
    shards: [shard],
  };
}

function compareIds(left: string, right: string, geometry: CollectedGeometry): number {
  return compareBytes(idBytes(left, geometry.idBytesById), idBytes(right, geometry.idBytesById));
}

function orderedPatternLegs(geometry: CollectedGeometry): readonly ResolvedPatternLegFragment[] {
  return [...geometry.patternLegsById.values()]
    .sort((left, right) => compareBytes(left.idBytes, right.idBytes))
    .map(({ value }) => value);
}

function compareShards(
  left: PreparedLineSpanShard,
  right: PreparedLineSpanShard,
  geometry: CollectedGeometry,
): number {
  const startDifference = left.fragment.carrierRange[0] - right.fragment.carrierRange[0];
  if (startDifference !== 0) return startDifference;
  const endDifference = left.fragment.carrierRange[1] - right.fragment.carrierRange[1];
  return endDifference !== 0
    ? endDifference
    : compareIds(left.fragment.id, right.fragment.id, geometry);
}

function prepareLogicalLegs(geometry: CollectedGeometry): PrepareLineSpanInputResult {
  const shardsById = new Map<string, PreparedLineSpanShard>();
  const mutableLogicalLegs = new Map<string, MutableLogicalPatternLeg>();
  for (const fragment of orderedPatternLegs(geometry)) {
    const shard = preparedShard(fragment, geometry);
    if ('kind' in shard) return shard;
    shardsById.set(fragment.id, shard);
    const logicalId = fragment.logicalPatternLegFragmentId;
    const logical = mutableLogicalLegs.get(logicalId);
    if (logical === undefined) {
      mutableLogicalLegs.set(logicalId, firstLogicalLeg(shard));
      idBytes(logicalId, geometry.idBytesById);
      continue;
    }
    if (!sameLogicalLeg(logical, shard)) {
      return rejection('logical-pattern-leg-conflict', logicalId);
    }
    logical.shards.push(shard);
  }

  for (const visibleId of geometry.visiblePatternLegIds) {
    if (!shardsById.has(visibleId)) {
      return rejection('missing-visible-pattern-leg-fragment', visibleId);
    }
  }

  const logicalPatternLegsById = new Map<string, PreparedLogicalPatternLeg>();
  const logicalIds = [...mutableLogicalLegs.keys()].sort((left, right) =>
    compareIds(left, right, geometry),
  );
  for (const logicalId of logicalIds) {
    const logical = mutableLogicalLegs.get(logicalId);
    if (logical === undefined) continue;
    logicalPatternLegsById.set(logicalId, {
      ...logical,
      shards: logical.shards.sort((left, right) => compareShards(left, right, geometry)),
    });
  }
  return { kind: 'ready', input: { shardsById, logicalPatternLegsById } };
}

/**
 * Normalizes only the transferred geometry records consumed by Line assembly.
 * General entity, relationship, cursor, and cross-page validation remain at
 * the network-result boundary.
 */
export function prepareLineSpanInput(
  chunks: readonly ResolvedNetworkChunk[],
): PrepareLineSpanInputResult {
  const collected = collectGeometry(chunks);
  return collected.kind === 'ready' ? prepareLogicalLegs(collected.geometry) : collected;
}
