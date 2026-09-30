import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parse } from 'smol-toml';

import { bindings, defineConfig, exports, triggers } from 'cf/config';

// The preview workflow supplies a different Worker name, public URL, and D1 ID
// for each PR. Defaults keep local builds and type generation deterministic.
const runWorkerFirst = [
  '/api/*',
  '/s/*',
  '/e/*',
  '/v/*',
  '/embed/*',
  '/transit-mapper',
  '/transit-mapper/*',
];

interface D1Record {
  database_id?: string;
}

interface WranglerDatabaseIds {
  d1_databases?: D1Record[];
  env?: { preview?: { d1_databases?: D1Record[] } };
}

// Bootstrap still provisions D1 through Wrangler and writes the resulting IDs
// to wrangler.toml. Reading only those IDs keeps a bootstrap run from leaving
// cf pointed at the old database; every other deployment setting lives here.
const wranglerIds = parse(
  readFileSync(resolve(import.meta.dirname, 'wrangler.toml'), 'utf8'),
) as WranglerDatabaseIds;

function databaseId(preview: boolean): string {
  const id = preview
    ? wranglerIds.env?.preview?.d1_databases?.[0]?.database_id
    : wranglerIds.d1_databases?.[0]?.database_id;
  if (!id || !/^[0-9a-f-]{36}$/iu.test(id)) {
    throw new Error(
      `Missing ${preview ? 'preview' : 'production'} D1 database ID in wrangler.toml`,
    );
  }
  return id;
}

function limiter(namespace: string, limit: number, period: 10 | 60) {
  return bindings.rateLimit({ namespace, simple: { limit, period } });
}

export default defineConfig(({ mode }) => {
  const preview = mode === 'preview';
  const previewName = process.env.TRANSITMAPPER_PREVIEW_NAME ?? 'transitmapper-preview';
  const previewUrl =
    process.env.TRANSITMAPPER_PREVIEW_URL ?? 'https://transitmapper-preview.invalid';
  const previewDatabaseId = process.env.TRANSITMAPPER_PREVIEW_DB_ID ?? databaseId(true);
  const name = preview ? previewName : 'transitmapper';

  return {
    worker: {
      name,
      compatibilityDate: '2025-07-01',
      entrypoint: 'src/entry.ts',
      observability: { enabled: true, headSamplingRate: 1 },
      assets: {
        notFoundHandling: 'single-page-application',
        runWorkerFirst,
      },
      ...(preview
        ? { workersDev: true, previewUrls: false }
        : {
            domains: ['map.lasvegasfortransit.org'],
            triggers: [
              triggers.fetch({
                pattern: 'labs.lasvegasfortransit.org/transit-mapper',
                zone: 'lasvegasfortransit.org',
              }),
              triggers.fetch({
                pattern: 'labs.lasvegasfortransit.org/transit-mapper/*',
                zone: 'lasvegasfortransit.org',
              }),
              triggers.scheduled({ schedule: '0 0 * * *' }),
            ],
          }),
      env: {
        SITE_URL: bindings.text(preview ? previewUrl : 'https://map.lasvegasfortransit.org'),
        NOMINATIM_URL: bindings.text('https://nominatim.openstreetmap.org/search'),
        DB: bindings.d1({
          name: preview ? 'transitmapper-preview' : 'transitmapper',
          id: preview ? previewDatabaseId : databaseId(false),
        }),
        GTFS_ARCHIVES: bindings.r2({ name: 'transitmapper-data' }),
        PLACE_SEARCH_GATE: bindings.durableObject({ worker: name, exportName: 'PlaceSearchGate' }),
        SHARE_CREATE_LIMITER: limiter('1001', 20, 60),
        VIEW_CREATE_LIMITER: limiter('1006', 20, 60),
        PERFORMANCE_SAMPLE_LIMITER: limiter('1005', 10, 60),
        PLACE_SEARCH_LIMITER: limiter('1002', 10, 60),
        PLACE_UPSTREAM_LIMITER: limiter('1004', 1, 10),
        OSM_TILE_LIMITER: limiter('1003', 60, 60),
        ASSETS: bindings.assets(),
      },
      // This class already has a live SQLite namespace. Keep its storage and
      // binding name unchanged when moving the deployment from Wrangler to cf.
      exports: { PlaceSearchGate: exports.durableObject({ storage: 'sqlite' }) },
    },
  };
});
