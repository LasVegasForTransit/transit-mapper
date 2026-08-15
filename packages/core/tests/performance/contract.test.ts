import { describe, expect, it } from 'vitest';
import {
  PERFORMANCE_CAPABILITY_BITS,
  parsePerformanceSample,
  type PerformanceSample,
} from '../../src/performance/contract';

const VALID_SAMPLE: PerformanceSample = {
  schemaVersion: 1,
  buildId: '2026.08.13+2157fe8',
  surface: 'editor',
  phases: {
    documentResponseEndMs: 42.5,
    shellMountedMs: 65,
    bootstrapCompleteMs: 80,
    storageCompleteMs: 95,
    deserializeCompleteMs: null,
    systemCommittedMs: 101,
    firstSystemPaintMs: 325,
    interactiveMs: 340,
    networkIdleMs: 760,
    serviceWorkerReadyMs: null,
  },
  vitals: { lcpMs: 325, cls: 0.01, inpMs: null },
  bytes: {
    firstPartyAppBytes: 430_000,
    externalMapBytes: 120_000,
    documentDataBytes: 0,
    serviceWorkerBytes: 25_000,
    telemetryBytes: 900,
    totalBytes: 575_900,
  },
  cacheState: 'cold',
  serviceWorkerState: 'installing',
  deviceTier: 'standard',
  networkTier: 'fast',
  capabilityBits: 0b1010_1010,
};

describe('performance sample contract', () => {
  it('keeps the version-one capability registry fixed to bits zero through seven', () => {
    expect(Object.values(PERFORMANCE_CAPABILITY_BITS)).toEqual([1, 2, 4, 8, 16, 32, 64, 128]);
  });

  it('accepts exactly the versioned anonymous performance fields', () => {
    expect(parsePerformanceSample(VALID_SAMPLE)).toEqual(VALID_SAMPLE);
  });

  it.each([
    ['a top-level URL', { ...VALID_SAMPLE, url: 'https://example.com/s/private' }],
    ['a document id', { ...VALID_SAMPLE, documentId: 'private-document' }],
    ['a raw user agent', { ...VALID_SAMPLE, userAgent: 'Mozilla/5.0' }],
    ['raw input', { ...VALID_SAMPLE, input: 'a private station name' }],
    [
      'nested coordinates',
      { ...VALID_SAMPLE, phases: { ...VALID_SAMPLE.phases, coordinates: [36.1, -115.2] } },
    ],
    [
      'an extra byte category',
      { ...VALID_SAMPLE, bytes: { ...VALID_SAMPLE.bytes, shareId: 'private-share' } },
    ],
  ])('rejects %s rather than silently dropping it', (_name, sample) => {
    expect(parsePerformanceSample(sample)).toBeNull();
  });

  it.each([
    ['a missing required section', { ...VALID_SAMPLE, phases: undefined }],
    ['an unsupported schema version', { ...VALID_SAMPLE, schemaVersion: 2 }],
    ['an empty build id', { ...VALID_SAMPLE, buildId: '' }],
    ['a path-shaped build id', { ...VALID_SAMPLE, buildId: '../../release' }],
    ['an unknown surface', { ...VALID_SAMPLE, surface: 'admin' }],
    [
      'a negative phase',
      { ...VALID_SAMPLE, phases: { ...VALID_SAMPLE.phases, shellMountedMs: -1 } },
    ],
    [
      'an infinite phase',
      { ...VALID_SAMPLE, phases: { ...VALID_SAMPLE.phases, shellMountedMs: Infinity } },
    ],
    [
      'an implausible layout shift',
      { ...VALID_SAMPLE, vitals: { ...VALID_SAMPLE.vitals, cls: 11 } },
    ],
    [
      'a fractional byte count',
      { ...VALID_SAMPLE, bytes: { ...VALID_SAMPLE.bytes, totalBytes: 10.5 } },
    ],
    [
      'an implausibly large byte count',
      { ...VALID_SAMPLE, bytes: { ...VALID_SAMPLE.bytes, totalBytes: 1_000_000_001 } },
    ],
    [
      'byte categories larger than the total',
      { ...VALID_SAMPLE, bytes: { ...VALID_SAMPLE.bytes, totalBytes: 100 } },
    ],
    ['an unknown cache state', { ...VALID_SAMPLE, cacheState: 'maybe-warm' }],
    ['an out-of-range capability bitset', { ...VALID_SAMPLE, capabilityBits: 256 }],
  ])('rejects %s', (_name, sample) => {
    expect(parsePerformanceSample(sample)).toBeNull();
  });

  it('accepts unobservable byte categories as null without inventing values', () => {
    const sample = {
      ...VALID_SAMPLE,
      bytes: { ...VALID_SAMPLE.bytes, externalMapBytes: null },
    };

    expect(parsePerformanceSample(sample)).toEqual(sample);
  });
});
