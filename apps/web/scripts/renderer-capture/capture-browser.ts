import type { TransitSystem } from '@transitmapper/core/model/system';
import type { BrowserContext, Page } from 'playwright-core';
import type { PerfProfileId } from '../../src/perf/types';
import type { RendererCaptureCase } from '../../src/perf/renderer-capture';
import type { RendererStatsSnapshot } from '../../src/perf/renderer-stats';
import { seedIndexedDbFixture } from '../perf/browser';
import { waitForLoadedDocument } from '../perf/journeys';
import { PREVIEW_URL } from '../perf/process';
import { rendererBasemapStyleForUrl, rendererSeedPageUrl } from './lifecycle';

const EXTERNAL_URL = /^https?:\/\/(?!127\.0\.0\.1(?::\d+)?(?:\/|$)|localhost(?::\d+)?(?:\/|$))/;

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

export async function settleCapturePixels(page: Page): Promise<void> {
  await page.addStyleTag({
    content:
      '[data-renderer-capture-exclude="true"],.app-banner-slot,.zen-restore,.maplibregl-ctrl{visibility:hidden!important}' +
      '.app[data-renderer-capture-bare] > :not(.maplibregl-map){visibility:hidden!important}',
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
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
  await app.evaluate((element) => element.setAttribute('data-renderer-capture-bare', 'true'));
  try {
    await settleCapturePixels(page);
    await page.locator('.maplibregl-map').screenshot({ path, animations: 'disabled' });
  } finally {
    await app.evaluate((element) => element.removeAttribute('data-renderer-capture-bare'));
  }
}

export async function seedEditor(page: Page, system: TransitSystem): Promise<void> {
  const pageErrors: string[] = [];
  const recordPageError = (error: Error) => pageErrors.push(error.stack ?? error.message);
  page.on('pageerror', recordPageError);
  await page.goto(rendererSeedPageUrl(PREVIEW_URL), { waitUntil: 'load' });
  await seedIndexedDbFixture(page, JSON.stringify(system), {
    id: system.id,
    name: system.name,
    updatedAt: system.updatedAt,
  });
  await page.goto(PREVIEW_URL, { waitUntil: 'domcontentloaded' });
  await waitForLoadedDocument(page);
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
  } finally {
    page.off('pageerror', recordPageError);
  }
  await page.waitForFunction(
    () => {
      const overlay = window.__perfOverlaySnapshot?.();
      return overlay?.overlayHealthy && overlay.symbolLayerExists;
    },
    null,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(1_750);
  await settleCapturePixels(page);
}

interface RendererViewSelection {
  profile: PerfProfileId;
  viewMode: RendererCaptureCase['viewMode'];
}

export async function selectView(page: Page, capture: RendererViewSelection): Promise<void> {
  const label =
    capture.viewMode === 'infrastructure'
      ? 'Infrastructure'
      : capture.viewMode === 'network'
        ? 'Network'
        : 'Diagram';
  if (capture.profile === 'desktop') {
    await page.getByRole('group', { name: 'View' }).getByRole('button', { name: label }).click();
    return;
  }
  const trigger = page.getByRole('button', { name: /^View:/ });
  if ((await trigger.getAttribute('aria-label')) !== `View: ${label}`) {
    await trigger.click();
    await page.getByRole('menuitem', { name: label }).click();
  }
}

export async function setSettledCamera(
  page: Page,
  system: TransitSystem,
  zoom: number,
  center: [number, number] = fixtureCenter(system),
): Promise<void> {
  await page.evaluate(
    async ({ center: requestedCenter, requestedZoom }) => {
      const setCamera = window.__rendererCaptureSetCamera;
      if (!setCamera) throw new Error('Renderer capture camera seam is unavailable.');
      await setCamera({ center: requestedCenter, zoom: requestedZoom });
    },
    { center, requestedZoom: zoom },
  );
  await settleCapturePixels(page);
}

export async function openExportDialog(page: Page, profile: PerfProfileId): Promise<void> {
  if (profile === 'desktop') {
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    return;
  }
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Export…' }).click();
}
