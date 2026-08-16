import { beforeEach, describe, expect, it } from 'vitest';
import { createEditorStore } from '../../src/editor/store';
import { buildFeatures } from '../../src/map/layers';
import { KEY_BINDINGS } from '../../src/editor/keymap';
import { LANE_KINDS, MODES } from '@transitmapper/core/model/catalog';
import { defaultProfileFor } from '@transitmapper/core/model/profile';
import { trimPath, wayLaneGeometry } from '@transitmapper/core/geometry/streets';
import {
  classifyTurn,
  collectWayTrims,
  connectorCurves,
  defaultConnectors,
  effectiveConnectors,
  incomingLanes,
  junctionGeometry,
  outgoingLanes,
  type JunctionArm,
  type JunctionGeometry,
} from '@transitmapper/core/geometry/junctions';
import { armRefKey, getComponent, laneRefKey } from '@transitmapper/core/model/components';
import type { LngLat, Node, TransitSystem, Way } from '@transitmapper/core/model/system';

/** Narrows an optional lookup result without a non-null assertion: the
 * codebase's usual `!` shortcut is off-limits, and every call site here knows
 * from the fixture it just built that the value exists. */
function must<T>(value: T | null | undefined, label = 'value'): T {
  if (value == null) throw new Error(`expected ${label} to be defined`);
  return value;
}

const FILTERS = { visibleModes: new Set(Object.keys(MODES)), visibleWayTypes: new Set(['road']) };

function buildCrossing(store: ReturnType<typeof createEditorStore>) {
  const ew = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(ew, [-115.2, 36.1]);
  store.getState().addWayPoint(ew, [-115.1, 36.1]);
  store.getState().finishWay();
  const ns = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(ns, [-115.15, 36.05]);
  store.getState().addWayPoint(ns, [-115.15, 36.15]);
  store.getState().finishWay();
}

describe('R3: junction footprints, trims, connectors (geometry/junctions.ts)', () => {
  let store: ReturnType<typeof createEditorStore>;
  let sys: TransitSystem;
  let waysById: Map<string, Way>;
  let g: JunctionGeometry;
  let conns: ReturnType<typeof defaultConnectors>;

  beforeEach(() => {
    store = createEditorStore();
    // A real 4-way crossing built through the store (auto-junction on finish).
    buildCrossing(store);
    sys = store.getState().system;
    waysById = new Map(sys.ways.map((w) => [w.id, w]));
    g = must(junctionGeometry(sys.nodes[0], waysById), 'junction geometry');
    conns = defaultConnectors(sys.nodes[0], waysById);
  });

  it('finishing a crossing way auto-forms the junction (no manual call)', () => {
    expect(sys.nodes.length).toBe(1);
    expect(sys.ways.length).toBe(4);
  });

  it('junctionGeometry finds all four arms', () => {
    expect(g.arms.length).toBe(4);
  });

  it('every arm of a 4-way crossing trims back', () => {
    expect(g.arms.every((a) => a.trimM > 1)).toBe(true);
  });

  it("perpendicular trim ≈ the crossing road's half-width", () => {
    // Perpendicular same-width arms: trim ≈ the other road's half-width.
    const half = g.arms[0].halfWidthM;
    expect(g.arms.every((a) => Math.abs(a.trimM - half) < 1.5)).toBe(true);
  });

  it('footprint polygon has two corners per arm', () => {
    expect(g.polygon.length).toBe(8);
  });

  it("collectWayTrims records a trim for every arm's way", () => {
    expect(collectWayTrims([g]).size).toBe(4);
  });

  // Default lane connectivity: every approach can go somewhere; through
  // lanes map straight, edges turn.
  it('default connectors exist for every approach', () => {
    expect(g.arms.every((arm) => conns.some((c) => c.from.wayId === arm.wayId))).toBe(true);
  });

  it('default connectors include left, straight, and right turns', () => {
    const armByWayId = new Map(g.arms.map((a) => [a.wayId, a]));
    const classes = new Set<string>();
    for (const c of conns) {
      const inArm = must(armByWayId.get(c.from.wayId), 'in-arm');
      const outArm = must(armByWayId.get(c.to.wayId), 'out-arm');
      const hx = -inArm.dir[0],
        hy = -inArm.dir[1];
      const cross = hx * outArm.dir[1] - hy * outArm.dir[0];
      const dot = hx * outArm.dir[0] + hy * outArm.dir[1];
      classes.add(classifyTurn(Math.atan2(cross, dot)));
    }
    expect([...classes]).toEqual(expect.arrayContaining(['left', 'straight', 'right']));
  });

  it('no default u-turns', () => {
    expect(conns.every((c) => c.from.wayId !== c.to.wayId)).toBe(true);
  });

  it('every connector renders a curve', () => {
    const trims = collectWayTrims([g]);
    const curves = connectorCurves(sys.nodes[0], waysById, trims);
    expect(curves.length).toBe(conns.length);
    expect(curves.every((c) => c.path.length >= 2)).toBe(true);
  });

  it('stored connectors override the heuristic', () => {
    // Stored connectors override the defaults.
    store.getState().setNodeConnectors(sys.nodes[0].id, [conns[0]]);
    const sys2 = store.getState().system;
    const waysById2 = new Map(sys2.ways.map((w) => [w.id, w]));
    expect(effectiveConnectors(sys2.nodes[0], waysById2).length).toBe(1);
  });

  // Directional lane bookkeeping: an "end" arm's incoming lanes are its
  // forward lanes; a "start" arm's are its backward lanes.
  it("incoming/outgoing lane counts match the profile's split", () => {
    const anyWay = sys.ways[0];
    const isDirectional = (l: Way['profile']['lanes'][number], dir: string) =>
      l.direction === dir && LANE_KINDS[l.kindId].directional;
    const fwd = anyWay.profile.lanes.filter((l) => isDirectional(l, 'forward')).length;
    const back = anyWay.profile.lanes.filter((l) => isDirectional(l, 'backward')).length;
    expect(incomingLanes(anyWay, 'end').length).toBe(fwd);
    expect(outgoingLanes(anyWay, 'end').length).toBe(back);
  });
});

describe('turn restrictions: target-way identity, never an angle bucket (geometry/junctions.ts + editor/store.ts)', () => {
  let store: ReturnType<typeof createEditorStore>;
  let node: Node;
  let inArm: JunctionArm;
  let inLane: Way['profile']['lanes'][number];
  let unrestricted: ReturnType<typeof defaultConnectors>;
  let oneTarget: string;

  // True for a connector leading off the specific arm+lane under test —
  // `inArm`/`inLane` are rebound each test by `beforeEach` above, and this
  // closes over the current binding rather than a snapshot.
  function isTarget(c: { from: { wayId: string; laneId: string } }) {
    return c.from.wayId === inArm.wayId && c.from.laneId === inLane.id;
  }

  beforeEach(() => {
    store = createEditorStore();
    buildCrossing(store);
    const sys = store.getState().system;
    const waysById = new Map(sys.ways.map((w) => [w.id, w]));
    node = sys.nodes[0];
    const g = must(junctionGeometry(node, waysById), 'junction geometry');
    inArm = g.arms[0];
    inLane = incomingLanes(must(waysById.get(inArm.wayId), 'in-arm way'), inArm.end)[0];
    unrestricted = defaultConnectors(node, waysById).filter(isTarget);
    oneTarget = unrestricted[0].to.wayId;
  });

  function wById() {
    return new Map(store.getState().system.ways.map((w) => [w.id, w]));
  }

  it('this lane has more than one candidate target before any restriction', () => {
    expect(unrestricted.length).toBeGreaterThan(0);
  });

  it('a target-way restriction narrows default connectors to just that target', () => {
    store.getState().setTurnRestriction(inArm.wayId, inLane.id, [oneTarget]);
    const sys = store.getState().system;
    const restricted = defaultConnectors(node, wById(), sys.turnRestrictions).filter(isTarget);
    expect(restricted.length).toBeGreaterThan(0);
    expect(restricted.every((c) => c.to.wayId === oneTarget)).toBe(true);
  });

  it('an empty allow-list produces no default connector for that lane at all (the modal-filter case)', () => {
    store.getState().setTurnRestriction(inArm.wayId, inLane.id, []);
    const sys = store.getState().system;
    const blockedDefaults = defaultConnectors(node, wById(), sys.turnRestrictions);
    expect(blockedDefaults.some(isTarget)).toBe(false);
  });

  // A restriction also holds against an explicit user-set connector added
  // before the restriction existed — it's never silently bypassed.
  it('effectiveConnectors filters even explicit stored connectors by an active restriction', () => {
    store.getState().setTurnRestriction(inArm.wayId, inLane.id, [oneTarget]);
    // The active restriction by this point in the original sequence is the
    // empty allow-list set by the previous check, not [oneTarget].
    store.getState().setTurnRestriction(inArm.wayId, inLane.id, []);
    store.getState().setNodeConnectors(node.id, unrestricted);
    const sys = store.getState().system;
    const effective = effectiveConnectors(node, wById(), sys.turnRestrictions);
    expect(effective.some(isTarget)).toBe(false);
  });

  it('clearing a restriction (undefined) removes it from the component map', () => {
    store.getState().setTurnRestriction(inArm.wayId, inLane.id, [inArm.wayId]);
    store.getState().setTurnRestriction(inArm.wayId, inLane.id, undefined);
    const sys = store.getState().system;
    expect(getComponent(sys.turnRestrictions, laneRefKey(inArm.wayId, inLane.id))).toBeUndefined();
  });
});

// kind-aware straight-through pairing (geometry/junctions.ts) — a lane
// that changes position across a profile change (e.g. a bus lane moving
// from center-running to curbside) should still default-connect to the
// same-kind lane on the far side, not whatever shares its numeric index.
describe('kind-aware straight-through pairing (geometry/junctions.ts)', () => {
  const wA: Way = {
    id: 'wA',
    typeId: 'road',
    points: [
      [-115.2, 36.1],
      [-115.15, 36.1],
    ],
    geometry: 'straight',
    grade: 'atGrade',
    profile: {
      lanes: [
        { id: 'a-bus', kindId: 'bus', widthM: 3.6, direction: 'forward' },
        { id: 'a-drive', kindId: 'drive', widthM: 3.3, direction: 'forward' },
      ],
    },
  };
  const wB: Way = {
    id: 'wB',
    typeId: 'road',
    points: [
      [-115.15, 36.1],
      [-115.1, 36.1],
    ],
    geometry: 'straight',
    grade: 'atGrade',
    profile: {
      lanes: [
        { id: 'b-drive', kindId: 'drive', widthM: 3.3, direction: 'forward' },
        { id: 'b-bus', kindId: 'bus', widthM: 3.6, direction: 'forward' },
      ],
    },
  };
  const swapNode: Node = {
    id: 'nX',
    coord: [-115.15, 36.1],
    refs: [
      { wayId: 'wA', pointIndex: 1 },
      { wayId: 'wB', pointIndex: 0 },
    ],
  };
  const swapWaysById = new Map([
    ['wA', wA],
    ['wB', wB],
  ]);
  const swapConns = defaultConnectors(swapNode, swapWaysById);

  it('kind-aware pairing connects bus-to-bus despite differing array position', () => {
    const busConn = must(swapConns.find((c) => c.from.wayId === 'wA' && c.from.laneId === 'a-bus'));
    expect(busConn.to.laneId).toBe('b-bus');
  });

  it('kind-aware pairing connects drive-to-drive too', () => {
    const driveConn = must(
      swapConns.find((c) => c.from.wayId === 'wA' && c.from.laneId === 'a-drive'),
    );
    expect(driveConn.to.laneId).toBe('b-drive');
  });
});

describe('per-approach traffic control override (editor/store.ts)', () => {
  let store: ReturnType<typeof createEditorStore>;
  let node2Id: string;
  let arm: JunctionArm;

  beforeEach(() => {
    store = createEditorStore();
    buildCrossing(store);
    const node2 = store.getState().system.nodes[0];
    node2Id = node2.id;
    store.getState().setNodeControl(node2.id, 'signal');
    const waysById4 = new Map(store.getState().system.ways.map((w) => [w.id, w]));
    arm = must(junctionGeometry(node2, waysById4), 'junction geometry').arms[0];
  });

  function override() {
    return getComponent(store.getState().system.approachControls, armRefKey(arm.wayId, arm.end));
  }

  it('an approach has no override by default', () => {
    expect(override()).toBeUndefined();
  });

  it('setApproachControl stores an explicit per-approach override', () => {
    store.getState().setApproachControl(arm.wayId, arm.end, 'stop');
    expect(override()?.control).toBe('stop');
  });

  it('the whole-node control is untouched by a per-approach override', () => {
    store.getState().setApproachControl(arm.wayId, arm.end, 'stop');
    expect(store.getState().system.nodes.find((n) => n.id === node2Id)?.control).toBe('signal');
  });

  it("an explicit 'uncontrolled' override is distinct from having no override at all", () => {
    store.getState().setApproachControl(arm.wayId, arm.end, 'uncontrolled');
    expect(override()?.control).toBe('uncontrolled');
  });

  it('clearing the override (undefined) removes it, reverting to the junction default', () => {
    store.getState().setApproachControl(arm.wayId, arm.end, 'stop');
    store.getState().setApproachControl(arm.wayId, arm.end, undefined);
    expect(override()).toBeUndefined();
  });
});

describe('R3: trims flow into stage-1 lane geometry; trimPath behaves', () => {
  const line: LngLat[] = [
    [-115.2, 36.1],
    [-115.1, 36.1],
  ]; // ~9km east
  const road: Way = {
    id: 'tw',
    typeId: 'road',
    points: line,
    geometry: 'straight',
    grade: 'atGrade',
    profile: defaultProfileFor('road', 4),
  };

  it('trimPath crops both ends', () => {
    const trimmed = trimPath(line, 100, 200);
    expect(trimmed.length).toBe(2);
    expect(trimmed[0][0]).toBeGreaterThan(line[0][0]);
    expect(trimmed[1][0]).toBeLessThan(line[1][0]);
  });

  it('trimPath with zero trims returns the path unchanged', () => {
    expect(trimPath(line, 0, 0)).toBe(line);
  });

  it('trimPath consuming the whole path returns empty', () => {
    const short: LngLat[] = [
      [-115.2, 36.1],
      [-115.1999, 36.1],
    ];
    expect(trimPath(short, 50, 50).length).toBe(0);
  });

  it('trimmed lane geometry is cached separately from untrimmed', () => {
    const full = wayLaneGeometry(road);
    const cut = wayLaneGeometry(road, 15, 0);
    expect(full).not.toBe(cut);
  });

  it('trimmed lanes start ~15m in', () => {
    const full = wayLaneGeometry(road);
    const cut = wayLaneGeometry(road, 15, 0);
    const dx =
      (cut.lanes[0].path[0][0] - full.lanes[0].path[0][0]) *
      111320 *
      Math.cos((36.1 * Math.PI) / 180);
    expect(dx).toBeGreaterThan(13);
    expect(dx).toBeLessThan(17);
  });
});

describe('R3: two-arm straight-through joints stay seamless', () => {
  let g: JunctionGeometry;

  beforeEach(() => {
    const store = createEditorStore();
    const a = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(a, [-115.2, 36.1]);
    store.getState().addWayPoint(a, [-115.15, 36.1]);
    store.getState().addWayPoint(a, [-115.1, 36.1]);
    store.getState().finishWay();
    store.getState().splitWayAt(a, 1);
    const sys = store.getState().system;
    const waysById = new Map(sys.ways.map((w) => [w.id, w]));
    g = must(junctionGeometry(sys.nodes[0], waysById), 'junction geometry');
  });

  it('a straight-through split joint draws no junction polygon', () => {
    expect(g.polygon.length).toBe(0);
  });

  it('a straight-through joint trims nothing', () => {
    expect(g.arms.every((arm) => arm.trimM < 0.01)).toBe(true);
  });
});

describe('R3: lane-detail rendering emits junction footprints + connector guides', () => {
  let store: ReturnType<typeof createEditorStore>;
  let nodeId: string;

  beforeEach(() => {
    store = createEditorStore();
    buildCrossing(store);
    nodeId = store.getState().system.nodes[0].id;
  });

  function infraFeatures(
    laneDetail: boolean,
    selection: { kind: 'node'; id: string } | null = null,
  ) {
    return buildFeatures(store.getState().system, selection, [], {
      viewMode: 'infrastructure',
      ...FILTERS,
      laneDetail,
    });
  }

  it('lane detail emits the junction footprint', () => {
    expect(infraFeatures(true).junctions.features.length).toBe(1);
  });

  // Connector guides are scoped to the SELECTED junction — otherwise a complex
  // interchange renders as a star-burst of every junction's lane connectors.
  it('connector guides are hidden for unselected junctions', () => {
    expect(infraFeatures(true).connectors.features.length).toBe(0);
  });

  it('no junction polygons below lane-detail zoom', () => {
    expect(infraFeatures(false).junctions.features.length).toBe(0);
  });

  it("a selected junction's footprint is flagged", () => {
    const sel = infraFeatures(true, { kind: 'node', id: nodeId });
    expect(sel.junctions.features.some((f) => f.properties?.selected === true)).toBe(true);
  });

  it('a selected junction emits its connector guides', () => {
    const sel = infraFeatures(true, { kind: 'node', id: nodeId });
    expect(sel.connectors.features.length).toBeGreaterThan(0);
  });
});

describe('R4: street name labels + lane keyboard shortcuts', () => {
  let store: ReturnType<typeof createEditorStore>;

  beforeEach(() => {
    store = createEditorStore();
    const r = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(r, [-115.2, 36.1]);
    store.getState().addWayPoint(r, [-115.1, 36.1]);
    store.getState().finishWay();
    store.getState().nameWay(r, 'Decatur Avenue');
    store.getState().separateCarriageways(r);
  });

  it('both carriageways label as the one named street', () => {
    const infra = buildFeatures(store.getState().system, null, [], {
      viewMode: 'infrastructure',
      ...FILTERS,
    });
    const labels = infra.wayLabels.features.filter((f) => f.properties?.name === 'Decatur Avenue');
    expect(labels.length).toBe(2);
  });

  it('street labels are infrastructure-view detail', () => {
    const net = buildFeatures(store.getState().system, null, [], {
      viewMode: 'network',
      ...FILTERS,
    });
    expect(net.wayLabels.features.length).toBe(0);
  });

  it('lane shortcuts exist ([ ] D O + 9 presets)', () => {
    const laneBindings = KEY_BINDINGS.filter((b) => b.group === 'Lanes');
    expect(laneBindings.length).toBe(4 + 9);
  });

  it('preset shortcut keys are 1–9', () => {
    const laneBindings = KEY_BINDINGS.filter((b) => b.group === 'Lanes');
    expect(laneBindings.filter((b) => /^[1-9]$/.test(b.keys[0])).length).toBe(9);
  });
});
