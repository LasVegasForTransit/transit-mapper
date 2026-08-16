import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { computeDiagramSystem } from '@transitmapper/core/model/diagramLayout';
import {
  haversineMeters,
  metersFromOrigin,
  nearestOnPath,
  offsetMeters,
  resolveWayPath,
} from '@transitmapper/core/model/geo';
import { createEditorStore } from '../../src/editor/store';
import {
  angleSnap,
  attachInteractions,
  continueStraight,
  isDoubleClickFinish,
} from '../../src/map/interactions';
import { SRC_ENDPOINT_HINT, SRC_PREVIEW } from '../../src/map/layers';
import {
  attachOpts,
  createFakeMap,
  installFrameScheduler,
  mouseEvent,
  press,
  type FakePoint,
} from '../support/fakeMap.test';
import { required } from '../support/required.test';

function angleSnapErrorRad(
  p1: [number, number] | number[],
  p2: [number, number] | number[],
): number {
  const [dx, dy] = metersFromOrigin(p1 as [number, number], p2 as [number, number]);
  const angle = Math.atan2(dy, dx);
  const step = Math.PI / 4;
  return Math.abs(angle - Math.round(angle / step) * step);
}

describe('computeDiagramSystem snaps the graph to a schematic octolinear layout without losing topology or crashing on edge cases', () => {
  let store: ReturnType<typeof createEditorStore>;
  let wayA: string;
  let wayB: string;
  let stationId: string;
  let real: TransitSystem;
  let diagram: ReturnType<typeof computeDiagramSystem>;

  beforeEach(() => {
    store = createEditorStore();
    wayA = required(store.commands.ways.beginWay('lightRail', 'straight'));
    store.commands.ways.addWayPoint(wayA, [-115.2, 36.1]);
    store.commands.ways.addWayPoint(wayA, [-115.1, 36.1]);
    store.commands.ways.finishWay();
    wayB = required(store.commands.ways.beginWay('lightRail', 'straight'));
    store.commands.ways.addWayPoint(wayB, [-115.15, 36.2]);
    store.commands.ways.addWayPoint(wayB, [-115.15, 36.1]);
    store.commands.ways.finishWay();
    // Joins B onto A's midpoint — A gets a genuine interior node, not just an
    // endpoint junction, exercising the harder case (see joinWayPointToWay).
    store.commands.ways.joinWayPointToWay(wayB, 1, wayA, [-115.15, 36.1]);
    stationId = required(store.commands.stops.addStop([-115.15, 36.15], { wayId: wayB, t: 0.5 }));

    real = store.getState().system;
    diagram = computeDiagramSystem(real);
  });

  it('diagram preserves the way count', () => {
    expect(diagram.ways).toHaveLength(real.ways.length);
  });

  it('diagram preserves the stop count', () => {
    expect(diagram.stops).toHaveLength(real.stops.length);
  });

  it('every diagram way is straight geometry', () => {
    expect(diagram.ways.every((w) => w.geometry === 'straight')).toBe(true);
  });

  it('the shared junction lands on the exact same schematic coordinate on both ways (no desync)', () => {
    const diagAPoints = diagram.ways.find((w) => w.id === wayA)?.points ?? [];
    const diagBPoints = diagram.ways.find((w) => w.id === wayB)?.points ?? [];
    const bJunctionCoord = diagBPoints[diagBPoints.length - 1];

    expect(diagAPoints.some((p) => p[0] === bJunctionCoord[0] && p[1] === bJunctionCoord[1])).toBe(
      true,
    );
  });

  it('a node-bearing way keeps its shared junction between its endpoints', () => {
    const diagAPoints = diagram.ways.find((w) => w.id === wayA)?.points ?? [];
    const diagBPoints = diagram.ways.find((w) => w.id === wayB)?.points ?? [];
    const bJunctionCoord = diagBPoints[diagBPoints.length - 1];

    expect(
      diagAPoints.some(
        (point, index) =>
          index > 0 &&
          index < diagAPoints.length - 1 &&
          point[0] === bJunctionCoord[0] &&
          point[1] === bJunctionCoord[1],
      ),
    ).toBe(true);
  });

  it("an anchored stop still sits on its way's new schematic path", () => {
    const diagBPoints = diagram.ways.find((w) => w.id === wayB)?.points ?? [];
    const diagStationCoord = diagram.stops.find((s) => s.id === stationId)?.coord;

    const onPath = diagStationCoord ? nearestOnPath(diagBPoints, diagStationCoord) : null;

    expect(onPath).not.toBeNull();
    expect(onPath?.distMeters ?? Infinity).toBeLessThan(1);
  });

  it('every schematic edge lands close to a 45° multiple', () => {
    let maxAngleError = 0;
    for (const w of diagram.ways) {
      for (let i = 1; i < w.points.length; i++) {
        maxAngleError = Math.max(maxAngleError, angleSnapErrorRad(w.points[i - 1], w.points[i]));
      }
    }

    expect(maxAngleError).toBeLessThan(0.05);
  });

  it('computeDiagramSystem is memoized by system reference', () => {
    expect(computeDiagramSystem(real)).toBe(diagram);
  });

  it("computeDiagramSystem on an empty system doesn't crash and stays empty", () => {
    const empty = createEmptySystem();

    expect(computeDiagramSystem(empty).ways).toHaveLength(0);
  });

  it('a single unjoined way still gets a valid 2-point straightened path', () => {
    // A separate, plain store rather than the two-way fixture built above —
    // this case is specifically about a way with no joins at all.
    const soloStore = createEditorStore();
    const soloWay = required(soloStore.commands.ways.beginWay('road', 'straight'));
    soloStore.commands.ways.addWayPoint(soloWay, [-115.2, 36.1]);
    soloStore.commands.ways.addWayPoint(soloWay, [-115.19, 36.1003]);
    soloStore.commands.ways.finishWay();

    const soloDiagram = computeDiagramSystem(soloStore.getState().system);

    expect(soloDiagram.ways[0].points).toHaveLength(2);
  });
});

// Way tool double-click-to-finish must not place a duplicate point — see
// isDoubleClickFinish's own comment for the exact bug this guards against (a
// native double-click's second mousedown independently placing another point
// at ~the same spot the first one just did).
describe('Way tool double-click-to-finish must not place a duplicate point', () => {
  it('a plain single click (detail 1) still starts a draw press', () => {
    expect(isDoubleClickFinish(1)).toBe(false);
  });

  it("the double-click's second press (detail 2) is skipped", () => {
    expect(isDoubleClickFinish(2)).toBe(true);
  });

  it("even a rapid triple-click's third press stays skipped", () => {
    expect(isDoubleClickFinish(3)).toBe(true);
  });
});

// Draw assists are measured on screen, and stay as strong as they look. Both
// of these used to do their trigonometry directly on lng/lat. A degree of
// longitude spans only cos(latitude) as many meters as a degree of latitude,
// so that math ran in a sheared space and the assists came out visibly
// different from what they claimed to be.
describe('Draw assists are measured on screen, and stay as strong as they look', () => {
  const VEGAS: [number, number] = [-115.166, 36.116];
  // The true on-screen angle of from→to, in degrees CCW from east.
  const screenAngle = (from: [number, number], to: [number, number]) => {
    const [dx, dy] = metersFromOrigin(from, to);
    return (Math.atan2(dy, dx) * 180) / Math.PI;
  };
  const at = (from: [number, number], angleDeg: number, meters: number) => {
    const th = (angleDeg * Math.PI) / 180;
    return offsetMeters(from, Math.cos(th) * meters, Math.sin(th) * meters);
  };

  // Was 51.07° — a diagonal the user was promised rendered 6° off it.
  for (const target of [45, 135, -45, -135]) {
    it(`a Shift-constrained ${target}° really renders at ${target}° on screen`, () => {
      const snapped = angleSnap(VEGAS, at(VEGAS, target + 3, 2000));

      expect(Math.abs(screenAngle(VEGAS, snapped) - target)).toBeLessThan(0.01);
    });
  }

  it('angle-snapping preserves the drawn length', () => {
    expect(
      Math.abs(haversineMeters(VEGAS, angleSnap(VEGAS, at(VEGAS, 48, 2000))) - 2000),
    ).toBeLessThan(1);
  });

  // continueStraight: `behind` sits back along the heading, so travel is due
  // east here and the assist should pull a near-east cursor onto that line.
  const behind = at(VEGAS, 180, 1000);
  const BUDGET_M = 50; // stands in for STRAIGHT_SNAP_PX * metersPerPixel()

  it('a cursor right on the heading continues straight', () => {
    expect(continueStraight(VEGAS, behind, at(VEGAS, 0, 1000), BUDGET_M)).not.toBeNull();
  });

  it('a cursor just inside the budget still snaps', () => {
    expect(continueStraight(VEGAS, behind, at(VEGAS, 2.5, 1000), BUDGET_M)).not.toBeNull();
  });

  it('a deliberate turn is left alone', () => {
    expect(continueStraight(VEGAS, behind, at(VEGAS, 30, 1000), BUDGET_M)).toBeNull();
  });

  it('dragging backwards never folds the line over itself', () => {
    expect(continueStraight(VEGAS, behind, at(VEGAS, 175, 1000), BUDGET_M)).toBeNull();
  });

  // The regression that made this feel like the tool overriding you: with an
  // ANGLE cone, the same slight angle snapped harder the longer you drew, so
  // a long line drawn a couple of degrees off went bolt straight. With a
  // distance gate, drawing further only makes the assist easier to escape.
  const SLIGHT = 4; // degrees off the heading — inside the old 10° cone

  it('a slight angle still snaps when the extension is short', () => {
    expect(continueStraight(VEGAS, behind, at(VEGAS, SLIGHT, 300), BUDGET_M)).not.toBeNull();
  });

  it('the same slight angle drawn far does NOT get yanked straight', () => {
    expect(continueStraight(VEGAS, behind, at(VEGAS, SLIGHT, 3000), BUDGET_M)).toBeNull();
  });

  // Whatever the assist does accept, it never moves the point further than
  // the budget — that is what makes "as strong as it looks" true.
  it('the straight assist never moves a point further than its budget', () => {
    const overBudget: string[] = [];
    for (const deg of [0.5, 1, 2, 3, 5, 8]) {
      for (const dist of [200, 800, 2500, 6000]) {
        const raw = at(VEGAS, deg, dist);
        const got = continueStraight(VEGAS, behind, raw, BUDGET_M);
        if (got && haversineMeters(raw, got) > BUDGET_M + 1) {
          overBudget.push(`${deg}° @ ${dist}m`);
        }
      }
    }

    expect(overBudget).toEqual([]);
  });

  // Direction-independence: the old degree-space cone was 8.10° wide heading
  // east but 12.31° heading north, so the assist was quietly stronger in some
  // directions than others. Measure the widest deviation still accepted at a
  // fixed distance and require every heading to agree.
  it('the straight assist is equally strong in every direction', () => {
    const widestAccepted = (headingDeg: number) => {
      const back = at(VEGAS, headingDeg + 180, 1000);
      let widest = 0;
      for (let a = 0; a <= 20; a += 0.01) {
        if (continueStraight(VEGAS, back, at(VEGAS, headingDeg + a, 1000), BUDGET_M)) widest = a;
      }
      return widest;
    };
    const cones = [0, 45, 90, 135, 270].map(widestAccepted);

    expect(Math.max(...cones) - Math.min(...cones)).toBeLessThan(0.05);
  });
});

// A press that moves does not eat the NEXT click. Gestures that handle their
// own node placement set an internal `suppressClick` flag so onClick doesn't
// then act on the same press a second time. The flag is cleared by the click
// it was meant to suppress — but MapLibre only fires `click` when the pointer
// stayed within its clickTolerance (3px by default) between mousedown and
// mouseup; past that it drops the event outright (see maplibre-gl's own
// ui/handler/map_event.ts, `click()`). So a press with any real movement in
// it left the flag armed with no click coming to clear it, and the user's
// NEXT genuine click was swallowed instead — reproduced live as
// click/nothing/click while trying to start a light rail line, and felt
// random because whether it happens is just whether your hand moved 3
// pixels.
describe('A press that moves does not eat the NEXT click', () => {
  let pumpFrames: () => void;

  beforeEach(() => {
    const scheduler = installFrameScheduler();
    pumpFrames = () => scheduler.pump();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function run(presses: [number, number][]): number[] {
    const s = createEditorStore();
    s.commands.document.setSystem(createEmptySystem());
    s.commands.tools.setTool('stop');
    const map = createFakeMap();
    const detach = attachInteractions(map as never, s, attachOpts(true));
    const added: number[] = [];
    let x = 400;
    for (const [dx, dy] of presses) {
      const before = s.getState().system.stops.length;
      press(map, { x, y: 300 }, dx, dy);
      added.push(s.getState().system.stops.length - before);
      x += 40; // never place two stations on the same spot
    }
    detach();
    return added;
  }

  // Baseline: still-hand clicks each place a station, which is what makes
  // the failure below a regression in the moved-press case specifically and
  // not the station tool being broken generally.
  it('consecutive still clicks each place a station', () => {
    expect(
      run([
        [0, 0],
        [0, 0],
        [0, 0],
      ]),
    ).toEqual([1, 1, 1]);
  });

  // The bug. A moved press still places its own station (its mousedown/
  // mouseup gesture handles that itself) — what regressed is the press
  // AFTER it, which used to place nothing at all. Measured against the real
  // MapLibre build before the fix, this was [1, 0].
  it('a click right after a moved press still places a station', () => {
    expect(
      run([
        [8, 0],
        [0, 0],
      ]),
    ).toEqual([1, 1]);
  });

  // The user-visible shape of it: click, click, nothing, click — every press
  // works except the one following the press that moved. Before the fix this
  // was [1, 1, 0, 1].
  it('a moved press never leaves a later click silently doing nothing', () => {
    expect(
      run([
        [0, 0],
        [8, 0],
        [0, 0],
        [0, 0],
      ]),
    ).toEqual([1, 1, 1, 1]);
  });

  // Network view normally treats a press on compatible infrastructure as the
  // start of a route draft. An OPEN END is the exception: dragging the
  // endpoint must resume and extend that same way. Test a tram whose draft
  // carrier is light rail against a road, because mode compatibility is
  // deliberately wider than the one draft way type.
  describe('resuming a compatible open endpoint in Network view', () => {
    function setupOpenEndWay() {
      const s = createEditorStore();
      s.commands.document.setSystem(createEmptySystem());
      const map = createFakeMap();
      const roadStart = map.unproject({ x: 400, y: 300 });
      const roadEnd = map.unproject({ x: 600, y: 300 });
      const roadId = required(s.commands.ways.beginWay('road', 'straight'));
      s.commands.ways.addWayPoint(roadId, [roadStart.lng, roadStart.lat]);
      s.commands.ways.addWayPoint(roadId, [roadEnd.lng, roadEnd.lat]);
      s.commands.ways.finishWay();
      s.commands.tools.setDraftWayType('lightRail');
      s.commands.tools.setDraftMode('tram');
      s.commands.tools.setTool('way');

      const detach = attachInteractions(map as never, s, attachOpts(true));
      return { s, map, roadId, detach };
    }

    it('Network view marks every mode-compatible endpoint it will resume', () => {
      const { map, detach } = setupOpenEndWay();

      map.fire('mousemove', mouseEvent({ x: 600, y: 300 }, map));
      pumpFrames();

      expect(map.sourceData.get(SRC_ENDPOINT_HINT)?.features).toHaveLength(1);
      detach();
    });

    it("dragging a compatible way's own endpoint extends it in Network view", () => {
      const { s, map, roadId, detach } = setupOpenEndWay();

      map.fire('mousemove', mouseEvent({ x: 600, y: 300 }, map));
      pumpFrames();
      press(map, { x: 600, y: 300 }, 80, 40);
      const road = s.getState().system.ways.find((way) => way.id === roadId);

      expect(s.getState().system.ways).toHaveLength(1);
      expect(road?.points).toHaveLength(3);
      expect(s.getState().routeDraft).toBeNull();
      detach();
    });
  });

  /**
   * A fresh way-tool store with a two-point way already drawn due east —
   * shared by the WYSIWYG-preview and filleted-corner sections below, which
   * both start from exactly this fixture.
   */
  function setupWayDraw() {
    const s = createEditorStore();
    s.commands.document.setSystem(createEmptySystem());
    s.commands.tools.setTool('way');
    const map = createFakeMap();
    const detach = attachInteractions(map as never, s, attachOpts(false));
    // Two presses lay a way running due east, which gives it a heading for
    // continue-straight to work from.
    press(map, { x: 400, y: 300 });
    press(map, { x: 600, y: 300 });
    return { s, map, detach };
  }

  // --- What you see is what you get -------------------------------------
  // The rubber band is a promise about the geometry the next release will
  // create, so it has to be drawn through the SAME resolveEnd the release
  // commits with. It used to be drawn to the raw cursor instead, so every
  // draw assist that moved the point — continue-straight above all — left
  // the preview showing one line and the committed way rendering a
  // different one, with nothing on screen saying the assist had grabbed.
  describe('the rubber band preview matches what actually gets committed', () => {
    function gapAt(
      s: ReturnType<typeof createEditorStore>,
      map: ReturnType<typeof createFakeMap>,
      pt: FakePoint,
    ) {
      // Hover, read the rubber band, then release at the SAME point and read
      // what actually got committed. Any gap between them is a broken
      // promise.
      map.fire('mousemove', mouseEvent(pt, map));
      pumpFrames(); // the rubber band is written on the frame, not the event
      const preview = map.sourceData.get(SRC_PREVIEW);
      const band = preview?.features[0]?.geometry?.coordinates;
      const shown = band?.[band.length - 1];
      press(map, pt);
      const way = s.getState().system.ways[0];
      const committed = way.points[way.points.length - 1];
      if (!shown) return null;
      return haversineMeters(shown, committed);
    }

    it('the rubber band is drawn at all while extending', () => {
      const { s, map, detach } = setupWayDraw();

      // A hair off the heading: continue-straight grabs, so the preview has
      // to show the straightened point, not the cursor.
      const insideAssist = gapAt(s, map, { x: 800, y: 302 });

      expect(insideAssist).not.toBeNull();
      detach();
    });

    it('preview matches what gets committed when the straight-assist grabs', () => {
      const { s, map, detach } = setupWayDraw();

      const insideAssist = gapAt(s, map, { x: 800, y: 302 });

      expect(insideAssist).not.toBeNull();
      expect(insideAssist ?? Infinity).toBeLessThan(0.01);
      detach();
    });

    it('preview matches what gets committed on a deliberate turn', () => {
      const { s, map, detach } = setupWayDraw();

      // A deliberate turn: no assist, so preview and commit trivially agree —
      // worth pinning so a future "preview the raw cursor" shortcut can't
      // pass by only ever being tested outside the assist zone.
      const clearTurn = gapAt(s, map, { x: 900, y: 560 });

      expect(clearTurn).not.toBeNull();
      expect(clearTurn ?? Infinity).toBeLessThan(0.01);
      detach();
    });
  });

  // The rubber band has to promise the right SHAPE, not just the right end
  // point. Draft geometry is "curved" by default, so committing a point
  // rounds the corner at the previous endpoint — which, until that moment,
  // is an unfilleted line end. A straight two-point band showed a sharp
  // corner and then rendered a curve through it.
  describe('the rubber band previews the actual filleted corner shape', () => {
    it('a curved draft previews its rounded corner, not a bare two-point line', () => {
      const { map, detach } = setupWayDraw();

      // Hover somewhere that turns a clear corner, and capture the band.
      map.fire('mousemove', mouseEvent({ x: 700, y: 560 }, map));
      pumpFrames();
      const band = map.sourceData.get(SRC_PREVIEW)?.features[0]?.geometry?.coordinates ?? [];

      expect(band.length).toBeGreaterThan(2);
      detach();
    });

    it("every previewed point lies on the committed way's rendered path", () => {
      const { s, map, detach } = setupWayDraw();

      map.fire('mousemove', mouseEvent({ x: 700, y: 560 }, map));
      pumpFrames();
      const band = map.sourceData.get(SRC_PREVIEW)?.features[0]?.geometry?.coordinates ?? [];

      // Commit it, then resolve the way exactly as the map renders it. The
      // band must lie on that rendered path.
      press(map, { x: 700, y: 560 });
      const rendered = resolveWayPath(s.getState().system.ways[0]);
      const offPath = band.map((p) => {
        const near = nearestOnPath(rendered, p);
        return near ? near.distMeters : Infinity;
      });

      expect(offPath.length).toBeGreaterThan(0);
      expect(Math.max(...offPath)).toBeLessThan(0.01);
      detach();
    });

    it('the committed corner really is filleted away from the control point', () => {
      const { s, map, detach } = setupWayDraw();
      press(map, { x: 700, y: 560 });

      // And the corner really is rounded rather than the band merely being
      // subdivided along a straight line — otherwise the check above would
      // pass on a preview that still promised a sharp corner.
      const rendered = resolveWayPath(s.getState().system.ways[0]);
      const sharp = [
        [400, 300],
        [600, 300],
        [700, 560],
      ].map(([x, y]) => map.unproject({ x, y }));
      const cornerCut = nearestOnPath(rendered, [sharp[1].lng, sharp[1].lat]);

      expect(cornerCut?.distMeters ?? 0).toBeGreaterThan(1);
      detach();
    });
  });
});
