import { pathToFileURL } from 'node:url';

const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';
export const GTFS_ARCHIVE_BUCKET = 'transitmapper-data';

export interface GtfsStorageOptions {
  accountId: string;
  apiToken: string;
  bucketName: string;
}

interface CloudflareError {
  code?: number;
  message?: string;
}

interface CloudflareEnvelope {
  success?: boolean;
  errors?: CloudflareError[];
  result?: {
    buckets?: Array<{ name?: string }>;
  };
}

function cloudflareError(operation: string, payload: CloudflareEnvelope): Error {
  const details = payload.errors
    ?.map((error) => `${error.code ?? 'unknown'}: ${error.message ?? 'Unknown error'}`)
    .join(', ');
  return new Error(`Cloudflare R2 ${operation} failed${details ? ` (${details})` : ''}`);
}

async function cloudflareRequest(
  url: string,
  init: RequestInit,
  fetcher: typeof fetch,
  operation: string,
): Promise<CloudflareEnvelope> {
  const response = await fetcher(url, init);
  const payload = (await response.json()) as CloudflareEnvelope;
  if (!response.ok || payload.success !== true) throw cloudflareError(operation, payload);
  return payload;
}

/** Ensures the scheduled publisher owns its storage before it downloads any
 * feed. This removes the one-time dashboard bucket step without hiding an
 * authentication or entitlement failure behind an ignored create error. */
export async function ensureGtfsArchiveBucket(
  options: GtfsStorageOptions,
  fetcher: typeof fetch = fetch,
): Promise<'created' | 'existing'> {
  const endpoint = `${CLOUDFLARE_API_BASE}/accounts/${encodeURIComponent(options.accountId)}/r2/buckets`;
  const headers = {
    authorization: `Bearer ${options.apiToken}`,
    'content-type': 'application/json',
  };
  const listed = await cloudflareRequest(
    `${endpoint}?name_contains=${encodeURIComponent(options.bucketName)}&per_page=100`,
    { method: 'GET', headers },
    fetcher,
    'bucket lookup',
  );
  if (listed.result?.buckets?.some((bucket) => bucket.name === options.bucketName)) {
    return 'existing';
  }
  await cloudflareRequest(
    endpoint,
    { method: 'POST', headers, body: JSON.stringify({ name: options.bucketName }) },
    fetcher,
    'bucket creation',
  );
  return 'created';
}

async function main(): Promise<void> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId) throw new Error('CLOUDFLARE_ACCOUNT_ID is required');
  if (!apiToken) throw new Error('CLOUDFLARE_API_TOKEN is required');
  const result = await ensureGtfsArchiveBucket({
    accountId,
    apiToken,
    bucketName: GTFS_ARCHIVE_BUCKET,
  });
  console.log(
    result === 'created'
      ? `Created R2 bucket ${GTFS_ARCHIVE_BUCKET}`
      : `R2 bucket ${GTFS_ARCHIVE_BUCKET} already exists`,
  );
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
