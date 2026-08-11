/**
 * Accepted-scene lifecycle for the live MapLibre renderer.
 *
 * Projection gives this object a complete or scoped scene update. It owns the
 * physical source banks, hidden-bank preparation, the visible/hit ownership
 * switch, retained-scene recovery, and the accepted CPU scene. Callers never
 * publish a source collection or advance a bank revision themselves.
 *
 * The old scene remains authoritative until the incoming bank has loaded and
 * painted. Any failure before that point rolls the bank transaction back, so
 * pixels, hit queries, and the accepted CPU scene continue to describe the
 * same revision.
 */
import type { LayerSpecification } from 'maplibre-gl';
import {
  systemFeatureSourceId,
  type RenderDomainIdentity,
} from '@transitmapper/core/render/render-identity';
import type { CooperativeRenderJobSchedulerStats } from './cooperative-render-job-scheduler';
import {
  createCooperativeRenderJobScheduler,
  type CooperativeRenderJobScheduler,
} from './cooperative-render-job-scheduler';
import {
  createAcceptedSceneStore,
  type AcceptedSceneStore,
  type AcceptedSceneUpdate,
  type SceneFeatureTarget,
  type SceneUpdate,
} from './accepted-scene-store';
import { SRC_HIT_FEATURES } from './layers/constants';
import {
  type GeoJsonSourceTarget,
  type RenderSceneSourceUpdateResult,
} from './render-scene-source-updater';
import {
  type RenderSourceErrorEvent,
  type RenderSourceErrorRecoveryCoordinator,
} from './render-source-error-recovery';
import { createAcceptedSceneRecovery } from './accepted-scene-recovery';
import { DocumentProjector, type DocumentProjectionRequest } from './document-projection';
import {
  createSourceFeatureProjectionAccounting,
  type SourceFeatureProjectionAccounting,
} from './committed-feature-projection';
import type { SourceUploadTransition } from './sourceUploadPlan';
import type { MapSystemFeatureSourceId } from './system-feature-sources';
import { createRendererStatsCollector, type RendererStatsCollector } from '../perf/renderer-stats';
import { publishSceneDraft, type ScenePublicationSubmission } from './scene-publication';
import { createSourceBankDataStore } from './source-bank-data';
import {
  createSourceBankLayerController,
  logicalBankedLayerIds,
  physicalRenderLayerIds,
  type RenderLayerVisibility,
  type SourceBankLayerController,
} from './source-bank-layers';
import {
  createSourceBankController,
  type SourceBankController,
  type SourceBankDiagnostics,
  type SourceBankId,
} from './source-bank';
import {
  createSourceBankBackgroundPreparation,
  waitForSourceBankLoad,
  waitForSourceBankPaint,
  type SourceBankBackgroundPreparation,
  type SourceBankSettlementHost,
} from './source-bank-settlement';
import {
  COMMITTED_SYSTEM_FEATURE_SOURCES,
  EDITOR_SYSTEM_FEATURE_SOURCES,
} from './system-feature-sources';

/** The deliberately small MapLibre boundary. Tests use the same contract, so
 * lifecycle rules can be proved without a browser or a second implementation. */
export interface LiveMapRendererHost extends SourceBankSettlementHost {
  resolveSource(sourceId: string): GeoJsonSourceTarget;
  hasLayer(layerId: string): boolean;
  setLayerVisibility(layerId: string, visibility: RenderLayerVisibility): void;
  setLayerPaintProperty(layerId: string, property: string, value: unknown): void;
  ensureOverlay(): boolean;
  now(): number;
  scheduleFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
}

type SceneTargetResolver = (domainIdentity: RenderDomainIdentity) => readonly SceneFeatureTarget[];

export interface LiveMapRendererOptions {
  readonly host: LiveMapRendererHost;
  readonly layerSpecs: readonly LayerSpecification[];
  /** Projection and scene publication normally share one scheduler. Tests and
   * isolated consumers may omit it and let the renderer own one. */
  readonly scheduler?: CooperativeRenderJobScheduler;
  readonly projectionAccounting?: SourceFeatureProjectionAccounting;
  readonly rendererStats?: RendererStatsCollector;
  readonly instrumentationEnabled?: boolean;
  requeueProjection?(
    sourceIds: readonly MapSystemFeatureSourceId[],
    transition: SourceUploadTransition | null,
  ): void;
  synchronizeInteractionState?(targets?: SceneTargetResolver): void;
  refreshInteractionPreviews?(): void;
  onInactiveBankReady?(): void;
  onRecoveryUpdate?(update: RenderSceneSourceUpdateResult): void | Promise<void>;
  onError?(error: unknown): void;
}

export interface PublishLiveSceneInput extends SceneUpdate {
  onAccepted?(update: AcceptedSceneUpdate): void | Promise<void>;
  recordScheduling?(stats: CooperativeRenderJobSchedulerStats): void;
}

export interface LiveMapRendererSnapshot {
  readonly acceptedRevision: string | null;
  readonly activeRevision: string | null;
  readonly activeBank: SourceBankId | null;
  readonly stagingBank: SourceBankId | null;
  readonly publicationInProgress: boolean;
  readonly recoveryVersion: number;
  readonly diagnostics: SourceBankDiagnostics;
}

/** One concrete runtime object rather than a collection of public pipeline
 * adapters. Its methods are phrased in scene, layer, and recovery vocabulary
 * because those are the decisions MapCanvas genuinely owns. */
export class LiveMapRenderer {
  private readonly banks: SourceBankController;
  private readonly layers: SourceBankLayerController;
  private readonly scenes: AcceptedSceneStore;
  private readonly scheduler: CooperativeRenderJobScheduler;
  private readonly ownsScheduler: boolean;
  private readonly recovery: RenderSourceErrorRecoveryCoordinator;
  private readonly projector: DocumentProjector;
  private readonly bankedLayerIds: ReadonlySet<string>;
  private readonly backgroundPreparation: SourceBankBackgroundPreparation;
  private sourceSubmissionAbort: AbortController | null = null;
  private sourceSubmissionMode: 'active' | 'hidden' | 'seed' | 'unbanked' | null = null;
  private sourceSubmissionBank: SourceBankId | null = null;
  private disposed = false;

  constructor(private readonly options: LiveMapRendererOptions) {
    this.scheduler =
      options.scheduler ??
      createCooperativeRenderJobScheduler({
        now: () => options.host.now(),
        scheduleFrame: (callback) => options.host.scheduleFrame(callback),
        cancelFrame: (handle) => options.host.cancelFrame(handle),
      });
    this.ownsScheduler = options.scheduler === undefined;
    this.banks = createSourceBankController();
    this.bankedLayerIds = logicalBankedLayerIds(options.layerSpecs);
    this.layers = createSourceBankLayerController({
      bankController: this.banks,
      logicalSpecs: options.layerSpecs,
      host: {
        hasLayer: (layerId) => options.host.hasLayer(layerId),
        setVisibility: (layerId, visibility) =>
          options.host.setLayerVisibility(layerId, visibility),
        setPaintProperty: (layerId, property, value) =>
          options.host.setLayerPaintProperty(layerId, property, value),
      },
      now: () => options.host.now(),
    });
    const sourceData = createSourceBankDataStore({
      controller: this.banks,
      sourceIds: COMMITTED_SYSTEM_FEATURE_SOURCES.map(systemFeatureSourceId),
      unbankedSourceIds: EDITOR_SYSTEM_FEATURE_SOURCES.map(systemFeatureSourceId),
      hitSourceId: SRC_HIT_FEATURES,
      resolveSource: (sourceId, bank) =>
        options.host.resolveSource(`${String(sourceId)}--bank-${bank}`),
      resolveHitSource: (bank) => options.host.resolveSource(`${SRC_HIT_FEATURES}--bank-${bank}`),
      resolveUnbankedSource: (sourceId) => options.host.resolveSource(String(sourceId)),
    });
    this.scenes = createAcceptedSceneStore({
      resolveSource: (sourceId) => options.host.resolveSource(String(sourceId)),
      resolveHitSource: () => options.host.resolveSource(SRC_HIT_FEATURES),
      hitSourceId: SRC_HIT_FEATURES,
      sourceUpdater: sourceData,
    });
    this.recovery = createAcceptedSceneRecovery({
      host: options.host,
      scenes: this.scenes,
      banks: this.banks,
      layers: this.layers,
      synchronizeInteractionState: () => options.synchronizeInteractionState?.(),
      refreshInteractionPreviews: () => options.refreshInteractionPreviews?.(),
      onRecovered: (update) => options.onRecoveryUpdate?.(update),
      onError: (error) => options.onError?.(error),
    });
    this.backgroundPreparation = createSourceBankBackgroundPreparation({
      scenes: this.scenes,
      layers: this.layers,
      host: options.host,
      scheduleFrame: (callback) => options.host.scheduleFrame(callback),
      cancelFrame: (handle) => options.host.cancelFrame(handle),
      onReady: () => options.onInactiveBankReady?.(),
      onError: (error) => options.onError?.(error),
    });
    this.projector = new DocumentProjector({
      scheduler: this.scheduler,
      accounting: options.projectionAccounting ?? createSourceFeatureProjectionAccounting(),
      stats: options.rendererStats ?? createRendererStatsCollector(),
      instrumentationEnabled: options.instrumentationEnabled ?? false,
      now: () => options.host.now(),
      requeue: (sourceIds, transition) => options.requeueProjection?.(sourceIds, transition),
      publish: (prepared, request, measurement, onAccepted) =>
        this.publishScene({
          revision: request.revision,
          features: prepared.features,
          sourceIds: prepared.sourceIds,
          ...(prepared.entityUpdate?.kind === 'scoped'
            ? { replacementDomainsBySource: prepared.entityUpdate.replacementDomainsBySource }
            : {}),
          intent: request.intent,
          onAccepted,
          recordScheduling: (stats) => measurement.recordScheduling(stats),
        }),
    });
  }

  projectDocument(request: DocumentProjectionRequest): Promise<void> {
    this.assertActive();
    this.cancelBackgroundPreparation();
    return this.projector.project(request);
  }

  cancelProjectionAndRequeue(): boolean {
    return this.projector.cancelAndRequeue();
  }

  afterCurrentProjectionSettles(callback: () => void): void {
    this.projector.afterCurrentSettles(callback);
  }

  hasActiveProjection(): boolean {
    return this.projector.hasActiveProjection();
  }

  publishScene(input: PublishLiveSceneInput): ScenePublicationSubmission {
    this.assertActive();
    this.cancelBackgroundPreparation();
    let mutatedSourceIds: readonly string[] = [];
    return publishSceneDraft({
      scheduler: this.scheduler,
      controller: this.scenes,
      input,
      beforeSourceMutation: async (context) => {
        if ((context.mode === 'hidden' || context.mode === 'seed') && context.bank) {
          this.layers.prepare(context.bank);
          await this.waitForPaint(this.sourceSubmissionAbort?.signal);
        }
      },
      onSourceMutationStart: (sourceIds, context) => {
        this.sourceSubmissionAbort?.abort();
        this.sourceSubmissionAbort = new AbortController();
        this.sourceSubmissionMode = context.mode ?? null;
        this.sourceSubmissionBank = context.bank ?? null;
        mutatedSourceIds = sourceIds;
      },
      beforePublish: async (context) => {
        if (context.sourceIds.length === 0) return;
        await this.waitForLoad(context.sourceIds, this.sourceSubmissionAbort?.signal);
        if ((context.mode === 'hidden' || context.mode === 'seed') && context.bank) {
          await this.waitForPaint(this.sourceSubmissionAbort?.signal);
        }
      },
      beforeScenePublish: async (context) => {
        if (context.mode !== 'hidden' || !context.bank) return;
        this.options.synchronizeInteractionState?.(context.targetsForDomainIdentity);
        this.layers.activate(context.bank);
        this.options.refreshInteractionPreviews?.();
        await this.waitForPaint(this.sourceSubmissionAbort?.signal);
      },
      onCommitError: (error, context) => {
        this.rollbackPublication(context?.bank ?? null);
        if (context?.mode !== 'hidden' && context?.mode !== 'seed') {
          this.recovery.requestRecovery();
        }
        this.options.onError?.(error);
      },
      onCommitted: async (update, context) => {
        try {
          this.options.synchronizeInteractionState?.();
          this.options.refreshInteractionPreviews?.();
          if (mutatedSourceIds.length > 0 && context?.mode !== 'hidden') {
            await this.waitForPaint(this.sourceSubmissionAbort?.signal);
            await this.recovery.whenSettled();
          }
          if (context?.mode === 'hidden' && context.bank) {
            this.layers.finishActivation(context.bank);
          }
          await input.onAccepted?.(update);
          this.backgroundPreparation.start();
        } finally {
          this.clearSourceSubmission();
        }
      },
      recordScheduling: (stats) => input.recordScheduling?.(stats),
    });
  }

  /** Editor handles and guides use the retained scene index but remain on
   * unbanked sources. This is intentionally synchronous and never enters the
   * committed projection queue. */
  updateEditorScene(input: SceneUpdate): AcceptedSceneUpdate {
    this.assertActive();
    try {
      return this.scenes.applySynchronously(input);
    } catch (error) {
      this.recovery.requestRecovery();
      throw error;
    }
  }

  hasAcceptedScene(): boolean {
    return this.scenes.acceptedScene() !== null;
  }

  publicationInProgress(): boolean {
    return this.scenes.publicationInProgress() || this.sourceSubmissionAbort !== null;
  }

  targetsForDomainIdentity(domainIdentity: RenderDomainIdentity): readonly SceneFeatureTarget[] {
    return this.scenes.targetsForDomainIdentity(domainIdentity);
  }

  activeSourceId(logicalSourceId: string): string {
    return this.banks.activeSourceId(logicalSourceId) ?? logicalSourceId;
  }

  activeLayerId(logicalLayerId: string): string | null {
    return this.banks.activeLayerId(logicalLayerId);
  }

  physicalLayerIds(logicalLayerId: string): string[] {
    return physicalRenderLayerIds(logicalLayerId, this.bankedLayerIds, this.banks.activeBank());
  }

  setLayerVisibility(logicalLayerId: string, visibility: RenderLayerVisibility): void {
    this.layers.setLogicalVisibility(logicalLayerId, visibility);
  }

  setLayerPaintProperty(logicalLayerId: string, property: string, value: unknown): void {
    this.layers.setLogicalPaintProperty(logicalLayerId, property, value);
  }

  restoreActiveLayers(): void {
    const activeBank = this.banks.activeBank();
    if (activeBank) this.layers.restore(activeBank);
  }

  handleSourceError(event: RenderSourceErrorEvent): boolean {
    const bank = event.sourceId?.endsWith('--bank-a')
      ? 'a'
      : event.sourceId?.endsWith('--bank-b')
        ? 'b'
        : null;
    if (
      bank !== null &&
      bank === this.sourceSubmissionBank &&
      (this.sourceSubmissionMode === 'hidden' || this.sourceSubmissionMode === 'seed')
    ) {
      this.sourceSubmissionAbort?.abort();
      return true;
    }
    return this.recovery.handleSourceError(event);
  }

  requestRecovery(sourceId?: string): void {
    this.recovery.requestRecovery(sourceId);
  }

  whenRecoverySettled(): Promise<void> {
    return this.recovery.whenSettled();
  }

  recoveryVersion(): number {
    return this.recovery.version();
  }

  invalidateSourceState(): void {
    this.scenes.invalidateSourceState();
  }

  healAcceptedScene(): RenderSceneSourceUpdateResult {
    return this.scenes.healCurrentScene();
  }

  cancelBackgroundPreparation(): void {
    this.backgroundPreparation.cancel();
  }

  snapshot(): LiveMapRendererSnapshot {
    return {
      acceptedRevision: this.scenes.acceptedScene()?.revision ?? null,
      activeRevision: this.banks.activeRevision(),
      activeBank: this.banks.activeBank(),
      stagingBank: this.layers.stagingBankId(),
      publicationInProgress: this.publicationInProgress(),
      recoveryVersion: this.recovery.version(),
      diagnostics: this.banks.snapshot(),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelBackgroundPreparation();
    this.sourceSubmissionAbort?.abort();
    this.sourceSubmissionAbort = null;
    this.projector.dispose();
    this.recovery.dispose();
    if (this.ownsScheduler) this.scheduler.dispose();
  }

  private rollbackPublication(bank: SourceBankId | null): void {
    this.sourceSubmissionAbort?.abort();
    if (bank) this.restoreAfterFailedBank(bank);
    this.options.synchronizeInteractionState?.();
    this.options.refreshInteractionPreviews?.();
    this.clearSourceSubmission();
  }

  private restoreAfterFailedBank(failedBank: SourceBankId): void {
    const activeBank = this.banks.activeBank();
    if (activeBank && activeBank !== failedBank) this.layers.restore(activeBank);
    else this.layers.finishStaging(failedBank);
  }

  private clearSourceSubmission(): void {
    this.sourceSubmissionAbort = null;
    this.sourceSubmissionMode = null;
    this.sourceSubmissionBank = null;
  }

  private waitForLoad(sourceIds: readonly string[], signal?: AbortSignal): Promise<void> {
    return waitForSourceBankLoad({
      host: this.options.host,
      sourceIds,
      ...(signal ? { signal } : {}),
    });
  }

  private waitForPaint(signal?: AbortSignal): Promise<void> {
    return waitForSourceBankPaint({
      host: this.options.host,
      ...(signal ? { signal } : {}),
    });
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('The live map renderer is disposed.');
  }
}

export function createLiveMapRenderer(options: LiveMapRendererOptions): LiveMapRenderer {
  return new LiveMapRenderer(options);
}
