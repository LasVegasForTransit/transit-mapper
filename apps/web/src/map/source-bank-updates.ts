/**
 * Source-update policy for the two physical renderer banks.
 *
 * The bank controller owns revision identity. This module owns the separate
 * question of whether a change may patch the visible bank or must be staged
 * as a complete inactive-bank revision.
 */
import type { SystemFeatureSourceId } from '@transitmapper/core/render/render-identity';
import type { RenderScene } from '@transitmapper/core/render/render-scene';
import type { RenderScenePatch } from '@transitmapper/core/render/render-scene-diff';
import {
  renderScenePatchEntryCount,
  renderScenePatchSourceCount,
} from './render-scene-patch-journal';
import {
  createRenderSceneSourceUpdater,
  type ApplyRenderSceneOptions,
  type GeoJsonSourceTarget,
  type RenderSceneSourceUpdatePlan,
  type RenderSceneSourceUpdateResult,
  type RenderSceneSourceUpdater,
} from './render-scene-source-updater';
import {
  bankedSourceId,
  type SourceBankRevision,
  type SourceBankController,
  type SourceBankId,
} from './source-bank';

export type SourceBankUpdateMode = 'active' | 'hidden' | 'seed' | 'unbanked';

export interface SourceBankUpdatePlan extends RenderSceneSourceUpdatePlan {
  readonly mode: SourceBankUpdateMode;
  readonly bank: SourceBankId | null;
  markSourcesLoaded(): void;
}

export interface SourceBankDataStoreOptions {
  readonly controller: SourceBankController;
  readonly sourceIds: readonly SystemFeatureSourceId[];
  readonly unbankedSourceIds?: readonly SystemFeatureSourceId[];
  readonly hitSourceId: string;
  resolveSource(sourceId: SystemFeatureSourceId, bank: SourceBankId): GeoJsonSourceTarget;
  resolveHitSource(bank: SourceBankId): GeoJsonSourceTarget;
  resolveUnbankedSource?(sourceId: SystemFeatureSourceId): GeoJsonSourceTarget;
}

export interface SourceBankDataStore {
  prepare(scene: RenderScene, options?: ApplyRenderSceneOptions): SourceBankUpdatePlan;
  apply(scene: RenderScene, options?: ApplyRenderSceneOptions): RenderSceneSourceUpdateResult;
  currentScene(): RenderScene | null;
  residentScene(bank: SourceBankId): RenderScene | null;
  invalidateSourceState(physicalSourceId?: string): void;
  prepareCurrentSceneHeal(): SourceBankUpdatePlan | null;
  prepareInactiveSeed(): SourceBankUpdatePlan | null;
  healCurrentScene(): RenderSceneSourceUpdateResult;
}

export interface JournalEntry {
  readonly sequence: number;
  readonly patch: RenderScenePatch;
}

export interface PendingTransition {
  readonly next: RenderScene;
  readonly patch: RenderScenePatch | null;
  readonly targetSequence: number;
  readonly fullBarrier: boolean;
}

export interface WrapPlanOptions {
  readonly delegate: RenderSceneSourceUpdatePlan;
  readonly mode: SourceBankUpdateMode;
  readonly bank: SourceBankId;
  readonly pending: PendingTransition;
  readonly transaction?: ReturnType<SourceBankController['begin']>;
}

export const MAX_ACTIVE_PATCH_ENTRIES = 64;

export function hasBankSceneChanges(patch: RenderScenePatch | null): patch is RenderScenePatch {
  return patch !== null && renderScenePatchEntryCount(patch) > 0;
}

export function canApplyDirectBankUpdate(
  delegate: RenderSceneSourceUpdatePlan,
  patch: RenderScenePatch | null,
): boolean {
  return (
    delegate.strategy !== 'full' &&
    (!patch || renderScenePatchEntryCount(patch) <= MAX_ACTIVE_PATCH_ENTRIES) &&
    (!patch || renderScenePatchSourceCount(patch) <= 1)
  );
}

export function emptyRenderSceneSourceUpdateResult(): RenderSceneSourceUpdateResult {
  return {
    strategy: 'none',
    sourceUploadCount: 0,
    fullSourceUploadCount: 0,
    patchSourceUploadCount: 0,
    fallbackSourceUploadCount: 0,
    uploadedFeatureCount: 0,
    addedFeatureCount: 0,
    changedFeatureCount: 0,
    removedFeatureCount: 0,
  };
}

export function sourceBankRevision(scene: RenderScene): SourceBankRevision {
  return { revision: scene.revision, residentFeatureCount: residentFeatureCount(scene) };
}

export function bankScene(
  scene: RenderScene,
  sourceIds: ReadonlySet<SystemFeatureSourceId>,
): RenderScene {
  return {
    ...scene,
    featuresBySource: new Map(
      [...scene.featuresBySource].filter(([sourceId]) => sourceIds.has(sourceId)),
    ),
  };
}

export function residentFeatureCount(scene: RenderScene): number {
  return scene.stats.generatedVisualFeatureCount + scene.stats.generatedHitFeatureCount;
}

export function createBankUpdater(
  options: SourceBankDataStoreOptions,
  bank: SourceBankId,
): RenderSceneSourceUpdater {
  return createRenderSceneSourceUpdater({
    resolveSource: (sourceId) => options.resolveSource(sourceId, bank),
    resolveSourceId: (sourceId) => bankedSourceId(sourceId, bank),
    resolveHitSource: () => options.resolveHitSource(bank),
    hitSourceId: bankedSourceId(options.hitSourceId, bank),
  });
}

export function createUnbankedUpdater(
  options: SourceBankDataStoreOptions,
): RenderSceneSourceUpdater | null {
  if (!options.resolveUnbankedSource || !options.unbankedSourceIds?.length) return null;
  return createRenderSceneSourceUpdater({
    resolveSource: (sourceId) => options.resolveUnbankedSource?.(sourceId),
  });
}

export function physicalLogicalSourceId(physicalSourceId: string, bank: SourceBankId): string {
  const suffix = `--bank-${bank}`;
  if (!physicalSourceId.endsWith(suffix)) {
    throw new Error(`Physical render source does not belong to bank ${bank}: ${physicalSourceId}`);
  }
  return physicalSourceId.slice(0, -suffix.length);
}
