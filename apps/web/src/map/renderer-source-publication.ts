/**
 * MapLibre source publication for one live renderer generation.
 *
 * Draft construction is private and retryable. This owner begins when a draft
 * is ready to mutate GeoJSON sources: it prewarms an inactive bank, observes
 * every source before the first mutation, waits for the loaded revision, and
 * flips visual and hit ownership only after that revision can paint. Keeping
 * those steps together prevents a source event or recovery error from leaving
 * the CPU scene, visible layers, and hit queries on different revisions.
 */
import type { RenderDomainIdentity } from '@transitmapper/core/render/render-identity';
import type { AcceptedSceneUpdate, SceneFeatureTarget } from './accepted-scene-store';
import type {
  RenderSourceErrorEvent,
  RenderSourceErrorRecoveryCoordinator,
} from './render-source-error-recovery';
import type { ScenePublicationContext, PublishSceneDraftOptions } from './scene-publication';
import type { SourceBankController, SourceBankId } from './source-bank';
import { SRC_HIT_FEATURES } from './layers/constants';
import { logicalRenderSourceId, type SourceBankLayerController } from './source-bank-layers';
import {
  waitForSourceBankLoad,
  waitForSourceBankPaint,
  type SourceBankSettlementHost,
} from './source-bank-settlement';

type SceneTargetResolver = (domainIdentity: RenderDomainIdentity) => readonly SceneFeatureTarget[];

export interface RendererSourcePublicationOptions {
  readonly host: SourceBankSettlementHost;
  readonly banks: SourceBankController;
  readonly layers: SourceBankLayerController;
  readonly recovery: RenderSourceErrorRecoveryCoordinator;
  readonly synchronizeInteractionState?: (targets?: SceneTargetResolver) => void;
  readonly refreshInteractionPreviews?: () => void;
  readonly onError?: (error: unknown) => void;
}

export interface RendererSourcePublicationHooks {
  readonly onAccepted?: (update: AcceptedSceneUpdate) => void | Promise<void>;
  readonly afterAccepted?: () => void;
}

/** Coordinates the irreversible MapLibre half of a scene publication. */
export class RendererSourcePublication {
  private abortController: AbortController | null = null;
  /** A GeoJSON source can report loaded during its own synchronous mutation,
   * so this subscription deliberately begins before the first source unit. */
  private sourceLoad: Promise<void> | null = null;
  private finishSourceMutations: (() => void) | null = null;
  private mode: ScenePublicationContext['mode'] | null = null;
  private bank: SourceBankId | null = null;

  constructor(private readonly options: RendererSourcePublicationOptions) {}

  hooks({
    onAccepted,
    afterAccepted,
  }: RendererSourcePublicationHooks): Pick<
    PublishSceneDraftOptions<AcceptedSceneUpdate>,
    | 'beforeSourceMutation'
    | 'onSourceMutationStart'
    | 'beforePublish'
    | 'beforeScenePublish'
    | 'onCommitError'
    | 'onCommitted'
  > {
    let mutatedSourceIds: readonly string[] = [];
    return {
      beforeSourceMutation: async (context) => {
        if (!this.isInactiveBank(context)) return;
        this.options.layers.prepare(context.bank, this.clearedLogicalSourceIds(context));
        // The initial scene has no active bank to preserve. Waiting for a
        // render of its empty, fully hidden staging bank can deadlock MapLibre
        // before the first GeoJSON mutation schedules a real frame.
        if (!this.options.banks.activeBank()) return;
        await this.waitForPaint();
      },
      onSourceMutationStart: (sourceIds, context) => {
        mutatedSourceIds = sourceIds;
        this.beginSourceMutation(this.sourceIdsAwaitingReadiness(sourceIds, context), context);
      },
      beforePublish: async (context) => {
        if (context.sourceIds.length === 0) return;
        this.finishSourceMutations?.();
        this.finishSourceMutations = null;
        if (this.sourceLoad) await this.sourceLoad;
        if (this.isInactiveBank(context)) await this.waitForPaint();
      },
      beforeScenePublish: async (context) => {
        if (context.mode !== 'hidden' || !context.bank) return;
        this.options.synchronizeInteractionState?.(context.targetsForDomainIdentity);
        this.options.layers.activate(context.bank);
        this.options.refreshInteractionPreviews?.();
        await this.waitForPaint();
      },
      onCommitError: (error, context) => {
        this.rollback(context?.bank ?? null);
        if (context?.mode !== 'hidden' && context?.mode !== 'seed') {
          this.options.recovery.requestRecovery();
        }
        this.options.onError?.(error);
      },
      onCommitted: async (update, context) => {
        try {
          this.options.synchronizeInteractionState?.();
          this.options.refreshInteractionPreviews?.();
          if (mutatedSourceIds.length > 0 && context?.mode !== 'hidden') {
            await this.waitForPaint();
            await this.options.recovery.whenSettled();
          }
          if (context?.mode === 'hidden' && context.bank) {
            this.options.layers.finishActivation(context.bank);
          }
          await onAccepted?.(update);
        } finally {
          this.clear();
        }
        // `afterAccepted` may prepare an editor-only scene. Release this
        // publication's source barrier first: the accepted CPU scene and the
        // physical bank are authoritative now, so the editor can safely use
        // that exact revision without being mistaken for a competing bank
        // transaction.
        afterAccepted?.();
      },
    };
  }

  inProgress(): boolean {
    return this.abortController !== null;
  }

  handleSourceError(event: RenderSourceErrorEvent): boolean {
    const bank = sourceBankFromPhysicalId(event.sourceId);
    if (bank !== null && bank === this.bank && (this.mode === 'hidden' || this.mode === 'seed')) {
      this.abortController?.abort();
      return true;
    }
    return this.options.recovery.handleSourceError(event);
  }

  dispose(): void {
    this.abortController?.abort();
    this.clear();
  }

  private beginSourceMutation(
    sourceIds: readonly string[],
    context: ScenePublicationContext,
  ): void {
    this.abortController?.abort();
    this.abortController = new AbortController();
    this.mode = context.mode ?? null;
    this.bank = context.bank ?? null;
    if (sourceIds.length === 0) {
      this.sourceLoad = null;
      this.finishSourceMutations = null;
      return;
    }
    let finishMutations = () => {};
    const mutationsComplete = new Promise<void>((resolve) => {
      finishMutations = resolve;
    });
    this.finishSourceMutations = finishMutations;
    // Observe acknowledgements from the first mutation, but do not let them
    // release the revision until `beforePublish` confirms that every source
    // unit has run. That keeps a quick first source from exposing a partial
    // bank while accommodating MapLibre's offscreen source-cache semantics.
    const sourceLoad = waitForSourceBankLoad({
      host: this.options.host,
      sourceIds,
      mutationsComplete,
      signal: this.abortController.signal,
    });
    void sourceLoad.catch(() => {});
    this.sourceLoad = sourceLoad;
  }

  private rollback(failedBank: SourceBankId | null): void {
    this.abortController?.abort();
    if (failedBank) this.restoreAfterFailedBank(failedBank);
    this.options.synchronizeInteractionState?.();
    this.options.refreshInteractionPreviews?.();
    this.clear();
  }

  private restoreAfterFailedBank(failedBank: SourceBankId): void {
    const activeBank = this.options.banks.activeBank();
    if (activeBank && activeBank !== failedBank) this.options.layers.restore(activeBank);
    else this.options.layers.finishStaging(failedBank);
  }

  private clear(): void {
    this.sourceLoad = null;
    this.finishSourceMutations = null;
    this.abortController = null;
    this.mode = null;
    this.bank = null;
  }

  private isInactiveBank(context: ScenePublicationContext): context is ScenePublicationContext & {
    readonly bank: SourceBankId;
  } {
    return (context.mode === 'hidden' || context.mode === 'seed') && context.bank !== undefined;
  }

  private sourceIdsAwaitingReadiness(
    sourceIds: readonly string[],
    context: ScenePublicationContext,
  ): string[] {
    if (!this.isInactiveBank(context)) return [...sourceIds];
    const cleared = new Set(context.clearedSourceIds);
    return sourceIds.filter(
      (sourceId) => !cleared.has(sourceId) || logicalRenderSourceId(sourceId) === SRC_HIT_FEATURES,
    );
  }

  private clearedLogicalSourceIds(context: ScenePublicationContext): ReadonlySet<string> {
    return new Set(context.clearedSourceIds.map(logicalRenderSourceId));
  }

  private waitForPaint(): Promise<void> {
    return waitForSourceBankPaint({
      host: this.options.host,
      ...(this.abortController ? { signal: this.abortController.signal } : {}),
    });
  }
}

function sourceBankFromPhysicalId(sourceId: string | undefined): SourceBankId | null {
  if (sourceId?.endsWith('--bank-a')) return 'a';
  if (sourceId?.endsWith('--bank-b')) return 'b';
  return null;
}
