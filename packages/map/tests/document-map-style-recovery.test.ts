import { describe, expect, it } from 'vitest';
import {
  createDocumentMapStyleRecovery,
  type DocumentMapStyleRecoveryOptions,
} from '../src/document-map-style-recovery';

class FakeScheduler {
  private nowMs = 0;
  private nextHandle = 1;
  private readonly frames = new Map<number, () => void>();

  now = (): number => this.nowMs;

  scheduleFrame = (callback: () => void): number => {
    const handle = this.nextHandle++;
    this.frames.set(handle, callback);
    return handle;
  };

  cancelFrame = (handle: number): void => {
    this.frames.delete(handle);
  };

  pendingFrameCount(): number {
    return this.frames.size;
  }

  /** Advances the fake clock and runs the oldest scheduled frame, mirroring
   * how a real animation frame both delivers a callback and lets time pass. */
  flushOne(advanceMs = 1): boolean {
    const entry = this.frames.entries().next();
    if (entry.done) return false;
    const [handle, callback] = entry.value;
    this.frames.delete(handle);
    this.nowMs += advanceMs;
    callback();
    return true;
  }
}

class RecoveryStats {
  ensureOverlayCalls = 0;
  scheduledProjections = 0;
  readonly errors: unknown[] = [];
}

function createRecovery(
  ensureOverlay: () => boolean,
  overrides: Partial<DocumentMapStyleRecoveryOptions> = {},
) {
  const scheduler = new FakeScheduler();
  const stats = new RecoveryStats();
  const recovery = createDocumentMapStyleRecovery({
    renderer: {
      hasAcceptedScene: () => false,
      hasActiveProjection: () => false,
      publicationInProgress: () => false,
      afterCurrentProjectionSettles: (callback) => callback(),
      requestRecovery: () => {},
      whenRecoverySettled: () => Promise.resolve(),
      restoreActiveLayers: () => {},
    },
    scheduler,
    acceptsWork: () => true,
    ensureOverlay: () => {
      stats.ensureOverlayCalls += 1;
      return ensureOverlay();
    },
    hasQueuedProjection: () => false,
    scheduleQueuedProjection: () => {},
    scheduleProjection: () => {
      stats.scheduledProjections += 1;
    },
    restoreAfterStyle: () => {},
    reportError: (error) => stats.errors.push(error),
    retryBudgetMs: 10,
    ...overrides,
  });
  return { recovery, scheduler, stats };
}

describe('document map style recovery', () => {
  it('retries an overlay setup refusal across more than one frame before recovering', () => {
    let refusals = 0;
    const { recovery, scheduler, stats } = createRecovery(() => {
      refusals += 1;
      return refusals > 2;
    });

    recovery.handleStyleLoad();
    expect(scheduler.flushOne()).toBe(true);
    expect(scheduler.flushOne()).toBe(true);

    expect(stats.ensureOverlayCalls).toBe(3);
    expect(stats.errors).toEqual([]);
    expect(recovery.isPending()).toBe(false);
  });

  it('reports an error and stops retrying once the retry budget is exhausted', () => {
    const { recovery, scheduler, stats } = createRecovery(() => false, { retryBudgetMs: 5 });

    recovery.handleStyleLoad();
    // Each flushed frame advances the fake clock by 1ms; the 5ms budget from
    // the first refusal is exhausted well before this many attempts.
    for (let attempt = 0; attempt < 20 && stats.errors.length === 0; attempt += 1) {
      scheduler.flushOne();
    }

    expect(stats.errors).toHaveLength(1);
    expect((stats.errors[0] as Error).message).toContain('retry budget');
    expect(recovery.isPending()).toBe(false);
    expect(scheduler.pendingFrameCount()).toBe(0);
  });

  it('starts a fresh retry budget on the next style load after giving up', () => {
    let alwaysFails = true;
    const { recovery, scheduler, stats } = createRecovery(() => !alwaysFails, {
      retryBudgetMs: 5,
    });

    recovery.handleStyleLoad();
    for (let attempt = 0; attempt < 20 && stats.errors.length === 0; attempt += 1) {
      scheduler.flushOne();
    }
    expect(stats.errors).toHaveLength(1);

    alwaysFails = false;
    const callsBeforeRetry = stats.ensureOverlayCalls;
    recovery.handleStyleLoad();

    expect(stats.ensureOverlayCalls).toBeGreaterThan(callsBeforeRetry);
    expect(stats.errors).toHaveLength(1);
    expect(recovery.isPending()).toBe(false);
  });

  it('never reports an error when the very first overlay setup attempt succeeds', () => {
    const { recovery, stats } = createRecovery(() => true);

    recovery.handleStyleLoad();

    expect(stats.errors).toEqual([]);
    expect(stats.scheduledProjections).toBe(1);
  });
});
