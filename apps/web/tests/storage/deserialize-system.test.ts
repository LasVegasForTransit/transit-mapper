import { describe, expect, it } from 'vitest';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import {
  deserializeSystemOffThread,
  type StorageDeserializerWorker,
} from '../../src/storage/deserialize-system';

class FakeWorker implements StorageDeserializerWorker {
  onmessage: StorageDeserializerWorker['onmessage'] = null;
  onerror: StorageDeserializerWorker['onerror'] = null;
  posted: string[] = [];
  terminated = false;

  postMessage(request: { serialized: string }): void {
    this.posted.push(request.serialized);
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe('deserializeSystemOffThread', () => {
  it('sends stored JSON to a Worker and resolves the reconstructed model', async () => {
    const worker = new FakeWorker();
    const system = createEmptySystem();
    const serialized = JSON.stringify(system);
    const pending = deserializeSystemOffThread(serialized, { workerFactory: () => worker });

    expect(worker.posted).toEqual([serialized]);
    worker.onmessage?.(new MessageEvent('message', { data: { kind: 'done', system } }));

    await expect(pending).resolves.toBe(system);
    expect(worker.terminated).toBe(true);
  });

  it('falls back to main-thread reconstruction when the Worker runtime fails', async () => {
    const worker = new FakeWorker();
    const system = createEmptySystem();
    const pending = deserializeSystemOffThread(JSON.stringify(system), {
      workerFactory: () => worker,
    });

    worker.onerror?.({ message: 'Worker script failed.' } as ErrorEvent);

    await expect(pending).resolves.toMatchObject({ id: system.id });
    expect(worker.terminated).toBe(true);
  });
});
