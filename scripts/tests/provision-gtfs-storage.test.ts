import { describe, expect, it, vi } from 'vitest';
import { ensureGtfsArchiveBucket } from '../provision-gtfs-storage.js';

const OPTIONS = {
  accountId: 'account-id',
  apiToken: 'token',
  bucketName: 'transitmapper-data',
};

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

describe('GTFS storage provisioning', () => {
  it('leaves an existing archive bucket unchanged', async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        jsonResponse({
          success: true,
          result: { buckets: [{ name: 'transitmapper-data' }] },
        }),
      ),
    );

    await expect(ensureGtfsArchiveBucket(OPTIONS, fetcher)).resolves.toBe('existing');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'GET' });
  });

  it('creates the archive bucket when the account does not have it', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ success: true, result: { buckets: [] } }))
      .mockResolvedValueOnce(
        jsonResponse({ success: true, result: { name: 'transitmapper-data' } }),
      );

    await expect(ensureGtfsArchiveBucket(OPTIONS, fetcher)).resolves.toBe('created');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ name: 'transitmapper-data' }),
    });
  });

  it('reports Cloudflare permission failures without attempting creation', async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        jsonResponse(
          {
            success: false,
            errors: [{ code: 10000, message: 'Authentication error' }],
          },
          403,
        ),
      ),
    );

    await expect(ensureGtfsArchiveBucket(OPTIONS, fetcher)).rejects.toThrow(
      'Cloudflare R2 bucket lookup failed (10000: Authentication error)',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
