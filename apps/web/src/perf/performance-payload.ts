import type { PerformanceSample } from '@transitmapper/core/performance/contract';

const MAX_FIELD_SAMPLE_BODY_BYTES = 8 * 1024;

interface FinalizedPerformanceSample {
  sample: PerformanceSample;
  body: string;
}

/** telemetryBytes counts the body that contains telemetryBytes. Re-encode
 * until that recursive decimal value and totalBytes no longer change. */
export function finalizePerformanceSample(
  source: PerformanceSample,
): FinalizedPerformanceSample | null {
  const baseTotal = source.bytes.totalBytes - (source.bytes.telemetryBytes ?? 0);
  const sample = structuredClone(source);
  let previous = -1;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    sample.bytes.telemetryBytes = Math.max(previous, 0);
    sample.bytes.totalBytes = baseTotal + sample.bytes.telemetryBytes;
    const body = JSON.stringify(sample);
    const size = new TextEncoder().encode(body).byteLength;
    if (size > MAX_FIELD_SAMPLE_BODY_BYTES) return null;
    if (size === previous) return { sample, body };
    previous = size;
  }
  return null;
}

interface PerformanceTransport {
  sendBeacon(dataUrl: string, data?: BodyInit | null): boolean;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<unknown>;
}

export async function sendPerformanceBody(
  body: string,
  transport: PerformanceTransport,
): Promise<void> {
  try {
    if (
      transport.sendBeacon(
        '/api/performance-samples',
        new Blob([body], { type: 'application/json' }),
      )
    ) {
      return;
    }
  } catch {
    // A false return and an exception both mean the user agent did not queue
    // the beacon. The bounded keepalive request is the only fallback.
  }
  try {
    await transport.fetch('/api/performance-samples', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
      credentials: 'omit',
    });
  } catch {
    // Field evidence is optional and must never surface an unload failure.
  }
}
