import { readFile } from 'node:fs/promises';
import type { Browser, BrowserContext, CDPSession, Frame, Page } from 'playwright-core';
import { generatePerfFixture } from '../../src/perf/fixtures';
import {
  AUTOMATIC_FIRST_SESSION_BOUNDARY_MS,
  createFirstSessionTimeline,
  type PerfFirstSessionTimeline,
} from '../../src/perf/first-session-timeline';
import {
  FIRST_SESSION_MARK_NAMES,
  FIRST_SYSTEM_PAINT_MARK,
  INTERACTIVE_MARK,
  type FirstSessionMarkName,
} from '../../src/perf/startup-marks';
import { PERF_SCENARIOS } from '../../src/perf/scenarios';
import type {
  PerfFirstSessionJourney,
  PerfFirstSessionSample,
  PerfProtocol,
  PerfScenario,
} from '../../src/perf/types';
import type {
  PerfRenderBlockingStatus,
  PerfResourceTimingAttribution,
} from '../../src/perf/network-byte-types';
import { createCdpNetworkRecorder, type CdpNetworkRecorder } from './cdp-network-recorder';
import { connectChromeFlatCdp } from './flat-cdp-connection';
import { LEGACY_497A549_FIRST_SESSION_INIT_SCRIPT } from './legacy-first-session-marks';
import { closeContext, configureProtocol, configureSurfaceRoutes } from './browser';
import {
  captureFirstSession,
  type FirstSessionPageDriver,
  type FirstSessionServiceWorkerPolicy,
} from './first-session';
import type { FirstSessionSurfaceRunner } from './first-session-matrix';

interface BrowserTimelineSnapshot {
  navigationTimeOriginMs: number;
  documentResponseEndMs: number;
  marks: Partial<Record<FirstSessionMarkName, number>>;
}

type ResourceTimingWithRenderBlocking = PerformanceResourceTiming & {
  readonly renderBlockingStatus?: string;
};

type MeasuredPage = Page | Frame;

interface PlaywrightFirstSessionDriverOptions {
  navigate(): Promise<MeasuredPage>;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function crossSiteEmbedHostHtml(embedUrl: string): string {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><link rel="icon" href="data:,"><title>Cross-site embed host</title></head>
  <body style="margin:0">
    <iframe
      id="tm-perf-embed"
      title="TransitMapper performance embed"
      loading="lazy"
      src="${escapeHtmlAttribute(embedUrl)}"
      style="display:block;border:0;width:100vw;height:100vh"
    ></iframe>
  </body>
</html>`;
}

export function crossSiteEmbedHostUrl(_embedUrl: string): string {
  return 'https://transitmapper-perf-host.invalid/first-session';
}

class PlaywrightFirstSessionDriver implements FirstSessionPageDriver {
  private target: MeasuredPage | null = null;

  constructor(private readonly options: PlaywrightFirstSessionDriverOptions) {}

  private measuredPage(): MeasuredPage {
    if (!this.target) throw new Error('The measured first-session page has not navigated.');
    return this.target;
  }

  async navigate(): Promise<void> {
    this.target = await this.options.navigate();
  }

  async waitForInteractive(): Promise<void> {
    await this.measuredPage().waitForFunction(
      (markName) => performance.getEntriesByName(markName, 'mark').length > 0,
      INTERACTIVE_MARK,
      { timeout: 30_000 },
    );
  }

  async waitForFirstSystemPaint(): Promise<void> {
    await this.measuredPage().waitForFunction(
      (markName) => performance.getEntriesByName(markName, 'mark').length > 0,
      FIRST_SYSTEM_PAINT_MARK,
      { timeout: 60_000 },
    );
  }

  async waitForAutomaticBoundary(): Promise<void> {
    await this.measuredPage().evaluate(
      (boundaryMs) =>
        new Promise<void>((resolvePromise) => {
          const remainingMs = Math.max(0, boundaryMs - performance.now());
          setTimeout(resolvePromise, remainingMs);
        }),
      AUTOMATIC_FIRST_SESSION_BOUNDARY_MS,
    );
  }

  async readTimeline(networkIdleMs: number | null): Promise<PerfFirstSessionTimeline> {
    const snapshot = await this.measuredPage().evaluate((markNames): BrowserTimelineSnapshot => {
      const navigation = performance.getEntriesByType('navigation')[0] as
        PerformanceNavigationTiming | undefined;
      if (!navigation) throw new Error('The first-session navigation timing is unavailable.');
      const marks: Partial<Record<FirstSessionMarkName, number>> = {};
      for (const name of markNames) {
        const entry = performance.getEntriesByName(name, 'mark').at(0);
        if (entry) marks[name] = entry.startTime;
      }
      return {
        navigationTimeOriginMs: performance.timeOrigin,
        documentResponseEndMs: navigation.responseEnd,
        marks,
      };
    }, FIRST_SESSION_MARK_NAMES);
    return createFirstSessionTimeline({
      ...snapshot,
      networkIdleMs,
    });
  }

  async readResourceTimings(): Promise<readonly PerfResourceTimingAttribution[]> {
    return this.measuredPage().evaluate(() => {
      const entries = [
        ...performance.getEntriesByType('navigation'),
        ...performance.getEntriesByType('resource'),
      ] as ResourceTimingWithRenderBlocking[];
      return entries.map((entry) => {
        const rawStatus = (entry.renderBlockingStatus ?? '').toLowerCase();
        let renderBlockingStatus: PerfRenderBlockingStatus = 'unknown';
        if (rawStatus === 'blocking') renderBlockingStatus = 'blocking';
        else if (rawStatus === 'non-blocking') renderBlockingStatus = 'non-blocking';
        return {
          url: entry.name,
          startTimeMs: entry.startTime,
          initiatorType: entry.initiatorType,
          nextHopProtocol: entry.nextHopProtocol,
          renderBlockingStatus,
          transferSize: entry.transferSize,
          encodedBodySize: entry.encodedBodySize,
          decodedBodySize: entry.decodedBodySize,
        };
      });
    });
  }

  async readServiceWorkerRegistrationCount(): Promise<number> {
    return this.measuredPage().evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 0;
      return (await navigator.serviceWorker.getRegistrations()).length;
    });
  }
}

function directNavigation(page: Page, url: string): () => Promise<MeasuredPage> {
  return async () => {
    await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
    return page;
  };
}

function crossSiteNavigation(page: Page, embedUrl: string): () => Promise<MeasuredPage> {
  return async () => {
    const hostUrl = crossSiteEmbedHostUrl(embedUrl);
    await page.route(
      hostUrl,
      (route) => {
        return route.fulfill({
          status: 200,
          contentType: 'text/html',
          headers: { 'cache-control': 'no-store' },
          body: crossSiteEmbedHostHtml(embedUrl),
        });
      },
      { times: 1 },
    );
    await page.goto(hostUrl, {
      waitUntil: 'load',
      timeout: 60_000,
    });
    const handle = await page.locator('#tm-perf-embed').elementHandle();
    const frame = await handle.contentFrame();
    if (!frame) throw new Error('The cross-site TransitMapper iframe did not attach.');
    await frame.waitForLoadState('load', { timeout: 60_000 });
    return frame;
  };
}

async function createRecorder(
  context: BrowserContext,
  page: Page,
  previewUrl: string,
  debuggingPort: number,
): Promise<{ recorder: CdpNetworkRecorder; pageSession: CDPSession }> {
  const pageSession = await context.newCDPSession(page);
  const targetInfo = await pageSession.send('Target.getTargetInfo');
  const connection = await connectChromeFlatCdp(debuggingPort);
  const recorder = createCdpNetworkRecorder({
    connection,
    pageTargetId: targetInfo.targetInfo.targetId,
    applicationOrigin: new URL(previewUrl).origin,
  });
  return { recorder, pageSession };
}

interface RunSurfaceFirstSessionOptions {
  browser: Browser;
  protocol: PerfProtocol;
  previewUrl: string;
  scenario: PerfScenario;
  journey: PerfFirstSessionJourney;
  crossSite: boolean;
  debuggingPort: number;
  embedHtmlPath?: string;
  historicalMilestoneInitScript?: string;
  serviceWorkerPolicy?: FirstSessionServiceWorkerPolicy;
}

async function runSurfaceFirstSession(
  options: RunSurfaceFirstSessionOptions,
): Promise<PerfFirstSessionSample> {
  const context = await options.browser.newContext({
    viewport: {
      width: options.protocol.viewport.width,
      height: options.protocol.viewport.height,
    },
    deviceScaleFactor: options.protocol.viewport.deviceScaleFactor,
    reducedMotion: 'no-preference',
    serviceWorkers: 'allow',
  });
  const page = await context.newPage();
  let recorder: CdpNetworkRecorder | undefined;
  try {
    if (options.historicalMilestoneInitScript) {
      await page.addInitScript({ content: options.historicalMilestoneInitScript });
    }
    if (options.scenario.surface !== 'editor') {
      const serialized = JSON.stringify(generatePerfFixture(options.scenario.fixtureId));
      await configureSurfaceRoutes(page, options.scenario, serialized);
    }
    if (options.scenario.surface === 'embed' && options.embedHtmlPath) {
      const embedHtml = await readFile(options.embedHtmlPath, 'utf8');
      await page.route(`**${options.scenario.path}`, async (route) => {
        await route.fulfill({ status: 200, contentType: 'text/html', body: embedHtml });
      });
    }
    const created = await createRecorder(context, page, options.previewUrl, options.debuggingPort);
    recorder = created.recorder;
    await configureProtocol(created.pageSession, options.protocol);
    await recorder.start();
    const surfaceUrl = `${options.previewUrl}${options.scenario.path}`;
    const navigate = options.crossSite
      ? crossSiteNavigation(page, surfaceUrl)
      : directNavigation(page, surfaceUrl);
    return await captureFirstSession({
      driver: new PlaywrightFirstSessionDriver({ navigate }),
      recorder,
      journey: options.journey,
      surface: options.scenario.surface,
      cacheState: 'cold',
      serviceWorkerPolicy: options.serviceWorkerPolicy,
    });
  } finally {
    await recorder?.stop();
    await closeContext(context);
  }
}

export async function runNewUserFirstSession(
  browser: Browser,
  protocol: PerfProtocol,
  previewUrl: string,
  debuggingPort: number,
): Promise<PerfFirstSessionSample> {
  return runSurfaceFirstSession({
    browser,
    protocol,
    previewUrl,
    scenario: PERF_SCENARIOS.small,
    journey: 'new-user-editor',
    crossSite: false,
    debuggingPort,
  });
}

export async function runPublicShareFirstSession(
  browser: Browser,
  protocol: PerfProtocol,
  previewUrl: string,
  debuggingPort: number,
): Promise<PerfFirstSessionSample> {
  return runSurfaceFirstSession({
    browser,
    protocol,
    previewUrl,
    scenario: PERF_SCENARIOS.viewer,
    journey: 'public-share',
    crossSite: false,
    debuggingPort,
  });
}

export async function runCrossSiteEmbedFirstSession(
  browser: Browser,
  protocol: PerfProtocol,
  previewUrl: string,
  debuggingPort: number,
): Promise<PerfFirstSessionSample> {
  return runSurfaceFirstSession({
    browser,
    protocol,
    previewUrl,
    scenario: PERF_SCENARIOS.embed,
    journey: 'cross-site-embed',
    crossSite: true,
    debuggingPort,
  });
}

export interface PlaywrightFirstSessionSurfaceRunnerOptions {
  browser: Browser;
  protocol: PerfProtocol;
  previewUrl: string;
  debuggingPort: number;
  /** Only populated by the historic baseline recorder. */
  embedHtmlPath?: string;
  /** A pre-navigation observer which must not alter application traffic. */
  historicalMilestoneInitScript?: string;
  serviceWorkerPolicy?: FirstSessionServiceWorkerPolicy;
}

export function createPlaywrightFirstSessionSurfaceRunner(
  options: PlaywrightFirstSessionSurfaceRunnerOptions,
): FirstSessionSurfaceRunner {
  const { browser, protocol, previewUrl, debuggingPort, ...runOptions } = options;
  return {
    runNewUserEditor: () =>
      runSurfaceFirstSession({
        browser,
        protocol,
        previewUrl,
        scenario: PERF_SCENARIOS.small,
        journey: 'new-user-editor',
        crossSite: false,
        debuggingPort,
        ...runOptions,
      }),
    runPublicShare: () =>
      runSurfaceFirstSession({
        browser,
        protocol,
        previewUrl,
        scenario: PERF_SCENARIOS.viewer,
        journey: 'public-share',
        crossSite: false,
        debuggingPort,
        ...runOptions,
      }),
    runCrossSiteEmbed: () =>
      runSurfaceFirstSession({
        browser,
        protocol,
        previewUrl,
        scenario: PERF_SCENARIOS.embed,
        journey: 'cross-site-embed',
        crossSite: true,
        debuggingPort,
        ...runOptions,
      }),
  };
}

/**
 * Use only while recording the immutable 497a549 baseline. Current artifacts
 * carry their own `tm:*` marks and must never receive this observer shim.
 */
export function createLegacy497a549FirstSessionSurfaceRunner(
  options: Legacy497a549FirstSessionSurfaceRunnerOptions,
): FirstSessionSurfaceRunner {
  return createPlaywrightFirstSessionSurfaceRunner({
    ...options,
    historicalMilestoneInitScript: LEGACY_497A549_FIRST_SESSION_INIT_SCRIPT,
    serviceWorkerPolicy: 'legacy-497a549',
  });
}

export interface Legacy497a549FirstSessionSurfaceRunnerOptions {
  browser: Browser;
  protocol: PerfProtocol;
  previewUrl: string;
  debuggingPort: number;
  embedHtmlPath: string;
}
