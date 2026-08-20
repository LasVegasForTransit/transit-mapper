import { strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import type { GtfsFeedDefinition } from '../../apps/worker/src/gtfs-feeds.js';

interface RefreshResult {
  slug: string;
  ok: boolean;
  error?: string;
}

interface RefreshModule {
  validateGtfsArchive(bytes: Uint8Array): void;
  refreshGtfsFeeds(
    feeds: readonly GtfsFeedDefinition[],
    dependencies: {
      download(feed: GtfsFeedDefinition): Promise<Uint8Array>;
      upload(feed: GtfsFeedDefinition, key: string, bytes: Uint8Array): Promise<void>;
    },
  ): Promise<RefreshResult[]>;
}

async function loadRefreshModule(): Promise<RefreshModule | null> {
  const moduleUrl = new URL('../refresh-gtfs-feeds.ts', import.meta.url).href;
  return import(/* @vite-ignore */ moduleUrl).catch(() => null) as Promise<RefreshModule | null>;
}

function archive(overrides: Record<string, string | undefined> = {}): Uint8Array {
  const files: Record<string, string | undefined> = {
    'routes.txt': 'route_id,route_type\nr1,3\n',
    'trips.txt': 'route_id,service_id,trip_id,shape_id\nr1,weekday,t1,s1\n',
    'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\na,First,36.1,-115.1\n',
    'stop_times.txt':
      'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nt1,08:00:00,08:00:00,a,1\n',
    'shapes.txt': 'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\ns1,36.1,-115.1,1\n',
    ...overrides,
  };
  return zipSync(
    Object.fromEntries(
      Object.entries(files).flatMap(([name, text]) =>
        text === undefined ? [] : [[name, strToU8(text)]],
      ),
    ),
  );
}

const FEEDS: readonly GtfsFeedDefinition[] = [
  {
    slug: 'first',
    name: 'First Transit',
    region: 'First Region',
    sourceUrl: 'https://example.com/first.zip',
  },
  {
    slug: 'broken',
    name: 'Broken Transit',
    region: 'Broken Region',
    sourceUrl: 'https://example.com/broken.zip',
  },
  {
    slug: 'last',
    name: 'Last Transit',
    region: 'Last Region',
    sourceUrl: 'https://example.com/last.zip',
  },
];

describe('GTFS feed refresh', () => {
  it('has an executable refresh module', async () => {
    await expect(loadRefreshModule()).resolves.not.toBeNull();
  });

  it('accepts an archive with every import-required file and header', async () => {
    const module = await loadRefreshModule();
    if (!module) return;

    expect(() => module.validateGtfsArchive(archive())).not.toThrow();
  });

  it('rejects a missing required file before upload', async () => {
    const module = await loadRefreshModule();
    if (!module) return;
    const files = archive({ 'shapes.txt': undefined });

    expect(() => module.validateGtfsArchive(files)).toThrow('shapes.txt is missing');
  });

  it('rejects a required file whose import columns are missing', async () => {
    const module = await loadRefreshModule();
    if (!module) return;
    const files = archive({ 'trips.txt': 'route_id,service_id,trip_id\nr1,weekday,t1\n' });

    expect(() => module.validateGtfsArchive(files)).toThrow('trips.txt is missing shape_id');
  });

  it('continues sequentially and leaves the failed feed untouched', async () => {
    const module = await loadRefreshModule();
    if (!module) return;
    const events: string[] = [];
    const stored = new Map<string, Uint8Array>([
      ['gtfs/broken/current.zip', new Uint8Array([9, 9, 9])],
    ]);
    const download = vi.fn((feed: GtfsFeedDefinition) => {
      events.push(`download:${feed.slug}`);
      return Promise.resolve(feed.slug === 'broken' ? archive({ 'shapes.txt': '' }) : archive());
    });
    const upload = vi.fn(
      (_feed: GtfsFeedDefinition, key: string, bytes: Uint8Array): Promise<void> => {
        events.push(`upload:${key}`);
        stored.set(key, bytes);
        return Promise.resolve();
      },
    );

    const results = await module.refreshGtfsFeeds(FEEDS, { download, upload });

    expect(events).toEqual([
      'download:first',
      'upload:gtfs/first/current.zip',
      'download:broken',
      'download:last',
      'upload:gtfs/last/current.zip',
    ]);
    expect(results.map(({ slug, ok }) => ({ slug, ok }))).toEqual([
      { slug: 'first', ok: true },
      { slug: 'broken', ok: false },
      { slug: 'last', ok: true },
    ]);
    const preserved = stored.get('gtfs/broken/current.zip');
    expect(preserved).toBeDefined();
    expect([...(preserved ?? [])]).toEqual([9, 9, 9]);
  });
});
