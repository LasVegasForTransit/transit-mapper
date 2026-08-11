/**
 * Describes one bounded attempt to turn a scene draft into source mutations.
 *
 * The publication coordinator may retry with smaller draft batches, but every
 * attempt owns isolated draft and source-preparation state. This module keeps
 * that mechanical scheduling state out of the accepted-scene lifecycle.
 */
import type { CooperativeRenderJobUnitSequence } from './cooperative-render-job-scheduler';
import type { RenderSceneSourceMutationUnit } from './render-scene-source-updater';
import type { SceneDraftPlan } from './scene-draft';
import type {
  PreparedScenePublication,
  ScenePublicationContext,
  PublishSceneDraftOptions,
} from './scene-publication-types';

export interface ScenePublicationAttempt<Update> {
  readonly batchSize: number;
  readonly tolerateBudgetOverrun: boolean;
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
  tolerateBudgetOverrun: boolean,
): ScenePublicationAttempt<Update> {
  return {
    batchSize,
    tolerateBudgetOverrun,
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
    return {
      id: `scene-publication:source-preparation:${sourceCommit.mode ?? 'legacy'}:${sourceCommit.bank ?? 'none'}`,
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

export function scenePublicationUnits<Update>(
  options: PublishSceneDraftOptions<Update>,
  attempt: ScenePublicationAttempt<Update>,
): CooperativeRenderJobUnitSequence<void> {
  return {
    unitAt(index) {
      if (index === 0) {
        const unitId = `scene-publication:plan:${attempt.batchSize}`;
        attempt.overBudgetYieldUnitIds.add(unitId);
        return {
          id: unitId,
          run: () => {
            attempt.plan = options.controller.draft(options.input, {
              batchSize: attempt.batchSize,
            });
          },
        };
      }
      const plan = attempt.plan;
      if (!plan) return undefined;
      if (!attempt.sourceCommit) {
        const planUnit = plan.units.unitAt(attempt.planUnitIndex);
        if (planUnit) {
          attempt.planUnitIndex += 1;
          attempt.overBudgetYieldUnitIds.add(planUnit.id);
          return planUnit;
        }
        if (!options.controller.preparePublication) return undefined;
        attempt.sourceCommit = options.controller.preparePublication(plan.result());
      }
      const sourceCommit = attempt.sourceCommit;
      const cpuPreparationUnit = sourceCommit.preparationUnits?.unitAt(
        attempt.sourceCpuPreparationIndex,
      );
      if (cpuPreparationUnit) {
        attempt.sourceCpuPreparationIndex += 1;
        attempt.overBudgetYieldUnitIds.add(cpuPreparationUnit.id);
        return cpuPreparationUnit;
      }
      const preparationUnit = sourcePreparationUnit(options, attempt);
      if (preparationUnit) return preparationUnit;
      const sourceUnit = sourceCommit.units.at(attempt.sourceUnitIndex);
      if (!sourceUnit) return undefined;
      const sourceUnitIndex = attempt.sourceUnitIndex;
      attempt.sourceUnitIndex += 1;
      if (sourceUnitIndex !== 0) return sourceUnit;
      return {
        ...sourceUnit,
        run: () => {
          options.onSourceMutationStart?.(
            sourceCommit.sourceIds,
            sourcePublicationContext(sourceCommit),
          );
          sourceUnit.run();
        },
      };
    },
  };
}
