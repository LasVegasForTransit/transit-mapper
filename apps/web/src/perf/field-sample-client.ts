import {
  PERFORMANCE_SAMPLE_SCHEMA_VERSION,
  type PerformanceSample,
  type PerformanceServiceWorkerState,
  type PerformanceSurface,
} from '@transitmapper/core/performance/contract';
import {
  capabilityBits,
  categorizeResourceBytes,
  coarseDeviceTier,
  coarseNetworkTier,
  createVitalAccumulator,
  readPhaseTimings,
} from './field-observations';
import { finalizePerformanceSample, sendPerformanceBody } from './performance-payload';

interface ObservationSession {
  snapshot(): PerformanceSample;
  disconnect(): void;
}

interface LifecycleTarget extends EventTarget {
  visibilityState: DocumentVisibilityState;
}

interface FieldSamplingControllerOptions {
  privacySignal(): boolean;
  eligibleBuild(): boolean;
  sampled(): boolean;
  installObservers(surface: PerformanceSurface): ObservationSession;
  lifecycle: LifecycleTarget;
  send(sample: PerformanceSample): void;
}

export function createFieldSamplingController(options: FieldSamplingControllerOptions): {
  start(surface: PerformanceSurface): void;
} {
  let started = false;
  return {
    start(surface) {
      if (started) return;
      started = true;
      // Privacy signals deliberately precede even eligibility and sampling:
      // an opted-out page does not instantiate a PerformanceObserver.
      if (options.privacySignal() || !options.eligibleBuild() || !options.sampled()) return;

      const observations = options.installObservers(surface);
      let sent = false;
      const sendOnce = () => {
        if (sent) return;
        sent = true;
        let snapshot: PerformanceSample | undefined;
        try {
          if (!options.privacySignal()) snapshot = observations.snapshot();
        } catch {
          // Optional evidence must never become a lifecycle error.
        }
        try {
          observations.disconnect();
        } catch {
          // A browser observer teardown failure is non-fatal and cannot block
          // a snapshot that was already drained.
        }
        if (snapshot) {
          try {
            options.send(snapshot);
          } catch {
            // Sending sampled evidence must never become a lifecycle error.
          }
        }
      };
      options.lifecycle.addEventListener('visibilitychange', () => {
        if (options.lifecycle.visibilityState === 'hidden') sendOnce();
      });
      options.lifecycle.addEventListener('pagehide', sendOnce);
      if (options.lifecycle.visibilityState === 'hidden') sendOnce();
    },
  };
}

type PrivacyNavigator = Navigator & {
  globalPrivacyControl?: boolean;
  deviceMemory?: number;
  connection?: { effectiveType?: string; saveData?: boolean };
};

type PrivacyWindow = Window & {
  doNotTrack?: string | null;
};

function privacySignalPresent(): boolean {
  const browserNavigator = navigator as PrivacyNavigator;
  const browserWindow = window as PrivacyWindow;
  return (
    browserNavigator.globalPrivacyControl === true ||
    browserNavigator.doNotTrack === '1' ||
    browserWindow.doNotTrack === '1'
  );
}

function observe(
  type: string,
  process: (entries: PerformanceEntry[]) => void,
  observers: Array<{ observer: PerformanceObserver; process: typeof process }>,
  options: PerformanceObserverInit = { type, buffered: true },
): void {
  if (!('PerformanceObserver' in globalThis)) return;
  if (!PerformanceObserver.supportedEntryTypes.includes(type)) return;
  try {
    const observer = new PerformanceObserver((list) => process(list.getEntries()));
    observer.observe(options);
    observers.push({ observer, process });
  } catch {
    // Optional observation differs across browsers and permissions. A missing
    // vital stays null; it does not weaken any other category or the page.
  }
}

function initialServiceWorkerState(): PerformanceServiceWorkerState {
  if (!('serviceWorker' in navigator)) return 'unsupported';
  return navigator.serviceWorker.controller ? 'controlled' : 'unregistered';
}

function registrationState(registration: ServiceWorkerRegistration): PerformanceServiceWorkerState {
  if (navigator.serviceWorker.controller) return 'controlled';
  if (registration.installing) return 'installing';
  if (registration.waiting) return 'waiting';
  return registration.active ? 'active-uncontrolled' : 'unregistered';
}

function detectCapabilityBits(): number {
  const browserWindow = window as PrivacyWindow;
  const navigationPrototype =
    'PerformanceNavigationTiming' in globalThis
      ? (PerformanceNavigationTiming.prototype as PerformanceNavigationTiming & {
          notRestoredReasons?: unknown;
        })
      : undefined;
  let webGl2 = false;
  try {
    webGl2 = document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    // Capability detection is best-effort and remains one fixed boolean bit.
  }
  return capabilityBits({
    serviceWorkerAndCacheStorage: 'serviceWorker' in navigator && 'caches' in window,
    compressionStreams: 'CompressionStream' in window && 'DecompressionStream' in window,
    originPrivateFileSystem:
      'storage' in navigator &&
      'getDirectory' in navigator.storage &&
      typeof navigator.storage.getDirectory === 'function',
    prioritizedTaskScheduling:
      'scheduler' in browserWindow && typeof browserWindow.scheduler.postTask === 'function',
    offscreenCanvasAndImageBitmap: 'OffscreenCanvas' in window && 'createImageBitmap' in window,
    webGl2,
    popoverAndAnchorPositioning:
      'showPopover' in HTMLElement.prototype &&
      typeof CSS !== 'undefined' &&
      CSS.supports('anchor-name: --tm-anchor'),
    bfcacheDiagnostics: !!navigationPrototype && 'notRestoredReasons' in navigationPrototype,
  });
}

function markMap(): Map<string, number> {
  return new Map(
    performance
      .getEntriesByType('mark')
      .filter((entry) => entry.name.startsWith('tm:'))
      .map((entry) => [entry.name, entry.startTime]),
  );
}

function resourceEntries(siteOrigin: string): Array<{
  name: string;
  encodedBodySize: number;
  transferSize: number;
}> {
  const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  const navigation = performance.getEntriesByType('navigation')[0] as
    PerformanceNavigationTiming | undefined;
  return [
    ...(navigation
      ? [
          {
            // The document pathname can contain a share id. A synthetic
            // first-party URL gives the categorizer only the origin it needs.
            name: `${siteOrigin}/`,
            encodedBodySize: navigation.encodedBodySize,
            transferSize: navigation.transferSize,
          },
        ]
      : []),
    ...resources.map((entry) => ({
      name: entry.name,
      encodedBodySize: entry.encodedBodySize,
      transferSize: entry.transferSize,
    })),
  ];
}

function installBrowserObservers(
  surface: PerformanceSurface,
  build: string,
  siteOrigin: string,
): ObservationSession {
  const vitals = createVitalAccumulator();
  const observers: Array<{
    observer: PerformanceObserver;
    process: (entries: PerformanceEntry[]) => void;
  }> = [];
  observe(
    'largest-contentful-paint',
    (entries) => vitals.addLargestContentfulPaint(entries),
    observers,
  );
  observe('layout-shift', (entries) => vitals.addLayoutShifts(entries as never[]), observers);
  observe('event', (entries) => vitals.addEventTimings(entries as never[]), observers, {
    type: 'event',
    buffered: true,
    durationThreshold: 40,
  } as PerformanceObserverInit);

  let serviceWorkerState = initialServiceWorkerState();
  if ('serviceWorker' in navigator && !navigator.serviceWorker.controller) {
    void navigator.serviceWorker
      .getRegistration()
      .then((registration) => {
        if (registration) serviceWorkerState = registrationState(registration);
      })
      .catch(() => undefined);
  }

  return {
    disconnect() {
      for (const { observer } of observers) observer.disconnect();
    },
    snapshot() {
      for (const { observer, process } of observers) process(observer.takeRecords());
      const bytes = categorizeResourceBytes(resourceEntries(siteOrigin), siteOrigin);
      const browserNavigator = navigator as PrivacyNavigator;
      return {
        schemaVersion: PERFORMANCE_SAMPLE_SCHEMA_VERSION,
        buildId: build,
        surface,
        phases: readPhaseTimings({
          navigationEntries: performance.getEntriesByType(
            'navigation',
          ) as PerformanceNavigationTiming[],
          marks: markMap(),
        }),
        vitals: vitals.snapshot(),
        bytes: {
          firstPartyAppBytes: bytes.firstPartyAppBytes,
          externalMapBytes: bytes.externalMapBytes,
          documentDataBytes: bytes.documentDataBytes,
          serviceWorkerBytes: bytes.serviceWorkerBytes,
          telemetryBytes: null,
          totalBytes: bytes.observedTotalBytes,
        },
        cacheState: bytes.cacheState,
        serviceWorkerState,
        deviceTier: coarseDeviceTier({
          deviceMemory: browserNavigator.deviceMemory,
          hardwareConcurrency: browserNavigator.hardwareConcurrency,
        }),
        networkTier: coarseNetworkTier({
          onLine: browserNavigator.onLine,
          saveData: browserNavigator.connection?.saveData,
          effectiveType: browserNavigator.connection?.effectiveType,
        }),
        capabilityBits: detectCapabilityBits(),
      };
    },
  };
}

let browserController: ReturnType<typeof createFieldSamplingController> | null = null;

function fieldSamplingController(
  buildId: string,
  siteOrigin: string,
): ReturnType<typeof createFieldSamplingController> {
  browserController ??= createFieldSamplingController({
    privacySignal: privacySignalPresent,
    eligibleBuild: () => true,
    sampled: () => true,
    installObservers: (surface) => installBrowserObservers(surface, buildId, siteOrigin),
    lifecycle: document,
    send: (sample) => {
      const finalized = finalizePerformanceSample(sample);
      if (finalized) {
        void sendPerformanceBody(finalized.body, {
          sendBeacon: (url, data) => navigator.sendBeacon(url, data),
          fetch: globalThis.fetch.bind(globalThis),
        });
      }
    },
  });
  return browserController;
}

export function startFieldSampleClient(
  surface: PerformanceSurface,
  buildId: string,
  siteOrigin: string,
): void {
  fieldSamplingController(buildId, siteOrigin).start(surface);
}
