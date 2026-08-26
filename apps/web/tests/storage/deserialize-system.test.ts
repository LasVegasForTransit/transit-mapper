import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

beforeEach(() => performance.clearMarks());
afterEach(() => {
  performance.clearMarks();
  vi.useRealTimers();
});

function startupMarkNames(): string[] {
  return performance.getEntriesByType('mark').map((entry) => entry.name);
}

describe('deserializeSystemOffThread', () => {
  it('parses normalized JSON returned by the Worker', async () => {
    const worker = new FakeWorker();
    const system = createEmptySystem();
    const serialized = JSON.stringify(system);
    const pending = deserializeSystemOffThread(serialized, { workerFactory: () => worker });

    expect(worker.posted).toEqual([serialized]);
    worker.onmessage?.(
      new MessageEvent('message', {
        data: { kind: 'done', serialized: JSON.stringify(system) },
      }),
    );

    await expect(pending).resolves.toEqual(system);
    expect(worker.terminated).toBe(true);
    expect(startupMarkNames()).toEqual(['tm:deserialize-start', 'tm:deserialize-end']);
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
    expect(startupMarkNames()).toEqual(['tm:deserialize-start', 'tm:deserialize-end']);
  });

  it('rejects an invalid normalized payload returned by the Worker', async () => {
    const worker = new FakeWorker();
    const pending = deserializeSystemOffThread('{}', { workerFactory: () => worker });

    worker.onmessage?.(
      new MessageEvent('message', {
        data: { kind: 'done', serialized: '{not-json' },
      }),
    );

    await expect(pending).rejects.toBeInstanceOf(Error);
    expect(worker.terminated).toBe(true);
    expect(startupMarkNames()).toEqual(['tm:deserialize-start', 'tm:deserialize-end']);
  });

  it('closes the milestone when Worker fallback cannot parse the stored document', async () => {
    const worker = new FakeWorker();
    const pending = deserializeSystemOffThread('{not-json', { workerFactory: () => worker });

    worker.onerror?.({ message: 'Worker script failed.' } as ErrorEvent);

    await expect(pending).rejects.toBeDefined();
    expect(startupMarkNames()).toEqual(['tm:deserialize-start', 'tm:deserialize-end']);
  });

  it('closes the milestone after a timed-out Worker falls back', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const worker = new FakeWorker();
    const system = createEmptySystem();
    const pending = deserializeSystemOffThread(JSON.stringify(system), {
      timeoutMs: 10,
      workerFactory: () => worker,
    });

    await vi.advanceTimersByTimeAsync(10);

    await expect(pending).resolves.toMatchObject({ id: system.id });
    expect(startupMarkNames()).toEqual(['tm:deserialize-start', 'tm:deserialize-end']);
  });
});
