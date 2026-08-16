import { resolve } from 'node:path';
import type { Browser, Page } from 'playwright-core';
import {
  createRendererContextPlan,
  rendererContextFilename,
} from '../../src/perf/renderer-capture';
import { createRendererFixture, type RendererFixtureId } from '../../src/perf/renderer-fixtures';
import { createPerfProtocol, PERF_SCENARIOS } from '../../src/perf/scenarios';
import type { PerfProfileId } from '../../src/perf/types';
import { configureSurfaceRoutes } from '../perf/browser';
import {
  openExportDialog,
  preventRemoteBasemap,
  rendererCaptureBaseUrl,
  rendererStatsForPage,
  seedEditor,
  setSettledCamera,
  settleCapturePixels,
  waitForSettledRenderer,
} from './capture-browser';
import type { RendererCaptureManifestEntry, RendererCaptureViewport } from './capture-types';

type RendererContextCase = ReturnType<typeof createRendererContextPlan>[number];
type RendererContextSurface = RendererContextCase['surface'];

export function contextRendererStats(
  page: Page,
  surface: RendererContextSurface,
): ReturnType<typeof rendererStatsForPage> {
  return surface === 'editor' ? rendererStatsForPage(page) : Promise.resolve(null);
}

interface ContextGroup {
  browser: Browser;
  profile: PerfProfileId;
  theme: 'light' | 'dark';
  phase: string;
  imageDirectory: string;
  viewport: RendererCaptureViewport;
}

function contextCase(group: ContextGroup, surface: RendererContextSurface): RendererContextCase {
  const capture = createRendererContextPlan(group.phase).find(
    (candidate) =>
      candidate.profile === group.profile &&
      candidate.theme === group.theme &&
      candidate.surface === surface,
  );
  if (!capture) {
    throw new Error(`Missing renderer context case: ${group.profile}/${group.theme}/${surface}`);
  }
  return capture;
}

interface ContextScreenshotOptions {
  page: Page;
  group: ContextGroup;
  surface: RendererContextSurface;
  fixtureId?: RendererFixtureId | 'onboarding';
}

async function captureContextScreenshot({
  page,
  group,
  surface,
  fixtureId = 'port-mason',
}: ContextScreenshotOptions): Promise<RendererCaptureManifestEntry> {
  const capture = contextCase(group, surface);
  const filename = rendererContextFilename(capture);
  await settleCapturePixels(page);
  await page.screenshot({
    path: resolve(group.imageDirectory, filename),
    animations: 'disabled',
  });
  return {
    id: capture.id,
    file: `images/${filename}`,
    profile: group.profile,
    theme: group.theme,
    viewMode: 'context',
    detail: 'context',
    zoom: null,
    fixtureId,
    viewport: group.viewport,
    camera: null,
    rendererStats: await contextRendererStats(page, surface),
  };
}

async function captureEditorSurfaces(group: ContextGroup): Promise<RendererCaptureManifestEntry[]> {
  const context = await group.browser.newContext({
    viewport: { width: group.viewport.width, height: group.viewport.height },
    deviceScaleFactor: group.viewport.pixelRatio,
    colorScheme: group.theme,
    reducedMotion: 'reduce',
  });
  await preventRemoteBasemap(context);
  const page = await context.newPage();
  const entries: RendererCaptureManifestEntry[] = [];
  try {
    const system = createRendererFixture('port-mason');
    await seedEditor(page, system);
    await setSettledCamera(page, system, 15);
    entries.push(await captureContextScreenshot({ page, group, surface: 'editor' }));

    await openExportDialog(page, group.profile);
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible' });
    await waitForSettledRenderer(page, '.export-preview-map');
    const exportPreview = page.locator('.export-preview-map[data-render-settled="true"]');
    if (group.profile === 'mobile') await exportPreview.scrollIntoViewIfNeeded();
    entries.push(await captureContextScreenshot({ page, group, surface: 'export' }));
    await dialog.getByRole('button', { name: 'Close' }).click();

    await page.evaluate(() => localStorage.removeItem('transitmapper:onboardingSeen'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('dialog').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await waitForSettledRenderer(page, '.onboarding-preview-map');
    entries.push(
      await captureContextScreenshot({
        page,
        group,
        surface: 'onboarding',
        fixtureId: 'onboarding',
      }),
    );
  } finally {
    await context.close();
  }
  return entries;
}

async function captureEmbedSurface(group: ContextGroup): Promise<RendererCaptureManifestEntry> {
  const context = await group.browser.newContext({
    viewport: { width: group.viewport.width, height: group.viewport.height },
    deviceScaleFactor: group.viewport.pixelRatio,
    colorScheme: group.theme,
    reducedMotion: 'reduce',
  });
  await preventRemoteBasemap(context);
  const page = await context.newPage();
  try {
    await configureSurfaceRoutes(
      page,
      PERF_SCENARIOS.embed,
      JSON.stringify(createRendererFixture('port-mason')),
    );
    await page.goto(`${rendererCaptureBaseUrl()}${PERF_SCENARIOS.embed.path}`, {
      waitUntil: 'domcontentloaded',
    });
    await waitForSettledRenderer(page, '.maplibregl-map');
    return await captureContextScreenshot({ page, group, surface: 'embed' });
  } finally {
    await context.close();
  }
}

export async function captureContextEvidence(
  browser: Browser,
  imageDirectory: string,
  phase: string,
): Promise<RendererCaptureManifestEntry[]> {
  const entries: RendererCaptureManifestEntry[] = [];
  for (const profile of ['desktop', 'mobile'] as const) {
    const perfViewport = createPerfProtocol(profile, 'smoke').viewport;
    for (const theme of ['light', 'dark'] as const) {
      const group: ContextGroup = {
        browser,
        profile,
        theme,
        phase,
        imageDirectory,
        viewport: {
          width: perfViewport.width,
          height: perfViewport.height,
          pixelRatio: perfViewport.deviceScaleFactor,
        },
      };
      entries.push(...(await captureEditorSurfaces(group)), await captureEmbedSurface(group));
    }
  }
  return entries;
}
