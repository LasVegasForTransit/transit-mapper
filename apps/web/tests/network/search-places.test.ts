import { describe, expect, it, vi } from 'vitest';
import { searchPlaces } from '../../src/network/search-places';

describe('searchPlaces', () => {
  it('rejects a successful payload whose place center is not a coordinate pair', async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(Response.json({ results: [{ label: 'Broken place', center: [-115.1] }] })),
    ) as typeof fetch;

    await expect(searchPlaces('Broken place', { fetcher })).rejects.toThrow(
      'Place search returned an invalid response.',
    );
  });

  it('rejects invalid normalized bounds and optional country metadata', async () => {
    const malformed = [
      {
        label: 'Broken bounds',
        center: [-115.1, 36.1],
        boundingBox: { west: -115.2, south: 36.2, east: -115, north: 36 },
      },
      { label: 'Broken country', center: [-115.1, 36.1], countryCode: 42 },
    ];
    const fetcher = vi.fn(() =>
      Promise.resolve(Response.json({ results: malformed })),
    ) as typeof fetch;

    await expect(searchPlaces('Broken place', { fetcher })).rejects.toThrow(
      'Place search returned an invalid response.',
    );
  });
});
