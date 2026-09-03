import { basename } from 'node:path';
import type { TransitSystem } from '@transitmapper/core/model/system';
import type { BrowserContext, Page } from 'playwright-core';
import type { PerfProfileId } from '../../src/perf/types';
import type { RendererCaptureCase } from '../../src/perf/renderer-capture';
import type { RendererStatsSnapshot } from '@transitmapper/renderer/stats';
import { seedIndexedDbFixture } from '../perf/browser';
import { waitForLoadedDocument } from '../perf/journeys';
import { assertRendererCaptureHasSceneContent } from './capture-image-validation';
import { rendererBasemapStyleForUrl, rendererSeedPageUrl } from './lifecycle';

const EXTERNAL_URL = /^https?:\/\/(?!127\.0\.0\.1(?::\d+)?(?:\/|$)|localhost(?::\d+)?(?:\/|$))/;

/** Long enough for a cold fixture on a loaded machine, short enough that a
 * stalled run reports rather than occupying an operator for an afternoon. */
const CAPTURE_STEP_TIMEOUT_MS = 120_000;
const DIAGNOSTICS_TIMEOUT_MS = 10_000;

let captureBaseUrl: string | null = null;

/** Playwright bounds its own waits, but `page.evaluate` has no timeout: an
 * in-page settle that never resolves used to hang the whole capture silently.
 * Every such await gets a deadline whose message names the step and fixture,
 * so a stall is a reported failure rather than an operator's guess. */
export async function withCaptureDeadline<T>(
  label: string,
  step: Promise<T>,
  timeoutMs: number = CAPTURE_STEP_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} did not finish within ${Math.round(timeoutMs / 1_000)}s.`)),
      timeoutMs,
    );
  });
  // The losing promise keeps running, so give it a handler of its own. The
  // race already has one, and a second observer does not swallow the first.
  void step.catch(() => {});
  try {
    return await Promise.race([step, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** The capture CLI owns one isolated preview server. Keeping its dynamically
 * assigned URL here prevents browser helpers from reviving a fixed port. */
export function configureRendererCaptureBaseUrl(url: string | null): void {
  captureBaseUrl = url;
}

export function rendererCaptureBaseUrl(): string {
  if (!captureBaseUrl) throw new Error('Renderer capture preview has not started.');
  return captureBaseUrl;
}

export function fixtureCenter(system: TransitSystem): [number, number] {
  return [system.viewport.center[0], system.viewport.center[1]];
}

export async function rendererStatsForPage(page: Page): Promise<RendererStatsSnapshot | null> {
  return page.evaluate(
    () =>
      (
        window as Window & {
          __rendererStats?: () => RendererStatsSnapshot;
        }
      ).__rendererStats?.() ?? null,
  );
}

export async function preventRemoteBasemap(context: BrowserContext): Promise<void> {
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    const blankStyle = rendererBasemapStyleForUrl(url);
    if (blankStyle) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(blankStyle),
      });
    } else if (EXTERNAL_URL.test(url)) await route.abort('blockedbyclient');
    else await route.continue();
  });
}

/** `subject` names whatever the caller is capturing. A font or paint that never
 * arrives stalls here, and the message is the only thing that says which one. */
export async function settleCapturePixels(
  page: Page,
  subject = 'the current capture',
): Promise<void> {
  await page.addStyleTag({
    content:
      '[data-renderer-capture-exclude="true"],.workspace-application-notice,.zen-restore,.maplibregl-ctrl{visibility:hidden!important}' +
      '.app[data-renderer-capture-bare] > :not(.maplibregl-map){visibility:hidden!important}' +
      '.app[data-renderer-capture-bare] .maplibregl-map{background-image:none!important}',
  });
  await withCaptureDeadline(
    `Capture pixel settling for ${subject}`,
    page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    }),
  );
}

export async function waitForSettledRenderer(page: Page, selector: string): Promise<void> {
  await page.locator(`${selector}[data-render-settled="true"]`).waitFor({
    state: 'visible',
    timeout: 60_000,
  });
  await settleCapturePixels(page);
}

export async function captureBareRenderer(page: Page, path: string): Promise<void> {
  const app = page.locator('.app');
  const subject = basename(path);
  await app.evaluate((element) => element.setAttribute('data-renderer-capture-bare', 'true'));
  try {
    await settleCapturePixels(page, subject);
    const image = await page
      .locator('.maplibregl-map')
      .screenshot({ path, animations: 'disabled' });
    try {
      await assertRendererCaptureHasSceneContent(image, subject);
    } catch (error) {
      // An empty frame is a renderer failure, not a screenshot failure. The
      // counters and bank state say whether anything was ever projected.
      throw new Error(
        `${error instanceof Error ? error.message : String(error)} ` +
          `Diagnostics: ${JSON.stringify(await captureDiagnostics(page))}`,
        { cause: error },
      );
    }
  } finally {
    await app.evaluate((element) => element.removeAttribute('data-renderer-capture-bare'));
  }
}

interface SeedEditorAttempt {
  page: Page;
  system: TransitSystem;
  pageErrors: readonly string[];
}

async function attachCaptureSeam({ page, system, pageErrors }: SeedEditorAttempt): Promise<void> {
  try {
    await page.waitForFunction(
      () => typeof window.__rendererCaptureSetCamera === 'function',
      null,
      {
        timeout: 60_000,
      },
    );
  } catch (error) {
    const body = (await page.locator('body').innerText()).slice(0, 2_000);
    throw new Error(
      `Renderer capture seam did not attach for ${system.id} at ${page.url()}. ` +
        `Page errors: ${pageErrors.join('\n') || 'none'}. Body: ${body}`,
      { cause: error },
    );
  }
}

async function awaitHealthyOverlay({ page, system, pageErrors }: SeedEditorAttempt): Promise<void> {
  try {
    await page.waitForFunction(
      () => {
        const overlay = window.__perfOverlaySnapshot?.();
        return overlay?.overlayHealthy && overlay.symbolLayerExists;
      },
      null,
      { timeout: 60_000 },
    );
  } catch (error) {
    throw new Error(
      `Renderer overlay never became healthy for ${system.id} at ${page.url()}. ` +
        `Diagnostics: ${JSON.stringify(await captureDiagnostics(page))}. ` +
        `Page errors: ${pageErrors.join('\n') || 'none'}`,
      { cause: error },
    );
  }
}

export async function seedEditor(page: Page, system: TransitSystem): Promise<void> {
  const baseUrl = rendererCaptureBaseUrl();
  const pageErrors: string[] = [];
  const recordPageError = (error: Error) => pageErrors.push(error.stack ?? error.message);
  page.on('pageerror', recordPageError);
  try {
    await page.goto(rendererSeedPageUrl(baseUrl), { waitUntil: 'load' });
    await seedIndexedDbFixture(page, JSON.stringify(system), {
      id: system.id,
      name: system.name,
      updatedAt: system.updatedAt,
    });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await waitForLoadedDocument(page);
    const attempt: SeedEditorAttempt = { page, system, pageErrors };
    await attachCaptureSeam(attempt);
    await awaitHealthyOverlay(attempt);
  } finally {
    page.off('pageerror', recordPageError);
  }
  await page.waitForTimeout(1_750);
  await settleCapturePixels(page, system.id);
}

interface RendererViewSelection {
  profile: PerfProfileId;
  viewMode: RendererCaptureCase['viewMode'];
  /** A calibrated desktop viewport can still use compact editor controls. */
  controls?: 'desktop' | 'compact';
}

export async function selectView(page: Page, capture: RendererViewSelection): Promise<void> {
  const label =
    capture.viewMode === 'infrastructure'
      ? 'Infrastructure'
      : capture.viewMode === 'network'
        ? 'Network'
        : 'Diagram';
  const controls = capture.controls ?? (capture.profile === 'desktop' ? 'desktop' : 'compact');
  if (controls === 'desktop') {
    await page.getByRole('group', { name: 'View' }).getByRole('button', { name: label }).click();
    return;
  }
  const trigger = page.getByRole('button', { name: /^View:/ });
  if ((await trigger.getAttribute('aria-label')) !== `View: ${label}`) {
    await trigger.click();
    await page.getByRole('menuitemradio', { name: label }).click();
  }
}

/** Read on the failure path only. The page may already be wedged, so this is
 * bounded too — an unbounded diagnostics read turns one stall into two. */
async function captureDiagnostics(page: Page): Promise<unknown> {
  return withCaptureDeadline(
    'Renderer capture diagnostics',
    page.evaluate(() => ({
      camera: window.__perfCameraSnapshot?.() ?? null,
      overlay: window.__perfOverlaySnapshot?.() ?? null,
      renderer: window.__rendererStats?.() ?? null,
      sourceUploads: window.__perfSourceUploadTimings?.() ?? null,
      sourceBanks: window.__perfRenderSourceBankSnapshot?.() ?? null,
    })),
    DIAGNOSTICS_TIMEOUT_MS,
  ).catch((error: unknown) => ({
    unavailable: error instanceof Error ? error.message : String(error),
  }));
}

export async function setSettledCamera(
  page: Page,
  system: TransitSystem,
  zoom: number,
  center: [number, number] = fixtureCenter(system),
): Promise<void> {
  try {
    await withCaptureDeadline(
      `Renderer camera settlement for ${system.id} at zoom ${zoom}`,
      page.evaluate(
        async ({ center: requestedCenter, requestedZoom }) => {
          const setCamera = window.__rendererCaptureSetCamera;
          if (!setCamera) throw new Error('Renderer capture camera seam is unavailable.');
          await setCamera({ center: requestedCenter, zoom: requestedZoom });
        },
        { center, requestedZoom: zoom },
      ),
    );
  } catch (error) {
    throw new Error(
      `Renderer camera settlement failed for ${system.id} at zoom ${zoom} ` +
        `centered on ${center.join(', ')}. Diagnostics: ${JSON.stringify(
          await captureDiagnostics(page),
        )}`,
      { cause: error },
    );
  }
  await settleCapturePixels(page, `${system.id} at zoom ${zoom}`);
}

export async function openExportDialog(page: Page, profile: PerfProfileId): Promise<void> {
  if (profile === 'desktop') {
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    return;
  }
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Export…' }).click();
}
