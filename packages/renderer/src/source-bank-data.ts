/**
 * Composite source updater for alternating physical banks.
 *
 * Each bank retains its own accepted scene sequence. Direct single-source
 * patches update the visible resident; wider changes are journaled and staged
 * against the inactive bank's actual baseline before a visual flip.
 */
import type { SystemFeatureSourceId } from '@transitmapper/core/render/render-identity';
import type { RenderScene } from '@transitmapper/core/render/render-scene';
import { composeRenderScenePatches, filterRenderScenePatch } from './render-scene-patch-journal';
import {
  bankScene,
  canApplyDirectBankUpdate,
  createBankUpdater,
  createUnbankedUpdater,
  emptyRenderSceneSourceUpdateResult,
  hasBankSceneChanges,
  physicalLogicalSourceId,
  sourceBankRevision,
  type SourceBankDataStore,
  type SourceBankDataStoreOptions,
  type SourceBankUpdatePlan,
  type JournalEntry,
  type PendingTransition,
  type WrapPlanOptions,
} from './source-bank-updates';
import type { SourceBankId } from './source-bank';
import {
  type ApplyRenderSceneOptions,
  type RenderSceneSourceUpdatePlan,
  type RenderSceneSourceUpdateResult,
  type RenderSceneSourceUpdater,
} from './render-scene-source-updater';
export type { SourceBankDataStore, SourceBankDataStoreOptions } from './source-bank-updates';

/** Keeps one immutable CPU scene per physical MapLibre bank. A small
 * single-source patch may update the visible bank directly; every wider
 * transaction targets the inactive bank from that bank's own journal base. */
class SourceBankDataStoreImplementation implements SourceBankDataStore {
  private readonly sourceIds: ReadonlySet<SystemFeatureSourceId>;
  private readonly unbankedSourceIds: ReadonlySet<SystemFeatureSourceId>;
  private readonly updaters: Record<SourceBankId, RenderSceneSourceUpdater>;
  private readonly unbankedUpdater: RenderSceneSourceUpdater | null;
  private readonly residentSequence: Record<SourceBankId, number> = { a: 0, b: 0 };
  private readonly journal: JournalEntry[] = [];
  private current: RenderScene | null = null;
  private changeSequence = 0;
  private fullBarrierSequence = 0;
  private activePlan: object | null = null;

  constructor(private readonly options: SourceBankDataStoreOptions) {
    this.sourceIds = new Set(options.sourceIds);
    this.unbankedSourceIds = new Set(options.unbankedSourceIds ?? []);
    this.updaters = {
      a: createBankUpdater(options, 'a'),
      b: createBankUpdater(options, 'b'),
    };
    this.unbankedUpdater = createUnbankedUpdater(options);
  }

  prepare(next: RenderScene, applyOptions: ApplyRenderSceneOptions = {}): SourceBankUpdatePlan {
    if (this.activePlan) throw new Error('A banked render source plan is already active.');
    const requested = applyOptions.requestedSourceIds ?? [];
    const requestsUnbanked = requested.some((sourceId) => this.unbankedSourceIds.has(sourceId));
    const requestsBanked = requested.some((sourceId) => this.sourceIds.has(sourceId));
    if (requestsUnbanked && requestsBanked) {
      throw new Error('Committed and editor render sources require separate transactions.');
    }
    if (requestsUnbanked) return this.prepareUnbanked(next, applyOptions);
    const pending = this.pendingTransition(next, applyOptions);
    const activeBank = this.options.controller.activeBank();
    if (activeBank && (applyOptions.intent ?? 'incremental') === 'incremental') {
      const delegate = this.updaters[activeBank].prepare(this.filteredScene(next), {
        ...(pending.patch ? { patch: pending.patch } : {}),
        ...(applyOptions.preparationBatchSize
          ? { preparationBatchSize: applyOptions.preparationBatchSize }
          : {}),
      });
      if (canApplyDirectBankUpdate(delegate, pending.patch)) {
        return this.wrapPlan({ delegate, mode: 'active', bank: activeBank, pending });
      }
      delegate.abort();
    }
    return this.hiddenPlan(pending, applyOptions);
  }

  apply(
    scene: RenderScene,
    applyOptions: ApplyRenderSceneOptions = {},
  ): RenderSceneSourceUpdateResult {
    const plan = this.prepare(scene, applyOptions);
    try {
      for (let index = 0; ; index += 1) {
        const unit = plan.preparationUnits?.unitAt(index);
        if (!unit) break;
        unit.run();
      }
      for (const unit of plan.units) unit.run();
      return plan.commit();
    } catch (error) {
      plan.abort();
      throw error;
    }
  }

  currentScene(): RenderScene | null {
    return this.current;
  }

  residentScene(bank: SourceBankId): RenderScene | null {
    return this.updaters[bank].currentScene();
  }

  invalidateSourceState(physicalSourceId?: string): void {
    if (!physicalSourceId) {
      this.updaters.a.invalidateSourceState();
      this.updaters.b.invalidateSourceState();
    } else if (physicalSourceId.endsWith('--bank-a')) {
      this.updaters.a.invalidateSourceState();
    } else if (physicalSourceId.endsWith('--bank-b')) {
      this.updaters.b.invalidateSourceState();
    }
  }

  prepareCurrentSceneHeal(): SourceBankUpdatePlan | null {
    return this.current ? this.prepare(this.current, { intent: 'style-heal' }) : null;
  }

  prepareInactiveSeed(): SourceBankUpdatePlan | null {
    const activeBank = this.options.controller.activeBank();
    if (!this.current || !activeBank || this.activePlan) return null;
    const inactiveBank: SourceBankId = activeBank === 'a' ? 'b' : 'a';
    if (
      this.updaters[inactiveBank].currentScene() &&
      this.residentSequence[inactiveBank] === this.changeSequence
    ) {
      return null;
    }
    return this.hiddenPlan(
      {
        next: this.current,
        patch: null,
        targetSequence: this.changeSequence,
        fullBarrier: false,
      },
      { intent: 'incremental' },
      'seed',
    );
  }

  healCurrentScene(): RenderSceneSourceUpdateResult {
    const plan = this.prepareCurrentSceneHeal();
    if (!plan) return this.noneResult();
    for (const unit of plan.units) unit.run();
    return plan.commit();
  }

  private filteredScene(scene: RenderScene): RenderScene {
    return bankScene(scene, this.sourceIds);
  }

  private unbankedScene(scene: RenderScene): RenderScene {
    return {
      ...bankScene(scene, this.unbankedSourceIds),
      hitFeatures: { type: 'FeatureCollection', features: [] },
      // `generatedHitFeatureCount` is the source updater's cheap signal that
      // a transaction owns hit geometry. Editor sources never do: retaining
      // the committed scene's count here would make an editor-only update try
      // to upload hits through an unbanked source target.
      stats: { ...scene.stats, generatedHitFeatureCount: 0 },
    };
  }

  private prepareUnbanked(
    next: RenderScene,
    applyOptions: ApplyRenderSceneOptions,
  ): SourceBankUpdatePlan {
    if (!this.unbankedUpdater) throw new Error('No unbanked render source boundary exists.');
    const suppliedPatch = applyOptions.patch;
    let patch = null;
    if (this.current) {
      if (!suppliedPatch) {
        throw new Error('An exact staged render scene patch is required after the initial scene.');
      }
      patch = filterRenderScenePatch(suppliedPatch, this.unbankedSourceIds, false);
    }
    const delegate = this.unbankedUpdater.prepare(this.unbankedScene(next), {
      ...(patch ? { patch } : {}),
      ...(applyOptions.preparationBatchSize
        ? { preparationBatchSize: applyOptions.preparationBatchSize }
        : {}),
    });
    return this.wrapUnbankedPlan(delegate, next);
  }

  private wrapUnbankedPlan(
    delegate: RenderSceneSourceUpdatePlan,
    next: RenderScene,
  ): SourceBankUpdatePlan {
    const token = {};
    this.activePlan = token;
    let stagedResult: RenderSceneSourceUpdateResult | null = null;
    const stage = () => {
      if (this.activePlan !== token) throw new Error('Unbanked render source plan is inactive.');
      stagedResult ??= delegate.stage();
      return stagedResult;
    };
    const publish = () => {
      if (this.activePlan !== token || !stagedResult) {
        throw new Error('Unbanked render source plan must be staged before publication.');
      }
      delegate.publish();
      this.current = next;
      this.activePlan = null;
    };
    return {
      strategy: delegate.strategy,
      sourceIds: delegate.sourceIds,
      clearedSourceIds: delegate.clearedSourceIds,
      preparationUnits: delegate.preparationUnits,
      units: delegate.units,
      mode: 'unbanked',
      bank: null,
      stage,
      publish,
      commit() {
        const result = stage();
        publish();
        return result;
      },
      markSourcesLoaded() {},
      abort: () => {
        if (this.activePlan !== token) return;
        delegate.abort();
        this.activePlan = null;
      },
      mutationStarted: () => delegate.mutationStarted(),
    };
  }

  private pendingTransition(
    next: RenderScene,
    applyOptions: ApplyRenderSceneOptions,
  ): PendingTransition {
    const intent = applyOptions.intent ?? 'incremental';
    const fullBarrier = intent !== 'incremental';
    if (this.current && !fullBarrier && !applyOptions.patch) {
      throw new Error('An exact staged render scene patch is required after the initial scene.');
    }
    const unfiltered = this.current ? (applyOptions.patch ?? null) : null;
    const patch = unfiltered ? filterRenderScenePatch(unfiltered, this.sourceIds, true) : null;
    return {
      next,
      patch,
      targetSequence: this.changeSequence + (fullBarrier || hasBankSceneChanges(patch) ? 1 : 0),
      fullBarrier,
    };
  }

  private recordAccepted(pending: PendingTransition, bank: SourceBankId): void {
    if (pending.fullBarrier) {
      this.changeSequence = pending.targetSequence;
      this.fullBarrierSequence = pending.targetSequence;
      this.journal.length = 0;
    } else if (hasBankSceneChanges(pending.patch)) {
      this.changeSequence = pending.targetSequence;
      this.journal.push({ sequence: this.changeSequence, patch: pending.patch });
    }
    this.residentSequence[bank] = pending.targetSequence;
    this.current = pending.next;
    const retainedFloor = Math.min(this.residentSequence.a, this.residentSequence.b);
    while (this.journal[0] && this.journal[0].sequence <= retainedFloor) this.journal.shift();
  }

  private wrapPlan({
    delegate,
    mode,
    bank,
    pending,
    transaction,
  }: WrapPlanOptions): SourceBankUpdatePlan {
    const token = {};
    this.activePlan = token;
    let stagedResult: RenderSceneSourceUpdateResult | null = null;
    let sourcesLoaded = false;
    let activated = false;
    const activation = () => sourceBankRevision(this.filteredScene(pending.next));
    const requireActive = () => {
      if (this.activePlan !== token)
        throw new Error('Banked render source plan is no longer active.');
    };
    const stage = () => {
      requireActive();
      stagedResult ??= delegate.stage();
      return stagedResult;
    };
    const publish = () => {
      requireActive();
      if (!stagedResult) throw new Error('Banked render source plan must be staged first.');
      delegate.publish();
      if (transaction) {
        if (mode === 'seed') transaction.retain(activation());
        else {
          if (!activated) transaction.activate(activation());
          transaction.confirmActivation();
        }
      } else {
        this.options.controller.updateActiveResident({
          ...sourceBankRevision(this.filteredScene(pending.next)),
        });
      }
      this.recordAccepted(pending, bank);
      this.activePlan = null;
    };
    return {
      strategy: delegate.strategy,
      sourceIds: delegate.sourceIds,
      clearedSourceIds: delegate.clearedSourceIds,
      preparationUnits: delegate.preparationUnits,
      units: delegate.units,
      mode,
      bank,
      stage,
      publish,
      commit() {
        const result = stage();
        this.markSourcesLoaded();
        this.activate?.();
        publish();
        return result;
      },
      markSourcesLoaded() {
        if (sourcesLoaded) return;
        for (const sourceId of delegate.sourceIds) transaction?.recordLoaded(sourceId);
        sourcesLoaded = true;
      },
      activate() {
        requireActive();
        if (!transaction || mode === 'seed' || activated) return;
        if (!stagedResult || !sourcesLoaded) {
          throw new Error('A hidden render bank must be staged and loaded before activation.');
        }
        transaction.activate(activation());
        activated = true;
      },
      abort: () => {
        if (this.activePlan !== token) return;
        delegate.abort();
        transaction?.abort();
        this.activePlan = null;
      },
      mutationStarted: () => delegate.mutationStarted(),
    };
  }

  private hiddenPlan(
    pending: PendingTransition,
    applyOptions: ApplyRenderSceneOptions,
    mode: 'hidden' | 'seed' = 'hidden',
  ): SourceBankUpdatePlan {
    const activeBank = this.options.controller.activeBank();
    const bank: SourceBankId = activeBank === 'a' ? 'b' : 'a';
    const updater = this.updaters[bank];
    const resident = updater.currentScene();
    const next = this.filteredScene(pending.next);
    const mustUploadFull =
      !resident ||
      (applyOptions.intent ?? 'incremental') !== 'incremental' ||
      this.residentSequence[bank] < this.fullBarrierSequence;
    const patches = [
      ...this.journal
        .filter((entry) => entry.sequence > this.residentSequence[bank])
        .map((entry) => entry.patch),
      ...(hasBankSceneChanges(pending.patch) ? [pending.patch] : []),
    ];
    const delegate = updater.prepare(next, {
      intent: mustUploadFull ? 'reset' : 'incremental',
      ...(applyOptions.preparationBatchSize
        ? { preparationBatchSize: applyOptions.preparationBatchSize }
        : {}),
      ...(mustUploadFull ? {} : { patch: composeRenderScenePatches(next.revision, patches) }),
    });
    const transaction = this.options.controller.begin({
      logicalSourceIds: delegate.sourceIds.map((sourceId) =>
        physicalLogicalSourceId(sourceId, bank),
      ),
    });
    return this.wrapPlan({ delegate, mode, bank, pending, transaction });
  }

  private noneResult(): RenderSceneSourceUpdateResult {
    return emptyRenderSceneSourceUpdateResult();
  }
}

export function createSourceBankDataStore(
  options: SourceBankDataStoreOptions,
): SourceBankDataStore {
  return new SourceBankDataStoreImplementation(options);
}
