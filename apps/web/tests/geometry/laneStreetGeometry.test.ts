import { beforeEach, describe, expect, it } from 'vitest';
import { createEditorStore } from '../../src/editor/store';
import { buildFeatures } from '../../src/map/layers';
import {
  MODE_ORDER,
  MODES,
  PROFILE_PRESETS,
  vehicleFootprint,
} from '@transitmapper/core/model/catalog';
import { buildProfile, profileWidthM } from '@transitmapper/core/model/profile';
import {
  bearingAtT,
  metersFromOrigin,
  oneSection,
  patternRunSegments,
  patternSegments,
  rotatedRectPolygon,
  serviceLaneOnWay,
  wayById,
  wholeLegs,
} from '@transitmapper/core/model/geo';
import { wayLaneGeometry } from '@transitmapper/core/geometry/streets';
import { patternLanePath } from '@transitmapper/core/geometry/vehicleLane';
import type { LngLat, Way } from '@transitmapper/core/model/system';

describe('R2: per-lane street geometry (geometry/streets.ts)', () => {
  const road: Way = {
    id: 'lg',
    typeId: 'road',
    points: [
      [-115.2, 36.1],
      [-115.1, 36.1],
    ], // due east
    geometry: 'straight',
    grade: 'atGrade',
    profile: buildProfile(PROFILE_PRESETS.roadArterial5.lanes),
  };
  const g = wayLaneGeometry(road);

  it('wayLaneGeometry derives one path per lane', () => {
    expect(g.lanes.length).toBe(road.profile.lanes.length);
  });

  it('wayLaneGeometry memoizes per way object', () => {
    expect(wayLaneGeometry(road)).toBe(g);
  });

  it('total width matches the profile', () => {
    expect(Math.abs(g.totalWidthM - profileWidthM(road.profile))).toBeLessThan(1e-9);
  });

  it('lane offsets ascend left-to-right', () => {
    const offsets = g.lanes.map((l) => l.offsetM);
    expect(offsets.every((o, i) => i === 0 || o > offsets[i - 1])).toBe(true);
  });

  it('lane offsets are centered on the way', () => {
    const offsets = g.lanes.map((l) => l.offsetM);
    expect(Math.abs(offsets[0] + offsets[offsets.length - 1])).toBeLessThan(0.5);
  });

  it('leftmost lane sits left of travel (north when heading east)', () => {
    // Heading east: leftmost lane (negative offset = left of travel) is NORTH.
    const leftLane = g.lanes[0];
    expect(leftLane.path[0][1]).toBeGreaterThan(road.points[0][1]);
  });

  // 5-lane w/ center turn: 2 back | turn | 2 fwd → one center line between
  // backward drive and the bidirectional turn lane? No — center transitions
  // are backward→both→forward, so the double-yellow appears where directions
  // OPPOSE directly; here the turn pocket separates them, so we expect
  // laneLines between same-direction pairs and edge lines at the sidewalks.
  it('dividers include edge lines where roadway meets sidewalk', () => {
    expect(g.dividers.filter((d) => d.kind === 'edgeLine').length).toBe(2);
  });

  it('dividers include dashed lane lines between same-direction lanes', () => {
    expect(g.dividers.some((d) => d.kind === 'laneLine')).toBe(true);
  });

  it('opposing directions get a center line (4-lane, no median)', () => {
    const plain = buildProfile(PROFILE_PRESETS.roadArterial4.lanes);
    const g4 = wayLaneGeometry({ ...road, id: 'lg4', profile: plain });
    expect(g4.dividers.some((d) => d.kind === 'centerLine')).toBe(true);
  });

  it("backward lanes' arrow paths are reversed to travel direction", () => {
    const backArrows = g.arrows.filter((a) => a.direction === 'backward');
    expect(backArrows.every((a) => a.path[0][0] > a.path[a.path.length - 1][0])).toBe(true);
  });

  it('bidirectional lanes emit no arrows', () => {
    expect(g.arrows.every((a) => a.direction !== 'both')).toBe(true);
  });
});

describe('Vehicles in Infrastructure view: direction detection, lane selection, lane-aware pattern path (geometry/vehicleLane.ts)', () => {
  // Two ways end-to-start, end-to-start — the natural "keep going forward"
  // case: way B's stored points already run the direction of travel.
  const wayA: Way = {
    id: 'va',
    typeId: 'road',
    geometry: 'straight',
    grade: 'atGrade',
    points: [
      [-115.2, 36.1],
      [-115.19, 36.1],
    ],
    profile: { lanes: [] },
  };
  const wayB: Way = {
    id: 'vb',
    typeId: 'road',
    geometry: 'straight',
    grade: 'atGrade',
    points: [
      [-115.19, 36.1],
      [-115.18, 36.1],
    ],
    profile: { lanes: [] },
  };
  const twoWayIds = wayById([wayA, wayB]);
  const straightOn = { id: 'p1', sections: oneSection(wholeLegs(twoWayIds, ['va', 'vb'])) };
  const segs = patternSegments(twoWayIds, straightOn);

  it('first way in a pattern defaults to forward', () => {
    expect(segs[0].forward).toBe(true);
  });

  it('a way continuing in its own stored order is forward', () => {
    expect(segs[1].forward).toBe(true);
  });

  // way C's own points run the OPPOSITE direction of travel (start where
  // way A ends up, at the far end) — traversing it means walking it backward.
  const wayC: Way = {
    id: 'vc',
    typeId: 'road',
    geometry: 'straight',
    grade: 'atGrade',
    points: [
      [-115.18, 36.1],
      [-115.19, 36.1],
    ],
    profile: { lanes: [] },
  };
  const reversedIds = wayById([wayA, wayC]);
  const reversedSegs = patternSegments(reversedIds, {
    id: 'p2',
    sections: oneSection(wholeLegs(reversedIds, ['va', 'vc'])),
  });

  it('a way stored opposite the direction of travel is detected as backward', () => {
    expect(reversedSegs[1].forward).toBe(false);
  });

  it('the return run mirrors the outbound one', () => {
    // The return run is the outbound one mirrored — same ways in reverse order,
    // each traversed the other way round — so the two cannot disagree.
    const backSegs = patternRunSegments(
      reversedIds,
      { id: 'p2', sections: oneSection(wholeLegs(reversedIds, ['va', 'vc'])) },
      'inbound',
    );
    const mirrored = [...reversedSegs].reverse();
    expect(backSegs.length).toBe(mirrored.length);
    expect(backSegs.every((seg, i) => seg.wayIndex === mirrored[i].wayIndex)).toBe(true);
    expect(backSegs.every((seg, i) => seg.forward === !mirrored[i].forward)).toBe(true);
  });

  // A 4-lane road: sidewalk, 2 backward drive, 1 forward bus, 1 forward
  // drive, sidewalk — built directly as a profile so the test doesn't
  // depend on catalog defaults changing later.
  const road: Way = {
    id: 'vroad',
    typeId: 'road',
    geometry: 'straight',
    grade: 'atGrade',
    points: [
      [-115.2, 36.1],
      [-115.19, 36.1],
    ],
    profile: {
      lanes: [
        { id: 'sw1', kindId: 'sidewalk', widthM: 2, direction: 'both' },
        { id: 'd1', kindId: 'drive', widthM: 3.3, direction: 'backward' },
        { id: 'd2', kindId: 'drive', widthM: 3.3, direction: 'backward' },
        { id: 'b1', kindId: 'bus', widthM: 3.6, direction: 'forward' },
        { id: 'd3', kindId: 'drive', widthM: 3.3, direction: 'forward' },
        { id: 'sw2', kindId: 'sidewalk', widthM: 2, direction: 'both' },
      ],
    },
  };
  const roadIds = wayById([road]);
  const roadPattern = { id: 'vp', sections: oneSection(wholeLegs(roadIds, ['vroad'])) };
  const laneOf = (forward: boolean, modeId: string) =>
    road.profile.lanes.find(
      (l) => l.id === serviceLaneOnWay(roadPattern, 0, roadIds, modeId, forward),
    );

  // Lane choice is serviceLaneOnWay's, the same call that places the drawn
  // line. The vehicles used to select their own and land one lane inboard.
  it('a bus prefers the dedicated bus lane over a general drive lane', () => {
    expect(laneOf(true, 'bus')?.kindId).toBe('bus');
  });

  it("BRT also prefers the bus lane (shares bus's preference list)", () => {
    expect(laneOf(true, 'brt')?.kindId).toBe('bus');
  });

  it('no bus lane going the other way on this road — the return run takes a backward drive lane', () => {
    expect(laneOf(false, 'bus')?.kindId).toBe('drive');
  });

  it('the return run takes the CURB lane for its direction, the one the line is drawn in', () => {
    expect(laneOf(false, 'bus')?.id).toBe('d1');
  });

  it('the two runs never share a lane on a street that has one for each direction', () => {
    expect(laneOf(true, 'bus')?.id).not.toBe(laneOf(false, 'bus')?.id);
  });

  const lpWayA: Way = {
    id: 'lp-a',
    typeId: 'road',
    geometry: 'straight',
    grade: 'atGrade',
    points: [
      [-115.2, 36.1],
      [-115.19, 36.1],
    ],
    profile: {
      lanes: [
        { id: 'a-d1', kindId: 'drive', widthM: 3.3, direction: 'forward' },
        { id: 'a-d2', kindId: 'drive', widthM: 3.3, direction: 'backward' },
      ],
    },
  };
  const lpWayB: Way = {
    id: 'lp-b',
    typeId: 'road',
    geometry: 'straight',
    grade: 'atGrade',
    points: [
      [-115.19, 36.1],
      [-115.18, 36.1],
    ],
    profile: {
      lanes: [
        { id: 'b-d1', kindId: 'drive', widthM: 3.3, direction: 'forward' },
        { id: 'b-d2', kindId: 'drive', widthM: 3.3, direction: 'backward' },
      ],
    },
  };
  const lpPath = patternLanePath(
    [lpWayA, lpWayB],
    { id: 'lp1', sections: oneSection(wholeLegs(wayById([lpWayA, lpWayB]), ['lp-a', 'lp-b'])) },
    'bus',
  );

  it('patternLanePath produces a continuous path across both ways', () => {
    expect(lpPath.length).toBeGreaterThanOrEqual(2);
  });

  it("patternLanePath's endpoints roughly track the ways' own endpoints (offset by lane width, not miles)", () => {
    expect(Math.abs(lpPath[0][1] - 36.1)).toBeLessThan(0.001);
    expect(Math.abs(lpPath[lpPath.length - 1][1] - 36.1)).toBeLessThan(0.001);
  });
});

describe('Vehicles in Infrastructure view: bearing + rotated-rectangle footprint', () => {
  const dueNorth: LngLat[] = [
    [-115.2, 36.1],
    [-115.2, 36.11],
  ];

  it('bearingAtT reads ~0° (north) for a due-north path', () => {
    expect(
      Math.abs(bearingAtT(dueNorth, 0.5)) < 1 || Math.abs(bearingAtT(dueNorth, 0.5) - 360) < 1,
    ).toBe(true);
  });

  const dueEast: LngLat[] = [
    [-115.2, 36.1],
    [-115.19, 36.1],
  ];

  it('bearingAtT reads ~90° (east) for a due-east path', () => {
    expect(Math.abs(bearingAtT(dueEast, 0.5) - 90)).toBeLessThan(1);
  });

  it('bearingAtT on a too-short path returns 0 rather than throwing', () => {
    expect(bearingAtT([[-115.2, 36.1]], 0.5)).toBe(0);
  });

  const center: LngLat = [-115.2, 36.1];
  const ring = rotatedRectPolygon(center, 0, 3, 10); // facing due north

  it('rotatedRectPolygon returns a closed ring (5 points, first === last)', () => {
    expect(ring.length).toBe(5);
    expect(ring[0][0]).toBe(ring[4][0]);
    expect(ring[0][1]).toBe(ring[4][1]);
  });

  it('facing north, a corner sits ~half-length north/south and ~half-width east/west of center', () => {
    const [dx, dy] = metersFromOrigin(center, ring[0]);
    expect(Math.abs(Math.abs(dy) - 5)).toBeLessThan(0.1);
    expect(Math.abs(Math.abs(dx) - 1.5)).toBeLessThan(0.1);
  });

  it('a light rail vehicle is longer than a bus (real mode differentiation from size alone)', () => {
    expect(vehicleFootprint('lightRail').lengthM).toBeGreaterThan(vehicleFootprint('bus').lengthM);
  });

  it('an unknown mode falls back to the bus footprint', () => {
    expect(vehicleFootprint('nonexistent-mode').lengthM).toBe(vehicleFootprint('bus').lengthM);
  });

  it('every catalog mode has a default vehicle footprint', () => {
    expect(MODE_ORDER.every((id) => MODES[id].defaultFootprintM.widthM > 0)).toBe(true);
  });

  it('bus mode prefers a dedicated bus lane over a general drive lane', () => {
    expect(MODES.bus.preferredLaneKindIds?.[0]).toBe('bus');
  });

  it('subway prefers a track', () => {
    expect(MODES.subway.preferredLaneKindIds?.[0]).toBe('track');
  });

  // preferredLaneKinds reads this field and nothing else, so a mode that leaves
  // it unset silently loses its lane preference.
  it('every mode declares which lane kinds it prefers', () => {
    expect(Object.values(MODES).every((m) => (m.preferredLaneKindIds?.length ?? 0) > 0)).toBe(true);
  });
});

describe('R2: lane-detail rendering emission (LOD + viewport scoping)', () => {
  let store: ReturnType<typeof createEditorStore>;
  let roadId: string;

  beforeEach(() => {
    store = createEditorStore();
    roadId = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(roadId, [-115.2, 36.1]);
    store.getState().addWayPoint(roadId, [-115.1, 36.1]);
    store.getState().finishWay();
  });

  const filters = { visibleModes: new Set(Object.keys(MODES)), visibleWayTypes: new Set(['road']) };

  function nearFeatures(bounds?: [LngLat, LngLat]) {
    return buildFeatures(store.getState().system, null, [], {
      viewMode: 'infrastructure',
      ...filters,
      laneDetail: true,
      bounds,
    });
  }

  it('without laneDetail the fan renders and lanes stay empty', () => {
    const infraFar = buildFeatures(store.getState().system, null, [], {
      viewMode: 'infrastructure',
      ...filters,
    });
    expect(infraFar.lanes.features.length).toBe(0);
    expect(infraFar.ways.features.length).toBeGreaterThan(0);
  });

  it('laneDetail emits one surface per surface lane', () => {
    const infraNear = nearFeatures();
    const wayObj = store.getState().system.ways[0];
    expect(infraNear.lanes.features.length).toBe(wayObj.profile.lanes.length);
  });

  it('laneDetail replaces the fan for that way', () => {
    const infraNear = nearFeatures();
    expect(
      infraNear.ways.features.filter((f) => f.properties?.id === roadId && !f.properties.haloOnly)
        .length,
    ).toBe(0);
  });

  it('laneDetail emits markings', () => {
    expect(nearFeatures().laneMarkings.features.length).toBeGreaterThan(0);
  });

  it('laneDetail emits direction arrows', () => {
    expect(nearFeatures().laneArrows.features.length).toBeGreaterThan(0);
  });

  it('lane features carry a metric z14 pixel width', () => {
    expect(
      nearFeatures().lanes.features.every(
        (f) => typeof f.properties?.w14 === 'number' && f.properties.w14 > 0,
      ),
    ).toBe(true);
  });

  it('viewport scoping: offscreen ways keep the cheap fan', () => {
    const offscreen = nearFeatures([
      [-114.5, 36.5],
      [-114.4, 36.6],
    ]);
    expect(offscreen.lanes.features.length).toBe(0);
    expect(offscreen.ways.features.length).toBeGreaterThan(0);
  });

  it('network view never lane-renders', () => {
    const net = buildFeatures(store.getState().system, null, [], {
      viewMode: 'network',
      ...filters,
      laneDetail: true,
    });
    expect(net.lanes.features.length).toBe(0);
  });

  it('underground ways keep the dashed fan (no asphalt in a tunnel)', () => {
    store.getState().setWayGrade(roadId, 'underground');
    expect(nearFeatures().lanes.features.length).toBe(0);
  });
});

describe('R2: draft preset shapes newly drawn ways', () => {
  let store: ReturnType<typeof createEditorStore>;

  beforeEach(() => {
    store = createEditorStore();
  });

  it("armed draft preset shapes the new way's profile", () => {
    store.getState().setDraftWayType('road');
    store.getState().setDraftPreset('roadBoulevard');
    const r = store.getState().beginWay();
    store.getState().addWayPoint(r, [-115.2, 36.1]);
    store.getState().addWayPoint(r, [-115.1, 36.1]);
    store.getState().finishWay();
    const way = store.getState().system.ways[0];
    expect(way.profile.lanes.some((l) => l.kindId === 'median')).toBe(true);
  });

  it('armed draft preset sets the class too', () => {
    store.getState().setDraftWayType('road');
    store.getState().setDraftPreset('roadBoulevard');
    const r = store.getState().beginWay();
    store.getState().addWayPoint(r, [-115.2, 36.1]);
    store.getState().addWayPoint(r, [-115.1, 36.1]);
    store.getState().finishWay();
    const way = store.getState().system.ways[0];
    expect(way.classId).toBe('arterial');
  });

  it('changing way type clears the armed preset', () => {
    store.getState().setDraftWayType('road');
    store.getState().setDraftPreset('roadBoulevard');
    store.getState().setDraftWayType('heavyRail');
    expect(store.getState().draftPresetId).toBeNull();
  });
});
