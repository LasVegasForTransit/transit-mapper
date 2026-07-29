import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { describe, expect, it, vi } from 'vitest';
import {
  serializeSystemOffThread,
  type StorageSerializerWorker,
} from '../../src/storage/serializeSystem';
import type {
  StorageSerializerEvent,
  StorageSerializerRequest,
} from '../../src/storage/storageSerializerProtocol';

class FakeWorker implements StorageSerializerWorker {
  onmessage: ((event: MessageEvent<StorageSerializerEvent>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  request: StorageSerializerRequest | null = null;
  terminate = vi.fn();

  postMessage(request: StorageSerializerRequest): void {
    this.request = request;
  }
}

describe('storage serialization Worker', () => {
  it('serializes the captured system outside the main thread', async () => {
    const worker = new FakeWorker();
    const system = { ...createEmptySystem(), id: 'large' };
    const pending = serializeSystemOffThread(system, { workerFactory: () => worker });

    expect(worker.request).toEqual({ system });
    worker.onmessage?.(
      new MessageEvent('message', {
        data: { kind: 'done', serialized: JSON.stringify(system) },
      }),
    );

    await expect(pending).resolves.toBe(JSON.stringify(system));
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('terminates the Worker and rejects if serialization fails', async () => {
    const worker = new FakeWorker();
    const pending = serializeSystemOffThread(createEmptySystem(), {
      workerFactory: () => worker,
    });

    worker.onmessage?.(
      new MessageEvent('message', {
        data: { kind: 'error', message: 'could not serialize' },
      }),
    );

    await expect(pending).rejects.toThrow('could not serialize');
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('falls back to synchronous serialization when Workers are unavailable', async () => {
    const system = { ...createEmptySystem(), id: 'fallback' };

    await expect(
      serializeSystemOffThread(system, {
        workerFactory: () => {
          throw new DOMException('Workers disabled.', 'SecurityError');
        },
      }),
    ).resolves.toBe(JSON.stringify(system));
  });

  it('cleans up when structured cloning throws synchronously', async () => {
    const worker = new FakeWorker();
    worker.postMessage = () => {
      throw new DOMException('Clone failed.', 'DataCloneError');
    };

    await expect(
      serializeSystemOffThread(createEmptySystem(), { workerFactory: () => worker }),
    ).rejects.toThrow('Clone failed');
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('does not leave a save waiting forever on a stalled Worker', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const pending = serializeSystemOffThread(createEmptySystem(), {
      timeoutMs: 20,
      workerFactory: () => worker,
    });
    const rejected = expect(pending).rejects.toThrow('timed out');

    await vi.advanceTimersByTimeAsync(20);

    await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
