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

// D1 IDs change in wrangler.toml through a reviewed configuration pull request.
// Shared setup checks each deployment scope before applying migrations. Reading
// only those IDs keeps both configs on the same database; other settings live here.
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

function limiter(namespace: string, limit: number, period: 10 | 60, preview: boolean) {
  return bindings.rateLimit({
    namespace: preview ? `2${namespace.slice(1)}` : namespace,
    simple: { limit, period },
  });
}
function previewDatabaseId(): string {
  if (process.env.TRANSITMAPPER_PREVIEW_DB_ID) return process.env.TRANSITMAPPER_PREVIEW_DB_ID;
  const declarations = process.env.LVBT_PREVIEW_BINDINGS;
  if (!declarations) return databaseId(true);
  const bindings = JSON.parse(declarations) as { DB?: { id?: unknown } };
  if (typeof bindings.DB?.id !== 'string')
    throw new Error('LVBT_PREVIEW_BINDINGS must declare the reviewed preview DB ID.');
  return bindings.DB.id;
}

export default defineConfig(({ mode }) => {
  const preview = mode === 'preview';
  const previewName = process.env.TRANSITMAPPER_PREVIEW_NAME ?? 'transitmapper-preview';
  const previewUrl =
    process.env.TRANSITMAPPER_PREVIEW_URL ?? 'https://transitmapper-preview.invalid';
  const previewId = previewDatabaseId();
  const name = preview ? previewName : 'transitmapper';

  return {
    worker: {
      name,
      compatibilityDate: '2025-07-01',
      entrypoint: 'src/entry.ts',
      observability: { enabled: true, headSamplingRate: 1 },
      assets: {
        notFoundHandling: 'single-page-application',
        runWorkerFirst: preview
          ? [...runWorkerFirst, '/', '/privacy', '/sitemap.xml', '/robots.txt']
          : runWorkerFirst,
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
          id: preview ? previewId : databaseId(false),
        }),
        GTFS_ARCHIVES: bindings.r2({ name: 'transitmapper-data' }),
        PLACE_SEARCH_GATE: bindings.durableObject({ worker: name, exportName: 'PlaceSearchGate' }),
        SHARE_CREATE_LIMITER: limiter('1001', 20, 60, preview),
        VIEW_CREATE_LIMITER: limiter('1006', 20, 60, preview),
        PERFORMANCE_SAMPLE_LIMITER: limiter('1005', 10, 60, preview),
        PLACE_SEARCH_LIMITER: limiter('1002', 10, 60, preview),
        PLACE_UPSTREAM_LIMITER: limiter('1004', 1, 10, preview),
        OSM_TILE_LIMITER: limiter('1003', 60, 60, preview),
        ASSETS: bindings.assets(),
      },
      // This class already has a live SQLite namespace. Keep its storage and
      // binding name unchanged when moving the deployment from Wrangler to cf.
      exports: { PlaceSearchGate: exports.durableObject({ storage: 'sqlite' }) },
    },
  };
});
