import {
  PERFORMANCE_CAPABILITY_BITS,
  type PerformanceByteTotals,
  type PerformanceCacheState,
  type PerformanceDeviceTier,
  type PerformanceNetworkTier,
  type PerformancePhaseTimings,
  type PerformanceVitals,
} from '@transitmapper/core/performance/contract';

interface LargestContentfulPaintValue {
  startTime: number;
}

interface LayoutShiftValue {
  startTime: number;
  value: number;
  hadRecentInput: boolean;
}

interface EventTimingValue {
  interactionId: number;
  duration: number;
}

export interface VitalAccumulator {
  addLargestContentfulPaint(entries: readonly LargestContentfulPaintValue[]): void;
  addLayoutShifts(entries: readonly LayoutShiftValue[]): void;
  addEventTimings(entries: readonly EventTimingValue[]): void;
  snapshot(): PerformanceVitals;
}

/** A small native CWV approximation: LCP keeps the last candidate; CLS uses
 * the standardized 1-second-gap/5-second session windows; INP groups Event
 * Timing entries by interaction and selects the p98 interaction (one lower
 * rank for each 50 interactions), matching the web-vitals aggregation rule. */
export function createVitalAccumulator(): VitalAccumulator {
  let lcpMs: number | null = null;
  let cls = 0;
  let clsWindow = 0;
  let clsWindowStart: number | null = null;
  let previousShift = 0;
  const interactions = new Map<number, number>();

  return {
    addLargestContentfulPaint(entries) {
      for (const entry of entries) lcpMs = entry.startTime;
    },
    addLayoutShifts(entries) {
      for (const entry of entries) {
        if (entry.hadRecentInput) continue;
        const continues =
          clsWindowStart !== null &&
          entry.startTime - previousShift < 1_000 &&
          entry.startTime - clsWindowStart < 5_000;
        if (!continues) {
          clsWindow = 0;
          clsWindowStart = entry.startTime;
        }
        clsWindow += entry.value;
        previousShift = entry.startTime;
        cls = Math.max(cls, clsWindow);
      }
    },
    addEventTimings(entries) {
      for (const entry of entries) {
        if (!entry.interactionId) continue;
        interactions.set(
          entry.interactionId,
          Math.max(interactions.get(entry.interactionId) ?? 0, entry.duration),
        );
      }
    },
    snapshot() {
      const durations = [...interactions.values()].sort((left, right) => right - left);
      const inpRank = Math.min(durations.length - 1, Math.floor(durations.length / 50));
      return {
        lcpMs,
        cls: cls > 0 ? cls : null,
        inpMs: durations.length > 0 ? durations[inpRank] : null,
      };
    },
  };
}

interface PhaseInput {
  navigationEntries: readonly { responseEnd: number }[];
  marks: ReadonlyMap<string, number>;
}

export function readPhaseTimings(input: PhaseInput): PerformancePhaseTimings {
  const value = (name: string): number | null => input.marks.get(name) ?? null;
  const systemCommittedMs = value('tm:system-committed');
  return {
    documentResponseEndMs: input.navigationEntries[0]?.responseEnd ?? null,
    shellMountedMs: value('tm:shell-mounted'),
    bootstrapCompleteMs: systemCommittedMs,
    storageCompleteMs: value('tm:storage-read-end'),
    deserializeCompleteMs: value('tm:deserialize-end'),
    systemCommittedMs,
    firstSystemPaintMs: value('tm:first-system-paint'),
    interactiveMs: value('tm:interactive'),
    // Resource Timing cannot prove a quiet window. The controlled performance
    // harness measures it; field samples leave the value honestly absent.
    networkIdleMs: null,
    serviceWorkerReadyMs: value('tm:service-worker-ready'),
  };
}

interface ResourceByteEntry {
  name: string;
  encodedBodySize: number;
  transferSize: number;
}

export interface CategorizedResourceBytes extends Omit<
  PerformanceByteTotals,
  'telemetryBytes' | 'totalBytes'
> {
  observedTotalBytes: number;
  cacheState: PerformanceCacheState;
}

type ByteCategory = keyof Omit<CategorizedResourceBytes, 'observedTotalBytes' | 'cacheState'>;

function byteCategory(url: URL, siteOrigin: string): ByteCategory {
  if (url.origin !== siteOrigin) return 'externalMapBytes';
  if (url.pathname === '/sw.js') return 'serviceWorkerBytes';
  if (url.pathname.startsWith('/api/systems/')) return 'documentDataBytes';
  return 'firstPartyAppBytes';
}

function parsedUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function cacheStateFromCounts(network: number, cached: number): PerformanceCacheState {
  if (network > 0 && cached > 0) return 'mixed';
  if (network > 0) return 'cold';
  if (cached > 0) return 'warm';
  return 'unknown';
}

export function categorizeResourceBytes(
  entries: readonly ResourceByteEntry[],
  siteOrigin: string,
): CategorizedResourceBytes {
  const values: Record<ByteCategory, number | null> = {
    firstPartyAppBytes: 0,
    externalMapBytes: 0,
    documentDataBytes: 0,
    // Page Resource Timing does not see the service worker's own install and
    // precache fetches. A partial script byte count would be misleading.
    serviceWorkerBytes: null,
  };
  let network = 0;
  let cached = 0;
  for (const entry of entries) {
    const url = parsedUrl(entry.name);
    if (!url) continue;
    const category = byteCategory(url, siteOrigin);
    if (url.origin !== siteOrigin && entry.encodedBodySize === 0 && entry.transferSize === 0) {
      values[category] = null;
      continue;
    }
    if (values[category] !== null) values[category] += entry.encodedBodySize;
    if (entry.transferSize > 0) network += 1;
    else if (entry.encodedBodySize > 0) cached += 1;
  }
  const observedTotalBytes = Object.values(values).reduce<number>(
    (total, value) => total + (value ?? 0),
    0,
  );
  const cacheState = cacheStateFromCounts(network, cached);
  return { ...values, observedTotalBytes, cacheState };
}

interface DeviceFacts {
  deviceMemory?: number;
  hardwareConcurrency?: number;
}

export function coarseDeviceTier(facts: DeviceFacts): PerformanceDeviceTier {
  const { deviceMemory, hardwareConcurrency } = facts;
  if (deviceMemory === undefined && hardwareConcurrency === undefined) return 'unknown';
  if ((deviceMemory ?? Infinity) <= 4 || (hardwareConcurrency ?? Infinity) <= 4) return 'low';
  if ((deviceMemory ?? 0) >= 8 && (hardwareConcurrency ?? 0) >= 8) return 'high';
  return 'standard';
}

interface NetworkFacts {
  onLine?: boolean;
  saveData?: boolean;
  effectiveType?: string;
}

export function coarseNetworkTier(facts: NetworkFacts): PerformanceNetworkTier {
  if (facts.onLine === false) return 'offline';
  if (facts.saveData) return 'data-saver';
  if (facts.effectiveType === 'slow-2g' || facts.effectiveType === '2g') return 'slow';
  if (facts.effectiveType === '3g') return 'moderate';
  if (facts.effectiveType === '4g') return 'fast';
  return 'unknown';
}

type CapabilityFacts = Record<keyof typeof PERFORMANCE_CAPABILITY_BITS, boolean>;

export function capabilityBits(facts: CapabilityFacts): number {
  return Object.entries(PERFORMANCE_CAPABILITY_BITS).reduce(
    (bits, [name, mask]) => bits | (facts[name as keyof CapabilityFacts] ? mask : 0),
    0,
  );
}
