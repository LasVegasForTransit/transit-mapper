import type { RenderSceneSourceUpdatePlan } from './render-scene-source-updater';
import type { AcceptedSceneStore } from './accepted-scene-store';
import { SRC_HIT_FEATURES } from './layers/constants';
import type { SourceBankId } from './source-bank';
import { logicalRenderSourceId, type SourceBankLayerController } from './source-bank-layers';

export interface SourceBankSettlementHost {
  isSourceLoaded(sourceId: string): boolean;
  onSourceData(listener: (sourceId: string) => void): () => void;
  onRender(listener: () => void): () => void;
  triggerRepaint(): void;
}

interface SourceBankSettlementOptions {
  readonly host: SourceBankSettlementHost;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface WaitForSourceBankLoadOptions extends SourceBankSettlementOptions {
  readonly sourceIds: readonly string[];
  /** Resolves once the caller has run every source mutation in this logical
   * revision. Source acknowledgements collected before this point must not
   * publish the old bank early. */
  readonly mutationsComplete?: Promise<void>;
}

export interface SourceBankSeedOptions {
  readonly plan: RenderSceneSourceUpdatePlan;
  scheduleFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
  beforeSourceMutation?(plan: RenderSceneSourceUpdatePlan): void | Promise<void>;
  /** Opens source-load observation immediately before the first GeoJSON
   * mutation. MapLibre may fire `sourcedata` during that mutation. */
  onSourceMutationStart?(plan: RenderSceneSourceUpdatePlan): void;
  beforePublish(plan: RenderSceneSourceUpdatePlan): void | Promise<void>;
}

export interface SourceBankSeedHandle {
  readonly settled: Promise<void>;
  cancel(): void;
}

const DEFAULT_SETTLEMENT_TIMEOUT_MS = 2_000;

function sourceIdsRequiringLoad(plan: RenderSceneSourceUpdatePlan): string[] {
  const cleared = new Set(plan.clearedSourceIds);
  return plan.sourceIds.filter(
    (sourceId) => !cleared.has(sourceId) || logicalRenderSourceId(sourceId) === SRC_HIT_FEATURES,
  );
}

function clearedLogicalSourceIds(plan: RenderSceneSourceUpdatePlan): ReadonlySet<string> {
  return new Set((plan.clearedSourceIds ?? []).map(logicalRenderSourceId));
}

function settlementPromise(
  subscribe: (settle: () => void) => () => void,
  options: SourceBankSettlementOptions,
  timeoutMessage: string | (() => string),
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let finished = false;
    let unsubscribe = () => {};
    const timeout = globalThis.setTimeout(
      () =>
        fail(new Error(typeof timeoutMessage === 'function' ? timeoutMessage() : timeoutMessage)),
      options.timeoutMs ?? DEFAULT_SETTLEMENT_TIMEOUT_MS,
    );
    const cleanup = () => {
      unsubscribe();
      globalThis.clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
    };
    const settle = () => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve();
    };
    const fail = (error: Error) => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => fail(new Error('Render source bank settlement was aborted.'));
    unsubscribe = subscribe(settle);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
  });
}

/** Waits only for the hidden renderer sources. It deliberately leaves
 * MapLibre repaint scheduling untouched, so camera, basemap, and vehicle
 * animation continue while the inactive bank's workers load. */
export function waitForSourceBankLoad({
  host,
  sourceIds,
  signal,
  timeoutMs,
  mutationsComplete,
}: WaitForSourceBankLoadOptions): Promise<void> {
  const exactSourceIds = [...new Set(sourceIds)];
  const expected = new Set(exactSourceIds);
  const observedData = new Set<string>();
  let mutationsFinished = mutationsComplete === undefined;
  const requiresFreshSourceEvent = mutationsComplete !== undefined;
  const sourceIsReady = (sourceId: string) =>
    observedData.has(sourceId) || (!requiresFreshSourceEvent && host.isSourceLoaded(sourceId));
  const loaded = () => mutationsFinished && exactSourceIds.every(sourceIsReady);
  if (exactSourceIds.length === 0) return Promise.resolve();
  return settlementPromise(
    (settle) => {
      const stopSourceData = host.onSourceData((sourceId) => {
        if (expected.has(sourceId)) observedData.add(sourceId);
        if (loaded()) settle();
      });
      // A worker acknowledgement is enough for a hidden source. When this
      // wait owns mutations, a resident source may still report loaded while
      // MapLibre replaces its worker data. Require the fresh source event in
      // that case. A later render remains a fallback only for a source that
      // was already ready before this waiter began.
      const stopRender = host.onRender(() => {
        if (loaded()) settle();
      });
      if (mutationsComplete) {
        void mutationsComplete.then(
          () => {
            mutationsFinished = true;
            if (loaded()) settle();
          },
          () => {},
        );
      }
      if (loaded()) {
        // Defer until `settlementPromise` has installed both unsubscriptions.
        // A synchronous settle here would leave the source/render listeners
        // registered forever.
        queueMicrotask(() => {
          if (loaded()) settle();
        });
      }
      // MapLibre normally schedules this after setData/updateData, but an
      // explicit request gives a just-finished bank one render to advance its
      // source caches without freezing the active map or its animation.
      host.triggerRepaint();
      return () => {
        stopSourceData();
        stopRender();
      };
    },
    { host, ...(signal ? { signal } : {}), ...(timeoutMs ? { timeoutMs } : {}) },
    () => {
      const missing = exactSourceIds.filter((sourceId) => !sourceIsReady(sourceId));
      return `Hidden renderer sources did not load in time: ${missing.join(', ')}.`;
    },
  );
}

/** Proves the post-flip revision reached one rendered frame. Unrelated
 * animation helps this boundary rather than preventing a global idle event. */
export function waitForSourceBankPaint(options: SourceBankSettlementOptions): Promise<void> {
  const pending = settlementPromise(
    (settle) => options.host.onRender(settle),
    options,
    'Activated renderer bank did not paint in time.',
  );
  options.host.triggerRepaint();
  return pending;
}

class SourceBankSeed implements SourceBankSeedHandle {
  private frame: number | null = null;
  private preparationUnitIndex = 0;
  private unitIndex = 0;
  private sourcePreparationStarted = false;
  private sourceMutationStarted = false;
  private finished = false;
  private resolve: () => void = () => {};
  private reject: (error: unknown) => void = () => {};
  readonly settled = new Promise<void>((resolve, reject) => {
    this.resolve = resolve;
    this.reject = reject;
  });

  constructor(private readonly options: SourceBankSeedOptions) {
    this.schedule();
  }

  cancel(): void {
    if (this.finished) return;
    this.finished = true;
    if (this.frame !== null) this.options.cancelFrame(this.frame);
    this.frame = null;
    this.options.plan.abort();
    this.resolve();
  }

  private schedule(): void {
    this.frame = this.options.scheduleFrame(() => this.run());
  }

  private run(): void {
    this.frame = null;
    if (this.finished) return;
    if (this.runPreparationUnit()) return;
    if (this.runSourceUnit()) return;
    this.publish();
  }

  private runPreparationUnit(): boolean {
    const cpuPreparation = this.options.plan.preparationUnits?.unitAt(this.preparationUnitIndex);
    if (!cpuPreparation) return false;
    try {
      cpuPreparation.run();
      this.preparationUnitIndex += 1;
      this.schedule();
    } catch (error) {
      this.fail(error);
    }
    return true;
  }

  private runSourceUnit(): boolean {
    const unit = this.options.plan.units.at(this.unitIndex);
    if (!unit) return false;
    if (this.unitIndex === 0 && !this.sourcePreparationStarted && this.startSourcePreparation()) {
      return true;
    }
    try {
      if (!this.sourceMutationStarted) {
        this.sourceMutationStarted = true;
        this.options.onSourceMutationStart?.(this.options.plan);
      }
      unit.run();
      this.unitIndex += 1;
      this.schedule();
    } catch (error) {
      this.fail(error);
    }
    return true;
  }

  private startSourcePreparation(): boolean {
    this.sourcePreparationStarted = true;
    try {
      const preparation = this.options.beforeSourceMutation?.(this.options.plan);
      if (!preparation) return false;
      void preparation.then(
        () => {
          if (!this.finished) this.schedule();
        },
        (error: unknown) => this.fail(error),
      );
    } catch (error) {
      this.fail(error);
    }
    return true;
  }

  private publish(): void {
    try {
      this.options.plan.stage();
      void Promise.resolve(this.options.beforePublish(this.options.plan)).then(
        () => {
          if (this.finished) return;
          this.options.plan.markSourcesLoaded?.();
          this.options.plan.publish();
          this.finished = true;
          this.resolve();
        },
        (error: unknown) => this.fail(error),
      );
    } catch (error) {
      this.fail(error);
    }
  }

  private fail(error: unknown): void {
    if (this.finished) return;
    this.finished = true;
    this.options.plan.abort();
    this.reject(error);
  }
}

export function scheduleSourceBankSeed(options: SourceBankSeedOptions): SourceBankSeedHandle {
  return new SourceBankSeed(options);
}

export interface SourceBankBackgroundPreparation {
  start(): void;
  cancel(): void;
}

export interface SourceBankBackgroundPreparationOptions {
  readonly scenes: AcceptedSceneStore;
  readonly layers: SourceBankLayerController;
  readonly host: SourceBankSettlementHost;
  scheduleFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
  onReady(): void;
  onError(error: unknown): void;
}

/** Keeps the inactive bank close to the accepted revision while the map is
 * idle. New foreground work cancels this preparation before it can contend
 * for the one source transaction allowed by the accepted-scene store. */
class BackgroundBankPreparation implements SourceBankBackgroundPreparation {
  private handle: SourceBankSeedHandle | null = null;
  private abort: AbortController | null = null;
  private bank: SourceBankId | null = null;

  constructor(private readonly options: SourceBankBackgroundPreparationOptions) {}

  start(): void {
    if (this.handle) return;
    const plan = this.options.scenes.prepareInactiveBankSeed();
    if (!plan) return;
    if (!plan.bank) throw new Error('An inactive renderer seed must target a source bank.');
    this.options.layers.prepare(plan.bank, clearedLogicalSourceIds(plan));
    this.bank = plan.bank;
    const abort = new AbortController();
    this.abort = abort;
    let sourceLoad: Promise<void> | null = null;
    const handle = scheduleSourceBankSeed({
      plan,
      scheduleFrame: (callback) => this.options.scheduleFrame(callback),
      cancelFrame: (frame) => this.options.cancelFrame(frame),
      beforeSourceMutation: () =>
        waitForSourceBankPaint({ host: this.options.host, signal: abort.signal }),
      onSourceMutationStart: (prepared) => {
        const awaitedSourceIds = sourceIdsRequiringLoad(prepared);
        if (awaitedSourceIds.length === 0) return;
        sourceLoad = waitForSourceBankLoad({
          host: this.options.host,
          sourceIds: awaitedSourceIds,
          signal: abort.signal,
        });
        // Cancellation can happen while the background seed is still between
        // source units, before `beforePublish` awaits this promise.
        void sourceLoad.catch(() => {});
      },
      beforePublish: async (prepared) => {
        const awaitedSourceIds = sourceIdsRequiringLoad(prepared);
        if (sourceLoad) await sourceLoad;
        else if (awaitedSourceIds.length > 0) {
          await waitForSourceBankLoad({
            host: this.options.host,
            sourceIds: awaitedSourceIds,
            signal: abort.signal,
          });
        }
        await waitForSourceBankPaint({ host: this.options.host, signal: abort.signal });
      },
    });
    this.handle = handle;
    void handle.settled.then(
      () => {
        if (this.handle !== handle) return;
        this.finish();
        this.options.onReady();
      },
      (error: unknown) => {
        if (this.handle !== handle) return;
        this.finish();
        this.options.onError(error);
      },
    );
  }

  cancel(): void {
    this.handle?.cancel();
    this.finish();
  }

  private finish(): void {
    this.handle = null;
    this.abort?.abort();
    this.abort = null;
    if (this.bank) this.options.layers.finishStaging(this.bank);
    this.bank = null;
  }
}

export function createSourceBankBackgroundPreparation(
  options: SourceBankBackgroundPreparationOptions,
): SourceBankBackgroundPreparation {
  return new BackgroundBankPreparation(options);
}
