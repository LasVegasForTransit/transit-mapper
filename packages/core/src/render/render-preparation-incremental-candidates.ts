import { RenderPreparationMutableSet } from './render-preparation-map';
import type { RenderPreparationPlanBuilder } from './render-preparation-plan-builder';
import type { RenderViewportCandidateSets } from './render-viewport-candidates';

const CANDIDATE_COPY_CHUNK_SIZE = 256;

export interface AddIncrementalPreparedCandidatePlanOptions {
  readonly builder: RenderPreparationPlanBuilder;
  readonly current: RenderViewportCandidateSets;
  readonly changedWayIds: ReadonlySet<string>;
  readonly changedLabelIds: ReadonlySet<string>;
  readonly additions: () => RenderViewportCandidateSets;
  readonly rankForId: (id: string) => number | undefined;
  readonly accept: (candidates: RenderViewportCandidateSets) => void;
}

interface CandidateCategoryDraft {
  readonly current: readonly string[] | undefined;
  readonly changedIds: ReadonlySet<string>;
  readonly output: string[];
  readonly ids?: RenderPreparationMutableSet<string>;
  visibleChanges: readonly string[];
  present: boolean;
}

function createCategoryDraft(
  current: readonly string[] | undefined,
  changedIds: ReadonlySet<string>,
  withSet: boolean,
): CandidateCategoryDraft {
  return {
    current,
    changedIds,
    output: [],
    ...(withSet ? { ids: new RenderPreparationMutableSet<string>() } : {}),
    visibleChanges: [],
    present: current !== undefined,
  };
}

function compareRankedIds(
  left: string,
  right: string,
  rankForId: AddIncrementalPreparedCandidatePlanOptions['rankForId'],
): number {
  const rankDifference =
    (rankForId(left) ?? Number.MAX_SAFE_INTEGER) - (rankForId(right) ?? Number.MAX_SAFE_INTEGER);
  return rankDifference || (left < right ? -1 : left > right ? 1 : 0);
}

function copyRetainedRange(draft: CandidateCategoryDraft, start: number, end: number): void {
  const current = draft.current ?? [];
  for (let index = start; index < Math.min(end, current.length); index++) {
    const id = current[index];
    if (draft.changedIds.has(id)) continue;
    draft.output.push(id);
    draft.ids?.add(id);
  }
}

function insertionIndex(
  values: readonly string[],
  id: string,
  rankForId: AddIncrementalPreparedCandidatePlanOptions['rankForId'],
): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (compareRankedIds(values[middle], id, rankForId) < 0) low = middle + 1;
    else high = middle;
  }
  return low;
}

function insertVisibleChanges(
  draft: CandidateCategoryDraft,
  rankForId: AddIncrementalPreparedCandidatePlanOptions['rankForId'],
): void {
  for (const id of draft.visibleChanges) {
    draft.output.splice(insertionIndex(draft.output, id, rankForId), 0, id);
    draft.ids?.add(id);
  }
}

function addRetainedCandidateRanges(
  builder: RenderPreparationPlanBuilder,
  label: string,
  draft: CandidateCategoryDraft,
): void {
  const count = draft.current?.length ?? 0;
  builder.addUnitRange(
    Math.ceil(count / CANDIDATE_COPY_CHUNK_SIZE),
    'finalize',
    `candidate-retain:${label}`,
    (index) => Math.min(CANDIDATE_COPY_CHUNK_SIZE, count - index * CANDIDATE_COPY_CHUNK_SIZE),
    (index) => {
      const start = index * CANDIDATE_COPY_CHUNK_SIZE;
      copyRetainedRange(draft, start, start + CANDIDATE_COPY_CHUNK_SIZE);
    },
  );
}

/** Builds the two changed candidate categories cooperatively. Every other
 * category keeps the exact prior immutable array reference. */
export function addIncrementalPreparedCandidatePlan(
  options: AddIncrementalPreparedCandidatePlanOptions,
): void {
  const way = createCategoryDraft(options.current.wayIds, options.changedWayIds, true);
  const label = createCategoryDraft(options.current.labelIds, options.changedLabelIds, false);
  options.builder.addUnit(
    'finalize',
    options.changedWayIds.size + options.changedLabelIds.size,
    () => {
      const additions = options.additions();
      way.present ||= additions.wayIds !== undefined;
      label.present ||= additions.labelIds !== undefined;
      way.visibleChanges = [...new Set(additions.wayIds ?? [])].sort((left, right) =>
        compareRankedIds(left, right, options.rankForId),
      );
      label.visibleChanges = [...new Set(additions.labelIds ?? [])].sort((left, right) =>
        compareRankedIds(left, right, options.rankForId),
      );
    },
    'candidate-setup',
  );
  addRetainedCandidateRanges(options.builder, 'corridor', way);
  options.builder.addUnit(
    'finalize',
    options.changedWayIds.size,
    () => insertVisibleChanges(way, options.rankForId),
    'candidate-changes:corridor',
  );
  addRetainedCandidateRanges(options.builder, 'label', label);
  options.builder.addUnit(
    'finalize',
    options.changedLabelIds.size,
    () => insertVisibleChanges(label, options.rankForId),
    'candidate-changes:label',
  );
  options.builder.addUnit(
    'finalize',
    1,
    () => {
      const wayIds = way.present ? way.output : undefined;
      options.accept({
        ...options.current,
        wayIds,
        ...(wayIds ? { wayIdSet: way.ids } : { wayIdSet: undefined }),
        labelIds: label.present ? label.output : undefined,
      });
    },
    'candidate-publish',
  );
}
