import type { Browser, Page } from 'playwright-core';
import { generatePerfFixture } from '../../src/perf/fixtures';
import type { PerfOnboardingSample, PerfProtocol } from '../../src/perf/types';
import { closeContext, configureProtocol, seedIndexedDbFixture } from './browser';
import {
  captureOnboardingJourney,
  type OnboardingJourneyDriver,
  type OnboardingJourneyObservations,
} from './onboarding-journey';

interface OnboardingBrowserProbe {
  measuring: boolean;
  longTasksMs: number[];
  lastLongTaskAt: number;
  uniquePreviewCanvasCount: number;
  webGlContextCount: number;
}

interface OnboardingProbeWindow extends Window {
  __perfOnboardingProbe?: OnboardingBrowserProbe;
}

type CanvasGetContext = (
  this: HTMLCanvasElement,
  contextId: string,
  options?: unknown,
) => RenderingContext | null;

async function installOnboardingProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state: OnboardingBrowserProbe = {
      measuring: false,
      longTasksMs: [],
      lastLongTaskAt: performance.now(),
      uniquePreviewCanvasCount: 0,
      webGlContextCount: 0,
    };
    (window as OnboardingProbeWindow).__perfOnboardingProbe = state;
    const canvasPrototype = HTMLCanvasElement.prototype as unknown as {
      getContext: CanvasGetContext;
    };
    const original = canvasPrototype.getContext;
    const contexts = new WeakSet<object>();
    const canvases = new WeakSet<HTMLCanvasElement>();
    canvasPrototype.getContext = function (
      this: HTMLCanvasElement,
      contextId: string,
      options?: unknown,
    ): RenderingContext | null {
      const context = original.call(this, contextId, options);
      const isPreview = this.closest('.onboarding-preview-map') !== null;
      if (
        context &&
        isPreview &&
        (contextId === 'webgl' || contextId === 'webgl2') &&
        !contexts.has(context)
      ) {
        contexts.add(context);
        state.webGlContextCount += 1;
        state.lastLongTaskAt = performance.now();
        if (!canvases.has(this)) {
          canvases.add(this);
          state.uniquePreviewCanvasCount += 1;
        }
      }
      return context;
    };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        state.lastLongTaskAt = performance.now();
        if (state.measuring) state.longTasksMs.push(entry.duration);
      }
    }).observe({ type: 'longtask', buffered: false });
  });
}

function remoteStyleRequest(url: string): boolean {
  const parsed = new URL(url);
  return parsed.hostname === 'tiles.openfreemap.org' && parsed.pathname.startsWith('/styles/');
}

/** Resolves once no long task has run for 500 ms.
 *
 * The preview map rewrites SRC_SERVICES on every animation frame while a scene
 * plays. A trusted click issued into that loop never completes its hit-target
 * round trip, so a slow frame surfaces as a 30-second click timeout instead of
 * as the long task it is. The slide-change tasks this journey measures are
 * recorded after the wait, so the numeric budget still sees them.
 */
async function waitForMainThreadQuiet(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const probe = (window as OnboardingProbeWindow).__perfOnboardingProbe;
      return probe !== undefined && performance.now() - probe.lastLongTaskAt >= 500;
    },
    undefined,
    { timeout: 30_000 },
  );
}

async function openOnboarding(
  page: Page,
  previewUrl: string,
  remoteStyleRequests: string[],
  startObservingRequests: () => void,
): Promise<void> {
  await page.goto(`${previewUrl}/`, { waitUntil: 'load', timeout: 60_000 });
  await page.locator('.app[data-document-status="ready"]').waitFor({
    state: 'attached',
    timeout: 60_000,
  });
  // Let the editor finish its 1.5-second basemap fallback lane before network
  // observation begins. The onboarding phase must not claim editor requests.
  await page.waitForTimeout(2_000);
  remoteStyleRequests.length = 0;
  startObservingRequests();
  const directReplay = page.getByLabel('Replay intro');
  if (await directReplay.isVisible()) await directReplay.click();
  else {
    await page.getByLabel('More actions').click();
    await page.getByText('Replay intro', { exact: true }).click();
  }
  await page.locator('.onboarding-step-count').waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('.onboarding-preview-map .maplibregl-canvas').waitFor({
    state: 'visible',
    timeout: 30_000,
  });
  await page.waitForFunction(
    () => (window as OnboardingProbeWindow).__perfOnboardingProbe?.webGlContextCount === 1,
    undefined,
    { timeout: 30_000 },
  );
  await waitForMainThreadQuiet(page);
}

function createOnboardingDriver(
  page: Page,
  previewUrl: string,
  remoteStyleRequests: string[],
  startObservingRequests: () => void,
): OnboardingJourneyDriver {
  let totalSlides = 0;
  return {
    open: () => openOnboarding(page, previewUrl, remoteStyleRequests, startObservingRequests),
    settle: () => waitForMainThreadQuiet(page),
    slideCount: async () => {
      const label = (await page.locator('.onboarding-step-count').textContent())?.trim() ?? '';
      const match = /^(\d+) of (\d+)$/.exec(label);
      if (!match) throw new Error(`Onboarding exposed an invalid step count: "${label}".`);
      totalSlides = Number(match[2]);
      return totalSlides;
    },
    beginSlideMeasurement: () =>
      page.evaluate(() => {
        const probe = (window as OnboardingProbeWindow).__perfOnboardingProbe;
        if (!probe) throw new Error('The onboarding browser probe is unavailable.');
        probe.longTasksMs.length = 0;
        probe.measuring = true;
      }),
    // Playwright's locator click dispatches a trusted browser pointer input.
    //
    // The generous timeout is the point of a functional smoke. Settling before
    // the click keeps it out of the worst of a scene animation, but the
    // renderer can saturate the main thread again while the click is in
    // flight, and a starved hit-test dispatch is a slow editor rather than a
    // broken one. Failing here would report the slowness as a journey that
    // does not work. The repeated audit owns timing and gates it; this gate
    // answers whether the four clicks advance the journey at all.
    clickNext: () => page.locator('.onboarding-next').click({ timeout: 120_000 }),
    waitForSlide: async (slide) => {
      await page.getByText(`${slide} of ${totalSlides}`, { exact: true }).waitFor({
        state: 'visible',
        timeout: 120_000,
      });
      await page.evaluate(
        () =>
          new Promise<void>((resolvePromise) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolvePromise()));
          }),
      );
    },
    finishSlideMeasurement: async () => {
      await page.waitForTimeout(100);
      return page.evaluate(() => {
        const probe = (window as OnboardingProbeWindow).__perfOnboardingProbe;
        if (!probe) throw new Error('The onboarding browser probe is unavailable.');
        probe.measuring = false;
        return [...probe.longTasksMs];
      });
    },
    observations: async (): Promise<OnboardingJourneyObservations> => {
      const browser = await page.evaluate(() => {
        const probe = (window as OnboardingProbeWindow).__perfOnboardingProbe;
        if (!probe) throw new Error('The onboarding browser probe is unavailable.');
        return {
          previewCanvasCount: document.querySelectorAll(
            '.onboarding-preview-map .maplibregl-canvas',
          ).length,
          uniquePreviewCanvasCount: probe.uniquePreviewCanvasCount,
          webGlContextCount: probe.webGlContextCount,
        };
      });
      return { ...browser, remoteStyleRequests: [...remoteStyleRequests] };
    },
  };
}

export async function capturePlaywrightOnboardingJourney(options: {
  browser: Browser;
  protocol: PerfProtocol;
  previewUrl: string;
}): Promise<PerfOnboardingSample> {
  const context = await options.browser.newContext({
    viewport: {
      width: options.protocol.viewport.width,
      height: options.protocol.viewport.height,
    },
    deviceScaleFactor: options.protocol.viewport.deviceScaleFactor,
    reducedMotion: 'no-preference',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  const remoteStyleRequests: string[] = [];
  let observeOnboardingRequests = false;
  page.on('request', (request) => {
    if (observeOnboardingRequests && remoteStyleRequest(request.url())) {
      remoteStyleRequests.push(request.url());
    }
  });
  try {
    await configureProtocol(session, options.protocol);
    await context.route('https://tiles.openfreemap.org/styles/**', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ version: 8, sources: {}, layers: [] }),
      }),
    );
    const fixture = generatePerfFixture('small');
    await page.goto(`${options.previewUrl}/favicon.svg`, { waitUntil: 'load', timeout: 60_000 });
    await seedIndexedDbFixture(page, JSON.stringify(fixture), fixture);
    await installOnboardingProbe(page);
    return await captureOnboardingJourney(
      createOnboardingDriver(page, options.previewUrl, remoteStyleRequests, () => {
        observeOnboardingRequests = true;
      }),
    );
  } finally {
    await closeContext(context);
  }
}
