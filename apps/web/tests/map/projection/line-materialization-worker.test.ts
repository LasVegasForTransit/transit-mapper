import type { NetworkQueryResult } from '@transitmapper/core/network/result';
import type { MapPresentation } from '@transitmapper/core/presentation/map-presentation';
import { describe, expect, it } from 'vitest';
import {
  LineMaterializationWorkerClient,
  type LineMaterializationWorker,
} from '../../../src/map/projection/line-materialization-worker-client';
import type {
  LineMaterializationWorkerEvent,
  LineMaterializationWorkerInput,
  LineMaterializationWorkerRequest,
} from '../../../src/map/projection/line-materialization-worker-protocol';

class FakeWorker implements LineMaterializationWorker {
  onmessage: ((event: MessageEvent<LineMaterializationWorkerEvent>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly requests: LineMaterializationWorkerRequest[] = [];
  terminated = false;
  throwOnRelease = false;

  postMessage(request: LineMaterializationWorkerRequest): void {
    if (request.kind === 'release' && this.throwOnRelease)
      throw new DOMException('Worker release failed.', 'DataCloneError');
    this.requests.push(request);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(event: LineMaterializationWorkerEvent): void {
    this.onmessage?.({
      data: structuredClone(event),
    } as MessageEvent<LineMaterializationWorkerEvent>);
  }
}

function sessionId(request: LineMaterializationWorkerRequest): string {
  return request.sessionId;
}

function input(): LineMaterializationWorkerInput {
  return {
    result: {
      descriptor: {} as NetworkQueryResult['descriptor'],
      coverage: [],
      lineOrder: [],
      chunks: [],
    },
    presentation: {
      camera: { center: [0, 0], zoom: 12, bearing: 0, pitch: 0 },
      representationId: 'test',
    } satisfies MapPresentation,
    carrierRule: 'shared-alignment' as const,
  };
}

describe('Line materialization Worker client', () => {
  it('returns no partial bundle aggregate when the Worker rejects', async () => {
    const worker = new FakeWorker();
    const client = new LineMaterializationWorkerClient({ workerFactory: () => worker });
    const pending = client.materialize(input());

    expect(worker.requests).toHaveLength(1);
    expect(worker.requests[0]).toMatchObject({
      kind: 'materialize',
      requestId: 1,
      input: input(),
    });
    expect(typeof worker.requests[0].sessionId).toBe('string');
    worker.reply({
      kind: 'materialized',
      requestId: 1,
      sessionId: sessionId(worker.requests[0]),
      result: {
        kind: 'rejected',
        reason: 'topology-mode-conflict',
        recordId: 'express-window',
      },
    });

    await expect(pending).resolves.toEqual({
      kind: 'rejected',
      reason: 'topology-mode-conflict',
      recordId: 'express-window',
    });
  });

  it('returns one detached aggregate after the Worker settles every Line', async () => {
    const worker = new FakeWorker();
    const client = new LineMaterializationWorkerClient({ workerFactory: () => worker });
    const pending = client.materialize(input());
    const result = { kind: 'ready' as const, bundles: [], visibleFragments: [] };

    worker.reply({
      kind: 'materialized',
      requestId: 1,
      sessionId: sessionId(worker.requests[0]),
      result,
    });
    result.bundles.push({ changed: true } as never);

    await expect(pending).resolves.toEqual({ kind: 'ready', bundles: [], visibleFragments: [] });
    expect(worker.requests.at(-1)).toMatchObject({ kind: 'release' });
  });

  it('cancels a pending aggregate before a replacement can publish', async () => {
    const first = new FakeWorker();
    const second = new FakeWorker();
    const workers = [first, second];
    const client = new LineMaterializationWorkerClient({
      workerFactory: () => {
        const worker = workers.shift();
        if (worker === undefined) throw new Error('Expected replacement Worker.');
        return worker;
      },
    });
    const controller = new AbortController();
    const stale = client.materialize(input(), controller.signal);
    const staleRequest = first.requests[0];
    controller.abort();

    await expect(stale).rejects.toMatchObject({ name: 'AbortError' });
    expect(first.terminated).toBe(true);

    const current = client.materialize(input());
    const currentRequest = second.requests[0];
    first.reply({
      kind: 'materialized',
      requestId: staleRequest.requestId,
      sessionId: sessionId(staleRequest),
      result: { kind: 'ready', bundles: [], visibleFragments: [] },
    });
    second.reply({
      kind: 'materialized',
      requestId: currentRequest.requestId,
      sessionId: sessionId(currentRequest),
      result: { kind: 'ready', bundles: [], visibleFragments: [] },
    });

    await expect(current).resolves.toEqual({ kind: 'ready', bundles: [], visibleFragments: [] });
  });

  it('replaces a Worker whose release cannot discard its aggregate session', async () => {
    const first = new FakeWorker();
    first.throwOnRelease = true;
    const second = new FakeWorker();
    const workers = [first, second];
    const client = new LineMaterializationWorkerClient({
      workerFactory: () => {
        const worker = workers.shift();
        if (worker === undefined) throw new Error('Expected replacement Worker.');
        return worker;
      },
    });
    const completed = client.materialize(input());
    first.reply({
      kind: 'materialized',
      requestId: 1,
      sessionId: sessionId(first.requests[0]),
      result: { kind: 'ready', bundles: [], visibleFragments: [] },
    });
    await expect(completed).resolves.toEqual({ kind: 'ready', bundles: [], visibleFragments: [] });
    expect(first.terminated).toBe(true);

    const replacement = client.materialize(input());
    second.reply({
      kind: 'materialized',
      requestId: 2,
      sessionId: sessionId(second.requests[0]),
      result: { kind: 'ready', bundles: [], visibleFragments: [] },
    });
    await expect(replacement).resolves.toEqual({
      kind: 'ready',
      bundles: [],
      visibleFragments: [],
    });
  });
});
