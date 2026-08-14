import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { TransitSystem } from '@transitmapper/core/model/system';
import type { Page } from 'playwright-core';
import {
  RENDERER_LOD_ACCEPTANCE_VISUAL_CASES,
  type RendererLodAcceptanceFixtureId,
  type RendererLodAcceptanceVisualCase,
} from '../../src/perf/renderer-lod-acceptance';
import { createRendererFixture } from '../../src/perf/renderer-fixtures';
import { createServedJunctionFixture } from '../../src/perf/renderer-specialized-fixtures';
import { captureBareRenderer, seedEditor, selectView, setSettledCamera } from './capture-browser';
import {
  rendererLodAcceptanceBankIdentity,
  rendererLodAcceptanceStatsSnapshot,
  requiredRendererBankAcceptanceSnapshot,
  type RendererLodAcceptancePerfBankSnapshot,
} from './lod-acceptance-observations';
import type {
  RendererLodAcceptanceAssertion,
  RendererLodAcceptanceFixtureProvenance,
  RendererLodAcceptanceStatsSnapshot,
  RendererLodAcceptanceVisualEntry,
} from './lod-acceptance-types';
import { rendererCaptureDigest } from './lifecycle';

/** Browser seams used only by the deterministic renderer acceptance appendix.
 * Keeping them here prevents the manifest runner from depending on page-global
 * details while preserving an explicit contract for capture failures. */
interface AcceptanceWindowAdditions {
  __rendererLodAcceptancePanPending?: boolean;
  __editor?: {
    getState(): {
      system: TransitSystem;
      select(selection: { kind: 'way'; id: string } | null): void;
    };
    setState(next: Partial<{ system: TransitSystem }>): void;
  };
}

export type AcceptanceWindow = Window & AcceptanceWindowAdditions;

export function fixtureForAcceptance(id: RendererLodAcceptanceFixtureId): TransitSystem {
  if (id === 'served-three-arm') {
    return createServedJunctionFixture(id, [0, 120, 240]);
  }
  if (id === 'served-four-arm') {
    return createServedJunctionFixture(id, [0, 90, 180, 270]);
  }
  if (id === 'served-five-arm') {
    return createServedJunctionFixture(id, [5, 73, 145, 218, 292]);
  }
  return createRendererFixture(id);
}

export function fixtureProvenance(
  fixtureId: RendererLodAcceptanceFixtureId,
  system: TransitSystem,
): RendererLodAcceptanceFixtureProvenance {
  return { id: fixtureId, documentId: system.id, updatedAt: system.updatedAt };
}

export async function acceptanceStatsForPage(
  page: Page,
): Promise<RendererLodAcceptanceStatsSnapshot> {
  const evidence = await page.evaluate(() => {
    const host = window as AcceptanceWindow;
    return {
      renderer: host.__rendererStats?.(),
      sourceUploads: host.__perfSourceUploadTimings?.(),
    };
  });
  if (!evidence.renderer || !evidence.sourceUploads) {
    throw new Error('Renderer acceptance stats instrumentation is unavailable.');
  }
  return rendererLodAcceptanceStatsSnapshot(evidence.renderer, evidence.sourceUploads);
}

export async function currentFixture(page: Page): Promise<TransitSystem> {
  const fixture = await page.evaluate(
    () => (window as AcceptanceWindow).__editor?.getState().system,
  );
  if (!fixture) throw new Error('Renderer acceptance fixture store is unavailable.');
  return fixture;
}

export async function waitForRendererSettlement(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const settle = (window as AcceptanceWindow).__rendererCaptureWhenSettled;
    if (!settle) throw new Error('Renderer settle-only capture seam is unavailable.');
    await settle();
  });
}

export async function selectAcceptanceWay(page: Page, wayId: string): Promise<void> {
  await page.evaluate((id) => {
    const state = (window as AcceptanceWindow).__editor?.getState();
    if (!state) throw new Error('Renderer acceptance fixture store is unavailable.');
    state.select({ kind: 'way', id });
  }, wayId);
  await waitForRendererSettlement(page);
}

async function currentCameraForCase(
  page: Page,
  planned: RendererLodAcceptanceVisualCase,
): Promise<RendererLodAcceptanceVisualCase['camera']> {
  const camera = await page.evaluate(() => (window as AcceptanceWindow).__perfCameraSnapshot?.());
  if (!camera) throw new Error('Renderer camera provenance is unavailable.');
  return { ...planned.camera, center: camera.center, zoom: camera.zoom };
}

interface CaptureLiveVisualOptions {
  page: Page;
  acceptanceDirectory: string;
  planned: RendererLodAcceptanceVisualCase;
  camera?: RendererLodAcceptanceVisualCase['camera'];
}

async function captureLiveVisual({
  page,
  acceptanceDirectory,
  planned,
  camera = planned.camera,
}: CaptureLiveVisualOptions): Promise<RendererLodAcceptanceVisualEntry> {
  const path = resolve(acceptanceDirectory, planned.file);
  await captureBareRenderer(page, path);
  const system = await currentFixture(page);
  return {
    ...planned,
    camera,
    fixture: fixtureProvenance(planned.fixtureId, system),
    rendererStats: await acceptanceStatsForPage(page),
    sha256: rendererCaptureDigest(await readFile(path)),
  };
}

async function seedCase(
  page: Page,
  planned: RendererLodAcceptanceVisualCase,
): Promise<TransitSystem> {
  const system = fixtureForAcceptance(planned.fixtureId);
  await seedEditor(page, system);
  await selectView(page, { profile: 'desktop', viewMode: 'infrastructure' });
  return system;
}

function visualCase(id: string): RendererLodAcceptanceVisualCase {
  const planned = RENDERER_LOD_ACCEPTANCE_VISUAL_CASES.find((entry) => entry.id === id);
  if (!planned) throw new Error(`Renderer acceptance case is missing: ${id}`);
  return planned;
}

export async function captureSelectedTunnelAndJunctionVisuals(
  page: Page,
  acceptanceDirectory: string,
): Promise<RendererLodAcceptanceVisualEntry[]> {
  const selected = visualCase('selected-wide-corridor-10-5');
  await seedCase(page, selected);
  await setSettledCamera(page, fixtureForAcceptance(selected.fixtureId), selected.camera.zoom, [
    ...selected.camera.center,
  ]);
  await selectAcceptanceWay(page, 'port-mason-harbor-bridge');
  const output = [await captureLiveVisual({ page, acceptanceDirectory, planned: selected })];

  for (const id of [
    'tunnel-below-12',
    'tunnel-at-12',
    'served-junction-3-arm',
    'served-junction-4-arm',
    'served-junction-5-arm',
  ]) {
    const planned = visualCase(id);
    const system = await seedCase(page, planned);
    await setSettledCamera(page, system, planned.camera.zoom, [...planned.camera.center]);
    output.push(await captureLiveVisual({ page, acceptanceDirectory, planned }));
  }
  return output;
}

export async function capturePanVisuals(
  page: Page,
  acceptanceDirectory: string,
): Promise<RendererLodAcceptanceVisualEntry[]> {
  const accepted = visualCase('fast-pan-accepted');
  const edge = visualCase('fast-pan-edge-preload');
  const settled = visualCase('fast-pan-settled');
  const system = await seedCase(page, accepted);
  await setSettledCamera(page, system, accepted.camera.zoom, [...accepted.camera.center]);
  const output = [await captureLiveVisual({ page, acceptanceDirectory, planned: accepted })];

  await setSettledCamera(page, system, edge.camera.zoom, [...edge.camera.center]);
  await page.evaluate(() => {
    const host = window as AcceptanceWindow;
    if (!host.__panGestureBench) throw new Error('Renderer pan benchmark is unavailable.');
    host.__rendererLodAcceptancePanPending = true;
    void host
      .__panGestureBench({ steps: 80, dx: 3, dy: 0 })
      .finally(() => (host.__rendererLodAcceptancePanPending = false));
  });
  await page.waitForFunction(() => (window as AcceptanceWindow).__rendererLodAcceptancePanPending);
  const movingCamera = await currentCameraForCase(page, edge);
  output.push(
    await captureLiveVisual({ page, acceptanceDirectory, planned: edge, camera: movingCamera }),
  );
  if (
    !(await page.evaluate(() => (window as AcceptanceWindow).__rendererLodAcceptancePanPending))
  ) {
    throw new Error('Fast-pan evidence settled before the moving frame was captured.');
  }
  await page.waitForFunction(
    () => (window as AcceptanceWindow).__rendererLodAcceptancePanPending === false,
  );
  await setSettledCamera(page, system, settled.camera.zoom, [...settled.camera.center]);
  output.push(await captureLiveVisual({ page, acceptanceDirectory, planned: settled }));
  return output;
}

async function bankSnapshot(page: Page): Promise<RendererLodAcceptancePerfBankSnapshot> {
  const snapshot = await page.evaluate(() =>
    (window as AcceptanceWindow).__perfRenderSourceBankSnapshot?.(),
  );
  if (!snapshot) return requiredRendererBankAcceptanceSnapshot({})();
  return requiredRendererBankAcceptanceSnapshot({
    __perfRenderSourceBankSnapshot: () => snapshot,
  })();
}

async function triggerWideDependencyEdit(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = (window as AcceptanceWindow).__editor;
    const current = store?.getState().system;
    if (!store || !current) throw new Error('Renderer acceptance fixture store is unavailable.');
    const first = current.ways[0];
    const points = first.points.map((point, index) =>
      index === 0 ? ([point[0] + 0.00002, point[1]] as [number, number]) : point,
    );
    store.setState({
      system: {
        ...current,
        updatedAt: current.updatedAt + 1,
        ways: current.ways.map((way, index) => (index === 0 ? { ...way, points } : { ...way })),
      },
    });
  });
}

export async function captureBankVisualsAndAssertion(
  page: Page,
  acceptanceDirectory: string,
): Promise<{
  visuals: RendererLodAcceptanceVisualEntry[];
  assertion: RendererLodAcceptanceAssertion;
}> {
  const old = visualCase('bank-old-accepted');
  const preparing = visualCase('bank-hidden-preparation');
  const promoted = visualCase('bank-new-promoted');
  const system = await seedCase(page, old);
  await setSettledCamera(page, system, old.camera.zoom, [...old.camera.center]);
  await selectAcceptanceWay(page, 'port-mason-harbor-bridge');
  const beforeSnapshot = await bankSnapshot(page);
  const visuals = [await captureLiveVisual({ page, acceptanceDirectory, planned: old })];

  const staging = page.waitForFunction(
    () => (window as AcceptanceWindow).__perfRenderSourceBankSnapshot?.().stagingBank !== null,
    null,
    { polling: 'raf', timeout: 10_000 },
  );
  await triggerWideDependencyEdit(page);
  try {
    await staging;
  } catch (error) {
    throw new Error(
      'The production bank staging interval completed before deterministic capture could observe it.',
      { cause: error },
    );
  }
  const duringSnapshot = await bankSnapshot(page);
  visuals.push(await captureLiveVisual({ page, acceptanceDirectory, planned: preparing }));
  const afterPreparingFrame = await bankSnapshot(page);
  if (
    afterPreparingFrame.stagingBank === null ||
    afterPreparingFrame.activeRevision !== duringSnapshot.activeRevision
  ) {
    throw new Error(
      'The production bank staging interval completed before its hidden-preparation frame finished.',
    );
  }
  await waitForRendererSettlement(page);
  await waitForRendererSettlement(page);
  const afterSnapshot = await bankSnapshot(page);
  visuals.push(await captureLiveVisual({ page, acceptanceDirectory, planned: promoted }));
  return {
    visuals,
    assertion: {
      id: 'bank-promotion-is-atomic',
      kind: 'bank-identity',
      action:
        'apply a wide dependency edit through the production renderer and observe normal promotion',
      fixture: fixtureProvenance('port-mason', await currentFixture(page)),
      camera: promoted.camera,
      before: rendererLodAcceptanceBankIdentity(beforeSnapshot),
      duringPreparation: rendererLodAcceptanceBankIdentity(duringSnapshot),
      afterPromotion: rendererLodAcceptanceBankIdentity(afterSnapshot),
      passed: true,
    },
  };
}

export async function captureParityVisuals(
  page: Page,
  acceptanceDirectory: string,
): Promise<RendererLodAcceptanceVisualEntry[]> {
  const cases = RENDERER_LOD_ACCEPTANCE_VISUAL_CASES.filter((entry) =>
    entry.id.startsWith('parity-'),
  );
  const output: RendererLodAcceptanceVisualEntry[] = [];
  const system = fixtureForAcceptance('port-mason');
  await seedEditor(page, system);
  await selectView(page, { profile: 'desktop', viewMode: 'infrastructure' });
  for (let index = 0; index < cases.length; index += 3) {
    const [live, staticMap, svg] = [cases[index], cases[index + 1], cases[index + 2]];
    await setSettledCamera(page, system, live.camera.zoom, [...live.camera.center]);
    output.push(await captureLiveVisual({ page, acceptanceDirectory, planned: live }));
    for (const planned of [staticMap, svg]) {
      await page.evaluate(
        async ({ surface, camera }) => {
          const seam = (window as AcceptanceWindow).__rendererLodAcceptanceSurface;
          if (!seam) throw new Error('Renderer LOD acceptance surface seam is unavailable.');
          const request = { camera, viewMode: 'infrastructure' as const };
          if (surface === 'static-maplibre') await seam.renderStatic(request);
          else await seam.renderSvg(request);
        },
        { surface: planned.surface, camera: planned.camera },
      );
      const path = resolve(acceptanceDirectory, planned.file);
      await page
        .locator('[data-renderer-lod-acceptance-surface="true"]')
        .screenshot({ path, animations: 'disabled' });
      output.push({
        ...planned,
        fixture: fixtureProvenance('port-mason', system),
        rendererStats: await acceptanceStatsForPage(page),
        sha256: rendererCaptureDigest(await readFile(path)),
      });
      await page.evaluate(() =>
        (window as AcceptanceWindow).__rendererLodAcceptanceSurface?.clear(),
      );
    }
  }
  return output;
}
