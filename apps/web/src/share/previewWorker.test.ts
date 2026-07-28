import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { renderPreviewMarkup } from './previewWorker';
import type { PreviewWorkerEvent, PreviewWorkerRequest } from './previewWorkerProtocol';

class FakePreviewWorker {
  onmessage: ((event: MessageEvent<PreviewWorkerEvent>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  postMessage(message: PreviewWorkerRequest): void {
    queueMicrotask(() => {
      const system = JSON.parse(message.data) as { id: string };
      this.onmessage?.({
        data: { kind: 'done', markup: `<svg data-system="${system.id}" />` },
      } as MessageEvent<PreviewWorkerEvent>);
    });
  }
  terminate(): void {
    this.terminated = true;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('share preview Worker', () => {
  it('returns generated markup and releases its Worker', async () => {
    const worker = new FakePreviewWorker();
    const system = createEmptySystem();

    await expect(
      renderPreviewMarkup(JSON.stringify(system), { workerFactory: () => worker }),
    ).resolves.toContain(system.id);
    expect(worker.terminated).toBe(true);
  });

  it('terminates immediately when sharing is canceled', async () => {
    const worker = new FakePreviewWorker();
    worker.postMessage = () => {};
    const controller = new AbortController();
    const pending = renderPreviewMarkup(JSON.stringify(createEmptySystem()), {
      signal: controller.signal,
      workerFactory: () => worker,
    });

    controller.abort(new DOMException('Canceled', 'AbortError'));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminated).toBe(true);
  });

  it('bounds a Worker that never answers', async () => {
    vi.useFakeTimers();
    const worker = new FakePreviewWorker();
    worker.postMessage = () => {};
    const pending = renderPreviewMarkup(JSON.stringify(createEmptySystem()), {
      timeoutMs: 100,
      workerFactory: () => worker,
    });
    const rejection = expect(pending).rejects.toThrow('timed out');

    await vi.advanceTimersByTimeAsync(100);

    await rejection;
    expect(worker.terminated).toBe(true);
  });
});
