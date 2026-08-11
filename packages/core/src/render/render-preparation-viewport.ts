import type { RenderPresentation } from './render-presentation';
import {
  renderCandidateEnvelopeBounds,
  type RenderCandidateEnvelope,
} from './render-candidate-envelope';
import { RenderPreparationMutableMap, RenderPreparationMutableSet } from './render-preparation-map';
import type { RenderViewportCategory } from './viewport-index';
import { renderViewportTransitionMarginDegrees } from './render-viewport-margin';
import type { ViewportSpatialEntry } from './viewport-index-entries';
import {
  appendUnindexedViewportSpatialEntry,
  beginViewportSpatialQuery,
  buildViewportSpatialGrid,
  createViewportSpatialGridDraft,
  finalizeViewportSpatialGrid,
  normalizeViewportSpatialBounds,
  indexViewportSpatialEntry,
  reserveViewportSpatialEntryCapacity,
  queryViewportSpatialGrid,
  queryViewportSpatialGridRange,
  type ViewportSpatialGrid,
  type ViewportSpatialGridDraft,
  type ViewportSpatialQuery,
  type NormalizedViewportBounds,
  viewportSpatialEntryIntersectsNormalizedBounds,
} from './viewport-spatial-grid';

export interface PreparedViewportSegment {
  readonly generation: number;
  readonly grid: ViewportSpatialGrid;
}

export interface PreparedViewportState {
  readonly segments: ReadonlyMap<RenderViewportCategory, readonly PreparedViewportSegment[]>;
  readonly latestGenerationById: ReadonlyMap<string, number>;
  readonly rankById: ReadonlyMap<string, number>;
  readonly entryIdsByOwner: ReadonlyMap<string, readonly string[]>;
  readonly nextRank: number;
  readonly incrementalLayerCount: number;
}

export interface ViewportOwnerEntries {
  readonly ownerId: string;
  readonly entries: readonly ViewportSpatialEntry[];
}

export interface ColdPreparedViewportCategory {
  readonly grid: ViewportSpatialGridDraft;
  candidateBounds?: NormalizedViewportBounds;
  queryGrid?: ViewportSpatialGrid;
}

export interface PreparedViewportDraft {
  readonly base: PreparedViewportState;
  readonly appendedSegments: Map<RenderViewportCategory, PreparedViewportSegment[]>;
  readonly latestUpdates: RenderPreparationMutableMap<string, number>;
  readonly rankUpdates: RenderPreparationMutableMap<string, number>;
  readonly ownerUpdates: RenderPreparationMutableMap<string, readonly string[]>;
  readonly candidateOrder: Map<RenderViewportCategory, string[]>;
  readonly candidateCounts: Map<RenderViewportCategory, number>;
  readonly candidateIds: Map<RenderViewportCategory, RenderPreparationMutableSet<string>>;
  nextRank: number;
}

export const ALL_PREPARED_VIEWPORT_CATEGORIES: readonly RenderViewportCategory[] = [
  'corridor',
  'junction',
  'station',
  'label',
  'way-handle',
  'service-terminus',
  'facility',
  'group',
  'physical-handle',
];

function ownerKey(category: RenderViewportCategory, ownerId: string): string {
  return `${category}\u0000${ownerId}`;
}

export function emptyPreparedViewportState(): PreparedViewportState {
  return {
    segments: new Map(ALL_PREPARED_VIEWPORT_CATEGORIES.map((category) => [category, []])),
    latestGenerationById: new Map(),
    rankById: new Map(),
    entryIdsByOwner: new Map(),
    nextRank: 0,
    incrementalLayerCount: 0,
  };
}

export function createPreparedViewportDraft(base: PreparedViewportState): PreparedViewportDraft {
  return {
    base,
    appendedSegments: new Map(),
    latestUpdates: new RenderPreparationMutableMap(),
    rankUpdates: new RenderPreparationMutableMap(),
    ownerUpdates: new RenderPreparationMutableMap(),
    candidateOrder: new Map(ALL_PREPARED_VIEWPORT_CATEGORIES.map((category) => [category, []])),
    candidateCounts: new Map(ALL_PREPARED_VIEWPORT_CATEGORIES.map((category) => [category, 0])),
    candidateIds: new Map(
      ALL_PREPARED_VIEWPORT_CATEGORIES.map((category) => [
        category,
        new RenderPreparationMutableSet<string>(),
      ]),
    ),
    nextRank: base.nextRank,
  };
}

function currentRank(draft: PreparedViewportDraft, id: string): number | undefined {
  return draft.rankUpdates.get(id) ?? draft.base.rankById.get(id);
}

function currentGeneration(draft: PreparedViewportDraft, id: string): number | undefined {
  return draft.latestUpdates.get(id) ?? draft.base.latestGenerationById.get(id);
}

function ownerEntryIds(
  draft: PreparedViewportDraft,
  category: RenderViewportCategory,
  id: string,
): readonly string[] {
  const key = ownerKey(category, id);
  return draft.ownerUpdates.get(key) ?? draft.base.entryIdsByOwner.get(key) ?? [];
}

export interface PreparedViewportCandidateQuery {
  readonly presentation: RenderPresentation;
  readonly candidateEnvelope?: RenderCandidateEnvelope;
}

function collectSegmentCandidates(
  draft: PreparedViewportDraft,
  category: RenderViewportCategory,
  segment: PreparedViewportSegment,
  query: PreparedViewportCandidateQuery,
): void {
  const result = queryViewportSpatialGrid(
    segment.grid,
    renderCandidateEnvelopeBounds(query.presentation, query.candidateEnvelope),
    renderViewportTransitionMarginDegrees(query.presentation),
  );
  for (const id of result.ids) {
    recordCandidate(draft, category, id, segment.generation);
  }
}

function recordCandidate(
  draft: PreparedViewportDraft,
  category: RenderViewportCategory,
  id: string,
  generation: number,
): void {
  if (currentGeneration(draft, id) !== generation) return;
  const order = draft.candidateOrder.get(category);
  const candidateIds = draft.candidateIds.get(category);
  if (!order || !candidateIds || candidateIds.has(id)) return;
  candidateIds.add(id);
  const count = draft.candidateCounts.get(category) ?? 0;
  order[count] = id;
  draft.candidateCounts.set(category, count + 1);
}

export function createColdPreparedViewportCategory(): ColdPreparedViewportCategory {
  return { grid: createViewportSpatialGridDraft() };
}

export function reserveColdPreparedViewportEntries(
  cold: ColdPreparedViewportCategory,
  entryCount: number,
): void {
  reserveViewportSpatialEntryCapacity(cold.grid, entryCount);
}

export function reservePreparedViewportCandidates(
  draft: PreparedViewportDraft,
  category: RenderViewportCategory,
  additionalCandidates: number,
): void {
  const order = draft.candidateOrder.get(category);
  if (!order) return;
  const count = draft.candidateCounts.get(category) ?? 0;
  order.length = Math.max(order.length, count + additionalCandidates);
}

export interface RecordColdViewportEntryMetadataOptions {
  readonly draft: PreparedViewportDraft;
  readonly category: RenderViewportCategory;
  readonly ownerId: string;
  readonly entry: ViewportSpatialEntry;
  readonly generation: number;
  readonly presentation: RenderPresentation;
  readonly candidateEnvelope?: RenderCandidateEnvelope;
  readonly cold: ColdPreparedViewportCategory;
}

export type RecordColdViewportEntryIdentityOptions = Omit<
  RecordColdViewportEntryMetadataOptions,
  'presentation' | 'candidateEnvelope'
>;

export function appendColdViewportGeometry(
  cold: ColdPreparedViewportCategory,
  entry: ViewportSpatialEntry,
): void {
  cold.queryGrid = undefined;
  appendUnindexedViewportSpatialEntry(cold.grid, entry);
}

export function recordColdViewportEntryIdentity({
  draft,
  category,
  ownerId,
  entry,
  generation,
}: RecordColdViewportEntryIdentityOptions): void {
  for (const priorId of ownerEntryIds(draft, category, ownerId)) {
    draft.latestUpdates.set(priorId, generation);
  }
  draft.latestUpdates.set(entry.id, generation);
  if (currentRank(draft, entry.id) === undefined) {
    draft.rankUpdates.set(entry.id, draft.nextRank++);
  }
  draft.ownerUpdates.set(ownerKey(category, ownerId), [entry.id]);
}

export function coldPreparedViewportCandidateBounds(
  cold: ColdPreparedViewportCategory,
  presentation: RenderPresentation,
  candidateEnvelope?: RenderCandidateEnvelope,
): NormalizedViewportBounds {
  cold.candidateBounds ??= normalizeViewportSpatialBounds(
    renderCandidateEnvelopeBounds(presentation, candidateEnvelope),
    renderViewportTransitionMarginDegrees(presentation),
  );
  return cold.candidateBounds;
}

export function recordColdViewportEntryCandidate(
  draft: PreparedViewportDraft,
  category: RenderViewportCategory,
  entry: ViewportSpatialEntry,
  generation: number,
): void {
  recordCandidate(draft, category, entry.id, generation);
}

export function recordColdViewportEntryMetadata({
  draft,
  category,
  ownerId,
  entry,
  generation,
  presentation,
  candidateEnvelope,
  cold,
}: RecordColdViewportEntryMetadataOptions): void {
  recordColdViewportEntryIdentity({ draft, category, ownerId, entry, generation, cold });
  if (
    viewportSpatialEntryIntersectsNormalizedBounds(
      entry,
      coldPreparedViewportCandidateBounds(cold, presentation, candidateEnvelope),
    )
  ) {
    recordColdViewportEntryCandidate(draft, category, entry, generation);
  }
}

export function indexColdPreparedViewportEntry(
  cold: ColdPreparedViewportCategory,
  entryIndex: number,
): void {
  indexViewportSpatialEntry(cold.grid, entryIndex);
}

export function finalizeColdPreparedViewportCategory(
  draft: PreparedViewportDraft,
  category: RenderViewportCategory,
  generation: number,
  cold: ColdPreparedViewportCategory,
): void {
  if (cold.grid.entries.length === 0) return;
  draft.appendedSegments.set(category, [
    { generation, grid: (cold.queryGrid ??= finalizeViewportSpatialGrid(cold.grid)) },
  ]);
}

/** Queries the category-wide grid while a cold plan is still being built.
 * The returned IDs are authoritative spatial candidates; callers can apply a
 * domain-specific exact predicate without constructing a second city index. */
export function queryColdPreparedViewportCategory(
  cold: ColdPreparedViewportCategory,
  bounds: [[number, number], [number, number]],
  marginDegrees: number,
): readonly string[] {
  return queryViewportSpatialGrid(
    (cold.queryGrid ??= finalizeViewportSpatialGrid(cold.grid)),
    bounds,
    marginDegrees,
  ).ids;
}

/** Replaces only the supplied owners and immediately queries the new segment.
 * Existing segments remain immutable and are suppressed by generation. */
export interface ReplaceViewportOwnersOptions {
  readonly draft: PreparedViewportDraft;
  readonly category: RenderViewportCategory;
  readonly owners: readonly ViewportOwnerEntries[];
  readonly generation: number;
  readonly presentation: RenderPresentation;
  readonly candidateEnvelope?: RenderCandidateEnvelope;
}

export function replaceAndQueryViewportOwners({
  draft,
  category,
  owners,
  generation,
  presentation,
  candidateEnvelope,
}: ReplaceViewportOwnersOptions): void {
  const entries: ViewportSpatialEntry[] = [];
  for (const owner of owners) {
    for (const priorId of ownerEntryIds(draft, category, owner.ownerId)) {
      draft.latestUpdates.set(priorId, generation);
    }
    const nextIds: string[] = [];
    for (const entry of owner.entries) {
      nextIds.push(entry.id);
      draft.latestUpdates.set(entry.id, generation);
      if (currentRank(draft, entry.id) === undefined) {
        draft.rankUpdates.set(entry.id, draft.nextRank++);
      }
      entries.push(entry);
    }
    draft.ownerUpdates.set(ownerKey(category, owner.ownerId), nextIds);
  }
  if (entries.length === 0) return;
  const segment = {
    generation,
    grid: buildViewportSpatialGrid(entries, { totalEntries: 0 }),
  };
  const appended = draft.appendedSegments.get(category) ?? [];
  appended.push(segment);
  draft.appendedSegments.set(category, appended);
  collectSegmentCandidates(draft, category, segment, { presentation, candidateEnvelope });
}

export function queryPreparedViewportSegment(
  draft: PreparedViewportDraft,
  category: RenderViewportCategory,
  segmentIndex: number,
  query: PreparedViewportCandidateQuery,
): void {
  const segment = draft.base.segments.get(category)?.[segmentIndex];
  if (segment) {
    collectSegmentCandidates(draft, category, segment, query);
  }
}

export interface PreparedViewportSegmentQuery {
  readonly segment: PreparedViewportSegment;
  readonly query: ViewportSpatialQuery;
}

export function preparedViewportSegmentEntryCount(
  state: PreparedViewportState,
  category: RenderViewportCategory,
  segmentIndex: number,
): number {
  return state.segments.get(category)?.[segmentIndex]?.grid.entries.length ?? 0;
}

export function beginPreparedViewportSegmentQuery(
  state: PreparedViewportState,
  category: RenderViewportCategory,
  segmentIndex: number,
  candidateQuery: PreparedViewportCandidateQuery,
): PreparedViewportSegmentQuery | null {
  const segment = state.segments.get(category)?.[segmentIndex];
  if (!segment) return null;
  return {
    segment,
    query: beginViewportSpatialQuery(
      segment.grid,
      renderCandidateEnvelopeBounds(candidateQuery.presentation, candidateQuery.candidateEnvelope),
      renderViewportTransitionMarginDegrees(candidateQuery.presentation),
    ),
  };
}

export interface QueryPreparedViewportSegmentRangeOptions {
  readonly draft: PreparedViewportDraft;
  readonly category: RenderViewportCategory;
  readonly prepared: PreparedViewportSegmentQuery;
  readonly start: number;
  readonly end: number;
}

export function queryPreparedViewportSegmentRange({
  draft,
  category,
  prepared,
  start,
  end,
}: QueryPreparedViewportSegmentRangeOptions): void {
  for (const id of queryViewportSpatialGridRange(prepared.query, start, end)) {
    recordCandidate(draft, category, id, prepared.segment.generation);
  }
}

export function preparedViewportCategoryCandidateIds(
  draft: PreparedViewportDraft,
  category: RenderViewportCategory,
): readonly string[] {
  const order = draft.candidateOrder.get(category) ?? [];
  order.length = draft.candidateCounts.get(category) ?? 0;
  return order;
}
