import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Browser, BrowserContext, CDPSession, Page } from 'playwright-core';
import { summarizeDisplayCadence } from '../../src/perf/calibration';
import { classifyPersistence } from '../../src/perf/persistencePolicy';
import { FIRST_SYSTEM_MAP_PAINT_MARK } from '../../src/perf/mapPaintMark';
import type {
  PerfCalibration,
  PerfMemorySnapshot,
  PerfMetricValues,
  PerfNetworkSnapshot,
  PerfPersistenceProbe,
  PerfProtocol,
  PerfScenario,
} from '../../src/perf/types';
import {
  type BrowserMetricState,
  type BrowserProductionPersistenceCycle,
  type BrowserProductionPersistenceState,
  type PerfPageWindow,
  PERF_STORAGE_CONTRACT,
} from './browserContract';
import { createEncodedJsonResponses, selectEncodedJsonResponse } from './compressedJsonResponse';
import { APP_ROOT } from './process';

const DISPLAY_CADENCE_SAMPLE_COUNT = 60;

interface LayoutShiftEntry extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
}

interface TraceCompleteEvent {
  stream: string;
}

interface TraceReadResult {
  data: string;
  base64Encoded?: boolean;
  eof?: boolean;
}

interface CdpPerformanceMetric {
  name: string;
  value: number;
}

interface CdpPerformanceResult {
  metrics: CdpPerformanceMetric[];
}

export interface BrowserStartupSnapshot {
  metrics: Pick<
    PerfMetricValues,
    | 'loadMs'
    | 'firstContentfulPaintMs'
    | 'largestContentfulPaintMs'
    | 'firstMapCanvasMs'
    | 'cumulativeLayoutShift'
    | 'longTaskTotalMs'
    | 'transferBytes'
  >;
  network: PerfNetworkSnapshot;
}

export interface PerfFixtureSeed {
  id: string;
  name: string;
  updatedAt: number;
}

export async function configureProtocol(
  session: CDPSession,
  protocol: PerfProtocol,
): Promise<void> {
  await session.send('Network.enable');
  await session.send('Performance.enable');
  await session.send('Network.clearBrowserCache');
  // A cleared cache makes the first navigation cold while leaving the
  // response eligible to populate Chrome's HTTP cache for the warm reload.
  await session.send('Network.setCacheDisabled', { cacheDisabled: false });
  await session.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: protocol.network.latencyMs,
    downloadThroughput: protocol.network.downloadThroughputBytesPerSecond,
    uploadThroughput: protocol.network.uploadThroughputBytesPerSecond,
    connectionType: 'cellular4g',
  });
  await session.send('Emulation.setCPUThrottlingRate', {
    rate: protocol.cpuThrottlingRate,
  });
}

export async function measureCompatibilityPersistenceDiagnostic(
  page: Page,
  session: CDPSession,
  previewUrl: string,
  serializedSystem: string,
): Promise<PerfPersistenceProbe> {
  // This measures the legacy compatibility boundary. The real save lane is
  // measured from the editor gesture itself.
  await page.goto(`${previewUrl}/favicon.svg`, {
    waitUntil: 'load',
    timeout: 60_000,
  });
  const measured = await page.evaluate(
    ({ serialized, probeKey }) => {
      const parseStartedAt = performance.now();
      const parsed = JSON.parse(serialized) as unknown;
      const parseMs = performance.now() - parseStartedAt;
      const serializationStartedAt = performance.now();
      const output = JSON.stringify(parsed);
      const serializationMs = performance.now() - serializationStartedAt;
      const writeStartedAt = performance.now();
      let localStorageWriteOutcome: 'stored' | 'quota-exceeded' | 'unavailable' = 'stored';
      try {
        localStorage.setItem(probeKey, output);
        localStorage.removeItem(probeKey);
      } catch (error) {
        localStorageWriteOutcome =
          error instanceof DOMException && error.name === 'QuotaExceededError'
            ? 'quota-exceeded'
            : 'unavailable';
      }
      return {
        serializedBytes: new TextEncoder().encode(output).byteLength,
        parseMs,
        serializationMs,
        localStorageWriteMs: performance.now() - writeStartedAt,
        localStorageWriteOutcome,
      };
    },
    {
      serialized: serializedSystem,
      probeKey: PERF_STORAGE_CONTRACT.compatibilityProbeKey,
    },
  );
  await session.send('Network.clearBrowserCache');
  return classifyPersistence(measured);
}

async function deletePerformanceDatabase(page: Page): Promise<void> {
  await page.evaluate(
    (databaseName) =>
      new Promise<void>((resolvePromise, reject) => {
        const request = indexedDB.deleteDatabase(databaseName);
        request.onsuccess = () => resolvePromise();
        request.onerror = () => reject(request.error);
        request.onblocked = () =>
          reject(new DOMException('Performance database reset was blocked.', 'InvalidStateError'));
      }),
    PERF_STORAGE_CONTRACT.databaseName,
  );
}

export async function seedIndexedDbFixture(
  page: Page,
  serializedSystem: string,
  fixture: PerfFixtureSeed,
): Promise<void> {
  await deletePerformanceDatabase(page);
  await page.evaluate(
    async ({ seed, storage }) => {
      localStorage.clear();
      localStorage.setItem(storage.activeIdKey, seed.id);
      localStorage.setItem(storage.onboardingSeenKey, '1');
      localStorage.setItem(storage.indexedDbHistoryKey, '1');
      const database = await new Promise<IDBDatabase>((resolvePromise, reject) => {
        const request = indexedDB.open(storage.databaseName, storage.databaseVersion);
        request.onupgradeneeded = () => {
          const opened = request.result;
          if (!opened.objectStoreNames.contains(storage.documentStore)) {
            opened.createObjectStore(storage.documentStore, { keyPath: 'id' });
          }
          if (!opened.objectStoreNames.contains(storage.libraryStore)) {
            opened.createObjectStore(storage.libraryStore, { keyPath: 'id' });
          }
        };
        request.onsuccess = () => resolvePromise(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolvePromise, reject) => {
        const transaction = database.transaction(
          [storage.documentStore, storage.libraryStore],
          'readwrite',
        );
        transaction.objectStore(storage.documentStore).put({
          id: seed.id,
          name: seed.name,
          updatedAt: seed.updatedAt,
          serialized: seed.serializedSystem,
        });
        transaction.objectStore(storage.libraryStore).put({
          id: seed.id,
          name: seed.name,
          updatedAt: seed.updatedAt,
        });
        transaction.oncomplete = () => resolvePromise();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      database.close();
    },
    {
      seed: { ...fixture, serializedSystem },
      storage: PERF_STORAGE_CONTRACT,
    },
  );
}

export async function seedLegacyFixture(
  page: Page,
  serializedSystem: string,
  activeId: string,
): Promise<void> {
  await deletePerformanceDatabase(page);
  await page.evaluate(
    ({ seed, storage }) => {
      localStorage.clear();
      localStorage.setItem(storage.activeIdKey, seed.activeId);
      localStorage.setItem(`${storage.legacySystemPrefix}${seed.activeId}`, seed.serializedSystem);
      localStorage.setItem(storage.onboardingSeenKey, '1');
    },
    {
      seed: { activeId, serializedSystem },
      storage: PERF_STORAGE_CONTRACT,
    },
  );
}

export async function installPerformanceInstrumentation(page: Page): Promise<void> {
  await page.addInitScript((storage) => {
    (window as PerfPageWindow).__TRANSITMAPPER_PERF_RUN__ = true;

    const state: BrowserMetricState = {
      largestContentfulPaintMs: 0,
      cumulativeLayoutShift: 0,
      longTaskTotalMs: 0,
      firstMapCanvasMs: null,
    };
    (window as Window & { __transitMapperPerf?: BrowserMetricState }).__transitMapperPerf = state;

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        state.largestContentfulPaintMs = Math.max(state.largestContentfulPaintMs, entry.startTime);
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as LayoutShiftEntry[]) {
        if (!entry.hadRecentInput) state.cumulativeLayoutShift += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) state.longTaskTotalMs += entry.duration;
    }).observe({ type: 'longtask', buffered: true });

    const persistence: BrowserProductionPersistenceState = { cycles: [] };
    (window as PerfPageWindow).__perfProductionPersistence = persistence;

    if (typeof Worker !== 'undefined') {
      const nativeWorker = Worker;
      const nativePostMessage = Worker.prototype.postMessage;
      window.Worker = new Proxy(nativeWorker, {
        construct(target, argumentsList, newTarget) {
          const worker = Reflect.construct(target, argumentsList, newTarget) as Worker;
          const options = argumentsList[1] as WorkerOptions | undefined;
          if (options?.name !== storage.serializerWorkerName) return worker;
          let cycle: BrowserProductionPersistenceCycle | null = null;
          worker.postMessage = new Proxy(nativePostMessage, {
            apply(postTarget, thisArgument, postArguments) {
              cycle = {
                workerStartedAt: performance.now(),
                workerCompletedAt: null,
                indexedDbStartedAt: null,
                indexedDbCompletedAt: null,
              };
              persistence.cycles.push(cycle);
              return Reflect.apply(postTarget, thisArgument, postArguments);
            },
          });
          worker.addEventListener('message', () => {
            if (cycle) cycle.workerCompletedAt = performance.now();
          });
          return worker;
        },
      });
    }

    if (typeof IDBDatabase !== 'undefined') {
      const nativeTransaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = new Proxy(nativeTransaction, {
        apply(target, thisArgument, argumentsList) {
          const transaction = Reflect.apply(target, thisArgument, argumentsList) as IDBTransaction;
          const stores =
            typeof argumentsList[0] === 'string'
              ? [argumentsList[0]]
              : Array.from(argumentsList[0] as Iterable<string>);
          if (argumentsList[1] === 'readwrite' && stores.includes(storage.documentStore)) {
            const cycle = [...persistence.cycles]
              .reverse()
              .find(
                (candidate) =>
                  candidate.workerCompletedAt !== null && candidate.indexedDbStartedAt === null,
              );
            if (cycle) {
              cycle.indexedDbStartedAt = performance.now();
              transaction.addEventListener(
                'complete',
                () => {
                  cycle.indexedDbCompletedAt = performance.now();
                },
                { once: true },
              );
            }
          }
          return transaction;
        },
      });
    }
  }, PERF_STORAGE_CONTRACT);
}

export async function configureSurfaceRoutes(
  page: Page,
  scenario: PerfScenario,
  serializedSystem: string,
): Promise<void> {
  if (scenario.surface === 'editor') return;
  const shareId = scenario.surface === 'share' ? 'perfshare' : 'perfembed';
  const apiResponse = createEncodedJsonResponses(
    `{"id":"${shareId}","system":${serializedSystem},"createdAt":0}`,
  );
  await page.route(`**/api/systems/${shareId}`, async (route) => {
    const response = selectEncodedJsonResponse(
      apiResponse,
      await route.request().headerValue('accept-encoding'),
    );
    await route.fulfill({
      status: 200,
      headers: response.headers,
      body: response.body,
    });
  });
  if (scenario.surface === 'embed') {
    const embedHtml = await readFile(resolve(APP_ROOT, 'dist/embed.html'), 'utf8');
    await page.route(`**${scenario.path}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: embedHtml,
      });
    });
  }
}

export async function startTrace(session: CDPSession): Promise<void> {
  await session.send('Tracing.start', {
    categories: [
      'blink.user_timing',
      'devtools.timeline',
      'disabled-by-default-devtools.timeline',
      'loading',
      'v8.execute',
    ].join(','),
    options: 'sampling-frequency=10000',
    transferMode: 'ReturnAsStream',
  });
}

export async function stopTrace(session: CDPSession, path: string): Promise<void> {
  const complete = new Promise<TraceCompleteEvent>((resolvePromise) => {
    session.once('Tracing.tracingComplete', (event) => {
      resolvePromise(event as TraceCompleteEvent);
    });
  });
  await session.send('Tracing.end');
  const { stream } = await complete;
  const chunks: Buffer[] = [];

  for (;;) {
    const result = (await session.send('IO.read', { handle: stream })) as TraceReadResult;
    chunks.push(
      result.base64Encoded ? Buffer.from(result.data, 'base64') : Buffer.from(result.data, 'utf8'),
    );
    if (result.eof) break;
  }
  await session.send('IO.close', { handle: stream });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.concat(chunks));
}

export async function collectStartupMetrics(page: Page): Promise<BrowserStartupSnapshot> {
  return page.evaluate((mapPaintMarkName) => {
    const navigation = performance.getEntriesByType('navigation')[0] as
      PerformanceNavigationTiming | undefined;
    const firstContentfulPaint = performance.getEntriesByName('first-contentful-paint')[0];
    const state = (window as Window & { __transitMapperPerf?: BrowserMetricState })
      .__transitMapperPerf;
    if (!navigation || !firstContentfulPaint || !state) {
      throw new Error('Required browser performance entries were not recorded.');
    }
    const firstMapPaint = performance.getEntriesByName(mapPaintMarkName, 'mark')[0];
    if (state.largestContentfulPaintMs <= 0 || !firstMapPaint) {
      throw new Error('The editor never produced a largest paint and map canvas.');
    }
    const origin = window.location.origin;
    const resources = performance
      .getEntriesByType('resource')
      .filter((entry) => new URL(entry.name).origin === origin) as PerformanceResourceTiming[];
    const transferBytes = resources.reduce(
      (sum, resource) => sum + (resource.transferSize || resource.encodedBodySize),
      0,
    );
    const cacheHitCount = resources.filter(
      (resource) => resource.transferSize === 0 && resource.encodedBodySize > 0,
    ).length;

    return {
      metrics: {
        loadMs: navigation.loadEventEnd,
        firstContentfulPaintMs: firstContentfulPaint.startTime,
        largestContentfulPaintMs: state.largestContentfulPaintMs,
        firstMapCanvasMs: firstMapPaint.startTime,
        cumulativeLayoutShift: state.cumulativeLayoutShift,
        longTaskTotalMs: state.longTaskTotalMs,
        transferBytes,
      },
      network: {
        requestCount: resources.length,
        cacheHitCount,
        cacheMissCount: resources.length - cacheHitCount,
        transferBytes,
      },
    };
  }, FIRST_SYSTEM_MAP_PAINT_MARK);
}

export async function collectMemory(
  session: CDPSession,
): Promise<{ memory: PerfMemorySnapshot; domNodeCount: number }> {
  const result = (await session.send('Performance.getMetrics')) as CdpPerformanceResult;
  const metrics = new Map(result.metrics.map((metric) => [metric.name, metric.value]));
  const jsHeapUsedBytes = metrics.get('JSHeapUsedSize');
  const jsHeapTotalBytes = metrics.get('JSHeapTotalSize');
  const domNodeCount = metrics.get('Nodes');
  if (
    jsHeapUsedBytes === undefined ||
    jsHeapTotalBytes === undefined ||
    domNodeCount === undefined
  ) {
    throw new Error('Chrome did not expose heap and DOM counters.');
  }
  return {
    memory: { jsHeapUsedBytes, jsHeapTotalBytes },
    domNodeCount,
  };
}

export async function closeContext(context: BrowserContext): Promise<void> {
  try {
    await context.close();
  } catch {
    // Preserve the measurement error that caused cleanup.
  }
}

export async function runCalibration(
  browser: Browser,
  protocol: PerfProtocol,
): Promise<PerfCalibration> {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  try {
    await session.send('Emulation.setCPUThrottlingRate', {
      rate: protocol.cpuThrottlingRate,
    });
    const measured = await page.evaluate(async (displaySampleCount) => {
      const displayFrameIntervalSamplesMs: number[] = [];
      let previousFrameAt = await new Promise<number>((resolveFrame) =>
        requestAnimationFrame(resolveFrame),
      );
      for (let sample = 0; sample < displaySampleCount; sample += 1) {
        const now = await new Promise<number>((resolveFrame) =>
          requestAnimationFrame(resolveFrame),
        );
        displayFrameIntervalSamplesMs.push(now - previousFrameAt);
        previousFrameAt = now;
      }
      const measurements: number[] = [];
      for (let run = 0; run < 6; run += 1) {
        let value = 0x9e3779b9;
        const startedAt = performance.now();
        for (let index = 0; index < 2_000_000; index += 1) {
          value = Math.imul(value ^ index, 0x85ebca6b);
          value ^= value >>> 13;
        }
        if (!Number.isFinite(value)) {
          throw new Error('The calibration loop produced an invalid result.');
        }
        if (run > 0) measurements.push(performance.now() - startedAt);
      }
      return { samplesMs: measurements, displayFrameIntervalSamplesMs };
    }, DISPLAY_CADENCE_SAMPLE_COUNT);
    const { samplesMs, displayFrameIntervalSamplesMs } = measured;
    const sorted = [...samplesMs].sort((left, right) => left - right);
    const displayCadence = summarizeDisplayCadence(displayFrameIntervalSamplesMs);
    return {
      benchmark: 'integer-mix-v1',
      samplesMs,
      medianMs: sorted[Math.floor(sorted.length / 2)],
      displayFrameIntervalSamplesMs,
      ...displayCadence,
    };
  } finally {
    await closeContext(context);
  }
}
