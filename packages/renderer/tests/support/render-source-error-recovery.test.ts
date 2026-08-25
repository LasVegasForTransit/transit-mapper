import { vi } from 'vitest';
import {
  createRenderSourceErrorRecoveryCoordinator,
  type RenderSourceErrorRecoveryCoordinator,
  type RenderSourceErrorRecoveryOptions,
} from '../../src/render-source-error-recovery';
import type { RenderSceneSourceUpdateResult } from '../../src/render-scene-source-updater';

export const RECOVERY_WAYS_SOURCE = 'tm-ways';
export const RECOVERY_HIT_SOURCE = 'tm-hit-features';
export const RECOVERY_HEAL_RESULT: RenderSceneSourceUpdateResult = {
  strategy: 'full',
  sourceUploadCount: 2,
  fullSourceUploadCount: 2,
  patchSourceUploadCount: 0,
  fallbackSourceUploadCount: 0,
  uploadedFeatureCount: 3,
  addedFeatureCount: 0,
  changedFeatureCount: 0,
  removedFeatureCount: 0,
};

export class RecoveryFrameHarness {
  private nextHandle = 1;
  private readonly callbacks = new Map<number, () => void>();

  readonly schedule = vi.fn((callback: () => void): number => {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.callbacks.set(handle, callback);
    return handle;
  });
  readonly cancel = vi.fn((handle: number): void => {
    this.callbacks.delete(handle);
  });
  flushNext(): void {
    const next = this.callbacks.entries().next();
    if (next.done) throw new Error('No scheduled frame to flush.');
    const [handle, callback] = next.value;
    this.callbacks.delete(handle);
    callback();
  }
  pendingCount(): number {
    return this.callbacks.size;
  }
}

export interface RecoveryHarness {
  coordinator: RenderSourceErrorRecoveryCoordinator;
  frames: RecoveryFrameHarness;
  ensureSources: ReturnType<typeof vi.fn<() => boolean>>;
  invalidateSourceState: ReturnType<typeof vi.fn<() => void>>;
  healCurrentScene: ReturnType<typeof vi.fn<() => RenderSceneSourceUpdateResult>>;
  onSuccess: ReturnType<typeof vi.fn<(result: RenderSceneSourceUpdateResult) => void>>;
  onError: ReturnType<typeof vi.fn<(error: unknown) => void>>;
}

export function recoveryHarness(
  overrides: Partial<RenderSourceErrorRecoveryOptions> = {},
): RecoveryHarness {
  const frames = new RecoveryFrameHarness();
  const ensureSources = vi.fn<() => boolean>(() => true);
  const invalidateSourceState = vi.fn<() => void>();
  const healCurrentScene = vi.fn<() => RenderSceneSourceUpdateResult>(() => RECOVERY_HEAL_RESULT);
  const onSuccess = vi.fn<(result: RenderSceneSourceUpdateResult) => void>();
  const onError = vi.fn<(error: unknown) => void>();
  const coordinator = createRenderSourceErrorRecoveryCoordinator({
    rendererSourceIds: [RECOVERY_WAYS_SOURCE, RECOVERY_HIT_SOURCE],
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
    ensureSources,
    controller: { invalidateSourceState, healCurrentScene },
    onSuccess,
    onError,
    ...overrides,
  });
  return {
    coordinator,
    frames,
    ensureSources,
    invalidateSourceState,
    healCurrentScene,
    onSuccess,
    onError,
  };
}
