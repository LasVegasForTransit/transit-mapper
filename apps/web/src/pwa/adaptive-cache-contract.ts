export interface AdaptiveAsset {
  url: string;
  /** Uncompressed emitted size. It is a conservative upper bound for the
   * encoded network bytes consumed by optional background caching. */
  bytes: number;
}

export interface AdaptiveAssetManifest {
  schemaVersion: 1;
  buildId: string;
  assets: AdaptiveAsset[];
}

export type OfflineReadiness = 'essential' | 'adaptive-pending' | 'complete' | 'deferred';

export const ADAPTIVE_ASSET_MANIFEST_URL = '/adaptive-assets.json';
export const ADAPTIVE_CACHE_NAME = 'transitmapper-adaptive-v1';
export const ADAPTIVE_SESSION_BYTE_LIMIT = 64 * 1024;

const BUILD_ID = /^[A-Za-z0-9._+-]{1,80}$/;
const BUILD_ASSET_URL = /^\/(?:assets|icons)\/[A-Za-z0-9_.@/-]+$/;
const OPTIONAL_ROOT_ASSET_URL = /^\/(?:apple-touch-icon|favicon-(?:dark-)?(?:16x16|32x32))\.png$/;
const MAX_ASSET_BYTES = 1_000_000_000;
const MAX_ASSETS = 256;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validAsset(value: unknown): value is AdaptiveAsset {
  const candidate = record(value);
  if (!candidate || !exactKeys(candidate, ['bytes', 'url'])) return false;
  const { bytes, url } = candidate;
  return (
    typeof url === 'string' &&
    (BUILD_ASSET_URL.test(url) || OPTIONAL_ROOT_ASSET_URL.test(url)) &&
    !url.includes('/../') &&
    Number.isSafeInteger(bytes) &&
    (bytes as number) >= 0 &&
    (bytes as number) <= MAX_ASSET_BYTES
  );
}

/** Parses an untrusted build artifact before it can initiate background
 * requests. Exact keys and same-origin path allowlists prevent a modified
 * manifest from becoming a general-purpose prefetch list. */
export function parseAdaptiveAssetManifest(value: unknown): AdaptiveAssetManifest {
  const candidate = record(value);
  const invalid = () => new Error('Invalid adaptive asset manifest.');
  if (!candidate || !exactKeys(candidate, ['assets', 'buildId', 'schemaVersion'])) throw invalid();
  if (candidate.schemaVersion !== 1 || typeof candidate.buildId !== 'string') throw invalid();
  if (!BUILD_ID.test(candidate.buildId) || !Array.isArray(candidate.assets)) throw invalid();
  if (candidate.assets.length > MAX_ASSETS || !candidate.assets.every(validAsset)) throw invalid();
  const assets = candidate.assets;
  for (const [index, current] of assets.entries()) {
    if (index > 0 && assets[index - 1].url >= current.url) throw invalid();
  }
  return { schemaVersion: 1, buildId: candidate.buildId, assets };
}
