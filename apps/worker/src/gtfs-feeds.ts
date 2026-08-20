import type { PublishedGtfsFeed } from '@transitmapper/core/model/gtfs-feed';

export interface GtfsFeedDefinition extends PublishedGtfsFeed {
  sourceUrl: string;
}

export const GTFS_FEEDS: readonly GtfsFeedDefinition[] = [
  {
    slug: 'rtc',
    name: 'RTC Southern Nevada',
    region: 'Las Vegas Valley, Nevada',
    sourceUrl: 'https://developer.rtcsnv.com/transitData/google_transit.zip',
  },
];

export function validateGtfsFeedCatalog(feeds: readonly GtfsFeedDefinition[]): void {
  const slugs = new Set<string>();
  for (const feed of feeds) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(feed.slug)) {
      throw new Error(`Invalid GTFS feed slug: ${feed.slug}`);
    }
    if (slugs.has(feed.slug)) throw new Error(`Duplicate GTFS feed slug: ${feed.slug}`);
    slugs.add(feed.slug);
    let sourceUrl: URL;
    try {
      sourceUrl = new URL(feed.sourceUrl);
    } catch {
      throw new Error(`GTFS feed ${feed.slug} has an invalid source URL`);
    }
    if (sourceUrl.protocol !== 'https:') {
      throw new Error(`GTFS feed ${feed.slug} source URL must use HTTPS`);
    }
  }
}

validateGtfsFeedCatalog(GTFS_FEEDS);

export function findGtfsFeed(slug: string): GtfsFeedDefinition | undefined {
  return GTFS_FEEDS.find((feed) => feed.slug === slug);
}

export function publishedGtfsFeeds(): PublishedGtfsFeed[] {
  return GTFS_FEEDS.map(({ slug, name, region }) => ({ slug, name, region }));
}

export function gtfsArchiveKey(slug: string): string {
  return `gtfs/${slug}/current.zip`;
}
