#!/usr/bin/env tsx

import { spawn, type ChildProcess } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
} from 'playwright-core';
import type { LngLat } from '@transitmapper/core/model/system';
import {
  createPerfProtocol,
  PERF_BASELINE_DIRECTORY,
  PERF_DEFAULT_ARTIFACT_DIRECTORY,
  PERF_MAX_REGRESSION_RATIO,
  PERF_PROTOCOL,
  PERF_SCENARIO_LIST,
} from '../../perf.config';
import { evaluatePerfBudgets } from '../../src/perf/budget';
import { generatePerfFixture } from '../../src/perf/fixtures';
import { summarizeGesture, type RawGestureMeasurements } from '../../src/perf/gestureStats';
import { classifyPersistence } from '../../src/perf/persistencePolicy';
import { createPerfReport, createUnavailablePerfReport } from '../../src/perf/report';
import { PERF_SCENARIOS } from '../../src/perf/scenarios';
import type {
  PerfBundleEntry,
  PerfBudgetEvaluation,
  PerfCalibration,
  PerfGestureDiagnostics,
  PerfMemorySnapshot,
  PerfMetricValues,
  PerfNetworkSnapshot,
  PerfPhaseCounters,
  PerfPersistenceProbe,
  PerfReport,
  PerfProfileId,
  PerfProtocol,
  PerfRuntimeCounters,
  PerfSample,
  PerfScenario,
} from '../../src/perf/types';

interface PerfCliOptions {
  record: boolean;
  outputDirectory: string;
  baselinePath?: string;
  requireBaseline: boolean;
  skipBuild: boolean;
  profile: PerfProfileId;
  scenarioId?: PerfScenario['id'];
  soak: boolean;
  soakDurationMs: number;
  help: boolean;
}

interface RunningPreview {
  child: ChildProcess;
  url: string;
  logs: string[];
}

interface PerfInitPayload {
  activeId: string;
  serializedSystem: string;
}

interface BrowserMetricState {
  largestContentfulPaintMs: number;
  cumulativeLayoutShift: number;
  longTaskTotalMs: number;
  firstMapCanvasMs: number | null;
}

interface BrowserStartupSnapshot {
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

interface GenericGestureState {
  eventTimings: EventTimingMeasurement[];
  animationFrameMs: number[];
  longTaskMs: number[];
  active: boolean;
  lastFrameAt: number;
  sourceUploadsBefore: number | null;
}

interface GenericGestureMeasurements {
  inputToNextPaintMs: number[];
  animationFrameMs: number[];
  longTaskMs: number[];
  sourceUploadCount: number | null;
  actions: Array<'camera-drag' | 'entity-drag' | 'draw'>;
}

interface PerfPageWindow extends Window {
  __genericPerfGesture?: GenericGestureState;
  __genericPerfFrame?: FrameRequestCallback;
  __panGestureBench?: (options?: {
    steps?: number;
    dx?: number;
    dy?: number;
  }) => Promise<RawGestureMeasurements>;
  __perfSourceUploadCount?: () => number;
  __perfProjectLngLat?: (coord: LngLat) => { x: number; y: number };
  __perfWebGlContextCount?: number;
  __mapProjectionCounts?: () => PerfPhaseCounters & {
    sourceUploadCount: number;
  };
}

interface EventTimingMeasurement {
  name: string;
  interactionId: number;
  duration: number;
  startTime: number;
}

interface BrowserEventTimingEntry extends PerformanceEntry {
  interactionId: number;
  duration: number;
}

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

interface BundleReportFile {
  entries: PerfBundleEntry[];
}

interface RunSampleOptions {
  browser: Browser;
  previewUrl: string;
  scenario: PerfScenario;
  outputDirectory: string;
  measuredRun?: number;
  tracePath?: string;
}

interface RunScenarioOptions {
  browser: Browser;
  previewUrl: string;
  scenario: PerfScenario;
  outputDirectory: string;
  record: boolean;
}

interface OfflineRuntimeReport {
  schemaVersion: 1;
  generatedAt: string;
  cacheEvicted: true;
  offline: true;
  serviceWorkerControlled: true;
  documentName: string;
}

interface ListenerResult {
  listeners: unknown[];
}

interface RuntimeObjectResult {
  result: {
    objectId?: string;
  };
}

interface SoakSnapshot {
  elapsedMs: number;
  jsHeapUsedBytes: number;
  domNodeCount: number;
  listenerCount: number;
  workerCount: number;
  webGlContextCount: number;
}

interface SoakReport {
  schemaVersion: 1;
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
  webGlContextCountSource: 'created-minus-context-lost-events';
}

const APP_ROOT = resolve(import.meta.dirname, '../..');
const PREVIEW_PORT = 4_173;
const PREVIEW_URL = `http://127.0.0.1:${PREVIEW_PORT}`;
const REPORT_FILENAME = 'report.json';
const BUNDLE_REPORT_PATH = resolve(APP_ROOT, 'dist/performance/bundle-report.json');
const PWA_REPORT_PATH = resolve(APP_ROOT, 'dist/performance/pwa-report.json');
const PWA_RUNTIME_REPORT_FILENAME = 'pwa-runtime-report.json';
let activeProtocol: PerfProtocol = PERF_PROTOCOL;

function usage(): string {
  return [
    'Usage: pnpm perf [options]',
    '',
    'Options:',
    '  --output <directory>   JSON/trace artifact directory',
    '  --baseline <report>    Compare medians with another report',
    '  --require-baseline     Fail when --baseline is absent or unavailable',
    '  --profile <name>        desktop (default) or mobile',
    '  --scenario <id>         Run one scenario for local diagnosis',
    '  --soak                  Run the ten-minute RTC leak gate',
    '  --soak-duration <ms>    Shorter local soak smoke (default 600000)',
    '  --skip-build           Reuse the current dist/ output',
    '  --record               Retain one Chrome trace per measured run',
    '  --help                 Show this help',
  ].join('\n');
}

function optionValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value.`);
  return value;
}

function parseOptions(args: string[]): PerfCliOptions {
  let record = false;
  let output: string | undefined;
  let baseline: string | undefined;
  let requireBaseline = false;
  let skipBuild = false;
  let profile: PerfProfileId = 'desktop';
  let scenarioId: PerfScenario['id'] | undefined;
  let soak = false;
  let soakDurationMs = 10 * 60 * 1_000;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') continue;
    if (argument === '--record') record = true;
    else if (argument === '--soak') soak = true;
    else if (argument === '--soak-duration') {
      const value = Number(optionValue(args, index, argument));
      if (!Number.isInteger(value) || value < 1_000) {
        throw new Error('--soak-duration must be an integer of at least 1000 ms.');
      }
      soakDurationMs = value;
      index += 1;
    } else if (argument === '--require-baseline') requireBaseline = true;
    else if (argument === '--skip-build') skipBuild = true;
    else if (argument === '--profile') {
      const value = optionValue(args, index, argument);
      if (value !== 'desktop' && value !== 'mobile') {
        throw new Error(`--profile must be desktop or mobile, not "${value}".`);
      }
      profile = value;
      index += 1;
    } else if (argument === '--scenario') {
      const value = optionValue(args, index, argument);
      const scenario = PERF_SCENARIO_LIST.find((candidate) => candidate.id === value);
      if (!scenario) throw new Error(`Unknown performance scenario: "${value}".`);
      scenarioId = scenario.id;
      index += 1;
    } else if (argument === '--help') help = true;
    else if (argument === '--output') {
      output = optionValue(args, index, argument);
      index += 1;
    } else if (argument === '--baseline') {
      baseline = optionValue(args, index, argument);
      index += 1;
    } else {
      throw new Error(`Unknown performance option: ${argument}`);
    }
  }

  const timestamp = new Date().toISOString().replaceAll(':', '-');
  const defaultOutput = record
    ? resolve(APP_ROOT, PERF_DEFAULT_ARTIFACT_DIRECTORY, 'recorded', profile, timestamp)
    : resolve(APP_ROOT, PERF_DEFAULT_ARTIFACT_DIRECTORY, 'current', profile);

  return {
    record,
    outputDirectory: resolve(APP_ROOT, output ?? defaultOutput),
    baselinePath: baseline ? resolve(APP_ROOT, baseline) : undefined,
    requireBaseline,
    skipBuild,
    profile,
    scenarioId,
    soak,
    soakDurationMs,
    help,
  };
}

function commandError(command: string, code: number | null, output: string): Error {
  const detail = output.trim();
  return new Error(`${command} exited with ${code ?? 'no status'}${detail ? `:\n${detail}` : '.'}`);
}

async function runCommand(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: APP_ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      process.stderr.write(chunk);
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(commandError([command, ...args].join(' '), code, output));
    });
  });
}

async function waitForPreview(preview: RunningPreview): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (preview.child.exitCode !== null) {
      throw commandError('vite preview', preview.child.exitCode, preview.logs.join(''));
    }
    try {
      const response = await fetch(preview.url, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      // The preview process is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`vite preview did not answer at ${preview.url} within 15 seconds.`);
}

async function startPreview(): Promise<RunningPreview> {
  const child = spawn(
    'pnpm',
    [
      'exec',
      'vite',
      'preview',
      '--host',
      '127.0.0.1',
      '--port',
      String(PREVIEW_PORT),
      '--strictPort',
    ],
    {
      cwd: APP_ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const preview: RunningPreview = { child, url: PREVIEW_URL, logs: [] };
  child.stdout?.on('data', (chunk: Buffer) => preview.logs.push(chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => preview.logs.push(chunk.toString()));
  await waitForPreview(preview);
  return preview;
}

async function stopPreview(preview: RunningPreview | undefined): Promise<void> {
  if (!preview || preview.child.exitCode !== null) return;
  preview.child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolvePromise) => preview.child.once('exit', () => resolvePromise())),
    new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 2_000)),
  ]);
  if (preview.child.exitCode === null) preview.child.kill('SIGKILL');
}

async function configureProtocol(session: CDPSession): Promise<void> {
  await session.send('Network.enable');
  await session.send('Performance.enable');
  await session.send('Network.clearBrowserCache');
  // A cleared cache makes the first navigation cold while leaving the
  // response eligible to populate Chrome's HTTP cache for the measured warm
  // reload in the same browser context.
  await session.send('Network.setCacheDisabled', { cacheDisabled: false });
  await session.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: activeProtocol.network.latencyMs,
    downloadThroughput: activeProtocol.network.downloadThroughputBytesPerSecond,
    uploadThroughput: activeProtocol.network.uploadThroughputBytesPerSecond,
    connectionType: 'cellular4g',
  });
  await session.send('Emulation.setCPUThrottlingRate', {
    rate: activeProtocol.cpuThrottlingRate,
  });
}

async function measurePersistencePhases(
  page: Page,
  session: CDPSession,
  previewUrl: string,
  serializedSystem: string,
): Promise<PerfPersistenceProbe> {
  // Use the real origin and unmodified Storage prototype for this probe. The
  // fixture shim is installed only afterwards so it cannot turn a quota
  // failure into an apparent successful save.
  await page.goto(`${previewUrl}/favicon.svg`, {
    waitUntil: 'load',
    timeout: 60_000,
  });
  const measured = await page.evaluate((serialized) => {
    const parseStartedAt = performance.now();
    const parsed = JSON.parse(serialized) as unknown;
    const parseMs = performance.now() - parseStartedAt;
    const serializationStartedAt = performance.now();
    const output = JSON.stringify(parsed);
    const serializationMs = performance.now() - serializationStartedAt;
    const writeStartedAt = performance.now();
    let localStorageWriteOutcome: 'stored' | 'quota-exceeded' | 'unavailable' = 'stored';
    try {
      localStorage.setItem('transitmapper:perf:persistence-probe', output);
      localStorage.removeItem('transitmapper:perf:persistence-probe');
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
  }, serializedSystem);
  // The favicon navigation was only an origin bootstrap. It must not warm the
  // cold-load sample that follows.
  await session.send('Network.clearBrowserCache');
  return classifyPersistence(measured);
}

async function installMeasurementState(
  page: Page,
  system: string,
  activeId: string,
): Promise<void> {
  const payload: PerfInitPayload = {
    activeId,
    serializedSystem: system,
  };
  await page.addInitScript((init: PerfInitPayload) => {
    (
      window as Window & {
        __TRANSITMAPPER_PERF_RUN__?: boolean;
      }
    ).__TRANSITMAPPER_PERF_RUN__ = true;
    const seeded = new Map<string, string>([
      ['transitmapper:activeId', init.activeId],
      [`transitmapper:system:${init.activeId}`, init.serializedSystem],
      ['transitmapper:onboardingSeen', '1'],
    ]);
    const local = window.localStorage;
    const originalGetItem = Storage.prototype.getItem;
    const originalSetItem = Storage.prototype.setItem;
    const originalRemoveItem = Storage.prototype.removeItem;
    Storage.prototype.getItem = function (key: string): string | null {
      if (this === local && seeded.has(key)) return seeded.get(key) ?? null;
      return originalGetItem.call(this, key);
    };
    Storage.prototype.setItem = function (key: string, value: string): void {
      if (this === local) {
        seeded.set(key, String(value));
        return;
      }
      originalSetItem.call(this, key, value);
    };
    Storage.prototype.removeItem = function (key: string): void {
      if (this === local) {
        seeded.delete(key);
        return;
      }
      originalRemoveItem.call(this, key);
    };

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

    const canvasTimer = window.setInterval(() => {
      if (!document.querySelector('.maplibregl-canvas')) return;
      state.firstMapCanvasMs = performance.now();
      window.clearInterval(canvasTimer);
    }, 16);
  }, payload);
}

async function configureSurfaceRoutes(
  page: Page,
  scenario: PerfScenario,
  serializedSystem: string,
): Promise<void> {
  if (scenario.surface === 'editor') return;
  const shareId = scenario.surface === 'share' ? 'perfshare' : 'perfembed';
  await page.route(`**/api/systems/${shareId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'cache-control': 'no-store' },
      body: `{"id":"${shareId}","system":${serializedSystem},"createdAt":0}`,
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

async function startTrace(session: CDPSession): Promise<void> {
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

async function stopTrace(session: CDPSession, path: string): Promise<void> {
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

async function collectStartupMetrics(page: Page): Promise<BrowserStartupSnapshot> {
  return page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0] as
      PerformanceNavigationTiming | undefined;
    const firstContentfulPaint = performance.getEntriesByName('first-contentful-paint')[0];
    const state = (window as Window & { __transitMapperPerf?: BrowserMetricState })
      .__transitMapperPerf;
    if (!navigation || !firstContentfulPaint || !state) {
      throw new Error('Required browser performance entries were not recorded.');
    }
    if (state.largestContentfulPaintMs <= 0 || state.firstMapCanvasMs === null) {
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
        firstMapCanvasMs: state.firstMapCanvasMs,
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
  });
}

async function collectMemory(
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

async function runDirectManipulation(
  page: Page,
  scenario: PerfScenario,
  entityCoord?: LngLat,
): Promise<GenericGestureMeasurements> {
  await page.evaluate(() => {
    const state: GenericGestureState = {
      eventTimings: [],
      animationFrameMs: [],
      longTaskMs: [],
      active: true,
      lastFrameAt: performance.now(),
      sourceUploadsBefore: (window as PerfPageWindow).__perfSourceUploadCount?.() ?? null,
    };
    (window as PerfPageWindow).__genericPerfGesture = state;
    const eventObserverOptions = {
      type: 'event',
      buffered: true,
      durationThreshold: 16,
    } as PerformanceObserverInit;
    new PerformanceObserver((list) => {
      if (!state.active) return;
      for (const entry of list.getEntries() as BrowserEventTimingEntry[]) {
        state.eventTimings.push({
          name: entry.name,
          interactionId: entry.interactionId,
          duration: entry.duration,
          startTime: entry.startTime,
        });
      }
    }).observe(eventObserverOptions);
    // first-input is not subject to Event Timing's 16 ms reporting threshold,
    // so a fast first drag remains a real measured value rather than a zero.
    new PerformanceObserver((list) => {
      if (!state.active) return;
      for (const entry of list.getEntries() as BrowserEventTimingEntry[]) {
        state.eventTimings.push({
          name: entry.name,
          interactionId: entry.interactionId,
          duration: entry.duration,
          startTime: entry.startTime,
        });
      }
    }).observe({
      type: 'first-input',
      buffered: true,
    });
    (window as PerfPageWindow).__genericPerfFrame = function (now: number): void {
      if (state.active) {
        state.animationFrameMs.push(now - state.lastFrameAt);
        state.lastFrameAt = now;
        const next = (window as PerfPageWindow).__genericPerfFrame;
        if (next) requestAnimationFrame(next);
      }
    };
    const initialFrame = (window as PerfPageWindow).__genericPerfFrame;
    if (initialFrame) requestAnimationFrame(initialFrame);
    new PerformanceObserver((list) => {
      if (!state.active) return;
      for (const entry of list.getEntries()) state.longTaskMs.push(entry.duration);
    }).observe({ type: 'longtask', buffered: false });
  });

  const canvas = page.locator('.maplibregl-canvas').first();
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('The map canvas has no measurable bounds.');
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const dragDistance = Math.min(120, bounds.width * 0.25);

  const actions: Array<'camera-drag' | 'entity-drag' | 'draw'> = ['camera-drag'];
  if (scenario.surface === 'editor') {
    if (!entityCoord) throw new Error('The editor scenario has no station drag target.');
    await page.keyboard.press('v');
    await page.waitForFunction(
      () => typeof (window as PerfPageWindow).__perfProjectLngLat === 'function',
      undefined,
      { timeout: 30_000 },
    );
    const beforeUploads = await page.evaluate(
      () => (window as PerfPageWindow).__perfSourceUploadCount?.() ?? null,
    );
    const target = await page.evaluate((coord) => {
      const project = (window as PerfPageWindow).__perfProjectLngLat;
      if (!project) throw new Error('The performance projection seam is unavailable.');
      return project(coord);
    }, entityCoord);
    if (
      target.x < bounds.x ||
      target.x > bounds.x + bounds.width ||
      target.y < bounds.y ||
      target.y > bounds.y + bounds.height
    ) {
      throw new Error('The deterministic station drag target is outside the map viewport.');
    }
    await page.mouse.move(target.x, target.y);
    await page.mouse.down();
    await page.mouse.move(target.x + 32, target.y + 18, { steps: 8 });
    await page.mouse.up();
    await page.evaluate(
      () =>
        new Promise<void>((resolvePromise) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolvePromise()));
        }),
    );
    const afterUploads = await page.evaluate(
      () => (window as PerfPageWindow).__perfSourceUploadCount?.() ?? null,
    );
    if (beforeUploads === null || afterUploads === null || afterUploads <= beforeUploads) {
      throw new Error('The deterministic station pointer drag did not commit an entity update.');
    }
    actions.push('entity-drag');
  }

  await page.mouse.move(centerX - dragDistance / 2, centerY);
  await page.mouse.down();
  for (let step = 1; step <= 24; step += 1) {
    await page.mouse.move(
      centerX - dragDistance / 2 + (dragDistance * step) / 24,
      centerY + Math.sin((step / 24) * Math.PI) * 12,
    );
    await page.waitForTimeout(12);
  }
  await page.mouse.up();

  if (scenario.surface === 'editor') {
    actions.push('draw');
    await page.keyboard.press('l');
    const drawY = bounds.y + bounds.height * 0.7;
    for (const ratio of [0.35, 0.5, 0.65]) {
      await page.mouse.click(bounds.x + bounds.width * ratio, drawY);
      await page.waitForTimeout(24);
    }
    await page.keyboard.press('Enter');
    // This interval includes validation and the shared content/camera
    // persistence debounce, so the interaction scenario catches contention
    // from the real work an edit schedules.
    await page.waitForTimeout(550);
  }

  await page.evaluate(
    () =>
      new Promise<void>((resolvePromise) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolvePromise()));
      }),
  );
  // Event Timing entries are queued after the presentation that ends an
  // interaction. Two rAFs establish that paint; this short task turn lets
  // PerformanceObserver deliver the buffered entry before we read it.
  await page.waitForTimeout(250);

  const measurements = await page.evaluate(() => {
    const state = (window as PerfPageWindow).__genericPerfGesture;
    if (!state) throw new Error('The direct-manipulation measurement did not start.');
    state.active = false;
    delete (window as PerfPageWindow).__genericPerfFrame;
    const deduplicated = new Map<string, EventTimingMeasurement>();
    for (const entry of state.eventTimings) {
      const key = `${entry.name}:${entry.interactionId}:${entry.startTime}:${entry.duration}`;
      deduplicated.set(key, entry);
    }
    const interactions = new Map<number | string, number>();
    for (const entry of deduplicated.values()) {
      const key =
        entry.interactionId > 0 ? entry.interactionId : `${entry.name}:${entry.startTime}`;
      interactions.set(key, Math.max(interactions.get(key) ?? 0, entry.duration));
    }
    const sourceUploadsAfter = (window as PerfPageWindow).__perfSourceUploadCount?.() ?? null;
    return {
      inputToNextPaintMs: [...interactions.values()],
      animationFrameMs: state.animationFrameMs.slice(2),
      longTaskMs: state.longTaskMs,
      sourceUploadCount:
        state.sourceUploadsBefore === null || sourceUploadsAfter === null
          ? null
          : sourceUploadsAfter - state.sourceUploadsBefore,
    };
  });
  if (measurements.inputToNextPaintMs.length === 0) {
    throw new Error(
      `${scenario.id} produced no Event Timing entries for trusted pointer interactions.`,
    );
  }
  return { ...measurements, actions };
}

async function runMeasuredGesture(
  page: Page,
  scenario: PerfScenario,
  entityCoord?: LngLat,
): Promise<{
  metrics: ReturnType<typeof summarizeGesture>['metrics'];
  diagnostics: PerfGestureDiagnostics;
  counters: Omit<PerfRuntimeCounters, 'domNodeCount'>;
}> {
  if (scenario.surface !== 'embed') {
    await page.waitForFunction(
      () => typeof (window as PerfPageWindow).__mapProjectionCounts === 'function',
      undefined,
      { timeout: 30_000 },
    );
  }
  const phaseBefore = await page.evaluate(
    () => (window as PerfPageWindow).__mapProjectionCounts?.() ?? null,
  );
  const direct = await runDirectManipulation(page, scenario, entityCoord);
  let mapMeasurements: RawGestureMeasurements | null = null;
  if (scenario.surface !== 'embed') {
    await page.waitForFunction(
      () => typeof (window as PerfPageWindow).__panGestureBench === 'function',
      undefined,
      { timeout: 30_000 },
    );
    mapMeasurements = await page.evaluate(async () => {
      const benchmark = (window as PerfPageWindow).__panGestureBench;
      if (!benchmark) throw new Error('The painted-map gesture benchmark is unavailable.');
      return benchmark();
    });
  }
  const phaseAfter = await page.evaluate(
    () => (window as PerfPageWindow).__mapProjectionCounts?.() ?? null,
  );
  const phaseCounters: PerfPhaseCounters | null =
    phaseBefore && phaseAfter
      ? {
          fullProjectionCount: phaseAfter.fullProjectionCount - phaseBefore.fullProjectionCount,
          gestureProjectionCount:
            phaseAfter.gestureProjectionCount - phaseBefore.gestureProjectionCount,
          entityComparisonCount:
            phaseAfter.entityComparisonCount - phaseBefore.entityComparisonCount,
          projectedEntityCount: phaseAfter.projectedEntityCount - phaseBefore.projectedEntityCount,
        }
      : null;

  const raw: RawGestureMeasurements = {
    inputToNextPaintMs: direct.inputToNextPaintMs,
    paintedFrameMs: mapMeasurements?.paintedFrameMs ?? direct.animationFrameMs,
    longTaskMs: [...direct.longTaskMs, ...(mapMeasurements?.longTaskMs ?? [])],
    sourceUploadCount:
      direct.sourceUploadCount === null && mapMeasurements?.sourceUploadCount == null
        ? null
        : (direct.sourceUploadCount ?? 0) + (mapMeasurements?.sourceUploadCount ?? 0),
  };
  const summary = summarizeGesture(raw);
  return {
    metrics: summary.metrics,
    diagnostics: {
      name: scenario.surface === 'editor' ? 'entity-drag-draw' : 'map-drag',
      frameSource: mapMeasurements ? 'map-render' : 'animation-frame-proxy',
      inputToNextPaintMs: raw.inputToNextPaintMs,
      paintedFrameMs: raw.paintedFrameMs,
      unexpectedLongTaskMs: raw.longTaskMs.filter((duration) => duration > 50),
      actions: direct.actions,
    },
    counters: {
      ...summary.counters,
      phaseCounters,
    },
  };
}

async function closeContext(context: BrowserContext): Promise<void> {
  try {
    await context.close();
  } catch {
    // Preserve the measurement error that caused cleanup.
  }
}

async function waitForScenarioReady(
  page: Page,
  scenario: PerfScenario,
  expectedName: string,
): Promise<void> {
  await page.locator(scenario.readySelector).first().waitFor({
    state: 'visible',
    timeout: 60_000,
  });
  if (scenario.surface === 'editor') {
    const name = page.getByLabel('System name');
    await name.waitFor({ state: 'visible', timeout: 60_000 });
    if ((await name.inputValue()) !== expectedName) {
      throw new Error(`${scenario.id} fixture did not become the active system.`);
    }
  } else if (scenario.surface === 'share') {
    if ((await page.locator('.ro-name').textContent())?.trim() !== expectedName) {
      throw new Error(`${scenario.id} share did not render the expected system.`);
    }
  } else {
    await page.waitForFunction(
      (name) => {
        const status = document.getElementById('embed-status');
        return status?.hidden === true && document.title.startsWith(name);
      },
      expectedName,
      { timeout: 60_000 },
    );
  }
  await page.evaluate(
    () =>
      new Promise<void>((resolvePromise) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolvePromise()));
      }),
  );
  await page.waitForTimeout(250);
}

async function runSample(options: RunSampleOptions): Promise<PerfSample | undefined> {
  const context = await options.browser.newContext({
    viewport: {
      width: activeProtocol.viewport.width,
      height: activeProtocol.viewport.height,
    },
    deviceScaleFactor: activeProtocol.viewport.deviceScaleFactor,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  let traceStarted = false;

  try {
    await configureProtocol(session);
    const fixture = generatePerfFixture(options.scenario.fixtureId);
    const serializedFixture = JSON.stringify(fixture);
    const persistence = await measurePersistencePhases(
      page,
      session,
      options.previewUrl,
      serializedFixture,
    );
    await installMeasurementState(page, serializedFixture, fixture.id);
    await configureSurfaceRoutes(page, options.scenario, serializedFixture);
    if (options.tracePath) {
      await startTrace(session);
      traceStarted = true;
    }

    await page.goto(`${options.previewUrl}${options.scenario.path}`, {
      waitUntil: 'load',
      timeout: 60_000,
    });
    await waitForScenarioReady(page, options.scenario, fixture.name);
    const startup = await collectStartupMetrics(page);
    const entityCoord = fixture.stations[Math.floor(fixture.stations.length / 2)]?.coord;
    const gesture = await runMeasuredGesture(page, options.scenario, entityCoord);
    const coldMemory = await collectMemory(session);

    await page.reload({ waitUntil: 'load', timeout: 60_000 });
    await waitForScenarioReady(page, options.scenario, fixture.name);
    const warmStartup = await collectStartupMetrics(page);
    const warmGesture = await runMeasuredGesture(page, options.scenario, entityCoord);
    const warmMemory = await collectMemory(session);
    const metrics: PerfMetricValues = {
      ...startup.metrics,
      ...gesture.metrics,
      warmLoadMs: warmStartup.metrics.loadMs,
      warmLargestContentfulPaintMs: warmStartup.metrics.largestContentfulPaintMs,
      warmCumulativeLayoutShift: warmStartup.metrics.cumulativeLayoutShift,
      warmInputToNextPaintP95Ms: warmGesture.metrics.inputToNextPaintP95Ms,
    };

    if (options.tracePath) {
      await stopTrace(session, options.tracePath);
      traceStarted = false;
    }
    if (options.measuredRun === undefined) return undefined;
    return {
      scenarioId: options.scenario.id,
      run: options.measuredRun,
      metrics,
      gesture: gesture.diagnostics,
      warmGesture: warmGesture.diagnostics,
      counters: {
        ...gesture.counters,
        domNodeCount: coldMemory.domNodeCount,
      },
      warmCounters: {
        ...warmGesture.counters,
        domNodeCount: warmMemory.domNodeCount,
      },
      network: startup.network,
      warmNetwork: warmStartup.network,
      memory: coldMemory.memory,
      warmMemory: warmMemory.memory,
      persistence,
      traceArtifact: options.tracePath
        ? relative(options.outputDirectory, options.tracePath)
        : undefined,
    };
  } finally {
    if (traceStarted) {
      try {
        await session.send('Tracing.end');
      } catch {
        // The run's original error is more useful than trace cleanup failure.
      }
    }
    await closeContext(context);
  }
}

async function runScenario(options: RunScenarioOptions): Promise<PerfSample[]> {
  console.log(`perf ${options.scenario.id}: warm-up`);
  await runSample({
    browser: options.browser,
    previewUrl: options.previewUrl,
    scenario: options.scenario,
    outputDirectory: options.outputDirectory,
  });

  const samples: PerfSample[] = [];
  for (let run = 1; run <= activeProtocol.measuredRuns; run += 1) {
    const tracePath = options.record
      ? resolve(options.outputDirectory, 'traces', `${options.scenario.id}-run-${run}.trace.json`)
      : undefined;
    console.log(`perf ${options.scenario.id}: measured run ${run}/${activeProtocol.measuredRuns}`);
    const sample = await runSample({
      browser: options.browser,
      previewUrl: options.previewUrl,
      scenario: options.scenario,
      outputDirectory: options.outputDirectory,
      measuredRun: run,
      tracePath,
    });
    if (!sample) throw new Error(`${options.scenario.id} run ${run} produced no sample.`);
    samples.push(sample);
  }
  return samples;
}

async function runCalibration(browser: Browser): Promise<PerfCalibration> {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  try {
    await session.send('Emulation.setCPUThrottlingRate', {
      rate: activeProtocol.cpuThrottlingRate,
    });
    const samplesMs = await page.evaluate(() => {
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
      return measurements;
    });
    const sorted = [...samplesMs].sort((left, right) => left - right);
    return {
      benchmark: 'integer-mix-v1',
      samplesMs,
      medianMs: sorted[Math.floor(sorted.length / 2)],
    };
  } finally {
    await closeContext(context);
  }
}

async function verifyCacheEvictedOfflineReload(
  browser: Browser,
  previewUrl: string,
  outputDirectory: string,
): Promise<void> {
  const context = await browser.newContext({
    viewport: {
      width: activeProtocol.viewport.width,
      height: activeProtocol.viewport.height,
    },
    deviceScaleFactor: activeProtocol.viewport.deviceScaleFactor,
    serviceWorkers: 'allow',
  });
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  const fixture = generatePerfFixture('small');
  try {
    await installMeasurementState(page, JSON.stringify(fixture), fixture.id);
    await page.goto(`${previewUrl}/`, { waitUntil: 'load', timeout: 60_000 });
    const name = page.getByLabel('System name');
    await name.waitFor({ state: 'visible', timeout: 60_000 });
    const initialDocumentName = await name.inputValue();
    if (initialDocumentName !== fixture.name) {
      const storageState = await page.evaluate(() => ({
        activeId: localStorage.getItem('transitmapper:activeId'),
        activeSystem: localStorage
          .getItem(`transitmapper:system:${localStorage.getItem('transitmapper:activeId') ?? ''}`)
          ?.slice(0, 80),
      }));
      throw new Error(
        `The online PWA bootstrap restored "${initialDocumentName}" instead of ` +
          `"${fixture.name}" (${JSON.stringify(storageState)}).`,
      );
    }
    await page.evaluate(async () => navigator.serviceWorker.ready);
    if (!(await page.evaluate(() => navigator.serviceWorker.controller !== null))) {
      await page.reload({ waitUntil: 'load', timeout: 60_000 });
    }
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 30_000,
    });

    // The reload below cannot succeed through Chrome's HTTP cache. Every
    // local byte has to come from the installed Workbox precache.
    await session.send('Network.clearBrowserCache');
    await context.setOffline(true);
    await page.reload({ waitUntil: 'load', timeout: 60_000 });
    await name.waitFor({ state: 'visible', timeout: 60_000 });
    const documentName = await name.inputValue();
    if (documentName !== fixture.name) {
      throw new Error(
        `The cache-evicted offline reload restored "${documentName}" instead of ` +
          `"${fixture.name}".`,
      );
    }
    const report: OfflineRuntimeReport = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      cacheEvicted: true,
      offline: true,
      serviceWorkerControlled: true,
      documentName,
    };
    await writeFile(
      resolve(outputDirectory, PWA_RUNTIME_REPORT_FILENAME),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8',
    );
    console.log('PWA runtime: cache-evicted offline editor reload passed.');
  } finally {
    await context.setOffline(false).catch(() => undefined);
    await closeContext(context);
  }
}

async function listenerCount(session: CDPSession): Promise<number> {
  let total = 0;
  for (const expression of ['window', 'document', 'document.querySelector(".maplibregl-canvas")']) {
    const evaluated = (await session.send('Runtime.evaluate', {
      expression,
      returnByValue: false,
    })) as RuntimeObjectResult;
    const objectId = evaluated.result.objectId;
    if (!objectId) continue;
    const result = (await session.send('DOMDebugger.getEventListeners', {
      objectId,
    })) as ListenerResult;
    total += result.listeners.length;
    await session.send('Runtime.releaseObject', { objectId });
  }
  return total;
}

async function soakSnapshot(
  page: Page,
  session: CDPSession,
  startedAt: number,
): Promise<SoakSnapshot> {
  await session.send('HeapProfiler.collectGarbage');
  const { memory, domNodeCount } = await collectMemory(session);
  return {
    elapsedMs: Date.now() - startedAt,
    jsHeapUsedBytes: memory.jsHeapUsedBytes,
    domNodeCount,
    listenerCount: await listenerCount(session),
    workerCount: page.workers().length,
    webGlContextCount: await page.evaluate(
      () => (window as PerfPageWindow).__perfWebGlContextCount ?? 0,
    ),
  };
}

function soakViolations(initial: SoakSnapshot, final: SoakSnapshot): string[] {
  const violations: string[] = [];
  const metrics: Array<keyof Omit<SoakSnapshot, 'elapsedMs'>> = [
    'jsHeapUsedBytes',
    'domNodeCount',
    'listenerCount',
    'workerCount',
    'webGlContextCount',
  ];
  for (const metric of metrics) {
    const initialValue = initial[metric];
    const finalValue = final[metric];
    const limit = initialValue === 0 ? 0 : initialValue * 1.1;
    if (finalValue > limit) {
      violations.push(
        `${metric} grew from ${initialValue} to ${finalValue}; the 10% limit is ${limit}.`,
      );
    }
  }
  return violations;
}

async function runBalancedSoakPan(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await (window as PerfPageWindow).__panGestureBench?.({
      steps: 40,
      dx: 4,
    });
    await (window as PerfPageWindow).__panGestureBench?.({
      steps: 40,
      dx: -4,
    });
  });
}

async function runSoakEditCycle(page: Page, coord: LngLat): Promise<void> {
  const target = await page.evaluate((stationCoord) => {
    const project = (window as PerfPageWindow).__perfProjectLngLat;
    if (!project) throw new Error('The soak station projection seam is unavailable.');
    return project(stationCoord);
  }, coord);
  await page.keyboard.press('v');
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await page.mouse.move(target.x + 24, target.y + 12, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  // Include validation and the content/camera persistence lane, then leave the
  // document at its deterministic starting shape for the next cycle.
  await page.waitForTimeout(550);
}

async function runSoakExportCycle(page: Page): Promise<void> {
  await page.locator('button[title="Export…"]').click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible', timeout: 30_000 });
  await dialog.locator('.export-preview-map .maplibregl-canvas').waitFor({
    state: 'visible',
    timeout: 30_000,
  });
  await page.waitForTimeout(250);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await dialog.waitFor({ state: 'detached', timeout: 5_000 });
}

async function runSoak(
  browser: Browser,
  previewUrl: string,
  outputDirectory: string,
  durationMs: number,
): Promise<SoakReport> {
  const context = await browser.newContext({
    viewport: {
      width: activeProtocol.viewport.width,
      height: activeProtocol.viewport.height,
    },
    deviceScaleFactor: activeProtocol.viewport.deviceScaleFactor,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  const fixture = generatePerfFixture('rtc');
  try {
    await configureProtocol(session);
    await session.send('HeapProfiler.enable');
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
        if (
          context &&
          (contextId === 'webgl' || contextId === 'webgl2') &&
          !contexts.has(context)
        ) {
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
    await installMeasurementState(page, JSON.stringify(fixture), fixture.id);
    await page.goto(`${previewUrl}/`, { waitUntil: 'load', timeout: 60_000 });
    await waitForScenarioReady(page, PERF_SCENARIOS.rtc, fixture.name);
    await page.waitForFunction(
      () => typeof (window as PerfPageWindow).__panGestureBench === 'function',
      undefined,
      { timeout: 30_000 },
    );
    for (let warmup = 0; warmup < 3; warmup += 1) {
      await runBalancedSoakPan(page);
    }

    const startedAt = Date.now();
    const initial = await soakSnapshot(page, session, startedAt);
    const stationCoord = fixture.stations[Math.floor(fixture.stations.length / 2)]?.coord;
    if (!stationCoord) throw new Error('The RTC soak fixture has no station target.');
    let iterations = 0;
    let editCycles = 0;
    let exportDialogCycles = 0;
    console.log(`perf soak: exercising RTC scale for ${durationMs} ms`);
    while (Date.now() - startedAt < durationMs) {
      await runBalancedSoakPan(page);
      iterations += 1;
      if (iterations % 4 === 0) {
        await runSoakEditCycle(page, stationCoord);
        editCycles += 1;
      }
      if (iterations % 8 === 0) {
        await runSoakExportCycle(page);
        exportDialogCycles += 1;
      }
      await page.waitForTimeout(100);
    }
    // Let dialog MapLibre workers and contexts observe unmount before the
    // forced-GC final snapshot.
    await page.waitForTimeout(1_000);
    const final = await soakSnapshot(page, session, startedAt);
    const violations = soakViolations(initial, final);
    const report: SoakReport = {
      schemaVersion: 1,
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
      webGlContextCountSource: 'created-minus-context-lost-events',
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

async function readBaseline(path: string | undefined): Promise<PerfReport | undefined> {
  if (!path) return undefined;
  try {
    return JSON.parse(await readFile(path, 'utf8')) as PerfReport;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function readBundleEntries(): Promise<PerfBundleEntry[]> {
  const report = JSON.parse(await readFile(BUNDLE_REPORT_PATH, 'utf8')) as BundleReportFile;
  if (!Array.isArray(report.entries)) {
    throw new Error('The generated bundle report has no entries.');
  }
  return report.entries.map((entry) => ({
    entry: entry.entry,
    rawBytes: entry.rawBytes,
    gzipBytes: entry.gzipBytes,
    brotliBytes: entry.brotliBytes,
  }));
}

function checkedBaselinePath(profile: PerfProfileId): string {
  const filename = profile === 'desktop' ? 'baseline.json' : 'baseline-mobile.json';
  return resolve(APP_ROOT, PERF_BASELINE_DIRECTORY, filename);
}

async function writeCheckedBaseline(path: string, report: PerfReport): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function writeReport(outputDirectory: string, report: PerfReport): Promise<string> {
  const path = resolve(outputDirectory, REPORT_FILENAME);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return path;
}

async function copyBuildReports(outputDirectory: string): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });
  await copyFile(BUNDLE_REPORT_PATH, resolve(outputDirectory, basename(BUNDLE_REPORT_PATH)));
  await copyFile(PWA_REPORT_PATH, resolve(outputDirectory, basename(PWA_REPORT_PATH)));
}

function reportEvaluation(evaluation: PerfBudgetEvaluation): void {
  for (const notice of evaluation.notices) console.warn(`performance budget: ${notice}`);
  for (const violation of evaluation.violations) {
    console.error(`performance budget: ${violation.message}`);
  }
}

function chromeUnavailableReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("Chromium distribution 'chrome' is not found") ||
    message.includes("Executable doesn't exist") ||
    message.includes('Failed to launch')
  ) {
    return (
      'Google Chrome is required for the fixed headed performance protocol, but it could not ' +
      `be launched. Install stable Chrome and retry. Original error: ${message}`
    );
  }
  return message;
}

async function run(options: PerfCliOptions): Promise<void> {
  if (options.record && options.scenarioId) {
    throw new Error('--record requires the full scenario matrix; omit --scenario.');
  }
  if (options.soak && (options.record || options.scenarioId)) {
    throw new Error('--soak cannot be combined with --record or --scenario.');
  }
  if (!options.soak && options.soakDurationMs !== 10 * 60 * 1_000) {
    throw new Error('--soak-duration requires --soak.');
  }
  if (options.soak && options.profile !== 'desktop') {
    throw new Error('--soak uses the desktop RTC protocol; omit --profile mobile.');
  }
  activeProtocol = createPerfProtocol(options.profile);
  const scenarios = options.scenarioId
    ? PERF_SCENARIO_LIST.filter((scenario) => scenario.id === options.scenarioId)
    : PERF_SCENARIO_LIST;
  await mkdir(options.outputDirectory, { recursive: true });
  if (!options.skipBuild) await runCommand('pnpm', ['run', 'build']);
  await copyBuildReports(options.outputDirectory);
  const bundles = await readBundleEntries();
  const baseline = await readBaseline(options.baselinePath ?? checkedBaselinePath(options.profile));

  let preview: RunningPreview | undefined;
  let browser: Browser | undefined;
  let calibration: PerfCalibration | undefined;
  try {
    preview = await startPreview();
    browser = await chromium.launch({
      channel: activeProtocol.browserChannel,
      headless: false,
    });
    if (options.soak) {
      const soak = await runSoak(
        browser,
        preview.url,
        options.outputDirectory,
        options.soakDurationMs,
      );
      if (soak.status !== 'pass') process.exitCode = 1;
      return;
    }
    calibration = await runCalibration(browser);
    await verifyCacheEvictedOfflineReload(browser, preview.url, options.outputDirectory);
    const samples: PerfSample[] = [];
    for (const scenario of scenarios) {
      samples.push(
        ...(await runScenario({
          browser,
          previewUrl: preview.url,
          scenario,
          outputDirectory: options.outputDirectory,
          record: options.record,
        })),
      );
    }
    const report = createPerfReport({
      generatedAt: new Date().toISOString(),
      protocol: activeProtocol,
      scenarios,
      samples,
      bundles,
      calibration,
    });
    const evaluation = evaluatePerfBudgets({
      report,
      baseline,
      scenarios,
      maxRegressionRatio: PERF_MAX_REGRESSION_RATIO,
      requireBaseline: options.requireBaseline,
    });
    report.evaluation = evaluation;
    const reportPath = await writeReport(options.outputDirectory, report);
    if (options.record) {
      const path = checkedBaselinePath(options.profile);
      await writeCheckedBaseline(path, report);
      console.log(`performance baseline refreshed: ${path}`);
    }
    reportEvaluation(evaluation);
    console.log(`performance report: ${reportPath}`);
    if (evaluation.status !== 'pass') process.exitCode = 1;
  } catch (error) {
    const reason = chromeUnavailableReason(error);
    const report = createUnavailablePerfReport({
      generatedAt: new Date().toISOString(),
      protocol: activeProtocol,
      scenarios,
      reason,
      bundles,
      calibration,
    });
    const reportPath = await writeReport(options.outputDirectory, report);
    console.error(`performance unavailable: ${reason}`);
    console.error(`performance report: ${reportPath}`);
    process.exitCode = 2;
  } finally {
    await browser?.close();
    await stopPreview(preview);
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  await run(options);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`performance harness failed before it could write a report: ${message}`);
  process.exitCode = 2;
});
