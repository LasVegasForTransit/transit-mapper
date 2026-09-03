import type { DocumentMapScheduler } from './document-map-driver-types';

interface DocumentMapStyleRecoveryRenderer {
  hasAcceptedScene(): boolean;
  hasActiveProjection(): boolean;
  publicationInProgress(): boolean;
  afterCurrentProjectionSettles(callback: () => void): void;
  requestRecovery(): void;
  whenRecoverySettled(): Promise<void>;
  restoreActiveLayers(): void;
}

export interface DocumentMapStyleRecoveryOptions {
  readonly renderer: DocumentMapStyleRecoveryRenderer;
  readonly scheduler: Pick<DocumentMapScheduler, 'scheduleFrame' | 'cancelFrame' | 'now'>;
  acceptsWork(): boolean;
  ensureOverlay(): boolean;
  hasQueuedProjection(): boolean;
  scheduleQueuedProjection(): void;
  scheduleProjection(): void;
  restoreAfterStyle(): void;
  reportError(error: unknown): void;
  /** MapLibre can take several seconds, not one frame, to accept a source
   * mutation on a heavily loaded main thread (a large document under CPU
   * throttling delays the style's own internal load, not just source
   * indexing). Defaults to `DEFAULT_STYLE_RETRY_BUDGET_MS`. */
  readonly retryBudgetMs?: number;
}

// Matches the order of magnitude documented in source-bank-settlement.ts for
// the RTC fixture's source indexing: several seconds, not one animation
// frame, under CI's CPU throttle.
const DEFAULT_STYLE_RETRY_BUDGET_MS = 10_000;

export interface DocumentMapStyleRecovery {
  isPending(): boolean;
  continueAfterProjectionFailure(): void;
  handleStyleLoad(): void;
  dispose(): void;
}

class DocumentMapStyleRecoveryController implements DocumentMapStyleRecovery {
  private disposed = false;
  private pending = false;
  private continuation: (() => void) | null = null;
  private retryFrame: number | null = null;
  private retryDeadline: number | null = null;

  constructor(private readonly options: DocumentMapStyleRecoveryOptions) {}

  isPending(): boolean {
    return this.pending;
  }

  continueAfterProjectionFailure(): void {
    if (this.pending) this.continueRecovery();
  }

  handleStyleLoad(): void {
    if (this.disposed) return;
    const pendingRetry = this.retryFrame;
    this.retryFrame = null;
    if (pendingRetry !== null) {
      try {
        this.options.scheduler.cancelFrame(pendingRetry);
      } catch (error) {
        this.reportSafely(error);
      }
    }
    this.retryDeadline = null;
    this.recoverStyle();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pending = false;
    this.continuation = null;
    const pendingRetry = this.retryFrame;
    this.retryFrame = null;
    if (pendingRetry !== null) this.options.scheduler.cancelFrame(pendingRetry);
  }

  private acceptsWork(): boolean {
    return !this.disposed && this.options.acceptsWork();
  }

  private reportSafely(error: unknown): void {
    try {
      this.options.reportError(error);
    } catch {
      // Diagnostics cannot abort MapLibre listener recovery.
    }
  }

  private continueRecovery = (): void => {
    const next = this.continuation;
    this.continuation = null;
    try {
      next?.();
    } catch (error) {
      this.pending = false;
      this.reportSafely(error);
    }
  };

  private recoverAcceptedStyle = (): void => {
    if (!this.acceptsWork()) return;
    try {
      this.options.restoreAfterStyle();
      this.options.renderer.requestRecovery();
    } catch (error) {
      this.pending = false;
      this.reportSafely(error);
      return;
    }
    void this.options.renderer.whenRecoverySettled().then(
      () => this.finishAcceptedRecovery(),
      (error: unknown) => {
        this.pending = false;
        if (this.acceptsWork()) this.reportSafely(error);
      },
    );
  };

  private finishAcceptedRecovery(): void {
    this.pending = false;
    if (!this.acceptsWork()) return;
    try {
      this.options.renderer.restoreActiveLayers();
      if (this.options.hasQueuedProjection()) this.options.scheduleQueuedProjection();
    } catch (error) {
      this.reportSafely(error);
    }
  }

  private scheduleRetry(): void {
    const now = this.options.scheduler.now();
    this.retryDeadline ??= now + (this.options.retryBudgetMs ?? DEFAULT_STYLE_RETRY_BUDGET_MS);
    if (now >= this.retryDeadline) {
      this.pending = false;
      this.retryDeadline = null;
      this.reportSafely(
        new Error(
          'Style recovery gave up: MapLibre did not accept a source mutation within the retry budget.',
        ),
      );
      return;
    }
    try {
      this.retryFrame = this.options.scheduler.scheduleFrame(() => {
        this.retryFrame = null;
        this.recoverStyle();
      });
    } catch (error) {
      this.pending = false;
      this.retryDeadline = null;
      this.reportSafely(error);
    }
  }

  private recoverStyle(): void {
    if (!this.acceptsWork()) return;
    this.pending = true;
    try {
      if (!this.options.ensureOverlay()) {
        this.scheduleRetry();
        return;
      }
      this.retryDeadline = null;
      if (this.options.renderer.hasAcceptedScene()) this.recoverAcceptedScene();
      else this.recoverInitialScene();
    } catch (error) {
      this.pending = false;
      this.reportSafely(error);
    }
  }

  private recoverAcceptedScene(): void {
    if (this.projectionIsBusy()) {
      this.continuation = this.recoverAcceptedStyle;
      this.options.renderer.afterCurrentProjectionSettles(this.continueRecovery);
    } else {
      this.recoverAcceptedStyle();
    }
  }

  private recoverInitialScene(): void {
    const scheduleInitialProjection = () => {
      this.pending = false;
      this.options.scheduleProjection();
    };
    if (this.projectionIsBusy()) {
      this.continuation = scheduleInitialProjection;
      this.options.renderer.afterCurrentProjectionSettles(this.continueRecovery);
    } else {
      scheduleInitialProjection();
    }
  }

  private projectionIsBusy(): boolean {
    return (
      this.options.renderer.hasActiveProjection() || this.options.renderer.publicationInProgress()
    );
  }
}

export function createDocumentMapStyleRecovery(
  options: DocumentMapStyleRecoveryOptions,
): DocumentMapStyleRecovery {
  return new DocumentMapStyleRecoveryController(options);
}
