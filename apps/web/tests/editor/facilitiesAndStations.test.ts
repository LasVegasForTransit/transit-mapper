import { beforeEach, describe, expect, it } from 'vitest';
import { FACILITY_TYPES, MODES } from '@transitmapper/core/model/catalog';
import { primaryAnchor, squareFootprint } from '@transitmapper/core/model/geo';
import {
  directionalLanes,
  flipProfile,
  isOneWay,
  makeTwoWay,
} from '@transitmapper/core/model/profile';
import type { LngLat, Way } from '@transitmapper/core/model/system';
import { createEditorStore } from '../../src/editor/store';
import { buildFeatures, LAYER_SPECS } from '../../src/map/layers';

/** Throw-guard for a lookup this test's own setup guarantees succeeds — turns
 *  a silent `undefined`/`null` into a clear failure at the point of use
 *  instead of a confusing crash further down the assertion. */
function mustFind<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) throw new Error(`expected ${what}`);
  return v;
}

describe('facility tool: place-on-click semantics (complex is a variant, not a hidden default)', () => {
  it('facility tool starts in PLACE mode, not complex mode', () => {
    const store = createEditorStore();
    expect(store.getState().draftFacilityComplexMode).toBe(false);
  });

  it('complex mode is opt-in', () => {
    const store = createEditorStore();
    store.getState().setDraftFacilityComplexMode(true);
    expect(store.getState().draftFacilityComplexMode).toBe(true);
  });

  it('picking a facility type leaves complex mode', () => {
    const store = createEditorStore();
    store.getState().setDraftFacilityComplexMode(true);
    store.getState().setDraftFacilityType('depot');
    expect(store.getState().draftFacilityComplexMode).toBe(false);
  });

  it('an area facility placed by click gets a real polygon', () => {
    const store = createEditorStore();
    const fid = store.getState().addFacility('depot', squareFootprint([-115.15, 36.1], 15));
    const fac = mustFind(
      store.getState().system.facilities.find((f) => f.id === fid),
      'facility',
    );
    expect(Array.isArray(fac.geometry[0])).toBe(true);
    expect((fac.geometry as LngLat[]).length).toBe(4);
  });
});

describe('one-way affordances: draft toggle, endpoint branch, network chevrons', () => {
  it('draft one-way: drawn road is one-way', () => {
    const store = createEditorStore();
    store.getState().setDraftServiceEnabled(false);
    store.getState().setDraftOneWay(true);
    const r = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(r, [-115.3, 36.1]);
    store.getState().addWayPoint(r, [-115.1, 36.1]);
    store.getState().finishWay();
    const way = store.getState().system.ways[0];
    expect(isOneWay(way.profile)).toBe(true);
  });

  it('draft one-way: travel runs the draw direction (forward)', () => {
    const store = createEditorStore();
    store.getState().setDraftServiceEnabled(false);
    store.getState().setDraftOneWay(true);
    const r = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(r, [-115.3, 36.1]);
    store.getState().addWayPoint(r, [-115.1, 36.1]);
    store.getState().finishWay();
    const way = store.getState().system.ways[0];
    expect(directionalLanes(way.profile).every((l) => l.direction === 'forward')).toBe(true);
  });

  describe('endpoint branch', () => {
    let store: ReturnType<typeof createEditorStore>;
    let r: string;
    let way: Way;
    let branchId: string;
    let branch: Way;

    beforeEach(() => {
      store = createEditorStore();
      store.getState().setDraftServiceEnabled(false);
      store.getState().setDraftOneWay(true);
      r = store.getState().beginWay('road', 'straight');
      store.getState().addWayPoint(r, [-115.3, 36.1]);
      store.getState().addWayPoint(r, [-115.1, 36.1]);
      store.getState().finishWay();
      way = store.getState().system.ways[0];
      store.getState().setDraftOneWay(false);
      store.getState().nameWay(r, 'Main Street');
      branchId = mustFind(store.getState().beginOneWayBranch(r, 'end'), 'branch way id');
      const sys = store.getState().system;
      branch = mustFind(
        sys.ways.find((w) => w.id === branchId),
        'branch way',
      );
    });

    it("branch starts AT the source way's endpoint", () => {
      expect(branch.points.length).toBeGreaterThanOrEqual(1);
      expect(branch.points[0][0]).toBe(-115.1);
    });

    it('branch is one-way with fresh lane ids', () => {
      expect(isOneWay(branch.profile)).toBe(true);
      expect(branch.profile.lanes.every((l) => !way.profile.lanes.some((o) => o.id === l.id))).toBe(
        true,
      );
    });

    it('branch inherits type and class', () => {
      expect(branch.typeId).toBe(way.typeId);
      expect(branch.classId).toBe(way.classId);
    });

    it('branch is joined to the source at a real junction', () => {
      const sys = store.getState().system;
      expect(
        sys.nodes.some(
          (n) => n.refs.some((x) => x.wayId === branchId) && n.refs.some((x) => x.wayId === r),
        ),
      ).toBe(true);
    });

    it('branch continues the street identity', () => {
      const sys = store.getState().system;
      expect(
        sys.namedWays.some((n) => n.name === 'Main Street' && n.wayIds.includes(branchId)),
      ).toBe(true);
    });

    it('branch becomes the active draw with one-way armed', () => {
      expect(store.getState().activeWayId).toBe(branchId);
      expect(store.getState().draftOneWay).toBe(true);
    });
  });

  describe('network view chevrons', () => {
    let store: ReturnType<typeof createEditorStore>;
    const filters = {
      visibleModes: new Set(Object.keys(MODES)),
      visibleWayTypes: new Set(['road']),
    };

    beforeEach(() => {
      store = createEditorStore();
      store.getState().setDraftOneWay(true);
      const ow = store.getState().beginWay('road', 'straight');
      store.getState().addWayPoint(ow, [-115.3, 36.1]);
      store.getState().addWayPoint(ow, [-115.1, 36.1]);
      store.getState().finishWay();
      store.getState().setDraftOneWay(false);
      store.getState().addServiceToWay(ow);
    });

    it('network view emits chevrons for a served one-way way', () => {
      const net = buildFeatures(store.getState().system, null, [], {
        viewMode: 'network',
        ...filters,
      });
      expect(net.laneArrows.features.length).toBe(1);
    });

    it('flipping the way reverses the chevron direction', () => {
      const net = buildFeatures(store.getState().system, null, [], {
        viewMode: 'network',
        ...filters,
      });
      const ow = store.getState().system.ways[0].id;
      const wref = mustFind(
        store.getState().system.ways.find((w) => w.id === ow),
        'way',
      );
      store.getState().setWayProfile(ow, flipProfile(wref.profile));
      const net2 = buildFeatures(store.getState().system, null, [], {
        viewMode: 'network',
        ...filters,
      });
      const c1 = net.laneArrows.features[0].geometry.coordinates[0][0];
      const c2 = net2.laneArrows.features[0].geometry.coordinates[0][0];
      expect(c1).not.toBe(c2);
    });

    it('two-way ways get no chevrons in network view', () => {
      const ow = store.getState().system.ways[0].id;
      store.getState().setWayProfile(ow, makeTwoWay(store.getState().system.ways[0].profile));
      const net3 = buildFeatures(store.getState().system, null, [], {
        viewMode: 'network',
        ...filters,
      });
      expect(net3.laneArrows.features.length).toBe(0);
    });
  });
});

describe('station DRAWING: a dragged footprint is a real station', () => {
  let store: ReturnType<typeof createEditorStore>;
  let r: string;

  beforeEach(() => {
    store = createEditorStore();
    store.getState().setDraftServiceEnabled(false);
    r = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(r, [-115.2, 36.1]);
    store.getState().addWayPoint(r, [-115.1, 36.1]);
    store.getState().finishWay();
    store.getState().setDraftServiceEnabled(true);
  });

  it('drawn station carries its footprint', () => {
    const fp = squareFootprint([-115.15, 36.1], 25);
    const sid = store.getState().addDrawnStation(fp);
    const st1 = mustFind(
      store.getState().system.stations.find((x) => x.id === sid),
      'station',
    );
    expect(st1.footprint).toBe(fp);
  });

  it('drawn station anchors onto the way it straddles', () => {
    const fp = squareFootprint([-115.15, 36.1], 25);
    const sid = store.getState().addDrawnStation(fp);
    const st1 = mustFind(
      store.getState().system.stations.find((x) => x.id === sid),
      'station',
    );
    expect(primaryAnchor(st1)?.wayId).toBe(r);
  });

  it("drawn station's coord sits on the way", () => {
    const fp = squareFootprint([-115.15, 36.1], 25);
    const sid = store.getState().addDrawnStation(fp);
    const st1 = mustFind(
      store.getState().system.stations.find((x) => x.id === sid),
      'station',
    );
    expect(Math.abs(st1.coord[1] - 36.1)).toBeLessThan(1e-6);
  });

  it('drawn station is selected for immediate platform work', () => {
    const fp = squareFootprint([-115.15, 36.1], 25);
    const sid = store.getState().addDrawnStation(fp);
    // Read the selection once: two separate getState() calls can't be
    // narrowed together, and the second was reading through a possibly-null
    // value.
    const drawnSelection = store.getState().selection;
    expect(drawnSelection?.kind).toBe('station');
    expect(drawnSelection?.id).toBe(sid);
  });

  it('a footprint away from any way makes a free station', () => {
    const fp2 = squareFootprint([-115.4, 36.3], 25);
    const sid2 = store.getState().addDrawnStation(fp2);
    const st2 = mustFind(
      store.getState().system.stations.find((x) => x.id === sid2),
      'station',
    );
    expect(st2.anchors.length).toBe(0);
    expect(st2.footprint).toBe(fp2);
  });
});

describe('station land + structures: the border IS the station; structures on its land belong to it and are real shapes', () => {
  let store: ReturnType<typeof createEditorStore>;
  let sid: string;

  beforeEach(() => {
    store = createEditorStore();
    const land = squareFootprint([-115.15, 36.1], 60);
    sid = store.getState().addDrawnStation(land);
    store.getState().setStationName(sid, 'Bonneville Transit Center');
  });

  it('a building is a drawn shape, not a point', () => {
    const bldg = store
      .getState()
      .addFacility('building', squareFootprint([-115.1502, 36.1002], 12));
    const sys = store.getState().system;
    const bf = mustFind(
      sys.facilities.find((f) => f.id === bldg),
      'facility',
    );
    expect(Array.isArray(bf.geometry[0])).toBe(true);
  });

  it("a structure on station land joins the station's complex", () => {
    const bldg = store
      .getState()
      .addFacility('building', squareFootprint([-115.1502, 36.1002], 12));
    const sys = store.getState().system;
    const complex = sys.groups.find((g) => g.memberIds.includes(sid));
    expect(complex).toBeDefined();
    expect(mustFind(complex, 'complex').memberIds).toContain(bldg);
  });

  it('the complex is named after the station', () => {
    store.getState().addFacility('building', squareFootprint([-115.1502, 36.1002], 12));
    const sys = store.getState().system;
    const complex = sys.groups.find((g) => g.memberIds.includes(sid));
    expect(mustFind(complex, 'complex').name).toBe('Bonneville Transit Center complex');
  });

  it('further structures join the same complex (no duplicates)', () => {
    store.getState().addFacility('building', squareFootprint([-115.1502, 36.1002], 12));
    const bay = store.getState().addFacility('busBay', squareFootprint([-115.1498, 36.0998], 8));
    const sys = store.getState().system;
    expect(sys.groups.length).toBe(1);
    expect(sys.groups[0].memberIds).toContain(bay);
  });

  it('a point access on the land joins the station', () => {
    store.getState().addFacility('building', squareFootprint([-115.1502, 36.1002], 12));
    const door = store.getState().addFacility('entrance', [-115.1501, 36.1001]);
    const sys = store.getState().system;
    expect(sys.groups[0].memberIds).toContain(door);
  });

  it('a facility off the land stays independent', () => {
    store.getState().addFacility('building', squareFootprint([-115.1502, 36.1002], 12));
    const remote = store.getState().addFacility('entrance', [-115.4, 36.4]);
    const sys = store.getState().system;
    expect(sys.groups[0].memberIds).not.toContain(remote);
    expect(sys.groups.length).toBe(1);
  });

  it('Building is a real area facility type', () => {
    expect(FACILITY_TYPES.building.geometryKind).toBe('area');
  });
});

describe('paint-order invariants: the street surface is the GROUND', () => {
  // Station/complex footprints must paint ABOVE lane asphalt and junction
  // fills, or a footprint straddling a lane-rendered street is invisible
  // (the "station boundaries only show while dragging corners" bug).
  const order = LAYER_SPECS.map((l) => l.id);
  const above = (upper: string, lower: string) =>
    order.indexOf(upper) > order.indexOf(lower) && order.includes(lower);

  it('footprint fill paints above lane surfaces', () => {
    expect(above('tm-footprints-fill', 'tm-lane-surfaces')).toBe(true);
  });

  it('footprint fill paints above junction fills', () => {
    expect(above('tm-footprints-fill', 'tm-junctions')).toBe(true);
  });

  it('platform fill paints above lane surfaces', () => {
    expect(above('tm-platforms-fill', 'tm-lane-surfaces')).toBe(true);
  });

  it('station markers paint above footprints', () => {
    expect(above('tm-stations', 'tm-footprints-fill')).toBe(true);
  });
});
