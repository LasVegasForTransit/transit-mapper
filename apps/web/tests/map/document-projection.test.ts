import { describe, expect, it, vi } from 'vitest';
import { aRoad, aSystem } from '@transitmapper/core/testing/fixtures';
import { renderPresentationForViewport } from '@transitmapper/core/render/render-presentation';
import { createSourceFeatureProjectionAccounting } from '../../src/map/committed-feature-projection';
import { createCooperativeRenderJobScheduler } from '../../src/map/cooperative-render-job-scheduler';
import {
  DocumentProjector,
  type DocumentProjectorOptions,
} from '../../src/map/document-projection';
import { SRC_WAYS } from '../../src/map/layers';
import { createRendererStatsCollector } from '../../src/perf/renderer-stats';
import type {
  FeatureProjectionResult,
  FeatureProjectionWorkerClient,
} from '../../src/map/feature-projection-worker';
import { emptySystemFeatures } from '../../src/map/system-feature-sources';
import { renderScene } from '../support/render-scene-source-updater.test';

class ProjectionClock {
  private nextFrame = 1;
  readonly frames = new Map<number, () => void>();

  now = (): number => 0;

  scheduleFrame = (callback: () => void): number => {
    const handle = this.nextFrame++;
    this.frames.set(handle, callback);
    return handle;
  };

  cancelFrame = (handle: number): void => {
    this.frames.delete(handle);
  };

  flushFrame(): void {
    const entry = this.frames.entries().next();
    if (entry.done) return;
    const [handle, callback] = entry.value;
    this.frames.delete(handle);
    callback();
  }
}

describe('document projection', () => {
  it('hands geographic features to the worker before source publication', async () => {
    const clock = new ProjectionClock();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    let resolveWorker: ((result: FeatureProjectionResult) => void) | null = null;
    const project = vi.fn(
      () =>
        new Promise<FeatureProjectionResult>((resolve) => {
          resolveWorker = resolve;
        }),
    );
    const worker: FeatureProjectionWorkerClient = {
      project,
      dispose: () => {},
    };
    const publish = vi.fn(() => ({
      generation: null,
      settled: Promise.resolve(),
      cancel: () => false,
    }));
    const projector = new DocumentProjector({
      scheduler,
      accounting: createSourceFeatureProjectionAccounting(),
      stats: createRendererStatsCollector(),
      instrumentationEnabled: false,
      featureProjectionWorker: worker,
      now: clock.now,
      publish,
      requeue: vi.fn(),
    });
    const system = aSystem({
      ways: [
        aRoad('visible', [
          [-115.181, 36.14],
          [-115.179, 36.14],
        ]),
      ],
    });

    const projection = projector.project({
      revision: 'worker-scene',
      transition: null,
      requestedSourceIds: [SRC_WAYS],
      intent: 'reset',
      projection: {
        system,
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
      },
    });

    for (let step = 0; step < 200; step += 1) {
      clock.flushFrame();
      await Promise.resolve();
    }
    expect(project).toHaveBeenCalledWith(
      expect.objectContaining({ system, sourceIds: [SRC_WAYS] }),
      expect.any(AbortSignal),
    );
    resolveWorker({ features: emptySystemFeatures(), counts: null });

    await projection;
    expect(publish).toHaveBeenCalledOnce();
    projector.dispose();
    scheduler.dispose();
  });

  it('accepts preparation state only after its scene publication succeeds', async () => {
    const clock = new ProjectionClock();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    const accepted = vi.fn();
    const publishImplementation: DocumentProjectorOptions['publish'] = (
      _prepared,
      request,
      _measurement,
      onAccepted,
    ) => {
      const update = {
        strategy: 'none' as const,
        sourceUploadCount: 0,
        fullSourceUploadCount: 0,
        patchSourceUploadCount: 0,
        fallbackSourceUploadCount: 0,
        uploadedFeatureCount: 0,
        addedFeatureCount: 0,
        changedFeatureCount: 0,
        removedFeatureCount: 0,
        scene: renderScene(request.revision, []),
      };
      return {
        generation: 1,
        settled: Promise.resolve(onAccepted(update)).then(() => undefined),
        cancel: () => false,
      };
    };
    const publish = vi.fn(publishImplementation);
    const projector = new DocumentProjector({
      scheduler,
      accounting: createSourceFeatureProjectionAccounting(),
      stats: createRendererStatsCollector(),
      instrumentationEnabled: false,
      featureProjectionWorker: {
        project: () => Promise.resolve({ features: emptySystemFeatures(), counts: null }),
        dispose: () => {},
      },
      now: clock.now,
      publish,
      requeue: vi.fn(),
    });
    const system = aSystem({
      ways: [
        aRoad('visible', [
          [-115.181, 36.14],
          [-115.179, 36.14],
        ]),
      ],
    });
    const projection = projector.project({
      revision: 'scene-one',
      transition: null,
      requestedSourceIds: [SRC_WAYS],
      intent: 'reset',
      projection: {
        system,
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
      },
      onAccepted: accepted,
    });

    for (let step = 0; step < 200; step += 1) {
      clock.flushFrame();
      await Promise.resolve();
      await Promise.resolve();
    }
    await projection;

    expect(publish).toHaveBeenCalledOnce();
    expect(accepted).toHaveBeenCalledWith(
      expect.objectContaining({ sourceIds: [SRC_WAYS], settlementLatencyMs: 0 }),
    );
    expect(projector.hasActiveProjection()).toBe(false);
    projector.dispose();
    scheduler.dispose();
  });
});
