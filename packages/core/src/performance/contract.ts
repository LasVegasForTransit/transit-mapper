/**
 * Privacy-preserving wire contract for first-party real-user performance
 * samples. Both the browser and Worker import this module so the fields the
 * client can send are exactly the fields the server can store.
 *
 * This parser is deliberately recursive and deny-by-default. Adding a field
 * requires changing the public contract, its storage schema and the privacy
 * policy together; unknown fields are never silently discarded at the trust
 * boundary.
 */

export const PERFORMANCE_SAMPLE_SCHEMA_VERSION = 1 as const;
export const MAX_PERFORMANCE_SAMPLE_PHASE_MS = 600_000;
export const MAX_PERFORMANCE_SAMPLE_CLS = 10;
export const MAX_PERFORMANCE_SAMPLE_BYTES = 1_000_000_000;

export const PERFORMANCE_SURFACES = ['editor', 'share', 'embed'] as const;
export type PerformanceSurface = (typeof PERFORMANCE_SURFACES)[number];

export const PERFORMANCE_CACHE_STATES = ['cold', 'warm', 'mixed', 'unknown'] as const;
export type PerformanceCacheState = (typeof PERFORMANCE_CACHE_STATES)[number];

export const PERFORMANCE_SERVICE_WORKER_STATES = [
  'unsupported',
  'unregistered',
  'installing',
  'waiting',
  'active-uncontrolled',
  'controlled',
] as const;
export type PerformanceServiceWorkerState = (typeof PERFORMANCE_SERVICE_WORKER_STATES)[number];

export const PERFORMANCE_DEVICE_TIERS = ['unknown', 'low', 'standard', 'high'] as const;
export type PerformanceDeviceTier = (typeof PERFORMANCE_DEVICE_TIERS)[number];

export const PERFORMANCE_NETWORK_TIERS = [
  'unknown',
  'offline',
  'data-saver',
  'slow',
  'moderate',
  'fast',
] as const;
export type PerformanceNetworkTier = (typeof PERFORMANCE_NETWORK_TIERS)[number];

export interface PerformancePhaseTimings {
  documentResponseEndMs: number | null;
  shellMountedMs: number | null;
  bootstrapCompleteMs: number | null;
  storageCompleteMs: number | null;
  deserializeCompleteMs: number | null;
  systemCommittedMs: number | null;
  firstSystemPaintMs: number | null;
  interactiveMs: number | null;
  networkIdleMs: number | null;
  serviceWorkerReadyMs: number | null;
}

export interface PerformanceVitals {
  lcpMs: number | null;
  cls: number | null;
  inpMs: number | null;
}

export interface PerformanceByteTotals {
  firstPartyAppBytes: number | null;
  externalMapBytes: number | null;
  documentDataBytes: number | null;
  serviceWorkerBytes: number | null;
  telemetryBytes: number | null;
  totalBytes: number;
}

/**
 * Stable v1 capability registry. Bits describe support, never browser brand:
 *
 * - 0: Service Worker and Cache Storage
 * - 1: Compression and Decompression Streams
 * - 2: origin private file system
 * - 3: Prioritized Task Scheduling
 * - 4: OffscreenCanvas and createImageBitmap
 * - 5: WebGL 2
 * - 6: Popover API and CSS anchor positioning
 * - 7: BFCache diagnostics
 */
export const PERFORMANCE_CAPABILITY_BITS = {
  serviceWorkerAndCacheStorage: 1 << 0,
  compressionStreams: 1 << 1,
  originPrivateFileSystem: 1 << 2,
  prioritizedTaskScheduling: 1 << 3,
  offscreenCanvasAndImageBitmap: 1 << 4,
  webGl2: 1 << 5,
  popoverAndAnchorPositioning: 1 << 6,
  bfcacheDiagnostics: 1 << 7,
} as const;

export interface PerformanceSample {
  schemaVersion: typeof PERFORMANCE_SAMPLE_SCHEMA_VERSION;
  buildId: string;
  surface: PerformanceSurface;
  phases: PerformancePhaseTimings;
  vitals: PerformanceVitals;
  bytes: PerformanceByteTotals;
  cacheState: PerformanceCacheState;
  serviceWorkerState: PerformanceServiceWorkerState;
  deviceTier: PerformanceDeviceTier;
  networkTier: PerformanceNetworkTier;
  /** Fixed anonymous capability bitset; never a raw user-agent string. */
  capabilityBits: number;
}

const SAMPLE_KEYS = [
  'schemaVersion',
  'buildId',
  'surface',
  'phases',
  'vitals',
  'bytes',
  'cacheState',
  'serviceWorkerState',
  'deviceTier',
  'networkTier',
  'capabilityBits',
] as const;

const PHASE_KEYS = [
  'documentResponseEndMs',
  'shellMountedMs',
  'bootstrapCompleteMs',
  'storageCompleteMs',
  'deserializeCompleteMs',
  'systemCommittedMs',
  'firstSystemPaintMs',
  'interactiveMs',
  'networkIdleMs',
  'serviceWorkerReadyMs',
] as const;

const VITAL_KEYS = ['lcpMs', 'cls', 'inpMs'] as const;

const BYTE_KEYS = [
  'firstPartyAppBytes',
  'externalMapBytes',
  'documentDataBytes',
  'serviceWorkerBytes',
  'telemetryBytes',
  'totalBytes',
] as const;

const BUILD_ID_PATTERN = /^[A-Za-z0-9._+-]{1,80}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function isEnumValue<Value extends string>(
  value: unknown,
  allowed: readonly Value[],
): value is Value {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function isNullableBoundedNumber(value: unknown, maximum: number): value is number | null {
  return (
    value === null ||
    (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum)
  );
}

function isByteCount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_PERFORMANCE_SAMPLE_BYTES
  );
}

function isNullableByteCount(value: unknown): value is number | null {
  return value === null || isByteCount(value);
}

function parsePhases(value: unknown): PerformancePhaseTimings | null {
  if (!isRecord(value) || !hasExactKeys(value, PHASE_KEYS)) return null;
  if (
    PHASE_KEYS.some((key) => !isNullableBoundedNumber(value[key], MAX_PERFORMANCE_SAMPLE_PHASE_MS))
  ) {
    return null;
  }
  return {
    documentResponseEndMs: value.documentResponseEndMs as number | null,
    shellMountedMs: value.shellMountedMs as number | null,
    bootstrapCompleteMs: value.bootstrapCompleteMs as number | null,
    storageCompleteMs: value.storageCompleteMs as number | null,
    deserializeCompleteMs: value.deserializeCompleteMs as number | null,
    systemCommittedMs: value.systemCommittedMs as number | null,
    firstSystemPaintMs: value.firstSystemPaintMs as number | null,
    interactiveMs: value.interactiveMs as number | null,
    networkIdleMs: value.networkIdleMs as number | null,
    serviceWorkerReadyMs: value.serviceWorkerReadyMs as number | null,
  };
}

function parseVitals(value: unknown): PerformanceVitals | null {
  if (!isRecord(value) || !hasExactKeys(value, VITAL_KEYS)) return null;
  if (
    !isNullableBoundedNumber(value.lcpMs, MAX_PERFORMANCE_SAMPLE_PHASE_MS) ||
    !isNullableBoundedNumber(value.cls, MAX_PERFORMANCE_SAMPLE_CLS) ||
    !isNullableBoundedNumber(value.inpMs, MAX_PERFORMANCE_SAMPLE_PHASE_MS)
  ) {
    return null;
  }
  return { lcpMs: value.lcpMs, cls: value.cls, inpMs: value.inpMs };
}

function parseBytes(value: unknown): PerformanceByteTotals | null {
  if (!isRecord(value) || !hasExactKeys(value, BYTE_KEYS)) return null;
  if (
    !isNullableByteCount(value.firstPartyAppBytes) ||
    !isNullableByteCount(value.externalMapBytes) ||
    !isNullableByteCount(value.documentDataBytes) ||
    !isNullableByteCount(value.serviceWorkerBytes) ||
    !isNullableByteCount(value.telemetryBytes) ||
    !isByteCount(value.totalBytes)
  ) {
    return null;
  }
  const categories = [
    value.firstPartyAppBytes,
    value.externalMapBytes,
    value.documentDataBytes,
    value.serviceWorkerBytes,
    value.telemetryBytes,
  ];
  const observedTotal = categories.reduce<number>((total, category) => total + (category ?? 0), 0);
  if (
    observedTotal > value.totalBytes ||
    (categories.every((category) => category !== null) && observedTotal !== value.totalBytes)
  ) {
    return null;
  }
  return {
    firstPartyAppBytes: value.firstPartyAppBytes,
    externalMapBytes: value.externalMapBytes,
    documentDataBytes: value.documentDataBytes,
    serviceWorkerBytes: value.serviceWorkerBytes,
    telemetryBytes: value.telemetryBytes,
    totalBytes: value.totalBytes,
  };
}

interface PerformanceSampleMetadata {
  buildId: string;
  surface: PerformanceSurface;
  cacheState: PerformanceCacheState;
  serviceWorkerState: PerformanceServiceWorkerState;
  deviceTier: PerformanceDeviceTier;
  networkTier: PerformanceNetworkTier;
  capabilityBits: number;
}

function isCapabilityBits(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xff;
}

function parseMetadata(value: Record<string, unknown>): PerformanceSampleMetadata | null {
  if (
    value.schemaVersion !== PERFORMANCE_SAMPLE_SCHEMA_VERSION ||
    typeof value.buildId !== 'string' ||
    !BUILD_ID_PATTERN.test(value.buildId) ||
    !isEnumValue(value.surface, PERFORMANCE_SURFACES) ||
    !isEnumValue(value.cacheState, PERFORMANCE_CACHE_STATES) ||
    !isEnumValue(value.serviceWorkerState, PERFORMANCE_SERVICE_WORKER_STATES) ||
    !isEnumValue(value.deviceTier, PERFORMANCE_DEVICE_TIERS) ||
    !isEnumValue(value.networkTier, PERFORMANCE_NETWORK_TIERS) ||
    !isCapabilityBits(value.capabilityBits)
  ) {
    return null;
  }
  return {
    buildId: value.buildId,
    surface: value.surface,
    cacheState: value.cacheState,
    serviceWorkerState: value.serviceWorkerState,
    deviceTier: value.deviceTier,
    networkTier: value.networkTier,
    capabilityBits: value.capabilityBits,
  };
}

/** Parse a sample into a fresh allowlisted object, or reject it completely. */
export function parsePerformanceSample(value: unknown): PerformanceSample | null {
  if (!isRecord(value) || !hasExactKeys(value, SAMPLE_KEYS)) return null;

  const metadata = parseMetadata(value);
  const phases = parsePhases(value.phases);
  const vitals = parseVitals(value.vitals);
  const bytes = parseBytes(value.bytes);
  if (!metadata || !phases || !vitals || !bytes) return null;

  return {
    schemaVersion: PERFORMANCE_SAMPLE_SCHEMA_VERSION,
    buildId: metadata.buildId,
    surface: metadata.surface,
    phases,
    vitals,
    bytes,
    cacheState: metadata.cacheState,
    serviceWorkerState: metadata.serviceWorkerState,
    deviceTier: metadata.deviceTier,
    networkTier: metadata.networkTier,
    capabilityBits: metadata.capabilityBits,
  };
}
