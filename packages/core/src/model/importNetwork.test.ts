import { afterEach, describe, expect, it, vi } from 'vitest';
import { importOsmWays } from './import';

const BBOX = { west: -115.2, south: 36.1, east: -115.19, north: 36.11 };

afterEach(() => {
  vi.useRealTimers();
});

describe('OSM network requests', () => {
  it('bounds a stalled mirror and continues to the next endpoint', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      if (calls === 2) {
        return Promise.resolve(
          new Response(JSON.stringify({ elements: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      });
    }) as typeof fetch;
    const result = importOsmWays(BBOX, ['road'], 'right', {
      endpointTimeoutMs: 25,
      fetcher,
    });

    await vi.advanceTimersByTimeAsync(25);

    await expect(result).resolves.toMatchObject({ ways: [] });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('honors caller cancellation without trying another mirror', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('Dialog closed', 'AbortError'));
    const fetcher = vi.fn() as typeof fetch;

    await expect(
      importOsmWays(BBOX, ['road'], 'right', {
        signal: controller.signal,
        fetcher,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps the mirror deadline active while JSON is still arriving', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls++;
      if (calls === 2) {
        return new Response(JSON.stringify({ elements: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"elements":['));
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    const result = importOsmWays(BBOX, ['road'], 'right', {
      endpointTimeoutMs: 25,
      fetcher,
    });

    await vi.advanceTimersByTimeAsync(25);

    await expect(result).resolves.toMatchObject({ ways: [] });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
