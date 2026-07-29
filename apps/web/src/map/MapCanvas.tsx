import { useEffect, useRef, useState } from 'react';
import maplibregl, {
  type FilterSpecification,
  type GeoJSONSource,
  type LayerSpecification,
  type Map as MLMap,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEditorStore } from '../editor/EditorProvider';
import type { SimCommands } from '../editor/keymap';
import { useSim, useSimClock } from '../ui/SimProvider';
import { useContextMenu, useUi } from '../ui/UiProvider';
import { useView } from '../ui/ViewProvider';
import { useSystemColorScheme } from '../theme/systemColorScheme';
import { attachInteractions, type TerminusConnectionChoice } from './interactions';
import { PointerBadge } from './PointerBadge';
import type { PointerIntent } from '../editor/pointerIntent';
import { computeDiagramSystem } from '@transitmapper/core/model/diagramLayout';
import { serviceWayIds, systemBounds, wayById } from '@transitmapper/core/model/geo';
import { routePath } from '@transitmapper/core/model/routeGraph';
import { selectionFocus } from './selectionFocus';
import {
  buildHandles,
  buildPhysicalHandles,
  createFeatureBuildOperationCounts,
  LANE_DETAIL_MIN_ZOOM,
  LAYER_SPECS,
  LYR_LANDMARKS,
  LYR_LANDMARK_LABELS,
  LYR_WAY_SELECTED,
  LYR_SERVICE_SELECTED,
  LYR_STATION_SELECTED,
  LYR_FACILITY_SELECTED,
  LYR_WAYS_SOLID,
  LYR_WAYS_DASHED,
  LYR_SERVICES_SOLID,
  LYR_SERVICES_SOLID_CASING,
  LYR_SERVICES_ELEVATED,
  LYR_SERVICES_UNDERGROUND,
  LYR_SERVICES_UNDERGROUND_CASING,
  LYR_STATIONS,
  LYR_FACILITIES,
  registerMapIcons,
  SRC_ENDPOINT_HINT,
  SRC_FACILITIES,
  SRC_FOOTPRINTS,
  SRC_GESTURE,
  SRC_HANDLES,
  SRC_SERVICE_TERMINI,
  SRC_ACTION_ANCHOR,
  SRC_CONNECTORS,
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
  type ViewOptions,
} from './layers';
import {
  createGestureProjectionController,
  createProjectionOperationCounts,
  recordFullProjection,
  recordSourceUpload,
  type EditGestureTargets,
  type GestureAffectedEntities,
  type GestureProjectionController,
  type GestureProjectionResult,
} from './gestureProjection';
import { buildGestureLayerMaskPlan, maskedGestureFilter } from './gestureLayerMask';
import {
  ALL_SYSTEM_FEATURE_SOURCES,
  createSourceUploadQueue,
  sourceUploadsForSystemChange,
  type SourceUploadRequest,
  type SystemFeatureSourceId,
} from './sourceUploadPlan';
import {
  buildFeaturesForSources,
  type SourceFeatureProjectionCounts,
} from './sourceFeatureProjection';
import { landmarksFeatureCollection } from './landmarks';
import { getMap, setMap } from './mapRef';
import {
  attachInitialStyleFallback,
  INITIAL_STYLE_FALLBACK_TIMEOUT_MS,
} from './initialStyleFallback';
import { initLiveCamera, setLiveCamera } from '../camera/liveCamera';
import { attachPerfHarness } from '../perf';
import { markFirstSystemMapPaint, systemPaintReady } from '../perf/mapPaintMark';
import { servicesByWay } from '@transitmapper/core/render/featureMemo';
import { attachSimDevHandle } from '../sim/devHandle';
import { attachVehicleAnimation } from '../sim/vehicles';
import { clearArmedTerminusForViewChange } from './viewEditorState';
import { basemapStyleForScheme, layerSpecsForScheme } from './mapTheme';
import { createStyleSwitchController, type StyleSwitchController } from './styleSwitchController';
const OWN_LAYER_IDS = new Set(LAYER_SPECS.map((l) => l.id));
const PERF_HARNESS_BUILD = import.meta.env.DEV || import.meta.env.VITE_PERF_BUILD === '1';

/** A local blank style has no glyph endpoint. Keep all geometry and icon-only
 * interaction layers, and omit only symbol layers whose text would otherwise
 * make an impossible network request before later layers are installed. */
function localBlankLayerSpecs(scheme: 'light' | 'dark'): LayerSpecification[] {
  return layerSpecsForScheme(scheme).filter(
    (layer) => layer.type !== 'symbol' || layer.layout?.['text-field'] === undefined,
  );
}

/** Diagram mode is a schematic with no real geography, so the street basemap
 *  underneath would be actively misleading — hide every style layer that
 *  isn't one of ours (leaving its background/land color as a plain backdrop)
 *  rather than tearing down and reloading the whole map style. */
function setBasemapVisible(map: MLMap, visible: boolean): void {
  const layers = map.getStyle()?.layers ?? [];
  for (const layer of layers) {
    if (OWN_LAYER_IDS.has(layer.id)) continue;
    map.setLayoutProperty(layer.id, 'visibility', visible ? 'visible' : 'none');
  }
}

export interface MapCanvasProps {
  /** Called once if the basemap never loads. The editor still works without
   *  it — every way, station and service is ours and draws regardless — but
   *  the backdrop is blank, and a user who isn't told assumes the app broke
   *  rather than that a third-party tile host is down. */
  onBasemapUnavailable?: () => void;
}

interface MapErrorLike {
  error?: unknown;
}

export function MapCanvas({ onBasemapUnavailable }: MapCanvasProps) {
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
    const source = getMap()?.getSource(SRC_ACTION_ANCHOR) as GeoJSONSource | undefined;
    source?.setData({ type: 'FeatureCollection', features: [] });
    // The controller holds the last real map pointer. Re-evaluate it now that
    // the menu no longer owns focus instead of consuming the next mouse move.
    refreshPointerIntentRef.current?.();
  }, [contextMenuAt, terminusConnectionChoice]);
  const { viewMode, setViewMode, visibleModes, visibleWayTypes, showLandmarks } = useView();
  useEffect(() => {
    const source = getMap()?.getSource(SRC_ACTION_ANCHOR) as GeoJSONSource | undefined;
    source?.setData({ type: 'FeatureCollection', features: [] });
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

  // Read live by the animation loop each tick, for the same reason.
  const pinnedPeriodRef = useRef<string | undefined>(pinnedPeriod);
  pinnedPeriodRef.current = pinnedPeriod;
  const vehicleGateListenersRef = useRef(new Set<() => void>());

  useEffect(() => {
    // Pinned periods are React presentation state, so the imperative vehicle
    // host cannot observe this change through the editor store. Publish it
    // explicitly; an inactive host has no polling timer to discover it later.
    for (const listener of vehicleGateListenersRef.current) listener();
  }, [pinnedPeriod]);

  const viewRef = useRef<ViewOptions>({ viewMode, visibleModes, visibleWayTypes });
  const showLandmarksRef = useRef(showLandmarks);
  showLandmarksRef.current = showLandmarks;
  const schedulePushDataRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const prevMode = viewRef.current.viewMode;
    const prevVisibleModes = viewRef.current.visibleModes;
    viewRef.current = { viewMode, visibleModes, visibleWayTypes };
    // A view swap changes whether the same stationary hover is editable.
    // Ask the interaction controller to resolve it again rather than waiting
    // for incidental pointer movement to remove a stale badge.
    refreshPointerIntentRef.current?.();
    if (prevMode !== viewMode || prevVisibleModes !== visibleModes) {
      // View mode and mode visibility determine whether the vehicle host has
      // any work. An explicit invalidation lets Diagram/fully-filtered states
      // remain completely unscheduled until one of these values changes.
      for (const listener of vehicleGateListenersRef.current) listener();
    }
    // Scheduled rather than called inline: a synchronous 14-collection build
    // here blocks the React commit that the user's own click just triggered,
    // which is the most visible place in the app to spend a frame. The rAF
    // still lands before paint, so the switch is seen in the same frame.
    schedulePushDataRef.current?.();
    const map = getMap();
    // NOT map.isStyleLoaded() — that reports false while tiles for the
    // current viewport are still streaming in, which is unrelated to
    // whether the style's layers exist yet (they do, from the first "load").
    // Gating on it here made this a coin flip: it silently skipped the
    // basemap toggle whenever a transition happened to land mid-tile-load,
    // with no retry since nothing re-fires this effect on its own.
    if (!map || !map.getStyle()) return;
    if (viewMode === 'diagram' || prevMode === 'diagram')
      setBasemapVisible(map, viewMode !== 'diagram');
    // Entering Diagram reframes the camera to the schematic layout's own
    // extent — its coordinates are a distorted projection of the real ones,
    // so whatever framing suited Network/Infrastructure may no longer show
    // the whole thing (or may be framing empty space).
    if (viewMode === 'diagram' && prevMode !== 'diagram') {
      const bounds = systemBounds(computeDiagramSystem(store.getState().system));
      if (bounds) map.fitBounds(bounds, { padding: 60, duration: 500 });
    }
    // A bare setLayoutProperty/setData pair doesn't reliably self-schedule a
    // repaint outside MapLibre's normal interaction-driven render loop (seen
    // live: toggling the basemap off left the canvas blank — visually stuck
    // on the last painted frame — until the user panned or zoomed). One
    // explicit nudge here guarantees the new layer/source state actually
    // reaches the screen the moment a view mode changes, not just on the
    // next incidental interaction.
    map.triggerRepaint();
  }, [viewMode, visibleModes, visibleWayTypes, store]);

  // Landmarks are a pure layer-visibility toggle. buildFeatures never reads
  // showLandmarks, so this deliberately does NOT live in the effect above:
  // there, every toggle ran a full synchronous rebuild that produced
  // byte-identical data for all fourteen sources.
  useEffect(() => {
    const map = getMap();
    if (!map || !map.getStyle() || !map.getLayer(LYR_LANDMARKS)) return;
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
      style: basemapStyleForScheme(initialColorScheme),
      center: initial.viewport.center,
      zoom: initial.viewport.zoom,
      // No preserveDrawingBuffer: PNG export renders on a dedicated offscreen
      // map (map/export/exportRenderer.ts), so the live map no longer pays the
      // always-on per-frame drawing-buffer copy that reading its canvas required.
      fadeDuration: 0, // no trailing label/icon fade animation after a pan/zoom — snappier, one fewer post-move repaint pass
      refreshExpiredTiles: false, // the basemap is static within a session; don't re-fetch/re-tessellate expired tiles
      dragPan: false, // SimCity-style: the map pans on right-drag / space-drag only
      dragRotate: false, // right-drag pans, never rotates
      doubleClickZoom: false, // double-click finishes a line instead
      keyboard: false, // we own the keymap (see keymap.ts)
      boxZoom: false, // Shift+drag is our marquee-select gesture, not MapLibre's native box-zoom
      attributionControl: false, // replaced below with a compact (collapsed-to-an-"i") one
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    setMap(map);

    // MapLibre reports style/source/tile failures through this event rather
    // than by throwing, so without a listener they are completely silent —
    // the same reasoning embed/main.ts already applies, which called silent
    // half-rendering the worst possible failure mode. It is worse here: the
    // overlay's self-healing in ensureOverlay() will keep re-adding layers
    // over a style that never loaded, hiding a persistent failure forever.
    //
    // OpenFreeMap is a third-party host with no SLA, so
    // "the basemap is down" is a real operating condition, not a hypothetical.
    // Only a failure *before the style loads* is worth telling the user about:
    // once it's up, later errors are individual tiles timing out, which
    // MapLibre retries and which nobody needs a message about.
    let usingLocalBlankStyle = false;
    let activeMapScheme = initialColorScheme;
    const onMapError = (event: MapErrorLike) => {
      console.error('[transitmapper]', event.error ?? event);
    };
    map.on('error', onMapError);
    const detachInitialStyleFallback = attachInitialStyleFallback(map, {
      scheme: initialColorScheme,
      timeoutMs: INITIAL_STYLE_FALLBACK_TIMEOUT_MS,
      onFallback: () => {
        usingLocalBlankStyle = true;
        basemapFailureRef.current?.();
      },
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
        const svc = s.system.services.find((sv) => sv.id === s.selection!.id);
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

    // Lane-detail LOD: real per-lane street geometry only derives/renders at
    // high zoom in the Infrastructure view, scoped to the current viewport
    // (with margin). Anything else keeps the cheap fan rendering.
    const laneDetailNow = () =>
      viewRef.current.viewMode === 'infrastructure' && map.getZoom() >= LANE_DETAIL_MIN_ZOOM;

    const ALL_SOURCES = [
      SRC_WAYS,
      SRC_SERVICES,
      SRC_STATIONS,
      SRC_HANDLES,
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
      SRC_WAY_LABELS,
    ];

    // Idempotent overlay setup. Sources/layers are normally added once on
    // "load", but an HMR pass or style hiccup landing mid-setup can leave
    // SOME layers silently missing until a hard reload (seen live: addLayer
    // "source not found" errors, then footprint layers gone — "station
    // boundaries only visible while drawing", because only the drag preview
    // still rendered). This heals that: anything missing is re-added, with
    // beforeId anchoring so a healed layer returns to its correct place in
    // the paint order instead of landing on top.
    const ensureOverlay = (): boolean => {
      if (!map.getStyle()) return false;
      const layerSpecs = usingLocalBlankStyle
        ? localBlankLayerSpecs(activeMapScheme)
        : layerSpecsForScheme(activeMapScheme);
      for (const src of ALL_SOURCES) {
        if (map.getSource(src)) continue;
        // The two heavy static line sources (imported GTFS geometry — ~121k
        // waypoints at RTC scale) get an explicit geojson-vt simplification
        // tolerance so edge tiles emit fewer vertices as they build. Tolerance
        // is in per-tile units, so it's ~lossless at high zoom (tiles cover
        // little ground → almost nothing drops) — max-zoom fidelity and the
        // exact source `Way.points` are untouched. Kept modest; revisit if any
        // mid-zoom kinking shows.
        const heavy = src === SRC_WAYS || src === SRC_SERVICES;
        // Stable feature ids for selection via setFeatureState (see
        // applySelectionState): way/station/facility features key on `id`,
        // service features on `serviceId` (a service's fan across its ways all
        // light together). Lets selection flip feature-state instead of
        // re-uploading these sources.
        const promoteId =
          src === SRC_SERVICES
            ? 'serviceId'
            : src === SRC_WAYS || src === SRC_STATIONS || src === SRC_FACILITIES
              ? 'id'
              : undefined;
        map.addSource(src, {
          type: 'geojson',
          data: emptyFC,
          ...(heavy ? { tolerance: 1 } : {}),
          ...(promoteId ? { promoteId } : {}),
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
      return true;
    };

    // Selection halos (way/service/station/facility) are driven by MapLibre
    // feature-state, not a `selected` feature property — so selecting an object
    // flips a few setFeatureState calls instead of re-uploading the big static
    // sources. setData() clears all feature-state, so this is re-applied at the
    // end of every pushData too. (Node selection still rides the junctions
    // filter, handled by a full rebuild in the subscription below.)
    const HALO_LAYERS = [
      LYR_WAY_SELECTED,
      LYR_SERVICE_SELECTED,
      LYR_STATION_SELECTED,
      LYR_FACILITY_SELECTED,
    ];
    let appliedSelectionStates: Array<{ source: string; id: string }> = [];
    // Whatever's under the cursor right now (feature-state `hover`), so the halo
    // layers light a hover too, not only a selection.
    let hovered: { source: string; id: string } | null = null;

    // The halo layers are feature-state driven, so without a filter they'd
    // redraw EVERY way/service/station at 0 opacity every frame (real fill-rate
    // on the 121k-waypoint services source during a zoom). Keep them hidden
    // unless something is actually selected OR hovered — the common idle case.
    const updateHaloVisibility = () => {
      const visible = appliedSelectionStates.length > 0 || hovered !== null;
      for (const layer of HALO_LAYERS) {
        if (map.getLayer(layer))
          map.setLayoutProperty(layer, 'visibility', visible ? 'visible' : 'none');
      }
    };

    // #2 Focus a route: while a SERVICE is selected, dim every OTHER route line
    // (the selected one keeps its feature-state `selected`, so it stays full) so
    // you can trace one line across a dense network. Restored when unfocused.
    const FOCUS_DIM = 0.12;
    let routeFocusActive = false;
    const setRouteFocus = (active: boolean, force = false) => {
      if (active === routeFocusActive && !force) return;
      routeFocusActive = active;
      for (const [layer, baseOpacity] of [
        [LYR_SERVICES_SOLID, 1],
        [LYR_SERVICES_UNDERGROUND, 1],
        [LYR_SERVICES_SOLID_CASING, 0.72],
        [LYR_SERVICES_UNDERGROUND_CASING, 0.72],
      ] as const) {
        if (!map.getLayer(layer)) continue;
        const layerOpacity = active
          ? ['case', ['boolean', ['feature-state', 'selected'], false], baseOpacity, FOCUS_DIM]
          : baseOpacity;
        map.setPaintProperty(layer, 'line-opacity', layerOpacity as never);
      }
    };

    const applySelectionState = () => {
      // Clear only the `selected` key so a concurrent `hover` state survives.
      for (const { source, id } of appliedSelectionStates)
        map.removeFeatureState({ source, id }, 'selected');
      appliedSelectionStates = [];
      const { system, selection } = store.getState();
      const mark = (source: string, id: string) => {
        map.setFeatureState({ source, id }, { selected: true });
        appliedSelectionStates.push({ source, id });
      };
      if (selection?.kind === 'way') {
        mark(SRC_WAYS, selection.id);
        // A selected way also lights the services riding it — most guideway
        // types draw no bare line when served, so the service line is the only
        // thing on screen to highlight for a way selection.
        for (const svc of servicesByWay(system.services, viewRef.current.visibleModes).get(
          selection.id,
        ) ?? []) {
          mark(SRC_SERVICES, svc.id);
        }
      } else if (selection?.kind === 'service') {
        mark(SRC_SERVICES, selection.id);
      } else if (selection?.kind === 'station') {
        mark(SRC_STATIONS, selection.id);
      } else if (selection?.kind === 'facility') {
        mark(SRC_FACILITIES, selection.id);
      }
      setRouteFocus(selection?.kind === 'service');
      updateHaloVisibility();
      map.triggerRepaint();
    };

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
    ];
    const setHover = (next: { source: string; id: string } | null) => {
      if (
        (hovered === null && next === null) ||
        (hovered !== null &&
          next !== null &&
          hovered.source === next.source &&
          hovered.id === next.id)
      )
        return;
      if (hovered && (!next || hovered.source !== next.source || hovered.id !== next.id)) {
        map.removeFeatureState(hovered, 'hover');
        hovered = null;
      }
      if (next && !hovered) {
        map.setFeatureState(next, { hover: true });
        hovered = next;
      }
      updateHaloVisibility();
      map.triggerRepaint();
    };
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
      const layers = HOVER_LAYERS.filter((l) => map.getLayer(l));
      const hit = layers.length ? map.queryRenderedFeatures(e.point, { layers })[0] : undefined;
      setHover(
        hit && typeof hit.source === 'string' && hit.id != null
          ? { source: hit.source, id: String(hit.id) }
          : null,
      );
    };
    const onHoverMove = (e: maplibregl.MapMouseEvent) => {
      pendingHover = e;
      if (hoverRaf === null) hoverRaf = requestAnimationFrame(flushHover);
    };
    const onHoverOut = () => {
      pendingHover = null;
      if (hoverRaf !== null) {
        cancelAnimationFrame(hoverRaf);
        hoverRaf = null;
      }
      setHover(null);
    };
    map.on('mousemove', onHoverMove);
    map.on('mouseout', onHoverOut);

    const projectionCounts = createProjectionOperationCounts();
    const sourceProjectionCounts: SourceFeatureProjectionCounts = {
      ...createFeatureBuildOperationCounts(),
      diagramTopologyBuildCount: 0,
      diagramTopologyCacheHitCount: 0,
      diagramStationBuildCount: 0,
      diagramStationCacheHitCount: 0,
    };
    let gestureActive = false;
    let directManipulationActive = false;
    let gestureProjection: GestureProjectionController | null = null;
    let gestureProjectionAborted = false;
    let gesturePreviewVisible = false;
    let fullAfterGesture = false;
    const sourceUploadQueue = createSourceUploadQueue();
    const notifyVehicleGate = () => {
      for (const listener of vehicleGateListenersRef.current) listener();
    };
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
        ...sourceProjectionCounts,
      });
    }

    const pushData = (requestedSources: readonly SystemFeatureSourceId[]) => {
      if (gestureActive) {
        sourceUploadQueue.add(requestedSources);
        fullAfterGesture = true;
        return;
      }
      // Self-heal before pushing — a missing source would otherwise silently
      // swallow this update (every setData below is optional-chained).
      const overlayNeedsHealing =
        ALL_SOURCES.some((sourceId) => !map.getSource(sourceId)) ||
        (usingLocalBlankStyle
          ? localBlankLayerSpecs(activeMapScheme)
          : layerSpecsForScheme(activeMapScheme)
        ).some((layer) => !map.getLayer(layer.id));
      let sourceIds = requestedSources;
      if (overlayNeedsHealing) {
        if (!ensureOverlay()) return;
        // A repaired style has fresh, empty sources. Repopulate every derived
        // collection even if the store change that exposed it was narrow.
        sourceIds = ALL_SYSTEM_FEATURE_SOURCES;
      }
      if (sourceIds.length === 0) return;
      const { system, selection, activePatternId, armedTerminus } = store.getState();
      const laneDetail = laneDetailNow();
      const b = map.getBounds();
      // Expand the lane-detail cull bounds by half a viewport on each side, so a
      // way just off-screen is already lane-rendered when it scrolls in (no
      // pop-in at the edges). Cheap because the refresh is debounced — this wider
      // extent is only built once a pan/zoom settles, not every mouse-move.
      const mLng = (b.getEast() - b.getWest()) * 0.5;
      const mLat = (b.getNorth() - b.getSouth()) * 0.5;
      const view: ViewOptions = {
        ...viewRef.current,
        laneDetail,
        bounds: laneDetail
          ? [
              [b.getWest() - mLng, b.getSouth() - mLat],
              [b.getEast() + mLng, b.getNorth() + mLat],
            ]
          : undefined,
      };
      const fc = buildFeaturesForSources({
        system,
        selection,
        handleWayIds: handleWayIds(),
        view,
        sourceIds,
        physicalHandleStationId: physicalHandleStationId(),
        physicalHandleGroupId: physicalHandleGroupId(),
        activePatternId,
        armedTerminus,
        counts: sourceProjectionCounts,
      });
      const sourceData: Record<SystemFeatureSourceId, GeoJSON.FeatureCollection> = {
        [SRC_WAYS]: fc.ways,
        [SRC_SERVICES]: fc.services,
        [SRC_STATIONS]: fc.stations,
        [SRC_HANDLES]: fc.handles,
        [SRC_SERVICE_TERMINI]: fc.serviceTermini,
        [SRC_FOOTPRINTS]: fc.footprints,
        [SRC_PLATFORMS]: fc.platforms,
        [SRC_FACILITIES]: fc.facilities,
        [SRC_PHYSICAL_HANDLES]: fc.physicalHandles,
        [SRC_LANES]: fc.lanes,
        [SRC_LANE_MARKINGS]: fc.laneMarkings,
        [SRC_LANE_ARROWS]: fc.laneArrows,
        [SRC_SERVICE_ARROWS]: fc.serviceArrows,
        [SRC_JUNCTIONS]: fc.junctions,
        [SRC_CONNECTORS]: fc.connectors,
        [SRC_WAY_LABELS]: fc.wayLabels,
      };
      let sourceUploads = 0;
      for (const sourceId of sourceIds) {
        const source = map.getSource(sourceId) as GeoJSONSource | undefined;
        if (!source) continue;
        source.setData(sourceData[sourceId]);
        sourceUploads++;
      }
      if (sourceIds.includes(SRC_STATIONS)) initialSystemDataUploaded = true;
      recordFullProjection(projectionCounts, sourceUploads);
      // setData above cleared feature-state — re-apply the current selection.
      applySelectionState();
    };

    // Coalesce rebuilds to at most one per animation frame. A bulk import
    // (streamRtcGtfsBatches) merges many batches in quick succession — each
    // is its own store commit, and pushData's buildFeatures()+13x setData()
    // is real main-thread work on a large system, so calling it once per
    // commit froze the tab between batches instead of yielding smoothly.
    // Reading store.getState() fresh inside pushData means a coalesced call
    // still reflects the LATEST merged state, not a stale snapshot.
    let pushDataRaf: number | null = null;
    const schedulePushData = (request: SourceUploadRequest = 'all') => {
      sourceUploadQueue.add(request);
      if (gestureActive) {
        fullAfterGesture = true;
        return;
      }
      if (pushDataRaf !== null) return;
      pushDataRaf = requestAnimationFrame(() => {
        pushDataRaf = null;
        pushData(sourceUploadQueue.take());
      });
    };
    // React view changes invalidate all derived collections, while store
    // content changes below pass a dependency-filtered source list.
    schedulePushDataRef.current = () => schedulePushData('all');

    const gestureFilterRestores = new Map<string, FilterSpecification | undefined>();
    const gestureVisibilityRestores = new Map<string, unknown>();

    const applyGestureMask = (affected: GestureAffectedEntities) => {
      const plan = buildGestureLayerMaskPlan(affected);
      for (const rule of plan.filterRules) {
        if (!map.getLayer(rule.layerId)) continue;
        if (!gestureFilterRestores.has(rule.layerId))
          gestureFilterRestores.set(
            rule.layerId,
            map.getFilter(rule.layerId) as FilterSpecification | undefined,
          );
        map.setFilter(
          rule.layerId,
          maskedGestureFilter(gestureFilterRestores.get(rule.layerId), rule.exclusions),
        );
      }
      for (const layerId of plan.hiddenLayerIds) {
        if (!map.getLayer(layerId)) continue;
        if (!gestureVisibilityRestores.has(layerId))
          gestureVisibilityRestores.set(layerId, map.getLayoutProperty(layerId, 'visibility'));
        map.setLayoutProperty(layerId, 'visibility', 'none');
      }
    };

    const restoreGestureMask = () => {
      for (const [layerId, filter] of gestureFilterRestores) {
        if (map.getLayer(layerId)) map.setFilter(layerId, filter ?? null);
      }
      gestureFilterRestores.clear();
      for (const [layerId, visibility] of gestureVisibilityRestores) {
        if (map.getLayer(layerId))
          map.setLayoutProperty(layerId, 'visibility', visibility ?? 'visible');
      }
      gestureVisibilityRestores.clear();
    };

    const clearGesturePreview = () => {
      if (!gesturePreviewVisible) return;
      const source = map.getSource(SRC_GESTURE) as GeoJSONSource | undefined;
      if (source) {
        source.setData(emptyFC);
        recordSourceUpload(projectionCounts);
      }
      gesturePreviewVisible = false;
    };

    const abortGestureProjection = () => {
      gestureProjectionAborted = true;
      fullAfterGesture = true;
      clearGesturePreview();
      restoreGestureMask();
    };

    const applyGestureProjectionResult = (result: GestureProjectionResult) => {
      if (result.kind === 'abort') {
        abortGestureProjection();
        return;
      }
      if (result.kind !== 'preview') return;
      const source = map.getSource(SRC_GESTURE) as GeoJSONSource | undefined;
      if (!source) {
        abortGestureProjection();
        return;
      }
      source.setData(result.projection.data);
      recordSourceUpload(projectionCounts);
      gesturePreviewVisible = true;
      applyGestureMask(result.projection.affected);
    };

    const beginGestureProjection = (targets: EditGestureTargets) => {
      if (gestureActive) return;
      gestureActive = true;
      gestureProjectionAborted = false;
      fullAfterGesture = false;
      const baseline = store.getState().system;
      gestureProjection = createGestureProjectionController(baseline, targets, projectionCounts);
      if (pushDataRaf !== null) {
        cancelAnimationFrame(pushDataRaf);
        pushDataRaf = null;
        fullAfterGesture = true;
      }
      if (selectionRaf !== null) {
        cancelAnimationFrame(selectionRaf);
        selectionRaf = null;
        sourceUploadQueue.add('all');
        fullAfterGesture = true;
      }
      applyGestureProjectionResult(gestureProjection.project(baseline));
    };

    const endGestureProjection = () => {
      if (!gestureActive) return;
      const finish = gestureProjection?.finish() ?? { rebuild: false, hadPreview: false };
      clearGesturePreview();
      restoreGestureMask();
      gestureActive = false;
      gestureProjection = null;
      const needsFullProjection = finish.rebuild || fullAfterGesture;
      fullAfterGesture = false;
      if (needsFullProjection) {
        // Gesture store commits already contributed their exact dependency
        // union. Fall back to all only for a canceled/aborted path that did not
        // expose a classifiable system change.
        schedulePushData(sourceUploadQueue.hasPending() ? [] : 'all');
      }
      void styleSwitchControllerRef.current?.flush();
    };

    // Selection-only fast path (system unchanged): update halos via feature-state
    // and refresh only the small handle sources — never re-tessellating the big
    // static sources (ways/services/stations) just to move a selection glow.
    let selectionRaf: number | null = null;
    const scheduleSelectionUpdate = () => {
      if (selectionRaf !== null) return;
      selectionRaf = requestAnimationFrame(() => {
        selectionRaf = null;
        if (!map.getSource(SRC_WAYS)) return;
        applySelectionState();
        const { system } = store.getState();
        const renderSystem =
          viewRef.current.viewMode === 'diagram'
            ? computeDiagramSystem(system, sourceProjectionCounts)
            : system;
        // Only the two handle sources depend on the selection, so build just
        // those. This used to run the whole fourteen-collection buildFeatures
        // and throw twelve of its outputs away — which at RTC scale meant
        // allocating a Set and a Feature for all ~3,787 stations, plus a full
        // pass over every way, every time the user clicked something.
        //
        // It also computed its own viewport bounds, narrower than the ones
        // pushData uses; the two then asked wayLaneGeometry for different trim
        // keys and evicted each other's cached lane geometry on every click.
        // Not recomputing bounds here removes that thrash outright.
        const physStation = physicalHandleStationId();
        const physGroup = physicalHandleGroupId();
        // Physical handles are Infrastructure-only, matching buildFeatures'
        // own `network` gate.
        const infrastructure = viewRef.current.viewMode === 'infrastructure';
        (map.getSource(SRC_HANDLES) as GeoJSONSource | undefined)?.setData({
          type: 'FeatureCollection',
          features: buildHandles(wayById(renderSystem.ways), handleWayIds()),
        });
        (map.getSource(SRC_PHYSICAL_HANDLES) as GeoJSONSource | undefined)?.setData({
          type: 'FeatureCollection',
          features: infrastructure
            ? buildPhysicalHandles(
                physStation ? renderSystem.stations.find((s) => s.id === physStation) : null,
                physGroup ? renderSystem.groups.find((g) => g.id === physGroup) : null,
              )
            : [],
        });
      });
    };

    // Lane-detail geometry (SRC_LANES/JUNCTIONS/…) is viewport-scoped, so a pan
    // or a zoom-threshold cross needs a rebuild. But panBy(duration:0) fires
    // moveend once PER MOUSE-MOVE, and re-tessellating the heavy lane sources
    // on every one made them flicker (setData briefly clears them) and lag the
    // camera (jump/misalign) during an infrastructure-view drag. Debounce it:
    // during the gesture MapLibre just pans the existing geometry (smooth,
    // aligned), and we rebuild ONCE, ~after it settles.
    let laneRefreshTimer: number | undefined;
    const LANE_REFRESH_DEBOUNCE_MS = 130;
    const scheduleLaneRefresh = () => {
      window.clearTimeout(laneRefreshTimer);
      laneRefreshTimer = window.setTimeout(() => {
        if (map.getSource(SRC_LANES)) schedulePushData('all');
      }, LANE_REFRESH_DEBOUNCE_MS);
    };

    let initialMapLoaded = false;
    const recoverMapStyle = () => {
      registerMapIcons(map, activeMapScheme);
      if (!ensureOverlay()) return;
      pushData(ALL_SYSTEM_FEATURE_SOURCES);
      // A full style rebuild creates fresh feature-state tables. pushData
      // reapplies selection after setData; restore the stationary hover too so
      // the pointer does not lose its affordance until it moves again.
      if (hovered && map.getSource(hovered.source)) {
        map.setFeatureState(hovered, { hover: true });
      }
      updateHaloVisibility();
      setRouteFocus(routeFocusActive, true);
      const landmarkVisibility =
        viewRef.current.viewMode !== 'diagram' && showLandmarksRef.current ? 'visible' : 'none';
      if (map.getLayer(LYR_LANDMARKS))
        map.setLayoutProperty(LYR_LANDMARKS, 'visibility', landmarkVisibility);
      if (map.getLayer(LYR_LANDMARK_LABELS))
        map.setLayoutProperty(LYR_LANDMARK_LABELS, 'visibility', landmarkVisibility);
      setBasemapVisible(map, viewRef.current.viewMode !== 'diagram');
      notifyVehicleGate();
      map.triggerRepaint();
    };
    const onStyleLoad = () => {
      if (initialMapLoaded) recoverMapStyle();
    };
    map.on('style.load', onStyleLoad);
    styleSwitchControllerRef.current = createStyleSwitchController({
      map,
      initialScheme: initialColorScheme,
      isInteractionActive: () => {
        const state = store.getState();
        return (
          gestureActive ||
          directManipulationActive ||
          state.activeWayId !== null ||
          state.routeDraft !== null
        );
      },
      recover: (scheme, fullRebuild) => {
        activeMapScheme = scheme;
        usingLocalBlankStyle = false;
        if (!fullRebuild) recoverMapStyle();
      },
      onUnavailable: () => basemapFailureRef.current?.(),
    });

    map.on('load', () => {
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
      ensureOverlay();
      if (PERF_HARNESS_BUILD) {
        initialPaintListener = () => {
          if (
            !systemPaintReady({
              systemDataUploaded: initialSystemDataUploaded,
              representativeSourceExists: Boolean(map.getSource(SRC_STATIONS)),
              representativeSourceLoaded: map.isSourceLoaded(SRC_STATIONS),
            })
          ) {
            return;
          }
          map.off('render', initialPaintListener!);
          initialPaintListener = null;
          markFirstSystemMapPaint();
        };
        map.on('render', initialPaintListener);
      }
      pushData(ALL_SYSTEM_FEATURE_SOURCES);
      initialMapLoaded = true;
      map.triggerRepaint();
      detachInteractions = attachInteractions(map, store, {
        openShortcuts,
        toggleUi,
        sim: simCommands,
        isDiagramMode: () => viewRef.current.viewMode === 'diagram',
        isNetworkMode: () => viewRef.current.viewMode === 'network',
        openContextMenu,
        closeContextMenu,
        setActionAnchor: (at) => {
          const source = map.getSource(SRC_ACTION_ANCHOR) as GeoJSONSource | undefined;
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
            { padding: 120, maxZoom: 19, duration: 600 },
          );
        },
      });
      detachVehicles = attachVehicleAnimation(map, store, simClock, {
        isVisible: (service) => viewRef.current.visibleModes.has(service.modeId),
        viewMode: () => viewRef.current.viewMode,
        pinnedPeriod: () => pinnedPeriodRef.current,
        isDirectManipulationActive: () => directManipulationActive,
        subscribe: (listener) => {
          vehicleGateListenersRef.current.add(listener);
          return () => {
            vehicleGateListenersRef.current.delete(listener);
          };
        },
      });
      if (PERF_HARNESS_BUILD) {
        detachPerf = attachPerfHarness(map, {
          stationSnapshot: (stationId) => {
            const system = store.getState().system;
            const station = system.stations.find((candidate) => candidate.id === stationId);
            return station
              ? { coord: station.coord, revision: system.updatedAt, wayCount: system.ways.length }
              : null;
          },
          overlaySnapshot: () => {
            const sourceExists = Boolean(map.getSource(SRC_STATIONS));
            const sourceLoaded = sourceExists && map.isSourceLoaded(SRC_STATIONS);
            return {
              sourceExists,
              layerExists: Boolean(map.getLayer(LYR_STATIONS)),
              sourceLoaded,
              featureCount: sourceLoaded ? map.querySourceFeatures(SRC_STATIONS).length : 0,
            };
          },
        });
      }
      detachSimDev = attachSimDevHandle(simClock); // DEV-only __sim.setTime()/__sim.step() clock driver
      map.resize();
    });

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    const unsub = store.subscribe((s, prev) => {
      const wasDrawing = prev.activeWayId !== null || prev.routeDraft !== null;
      const drawing = s.activeWayId !== null || s.routeDraft !== null;
      if (wasDrawing && !drawing) void styleSwitchControllerRef.current?.flush();

      // Plan from the exact TransitSystem fields whose references changed.
      // Renaming the system, moving the camera, or picking a palette color
      // produces an empty plan; topology edits conservatively include every
      // derived collection they can influence.
      const documentChanged = prev.system.id !== s.system.id;
      const changedSources = sourceUploadsForSystemChange(prev.system, s.system, {
        forceAll: documentChanged,
      });
      if (changedSources.length > 0 || (gestureActive && documentChanged)) {
        if (gestureActive) {
          // A document switch must abort the baseline-bound gesture even in
          // the degenerate case where the new document reuses the same arrays.
          sourceUploadQueue.add(documentChanged ? 'all' : changedSources);
          if (!gestureProjectionAborted && gestureProjection)
            applyGestureProjectionResult(gestureProjection.project(s.system));
          else fullAfterGesture = true;
        } else if (map.getSource(SRC_SERVICES)) {
          // Build and upload only dependencies whose GeoJSON may differ.
          // Unrequested feature phases never traverse or allocate their
          // RTC-scale collections.
          schedulePushData(changedSources);
        }
      } else if (
        (s.selection !== prev.selection ||
          s.activeWayId !== prev.activeWayId ||
          s.activePatternId !== prev.activePatternId ||
          s.armedTerminus !== prev.armedTerminus) &&
        map.getSource(SRC_SERVICES)
      ) {
        if (gestureActive) {
          sourceUploadQueue.add('all');
          fullAfterGesture = true;
        } else {
          // Only the selection/active way changed. Node selection rides the
          // junctions `selected` filter, so it still needs a rebuild; everything
          // else takes the feature-state fast path.
          const involvesNode = s.selection?.kind === 'node' || prev.selection?.kind === 'node';
          if (involvesNode) schedulePushData('all');
          else {
            scheduleSelectionUpdate();
            schedulePushData([SRC_SERVICE_TERMINI]);
          }
        }
      }
      // Route drafting (Network view snap-to-streets drawing): show the
      // committed legs as the standard dashed draw preview.
      if (s.routeDraft !== prev.routeDraft) {
        // One feature per SPAN rather than one for the whole route, so a
        // stretch the router had to run against traffic can say so. Under
        // `preferLegal` the draft is given the line rather than a refusal —
        // which is only half an answer if nothing shows what is wrong with it.
        const spans = s.routeDraft?.spans ?? [];
        const features = spans
          .map((span) => ({ span, path: routePath(s.system, [span]) }))
          .filter(({ path }) => path.length >= 2)
          .map(({ span, path }) => ({
            type: 'Feature' as const,
            properties: { wrongWay: span.wrongWay === true },
            geometry: { type: 'LineString' as const, coordinates: path },
          }));
        (map.getSource(SRC_PREVIEW) as GeoJSONSource | undefined)?.setData(
          features.length > 0 ? { type: 'FeatureCollection', features } : emptyFC,
        );
      }
      if (s.system.id !== lastSystemId) {
        lastSystemId = s.system.id;
        map.jumpTo({ center: s.system.viewport.center, zoom: s.system.viewport.zoom });
        // The newly-loaded system's saved camera becomes the live camera.
        initLiveCamera(s.system.viewport);
      }
      // Chrome-driven selection (Objects list, keyboard nav, Inspector jump
      // links, Issues) asks for this via selectAndFocus bumping the token —
      // a direct map click already shows the user where the thing is and
      // never touches this. See editor/store.ts's cameraFocusToken comment.
      if (s.cameraFocusToken !== prev.cameraFocusToken) {
        const focus = selectionFocus(s.system, s.selection);
        if (focus) {
          if (focus.needsInfrastructureView) setViewMode('infrastructure');
          map.fitBounds(focus.bounds, { padding: 100, maxZoom: 18, duration: 500 });
        }
      }
    });

    // Crossing the lane-detail zoom threshold swaps the whole rendering mode;
    // panning while AT lane detail changes which ways are in view. Either one
    // needs a data refresh — a plain pan below the threshold doesn't.
    let wasLaneDetail = false;
    const onZoom = () => {
      const now = laneDetailNow();
      if (now !== wasLaneDetail) {
        wasLaneDetail = now;
        scheduleLaneRefresh(); // debounced: swap fan⇄lane-detail after the zoom settles, not mid-zoom
      }
    };
    map.on('zoom', onZoom);

    const onMoveEnd = () => {
      const c = map.getCenter();
      // Record the move on the live camera holder — NOT the domain store. A pure
      // pan/zoom must not mint a new `system` reference: that used to fire the
      // subscription below → full-system buildFeatures + 13 setData + selector
      // fan-out + autosave, once per coalesced drag frame (panBy(duration:0)
      // fires moveend per mousemove). Camera persistence is handled separately
      // and debounced (storage/persistenceCoordinator.ts).
      setLiveCamera({ center: [c.lng, c.lat], zoom: map.getZoom() });
      // Debounced — a lane-detail pan rebuilds once it settles, not per
      // mouse-move (moveend fires per mouse-move from panBy(duration:0)).
      if (laneDetailNow()) scheduleLaneRefresh();
    };
    map.on('moveend', onMoveEnd);

    return () => {
      ro.disconnect();
      unsub();
      pendingHover = null;
      if (hoverRaf !== null) cancelAnimationFrame(hoverRaf);
      map.off('mousemove', onHoverMove);
      map.off('mouseout', onHoverOut);
      if (pushDataRaf !== null) cancelAnimationFrame(pushDataRaf);
      if (selectionRaf !== null) cancelAnimationFrame(selectionRaf);
      if (initialPaintListener) map.off('render', initialPaintListener);
      window.clearTimeout(laneRefreshTimer);
      map.off('zoom', onZoom);
      map.off('moveend', onMoveEnd);
      detachInteractions?.();
      detachVehicles?.();
      detachPerf?.();
      detachSimDev?.();
      detachInitialStyleFallback();
      styleSwitchControllerRef.current?.dispose();
      styleSwitchControllerRef.current = null;
      map.off('style.load', onStyleLoad);
      map.off('error', onMapError);
      clearGesturePreview();
      restoreGestureMask();
      if (PERF_HARNESS_BUILD) delete window.__mapProjectionCounts;
      schedulePushDataRef.current = null;
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
          background: 'var(--tm-map-background)',
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
