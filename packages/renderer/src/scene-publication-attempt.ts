/**
 * Describes one bounded attempt to turn a scene draft into source mutations.
 *
 * Every attempt owns isolated draft and source-preparation state. This module
 * keeps that mechanical scheduling state out of the accepted-scene lifecycle.
 */
import type {
  CooperativeRenderJobUnit,
  CooperativeRenderJobUnitSequence,
} from './cooperative-render-job-scheduler';
import type { RenderSceneSourceMutationUnit } from './render-scene-source-updater';
import type { SceneDraftPlan } from './scene-draft';
import type {
  PreparedScenePublication,
  ScenePublicationContext,
  PublishSceneDraftOptions,
} from './scene-publication-types';

export interface ScenePublicationAttempt<Update> {
  readonly batchSize: number;
  plan: SceneDraftPlan | null;
  planUnitIndex: number;
  sourceCommit: PreparedScenePublication<Update> | null;
  sourceUnitIndex: number;
  sourceCpuPreparationIndex: number;
  commitErrorReported: boolean;
  sourcePublished: boolean;
  sourceStaged: boolean;
  postCommitSettlement: Promise<void> | null;
  readonly overBudgetYieldUnitIds: Set<string>;
  sourcePreparationStarted: boolean;
  sourcePreparationReady: boolean;
  sourcePreparationError: Error | null;
  sourcePreparationWaitIndex: number;
}

export function createScenePublicationAttempt<Update>(
  batchSize: number,
): ScenePublicationAttempt<Update> {
  return {
    batchSize,
    plan: null,
    planUnitIndex: 0,
    sourceCommit: null,
    sourceUnitIndex: 0,
    sourceCpuPreparationIndex: 0,
    commitErrorReported: false,
    sourcePublished: false,
    sourceStaged: false,
    postCommitSettlement: null,
    overBudgetYieldUnitIds: new Set(),
    sourcePreparationStarted: false,
    sourcePreparationReady: false,
    sourcePreparationError: null,
    sourcePreparationWaitIndex: 0,
  };
}

export function toPublicationError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}

export function sourcePublicationContext<Update>(
  sourceCommit: PreparedScenePublication<Update>,
): ScenePublicationContext {
  return {
    sourceIds: sourceCommit.sourceIds,
    clearedSourceIds: sourceCommit.clearedSourceIds ?? [],
    ...(sourceCommit.mode ? { mode: sourceCommit.mode } : {}),
    ...(sourceCommit.bank !== undefined ? { bank: sourceCommit.bank } : {}),
    ...(sourceCommit.targetsForDomainIdentity
      ? {
          targetsForDomainIdentity: (identity) =>
            sourceCommit.targetsForDomainIdentity?.(identity) ?? [],
        }
      : {}),
  };
}

function reportSourcePreparationFailure<Update>(
  options: PublishSceneDraftOptions<Update>,
  attempt: ScenePublicationAttempt<Update>,
  error: Error,
): never {
  if (!attempt.commitErrorReported && attempt.sourceCommit) {
    try {
      options.onCommitError?.(error, sourcePublicationContext(attempt.sourceCommit));
      attempt.commitErrorReported = true;
    } catch {
      // Recovery diagnostics cannot replace the preparation failure.
    }
  }
  throw error;
}

function sourcePreparationUnit<Update>(
  options: PublishSceneDraftOptions<Update>,
  attempt: ScenePublicationAttempt<Update>,
): RenderSceneSourceMutationUnit | null {
  const sourceCommit = attempt.sourceCommit;
  if (!sourceCommit || !options.beforeSourceMutation) return null;
  if (!attempt.sourcePreparationStarted) {
    attempt.sourcePreparationStarted = true;
    // Only this unit needs the registration. It hands control to the
    // renderer's own source machinery, so its duration is not this
    // scheduler's to divide or predict: it measured 7 ms against a 4 ms
    // budget on an ordinary cold start. Without yielding it failed the
    // publication every time, the bank transaction aborted, and no system of
    // any size ever published a first scene. The polling and failure units
    // below do no work, so they can never reach the budget check.
    const id = `scene-publication:source-preparation:${sourceCommit.mode ?? 'legacy'}:${sourceCommit.bank ?? 'none'}`;
    attempt.overBudgetYieldUnitIds.add(id);
    return {
      id,
      sliceExclusive: true,
      run: () => {
        try {
          const pending = options.beforeSourceMutation?.(sourcePublicationContext(sourceCommit));
          if (!pending) {
            attempt.sourcePreparationReady = true;
            return;
          }
          void pending.then(
            () => {
              attempt.sourcePreparationReady = true;
            },
            (thrown: unknown) => {
              attempt.sourcePreparationError = toPublicationError(thrown);
            },
          );
        } catch (thrown) {
          reportSourcePreparationFailure(options, attempt, toPublicationError(thrown));
        }
      },
    };
  }
  if (attempt.sourcePreparationError) {
    const error = attempt.sourcePreparationError;
    return {
      id: 'scene-publication:source-preparation:failed',
      sliceExclusive: true,
      run: () => reportSourcePreparationFailure(options, attempt, error),
    };
  }
  if (attempt.sourcePreparationReady) return null;
  const waitIndex = attempt.sourcePreparationWaitIndex++;
  return {
    id: `scene-publication:source-preparation:wait:${waitIndex}`,
    sliceExclusive: true,
    run() {},
  };
}

/** A completed private draft unit is immutable staged work. Its elapsed time
 * is scheduling evidence, not a reason to discard the draft and rebuild it. */
function toleratePrivateUnit(
  attempt: ScenePublicationAttempt<unknown>,
  unit: CooperativeRenderJobUnit<void>,
): CooperativeRenderJobUnit<void> {
  attempt.overBudgetYieldUnitIds.add(unit.id);
  return unit;
}

function createDraftPlanUnit<Update>(
  options: PublishSceneDraftOptions<Update>,
  attempt: ScenePublicationAttempt<Update>,
): CooperativeRenderJobUnit<void> {
  const id = `scene-publication:plan:${attempt.batchSize}`;
  return toleratePrivateUnit(attempt, {
    id,
    run: () => {
      attempt.plan = options.controller.draft(options.input, {
        batchSize: attempt.batchSize,
      });
    },
  });
}

function nextDraftWorkUnit<Update>(
  attempt: ScenePublicationAttempt<Update>,
): CooperativeRenderJobUnit<void> | null {
  const plan = attempt.plan;
  if (!plan) return null;
  const unit = plan.units.unitAt(attempt.planUnitIndex);
  if (!unit) return null;
  attempt.planUnitIndex += 1;
  return toleratePrivateUnit(attempt, unit);
}

function sourceCommitFor<Update>(
  options: PublishSceneDraftOptions<Update>,
  attempt: ScenePublicationAttempt<Update>,
): PreparedScenePublication<Update> | null {
  if (attempt.sourceCommit) return attempt.sourceCommit;
  const plan = attempt.plan;
  if (!plan || !options.controller.preparePublication) return null;
  attempt.sourceCommit = options.controller.preparePublication(plan.result());
  return attempt.sourceCommit;
}

function nextSourcePreparationUnit<Update>(
  attempt: ScenePublicationAttempt<Update>,
  sourceCommit: PreparedScenePublication<Update>,
): CooperativeRenderJobUnit<void> | null {
  const unit = sourceCommit.preparationUnits?.unitAt(attempt.sourceCpuPreparationIndex);
  if (!unit) return null;
  attempt.sourceCpuPreparationIndex += 1;
  return toleratePrivateUnit(attempt, unit);
}

/** GeoJSON mutations are side-effecting MapLibre boundaries. They cannot be
 * preempted or rolled back after return, so an overrun yields and remains in
 * the transaction's recorded performance facts instead of rejecting it. */
function nextSourceMutationUnit<Update>(
  options: PublishSceneDraftOptions<Update>,
  attempt: ScenePublicationAttempt<Update>,
  sourceCommit: PreparedScenePublication<Update>,
): CooperativeRenderJobUnit<void> | null {
  const unit = sourceCommit.units.at(attempt.sourceUnitIndex);
  if (!unit) return null;
  const startsMutation = attempt.sourceUnitIndex === 0;
  attempt.sourceUnitIndex += 1;
  attempt.overBudgetYieldUnitIds.add(unit.id);
  if (!startsMutation) return unit;
  return {
    ...unit,
    run: () => {
      options.onSourceMutationStart?.(
        sourceCommit.sourceIds,
        sourcePublicationContext(sourceCommit),
      );
      unit.run();
    },
  };
}

export function scenePublicationUnits<Update>(
  options: PublishSceneDraftOptions<Update>,
  attempt: ScenePublicationAttempt<Update>,
): CooperativeRenderJobUnitSequence<void> {
  return {
    unitAt(index) {
      if (index === 0) return createDraftPlanUnit(options, attempt);
      if (!attempt.plan) return undefined;
      const draftUnit = nextDraftWorkUnit(attempt);
      if (draftUnit) return draftUnit;
      const sourceCommit = sourceCommitFor(options, attempt);
      if (!sourceCommit) return undefined;
      const sourceCpuUnit = nextSourcePreparationUnit(attempt, sourceCommit);
      if (sourceCpuUnit) return sourceCpuUnit;
      const preparationUnit = sourcePreparationUnit(options, attempt);
      return preparationUnit ?? nextSourceMutationUnit(options, attempt, sourceCommit) ?? undefined;
    },
  };
}
