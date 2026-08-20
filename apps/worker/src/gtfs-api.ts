import type { PublishedGtfsFeedsResponse } from '@transitmapper/core/model/gtfs-feed';
import { findGtfsFeed, gtfsArchiveKey, publishedGtfsFeeds } from './gtfs-feeds';

const GTFS_CACHE_SECONDS = 3600;

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

export function listGtfsFeedsResponse(): Response {
  const body: PublishedGtfsFeedsResponse = { feeds: publishedGtfsFeeds() };
  return Response.json(body);
}

/** The browser names a reviewed feed, never an upstream URL. This route only
 * reads validated archives, so it cannot act as an arbitrary-fetch proxy. */
export async function gtfsArchiveResponse(slug: string, archives: R2Bucket): Promise<Response> {
  const feed = findGtfsFeed(slug);
  if (!feed) return jsonError('GTFS feed not found', 404);
  const archive = await archives.get(gtfsArchiveKey(feed.slug));
  if (!archive) {
    return jsonError(`${feed.name} GTFS feed is temporarily unavailable`, 503);
  }
  return new Response(archive.body, {
    headers: {
      'content-type': 'application/zip',
      'cache-control': `public, max-age=${GTFS_CACHE_SECONDS}`,
      'content-length': archive.size.toString(),
      etag: archive.httpEtag,
    },
  });
}
