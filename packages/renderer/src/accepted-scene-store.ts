/**
 * Browser-free accepted-scene boundary.
 *
 * Projection hands this controller complete or domain-scoped feature
 * collections. It prepares a private normalized scene, delegates the exact
 * source mutation plan, and publishes CPU state only after that plan succeeds.
 * MapCanvas should not reproduce normalization, diff, or rollback rules.
 */
import type { SystemFeatures } from '@transitmapper/core/render/buildFeatures';
import {
  type RenderDomainIdentity,
  type RenderFeatureId,
  type SystemFeatureSourceId,
} from '@transitmapper/core/render/render-identity';
import type { RenderScene, RenderSceneStats } from '@transitmapper/core/render/render-scene';
import { visualTargetsForDomain, type IncrementalLiveSceneState } from './accepted-scene-state';
import type { IncrementalSceneOperationCounts } from './sources/scene-source-state';
import {
  createRenderSceneSourceUpdater,
  type ApplyRenderSceneOptions,
  type RenderSceneSourceMutationUnit,
  type RenderSceneSourceUpdatePlan,
  type RenderSceneSourceUpdateResult,
  type RenderSceneSourceUpdaterOptions,
  type RenderSceneUploadIntent,
} from './sources/render-scene-source-updater';
import type { MapSystemFeatureSourceId } from './system-feature-sources';
import {
  planSceneDraft,
  rebaseSceneDraft,
  type SceneDraft,
  type SceneDraftOptions,
  type SceneDraftPlan,
} from './scene-draft';

export interface SceneUpdate {
  revision: string;
  /** A projection result whose requested collections are authoritative. Empty
   * requested collections remove their previous features; unrequested
   * collections retain the last successfully uploaded result. */
  features: SystemFeatures;
  sourceIds: readonly MapSystemFeatureSourceId[];
  /** When supplied, each requested source collection is a partial projection.
   * The listed semantic domains are authoritative: their prior visual and hit
   * features are replaced, while every unrelated feature remains retained. */
  replacementDomainsBySource?: ReadonlyMap<
    MapSystemFeatureSourceId,
    readonly RenderDomainIdentity[]
  >;
  intent?: RenderSceneUploadIntent;
  stats?: RenderSceneStats;
}

export interface SceneFeatureTarget {
  sourceId: SystemFeatureSourceId;
  featureId: RenderFeatureId;
}

export interface AcceptedSceneUpdate extends RenderSceneSourceUpdateResult {
  scene: RenderScene;
}

export interface AcceptedSceneStore {
  draft(input: SceneUpdate, options?: SceneDraftOptions): SceneDraftPlan;
  preparePublication(draft: SceneDraft): ScenePublication;
  publishDraftSynchronously(draft: SceneDraft): AcceptedSceneUpdate;
  applySynchronously(input: SceneUpdate): AcceptedSceneUpdate;
  invalidateSourceState(sourceId?: string): void;
  prepareCurrentSceneHeal(): RenderSceneSourceUpdatePlan | null;
  prepareInactiveBankSeed(): RenderSceneSourceUpdatePlan | null;
  healCurrentScene(): RenderSceneSourceUpdateResult;
  acceptedScene(): RenderScene | null;
  publicationInProgress(): boolean;
  targetsForDomainIdentity(domainIdentity: RenderDomainIdentity): readonly SceneFeatureTarget[];
}

interface ScenePublication {
  readonly sourceIds: readonly string[];
  readonly clearedSourceIds: readonly string[];
  readonly preparationUnits?: RenderSceneSourceUpdatePlan['preparationUnits'];
  readonly units: readonly RenderSceneSourceMutationUnit[];
  readonly mode?: RenderSceneSourceUpdatePlan['mode'];
  readonly bank?: RenderSceneSourceUpdatePlan['bank'];
  stage(): RenderSceneSourceUpdateResult;
  markSourcesLoaded(): void;
  activate?(): void;
  targetsForDomainIdentity(domainIdentity: RenderDomainIdentity): readonly SceneFeatureTarget[];
  publish(): AcceptedSceneUpdate;
  commit(): AcceptedSceneUpdate;
  abort(): void;
  mutationStarted(): boolean;
}

export type SceneDraftOperationCounts = IncrementalSceneOperationCounts;

export interface AcceptedSceneStoreOptions extends RenderSceneSourceUpdaterOptions {
  counts?: SceneDraftOperationCounts;
  sourceUpdater?: SceneSourceStore;
}

interface SceneSourceStore {
  prepare(scene: RenderScene, options?: ApplyRenderSceneOptions): RenderSceneSourceUpdatePlan;
  invalidateSourceState(sourceId?: string): void;
  prepareCurrentSceneHeal(): RenderSceneSourceUpdatePlan | null;
  prepareInactiveSeed?(): RenderSceneSourceUpdatePlan | null;
  healCurrentScene(): RenderSceneSourceUpdateResult;
  currentScene(): RenderScene | null;
}

export function createSceneDraftOperationCounts(): SceneDraftOperationCounts {
  return {
    normalizedSourceCount: 0,
    normalizedFeatureCount: 0,
    indexedFeatureCount: 0,
    diffedSourceCount: 0,
    diffedFeatureCount: 0,
    comparedFeatureCount: 0,
    comparisonUnitCount: 0,
    comparisonStepCount: 0,
    comparedValueCount: 0,
    referenceEqualFeatureCount: 0,
    authoritativeChangedFeatureCount: 0,
    diffBypassedSourceCount: 0,
  };
}

/** Owns the authoritative settled scene at the MapLibre boundary. Core can
 * project one dependency subset at a time without treating every unrequested
 * collection as deleted, and the source updater can consequently issue exact
 * stable-ID patches. */
class AcceptedSceneStoreImplementation implements AcceptedSceneStore {
  private readonly sourceUpdater: SceneSourceStore;
  private readonly owner = {};
  private incrementalState: IncrementalLiveSceneState | null = null;
  private sourceSubmissionActive = false;

  constructor(private readonly options: AcceptedSceneStoreOptions) {
    this.sourceUpdater = options.sourceUpdater ?? createRenderSceneSourceUpdater(options);
  }

  draft(input: SceneUpdate, draftOptions?: SceneDraftOptions): SceneDraftPlan {
    return planSceneDraft(
      {
        previous: this.incrementalState,
        revision: input.revision,
        features: input.features,
        sourceIds: input.sourceIds,
        owner: this.owner,
        ...(input.replacementDomainsBySource
          ? { replacementDomainsBySource: input.replacementDomainsBySource }
          : {}),
        ...(input.intent ? { intent: input.intent } : {}),
        ...(input.stats ? { stats: input.stats } : {}),
        ...(this.options.counts ? { counts: this.options.counts } : {}),
      },
      draftOptions,
    );
  }

  preparePublication(draft: SceneDraft): ScenePublication {
    if (draft.owner !== this.owner) {
      throw new Error('Prepared live render scene belongs to another controller.');
    }
    const nextState = rebaseSceneDraft(draft, this.incrementalState);
    const sourcePlan = this.sourceUpdater.prepare(nextState.scene, {
      intent: draft.intent,
      patch: draft.patch,
      requestedSourceIds: draft.requestedSourceIds,
      preparationBatchSize: draft.batchSize,
    });
    this.sourceSubmissionActive = true;
    let stagedUpload: RenderSceneSourceUpdateResult | null = null;
    const stage = () => {
      stagedUpload ??= sourcePlan.stage();
      return stagedUpload;
    };
    const publish = () => {
      if (!stagedUpload) throw new Error('Live render sources must be staged before publication.');
      try {
        sourcePlan.publish();
        this.incrementalState = nextState;
        return { ...stagedUpload, scene: nextState.scene };
      } finally {
        this.sourceSubmissionActive = false;
      }
    };
    return {
      sourceIds: sourcePlan.sourceIds,
      clearedSourceIds: sourcePlan.clearedSourceIds ?? [],
      preparationUnits: sourcePlan.preparationUnits,
      units: sourcePlan.units,
      ...(sourcePlan.mode ? { mode: sourcePlan.mode } : {}),
      ...(sourcePlan.bank !== undefined ? { bank: sourcePlan.bank } : {}),
      stage,
      markSourcesLoaded: () => sourcePlan.markSourcesLoaded?.(),
      ...(sourcePlan.activate ? { activate: () => sourcePlan.activate?.() } : {}),
      targetsForDomainIdentity: (domainIdentity) =>
        visualTargetsForDomain(nextState, domainIdentity),
      publish,
      commit: () => {
        try {
          const upload = sourcePlan.commit();
          // Source methods accepted the submission synchronously. MapLibre
          // worker settlement remains event-driven; an asynchronous error
          // invalidates and heals this exact complete scene below.
          this.incrementalState = nextState;
          return { ...upload, scene: nextState.scene };
        } finally {
          this.sourceSubmissionActive = false;
        }
      },
      abort: () => {
        sourcePlan.abort();
        this.sourceSubmissionActive = false;
      },
      mutationStarted: () => sourcePlan.mutationStarted(),
    };
  }

  publishDraftSynchronously(draft: SceneDraft): AcceptedSceneUpdate {
    const commit = this.preparePublication(draft);
    try {
      for (let index = 0; ; index += 1) {
        const unit = commit.preparationUnits?.unitAt(index);
        if (!unit) break;
        unit.run();
      }
      for (const unit of commit.units) unit.run();
      return commit.commit();
    } catch (error) {
      commit.abort();
      throw error;
    }
  }

  applySynchronously(input: SceneUpdate): AcceptedSceneUpdate {
    const plan = this.draft(input);
    for (let index = 0; ; index += 1) {
      const unit = plan.units.unitAt(index);
      if (!unit) break;
      unit.run();
    }
    return this.publishDraftSynchronously(plan.result());
  }

  invalidateSourceState(sourceId?: string): void {
    this.sourceUpdater.invalidateSourceState(sourceId);
  }

  prepareCurrentSceneHeal(): RenderSceneSourceUpdatePlan | null {
    return this.trackPlan(this.sourceUpdater.prepareCurrentSceneHeal());
  }

  prepareInactiveBankSeed(): RenderSceneSourceUpdatePlan | null {
    return this.trackPlan(this.sourceUpdater.prepareInactiveSeed?.() ?? null);
  }

  healCurrentScene(): RenderSceneSourceUpdateResult {
    return this.sourceUpdater.healCurrentScene();
  }

  acceptedScene(): RenderScene | null {
    return this.incrementalState?.scene ?? this.sourceUpdater.currentScene();
  }

  publicationInProgress(): boolean {
    return this.sourceSubmissionActive;
  }

  targetsForDomainIdentity(domainIdentity: RenderDomainIdentity): readonly SceneFeatureTarget[] {
    return visualTargetsForDomain(this.incrementalState, domainIdentity);
  }

  private trackPlan(plan: RenderSceneSourceUpdatePlan | null): RenderSceneSourceUpdatePlan | null {
    if (!plan) return null;
    this.sourceSubmissionActive = true;
    const finish = () => {
      this.sourceSubmissionActive = false;
    };
    return {
      ...plan,
      stage: () => plan.stage(),
      publish() {
        try {
          plan.publish();
        } finally {
          finish();
        }
      },
      commit() {
        try {
          return plan.commit();
        } finally {
          finish();
        }
      },
      abort() {
        plan.abort();
        finish();
      },
      mutationStarted: () => plan.mutationStarted(),
    };
  }
}

export function createAcceptedSceneStore(options: AcceptedSceneStoreOptions): AcceptedSceneStore {
  return new AcceptedSceneStoreImplementation(options);
}
