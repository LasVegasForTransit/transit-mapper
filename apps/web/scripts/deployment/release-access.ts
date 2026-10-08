import { resolve } from 'node:path';
import {
  accessCredentials,
  accessHeaders,
  readReleaseConfiguration,
  scopeBrowserAccess,
  validateWorkerSmokeOrigin,
  type ReleaseConfiguration,
} from '@lasvegasfortransit/web-platform/release';
import type { BrowserContext } from 'playwright-core';

type OriginConfiguration = Pick<
  ReleaseConfiguration,
  'productionUrl' | 'previewUrl' | 'productionWorker' | 'previewWorker' | 'workersDevSubdomain'
>;
export async function releaseBrowserCredentials(
  origin: string,
  config?: OriginConfiguration,
  env: Record<string, string | undefined> = process.env,
) {
  const url = new URL(origin);
  if (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    return;
  if (!env.CF_ACCESS_CLIENT_ID && !env.CF_ACCESS_CLIENT_SECRET) return;
  config ??= await readReleaseConfiguration(resolve(import.meta.dirname, '../../../..'), env);
  if (url.origin === config.productionUrl) return;
  validateWorkerSmokeOrigin(origin, config, true);
  return accessCredentials(env);
}
export async function releaseRequestHeaders(url: string): Promise<Record<string, string>> {
  const origin = new URL(url).origin;
  return accessHeaders(url, origin, await releaseBrowserCredentials(origin));
}
export async function scopeReleaseBrowser(context: BrowserContext, origin: string): Promise<void> {
  await scopeBrowserAccess(context, origin, await releaseBrowserCredentials(origin));
}
