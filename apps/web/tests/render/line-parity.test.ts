/**
 * One system, one camera, every passenger surface — do they agree?
 *
 * Each surface already has its own test, and every one of those tests passes
 * against a surface that has quietly gone back to painting one stripe per
 * ServicePlan, as long as the surface is self-consistent. Nothing compared any
 * surface to any other, so the four could drift apart without a failure. This
 * file is that comparison: it resolves the same fixture through each surface's
 * own production entry point and asserts they yield the same Line identities
 * and the same stripe and casing counts.
 *
 * The editor, the reader, the embed, and PNG export do not each need a driver
 * here. All four ask the one projection Worker for their geometry —
 * `editor-map-driver.ts`, `viewer-document-map.ts`, `embed-map-runtime.ts`,
 * and `map/export/exportRenderer.ts` all build it with
 * `createFeatureProjectionWorker` — and that Worker's entry module is the only
 * place any of them swaps the Line scene in for per-ServicePlan geometry. So
 * the real entry is driven here behind the real client, through the two of the
 * four callers that need no WebGL map: the embed's `projectEmbedScene` and the
 * PNG path's `projectFeaturesForFittedMap`.
 *
 * The editor and reader drivers are not covered: both attach to a live
 * `maplibregl.Map` and cannot be constructed in a node test. Their coverage
 * here is the shared Worker they delegate to, not their own attachment code.
 */
import type { Feature, FeatureCollection } from 'geojson';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { systemBounds } from '@transitmapper/core/model/geo';
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

/** Two ServicePlans on one carrier under one Line. Painting per plan yields
 *  two stripes here instead of one. */
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
 * The Line-first result both corridors add up to.
 *
 * Every rule this file enforces moves one of these three numbers, which is why
 * the surfaces can be compared on totals rather than corridor by corridor: a
 * surface that paints the resort corridor per ServicePlan reports four
 * stripes, and one that gives each Line on the downtown corridor its own
 * casing reports three casings.
 */
const LINE_FIRST_RESULT: LineSurfaceSummary = {
  stripeLineIds: ['route-109', 'route-201', 'route-202'],
  stripes: 3,
  casings: 2,
};

interface LineSurfaceSummary {
  /** Sorted and de-duplicated, so surfaces are compared on the Lines they
   *  drew rather than on the order their projector happened to emit. */
  readonly stripeLineIds: readonly string[];
  readonly stripes: number;
  readonly casings: number;
}

function parityFixture(): TransitSystem {
  const resort = aRoad('resort-corridor', RESORT_CORRIDOR);
  const downtown = aRoad('downtown-corridor', DOWNTOWN_CORRIDOR);
  const weekday = aService('weekday-plan', [aPattern('weekday-pattern', [resort], [resort.id])]);
  const weekend = aService('weekend-plan', [aPattern('weekend-pattern', [resort], [resort.id])]);
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

/** Reads a projected scene the way MapLibre reads it: by the role each route
 *  feature was named with. */
function sceneSummary(services: FeatureCollection): LineSurfaceSummary {
  const stripes = services.features.filter((feature) => routeRole(feature) === 'stripe');
  return {
    stripeLineIds: [...new Set(stripes.map(lineIdOf))].sort(),
    stripes: stripes.length,
    casings: services.features.filter((feature) => routeRole(feature) === 'casing').length,
  };
}

function attribute(path: string, name: string): string | undefined {
  return new RegExp(`${name}="([^"]*)"`).exec(path)?.[1];
}

/**
 * Reads a drawing the way a person does: one path per route feature per paint
 * pass. Every identity is painted more than once — a stripe is drawn in the
 * casing colour before it is drawn in its own — so the paths are collapsed by
 * feature ID, and the Line is the one recognised colour among a stripe's
 * strokes.
 */
function markupSummary(markup: string): LineSurfaceSummary {
  const casings = new Set<string>();
  const lineIdByStripe = new Map<string, string>();
  const stripes = new Set<string>();
  for (const [path] of markup.matchAll(/<path\b[^>]*>/g)) {
    if (attribute(path, 'data-render-source') !== 'services') continue;
    const featureId = attribute(path, 'data-feature-id');
    if (featureId === undefined) continue;
    if (featureId.includes('line-casing')) casings.add(featureId);
    if (!featureId.includes('line-stripe')) continue;
    stripes.add(featureId);
    const lineId = LINE_ID_BY_COLOR.get(attribute(path, 'stroke') ?? '');
    if (lineId) lineIdByStripe.set(featureId, lineId);
  }
  if (lineIdByStripe.size !== stripes.size) {
    throw new Error(`${stripes.size - lineIdByStripe.size} drawn stripes carry no Line colour.`);
  }
  return {
    stripeLineIds: [...new Set(lineIdByStripe.values())].sort(),
    stripes: stripes.size,
    casings: casings.size,
  };
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
    surfaces.set('projection Worker, through the embed', await embedSurface(system, camera));
    surfaces.set('projection Worker, through PNG export', await pngSurface(system, camera));
    surfaces.set('SVG export', await svgSurface(system, camera));
    surfaces.set('share card', await previewCardSurface(system));
  });

  it('no two surfaces disagree about the Lines they drew', () => {
    expect([...surfaces.keys()]).toHaveLength(4);
    expect(Object.fromEntries(surfaces)).toEqual(
      Object.fromEntries([...surfaces.keys()].map((name) => [name, LINE_FIRST_RESULT])),
    );
  });

  it('a Line two ServicePlans serve paints one stripe on every surface', () => {
    for (const [name, surface] of surfaces) {
      expect({ name, stripes: surface.stripes, lines: surface.stripeLineIds }).toEqual({
        name,
        stripes: LINE_FIRST_RESULT.stripes,
        lines: LINE_FIRST_RESULT.stripeLineIds,
      });
    }
  });

  it('a corridor two Lines share carries one casing on every surface', () => {
    for (const [name, surface] of surfaces) {
      expect({ name, casings: surface.casings }).toEqual({
        name,
        casings: LINE_FIRST_RESULT.casings,
      });
    }
  });
});
