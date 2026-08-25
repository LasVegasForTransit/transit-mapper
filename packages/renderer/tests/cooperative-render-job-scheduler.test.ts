import { describe, expect, it, vi } from 'vitest';
import { createCooperativeRenderJobScheduler } from '../src/cooperative-render-job-scheduler';

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

describe('cooperative render job scheduling', () => {
  it('requires a finite positive slice budget', () => {
    const clock = new FrameClock();

    for (const budgetMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        createCooperativeRenderJobScheduler({
          budgetMs,
          now: clock.now,
          scheduleFrame: clock.scheduleFrame,
          cancelFrame: clock.cancelFrame,
        }),
      ).toThrow(RangeError);
    }
  });

  it('stages every unit privately and commits its ordered result exactly once', async () => {
    const clock = new FrameClock();
    const commit = vi.fn();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });

    const handle = scheduler.submit({
      units: [
        { id: 'ways', run: () => 'way-result' },
        { id: 'stations', run: () => 'station-result' },
      ],
      commit,
    });

    expect(commit).not.toHaveBeenCalled();
    clock.flushFrame();

    expect(commit).not.toHaveBeenCalled();
    clock.flushFrame();

    expect(commit).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledWith(['way-result', 'station-result'], {
      generation: handle.generation,
    });
    await expect(handle.settled).resolves.toEqual({
      generation: handle.generation,
      status: 'committed',
    });
  });

  it('does not retain results for a side-effect-only staged job', async () => {
    const clock = new FrameClock();
    const commit = vi.fn();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });

    const handle = scheduler.submit({
      units: [
        { id: 'first', run: () => 'discarded-first' },
        { id: 'second', run: () => 'discarded-second' },
      ],
      retainResults: false,
      commit,
    });
    clock.flushFrame();
    clock.flushFrame();

    await expect(handle.settled).resolves.toMatchObject({ status: 'committed' });
    expect(commit).toHaveBeenCalledWith([], { generation: handle.generation });
  });

  it('does not enumerate a lazy unit sequence during submission or commit', async () => {
    const clock = new FrameClock();
    const commit = vi.fn();
    const unitAt = vi.fn((index: number) =>
      index < 2 ? { id: `lazy-${index}`, run: () => `result-${index}` } : undefined,
    );
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });

    const handle = scheduler.submit({ units: { unitAt }, commit });

    expect(unitAt).not.toHaveBeenCalled();
    clock.flushFrame();
    clock.flushFrame();
    await handle.settled;
    expect(commit).toHaveBeenCalledWith(['result-0', 'result-1'], {
      generation: handle.generation,
    });
    expect(unitAt).toHaveBeenCalledTimes(3);
  });

  it('reserves half the slice before starting another indivisible unit', async () => {
    const clock = new FrameClock();
    const commit = vi.fn();
    let unitRuns = 0;
    const unit = (id: string, durationMs: number) => ({
      id,
      run: () => {
        unitRuns += 1;
        clock.advance(durationMs);
        return id;
      },
    });
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });

    const handle = scheduler.submit({
      units: [unit('ways', 2), unit('services', 2), unit('stations', 1)],
      commit,
    });
    clock.flushFrame();

    expect(unitRuns).toBe(1);
    expect(commit).not.toHaveBeenCalled();
    expect(clock.frames.size).toBe(1);
    expect(scheduler.snapshot()).toMatchObject({
      sliceCount: 1,
      unitRunCount: 1,
      yieldCount: 1,
      maxSliceDurationMs: 2,
    });

    clock.flushFrame();
    expect(unitRuns).toBe(2);
    expect(commit).not.toHaveBeenCalled();
    clock.flushFrame();
    expect(unitRuns).toBe(3);
    expect(commit).not.toHaveBeenCalled();
    clock.flushFrame();
    expect(commit).toHaveBeenCalledOnce();
    await expect(handle.settled).resolves.toMatchObject({ status: 'committed' });
    expect(scheduler.snapshot()).toMatchObject({
      sliceCount: 4,
      committedJobCount: 1,
      unitRunCount: 3,
      yieldCount: 3,
      maxSliceDurationMs: 2,
      maxUnitDurationMs: 2,
    });
  });

  it('yields before resolving the next descriptor and budgets that planning on its next slice', async () => {
    const clock = new FrameClock();
    const descriptors: number[] = [];
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    const handle = scheduler.submit({
      units: {
        unitAt(index) {
          descriptors.push(index);
          if (index === 0) return { id: 'first', run: () => clock.advance(2) };
          if (index === 1) {
            clock.advance(3);
            return { id: 'oversized-descriptor', run: () => undefined };
          }
          return undefined;
        },
      },
      commit: vi.fn(),
    });

    clock.flushFrame();
    expect(descriptors).toEqual([0]);
    expect(scheduler.snapshot().maxSliceDurationMs).toBe(2);

    clock.flushFrame();
    const settlement = await handle.settled;
    expect(settlement.status).toBe('failed');
    if (settlement.status !== 'failed') throw new Error('Expected descriptor planning to fail.');
    expect(settlement.error).toMatchObject({
      unitId: 'oversized-descriptor',
      durationMs: 3,
    });
    expect(scheduler.snapshot()).toMatchObject({ maxUnitDurationMs: 3, maxSliceDurationMs: 3 });
  });

  it('reserves enough budget that two legal units cannot create a 7.8 ms slice', async () => {
    const clock = new FrameClock();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    const unit = (id: string) => ({
      id,
      run: () => {
        clock.advance(3.9);
        return id;
      },
    });
    const handle = scheduler.submit({ units: [unit('first'), unit('second')], commit: vi.fn() });

    clock.flushFrame();

    await expect(handle.settled).resolves.toMatchObject({ status: 'failed' });
    expect(scheduler.snapshot().maxSliceDurationMs).toBeLessThanOrEqual(4);
    expect(scheduler.snapshot().unitRunCount).toBe(1);
  });

  it('gives a slice-exclusive boundary unit the full budget and yields immediately', async () => {
    const clock = new FrameClock();
    const events: string[] = [];
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    const handle = scheduler.submit({
      units: [
        {
          id: 'source:stations',
          sliceExclusive: true,
          run: () => {
            events.push('stations');
            clock.advance(3.5);
          },
        },
        {
          id: 'source:hits',
          sliceExclusive: true,
          run: () => {
            events.push('hits');
            clock.advance(3.5);
          },
        },
      ],
      commit: () => events.push('commit'),
    });

    clock.flushFrame();
    expect(events).toEqual(['stations']);
    clock.flushFrame();
    expect(events).toEqual(['stations', 'hits']);
    clock.flushFrame();
    expect(events).toEqual(['stations', 'hits', 'commit']);
    await expect(handle.settled).resolves.toMatchObject({ status: 'committed' });
    expect(await handle.stats).toMatchObject({
      sliceCount: 3,
      yieldCount: 2,
      maxUnitDurationMs: 3.5,
      maxSliceDurationMs: 3.5,
    });
  });

  it('cancels a partially staged generation when a newer job replaces it', async () => {
    const clock = new FrameClock();
    const staleCommit = vi.fn();
    const currentCommit = vi.fn();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    const stale = scheduler.submit({
      units: [
        {
          id: 'stale-ways',
          run: () => {
            clock.advance(2);
            return 'staged-but-stale';
          },
        },
        { id: 'stale-stations', run: () => 'must-not-run' },
      ],
      commit: staleCommit,
    });
    clock.flushFrame();
    expect(staleCommit).not.toHaveBeenCalled();
    expect(clock.frames.size).toBe(1);

    const current = scheduler.submit({
      units: [{ id: 'current', run: () => 'current-result' }],
      commit: currentCommit,
    });

    await expect(stale.settled).resolves.toEqual({
      generation: stale.generation,
      status: 'canceled',
    });
    expect(clock.frames.size).toBe(1);
    clock.flushFrame();
    expect(staleCommit).not.toHaveBeenCalled();
    expect(currentCommit).not.toHaveBeenCalled();
    clock.flushFrame();
    expect(currentCommit).toHaveBeenCalledOnce();
    await expect(current.settled).resolves.toMatchObject({ status: 'committed' });
    expect(scheduler.snapshot()).toMatchObject({
      submittedJobCount: 2,
      committedJobCount: 1,
      canceledJobCount: 1,
      yieldCount: 2,
    });
  });

  it('cancels only the active generation when cancellation is requested explicitly', async () => {
    const clock = new FrameClock();
    const run = vi.fn(() => 'result');
    const commit = vi.fn();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    const handle = scheduler.submit({ units: [{ id: 'ways', run }], commit });

    expect(scheduler.cancel(handle.generation + 1)).toBe(false);
    expect(scheduler.cancel(handle.generation)).toBe(true);
    expect(scheduler.cancel(handle.generation)).toBe(false);

    await expect(handle.settled).resolves.toEqual({
      generation: handle.generation,
      status: 'canceled',
    });
    expect(clock.frames.size).toBe(0);
    expect(run).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(scheduler.snapshot().canceledJobCount).toBe(1);
  });
});
