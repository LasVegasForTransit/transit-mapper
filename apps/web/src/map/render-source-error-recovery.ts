import type {
  RenderSceneSourceUpdatePlan,
  RenderSceneSourceUpdateResult,
} from './render-scene-source-updater';

export interface RenderSourceErrorEvent {
  sourceId?: string;
  error?: unknown;
}

export interface RenderSourceRecoveryController {
  invalidateSourceState(sourceId?: string): void;
  prepareCurrentSceneHeal?(): RenderSceneSourceUpdatePlan | null;
  healCurrentScene(): RenderSceneSourceUpdateResult;
}

export interface RenderSourceErrorRecoveryOptions {
  rendererSourceIds: readonly string[];
  scheduleFrame: (callback: () => void) => number;
  cancelFrame: (handle: number) => void;
  ensureSources: () => boolean;
  controller: RenderSourceRecoveryController;
  onSourceMutationStart?: (sourceIds: readonly string[], plan: RenderSceneSourceUpdatePlan) => void;
  beforeSourceMutation?: (plan: RenderSceneSourceUpdatePlan) => void | Promise<void>;
  beforePublish?: (plan: RenderSceneSourceUpdatePlan) => void | Promise<void>;
  beforeScenePublish?: (plan: RenderSceneSourceUpdatePlan) => void | Promise<void>;
  onSuccess: (result: RenderSceneSourceUpdateResult) => void | Promise<void>;
  onError: (error: unknown) => void;
}

export interface RenderSourceErrorRecoveryCoordinator {
  /** Claims only renderer-owned source errors. Basemap, vector-tile, and
   * source-less map errors remain available to the map's general handler. */
  handleSourceError(event: RenderSourceErrorEvent): boolean;
  /** Marks a partially submitted synchronous source batch uncertain and
   * schedules a complete retained-scene heal. */
  requestRecovery(sourceId?: string): void;
  /** Resolves after a scheduled recovery has resubmitted the retained scene
   * and its source-loaded render continuation has completed. */
  whenSettled(): Promise<void>;
  /** Monotonic source-state epoch. Evidence and gesture barriers compare it
   * across rendered frames because worker errors arrive asynchronously. */
  version(): number;
  dispose(): void;
}

interface RecoveryWaiter {
  resolve(): void;
  reject(error: unknown): void;
}

function unavailableSourcesError(): Error {
  return new Error('Renderer sources are unavailable for source-state recovery.');
}

function recoveryError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isOwnedRendererError(
  event: RenderSourceErrorEvent,
  rendererSourceIds: ReadonlySet<string>,
): boolean {
  return event.sourceId !== undefined && rendererSourceIds.has(event.sourceId);
}

class RenderSourceErrorRecovery implements RenderSourceErrorRecoveryCoordinator {
  private readonly rendererSourceIds: ReadonlySet<string>;
  private disposed = false;
  private recoveryRequired = false;
  private pendingFrame: number | null = null;
  private lastError: Error | undefined;
  private currentVersion = 0;
  private healPlan: RenderSceneSourceUpdatePlan | null = null;
  private healPreparationUnitIndex = 0;
  private healUnitIndex = 0;
  private sourcePreparationStarted = false;
  private sourcePreparationPending = false;
  private completionPending = false;
  private readonly waiters = new Set<RecoveryWaiter>();

  constructor(private readonly options: RenderSourceErrorRecoveryOptions) {
    this.rendererSourceIds = new Set(options.rendererSourceIds);
  }

  handleSourceError(event: RenderSourceErrorEvent): boolean {
    if (this.disposed || !isOwnedRendererError(event, this.rendererSourceIds)) return false;
    this.requestRecovery(event.sourceId);
    return true;
  }

  requestRecovery(sourceId?: string): void {
    if (this.disposed) return;
    this.currentVersion += 1;
    if (sourceId) this.options.controller.invalidateSourceState(sourceId);
    if (!this.recoveryRequired) {
      this.recoveryRequired = true;
      if (!sourceId) this.options.controller.invalidateSourceState();
    }
    this.lastError = undefined;
    this.scheduleRecovery();
  }

  whenSettled(): Promise<void> {
    if (this.pendingFrame === null && (!this.recoveryRequired || this.lastError !== undefined)) {
      return this.lastError === undefined ? Promise.resolve() : Promise.reject(this.lastError);
    }
    return new Promise<void>((resolve, reject) => {
      this.waiters.add({ resolve, reject });
    });
  }

  version(): number {
    return this.currentVersion;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.pendingFrame !== null) this.options.cancelFrame(this.pendingFrame);
    this.healPlan?.abort();
    this.healPlan = null;
    this.pendingFrame = null;
    this.recoveryRequired = false;
    this.lastError = undefined;
    this.notifyIfSettled();
  }

  private notifyIfSettled(): void {
    if (
      this.pendingFrame !== null ||
      this.completionPending ||
      (this.recoveryRequired && this.lastError === undefined)
    ) {
      return;
    }
    for (const waiter of this.waiters) {
      if (this.lastError === undefined) waiter.resolve();
      else waiter.reject(this.lastError);
    }
    this.waiters.clear();
  }

  private completeRecovery(result: RenderSceneSourceUpdateResult): void {
    const requestedVersion = this.currentVersion;
    this.healPlan = null;
    this.healPreparationUnitIndex = 0;
    this.healUnitIndex = 0;
    this.sourcePreparationStarted = false;
    const accept = () => this.acceptRecovery(requestedVersion);
    try {
      const settlement = this.options.onSuccess(result);
      if (!settlement) {
        accept();
        return;
      }
      this.completionPending = true;
      void settlement.then(accept, (error: unknown) => this.failRecovery(error));
    } catch (error) {
      this.failRecovery(error);
    }
  }

  private publishPreparedHeal(plan: RenderSceneSourceUpdatePlan): void {
    let result: RenderSceneSourceUpdateResult;
    try {
      result = plan.stage();
      const ready = this.options.beforePublish?.(plan);
      if (!ready) {
        plan.markSourcesLoaded?.();
        plan.activate?.();
        this.publishAfterActivatedPaint(plan, result);
        return;
      }
      this.completionPending = true;
      void ready.then(
        () => {
          this.completionPending = false;
          plan.markSourcesLoaded?.();
          plan.activate?.();
          this.publishAfterActivatedPaint(plan, result);
        },
        (error: unknown) => this.failRecovery(error),
      );
    } catch (error) {
      this.failRecovery(error);
    }
  }

  private publishAfterActivatedPaint(
    plan: RenderSceneSourceUpdatePlan,
    result: RenderSceneSourceUpdateResult,
  ): void {
    const painted = this.options.beforeScenePublish?.(plan);
    if (!painted) {
      plan.publish();
      this.completeRecovery(result);
      return;
    }
    this.completionPending = true;
    void painted.then(
      () => {
        this.completionPending = false;
        plan.publish();
        this.completeRecovery(result);
      },
      (error: unknown) => this.failRecovery(error),
    );
  }

  private acceptRecovery(requestedVersion: number): void {
    this.completionPending = false;
    if (this.currentVersion !== requestedVersion) {
      this.scheduleRecovery();
      return;
    }
    this.recoveryRequired = false;
    this.lastError = undefined;
    this.currentVersion += 1;
    this.notifyIfSettled();
  }

  private failRecovery(error: unknown): void {
    this.completionPending = false;
    this.healPlan?.abort();
    this.healPlan = null;
    this.healPreparationUnitIndex = 0;
    this.healUnitIndex = 0;
    this.sourcePreparationStarted = false;
    this.sourcePreparationPending = false;
    this.lastError = recoveryError(error);
    try {
      this.options.onError(this.lastError);
    } catch {
      // Reporting must not strand screenshot or presentation barriers.
    }
    this.currentVersion += 1;
    this.notifyIfSettled();
  }

  private recover = (): void => {
    this.pendingFrame = null;
    if (this.disposed || !this.recoveryRequired) return;
    try {
      if (!this.options.ensureSources()) throw unavailableSourcesError();
      if (this.runPreparedHealUnit()) return;
      this.completeRecovery(this.options.controller.healCurrentScene());
    } catch (error) {
      this.failRecovery(error);
    }
  };

  private runPreparedHealUnit(): boolean {
    if (!this.options.controller.prepareCurrentSceneHeal) return false;
    this.healPlan ??= this.options.controller.prepareCurrentSceneHeal();
    const plan = this.healPlan;
    const cpuPreparation = plan?.preparationUnits?.unitAt(this.healPreparationUnitIndex);
    if (cpuPreparation) {
      cpuPreparation.run();
      this.healPreparationUnitIndex += 1;
      this.scheduleRecovery();
      return true;
    }
    const unit = plan?.units[this.healUnitIndex];
    if (unit) {
      if (this.healUnitIndex === 0) {
        if (!this.sourcePreparationStarted) {
          this.sourcePreparationStarted = true;
          const preparation = this.options.beforeSourceMutation?.(plan);
          if (preparation) {
            this.sourcePreparationPending = true;
            void preparation.then(
              () => {
                this.sourcePreparationPending = false;
                this.scheduleRecovery();
              },
              (error: unknown) => this.failRecovery(error),
            );
            return true;
          }
        }
        this.options.onSourceMutationStart?.(plan.sourceIds, plan);
      }
      unit.run();
      this.healUnitIndex += 1;
      this.scheduleRecovery();
      return true;
    }
    if (!plan) return false;
    this.publishPreparedHeal(plan);
    return true;
  }

  private scheduleRecovery(): void {
    if (this.pendingFrame !== null || this.completionPending || this.sourcePreparationPending)
      return;
    this.pendingFrame = this.options.scheduleFrame(this.recover);
  }
}

/** Reconciles MapLibre's asynchronous worker-error contract with the
 * renderer's complete retained scene. Error bursts share one staged replay. */
export function createRenderSourceErrorRecoveryCoordinator(
  options: RenderSourceErrorRecoveryOptions,
): RenderSourceErrorRecoveryCoordinator {
  return new RenderSourceErrorRecovery(options);
}
