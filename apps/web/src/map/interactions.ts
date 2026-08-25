import type { Map as MLMap, MapMouseEvent, MapGeoJSONFeature, GeoJSONSource } from 'maplibre-gl';
import type { EditorState, EditorStore, MultiSelectItem } from '../editor/store';
import type { InputTuning } from '../editor/input-tuning';
import { attachTouchGestures } from './touch-gestures';
import {
  resolvePointerIntent,
  type ModifierState,
  type PointerIntent,
  type PointerIntentInput,
  type PointerOperation,
  type PointerTarget,
} from '../editor/pointerIntent';
import {
  CONFLATION_TOLERANCE_M,
  densifyForMatching,
  detectShapeRuns,
  haversineMeters,
  metersFromOrigin,
  nearestOpenEndpoint,
  nearestOnPath,
  offsetMeters,
  offsetPolyline,
  pathLengthMeters,
  patternPath,
  resolveWayPath,
  snap,
  squareFootprint,
  type ShapeRun,
  patternLegs,
  patternRunLegs,
  legRange,
  pointAtT,
  primaryAnchor,
  slicePathByT,
  wayById,
} from '@transitmapper/core/model/geo';
import { facilityType, mode } from '@transitmapper/core/model/catalog';
import { profileWidthM } from '@transitmapper/core/model/profile';
import { anchorOnWay, routePath } from '@transitmapper/core/model/routeGraph';
import { patternPositionAt } from '@transitmapper/core/model/serviceEdits';
import { lineForService, servicePattern } from '@transitmapper/core/model/line-service';
import {
  planTerminusGesture,
  type TerminusGesturePlan,
  type TerminusGestureSource,
  type TerminusGestureTarget,
} from '@transitmapper/core/model/serviceGestures';
import type { LngLat, TransitSystem } from '@transitmapper/core/model/system';
import type {
  CorridorActionHit,
  ServiceActionHit,
} from '@transitmapper/core/model/selectionActions';
import type { EditGestureTargets } from './gestureProjection';
import {
  LYR_FACILITIES,
  LYR_GESTURE_POINT,
  LYR_HANDLES,
  LYR_SERVICE_TERMINI_HIT,
  LYR_JUNCTIONS,
  LYR_LANE_SURFACES,
  LYR_PHYSICAL_HANDLES,
  LYR_SERVICES_UNDERGROUND,
  LYR_SERVICES_HIT,
  LYR_SERVICES_SOLID,
  LYR_WAY_ENDPOINTS,
  LYR_WAYS_DASHED,
  LYR_WAYS_SOLID,
  LYR_STATIONS,
  SRC_ENDPOINT_HINT,
  SRC_MARQUEE,
  SRC_PREVIEW,
  SRC_SHARING,
} from '@transitmapper/renderer/layers';

/** A screen-space pixel coordinate (as opposed to LngLat's map-space one). */
interface ScreenPoint {
  x: number;
  y: number;
}

const SERVICE_LAYERS = [LYR_SERVICES_HIT, LYR_SERVICES_SOLID, LYR_SERVICES_UNDERGROUND];
// Street lanes retain the corridor domain ID, so hit-testing works across LOD tiers.
const WAY_LAYERS = [LYR_WAYS_SOLID, LYR_WAYS_DASHED, LYR_LANE_SURFACES];
const HIT_TEST_LAYERS = [
  LYR_SERVICE_TERMINI_HIT,
  LYR_WAY_ENDPOINTS,
  LYR_HANDLES,
  LYR_PHYSICAL_HANDLES,
  LYR_GESTURE_POINT,
  LYR_STATIONS,
  LYR_FACILITIES,
  LYR_JUNCTIONS,
  ...SERVICE_LAYERS,
  ...WAY_LAYERS,
];

// Coalesces a fast-firing callback to at most once per animation frame,
// keeping only the latest call's arguments. Raw "mousemove" fires far faster
// than the map can actually repaint. Drag handlers that write to the store
// need this so a moved point doesn't re-rebuild the entire system once per
// raw mouse event instead of once per painted frame; drag handlers that only
// update the rubber-band SRC_PREVIEW source need it too — an un-throttled
// setData still round-trips through the source's worker on every event, and
// on a large system that backs up badly (see startDraw/startExtendDrag/the
// facility+station-land+structure rectangle drags below, all of which route
// their preview writes through this).
function rafThrottle<A extends unknown[]>(fn: (...args: A) => void) {
  let frame: number | null = null;
  let pending: A | null = null;
  const flushNow = () => {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
    if (pending) {
      const args = pending;
      pending = null;
      fn(...args);
    }
  };
  return {
    call(...args: A) {
      pending = args;
      frame ??= requestAnimationFrame(flushNow);
    },
    // Applies the latest pending call immediately and cancels the scheduled
    // frame — call on mouseup so the drag doesn't end a frame short of the
    // actual release position.
    flush: flushNow,
    // Drops any pending call without invoking it — call on cancel, where the
    // gesture's own revert should win over one more throttled write.
    cancel() {
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      pending = null;
    },
  };
}

/** What a marquee can ask about the box it just swept. Separating this from
 *  the gesture keeps "where did the box land" in one place and "what counts
 *  as caught by it" in another — the Select tool and the Lines tool answer
 *  the second question differently and share the first. */
interface MarqueeProbe {
  inBox: (coord: LngLat) => boolean;
  pathInBox: (path: LngLat[]) => boolean;
}

type MarqueeCollector = (probe: MarqueeProbe, system: TransitSystem) => MultiSelectItem[];

function publicLineTarget(
  state: EditorState,
  target: MultiSelectItem,
  hasExplicitTerminus: boolean,
): MultiSelectItem {
  if (hasExplicitTerminus || target.kind !== 'service') return target;
  const line = lineForService(state.system, target.id);
  if (!line) return target;
  const lineIsActive =
    state.multiSelection.some((item) => item.kind === 'line' && item.id === line.id) ||
    (state.selection?.kind === 'line' && state.selection.id === line.id);
  return lineIsActive ? { kind: 'line', id: line.id } : target;
}

export interface TerminusConnectionChoice {
  x: number;
  y: number;
  connectPaths: () => void;
  joinThroughService: () => void;
  dismiss: () => void;
}

export interface AttachInteractionsOptions {
  openShortcuts: () => void;
  toggleUi: () => void;
  attachKeyboard(context: EditorKeyboardContext): () => void;
  /** True while the Diagram view is active — a schematic, read-only
   *  projection (see model/diagramLayout.ts). Gated exactly like `readOnly`
   *  below: pan/zoom still work, nothing else does, since every coordinate
   *  on screen is a distorted stand-in for the real one and must never be
   *  fed back into a store mutation. */
  isDiagramMode: () => boolean;
  /** Called with a newly-drawn facility complex's boundary — switches to the
   *  Infrastructure view (where footprints render) and fits the camera to it,
   *  so the result of drawing is immediately visible instead of requiring a
   *  manual view switch + zoom to find it. */
  focusFootprint: (footprint: LngLat[]) => void;
  /** True while the Network view is active — the Way tool there ROUTES along
   *  existing compatible infrastructure when a press lands on it (snap-to-
   *  streets line drawing) instead of laying new geometry. */
  isNetworkMode: () => boolean;
  /** Open the map's action menu at these viewport pixels. Called for a right
   *  CLICK that placed no node and finished no draw — a right DRAG still
   *  pans, so this never fires mid-gesture. */
  openContextMenu: (
    x: number,
    y: number,
    at: LngLat,
    serviceHit?: ServiceActionHit,
    corridorHit?: CorridorActionHit,
  ) => void;
  /** Dismisses the React menu as well as its imperative map anchor. */
  closeContextMenu?: () => void;
  /** The action menu keeps an exact geographic marker while it owns focus. */
  setActionAnchor?: (at: LngLat | null) => void;
  /** MapCanvas uses these exact pointer-gesture boundaries to switch from the
   *  full derived map to its one-source manipulation projection, then rebuild
   *  the settled map once on commit/cancel. Optional for non-rendering callers
   *  such as interaction unit tests. */
  onEditGestureStart?: (targets: EditGestureTargets) => void;
  onEditGestureEnd?: () => void;
  /** Pointer-down boundaries for any continuous manipulation, including
   * camera pans. Ambient rendering uses this to hold expensive derived
   * geometry on its last committed snapshot while continuous feedback keeps
   * painting, without conflating a camera move with an editable checkpoint. */
  onDirectManipulationStart?: () => void;
  onDirectManipulationEnd?: () => void;
  /** Presentation is a consumer of the exact same pure decision that pointer
   * dispatch uses. Keeping it outside this imperative controller lets React
   * render the badge without the map owning a second cursor vocabulary. */
  onPointerIntent?: (intent: PointerIntent | null, x: number, y: number) => void;
  /** Starts the selection-only UI import at the press boundary, before the
   * release commits a selection. Drawing and camera gestures do not pay it. */
  onSelectionIntent?: () => void;
  /** Presentation must remain silent while the map's action menu owns focus;
   * otherwise stationary key events can revive a stale hover beneath it. */
  isContextMenuOpen?: () => boolean;
  /** Lets view state invalidate a stationary hover without recreating the map
   * controller. The registration is optional for browser-free tests. */
  registerPointerIntentRefresh?: (refresh: () => void) => () => void;
  /** A drop on another line's terminus is deliberately inert until this
   * anchored chooser invokes one of the two callbacks. */
  openTerminusConnectionChoice?: (choice: TerminusConnectionChoice) => void;
  /** Hit, snap, and drag tolerances for this attachment (see
   * editor/input-tuning.ts). Required, and resolved by the caller: this module
   * takes numbers and asks nothing about the device, which is also why its
   * tests never need a media query to exercise either profile. */
  tuning: InputTuning;
  /** Resolves a logical renderer layer to the currently interactive physical
   * bank. Editor and transient layers return their one unchanged ID. */
  resolveQueryLayerIds?: (logicalLayerId: string) => readonly string[];
  /** Event delegation must cover both physical banks because activation does
   * not recreate this controller. */
  resolveEventLayerIds?: (logicalLayerId: string) => readonly string[];
  /** Turns a physical bank suffix back into the stable logical identity used
   * by selection and gesture dispatch. */
  logicalLayerId?: (physicalLayerId: string) => string;
  isAttachmentActive?: () => boolean;
}

export interface EditorKeyboardContext {
  readonly map: MLMap;
  readonly editor: EditorStore;
  setPanKeyHeld(held: boolean): void;
  openShortcuts(): void;
  toggleUi(): void;
}

/**
 * True when a mousedown's native `detail` marks it as the SECOND press of a
 * double-click (browsers count consecutive same-spot-and-timing clicks in
 * `detail`, resetting to 1 once they're too slow or far apart to count as
 * one gesture). The Way tool's "double-click to finish" gesture is built
 * entirely on ordinary presses: a double-click is just two normal mousedown/
 * mouseup pairs at ~the same spot, followed by a `dblclick` event. Without
 * this check, the Way tool's onMouseDown (see the "way" case below) placed a
 * point for EACH of those two presses — confirmed live: click, click,
 * double-click-to-finish produced a 3-point way whose last two points were
 * bit-identical, not the clean 2-point line it should have been. Skipping
 * the second press here (rather than deduping the point afterward) means
 * only the first one places a point; the dblclick handler right after it
 * still fires and calls finishWay() exactly as before.
 */
export function isDoubleClickFinish(detail: number): boolean {
  return detail >= 2;
}

/**
 * Wire the unified SimCity-style pointer/keyboard interactions to the store.
 * One drawing/editing path serves every way type (rail, road, bike, aerial,
 * water) — the same startDraw/handle-drag/erase family, snap-first — so
 * drawing a road behaves exactly like drawing a rail line.
 */
export function attachInteractions(
  map: MLMap,
  store: EditorStore,
  opts: AttachInteractionsOptions,
): () => void {
  const canvas = map.getCanvas();
  const commands = store.commands;
  const attachmentCleanup: Array<() => void> = [];
  let abortGestureForCleanup: (() => void) | null = null;
  const cleanupAttachmentSetup = () => {
    if (abortGestureForCleanup) {
      try {
        abortGestureForCleanup();
      } catch {
        // Listener cleanup must continue even when gesture rollback fails.
      }
      abortGestureForCleanup = null;
    }
    for (const release of attachmentCleanup.splice(0).reverse()) {
      try {
        release();
      } catch {
        // A failed cleanup cannot strand resources registered before it.
      }
    }
  };
  const attachmentRemainsActive = () => opts.isAttachmentActive?.() !== false;
  const stopIfAttachmentEnded = () => {
    if (attachmentRemainsActive()) return;
    cleanupAttachmentSetup();
    throw new Error('The editor interaction attachment ended during setup.');
  };
  const registerListener = (attach: () => void, detach: () => void) => {
    try {
      stopIfAttachmentEnded();
      attach();
      if (!attachmentRemainsActive()) {
        try {
          detach();
        } finally {
          stopIfAttachmentEnded();
        }
      }
      attachmentCleanup.push(detach);
    } catch (error) {
      cleanupAttachmentSetup();
      throw error;
    }
  };
  const registerExtension = (attach: () => (() => void) | undefined) => {
    try {
      stopIfAttachmentEnded();
      const detach = attach();
      if (detach && !attachmentRemainsActive()) {
        try {
          detach();
        } finally {
          stopIfAttachmentEnded();
        }
      }
      if (detach) attachmentCleanup.push(detach);
    } catch (error) {
      cleanupAttachmentSetup();
      throw error;
    }
  };
  // Destructured once per attachment, not read per event: swapping tolerances
  // underneath a drag already in progress would change what the gesture means
  // halfway through it.
  const { hitPx, snapPx, dragPx, freehandSamplePx, straightSnapPx } = opts.tuning;
  const queryLayerIds = (logicalLayerId: string) =>
    opts.resolveQueryLayerIds?.(logicalLayerId) ?? [logicalLayerId];
  const eventLayerIds = (logicalLayerId: string) =>
    opts.resolveEventLayerIds?.(logicalLayerId) ?? [logicalLayerId];
  const logicalLayerId = (physicalLayerId: string) =>
    opts.logicalLayerId?.(physicalLayerId) ?? physicalLayerId;
  const featureLayerId = (feature: MapGeoJSONFeature) => logicalLayerId(feature.layer.id);
  let spaceHeld = false;
  let lastPointer: MapMouseEvent | null = null;
  let lockedPrimaryOperation: PointerOperation | undefined;
  let activeTerminusSource: TerminusGestureSource | null = null;
  /**
   * Set by a gesture that already handled the current press itself, so onClick
   * doesn't act on that same press a second time.
   *
   * Scoped to ONE press, and cleared by the next mousedown rather than by the
   * click it suppresses. That distinction is the whole point: MapLibre only
   * fires `click` when the pointer stayed within its clickTolerance (3px) from
   * mousedown to mouseup, and drops the event entirely otherwise (see
   * maplibre-gl's ui/handler/map_event.ts, `click()`). Clearing this in onClick
   * alone therefore left it armed forever whenever a press moved at all — and
   * the next genuine click got swallowed instead of the one it was meant for.
   * That read as clicking to start a line and having nothing happen, seemingly
   * at random, since what actually decided it was whether your hand moved
   * three pixels.
   *
   * Every assignment below happens during a press (in onMouseDown or in that
   * press's own mousemove/mouseup handlers), so a reset at the next mousedown
   * always lands after the click this was armed for and before anything can
   * arm it again.
   */
  let suppressClick = false;
  // Sticky for the duration of one draw session (persists across the repeated
  // startDraw calls a click-click-click session makes): true when this
  // session is extending a resumed way from its FIRST point (so new nodes
  // prepend) rather than its last (the default, append).
  let activeExtendAtStart = false;

  // A facility complex's boundary being drawn click-by-click (as opposed to
  // the single-drag rectangle path, which never needs to persist state
  // between events). Null when no click-points draft is in progress.
  let facilityBoundaryDraft: LngLat[] | null = null;

  // Same, for a Station boundary being drawn click-by-click. Stops are
  // anchored boarding points; Stations are the physical passenger places that
  // own a footprint in Infrastructure view.
  let stationBoundaryDraft: LngLat[] | null = null;

  // Every pointer gesture (draw, handle-drag, extend-drag, station-drag,
  // freehand, erase) registers how to abort itself here while it's in
  // progress. Escape (see the capture-phase listener below) calls whichever
  // one is live — this is what makes Escape actually stop the operation the
  // user is mid-way through, not just a committed store-level state.
  let cancelActiveGesture: ((revert: boolean) => void) | null = null;

  const lngLatOf = (e: MapMouseEvent): LngLat => [e.lngLat.lng, e.lngLat.lat];

  // A press is classified several ways (presentation intent, then dispatch,
  // then sometimes selection), but MapLibre's rendered-feature query is the
  // expensive part and the map cannot change within one event callback. Read
  // the complete hit stack once and let each classifier apply its own layer
  // priority to that immutable result.
  const hitStackByEvent = new WeakMap<MapMouseEvent, MapGeoJSONFeature[]>();
  const hitStack = (e: MapMouseEvent): MapGeoJSONFeature[] => {
    const cached = hitStackByEvent.get(e);
    if (cached) return cached;
    const layers = HIT_TEST_LAYERS.flatMap(queryLayerIds).filter((layer) => map.getLayer(layer));
    const box: [[number, number], [number, number]] = [
      [e.point.x - hitPx, e.point.y - hitPx],
      [e.point.x + hitPx, e.point.y + hitPx],
    ];
    const features = layers.length ? map.queryRenderedFeatures(box, { layers }) : [];
    hitStackByEvent.set(e, features);
    return features;
  };

  // Pointer intent and dispatch classify the same rendered feature more than
  // once, but neither its geometry nor the event's screen point can change
  // during that callback. Retain the exact projected distance for that event
  // so repeated classifiers do not reproject every point and line segment.
  const squaredDistanceByEvent = new WeakMap<MapMouseEvent, WeakMap<MapGeoJSONFeature, number>>();
  const squaredDistance = (e: MapMouseEvent, feature: MapGeoJSONFeature): number => {
    let distances = squaredDistanceByEvent.get(e);
    if (!distances) {
      distances = new WeakMap();
      squaredDistanceByEvent.set(e, distances);
    }
    const cached = distances.get(feature);
    if (cached !== undefined) return cached;

    let distance = Infinity;
    if (feature.geometry.type === 'Point') {
      const p = map.project(feature.geometry.coordinates as [number, number]);
      distance = (p.x - e.point.x) ** 2 + (p.y - e.point.y) ** 2;
    } else if (feature.geometry.type === 'LineString') {
      const coords = feature.geometry.coordinates as [number, number][];
      for (let i = 1; i < coords.length; i++) {
        const a = map.project(coords[i - 1]);
        const z = map.project(coords[i]);
        const dx = z.x - a.x;
        const dy = z.y - a.y;
        const den = dx * dx + dy * dy;
        const t =
          den === 0
            ? 0
            : Math.max(0, Math.min(1, ((e.point.x - a.x) * dx + (e.point.y - a.y) * dy) / den));
        distance = Math.min(
          distance,
          (a.x + t * dx - e.point.x) ** 2 + (a.y + t * dy - e.point.y) ** 2,
        );
      }
    }
    distances.set(feature, distance);
    return distance;
  };

  const featureAt = (e: MapMouseEvent, layers: string[]): MapGeoJSONFeature | undefined => {
    const existingByLogicalLayer = layers.map((layer) =>
      queryLayerIds(layer).filter((candidate) => map.getLayer(candidate)),
    );
    const existing = existingByLogicalLayer.flat();
    if (!existing.length) return undefined;

    const layerOrder = new Map<string, number>();
    for (let index = 0; index < existingByLogicalLayer.length; index += 1) {
      for (const physicalLayerId of existingByLogicalLayer[index]) {
        layerOrder.set(physicalLayerId, index);
      }
    }
    const hits = hitStack(e);
    let selectedLayer = Infinity;
    for (const feature of hits) {
      const order = layerOrder.get(feature.layer.id);
      if (order !== undefined) selectedLayer = Math.min(selectedLayer, order);
    }
    if (selectedLayer === Infinity) return undefined;

    let selected: MapGeoJSONFeature | undefined;
    let selectedDistance: number | undefined;
    for (const feature of hits) {
      if (layerOrder.get(feature.layer.id) !== selectedLayer) continue;
      if (!selected) {
        selected = feature;
        continue;
      }
      selectedDistance ??= squaredDistance(e, selected);
      const candidateDistance = squaredDistance(e, feature);
      // Strictly nearer wins. Equal distances retain MapLibre's first result,
      // matching stable Array.sort without allocating and sorting candidates.
      if (candidateDistance < selectedDistance) {
        selected = feature;
        selectedDistance = candidateDistance;
      }
    }
    return selected;
  };

  const stopFeatureAt = (e: MapMouseEvent): MapGeoJSONFeature | undefined => {
    // A committed stop remains masked for the few frames in which its
    // one-feature source diff settles. Its visible gesture point must retain
    // the same hit behavior, or an immediate second drag would pan the map
    // despite showing a draggable stop under the pointer.
    const settling = featureAt(e, [LYR_GESTURE_POINT]);
    if (settling?.properties.kind === 'stop') return settling;
    return featureAt(e, [LYR_STATIONS]);
  };

  /**
   * A held key OR the Select tool's variant produces the same state, which is
   * the one place the two input paths meet. Everything downstream — the
   * resolver, the badge, the dispatch — sees a channel and cannot tell which
   * set it, so a finger reaches the Alt and Ctrl operations through the dock
   * without a second code path.
   */
  const modifierState = (event: {
    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    button?: number;
  }): ModifierState => {
    const { tool, selectVariant } = store.getState();
    // A variant only speaks for the tool it belongs to.
    const variant = tool === 'select' ? selectVariant : 'select';
    return {
      pan: spaceHeld,
      constrain: event.shiftKey === true,
      alternate: event.altKey === true || variant === 'erase',
      secondary: event.ctrlKey === true || event.metaKey === true || variant === 'split',
      actions: event.button === 2,
    };
  };

  /**
   * Shift during a live drag: the sole modifier allowed to alter a gesture
   * mid-flight, and it changes only geometry, never the verb. Read through one
   * helper so every drag loop that offers angle-snapping asks the same
   * question.
   */
  const constrainActive = (ev: { originalEvent?: { shiftKey?: boolean } }): boolean =>
    ev.originalEvent?.shiftKey === true;

  /** The one definition of a corridor a Network line may route over. Both
   * rendered-hit classification and startDraw use it, so an icon never says
   * "connect" for a way that the press will turn into new geometry instead. */
  const networkCandidates = (state: Pick<EditorState, 'system' | 'draftModeId'>) => {
    const allowed = new Set(mode(state.draftModeId).wayTypeIds);
    return state.system.ways.filter((way) => allowed.has(way.typeId));
  };

  const networkWayId = (feature: MapGeoJSONFeature | undefined): string | undefined => {
    if (!feature) return undefined;
    const wayId = feature.properties.wayId ?? feature.properties.id;
    return typeof wayId === 'string' ? wayId : undefined;
  };

  const isCompatibleNetworkWay = (
    state: Pick<EditorState, 'system' | 'draftModeId'>,
    wayId: string | undefined,
  ) => Boolean(wayId && networkCandidates(state).some((way) => way.id === wayId));

  /** Translate the rendered hit stack into the editor-level vocabulary once.
   * The resolver deliberately does not know MapLibre layer ids. */
  const pointerTargetAt = (e: MapMouseEvent): PointerTarget => {
    const state = store.getState();
    // Once a fresh way has a seed, the next hover controls its rubber-band
    // preview. Existing corridors below it are no longer a route-start target.
    if (opts.isNetworkMode() && state.tool === 'way' && state.activeWayId) return 'empty';
    if (opts.isNetworkMode() && state.tool === 'way' && networkOpenEndpointAt(e))
      return state.routeDraft ? 'compatible-corridor' : 'endpoint';
    const serviceTerminus = featureAt(e, [LYR_SERVICE_TERMINI_HIT]);
    if (serviceTerminus) {
      const armed = state.armedTerminus;
      if (
        armed &&
        armed.serviceId === serviceTerminus.properties.serviceId &&
        armed.patternId === serviceTerminus.properties.patternId &&
        armed.side === serviceTerminus.properties.side
      )
        return 'return-terminus';
      if (activeTerminusSource) {
        const targetService = state.system.services.find(
          (service) => service.id === serviceTerminus.properties.serviceId,
        );
        const sourceService = state.system.services.find(
          (service) => service.id === activeTerminusSource?.serviceId,
        );
        if (targetService && sourceService)
          return targetService.modeId === sourceService.modeId
            ? 'same-mode-line'
            : 'different-mode-line';
      }
      return 'service-terminus';
    }
    const endpoint = featureAt(e, [LYR_WAY_ENDPOINTS]);
    if (endpoint) return 'endpoint';
    const handle = featureAt(e, [LYR_HANDLES]);
    if (handle) {
      const wayId = handle.properties.wayId as string;
      const index = handle.properties.index as number;
      const pointCount = store.getState().system.ways.find((way) => way.id === wayId)
        ?.points.length;
      return index === 0 || (pointCount !== undefined && index === pointCount - 1)
        ? 'endpoint'
        : 'interior-point';
    }
    if (featureAt(e, [LYR_PHYSICAL_HANDLES])) return 'control-point';
    if (stopFeatureAt(e)) return 'stop';
    if (featureAt(e, [LYR_FACILITIES])) return 'facility';
    const serviceLine = featureAt(e, SERVICE_LAYERS);
    const wayLine = featureAt(e, WAY_LAYERS);
    if (!serviceLine && !wayLine) {
      // The endpoint ring has a larger snap radius than a rendered stroke.
      // It is still a real route/resume target, so classify it with the same
      // candidates startDraw will inspect rather than advertising a new line.
      if (opts.isNetworkMode() && state.tool === 'way' && networkRouteAnchorAt(e) !== null)
        return 'compatible-corridor';
      return 'empty';
    }
    if (opts.isNetworkMode() && state.tool === 'select') {
      if (activeTerminusSource && serviceLine) {
        const serviceId = serviceLine.properties.serviceId as string;
        const patternId = serviceLine.properties.patternId as string;
        if (
          serviceId === activeTerminusSource.serviceId &&
          patternId === activeTerminusSource.patternId
        )
          return 'same-branch-interior';
        const sourceMode = state.system.services.find(
          (service) => service.id === activeTerminusSource?.serviceId,
        )?.modeId;
        const targetMode = state.system.services.find(
          (service) => service.id === serviceId,
        )?.modeId;
        return sourceMode === targetMode ? 'same-mode-line' : 'different-mode-line';
      }
      return 'line-body';
    }
    if (opts.isNetworkMode() && state.tool === 'way') {
      // Service paint sits above its carrier. Its feature retains `wayId`, so
      // use that exact carrier rather than treating a colored overlay as an
      // unrelated line body or guessing from whatever layer drew first.
      const wayId = networkWayId(serviceLine) ?? networkWayId(wayLine);
      return isCompatibleNetworkWay(state, wayId) ? 'compatible-corridor' : 'empty';
    }
    return 'corridor';
  };

  const intentAt = (
    e: MapMouseEvent,
    modifierOverride?: ModifierState,
    gestureActive = lockedPrimaryOperation !== undefined,
  ): PointerIntent => {
    const state = store.getState();
    // Demolish has one verb and isn't part of resolvePointerIntent's
    // Select/Way/Station/Facility vocabulary (route-service, corridor-
    // splitting, station/facility drag…) — short-circuit before that
    // function ever sees the tool, rather than widening its closed union
    // for a single unrelated case.
    if (state.tool === 'demolish') {
      return {
        primaryOperation: 'default',
        cursor: 'crosshair',
        badge: null,
        allowed: !state.readOnly && !opts.isNetworkMode(),
        anchor: 'none',
        constraint: 'none',
      };
    }
    const view: PointerIntentInput['view'] = opts.isDiagramMode()
      ? 'diagram'
      : opts.isNetworkMode()
        ? 'network'
        : 'infrastructure';
    return resolvePointerIntent({
      view,
      tool: state.tool,
      target: pointerTargetAt(e),
      modifiers: modifierOverride ?? modifierState(e.originalEvent),
      readOnly: state.readOnly,
      armed: activeTerminusSource
        ? activeTerminusSource.purpose === 'return'
          ? 'network-return'
          : 'network-extending'
        : state.armedTerminus
          ? 'network-return'
          : 'none',
      gestureActive,
      lockedPrimaryOperation,
      routeDraftActive: Boolean(state.routeDraft),
    });
  };

  const publishPointerIntent = (
    e: MapMouseEvent,
    modifierOverride?: ModifierState,
    gestureActive?: boolean,
  ): PointerIntent => {
    lastPointer = e;
    const pointerIntent = intentAt(e, modifierOverride, gestureActive);
    if (opts.isContextMenuOpen?.()) {
      clearPointerIntent();
      return pointerIntent;
    }
    canvas.style.cursor = pointerIntent.cursor;
    opts.onPointerIntent?.(pointerIntent, e.originalEvent.clientX, e.originalEvent.clientY);
    return pointerIntent;
  };

  const clearPointerIntent = () => opts.onPointerIntent?.(null, 0, 0);
  const refreshPointerIntent = () => {
    if (lastPointer) publishPointerIntent(lastPointer, undefined, false);
    else clearPointerIntent();
  };

  const metersPerPixel = () =>
    (156543.03392 * Math.cos((map.getCenter().lat * Math.PI) / 180)) / 2 ** map.getZoom();

  /**
   * Snapping tolerance in metres — a screen distance, but never more than a
   * real one.
   *
   * A pixel tolerance alone keeps snapping feeling the same at every zoom,
   * which is why it is expressed that way. Unbounded, though, it stops meaning
   * anything: at a zoom that fits a metropolitan area on screen one pixel is
   * over a hundred metres, so an eighteen-pixel radius reaches two kilometres
   * and every press lands on whatever line is nearest. Drawing a second line
   * along an existing one resumed the existing one instead, from most of a
   * kilometre away.
   *
   * The ceiling is a claim about the world rather than about the screen: past
   * this, two things are different places and the user meant the empty ground
   * they clicked. Well under the 90 m at which two stops start counting as one
   * interchange, and well over the width of any street.
   */
  const MAX_SNAP_M = 50;
  const snapMeters = (px: number) => Math.min(px * metersPerPixel(), MAX_SNAP_M);

  const networkRouteAnchorAt = (e: MapMouseEvent): LngLat | null => {
    const hit = snap(networkCandidates(store.getState()), lngLatOf(e), snapMeters(snapPx));
    return hit?.coord ?? null;
  };

  const networkOpenEndpointAt = (e: MapMouseEvent) =>
    nearestOpenEndpoint(networkCandidates(store.getState()), lngLatOf(e), snapMeters(snapPx));

  // ---- pan (right-drag or space+left-drag) --------------------------------
  // Not part of the cancel system: it never mutates the system, so there's
  // nothing for Escape to undo — releasing the mouse already ends it.
  const startPan = (e: MapMouseEvent, rightButton: boolean) => {
    opts.onDirectManipulationStart?.();
    let last = e.point;
    let moved = false;
    canvas.style.cursor = 'grabbing';
    // Accumulate raw deltas and issue one panBy per animation frame (same
    // idiom as startGroupDrag's nudge accumulator below) — panBy re-renders
    // every layer in the whole style, so calling it once per raw mousemove
    // (which can fire far faster than the map can paint) starved MapLibre's
    // own render/tile pipeline badly enough to blank the map mid-drag, not
    // just lag it.
    let pendingDx = 0;
    let pendingDy = 0;
    let frame: number | null = null;
    const flush = () => {
      frame = null;
      if (pendingDx === 0 && pendingDy === 0) return;
      map.panBy([pendingDx, pendingDy], { duration: 0 });
      pendingDx = 0;
      pendingDy = 0;
    };
    const onMove = (ev: MapMouseEvent) => {
      if (Math.hypot(ev.point.x - last.x, ev.point.y - last.y) > 1) moved = true;
      pendingDx += last.x - ev.point.x;
      pendingDy += last.y - ev.point.y;
      last = ev.point;
      if (frame === null) frame = requestAnimationFrame(flush);
    };
    const onUp = (ev: MapMouseEvent) => {
      if (frame !== null) cancelAnimationFrame(frame);
      flush();
      map.off('mousemove', onMove);
      canvas.style.cursor = cursorFor();
      opts.onDirectManipulationEnd?.();
      if (rightButton && !moved) {
        const st = store.getState();
        // Way tool, right-click ON an open endpoint: branch a NEW one-way
        // segment off it — the couplet gesture. Inherits the street's
        // cross-section and name; travel runs the direction you now draw.
        if (
          st.tool === 'way' &&
          !st.readOnly &&
          !opts.isDiagramMode() &&
          !st.activeWayId &&
          !st.routeDraft
        ) {
          const hit = nearestOpenEndpoint(st.system.ways, lngLatOf(ev), snapMeters(snapPx));
          if (hit) {
            commands.ways.beginOneWayBranch(hit.wayId, hit.end);
            return;
          }
        }
        // Otherwise a plain right-click finishes the current draw — a live
        // route draft (snap-to-streets) as well as a way draw, so right-click
        // never leaves a draft hanging (a stuck draft would swallow every
        // later press and read as "drawing is broken").
        if (st.routeDraft) commands.routing.commitRouteDraft();
        else if (st.activeWayId) commands.ways.finishWay();
        else openMenuAt(ev);
      }
    };
    map.on('mousemove', onMove);
    map.once('mouseup', onUp);
  };

  // ---- dragging an existing thing -----------------------------------------
  const startHandleDrag = (feature: MapGeoJSONFeature) => {
    suppressClick = true;
    const wayId = feature.properties.wayId as string;
    const index = feature.properties.index as number;
    const original = wayPointAt(wayId, index);
    let moved = false;
    const throttled = rafThrottle((c: LngLat) => commands.ways.moveWayPoint(wayId, index, c));
    const onMove = (ev: MapMouseEvent) => {
      moved = true;
      let c = lngLatOf(ev);
      // The pointer-down verb is already locked to moving this point. Shift is
      // the sole modifier permitted to alter it mid-drag, and only changes the
      // geometric constraint — Alt/Ctrl/Cmd cannot turn the drag into erase/
      // split/extend after its start.
      if (constrainActive(ev)) c = constrainToNeighbor(wayId, index, c);
      throttled.call(c);
    };
    const onUp = () => {
      throttled.flush();
      endGesture();
      map.off('mousemove', onMove);
      if (moved) {
        // Dragging a point across another same-type, same-grade way forms a
        // real junction there, same as finishing a draw does.
        commands.network.formCrossingJunctions(wayId);
      } else {
        commands.selection.select({ kind: 'way', id: wayId });
      }
    };
    map.on('mousemove', onMove);
    map.once('mouseup', onUp);
    beginGesture(
      (revert) => {
        throttled.cancel();
        map.off('mousemove', onMove);
        map.off('mouseup', onUp);
        if (revert && original) commands.ways.moveWayPoint(wayId, index, original);
      },
      { wayPoints: [{ wayId, pointIndex: index }] },
    );
  };

  // Ctrl/Cmd-dragging a way's OPEN END (LYR_WAY_ENDPOINTS, not a regular
  // handle) extends it with a new point in the direction you drag — the
  // literal "grab the end and pull" gesture. A PLAIN drag on the same end
  // just reshapes it in place instead (see startHandleDrag, called for
  // endpoints too now) — extending got demoted to a modifier because it was
  // the only way to nudge an end without also growing the way, which is the
  // less common of the two intents. A plain click (no drag) just selects the
  // way, same as a regular handle.
  const startExtendDrag = (feature: MapGeoJSONFeature) => {
    suppressClick = true;
    const wayId = feature.properties.wayId as string;
    const atStart = (feature.properties.index as number) === 0;
    let dragged = false;
    // Same resolveEnd the release below commits with — see previewEnd.
    const previewThrottle = rafThrottle((raw: LngLat, shiftKey: boolean) => {
      previewEnd(wayId, atStart, raw, shiftKey);
    });
    const onMove = (ev: MapMouseEvent) => {
      dragged = true;
      previewThrottle.call(lngLatOf(ev), constrainActive(ev));
    };
    const onUp = (ev: MapMouseEvent) => {
      previewThrottle.cancel();
      endGesture();
      map.off('mousemove', onMove);
      clearPreviews();
      if (dragged) {
        placeEnd(wayId, atStart, resolveEnd(wayId, atStart, lngLatOf(ev), constrainActive(ev)));
        // Pulling an end across another same-grade way forms a real junction
        // there, same as finishing a draw does.
        commands.network.formCrossingJunctions(wayId);
      } else {
        commands.selection.select({ kind: 'way', id: wayId });
      }
    };
    map.on('mousemove', onMove);
    map.once('mouseup', onUp);
    beginGesture(() => {
      previewThrottle.cancel();
      map.off('mousemove', onMove);
      map.off('mouseup', onUp);
      clearPreviews(); // nothing committed yet — cancel just drops the drag
    });
  };

  const startStopDrag = (id: string) => {
    suppressClick = true;
    const st0 = store.getState().system.stops.find((s) => s.id === id);
    const originalCoord = st0?.coord;
    const originalAnchor = st0 ? primaryAnchor(st0) : undefined;
    let moved = false;
    const throttled = rafThrottle((c: LngLat) => placeOrSnapStop(id, c));
    const onMove = (ev: MapMouseEvent) => {
      moved = true;
      throttled.call(lngLatOf(ev));
    };
    const onUp = () => {
      throttled.flush();
      endGesture();
      map.off('mousemove', onMove);
      if (!moved) commands.selection.select({ kind: 'stop', id });
    };
    map.on('mousemove', onMove);
    map.once('mouseup', onUp);
    beginGesture(
      (revert) => {
        throttled.cancel();
        map.off('mousemove', onMove);
        map.off('mouseup', onUp);
        if (revert && originalCoord) commands.stops.moveStop(id, originalCoord, originalAnchor);
      },
      { stopIds: [id] },
    );
  };

  const startFacilityDrag = (id: string) => {
    suppressClick = true;
    const original = store.getState().system.facilities.find((f) => f.id === id)?.geometry;
    let moved = false;
    const throttled = rafThrottle((c: LngLat) => commands.facilities.moveFacility(id, c));
    const onMove = (ev: MapMouseEvent) => {
      moved = true;
      throttled.call(lngLatOf(ev));
    };
    const onUp = () => {
      throttled.flush();
      endGesture();
      map.off('mousemove', onMove);
      if (!moved) commands.selection.select({ kind: 'facility', id });
    };
    map.on('mousemove', onMove);
    map.once('mouseup', onUp);
    beginGesture(
      (revert) => {
        throttled.cancel();
        map.off('mousemove', onMove);
        map.off('mouseup', onUp);
        if (revert && original && !Array.isArray(original[0]))
          commands.facilities.moveFacility(id, original as LngLat);
      },
      { facilityIds: [id] },
    );
  };

  // The 4 open corners of an axis-aligned (true north/east) rectangle between
  // two opposite corners — the fast-path for a facility complex's boundary.
  // Stored OPEN (no repeated closing point), matching squareFootprint's own
  // convention — layers.ts's closeRing() closes it only at render time.
  function rectCorners(a: LngLat, b: LngLat): LngLat[] {
    return [
      [a[0], a[1]],
      [b[0], a[1]],
      [b[0], b[1]],
      [a[0], b[1]],
    ];
  }
  // Same points with the first repeated at the end — for the live preview
  // line only, so the rubber-band reads as a closed loop while drawing.
  function closedForPreview(points: LngLat[]): LngLat[] {
    return points.length > 0 ? [...points, points[0]] : points;
  }

  const cancelFacilityBoundaryDraft = () => {
    facilityBoundaryDraft = null;
    clearPreviews();
  };

  const finishFacilityBoundaryDraft = () => {
    const draft = facilityBoundaryDraft;
    facilityBoundaryDraft = null;
    clearPreviews();
    if (!draft || draft.length < 3) return; // need at least a triangle for a real region
    commands.groups.createFacilityComplex(draft);
    opts.focusFootprint(draft);
  };

  // Facility tool, pressing on empty space (not an existing facility marker,
  // not armed for "place inside"): a drag draws an axis-aligned rectangle and
  // creates the complex immediately on release; a plain click instead seeds a
  // click-points boundary (any shape, any angle — closed via double-click/
  // Enter, see onDblClick/keymap) so a region can be drawn to any orientation,
  // not just north-up. Either way, a real boundary is now REQUIRED to create
  // a complex — there's no more silent default-sized invisible square.
  const startFacilityBoundary = (e: MapMouseEvent) => {
    const startCoord = lngLatOf(e);

    if (facilityBoundaryDraft) {
      // Continuing an already-seeded click-points polygon.
      facilityBoundaryDraft.push(startCoord);
      setPreview(closedForPreview(facilityBoundaryDraft));
      suppressClick = true;
      return;
    }

    const startPt = e.point;
    let dragged = false;
    const previewThrottle = rafThrottle((c: LngLat) =>
      setPreview(closedForPreview(rectCorners(startCoord, c))),
    );
    const onMove = (ev: MapMouseEvent) => {
      if (Math.hypot(ev.point.x - startPt.x, ev.point.y - startPt.y) >= dragPx) dragged = true;
      if (dragged) previewThrottle.call(lngLatOf(ev));
    };
    const onUp = (ev: MapMouseEvent) => {
      previewThrottle.cancel();
      map.off('mousemove', onMove);
      if (dragged) {
        const corners = rectCorners(startCoord, lngLatOf(ev));
        clearPreviews();
        commands.groups.createFacilityComplex(corners);
        opts.focusFootprint(corners);
      } else {
        facilityBoundaryDraft = [startCoord];
        setPreview([startCoord, startCoord]);
      }
      suppressClick = true;
    };
    map.on('mousemove', onMove);
    map.once('mouseup', onUp);
  };

  const cancelStationBoundaryDraft = () => {
    stationBoundaryDraft = null;
    clearPreviews();
  };

  const finishStationBoundaryDraft = () => {
    const draft = stationBoundaryDraft;
    stationBoundaryDraft = null;
    clearPreviews();
    if (!draft || draft.length < 3) return; // a border needs at least a triangle
    commands.stations.addDrawnStation(draft);
    opts.focusFootprint(draft);
  };

  // The Stop tool means different things in the two views: Infrastructure
  // draws a physical Station boundary; Network places an anchored Stop.
  const startStationBoundaryDraw = (e: MapMouseEvent, allowClickPoints: boolean) => {
    const startCoord = lngLatOf(e);

    if (stationBoundaryDraft) {
      stationBoundaryDraft.push(startCoord);
      setPreview(closedForPreview(stationBoundaryDraft));
      suppressClick = true;
      return;
    }

    const startPt = e.point;
    let dragged = false;
    const previewThrottle = rafThrottle((c: LngLat) =>
      setPreview(closedForPreview(rectCorners(startCoord, c))),
    );
    const onMove = (ev: MapMouseEvent) => {
      if (Math.hypot(ev.point.x - startPt.x, ev.point.y - startPt.y) >= dragPx) dragged = true;
      if (dragged) previewThrottle.call(lngLatOf(ev));
    };
    const onUp = (ev: MapMouseEvent) => {
      previewThrottle.cancel();
      map.off('mousemove', onMove);
      if (dragged) {
        clearPreviews();
        if (allowClickPoints) {
          const corners = rectCorners(startCoord, lngLatOf(ev));
          commands.stations.addDrawnStation(corners);
          opts.focusFootprint(corners);
        } else {
          const coord = lngLatOf(ev);
          const system = store.getState().system;
          const snapped = snap(system.ways, coord, snapMeters(snapPx));
          if (snapped)
            commands.stops.addStop(snapped.coord, { wayId: snapped.wayId, t: snapped.t });
          else commands.stops.addStop(coord);
        }
        suppressClick = true;
      } else if (allowClickPoints) {
        // Seed a click-points border, same grammar as site boundaries.
        stationBoundaryDraft = [startCoord];
        setPreview([startCoord, startCoord]);
        suppressClick = true;
      }
      // No drag + no click-points (Network view): leave the click alone so
      // onClick places the schematic stop.
    };
    map.on('mousemove', onMove);
    map.once('mouseup', onUp);
  };

  // Facility tool, AREA kind selected (building, platform, bus bay, …):
  // DRAG draws the structure's real shape as a rectangle — structures are
  // drawn things, never just points. A plain click still drops a default
  // square (see onClick) to reshape.
  const startStructureDraw = (e: MapMouseEvent) => {
    const startCoord = lngLatOf(e);
    const startPt = e.point;
    let dragged = false;
    const previewThrottle = rafThrottle((c: LngLat) =>
      setPreview(closedForPreview(rectCorners(startCoord, c))),
    );
    const onMove = (ev: MapMouseEvent) => {
      if (Math.hypot(ev.point.x - startPt.x, ev.point.y - startPt.y) >= dragPx) dragged = true;
      if (dragged) previewThrottle.call(lngLatOf(ev));
    };
    const onUp = (ev: MapMouseEvent) => {
      previewThrottle.cancel();
      map.off('mousemove', onMove);
      if (dragged) {
        clearPreviews();
        const st = store.getState();
        const corners = rectCorners(startCoord, lngLatOf(ev));
        commands.facilities.addFacility(st.draftFacilityTypeId, corners);
        opts.focusFootprint(corners);
        suppressClick = true;
      }
    };
    map.on('mousemove', onMove);
    map.once('mouseup', onUp);
  };

  // Dragging any handle/station/facility that's part of a 2+ multi-select
  // group moves the WHOLE group together by the cumulative pointer delta —
  // "nudge this whole line" without redrawing it point by point. Applied as
  // incremental per-frame deltas (not absolute positions, unlike a single
  // handle drag) since there's no single "the point" to snap to the cursor.
  const startGroupDrag = (e: MapMouseEvent) => {
    suppressClick = true;
    let last = lngLatOf(e);
    let totalDx = 0;
    let totalDy = 0;
    let pendingDx = 0;
    let pendingDy = 0;
    let frame: number | null = null;
    const flush = () => {
      frame = null;
      if (pendingDx === 0 && pendingDy === 0) return;
      commands.selection.nudgeMultiSelection(pendingDx, pendingDy);
      pendingDx = 0;
      pendingDy = 0;
    };
    const onMove = (ev: MapMouseEvent) => {
      const c = lngLatOf(ev);
      const dx = c[0] - last[0];
      const dy = c[1] - last[1];
      pendingDx += dx;
      pendingDy += dy;
      totalDx += dx;
      totalDy += dy;
      last = c;
      if (frame === null) frame = requestAnimationFrame(flush);
    };
    const onUp = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      flush();
      endGesture();
      map.off('mousemove', onMove);
    };
    map.on('mousemove', onMove);
    map.once('mouseup', onUp);
    const selected = store.getState().multiSelection;
    beginGesture(
      (revert) => {
        map.off('mousemove', onMove);
        map.off('mouseup', onUp);
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
        if (revert) {
          flush(); // apply whatever had not flushed, so `total` matches the store
          if (totalDx !== 0 || totalDy !== 0)
            commands.selection.nudgeMultiSelection(-totalDx, -totalDy);
        } else {
          pendingDx = 0;
          pendingDy = 0;
        }
      },
      {
        wayIds: selected.filter((item) => item.kind === 'way').map((item) => item.id),
        stationIds: selected.filter((item) => item.kind === 'station').map((item) => item.id),
        facilityIds: selected.filter((item) => item.kind === 'facility').map((item) => item.id),
      },
    );
  };

  // True once 2+ items are multi-selected AND this one is among them — the
  // gate that routes a drag to startGroupDrag instead of the normal
  // single-item gesture. A lone Shift-clicked item still drags normally.
  const isGroupMember = (kind: MultiSelectItem['kind'], id: string): boolean => {
    const items = store.getState().multiSelection;
    return items.length > 1 && items.some((i) => i.kind === kind && i.id === id);
  };

  // Drag a station footprint/platform or a group (facility-complex) footprint
  // vertex to reshape it — the same plain reshape gesture as a way's interior
  // handle, just targeting that owner's own physical geometry instead.
  const startPhysicalHandleDrag = (feature: MapGeoJSONFeature) => {
    suppressClick = true;
    const kind = feature.properties.kind as 'footprint' | 'platform' | 'groupFootprint';
    const index = feature.properties.index as number;

    if (kind === 'groupFootprint') {
      const groupId = feature.properties.groupId as string;
      const group = store.getState().system.groups.find((g) => g.id === groupId);
      const original = group?.footprint?.[index];
      const apply = (coord: LngLat) =>
        commands.groups.moveGroupFootprintPoint(groupId, index, coord);
      let moved = false;
      const throttled = rafThrottle(apply);
      const onMove = (ev: MapMouseEvent) => {
        moved = true;
        throttled.call(lngLatOf(ev));
      };
      const onUp = () => {
        throttled.flush();
        endGesture();
        map.off('mousemove', onMove);
        if (!moved) commands.selection.select({ kind: 'group', id: groupId });
      };
      map.on('mousemove', onMove);
      map.once('mouseup', onUp);
      beginGesture(
        (revert) => {
          throttled.cancel();
          map.off('mousemove', onMove);
          map.off('mouseup', onUp);
          if (revert && original) apply(original);
        },
        { groupIds: [groupId] },
      );
      return;
    }

    const stationId = feature.properties.stationId as string;
    const platformId = feature.properties.platformId as string | undefined;
    const station = store.getState().system.stations.find((s) => s.id === stationId);
    const original =
      kind === 'footprint'
        ? station?.footprint?.[index]
        : station?.platforms?.find((p) => p.id === platformId)?.points[index];
    const apply = (coord: LngLat) => {
      if (kind === 'footprint') commands.stations.moveFootprintPoint(stationId, index, coord);
      else if (platformId) commands.stations.movePlatformPoint(stationId, platformId, index, coord);
    };
    let moved = false;
    const throttled = rafThrottle(apply);
    const onMove = (ev: MapMouseEvent) => {
      moved = true;
      throttled.call(lngLatOf(ev));
    };
    const onUp = () => {
      throttled.flush();
      endGesture();
      map.off('mousemove', onMove);
      if (!moved) commands.selection.select({ kind: 'station', id: stationId });
    };
    map.on('mousemove', onMove);
    map.once('mouseup', onUp);
    beginGesture(
      (revert) => {
        throttled.cancel();
        map.off('mousemove', onMove);
        map.off('mouseup', onUp);
        if (revert && original) apply(original);
      },
      { stationIds: [stationId] },
    );
  };

  /**
   * The stretches of existing infrastructure this stroke will be absorbed onto
   * if it commits now.
   *
   * Drawing a line that runs along a street rebinds it onto that street on
   * commit (see finishWay). Without showing it first, the line jumps onto the
   * street the moment you press Enter and nothing warned you — a preview has
   * to say what the commit will do.
   */
  const setSharingPreview = (runs: LngLat[][], color: string) => {
    map.getSource<GeoJSONSource>(SRC_SHARING)?.setData({
      type: 'FeatureCollection',
      features: runs
        .filter((coords) => coords.length >= 2)
        .map((coords) => ({
          type: 'Feature',
          properties: { color },
          geometry: { type: 'LineString', coordinates: coords },
        })),
    });
  };

  /** What the stroke so far would share, resolved the SAME way finishWay
   *  resolves it — same matcher, same mode tolerance, same candidate filter —
   *  so the preview cannot promise something the commit won't do. */
  const sharingRunsFor = (points: LngLat[]): LngLat[][] => {
    const st = store.getState();
    if (st.draftSeparate || points.length < 2) return [];
    const modeSpec = mode(st.draftModeId);
    const allowed = new Set(modeSpec.wayTypeIds);
    const candidates = st.system.ways.filter(
      (w) => allowed.has(w.typeId) && w.id !== st.activeWayId,
    );
    if (candidates.length === 0) return [];
    const toleranceM = modeSpec.corridorToleranceM ?? CONFLATION_TOLERANCE_M;
    const dense = densifyForMatching(points, toleranceM);
    return detectShapeRuns(dense, candidates, { toleranceM })
      .filter((run): run is Extract<ShapeRun, { onWayId: string }> => !('fresh' in run))
      .map((run) => dense.slice(run.fromIdx, run.toIdx + 1));
  };

  /** Both preview overlays go together: the highlight only ever means
   *  something alongside the rubber band that produced it. */
  const clearPreviews = () => {
    setPreview(null);
    setSharingPreview([], store.getState().draftColor);
  };

  interface PreviewProperties {
    oneWayReturn?: boolean;
    /** Styles this preview stretch in the same warning colour as a
     *  wrong-way service span — what the Demolish tool's drag is currently
     *  about to remove. */
    demolish?: boolean;
  }

  const setPreview = (coords: LngLat[] | null, properties: PreviewProperties = {}) => {
    map.getSource<GeoJSONSource>(SRC_PREVIEW)?.setData({
      type: 'FeatureCollection',
      features: coords
        ? [
            {
              type: 'Feature',
              properties,
              geometry: { type: 'LineString', coordinates: coords },
            },
          ]
        : [],
    });
  };

  // See onHoverMove: the "clicking here resumes/extends this way" ring,
  // shown at an open endpoint the Way tool is currently hovering near.
  const setEndpointHint = (coord: LngLat | null) => {
    map.getSource<GeoJSONSource>(SRC_ENDPOINT_HINT)?.setData({
      type: 'FeatureCollection',
      features: coord
        ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: coord } }]
        : [],
    });
  };

  const setMarquee = (from: ScreenPoint, to: ScreenPoint) => {
    const corners: LngLat[] = [
      [from.x, from.y],
      [to.x, from.y],
      [to.x, to.y],
      [from.x, to.y],
    ].map((p) => {
      const ll = map.unproject(p as [number, number]);
      return [ll.lng, ll.lat];
    });
    map.getSource<GeoJSONSource>(SRC_MARQUEE)?.setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: [[...corners, corners[0]]] },
        },
      ],
    });
  };
  const clearMarquee = () => {
    map.getSource<GeoJSONSource>(SRC_MARQUEE)?.setData({
      type: 'FeatureCollection',
      features: [],
    });
  };

  // Shift-drag on truly empty space (nothing else under the cursor) rubber-
  // bands a selection box — everything in it joins multiSelection at once,
  // instead of Shift-clicking one thing at a time. Additive (addMultiSelect,
  // not toggle) to match the rest of this app's Shift = "add" convention.
  // Screen corners are unprojected individually (not just min/max'd in
  // screen space) so this stays correct even if the map ever gains rotation
  // — it doesn't today, but this way nothing here silently assumes it never
  // will.
  /** Everything physical the box touched — the Select tool's own marquee. */
  const collectInfrastructure: MarqueeCollector = ({ inBox, pathInBox }, system) => {
    const items: MultiSelectItem[] = [];
    for (const w of system.ways)
      if (pathInBox(resolveWayPath(w))) items.push({ kind: 'way', id: w.id });
    for (const s of system.stations) if (inBox(s.coord)) items.push({ kind: 'station', id: s.id });
    for (const f of system.facilities) {
      const coord = Array.isArray(f.geometry[0])
        ? (f.geometry as LngLat[])[0]
        : (f.geometry as LngLat);
      if (inBox(coord)) items.push({ kind: 'facility', id: f.id });
    }
    return items;
  };

  /** Every LINE the box touched and nothing else — the Lines tool's marquee.
   *  A box dragged over one boulevard covers the street and every service on
   *  it; which of those you meant is what picking up the tool already said,
   *  so nothing here has to guess. */
  const collectLines: MarqueeCollector = ({ pathInBox }, system) => {
    const items: MultiSelectItem[] = [];
    const servicesById = new Map(system.services.map((service) => [service.id, service]));
    for (const line of system.lines) {
      const touched = line.serviceIds.some((serviceId) => {
        const service = servicesById.get(serviceId);
        return !!service && pathInBox(patternPath(system.ways, servicePattern(service)));
      });
      if (touched) items.push({ kind: 'line', id: line.id });
    }
    return items;
  };

  const startMarqueeSelect = (e: MapMouseEvent, collect: MarqueeCollector) => {
    suppressClick = true;
    const startPt = e.point;
    let dragged = false;
    const marqueeThrottle = rafThrottle((pt: ScreenPoint) => setMarquee(startPt, pt));
    const onMove = (ev: MapMouseEvent) => {
      dragged = true;
      marqueeThrottle.call(ev.point);
    };
    const onUp = (ev: MapMouseEvent) => {
      marqueeThrottle.cancel();
      map.off('mousemove', onMove);
      clearMarquee();
      if (!dragged) return; // a Shift-click on empty space stays a no-op
      const endPt = ev.point;
      const corners = [
        startPt,
        { x: endPt.x, y: startPt.y },
        endPt,
        { x: startPt.x, y: endPt.y },
      ].map((p) => map.unproject([p.x, p.y]));
      let minLng = Infinity,
        minLat = Infinity,
        maxLng = -Infinity,
        maxLat = -Infinity;
      for (const c of corners) {
        if (c.lng < minLng) minLng = c.lng;
        if (c.lng > maxLng) maxLng = c.lng;
        if (c.lat < minLat) minLat = c.lat;
        if (c.lat > maxLat) maxLat = c.lat;
      }
      const inBox = (c: LngLat) =>
        c[0] >= minLng && c[0] <= maxLng && c[1] >= minLat && c[1] <= maxLat;
      // A way is "in the box" if the box touches its rendered path anywhere —
      // not just at a sampled point. Checking only resolveWayPath's own
      // points misses a long straight way whose two endpoints both sit
      // outside the box while the segment between them cuts straight through
      // it, which is exactly the common case for a short marquee over a long
      // line.
      const pathInBox = (path: LngLat[]): boolean => {
        for (let i = 0; i < path.length; i++) {
          if (inBox(path[i])) return true;
          if (i > 0 && segmentIntersectsBox(path[i - 1], path[i], minLng, minLat, maxLng, maxLat))
            return true;
        }
        return false;
      };
      const st = store.getState();
      const items = collect({ inBox, pathInBox }, st.system);
      if (items.length > 0) commands.selection.addMultiSelection(items);
    };
    map.on('mousemove', onMove);
    map.once('mouseup', onUp);
  };

  const wayPointAt = (wayId: string, index: number): LngLat | null => {
    const w = store.getState().system.ways.find((x) => x.id === wayId);
    return w?.points[index] ?? null;
  };

  // The end of the way a new node is added relative to: its last point
  // normally, or its first point when extending a resumed way backwards.
  const wayEndpoint = (wayId: string, atStart: boolean): LngLat | null => {
    const w = store.getState().system.ways.find((x) => x.id === wayId);
    if (!w || w.points.length === 0) return null;
    return atStart ? w.points[0] : w.points[w.points.length - 1];
  };

  // The point just behind the endpoint — the way's current heading, used to
  // let an extension continue straight along it. Null until there are ≥2
  // points (no heading exists yet for a single-point way).
  const wayHeadingAnchor = (wayId: string, atStart: boolean): LngLat | null => {
    const w = store.getState().system.ways.find((x) => x.id === wayId);
    if (!w || w.points.length < 2) return null;
    return atStart ? w.points[1] : w.points[w.points.length - 2];
  };

  // The vertex closing this way's own loop: the endpoint OPPOSITE the one
  // currently being extended (if extending from the start, that's the way's
  // end, and vice versa). Only offered once there are enough committed
  // points that closing back onto it forms a real loop instead of doubling
  // back between two adjacent clicks — 3 raw control points means the ring
  // closed by a 4th coincident point has 3 distinct vertices, the smallest
  // shape that means anything.
  const OWN_LOOP_MIN_POINTS = 3;
  const ownLoopCloseTarget = (wayId: string, atStart: boolean): LngLat | null => {
    const w = store.getState().system.ways.find((x) => x.id === wayId);
    if (!w || w.points.length < OWN_LOOP_MIN_POINTS) return null;
    return atStart ? w.points[w.points.length - 1] : w.points[0];
  };

  // Freehand: sample the drag path into a way (freeform geometry only).
  // Coarse sampling keeps it smooth without dumping hundreds of points.
  const startFreehand = (e: MapMouseEvent) => {
    const startPt = e.point;
    const startCoord = lngLatOf(e);
    let started = false;
    let wayId = '';
    let lastPt = startPt;
    const moveThrottle = rafThrottle((ev: MapMouseEvent) => {
      if (!started) {
        if (Math.hypot(ev.point.x - startPt.x, ev.point.y - startPt.y) < dragPx) return;
        const st = store.getState();
        const createdWayId = commands.ways.beginWay(st.draftWayTypeId, 'freeform');
        if (createdWayId === null) return;
        wayId = createdWayId;
        started = true;
        suppressClick = true;
        commands.ways.addWayPoint(wayId, startCoord);
        lastPt = startPt;
      }
      if (Math.hypot(ev.point.x - lastPt.x, ev.point.y - lastPt.y) < freehandSamplePx) return;
      lastPt = ev.point;
      commands.ways.addWayPoint(wayId, lngLatOf(ev));
    });
    const onMove = (ev: MapMouseEvent) => moveThrottle.call(ev);
    const onUp = (ev: MapMouseEvent) => {
      map.off('mousemove', onMove);
      moveThrottle.flush();
      if (started) {
        // Still inside the checkpoint (endGesture is below) so the final
        // point + finishWay coalesce with the sampled points from onMove
        // into the one undo step this whole freehand stroke should be.
        if (Math.hypot(ev.point.x - lastPt.x, ev.point.y - lastPt.y) > 0)
          commands.ways.addWayPoint(wayId, lngLatOf(ev));
        commands.ways.finishWay();
      }
      endGesture();
    };
    map.on('mousemove', onMove);
    map.once('mouseup', onUp);
    beginGesture(
      (revert) => {
        moveThrottle.cancel();
        map.off('mousemove', onMove);
        map.off('mouseup', onUp);
        if (revert && started) commands.ways.deleteWay(wayId);
      },
      { discoverNewWay: true },
    );
  };

  // Draw like laying track: each click OR drag places ONE node. The first
  // press on empty seeds the start; every release after adds the next node,
  // and the geometry mode (straight/curved) shapes the segments between them.
  // Pressing near an existing, already-finished way's open endpoint RESUMES
  // that same way (same entity, same service) instead of starting an
  // unrelated new one — turnkey, SimCity-style continuation. Pressing near
  // any other point on another way still just snaps onto it, forming a
  // junction between two distinct ways (the correct behavior when they're
  // genuinely different infrastructure).
  // `forceSeparate` (Alt-draw) lays new, independent infrastructure even when
  // an existing compatible corridor is right here — the "explicitly separated"
  // escape hatch to the share-by-default behavior below (express/local tracks,
  // a busway beside a road).
  const startDraw = (
    e: MapMouseEvent,
    operation: Extract<
      PointerOperation,
      | 'route-service'
      | 'resume-service-and-corridor'
      | 'draw-service-and-corridor'
      | 'draw-separate-corridor'
    > = 'draw-service-and-corridor',
  ) => {
    const st = store.getState();
    const forceSeparate = operation === 'draw-separate-corridor';
    const routeExisting = operation === 'route-service';
    const resumeExisting = operation === 'resume-service-and-corridor';
    const candidates = opts.isNetworkMode() ? networkCandidates(st) : null;
    // A route draft is an armed routing gesture, not a partial physical way.
    // Keep every compatible press inside that draft so Alt cannot manufacture
    // an active way beside it; non-routing operations are invalid until the
    // draft is committed or cancelled.
    if (st.routeDraft) {
      if (!routeExisting || !candidates) return;
      suppressClick = true;
      const hit = snap(candidates, lngLatOf(e), snapMeters(snapPx));
      if (hit) {
        const way = candidates.find((w) => w.id === hit.wayId);
        const anchor = way ? anchorOnWay(way, hit.coord) : null;
        if (anchor) commands.routing.extendRouteDraft(anchor);
      }
      return;
    }
    // Remember it for the whole gesture: finishWay is what decides whether the
    // committed line rides existing infrastructure or keeps its own, and by
    // then this press is long gone. Only the press that STARTS a line arms it,
    // so Alt on a later node doesn't silently change the line's mind.
    if (!st.activeWayId) commands.tools.setDraftSeparate(forceSeparate);

    // Network view, pressing ON existing compatible infrastructure: draw by
    // ROUTING along it (snap-to-streets) instead of laying new geometry, since
    // a line drawn onto a corridor is expected to SHARE it. Alt (forceSeparate)
    // opts out — lay separate parallel infrastructure instead. Clicks in empty
    // space fall through to a new-way draw; while a route draft is live,
    // empty-space clicks are ignored (finish with Enter/double-click, back out
    // with Escape).
    //
    // `candidates` here is also what "compatible" means for resuming a way's
    // own OPEN END below: a mode can ride more than one way type (streetcar
    // covers both lightRail and road), wider than the single draftWayTypeId
    // Infrastructure view draws with, so the resume check has to share this
    // set rather than filter by draftWayTypeId alone.
    if (candidates && !st.activeWayId && !forceSeparate) {
      // A press on one of these candidates' own open end must win over
      // starting a route draft along it — an end sits at distance 0 on its
      // own path, so the corridor snap below would otherwise always fire
      // first and swallow the press before the extend-drag handlers (added
      // further down) ever get registered.
      const onOwnEndpoint =
        nearestOpenEndpoint(candidates, lngLatOf(e), snapMeters(snapPx)) !== null;
      if (routeExisting && !onOwnEndpoint) {
        const hit = snap(candidates, lngLatOf(e), snapMeters(snapPx));
        if (hit) {
          const way = candidates.find((w) => w.id === hit.wayId);
          const anchor = way ? anchorOnWay(way, hit.coord) : null;
          if (anchor) {
            suppressClick = true;
            commands.routing.startRouteDraft(anchor);
            return;
          }
        }
      }
    }

    if (st.draftGeometry === 'freeform') {
      startFreehand(e);
      return;
    }
    const startPt = e.point;
    const startCoord = lngLatOf(e);
    let wayId = st.activeWayId ?? '';
    const seededStart = !wayId; // no active way yet — this press only seeds/grabs
    let extendAtStart = activeExtendAtStart;

    if (!wayId) {
      // Alt-draw (forceSeparate) never resumes an existing way — it's the
      // opt-out from attaching to what's already here. In Network view this
      // must search the same networkCandidates set the block above checked
      // for `onOwnEndpoint`, or a mode that rides more than one way type
      // (e.g. streetcar's lightRail+road) could find the endpoint above but
      // fail to resume it here and silently start an unrelated new way.
      const resume = forceSeparate
        ? null
        : candidates && resumeExisting
          ? nearestOpenEndpoint(candidates, startCoord, snapMeters(snapPx))
          : nearestOpenEndpoint(st.system.ways, startCoord, snapMeters(snapPx), st.draftWayTypeId);
      if (resume) {
        wayId = resume.wayId;
        extendAtStart = resume.end === 'start';
        commands.ways.resumeWay(wayId);
        const ridingService = st.system.services.find((sv) =>
          patternLegs(servicePattern(sv)).some((leg) => leg.wayId === wayId),
        );
        commands.selection.select(
          ridingService ? { kind: 'service', id: ridingService.id } : { kind: 'way', id: wayId },
        );
      } else {
        const createdWayId = commands.ways.beginWay(st.draftWayTypeId, st.draftGeometry);
        if (createdWayId === null) return;
        wayId = createdWayId;
        extendAtStart = false;
        const seed = snap(
          st.system.ways,
          startCoord,
          snapMeters(snapPx),
          new Set([wayId]),
          st.draftWayTypeId,
        );
        commands.ways.addWayPoint(wayId, seed ? seed.coord : startCoord);
        if (seed) commands.ways.joinWayPointToWay(wayId, 0, seed.wayId, seed.coord);
      }
      activeExtendAtStart = extendAtStart;
    }
    const committedWayId = wayId;
    let dragged = false;

    // resolveEnd runs inside the throttle, not per raw mousemove: it queries
    // the snap index, and that's frame-rate work, not event-rate work.
    const previewThrottle = rafThrottle((raw: LngLat, shiftKey: boolean) => {
      previewEnd(committedWayId, extendAtStart, raw, shiftKey);
    });
    const onMove = (ev: MapMouseEvent) => {
      if (Math.hypot(ev.point.x - startPt.x, ev.point.y - startPt.y) >= dragPx) dragged = true;
      previewThrottle.call(lngLatOf(ev), constrainActive(ev));
    };
    const onUp = (ev: MapMouseEvent) => {
      previewThrottle.cancel();
      endGesture();
      map.off('mousemove', onMove);
      // Seed-only click just grabbed the start (fresh or resumed); every
      // other release adds a node.
      if (dragged || !seededStart) {
        const end = resolveEnd(committedWayId, extendAtStart, lngLatOf(ev), constrainActive(ev));
        placeEnd(committedWayId, extendAtStart, end);
      }
      suppressClick = true; // node placement is handled here, not in onClick
    };
    map.on('mousemove', onMove);
    map.once('mouseup', onUp);
    beginGesture(() => {
      previewThrottle.cancel();
      map.off('mousemove', onMove);
      map.off('mouseup', onUp);
      clearPreviews();
      // A brand-new way's seed point was already committed before this
      // closure exists — canceling just drops the pending node this press
      // would have added; the way stays active (as if only the seed had
      // happened), and a follow-up Escape backs it out via the store-level
      // finishWay() / activeWayId handling, same as any other stub draw.
    });
  };

  interface ResolvedEnd {
    coord: LngLat;
    /** Set when `coord` landed on another way's path — placeEnd forms a real
     *  junction (a shared control point, not just a coincidental-looking
     *  curve) once the point is placed. */
    snapWayId?: string;
    /** Set when `coord` landed on this same way's own start/end vertex —
     *  placeEnd closes a real loop junction once the point is placed. */
    closesLoop?: boolean;
  }

  // How much more permissive corridor-following is than an exact-type snap —
  // "run alongside this" is a looser judgment than "is this the same track,"
  // so it gets a wider radius than snapMeters' own tight tolerance.
  const CORRIDOR_FOLLOW_TOLERANCE_SCALE = 1.75;
  // Within this many degrees of dead-parallel counts as "following" rather
  // than "crossing" — a drag steeper than this is passing over the candidate
  // way, not running alongside it, and bending toward it would read as the
  // line snapping sideways instead of continuing where it was aimed.
  const CORRIDOR_FOLLOW_MAX_ANGLE_DEG = 35;
  const CORRIDOR_FOLLOW_MIN_COS = Math.cos((CORRIDOR_FOLLOW_MAX_ANGLE_DEG * Math.PI) / 180);
  // Clearance beyond both ways' own half-widths, and beyond the mode's own
  // corridorToleranceM — so the offset line never nearly touches the
  // corridor it's deliberately kept separate from, and finishWay's own
  // conflatePatternOntoExisting can't quietly re-absorb it on commit.
  const CORRIDOR_FOLLOW_CLEARANCE_M = 3;

  /**
   * When freehand-dragging near an existing way of a type the draft can't
   * merge with (so the exact-type snap above found nothing) and the CURRENT
   * drag direction is running roughly PARALLEL to it rather than crossing
   * it, bend the drawn point onto an offset copy of that way's path — "run
   * alongside this corridor" without landing on it or forming any junction.
   * A passive assist: it only nudges a point that's already close and
   * roughly aligned — move the cursor away and it stops applying, the same
   * as any other snap here.
   */
  const followCorridor = (wayId: string, endpoint: LngLat, raw: LngLat): LngLat | null => {
    const state = store.getState();
    const waysById = wayById(state.system.ways);
    const drawing = waysById.get(wayId);
    if (!drawing) return null;
    const modeSpec = mode(state.draftModeId);
    const baseToleranceM = modeSpec.corridorToleranceM ?? CONFLATION_TOLERANCE_M;
    const candidate = snap(
      state.system.ways,
      raw,
      baseToleranceM * CORRIDOR_FOLLOW_TOLERANCE_SCALE,
      new Set([wayId]),
    );
    if (!candidate) return null;
    const way = waysById.get(candidate.wayId);
    if (!way) return null;
    // A way of the SAME type as the draft belongs to the exact-type snap
    // above (which already ran and found nothing at the tighter radius) —
    // corridor-following only ever bends toward a genuinely incompatible
    // type, per its own doc comment. Without this, a same-type way just
    // outside the tight snap radius but inside this wider one gets treated
    // as "incompatible" and offset alongside instead of left alone,
    // planting an unwanted parallel duplicate.
    if (way.typeId === drawing.typeId) return null;
    const path = resolveWayPath(way);
    if (path.length < 2) return null;
    const totalM = pathLengthMeters(path);
    if (totalM < 1e-6) return null;

    // The CURRENT drag direction (endpoint → raw), not the way's already-
    // committed heading (endpoint → behind, fixed before this call) — the
    // gate below exists to tell "dragging alongside this corridor" apart
    // from "crossing it," and only the live cursor direction can answer
    // that. Using the fixed prior heading here would keep passing even
    // after a sharp turn mid-drag, bending a deliberate crossing sideways.
    const drag = unitVectorMeters(endpoint, raw);
    if (!drag) return null;
    const [dragX, dragY] = drag;

    const near = nearestOnPath(path, candidate.coord);
    if (!near) return null;
    // A local tangent sampled a couple of meters either side of the nearest
    // point — short enough to stay local on a long way, wide enough not to
    // be numerical noise on a short one.
    const tEps = Math.min(0.05, Math.max(0.002, 2 / totalM));
    const tangent = unitVectorMeters(
      pointAtT(path, Math.max(0, near.t - tEps)),
      pointAtT(path, Math.min(1, near.t + tEps)),
    );
    if (!tangent) return null;
    const [tx, ty] = tangent;
    const cosAngle = Math.abs(dragX * tx + dragY * ty);
    if (cosAngle < CORRIDOR_FOLLOW_MIN_COS) return null;

    const halfSpanM =
      Math.max(
        profileWidthM(way.profile) / 2 + profileWidthM(drawing.profile) / 2,
        baseToleranceM,
      ) + CORRIDOR_FOLLOW_CLEARANCE_M;
    // Only the neighborhood around the drag actually gets consulted below
    // (via nearestOnPath), so offset just that window instead of the whole
    // way — offsetPolyline's per-point cost otherwise scales with a long
    // imported way's full point count, on every drag frame.
    const windowMarginM = halfSpanM + baseToleranceM * CORRIDOR_FOLLOW_TOLERANCE_SCALE + 20;
    const window = windowAroundArcLength(path, near.t * totalM, windowMarginM);
    if (window.length < 2) return null;
    const plus = offsetPolyline(window, halfSpanM);
    const minus = offsetPolyline(window, -halfSpanM);
    const nearPlus = nearestOnPath(plus, raw);
    const nearMinus = nearestOnPath(minus, raw);
    const chosen =
      nearPlus && (!nearMinus || nearPlus.distMeters <= nearMinus.distMeters)
        ? nearPlus
        : nearMinus;
    return chosen?.coord ?? null;
  };

  // Where a new node lands: another way's path or this way's own loop-close
  // vertex win first (whichever is nearer forms a junction); failing that, an
  // incompatible-type corridor to run alongside if the drag is roughly
  // parallel to one (see followCorridor); failing that, the way's own current
  // heading if the drag is roughly aligned with it (so extending continues
  // straight instead of introducing an accidental kink); a Shift-held drag
  // instead constrains to 45° from the endpoint; otherwise the raw cursor
  // position.
  const resolveEnd = (
    wayId: string,
    atStart: boolean,
    raw: LngLat,
    shiftKey: boolean,
  ): ResolvedEnd => {
    const endpoint = wayEndpoint(wayId, atStart);
    if (shiftKey && endpoint) return { coord: angleSnap(endpoint, raw) };
    const otherWay = snap(
      store.getState().system.ways,
      raw,
      snapMeters(snapPx),
      new Set([wayId]),
      store.getState().draftWayTypeId,
    );
    // The way's own start/end vertex is a snap candidate exactly like any
    // other way's endpoint. Nearest wins — the same tie-break `snap()` itself
    // uses across different ways — so a genuinely closer junction with
    // someone else's line still forms that junction instead of force-closing
    // a loop the cursor only brushed past.
    const loopTarget = ownLoopCloseTarget(wayId, atStart);
    if (loopTarget) {
      const loopDist = haversineMeters(raw, loopTarget);
      if (loopDist <= snapMeters(snapPx) && (!otherWay || loopDist <= otherWay.distMeters)) {
        return { coord: loopTarget, closesLoop: true };
      }
    }
    if (otherWay) return { coord: otherWay.coord, snapWayId: otherWay.wayId };
    const heading = wayHeadingAnchor(wayId, atStart);
    if (endpoint && heading) {
      const followed = followCorridor(wayId, endpoint, raw);
      if (followed) return { coord: followed };
      const straight = continueStraight(endpoint, heading, raw, snapMeters(straightSnapPx));
      if (straight) return { coord: straight };
    }
    return { coord: raw };
  };

  // A new node appends at the way's end normally, or prepends at its start
  // when extending a resumed way backwards. When the resolved coordinate
  // snapped onto another way, also forms a real junction between them; when
  // it closed this way's own loop, forms the same kind of junction with
  // itself instead.
  const placeEnd = (wayId: string, atStart: boolean, end: ResolvedEnd): void => {
    const way = store.getState().system.ways.find((w) => w.id === wayId);
    const index = atStart ? 0 : (way?.points.length ?? 0);
    if (atStart) commands.ways.insertWayPoint(wayId, 0, end.coord);
    else commands.ways.addWayPoint(wayId, end.coord);
    if (end.closesLoop) commands.ways.closeWayLoop(wayId);
    else if (end.snapWayId) commands.ways.joinWayPointToWay(wayId, index, end.snapWayId, end.coord);
  };

  /**
   * Draw the rubber band to where a release would ACTUALLY put the node —
   * through the very same resolveEnd the mouseup path commits with, never the
   * raw cursor.
   *
   * What you see is what you get: the preview is a promise about the geometry
   * you're about to create, so any assist that moves the point (continue-
   * straight, 45° constrain, snapping onto another way) has to be visible
   * while you're still deciding. Previewing the raw cursor instead meant the
   * band showed one line and the committed way rendered as a different one,
   * with no way to tell in advance that the assist had grabbed.
   */
  const previewEnd = (wayId: string, atStart: boolean, raw: LngLat, shiftKey: boolean): void => {
    const way = store.getState().system.ways.find((w) => w.id === wayId);
    if (!way || way.points.length === 0) return;
    const coord = resolveEnd(wayId, atStart, raw, shiftKey).coord;
    // Preview the way's RESOLVED shape, not a straight line to the new point.
    // The draft geometry is "curved" by default, so committing rounds the
    // corner at the current endpoint — a vertex that, until this point is
    // added, is an unfilleted line end. A straight rubber band promised a
    // sharp corner and then rendered a curve through it.
    //
    // Only the last two committed points are needed: roundedCorners has
    // strictly local support (see wayPath.ts), so the fillet computed here at
    // the current endpoint is identical to the one the committed way renders.
    const points = atStart ? [coord, ...way.points.slice(0, 2)] : [...way.points.slice(-2), coord];
    setPreview(resolveWayPath({ ...way, points }));
    // Against the WHOLE stroke, not just the segment being previewed: whether
    // a stretch counts as shared depends on how long the run is, which only
    // the whole line can answer (see detectShapeRuns' minRunM).
    const whole = atStart ? [coord, ...way.points] : [...way.points, coord];
    setSharingPreview(
      sharingRunsFor(resolveWayPath({ ...way, points: whole })),
      store.getState().draftColor,
    );
  };

  // Rubber-band preview from the last node to the cursor while drawing; when
  // not yet drawing, a ring over any open endpoint within snap range warns
  // that pressing there resumes/extends THAT way instead of starting a new
  // one (see startDraw's own nearestOpenEndpoint call, which this mirrors).
  // Throttled like every drag handler in this file (rafThrottle, above) —
  // unlike a drag, this fires on every raw mousemove regardless of whether
  // a button is held (it drives the rubber-band preview and the "resume this
  // way" endpoint ring), and its resume-endpoint branch below does an
  // O(ways) scan (nearestOpenEndpoint) — at native mousemove frequency that
  // ran far more often than the map could paint. A single rAF frame of
  // latency on a hover affordance is imperceptible.
  const onHoverMoveImpl = (ev: MapMouseEvent, pointerIntent: PointerIntent) => {
    const st = store.getState();
    if (st.tool === 'way' && st.activeWayId) {
      // Infrastructure's Way tool predates Network's route/new/separate
      // vocabulary, so it has no resolver preview kind to consume yet. Its
      // established rubber band remains unconditional; Network drafts are
      // gated by the resolved presentation contract.
      if (!opts.isNetworkMode() || pointerIntent.anchor === 'preview')
        previewEnd(st.activeWayId, activeExtendAtStart, lngLatOf(ev), constrainActive(ev));
      else clearPreviews();
      // While drawing, the one endpoint hint that still applies is the way's
      // own loop-close vertex (see resolveEnd/ownLoopCloseTarget) — hints for
      // OTHER ways' open endpoints stay suppressed here, unchanged.
      const loopTarget = ownLoopCloseTarget(st.activeWayId, activeExtendAtStart);
      setEndpointHint(
        loopTarget && haversineMeters(lngLatOf(ev), loopTarget) <= snapMeters(snapPx)
          ? loopTarget
          : null,
      );
      return;
    }
    if (facilityBoundaryDraft) {
      setPreview(closedForPreview([...facilityBoundaryDraft, lngLatOf(ev)]));
      return;
    }
    if (stationBoundaryDraft) {
      setPreview(closedForPreview([...stationBoundaryDraft, lngLatOf(ev)]));
      return;
    }
    clearPreviews();
    if (
      st.tool === 'way' &&
      !st.readOnly &&
      (pointerIntent.primaryOperation === 'route-service' ||
        pointerIntent.primaryOperation === 'resume-service-and-corridor') &&
      pointerIntent.anchor === 'target'
    ) {
      // The resolver's target presentation is not merely decorative: this is
      // the same visible anchor the resolved route-service press will start
      // from. New/separate previews deliberately clear it instead.
      setEndpointHint(networkRouteAnchorAt(ev));
    } else {
      setEndpointHint(null);
    }
  };
  const hoverThrottle = rafThrottle((ev: MapMouseEvent) => {
    const pointerIntent = publishPointerIntent(ev);
    if (opts.isContextMenuOpen?.()) {
      clearPreviews();
      setEndpointHint(null);
      return;
    }
    onHoverMoveImpl(ev, pointerIntent);
  });
  attachmentCleanup.push(() => hoverThrottle.cancel());
  const onHoverMove = (ev: MapMouseEvent) => {
    // Retain the pointer immediately for stationary key transitions, but defer
    // every rendered-feature query and presentation update to the frame.
    lastPointer = ev;
    hoverThrottle.call(ev);
  };

  const placeOrSnapStop = (id: string, coord: LngLat) => {
    const ways = store.getState().system.ways;
    const s = snap(ways, coord, snapMeters(snapPx));
    if (s) commands.stops.moveStop(id, s.coord, { wayId: s.wayId, t: s.t });
    else commands.stops.moveStop(id, coord, undefined);
  };

  // Alt-drag erases control points: delete the one under the cursor, then any
  // point dragged over. Handles re-render after each delete, so re-querying
  // gives current indices. Lets you carve a section out of a line. Escape
  // stops erasing further points but doesn't un-erase what's already gone —
  // that's what Ctrl+Z is for (the whole erase-so-far is one undo step, same
  // as any other gesture; see beginGesture/endGesture).
  const startErase = (firstHandle: MapGeoJSONFeature) => {
    suppressClick = true;
    const wayId = firstHandle.properties.wayId as string;
    let moved = false;
    const eraseThrottle = rafThrottle((ev: MapMouseEvent) => {
      const f = featureAt(ev, [LYR_HANDLES, LYR_WAY_ENDPOINTS]);
      if (f)
        commands.ways.deleteWayPoint(f.properties.wayId as string, f.properties.index as number);
    });
    const onMove = (ev: MapMouseEvent) => {
      moved = true;
      eraseThrottle.call(ev);
    };
    const onUp = (ev: MapMouseEvent) => {
      if (moved) {
        eraseThrottle.call(ev);
        eraseThrottle.flush();
      } else {
        eraseThrottle.cancel();
      }
      endGesture();
      map.off('mousemove', onMove);
    };
    map.on('mousemove', onMove);
    map.once('mouseup', onUp);
    beginGesture(
      () => {
        eraseThrottle.cancel();
        map.off('mousemove', onMove);
        map.off('mouseup', onUp);
      },
      {
        wayIds: [wayId],
        nodeIds: store
          .getState()
          .system.nodes.filter((node) => node.refs.some((ref) => ref.wayId === wayId))
          .map((node) => node.id),
      },
    );
    // This first deletion belongs inside the same checkpoint and projection
    // boundary as the subsequent frame-coalesced sweep.
    commands.ways.deleteWayPoint(
      firstHandle.properties.wayId as string,
      firstHandle.properties.index as number,
    );
  };

  function beginGesture(cancel: (revert: boolean) => void, targets: EditGestureTargets = {}) {
    cancelActiveGesture = cancel;
    opts.onDirectManipulationStart?.();
    opts.onEditGestureStart?.(targets);
    commands.history.beginHistoryCheckpoint();
  }
  function endGesture() {
    cancelActiveGesture = null;
    commands.history.commitHistoryCheckpoint();
    opts.onEditGestureEnd?.();
    opts.onDirectManipulationEnd?.();
    clearPointerIntent();
  }

  // Bulldozer-style: a click with no movement removes the whole street
  // (deleteWayStretch's own [lo,hi]≈[0,1] degrades to a full-way removal, so
  // that path is reused rather than calling deleteWay separately — see its
  // MIN_STRETCH_T guard); a drag removes only the stretch swept, one
  // deleteWayStretch call per way touched. Whatever the drag crosses is one
  // undo step, same as startErase's own sweep.
  const startDemolishDrag = (e: MapMouseEvent) => {
    suppressClick = true;
    const first = snap(store.getState().system.ways, lngLatOf(e), snapMeters(snapPx));
    if (!first) return; // pressed on empty ground
    const hitRanges = new Map<string, { lo: number; hi: number }>();
    const record = (wayId: string, t: number) => {
      const r = hitRanges.get(wayId);
      if (!r) hitRanges.set(wayId, { lo: t, hi: t });
      else {
        r.lo = Math.min(r.lo, t);
        r.hi = Math.max(r.hi, t);
      }
    };
    record(first.wayId, first.t);
    let moved = false;

    const updatePreview = () => {
      const sys = store.getState().system;
      const coords: LngLat[] = [];
      for (const [wayId, { lo, hi }] of hitRanges) {
        const way = sys.ways.find((w) => w.id === wayId);
        if (!way) continue;
        coords.push(...slicePathByT(resolveWayPath(way), lo, hi));
      }
      setPreview(coords, { demolish: true });
    };

    const throttle = rafThrottle((coord: LngLat) => {
      const hit = snap(store.getState().system.ways, coord, snapMeters(snapPx));
      if (hit) record(hit.wayId, hit.t);
      updatePreview();
    });
    const onMove = (ev: MapMouseEvent) => {
      moved = true;
      throttle.call(lngLatOf(ev));
    };
    const onUp = () => {
      // Applies the release position's own sample before reading hitRanges —
      // cancel() would silently drop it if no animation frame happened to
      // land between the last mousemove and this mouseup (same reasoning as
      // startErase's own onUp).
      if (moved) throttle.flush();
      else throttle.cancel();
      map.off('mousemove', onMove);
      clearPreviews();
      // The deletions run BEFORE endGesture — commitHistoryCheckpoint diffs
      // against the system as it stands when called, so ending the gesture
      // first would commit a no-op checkpoint and let each deletion below
      // fall through to the store's per-set auto-history instead, splitting
      // one sweep into several undo steps.
      if (!moved) {
        commands.ways.deleteWay(first.wayId);
      } else {
        for (const [wayId, { lo, hi }] of hitRanges)
          commands.network.deleteWayStretch(wayId, lo, hi);
      }
      endGesture();
    };
    map.on('mousemove', onMove);
    map.once('mouseup', onUp);
    beginGesture(() => {
      throttle.cancel();
      map.off('mousemove', onMove);
      clearPreviews();
    });
    updatePreview();
  };

  const terminusTargetAt = (
    e: MapMouseEvent,
    source: TerminusGestureSource,
  ): TerminusGestureTarget | null => {
    const serviceTarget = rightClickTarget(e);
    if (serviceTarget?.serviceHit && serviceTarget.target.kind === 'service') {
      const { serviceHit } = serviceTarget;
      const position = serviceHit.position;
      if (!position) return null;
      return {
        kind: 'service-position',
        serviceId: serviceHit.serviceId,
        position,
        ...(serviceHit.terminusSide
          ? {
              terminus: {
                patternId: serviceHit.patternId,
                side: serviceHit.terminusSide,
              },
            }
          : {}),
      };
    }
    const state = store.getState();
    const sourceMode = state.system.services.find(
      (service) => service.id === source.serviceId,
    )?.modeId;
    if (!sourceMode) return null;
    const allowed = new Set(mode(sourceMode).wayTypeIds);
    const candidates = state.system.ways.filter((way) => allowed.has(way.typeId));
    const hit = snap(candidates, lngLatOf(e), snapMeters(snapPx));
    return hit ? { kind: 'corridor', wayId: hit.wayId, coord: hit.coord } : null;
  };

  const finishTerminusGestureWithoutCommit = () => {
    activeTerminusSource = null;
    cancelActiveGesture = null;
    commands.history.cancelHistoryCheckpoint();
    opts.onEditGestureEnd?.();
    opts.onDirectManipulationEnd?.();
    clearPreviews();
    clearPointerIntent();
  };

  const startTerminusDrag = (feature: MapGeoJSONFeature) => {
    const state = store.getState();
    const serviceId = feature.properties.serviceId as string;
    const patternId = feature.properties.patternId as string;
    const side = feature.properties.side as 'start' | 'end';
    if ((side !== 'start' && side !== 'end') || !serviceId || !patternId) return;
    const armed = state.armedTerminus;
    const source: TerminusGestureSource = {
      serviceId,
      patternId,
      side,
      purpose:
        armed &&
        armed.serviceId === serviceId &&
        armed.patternId === patternId &&
        armed.side === side
          ? 'return'
          : 'extend',
    };
    activeTerminusSource = source;
    suppressClick = true;
    let latest: { target: TerminusGestureTarget; plan: TerminusGesturePlan } | null = null;
    const preview = (ev: MapMouseEvent) => {
      const target = terminusTargetAt(ev, source);
      latest = target
        ? { target, plan: planTerminusGesture(store.getState().system, source, target) }
        : null;
      const coords =
        latest && latest.plan.kind !== 'refuse'
          ? routePath(latest.plan.system, latest.plan.spans)
          : [];
      setPreview(
        coords.length >= 2 ? coords : null,
        source.purpose === 'return' ? { oneWayReturn: true } : {},
      );
      const sourceService = store
        .getState()
        .system.services.find((service) => service.id === source.serviceId);
      setSharingPreview(
        coords.length >= 2 ? [coords] : [],
        (sourceService
          ? lineForService(store.getState().system, sourceService.id)?.color
          : undefined) ?? store.getState().draftColor,
      );
      setEndpointHint(coords.at(-1) ?? null);
      publishPointerIntent(ev, undefined, true);
    };
    const throttled = rafThrottle(preview);
    const onMove = (ev: MapMouseEvent) => throttled.call(ev);
    const onUp = (ev: MapMouseEvent) => {
      throttled.cancel();
      preview(ev);
      map.off('mousemove', onMove);
      map.off('mouseup', onUp);
      clearPreviews();
      setEndpointHint(null);
      const resolved = latest;
      if (resolved?.plan.kind === 'connection-choice') {
        opts.setActionAnchor?.(rightClickTarget(ev)?.anchor ?? lngLatOf(ev));
        finishTerminusGestureWithoutCommit();
        const choose = (choice: 'connect' | 'through') => {
          opts.setActionAnchor?.(null);
          commands.services.commitTerminusGesture(source, resolved.target, resolved.plan, choice);
        };
        opts.openTerminusConnectionChoice?.({
          x: ev.originalEvent.clientX,
          y: ev.originalEvent.clientY,
          connectPaths: () => choose('connect'),
          joinThroughService: () => choose('through'),
          dismiss: () => {
            opts.setActionAnchor?.(null);
            commands.selection.clearArmedTerminus();
          },
        });
        return;
      }
      if (resolved) commands.services.commitTerminusGesture(source, resolved.target, resolved.plan);
      else commands.selection.clearArmedTerminus();
      activeTerminusSource = null;
      endGesture();
    };
    map.on('mousemove', onMove);
    map.once('mouseup', onUp);
    beginGesture((revert) => {
      throttled.cancel();
      map.off('mousemove', onMove);
      map.off('mouseup', onUp);
      activeTerminusSource = null;
      if (revert) commands.selection.clearArmedTerminus();
      clearPreviews();
      setEndpointHint(null);
    }, {});
  };

  // ---- mousedown: dispatch by button, channel, tool, target ----------------
  const onMouseDown = (e: MapMouseEvent) => {
    // The compatibility mouse events a browser emits after a motionless touch.
    // The touch adapter below already drove that press; replaying it here
    // would run the whole gesture a second time — a long press would open the
    // action menu and then immediately start a draw underneath it.
    if (ignoringCompatMouse()) return;
    ignoreCompatMouseUntil = 0;
    const st = store.getState();
    const oe = e.originalEvent;
    // Resolved channels, not raw key state: the branches below must agree with
    // the intent the badge and cursor already published, and a latched channel
    // has to reach them exactly as a held key does. Read once so the whole
    // dispatch sees one consistent answer.
    const channels = modifierState(oe);
    // A new press owns the flag outright: whatever the previous one armed is
    // spent by now, whether or not a click ever arrived to consume it.
    suppressClick = false;
    const pointerIntent = publishPointerIntent(e, undefined, false);
    // This is captured before dispatch so the operation chosen by the press
    // cannot be rewritten by later modifier events while the button is held.
    lockedPrimaryOperation = pointerIntent.primaryOperation;
    if (oe.button === 2 || (oe.button === 0 && spaceHeld)) {
      startPan(e, oe.button === 2);
      return;
    }
    if (oe.button !== 0) return;
    if (st.readOnly || st.tool === 'select' || st.tool === 'lines') {
      opts.onSelectionIntent?.();
    }

    const endpoint = featureAt(e, [LYR_WAY_ENDPOINTS]);
    const handle = endpoint ?? featureAt(e, [LYR_HANDLES]);
    const physicalHandle = featureAt(e, [LYR_PHYSICAL_HANDLES]);
    const serviceTerminus = featureAt(e, [LYR_SERVICE_TERMINI_HIT]);
    const stop = stopFeatureAt(e);
    const facility = featureAt(e, [LYR_FACILITIES]);

    if (
      pointerIntent.primaryOperation === 'refuse' ||
      pointerIntent.primaryOperation === 'refuse-edit'
    ) {
      return;
    }

    if (st.readOnly || opts.isDiagramMode()) {
      // Nothing is editable, but empty-space left-drag still pans — matching
      // the grab cursor and right-drag/space-drag, which already bypass this.
      if (!endpoint && !handle && !physicalHandle && !stop && !facility) startPan(e, false);
      return;
    }

    // Picking mode (Inspector's "Add existing" flow) takes over the press
    // entirely — no drag/reshape/pan starts while armed, so a slightly
    // sloppy click can't accidentally move the very thing being targeted.
    // onClick (below) resolves the actual pick once the button is released.
    if (st.pickingMemberForGroupId) return;

    // Network drawing is dispatched from the resolved verb, not a second
    // modifier/target decision below. That keeps the corridor badge, cursor,
    // and press semantics one contract while Tasks 3/4 add their own future
    // terminus and connection targets.
    if (
      (pointerIntent.primaryOperation === 'route-service' ||
        pointerIntent.primaryOperation === 'resume-service-and-corridor' ||
        pointerIntent.primaryOperation === 'draw-service-and-corridor' ||
        pointerIntent.primaryOperation === 'draw-separate-corridor') &&
      st.tool === 'way' &&
      !isDoubleClickFinish(oe.detail)
    ) {
      startDraw(e, pointerIntent.primaryOperation);
      return;
    }

    if (
      opts.isNetworkMode() &&
      serviceTerminus &&
      (pointerIntent.primaryOperation === 'extend-branch' ||
        pointerIntent.primaryOperation === 'draw-inbound-side')
    ) {
      startTerminusDrag(serviceTerminus);
      return;
    }

    if (opts.isNetworkMode() && st.tool === 'select') {
      if (pointerIntent.primaryOperation === 'delete-stop' && stop) {
        commands.stops.deleteStop(stop.properties.id as string);
        suppressClick = true;
        return;
      }
      if (pointerIntent.primaryOperation === 'delete-facility' && facility) {
        commands.facilities.deleteFacility(facility.properties.id as string);
        suppressClick = true;
        return;
      }
      // Shift-click and a 2+ item group are established Select gestures. Let
      // their branch below own the press rather than turning a resolved
      // stop/facility move into a single-item drag before it gets there.
      if (
        pointerIntent.primaryOperation === 'move-stop' &&
        stop &&
        !channels.constrain &&
        !isGroupMember('stop', stop.properties.id as string)
      ) {
        startStopDrag(stop.properties.id as string);
        return;
      }
      if (
        pointerIntent.primaryOperation === 'move-facility' &&
        facility &&
        !channels.constrain &&
        !isGroupMember('facility', facility.properties.id as string)
      ) {
        startFacilityDrag(facility.properties.id as string);
        return;
      }
      // The Network resolver names empty-space pan explicitly. Handles are
      // normally absent from that projection, but preserving their existing
      // edit dispatch here keeps a transient layer refresh from converting a
      // real control-point press into a camera gesture.
      if (pointerIntent.primaryOperation === 'pan' && pointerTargetAt(e) === 'empty') {
        startPan(e, false);
        return;
      }
      if (pointerIntent.primaryOperation === 'select-line-and-branch') return;
    }

    if (pointerIntent.primaryOperation === 'erase-points' && handle) {
      startErase(handle);
      return;
    }

    if (pointerIntent.primaryOperation === 'split-corridor' && handle && !endpoint) {
      commands.ways.splitWayAt(
        handle.properties.wayId as string,
        handle.properties.index as number,
      );
      suppressClick = true;
      return;
    }

    if (pointerIntent.primaryOperation === 'extend-corridor' && endpoint) {
      startExtendDrag(endpoint);
      return;
    }

    if (
      (pointerIntent.primaryOperation === 'move-point' ||
        pointerIntent.primaryOperation === 'constrained-move') &&
      handle
    ) {
      startHandleDrag(handle);
      return;
    }

    if (channels.alternate) {
      if (physicalHandle) {
        const kind = physicalHandle.properties.kind as 'footprint' | 'platform' | 'groupFootprint';
        if (kind === 'groupFootprint') {
          commands.groups.deleteGroupFootprint(physicalHandle.properties.groupId as string);
        } else {
          const stationId = physicalHandle.properties.stationId as string;
          if (kind === 'footprint') commands.stations.deleteStationFootprint(stationId);
          else
            commands.stations.deletePlatform(
              stationId,
              physicalHandle.properties.platformId as string,
            );
        }
        suppressClick = true;
      } else if (handle) {
        startErase(handle); // Alt-click removes a point; Alt-drag erases a section
      } else if (stop) {
        commands.stops.deleteStop(stop.properties.id as string);
        suppressClick = true;
      } else if (facility) {
        commands.facilities.deleteFacility(facility.properties.id as string);
        suppressClick = true;
      } else if (
        st.tool === 'way' &&
        opts.isNetworkMode() &&
        !st.routeDraft &&
        !st.activeWayId &&
        !isDoubleClickFinish(oe.detail)
      ) {
        // Alt on empty space in the Way tool draws SEPARATE infrastructure,
        // opting out of share-by-default corridor snapping (see startDraw).
        startDraw(e, 'draw-separate-corridor');
      }
      return;
    }

    // Ctrl/Cmd-drag a way's open END extends it (adds a new point) — the
    // plain drag there now just reshapes the end in place, like any other
    // handle (see the "select" tool's own endpoint case below), so extending
    // needs its own deliberate gesture instead of being the unmodified
    // default. This target was otherwise a no-op under Ctrl/Cmd (nothing to
    // split off an endpoint), which is exactly why it was free to repurpose.
    // Ctrl/Cmd-click an interior handle splits the way there — each half
    // keeps the original's type/grade/class/capacity and can then be edited
    // independently (see model/way-split-edits.ts). A no-op on an
    // endpoint (nothing to split off) or any other target.
    if (channels.secondary) return;

    switch (st.tool) {
      case 'select':
        // Shift-click toggles multi-select membership instead of starting any
        // drag — a discrete add/remove, resolved entirely here since every
        // draggable target below sets suppressClick and would otherwise
        // swallow the click before onClick ever saw it.
        if (channels.constrain) {
          if (handle)
            commands.selection.extendSelection({
              kind: 'way',
              id: handle.properties.wayId as string,
            });
          else if (facility)
            commands.selection.extendSelection({
              kind: 'facility',
              id: facility.properties.id as string,
            });
          else if (stop)
            commands.selection.extendSelection({
              kind: 'stop',
              id: stop.properties.id as string,
            });
          else {
            // A served way's visible line is drawn as its SERVICE feature, not
            // its (often-hidden) bare WAY_LAYERS one — try both, same as a
            // plain click's own hit-testing does.
            //
            // And resolve it to the same public identity a plain first click
            // would: shift-clicking two visible transit lines produces two
            // Lines, not two technical Services or the streets beneath them.
            const wayHit = featureAt(e, WAY_LAYERS);
            const serviceHit = wayHit ? undefined : featureAt(e, SERVICE_LAYERS);
            const serviceId = serviceHit?.properties.serviceId as string | undefined;
            const wayId = wayHit ? (wayHit.properties.id as string) : undefined;
            if (serviceId) {
              const line = lineForService(st.system, serviceId);
              commands.selection.extendSelection(
                line ? { kind: 'line', id: line.id } : { kind: 'service', id: serviceId },
              );
            } else if (wayId) commands.selection.extendSelection({ kind: 'way', id: wayId });
            // Truly empty space under the cursor — rubber-band select
            // instead of toggling a single (nonexistent) target.
            else startMarqueeSelect(e, collectInfrastructure);
          }
          suppressClick = true;
          break;
        }
        if (physicalHandle) startPhysicalHandleDrag(physicalHandle);
        // `handle` is `endpoint ?? …` — this also covers an endpoint whose
        // way is part of a multi-selection, so nudging one end drags the
        // whole group, same as any other member handle.
        else if (handle && isGroupMember('way', handle.properties.wayId as string))
          startGroupDrag(e);
        // Plain drag on a way's open END reshapes it in place (moves that
        // one point, same gesture as an interior handle) — hold Ctrl/Cmd
        // instead to extend the way with a new point (handled above, before
        // the tool switch, since it needs to run even though this case does
        // too little to reach otherwise).
        else if (endpoint) startHandleDrag(endpoint);
        else if (handle) startHandleDrag(handle);
        else if (facility && isGroupMember('facility', facility.properties.id as string))
          startGroupDrag(e);
        else if (facility) startFacilityDrag(facility.properties.id as string);
        else if (stop && isGroupMember('stop', stop.properties.id as string)) startGroupDrag(e);
        else if (stop) startStopDrag(stop.properties.id as string);
        else {
          // Grabbing a multi-selected way's LINE anywhere (not just a control-
          // point handle) still moves the whole group — the natural "grab and
          // drag this line" gesture, not one gated on hitting an exact vertex.
          const lineHit = featureAt(e, [...WAY_LAYERS, ...SERVICE_LAYERS]);
          const lineWayId =
            lineHit &&
            ((lineHit.properties.wayId as string | undefined) ??
              (lineHit.properties.id as string | undefined));
          if (lineWayId && isGroupMember('way', lineWayId)) startGroupDrag(e);
          // Empty space: left-drag pans too (not just right-drag/space+drag) —
          // the canvas shows a grab cursor there by default (see cursorFor),
          // so left-click must actually honor it or the cursor is a lie. A
          // plain click (no movement) still falls through to onClick's normal
          // select/deselect handling below, since startPan doesn't suppress it.
          else startPan(e, false);
        }
        break;
      case 'lines': {
        // The Lines tool is a selection tool for services and nothing else:
        // every press starts a marquee that catches lines, and a press that
        // never moves falls through to onClick's normal select handling.
        // Dragging infrastructure is the Select tool's job, and keeping the
        // two apart is the whole reason this tool exists — a box over a
        // boulevard would otherwise have to guess between the street and the
        // eleven routes on it.
        startMarqueeSelect(e, collectLines);
        break;
      }
      case 'way':
        // In the Way tool a press always places the next node (even starting
        // on a handle) — reshaping handles is a Select-tool action — EXCEPT
        // the second press of a double-click, which exists only to trigger
        // the dblclick->finishWay that follows it. See isDoubleClickFinish.
        if (!isDoubleClickFinish(oe.detail)) startDraw(e, 'draw-service-and-corridor');
        break;
      case 'stop':
        if (stop) startStopDrag(stop.properties.id as string);
        // Infrastructure = 2D: the tool draws LAND (drag rect or click
        // points). Network keeps its schematic click-a-stop via onClick;
        // drag still draws land there too.
        else startStationBoundaryDraw(e, !opts.isNetworkMode());
        break;
      case 'facility':
        if (facility) startFacilityDrag(facility.properties.id as string);
        else if (!st.placingFacilityForGroupId) {
          // Complex mode drafts the site boundary; AREA kinds drag-draw the
          // structure's real shape; point kinds click-place via onClick.
          if (st.draftFacilityComplexMode) startFacilityBoundary(e);
          else if (facilityType(st.draftFacilityTypeId).geometryKind === 'area')
            startStructureDraw(e);
        }
        break;
      case 'demolish':
        // Infrastructure view only — Network foregrounds lines over the
        // ways beneath them, and demolishing real streets is deliberately
        // kept a distinct, physical-view action.
        if (!opts.isNetworkMode()) startDemolishDrag(e);
        break;
    }
  };

  // ---- click: discrete add / select (fires only when not dragged) ---------
  const onClick = (e: MapMouseEvent) => {
    // The tail of a compatibility tap whose press the touch adapter already
    // handled (see onMouseDown's own guard, which never ran for this one and
    // so never cleared the window).
    if (ignoringCompatMouse()) return;
    // Not reset here — onMouseDown owns clearing it, so a press whose click
    // MapLibre never fires can't leave this armed for the next one.
    if (suppressClick) return;
    const st = store.getState();
    if (st.readOnly || opts.isDiagramMode() || spaceHeld) return;
    const coord = lngLatOf(e);

    // Picking mode: the next stop/facility clicked joins the armed group;
    // clicking empty space does nothing (only Escape/the Inspector cancels),
    // so a mis-click can't silently drop the user out of the flow.
    if (st.pickingMemberForGroupId) {
      const hit = stopFeatureAt(e) ?? featureAt(e, [LYR_FACILITIES]);
      if (hit) {
        const memberId = hit.properties.id as string;
        commands.groups.addGroupMember(st.pickingMemberForGroupId, memberId);
        commands.groups.cancelPickingMember();
      }
      return;
    }

    switch (st.tool) {
      case 'stop': {
        // Point stops are a NETWORK-view (schematic) concept. In the
        // Infrastructure view everything is 2D — the mousedown gesture owns
        // Station creation there (land only), so a bare click does nothing.
        if (!opts.isNetworkMode()) break;
        const s = snap(st.system.ways, coord, snapMeters(snapPx));
        if (s) commands.stops.addStop(s.coord, { wayId: s.wayId, t: s.t });
        else commands.stops.addStop(coord);
        break;
      }
      case 'facility': {
        // Armed "place inside" (from a complex's Inspector) wins; complex
        // mode's boundary drafting lives in onMouseDown; otherwise a click
        // simply PLACES the selected facility type right there — point kinds
        // as a marker, area kinds as a default square to reshape.
        if (st.placingFacilityForGroupId) {
          commands.groups.placeFacilityInGroup(
            st.placingFacilityForGroupId,
            st.draftFacilityTypeId,
            coord,
          );
        } else if (!st.draftFacilityComplexMode) {
          const kind = facilityType(st.draftFacilityTypeId);
          // Size comes from the facility type itself (catalog), not from this
          // layer: how big a depot is when you drop one is a fact about
          // depots, and placing code has no standing to decide it.
          const half = kind.defaultHalfExtentM;
          commands.facilities.addFacility(
            st.draftFacilityTypeId,
            kind.geometryKind === 'area' && half !== null ? squareFootprint(coord, half) : coord,
          );
        }
        break;
      }
      case 'select': {
        // Stops/handles/lines outrank the junction footprint under them.
        const hit =
          featureAt(e, [LYR_SERVICE_TERMINI_HIT]) ??
          stopFeatureAt(e) ??
          featureAt(e, [LYR_FACILITIES, LYR_HANDLES, ...SERVICE_LAYERS, ...WAY_LAYERS]) ??
          featureAt(e, [LYR_JUNCTIONS]);
        if (!hit) {
          commands.selection.select(null);
        } else if (featureLayerId(hit) === LYR_JUNCTIONS) {
          commands.selection.select({ kind: 'node', id: hit.properties.nodeId as string });
        } else if (featureLayerId(hit) === LYR_SERVICE_TERMINI_HIT) {
          commands.selection.select({ kind: 'service', id: hit.properties.serviceId as string });
          commands.selection.setActivePattern(hit.properties.patternId as string);
        } else if (
          featureLayerId(hit) === LYR_STATIONS ||
          (featureLayerId(hit) === LYR_GESTURE_POINT && hit.properties.kind === 'stop')
        ) {
          commands.selection.select({ kind: 'stop', id: hit.properties.id as string });
        } else if (featureLayerId(hit) === LYR_FACILITIES) {
          commands.selection.select({ kind: 'facility', id: hit.properties.id as string });
        } else if (featureLayerId(hit) === LYR_HANDLES) {
          commands.selection.select({ kind: 'way', id: hit.properties.wayId as string });
        } else if (WAY_LAYERS.includes(featureLayerId(hit))) {
          commands.selection.select({ kind: 'way', id: hit.properties.id as string });
        } else {
          // A rendered Service belongs to a public Line. The first click stays
          // at that understandable public identity; clicking the same Line
          // again deliberately descends to its technical Service. In
          // Infrastructure, one further click on that selected Service edits
          // the physical way beneath it.
          const serviceId = hit.properties.serviceId as string;
          const wayId = hit.properties.wayId as string;
          const line = lineForService(st.system, serviceId);
          if (
            !opts.isNetworkMode() &&
            st.selection?.kind === 'service' &&
            st.selection.id === serviceId
          ) {
            const way = st.system.ways.find((w) => w.id === wayId);
            if (way) {
              commands.ways.insertWayPoint(wayId, insertIndexOnPolygon(way.points, e.point), coord);
              commands.network.formCrossingJunctions(wayId);
            }
          } else if (line && st.selection?.kind === 'line' && st.selection.id === line.id) {
            commands.selection.select({ kind: 'service', id: serviceId });
          } else if (line) {
            commands.selection.select({ kind: 'line', id: line.id });
          } else {
            commands.selection.select({ kind: 'service', id: serviceId });
          }
          const patternId = hit.properties.patternId;
          if (typeof patternId === 'string') commands.selection.setActivePattern(patternId);
        }
        break;
      }
    }
  };

  const onDblClick = (e: MapMouseEvent) => {
    const st = store.getState();
    if (st.routeDraft) {
      e.preventDefault();
      commands.routing.commitRouteDraft();
      return;
    }
    if (st.activeWayId) {
      e.preventDefault();
      commands.ways.finishWay();
    } else if (facilityBoundaryDraft) {
      e.preventDefault();
      finishFacilityBoundaryDraft();
    } else if (stationBoundaryDraft) {
      e.preventDefault();
      finishStationBoundaryDraft();
    }
  };

  /** What a right-click at this point is about, resolved exactly the way a
   *  left click resolves what to select — the two must agree, or right-
   *  clicking a line would offer actions for the street under it. */
  const rightClickTarget = (
    e: MapMouseEvent,
  ): {
    target: MultiSelectItem;
    serviceHit?: ServiceActionHit;
    corridorHit?: CorridorActionHit;
    anchor: LngLat;
  } | null => {
    const st = store.getState();
    const hit =
      stopFeatureAt(e) ??
      featureAt(e, [
        LYR_FACILITIES,
        LYR_SERVICE_TERMINI_HIT,
        LYR_HANDLES,
        ...SERVICE_LAYERS,
        ...WAY_LAYERS,
      ]);
    if (!hit) return null;
    if (
      featureLayerId(hit) === LYR_STATIONS ||
      (featureLayerId(hit) === LYR_GESTURE_POINT && hit.properties.kind === 'stop')
    )
      return { target: { kind: 'stop', id: hit.properties.id as string }, anchor: lngLatOf(e) };
    if (featureLayerId(hit) === LYR_FACILITIES)
      return { target: { kind: 'facility', id: hit.properties.id as string }, anchor: lngLatOf(e) };
    if (featureLayerId(hit) === LYR_SERVICE_TERMINI_HIT) {
      const { serviceId, patternId, side } = hit.properties;
      const anchor =
        hit.geometry.type === 'Point' ? (hit.geometry.coordinates as LngLat) : lngLatOf(e);
      const service = st.system.services.find((candidate) => candidate.id === serviceId);
      const pattern = service && service.id === patternId ? servicePattern(service) : undefined;
      const run = 'outbound' as const;
      const runLegs = pattern ? patternRunLegs(pattern, run) : [];
      const legIndex = side === 'start' ? 0 : runLegs.length - 1;
      const entry = runLegs[legIndex];
      const [lo, hi] = entry ? legRange(entry.leg) : [0, 1];
      const t = entry && (side === 'start') === entry.forward ? lo : hi;
      const position =
        pattern && entry && (side === 'start' || side === 'end')
          ? patternPositionAt(st.system.ways, pattern, run, legIndex, t)
          : null;
      return {
        target: { kind: 'service', id: serviceId as string },
        anchor,
        ...(typeof serviceId === 'string' &&
        typeof patternId === 'string' &&
        (side === 'start' || side === 'end') &&
        position
          ? { serviceHit: { serviceId, patternId, run, legIndex, terminusSide: side, position } }
          : {}),
      };
    }
    if (featureLayerId(hit) === LYR_HANDLES)
      return { target: { kind: 'way', id: hit.properties.wayId as string }, anchor: lngLatOf(e) };
    if (WAY_LAYERS.includes(featureLayerId(hit))) {
      const wayId = hit.properties.id as string;
      const way = st.system.ways.find((candidate) => candidate.id === wayId);
      const near = way && nearestOnPath(resolveWayPath(way), lngLatOf(e));
      const anchor = near && way ? pointAtT(resolveWayPath(way), near.t) : lngLatOf(e);
      return {
        target: { kind: 'way', id: wayId },
        anchor,
        ...(near ? { corridorHit: { wayId, t: near.t } } : {}),
      };
    }
    const { serviceId, patternId, run, legIndex } = hit.properties;
    const service = st.system.services.find((candidate) => candidate.id === serviceId);
    const pattern = service && service.id === patternId ? servicePattern(service) : undefined;
    const leg =
      pattern && (run === 'outbound' || run === 'inbound') && typeof legIndex === 'number'
        ? patternRunLegs(pattern, run)[legIndex]
        : undefined;
    const way = leg && st.system.ways.find((candidate) => candidate.id === leg.leg.wayId);
    const near = way && nearestOnPath(resolveWayPath(way), lngLatOf(e));
    const position =
      pattern &&
      leg &&
      near &&
      (run === 'outbound' || run === 'inbound') &&
      typeof legIndex === 'number'
        ? patternPositionAt(st.system.ways, pattern, run, legIndex, near.t)
        : null;
    const serviceHit =
      typeof serviceId === 'string' &&
      typeof patternId === 'string' &&
      (run === 'outbound' || run === 'inbound') &&
      typeof legIndex === 'number'
        ? { serviceId, patternId, run, legIndex, ...(position ? { position } : {}) }
        : undefined;
    return {
      target: { kind: 'service', id: serviceId as string },
      anchor: position && way ? pointAtT(resolveWayPath(way), position.t) : lngLatOf(e),
      ...(serviceHit ? { serviceHit } : {}),
    };
  };

  /**
   * Open the action menu for a right-click that neither panned nor finished a
   * draw. This is the slot that used to just clear the selection.
   *
   * Right-clicking something already in the selection keeps that whole
   * selection, which is what makes "shift-click two lines, right-click either
   * one, merge" work. Right-clicking anything else selects it first, because
   * acting on what was selected a minute ago instead of what the cursor is
   * pointing at is how a menu earns a reputation for being dangerous.
   */
  const openMenuAt = (e: MapMouseEvent) => {
    clearPointerIntent();
    opts.setActionAnchor?.(null);
    const st = store.getState();
    const hit = rightClickTarget(e);
    if (!hit) {
      commands.selection.select(null);
      commands.selection.clearMultiSelection();
      return;
    }
    let { target } = hit;
    const { serviceHit, corridorHit, anchor } = hit;
    const terminus = featureAt(e, [LYR_SERVICE_TERMINI_HIT]);
    target = publicLineTarget(st, target, Boolean(terminus));
    // A terminus owns its menu: its side-aware conversion cannot safely share
    // a two-service merge group. Service-body right-clicks retain the ordinary
    // multi-select behavior below.
    if (terminus) {
      commands.selection.clearMultiSelection();
      commands.selection.select(target);
    }
    const inGroup = st.multiSelection.some((i) => i.kind === target.kind && i.id === target.id);
    const isSelected = st.selection?.kind === target.kind && st.selection.id === target.id;
    if (!inGroup && !isSelected) commands.selection.select(target);
    if (hit.target.kind === 'service') {
      const patternId = terminus?.properties.patternId;
      if (typeof patternId === 'string') commands.selection.setActivePattern(patternId);
    }
    // The map coordinate travels with the screen one: an action that cuts a
    // line where you clicked needs the place, not the pixel.
    opts.setActionAnchor?.(anchor);
    opts.openContextMenu(
      e.originalEvent.clientX,
      e.originalEvent.clientY,
      anchor,
      serviceHit,
      corridorHit,
    );
  };

  const onContextMenu = (ev: Event) => ev.preventDefault();

  // Escape must stop whatever pointer gesture is actually in flight — a
  // committed store state like activeWayId can't see a live drag, only the
  // gesture that started it can. Capture phase guarantees this fires before
  // the keymap's own (bubble-phase) Escape handler, so a canceled gesture
  // consumes the keypress instead of also "backing out" a level.
  /**
   * Cancel whatever pointer gesture is in flight, and report whether there was
   * one. Escape and an interrupted touch both need exactly this, and kept
   * their own copies of it until they didn't.
   */
  const abortActiveGesture = (revert = true): boolean => {
    if (!cancelActiveGesture) return false;
    const cancel = cancelActiveGesture;
    cancelActiveGesture = null;
    const cleanupSteps = [
      () => cancel(revert),
      () => commands.history.cancelHistoryCheckpoint(),
      () => opts.onEditGestureEnd?.(),
      () => opts.onDirectManipulationEnd?.(),
    ];
    for (const cleanup of cleanupSteps) {
      try {
        cleanup();
      } catch {
        // One failed rollback port cannot strand the remaining gesture owners.
      }
    }
    lockedPrimaryOperation = undefined;
    try {
      clearPointerIntent();
    } catch {
      // Pointer presentation cannot interrupt gesture rollback.
    }
    return true;
  };
  abortGestureForCleanup = () => void abortActiveGesture();

  const onEscapeCapture = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    opts.setActionAnchor?.(null);
    opts.closeContextMenu?.();
    if (abortActiveGesture()) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (facilityBoundaryDraft) {
      e.preventDefault();
      e.stopImmediatePropagation();
      cancelFacilityBoundaryDraft();
    }
    if (stationBoundaryDraft) {
      e.preventDefault();
      e.stopImmediatePropagation();
      cancelStationBoundaryDraft();
    }
  };
  registerListener(
    () => window.addEventListener('keydown', onEscapeCapture, true),
    () => window.removeEventListener('keydown', onEscapeCapture, true),
  );

  // All discrete keyboard commands live in the declarative keymap. Here we only
  // supply it the context and let it drive the space-hold pan modifier.
  registerExtension(() =>
    opts.attachKeyboard({
      map,
      editor: store,
      openShortcuts: opts.openShortcuts,
      toggleUi: opts.toggleUi,
      setPanKeyHeld: (held) => {
        spaceHeld = held;
        if (lastPointer)
          publishPointerIntent(
            lastPointer,
            { ...modifierState(lastPointer.originalEvent), pan: held },
            false,
          );
        else canvas.style.cursor = held ? 'grab' : cursorFor();
      },
    }),
  );

  // Modifier key transitions occur independently of pointer movement. Reuse
  // the last real map hit so a held Shift/Alt/Ctrl immediately updates the
  // cursor badge while the pointer is stationary.
  const onModifierChange = (event: KeyboardEvent) => {
    if (!lastPointer) return;
    publishPointerIntent(lastPointer, modifierState(event));
  };
  registerListener(
    () => window.addEventListener('keydown', onModifierChange),
    () => window.removeEventListener('keydown', onModifierChange),
  );
  registerListener(
    () => window.addEventListener('keyup', onModifierChange),
    () => window.removeEventListener('keyup', onModifierChange),
  );
  registerExtension(() => opts.registerPointerIntentRefresh?.(refreshPointerIntent));

  function cursorFor(): string {
    // Hover presentation and press dispatch share resolvePointerIntent. The
    // fallback below only serves initial mount, before MapLibre has delivered
    // a real pointer position to classify.
    if (lastPointer) return intentAt(lastPointer, undefined, false).cursor;
    if (spaceHeld) return 'grab';
    // Diagram mode ignores the active tool entirely (nothing is drawable
    // there) — always the plain pan affordance, never a crosshair promising
    // a draw that won't happen.
    if (opts.isDiagramMode()) return 'grab';
    const tool = store.getState().tool;
    if (
      tool === 'way' ||
      tool === 'stop' ||
      tool === 'facility' ||
      tool === 'lines' ||
      tool === 'demolish'
    )
      return 'crosshair';
    // Select tool, empty space: left-drag pans here too (see onMouseDown), so
    // the grab cursor MapLibre already shows by default is actually honest —
    // explicit rather than relying on an inline-style reset falling through
    // to MapLibre's own CSS, which is what caused the mismatch in the first
    // place (this "" would inherit the container's cursor:grab regardless).
    if (tool === 'select') return 'grab';
    return 'default';
  }

  // Cursor must always match what a press would actually do right now — never
  // show an affordance the current tool/readOnly state can't back up.
  const draggable = () =>
    store.getState().tool === 'select' && !store.getState().readOnly && !opts.isDiagramMode();
  // Stations/handles/facilities: click-drag to select/reshape/reposition —
  // "grab" (not "pointer", which reads as "click this link/button") matches
  // the same drag-affordance convention as the map's own pan cursor. Which
  // of these you're over is disambiguated by SHAPE, not cursor: a station is
  // always a circle, a facility is always its own catalog pictogram, and a
  // reshape handle is always a plain solid square (see map/layers.ts) — none
  // of them can ever be mistaken for one another.
  // Only the Select tool's own drag affordance depends on draggable() (grab
  // to reshape/move) — every drawing tool (way/station/facility) still acts
  // on a click regardless of what's under the cursor, so its own crosshair
  // from cursorFor() stays accurate there and must NOT be overridden to
  // "default". The one real gap this closes: read-only + Select tool used
  // to keep showing "grab" over a station even though a press there did
  // nothing (dragging disabled, and it's not empty space either, so the pan
  // fallback doesn't kick in) — that's the only case that becomes "default".
  // A way's open end shares this cursor too — a plain drag there reshapes
  // it in place now, same verb as any other handle. Extending is the
  // Ctrl/Cmd-modified action (see startExtendDrag) and, like this app's
  // other modifier gestures (Alt-erase, Ctrl-split), doesn't get its own
  // hover cursor — only documented in the Inspector's hint text.
  const onEnterHandle = () => {
    if (draggable()) canvas.style.cursor = 'grab';
    else if (store.getState().tool === 'select') canvas.style.cursor = 'default';
  };
  const onLeaveFeature = () => {
    clearPointerIntent();
    canvas.style.cursor = cursorFor();
  };

  const onPointerUp = () => {
    lockedPrimaryOperation = undefined;
    canvas.style.cursor = cursorFor();
    clearPointerIntent();
  };
  const onPointerOut = () => {
    lastPointer = null;
    clearPointerIntent();
  };

  /**
   * The compatibility mouse events a browser emits after a motionless touch.
   *
   * This is the one place the mouse path cannot be entirely innocent of touch,
   * so it is named rather than hidden. The touch adapter drives each gesture
   * itself and then arms this; without it a long press would open the action
   * menu and immediately start a draw underneath it.
   *
   * 700ms covers the compatibility tail (~300ms in practice) without being long
   * enough to hold off a real mouse on a hybrid device, which would need
   * someone to touch the screen and grab the mouse inside the same gesture.
   */
  let ignoreCompatMouseUntil = 0;
  /**
   * True while the touch adapter is re-firing an event on the map itself.
   *
   * The window above cannot tell the adapter's own dispatch from the browser's
   * tail by timing alone — they overlap by design — so the dispatch says so
   * explicitly. Without this the window swallowed the very events it exists to
   * protect: the second tap of a double tap arrives inside the first tap's
   * window, so a line could never be finished by finger.
   */
  let dispatchingSynthetic = false;

  const ignoringCompatMouse = () =>
    !dispatchingSynthetic && ignoreCompatMouseUntil > 0 && Date.now() < ignoreCompatMouseUntil;

  registerExtension(() =>
    attachTouchGestures(map, {
      dispatch(type, event) {
        dispatchingSynthetic = true;
        try {
          map.fire(type, event);
        } finally {
          dispatchingSynthetic = false;
        }
      },
      startPan: (at) => startPan(at, false),
      abortGesture: () => void abortActiveGesture(),
      publishIntent: (at) => publishPointerIntent(at, undefined, false),
      dragPx,
      armCompatSuppression() {
        ignoreCompatMouseUntil = Date.now() + 700;
      },
    }),
  );

  registerListener(
    () => map.on('mousedown', onMouseDown),
    () => map.off('mousedown', onMouseDown),
  );
  registerListener(
    () => map.on('mouseup', onPointerUp),
    () => map.off('mouseup', onPointerUp),
  );
  registerListener(
    () => map.on('mousemove', onHoverMove),
    () => map.off('mousemove', onHoverMove),
  );
  registerListener(
    () => map.on('mouseout', onPointerOut),
    () => map.off('mouseout', onPointerOut),
  );
  registerListener(
    () => map.on('click', onClick),
    () => map.off('click', onClick),
  );
  registerListener(
    () => map.on('dblclick', onDblClick),
    () => map.off('dblclick', onDblClick),
  );
  const delegatedHandleLayers = [
    LYR_STATIONS,
    LYR_HANDLES,
    LYR_WAY_ENDPOINTS,
    LYR_FACILITIES,
    LYR_PHYSICAL_HANDLES,
  ].flatMap(eventLayerIds);
  for (const layerId of delegatedHandleLayers) {
    registerListener(
      () => map.on('mouseenter', layerId, onEnterHandle),
      () => map.off('mouseenter', layerId, onEnterHandle),
    );
    registerListener(
      () => map.on('mouseleave', layerId, onLeaveFeature),
      () => map.off('mouseleave', layerId, onLeaveFeature),
    );
  }
  registerListener(
    () => canvas.addEventListener('contextmenu', onContextMenu),
    () => canvas.removeEventListener('contextmenu', onContextMenu),
  );

  let lastTool = store.getState().tool;
  let lastActive = store.getState().activeWayId;
  let lastReadOnly = store.getState().readOnly;
  let lastSystemId = store.getState().system.id;
  registerExtension(() =>
    store.subscribe((s) => {
      if (s.system.id !== lastSystemId) {
        lastSystemId = s.system.id;
        abortActiveGesture(false);
      }
      if (s.tool !== lastTool) {
        lastTool = s.tool;
        canvas.style.cursor = cursorFor();
        clearPointerIntent();
        opts.setActionAnchor?.(null);
        if (s.tool !== 'way') {
          clearPreviews();
          setEndpointHint(null);
        }
        if (s.tool !== 'facility') facilityBoundaryDraft = null;
      }
      if (s.activeWayId !== lastActive) {
        lastActive = s.activeWayId;
        if (!s.activeWayId) {
          clearPreviews(); // clear rubber-band when a draw ends
          activeExtendAtStart = false;
          clearPointerIntent();
        }
      }
      if (s.readOnly !== lastReadOnly) {
        lastReadOnly = s.readOnly;
        // A transition to a shared snapshot invalidates a previously editable
        // hover even when the active tool happened to remain Select.
        clearPointerIntent();
        canvas.style.cursor = cursorFor();
      }
    }),
  );
  try {
    canvas.style.cursor = cursorFor();
  } catch (error) {
    cleanupAttachmentSetup();
    throw error;
  }

  return cleanupAttachmentSetup;

  // Constrain a dragged control point so its segment to a neighbor snaps to 45°.
  function constrainToNeighbor(wayId: string, index: number, coord: LngLat): LngLat {
    const way = store.getState().system.ways.find((w) => w.id === wayId);
    if (!way) return coord;
    const anchor = way.points[index - 1] ?? way.points[index + 1];
    return anchor ? angleSnap(anchor, coord) : coord;
  }

  // Index at which to insert a new control point given a screen click, so the
  // new vertex lands on the segment of the control polygon nearest the cursor.
  function insertIndexOnPolygon(points: LngLat[], pt: ScreenPoint): number {
    if (points.length < 2) return points.length;
    const px = points.map((p) => map.project(p));
    let best = points.length;
    let bestD = Infinity;
    for (let i = 0; i < px.length - 1; i++) {
      const d = distToSegment(pt, px[i], px[i + 1]);
      if (d < bestD) {
        bestD = d;
        best = i + 1;
      }
    }
    return best;
  }
}

// True if segment a→b crosses (or touches) the given axis-aligned box —
// used by startMarqueeSelect so a way is caught by the marquee even when it
// merely passes through the box without either endpoint or any resampled
// point landing inside it (a long straight way through a small box).
function segmentIntersectsBox(
  a: LngLat,
  b: LngLat,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean {
  if (Math.max(a[0], b[0]) < minX || Math.min(a[0], b[0]) > maxX) return false;
  if (Math.max(a[1], b[1]) < minY || Math.min(a[1], b[1]) > maxY) return false;
  const edges: [LngLat, LngLat][] = [
    [
      [minX, minY],
      [maxX, minY],
    ],
    [
      [maxX, minY],
      [maxX, maxY],
    ],
    [
      [maxX, maxY],
      [minX, maxY],
    ],
    [
      [minX, maxY],
      [minX, minY],
    ],
  ];
  return edges.some(([p3, p4]) => segmentsIntersect(a, b, p3, p4));
}

function segmentsIntersect(p1: LngLat, p2: LngLat, p3: LngLat, p4: LngLat): boolean {
  const d1x = p2[0] - p1[0];
  const d1y = p2[1] - p1[1];
  const d2x = p4[0] - p3[0];
  const d2y = p4[1] - p3[1];
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-15) return false; // parallel or collinear
  const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / denom;
  const u = ((p3[0] - p1[0]) * d1y - (p3[1] - p1[1]) * d1x) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function distToSegment(p: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * The unit direction vector from `a` to `b`, in local meters — null when the
 * two points are coincident, since a zero-length vector has no direction.
 * Shared by every heading/tangent gate in this file (continueStraight,
 * followCorridor) that needs "which way does this line point," so the
 * meters-space normalization lives in exactly one place.
 */
function unitVectorMeters(a: LngLat, b: LngLat): [number, number] | null {
  const [dx, dy] = metersFromOrigin(a, b);
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  return [dx / len, dy / len];
}

/**
 * A slice of `path`'s own points spanning at least `marginM` on either side
 * of arc-length position `nearM`, clamped to the path's bounds — enough
 * neighborhood for offsetPolyline's normal computation to stay accurate
 * without processing the whole path. followCorridor only ever consults the
 * offset near the drag point, but a long imported way can run thousands of
 * points, and this runs on every drag frame.
 */
function windowAroundArcLength(path: LngLat[], nearM: number, marginM: number): LngLat[] {
  const loBound = nearM - marginM;
  const hiBound = nearM + marginM;
  let acc = 0;
  let loIdx = -1;
  let hiIdx = path.length - 1;
  for (let i = 1; i < path.length; i++) {
    if (loIdx === -1 && acc >= loBound) loIdx = i - 1;
    acc += haversineMeters(path[i - 1], path[i]);
    if (acc >= hiBound) {
      hiIdx = i;
      break;
    }
  }
  return path.slice(loIdx === -1 ? 0 : loIdx, hiIdx + 1);
}

/**
 * Snap the vector from→to to the nearest 45° increment, as seen on screen.
 *
 * Measured in local meters rather than in raw degrees. A degree of longitude
 * spans only cos(latitude) as many meters as a degree of latitude, so doing
 * this trigonometry straight on lng/lat works in a sheared space: at Las
 * Vegas's ~36°N the old version's "45°" came out as 51.07° on screen, and a
 * line the user was promised would be diagonal rendered visibly off it.
 */
export function angleSnap(from: LngLat, to: LngLat): LngLat {
  const [dx, dy] = metersFromOrigin(from, to);
  const step = Math.PI / 4;
  const ang = Math.round(Math.atan2(dy, dx) / step) * step;
  const len = Math.hypot(dx, dy);
  return offsetMeters(from, Math.cos(ang) * len, Math.sin(ang) * len);
}

/**
 * Project `raw` onto the ray starting at `endpoint` heading away from
 * `behind` (the way's existing direction of travel) — but only while `raw`
 * sits within `maxDeviationMeters` of that ray. Outside it, returns null so
 * the caller falls back to the raw cursor: this is a snap, not a hard
 * constraint, so a deliberate turn is never fought.
 *
 * Gated on PERPENDICULAR DISTANCE, not on an angle, and that difference is
 * the whole point. An angle cone has no fixed width in the space the user is
 * actually working in: at a fixed 9° inside the old 10° cone, extending 200m
 * pulled the new point 31m sideways, but extending 2km pulled it 313m — the
 * further you drew, the harder it yanked, so drawing a long line at a slight
 * angle snapped bolt straight and felt like the tool overriding you. A
 * distance gate keeps the snap exactly as strong as it looks: the caller
 * passes a pixel budget converted to meters, so the cursor has to be within
 * that many pixels of the guide no matter how long the line or how far out
 * the zoom.
 *
 * Also computed in local meters instead of raw degrees. Because a degree of
 * longitude is only cos(latitude) as long as a degree of latitude, the old
 * degree-space cone measured 8.10° wide heading east but 12.31° heading
 * north — the assist was quietly stronger in some directions than others.
 */
export function continueStraight(
  endpoint: LngLat,
  behind: LngLat,
  raw: LngLat,
  maxDeviationMeters: number,
): LngLat | null {
  // Vector endpoint→behind, so the way's direction of travel is its negation.
  const behindUnit = unitVectorMeters(endpoint, behind);
  if (!behindUnit) return null;
  const nx = -behindUnit[0];
  const ny = -behindUnit[1];
  const [rx, ry] = metersFromOrigin(endpoint, raw);
  const along = rx * nx + ry * ny;
  if (along <= 0) return null; // only continue forward, never fold back over itself
  const perpendicular = Math.abs(rx * ny - ry * nx);
  if (perpendicular > maxDeviationMeters) return null;
  return offsetMeters(endpoint, nx * along, ny * along);
}
