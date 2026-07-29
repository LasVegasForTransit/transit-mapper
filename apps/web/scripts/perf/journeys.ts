import type { LngLat } from '@transitmapper/core/model/system';
import type { Page } from 'playwright-core';
import { eventTimingInteractionDurations } from '../../src/perf/eventTiming';
import { summarizeGesture } from '../../src/perf/gestureStats';
import { directGestureGateMeasurements } from '../../src/perf/gestureGate';
import {
  cameraChanged,
  drawChangedSystem,
  projectedPointChanged,
} from '../../src/perf/journeyProof';
import { FIRST_SYSTEM_MAP_PAINT_MARK } from '../../src/perf/mapPaintMark';
import type {
  PerfGestureDiagnostics,
  PerfPhaseCounters,
  PerfProductionPersistenceProbe,
  PerfRuntimeCounters,
  PerfScenario,
} from '../../src/perf/types';
import {
  type BrowserMetricState,
  type DirectJourneyMeasurements,
  type GestureCaptureState,
  type PerfPageWindow,
  PERF_STORAGE_CONTRACT,
} from './browserContract';

interface BrowserEventTimingEntry extends PerformanceEntry {
  interactionId: number;
  duration: number;
}

interface EventPerformanceObserverInit extends PerformanceObserverInit {
  durationThreshold?: number;
}

interface CanvasGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

interface PaintedFrameRecorder {
  values: number[] | null;
  startAction(): Promise<void>;
  stopAction(): Promise<void>;
}

export interface EditorEntity {
  id: string;
  name: string;
}

interface DrawPersistenceResult {
  persistence: PerfProductionPersistenceProbe;
}

interface JourneySummary {
  metrics: ReturnType<typeof summarizeGesture>['metrics'];
  diagnostics: PerfGestureDiagnostics;
  counters: Omit<PerfRuntimeCounters, 'domNodeCount'>;
  persistence: PerfProductionPersistenceProbe | null;
}

function waitForResponsePaint(page: Page): Promise<void> {
  return page.evaluate(
    () =>
      new Promise<void>((resolvePromise) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolvePromise()));
      }),
  );
}

async function beginGestureCapture(page: Page): Promise<void> {
  await page.evaluate(() => {
    const persistence = (window as PerfPageWindow).__perfProductionPersistence;
    if (persistence) persistence.cycles.length = 0;
    const startedAt = performance.now();
    const state: GestureCaptureState = {
      eventTimings: [],
      animationFrameMs: [],
      longTaskMs: [],
      active: true,
      lastFrameAt: startedAt,
      startedAt,
      sourceUploadsBefore: (window as PerfPageWindow).__perfSourceUploadCount?.() ?? null,
    };
    (window as PerfPageWindow).__genericPerfGesture = state;

    for (const observerOptions of [
      { type: 'event', buffered: true, durationThreshold: 16 },
      // first-input is not subject to Event Timing's 16 ms reporting threshold.
      { type: 'first-input', buffered: true },
    ] satisfies EventPerformanceObserverInit[]) {
      new PerformanceObserver((list) => {
        if (!state.active) return;
        for (const entry of list.getEntries() as BrowserEventTimingEntry[]) {
          if (entry.startTime < state.startedAt) continue;
          state.eventTimings.push({
            name: entry.name,
            interactionId: entry.interactionId,
            duration: entry.duration,
            startTime: entry.startTime,
          });
        }
      }).observe(observerOptions);
    }

    (window as PerfPageWindow).__genericPerfFrame = function (now: number): void {
      if (!state.active) return;
      state.animationFrameMs.push(now - state.lastFrameAt);
      state.lastFrameAt = now;
      const next = (window as PerfPageWindow).__genericPerfFrame;
      if (next) requestAnimationFrame(next);
    };
    const initialFrame = (window as PerfPageWindow).__genericPerfFrame;
    if (initialFrame) requestAnimationFrame(initialFrame);
    new PerformanceObserver((list) => {
      if (!state.active) return;
      for (const entry of list.getEntries()) state.longTaskMs.push(entry.duration);
    }).observe({ type: 'longtask', buffered: false });
  });
}

async function resetGestureCapture(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = (window as PerfPageWindow).__genericPerfGesture;
    if (!state) throw new Error('The direct-manipulation measurement did not start.');
    state.eventTimings.length = 0;
    state.animationFrameMs.length = 0;
    state.longTaskMs.length = 0;
    state.startedAt = performance.now();
    state.lastFrameAt = state.startedAt;
    state.sourceUploadsBefore = (window as PerfPageWindow).__perfSourceUploadCount?.() ?? null;
  });
}

async function finishGestureCapture(
  page: Page,
): Promise<
  Omit<DirectJourneyMeasurements, 'paintedFrameMs' | 'actions' | 'productionPersistence'>
> {
  await waitForResponsePaint(page);
  // Give PerformanceObserver one task turn to deliver entries queued after
  // the presentation that ended the interaction.
  await page.waitForTimeout(250);
  const measurements = await page.evaluate(() => {
    const state = (window as PerfPageWindow).__genericPerfGesture;
    if (!state) throw new Error('The direct-manipulation measurement did not start.');
    state.active = false;
    delete (window as PerfPageWindow).__genericPerfFrame;

    const sourceUploadsAfter = (window as PerfPageWindow).__perfSourceUploadCount?.() ?? null;
    return {
      eventTimings: state.eventTimings,
      animationFrameMs: state.animationFrameMs.slice(2),
      longTaskMs: state.longTaskMs,
      sourceUploadCount:
        state.sourceUploadsBefore === null || sourceUploadsAfter === null
          ? null
          : sourceUploadsAfter - state.sourceUploadsBefore,
    };
  });
  return {
    inputToNextPaintMs: eventTimingInteractionDurations(measurements.eventTimings),
    animationFrameMs: measurements.animationFrameMs,
    longTaskMs: measurements.longTaskMs,
    sourceUploadCount: measurements.sourceUploadCount,
  };
}

async function canvasGeometry(page: Page): Promise<CanvasGeometry> {
  const bounds = await page.locator('.maplibregl-canvas').first().boundingBox();
  if (!bounds) throw new Error('The map canvas has no measurable bounds.');
  return {
    ...bounds,
    centerX: bounds.x + bounds.width / 2,
    centerY: bounds.y + bounds.height / 2,
  };
}

async function createPaintedFrameRecorder(page: Page): Promise<PaintedFrameRecorder> {
  const available = await page.evaluate(
    () =>
      typeof (window as PerfPageWindow).__perfStartPaintedFrameCapture === 'function' &&
      typeof (window as PerfPageWindow).__perfStopPaintedFrameCapture === 'function',
  );
  const values: number[] | null = available ? [] : null;
  return {
    values,
    startAction: async () => {
      if (!available) return;
      await page.evaluate(() => (window as PerfPageWindow).__perfStartPaintedFrameCapture?.());
    },
    stopAction: async () => {
      if (!values) return;
      const frames = await page.evaluate(
        () => (window as PerfPageWindow).__perfStopPaintedFrameCapture?.() ?? [],
      );
      values.push(...frames);
    },
  };
}

async function performEntityDrag(
  page: Page,
  canvas: CanvasGeometry,
  recorder: PaintedFrameRecorder,
  entity: EditorEntity,
): Promise<void> {
  await page.keyboard.press('v');
  await page.waitForFunction(
    () =>
      typeof (window as PerfPageWindow).__perfProjectLngLat === 'function' &&
      typeof (window as PerfPageWindow).__perfStationSnapshot === 'function',
    undefined,
    { timeout: 30_000 },
  );
  const before = await page.evaluate((stationId) => {
    const snapshot = (window as PerfPageWindow).__perfStationSnapshot?.(stationId);
    const project = (window as PerfPageWindow).__perfProjectLngLat;
    if (!snapshot || !project) throw new Error('The live station target is unavailable.');
    return { snapshot, point: project(snapshot.coord) };
  }, entity.id);
  if (
    before.point.x < canvas.x ||
    before.point.x > canvas.x + canvas.width ||
    before.point.y < canvas.y ||
    before.point.y > canvas.y + canvas.height
  ) {
    throw new Error('The deterministic station drag target is outside the map viewport.');
  }

  await page.mouse.click(before.point.x, before.point.y);
  const selectedStationName = page.getByLabel('Station name');
  await selectedStationName.waitFor({ state: 'visible', timeout: 30_000 });
  const selectedName = await selectedStationName.inputValue();
  if (selectedName !== entity.name) {
    throw new Error(
      `The projected fixture target "${entity.name}" (${entity.id}) at ` +
        `${before.point.x.toFixed(1)},${before.point.y.toFixed(1)} selected "${selectedName}".`,
    );
  }

  // Selecting an entity intentionally expands the mobile Details sheet over
  // most of the map. Collapse that real UI before the measured drag, exactly
  // as a user must, then project again after the responsive layout settles.
  // Reusing the pre-selection point made the script drag the sheet instead of
  // the station on phones, while desktop happened to keep the point stable.
  const collapsePanel = page.getByRole('button', { name: 'Collapse panel' });
  if (await collapsePanel.isVisible()) {
    await collapsePanel.click();
    await page.getByRole('button', { name: 'Expand panel' }).waitFor({ state: 'visible' });
    await waitForResponsePaint(page);
  }
  const dragPoint = await page.evaluate((coord) => {
    const project = (window as PerfPageWindow).__perfProjectLngLat;
    if (!project) throw new Error('The live station projection disappeared.');
    return project(coord);
  }, before.snapshot.coord);
  const currentCanvas = await canvasGeometry(page);
  if (
    dragPoint.x < currentCanvas.x ||
    dragPoint.x > currentCanvas.x + currentCanvas.width ||
    dragPoint.y < currentCanvas.y ||
    dragPoint.y > currentCanvas.y + currentCanvas.height
  ) {
    throw new Error('The selected station drag target is outside the current map viewport.');
  }

  await resetGestureCapture(page);
  await recorder.startAction();
  await page.mouse.move(dragPoint.x, dragPoint.y);
  await page.mouse.down();
  await page.mouse.move(dragPoint.x + 32, dragPoint.y + 18, { steps: 8 });
  await page.mouse.up();
  await waitForResponsePaint(page);
  await recorder.stopAction();

  const after = await page.evaluate(
    (stationId) => (window as PerfPageWindow).__perfStationSnapshot?.(stationId) ?? null,
    entity.id,
  );
  const coordinateChanged =
    after !== null &&
    (after.coord[0] !== before.snapshot.coord[0] || after.coord[1] !== before.snapshot.coord[1]);
  if (!after || !coordinateChanged || after.revision === before.snapshot.revision) {
    throw new Error('The station drag did not change the live model coordinate and revision.');
  }
}

async function performCameraDrag(
  page: Page,
  scenario: PerfScenario,
  canvas: CanvasGeometry,
  recorder: PaintedFrameRecorder,
  entityId?: string,
): Promise<void> {
  const probeCoordinate =
    scenario.surface === 'embed'
      ? null
      : await page.evaluate((stationId) => {
          const snapshot = stationId
            ? (window as PerfPageWindow).__perfStationSnapshot?.(stationId)
            : null;
          if (!snapshot) throw new Error('The camera projection target is unavailable.');
          return snapshot.coord;
        }, entityId);
  const before =
    scenario.surface === 'embed'
      ? await page.evaluate(() => {
          const snapshot = (window as PerfPageWindow).__perfCameraSnapshot?.();
          if (!snapshot) throw new Error('The embed camera seam is unavailable.');
          return snapshot;
        })
      : await page.evaluate((coordinate) => {
          const project = (window as PerfPageWindow).__perfProjectLngLat;
          if (!coordinate || !project)
            throw new Error('The camera projection seam is unavailable.');
          return project(coordinate);
        }, probeCoordinate);

  const dragDistance = Math.min(120, canvas.width * 0.25);
  const button = scenario.surface === 'embed' ? 'left' : 'right';
  await recorder.startAction();
  await page.mouse.move(canvas.centerX - dragDistance / 2, canvas.centerY);
  await page.mouse.down({ button });
  for (let step = 1; step <= 24; step += 1) {
    await page.mouse.move(
      canvas.centerX - dragDistance / 2 + (dragDistance * step) / 24,
      canvas.centerY + Math.sin((step / 24) * Math.PI) * 12,
    );
    await page.waitForTimeout(12);
  }
  await page.mouse.up({ button });
  await waitForResponsePaint(page);
  await recorder.stopAction();

  const after =
    scenario.surface === 'embed'
      ? await page.evaluate(() => {
          const snapshot = (window as PerfPageWindow).__perfCameraSnapshot?.();
          if (!snapshot) throw new Error('The embed camera seam disappeared.');
          return snapshot;
        })
      : await page.evaluate((coordinate) => {
          const project = (window as PerfPageWindow).__perfProjectLngLat;
          if (!coordinate || !project) throw new Error('The camera projection seam disappeared.');
          return project(coordinate);
        }, probeCoordinate);
  const changed =
    scenario.surface === 'embed'
      ? cameraChanged(
          before as { center: LngLat; zoom: number },
          after as { center: LngLat; zoom: number },
        )
      : projectedPointChanged(
          before as { x: number; y: number },
          after as { x: number; y: number },
        );
  if (!changed) throw new Error('The deterministic pointer drag did not change the live camera.');
}

async function performDrawAndPersistenceProof(
  page: Page,
  scenario: PerfScenario,
  canvas: CanvasGeometry,
  entityId: string,
): Promise<DrawPersistenceResult> {
  const before = await page.evaluate((stationId) => {
    const snapshot = (window as PerfPageWindow).__perfStationSnapshot?.(stationId);
    if (!snapshot) throw new Error('The performance system seam is unavailable.');
    return snapshot;
  }, entityId);

  await page.keyboard.press('l');
  const drawY = canvas.y + canvas.height * 0.7;
  const ratios = [0.35, 0.5, 0.65];
  await page.keyboard.down('Alt');
  await page.mouse.click(canvas.x + canvas.width * ratios[0], drawY);
  await page.keyboard.up('Alt');
  await page.waitForTimeout(24);
  for (const ratio of ratios.slice(1)) {
    await page.mouse.click(canvas.x + canvas.width * ratio, drawY);
    await page.waitForTimeout(24);
  }
  const commitRequestedAt = await page.evaluate(() => performance.now());
  await page.keyboard.press('Enter');
  const after = await page.evaluate((stationId) => {
    const snapshot = (window as PerfPageWindow).__perfStationSnapshot?.(stationId);
    if (!snapshot) throw new Error('The system seam disappeared after drawing.');
    return snapshot;
  }, entityId);
  await waitForResponsePaint(page);
  if (!drawChangedSystem(before, after)) {
    throw new Error('The line draw did not advance the system revision and way count.');
  }

  // Include validation and the shared content/camera persistence debounce.
  await page.waitForTimeout(550);
  try {
    await page.waitForFunction(
      (committedAt) =>
        (window as PerfPageWindow).__perfProductionPersistence?.cycles.some(
          (cycle) =>
            cycle.workerStartedAt >= committedAt &&
            cycle.workerCompletedAt !== null &&
            cycle.indexedDbStartedAt !== null &&
            cycle.indexedDbCompletedAt !== null,
        ) === true,
      commitRequestedAt,
      { timeout: 30_000 },
    );
  } catch (error) {
    const cycles = await page.evaluate(
      () => (window as PerfPageWindow).__perfProductionPersistence?.cycles ?? [],
    );
    throw new Error(
      `The production persistence cycle did not settle: ${JSON.stringify(cycles)}. ` +
        `${String(error)}`,
    );
  }
  const durable = await page.evaluate(
    async ({ expected, storage }) => {
      const cycle = [...((window as PerfPageWindow).__perfProductionPersistence?.cycles ?? [])]
        .reverse()
        .find(
          (candidate) =>
            candidate.workerStartedAt >= expected.committedAt &&
            candidate.workerCompletedAt !== null &&
            candidate.indexedDbStartedAt !== null &&
            candidate.indexedDbCompletedAt !== null,
        );
      if (
        !cycle ||
        cycle.workerCompletedAt === null ||
        cycle.indexedDbStartedAt === null ||
        cycle.indexedDbCompletedAt === null
      ) {
        throw new Error('The production persistence phases were incomplete.');
      }
      const database = await new Promise<IDBDatabase>((resolvePromise, reject) => {
        const request = indexedDB.open(storage.databaseName, storage.databaseVersion);
        request.onsuccess = () => resolvePromise(request.result);
        request.onerror = () => reject(request.error);
      });
      const record = await new Promise<{ serialized?: string } | undefined>(
        (resolvePromise, reject) => {
          const transaction = database.transaction(storage.documentStore, 'readonly');
          const request = transaction.objectStore(storage.documentStore).get(expected.systemId);
          request.onsuccess = () =>
            resolvePromise(request.result as { serialized?: string } | undefined);
          request.onerror = () => reject(request.error);
        },
      );
      database.close();
      const stored = record?.serialized ? (JSON.parse(record.serialized) as unknown) : null;
      return {
        cycle,
        stored:
          stored &&
          typeof stored === 'object' &&
          'updatedAt' in stored &&
          'ways' in stored &&
          typeof stored.updatedAt === 'number' &&
          Array.isArray(stored.ways)
            ? { revision: stored.updatedAt, wayCount: stored.ways.length }
            : null,
      };
    },
    {
      expected: {
        committedAt: commitRequestedAt,
        systemId: `perf-${scenario.fixtureId}`,
      },
      storage: PERF_STORAGE_CONTRACT,
    },
  );
  if (
    !durable.stored ||
    durable.stored.revision !== after.revision ||
    durable.stored.wayCount !== after.wayCount
  ) {
    throw new Error('IndexedDB did not contain the committed line draw.');
  }
  return {
    persistence: {
      saveMs: durable.cycle.indexedDbCompletedAt! - commitRequestedAt,
      workerSerializationMs: durable.cycle.workerCompletedAt! - durable.cycle.workerStartedAt,
      indexedDbWriteMs: durable.cycle.indexedDbCompletedAt! - durable.cycle.indexedDbStartedAt!,
    },
  };
}

async function runDirectManipulation(
  page: Page,
  scenario: PerfScenario,
  entity?: EditorEntity,
): Promise<DirectJourneyMeasurements> {
  await beginGestureCapture(page);
  const canvas = await canvasGeometry(page);
  const recorder = await createPaintedFrameRecorder(page);
  const actions: DirectJourneyMeasurements['actions'] = [];

  if (scenario.surface === 'editor') {
    if (!entity) throw new Error('The editor scenario has no station drag target.');
    await performEntityDrag(page, canvas, recorder, entity);
    actions.push('entity-drag');
  }

  await performCameraDrag(page, scenario, canvas, recorder, entity?.id);
  actions.push('camera-drag');

  let productionPersistence: PerfProductionPersistenceProbe | null = null;
  if (scenario.surface === 'editor') {
    if (!entity) throw new Error('The editor scenario has no draw proof target.');
    productionPersistence = (
      await performDrawAndPersistenceProof(page, scenario, canvas, entity.id)
    ).persistence;
    actions.push('draw');
  }

  const measurements = await finishGestureCapture(page);
  if (measurements.inputToNextPaintMs.length === 0) {
    throw new Error(`${scenario.id} produced no Event Timing entries for pointer interactions.`);
  }
  if (scenario.surface !== 'embed' && (!recorder.values || recorder.values.length === 0)) {
    throw new Error(`${scenario.id} produced no painted map frames for its trusted actions.`);
  }
  return {
    ...measurements,
    paintedFrameMs: recorder.values,
    actions,
    productionPersistence,
  };
}

export async function runMeasuredJourney(
  page: Page,
  scenario: PerfScenario,
  entity?: EditorEntity,
  simulationState: PerfGestureDiagnostics['simulationState'] = 'not-applicable',
): Promise<JourneySummary> {
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
  const direct = await runDirectManipulation(page, scenario, entity);
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

  // Scripted pans remain available to DevTools and the soak runner, but are
  // deliberately excluded from normal cold/warm user-journey samples.
  const raw = directGestureGateMeasurements(direct, null);
  const summary = summarizeGesture(raw);
  return {
    metrics: summary.metrics,
    diagnostics: {
      name: scenario.surface === 'editor' ? 'entity-drag-draw' : 'map-drag',
      frameSource: direct.paintedFrameMs !== null ? 'map-render' : 'animation-frame-proxy',
      inputToNextPaintMs: raw.inputToNextPaintMs,
      paintedFrameMs: raw.paintedFrameMs,
      unexpectedLongTaskMs: raw.longTaskMs.filter((duration) => duration > 50),
      actions: direct.actions,
      simulationState,
    },
    counters: {
      ...summary.counters,
      phaseCounters,
    },
    persistence: direct.productionPersistence,
  };
}

export async function waitForScenarioReady(
  page: Page,
  scenario: PerfScenario,
  expectedName: string,
  loadPhase: 'cold' | 'warm',
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

  try {
    await page.waitForFunction(
      (markName) => performance.getEntriesByName(markName, 'mark').length > 0,
      FIRST_SYSTEM_MAP_PAINT_MARK,
      { timeout: 60_000 },
    );
  } catch (error) {
    const diagnostics = await page.evaluate(
      (markName) => ({
        automatedPerfRun: (window as PerfPageWindow).__TRANSITMAPPER_PERF_RUN__ === true,
        firstMapCanvasMs: (window as Window & { __transitMapperPerf?: BrowserMetricState })
          .__transitMapperPerf?.firstMapCanvasMs,
        marks: performance.getEntriesByName(markName, 'mark').map((entry) => entry.startTime),
        overlay: (window as PerfPageWindow).__perfOverlaySnapshot?.() ?? null,
        projectionCounts: (window as PerfPageWindow).__mapProjectionCounts?.() ?? null,
      }),
      FIRST_SYSTEM_MAP_PAINT_MARK,
    );
    throw new Error(
      `${scenario.id} ${loadPhase} load never produced a proven system paint: ` +
        `${JSON.stringify(diagnostics)}. Original error: ${String(error)}`,
    );
  }
  await waitForResponsePaint(page);
  await page.waitForTimeout(250);
}
