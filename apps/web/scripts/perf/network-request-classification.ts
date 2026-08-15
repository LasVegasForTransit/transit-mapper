import type {
  CdpResponse,
  PerfByteCategory,
  PerfCacheSource,
  PerfCompression,
  PerfNetworkTarget,
  PerfRenderBlockingStatus,
} from '../../src/perf/network-byte-types';

const EXTERNAL_MAP_HOSTS = new Set(['tiles.openfreemap.org']);

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function header(headers: Record<string, unknown> | undefined, name: string): string {
  if (!headers) return '';
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  return match ? stringValue(match[1]).toLowerCase() : '';
}

export function compression(headers: Record<string, unknown> | undefined): PerfCompression {
  const value = header(headers, 'content-encoding');
  if (!value || value === 'identity') return 'identity';
  if (value.includes('zstd')) return 'zstd';
  if (value.includes('gzip')) return 'gzip';
  if (value.includes('br')) return 'br';
  return 'other';
}

export function renderBlockingStatus(value: unknown): PerfRenderBlockingStatus {
  const normalized = stringValue(value).toLowerCase();
  if (normalized.includes('nonblocking') || normalized.includes('non-blocking')) {
    return 'non-blocking';
  }
  return normalized.includes('blocking') ? 'blocking' : 'unknown';
}

export function cacheSource(
  response: CdpResponse | undefined,
  servedFromCache: boolean,
): PerfCacheSource {
  if (response?.fromServiceWorker === true) return 'service-worker';
  if (response?.fromPrefetchCache === true) return 'prefetch';
  if (response?.fromDiskCache === true) return 'disk';
  if (servedFromCache) return 'memory-or-disk';
  return response ? 'network' : 'unknown';
}

export function categoryFor(
  url: string,
  target: PerfNetworkTarget,
  applicationOrigin: string,
): PerfByteCategory {
  if (target === 'service-worker') return 'service-worker';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'other';
  }
  if (
    parsed.pathname === '/api/performance-samples' ||
    parsed.pathname.startsWith('/cdn-cgi/rum') ||
    parsed.hostname === 'static.cloudflareinsights.com'
  ) {
    return 'telemetry';
  }
  if (parsed.origin !== applicationOrigin) {
    return EXTERNAL_MAP_HOSTS.has(parsed.hostname) ? 'external-map' : 'other';
  }
  if (parsed.pathname.startsWith('/api/systems/')) return 'document-data';
  return parsed.protocol === 'http:' || parsed.protocol === 'https:'
    ? 'first-party-application'
    : 'other';
}
