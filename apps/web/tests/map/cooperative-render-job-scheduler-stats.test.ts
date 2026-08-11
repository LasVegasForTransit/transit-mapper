import { describe, expect, it } from 'vitest';
import { createCooperativeRenderJobScheduler } from '../../src/map/cooperative-render-job-scheduler';

class FrameClock {
  nowMs = 0;
  private nextHandle = 1;
  readonly frames = new Map<number, () => void>();

  now = (): number => this.nowMs;
  scheduleFrame = (callback: () => void): number => {
    const handle = this.nextHandle++;
    this.frames.set(handle, callback);
    return handle;
  };
  cancelFrame = (handle: number): void => {
    this.frames.delete(handle);
  };
  advance(durationMs: number): void {
    this.nowMs += durationMs;
  }
  flushFrame(): void {
    const entry = this.frames.entries().next();
    if (entry.done) throw new Error('No frame is scheduled.');
    const [handle, callback] = entry.value;
    this.frames.delete(handle);
    callback();
  }
}

describe('cooperative render job scheduling diagnostics', () => {
  it('reports generation-local scheduling deltas through the settlement barrier', async () => {
    const clock = new FrameClock();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    const stale = scheduler.submit({
      units: [
        {
          id: 'stale-first',
          run: () => {
            clock.advance(2);
            return 'stale';
          },
        },
        { id: 'stale-second', run: () => 'never' },
      ],
      commit: () => {},
    });
    clock.flushFrame();
    const current = scheduler.submit({
      units: [
        {
          id: 'current',
          run: () => {
            clock.advance(2);
            return 'current';
          },
        },
      ],
      commit: () => clock.advance(1),
    });
    clock.flushFrame();
    clock.flushFrame();

    await expect(stale.stats).resolves.toMatchObject({
      sliceCount: 1,
      unitRunCount: 1,
      yieldCount: 1,
      canceledJobCount: 1,
      committedJobCount: 0,
      maxSliceDurationMs: 2,
      totalSliceDurationMs: 2,
      maxUnitDurationMs: 2,
    });
    await expect(current.stats).resolves.toMatchObject({
      sliceCount: 2,
      unitRunCount: 1,
      yieldCount: 1,
      canceledJobCount: 0,
      committedJobCount: 1,
      maxSliceDurationMs: 2,
      totalSliceDurationMs: 3,
      maxUnitDurationMs: 2,
      maxCommitDurationMs: 1,
    });
  });

  it('sums every generation-local slice without including time between frames', async () => {
    const clock = new FrameClock();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    const handle = scheduler.submit({
      units: [
        {
          id: 'first',
          run: () => {
            clock.advance(2);
          },
        },
        {
          id: 'second',
          run: () => {
            clock.advance(1);
          },
        },
      ],
      commit: () => clock.advance(0.5),
    });

    clock.flushFrame();
    clock.advance(50);
    clock.flushFrame();
    clock.flushFrame();

    await expect(handle.stats).resolves.toMatchObject({
      sliceCount: 3,
      totalSliceDurationMs: 3.5,
      maxSliceDurationMs: 2,
    });
    expect(scheduler.snapshot().totalSliceDurationMs).toBe(3.5);
  });
});
