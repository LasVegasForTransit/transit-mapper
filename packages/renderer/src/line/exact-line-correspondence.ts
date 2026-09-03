import type { LineOrderEntry, TransitCarrierRef } from '@transitmapper/core/transit/value-types';
import {
  collectActiveSpans,
  compareRankedLineSpans,
  insertActiveSpan,
  removeActiveSpan,
  type ActiveSpanNode,
  type RankedLineSpan,
} from './line-exact-correspondence-active-spans';
import type { LineSpan } from './line-span-types';

export interface LineMaterialization {
  readonly lineId: string;
  readonly spans: readonly LineSpan[];
}

export interface ExactLineCorrespondenceInput {
  readonly lineOrder: readonly LineOrderEntry[];
  readonly materializations: readonly LineMaterialization[];
}

export interface ExactLineCorrespondence {
  readonly canonicalCarrier: TransitCarrierRef;
  readonly canonicalCarrierRange: readonly [number, number];
  readonly lineIds: readonly [string, string, ...string[]];
  readonly members: readonly [LineSpan, ...LineSpan[]];
}

type ExactLineCorrespondenceRejectionReason =
  | 'invalid-line-order'
  | 'missing-line-order'
  | 'missing-line-materialization'
  | 'line-scope-conflict'
  | 'duplicate-line-materialization'
  | 'invalid-canonical-carrier-range';

export type ExactLineCorrespondenceResult =
  | { readonly kind: 'ready'; readonly correspondences: readonly ExactLineCorrespondence[] }
  | {
      readonly kind: 'rejected';
      readonly reason: ExactLineCorrespondenceRejectionReason;
      readonly recordId: string;
    };

interface CarrierGroup {
  readonly carrier: TransitCarrierRef;
  readonly spans: readonly LineSpan[];
}

interface CarrierBoundaryEvent {
  readonly kind: 'start' | 'end';
  readonly position: number;
  readonly span: RankedLineSpan;
}

interface PreparedLineOrder {
  readonly rankByLineId: ReadonlyMap<string, number>;
}

type PreparedLineOrderResult =
  | { readonly kind: 'ready'; readonly order: PreparedLineOrder }
  | Extract<ExactLineCorrespondenceResult, { readonly kind: 'rejected' }>;

const textEncoder = new TextEncoder();

function compareIds(left: string, right: string): number {
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftBytes[index] ?? 0) - (rightBytes[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

function compareOptionalIds(left: string | undefined, right: string | undefined): number {
  if (left === undefined) return right === undefined ? 0 : -1;
  if (right === undefined) return 1;
  return compareIds(left, right);
}

function compareCarrier(left: TransitCarrierRef, right: TransitCarrierRef): number {
  const kindDifference = (left.kind === 'way' ? 0 : 1) - (right.kind === 'way' ? 0 : 1);
  if (kindDifference !== 0) return kindDifference;
  const idDifference = compareIds(left.id, right.id);
  if (idDifference !== 0) return idDifference;
  return compareOptionalIds(
    left.kind === 'way' ? left.laneId : undefined,
    right.kind === 'way' ? right.laneId : undefined,
  );
}

function canonicalCarrier(carrier: TransitCarrierRef): TransitCarrierRef {
  if (carrier.kind === 'alignment') return { kind: 'alignment', id: carrier.id };
  return carrier.laneId === undefined
    ? { kind: 'way', id: carrier.id }
    : { kind: 'way', id: carrier.id, laneId: carrier.laneId };
}

function carrierKey(carrier: TransitCarrierRef): string {
  return carrier.kind === 'alignment'
    ? JSON.stringify(['alignment', carrier.id])
    : JSON.stringify(['way', carrier.id, carrier.laneId ?? null]);
}

function rejected(
  reason: ExactLineCorrespondenceRejectionReason,
  recordId: string,
): Extract<ExactLineCorrespondenceResult, { readonly kind: 'rejected' }> {
  return { kind: 'rejected', reason, recordId };
}

function firstLineIdAfterRank(
  lineIdByRank: ReadonlyMap<number, string>,
  rank: number,
): string | undefined {
  let nextRank = Number.POSITIVE_INFINITY;
  let lineId: string | undefined;
  for (const [candidateRank, candidateLineId] of lineIdByRank) {
    if (candidateRank > rank && candidateRank < nextRank) {
      nextRank = candidateRank;
      lineId = candidateLineId;
    }
  }
  return lineId;
}

function prepareLineOrder(lineOrder: readonly LineOrderEntry[]): PreparedLineOrderResult {
  const rankByLineId = new Map<string, number>();
  const lineIdByRank = new Map<number, string>();
  for (const entry of lineOrder) {
    if (!Number.isSafeInteger(entry.rank) || entry.rank < 0 || rankByLineId.has(entry.lineId)) {
      return rejected('invalid-line-order', entry.lineId);
    }
    const rankOwner = lineIdByRank.get(entry.rank);
    if (rankOwner !== undefined) {
      return rejected(
        'invalid-line-order',
        compareIds(rankOwner, entry.lineId) <= 0 ? rankOwner : entry.lineId,
      );
    }
    rankByLineId.set(entry.lineId, entry.rank);
    lineIdByRank.set(entry.rank, entry.lineId);
  }
  for (let rank = 0; rank < lineIdByRank.size; rank += 1) {
    if (!lineIdByRank.has(rank))
      return rejected('invalid-line-order', firstLineIdAfterRank(lineIdByRank, rank) ?? '');
  }
  return { kind: 'ready', order: { rankByLineId } };
}

function missingLineOrderRejection(
  materializations: readonly LineMaterialization[],
  ranks: ReadonlyMap<string, number>,
): Extract<ExactLineCorrespondenceResult, { readonly kind: 'rejected' }> | undefined {
  const lineId = materializations
    .map(({ lineId }) => lineId)
    .filter((lineId) => !ranks.has(lineId))
    .sort(compareIds)
    .at(0);
  return lineId === undefined ? undefined : rejected('missing-line-order', lineId);
}

function missingLineMaterializationRejection(
  materializations: readonly LineMaterialization[],
  ranks: ReadonlyMap<string, number>,
): Extract<ExactLineCorrespondenceResult, { readonly kind: 'rejected' }> | undefined {
  const materializedLineIds = new Set(materializations.map(({ lineId }) => lineId));
  const lineId = [...ranks]
    .sort((left, right) => left[1] - right[1])
    .map(([candidateLineId]) => candidateLineId)
    .find((candidateLineId) => !materializedLineIds.has(candidateLineId));
  return lineId === undefined ? undefined : rejected('missing-line-materialization', lineId);
}

function materializationIntegrityRejection(
  materializations: readonly LineMaterialization[],
): Extract<ExactLineCorrespondenceResult, { readonly kind: 'rejected' }> | undefined {
  const wrapperCounts = new Map<string, number>();
  for (const { lineId } of materializations)
    wrapperCounts.set(lineId, (wrapperCounts.get(lineId) ?? 0) + 1);
  const duplicateLineId = [...wrapperCounts]
    .filter(([, count]) => count > 1)
    .map(([lineId]) => lineId)
    .sort(compareIds)
    .at(0);
  if (duplicateLineId !== undefined)
    return rejected('duplicate-line-materialization', duplicateLineId);
  const conflictingSpan = materializations
    .flatMap(({ lineId, spans }) => spans.map((span) => ({ lineId, span })))
    .filter(({ lineId, span }) => lineId !== span.lineId)
    .sort((left, right) => compareIds(left.span.id, right.span.id))
    .at(0);
  return conflictingSpan === undefined
    ? undefined
    : rejected('line-scope-conflict', conflictingSpan.span.id);
}

function validCanonicalCarrierRange(range: readonly [number, number]): boolean {
  return (
    Number.isFinite(range[0]) &&
    Number.isFinite(range[1]) &&
    range[0] >= 0 &&
    range[0] < range[1] &&
    range[1] <= 1
  );
}

function invalidCanonicalCarrierRangeRejection(
  materializations: readonly LineMaterialization[],
): Extract<ExactLineCorrespondenceResult, { readonly kind: 'rejected' }> | undefined {
  const span = materializations
    .flatMap(({ spans }) => spans)
    .filter(({ canonicalCarrierRange }) => !validCanonicalCarrierRange(canonicalCarrierRange))
    .sort((left, right) => compareIds(left.id, right.id))
    .at(0);
  return span === undefined ? undefined : rejected('invalid-canonical-carrier-range', span.id);
}

function nonempty<T>(values: readonly T[]): readonly [T, ...T[]] | undefined {
  const [first, ...rest] = values;
  return first === undefined ? undefined : [first, ...rest];
}

function atLeastTwo<T>(values: readonly T[]): readonly [T, T, ...T[]] | undefined {
  const [first, second, ...rest] = values;
  return first === undefined || second === undefined ? undefined : [first, second, ...rest];
}

function compareBoundaryEvents(left: CarrierBoundaryEvent, right: CarrierBoundaryEvent): number {
  const positionDifference = left.position - right.position;
  if (positionDifference !== 0) return positionDifference;
  const kindDifference = (left.kind === 'end' ? 0 : 1) - (right.kind === 'end' ? 0 : 1);
  return kindDifference !== 0 ? kindDifference : compareRankedLineSpans(left.span, right.span);
}

function carrierBoundaryEvents(
  group: CarrierGroup,
  ranks: ReadonlyMap<string, number>,
): readonly CarrierBoundaryEvent[] {
  const events: CarrierBoundaryEvent[] = [];
  for (const span of group.spans) {
    const lineRank = ranks.get(span.lineId);
    if (lineRank === undefined)
      throw new Error('Validated Line materialization lacks a Line rank.');
    const [start, end] = span.canonicalCarrierRange;
    if (start >= end) continue;
    const rankedSpan = { span, lineRank } satisfies RankedLineSpan;
    events.push({ kind: 'start', position: start, span: rankedSpan });
    events.push({ kind: 'end', position: end, span: rankedSpan });
  }
  return events.sort(compareBoundaryEvents);
}

function groupByCarrier(materializations: readonly LineMaterialization[]): readonly CarrierGroup[] {
  const groupsByKey = new Map<string, { carrier: TransitCarrierRef; spans: LineSpan[] }>();
  for (const { spans } of materializations) {
    for (const span of spans) {
      const carrier = canonicalCarrier(span.canonicalCarrier);
      const key = carrierKey(carrier);
      const group = groupsByKey.get(key);
      if (group === undefined) groupsByKey.set(key, { carrier, spans: [span] });
      else group.spans.push(span);
    }
  }
  return [...groupsByKey.values()].sort((left, right) =>
    compareCarrier(left.carrier, right.carrier),
  );
}

function correspondenceFromActiveSpans(
  carrier: TransitCarrierRef,
  range: readonly [number, number],
  root: ActiveSpanNode | undefined,
): ExactLineCorrespondence | undefined {
  const activeSpans: RankedLineSpan[] = [];
  collectActiveSpans(root, activeSpans);
  const members = nonempty(activeSpans.map(({ span }) => span));
  if (members === undefined) return undefined;
  const lineIds = atLeastTwo([...new Set(members.map(({ lineId }) => lineId))]);
  if (lineIds === undefined) return undefined;
  return { canonicalCarrier: carrier, canonicalCarrierRange: range, lineIds, members };
}

function decrementActiveLine(activeLineCounts: Map<string, number>, lineId: string): void {
  const count = activeLineCounts.get(lineId);
  if (count === undefined) throw new Error('Active Line span sweep lost a Line count.');
  if (count === 1) activeLineCounts.delete(lineId);
  else activeLineCounts.set(lineId, count - 1);
}

interface CarrierSweep {
  readonly activeLineCounts: Map<string, number>;
  root: ActiveSpanNode | undefined;
}

function applyCarrierBoundary(sweep: CarrierSweep, event: CarrierBoundaryEvent): void {
  const { lineId } = event.span.span;
  if (event.kind === 'end') {
    sweep.root = removeActiveSpan(sweep.root, event.span);
    decrementActiveLine(sweep.activeLineCounts, lineId);
    return;
  }
  sweep.root = insertActiveSpan(sweep.root, event.span);
  sweep.activeLineCounts.set(lineId, (sweep.activeLineCounts.get(lineId) ?? 0) + 1);
}

function advanceCarrierBoundaryEvents(
  events: readonly CarrierBoundaryEvent[],
  index: number,
  sweep: CarrierSweep,
): number {
  const boundary = events[index].position;
  while (index < events.length && events[index].position === boundary) {
    applyCarrierBoundary(sweep, events[index]);
    index += 1;
  }
  return index;
}

function correspondencesForCarrier(
  group: CarrierGroup,
  ranks: ReadonlyMap<string, number>,
): readonly ExactLineCorrespondence[] {
  const events = carrierBoundaryEvents(group, ranks);
  const correspondences: ExactLineCorrespondence[] = [];
  const sweep: CarrierSweep = { activeLineCounts: new Map(), root: undefined };
  for (let index = 0; index < events.length;) {
    const boundary = events[index].position;
    index = advanceCarrierBoundaryEvents(events, index, sweep);
    if (index === events.length || sweep.activeLineCounts.size < 2) continue;
    const nextBoundary = events[index].position;
    if (boundary >= nextBoundary) continue;
    const correspondence = correspondenceFromActiveSpans(
      group.carrier,
      [boundary, nextBoundary],
      sweep.root,
    );
    if (correspondence !== undefined) correspondences.push(correspondence);
  }
  return correspondences;
}

/** Finds exact shared canonical-carrier intervals without inspecting visible geometry. */
export function deriveExactLineCorrespondence(
  input: ExactLineCorrespondenceInput,
): ExactLineCorrespondenceResult {
  const lineOrder = prepareLineOrder(input.lineOrder);
  if (lineOrder.kind === 'rejected') return lineOrder;
  const integrityRejection = materializationIntegrityRejection(input.materializations);
  if (integrityRejection !== undefined) return integrityRejection;
  const invalidCanonicalCarrierRange = invalidCanonicalCarrierRangeRejection(
    input.materializations,
  );
  if (invalidCanonicalCarrierRange !== undefined) return invalidCanonicalCarrierRange;
  const missingLineOrder = missingLineOrderRejection(
    input.materializations,
    lineOrder.order.rankByLineId,
  );
  if (missingLineOrder !== undefined) return missingLineOrder;
  const missingMaterialization = missingLineMaterializationRejection(
    input.materializations,
    lineOrder.order.rankByLineId,
  );
  if (missingMaterialization !== undefined) return missingMaterialization;
  const correspondences: ExactLineCorrespondence[] = [];
  for (const group of groupByCarrier(input.materializations))
    correspondences.push(...correspondencesForCarrier(group, lineOrder.order.rankByLineId));
  return { kind: 'ready', correspondences };
}
