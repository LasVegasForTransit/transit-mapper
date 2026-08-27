import { describe, expect, it } from 'vitest';
import { aSystem } from '@transitmapper/core/testing/fixtures';
import { renderPresentationForViewport } from '@transitmapper/core/render/render-presentation';
import {
  createFeatureProjectionWorker,
  type FeatureProjectionClientInput,
  type FeatureProjectionWorker,
} from '../src/workers/feature-projection-worker';
import type {
  FeatureProjectionWorkerEvent,
  FeatureProjectionWorkerRequest,
} from '../src/workers/feature-projection-worker-protocol';
import { emptySystemFeatures } from '../src/system-feature-sources';
import { SRC_WAYS } from '../src/layers/constants';
import type { RenderPreparedSnapshot } from '@transitmapper/core/render/render-preparation';

class RecordingFeatureProjectionWorker implements FeatureProjectionWorker {
  onmessage: ((event: MessageEvent<FeatureProjectionWorkerEvent>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly requests: FeatureProjectionWorkerRequest[] = [];
  terminated = false;

  postMessage(request: FeatureProjectionWorkerRequest): void {
    this.requests.push(request);
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(event: FeatureProjectionWorkerEvent): void {
    this.onmessage?.({ data: event } as MessageEvent<FeatureProjectionWorkerEvent>);
  }
}

function requestInput(): FeatureProjectionClientInput {
  return {
    system: aSystem({ id: 'worker-system' }),
    selection: null,
    handleWayIds: [],
    sourceIds: [SRC_WAYS],
    view: {
      viewMode: 'infrastructure' as const,
      visibleModes: new Set<string>(),
      visibleWayTypes: new Set<string>(),
      presentation: renderPresentationForViewport({
        center: [-115.15, 36.15],
        zoom: 14,
        width: 800,
        height: 600,
      }),
    },
  };
}

describe('Feature projection worker', () => {
  it('sends a clone-safe projection request and returns its matching result', async () => {
    const worker = new RecordingFeatureProjectionWorker();
    const client = createFeatureProjectionWorker({ workerFactory: () => worker });
    const input = requestInput();

    const projected = client.project(input);

    expect(worker.requests).toHaveLength(1);
    expect(worker.requests[0]).toMatchObject({
      kind: 'project',
      requestId: 1,
      input: {
        system: input.system,
        sourceIds: [SRC_WAYS],
      },
    });
    expect('tierStateResolver' in (worker.requests[0]?.input.view ?? {})).toBe(false);
    const features = emptySystemFeatures();
    worker.respond({ kind: 'done', requestId: 1, features, counts: null });

    await expect(projected).resolves.toEqual({ features, counts: null });
  });

  it('keeps main-thread preparation indexes out of the worker message', async () => {
    const worker = new RecordingFeatureProjectionWorker();
    const client = createFeatureProjectionWorker({ workerFactory: () => worker });
    const preparedSnapshot = {
      servicesByWay: { get: () => [] },
    } as unknown as RenderPreparedSnapshot;

    const projected = client.project({ ...requestInput(), preparedSnapshot });

    expect(worker.requests[0]?.input).not.toHaveProperty('preparedSnapshot');
    client.dispose();
    await expect(projected).rejects.toThrow('Feature projection Worker is disposed.');
  });

  it('rejects an aborted request and ignores its late worker response', async () => {
    const worker = new RecordingFeatureProjectionWorker();
    const client = createFeatureProjectionWorker({ workerFactory: () => worker });
    const abort = new AbortController();
    const pending = client.project(requestInput(), abort.signal);

    abort.abort();
    worker.respond({ kind: 'done', requestId: 1, features: emptySystemFeatures(), counts: null });

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    client.dispose();
    expect(worker.terminated).toBe(true);
  });
});
