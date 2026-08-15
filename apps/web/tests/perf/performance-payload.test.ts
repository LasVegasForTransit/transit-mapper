import type { PerformanceSample } from '@transitmapper/core/performance/contract';
import { describe, expect, it, vi } from 'vitest';
import { finalizePerformanceSample, sendPerformanceBody } from '../../src/perf/performance-payload';

function sample(): PerformanceSample {
  return {
    schemaVersion: 1,
    buildId: 'v1.2.3+0123456',
    surface: 'editor',
    phases: {
      documentResponseEndMs: 20,
      shellMountedMs: 30,
      bootstrapCompleteMs: 80,
      storageCompleteMs: 50,
      deserializeCompleteMs: 70,
      systemCommittedMs: 80,
      firstSystemPaintMs: 100,
      interactiveMs: 120,
      networkIdleMs: null,
      serviceWorkerReadyMs: null,
    },
    vitals: { lcpMs: 100, cls: 0.01, inpMs: null },
    bytes: {
      firstPartyAppBytes: 1_000,
      externalMapBytes: null,
      documentDataBytes: 200,
      serviceWorkerBytes: null,
      telemetryBytes: null,
      totalBytes: 1_200,
    },
    cacheState: 'mixed',
    serviceWorkerState: 'controlled',
    deviceTier: 'standard',
    networkTier: 'fast',
    capabilityBits: 127,
  };
}

describe('performance sample payload', () => {
  it('counts its own UTF-8 body until telemetry and total bytes are stable', () => {
    const finalized = finalizePerformanceSample(sample());

    expect(finalized).not.toBeNull();
    if (!finalized) return;
    const actualBytes = new TextEncoder().encode(finalized.body).byteLength;
    expect(finalized.sample.bytes.telemetryBytes).toBe(actualBytes);
    expect(finalized.sample.bytes.totalBytes).toBe(1_200 + actualBytes);
    expect(actualBytes).toBeLessThanOrEqual(8 * 1024);
    expect(JSON.parse(finalized.body)).toEqual(finalized.sample);
  });

  it('refuses a body above the eight KiB ceiling', () => {
    const oversized = sample() as PerformanceSample & { forbidden?: string };
    oversized.forbidden = 'x'.repeat(9_000);

    expect(finalizePerformanceSample(oversized)).toBeNull();
  });

  it('uses a JSON Blob beacon without starting a fallback request when accepted', async () => {
    const body = finalizePerformanceSample(sample())?.body;
    if (!body) throw new Error('Expected a bounded body');
    const sendBeacon = vi.fn<(url: string, data?: BodyInit | null) => boolean>(() => true);
    const fetch = vi.fn();

    await sendPerformanceBody(body, { sendBeacon, fetch });

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [url, blob] = sendBeacon.mock.calls[0];
    expect(url).toBe('/api/performance-samples');
    expect(blob).toBeInstanceOf(Blob);
    expect((blob as Blob).type).toBe('application/json');
    expect(await (blob as Blob).text()).toBe(body);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['false', 'throw'] as const)(
    'falls back to the same-origin keepalive request when beacon returns %s',
    async (behavior) => {
      const body = finalizePerformanceSample(sample())?.body;
      if (!body) throw new Error('Expected a bounded body');
      const sendBeacon = vi.fn(() => {
        if (behavior === 'throw') throw new DOMException('blocked');
        return false;
      });
      const fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));

      await expect(sendPerformanceBody(body, { sendBeacon, fetch })).resolves.toBeUndefined();

      expect(fetch).toHaveBeenCalledWith('/api/performance-samples', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
        credentials: 'omit',
      });
    },
  );

  it('silences fallback network failures', async () => {
    const body = finalizePerformanceSample(sample())?.body;
    if (!body) throw new Error('Expected a bounded body');

    await expect(
      sendPerformanceBody(body, {
        sendBeacon: () => false,
        fetch: () => Promise.reject(new TypeError('offline')),
      }),
    ).resolves.toBeUndefined();
  });
});
