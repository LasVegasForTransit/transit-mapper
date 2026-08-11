import { describe, expect, it, vi } from 'vitest';
import { renderPresentationForViewport } from '@transitmapper/core/render/render-presentation';
import { aRoad, aSystem } from '@transitmapper/core/testing/fixtures';
import { submitCommittedFeatureProjection } from '../../src/map/committed-feature-projection';
import { createCooperativeRenderJobScheduler } from '../../src/map/cooperative-render-job-scheduler';
import { SRC_WAYS } from '../../src/map/layers';

describe('committed feature projection', () => {
  it('records synchronous preparation overruns without making elapsed time a correctness gate', async () => {
    const frames = new Map<number, () => void>();
    let nextFrame = 1;
    const scheduler = createCooperativeRenderJobScheduler({
      now: () => 5,
      scheduleFrame: (callback) => {
        const frame = nextFrame++;
        frames.set(frame, callback);
        return frame;
      },
      cancelFrame: (frame) => {
        frames.delete(frame);
      },
    });
    const commit = vi.fn();
    const recordPreparation = vi.fn();
    const submission = submitCommittedFeatureProjection({
      scheduler,
      projection: {
        system: aSystem({
          ways: [
            aRoad('visible', [
              [-115.181, 36.14],
              [-115.179, 36.14],
            ]),
          ],
        }),
        selection: null,
        handleWayIds: [],
        view: {
          viewMode: 'infrastructure',
          visibleModes: new Set(['bus']),
          visibleWayTypes: new Set(['road']),
          presentation: renderPresentationForViewport({
            center: [-115.18, 36.14],
            zoom: 18,
            width: 1_440,
            height: 900,
          }),
        },
        sourceIds: [SRC_WAYS],
      },
      preparationStartedAtMs: 0,
      now: () => 5,
      commit: () => {
        commit();
        return null;
      },
      recordPreparation,
      recordScheduling: vi.fn(),
    });

    for (let frame = 0; frame < 24 && frames.size > 0; frame += 1) {
      const entry = frames.entries().next();
      if (entry.done) break;
      frames.delete(entry.value[0]);
      entry.value[1]();
      await Promise.resolve();
      await Promise.resolve();
    }
    await expect(submission.settled).resolves.toBeUndefined();
    expect(recordPreparation).toHaveBeenCalledWith(
      expect.objectContaining({ overBudgetPreparationCount: 1 }),
    );
    expect(scheduler.snapshot().submittedJobCount).toBeGreaterThan(0);
    expect(frames.size).toBe(0);
    expect(commit).toHaveBeenCalledOnce();
  });
});
