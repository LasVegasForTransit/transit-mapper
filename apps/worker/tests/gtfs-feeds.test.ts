import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { PublishedGtfsFeedsResponse } from '@transitmapper/core/model/gtfs-feed';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index';
import { validateGtfsFeedCatalog } from '../src/gtfs-feeds';

const RTC_ARCHIVE_KEY = 'gtfs/rtc/current.zip';

async function call(path: string): Promise<Response> {
  const context = createExecutionContext();
  const response = await worker.fetch(new Request(`https://example.com${path}`), env, context);
  await waitOnExecutionContext(context);
  return response;
}

beforeEach(async () => env.GTFS_ARCHIVES.delete(RTC_ARCHIVE_KEY));

describe('published GTFS feeds', () => {
  it('rejects duplicate and malformed server catalog entries', () => {
    const feed = {
      slug: 'valid-feed',
      name: 'Valid Transit',
      region: 'Valid Region',
      sourceUrl: 'https://example.com/feed.zip',
    };

    expect(() => validateGtfsFeedCatalog([feed, feed])).toThrow('Duplicate GTFS feed slug');
    expect(() => validateGtfsFeedCatalog([{ ...feed, slug: '../bad' }])).toThrow(
      'Invalid GTFS feed slug',
    );
    expect(() =>
      validateGtfsFeedCatalog([{ ...feed, sourceUrl: 'http://example.com/feed.zip' }]),
    ).toThrow('must use HTTPS');
  });

  it('lists public feed metadata without exposing upstream URLs', async () => {
    const response = await call('/api/v1/gtfs');
    const payload = await response.json<PublishedGtfsFeedsResponse>();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      feeds: [
        {
          slug: 'rtc',
          name: 'RTC Southern Nevada',
          region: 'Las Vegas Valley, Nevada',
        },
      ],
    });
    expect(JSON.stringify(payload)).not.toContain('developer.rtcsnv.com');
  });

  it('does not publish a second unversioned GTFS contract', async () => {
    const response = await call('/api/gtfs');

    expect(response.status).toBe(404);
  });

  it('rejects slugs that are not in the server catalog', async () => {
    const response = await call('/api/v1/gtfs/not-configured');

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'GTFS feed not found' });
  });

  it('reports a configured feed whose managed archive is missing', async () => {
    const response = await call('/api/v1/gtfs/rtc');

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'RTC Southern Nevada GTFS feed is temporarily unavailable',
    });
  });

  it('streams the configured archive with cache and object metadata', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const object = await env.GTFS_ARCHIVES.put(RTC_ARCHIVE_KEY, bytes);
    const response = await call('/api/v1/gtfs/rtc');

    expect(response.status).toBe(200);
    expect(object).not.toBeNull();
    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(response.headers.get('content-length')).toBe('4');
    expect(response.headers.get('etag')).toBe(object?.httpEtag);
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3, 4]);
  });
});
