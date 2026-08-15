import {
  ADAPTIVE_ASSET_MANIFEST_URL,
  ADAPTIVE_CACHE_NAME,
  ADAPTIVE_SESSION_BYTE_LIMIT,
  parseAdaptiveAssetManifest,
  type AdaptiveAsset,
  type OfflineReadiness,
} from './adaptive-cache-contract';

export type { OfflineReadiness } from './adaptive-cache-contract';

interface AdaptiveCache {
  match(url: string): Promise<Response | undefined>;
  put(url: string, response: Response): Promise<void>;
}

export interface AdaptiveCacheEnvironment {
  estimateStorage: () => Promise<StorageEstimate>;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  openCache: (name: string) => Promise<AdaptiveCache>;
}

export interface AdaptiveCacheRunOptions {
  returningOrInstalled: boolean;
  saveData: boolean;
  effectiveType: string | null;
  environment: AdaptiveCacheEnvironment;
}

interface NetworkInformationHint {
  saveData?: boolean;
  effectiveType?: string;
}

interface NavigatorWithConnection extends Navigator {
  connection?: NetworkInformationHint;
}

// Leave room for response headers and the small optional-manifest request.
// Asset sizes are uncompressed, so their declared body ceiling remains more
// conservative than the Brotli payload used in production.
const TRANSPORT_OVERHEAD_RESERVE_BYTES = 1024;
const SLOW_CONNECTIONS = new Set(['slow-2g', '2g']);

function policyAllowsRun(options: AdaptiveCacheRunOptions): boolean {
  return (
    options.returningOrInstalled &&
    !options.saveData &&
    !SLOW_CONNECTIONS.has(options.effectiveType ?? '')
  );
}

function enoughStorage(estimate: StorageEstimate): boolean {
  if (estimate.quota === undefined || estimate.usage === undefined) return false;
  return estimate.quota - estimate.usage >= ADAPTIVE_SESSION_BYTE_LIMIT;
}

async function manifestResponse(environment: AdaptiveCacheEnvironment) {
  const response = await environment.fetch(ADAPTIVE_ASSET_MANIFEST_URL, {
    cache: 'no-store',
    credentials: 'same-origin',
    redirect: 'error',
  });
  if (!response.ok || !response.headers.get('content-type')?.startsWith('application/json')) {
    throw new Error('Adaptive asset manifest response is invalid.');
  }
  const body = await response.arrayBuffer();
  const manifest = parseAdaptiveAssetManifest(JSON.parse(new TextDecoder().decode(body)));
  return { manifest, bodyBytes: body.byteLength };
}

async function cacheAsset(
  asset: AdaptiveAsset,
  cache: AdaptiveCache,
  environment: AdaptiveCacheEnvironment,
): Promise<void> {
  const response = await environment.fetch(asset.url, {
    cache: 'no-cache',
    credentials: 'same-origin',
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`Adaptive asset request failed: ${asset.url}`);
  await cache.put(asset.url, response);
}

async function cacheWithinBudget(
  assets: readonly AdaptiveAsset[],
  cache: AdaptiveCache,
  environment: AdaptiveCacheEnvironment,
  bodyBytes: number,
): Promise<void> {
  let remaining = ADAPTIVE_SESSION_BYTE_LIMIT - bodyBytes - TRANSPORT_OVERHEAD_RESERVE_BYTES;
  for (const asset of assets) {
    if (await cache.match(asset.url)) continue;
    if (asset.bytes > remaining) continue;
    await cacheAsset(asset, cache, environment);
    remaining -= asset.bytes;
  }
}

async function allAssetsCached(assets: readonly AdaptiveAsset[], cache: AdaptiveCache) {
  const results = await Promise.all(assets.map((asset) => cache.match(asset.url)));
  return results.every(Boolean);
}

/** Performs at most one bounded optional-cache fill. All failures become a
 * truthful deferred state: background availability must never affect editor
 * correctness or claim more offline coverage than the Cache API proves. */
export async function cacheAdaptiveAssets(
  options: AdaptiveCacheRunOptions,
): Promise<OfflineReadiness> {
  if (!policyAllowsRun(options)) return 'deferred';
  try {
    if (!enoughStorage(await options.environment.estimateStorage())) return 'deferred';
    const { manifest, bodyBytes } = await manifestResponse(options.environment);
    if (bodyBytes + TRANSPORT_OVERHEAD_RESERVE_BYTES > ADAPTIVE_SESSION_BYTE_LIMIT) {
      return 'deferred';
    }
    const cache = await options.environment.openCache(ADAPTIVE_CACHE_NAME);
    await cacheWithinBudget(manifest.assets, cache, options.environment, bodyBytes);
    return (await allAssetsCached(manifest.assets, cache)) ? 'complete' : 'adaptive-pending';
  } catch {
    return 'deferred';
  }
}

/** Browser adapter kept in this lazy module so none of the quota, connection,
 * Cache Storage, or manifest machinery joins the brand-new editor graph. */
export function cacheBrowserAdaptiveAssets(
  returningOrInstalled: boolean,
): Promise<OfflineReadiness> {
  const connection = (navigator as NavigatorWithConnection).connection;
  return cacheAdaptiveAssets({
    returningOrInstalled,
    saveData: connection?.saveData === true,
    effectiveType: connection?.effectiveType ?? null,
    environment: {
      estimateStorage: () => navigator.storage.estimate(),
      fetch: (url, init) => fetch(url, init),
      openCache: (name) => caches.open(name),
    },
  });
}
