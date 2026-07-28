import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout, RequestTimeoutError } from './fetchWithTimeout';

function pendingFetch(_input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('fetchWithTimeout', () => {
  it('aborts a request after its deadline with a bounded error', async () => {
    vi.useFakeTimers();
    const request = fetchWithTimeout('/api/systems', {}, { fetcher: pendingFetch, timeoutMs: 50 });
    const rejection = expect(request).rejects.toBeInstanceOf(RequestTimeoutError);

    await vi.advanceTimersByTimeAsync(50);

    await rejection;
  });

  it('forwards caller cancellation instead of relabeling it as a timeout', async () => {
    const controller = new AbortController();
    const request = fetchWithTimeout(
      '/api/systems',
      {},
      { fetcher: pendingFetch, signal: controller.signal },
    );

    controller.abort(new DOMException('Dialog closed', 'AbortError'));

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('keeps the deadline active while the response body is still arriving', async () => {
    vi.useFakeTimers();
    const stalledBodyFetch = vi.fn(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"partial":'));
        },
      });
      return new Response(stream, { status: 200 });
    }) as typeof fetch;
    const request = fetchWithTimeout(
      '/api/systems',
      {},
      { fetcher: stalledBodyFetch, timeoutMs: 50 },
    );
    const rejection = expect(request).rejects.toBeInstanceOf(RequestTimeoutError);

    await vi.advanceTimersByTimeAsync(50);

    await rejection;
  });
});
