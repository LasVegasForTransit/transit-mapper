/**
 * Resumable construction of the next accepted RenderScene.
 *
 * Every builder below mutates plan-private state. No MapLibre source and no
 * controller state changes until the caller drains the units, reads result(),
 * and completes the separate source transaction.
 */
import type {
  RenderFeatureId,
  SystemFeatureSourceId,
} from '@transitmapper/core/render/render-identity';
import {
  compareRenderPaintOrder,
  type RenderFeature,
  type RenderFeatureCollection,
} from '@transitmapper/core/render/render-scene';
import type {
  RenderFeaturePatch,
  RenderScenePatch,
  RenderScenePatchStats,
} from '@transitmapper/core/render/render-scene-diff';
import type { CooperativeRenderJobUnitSequence } from './cooperative-render-job-scheduler';
import type { IncrementalLiveSceneState } from './accepted-scene-state';
import type { IncrementalSourceState } from './scene-source-state';
import {
  createRenderFeatureCollectionMaterialization,
  type RenderFeatureCollectionMaterialization,
} from './persistent-render-source-state';
import { SourcePatchBuilder, type CollectionPatch } from './scene-draft-patch';
import { completeStagedLiveScene } from './scene-draft-assembly';
import type {
  BuildSceneDraftInput,
  SceneDraft,
  SceneDraftWorkUnit,
  SceneDraftOptions,
  SceneDraftPlan,
} from './scene-draft-types';
import { SourceStateUpdate, type SourceStateUpdateResult } from './scene-draft-source-update';
import { SortedRunMerge } from './scene-draft-work';

export { rebaseSceneDraft } from './scene-draft-assembly';
export type { SceneDraft, SceneDraftOptions, SceneDraftPlan } from './scene-draft-types';

type PlanPhase =
  | 'sources'
  | 'diff'
  | 'hit-patch-add'
  | 'hit-patch-remove'
  | 'scene-hit-materialize'
  | 'scene-hits'
  | 'finish'
  | 'complete';

class SceneDraftBuilder implements CooperativeRenderJobUnitSequence<void> {
  private readonly sourceTransaction: SourceStateUpdate;
  private readonly patchAdd = new Map<SystemFeatureSourceId, readonly RenderFeature[]>();
  private readonly patchRemove = new Map<SystemFeatureSourceId, readonly RenderFeatureId[]>();
  private readonly hitAddRuns: Array<readonly RenderFeature[]> = [];
  private readonly hitRemoveRuns: Array<readonly RenderFeatureId[]> = [];
  private readonly patchStats: RenderScenePatchStats = {
    addedFeatureCount: 0,
    changedFeatureCount: 0,
    removedFeatureCount: 0,
  };
  private phase: PlanPhase = 'sources';
  private sources: SourceStateUpdateResult | null = null;
  private diffSourceIndex = 0;
  private currentDiff: SourcePatchBuilder | null = null;
  private hitAddMerge: SortedRunMerge<RenderFeature> | null = null;
  private hitRemoveMerge: SortedRunMerge<RenderFeatureId> | null = null;
  private patchHitFeatures: RenderFeaturePatch | null = null;
  private sceneHitFeatures: RenderFeatureCollection | null = null;
  private sceneHitMerge: SortedRunMerge<RenderFeature> | null = null;
  private sceneHitStates: readonly IncrementalSourceState[] | null = null;
  private sceneHitStateIndex = 0;
  private sceneHitMaterialization: RenderFeatureCollectionMaterialization | null = null;
  private prepared: SceneDraft | null = null;
  private lastIndex = -1;
  private lastUnit: SceneDraftWorkUnit | undefined;
  private issuedUnitCount = 0;
  private completedUnitCount = 0;
  private failed = false;
  private exhausted = false;
  private diffBypassRecorded = false;

  constructor(
    private readonly input: BuildSceneDraftInput,
    private readonly batchSize: number,
  ) {
    this.sourceTransaction = new SourceStateUpdate({ input, batchSize });
  }

  unitAt(index: number): SceneDraftWorkUnit | undefined {
    if (index === this.lastIndex) return this.lastUnit;
    if (index !== this.lastIndex + 1) {
      throw new RangeError('Scene draft units must be requested in order.');
    }
    this.lastIndex = index;
    const next = this.nextWork();
    this.lastUnit = next ? this.guard(next) : undefined;
    if (this.lastUnit) this.issuedUnitCount += 1;
    else this.exhausted = true;
    return this.lastUnit;
  }

  result(): SceneDraft {
    if (
      this.failed ||
      !this.exhausted ||
      this.completedUnitCount !== this.issuedUnitCount ||
      !this.prepared
    ) {
      throw new Error('Scene draft is incomplete and cannot be published.');
    }
    return this.prepared;
  }

  private guard(work: SceneDraftWorkUnit): SceneDraftWorkUnit {
    return {
      id: work.id,
      run: () => {
        if (this.failed) throw new Error('Scene draft already failed.');
        try {
          work.run();
          this.completedUnitCount += 1;
        } catch (error) {
          this.failed = true;
          throw error;
        }
      },
    };
  }

  private nextWork(): SceneDraftWorkUnit | undefined {
    switch (this.phase) {
      case 'sources':
        return this.nextSources();
      case 'diff':
        return this.nextDiff();
      case 'hit-patch-add':
        return this.nextHitPatchAdd();
      case 'hit-patch-remove':
        return this.nextHitPatchRemove();
      case 'scene-hit-materialize':
        return this.nextSceneHitMaterialization();
      case 'scene-hits':
        return this.nextSceneHits();
      case 'finish':
        return this.finishWork();
      case 'complete':
        return undefined;
    }
  }

  private advance(phase: PlanPhase): SceneDraftWorkUnit | undefined {
    this.phase = phase;
    return this.nextWork();
  }

  private nextSources(): SceneDraftWorkUnit | undefined {
    const work = this.sourceTransaction.nextWork();
    if (work) return work;
    this.sources = this.sourceTransaction.result();
    return this.advance('diff');
  }

  private nextDiff(): SceneDraftWorkUnit | undefined {
    if (this.input.intent !== undefined && this.input.intent !== 'incremental') {
      if (!this.diffBypassRecorded) {
        if (this.input.counts) {
          this.input.counts.diffBypassedSourceCount +=
            this.requireSources().requestedSourceIds.length;
        }
        this.diffBypassRecorded = true;
      }
      return this.advance('hit-patch-add');
    }
    const work = this.diffWork();
    return work ?? this.advance('hit-patch-add');
  }

  private diffWork(): SceneDraftWorkUnit | undefined {
    const sources = this.requireSources();
    if (this.diffSourceIndex >= sources.requestedSourceIds.length) return undefined;
    const sourceId = sources.requestedSourceIds[this.diffSourceIndex];
    this.currentDiff ??= new SourcePatchBuilder({
      sourceId,
      previous: this.sourceState(sources.previousStates, sourceId),
      next: sources.replacementDomains
        ? this.sourceState(sources.normalized, sourceId)
        : this.sourceState(sources.nextStates, sourceId),
      includedPreviousIds: sources.previousIncludedFeatureIds.get(sourceId),
      compareSameId: this.input.intent === undefined || this.input.intent === 'incremental',
      ...(this.input.counts ? { counts: this.input.counts } : {}),
      batchSize: this.batchSize,
    });
    const work = this.currentDiff.nextWork();
    if (work) return work;
    this.retainDiff(sourceId, this.currentDiff.result());
    this.currentDiff = null;
    this.diffSourceIndex += 1;
    return this.diffWork();
  }

  private retainDiff(
    sourceId: SystemFeatureSourceId,
    diff: ReturnType<SourcePatchBuilder['result']>,
  ): void {
    if (diff.visual.add.length > 0) this.patchAdd.set(sourceId, diff.visual.add);
    if (diff.visual.remove.length > 0) this.patchRemove.set(sourceId, diff.visual.remove);
    if (diff.hits.add.length > 0) this.hitAddRuns.push(diff.hits.add);
    if (diff.hits.remove.length > 0) this.hitRemoveRuns.push(diff.hits.remove);
    this.addPatchCounts(diff.visual);
    this.addPatchCounts(diff.hits);
    this.recordDiffCounts(sourceId);
  }

  private addPatchCounts(diff: CollectionPatch): void {
    this.patchStats.addedFeatureCount += diff.addedFeatureCount;
    this.patchStats.changedFeatureCount += diff.changedFeatureCount;
    this.patchStats.removedFeatureCount += diff.removedFeatureCount;
  }

  private recordDiffCounts(sourceId: SystemFeatureSourceId): void {
    if (!this.input.counts) return;
    const sources = this.requireSources();
    const previousCount = sources.replacementDomains
      ? (sources.previousIncludedFeatureIds.get(sourceId)?.size ?? 0)
      : this.sourceState(sources.previousStates, sourceId).featureIds.length;
    this.input.counts.diffedSourceCount += 1;
    this.input.counts.diffedFeatureCount +=
      previousCount + this.sourceState(sources.normalized, sourceId).featureIds.length;
  }

  private nextHitPatchAdd(): SceneDraftWorkUnit | undefined {
    this.hitAddMerge ??= new SortedRunMerge({
      id: 'scene-draft:patch:hits:add',
      runs: this.hitAddRuns,
      compare: compareRenderPaintOrder,
      batchSize: this.batchSize,
    });
    const work = this.hitAddMerge.nextWork();
    return work ?? this.advance('hit-patch-remove');
  }

  private nextHitPatchRemove(): SceneDraftWorkUnit | undefined {
    this.hitRemoveMerge ??= new SortedRunMerge({
      id: 'scene-draft:patch:hits:remove',
      runs: this.hitRemoveRuns,
      compare: (left, right) => left.localeCompare(right),
      batchSize: this.batchSize,
    });
    const work = this.hitRemoveMerge.nextWork();
    if (work) return work;
    this.patchHitFeatures = {
      add: this.hitAddMerge?.result() ?? [],
      remove: this.hitRemoveMerge.result(),
    };
    return this.advance('scene-hit-materialize');
  }

  private nextSceneHitMaterialization(): SceneDraftWorkUnit | undefined {
    this.sceneHitStates ??= [...this.requireSources().nextStates.values()];
    if (this.sceneHitStateIndex >= this.sceneHitStates.length) {
      return this.advance('scene-hits');
    }
    const state = this.sceneHitStates[this.sceneHitStateIndex];
    this.sceneHitMaterialization ??= createRenderFeatureCollectionMaterialization({
      id: `scene-draft:${state.sourceId}:hits`,
      collection: state.hits,
      batchSize: this.batchSize,
    });
    if (!this.sceneHitMaterialization) {
      this.sceneHitStateIndex += 1;
      return this.nextSceneHitMaterialization();
    }
    const work = this.sceneHitMaterialization.nextWork();
    if (work) return work;
    this.sceneHitMaterialization.result();
    this.sceneHitMaterialization = null;
    this.sceneHitStateIndex += 1;
    return this.nextSceneHitMaterialization();
  }

  private nextSceneHits(): SceneDraftWorkUnit | undefined {
    if (this.canReusePreviousHits()) {
      this.sceneHitFeatures = this.input.previous?.scene.hitFeatures ?? null;
      return this.advance('finish');
    }
    this.sceneHitMerge ??= new SortedRunMerge({
      id: 'scene-draft:hits:complete',
      runs: (this.sceneHitStates ?? []).map((state) => state.hits.features),
      compare: compareRenderPaintOrder,
      batchSize: this.batchSize,
    });
    const work = this.sceneHitMerge.nextWork();
    if (work) return work;
    this.sceneHitFeatures = {
      type: 'FeatureCollection',
      features: this.sceneHitMerge.result(),
    };
    return this.advance('finish');
  }

  private canReusePreviousHits(): boolean {
    return (
      (this.input.intent === undefined || this.input.intent === 'incremental') &&
      this.input.previous !== null &&
      this.patchHitFeatures?.add.length === 0 &&
      this.patchHitFeatures.remove.length === 0
    );
  }

  private finishWork(): SceneDraftWorkUnit {
    return {
      id: 'scene-draft:finish',
      run: () => {
        const sources = this.requireSources();
        const states = sources.nextStates;
        if (!this.sceneHitFeatures || !this.patchHitFeatures) {
          throw new Error('Scene draft finalization is incomplete.');
        }
        const scene = completeStagedLiveScene(
          this.input.revision,
          states,
          this.sceneHitFeatures,
          this.input.stats,
        );
        const patch: RenderScenePatch = {
          revision: scene.revision,
          add: this.patchAdd,
          remove: this.patchRemove,
          hitFeatures: this.patchHitFeatures,
          stats: this.patchStats,
        };
        const state: IncrementalLiveSceneState = { sourceStates: states, scene };
        this.prepared = {
          owner: this.input.owner,
          batchSize: this.batchSize,
          baseState: this.input.previous,
          baseSourceStates: sources.previousStates,
          state,
          scene,
          patch,
          requestedSourceIds: sources.requestedSourceIds,
          intent: this.input.intent ?? 'incremental',
        };
        this.phase = 'complete';
      },
    };
  }

  private requireSources(): SourceStateUpdateResult {
    if (!this.sources) throw new Error('Renderer source transaction is unavailable.');
    return this.sources;
  }

  private sourceState(
    states: ReadonlyMap<SystemFeatureSourceId, IncrementalSourceState>,
    sourceId: SystemFeatureSourceId,
  ): IncrementalSourceState {
    const state = states.get(sourceId);
    if (!state) throw new Error(`Renderer source state is unavailable: ${sourceId}`);
    return state;
  }
}

/** Plans every expensive scene-draft stage without walking a projected feature
 * collection. Unit descriptors are range-backed; only `run()` visits data. */
export function planSceneDraft(
  input: BuildSceneDraftInput,
  options: SceneDraftOptions = {},
): SceneDraftPlan {
  const batchSize = options.batchSize ?? 8;
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new RangeError('Scene draft batch size must be a positive integer.');
  }
  const builder = new SceneDraftBuilder(input, batchSize);
  return { units: builder, result: () => builder.result() };
}
