import { describe, expect, it, vi } from 'vitest';
import { searchPlaces } from '../../src/model/geocode';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('searchPlaces', () => {
  it('resolves a query to a center and country code', async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(
        jsonResponse([
          {
            display_name: 'Las Vegas, Nevada, United States',
            lat: '36.1699',
            lon: '-115.1398',
            boundingbox: ['36.0', '36.3', '-115.3', '-115.0'],
            address: { country_code: 'us' },
          },
        ]),
      ),
    ) as typeof fetch;

    const results = await searchPlaces('Las Vegas', { fetcher });

    expect(results).toEqual([
      {
        label: 'Las Vegas, Nevada, United States',
        center: [-115.1398, 36.1699],
        boundingBox: { south: 36.0, north: 36.3, west: -115.3, east: -115.0 },
        countryCode: 'us',
      },
    ]);
  });

  it('returns an empty array for a blank query without touching the network', async () => {
    const fetcher = vi.fn() as typeof fetch;
    await expect(searchPlaces('   ', { fetcher })).resolves.toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('drops results with no usable coordinates instead of throwing', async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(jsonResponse([{ display_name: 'Nowhere', lat: 'not-a-number', lon: '1' }])),
    ) as typeof fetch;
    await expect(searchPlaces('nowhere', { fetcher })).resolves.toEqual([]);
  });

  it('throws on a genuine network failure', async () => {
    const fetcher = vi.fn(() => Promise.resolve(jsonResponse({}, 503))) as typeof fetch;
    await expect(searchPlaces('anywhere', { fetcher })).rejects.toThrow('Place search failed');
  });

  it('never resolves once its signal is aborted', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((_resolve, reject) => {
          controller.signal.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    ) as typeof fetch;

    const result = searchPlaces('abort me', { fetcher, signal: controller.signal });
    controller.abort();

    await expect(result).rejects.toThrow();
  });
});
