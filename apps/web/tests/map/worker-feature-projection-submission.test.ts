import { describe, expect, it, vi } from 'vitest';
import { aSystem } from '@transitmapper/core/testing/fixtures';
import { renderPresentationForViewport } from '@transitmapper/core/render/render-presentation';
import { emptySystemFeatures, SRC_WAYS } from '../../src/map/system-feature-sources';
import {
  submitWorkerFeatureProjection,
  type WorkerFeatureProjectionClient,
} from '../../src/map/worker-feature-projection-submission';
import type { FeatureProjectionResult } from '../../src/map/feature-projection-worker';

function projectionInput() {
  return {
    system: aSystem({ id: 'worker-submission' }),
    selection: null,
    handleWayIds: [],
    sourceIds: [SRC_WAYS],
    view: {
      viewMode: 'infrastructure' as const,
      visibleModes: new Set<string>(),
      visibleWayTypes: new Set<string>(),
      presentation: renderPresentationForViewport({
        center: [-115.18, 36.14],
        zoom: 14,
        width: 800,
        height: 600,
      }),
    },
  };
}

describe('worker feature projection submission', () => {
  it('publishes detached worker features only after the matching worker result arrives', async () => {
    let resolveProjection: ((result: FeatureProjectionResult) => void) | null = null;
    const worker: WorkerFeatureProjectionClient = {
      project: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveProjection = resolve;
          }),
      ),
    };
    const commit = vi.fn(() => ({ settled: Promise.resolve(), cancel: () => false }));
    const projected = vi.fn();

    const submission = submitWorkerFeatureProjection({
      worker,
      input: () => projectionInput(),
      onProjected: projected,
      commit,
    });

    await Promise.resolve();
    expect(commit).not.toHaveBeenCalled();
    const resolve = resolveProjection;
    const features = emptySystemFeatures();
    resolve({ features, counts: null });

    await expect(submission.settled).resolves.toBeUndefined();
    expect(projected).toHaveBeenCalledWith({ features, counts: null });
    expect(commit).toHaveBeenCalledWith(features);
  });

  it('does not publish a worker result after its generation is canceled', async () => {
    let resolveProjection: ((result: FeatureProjectionResult) => void) | null = null;
    const worker: WorkerFeatureProjectionClient = {
      project: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveProjection = resolve;
          }),
      ),
    };
    const commit = vi.fn(() => ({ settled: Promise.resolve(), cancel: () => false }));
    const submission = submitWorkerFeatureProjection({
      worker,
      input: () => projectionInput(),
      commit,
    });

    await Promise.resolve();
    expect(submission.cancel()).toBe(true);
    const resolve = resolveProjection;
    resolve({ features: emptySystemFeatures(), counts: null });

    await expect(submission.settled).rejects.toMatchObject({ name: 'AbortError' });
    expect(commit).not.toHaveBeenCalled();
  });
});
