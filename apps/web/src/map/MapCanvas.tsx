import { useEffect, useRef } from "react";
import maplibregl, { type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEditorStore } from "../editor/EditorProvider";
import { useUi } from "../ui/UiProvider";
import { useView } from "../ui/ViewProvider";
import { BASEMAP_STYLE } from "./basemap";
import { attachInteractions } from "./interactions";
import { computeDiagramSystem } from "@transitmapper/core/model/diagramLayout";
import { serviceWayIds, systemBounds } from "@transitmapper/core/model/geo";
import { routePath } from "@transitmapper/core/model/routeGraph";
import { selectionFocus } from "./selectionFocus";
import {
  buildFeatures,
  LANE_DETAIL_MIN_ZOOM,
  LAYER_SPECS,
  LYR_LANDMARKS,
  LYR_LANDMARK_LABELS,
  LYR_WAY_SELECTED,
  LYR_SERVICE_SELECTED,
  LYR_STATION_SELECTED,
  LYR_FACILITY_SELECTED,
  registerMapIcons,
  SRC_ENDPOINT_HINT,
  SRC_FACILITIES,
  SRC_FOOTPRINTS,
  SRC_HANDLES,
  SRC_CONNECTORS,
  SRC_JUNCTIONS,
  SRC_LANDMARKS,
  SRC_LANE_ARROWS,
  SRC_LANE_MARKINGS,
  SRC_LANES,
  SRC_MARQUEE,
  SRC_PHYSICAL_HANDLES,
  SRC_PLATFORMS,
  SRC_PREVIEW,
  SRC_SERVICES,
  SRC_VEHICLES,
  SRC_VEHICLES_INFRA,
  SRC_WAYS,
  SRC_WAY_LABELS,
  SRC_STATIONS,
  type ViewOptions,
} from "./layers";
import { landmarksFeatureCollection } from "./landmarks";
import { getMap, setMap } from "./mapRef";
import { initLiveCamera, setLiveCamera } from "../camera/liveCamera";
import { attachPerfHarness } from "../perf";
import { servicesByWay } from "./layers/featureMemo";
import { attachVehicleAnimation } from "../sim/vehicles";
import type { Map as MLMap } from "maplibre-gl";

const OWN_LAYER_IDS = new Set(LAYER_SPECS.map((l) => l.id));

/** Diagram mode is a schematic with no real geography, so the street basemap
 *  underneath would be actively misleading — hide every style layer that
 *  isn't one of ours (leaving its background/land color as a plain backdrop)
 *  rather than tearing down and reloading the whole map style. */
function setBasemapVisible(map: MLMap, visible: boolean): void {
  const layers = map.getStyle()?.layers ?? [];
  for (const layer of layers) {
    if (OWN_LAYER_IDS.has(layer.id)) continue;
    map.setLayoutProperty(layer.id, "visibility", visible ? "visible" : "none");
  }
}

export interface MapCanvasProps {
  /** Called once if the basemap never loads. The editor still works without
   *  it — every way, station and service is ours and draws regardless — but
   *  the backdrop is blank, and a user who isn't told assumes the app broke
   *  rather than that a third-party tile host is down. */
  onBasemapUnavailable?: () => void;
}

export function MapCanvas({ onBasemapUnavailable }: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const store = useEditorStore();
  const { openShortcuts, toggleUi } = useUi();
  const { viewMode, setViewMode, visibleModes, visibleWayTypes, showLandmarks } = useView();

  // The map-setup effect below runs once (mount-only); it reads the latest
  // view options from this ref rather than closing over React state, so a
  // separate effect can push view-only changes (Network⇄Infrastructure, a
  // filter toggle) without tearing down and recreating the whole map.
  // Held in a ref, not read directly in the map effect: that effect builds the
  // whole map, and listing a caller-supplied callback in its deps would tear
  // the map down and rebuild it every time App re-renders with a fresh arrow.
  const basemapFailureRef = useRef(onBasemapUnavailable);
  basemapFailureRef.current = onBasemapUnavailable;

  const viewRef = useRef<ViewOptions>({ viewMode, visibleModes, visibleWayTypes });
  const pushDataRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const prevMode = viewRef.current.viewMode;
    viewRef.current = { viewMode, visibleModes, visibleWayTypes };
    pushDataRef.current?.();
    const map = getMap();
    // NOT map.isStyleLoaded() — that reports false while tiles for the
    // current viewport are still streaming in, which is unrelated to
    // whether the style's layers exist yet (they do, from the first "load").
    // Gating on it here made this a coin flip: it silently skipped the
    // basemap toggle whenever a transition happened to land mid-tile-load,
    // with no retry since nothing re-fires this effect on its own.
    if (!map || !map.getStyle()) return;
    if (viewMode === "diagram" || prevMode === "diagram") setBasemapVisible(map, viewMode !== "diagram");
    // Landmarks are real-world reference points; Diagram's schematic
    // coordinates aren't real geography, so they'd land somewhere meaningless.
    const landmarksVisible = showLandmarks && viewMode !== "diagram";
    if (map.getLayer(LYR_LANDMARKS)) {
      map.setLayoutProperty(LYR_LANDMARKS, "visibility", landmarksVisible ? "visible" : "none");
      map.setLayoutProperty(LYR_LANDMARK_LABELS, "visibility", landmarksVisible ? "visible" : "none");
    }
    // Entering Diagram reframes the camera to the schematic layout's own
    // extent — its coordinates are a distorted projection of the real ones,
    // so whatever framing suited Network/Infrastructure may no longer show
    // the whole thing (or may be framing empty space).
    if (viewMode === "diagram" && prevMode !== "diagram") {
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
  }, [viewMode, visibleModes, visibleWayTypes, showLandmarks, store]);

  useEffect(() => {
    if (!containerRef.current) return;
    const initial = store.getState().system;
    // Seed the live camera holder from the loaded system's saved viewport
    // (camera/liveCamera.ts owns the LIVE camera from here on, not `system`).
    initLiveCamera(initial.viewport);

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
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
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    setMap(map);

    // MapLibre reports style/source/tile failures through this event rather
    // than by throwing, so without a listener they are completely silent —
    // the same reasoning embed/main.ts already applies, which called silent
    // half-rendering the worst possible failure mode. It is worse here: the
    // overlay's self-healing in ensureOverlay() will keep re-adding layers
    // over a style that never loaded, hiding a persistent failure forever.
    //
    // BASEMAP_STYLE is a third-party host (openfreemap.org) with no SLA, so
    // "the basemap is down" is a real operating condition, not a hypothetical.
    // Only a failure *before the style loads* is worth telling the user about:
    // once it's up, later errors are individual tiles timing out, which
    // MapLibre retries and which nobody needs a message about.
    let styleLoaded = false;
    let reportedBasemapFailure = false;
    map.on("style.load", () => {
      styleLoaded = true;
    });
    map.on("error", (e) => {
      console.error("[transitmapper]", e.error ?? e);
      if (styleLoaded || reportedBasemapFailure) return;
      reportedBasemapFailure = true;
      basemapFailureRef.current?.();
    });

    let detachInteractions: (() => void) | null = null;
    let detachVehicles: (() => void) | null = null;
    let detachPerf: (() => void) | null = null;
    let lastSystemId = initial.id;
    const emptyFC = { type: "FeatureCollection" as const, features: [] };

    const handleWayIds = (): string[] => {
      // Diagram mode is view-only — a reshape handle there would promise a
      // drag that attachInteractions refuses to honor (see isDiagramMode).
      if (viewRef.current.viewMode === "diagram") return [];
      const s = store.getState();
      if (s.activeWayId) return [s.activeWayId];
      if (s.selection?.kind === "way") return [s.selection.id];
      if (s.selection?.kind === "service") {
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
      return s.selection?.kind === "station" ? s.selection.id : null;
    };

    // Same, for a group's (facility-complex's) own footprint — whichever
    // group is selected.
    const physicalHandleGroupId = (): string | null => {
      const s = store.getState();
      return s.selection?.kind === "group" ? s.selection.id : null;
    };

    // Lane-detail LOD: real per-lane street geometry only derives/renders at
    // high zoom in the Infrastructure view, scoped to the current viewport
    // (with margin). Anything else keeps the cheap fan rendering.
    const laneDetailNow = () => viewRef.current.viewMode === "infrastructure" && map.getZoom() >= LANE_DETAIL_MIN_ZOOM;

    const ALL_SOURCES = [
      SRC_WAYS, SRC_SERVICES, SRC_STATIONS, SRC_HANDLES, SRC_PREVIEW,
      SRC_ENDPOINT_HINT, SRC_MARQUEE, SRC_FOOTPRINTS, SRC_PLATFORMS,
      SRC_FACILITIES, SRC_PHYSICAL_HANDLES, SRC_VEHICLES, SRC_VEHICLES_INFRA, SRC_LANES,
      SRC_LANE_MARKINGS, SRC_LANE_ARROWS, SRC_JUNCTIONS, SRC_CONNECTORS,
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
          src === SRC_SERVICES ? "serviceId" : src === SRC_WAYS || src === SRC_STATIONS || src === SRC_FACILITIES ? "id" : undefined;
        map.addSource(src, {
          type: "geojson",
          data: emptyFC,
          ...(heavy ? { tolerance: 1 } : {}),
          ...(promoteId ? { promoteId } : {}),
        });
      }
      // Static context, not system-derived — set once here rather than on
      // every pushData() like the sources above.
      if (!map.getSource(SRC_LANDMARKS)) map.addSource(SRC_LANDMARKS, { type: "geojson", data: landmarksFeatureCollection() });
      for (let i = 0; i < LAYER_SPECS.length; i++) {
        const spec = LAYER_SPECS[i];
        if (map.getLayer(spec.id)) continue;
        const anchor = LAYER_SPECS.slice(i + 1).find((later) => map.getLayer(later.id));
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
    const HALO_LAYERS = [LYR_WAY_SELECTED, LYR_SERVICE_SELECTED, LYR_STATION_SELECTED, LYR_FACILITY_SELECTED];
    let appliedSelectionStates: Array<{ source: string; id: string }> = [];
    const applySelectionState = () => {
      for (const { source, id } of appliedSelectionStates) map.removeFeatureState({ source, id });
      appliedSelectionStates = [];
      const { system, selection } = store.getState();
      const mark = (source: string, id: string) => {
        map.setFeatureState({ source, id }, { selected: true });
        appliedSelectionStates.push({ source, id });
      };
      if (selection?.kind === "way") {
        mark(SRC_WAYS, selection.id);
        // A selected way also lights the services riding it — most guideway
        // types draw no bare line when served, so the service line is the only
        // thing on screen to highlight for a way selection.
        for (const svc of servicesByWay(system.services, viewRef.current.visibleModes).get(selection.id) ?? []) {
          mark(SRC_SERVICES, svc.id);
        }
      } else if (selection?.kind === "service") {
        mark(SRC_SERVICES, selection.id);
      } else if (selection?.kind === "station") {
        mark(SRC_STATIONS, selection.id);
      } else if (selection?.kind === "facility") {
        mark(SRC_FACILITIES, selection.id);
      }
      // The halo layers are feature-state driven, so without a filter they'd
      // otherwise redraw EVERY way/service/station at 0 opacity on every frame
      // (real fill-rate on the 121k-waypoint services source during a zoom).
      // Hide them outright when nothing halo-able is selected — the common case.
      const visibility = appliedSelectionStates.length > 0 ? "visible" : "none";
      for (const layer of HALO_LAYERS) {
        if (map.getLayer(layer)) map.setLayoutProperty(layer, "visibility", visibility);
      }
      map.triggerRepaint();
    };

    const pushData = () => {
      // Self-heal before pushing — a missing source would otherwise silently
      // swallow this update (every setData below is optional-chained).
      if (!map.getSource(SRC_WAYS) || !map.getLayer(LAYER_SPECS[0].id)) {
        if (!ensureOverlay()) return;
      }
      const { system, selection } = store.getState();
      const renderSystem = viewRef.current.viewMode === "diagram" ? computeDiagramSystem(system) : system;
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
        bounds: laneDetail ? [[b.getWest() - mLng, b.getSouth() - mLat], [b.getEast() + mLng, b.getNorth() + mLat]] : undefined,
      };
      const fc = buildFeatures(renderSystem, selection, handleWayIds(), view, physicalHandleStationId(), physicalHandleGroupId());
      (map.getSource(SRC_LANES) as GeoJSONSource | undefined)?.setData(fc.lanes);
      (map.getSource(SRC_LANE_MARKINGS) as GeoJSONSource | undefined)?.setData(fc.laneMarkings);
      (map.getSource(SRC_LANE_ARROWS) as GeoJSONSource | undefined)?.setData(fc.laneArrows);
      (map.getSource(SRC_JUNCTIONS) as GeoJSONSource | undefined)?.setData(fc.junctions);
      (map.getSource(SRC_CONNECTORS) as GeoJSONSource | undefined)?.setData(fc.connectors);
      (map.getSource(SRC_WAY_LABELS) as GeoJSONSource | undefined)?.setData(fc.wayLabels);
      (map.getSource(SRC_WAYS) as GeoJSONSource | undefined)?.setData(fc.ways);
      (map.getSource(SRC_SERVICES) as GeoJSONSource | undefined)?.setData(fc.services);
      (map.getSource(SRC_STATIONS) as GeoJSONSource | undefined)?.setData(fc.stations);
      (map.getSource(SRC_HANDLES) as GeoJSONSource | undefined)?.setData(fc.handles);
      (map.getSource(SRC_FOOTPRINTS) as GeoJSONSource | undefined)?.setData(fc.footprints);
      (map.getSource(SRC_PLATFORMS) as GeoJSONSource | undefined)?.setData(fc.platforms);
      (map.getSource(SRC_FACILITIES) as GeoJSONSource | undefined)?.setData(fc.facilities);
      (map.getSource(SRC_PHYSICAL_HANDLES) as GeoJSONSource | undefined)?.setData(fc.physicalHandles);
      // setData above cleared feature-state — re-apply the current selection.
      applySelectionState();
    };
    pushDataRef.current = pushData;

    // Coalesce rebuilds to at most one per animation frame. A bulk import
    // (streamRtcGtfsBatches) merges many batches in quick succession — each
    // is its own store commit, and pushData's buildFeatures()+13x setData()
    // is real main-thread work on a large system, so calling it once per
    // commit froze the tab between batches instead of yielding smoothly.
    // Reading store.getState() fresh inside pushData means a coalesced call
    // still reflects the LATEST merged state, not a stale snapshot.
    let pushDataRaf: number | null = null;
    const schedulePushData = () => {
      if (pushDataRaf !== null) return;
      pushDataRaf = requestAnimationFrame(() => {
        pushDataRaf = null;
        pushData();
      });
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
        const { system, selection } = store.getState();
        const renderSystem = viewRef.current.viewMode === "diagram" ? computeDiagramSystem(system) : system;
        const laneDetail = laneDetailNow();
        const b = map.getBounds();
        const view: ViewOptions = {
          ...viewRef.current,
          laneDetail,
          bounds: laneDetail ? [[b.getWest(), b.getSouth()], [b.getEast(), b.getNorth()]] : undefined,
        };
        // buildFeatures is cheap now (memoized — see featureMemo); we take only
        // its handle outputs and skip setData on every big source.
        const fc = buildFeatures(renderSystem, selection, handleWayIds(), view, physicalHandleStationId(), physicalHandleGroupId());
        (map.getSource(SRC_HANDLES) as GeoJSONSource | undefined)?.setData(fc.handles);
        (map.getSource(SRC_PHYSICAL_HANDLES) as GeoJSONSource | undefined)?.setData(fc.physicalHandles);
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
        if (map.getSource(SRC_LANES)) pushData();
      }, LANE_REFRESH_DEBOUNCE_MS);
    };

    map.on("load", () => {
      // MapLibre's compact attribution starts expanded once (its own default
      // "first impression" behavior, applied asynchronously as style/source
      // data loads — too late to undo right after addControl) and only
      // collapses to the bare "i" after the map is interacted with. Collapse
      // it immediately instead so it never shows the full text unprompted.
      map.getContainer().querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
      registerMapIcons(map);
      ensureOverlay();
      pushData();
      detachInteractions = attachInteractions(map, store, {
        openShortcuts,
        toggleUi,
        isDiagramMode: () => viewRef.current.viewMode === "diagram",
        isNetworkMode: () => viewRef.current.viewMode === "network",
        // Footprints only render in the Infrastructure view — switch there
        // and zoom in, or a newly-drawn complex would be invisible right
        // where the user just drew it (the original bug report this fixes).
        focusFootprint: (footprint) => {
          setViewMode("infrastructure");
          let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
          for (const [lng, lat] of footprint) {
            if (lng < west) west = lng;
            if (lng > east) east = lng;
            if (lat < south) south = lat;
            if (lat > north) north = lat;
          }
          map.fitBounds([[west, south], [east, north]], { padding: 120, maxZoom: 19, duration: 600 });
        },
      });
      detachVehicles = attachVehicleAnimation(map, store, {
        isVisible: (service) => viewRef.current.visibleModes.has(service.modeId),
        viewMode: () => viewRef.current.viewMode,
      });
      detachPerf = attachPerfHarness(map); // DEV-only frame-time overlay + __panBench() + __perf toggles
      map.resize();
    });

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    const unsub = store.subscribe((s, prev) => {
      if (s.system !== prev.system) {
        // Content changed — full rebuild (which re-applies selection state).
        if (map.getSource(SRC_SERVICES)) schedulePushData();
      } else if ((s.selection !== prev.selection || s.activeWayId !== prev.activeWayId) && map.getSource(SRC_SERVICES)) {
        // Only the selection/active way changed. Node selection rides the
        // junctions `selected` filter, so it still needs a rebuild; everything
        // else takes the feature-state fast path.
        const involvesNode = s.selection?.kind === "node" || prev.selection?.kind === "node";
        if (involvesNode) schedulePushData();
        else scheduleSelectionUpdate();
      }
      // Route drafting (Network view snap-to-streets drawing): show the
      // committed legs as the standard dashed draw preview.
      if (s.routeDraft !== prev.routeDraft) {
        const path = s.routeDraft ? routePath(s.system, s.routeDraft.spans) : [];
        (map.getSource(SRC_PREVIEW) as GeoJSONSource | undefined)?.setData(
          path.length >= 2
            ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: path } }] }
            : emptyFC,
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
          if (focus.needsInfrastructureView) setViewMode("infrastructure");
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
    map.on("zoom", onZoom);

    const onMoveEnd = () => {
      const c = map.getCenter();
      // Record the move on the live camera holder — NOT the domain store. A pure
      // pan/zoom must not mint a new `system` reference: that used to fire the
      // subscription below → full-system buildFeatures + 13 setData + selector
      // fan-out + autosave, once per coalesced drag frame (panBy(duration:0)
      // fires moveend per mousemove). Camera persistence is handled separately
      // and debounced (camera/cameraPersistence.ts).
      setLiveCamera({ center: [c.lng, c.lat], zoom: map.getZoom() });
      // Debounced — a lane-detail pan rebuilds once it settles, not per
      // mouse-move (moveend fires per mouse-move from panBy(duration:0)).
      if (laneDetailNow()) scheduleLaneRefresh();
    };
    map.on("moveend", onMoveEnd);

    return () => {
      ro.disconnect();
      unsub();
      if (pushDataRaf !== null) cancelAnimationFrame(pushDataRaf);
      if (selectionRaf !== null) cancelAnimationFrame(selectionRaf);
      window.clearTimeout(laneRefreshTimer);
      map.off("zoom", onZoom);
      map.off("moveend", onMoveEnd);
      detachInteractions?.();
      detachVehicles?.();
      detachPerf?.();
      pushDataRef.current = null;
      setMap(null);
      map.remove();
    };
  }, [store, openShortcuts, toggleUi]);

  return <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />;
}
