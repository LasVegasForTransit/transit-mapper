import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Browser, Page } from 'playwright-core';
import {
  RENDERER_LOD_ACCEPTANCE_VISUAL_CASES,
  type RendererLodAcceptanceAssertionId,
} from '../../src/perf/renderer-lod-acceptance';
import { createPerfProtocol } from '../../src/perf/scenarios';
import { preventRemoteBasemap, seedEditor, selectView, setSettledCamera } from './capture-browser';
import type { RendererCaptureManifest } from './capture-types';
import { rendererLodAcceptanceStatsAssertion } from './lod-acceptance-observations';
import type {
  RendererLodAcceptanceAssertion,
  RendererLodAcceptanceManifest,
  RendererLodAcceptanceStatsAssertion,
} from './lod-acceptance-types';
import { validateRendererLodAcceptanceManifest } from './lod-acceptance-validation';
import {
  acceptanceStatsForPage,
  captureBankVisualsAndAssertion,
  capturePanVisuals,
  captureParityVisuals,
  captureSelectedTunnelAndJunctionVisuals,
  currentFixture,
  fixtureForAcceptance,
  fixtureProvenance,
  selectAcceptanceWay,
  type AcceptanceWindow,
  waitForRendererSettlement,
} from './lod-acceptance-visual-capture';

// The runner keeps this stable public surface for direct rule tests. Browser
// operations live in lod-acceptance-visual-capture; pure rules live in
// lod-acceptance-observations.
export {
  rendererLodAcceptanceBankIdentity,
  rendererLodAcceptanceStatsAssertion,
  rendererLodAcceptanceStatsSnapshot,
  requiredRendererBankAcceptanceSnapshot,
} from './lod-acceptance-observations';
export type {
  RendererLodAcceptanceBankHost,
  RendererLodAcceptancePerfBankSnapshot,
} from './lod-acceptance-observations';

async function statAssertion(
  page: Page,
  id: Exclude<RendererLodAcceptanceAssertionId, 'bank-promotion-is-atomic'>,
  action: string,
  mutate: () => Promise<void>,
): Promise<RendererLodAcceptanceStatsAssertion> {
  const fixture = await currentFixture(page);
  const before = await acceptanceStatsForPage(page);
  await mutate();
  await waitForRendererSettlement(page);
  const after = await acceptanceStatsForPage(page);
  const camera = RENDERER_LOD_ACCEPTANCE_VISUAL_CASES.find(
    (entry) => entry.fixtureId === 'port-mason',
  )?.camera;
  if (!camera) throw new Error('Port Mason acceptance camera is missing.');
  return rendererLodAcceptanceStatsAssertion({
    id,
    action,
    fixture: fixtureProvenance('port-mason', fixture),
    camera,
    before,
    after,
  });
}

async function captureStatsAssertions(page: Page): Promise<RendererLodAcceptanceStatsAssertion[]> {
  const fixture = fixtureForAcceptance('port-mason');
  const camera = RENDERER_LOD_ACCEPTANCE_VISUAL_CASES.find(
    (entry) => entry.id === 'fast-pan-accepted',
  )?.camera;
  if (!camera) throw new Error('Camera acceptance case is missing.');
  const reset = async () => {
    await seedEditor(page, fixture);
    await selectView(page, { profile: 'desktop', viewMode: 'infrastructure' });
    await setSettledCamera(page, fixture, camera.zoom, [...camera.center]);
  };
  const assertions: RendererLodAcceptanceStatsAssertion[] = [];
  const record = async (
    id: Exclude<RendererLodAcceptanceAssertionId, 'bank-promotion-is-atomic'>,
    action: string,
    mutate: () => Promise<void>,
  ) => {
    await reset();
    assertions.push(await statAssertion(page, id, action, mutate));
  };
  await record('hover-zero-committed-work', 'hover a committed corridor', async () => {
    const point = await page.evaluate(() =>
      (window as AcceptanceWindow).__perfProjectLngLat?.([-122.456, 37.758]),
    );
    if (!point) throw new Error('Renderer projection seam is unavailable.');
    await page.mouse.move(point.x, point.y);
  });
  await record(
    'selection-zero-committed-work',
    'select a way while measuring committed and editor-owned counters separately',
    () => selectAcceptanceWay(page, 'port-mason-harbor-bridge'),
  );
  await record('filter-zero-committed-work', 'change the visible view filter', () =>
    selectView(page, { profile: 'desktop', viewMode: 'network' }),
  );
  await record(
    'retained-theme-zero-committed-work',
    'change the retained light theme to dark',
    () => page.emulateMedia({ colorScheme: 'dark' }),
  );
  await page.emulateMedia({ colorScheme: 'light' });
  await record(
    'accepted-camera-reuses-scene',
    'move the same-scale camera inside accepted coverage',
    () =>
      setSettledCamera(page, fixture, camera.zoom, [camera.center[0] + 0.0001, camera.center[1]]),
  );
  await record(
    'invalidating-camera-reprojects',
    'change displayed scale beyond the accepted presentation',
    () => setSettledCamera(page, fixture, camera.zoom + 1.5, [...camera.center]),
  );
  return assertions;
}

function requireDprOne() {
  const { deviceScaleFactor } = createPerfProtocol('desktop', 'smoke').viewport;
  if (deviceScaleFactor !== 1) {
    throw new Error('Phase 2 acceptance requires a deterministic DPR-1 desktop context.');
  }
}

function orderedVisuals(
  visuals: Awaited<ReturnType<typeof captureSelectedTunnelAndJunctionVisuals>>,
) {
  const byId = new Map(visuals.map((entry) => [entry.id, entry]));
  return RENDERER_LOD_ACCEPTANCE_VISUAL_CASES.map((entry) => {
    const captured = byId.get(entry.id);
    if (!captured) throw new Error(`Renderer acceptance visual was not captured: ${entry.id}`);
    return captured;
  });
}

/** Captures the additive Phase 2 appendix. It deliberately runs after the
 * fixed 116-image corpus and writes only beneath `acceptance/`. */
export async function captureRendererLodAcceptance(
  browser: Browser,
  outputDirectory: string,
  source: RendererCaptureManifest['source'],
): Promise<RendererLodAcceptanceManifest> {
  const acceptanceDirectory = resolve(outputDirectory, 'acceptance');
  await mkdir(resolve(acceptanceDirectory, 'images'), { recursive: true });
  requireDprOne();
  const context = await browser.newContext({
    viewport: { width: 960, height: 600 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  await preventRemoteBasemap(context);
  try {
    const page = await context.newPage();
    const visuals = [
      ...(await captureSelectedTunnelAndJunctionVisuals(page, acceptanceDirectory)),
      ...(await capturePanVisuals(page, acceptanceDirectory)),
    ];
    const bank = await captureBankVisualsAndAssertion(page, acceptanceDirectory);
    visuals.push(...bank.visuals, ...(await captureParityVisuals(page, acceptanceDirectory)));
    const assertions: RendererLodAcceptanceAssertion[] = [
      ...(await captureStatsAssertions(page)),
      bank.assertion,
    ];
    const manifest: RendererLodAcceptanceManifest = {
      schemaVersion: 1,
      suiteId: 'phase-2-lod',
      phase: '01-lod',
      generatedAt: new Date().toISOString(),
      source,
      basemap: 'local-blank-v2',
      visuals: orderedVisuals(visuals),
      assertions,
    };
    const errors = await validateRendererLodAcceptanceManifest(
      manifest,
      acceptanceDirectory,
      source,
    );
    if (errors.length > 0) {
      throw new Error(`Renderer LOD acceptance failed:\n${errors.join('\n')}`);
    }
    await writeFile(
      resolve(acceptanceDirectory, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );
    return manifest;
  } finally {
    await context.close();
  }
}
