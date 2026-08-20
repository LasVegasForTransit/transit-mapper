import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import {
  GTFS_FEEDS,
  gtfsArchiveKey,
  type GtfsFeedDefinition,
} from '../apps/worker/src/gtfs-feeds.js';

const GTFS_ARCHIVE_BUCKET = 'transitmapper-data';
const DOWNLOAD_TIMEOUT_MS = 120_000;

const REQUIRED_HEADERS: Readonly<Record<string, readonly string[]>> = {
  'routes.txt': ['route_id', 'route_type'],
  'trips.txt': ['route_id', 'service_id', 'trip_id', 'shape_id'],
  'stops.txt': ['stop_id', 'stop_name', 'stop_lat', 'stop_lon'],
  'stop_times.txt': ['trip_id', 'stop_id', 'stop_sequence'],
  'shapes.txt': ['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence'],
};

export interface RefreshGtfsDependencies {
  download(feed: GtfsFeedDefinition): Promise<Uint8Array>;
  upload(feed: GtfsFeedDefinition, key: string, bytes: Uint8Array): Promise<void>;
}

export interface RefreshGtfsResult {
  slug: string;
  ok: boolean;
  error?: string;
}

/** Rejects an archive before any upload can replace a feed's last good copy. */
export function validateGtfsArchive(bytes: Uint8Array): void {
  const files = unzipSync(bytes);
  for (const [name, requiredHeaders] of Object.entries(REQUIRED_HEADERS)) {
    const file = files[name];
    if (!file) throw new Error(`${name} is missing`);
    const text = strFromU8(file).replace(/^\uFEFF/, '');
    if (text.trim().length === 0) throw new Error(`${name} is empty`);
    const header = new Set(
      (text.split(/\r?\n/, 1)[0] ?? '').split(',').map((column) => column.trim()),
    );
    for (const requiredHeader of requiredHeaders) {
      if (!header.has(requiredHeader)) {
        throw new Error(`${name} is missing ${requiredHeader}`);
      }
    }
  }
}

/** Processes feeds one at a time so adding catalog entries does not create an
 * unbounded download/upload burst. A failure never reaches upload, and later
 * feeds still run before the caller reports the aggregate result. */
export async function refreshGtfsFeeds(
  feeds: readonly GtfsFeedDefinition[],
  dependencies: RefreshGtfsDependencies,
): Promise<RefreshGtfsResult[]> {
  const results: RefreshGtfsResult[] = [];
  for (const feed of feeds) {
    try {
      const bytes = await dependencies.download(feed);
      validateGtfsArchive(bytes);
      await dependencies.upload(feed, gtfsArchiveKey(feed.slug), bytes);
      results.push({ slug: feed.slug, ok: true });
    } catch (error) {
      results.push({
        slug: feed.slug,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

async function downloadFeed(feed: GtfsFeedDefinition): Promise<Uint8Array> {
  const response = await fetch(feed.sourceUrl, {
    headers: {
      accept: 'application/zip, application/octet-stream;q=0.9, */*;q=0.8',
      'user-agent': 'TransitMapper GTFS refresh (+https://map.lasvegasfortransit.org)',
    },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`source returned ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function uploadFeed(
  _feed: GtfsFeedDefinition,
  key: string,
  bytes: Uint8Array,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'pnpm',
      [
        '--filter',
        '@transitmapper/worker',
        'exec',
        'wrangler',
        'r2',
        'object',
        'put',
        `${GTFS_ARCHIVE_BUCKET}/${key}`,
        '--pipe',
        '--remote',
        '--content-type',
        'application/zip',
        '--cache-control',
        'public, max-age=3600',
        '--force',
      ],
      { cwd: new URL('..', import.meta.url), stdio: ['pipe', 'inherit', 'inherit'] },
    );
    child.once('error', reject);
    child.stdin.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`R2 upload exited with status ${code ?? 'unknown'}`));
    });
    child.stdin.end(bytes);
  });
}

async function main(): Promise<void> {
  const requestedSlug = process.env.GTFS_FEED_SLUG?.trim();
  const feeds = requestedSlug
    ? GTFS_FEEDS.filter((feed) => feed.slug === requestedSlug)
    : GTFS_FEEDS;
  if (requestedSlug && feeds.length === 0) {
    throw new Error(`Unknown GTFS feed slug: ${requestedSlug}`);
  }

  const results = await refreshGtfsFeeds(feeds, {
    download: downloadFeed,
    upload: uploadFeed,
  });
  for (const result of results) {
    if (result.ok) console.log(`Updated ${result.slug}`);
    else console.error(`Failed ${result.slug}: ${result.error}`);
  }
  if (results.some((result) => !result.ok)) process.exitCode = 1;
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
