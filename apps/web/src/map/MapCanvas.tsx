import { useEffect, useRef, useState } from 'react';
import maplibregl, {
  type GeoJSONSource,
  type Map as MLMap,
  type MapSourceDataEvent,
  type PaddingOptions,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEditorStore } from '../editor/EditorProvider';
import type { EditorState } from '../editor/store';
import type { SimCommands } from '../editor/keymap';
import { useSim, useSimClock } from '../ui/SimProvider';
import { useContextMenu, useUi } from '../ui/UiProvider';
import { useView } from '../ui/ViewProvider';
import { useSystemColorScheme } from '../theme/systemColorScheme';
import { attachInteractions, type TerminusConnectionChoice } from './interactions';
import { PointerBadge } from './PointerBadge';
import { useCoarsePointer } from '../device/capabilities';
import { inputTuningFor } from '../editor/input-tuning';
import type { PointerIntent } from '../editor/pointerIntent';
import { serviceWayIds, systemBounds } from '@transitmapper/core/model/geo';
import { routePath } from '@transitmapper/core/model/routeGraph';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { renderDomainIdentity } from '@transitmapper/core/render/render-identity';
import { createRenderTierStateResolver } from '@transitmapper/core/render/render-presentation';
import { selectionFocus } from './selectionFocus';
import {
  LAYER_SPECS,
  LYR_LANDMARKS,
  LYR_LANDMARK_LABELS,
  LYR_JUNCTIONS,
  LYR_WAYS_SOLID,
  LYR_WAYS_DASHED,
  LYR_SERVICES_SOLID,
  LYR_SERVICES_HIT,
  LYR_SERVICES_ELEVATED,
  LYR_SERVICES_UNDERGROUND,
  LYR_STATIONS,
  LYR_STATION_LABELS_MAJOR,
  LYR_FACILITIES,
  registerMapIcons,
  SRC_ENDPOINT_HINT,
  SRC_FACILITIES,
  SRC_FOOTPRINTS,
  SRC_GESTURE,
  SRC_HANDLES,
  SRC_HIT_FEATURES,
  SRC_SERVICE_TERMINI,
  SRC_ACTION_ANCHOR,
  SRC_CONNECTORS,
  SRC_JUNCTION_GUIDES,
  SRC_JUNCTIONS,
  SRC_LANDMARKS,
  SRC_LANE_ARROWS,
  SRC_SERVICE_ARROWS,
  SRC_LANE_MARKINGS,
  SRC_LANES,
  SRC_MARQUEE,
  SRC_PHYSICAL_HANDLES,
  SRC_PLATFORMS,
  SRC_PREVIEW,
  SRC_SHARING,
  SRC_SERVICES,
  SRC_VEHICLES,
  SRC_VEHICLES_INFRA,
  SRC_WAYS,
  SRC_WAY_LABELS,
  SRC_STATIONS,
} from './layers';
import type { RenderViewOptions, ViewOptions } from '@transitmapper/core/render/buildFeatures';
import {
  createGestureProjectionController,
  createProjectionOperationCounts,
  recordFullProjection,
  recordSourceUpload,
  type EditGestureTargets,
  type GestureProjectionController,
  type GestureProjectionResult,
  type ProjectionOperationCounts,
} from './gestureProjection';
import {
  createGesturePaintSettlementController,
  createRendererWorkSettlementTracker,
  gestureNeedsCommittedPaint,
  waitForGestureRenderBoundary,
  type RendererWorkLease,
} from './render-settlement';
import { createGestureLayerMaskController } from './gestureLayerMask';
import type { SourceMutationSettlementHost } from './sourceMutationSettlement';
import { planStopGestureSettlement } from './stopGesturePlan';
import { createStopGesturePreviewController } from './stopGesturePreview';
import { createStopGestureSettlementController } from './stopGestureSettlement';
import {
  ALL_SYSTEM_FEATURE_SOURCES,
  createSourceUploadQueue,
  sourceUploadsForSystemChange,
  type SourceUploadBatch,
  type SourceUploadRequest,
  type SourceUploadTransition,
  type SystemFeatureSourceId,
} from './sourceUploadPlan';
import { mergeSourceFeatureProjectionCounts } from './feature-projection-counts';
import type { AcceptedSceneUpdate } from './accepted-scene-store';
import type { RenderSceneSourceUpdateResult } from './render-scene-source-updater';
import { renderPresentationFromMap } from './render-presentation';
import { landmarksFeatureCollection } from './landmarks';
import { getMap, setMap } from './mapRef';
import {
  attachInitialStyleFallback,
  INITIAL_STYLE_FALLBACK_TIMEOUT_MS,
} from './initialStyleFallback';
import {
  attachInitialMapReady,
  shouldProjectInitialDocument,
  shouldScheduleInitialReadyDocument,
} from './initial-map-ready';
import { initLiveCamera, setLiveCamera } from '../camera/liveCamera';
import { attachPerfHarness } from '../perf';
import {
  acceptedSystemScenePaintReady,
  markFirstSystemMapPaint,
  systemPaintReady,
} from '../perf/mapPaintMark';
import { createRendererStatsCollector } from '../perf/renderer-stats';
import { attachSimDevHandle } from '../sim/devHandle';
import { attachVehicleAnimation } from '../sim/vehicles';
import { createVehicleAnimationGateController } from '../sim/vehicle-animation-gate';
import { clearArmedTerminusForViewChange } from './viewEditorState';
import { layerSpecsForScheme, localBlankStyleForScheme } from './mapTheme';
import { createStyleSwitchController, type StyleSwitchController } from './styleSwitchController';
import { attachMapStyleRecovery, recoverMapStyleState } from './styleRecovery';
import { createMapStyleFeatureDataRecovery } from './styleRecovery';
import {
  canApplyEditorSourceUpdate,
  editorOverlayWorkerInput,
  editorSourcesNeedSystemRefresh,
  planSelectionRenderUpdate,
  selectedJunctionConnectorFeatures,
} from './editor-overlays';
import { applyRendererVisibilityFilters, planViewRenderUpdate } from './render-visibility';
import {
  COMMITTED_SYSTEM_FEATURE_SOURCES,
  EDITOR_SYSTEM_FEATURE_SOURCES,
  committedSystemFeatureSources,
  emptySystemFeatures,
} from './system-feature-sources';
import {
  createSourceFeatureProjectionAccounting,
  scheduleRenderProjectionFailureRetry,
} from './committed-feature-projection';
import {
  canReuseCommittedCameraRefresh,
  createCameraRenderPreloadController,
  createPresentationRefreshScheduler,
  type CommittedCameraCoverage,
} from './camera-render-preload';
import { bankedLayerId, SOURCE_BANK_IDS } from './source-bank';
import {
  logicalBankedLayerIds,
  sourceBankLayerSpecs,
  isBankedRenderLayer,
  logicalRenderLayerId,
  logicalRenderSourceId,
  physicalRenderSourceIds,
  renderOverlayNeedsHealing as physicalOverlayNeedsHealing,
} from './source-bank-layers';
import type { SourceBankSettlementHost } from './source-bank-settlement';
import { createLiveMapRenderer, type LiveMapRenderer } from './live-map-renderer';
import { createDiagramLayoutWorker } from './diagram-layout-worker';
import { createFeatureProjectionWorker } from './feature-projection-worker';
import { createFrameFallbackScheduler } from './frame-fallback-scheduler';
import {
  createEditorFeatureState,
  type EditorFeatureState,
  type SceneTargetResolver,
} from './editor-feature-state';
const OWN_LAYER_IDS = new Set(sourceBankLayerSpecs(LAYER_SPECS).map((layer) => layer.id));
const PERF_HARNESS_BUILD = import.meta.env.DEV || import.meta.env.VITE_PERF_BUILD === '1';

function recordSourceUploads(counts: ProjectionOperationCounts, sourceUploadCount: number): void {
  counts.sourceUploadCount += sourceUploadCount;
}

/** Diagram mode is a schematic with no real geography, so the street basemap
 *  underneath would be actively misleading — hide every style layer that
 *  isn't one of ours (leaving its background/land color as a plain backdrop)
 *  rather than tearing down and reloading the whole map style. */
function setBasemapVisible(map: MLMap, visible: boolean): void {
  const layers = map.getStyle().layers;
  for (const layer of layers) {
    if (OWN_LAYER_IDS.has(layer.id)) continue;
    map.setLayoutProperty(layer.id, 'visibility', visible ? 'visible' : 'none');
  }
}

interface ViewModeMapUpdate {
  previousMode: ViewOptions['viewMode'];
  nextMode: ViewOptions['viewMode'];
  system: TransitSystem;
  container: HTMLDivElement | null;
}

function applyViewModeToMap(map: MLMap, update: ViewModeMapUpdate): void {
  // Keep the last accepted geography on screen while the first Diagram
  // result is in the Worker. Hiding the basemap here would turn a failed or
  // superseded request into a blank map. The accepted Diagram callback hides
  // it only once the corresponding schematic scene has painted.
  if (update.previousMode === 'diagram' && update.nextMode !== 'diagram') {
    setBasemapVisible(map, true);
  }
  if (update.nextMode !== 'diagram' || update.previousMode === 'diagram') return;
  // Enter Diagram immediately from the saved geographic bounds. The Worker
  // resolves its schematic snapshot separately; solving it here would freeze
  // the very transition that is meant to reveal the alternate view.
  const bounds = systemBounds(update.system);
  if (bounds && update.container) {
    map.fitBounds(bounds, { padding: framePadding(update.container, 60), duration: 500 });
  }
}

export interface MapCanvasProps {
  /** Called once if the basemap never loads. The editor still works without
   *  it — every way, station and service is ours and draws regardless — but
   *  the backdrop is blank, and a user who isn't told assumes the app broke
   *  rather than that a third-party tile host is down. */
  onBasemapUnavailable?: () => void;
  /** Stops editor vehicle source writes while onboarding owns the visible map. */
  vehiclePaintingSuspended?: boolean;
}

interface MapErrorLike {
  error?: unknown;
  sourceId?: string;
}

/**
 * How much of the map the chrome is sitting on top of.
 *
 * The map is full-bleed behind an opaque top bar and an opaque bottom bar (and
 * on desktop a docked panel), so its canvas is larger than the part anyone can
 * see. MapLibre takes that as padding: a camera told about it centres and fits
 * inside the visible band instead of the whole canvas.
 *
 * Read from CSS rather than measured. app.css declares `--map-pad-*` beside the
 * rules that create the chrome, which makes one source for two readers — this,
 * and the rule that lifts MapLibre's own controls off the bottom bar. Measuring
 * the rendered chrome instead is what an earlier version did, via a
 * ResizeObserver that wrote a height onto the document root for CSS to read
 * back; the numbers were never the hard part.
 */
/** The cast is load-bearing: `getSource` is typed `Source`, which has no
 *  `setData`. */
function clearActionAnchor(): void {
  const source = getMap()?.getSource<GeoJSONSource>(SRC_ACTION_ANCHOR);
  source?.setData({ type: 'FeatureCollection', features: [] });
}

function chromePadding(el: HTMLElement): PaddingOptions {
  const style = getComputedStyle(el);
  const side = (name: string) => Number.parseFloat(style.getPropertyValue(name)) || 0;
  return {
    top: side('--map-pad-top'),
    bottom: side('--map-pad-bottom'),
    left: side('--map-pad-left'),
    right: side('--map-pad-right'),
  };
}

/**
 * The chrome's footprint plus room to breathe, for one framing operation.
 *
 * `fitBounds` takes padding as part of CameraOptions, so a bare number there
 * REPLACES whatever `setPadding` established rather than adding to it. All
 * three fits in this file passed one — 60, 100, 120 — which is how content
 * ended up framed behind the bars even though the map knew where they were.
 */
function framePadding(el: HTMLElement, margin: number): PaddingOptions {
  const chrome = chromePadding(el);
  return {
    top: chrome.top + margin,
    bottom: chrome.bottom + margin,
    left: chrome.left + margin,
    right: chrome.right + margin,
  };
}

export function MapCanvas({
  onBasemapUnavailable,
  vehiclePaintingSuspended = false,
}: MapCanvasProps) {
  const colorScheme = useSystemColorScheme();
  const initialColorSchemeRef = useRef(colorScheme);
  const styleSwitchControllerRef = useRef<StyleSwitchController | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pointerBadge, setPointerBadge] = useState<{
    intent: PointerIntent | null;
    x: number;
    y: number;
  }>({ intent: null, x: 0, y: 0 });
  const refreshPointerIntentRef = useRef<(() => void) | null>(null);
  const [terminusConnectionChoice, setTerminusConnectionChoice] =
    useState<TerminusConnectionChoice | null>(null);
  const store = useEditorStore();
  const { openShortcuts, toggleUi } = useUi();
  const { contextMenuAt, openContextMenu, closeContextMenu } = useContextMenu();
  const contextMenuOpenRef = useRef(false);
  contextMenuOpenRef.current = contextMenuAt !== null || terminusConnectionChoice !== null;
  useEffect(() => {
    if (contextMenuAt !== null || terminusConnectionChoice !== null) return;
    clearActionAnchor();
    // The controller holds the last real map pointer. Re-evaluate it now that
    // the menu no longer owns focus instead of consuming the next mouse move.
    refreshPointerIntentRef.current?.();
  }, [contextMenuAt, terminusConnectionChoice]);
  const { viewMode, setViewMode, visibleModes, visibleWayTypes, showLandmarks } = useView();
  const viewRef = useRef<ViewOptions>({ viewMode, visibleModes, visibleWayTypes });
  useEffect(() => {
    clearActionAnchor();
    clearArmedTerminusForViewChange(store);
    setTerminusConnectionChoice((choice) => {
      choice?.dismiss();
      return null;
    });
  }, [viewMode, store]);
  useEffect(() => {
    if (!terminusConnectionChoice) return;
    const dismiss = () => {
      terminusConnectionChoice.dismiss();
      setTerminusConnectionChoice(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [terminusConnectionChoice]);
  useEffect(
    () =>
      store.subscribe((state, previous) => {
        if (state.tool === previous.tool) return;
        setTerminusConnectionChoice((choice) => {
          choice?.dismiss();
          return null;
        });
      }),
    [store],
  );
  // Created once by SimProvider and injected into the animation loop below,
  // the same way the editor store is — the loop is imperative and lives
  // outside React, so it is handed what it needs rather than reaching for an
  // ambient one.
  const simClock = useSimClock();
  const { togglePaused, stepSpeed, pinnedPeriod } = useSim();

  // The map-setup effect below runs once (mount-only); it reads the latest
  // view options from this ref rather than closing over React state, so a
  // separate effect can push view-only changes (Network⇄Infrastructure, a
  // filter toggle) without tearing down and recreating the whole map.
  // Held in a ref, not read directly in the map effect: that effect builds the
  // whole map, and listing a caller-supplied callback in its deps would tear
  // the map down and rebuild it every time App re-renders with a fresh arrow.
  const basemapFailureRef = useRef(onBasemapUnavailable);
  basemapFailureRef.current = onBasemapUnavailable;
  // Same reasoning as basemapFailureRef: the keymap needs to run these, but
  // naming them in the map effect's deps would tear down and rebuild the
  // entire map if their identity ever changed.
  const simCommandsRef = useRef<SimCommands>({ togglePaused, stepSpeed });
  simCommandsRef.current = { togglePaused, stepSpeed };
  const simCommands = useRef<SimCommands>({
    togglePaused: () => simCommandsRef.current.togglePaused(),
    stepSpeed: (direction) => simCommandsRef.current.stepSpeed(direction),
  }).current;

  const vehicleGateController = useRef(
    createVehicleAnimationGateController(() => viewRef.current),
  ).current;
  vehicleGateController.update(pinnedPeriod, vehiclePaintingSuspended);

  useEffect(() => {
    // The imperative vehicle host does not poll React state while it is idle.
    vehicleGateController.notify();
  }, [pinnedPeriod, vehiclePaintingSuspended, vehicleGateController]);

  const coarsePointer = useCoarsePointer();
  const showLandmarksRef = useRef(showLandmarks);
  showLandmarksRef.current = showLandmarks;
  // The map layer takes tolerances, not a device: which profile applies is
  // resolved here, where a hook can see it, and interactions.ts asks nothing
  // about the pointer. Through a ref because a pointer type appearing
  // mid-session must not tear down and rebuild the map.
  const tuningRef = useRef(inputTuningFor(coarsePointer));
  tuningRef.current = inputTuningFor(coarsePointer);
  const schedulePushDataRef = useRef<(() => void) | null>(null);
  const applyRendererVisibilityRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const previous = viewRef.current;
    const next: ViewOptions = { viewMode, visibleModes, visibleWayTypes };
    const update = planViewRenderUpdate(previous, next);
    viewRef.current = next;
    refreshPointerIntentRef.current?.();
    if (update.notifyVehicles) {
      vehicleGateController.notify();
    }
    if (update.reproject) schedulePushDataRef.current?.();
    const map = getMap();
    if (!map?.getStyle()) return;
    if (update.updateFilters) applyRendererVisibilityRef.current?.();
    applyViewModeToMap(map, {
      previousMode: previous.viewMode,
      nextMode: viewMode,
      system: store.getState().system,
      container: containerRef.current,
    });
    map.triggerRepaint();
  }, [viewMode, visibleModes, visibleWayTypes, store, vehicleGateController]);

  // Landmarks are a pure layer-visibility toggle. buildFeatures never reads
  // showLandmarks, so this deliberately does NOT live in the effect above:
  // there, every toggle ran a full synchronous rebuild that produced
  // byte-identical data for every renderer-owned source.
  useEffect(() => {
    const map = getMap();
    if (!map?.getStyle() || !map.getLayer(LYR_LANDMARKS)) return;
    // Landmarks are real-world reference points; Diagram's schematic
    // coordinates aren't real geography, so they'd land somewhere meaningless.
    const visibility = showLandmarks && viewMode !== 'diagram' ? 'visible' : 'none';
    map.setLayoutProperty(LYR_LANDMARKS, 'visibility', visibility);
    if (map.getLayer(LYR_LANDMARK_LABELS)) {
      map.setLayoutProperty(LYR_LANDMARK_LABELS, 'visibility', visibility);
    }
    map.triggerRepaint();
  }, [showLandmarks, viewMode]);

  useEffect(() => {
    if (!containerRef.current) return;
    const initialColorScheme = initialColorSchemeRef.current;
    const initial = store.getState().system;
    // Seed the live camera holder from the loaded system's saved viewport
    // (camera/liveCamera.ts owns the LIVE camera from here on, not `system`).
    initLiveCamera(initial.viewport);

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: localBlankStyleForScheme(initialColorScheme),
      center: initial.viewport.center,
      zoom: initial.viewport.zoom,
      // No preserveDrawingBuffer: PNG export renders on a dedicated offscreen
      // map (map/export/exportRenderer.ts), so the live map no longer pays the
      // always-on per-frame drawing-buffer copy that reading its canvas required.
      fadeDuration: 0, // no trailing label/icon fade animation after a pan/zoom — snappier, one fewer post-move repaint pass
      refreshExpiredTiles: false, // the basemap is static within a session; don't re-fetch/re-tessellate expired tiles
      // SimCity-style: the primary press belongs to the active tool, never to
      // the camera. On a mouse that means pan is right-drag or space-drag; by
      // finger it means two fingers (see interactions.ts's touch adapter, which
      // owns that gesture). Leaving dragPan off is what reserves the one-finger
      // drag for the tool — MapLibre's own DragPanHandler would otherwise claim
      // it, and there is no supported way to enable its touch half alone.
      dragPan: false,
      dragRotate: false, // right-drag pans, never rotates
      doubleClickZoom: false, // double-click (and double-tap) finishes a line instead
      keyboard: false, // we own the keymap (see keymap.ts)
      boxZoom: false, // Shift+drag is our marquee-select gesture, not MapLibre's native box-zoom
      // Pinch-to-zoom is MapLibre's, and the only camera gesture it still owns.
      touchZoomRotate: true,
      touchPitch: false, // a two-finger drag pans; it must never tilt the map instead
      attributionControl: false, // replaced below with a compact (collapsed-to-an-"i") one
    });
    // Before anything frames anything. Every camera operation from here —
    // fitBounds, flyTo, the initial frame — then keeps inside the band the
    // chrome leaves visible, rather than centring on a canvas whose top and
    // bottom are behind opaque bars.
    map.setPadding(chromePadding(containerRef.current), { duration: 0 });

    // Rotation would leave a reader unable to get back to north, and every
    // projection in this app assumes an unrotated camera (see render/project).
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    setMap(map);
    const startupTrace: string[] = [];
    const traceStartup = (event: string) => {
      if (!PERF_HARNESS_BUILD) return;
      startupTrace.push(event);
    };
    if (PERF_HARNESS_BUILD) window.__mapStartupTrace = () => [...startupTrace];

    // Report initial OpenFreeMap failures; overlay recovery can mask a style that never loaded.
    let activeMapScheme = initialColorScheme;
    let liveRenderer: LiveMapRenderer | null = null;
    const onMapError = (event: MapErrorLike) => {
      if (liveRenderer?.handleSourceError(event)) return;
      console.error('[transitmapper]', event.error ?? event);
    };
    map.on('error', onMapError);
    const initialStyleOwnership = { localOnly: false };
    const detachInitialStyleFallback = attachInitialStyleFallback(map, {
      scheme: initialColorScheme,
      timeoutMs: INITIAL_STYLE_FALLBACK_TIMEOUT_MS,
      startsWithLocalStyle: true,
      onLocalStyleSelected: () => {
        initialStyleOwnership.localOnly = true;
        styleSwitchControllerRef.current?.lockToLocal(initialColorScheme);
      },
      onFallback: () => basemapFailureRef.current?.(),
    });

    let detachInteractions: (() => void) | null = null;
    let detachVehicles: (() => void) | null = null;
    let detachPerf: (() => void) | null = null;
    let detachSimDev: (() => void) | null = null;
    let initialPaintListener: (() => void) | null = null;
    let initialSystemDataUploaded = false;
    let lastSystemId = initial.id;
    const emptyFC = { type: 'FeatureCollection' as const, features: [] };

    const handleWayIds = (): string[] => {
      // Diagram mode is view-only — a reshape handle there would promise a
      // drag that attachInteractions refuses to honor (see isDiagramMode).
      if (viewRef.current.viewMode === 'diagram') return [];
      const s = store.getState();
      if (s.activeWayId) return [s.activeWayId];
      if (s.selection?.kind === 'way') return [s.selection.id];
      if (s.selection?.kind === 'service') {
        const selectedServiceId = s.selection.id;
        const svc = s.system.services.find((sv) => sv.id === selectedServiceId);
        return svc ? serviceWayIds(svc) : [];
      }
      return [];
    };

    // The station whose footprint/platform vertices are editable right now —
    // simply whichever station is selected (footprints/platforms are a
    // station's own physical detail, not a separate selection target).
    const physicalHandleStationId = (): string | null => {
      const s = store.getState();
      return s.selection?.kind === 'station' ? s.selection.id : null;
    };

    // Same, for a group's (facility-complex's) own footprint — whichever
    // group is selected.
    const physicalHandleGroupId = (): string | null => {
      const s = store.getState();
      return s.selection?.kind === 'group' ? s.selection.id : null;
    };

    const renderPresentationNow = () => {
      const canvas = map.getCanvas();
      const container = map.getContainer();
      return renderPresentationFromMap({
        bounds: map.getBounds(),
        zoom: map.getZoom(),
        viewportWidthPx: canvas.clientWidth,
        viewportHeightPx: canvas.clientHeight,
        displayedWidthPx: container.clientWidth,
        displayedHeightPx: container.clientHeight,
        pixelRatio: map.getPixelRatio(),
      });
    };
    const cameraRenderPreload = createCameraRenderPreloadController();
    cameraRenderPreload.observe(renderPresentationNow(), performance.now());
    const tierStateResolver = createRenderTierStateResolver();
    const renderViewForPresentation = (
      presentation: ReturnType<typeof renderPresentationNow>,
    ): RenderViewOptions => ({
      ...viewRef.current,
      presentation,
      styleDeferredVisibility: true,
      tierStateResolver,
    });
    const liveRenderView = (): RenderViewOptions =>
      renderViewForPresentation(renderPresentationNow());

    const LOGICAL_SOURCES = [
      SRC_WAYS,
      SRC_SERVICES,
      SRC_STATIONS,
      SRC_HANDLES,
      SRC_HIT_FEATURES,
      SRC_SERVICE_TERMINI,
      SRC_ACTION_ANCHOR,
      SRC_PREVIEW,
      SRC_GESTURE,
      SRC_SHARING,
      SRC_ENDPOINT_HINT,
      SRC_MARQUEE,
      SRC_FOOTPRINTS,
      SRC_PLATFORMS,
      SRC_FACILITIES,
      SRC_PHYSICAL_HANDLES,
      SRC_VEHICLES,
      SRC_VEHICLES_INFRA,
      SRC_LANES,
      SRC_LANE_MARKINGS,
      SRC_LANE_ARROWS,
      SRC_SERVICE_ARROWS,
      SRC_JUNCTIONS,
      SRC_CONNECTORS,
      SRC_JUNCTION_GUIDES,
      SRC_WAY_LABELS,
    ];
    const ALL_SOURCES = physicalRenderSourceIds(LOGICAL_SOURCES);
    const activeRenderSourceId = (logicalSourceId: string) =>
      liveRenderer?.activeSourceId(logicalSourceId) ?? logicalSourceId;
    const activeLayerSpecs = () => layerSpecsForScheme(activeMapScheme);
    const activePhysicalLayerSpecs = () => sourceBankLayerSpecs(activeLayerSpecs());
    const bankedLayerIds = logicalBankedLayerIds(LAYER_SPECS);
    const applyRendererVisibility = () =>
      applyRendererVisibilityFilters(
        map,
        activePhysicalLayerSpecs(),
        viewRef.current.visibleModes,
        viewRef.current.visibleWayTypes,
      );
    applyRendererVisibilityRef.current = applyRendererVisibility;

    // Idempotent overlay setup. Sources/layers are normally added once on
    // "load", but an HMR pass or style hiccup landing mid-setup can leave
    // SOME layers silently missing until a hard reload (seen live: addLayer
    // "source not found" errors, then footprint layers gone — "station
    // boundaries only visible while drawing", because only the drag preview
    // still rendered). This heals that: anything missing is re-added, with
    // beforeId anchoring so a healed layer returns to its correct place in
    // the paint order instead of landing on top.
    const ensureOverlay = (): boolean => {
      try {
        const layerSpecs = activePhysicalLayerSpecs();
        for (const src of ALL_SOURCES) {
          if (map.getSource(src)) continue;
          // The two heavy static line sources (imported GTFS geometry — ~121k
          // waypoints at RTC scale) get an explicit geojson-vt simplification
          // tolerance so edge tiles emit fewer vertices as they build. Tolerance
          // is in per-tile units, so it's ~lossless at high zoom (tiles cover
          // little ground → almost nothing drops) — max-zoom fidelity and the
          // exact source `Way.points` are untouched. Kept modest; revisit if any
          // mid-zoom kinking shows.
          const logicalSourceId = logicalRenderSourceId(src);
          const heavy = logicalSourceId === SRC_WAYS || logicalSourceId === SRC_SERVICES;
          map.addSource(src, {
            type: 'geojson',
            data: emptyFC,
            ...(heavy ? { tolerance: 1 } : {}),
          });
        }
        // Static context, not system-derived — set once here rather than on
        // every pushData() like the sources above.
        if (!map.getSource(SRC_LANDMARKS))
          map.addSource(SRC_LANDMARKS, { type: 'geojson', data: landmarksFeatureCollection() });
        for (let i = 0; i < layerSpecs.length; i++) {
          const spec = layerSpecs[i];
          if (map.getLayer(spec.id)) continue;
          const anchor = layerSpecs.slice(i + 1).find((later) => map.getLayer(later.id));
          map.addLayer(spec, anchor?.id);
        }
        applyRendererVisibility();
        liveRenderer?.restoreActiveLayers();
        return true;
      } catch (error) {
        // A stale style event can arrive after MapLibre begins replacing the
        // remote basemap with the local fallback. The later style.load will
        // retry this exact idempotent setup against the current style.
        if (error instanceof Error && error.message === 'Style is not done loading.') return false;
        throw error;
      }
    };

    const requiredGeoJsonSource = (sourceId: string): GeoJSONSource => {
      const source = map.getSource<GeoJSONSource>(sourceId);
      if (!source) throw new Error(`Renderer source is unavailable: ${sourceId}`);
      return source;
    };
    const recordSceneUpdate = (update: AcceptedSceneUpdate) => {
      if (update.strategy === 'full') {
        rendererStats.recordFullUpload(update.sourceUploadCount);
      } else if (update.strategy === 'patch') {
        rendererStats.recordPatch({
          addedFeatureCount: update.addedFeatureCount + update.changedFeatureCount,
          removedFeatureCount: update.removedFeatureCount,
          sourceUploadCount: update.sourceUploadCount,
        });
      }
    };
    // Editor work may wait behind a bank publication. Only count the update
    // when it actually reached its unbanked source; a deferred refresh will
    // be applied against the accepted revision by LiveMapRenderer instead.
    const recordAcceptedSceneUpdate = (update: AcceptedSceneUpdate | null) => {
      if (!update) return;
      recordSourceUploads(projectionCounts, update.sourceUploadCount);
      recordSceneUpdate(update);
    };

    // Renderer construction and interaction-state construction reference each
    // other during a bank handoff. The callback is installed synchronously
    // below, before MapLibre can emit an input or paint event.
    let editorFeatureState: EditorFeatureState | null = null;
    const applySelectionState = (targets?: SceneTargetResolver) =>
      editorFeatureState?.applySelection(targets);

    // #1 Hover highlight: light whatever's under the cursor via feature-state
    // (the same halo layers selection uses, at a fainter opacity). Additive and
    // read-only — it queries features and flips feature-state + halo visibility,
    // never touching the cursor or gestures (interactions.ts owns those). Skipped
    // while the map is moving, so a pan/zoom never triggers hover work.
    const HOVER_LAYERS = [
      LYR_WAYS_SOLID,
      LYR_WAYS_DASHED,
      LYR_SERVICES_SOLID,
      LYR_SERVICES_ELEVATED,
      LYR_SERVICES_UNDERGROUND,
      LYR_STATIONS,
      LYR_FACILITIES,
      LYR_JUNCTIONS,
    ];
    let pendingHover: maplibregl.MapMouseEvent | null = null;
    let hoverRaf: number | null = null;
    const flushHover = () => {
      hoverRaf = null;
      const e = pendingHover;
      pendingHover = null;
      if (!e) return;
      // Skip while a pan is in flight (isMoving) OR while any mouse button is
      // held — a held button means a DRAG is underway (dragging a handle/point,
      // a station, a marquee…). The map isn't "moving" during a handle drag, so
      // without the button check this ran a queryRenderedFeatures + feature-state
      // + triggerRepaint on every raw mousemove throughout a drag, storming the
      // main thread on top of the per-frame geometry rebuild (the "insane lag"
      // when dragging a midpoint/junction). Hover is a no-button-held affordance.
      if (map.isMoving() || e.originalEvent.buttons !== 0) return;
      const layers = HOVER_LAYERS.flatMap(
        (layer) => liveRenderer?.physicalLayerIds(layer) ?? [],
      ).filter((layer) => map.getLayer(layer));
      const hit = layers.length ? map.queryRenderedFeatures(e.point, { layers })[0] : undefined;
      editorFeatureState?.setHoveredFeature(
        hit && typeof hit.source === 'string' && hit.id != null
          ? { source: hit.source, id: String(hit.id) }
          : null,
      );
    };
    const onHoverMove = (e: maplibregl.MapMouseEvent) => {
      pendingHover = e;
      hoverRaf ??= requestAnimationFrame(flushHover);
    };
    const onHoverOut = () => {
      pendingHover = null;
      if (hoverRaf !== null) {
        cancelAnimationFrame(hoverRaf);
        hoverRaf = null;
      }
      editorFeatureState?.setHoveredFeature(null);
    };
    map.on('mousemove', onHoverMove);
    map.on('mouseout', onHoverOut);

    const projectionCounts = createProjectionOperationCounts();
    const sourceProjectionAccounting = createSourceFeatureProjectionAccounting();
    const rendererStats = createRendererStatsCollector();
    const rendererTasks = new Map<number, () => void>();
    const rendererTaskChannel = new MessageChannel();
    let nextRendererTaskHandle = 0;
    rendererTaskChannel.port1.onmessage = (event: MessageEvent<number>) => {
      const callback = rendererTasks.get(event.data);
      if (!callback) return;
      rendererTasks.delete(event.data);
      callback();
    };
    const rendererFrames = createFrameFallbackScheduler({
      requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
      cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
      setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clearTimeout: (handle) => window.clearTimeout(handle),
      // Virtual displays can throttle animation frames for seconds. Once the
      // fallback detects that state, regular tasks keep bounded preparation
      // slices moving without treating them as new MapLibre paint work.
      scheduleTask: (callback) => {
        const handle = ++nextRendererTaskHandle;
        rendererTasks.set(handle, callback);
        rendererTaskChannel.port2.postMessage(handle);
        return handle;
      },
      cancelTask: (handle) => rendererTasks.delete(handle),
      now: () => performance.now(),
    });
    const sourcePaintHost: SourceBankSettlementHost = {
      triggerRepaint: () => map.triggerRepaint(),
      isSourceLoaded: (sourceId) =>
        Boolean(map.getSource(sourceId)) && map.isSourceLoaded(sourceId),
      onSourceData(listener) {
        const onSourceData = (event: MapSourceDataEvent) => listener(event.sourceId);
        map.on('sourcedata', onSourceData);
        return () => map.off('sourcedata', onSourceData);
      },
      onRender(listener) {
        const onRender = () => listener();
        map.on('render', onRender);
        return () => map.off('render', onRender);
      },
    };
    const renderWorkSettlement = createRendererWorkSettlementTracker();
    let renderSceneRevision = 0;
    let lastRenderedSystemId: string | null = null;
    let committedCameraCoverage: CommittedCameraCoverage | null = null;
    let pendingStyleHeal = false;
    let gestureActive = false;
    let directManipulationActive = false;
    let gestureProjection: GestureProjectionController | null = null;
    let gestureProjectionAborted = false;
    let gesturePreviewVisible = false;
    let fullAfterGesture = false;
    let stopProjectionAbort: AbortController | null = null;
    let pushDataRaf: number | null = null;
    let pushDataFallbackTimer: number | null = null;
    let scheduledPushLease: RendererWorkLease | null = null;
    let sourceFailureRetryCount = 0;
    const sourceUploadQueue = createSourceUploadQueue();
    let refreshCommittedInteractionPreviews = () => {};
    let handleInactiveBankReady = () => {};
    let handleRecoveredScene = (_update: RenderSceneSourceUpdateResult) => {};
    const diagramLayout = createDiagramLayoutWorker();
    const featureProjection = createFeatureProjectionWorker();
    const renderer = createLiveMapRenderer({
      projectionAccounting: sourceProjectionAccounting,
      rendererStats,
      instrumentationEnabled: PERF_HARNESS_BUILD,
      featureProjectionWorker: featureProjection,
      layoutDiagram: async (system, revision, signal) => {
        try {
          return (await diagramLayout.layout(system, revision, signal)).system;
        } catch (error) {
          if (signal.aborted) throw error;
          // The last accepted scene stays on screen. Running the compatibility
          // solver here would make a Worker failure freeze exactly the map
          // interaction this boundary exists to protect.
          console.error('[transitmapper] Diagram Worker failed.', error);
          throw error;
        }
      },
      requeueProjection: (sourceIds, transition) =>
        sourceUploadQueue.add(sourceIds, transition ?? undefined),
      layerSpecs: LAYER_SPECS,
      host: {
        ...sourcePaintHost,
        resolveSource: requiredGeoJsonSource,
        hasLayer: (layerId) => Boolean(map.getLayer(layerId)),
        setLayerVisibility: (layerId, visibility) =>
          map.setLayoutProperty(layerId, 'visibility', visibility),
        setLayerPaintProperty: (layerId, property, value) =>
          map.setPaintProperty(layerId, property, value),
        ensureOverlay,
        now: () => performance.now(),
        scheduleFrame: (callback) => rendererFrames.scheduleFrame(callback),
        cancelFrame: (handle) => rendererFrames.cancelFrame(handle),
      },
      synchronizeInteractionState: (targets) => applySelectionState(targets),
      refreshInteractionPreviews: () => refreshCommittedInteractionPreviews(),
      onInactiveBankReady: () => handleInactiveBankReady(),
      onRecoveryUpdate: (update) => handleRecoveredScene(update),
      onError: (error) => {
        traceStartup(`renderer-error:${error instanceof Error ? error.message : String(error)}`);
        console.error('[transitmapper] live renderer', error);
      },
    });
    liveRenderer = renderer;
    editorFeatureState = createEditorFeatureState({
      map,
      renderer,
      readSelection: () => store.getState().selection,
    });
    const notifyVehicleGate = () => vehicleGateController.notify();
    const beginDirectManipulation = () => {
      if (directManipulationActive) return;
      directManipulationActive = true;
      notifyVehicleGate();
    };
    const endDirectManipulation = () => {
      if (!directManipulationActive) return;
      directManipulationActive = false;
      notifyVehicleGate();
      void styleSwitchControllerRef.current?.flush();
    };

    if (PERF_HARNESS_BUILD) {
      window.__mapProjectionCounts = () => ({
        ...projectionCounts,
        ...sourceProjectionAccounting.snapshot(),
      });
    }

    const overlayNeedsHealing = () =>
      physicalOverlayNeedsHealing({
        sourceIds: ALL_SOURCES,
        layerIds: activePhysicalLayerSpecs().map((layer) => layer.id),
        hasSource: (sourceId) => Boolean(map.getSource(sourceId)),
        hasLayer: (layerId) => Boolean(map.getLayer(layerId)),
      });

    const rendererUploadPlan = (
      requestedSources: readonly SystemFeatureSourceId[],
      systemId: string,
    ): {
      sourceIds: readonly SystemFeatureSourceId[];
      intent: 'incremental' | 'reset' | 'style-heal';
    } | null => {
      if (overlayNeedsHealing()) {
        if (!ensureOverlay()) return null;
        return { sourceIds: COMMITTED_SYSTEM_FEATURE_SOURCES, intent: 'style-heal' };
      }
      if (pendingStyleHeal) {
        return { sourceIds: COMMITTED_SYSTEM_FEATURE_SOURCES, intent: 'style-heal' };
      }
      const reset = lastRenderedSystemId !== null && lastRenderedSystemId !== systemId;
      return {
        sourceIds: committedSystemFeatureSources(requestedSources),
        intent: reset ? 'reset' : 'incremental',
      };
    };

    const pushData = (
      requestedSources: readonly SystemFeatureSourceId[],
      transition: SourceUploadTransition | null = null,
    ): Promise<void> => {
      traceStartup(`push:${requestedSources.length}`);
      if (gestureActive) {
        sourceUploadQueue.add(requestedSources, transition ?? undefined);
        fullAfterGesture = true;
        return Promise.resolve();
      }
      const { system, selection, activePatternId, armedTerminus } = store.getState();
      const presentation = renderPresentationNow();
      const cameraPreload = cameraRenderPreload.prepare(presentation, performance.now());
      const view = renderViewForPresentation(presentation);
      const upload = rendererUploadPlan(requestedSources, system.id);
      if (!upload || upload.sourceIds.length === 0) return Promise.resolve();
      return renderer.projectDocument({
        revision: `${system.id}:${++renderSceneRevision}`,
        transition,
        requestedSourceIds: upload.sourceIds,
        intent: upload.intent,
        candidateEnvelope: cameraPreload.candidateEnvelope,
        projection: {
          system,
          selection,
          handleWayIds: handleWayIds(),
          view,
          physicalHandleStationId: physicalHandleStationId(),
          physicalHandleGroupId: physicalHandleGroupId(),
          activePatternId,
          armedTerminus,
          selectionOwnedConnectors: false,
        },
        onAccepted: ({ update, sourceIds, settlementLatencyMs }) => {
          cameraRenderPreload.accept(cameraPreload.token, settlementLatencyMs);
          committedCameraCoverage = {
            presentation,
            candidateEnvelope: cameraPreload.candidateEnvelope,
          };
          pendingStyleHeal = false;
          lastRenderedSystemId = system.id;
          if (viewRef.current.viewMode === 'diagram') setBasemapVisible(map, false);
          if (sourceIds.includes(SRC_STATIONS)) {
            initialSystemDataUploaded = true;
            if (
              PERF_HARNESS_BUILD &&
              acceptedSystemScenePaintReady({
                documentReady: store.getState().documentStatus === 'ready',
                systemDataUploaded: initialSystemDataUploaded,
                systemDataMatchesDocument: lastRenderedSystemId === store.getState().system.id,
                // RendererSourcePublication resolves its accepted callback only
                // after the activated bank's MapLibre paint barrier completes.
                acceptedScenePainted: true,
              })
            ) {
              if (initialPaintListener) map.off('render', initialPaintListener);
              initialPaintListener = null;
              markFirstSystemMapPaint();
            }
          }
          // The bank flip can settle between MapLibre render callbacks. Request
          // one after this accepted scene so the startup mark proves the
          // published bank reached the canvas rather than merely its sources.
          map.triggerRepaint();
          recordFullProjection(projectionCounts, update.sourceUploadCount);
          recordSceneUpdate(update);
          scheduleSelectionUpdate();
        },
      });
    };

    // Coalesce rebuilds to at most one per animation frame. A bulk import
    // (streamRtcGtfsBatches) merges many batches in quick succession — each
    // is its own store commit, and even differential scene projection is real
    // main-thread work on a large system, so calling it once per
    // commit froze the tab between batches instead of yielding smoothly.
    // Reading store.getState() fresh inside pushData means a coalesced call
    // still reflects the LATEST merged state, not a stale snapshot.
    const schedulePushData = (
      request: SourceUploadRequest = 'all',
      transition?: SourceUploadTransition,
      deferUntilCurrentSettles = false,
      replaceActiveProjection = false,
    ) => {
      traceStartup(
        `schedule:${request === 'all' ? 'all' : request.length}:${store.getState().documentStatus}`,
      );
      liveRenderer?.cancelBackgroundPreparation();
      sourceUploadQueue.add(request, transition);
      scheduledPushLease ??= renderWorkSettlement.begin();
      // A prepared source transaction owns one complete MapLibre mutation
      // task and publishes its retained-scene identity on the following
      // scheduler turn. Never cancel it between those boundaries: doing so
      // could leave MapLibre on the submitted revision while the controller
      // still describes the prior scene. Queue the latest request instead.
      if (renderer.publicationInProgress()) {
        if (renderer.hasActiveProjection()) {
          renderer.afterCurrentProjectionSettles(() => {
            schedulePushData([], undefined, true);
          });
        }
        return;
      }
      // Only a document switch revokes private preparation. Map setup, camera
      // refreshes, and edits often repeat the current request while its first
      // bank is still building. Canceling those requests discarded valid work
      // and delayed the first painted scene by seconds.
      if (renderer.hasActiveProjection()) {
        if (replaceActiveProjection) {
          renderer.cancelProjectionAndRequeue();
        } else {
          renderer.afterCurrentProjectionSettles(() => {
            schedulePushData([], undefined, true);
          });
          return;
        }
      }
      if (gestureActive) {
        fullAfterGesture = true;
        return;
      }
      if (deferUntilCurrentSettles && renderer.hasActiveProjection()) {
        renderer.afterCurrentProjectionSettles(() => {
          schedulePushData([], undefined, true);
        });
        return;
      }
      if (pushDataRaf !== null) return;
      const flushQueuedPushData = () => {
        if (pushDataRaf === null) return;
        traceStartup('flush');
        pushDataRaf = null;
        if (pushDataFallbackTimer !== null) {
          window.clearTimeout(pushDataFallbackTimer);
          pushDataFallbackTimer = null;
        }
        const lease = scheduledPushLease;
        scheduledPushLease = null;
        const batch = sourceUploadQueue.takeBatch();
        void pushData(batch.sourceIds, batch.transition).then(
          () => {
            sourceFailureRetryCount = 0;
            lease?.complete();
          },
          (error: unknown) => {
            traceStartup(
              `projection-failed:${error instanceof Error ? error.message : String(error)}`,
            );
            if (sourceFailureRetryCount < 2) {
              sourceFailureRetryCount += 1;
              retryFailedSourceBatch(batch, lease);
              return;
            }
            sourceFailureRetryCount = 0;
            console.error('[transitmapper] committed renderer projection failed', error);
            lease?.fail(error);
          },
        );
      };
      pushDataRaf = requestAnimationFrame(flushQueuedPushData);
      // Chrome can defer the first animation frame of a newly-created
      // performance context. The queue already coalesces source work, so a
      // short timer may flush that same batch without creating a second scene.
      pushDataFallbackTimer = window.setTimeout(() => {
        if (pushDataRaf === null) return;
        cancelAnimationFrame(pushDataRaf);
        flushQueuedPushData();
      }, 50);
    };

    function retryFailedSourceBatch(
      batch: SourceUploadBatch,
      lease: RendererWorkLease | null,
    ): void {
      scheduleRenderProjectionFailureRetry({
        batch,
        requeue: (current) =>
          sourceUploadQueue.add(current.sourceIds, current.transition ?? undefined),
        whenRecovered: () => liveRenderer?.whenRecoverySettled() ?? Promise.resolve(),
        schedule: () => schedulePushData(),
        completePreviousLease: () => lease?.complete(),
        failPreviousLease: (error) => lease?.fail(error),
      });
    }
    const gestureMask = createGestureLayerMaskController(map, {
      resolveLayerIds: (layerId) => liveRenderer?.physicalLayerIds(layerId) ?? [],
    });

    const clearGesturePreview = () => {
      if (!gesturePreviewVisible) return;
      const source = map.getSource<GeoJSONSource>(SRC_GESTURE);
      if (source) {
        source.setData(emptyFC);
        recordSourceUpload(projectionCounts);
      }
      gesturePreviewVisible = false;
    };

    const gesturePreview = createStopGesturePreviewController({
      render(projection) {
        if (!projection) {
          clearGesturePreview();
          gestureMask.restore();
          return true;
        }
        const source = map.getSource<GeoJSONSource>(SRC_GESTURE);
        if (!source) return false;
        if (projection.data.features.length > 0) {
          source.setData(projection.data);
          recordSourceUpload(projectionCounts);
          gesturePreviewVisible = true;
        } else {
          clearGesturePreview();
        }
        gestureMask.apply(projection.affected);
        return true;
      },
    });
    refreshCommittedInteractionPreviews = () => {
      gestureMask.invalidate();
      gesturePreview.refresh();
    };

    const finishStopSettlementVisuals = () => {
      // updateData normally preserves feature-state, but reapplying here also
      // covers the full-setData fallback without exposing an unselected frame.
      applySelectionState();
      gesturePreview.releaseStops();
      void styleSwitchControllerRef.current?.flush();
    };

    const finishGestureSettlementVisuals = () => {
      // The scratch feature and its layer mask move as one ownership unit.
      // Reapply stable feature-state before exposing the committed geometry so
      // the selected entity cannot flash unselected during the handoff.
      applySelectionState();
      gesturePreview.clearActive();
      void styleSwitchControllerRef.current?.flush();
    };

    const sourceSettlementHost: SourceMutationSettlementHost = {
      onSourceLoading(listener) {
        const onSourceLoading = (event: MapSourceDataEvent) => {
          // GeoJSON tile requests also emit sourcedataloading. Only the
          // source-level event proves that setData/updateData has begun.
          if (!event.tile) listener(event.sourceId);
        };
        map.on('sourcedataloading', onSourceLoading);
        return () => map.off('sourcedataloading', onSourceLoading);
      },
      onSourceData(listener) {
        const onSourceData = (event: MapSourceDataEvent) =>
          listener({
            sourceId: event.sourceId,
            sourceDataType: event.sourceDataType,
            isSourceLoaded: event.isSourceLoaded,
          });
        map.on('sourcedata', onSourceData);
        return () => map.off('sourcedata', onSourceData);
      },
      onRender(listener) {
        map.on('render', listener);
        return () => map.off('render', listener);
      },
      triggerRepaint: () => map.triggerRepaint(),
    };

    const stopSettlement = createStopGestureSettlementController({
      host: sourceSettlementHost,
      sourceId: () => activeRenderSourceId(SRC_STATIONS),
      isGestureActive: () => gestureActive,
      onRelease: finishStopSettlementVisuals,
    });
    let gestureSettlementRetryCount = 0;
    const gestureSettlement = createGesturePaintSettlementController({
      settlePaint: async (signal) => {
        for (let pass = 0; pass < 3; pass++) {
          await renderWorkSettlement.whenSettled();
          await liveRenderer?.whenRecoverySettled();
          if (signal.aborted) throw new Error('Gesture paint settlement was superseded.');
          const recoveryVersion = liveRenderer?.recoveryVersion() ?? 0;
          await waitForGestureRenderBoundary(sourcePaintHost, signal);
          await liveRenderer?.whenRecoverySettled();
          if ((liveRenderer?.recoveryVersion() ?? 0) === recoveryVersion) return;
        }
        throw new Error('Renderer sources did not reach a stable painted recovery epoch.');
      },
      isGestureActive: () => gestureActive,
      onRelease: () => {
        gestureSettlementRetryCount = 0;
        finishGestureSettlementVisuals();
      },
      onUnsettled: (error) => {
        console.error('[transitmapper] gesture paint remains on its retained preview', error);
        if (gestureSettlementRetryCount >= 2) return;
        gestureSettlementRetryCount += 1;
        const recoverySettled = liveRenderer?.whenRecoverySettled() ?? Promise.resolve();
        void recoverySettled.then(() => {
          if (gestureActive || !gestureSettlement.ownsPreview()) return;
          gestureSettlement.begin({ mutate: () => schedulePushData('all') });
        });
      },
    });

    // React view changes invalidate every derived collection and the visual
    // meaning of any pending gesture handoff. Store changes below still pass a
    // dependency-filtered source list.
    schedulePushDataRef.current = () => {
      stopSettlement.invalidate();
      gestureSettlement.invalidate();
      gesturePreview.clear();
      // EditorProvider mounts an empty loading shell before it restores the
      // persisted document. Rendering that shell creates a generation which
      // the real document must cancel a moment later. Wait for the ready
      // snapshot so first publication has one owner and one revision.
      if (store.getState().documentStatus === 'ready') schedulePushData('all');
      scheduleSelectionUpdate();
    };

    const abortGestureProjection = () => {
      stopProjectionAbort?.abort();
      stopProjectionAbort = null;
      gestureProjectionAborted = true;
      fullAfterGesture = true;
      stopSettlement.invalidate();
      gestureSettlement.invalidate();
      gesturePreview.clear();
    };

    const applyGestureProjectionResult = (result: GestureProjectionResult) => {
      if (result.kind === 'abort') {
        abortGestureProjection();
        return;
      }
      if (!gesturePreview.showActive(result.kind === 'preview' ? result.projection : null)) {
        abortGestureProjection();
      }
    };

    const beginGestureProjection = (targets: EditGestureTargets) => {
      if (gestureActive) return;
      stopProjectionAbort?.abort();
      stopProjectionAbort = null;
      gestureActive = true;
      gestureProjectionAborted = false;
      fullAfterGesture = false;
      const baseline = store.getState().system;
      gestureProjection = createGestureProjectionController(baseline, targets, projectionCounts);
      if (renderer.cancelProjectionAndRequeue()) {
        fullAfterGesture = true;
      }
      if (pushDataRaf !== null) {
        cancelAnimationFrame(pushDataRaf);
        pushDataRaf = null;
        fullAfterGesture = true;
      }
      if (selectionRaf !== null) {
        cancelAnimationFrame(selectionRaf);
        selectionRaf = null;
        updateSelectionEditorSources();
      }
      applyGestureProjectionResult(gestureProjection.project(baseline));
    };

    const settleStopGestureDiff = (
      pendingBatch: SourceUploadBatch,
      affected: ReturnType<GestureProjectionController['affected']>,
      stopIds: readonly string[],
    ) => {
      const { system, selection, activePatternId, armedTerminus } = store.getState();
      const countTransaction = sourceProjectionAccounting.begin();
      stopProjectionAbort?.abort();
      const abort = new AbortController();
      stopProjectionAbort = abort;
      gesturePreview.retainActiveStops(affected.stopIds);
      gestureSettlement.releaseIfReady();
      void featureProjection
        .project(
          {
            system,
            selection,
            handleWayIds: handleWayIds(),
            view: liveRenderView(),
            sourceIds: [SRC_STATIONS],
            stopIds,
            physicalHandleStationId: physicalHandleStationId(),
            physicalHandleGroupId: physicalHandleGroupId(),
            activePatternId,
            armedTerminus,
            selectionOwnedConnectors: false,
          },
          abort.signal,
        )
        .then(({ features: projected, counts }) => {
          if (abort.signal.aborted || stopProjectionAbort !== abort) return;
          if (counts) mergeSourceFeatureProjectionCounts(countTransaction.counts, counts);
          const expectedIds = new Set(stopIds);
          const features = projected.stops.features;
          const complete =
            features.length === expectedIds.size &&
            features.every(
              (feature) =>
                typeof feature.properties?.id === 'string' &&
                expectedIds.has(feature.properties.id),
            );
          const source = map.getSource<GeoJSONSource>(activeRenderSourceId(SRC_STATIONS));
          if (!source || !complete) {
            countTransaction.discard();
            stopSettlement.beginFull({
              mutate: () =>
                schedulePushData(pendingBatch.sourceIds, pendingBatch.transition ?? undefined),
            });
            return;
          }
          gesturePreview.retainCommitted(stopIds, features);
          stopSettlement.beginDiff({
            mutate: () => {
              try {
                const update = renderer.updateEditorScene({
                  revision: `${system.id}:${++renderSceneRevision}`,
                  features: projected,
                  sourceIds: [SRC_STATIONS],
                  replacementDomainsBySource: new Map([
                    [SRC_STATIONS, stopIds.map((stopId) => renderDomainIdentity('stop', stopId))],
                  ]),
                });
                recordAcceptedSceneUpdate(update);
                countTransaction.accept();
              } catch (error) {
                countTransaction.discard();
                throw error;
              }
            },
            fallback: () => {
              countTransaction.discard();
              schedulePushData(pendingBatch.sourceIds, pendingBatch.transition ?? undefined);
            },
          });
        })
        .catch((error: unknown) => {
          countTransaction.discard();
          if (abort.signal.aborted) return;
          console.error('[transitmapper] stop feature projection failed.', error);
          stopSettlement.beginFull({
            mutate: () =>
              schedulePushData(pendingBatch.sourceIds, pendingBatch.transition ?? undefined),
          });
        });
    };

    const settleFullGestureProjection = (
      affected: ReturnType<GestureProjectionController['affected']>,
      finish: ReturnType<GestureProjectionController['finish']>,
      pendingBatch: SourceUploadBatch,
      preserveStopPreview: boolean,
    ) => {
      const pendingSources = pendingBatch.sourceIds;
      const refreshRequest = pendingSources.length > 0 ? pendingSources : 'all';
      const transition =
        pendingSources.length > 0 ? (pendingBatch.transition ?? undefined) : undefined;
      if (finish.hadPreview && gestureNeedsCommittedPaint(affected)) {
        gestureSettlement.begin({ mutate: () => schedulePushData(refreshRequest, transition) });
        return;
      }
      const refreshesStops = pendingSources.length === 0 || pendingSources.includes(SRC_STATIONS);
      if (preserveStopPreview) gesturePreview.retainActiveStops(affected.stopIds);
      else gesturePreview.clearActive();
      gestureSettlement.releaseIfReady();

      if (refreshesStops && (preserveStopPreview || stopSettlement.ownsPreview())) {
        stopSettlement.beginFull({ mutate: () => schedulePushData(refreshRequest, transition) });
        return;
      }
      if (!stopSettlement.ownsPreview()) {
        stopSettlement.invalidate();
        gesturePreview.releaseStops();
      }
      schedulePushData(refreshRequest, transition);
    };

    const settleGestureProjection = () => {
      const affected = gestureProjection?.affected() ?? {
        wayIds: [],
        stopIds: [],
        stationIds: [],
        facilityIds: [],
        groupIds: [],
        nodeIds: [],
      };
      const finish = gestureProjection?.finish() ?? { rebuild: false, hadPreview: false };
      gestureActive = false;
      gestureProjection = null;
      const needsFullProjection = finish.rebuild || fullAfterGesture;
      fullAfterGesture = false;
      if (needsFullProjection) {
        const pendingBatch = sourceUploadQueue.takeBatch();
        const pendingSources = pendingBatch.sourceIds;
        const stationSourceId = activeRenderSourceId(SRC_STATIONS);
        const stopPlan = planStopGestureSettlement({
          viewMode: viewRef.current.viewMode,
          affected,
          pendingSources,
          // Committed sources belong to the active physical bank. During the
          // first bank publication there is no active source yet, so absence
          // means the stop preview must remain in control rather than asking
          // MapLibre to load the retired logical source ID.
          stopSourceReady:
            (Boolean(map.getSource(stationSourceId)) && map.isSourceLoaded(stationSourceId)) ||
            stopSettlement.ownsPreview(),
          overlayHealthy: !overlayNeedsHealing(),
          projectionAborted: gestureProjectionAborted,
        });
        if (stopPlan.kind === 'diff') {
          settleStopGestureDiff(pendingBatch, affected, stopPlan.stopIds);
          return;
        }
        settleFullGestureProjection(affected, finish, pendingBatch, stopPlan.preserveStopPreview);
        return;
      } else if (gestureSettlement.ownsPreview()) {
        // The older barrier may have completed during this gesture. Do not
        // clear the newer active projection unless that generation is ready;
        // a later non-station commit will supersede it through begin().
        stopSettlement.releaseIfReady();
        gestureSettlement.releaseIfReady();
        return;
      } else if (stopSettlement.ownsPreview()) {
        // A click against a settling preview may have taken ownership while
        // its source completed. Release now if ready; otherwise its existing
        // paint barrier will release after this gesture.
        gesturePreview.clearActive();
        stopSettlement.releaseIfReady();
        return;
      } else {
        gesturePreview.clearActive();
      }
    };

    const endGestureProjection = () => {
      if (!gestureActive) return;
      try {
        settleGestureProjection();
      } finally {
        // A queued system-theme change may proceed only after either the live
        // gesture or its committed-paint handoff has released map ownership.
        void styleSwitchControllerRef.current?.flush();
      }
    };

    // Selection-only fast path: update halos via feature-state and refresh only
    // the small editor-owned sources. Junction guides are derived for one node
    // here rather than rebuilding the settled city-scale junction scene.
    let selectionRaf: number | null = null;
    let editorProjectionAbort: AbortController | null = null;
    const updateSelectionEditorSources = () => {
      if (overlayNeedsHealing()) return;
      if (
        !canApplyEditorSourceUpdate(renderer.hasAcceptedScene(), renderer.publicationInProgress())
      ) {
        return;
      }
      const { system, selection } = store.getState();
      if (viewRef.current.viewMode === 'diagram') {
        editorProjectionAbort?.abort();
        editorProjectionAbort = null;
        // Diagram layout is Worker-owned in Phase 6. Selection only restores
        // stable feature-state; its editor sources are already empty from the
        // committed view projection, so never synchronously rerun the solver.
        const features = emptySystemFeatures();
        const update = renderer.updateEditorScene({
          revision: `${system.id}:${++renderSceneRevision}`,
          features,
          sourceIds: EDITOR_SYSTEM_FEATURE_SOURCES,
        });
        recordAcceptedSceneUpdate(update);
        applySelectionState();
        const guideSource = map.getSource<GeoJSONSource>(SRC_JUNCTION_GUIDES);
        if (guideSource) {
          guideSource.setData(emptyFC);
          recordSourceUpload(projectionCounts);
        }
        return;
      }
      const countTransaction = sourceProjectionAccounting.begin();
      const infrastructure = viewRef.current.viewMode === 'infrastructure';
      editorProjectionAbort?.abort();
      const abort = new AbortController();
      editorProjectionAbort = abort;
      const { activePatternId, armedTerminus } = store.getState();
      const input = editorOverlayWorkerInput({
        system,
        selection,
        handleWayIds: handleWayIds(),
        view: liveRenderView(),
        physicalHandleStationId: infrastructure ? physicalHandleStationId() : null,
        physicalHandleGroupId: infrastructure ? physicalHandleGroupId() : null,
        activePatternId,
        armedTerminus,
      });
      void featureProjection
        .project(input, abort.signal)
        .then(({ features, counts }) => {
          if (abort.signal.aborted || editorProjectionAbort !== abort) return;
          if (counts) mergeSourceFeatureProjectionCounts(countTransaction.counts, counts);
          try {
            const update = renderer.updateEditorScene({
              revision: `${system.id}:${++renderSceneRevision}`,
              features,
              sourceIds: EDITOR_SYSTEM_FEATURE_SOURCES,
            });
            recordAcceptedSceneUpdate(update);
            applySelectionState();
            const guideSource = map.getSource<GeoJSONSource>(SRC_JUNCTION_GUIDES);
            if (guideSource) {
              guideSource.setData(
                infrastructure
                  ? selectedJunctionConnectorFeatures(
                      system,
                      selection?.kind === 'node' ? selection.id : null,
                    )
                  : emptyFC,
              );
              recordSourceUpload(projectionCounts);
            }
            countTransaction.accept();
          } finally {
            countTransaction.discard();
          }
        })
        .catch((error: unknown) => {
          countTransaction.discard();
          if (abort.signal.aborted) return;
          console.error('[transitmapper] editor feature projection failed.', error);
        });
    };
    const scheduleSelectionUpdate = () => {
      if (selectionRaf !== null) return;
      selectionRaf = requestAnimationFrame(() => {
        selectionRaf = null;
        updateSelectionEditorSources();
      });
    };
    const styleFeatureDataRecovery = createMapStyleFeatureDataRecovery({
      hasRetainedScene: () => renderer.hasAcceptedScene(),
      canScheduleFullProjection: () =>
        shouldProjectInitialDocument(store.getState().documentStatus),
      setPending: (pending) => {
        pendingStyleHeal = pending;
      },
      invalidateSourceState: () => renderer.invalidateSourceState(),
      healCurrentScene: () => renderer.healAcceptedScene(),
      scheduleRetainedSceneHeal: () => renderer.requestRecovery(),
      recordFullUpload: (update) => {
        recordSourceUploads(projectionCounts, update.sourceUploadCount);
        rendererStats.recordFullUpload(update.sourceUploadCount);
      },
      replayEditorState: () => {
        // The retained complete scene already includes the editor-owned
        // sources. Reapply feature state only; scheduling their projector here
        // would turn a source replay back into geometry work.
        applySelectionState();
        map.triggerRepaint();
      },
      scheduleFullProjection: () => {
        schedulePushData('all');
        scheduleSelectionUpdate();
      },
      requestSourceRecovery: () => renderer.requestRecovery(),
    });
    handleInactiveBankReady = () => {
      scheduleSelectionUpdate();
      schedulePushData([]);
    };
    handleRecoveredScene = (update) => styleFeatureDataRecovery.sourceRecoverySucceeded(update);

    // Every committed source is viewport/presentation dependent. The small
    // selection-owned handle/terminus sources refresh separately below so a
    // camera move cannot turn them into city-scale preparation work.
    const presentationSources: readonly SystemFeatureSourceId[] = COMMITTED_SYSTEM_FEATURE_SOURCES;
    const presentationRefresh = createPresentationRefreshScheduler({
      intervalMs: 80,
      now: () => performance.now(),
      scheduleFrame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (handle) => cancelAnimationFrame(handle),
      scheduleTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
      cancelTimer: (handle) => window.clearTimeout(handle),
      refresh: () => {
        if (!map.getSource(activeRenderSourceId(SRC_LANES))) return;
        const currentPresentation = renderPresentationNow();
        const currentSystemId = store.getState().system.id;
        if (
          canReuseCommittedCameraRefresh({
            committed: committedCameraCoverage,
            current: currentPresentation,
            renderedSystemId: lastRenderedSystemId,
            currentSystemId,
            rendererHealthy: !pendingStyleHeal && !overlayNeedsHealing(),
            projectionActive: renderer.hasActiveProjection(),
          })
        ) {
          return;
        }
        if (stopSettlement.ownsPreview()) {
          stopSettlement.beginFull({
            mutate: () => schedulePushData(presentationSources, undefined, true),
          });
        } else {
          schedulePushData(presentationSources, undefined, true);
        }
        scheduleSelectionUpdate();
        return renderWorkSettlement.whenSettled();
      },
    });

    let initialMapLoaded = false;
    const recoverMapStyle = () =>
      recoverMapStyleState({
        registerIcons: () => registerMapIcons(map, activeMapScheme),
        // Read before ensureOverlay creates replacements. Differential theme
        // switches carry these source objects (and their GeoJSON) forward;
        // a full rebuild sets pendingStyleHeal so it can never be mistaken for
        // retained renderer state even if MapLibre is between style events.
        hasRetainedRendererSources: () =>
          !pendingStyleHeal &&
          physicalRenderSourceIds([...ALL_SYSTEM_FEATURE_SOURCES, SRC_HIT_FEATURES]).every(
            (sourceId) => Boolean(map.getSource(sourceId)),
          ),
        ensureOverlay,
        restoreFeatureData: () => {
          styleFeatureDataRecovery.restore();
        },
        // Feature state is paint state, not geometry. Reapply it after every
        // style recovery even when the stable renderer sources were retained
        // and no projection or source upload is necessary.
        restoreEditorFeatureState: () => editorFeatureState.restoreAfterStyle(),
        restoreGesturePreview: () => {
          // Style replacement creates fresh layer/source objects. Replay any
          // active or settling preview and rebuild its mask from those objects.
          gestureMask.invalidate();
          gesturePreview.refresh();
        },
        restoreLandmarkVisibility: () => {
          const visibility =
            viewRef.current.viewMode !== 'diagram' && showLandmarksRef.current ? 'visible' : 'none';
          if (map.getLayer(LYR_LANDMARKS))
            map.setLayoutProperty(LYR_LANDMARKS, 'visibility', visibility);
          if (map.getLayer(LYR_LANDMARK_LABELS))
            map.setLayoutProperty(LYR_LANDMARK_LABELS, 'visibility', visibility);
        },
        restoreDiagramVisibility: () =>
          setBasemapVisible(map, viewRef.current.viewMode !== 'diagram'),
        restoreSimulation: notifyVehicleGate,
        repaint: () => map.triggerRepaint(),
      });
    const styleReady = () => initialMapLoaded;
    const detachStyleRecovery = attachMapStyleRecovery(map, styleReady, recoverMapStyle);
    // Which numbers CSS reports depends on media queries — the compact layout
    // covers the top and bottom edges, the docked one covers a column at the
    // left — and every change that flips one of those also resizes this
    // container. Re-reading on resize therefore covers crossing the layout
    // boundary and turning a phone sideways, without a second source of truth
    // for either.
    const onResize = () => {
      const el = containerRef.current;
      if (el) map.setPadding(chromePadding(el), { duration: 0 });
      cameraRenderPreload.observe(renderPresentationNow(), performance.now());
      presentationRefresh.request();
    };
    map.on('resize', onResize);
    styleSwitchControllerRef.current = createStyleSwitchController({
      map,
      initialScheme: initialColorScheme,
      isInteractionActive: () => {
        const state = store.getState();
        return (
          gestureActive ||
          directManipulationActive ||
          (liveRenderer?.publicationInProgress() ?? false) ||
          gestureSettlement.blocksStyleSwitch() ||
          stopSettlement.ownsPreview() ||
          state.activeWayId !== null ||
          state.routeDraft !== null
        );
      },
      recover: (scheme, fullRebuild) => {
        activeMapScheme = scheme;
        if (fullRebuild) pendingStyleHeal = true;
        else recoverMapStyle();
      },
      onUnavailable: () => basemapFailureRef.current?.(),
    });
    if (initialStyleOwnership.localOnly) {
      styleSwitchControllerRef.current.lockToLocal(initialColorScheme);
    }

    attachInitialMapReady(map, () => {
      traceStartup(`map-ready:${store.getState().documentStatus}`);
      // MapLibre's compact attribution starts expanded once (its own default
      // "first impression" behavior, applied asynchronously as style/source
      // data loads — too late to undo right after addControl) and only
      // collapses to the bare "i" after the map is interacted with. Collapse
      // it immediately instead so it never shows the full text unprompted.
      map
        .getContainer()
        .querySelector('.maplibregl-ctrl-attrib')
        ?.classList.remove('maplibregl-compact-show');
      registerMapIcons(map, activeMapScheme);
      if (!ensureOverlay()) return false;
      if (PERF_HARNESS_BUILD) {
        initialPaintListener = () => {
          const stationSourceId = activeRenderSourceId(SRC_STATIONS);
          const representativeSourceExists = Boolean(map.getSource(stationSourceId));
          if (
            !systemPaintReady({
              documentReady: store.getState().documentStatus === 'ready',
              systemDataUploaded: initialSystemDataUploaded,
              systemDataMatchesDocument: lastRenderedSystemId === store.getState().system.id,
              representativeSourceExists,
              representativeSourceLoaded:
                representativeSourceExists && map.isSourceLoaded(stationSourceId),
            })
          ) {
            return;
          }
          if (initialPaintListener) map.off('render', initialPaintListener);
          initialPaintListener = null;
          markFirstSystemMapPaint();
        };
        map.on('render', initialPaintListener);
      }
      if (shouldProjectInitialDocument(store.getState().documentStatus)) {
        schedulePushData('all');
      }
      scheduleSelectionUpdate();
      initialMapLoaded = true;
      map.triggerRepaint();
      detachInteractions = attachInteractions(map, store, {
        tuning: tuningRef.current,
        resolveQueryLayerIds: (layerId) => liveRenderer?.physicalLayerIds(layerId) ?? [],
        resolveEventLayerIds: (layerId) =>
          bankedLayerIds.has(layerId)
            ? SOURCE_BANK_IDS.map((bank) => bankedLayerId(layerId, bank))
            : [layerId],
        logicalLayerId: logicalRenderLayerId,
        openShortcuts,
        toggleUi,
        sim: simCommands,
        isDiagramMode: () => viewRef.current.viewMode === 'diagram',
        isNetworkMode: () => viewRef.current.viewMode === 'network',
        openContextMenu,
        closeContextMenu,
        setActionAnchor: (at) => {
          const source = map.getSource<GeoJSONSource>(SRC_ACTION_ANCHOR);
          source?.setData(
            at
              ? {
                  type: 'FeatureCollection',
                  features: [
                    {
                      type: 'Feature',
                      properties: {},
                      geometry: { type: 'Point', coordinates: at },
                    },
                  ],
                }
              : emptyFC,
          );
        },
        onDirectManipulationStart: beginDirectManipulation,
        onDirectManipulationEnd: endDirectManipulation,
        onEditGestureStart: beginGestureProjection,
        onEditGestureEnd: endGestureProjection,
        onPointerIntent: (intent, x, y) => setPointerBadge({ intent, x, y }),
        isContextMenuOpen: () => contextMenuOpenRef.current,
        registerPointerIntentRefresh: (refresh) => {
          refreshPointerIntentRef.current = refresh;
          return () => {
            if (refreshPointerIntentRef.current === refresh) refreshPointerIntentRef.current = null;
          };
        },
        openTerminusConnectionChoice: setTerminusConnectionChoice,
        // Footprints only render in the Infrastructure view — switch there
        // and zoom in, or a newly-drawn complex would be invisible right
        // where the user just drew it (the original bug report this fixes).
        focusFootprint: (footprint) => {
          setViewMode('infrastructure');
          let west = Infinity,
            south = Infinity,
            east = -Infinity,
            north = -Infinity;
          for (const [lng, lat] of footprint) {
            if (lng < west) west = lng;
            if (lng > east) east = lng;
            if (lat < south) south = lat;
            if (lat > north) north = lat;
          }
          map.fitBounds(
            [
              [west, south],
              [east, north],
            ],
            {
              padding: containerRef.current ? framePadding(containerRef.current, 120) : 120,
              maxZoom: 19,
              duration: 600,
            },
          );
        },
      });
      const vehicleGate = vehicleGateController.createGate(() => directManipulationActive);
      detachVehicles = attachVehicleAnimation(map, store, simClock, vehicleGate);
      if (PERF_HARNESS_BUILD) {
        detachPerf = attachPerfHarness(map, {
          stopSnapshot: (stopId) => {
            const system = store.getState().system;
            const stop = system.stops.find((candidate) => candidate.id === stopId);
            return stop
              ? { coord: stop.coord, revision: system.updatedAt, wayCount: system.ways.length }
              : null;
          },
          overlaySnapshot: () => {
            const stationSourceId = activeRenderSourceId(SRC_STATIONS);
            const sourceExists = Boolean(map.getSource(stationSourceId));
            const sourceLoaded = sourceExists && map.isSourceLoaded(stationSourceId);
            const expectedLayers = activePhysicalLayerSpecs();
            const rendererLayerCount = expectedLayers.filter((layer) =>
              map.getLayer(layer.id),
            ).length;
            return {
              sourceExists,
              layerExists: Boolean(map.getLayer(liveRenderer?.activeLayerId(LYR_STATIONS) ?? '')),
              symbolLayerExists: Boolean(
                map.getLayer(liveRenderer?.activeLayerId(LYR_STATION_LABELS_MAJOR) ?? ''),
              ),
              overlayHealthy: rendererLayerCount === expectedLayers.length,
              rendererLayerCount,
              expectedRendererLayerCount: expectedLayers.length,
              sourceLoaded,
              featureCount: sourceLoaded ? map.querySourceFeatures(stationSourceId).length : 0,
            };
          },
          rendererStats: () => rendererStats.snapshot(),
          renderSourceBankSnapshot: () => {
            if (!liveRenderer) throw new Error('Live renderer is unavailable.');
            const logicalBankedLayers = activeLayerSpecs().filter(isBankedRenderLayer);
            const activeLayerIds = (hitLayers: boolean) =>
              logicalBankedLayers
                .filter(
                  (layer) => ('source' in layer && layer.source === SRC_HIT_FEATURES) === hitLayers,
                )
                .map((layer) => liveRenderer?.activeLayerId(layer.id))
                .filter((layerId): layerId is string => Boolean(layerId && map.getLayer(layerId)));
            const activeVisualSourceIds = COMMITTED_SYSTEM_FEATURE_SOURCES.map((sourceId) =>
              liveRenderer?.activeSourceId(sourceId),
            ).filter((sourceId): sourceId is string =>
              Boolean(sourceId && map.getSource(sourceId)),
            );
            const rendererSnapshot = liveRenderer.snapshot();
            const hasActiveBank = rendererSnapshot.activeBank !== null;
            return {
              activeBank: rendererSnapshot.activeBank,
              stagingBank: rendererSnapshot.stagingBank,
              activeRevision: rendererSnapshot.activeRevision,
              activeVisualSourceIds,
              activeVisualLayerIds: activeLayerIds(false),
              activeVisualSourceId: hasActiveBank ? liveRenderer.activeSourceId(SRC_WAYS) : null,
              activeHitSourceId: hasActiveBank
                ? liveRenderer.activeSourceId(SRC_HIT_FEATURES)
                : null,
              activeHitLayerIds: activeLayerIds(true),
              activeVisualLayerId: liveRenderer.activeLayerId(LYR_WAYS_SOLID),
              activeHitLayerId: liveRenderer.activeLayerId(LYR_SERVICES_HIT),
              selectedFeatureStateSourceIds: editorFeatureState.selectedSourceIds(),
              diagnostics: rendererSnapshot.diagnostics,
              scheduler: rendererSnapshot.scheduler,
            };
          },
          rendererSettled: async () => {
            await presentationRefresh.whenSettled();
            await renderWorkSettlement.whenSettled();
            await liveRenderer?.whenRecoverySettled();
          },
          rendererSettlementVersion: () => liveRenderer?.recoveryVersion() ?? 0,
        });
      }
      detachSimDev = attachSimDevHandle(simClock); // DEV-only __sim.setTime()/__sim.step() clock driver
      map.resize();
      return true;
    });

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    interface SystemRenderUpdate {
      state: EditorState;
      previous: EditorState;
      documentChanged: boolean;
      initialDocumentReady: boolean;
      changedSources: readonly SystemFeatureSourceId[];
    }

    const scheduleSystemRender = ({
      state,
      previous,
      documentChanged,
      initialDocumentReady,
      changedSources,
    }: SystemRenderUpdate) => {
      if (
        !initialDocumentReady &&
        changedSources.length === 0 &&
        !(gestureActive && documentChanged)
      ) {
        return;
      }
      const systemTransition = { previous: previous.system, next: state.system };
      if (gestureActive) {
        // A document switch must abort the baseline-bound gesture even in
        // the degenerate case where the new document reuses the same arrays.
        sourceUploadQueue.add(documentChanged ? 'all' : changedSources, systemTransition);
        if (!gestureProjectionAborted && gestureProjection) {
          applyGestureProjectionResult(gestureProjection.project(state.system));
        } else {
          fullAfterGesture = true;
        }
        return;
      }
      // The first document can arrive after MapLibre created the empty editor
      // shell but before either bank has published. The renderer owns first-bank
      // creation, so it must receive that request without an active source.
      if (changedSources.includes(SRC_STATIONS) && stopSettlement.ownsPreview()) {
        gesturePreview.syncStops(state.system);
        stopSettlement.beginFull({
          mutate: () => schedulePushData(changedSources, systemTransition),
        });
        return;
      }
      schedulePushData(
        initialDocumentReady ? 'all' : changedSources,
        systemTransition,
        false,
        documentChanged,
      );
    };

    const syncRendererFromStore = (state: EditorState, previous: EditorState) => {
      // Plan from the exact TransitSystem fields whose references changed.
      // Renaming the system, moving the camera, or picking a palette color
      // produces an empty plan; topology edits conservatively include every
      // derived collection they can influence.
      const documentChanged = previous.system.id !== state.system.id;
      const initialDocumentReady =
        previous.documentStatus !== 'ready' &&
        state.documentStatus === 'ready' &&
        lastRenderedSystemId === null;
      if (initialDocumentReady) traceStartup('document-ready');
      const selectionUpdate = planSelectionRenderUpdate(previous, state);
      if (documentChanged && !gestureActive) {
        stopSettlement.invalidate();
        gestureSettlement.invalidate();
        gesturePreview.clear();
      }
      const changedSources = sourceUploadsForSystemChange(previous.system, state.system, {
        forceAll: documentChanged,
      });
      const editorSystemRefresh = editorSourcesNeedSystemRefresh(changedSources, documentChanged);
      scheduleSystemRender({
        state,
        previous,
        documentChanged,
        initialDocumentReady,
        changedSources,
      });
      if (
        map.getSource(activeRenderSourceId(SRC_SERVICES)) &&
        (selectionUpdate.updateEditorSources ||
          selectionUpdate.updateServiceTermini ||
          editorSystemRefresh)
      ) {
        scheduleSelectionUpdate();
      }
    };

    const syncRouteDraftPreview = (state: EditorState, previous: EditorState) => {
      // Route drafting (Network view snap-to-streets drawing): show the
      // committed legs as the standard dashed draw preview.
      if (state.routeDraft !== previous.routeDraft) {
        // One feature per SPAN rather than one for the whole route, so a
        // stretch the router had to run against traffic can say so. Under
        // `preferLegal` the draft is given the line rather than a refusal —
        // which is only half an answer if nothing shows what is wrong with it.
        const spans = state.routeDraft?.spans ?? [];
        const features = spans
          .map((span) => ({ span, path: routePath(state.system, [span]) }))
          .filter(({ path }) => path.length >= 2)
          .map(({ span, path }) => ({
            type: 'Feature' as const,
            properties: { wrongWay: span.wrongWay === true },
            geometry: { type: 'LineString' as const, coordinates: path },
          }));
        map
          .getSource<GeoJSONSource>(SRC_PREVIEW)
          ?.setData(features.length > 0 ? { type: 'FeatureCollection', features } : emptyFC);
      }
    };

    const syncSystemCamera = (state: EditorState) => {
      if (state.system.id !== lastSystemId) {
        lastSystemId = state.system.id;
        cameraRenderPreload.reset();
        committedCameraCoverage = null;
        map.jumpTo({ center: state.system.viewport.center, zoom: state.system.viewport.zoom });
        // The newly-loaded system's saved camera becomes the live camera.
        initLiveCamera(state.system.viewport);
      }
    };

    const syncSelectionFocus = (state: EditorState, previous: EditorState) => {
      // Chrome-driven selection (Objects list, keyboard nav, Inspector jump
      // links, Issues) asks for this via selectAndFocus bumping the token —
      // a direct map click already shows the user where the thing is and
      // never touches this. The selection command group owns the token.
      if (state.cameraFocusToken !== previous.cameraFocusToken) {
        const focus = selectionFocus(state.system, state.selection);
        if (focus) {
          if (focus.needsInfrastructureView) setViewMode('infrastructure');
          map.fitBounds(focus.bounds, {
            padding: containerRef.current ? framePadding(containerRef.current, 100) : 100,
            maxZoom: 18,
            duration: 500,
          });
        }
      }
    };

    const unsub = store.subscribe((state, previous) => {
      const wasDrawing = previous.activeWayId !== null || previous.routeDraft !== null;
      const drawing = state.activeWayId !== null || state.routeDraft !== null;
      if (wasDrawing && !drawing) void styleSwitchControllerRef.current?.flush();
      syncRendererFromStore(state, previous);
      syncRouteDraftPreview(state, previous);
      syncSystemCamera(state);
      syncSelectionFocus(state, previous);
    });
    // The local style can finish while IndexedDB delivers the saved document.
    // If that ready transition lands between editor setup and subscription,
    // the subscription cannot replay it. The queue coalesces same-frame
    // startup requests, so this cannot produce a second preparation attempt.
    if (
      shouldScheduleInitialReadyDocument(
        store.getState().documentStatus,
        renderer.hasAcceptedScene(),
      )
    ) {
      schedulePushData('all');
    }

    // A leading refresh prepares adjacent tiers; bounded trailing work commits
    // the exact viewport without projecting on every raw camera event.
    const onZoom = () => {
      cameraRenderPreload.observe(renderPresentationNow(), performance.now());
      presentationRefresh.request();
    };
    map.on('zoom', onZoom);

    // Native touch/trackpad panning emits a continuous `move` stream followed
    // by one `moveend`. Refresh at the same throttled cadence as zoom so a pan
    // beyond the culling margin never exposes a blank band for the full drag.
    const onMove = () => {
      cameraRenderPreload.observe(renderPresentationNow(), performance.now());
      presentationRefresh.request();
    };
    map.on('move', onMove);

    const onMoveEnd = () => {
      const c = map.getCenter();
      cameraRenderPreload.observe(renderPresentationNow(), performance.now());
      // Record the move on the live camera holder — NOT the domain store. A pure
      // pan/zoom must not mint a new `system` reference: that used to fire the
      // subscription below → full-system buildFeatures + 13 setData + selector
      // fan-out + autosave, once per coalesced drag frame (panBy(duration:0)
      // fires moveend per mousemove). Camera persistence is handled separately
      // and debounced (storage/persistenceCoordinator.ts).
      setLiveCamera({ center: [c.lng, c.lat], zoom: map.getZoom() });
      // moveend fires per mouse-move from panBy(duration:0), so coalesce it.
      presentationRefresh.request();
    };
    map.on('moveend', onMoveEnd);

    return () => {
      stopSettlement.dispose();
      gestureSettlement.dispose();
      ro.disconnect();
      unsub();
      pendingHover = null;
      if (hoverRaf !== null) cancelAnimationFrame(hoverRaf);
      map.off('mousemove', onHoverMove);
      map.off('mouseout', onHoverOut);
      if (pushDataRaf !== null) cancelAnimationFrame(pushDataRaf);
      if (pushDataFallbackTimer !== null) window.clearTimeout(pushDataFallbackTimer);
      if (selectionRaf !== null) cancelAnimationFrame(selectionRaf);
      editorProjectionAbort?.abort();
      stopProjectionAbort?.abort();
      if (initialPaintListener) map.off('render', initialPaintListener);
      presentationRefresh.dispose();
      liveRenderer?.dispose();
      rendererFrames.dispose();
      rendererTasks.clear();
      rendererTaskChannel.port1.close();
      rendererTaskChannel.port2.close();
      diagramLayout.dispose();
      featureProjection.dispose();
      liveRenderer = null;
      renderWorkSettlement.dispose();
      map.off('zoom', onZoom);
      map.off('move', onMove);
      map.off('moveend', onMoveEnd);
      detachInteractions?.();
      detachVehicles?.();
      detachPerf?.();
      detachSimDev?.();
      detachInitialStyleFallback();
      styleSwitchControllerRef.current?.dispose();
      styleSwitchControllerRef.current = null;
      detachStyleRecovery();
      map.off('error', onMapError);
      clearGesturePreview();
      gestureMask.restore();
      if (PERF_HARNESS_BUILD) delete window.__mapProjectionCounts;
      if (PERF_HARNESS_BUILD) delete window.__mapStartupTrace;
      schedulePushDataRef.current = null;
      applyRendererVisibilityRef.current = null;
      setMap(null);
      map.remove();
    };
    // setViewMode is a useState setter from ViewProvider, and React guarantees
    // those keep their identity for the life of the component. Naming it here
    // therefore cannot retrigger this effect — which matters, because this
    // effect's cleanup calls map.remove(), so a retrigger would tear down and
    // rebuild the whole MapLibre map. simClock and simCommands are stable for
    // the same kind of reason: SimProvider holds one clock instance for the
    // session, and simCommands is a ref-held façade whose identity never
    // changes (it reads the live handlers through simCommandsRef). All are
    // listed because the effect genuinely closes over them.
  }, [
    store,
    openShortcuts,
    toggleUi,
    openContextMenu,
    closeContextMenu,
    setViewMode,
    simClock,
    simCommands,
    vehicleGateController,
  ]);

  useEffect(() => {
    void styleSwitchControllerRef.current?.request(colorScheme);
  }, [colorScheme]);

  return (
    <>
      <div
        ref={containerRef}
        style={{
          position: 'absolute',
          inset: 0,
          // app.css owns this backdrop so the same drafting surface remains
          // visible whenever MapLibre has no opaque basemap tile to paint.
          // The map owns every gesture inside its own box, so the browser gets
          // none of them. Without this a downward swipe on the canvas is
          // pull-to-refresh and a horizontal one is back-navigation on some
          // Android browsers: a gesture meant to draw a line reloads the page
          // or leaves it. Scoped to the canvas, never the whole app — the
          // bottom sheet and its panels still need to scroll.
          touchAction: 'none',
        }}
      />
      <PointerBadge intent={pointerBadge.intent} x={pointerBadge.x} y={pointerBadge.y} />
      {terminusConnectionChoice ? (
        <>
          <button
            type="button"
            aria-label="Dismiss connection choices"
            style={{ position: 'fixed', inset: 0, zIndex: 49, cursor: 'default', opacity: 0 }}
            onClick={() => {
              terminusConnectionChoice.dismiss();
              setTerminusConnectionChoice(null);
            }}
          />
          <div
            role="menu"
            aria-label="Choose how to connect these paths"
            style={{
              position: 'fixed',
              left: terminusConnectionChoice.x,
              top: terminusConnectionChoice.y,
              zIndex: 50,
              display: 'grid',
              minWidth: 240,
              padding: 6,
              gap: 2,
              border: '1px solid var(--md-sys-color-outline-variant)',
              borderRadius: 8,
              background: 'var(--md-sys-color-surface-container)',
              boxShadow: 'var(--md-sys-elevation-level2)',
            }}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                terminusConnectionChoice.connectPaths();
                setTerminusConnectionChoice(null);
              }}
            >
              Connect paths
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                terminusConnectionChoice.joinThroughService();
                setTerminusConnectionChoice(null);
              }}
            >
              Join into a through-service
            </button>
            <button
              type="button"
              onClick={() => {
                terminusConnectionChoice.dismiss();
                setTerminusConnectionChoice(null);
              }}
            >
              Cancel
            </button>
          </div>
        </>
      ) : null}
    </>
  );
}
