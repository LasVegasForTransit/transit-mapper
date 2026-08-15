import { describe, expect, it } from 'vitest';
import {
  capabilityBits,
  categorizeResourceBytes,
  coarseDeviceTier,
  coarseNetworkTier,
  createVitalAccumulator,
  readPhaseTimings,
} from '../../src/perf/field-observations';

describe('field performance observations', () => {
  it('uses the last LCP, maximum CLS session window, and p98 interaction duration', () => {
    const vitals = createVitalAccumulator();
    vitals.addLargestContentfulPaint([{ startTime: 320 }, { startTime: 470 }]);
    vitals.addLayoutShifts([
      { startTime: 100, value: 0.1, hadRecentInput: false },
      { startTime: 900, value: 0.2, hadRecentInput: false },
      { startTime: 2_100, value: 0.8, hadRecentInput: false },
      { startTime: 2_200, value: 4, hadRecentInput: true },
    ]);
    vitals.addEventTimings(
      Array.from({ length: 50 }, (_, index) => ({
        interactionId: index + 1,
        duration: index === 0 ? 500 : index === 1 ? 400 : 50,
      })),
    );

    expect(vitals.snapshot()).toEqual({ lcpMs: 470, cls: 0.8, inpMs: 400 });
  });

  it('keeps a CLS session window that begins at navigation time zero', () => {
    const vitals = createVitalAccumulator();
    vitals.addLayoutShifts([
      { startTime: 0, value: 0.1, hadRecentInput: false },
      { startTime: 500, value: 0.2, hadRecentInput: false },
    ]);

    expect(vitals.snapshot().cls).toBeCloseTo(0.3);
  });

  it('keeps unavailable phases and vitals null instead of inventing zeroes', () => {
    expect(
      readPhaseTimings({
        navigationEntries: [],
        marks: new Map(),
      }),
    ).toEqual({
      documentResponseEndMs: null,
      shellMountedMs: null,
      bootstrapCompleteMs: null,
      storageCompleteMs: null,
      deserializeCompleteMs: null,
      systemCommittedMs: null,
      firstSystemPaintMs: null,
      interactiveMs: null,
      networkIdleMs: null,
      serviceWorkerReadyMs: null,
    });
    expect(createVitalAccumulator().snapshot()).toEqual({ lcpMs: null, cls: null, inpMs: null });
  });

  it('maps tm marks to the exact wire phases', () => {
    expect(
      readPhaseTimings({
        navigationEntries: [{ responseEnd: 18 }],
        marks: new Map([
          ['tm:shell-mounted', 25],
          ['tm:storage-read-end', 42],
          ['tm:deserialize-end', 50],
          ['tm:system-committed', 55],
          ['tm:first-system-paint', 90],
          ['tm:interactive', 110],
          ['tm:service-worker-ready', 140],
        ]),
      }),
    ).toEqual({
      documentResponseEndMs: 18,
      shellMountedMs: 25,
      bootstrapCompleteMs: 55,
      storageCompleteMs: 42,
      deserializeCompleteMs: 50,
      systemCommittedMs: 55,
      firstSystemPaintMs: 90,
      interactiveMs: 110,
      networkIdleMs: null,
      serviceWorkerReadyMs: 140,
    });
  });

  it('aggregates only URL categories and never returns an individual URL', () => {
    const result = categorizeResourceBytes(
      [
        { name: 'https://map.example/assets/main.js', encodedBodySize: 1_000, transferSize: 1_100 },
        {
          name: 'https://tiles.example/planet.pmtiles',
          encodedBodySize: 2_000,
          transferSize: 2_100,
        },
        {
          name: 'https://map.example/api/systems/private-share-id',
          encodedBodySize: 300,
          transferSize: 400,
        },
        { name: 'https://map.example/sw.js', encodedBodySize: 200, transferSize: 300 },
      ],
      'https://map.example',
    );

    expect(result).toEqual({
      firstPartyAppBytes: 1_000,
      externalMapBytes: 2_000,
      documentDataBytes: 300,
      serviceWorkerBytes: null,
      observedTotalBytes: 3_300,
      cacheState: 'cold',
    });
    expect(JSON.stringify(result)).not.toContain('private-share-id');
    expect(JSON.stringify(result)).not.toContain('https://');
  });

  it('reports mixed cache evidence and opaque cross-origin bytes as unavailable', () => {
    expect(
      categorizeResourceBytes(
        [
          { name: 'https://map.example/assets/main.js', encodedBodySize: 100, transferSize: 0 },
          { name: 'https://tiles.example/style.json', encodedBodySize: 0, transferSize: 0 },
          { name: 'https://map.example/favicon.svg', encodedBodySize: 20, transferSize: 30 },
        ],
        'https://map.example',
      ),
    ).toEqual({
      firstPartyAppBytes: 120,
      externalMapBytes: null,
      documentDataBytes: 0,
      serviceWorkerBytes: null,
      observedTotalBytes: 120,
      cacheState: 'mixed',
    });
  });

  it('uses coarse device and network tiers only', () => {
    expect(coarseDeviceTier({ deviceMemory: 2, hardwareConcurrency: 8 })).toBe('low');
    expect(coarseDeviceTier({ deviceMemory: 8, hardwareConcurrency: 8 })).toBe('high');
    expect(coarseDeviceTier({ deviceMemory: 8, hardwareConcurrency: 6 })).toBe('standard');
    expect(coarseDeviceTier({})).toBe('unknown');

    expect(coarseNetworkTier({ onLine: false })).toBe('offline');
    expect(coarseNetworkTier({ onLine: true, saveData: true, effectiveType: '4g' })).toBe(
      'data-saver',
    );
    expect(coarseNetworkTier({ onLine: true, effectiveType: '2g' })).toBe('slow');
    expect(coarseNetworkTier({ onLine: true, effectiveType: '3g' })).toBe('moderate');
    expect(coarseNetworkTier({ onLine: true, effectiveType: '4g' })).toBe('fast');
  });

  it('packs the fixed eight capability checks into one byte', () => {
    expect(
      capabilityBits({
        serviceWorkerAndCacheStorage: true,
        compressionStreams: false,
        originPrivateFileSystem: true,
        prioritizedTaskScheduling: false,
        offscreenCanvasAndImageBitmap: true,
        webGl2: false,
        popoverAndAnchorPositioning: true,
        bfcacheDiagnostics: true,
      }),
    ).toBe(0b11010101);
  });
});
