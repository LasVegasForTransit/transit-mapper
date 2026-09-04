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
import type { CooperativeRenderJobSchedulerStats } from '@transitmapper/renderer/projection';
import {
  createCooperativeRenderJobScheduler,
  type CooperativeRenderJobScheduler,
} from '@transitmapper/renderer/projection';
import {
  createAcceptedSceneStore,
  type AcceptedSceneStore,
  type AcceptedSceneUpdate,
  type SceneFeatureTarget,
  type SceneUpdate,
} from '@transitmapper/renderer/runtime';
import { SRC_HIT_FEATURES } from '@transitmapper/renderer/layers';
import type {
  GeoJsonSourceTarget,
  RenderSceneSourceUpdateResult,
} from '@transitmapper/renderer/runtime';
import type {
  RenderSourceErrorEvent,
  RenderSourceErrorRecoveryCoordinator,
} from './sources/render-source-error-recovery';
import { createAcceptedSceneRecovery } from './accepted-scene-recovery';
import { RendererSourcePublication } from './sources/renderer-source-publication';
import {
  DocumentProjector,
  type DiagramLayoutResolver,
  type DocumentProjectionRequest,
} from '@transitmapper/renderer/projection';
import type { FeatureProjectionClient } from '@transitmapper/renderer/projection';
import {
  createSourceFeatureProjectionAccounting,
  type SourceFeatureProjectionAccounting,
} from '@transitmapper/renderer/projection';
import type { SourceUploadTransition } from '@transitmapper/renderer/projection';
import type { MapSystemFeatureSourceId } from '@transitmapper/renderer/layers';
import {
  createRendererStatsCollector,
  type RendererStatsCollector,
} from '@transitmapper/renderer/stats';
import {
  publishSceneDraft,
  type ScenePublicationSubmission,
} from '@transitmapper/renderer/runtime';
import { createSourceBankDataStore } from './sources/source-bank-data';
import {
  createSourceBankLayerController,
  logicalBankedLayerIds,
  physicalRenderLayerIds,
  type RenderLayerVisibility,
  type SourceBankLayerController,
} from './sources/source-bank-layers';
import {
  createSourceBankController,
  type SourceBankController,
  type SourceBankDiagnostics,
  type SourceBankId,
} from './sources/source-bank';
import {
  createSourceBankBackgroundPreparation,
  type SourceBankBackgroundPreparation,
  type SourceBankSettlementHost,
} from './sources/source-bank-settlement';
import {
  COMMITTED_SYSTEM_FEATURE_SOURCES,
  EDITOR_SYSTEM_FEATURE_SOURCES,
} from '@transitmapper/renderer/layers';

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

export type SceneTargetResolver = (
  domainIdentity: RenderDomainIdentity,
) => readonly SceneFeatureTarget[];

export interface LiveMapRendererOptions {
  readonly host: LiveMapRendererHost;
  readonly layerSpecs: readonly LayerSpecification[];
  /** Projection and scene publication normally share one scheduler. Tests and
   * isolated consumers may omit it and let the renderer own one. */
  readonly scheduler?: CooperativeRenderJobScheduler;
  readonly projectionAccounting?: SourceFeatureProjectionAccounting;
  readonly rendererStats?: RendererStatsCollector;
  readonly instrumentationEnabled?: boolean;
  /** Geographic feature construction is worker-owned. The renderer still
   * owns MapLibre source and bank publication on this thread. */
  readonly featureProjectionWorker: FeatureProjectionClient;
  readonly layoutDiagram?: DiagramLayoutResolver;
  readonly requeueProjection?: (
    sourceIds: readonly MapSystemFeatureSourceId[],
    transition: SourceUploadTransition | null,
  ) => void;
  readonly synchronizeInteractionState?: (targets?: SceneTargetResolver) => void;
  readonly refreshInteractionPreviews?: () => void;
  readonly onInactiveBankReady?: () => void;
  readonly onRecoveryUpdate?: (update: RenderSceneSourceUpdateResult) => void | Promise<void>;
  readonly onError?: (error: unknown) => void;
}

export interface PublishLiveSceneInput extends SceneUpdate {
  readonly onAccepted?: (update: AcceptedSceneUpdate) => void | Promise<void>;
  readonly recordScheduling?: (stats: CooperativeRenderJobSchedulerStats) => void;
}

export interface LiveMapRendererSnapshot {
  readonly acceptedRevision: string | null;
  readonly activeRevision: string | null;
  readonly activeBank: SourceBankId | null;
  readonly stagingBank: SourceBankId | null;
  readonly publicationInProgress: boolean;
  readonly recoveryVersion: number;
  readonly diagnostics: SourceBankDiagnostics;
  readonly scheduler: CooperativeRenderJobSchedulerStats;
}

/** One concrete runtime object rather than a collection of public pipeline
 * adapters. Its methods are phrased in scene, layer, and recovery vocabulary
 * because those are the decisions MapCanvas genuinely owns. */
/** Chosen to stay well inside a frame on the throttled hardware the budgets
 * are measured on, rather than to be as large as possible: a slice that
 * overruns a frame trades a faster first paint for a visibly stalled one. */
const COLD_START_SLICE_BUDGET_MS = 24;

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
  private readonly sourcePublication: RendererSourcePublication;
  private readonly reportError: (error: unknown) => void;
  private readonly triggerRepaint: () => void;
  private pendingEditorScene: SceneUpdate | null = null;
  private disposed = false;

  constructor(options: LiveMapRendererOptions) {
    this.reportError = (error) => options.onError?.(error);
    this.triggerRepaint = () => options.host.triggerRepaint();
    this.scheduler =
      options.scheduler ??
      createCooperativeRenderJobScheduler({
        // Four-entity scene units can legally take just under 4 ms. An 8 ms
        // slice preserves that reserve while allowing a second ready unit in
        // the same frame instead of stretching cold startup across hundreds
        // of virtual-display animation frames.
        //
        // A slice still costs a whole frame, so the wall time to a first paint
        // is the slice count times the frame interval, whatever each slice
        // spends. Until something is on screen there is no interaction for the
        // reserve to protect, so cold start takes a larger slice and reaches
        // the first accepted scene in fewer frames. Every slice after that one
        // is back to 8 ms.
        budgetMs: () => (this.hasAcceptedScene() ? 8 : COLD_START_SLICE_BUDGET_MS),
        now: () => options.host.now(),
        scheduleFrame: (callback) => options.host.scheduleFrame(callback),
        cancelFrame: (handle) => options.host.cancelFrame(handle),
        onError: (error) => this.reportError(error),
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
    this.sourcePublication = new RendererSourcePublication({
      host: options.host,
      banks: this.banks,
      layers: this.layers,
      recovery: this.recovery,
      synchronizeInteractionState: (targets) => options.synchronizeInteractionState?.(targets),
      refreshInteractionPreviews: () => options.refreshInteractionPreviews?.(),
      onError: (error) => options.onError?.(error),
    });
    this.backgroundPreparation = createSourceBankBackgroundPreparation({
      scenes: this.scenes,
      layers: this.layers,
      host: options.host,
      scheduleFrame: (callback) => options.host.scheduleFrame(callback),
      cancelFrame: (handle) => options.host.cancelFrame(handle),
      onReady: () => {
        this.flushPendingEditorScene();
        options.onInactiveBankReady?.();
      },
      onError: (error) => {
        this.flushPendingEditorScene();
        options.onError?.(error);
      },
    });
    this.projector = this.createProjector(options);
  }

  /** Projection is the only producer of committed scene drafts. It delegates
   * the irreversible MapLibre boundary back to this renderer's publication
   * lifecycle, so callers cannot accidentally publish a partial draft. */
  private createProjector(options: LiveMapRendererOptions): DocumentProjector {
    return new DocumentProjector({
      scheduler: this.scheduler,
      accounting: options.projectionAccounting ?? createSourceFeatureProjectionAccounting(),
      stats: options.rendererStats ?? createRendererStatsCollector(),
      instrumentationEnabled: options.instrumentationEnabled ?? false,
      featureProjectionWorker: options.featureProjectionWorker,
      now: () => options.host.now(),
      ...(options.layoutDiagram ? { layoutDiagram: options.layoutDiagram } : {}),
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
    return publishSceneDraft({
      scheduler: this.scheduler,
      controller: this.scenes,
      input,
      ...this.sourcePublication.hooks({
        onAccepted: input.onAccepted,
        afterAccepted: () => {
          this.flushPendingEditorScene();
          this.backgroundPreparation.start();
        },
      }),
      recordScheduling: (stats) => input.recordScheduling?.(stats),
    });
  }

  /** Editor handles and guides stay on unbanked sources. They still derive
   * from the accepted scene, so an editor update waits for an in-flight bank
   * publication instead of preparing from a provisional revision. */
  updateEditorScene(input: SceneUpdate): AcceptedSceneUpdate | null {
    this.assertActive();
    // Committed banks and editor overlays own distinct MapLibre sources, but
    // their scene drafts share the accepted identity snapshot. Do not let an
    // editor refresh prepare against that snapshot while a bank publication is
    // still provisional: the latest editor intent is retained and applied as
    // soon as the committed revision becomes authoritative.
    if (this.publicationInProgress()) {
      this.pendingEditorScene = input;
      return null;
    }
    return this.applyEditorScene(input);
  }

  private applyEditorScene(input: SceneUpdate): AcceptedSceneUpdate {
    try {
      return this.scenes.applySynchronously(input);
    } catch (error) {
      this.recovery.requestRecovery();
      throw error;
    }
  }

  private flushPendingEditorScene(): void {
    const pending = this.pendingEditorScene;
    if (!pending || this.scenes.publicationInProgress() || this.disposed) return;
    this.pendingEditorScene = null;
    try {
      this.applyEditorScene(pending);
    } catch (error) {
      // The accepted bank remains valid. Report this separately so the
      // caller can schedule recovery without making a delayed editor update
      // an uncaught rendering failure.
      this.reportError(error);
    }
  }

  hasAcceptedScene(): boolean {
    return this.scenes.acceptedScene() !== null;
  }

  publicationInProgress(): boolean {
    return this.scenes.publicationInProgress() || this.sourcePublication.inProgress();
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
    if (!activeBank) return;
    this.layers.restore(activeBank);
    this.triggerRepaint();
  }

  handleSourceError(event: RenderSourceErrorEvent): boolean {
    return this.sourcePublication.handleSourceError(event);
  }

  requestRecovery(sourceId?: string): void {
    // A retained-scene heal and the speculative inactive-bank seed both own
    // the same source plan. Recovery wins because a style change can discard
    // the data that the accepted scene needs to remain visible.
    this.cancelBackgroundPreparation();
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
      scheduler: this.scheduler.snapshot(),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pendingEditorScene = null;
    this.cancelBackgroundPreparation();
    this.sourcePublication.dispose();
    this.projector.dispose();
    this.recovery.dispose();
    if (this.ownsScheduler) this.scheduler.dispose();
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('The live map renderer is disposed.');
  }
}

export function createLiveMapRenderer(options: LiveMapRendererOptions): LiveMapRenderer {
  return new LiveMapRenderer(options);
}
