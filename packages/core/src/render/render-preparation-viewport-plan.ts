import type { RenderPreparationPlanBuilder } from './render-preparation-plan-builder';
import type { PlanRenderPreparationOptions } from './render-preparation-types';
import {
  beginPreparedViewportSegmentQuery,
  preparedViewportSegmentEntryCount,
  queryPreparedViewportSegmentRange,
  reservePreparedViewportCandidates,
  type PreparedViewportDraft,
  type PreparedViewportSegmentQuery,
  type PreparedViewportState,
} from './render-preparation-viewport';
import { preparedViewportSegmentCounts } from './render-preparation-viewport-state';
import type { RenderViewportCategory } from './viewport-index';

export interface AddBasePreparedViewportQueriesOptions {
  readonly builder: RenderPreparationPlanBuilder;
  readonly viewport: PreparedViewportDraft;
  readonly state: PreparedViewportState;
  readonly categories: readonly RenderViewportCategory[];
  readonly presentation: PlanRenderPreparationOptions['presentation'];
  readonly candidateEnvelope: PlanRenderPreparationOptions['candidateEnvelope'];
}

function addSegmentQuery(
  options: AddBasePreparedViewportQueriesOptions,
  category: RenderViewportCategory,
  segmentIndex: number,
): void {
  const entryChunkSize = 64;
  const entryCount = preparedViewportSegmentEntryCount(options.state, category, segmentIndex);
  const rangeCount = Math.ceil(entryCount / entryChunkSize);
  let prepared: PreparedViewportSegmentQuery | null = null;
  options.builder.runtime.operations.viewportSegmentQueries += 1 + rangeCount;
  options.builder.addUnit(
    'viewport-query',
    1,
    () => {
      prepared = beginPreparedViewportSegmentQuery(options.state, category, segmentIndex, {
        presentation: options.presentation,
        candidateEnvelope: options.candidateEnvelope,
      });
    },
    `candidates:${category}`,
  );
  options.builder.addUnitRange(
    rangeCount,
    'viewport-query',
    `exact:${category}`,
    (index) => Math.min(entryChunkSize, entryCount - index * entryChunkSize),
    (index) => {
      if (!prepared) throw new Error('Viewport candidate discovery must run before exact checks.');
      const start = index * entryChunkSize;
      queryPreparedViewportSegmentRange({
        draft: options.viewport,
        category,
        prepared,
        start,
        end: start + entryChunkSize,
      });
    },
  );
}

export function addBasePreparedViewportQueries(
  options: AddBasePreparedViewportQueriesOptions,
): void {
  for (const { category, count } of preparedViewportSegmentCounts(
    options.state,
    options.categories,
  )) {
    let categoryEntryCount = 0;
    for (let index = 0; index < count; index++) {
      categoryEntryCount += preparedViewportSegmentEntryCount(options.state, category, index);
    }
    reservePreparedViewportCandidates(options.viewport, category, categoryEntryCount);
    for (let index = 0; index < count; index++) addSegmentQuery(options, category, index);
  }
}
