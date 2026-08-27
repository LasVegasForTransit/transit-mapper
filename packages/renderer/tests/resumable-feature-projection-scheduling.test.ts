import { describe, expect, it, vi } from 'vitest';
import { emptySystemFeatures } from '../src/system-feature-sources';
import { createCooperativeRenderJobScheduler } from '../src/projection/cooperative-render-job-scheduler';
import type { ResumableGeographicFeatureProjectionPlan } from '../src/projection/resumable-feature-projection';
import { submitResumableGeographicFeatureProjection } from '../src/projection/resumable-feature-projection-scheduling';
import type { SourceFeatureProjectionCounts } from '../src/projection/source-feature-projection';

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

type ReadyPlan = Extract<ResumableGeographicFeatureProjectionPlan, { kind: 'ready' }>;

async function flushPipeline(clock: FrameClock): Promise<void> {
  for (let index = 0; index < 64; index++) {
    for (let microtask = 0; microtask < 8; microtask++) await Promise.resolve();
    if (clock.frames.size === 0) return;
    clock.flushFrame();
  }
  throw new Error('Render pipeline did not settle within sixty-four frames.');
}

describe('resumable geographic feature projection scheduling', () => {
  it('keeps the previous scene until one aggregate and atomic commit complete', async () => {
    const clock = new FrameClock();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    const first = emptySystemFeatures();
    const second = emptySystemFeatures();
    const aggregate = vi.fn(() => emptySystemFeatures());
    const commit = vi.fn();
    const recordScheduling = vi.fn();
    const plan: ReadyPlan = {
      kind: 'ready',
      sourceIds: [],
      units: [
        {
          id: 'first',
          primary: { kind: 'corridor', ids: ['first'] },
          sourceIds: [],
          run: () => first,
        },
        {
          id: 'second',
          primary: { kind: 'station', ids: ['second'] },
          sourceIds: [],
          run: () => second,
        },
      ],
      aggregate,
    };

    const handle = submitResumableGeographicFeatureProjection({
      scheduler,
      plan,
      commit,
      recordScheduling,
    });

    expect(aggregate).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    clock.flushFrame();
    expect(commit).not.toHaveBeenCalled();
    clock.flushFrame();
    clock.flushFrame();
    clock.flushFrame();
    await expect(handle.settled).resolves.toMatchObject({ status: 'committed' });
    expect(aggregate).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({ ways: first.ways }), {
      generation: handle.generation,
    });
    expect(recordScheduling).toHaveBeenCalledTimes(2);
    expect(recordScheduling).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ committedJobCount: 1, unitRunCount: 2 }),
    );
    expect(recordScheduling).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ committedJobCount: 1 }),
    );
    await expect(handle.stats).resolves.toMatchObject({ maxCommitDurationMs: 0 });
  });

  it('discards a replaced plan without aggregating or committing it', async () => {
    const clock = new FrameClock();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    const staleAggregate = vi.fn(() => emptySystemFeatures());
    const staleCommit = vi.fn();
    const stale = submitResumableGeographicFeatureProjection({
      scheduler,
      plan: {
        kind: 'ready',
        sourceIds: [],
        units: [
          {
            id: 'stale-first',
            primary: { kind: 'corridor', ids: ['stale'] },
            sourceIds: [],
            run: () => {
              clock.advance(4);
              return emptySystemFeatures();
            },
          },
          {
            id: 'stale-second',
            primary: { kind: 'station', ids: ['stale'] },
            sourceIds: [],
            run: emptySystemFeatures,
          },
        ],
        aggregate: staleAggregate,
      },
      commit: staleCommit,
    });
    clock.flushFrame();

    const currentCommit = vi.fn();
    const current = submitResumableGeographicFeatureProjection({
      scheduler,
      plan: {
        kind: 'ready',
        sourceIds: [],
        units: [],
        aggregate: () => emptySystemFeatures(),
      },
      commit: currentCommit,
    });
    await flushPipeline(clock);

    await expect(stale.settled).resolves.toMatchObject({ status: 'canceled' });
    await expect(current.settled).resolves.toMatchObject({ status: 'committed' });
    expect(staleAggregate).not.toHaveBeenCalled();
    expect(staleCommit).not.toHaveBeenCalled();
    expect(currentCommit).toHaveBeenCalledOnce();
  });

  it('retries an oversized batch with a finer plan before committing once', async () => {
    const clock = new FrameClock();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    const settledScene = emptySystemFeatures();
    const retryAggregate = vi.fn(() => settledScene);
    const retryPlan: ReadyPlan = {
      kind: 'ready',
      sourceIds: [],
      units: [
        {
          id: 'corridor:0',
          primary: { kind: 'corridor', ids: ['first'] },
          sourceIds: [],
          run: (counts?: SourceFeatureProjectionCounts) => {
            if (!counts) throw new Error('Projection attempt counts were not provided.');
            counts.featureTopologyWayVisitCount += 1;
            clock.advance(1);
            return emptySystemFeatures();
          },
        },
      ],
      aggregate: retryAggregate,
    };
    const refineAfterUnitBudgetExceeded = vi.fn(() => retryPlan);
    const failedAggregate = vi.fn(() => emptySystemFeatures());
    const plan: ReadyPlan = {
      kind: 'ready',
      sourceIds: [],
      units: [
        {
          id: 'corridor:0',
          primary: { kind: 'corridor', ids: ['first', 'second'] },
          sourceIds: [],
          run: (counts?: SourceFeatureProjectionCounts) => {
            if (!counts) throw new Error('Projection attempt counts were not provided.');
            counts.featureTopologyWayVisitCount += 10;
            clock.advance(5);
            return emptySystemFeatures();
          },
        },
      ],
      aggregate: failedAggregate,
      refineAfterUnitBudgetExceeded,
    };
    const commit = vi.fn();
    const recordScheduling = vi.fn();
    const recordAcceptedCounts = vi.fn();

    const handle = submitResumableGeographicFeatureProjection({
      scheduler,
      plan,
      commit,
      recordScheduling,
      recordAcceptedCounts,
    });

    clock.flushFrame();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(commit).not.toHaveBeenCalled();
    expect(failedAggregate).not.toHaveBeenCalled();
    expect(refineAfterUnitBudgetExceeded).toHaveBeenCalledWith('corridor:0');
    clock.flushFrame();
    clock.flushFrame();
    clock.flushFrame();
    clock.flushFrame();

    await expect(handle.settled).resolves.toEqual({
      generation: handle.generation,
      status: 'committed',
    });
    expect(retryAggregate).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledWith(expect.any(Object), { generation: handle.generation });
    expect(recordScheduling).toHaveBeenCalledTimes(3);
    expect(recordScheduling).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ failedJobCount: 1, maxUnitDurationMs: 5 }),
    );
    expect(recordAcceptedCounts).toHaveBeenCalledOnce();
    expect(recordAcceptedCounts).toHaveBeenCalledWith(
      expect.objectContaining({ featureTopologyWayVisitCount: 1 }),
    );
    expect(recordScheduling).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ committedJobCount: 1, maxUnitDurationMs: 1 }),
    );
    await expect(handle.stats).resolves.toMatchObject({
      submittedJobCount: 3,
      committedJobCount: 2,
      failedJobCount: 1,
      unitRunCount: 3,
      maxUnitDurationMs: 5,
    });
  });

  it('does not let a stale failed attempt retry over a newer submission', async () => {
    const clock = new FrameClock();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    const refineAfterUnitBudgetExceeded = vi.fn((): ReadyPlan => ({
      kind: 'ready',
      sourceIds: [],
      units: [],
      aggregate: emptySystemFeatures,
    }));
    const staleCommit = vi.fn();
    const stale = submitResumableGeographicFeatureProjection({
      scheduler,
      plan: {
        kind: 'ready',
        sourceIds: [],
        units: [
          {
            id: 'corridor:0',
            primary: { kind: 'corridor', ids: ['stale'] },
            sourceIds: [],
            run: () => {
              clock.advance(5);
              return emptySystemFeatures();
            },
          },
        ],
        aggregate: emptySystemFeatures,
        refineAfterUnitBudgetExceeded,
      },
      commit: staleCommit,
    });
    clock.flushFrame();

    const currentCommit = vi.fn();
    const current = submitResumableGeographicFeatureProjection({
      scheduler,
      plan: {
        kind: 'ready',
        sourceIds: [],
        units: [],
        aggregate: emptySystemFeatures,
      },
      commit: currentCommit,
    });
    await flushPipeline(clock);

    await expect(stale.settled).resolves.toEqual({
      generation: stale.generation,
      status: 'canceled',
    });
    await expect(current.settled).resolves.toEqual({
      generation: current.generation,
      status: 'committed',
    });
    expect(refineAfterUnitBudgetExceeded).not.toHaveBeenCalled();
    expect(staleCommit).not.toHaveBeenCalled();
    expect(currentCommit).toHaveBeenCalledOnce();
  });

  it('cancels the current physical retry through its stable logical handle', async () => {
    const clock = new FrameClock();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    const commit = vi.fn();
    const handle = submitResumableGeographicFeatureProjection({
      scheduler,
      plan: {
        kind: 'ready',
        sourceIds: [],
        units: [
          {
            id: 'corridor:0',
            primary: { kind: 'corridor', ids: ['first', 'second'] },
            sourceIds: [],
            run: () => {
              clock.advance(5);
              return emptySystemFeatures();
            },
          },
        ],
        aggregate: emptySystemFeatures,
        refineAfterUnitBudgetExceeded: () => ({
          kind: 'ready',
          sourceIds: [],
          units: [
            {
              id: 'corridor:0',
              primary: { kind: 'corridor', ids: ['first'] },
              sourceIds: [],
              run: emptySystemFeatures,
            },
          ],
          aggregate: emptySystemFeatures,
        }),
      },
      commit,
    });

    clock.flushFrame();
    await Promise.resolve();
    await Promise.resolve();
    expect(handle.cancel()).toBe(true);

    await expect(handle.settled).resolves.toEqual({
      generation: handle.generation,
      status: 'canceled',
    });
    expect(commit).not.toHaveBeenCalled();
    expect(clock.frames.size).toBe(0);
  });
});
