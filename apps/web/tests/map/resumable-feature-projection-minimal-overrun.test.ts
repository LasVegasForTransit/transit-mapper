import { describe, expect, it, vi } from 'vitest';
import { createCooperativeRenderJobScheduler } from '../../src/map/cooperative-render-job-scheduler';
import type { ResumableGeographicFeatureProjectionPlan } from '../../src/map/resumable-feature-projection';
import { submitResumableGeographicFeatureProjection } from '../../src/map/resumable-feature-projection-scheduling';
import { emptySystemFeatures } from '../../src/map/system-feature-sources';

class FrameClock {
  nowMs = 0;
  private nextHandle = 1;
  readonly frames = new Map<number, () => void>();
  now = () => this.nowMs;
  scheduleFrame = (callback: () => void) => {
    const handle = this.nextHandle++;
    this.frames.set(handle, callback);
    return handle;
  };
  cancelFrame = (handle: number) => this.frames.delete(handle);
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
  for (let index = 0; index < 96; index++) {
    for (let microtask = 0; microtask < 8; microtask++) await Promise.resolve();
    if (clock.frames.size === 0) return;
    clock.flushFrame();
  }
  throw new Error('Render pipeline did not settle within ninety-six frames.');
}

function scheduler(clock: FrameClock) {
  return createCooperativeRenderJobScheduler({
    now: clock.now,
    scheduleFrame: clock.scheduleFrame,
    cancelFrame: clock.cancelFrame,
  });
}

describe('minimal renderer projection overruns', () => {
  it('keeps a minimal projection after a non-refinable elapsed-time overrun', async () => {
    const clock = new FrameClock();
    const refine = vi.fn(() => null);
    const commit = vi.fn();
    const recordScheduling = vi.fn();
    const handle = submitResumableGeographicFeatureProjection({
      scheduler: scheduler(clock),
      plan: {
        kind: 'ready',
        sourceIds: [],
        units: [
          {
            id: 'minimal-corridor',
            primary: { kind: 'corridor', ids: ['only'] },
            sourceIds: [],
            run: () => {
              clock.advance(3);
              return emptySystemFeatures();
            },
          },
        ],
        aggregate: emptySystemFeatures,
        refineAfterUnitBudgetExceeded: refine,
      },
      commit,
      recordScheduling,
    });

    await flushPipeline(clock);

    await expect(handle.settled).resolves.toMatchObject({ status: 'committed' });
    expect(refine).toHaveBeenCalledWith('minimal-corridor');
    expect(commit).toHaveBeenCalledOnce();
    expect(recordScheduling).toHaveBeenCalledWith(
      expect.objectContaining({ failedJobCount: 1, maxUnitDurationMs: 3 }),
    );
    expect(recordScheduling).toHaveBeenCalledWith(
      expect.objectContaining({ committedJobCount: 1, maxUnitDurationMs: 3 }),
    );
  });

  it('refines each later entity kind before tolerating its own minimal unit', async () => {
    const clock = new FrameClock();
    const refined: ReadyPlan = {
      kind: 'ready',
      sourceIds: [],
      units: [
        {
          id: 'minimal-corridor',
          primary: { kind: 'corridor', ids: ['only'] },
          sourceIds: [],
          run: () => {
            clock.advance(3);
            return emptySystemFeatures();
          },
        },
        {
          id: 'station-singleton',
          primary: { kind: 'station', ids: ['only'] },
          sourceIds: [],
          run: () => {
            clock.advance(1);
            return emptySystemFeatures();
          },
        },
      ],
      aggregate: emptySystemFeatures,
    };
    const refine = vi.fn((unitId: string) => (unitId === 'station-batch' ? refined : null));
    const commit = vi.fn();
    const recordScheduling = vi.fn();
    const handle = submitResumableGeographicFeatureProjection({
      scheduler: scheduler(clock),
      plan: {
        kind: 'ready',
        sourceIds: [],
        units: [
          refined.units[0],
          {
            id: 'station-batch',
            primary: { kind: 'station', ids: Array.from({ length: 16 }, (_, i) => `${i}`) },
            sourceIds: [],
            run: () => {
              clock.advance(9);
              return emptySystemFeatures();
            },
          },
        ],
        aggregate: emptySystemFeatures,
        refineAfterUnitBudgetExceeded: refine,
      },
      commit,
      recordScheduling,
    });

    await flushPipeline(clock);

    await expect(handle.settled).resolves.toMatchObject({ status: 'committed' });
    expect(refine.mock.calls.map(([unitId]) => unitId)).toEqual([
      'minimal-corridor',
      'station-batch',
    ]);
    expect(recordScheduling).toHaveBeenCalledWith(
      expect.objectContaining({ failedJobCount: 1, maxUnitDurationMs: 9 }),
    );
    expect(commit).toHaveBeenCalledOnce();
  });

  it('re-proves tolerance when refined unit positions reuse an earlier ID', async () => {
    const clock = new FrameClock();
    const finalPlan: ReadyPlan = {
      kind: 'ready',
      sourceIds: [],
      units: [
        {
          id: 'station:0',
          primary: { kind: 'station', ids: ['singleton'] },
          sourceIds: [],
          run: () => {
            clock.advance(1);
            return emptySystemFeatures();
          },
        },
      ],
      aggregate: emptySystemFeatures,
    };
    const shiftedRefine = vi.fn(() => finalPlan);
    const shiftedPlan: ReadyPlan = {
      kind: 'ready',
      sourceIds: [],
      units: [
        {
          id: 'station:0',
          primary: { kind: 'station', ids: ['still', 'batched'] },
          sourceIds: [],
          run: () => {
            clock.advance(9);
            return emptySystemFeatures();
          },
        },
      ],
      aggregate: emptySystemFeatures,
      refineAfterUnitBudgetExceeded: shiftedRefine,
    };
    const initialRefine = vi.fn((unitId: string) => (unitId === 'station:1' ? shiftedPlan : null));
    const commit = vi.fn();
    const handle = submitResumableGeographicFeatureProjection({
      scheduler: scheduler(clock),
      plan: {
        kind: 'ready',
        sourceIds: [],
        units: [
          {
            id: 'station:0',
            primary: { kind: 'station', ids: ['proven'] },
            sourceIds: [],
            run: () => {
              clock.advance(3);
              return emptySystemFeatures();
            },
          },
          {
            id: 'station:1',
            primary: { kind: 'station', ids: ['still', 'batched'] },
            sourceIds: [],
            run: () => {
              clock.advance(9);
              return emptySystemFeatures();
            },
          },
        ],
        aggregate: emptySystemFeatures,
        refineAfterUnitBudgetExceeded: initialRefine,
      },
      commit,
    });

    await flushPipeline(clock);

    await expect(handle.settled).resolves.toMatchObject({ status: 'committed' });
    expect(initialRefine.mock.calls.map(([unitId]) => unitId)).toEqual(['station:0', 'station:1']);
    expect(shiftedRefine).toHaveBeenCalledWith('station:0');
    expect(commit).toHaveBeenCalledOnce();
  });

  it('keeps a minimal aggregation after reporting an elapsed-time overrun', async () => {
    const clock = new FrameClock();
    const part = emptySystemFeatures();
    const feature = {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
    };
    Object.defineProperty(feature, 'id', {
      enumerable: true,
      get: () => {
        clock.advance(1.5);
        return 'way:only';
      },
    });
    part.ways.features.push(feature);
    const commit = vi.fn();
    const recordScheduling = vi.fn();
    const handle = submitResumableGeographicFeatureProjection({
      scheduler: scheduler(clock),
      plan: {
        kind: 'ready',
        sourceIds: ['tm-ways'],
        units: [
          {
            id: 'project-way',
            primary: { kind: 'corridor', ids: ['only'] },
            sourceIds: ['tm-ways'],
            run: () => part,
          },
        ],
        aggregate: emptySystemFeatures,
      },
      commit,
      recordScheduling,
    });

    await flushPipeline(clock);

    await expect(handle.settled).resolves.toMatchObject({ status: 'committed' });
    expect(commit).toHaveBeenCalledOnce();
    expect(recordScheduling).toHaveBeenCalledWith(
      expect.objectContaining({ failedJobCount: 1, maxUnitDurationMs: 3 }),
    );
    expect(recordScheduling).toHaveBeenCalledWith(
      expect.objectContaining({ committedJobCount: 1, maxUnitDurationMs: 3 }),
    );
  });
});
