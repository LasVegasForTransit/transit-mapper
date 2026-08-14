import { updateRenderPreparationMap } from './render-preparation-map';
import type { RenderViewportCandidateSets } from './render-viewport-candidates';
import {
  ALL_PREPARED_VIEWPORT_CATEGORIES,
  preparedViewportCategoryCandidateIds,
  type PreparedViewportDraft,
  type PreparedViewportSegment,
  type PreparedViewportState,
} from './render-preparation-viewport';
import { queryViewportSpatialGrid } from './viewport-spatial-grid';
import type { RenderViewportCategory } from './viewport-index';

export function preparedViewportFinalizeOperationCount(draft: PreparedViewportDraft): number {
  return (
    ALL_PREPARED_VIEWPORT_CATEGORIES.length +
    draft.latestUpdates.size +
    draft.rankUpdates.size +
    draft.ownerUpdates.size
  );
}

export function preparedViewportCandidates(
  draft: PreparedViewportDraft,
  categories: ReadonlySet<RenderViewportCategory>,
): RenderViewportCandidateSets {
  const ids = (category: RenderViewportCategory) =>
    categories.has(category) ? preparedViewportCategoryCandidateIds(draft, category) : undefined;
  const wayIds = ids('corridor');
  return {
    wayIds,
    ...(wayIds ? { wayIdSet: draft.candidateIds.get('corridor') } : {}),
    junctionIds: ids('junction'),
    stopIds: ids('stop'),
    stationIds: ids('station'),
    labelIds: ids('label'),
    wayHandleIds: ids('way-handle'),
    serviceTerminusIds: ids('service-terminus'),
    facilityIds: ids('facility'),
    groupIds: ids('group'),
    physicalHandleIds: ids('physical-handle'),
  };
}

export function finalizePreparedViewportState(
  draft: PreparedViewportDraft,
  kind: 'cold' | 'incremental' | 'camera',
): PreparedViewportState {
  const segments = new Map<RenderViewportCategory, readonly PreparedViewportSegment[]>();
  for (const category of ALL_PREPARED_VIEWPORT_CATEGORIES) {
    segments.set(category, [
      ...(draft.base.segments.get(category) ?? []),
      ...(draft.appendedSegments.get(category) ?? []),
    ]);
  }
  return {
    segments,
    latestGenerationById: updateRenderPreparationMap(
      draft.base.latestGenerationById,
      draft.latestUpdates,
      new Set(),
    ),
    rankById: updateRenderPreparationMap(draft.base.rankById, draft.rankUpdates, new Set()),
    entryIdsByOwner: updateRenderPreparationMap(
      draft.base.entryIdsByOwner,
      draft.ownerUpdates,
      new Set(),
    ),
    nextRank: draft.nextRank,
    incrementalLayerCount:
      kind === 'cold'
        ? 0
        : kind === 'incremental'
          ? draft.base.incrementalLayerCount + 1
          : draft.base.incrementalLayerCount,
  };
}

export function preparedViewportSegmentCounts(
  state: PreparedViewportState,
  categories: readonly RenderViewportCategory[],
): readonly { category: RenderViewportCategory; count: number }[] {
  return categories.map((category) => ({
    category,
    count: state.segments.get(category)?.length ?? 0,
  }));
}

export function queryPreparedViewportState(
  state: PreparedViewportState,
  category: RenderViewportCategory,
  bounds: [[number, number], [number, number]],
  marginDegrees: number,
): readonly string[] {
  const byRank = new Map<string, number>();
  for (const segment of state.segments.get(category) ?? []) {
    for (const id of queryViewportSpatialGrid(segment.grid, bounds, marginDegrees).ids) {
      if (state.latestGenerationById.get(id) !== segment.generation) continue;
      const rank = state.rankById.get(id);
      if (rank !== undefined) byRank.set(id, rank);
    }
  }
  return [...byRank].sort((left, right) => left[1] - right[1]).map(([id]) => id);
}
