import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Browser, CDPSession, Page } from 'playwright-core';
import { generatePerfFixture } from '../../src/perf/fixtures';
import {
  createPerfListenerIdentity,
  groupListenerInventory,
  listenerDeltas,
  type PerfListenerDescription,
  type PerfListenerDiagnostics,
  type PerfListenerIdentity,
  type PerfListenerTarget,
} from '../../src/perf/listenerInventory';
import { PERF_SCENARIOS } from '../../src/perf/scenarios';
import { settleKeyboardPointerSentinels } from '../../src/perf/soakSettlement';
import { soakViolations, type SoakSnapshot } from '../../src/perf/soakPolicy';
import type { PerfProtocol } from '../../src/perf/types';
import {
  closeContext,
  collectMemory,
  configureProtocol,
  installPerformanceInstrumentation,
  seedIndexedDbFixture,
} from './browser';
import type { PerfPageWindow } from './browserContract';
import { waitForScenarioReady } from './journeys';

interface ListenerResult {
  listeners: PerfListenerDescription[];
}

interface RuntimeObjectResult {
  result: {
    objectId?: string;
  };
}

interface ScriptParsedEvent {
  scriptId: string;
  url: string;
}

export interface SoakReport {
  schemaVersion: 3;
  generatedAt: string;
  durationMs: number;
  scenarioId: 'rtc';
  maximumGrowthRatio: 0.1;
  initial: SoakSnapshot;
  final: SoakSnapshot;
  violations: string[];
  status: 'pass' | 'fail';
  editCycles: number;
  exportDialogCycles: number;
  pngDownloadCount: number;
  svgDownloadCount: number;
  webGlContextCountSource: 'created-minus-context-lost-events';
  listenerDiagnostics: PerfListenerDiagnostics;
}

const LISTENER_TARGETS: Array<{ target: PerfListenerTarget; expression: string }> = [
  { target: 'window', expression: 'window' },
  { target: 'document', expression: 'document' },
  { target: 'map-canvas', expression: 'document.querySelector(".maplibregl-canvas")' },
];

async function listenerInventory(
  session: CDPSession,
  scriptUrls: Map<string, string>,
): Promise<PerfListenerIdentity[]> {
  const inventory: PerfListenerIdentity[] = [];
  for (const { target, expression } of LISTENER_TARGETS) {
    const evaluated = (await session.send('Runtime.evaluate', {
      expression,
      returnByValue: false,
    })) as RuntimeObjectResult;
    const objectId = evaluated.result.objectId;
    if (!objectId) continue;
    try {
      const result = (await session.send('DOMDebugger.getEventListeners', {
        objectId,
        depth: 1,
      })) as ListenerResult;
      inventory.push(
        ...result.listeners.map((listener) =>
          createPerfListenerIdentity(
            target,
            listener,
            listener.scriptId ? scriptUrls.get(listener.scriptId) : undefined,
          ),
        ),
      );
    } finally {
      await session.send('Runtime.releaseObject', { objectId });
    }
  }
  return inventory;
}

interface CapturedSoakSnapshot {
  snapshot: SoakSnapshot;
  listeners: PerfListenerIdentity[];
}

async function captureSoakSnapshot(
  page: Page,
  session: CDPSession,
  scriptUrls: Map<string, string>,
  startedAt: number,
): Promise<CapturedSoakSnapshot> {
  await session.send('HeapProfiler.collectGarbage');
  const { memory, domNodeCount } = await collectMemory(session);
  const listeners = await listenerInventory(session, scriptUrls);
  return {
    snapshot: {
      elapsedMs: Date.now() - startedAt,
      jsHeapUsedBytes: memory.jsHeapUsedBytes,
      domNodeCount,
      listenerCount: listeners.length,
      workerCount: page.workers().length,
      webGlContextCount: await page.evaluate(
        () => (window as PerfPageWindow).__perfWebGlContextCount ?? 0,
      ),
    },
    listeners,
  };
}

async function runBalancedPan(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await (window as PerfPageWindow).__panGestureBench?.({ steps: 40, dx: 4 });
    await (window as PerfPageWindow).__panGestureBench?.({ steps: 40, dx: -4 });
  });
}

async function runEditCycle(page: Page, stationId: string, stationName: string): Promise<void> {
  await page.keyboard.press('v');
  const before = await page.evaluate((targetId) => {
    const station = (window as PerfPageWindow).__perfStationSnapshot?.(targetId);
    const project = (window as PerfPageWindow).__perfProjectLngLat;
    if (!station || !project) throw new Error('The soak station target is unavailable.');
    return { station, point: project(station.coord) };
  }, stationId);
  await page.mouse.click(before.point.x, before.point.y);
  const selectedStationName = page.getByLabel('Station name');
  await selectedStationName.waitFor({ state: 'visible', timeout: 30_000 });
  if ((await selectedStationName.inputValue()) !== stationName) {
    throw new Error('The soak target did not resolve to the expected station.');
  }
  await page.mouse.move(before.point.x, before.point.y);
  await page.mouse.down();
  await page.mouse.move(before.point.x + 24, before.point.y + 12, { steps: 6 });
  await page.mouse.up();
  const moved = await page.evaluate(
    (targetId) => (window as PerfPageWindow).__perfStationSnapshot?.(targetId) ?? null,
    stationId,
  );
  if (
    !moved ||
    moved.revision === before.station.revision ||
    (moved.coord[0] === before.station.coord[0] && moved.coord[1] === before.station.coord[1])
  ) {
    throw new Error('The soak edit cycle did not commit a station move.');
  }
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  // Let validation and persistence finish before restoring the fixed shape.
  await page.waitForTimeout(550);
}

async function runExportCycle(page: Page, format: 'PNG' | 'SVG'): Promise<number> {
  await page.locator('button[title="Export…"]').click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible', timeout: 30_000 });
  await dialog.locator('.export-preview-map .maplibregl-canvas').waitFor({
    state: 'visible',
    timeout: 30_000,
  });
  await dialog.getByRole('button', { name: format, exact: true }).click();
  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
  await dialog.getByRole('button', { name: `Export ${format}`, exact: true }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  if (!stream) throw new Error(`Chrome did not expose the ${format} download stream.`);
  let downloadedBytes = 0;
  for await (const chunk of stream) {
    downloadedBytes += Buffer.isBuffer(chunk) ? chunk.byteLength : Buffer.byteLength(chunk);
  }
  const failure = await download.failure();
  if (failure) throw new Error(`${format} download failed: ${failure}`);
  if (downloadedBytes === 0) throw new Error(`${format} download produced an empty file.`);
  await dialog.waitFor({ state: 'detached', timeout: 30_000 });
  return downloadedBytes;
}

async function installWebGlContextCounter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type CanvasGetContext = (
      this: HTMLCanvasElement,
      contextId: string,
      options?: unknown,
    ) => RenderingContext | null;
    const canvasPrototype = HTMLCanvasElement.prototype as unknown as {
      getContext: CanvasGetContext;
    };
    const original = canvasPrototype.getContext;
    const contexts = new WeakSet<object>();
    (window as PerfPageWindow).__perfWebGlContextCount = 0;
    canvasPrototype.getContext = function (
      this: HTMLCanvasElement,
      contextId: string,
      options?: unknown,
    ): RenderingContext | null {
      const context = original.call(this, contextId, options);
      if (context && (contextId === 'webgl' || contextId === 'webgl2') && !contexts.has(context)) {
        contexts.add(context);
        (window as PerfPageWindow).__perfWebGlContextCount =
          ((window as PerfPageWindow).__perfWebGlContextCount ?? 0) + 1;
        this.addEventListener(
          'webglcontextlost',
          () => {
            if (!contexts.delete(context)) return;
            (window as PerfPageWindow).__perfWebGlContextCount = Math.max(
              0,
              ((window as PerfPageWindow).__perfWebGlContextCount ?? 1) - 1,
            );
          },
          { once: true },
        );
      }
      return context;
    };
  });
}

export async function runSoak(
  browser: Browser,
  protocol: PerfProtocol,
  previewUrl: string,
  outputDirectory: string,
  durationMs: number,
): Promise<SoakReport> {
  const context = await browser.newContext({
    viewport: {
      width: protocol.viewport.width,
      height: protocol.viewport.height,
    },
    deviceScaleFactor: protocol.viewport.deviceScaleFactor,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  const scriptUrls = new Map<string, string>();
  session.on('Debugger.scriptParsed', ({ scriptId, url }: ScriptParsedEvent) => {
    if (url) scriptUrls.set(scriptId, url);
  });
  const fixture = generatePerfFixture('rtc');
  try {
    await session.send('Debugger.enable');
    await configureProtocol(session, protocol);
    await session.send('HeapProfiler.enable');
    await installWebGlContextCounter(page);
    await page.goto(`${previewUrl}/favicon.svg`, { waitUntil: 'load', timeout: 60_000 });
    await seedIndexedDbFixture(page, JSON.stringify(fixture), fixture);
    await installPerformanceInstrumentation(page);
    await session.send('Network.clearBrowserCache');
    await page.goto(`${previewUrl}/`, { waitUntil: 'load', timeout: 60_000 });
    await waitForScenarioReady(page, PERF_SCENARIOS.rtc, fixture.name, 'cold');
    await page.waitForFunction(
      () => typeof (window as PerfPageWindow).__panGestureBench === 'function',
      undefined,
      { timeout: 30_000 },
    );
    for (let warmup = 0; warmup < 3; warmup += 1) await runBalancedPan(page);
    const station = fixture.stations[Math.floor(fixture.stations.length / 2)];
    if (!station) throw new Error('The RTC soak fixture has no station target.');

    // Warm all one-time paths before the forced-GC baseline.
    await runEditCycle(page, station.id, station.name ?? '');
    await runExportCycle(page, 'PNG');
    await runExportCycle(page, 'SVG');
    await page.waitForTimeout(1_000);

    const startedAt = Date.now();
    const initialCapture = await captureSoakSnapshot(page, session, scriptUrls, startedAt);
    const initial = initialCapture.snapshot;
    let iterations = 0;
    let editCycles = 0;
    let exportDialogCycles = 0;
    let pngDownloadCount = 0;
    let svgDownloadCount = 0;
    console.log(`perf soak: exercising RTC scale for ${durationMs} ms`);
    while (Date.now() - startedAt < durationMs) {
      await runBalancedPan(page);
      iterations += 1;
      if (iterations === 1 || iterations % 4 === 0) {
        await runEditCycle(page, station.id, station.name ?? '');
        editCycles += 1;
      }
      if (iterations === 1 || iterations % 8 === 0) {
        await runExportCycle(page, 'PNG');
        pngDownloadCount += 1;
        exportDialogCycles += 1;
        await runExportCycle(page, 'SVG');
        svgDownloadCount += 1;
        exportDialogCycles += 1;
      }
      await page.waitForTimeout(100);
    }
    await settleKeyboardPointerSentinels(page);
    await page.waitForTimeout(1_000);
    const finalCapture = await captureSoakSnapshot(page, session, scriptUrls, startedAt);
    const final = finalCapture.snapshot;
    const violations = soakViolations(initial, final, {
      editCycles,
      exportDialogCycles,
      pngDownloadCount,
      svgDownloadCount,
    });
    const initialListeners = groupListenerInventory(initialCapture.listeners);
    const finalListeners = groupListenerInventory(finalCapture.listeners);
    const report: SoakReport = {
      schemaVersion: 3,
      generatedAt: new Date().toISOString(),
      durationMs,
      scenarioId: 'rtc',
      maximumGrowthRatio: 0.1,
      initial,
      final,
      violations,
      status: violations.length === 0 ? 'pass' : 'fail',
      editCycles,
      exportDialogCycles,
      pngDownloadCount,
      svgDownloadCount,
      webGlContextCountSource: 'created-minus-context-lost-events',
      listenerDiagnostics: {
        initial: initialListeners,
        final: finalListeners,
        deltas: listenerDeltas(initialListeners, finalListeners),
      },
    };
    const path = resolve(outputDirectory, 'soak-report.json');
    await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`performance soak report: ${path}`);
    for (const violation of violations) console.error(`performance soak: ${violation}`);
    return report;
  } finally {
    await closeContext(context);
  }
}
