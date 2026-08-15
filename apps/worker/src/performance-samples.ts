import {
  parsePerformanceSample,
  type PerformanceSample,
} from '@transitmapper/core/performance/contract';

const MAX_PERFORMANCE_SAMPLE_BODY_BYTES = 8 * 1024;

export interface PerformanceSampleEnv {
  DB: D1Database;
  SITE_URL: string;
  /** Optional only for local workerd invocations without a client IP. A
   * deployed request with Cloudflare's IP header fails closed if this binding
   * is absent. */
  PERFORMANCE_SAMPLE_LIMITER?: RateLimit;
}

class PerformanceSampleBodyTooLargeError extends Error {}

function noStoreResponse(status = 204): Response {
  return new Response(null, { status, headers: { 'cache-control': 'no-store' } });
}

function privacySignalPresent(request: Request): boolean {
  return request.headers.get('sec-gpc') === '1' || request.headers.get('dnt') === '1';
}

function isSameOriginRequest(request: Request, siteUrl: string): boolean {
  let siteOrigin: string;
  try {
    siteOrigin = new URL(siteUrl).origin;
  } catch {
    return false;
  }
  if (new URL(request.url).origin !== siteOrigin) return false;
  if (request.headers.get('origin') !== siteOrigin) return false;
  const fetchSite = request.headers.get('sec-fetch-site');
  return fetchSite === null || fetchSite === 'same-origin';
}

function isJsonContentType(request: Request): boolean {
  const contentType = request.headers.get('content-type');
  if (!contentType) return false;
  const [mediaType, ...parameters] = contentType
    .split(';')
    .map((part) => part.trim().toLowerCase());
  if (mediaType !== 'application/json') return false;
  return parameters.every((parameter) => parameter === 'charset=utf-8');
}

function hasIdentityContentEncoding(request: Request): boolean {
  const encoding = request.headers.get('content-encoding');
  return encoding === null || encoding.trim().toLowerCase() === 'identity';
}

function declaredBodyLength(request: Request): number | null | undefined {
  const raw = request.headers.get('content-length');
  if (raw === null) return undefined;
  if (!/^\d+$/.test(raw)) return null;
  const length = Number(raw);
  return Number.isSafeInteger(length) ? length : null;
}

async function readBoundedUtf8Body(request: Request): Promise<string> {
  if (!request.body) return '';
  const reader = request.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_PERFORMANCE_SAMPLE_BODY_BYTES) {
        await reader.cancel();
        throw new PerformanceSampleBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
}

async function insertPerformanceSample(
  db: D1Database,
  receivedAt: number,
  sample: PerformanceSample,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO performance_samples (
        received_at, schema_version, build_id, surface,
        document_response_end_ms, shell_mounted_ms, bootstrap_complete_ms,
        storage_complete_ms, deserialize_complete_ms, system_committed_ms,
        first_system_paint_ms, interactive_ms, network_idle_ms,
        service_worker_ready_ms, lcp_ms, cls, inp_ms,
        first_party_app_bytes, external_map_bytes, document_data_bytes,
        service_worker_bytes, telemetry_bytes, total_bytes,
        cache_state, service_worker_state, device_tier, network_tier, capability_bits
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )`,
    )
    .bind(
      receivedAt,
      sample.schemaVersion,
      sample.buildId,
      sample.surface,
      sample.phases.documentResponseEndMs,
      sample.phases.shellMountedMs,
      sample.phases.bootstrapCompleteMs,
      sample.phases.storageCompleteMs,
      sample.phases.deserializeCompleteMs,
      sample.phases.systemCommittedMs,
      sample.phases.firstSystemPaintMs,
      sample.phases.interactiveMs,
      sample.phases.networkIdleMs,
      sample.phases.serviceWorkerReadyMs,
      sample.vitals.lcpMs,
      sample.vitals.cls,
      sample.vitals.inpMs,
      sample.bytes.firstPartyAppBytes,
      sample.bytes.externalMapBytes,
      sample.bytes.documentDataBytes,
      sample.bytes.serviceWorkerBytes,
      sample.bytes.telemetryBytes,
      sample.bytes.totalBytes,
      sample.cacheState,
      sample.serviceWorkerState,
      sample.deviceTier,
      sample.networkTier,
      sample.capabilityBits,
    )
    .run();
}

function rejectRequestShape(request: Request, siteUrl: string): Response | null {
  // Privacy signals win before origin checks, rate limiting or body reads.
  if (privacySignalPresent(request)) return noStoreResponse();
  if (!isSameOriginRequest(request, siteUrl)) return noStoreResponse(403);
  if (!isJsonContentType(request) || !hasIdentityContentEncoding(request)) {
    return noStoreResponse(415);
  }
  return null;
}

async function rejectRateLimit(
  request: Request,
  limiter: RateLimit | undefined,
): Promise<Response | null> {
  const clientIp = request.headers.get('cf-connecting-ip');
  if (!clientIp) return null;
  if (!limiter) {
    console.error('PERFORMANCE_SAMPLE_LIMITER binding missing; refusing telemetry writes');
    return noStoreResponse(503);
  }
  try {
    const { success } = await limiter.limit({ key: clientIp });
    return success ? null : noStoreResponse(429);
  } catch (error) {
    console.error('Performance sample rate limiter failed', error);
    return noStoreResponse(503);
  }
}

function rejectDeclaredLength(request: Request): Response | null {
  const declaredLength = declaredBodyLength(request);
  if (declaredLength === null) return noStoreResponse(400);
  return declaredLength !== undefined && declaredLength > MAX_PERFORMANCE_SAMPLE_BODY_BYTES
    ? noStoreResponse(413)
    : null;
}

/**
 * Accept one bounded, anonymous performance sample. Validation failures are
 * explicit, while storage failures are logged and isolated from the page that
 * is trying to close — telemetry must never become an application outage.
 */
export async function handlePerformanceSample(
  request: Request,
  env: PerformanceSampleEnv,
): Promise<Response> {
  const shapeRejection = rejectRequestShape(request, env.SITE_URL);
  if (shapeRejection) return shapeRejection;
  const rateRejection = await rejectRateLimit(request, env.PERFORMANCE_SAMPLE_LIMITER);
  if (rateRejection) return rateRejection;
  const lengthRejection = rejectDeclaredLength(request);
  if (lengthRejection) return lengthRejection;

  let sample: PerformanceSample | null;
  try {
    sample = parsePerformanceSample(JSON.parse(await readBoundedUtf8Body(request)));
  } catch (error) {
    return noStoreResponse(error instanceof PerformanceSampleBodyTooLargeError ? 413 : 400);
  }
  if (!sample) return noStoreResponse(400);

  try {
    await insertPerformanceSample(env.DB, Date.now(), sample);
  } catch (error) {
    console.error('Performance sample storage failed', error);
  }
  return noStoreResponse();
}
