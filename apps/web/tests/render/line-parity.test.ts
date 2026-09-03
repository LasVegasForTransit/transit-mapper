/* eslint-disable max-lines -- Six surfaces compared against one another only
   mean anything in one file; splitting them leaves nothing that compares. */
/**
 * One system, one camera, every passenger surface — do they agree?
 *
 * Each surface already has its own test, and every one of those tests passes
 * against a surface that has quietly gone back to painting one stripe per
 * ServicePlan, as long as the surface is self-consistent. Nothing compared any
 * surface to any other, so they could drift apart without a failure. This file
 * is that comparison: it resolves the same fixture through each surface's own
 * production entry point and asserts they draw the same Lines over the same
 * stretches, under the same casings.
 *
 * Six surfaces are driven, and these are the entry points they are driven at:
 *
 * - the embed, at `projectEmbedScene`
 * - PNG export, at `projectFeaturesForFittedMap`
 * - the reader, at `createViewerDocumentMap`
 * - the editor, at `createEditorDocumentMap`
 * - SVG export and the share card, at their own Worker entries
 *
 * The first four all ask the one projection Worker for their geometry, and its
 * entry module — the only place any of them swaps the Line scene in for
 * per-ServicePlan geometry — runs here for real, behind the real client. Two
 * of them reach it directly. The reader and the editor reach it through their
 * own drivers, which read a camera off MapLibre, resolve a scene from it, and
 * publish that scene to MapLibre sources; both take the map from their host
 * rather than building one, so a stand-in reporting the shared camera drives
 * them. That makes four pipelines observed here, not six: the embed and PNG
 * share the Worker call, and SVG and the share card share a projector.
 *
 * Two things above these are NOT covered, and they are out of reach for two
 * different reasons. The embed's `startEmbedMap` constructs its own
 * `maplibregl.Map`, so it needs a WebGL canvas and cannot run here at all;
 * `tests/embed/embed-map-reprojection` covers that half instead.
 * `createEditorMapDriver` constructs no map — it takes one from its host, the
 * same way the composition below it does — so WebGL is not what stops it. What
 * stops it is how much of MapLibre a stand-in would have to answer for once it
 * attaches pointer handling, keyboard handling, navigation handlers, and
 * vehicle animation. None of that decides which features arrive, so the scene
 * it publishes is the one `createEditorDocumentMap` resolves above. Nothing
 * here would notice if either of them stopped calling the composition
 * underneath it.
 */
import type { Feature, FeatureCollection } from 'geojson';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { oneSection, systemBounds } from '@transitmapper/core/model/geo';
import type { LngLat, TransitSystem } from '@transitmapper/core/model/system';
import type {
  RenderViewOptions,
  SystemFeatures,
  ViewOptions,
} from '@transitmapper/core/render/buildFeatures';
import { previewRenderView } from '@transitmapper/core/render/preview';
import { fitBounds } from '@transitmapper/core/render/project';
import type { RenderPresentation } from '@transitmapper/core/render/render-presentation';
import { aPattern, aRoad, aService, aSystem } from '@transitmapper/core/testing/fixtures';
import {
  createFeatureProjectionWorker,
  type FeatureProjectionWorker,
} from '@transitmapper/renderer/projection-worker';
// The projection Worker entry is loaded by URL rather than exported, so a test
// that wants the real one — not a stand-in that calls the Line projector for
// it — has to reach for the file.
import type {
  FeatureProjectionWorkerEvent,
  FeatureProjectionWorkerRequest,
} from '../../../../packages/renderer/src/workers/feature-projection-worker-protocol';
import { projectEmbedScene } from '../../src/embed/embed-map-runtime';
import {
  projectFeaturesForFittedMap,
  type FittedMapLike,
} from '../../src/map/static-render-features';
import { installPreviewWorker, type PreviewWorkerScope } from '../../src/share/previewWorkerEntry';
import type {
  PreviewWorkerEvent,
  PreviewWorkerRequest,
} from '../../src/share/previewWorkerProtocol';
import { installSvgRenderWorker, type SvgRenderWorkerScope } from '../../src/share/svgWorkerEntry';
import type { SvgWorkerEvent, SvgWorkerRequest } from '../../src/share/svgWorkerProtocol';
import { createMapViewStore, createSelectionController } from '@transitmapper/map';
import { createDocumentPresentationState } from '@transitmapper/map/presentation';
import { SRC_SERVICES } from '@transitmapper/renderer/layers';
import { createViewerDocumentMap } from '../../src/viewer/viewer-document-map';
// The reader's driver takes a MapLibre map from its host rather than building
// one, so the stand-in the map package's own driver tests already use drives
// it here too.
import {
  createAttachOptions,
  DocumentDriverClock,
  TestDocumentMap,
} from '../../../../packages/map/tests/support/document-map-driver.test';
import { createEditorDocumentMap } from '../../src/editor/document-map';
import { createEditorStore } from '../../src/editor/store';

// The embed runtime constructs a map at import time only when it is started;
// importing it still pulls MapLibre in, which needs a browser to evaluate.
vi.mock('maplibre-gl', () => ({ default: {} }));

/** A Line's identity in a drawing is its colour: the stripe feature IDs are
 *  content digests, so nothing in the markup names the Line that painted a
 *  path. Every Line in the fixture therefore gets a colour no other Line and
 *  no casing uses, and the drawing surfaces read identity back out of it. */
const LINE_COLORS: Readonly<Record<string, string>> = {
  'route-109': '#e8562a',
  'route-201': '#1b6ac9',
  'route-202': '#2f9e44',
};
const LINE_ID_BY_COLOR = new Map(
  Object.entries(LINE_COLORS).map(([lineId, color]) => [color, lineId] as const),
);

/** Two ServicePlans on one carrier under one Line, one of them running only
 *  part of it. Painting per plan draws the shared stretch twice. */
const RESORT_CORRIDOR: LngLat[] = [
  [-115.22, 36.14],
  [-115.16, 36.14],
];
/** One carrier under two Lines. Painting per Line's own casing yields two
 *  casings here instead of the one the corridor shares. Far enough from the
 *  resort corridor that no carrier rule bundles the two together. */
const DOWNTOWN_CORRIDOR: LngLat[] = [
  [-115.22, 36.18],
  [-115.16, 36.18],
];
/**
 * Where the weekend plan stops, as a fraction of the resort corridor.
 *
 * Two plans covering the identical stretch is what this fixture used to say,
 * and it made the drawing surfaces blind: their stripes are collapsed by
 * feature ID, an ID is a content digest, and two per-plan stripes over one
 * stretch are byte-identical. A shorter second run gives the two plans
 * different content, so a per-plan drawing can be counted. Not a half,
 * because equal halves let a surface swap the two stretches and still report
 * the same pair of numbers.
 */
const WEEKEND_RUN_END_T = 1 / 3;

/**
 * The Line-first result both corridors add up to.
 *
 * Route 109 runs the whole resort corridor, so it draws that corridor once —
 * as two stretches, because coverage changes a third of the way along and the
 * stretch both plans run is one stripe, not one per plan. The two downtown
 * Lines each draw their corridor whole, over a single casing they share.
 */
const LINE_FIRST_RESULT: LineSurfaceSummary = {
  stripeSpansByLineId: {
    'route-109': [0.33, 0.67],
    'route-201': [1],
    'route-202': [1],
  },
  casingSpans: [0.33, 0.67, 1],
};

interface LineSurfaceSummary {
  /**
   * The stretch every stripe covers, by the Line that drew it, as a fraction
   * of the longest stripe on the surface and sorted.
   *
   * Lengths rather than a count, because a count cannot tell the two worlds
   * apart. A Line-first resort corridor is two stripes and so is a per-plan
   * one — the difference is that the Line-first pair tiles the corridor
   * (0.33 + 0.67) while the per-plan pair repeats a third of it (0.33 and 1).
   * Normalizing lets one expectation cover both the projected scenes, which
   * measure in degrees, and the drawings, which measure in page pixels.
   */
  readonly stripeSpansByLineId: Readonly<Record<string, readonly number[]>>;
  readonly casingSpans: readonly number[];
}

function parityFixture(): TransitSystem {
  const resort = aRoad('resort-corridor', RESORT_CORRIDOR);
  const downtown = aRoad('downtown-corridor', DOWNTOWN_CORRIDOR);
  const weekday = aService('weekday-plan', [aPattern('weekday-pattern', [resort], [resort.id])]);
  const weekend = aService('weekend-plan', [
    {
      id: 'weekend-pattern',
      sections: oneSection([
        {
          wayId: resort.id,
          direction: 'withPoints',
          extent: { kind: 'stretch', fromT: 0, toT: WEEKEND_RUN_END_T },
          lane: { kind: 'auto' },
        },
      ]),
    },
  ]);
  const express = aService('201-plan', [aPattern('201-pattern', [downtown], [downtown.id])]);
  const local = aService('202-plan', [aPattern('202-pattern', [downtown], [downtown.id])]);
  return aSystem({
    name: 'Parity Valley',
    ways: [resort, downtown],
    services: [weekday, weekend, express, local],
    lines: [
      {
        id: 'route-109',
        name: '109',
        color: LINE_COLORS['route-109'],
        serviceIds: [weekday.id, weekend.id],
      },
      { id: 'route-201', name: '201', color: LINE_COLORS['route-201'], serviceIds: [express.id] },
      { id: 'route-202', name: '202', color: LINE_COLORS['route-202'], serviceIds: [local.id] },
    ],
  });
}

/**
 * The camera every surface is asked about.
 *
 * A Line scene is clipped and tiered for one camera, so surfaces framed
 * differently could disagree for a reason that is not drift. The share card is
 * the one surface that derives its camera from the system and cannot be told a
 * different one, so its camera is the one the others are handed.
 */
function sharedCamera(system: TransitSystem): RenderViewOptions {
  return previewRenderView(system);
}

function viewOptions(camera: RenderViewOptions): ViewOptions {
  return {
    viewMode: camera.viewMode,
    visibleModes: camera.visibleModes,
    visibleWayTypes: camera.visibleWayTypes,
  };
}

/** A settled read-only MapLibre camera reporting exactly the shared one. */
function fittedMapFor(presentation: RenderPresentation): FittedMapLike {
  const [westLng, southLat] = presentation.bounds.southwest;
  const [eastLng, northLat] = presentation.bounds.northeast;
  return {
    getBounds: () => ({
      getSouthWest: () => ({ lng: westLng, lat: southLat }),
      getNorthEast: () => ({ lng: eastLng, lat: northLat }),
    }),
    getZoom: () => presentation.zoom,
    getCanvas: () => ({
      clientWidth: presentation.viewportWidthPx,
      clientHeight: presentation.viewportHeightPx,
    }),
    getContainer: () => ({
      clientWidth: presentation.displayedWidthPx,
      clientHeight: presentation.displayedHeightPx,
    }),
    getPixelRatio: () => presentation.pixelRatio,
  };
}

interface FeatureProjectionWorkerScope {
  onmessage: ((event: MessageEvent<FeatureProjectionWorkerRequest>) => void) | null;
  postMessage(event: FeatureProjectionWorkerEvent): void;
}

const workerReplies = new Map<number, (event: FeatureProjectionWorkerEvent) => void>();
let workerEntryHandler: ((event: MessageEvent<FeatureProjectionWorkerRequest>) => void) | null =
  null;

/**
 * Hands a request to the real Worker entry.
 *
 * The entry installs itself on the Worker global instead of exporting a
 * handler, so a test drives it the way workerd does. The import is deferred
 * because the SVG and preview entries install themselves on that same global
 * at import time; taking the handler straight after this import is what makes
 * sure it is the projection one.
 */
async function deliverToWorkerEntry(request: FeatureProjectionWorkerRequest): Promise<void> {
  const scope = globalThis as unknown as FeatureProjectionWorkerScope;
  if (!workerEntryHandler) {
    await import('../../../../packages/renderer/src/workers/feature-projection-worker-entry');
    workerEntryHandler = scope.onmessage;
    scope.postMessage = (event) => {
      workerReplies.get(event.requestId)?.(event);
      workerReplies.delete(event.requestId);
    };
  }
  if (!workerEntryHandler) throw new Error('The projection Worker entry installed no handler.');
  workerEntryHandler({ data: request } as MessageEvent<FeatureProjectionWorkerRequest>);
}

/** Stands in for `postMessage` and nothing else: the client, the request, the
 *  entry, and the reply are all the production ones. */
class ProjectionWorkerRelay implements FeatureProjectionWorker {
  onmessage: ((event: MessageEvent<FeatureProjectionWorkerEvent>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  postMessage(request: FeatureProjectionWorkerRequest): void {
    workerReplies.set(request.requestId, (event) => {
      this.onmessage?.({ data: event } as MessageEvent<FeatureProjectionWorkerEvent>);
    });
    void deliverToWorkerEntry(request);
  }

  terminate(): void {
    workerReplies.clear();
  }
}

const projection = createFeatureProjectionWorker({
  workerFactory: () => new ProjectionWorkerRelay(),
});

function routeRole(feature: Feature): string | undefined {
  const role: unknown = feature.properties?.routeRole;
  return typeof role === 'string' ? role : undefined;
}

function lineIdOf(feature: Feature): string {
  const lineId: unknown = feature.properties?.lineId;
  if (typeof lineId !== 'string') throw new Error('A Line stripe carries no lineId.');
  return lineId;
}

/** Both corridors run due east, so a plain planar sum is exact for them in
 *  either unit — degrees of longitude off a projected scene, page pixels off a
 *  drawing — and neither number leaves this file unnormalized. */
function polylineLength(points: readonly (readonly number[])[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const [previousX, previousY] = points[index - 1];
    const [x, y] = points[index];
    total += Math.hypot(x - previousX, y - previousY);
  }
  return total;
}

function lineStringPoints(feature: Feature): readonly number[][] {
  if (feature.geometry.type !== 'LineString') {
    throw new Error(`A route feature is a ${feature.geometry.type}, not a LineString.`);
  }
  return feature.geometry.coordinates;
}

interface RouteFeatureLengths {
  /** Every stripe length a Line contributed, in the surface's own units. */
  readonly stripes: ReadonlyMap<string, readonly number[]>;
  readonly casings: readonly number[];
}

function spansOf(lengths: readonly number[], longest: number): number[] {
  return lengths.map((length) => Math.round((length / longest) * 100) / 100).sort((a, b) => a - b);
}

/** The longest stripe is the downtown corridor, which both surfaces draw
 *  whole, so it is the one length every surface can be measured against. */
function surfaceSummary(lengths: RouteFeatureLengths): LineSurfaceSummary {
  const longest = Math.max(...[...lengths.stripes.values()].flat());
  return {
    stripeSpansByLineId: Object.fromEntries(
      [...lengths.stripes].map(([lineId, stripes]) => [lineId, spansOf(stripes, longest)]),
    ),
    casingSpans: spansOf(lengths.casings, longest),
  };
}

/** Reads a projected scene the way MapLibre reads it: by the role each route
 *  feature was named with. */
function sceneSummary(services: FeatureCollection): LineSurfaceSummary {
  const stripes = new Map<string, number[]>();
  const casings: number[] = [];
  for (const feature of services.features) {
    const role = routeRole(feature);
    if (role !== 'stripe' && role !== 'casing') continue;
    const length = polylineLength(lineStringPoints(feature));
    if (role === 'casing') {
      casings.push(length);
      continue;
    }
    const lineId = lineIdOf(feature);
    stripes.set(lineId, [...(stripes.get(lineId) ?? []), length]);
  }
  return surfaceSummary({ stripes, casings });
}

/** Anchored on the space before the name, because `d` is otherwise found
 *  inside `data-feature-id` and reads back a feature ID as a path. */
function attribute(path: string, name: string): string | undefined {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(path)?.[1];
}

/** `M x,y L x,y` is the only shape static-visual-svg.ts writes for a route. */
function pathPoints(d: string): number[][] {
  return [...d.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map(([, x, y]) => [Number(x), Number(y)]);
}

/**
 * Reads a drawing the way a person does: one path per route feature per paint
 * pass. Every identity is painted more than once — a stripe is drawn in the
 * casing colour before it is drawn in its own — so the paths are collapsed by
 * feature ID, and the Line is the one recognised colour among a stripe's
 * strokes.
 */
function markupSummary(markup: string): LineSurfaceSummary {
  const casingLengths = new Map<string, number>();
  const stripeLengths = new Map<string, number>();
  const lineIdByStripe = new Map<string, string>();
  for (const [path] of markup.matchAll(/<path\b[^>]*>/g)) {
    if (attribute(path, 'data-render-source') !== 'services') continue;
    const featureId = attribute(path, 'data-feature-id');
    if (featureId === undefined) continue;
    const length = polylineLength(pathPoints(attribute(path, 'd') ?? ''));
    if (featureId.includes('line-casing')) casingLengths.set(featureId, length);
    if (!featureId.includes('line-stripe')) continue;
    stripeLengths.set(featureId, length);
    const lineId = LINE_ID_BY_COLOR.get(attribute(path, 'stroke') ?? '');
    if (lineId) lineIdByStripe.set(featureId, lineId);
  }
  const stripes = new Map<string, number[]>();
  for (const [featureId, length] of stripeLengths) {
    const lineId = lineIdByStripe.get(featureId);
    if (lineId === undefined) throw new Error(`Drawn stripe ${featureId} carries no Line colour.`);
    stripes.set(lineId, [...(stripes.get(lineId) ?? []), length]);
  }
  return surfaceSummary({ stripes, casings: [...casingLengths.values()] });
}

/** The embed's own scene request, running against the real Worker entry. */
async function embedSurface(
  system: TransitSystem,
  camera: RenderViewOptions,
): Promise<LineSurfaceSummary> {
  const scene: SystemFeatures = await projectEmbedScene({
    projection,
    system,
    presentation: viewOptions(camera),
    map: fittedMapFor(camera.presentation),
  });
  return sceneSummary(scene.services);
}

/** What PNG export rasterizes: the same Worker, reached through the fitted
 *  offscreen map its renderer projects with. */
async function pngSurface(
  system: TransitSystem,
  camera: RenderViewOptions,
): Promise<LineSurfaceSummary> {
  const scene = await projectFeaturesForFittedMap({
    worker: projection,
    system,
    view: viewOptions(camera),
    map: fittedMapFor(camera.presentation),
  });
  return sceneSummary(scene.services);
}

/**
 * The MapLibre stand-in the reader's driver attaches to.
 *
 * It reports the shared camera instead of the stand-in's own built-in one,
 * because the reader reads its camera off the map rather than being handed
 * one, and a driver framed differently would resolve a differently clipped
 * scene for a reason that is not drift.
 */
class ParityDocumentMap extends TestDocumentMap {
  constructor(private readonly camera: FittedMapLike) {
    super();
  }

  override getBounds(): ReturnType<FittedMapLike['getBounds']> {
    return this.camera.getBounds();
  }

  override getZoom(): number {
    return this.camera.getZoom();
  }

  override getCanvas(): { clientWidth: number; clientHeight: number } {
    return this.camera.getCanvas();
  }

  override getContainer(): { clientWidth: number; clientHeight: number } {
    return this.camera.getContainer();
  }

  override getPixelRatio(): number {
    return this.camera.getPixelRatio();
  }

  /** Rasterizing an icon needs a canvas the node environment has not got, and
   *  registration is skipped for an image the map already holds. Claiming to
   *  hold them all keeps that work off the DOM; nothing here draws a symbol. */
  hasImage(): boolean {
    return true;
  }

  removeImage(): void {}

  getLayoutProperty(): undefined {
    return undefined;
  }
}

/**
 * The reader's own map composition, driven to its first committed scene.
 *
 * `createViewerDocumentMap` builds no map of its own — its host hands it one —
 * so the only thing standing between it and a node test is the Worker it
 * constructs internally, which has no port. Stubbing the global `Worker`
 * constructor puts the same relay behind it that the surfaces above run on,
 * and so the same Worker entry.
 */
async function readerSurface(
  system: TransitSystem,
  camera: RenderViewOptions,
): Promise<LineSurfaceSummary> {
  const map = new ParityDocumentMap(fittedMapFor(camera.presentation));
  // The reader's defaults already resolve to the shared camera's view mode and
  // filters; anything else would frame a different scene.
  const viewStore = createMapViewStore(createDocumentPresentationState());
  const selection = createSelectionController();
  const driver = createViewerDocumentMap({
    system,
    viewStore,
    selection,
    style: { current: 'light' },
  });
  const errors: unknown[] = [];
  const attachment = await driver.attach(
    createAttachOptions(map, [], errors, { viewStore, selection }),
  );
  attachment.dispose();
  if (errors.length > 0) throw new Error(`The reader reported ${String(errors[0])}.`);
  const services = map.sourceData.get(SRC_SERVICES);
  if (!services) throw new Error('The reader committed no service features.');
  return sceneSummary(services);
}

/** The editor publishes a logical source into one of two physical banks and
 *  seeds the standby bank with the same accepted scene, so either bank
 *  answers for what it committed. */
function committedServices(map: TestDocumentMap): FeatureCollection {
  const services = map.sourceData.get(`${SRC_SERVICES}--bank-a`);
  if (!services || services.features.length === 0) {
    throw new Error('The editor committed no service features.');
  }
  return services;
}

/** The editor's projection is cooperative: it hands the host a chunk at a
 *  time and resumes on the next frame. A settled scene therefore needs frames
 *  pumped and the macrotask queue drained, not merely awaited. */
async function settleEditorScene(clock: DocumentDriverClock, map: TestDocumentMap): Promise<void> {
  for (let step = 0; step < 200; step += 1) {
    if ((map.sourceData.get(`${SRC_SERVICES}--bank-a`)?.features.length ?? 0) > 0) return;
    clock.flushOne(map);
    await new Promise((resume) => setTimeout(resume, 0));
  }
  throw new Error('The editor never settled on a scene.');
}

/**
 * The editor's own document map, driven to its first accepted scene.
 *
 * `createEditorMapDriver` stays out of reach: it builds a `maplibregl.Map`,
 * attaches pointer and keyboard handling to it, and animates vehicles on it.
 * The composition underneath it does not — `createEditorDocumentMap` takes
 * the projection client as a port and is the piece that asks for a scene and
 * publishes it, which is the only part of the editor this comparison is
 * about. Its layer catalog is stood in for, because a layer decides how a
 * feature is drawn and never which features arrive.
 */
async function editorSurface(
  system: TransitSystem,
  camera: RenderViewOptions,
): Promise<LineSurfaceSummary> {
  const store = createEditorStore({ documentStatus: 'ready' });
  store.commands.document.setSystem(system);
  const map = new ParityDocumentMap(fittedMapFor(camera.presentation));
  const clock = new DocumentDriverClock();
  const viewStore = createMapViewStore(createDocumentPresentationState());
  const composition = createEditorDocumentMap({
    store,
    layerSpecs: () => [{ id: 'parity-services', type: 'line', source: SRC_SERVICES }],
    // Its own client, on the same stubbed `Worker` and so the same entry.
    createFeatureProjectionWorker: () => createFeatureProjectionWorker(),
    scheduler: clock,
  });
  const errors: unknown[] = [];
  const attachment = await composition.driver.attach(
    createAttachOptions(map, [], errors, { viewStore, selection: composition.selection }),
  );
  await settleEditorScene(clock, map);
  const services = committedServices(map);
  attachment.dispose();
  if (errors.length > 0) throw new Error(`The editor reported ${String(errors[0])}.`);
  return sceneSummary(services);
}

class SvgScope implements SvgRenderWorkerScope {
  onmessage: ((event: MessageEvent<SvgWorkerRequest>) => void) | null = null;
  readonly events: SvgWorkerEvent[] = [];

  postMessage(event: SvgWorkerEvent): void {
    this.events.push(event);
  }

  dispatch(request: SvgWorkerRequest): void {
    this.onmessage?.({ data: request } as MessageEvent<SvgWorkerRequest>);
  }
}

class PreviewScope implements PreviewWorkerScope {
  onmessage: ((event: MessageEvent<PreviewWorkerRequest>) => void) | null = null;
  readonly events: PreviewWorkerEvent[] = [];

  postMessage(event: PreviewWorkerEvent): void {
    this.events.push(event);
  }

  dispatch(request: PreviewWorkerRequest): void {
    this.onmessage?.({ data: request } as MessageEvent<PreviewWorkerRequest>);
  }
}

async function markupFrom(scope: SvgScope | PreviewScope): Promise<string> {
  await vi.waitFor(() => expect(scope.events).toHaveLength(1));
  const [event] = scope.events;
  if (event.kind !== 'done') throw new Error(`A drawing Worker failed: ${event.message}`);
  return event.markup;
}

/** SVG export. The projector only decides where a path lands on the page, so
 *  it is the request's view — the shared camera — that decides which Lines
 *  the drawing carries. */
async function svgSurface(
  system: TransitSystem,
  camera: RenderViewOptions,
): Promise<LineSurfaceSummary> {
  const bounds = systemBounds(system);
  if (!bounds) throw new Error('The parity fixture has no bounds.');
  const scope = new SvgScope();
  installSvgRenderWorker(scope);
  scope.dispatch({
    system,
    view: camera,
    viewport: fitBounds(bounds, { width: 800, height: 500, padding: 40 }),
    options: { title: '', legend: [], width: 800, height: 500, captionedExternally: true },
  });
  return markupSummary(await markupFrom(scope));
}

/** The share card the Worker rasterizes for a link unfurl. It takes the
 *  serialized system a share carries, and derives the shared camera itself. */
async function previewCardSurface(system: TransitSystem): Promise<LineSurfaceSummary> {
  const scope = new PreviewScope();
  installPreviewWorker(scope);
  scope.dispatch({ data: JSON.stringify(system) });
  return markupSummary(await markupFrom(scope));
}

describe('every passenger surface resolves one Line-first scene', () => {
  const system = parityFixture();
  const camera = sharedCamera(system);
  const surfaces = new Map<string, LineSurfaceSummary>();

  beforeAll(async () => {
    vi.stubGlobal('Worker', ProjectionWorkerRelay);
    // The reader hangs a debug handle off `window` in a dev build, and vitest
    // is one. Nothing here reads it back.
    vi.stubGlobal('window', {});
    surfaces.set('projection Worker, through the embed', await embedSurface(system, camera));
    surfaces.set('projection Worker, through PNG export', await pngSurface(system, camera));
    surfaces.set("the reader's snapshot driver", await readerSurface(system, camera));
    surfaces.set("the editor's document map", await editorSurface(system, camera));
    surfaces.set('SVG export', await svgSurface(system, camera));
    surfaces.set('share card', await previewCardSurface(system));
  });

  afterAll(() => vi.unstubAllGlobals());

  it('no two surfaces disagree about the Lines they drew', () => {
    expect([...surfaces.keys()]).toHaveLength(6);
    expect(Object.fromEntries(surfaces)).toEqual(
      Object.fromEntries([...surfaces.keys()].map((name) => [name, LINE_FIRST_RESULT])),
    );
  });

  it('a Line two ServicePlans serve draws its run once on every surface', () => {
    for (const [name, surface] of surfaces) {
      expect({ name, stripes: surface.stripeSpansByLineId }).toEqual({
        name,
        stripes: LINE_FIRST_RESULT.stripeSpansByLineId,
      });
    }
  });

  it('a corridor two Lines share carries one casing on every surface', () => {
    for (const [name, surface] of surfaces) {
      expect({ name, casings: surface.casingSpans }).toEqual({
        name,
        casings: LINE_FIRST_RESULT.casingSpans,
      });
    }
  });
});
