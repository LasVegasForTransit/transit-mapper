/**
 * Replays the last accepted scene after MapLibre reports a renderer-source
 * error. Recovery follows the same hidden-bank rule as normal publication:
 * prepare offscreen, load exactly the affected sources, paint, then switch.
 */
import type { RenderSceneSourceUpdateResult } from './render-scene-source-updater';
import {
  createRenderSourceErrorRecoveryCoordinator,
  type RenderSourceErrorRecoveryCoordinator,
} from './render-source-error-recovery';
import type { AcceptedSceneStore } from './accepted-scene-store';
import { SRC_HIT_FEATURES } from './layers/constants';
import type { SourceBankController, SourceBankId } from './source-bank';
import type { SourceBankLayerController } from './source-bank-layers';
import {
  waitForSourceBankLoad,
  waitForSourceBankPaint,
  type SourceBankSettlementHost,
} from './source-bank-settlement';
import {
  COMMITTED_SYSTEM_FEATURE_SOURCES,
  EDITOR_SYSTEM_FEATURE_SOURCES,
} from './system-feature-sources';

export interface AcceptedSceneRecoveryHost extends SourceBankSettlementHost {
  ensureOverlay(): boolean;
  scheduleFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
}

export interface AcceptedSceneRecoveryOptions {
  readonly host: AcceptedSceneRecoveryHost;
  readonly scenes: AcceptedSceneStore;
  readonly banks: SourceBankController;
  readonly layers: SourceBankLayerController;
  synchronizeInteractionState(): void;
  refreshInteractionPreviews(): void;
  onRecovered(update: RenderSceneSourceUpdateResult): void | Promise<void>;
  onError(error: unknown): void;
}

function physicalSourceIds(): string[] {
  return [
    ...COMMITTED_SYSTEM_FEATURE_SOURCES.flatMap((sourceId) => [
      `${sourceId}--bank-a`,
      `${sourceId}--bank-b`,
    ]),
    `${SRC_HIT_FEATURES}--bank-a`,
    `${SRC_HIT_FEATURES}--bank-b`,
    ...EDITOR_SYSTEM_FEATURE_SOURCES,
  ];
}

function restoreAcceptedBank(
  banks: SourceBankController,
  layers: SourceBankLayerController,
  failedBank: SourceBankId,
): void {
  const activeBank = banks.activeBank();
  if (activeBank && activeBank !== failedBank) layers.restore(activeBank);
  else layers.finishStaging(failedBank);
}

export function createAcceptedSceneRecovery(
  options: AcceptedSceneRecoveryOptions,
): RenderSourceErrorRecoveryCoordinator {
  let mutatedSourceIds: readonly string[] = [];
  let mode: 'active' | 'hidden' | 'seed' | 'unbanked' | undefined;
  let bank: SourceBankId | null | undefined;
  const abort = new AbortController();
  const paint = () => waitForSourceBankPaint({ host: options.host, signal: abort.signal });

  return createRenderSourceErrorRecoveryCoordinator({
    rendererSourceIds: physicalSourceIds(),
    scheduleFrame: (callback) => options.host.scheduleFrame(callback),
    cancelFrame: (handle) => options.host.cancelFrame(handle),
    ensureSources: () => options.host.ensureOverlay(),
    controller: options.scenes,
    beforeSourceMutation: async (plan) => {
      if ((plan.mode === 'hidden' || plan.mode === 'seed') && plan.bank) {
        options.layers.prepare(plan.bank);
        await paint();
      }
    },
    onSourceMutationStart: (sourceIds, plan) => {
      mutatedSourceIds = sourceIds;
      mode = plan.mode;
      bank = plan.bank;
    },
    beforePublish: async (plan) => {
      mode = plan.mode;
      bank = plan.bank;
      if (plan.sourceIds.length === 0) return;
      await waitForSourceBankLoad({
        host: options.host,
        sourceIds: plan.sourceIds,
        signal: abort.signal,
      });
      if ((plan.mode === 'hidden' || plan.mode === 'seed') && plan.bank) await paint();
    },
    beforeScenePublish: async (plan) => {
      if (plan.mode !== 'hidden' || !plan.bank) return;
      options.synchronizeInteractionState();
      options.layers.activate(plan.bank);
      await paint();
    },
    onSuccess: async (update) => {
      try {
        options.synchronizeInteractionState();
        if (mutatedSourceIds.length > 0 && mode !== 'hidden') await paint();
        if (mode === 'hidden' && bank) options.layers.finishActivation(bank);
        else if (mode === 'seed' && bank) options.layers.finishStaging(bank);
        await options.onRecovered(update);
      } finally {
        mutatedSourceIds = [];
        mode = undefined;
        bank = undefined;
      }
    },
    onError: (error) => {
      if (bank) restoreAcceptedBank(options.banks, options.layers, bank);
      options.synchronizeInteractionState();
      options.refreshInteractionPreviews();
      mutatedSourceIds = [];
      mode = undefined;
      bank = undefined;
      options.onError(error);
    },
  });
}
