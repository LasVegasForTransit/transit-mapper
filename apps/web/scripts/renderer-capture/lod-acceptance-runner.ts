import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { TransitSystem } from '@transitmapper/core/model/system';
import type { Browser, Page } from 'playwright-core';
import { SRC_HIT_FEATURES } from '../../src/map/layers';
import {
  COMMITTED_SYSTEM_FEATURE_SOURCES,
  EDITOR_SYSTEM_FEATURE_SOURCES,
} from '../../src/map/system-feature-sources';
import {
  RENDERER_LOD_ACCEPTANCE_VISUAL_CASES,
  type RendererLodAcceptanceAssertionId,
  type RendererLodAcceptanceFixtureId,
  type RendererLodAcceptanceVisualCase,
} from '../../src/perf/renderer-lod-acceptance';
import { createRendererFixture } from '../../src/perf/renderer-fixtures';
import { createServedJunctionFixture } from '../../src/perf/renderer-specialized-fixtures';
import { createPerfProtocol } from '../../src/perf/scenarios';
import {
  captureBareRenderer,
  preventRemoteBasemap,
  seedEditor,
  selectView,
  setSettledCamera,
} from './capture-browser';
import type { RendererCaptureManifest } from './capture-types';
import type {
  RendererLodAcceptanceAssertion,
  RendererLodAcceptanceBankIdentity,
  RendererLodAcceptanceFixtureProvenance,
  RendererLodAcceptanceManifest,
  RendererLodAcceptanceStatsAssertion,
  RendererLodAcceptanceStatsSnapshot,
  RendererLodAcceptanceVisualEntry,
} from './lod-acceptance-types';
import { validateRendererLodAcceptanceManifest } from './lod-acceptance-validation';
import { rendererCaptureDigest } from './lifecycle';

interface RendererStatsCounters {
  projectionCount: number;
  fullUploadCount: number;
  editorProjectionCount: number;
}

interface SourceUploadCounter {
  sourceId: string;
  method: 'setData' | 'updateData';
  callCount: number;
}

const COMMITTED_LOGICAL_SOURCE_IDS = new Set<string>([
  ...COMMITTED_SYSTEM_FEATURE_SOURCES,
  SRC_HIT_FEATURES,
]);
const EDITOR_SOURCE_IDS = new Set<string>(EDITOR_SYSTEM_FEATURE_SOURCES);

function logicalBankedSourceId(sourceId: string): string | undefined {
  const match = /^(.*)--bank-[ab]$/.exec(sourceId);
  return match?.[1];
}

/** Converts the existing perf instrumentation into the ownership-specific
 * counters asserted by the appendix. Transient gesture/vehicle uploads are
 * intentionally outside both renderer ownership totals. */
export function rendererLodAcceptanceStatsSnapshot(
  renderer: RendererStatsCounters,
  sourceUploads: readonly SourceUploadCounter[],
) {
  let sourceUploadCount = 0;
  let editorSourceUploadCount = 0;
  for (const upload of sourceUploads) {
    const logicalId = logicalBankedSourceId(upload.sourceId);
    if (logicalId && COMMITTED_LOGICAL_SOURCE_IDS.has(logicalId)) {
      sourceUploadCount += upload.callCount;
    } else if (EDITOR_SOURCE_IDS.has(upload.sourceId)) {
      editorSourceUploadCount += upload.callCount;
    }
  }
  return {
    projectionCount: renderer.projectionCount,
    fullUploadCount: renderer.fullUploadCount,
    sourceUploadCount,
    editorProjectionCount: renderer.editorProjectionCount,
    editorSourceUploadCount,
  };
}

interface CreateRendererLodAcceptanceStatsAssertionOptions {
  id: RendererLodAcceptanceStatsAssertion['id'];
  action: string;
  fixture: RendererLodAcceptanceStatsAssertion['fixture'];
  camera: RendererLodAcceptanceStatsAssertion['camera'];
  before: RendererLodAcceptanceStatsSnapshot;
  after: RendererLodAcceptanceStatsSnapshot;
  observation?: RendererLodAcceptanceStatsAssertion['observation'];
}

export function rendererLodAcceptanceStatsAssertion({
  id,
  action,
  fixture,
  camera,
  before,
  after,
  observation,
}: CreateRendererLodAcceptanceStatsAssertionOptions): RendererLodAcceptanceStatsAssertion {
  const delta: RendererLodAcceptanceStatsSnapshot = {
    projectionCount: after.projectionCount - before.projectionCount,
    fullUploadCount: after.fullUploadCount - before.fullUploadCount,
    sourceUploadCount: after.sourceUploadCount - before.sourceUploadCount,
    editorProjectionCount: after.editorProjectionCount - before.editorProjectionCount,
    editorSourceUploadCount: after.editorSourceUploadCount - before.editorSourceUploadCount,
  };
  const nonNegative = Object.values(delta).every((value) => value >= 0);
  const passed =
    nonNegative &&
    (id === 'invalidating-camera-reprojects'
      ? delta.projectionCount > 0
      : delta.projectionCount === 0 &&
        delta.fullUploadCount === 0 &&
        delta.sourceUploadCount === 0);
  return {
    id,
    kind: 'renderer-stats',
    action,
    fixture,
    camera,
    before,
    after,
    delta,
    ...(observation ? { observation } : {}),
    passed,
    ...(passed ? {} : { failure: 'Observed renderer-stat deltas violate the acceptance rule.' }),
  };
}

export interface RendererLodAcceptancePerfBankSnapshot {
  activeBank: 'a' | 'b' | null;
  stagingBank: 'a' | 'b' | null;
  activeRevision: string | null;
  activeVisualSourceIds: readonly string[];
  activeVisualLayerIds: readonly string[];
  activeVisualSourceId: string | null;
  activeHitSourceId: string | null;
  activeHitLayerIds: readonly string[];
  activeVisualLayerId: string | null;
  activeHitLayerId: string | null;
  selectedFeatureStateSourceIds: readonly string[];
  diagnostics: unknown;
}

export interface RendererLodAcceptanceBankHost {
  __perfRenderSourceBankSnapshot?: () => RendererLodAcceptancePerfBankSnapshot;
}

export function requiredRendererBankAcceptanceSnapshot(
  host: RendererLodAcceptanceBankHost,
): () => RendererLodAcceptancePerfBankSnapshot {
  if (!host.__perfRenderSourceBankSnapshot) {
    throw new Error('Phase 2 bank acceptance requires __perfRenderSourceBankSnapshot.');
  }
  return host.__perfRenderSourceBankSnapshot;
}

/** The snapshot reads each physical boundary independently. The manifest
 * validator derives and cross-checks bank suffixes; this adapter never fills
 * several fields from one trusted bank label. */
export function rendererLodAcceptanceBankIdentity(
  snapshot: RendererLodAcceptancePerfBankSnapshot,
): RendererLodAcceptanceBankIdentity {
  if (
    !snapshot.activeRevision ||
    snapshot.activeVisualLayerIds.length === 0 ||
    snapshot.activeVisualSourceIds.length === 0 ||
    !snapshot.activeHitSourceId ||
    snapshot.activeHitLayerIds.length === 0 ||
    snapshot.selectedFeatureStateSourceIds.length === 0
  ) {
    throw new Error('Renderer bank snapshot is missing active identity evidence.');
  }
  return {
    activeRevision: snapshot.activeRevision,
    visibleLayerIds: [...snapshot.activeVisualLayerIds],
    visibleSourceIds: [...snapshot.activeVisualSourceIds],
    hitSourceId: snapshot.activeHitSourceId,
    hitLayerIds: [...snapshot.activeHitLayerIds],
    featureStateSourceIds: [...snapshot.selectedFeatureStateSourceIds],
  };
}

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

type AcceptanceWindow = Window & AcceptanceWindowAdditions;

function fixtureForAcceptance(id: RendererLodAcceptanceFixtureId): TransitSystem {
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

function fixtureProvenance(
  fixtureId: RendererLodAcceptanceFixtureId,
  system: TransitSystem,
): RendererLodAcceptanceFixtureProvenance {
  return { id: fixtureId, documentId: system.id, updatedAt: system.updatedAt };
}

async function acceptanceStatsForPage(page: Page): Promise<RendererLodAcceptanceStatsSnapshot> {
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

async function currentFixture(page: Page): Promise<TransitSystem> {
  const fixture = await page.evaluate(
    () => (window as AcceptanceWindow).__editor?.getState().system,
  );
  if (!fixture) throw new Error('Renderer acceptance fixture store is unavailable.');
  return fixture;
}

async function waitForRendererSettlement(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const settle = (window as AcceptanceWindow).__rendererCaptureWhenSettled;
    if (!settle) throw new Error('Renderer settle-only capture seam is unavailable.');
    await settle();
  });
}

async function selectAcceptanceWay(page: Page, wayId: string): Promise<void> {
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
  return {
    ...planned.camera,
    center: camera.center,
    zoom: camera.zoom,
  };
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

async function captureSelectedTunnelAndJunctionVisuals(
  page: Page,
  acceptanceDirectory: string,
): Promise<RendererLodAcceptanceVisualEntry[]> {
  const byId = new Map(RENDERER_LOD_ACCEPTANCE_VISUAL_CASES.map((entry) => [entry.id, entry]));
  const output: RendererLodAcceptanceVisualEntry[] = [];
  const selected = byId.get('selected-wide-corridor-10-5');
  if (!selected) throw new Error('Selected corridor acceptance case is missing.');
  await seedCase(page, selected);
  await setSettledCamera(page, fixtureForAcceptance(selected.fixtureId), selected.camera.zoom, [
    ...selected.camera.center,
  ]);
  await selectAcceptanceWay(page, 'port-mason-harbor-bridge');
  output.push(await captureLiveVisual({ page, acceptanceDirectory, planned: selected }));

  for (const id of [
    'tunnel-below-12',
    'tunnel-at-12',
    'served-junction-3-arm',
    'served-junction-4-arm',
    'served-junction-5-arm',
  ]) {
    const planned = byId.get(id);
    if (!planned) throw new Error(`Renderer acceptance case is missing: ${id}`);
    const system = await seedCase(page, planned);
    await setSettledCamera(page, system, planned.camera.zoom, [...planned.camera.center]);
    output.push(await captureLiveVisual({ page, acceptanceDirectory, planned }));
  }
  return output;
}

async function capturePanVisuals(
  page: Page,
  acceptanceDirectory: string,
): Promise<RendererLodAcceptanceVisualEntry[]> {
  const byId = new Map(RENDERER_LOD_ACCEPTANCE_VISUAL_CASES.map((entry) => [entry.id, entry]));
  const accepted = byId.get('fast-pan-accepted');
  const edge = byId.get('fast-pan-edge-preload');
  const settled = byId.get('fast-pan-settled');
  if (!accepted || !edge || !settled) throw new Error('Fast-pan acceptance plan is incomplete.');
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
    await captureLiveVisual({
      page,
      acceptanceDirectory,
      planned: edge,
      camera: movingCamera,
    }),
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
    if (!first) throw new Error('Renderer bank fixture has no way to edit.');
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

async function captureBankVisualsAndAssertion(
  page: Page,
  acceptanceDirectory: string,
): Promise<{
  visuals: RendererLodAcceptanceVisualEntry[];
  assertion: RendererLodAcceptanceAssertion;
}> {
  const byId = new Map(RENDERER_LOD_ACCEPTANCE_VISUAL_CASES.map((entry) => [entry.id, entry]));
  const old = byId.get('bank-old-accepted');
  const preparing = byId.get('bank-hidden-preparation');
  const promoted = byId.get('bank-new-promoted');
  if (!old || !preparing || !promoted) throw new Error('Bank acceptance plan is incomplete.');
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

async function captureParityVisuals(
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
    const live = cases[index];
    const staticMap = cases[index + 1];
    const svg = cases[index + 2];
    if (!live || !staticMap || !svg) throw new Error('Parity acceptance plan is incomplete.');
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
  const plan = RENDERER_LOD_ACCEPTANCE_VISUAL_CASES.find(
    (entry) => entry.fixtureId === 'port-mason',
  );
  if (!plan) throw new Error('Port Mason acceptance camera is missing.');
  return rendererLodAcceptanceStatsAssertion({
    id,
    action,
    fixture: fixtureProvenance('port-mason', fixture),
    camera: plan.camera,
    before,
    after,
  });
}

async function captureStatsAssertions(page: Page): Promise<RendererLodAcceptanceStatsAssertion[]> {
  const fixture = fixtureForAcceptance('port-mason');
  const cameraCase = RENDERER_LOD_ACCEPTANCE_VISUAL_CASES.find(
    (entry) => entry.id === 'fast-pan-accepted',
  );
  if (!cameraCase) throw new Error('Camera acceptance case is missing.');
  const reset = async () => {
    await seedEditor(page, fixture);
    await selectView(page, { profile: 'desktop', viewMode: 'infrastructure' });
    await setSettledCamera(page, fixture, cameraCase.camera.zoom, [...cameraCase.camera.center]);
  };
  const assertions: RendererLodAcceptanceStatsAssertion[] = [];

  await reset();
  assertions.push(
    await statAssertion(
      page,
      'hover-zero-committed-work',
      'hover a committed corridor',
      async () => {
        const point = await page.evaluate(() =>
          (window as AcceptanceWindow).__perfProjectLngLat?.([-122.456, 37.758]),
        );
        if (!point) throw new Error('Renderer projection seam is unavailable.');
        await page.mouse.move(point.x, point.y);
      },
    ),
  );

  await reset();
  assertions.push(
    await statAssertion(
      page,
      'selection-zero-committed-work',
      'select a way while measuring committed and editor-owned counters separately',
      () => selectAcceptanceWay(page, 'port-mason-harbor-bridge'),
    ),
  );

  await reset();
  assertions.push(
    await statAssertion(page, 'filter-zero-committed-work', 'change the visible view filter', () =>
      selectView(page, { profile: 'desktop', viewMode: 'network' }),
    ),
  );

  await reset();
  assertions.push(
    await statAssertion(
      page,
      'retained-theme-zero-committed-work',
      'change the retained light theme to dark',
      () => page.emulateMedia({ colorScheme: 'dark' }),
    ),
  );
  await page.emulateMedia({ colorScheme: 'light' });

  await reset();
  assertions.push(
    await statAssertion(
      page,
      'accepted-camera-reuses-scene',
      'move the same-scale camera inside accepted coverage',
      () =>
        setSettledCamera(page, fixture, cameraCase.camera.zoom, [
          cameraCase.camera.center[0] + 0.0001,
          cameraCase.camera.center[1],
        ]),
    ),
  );

  await reset();
  assertions.push(
    await statAssertion(
      page,
      'invalidating-camera-reprojects',
      'change displayed scale beyond the accepted presentation',
      () =>
        setSettledCamera(page, fixture, cameraCase.camera.zoom + 1.5, [
          ...cameraCase.camera.center,
        ]),
    ),
  );
  return assertions;
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
  const viewport = createPerfProtocol('desktop', 'smoke').viewport;
  const context = await browser.newContext({
    viewport: { width: 960, height: 600 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  if (viewport.deviceScaleFactor !== 1) {
    throw new Error('Phase 2 acceptance requires a deterministic DPR-1 desktop context.');
  }
  await preventRemoteBasemap(context);
  try {
    const page = await context.newPage();
    const visuals = [
      ...(await captureSelectedTunnelAndJunctionVisuals(page, acceptanceDirectory)),
      ...(await capturePanVisuals(page, acceptanceDirectory)),
    ];
    const bank = await captureBankVisualsAndAssertion(page, acceptanceDirectory);
    visuals.push(...bank.visuals, ...(await captureParityVisuals(page, acceptanceDirectory)));
    const visualById = new Map(visuals.map((entry) => [entry.id, entry]));
    const orderedVisuals = RENDERER_LOD_ACCEPTANCE_VISUAL_CASES.map((entry) => {
      const captured = visualById.get(entry.id);
      if (!captured) throw new Error(`Renderer acceptance visual was not captured: ${entry.id}`);
      return captured;
    });
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
      visuals: orderedVisuals,
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
