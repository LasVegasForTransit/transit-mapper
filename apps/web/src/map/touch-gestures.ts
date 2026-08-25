import type { Map as MLMap, MapMouseEvent, MapTouchEvent } from 'maplibre-gl';

/**
 * Touch, as an ADAPTER onto the mouse vocabulary rather than a second
 * dispatcher.
 *
 * Every editing gesture in interactions.ts runs the same shape: a press
 * classifies its target and starts a loop bound to `map.on('mousemove')` /
 * `map.once('mouseup')`. Browsers emit no `mousemove` during a touch drag, so
 * none of it worked by finger. Rather than teach four hundred lines of dispatch
 * a second event vocabulary, this supplies the one it already speaks — so every
 * gesture below reaches the same dispatch and resolves through the same
 * pointer-intent verbs. Nothing here decides what a press means.
 *
 * The grammar:
 *
 * | Gesture          | Stands in for              |
 * | ---------------- | -------------------------- |
 * | one-finger drag  | left-drag: the active tool |
 * | two-finger drag  | right-drag / space-drag    |
 * | long press       | right-click                |
 * | tap, double tap  | click, double-click        |
 *
 * Pinch-zoom is MapLibre's own TwoFingersTouchZoomRotate and is untouched.
 *
 * It drives every one of those itself and then discards the compatibility mouse
 * events the browser may emit afterwards. Leaning on those instead was tried
 * and abandoned: whether they arrive depends on `touch-action`, on whether
 * anything called `preventDefault`, and on the engine — so a tap landed twice
 * in one browser and went missing in another. Confirmed live on a phone profile
 * both ways: three taps producing four control points, then three taps
 * producing two.
 */

/** A screen-space pixel coordinate, as MapLibre reports one. */
interface ScreenPoint {
  x: number;
  y: number;
}

type SyntheticMouseEvent = 'mousedown' | 'mousemove' | 'mouseup' | 'click' | 'dblclick';

/**
 * What this adapter needs from the dispatch it feeds.
 *
 * Six functions, none of which mention touch. That is the seam: everything
 * about fingers lives on this side of it, and interactions.ts supplies the
 * same operations it already performs for a mouse.
 */
export interface TouchGestureHost {
  /** Re-fire into the mouse vocabulary the dispatch already speaks. */
  dispatch: (type: SyntheticMouseEvent, event: MapMouseEvent) => void;
  /** Begin a camera pan. Two fingers mean the camera, and only the camera. */
  startPan: (at: MapMouseEvent) => void;
  /** Cancel whatever gesture is in flight, as Escape does. */
  abortGesture: () => void;
  /** Publish what the press under way would do, for the pointer badge. The
   *  badge is cleared by the dispatch's own mouseup handler, so there is no
   *  matching clear here. */
  publishIntent: (at: MapMouseEvent) => void;
  /** Movement past this is a drag rather than a tap — see editor/input-tuning. */
  dragPx: number;
  /** Called once a gesture ends, so the mouse path can ignore the browser's
   *  compatibility tail. The one place the mouse path cannot be innocent of
   *  touch, and it is named rather than hidden. */
  armCompatSuppression: () => void;
}

const LONG_PRESS_MS = 500;

/**
 * The gap between one finger LIFTING and the next landing.
 *
 * Read from the browser's own event timestamps rather than the clock: on real
 * hardware those record when the finger actually moved, so a person tapping at
 * a normal cadence still registers while the main thread is busy committing the
 * first tap.
 *
 * 500ms, matching the platform default for a double click, rather than the
 * 300ms a double tap nominally is. Dispatching a tap runs a store mutation and
 * a MapLibre repaint; that work lands inside the measured gap whenever the
 * browser stamps an event late, and at 300ms a double tap on a slow device
 * silently became two points and no finish. Widening it is safe because the
 * distance check is what actually prevents a false positive: two deliberate
 * points placed within a fingertip's width of each other are already
 * degenerate.
 */
const DOUBLE_TAP_MS = 500;

/** Which vocabulary the live gesture was committed to at touchstart. */
type GestureKind = 'pending' | 'tool' | 'camera' | 'actions';

/**
 * One record rather than seven bindings, because latching them together at
 * touchstart is the whole correctness argument: a finger lifting out of a
 * pinch must not convert a camera gesture into a draw across the map someone
 * was only trying to look at.
 */
interface LiveGesture {
  kind: GestureKind;
  point: ScreenPoint;
  event: MapTouchEvent;
  /** When the finger landed, by the browser's clock. */
  startedAt: number;
}

interface TouchListeners {
  readonly touchstart: (event: MapTouchEvent) => void;
  readonly touchmove: (event: MapTouchEvent) => void;
  readonly touchend: (event: MapTouchEvent) => void;
  readonly touchcancel: () => void;
}

interface TapHistory {
  endedAt: number;
  point: ScreenPoint | null;
}

interface FinishTouchOptions {
  readonly map: MLMap;
  readonly host: TouchGestureHost;
  readonly event: MapTouchEvent;
  readonly live: LiveGesture | null;
  readonly tap: TapHistory;
}

function attachTouchListeners(map: MLMap, listeners: TouchListeners): () => void {
  const cleanup: Array<() => void> = [];
  const releaseAll = () => {
    for (const release of cleanup.splice(0).reverse()) {
      try {
        release();
      } catch {
        // One MapLibre listener failure cannot strand the listeners before it.
      }
    }
  };
  const register = <EventName extends keyof TouchListeners>(
    type: EventName,
    listener: TouchListeners[EventName],
  ) => {
    try {
      map.on(type, listener);
      cleanup.push(() => map.off(type, listener));
    } catch (error) {
      releaseAll();
      throw error;
    }
  };
  register('touchstart', listeners.touchstart);
  register('touchmove', listeners.touchmove);
  register('touchend', listeners.touchend);
  register('touchcancel', listeners.touchcancel);
  return releaseAll;
}

function finishTouch(options: FinishTouchOptions): void {
  const { map, host, event, live, tap } = options;
  if (live === null) return;
  if (live.kind === 'pending') {
    const doubleTap =
      tap.point !== null &&
      live.startedAt - tap.endedAt < DOUBLE_TAP_MS &&
      Math.hypot(live.point.x - tap.point.x, live.point.y - tap.point.y) < host.dragPx;
    const detail = doubleTap ? 2 : 1;
    host.dispatch('mousedown', asMouseEvent(map, live.event, live.point, 0, detail));
    host.dispatch('mouseup', asMouseEvent(map, live.event, live.point, 0));
    host.dispatch('click', asMouseEvent(map, live.event, live.point, 0, detail));
    if (doubleTap) {
      host.dispatch('dblclick', asMouseEvent(map, live.event, live.point, 0, 2));
      tap.endedAt = 0;
      tap.point = null;
    } else {
      tap.endedAt = touchTime(event);
      tap.point = live.point;
    }
    host.armCompatSuppression();
    return;
  }
  // `touchend` carries only the touches that remain, so use the last known
  // point when the released finger was the final touch.
  const point = event.points.length > 0 ? event.point : live.point;
  host.dispatch('mouseup', asMouseEvent(map, event, point, live.kind === 'actions' ? 2 : 0));
  host.armCompatSuppression();
}

/** When a touch happened, as the browser recorded it. */
function touchTime(e: MapTouchEvent): number {
  return typeof e.originalEvent?.timeStamp === 'number' ? e.originalEvent.timeStamp : Date.now();
}

/**
 * A MapMouseEvent good enough for every consumer in the dispatch: it reads
 * `point` for hit-testing, `lngLat` for geometry, and `originalEvent` for the
 * button and modifier keys.
 */
function asMouseEvent(
  map: MLMap,
  source: MapTouchEvent,
  point: ScreenPoint,
  button: number,
  detail = 1,
): MapMouseEvent {
  // Viewport coordinates, which the action menu and the pointer badge position
  // against — `point` is canvas-relative and would place both wrong whenever
  // the canvas is inset. Read from the real TouchEvent where there is one,
  // falling back to the canvas point for the offsetless common case.
  const touch = source.originalEvent?.changedTouches?.[0] ?? source.originalEvent?.touches?.[0];
  return {
    point,
    lngLat: source.lngLat,
    target: map,
    originalEvent: {
      button,
      detail,
      clientX: touch?.clientX ?? point.x,
      clientY: touch?.clientY ?? point.y,
      // Touch supplies no modifier keys. Erase and split are reached as
      // variants on the Select tool's dock button instead, never as chorded
      // finger gestures.
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      preventDefault() {},
      stopPropagation() {},
    },
    preventDefault() {},
  } as unknown as MapMouseEvent;
}

export function attachTouchGestures(map: MLMap, host: TouchGestureHost): () => void {
  const { dispatch, dragPx } = host;
  let gesture: LiveGesture | null = null;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  const tap: TapHistory = { endedAt: 0, point: null };

  const cancelLongPress = () => {
    if (longPressTimer === null) return;
    clearTimeout(longPressTimer);
    longPressTimer = null;
  };

  const movedPastThreshold = (point: ScreenPoint): boolean =>
    gesture !== null && Math.hypot(point.x - gesture.point.x, point.y - gesture.point.y) >= dragPx;

  const onTouchStart = (e: MapTouchEvent) => {
    cancelLongPress();
    if (e.points.length >= 2) {
      if (gesture?.kind === 'tool' || gesture?.kind === 'actions') {
        dispatch('mouseup', asMouseEvent(map, e, e.point, 0));
      }
      gesture = { kind: 'camera', point: e.point, event: e, startedAt: touchTime(e) };
      // Called directly rather than through a synthetic right-button mousedown,
      // because the right-button path also owns finish-the-draw and
      // open-the-menu on release. Two fingers mean the camera and nothing else.
      host.startPan(asMouseEvent(map, e, e.point, 0));
      return;
    }
    gesture = { kind: 'pending', point: e.point, event: e, startedAt: touchTime(e) };
    // The badge, published before anything is dispatched. A mouse answers
    // "what will this press do" from an idle hover; a finger has no idle state,
    // so the answer moves inside the gesture — shown while the press is still
    // undecided and there is time to lift and cancel.
    host.publishIntent(asMouseEvent(map, e, e.point, 0));
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      if (gesture?.kind !== 'pending') return;
      const { event, point } = gesture;
      gesture = { ...gesture, kind: 'actions' };
      // Button 2 is the whole substitution: the dispatch routes it to the
      // right-button pan, whose release path already owns the one-way branch,
      // the finish-the-draw, and the action menu.
      dispatch('mousedown', asMouseEvent(map, event, point, 2));
      // Confirms a press that produced no visible motion. Absent on iOS, where
      // the menu appearing is the only feedback available.
      navigator.vibrate?.(10);
    }, LONG_PRESS_MS);
  };

  const onTouchMove = (e: MapTouchEvent) => {
    if (gesture === null) return;
    if (gesture.kind === 'pending') {
      if (!movedPastThreshold(e.point)) return;
      cancelLongPress();
      const { event, point } = gesture;
      gesture = { ...gesture, kind: 'tool' };
      // The press is replayed at the point the finger STARTED from, then moved
      // to where it is now. Dispatching it here instead would silently shift
      // every gesture's origin by the drag threshold.
      dispatch('mousedown', asMouseEvent(map, event, point, 0));
    }
    dispatch('mousemove', asMouseEvent(map, e, e.point, 0));
  };

  const onTouchEnd = (e: MapTouchEvent) => {
    cancelLongPress();
    const live = gesture;
    // A pinch releasing one finger at a time ends the camera gesture on the
    // first release; the remaining finger must not become a new draw.
    gesture = null;
    finishTouch({ map, host, event: e, live, tap });
  };

  // The system interrupted the gesture (an incoming call, a system edge swipe).
  // Treated as Escape rather than as a release: a drag the person never
  // finished must not commit wherever their finger happened to be.
  const onTouchCancel = () => {
    cancelLongPress();
    host.abortGesture();
    gesture = null;
  };

  const releaseListeners = attachTouchListeners(map, {
    touchstart: onTouchStart,
    touchmove: onTouchMove,
    touchend: onTouchEnd,
    touchcancel: onTouchCancel,
  });
  return () => {
    cancelLongPress();
    releaseListeners();
  };
}
