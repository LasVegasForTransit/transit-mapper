import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { describe, expect, it } from 'vitest';
import { reconcileGtfs } from '../../src/import/reconcile-gtfs';
import type {
  GtfsReconcileEvent,
  GtfsReconcileRequest,
} from '../../src/import/gtfsReconcileProtocol';

class FakeReconcileWorker {
  onmessage: ((event: MessageEvent<GtfsReconcileEvent>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;

  postMessage(message: GtfsReconcileRequest): void {
    queueMicrotask(() =>
      this.onmessage?.({
        data: { kind: 'done', system: message.system, reconciled: 3 },
      } as MessageEvent<GtfsReconcileEvent>),
    );
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe('GTFS reconciliation Worker', () => {
  it('returns the Worker result and releases its thread', async () => {
    const worker = new FakeReconcileWorker();
    const system = createEmptySystem();

    const result = await reconcileGtfs(system, ['service'], {
      workerFactory: () => worker,
    });

    expect(result).toEqual({ system, reconciled: 3 });
    expect(worker.terminated).toBe(true);
  });

  it('terminates and rejects when canceled', async () => {
    const worker = new FakeReconcileWorker();
    worker.postMessage = () => {};
    const controller = new AbortController();
    const pending = reconcileGtfs(createEmptySystem(), [], {
      signal: controller.signal,
      workerFactory: () => worker,
    });

    controller.abort(new DOMException('Canceled', 'AbortError'));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminated).toBe(true);
  });
});
