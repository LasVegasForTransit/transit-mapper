import { resolve } from 'node:path';
import type { Browser, Page } from 'playwright-core';
import {
  createRendererCapturePlan,
  createRendererFilmstripPlan,
  rendererCaptureFilename,
  rendererFilmstripFilename,
  rendererFixtureFilename,
  selectRendererCaptureCases,
  type RendererCaptureCase,
} from '../../src/perf/renderer-capture';
import {
  createRendererFixture,
  RENDERER_FIXTURE_DESCRIPTORS,
} from '../../src/perf/renderer-fixtures';
import { createPerfProtocol } from '../../src/perf/scenarios';
import type { RendererFixtureId } from '../../src/perf/renderer-fixture-types';
import type { PerfProfileId } from '../../src/perf/types';
import type { RendererCaptureCliOptions } from './cli';
import {
  captureBareRenderer,
  fixtureCenter,
  preventRemoteBasemap,
  rendererStatsForPage,
  seedEditor,
  selectView,
  setSettledCamera,
} from './capture-browser';
import type { RendererCaptureManifestEntry } from './capture-types';

interface EditorCaseOptions {
  page: Page;
  profile: PerfProfileId;
  captures: readonly RendererCaptureCase[];
  imageDirectory: string;
}

async function captureEditorCases({
  page,
  profile,
  captures,
  imageDirectory,
}: EditorCaseOptions): Promise<RendererCaptureManifestEntry[]> {
  const viewport = createPerfProtocol(profile, 'smoke').viewport;
  const system = createRendererFixture('port-mason');
  const entries: RendererCaptureManifestEntry[] = [];
  await seedEditor(page, system);
  for (const capture of captures) {
    await selectView(page, capture);
    await setSettledCamera(page, system, capture.zoom);
    const filename = rendererCaptureFilename(capture);
    await captureBareRenderer(page, resolve(imageDirectory, filename));
    entries.push({
      id: capture.id,
      file: `images/${filename}`,
      profile: capture.profile,
      theme: capture.theme,
      viewMode: capture.viewMode,
      detail: capture.detail,
      zoom: capture.zoom,
      targetCorridorWidthPx: capture.targetCorridorWidthPx,
      fixtureId: 'port-mason',
      viewport: {
        width: viewport.width,
        height: viewport.height,
        pixelRatio: viewport.deviceScaleFactor,
      },
      camera: { center: fixtureCenter(system), zoom: capture.zoom },
      rendererStats: await rendererStatsForPage(page),
    });
  }
  return entries;
}

export async function captureEditorMatrix(
  browser: Browser,
  options: RendererCaptureCliOptions,
  imageDirectory: string,
): Promise<RendererCaptureManifestEntry[]> {
  const plan = selectRendererCaptureCases(createRendererCapturePlan(options.phase), options);
  const entries: RendererCaptureManifestEntry[] = [];
  for (const profile of ['desktop', 'mobile'] as const) {
    const viewport = createPerfProtocol(profile, 'smoke').viewport;
    for (const theme of ['light', 'dark'] as const) {
      const captures = plan.filter(
        (capture) => capture.profile === profile && capture.theme === theme,
      );
      if (captures.length === 0) continue;
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: viewport.deviceScaleFactor,
        colorScheme: theme,
        reducedMotion: 'reduce',
      });
      await preventRemoteBasemap(context);
      try {
        entries.push(
          ...(await captureEditorCases({
            page: await context.newPage(),
            profile,
            captures,
            imageDirectory,
          })),
        );
      } finally {
        await context.close();
      }
    }
  }
  return entries;
}

export async function captureFractionalFilmstrips(
  browser: Browser,
  imageDirectory: string,
  phase: string,
): Promise<RendererCaptureManifestEntry[]> {
  const viewport = createPerfProtocol('desktop', 'smoke').viewport;
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  await preventRemoteBasemap(context);
  const page = await context.newPage();
  const system = createRendererFixture('port-mason');
  const entries: RendererCaptureManifestEntry[] = [];
  try {
    await seedEditor(page, system);
    for (const capture of createRendererFilmstripPlan(phase)) {
      await selectView(page, { profile: 'desktop', viewMode: capture.viewMode });
      await setSettledCamera(page, system, capture.zoom);
      const filename = rendererFilmstripFilename(capture);
      await captureBareRenderer(page, resolve(imageDirectory, filename));
      entries.push({
        id: capture.id,
        file: `images/${filename}`,
        profile: 'filmstrip',
        theme: 'light',
        viewMode: capture.viewMode,
        detail: 'filmstrip',
        zoom: capture.zoom,
        targetCorridorWidthPx: capture.targetCorridorWidthPx,
        fixtureId: 'port-mason',
        viewport: {
          width: viewport.width,
          height: viewport.height,
          pixelRatio: viewport.deviceScaleFactor,
        },
        camera: { center: fixtureCenter(system), zoom: capture.zoom },
        rendererStats: await rendererStatsForPage(page),
      });
    }
  } finally {
    await context.close();
  }
  return entries;
}

interface ReferenceCaptureOptions {
  browser: Browser;
  imageDirectory: string;
  phase: string;
  descriptor: (typeof RENDERER_FIXTURE_DESCRIPTORS)[number];
}

async function captureReferenceFixture({
  browser,
  imageDirectory,
  phase,
  descriptor,
}: ReferenceCaptureOptions): Promise<RendererCaptureManifestEntry> {
  const viewport = createPerfProtocol('desktop', 'smoke').viewport;
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  await preventRemoteBasemap(context);
  const page = await context.newPage();
  const system = descriptor.create();
  try {
    await seedEditor(page, system);
    await selectView(page, { profile: 'desktop', viewMode: descriptor.viewMode });
    await setSettledCamera(page, system, descriptor.camera.zoom, descriptor.camera.center);
    const filename = rendererFixtureFilename(descriptor.id);
    await captureBareRenderer(page, resolve(imageDirectory, filename));
    return {
      id: `${phase}-fixture-${descriptor.id}`,
      file: `images/${filename}`,
      profile: 'reference',
      theme: 'light',
      viewMode: descriptor.viewMode,
      detail: 'reference',
      zoom: descriptor.camera.zoom,
      fixtureId: descriptor.id,
      viewport: {
        width: viewport.width,
        height: viewport.height,
        pixelRatio: viewport.deviceScaleFactor,
      },
      camera: { center: descriptor.camera.center, zoom: descriptor.camera.zoom },
      rendererStats: await rendererStatsForPage(page),
    };
  } finally {
    await context.close();
  }
}

export async function captureReferenceFixtures(
  browser: Browser,
  imageDirectory: string,
  phase: string,
  only: readonly RendererFixtureId[] = [],
): Promise<RendererCaptureManifestEntry[]> {
  const wanted = new Set<string>(only);
  const descriptors = RENDERER_FIXTURE_DESCRIPTORS.filter(
    (descriptor) => wanted.size === 0 || wanted.has(descriptor.id),
  );
  const entries: RendererCaptureManifestEntry[] = [];
  for (const descriptor of descriptors) {
    entries.push(await captureReferenceFixture({ browser, imageDirectory, phase, descriptor }));
  }
  return entries;
}
