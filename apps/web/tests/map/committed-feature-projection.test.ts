import { describe, expect, it, vi } from 'vitest';
import { renderPresentationForViewport } from '@transitmapper/core/render/render-presentation';
import { aRoad, aSystem } from '@transitmapper/core/testing/fixtures';
import { createCooperativeRenderJobScheduler } from '../../src/map/cooperative-render-job-scheduler';
import { SRC_WAYS } from '../../src/map/layers';
import { submitSynchronousCommittedFeatureProjection } from '../support/committed-feature-projection.test';

describe('committed feature projection', () => {
  it('waits for the Diagram Worker before publishing a schematic scene', async () => {
    const frames = new Map<number, () => void>();
    let nextFrame = 1;
    const scheduler = createCooperativeRenderJobScheduler({
      now: () => 0,
      scheduleFrame: (callback) => {
        const frame = nextFrame++;
        frames.set(frame, callback);
        return frame;
      },
      cancelFrame: (frame) => {
        frames.delete(frame);
      },
    });
    const geographic = aSystem({
      ways: [
        aRoad('diagram-way', [
          [-115.181, 36.14],
          [-115.179, 36.141],
        ]),
      ],
    });
    const schematic = {
      ...geographic,
      ways: geographic.ways.map((way) => ({
        ...way,
        points: way.points.map(([lng, lat]) => [lng + 0.01, lat] as [number, number]),
      })),
    };
    const layoutDeferred: { resolve: ((system: typeof schematic) => void) | null } = {
      resolve: null,
    };
    const commit = vi.fn();

    const submission = submitSynchronousCommittedFeatureProjection({
      scheduler,
      projection: {
        system: geographic,
        selection: null,
        handleWayIds: [],
        view: {
          viewMode: 'diagram',
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
      now: () => 0,
      layoutDiagram: () =>
        new Promise((resolve) => {
          layoutDeferred.resolve = resolve;
        }),
      commit: () => {
        commit();
        return null;
      },
      recordPreparation: vi.fn(),
      recordScheduling: vi.fn(),
    });

    expect(commit).not.toHaveBeenCalled();
    const resolveLayout = layoutDeferred.resolve;
    if (!resolveLayout) throw new Error('Diagram layout request was not started.');
    resolveLayout(schematic);
    await expect(submission.settled).resolves.toBeUndefined();
    expect(commit).toHaveBeenCalledOnce();
  });

  it('keeps the previously accepted scene when Diagram layout fails', async () => {
    const scheduler = createCooperativeRenderJobScheduler({
      now: () => 0,
      scheduleFrame: () => 1,
      cancelFrame: () => {},
    });
    const commit = vi.fn();
    const submission = submitSynchronousCommittedFeatureProjection({
      scheduler,
      projection: {
        system: aSystem({
          ways: [
            aRoad('diagram-way', [
              [-115.181, 36.14],
              [-115.179, 36.141],
            ]),
          ],
        }),
        selection: null,
        handleWayIds: [],
        view: {
          viewMode: 'diagram',
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
      now: () => 0,
      layoutDiagram: () => Promise.reject(new Error('Worker failed.')),
      commit: () => {
        commit();
        return null;
      },
      recordPreparation: vi.fn(),
      recordScheduling: vi.fn(),
    });

    await expect(submission.settled).rejects.toThrow('Worker failed.');
    expect(commit).not.toHaveBeenCalled();
  });

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
    const submission = submitSynchronousCommittedFeatureProjection({
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
