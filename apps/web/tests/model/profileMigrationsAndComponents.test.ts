// Converted from apps/web/tests/verify.test.ts lines 6494-7010 (8 sections).
import { describe, expect, it } from 'vitest';
import {
  buildProfile,
  combineProfiles,
  defaultProfileFor,
  directionalLanes,
  flipProfile,
  isOneWay,
  laneCapacity,
  makeOneWay,
  makeTwoWay,
  profileWidthM,
  separateProfiles,
  travelLanes,
  wayCapacity,
  withLaneCount,
} from '@transitmapper/core/model/profile';
import { PROFILE_PRESETS } from '@transitmapper/core/model/catalog';
import {
  armRefKey,
  getComponent,
  laneRefKey,
  withComponent,
  withoutComponent,
} from '@transitmapper/core/model/components';
import {
  haversineMeters,
  legIsWhole,
  legRunsWithPoints,
  offsetPolyline,
  pathLengthMeters,
  patternLegs,
  patternPath,
} from '@transitmapper/core/model/geo';
import { createEmptySystem, parseSystem } from '@transitmapper/core/model/serialize';
import type { CrossSection, LngLat, Way } from '@transitmapper/core/model/system';

describe('profile ops', () => {
  const road = defaultProfileFor('road', 4);

  it('defaultProfileFor(road, 4) carries 4 counted lanes', () => {
    expect(laneCapacity(road)).toBe(4);
  });

  it('default 4-lane road splits 2 backward / 2 forward', () => {
    expect(
      travelLanes(road).filter((l) => l.direction === 'forward' && l.kindId === 'drive').length,
    ).toBe(2);
  });

  it('lane ids are unique within a profile', () => {
    expect(new Set(road.lanes.map((l) => l.id)).size).toBe(road.lanes.length);
  });

  it('profile width sums lane widths', () => {
    expect(
      Math.abs(profileWidthM(road) - road.lanes.reduce((s, l) => s + l.widthM, 0)),
    ).toBeLessThan(1e-9);
  });

  it('odd capacity puts the extra lane forward', () => {
    const odd = defaultProfileFor('road', 5);
    expect(odd.lanes.filter((l) => l.kindId === 'drive' && l.direction === 'forward').length).toBe(
      3,
    );
  });

  it('capacity 1 becomes one bidirectional lane', () => {
    const single = defaultProfileFor('road', 1);
    expect(
      travelLanes(single)
        .filter((l) => l.kindId === 'drive')
        .every((l) => l.direction === 'both'),
    ).toBe(true);
  });

  it('flipProfile reverses lane order', () => {
    const flipped = flipProfile(road);
    expect(flipped.lanes[0].id).toBe(road.lanes[road.lanes.length - 1].id);
  });

  it('flipProfile swaps directions', () => {
    const flipped = flipProfile(road);
    expect(
      flipped.lanes.every((l) => {
        const orig = road.lanes.find((o) => o.id === l.id)!;
        return orig.direction === 'forward'
          ? l.direction === 'backward'
          : orig.direction === 'backward'
            ? l.direction === 'forward'
            : l.direction === orig.direction;
      }),
    ).toBe(true);
  });

  it('flipProfile twice is identity', () => {
    const flipped = flipProfile(road);
    expect(flipProfile(flipped)).toEqual(road);
  });

  it('makeOneWay makes every travel lane forward', () => {
    const oneWay = makeOneWay(road, 'forward');
    expect(isOneWay(oneWay)).toBe(true);
  });

  it('makeOneWay leaves separators/edges alone', () => {
    const oneWay = makeOneWay(road, 'forward');
    expect(
      oneWay.lanes.filter((l) => l.kindId === 'sidewalk').every((l) => l.direction === 'both'),
    ).toBe(true);
  });

  it('makeTwoWay restores a directional split', () => {
    const oneWay = makeOneWay(road, 'forward');
    const twoWay = makeTwoWay(oneWay);
    expect(isOneWay(twoWay)).toBe(false);
    expect(travelLanes(twoWay).some((l) => l.direction === 'backward')).toBe(true);
  });

  it('withLaneCount grows to the target', () => {
    const widened = withLaneCount(road, 'road', 6);
    expect(laneCapacity(widened)).toBe(6);
  });

  it('withLaneCount keeps the directional split balanced', () => {
    const widened = withLaneCount(road, 'road', 6);
    const fwd6 = widened.lanes.filter(
      (l) => l.kindId === 'drive' && l.direction === 'forward',
    ).length;
    expect(fwd6).toBe(3);
  });

  it('withLaneCount shrinks to the target', () => {
    const widened = withLaneCount(road, 'road', 6);
    const narrowed = withLaneCount(widened, 'road', 2);
    expect(laneCapacity(narrowed)).toBe(2);
  });

  it('withLaneCount(1) floors at one lane', () => {
    expect(laneCapacity(withLaneCount(road, 'road', 0))).toBe(1);
  });

  it('widening a one-way road stays one-way', () => {
    const oneWayWidened = withLaneCount(
      makeOneWay(defaultProfileFor('road', 2), 'forward'),
      'road',
      3,
    );
    expect(isOneWay(oneWayWidened)).toBe(true);
    expect(laneCapacity(oneWayWidened)).toBe(3);
  });
});

describe('carriageway separation / combination (profile level)', () => {
  const boulevard = buildProfile(PROFILE_PRESETS.roadBoulevard.lanes);
  const sep = separateProfiles(boulevard)!;

  it('separateProfiles splits a divided boulevard', () => {
    expect(sep).not.toBeNull();
  });

  it('forward carriageway is one-way forward', () => {
    expect(isOneWay(sep.forward)).toBe(true);
    expect(directionalLanes(sep.forward).every((l) => l.direction === 'forward')).toBe(true);
  });

  it('backward carriageway is one-way backward', () => {
    expect(directionalLanes(sep.backward).every((l) => l.direction === 'backward')).toBe(true);
  });

  it('the median itself is dropped (the physical gap replaces it)', () => {
    expect([...sep.forward.lanes, ...sep.backward.lanes].every((l) => l.kindId !== 'median')).toBe(
      true,
    );
  });

  it("each carriageway keeps its own side's bike lane", () => {
    expect(sep.forward.lanes.some((l) => l.kindId === 'bike')).toBe(true);
    expect(sep.backward.lanes.some((l) => l.kindId === 'bike')).toBe(true);
  });

  it('separateProfiles refuses a one-way profile', () => {
    expect(separateProfiles(makeOneWay(boulevard, 'forward'))).toBeNull();
  });

  it('combineProfiles restores two-way travel', () => {
    const recombined = combineProfiles(sep.backward, sep.forward);
    expect(isOneWay(recombined)).toBe(false);
    expect(travelLanes(recombined).some((l) => l.direction === 'forward')).toBe(true);
    expect(travelLanes(recombined).some((l) => l.direction === 'backward')).toBe(true);
  });

  it('combineProfiles inserts a median between the halves', () => {
    const recombined = combineProfiles(sep.backward, sep.forward);
    expect(recombined.lanes.some((l) => l.kindId === 'median')).toBe(true);
  });

  it('combineProfiles accepts a captured width/kind instead of the catalog default', () => {
    const recombinedKind = combineProfiles(sep.backward, sep.forward, 5, 'railReservation');
    expect(recombinedKind.lanes.some((l) => l.kindId === 'railReservation' && l.widthM === 5)).toBe(
      true,
    );
  });
});

describe('ECS-shaped component registry (model/components.ts)', () => {
  const empty: Record<string, { n: number }> = {};
  const withA = withComponent(empty, 'a', { n: 1 });

  it('withComponent adds without mutating the original map', () => {
    expect(empty.a).toBeUndefined();
    expect(withA.a?.n).toBe(1);
  });

  it('getComponent reads a present key', () => {
    expect(getComponent(withA, 'a')?.n).toBe(1);
  });

  it('getComponent reads an absent key as undefined', () => {
    expect(getComponent(withA, 'b')).toBeUndefined();
  });

  it('withoutComponent removes only the given key', () => {
    const withB = withComponent(withA, 'b', { n: 2 });
    const withoutA = withoutComponent(withB, 'a');
    expect(withoutA.a).toBeUndefined();
    expect(withoutA.b?.n).toBe(2);
  });

  it('withoutComponent on an absent key is a no-op (same reference)', () => {
    const withB = withComponent(withA, 'b', { n: 2 });
    expect(withoutComponent(withB, 'z')).toBe(withB);
  });

  it('laneRefKey/armRefKey format lane and arm references', () => {
    expect(laneRefKey('w1', 'l1')).toBe('w1:l1');
    expect(armRefKey('w1', 'start')).toBe('w1:start');
  });
});

// driving side (model/profile.ts) — target-way/kind identity, never an angle
// bucket, is what makes turn restrictions robust; drivingSide is the one
// place actual left/right geometry matters, and it's isolated to these three
// functions.
describe('driving side (model/profile.ts)', () => {
  // separateProfiles: which array-half becomes which carriageway flips.
  const customProfile: CrossSection = {
    lanes: [
      { id: 's1', kindId: 'shoulder', widthM: 2, direction: 'none' },
      { id: 'd1', kindId: 'drive', widthM: 3.3, direction: 'backward' },
      { id: 'd2', kindId: 'drive', widthM: 3.3, direction: 'forward' },
      { id: 'p1', kindId: 'parking', widthM: 2, direction: 'none' },
    ],
  };
  const rightSep = separateProfiles(customProfile, 'right')!;
  const leftSep = separateProfiles(customProfile, 'left')!;

  it('separateProfiles(right): backward carriageway keeps the array-left half', () => {
    expect(rightSep.backward.lanes.some((l) => l.kindId === 'shoulder')).toBe(true);
    expect(rightSep.forward.lanes.some((l) => l.kindId === 'parking')).toBe(true);
  });

  it('separateProfiles(left): mirrored — forward carriageway keeps the array-left half', () => {
    expect(leftSep.forward.lanes.some((l) => l.kindId === 'shoulder')).toBe(true);
    expect(leftSep.backward.lanes.some((l) => l.kindId === 'parking')).toBe(true);
  });

  // makeTwoWay: which half gets which direction flips.
  const oneWay4 = makeOneWay(defaultProfileFor('road', 4), 'forward');
  const rightTwoWay = makeTwoWay(oneWay4, 'right');
  const leftTwoWay = makeTwoWay(oneWay4, 'left');
  const rightDirs = directionalLanes(rightTwoWay).map((l) => l.direction);
  const leftDirs = directionalLanes(leftTwoWay).map((l) => l.direction);

  it('makeTwoWay(right) puts backward lanes first (array-left)', () => {
    expect(rightDirs[0]).toBe('backward');
    expect(rightDirs[rightDirs.length - 1]).toBe('forward');
  });

  it('makeTwoWay(left) mirrors: forward lanes first', () => {
    expect(leftDirs[0]).toBe('forward');
    expect(leftDirs[leftDirs.length - 1]).toBe('backward');
  });

  it('makeTwoWay driving side changes direction assignment only, not lane count', () => {
    expect(rightTwoWay.lanes.length).toBe(leftTwoWay.lanes.length);
  });

  it('makeTwoWay defaults to right-hand traffic (matches pre-existing behavior)', () => {
    expect(makeTwoWay(oneWay4).lanes).toEqual(rightTwoWay.lanes);
  });

  // withLaneCount: which side a new lane inserts on flips.
  const twoLane: CrossSection = {
    lanes: [
      { id: 'b1', kindId: 'drive', widthM: 3.3, direction: 'backward' },
      { id: 'f1', kindId: 'drive', widthM: 3.3, direction: 'forward' },
    ],
  };
  const grownRight = withLaneCount(twoLane, 'road', 3, 'right');
  const grownLeft = withLaneCount(twoLane, 'road', 3, 'left');

  it('withLaneCount(right) inserts the new forward lane at the end', () => {
    expect(grownRight.lanes[0].id).toBe('b1');
    expect(grownRight.lanes[grownRight.lanes.length - 1].direction).toBe('forward');
    expect(grownRight.lanes[grownRight.lanes.length - 1].id).not.toBe('f1');
  });

  it('withLaneCount(left) mirrors: inserts the new forward lane at the front', () => {
    expect(grownLeft.lanes[0].direction).toBe('forward');
    expect(grownLeft.lanes[0].id).not.toBe('f1');
    expect(grownLeft.lanes.some((l) => l.id === 'b1')).toBe(true);
  });
});

describe('offsetPolyline (the carriageway/lane offset primitive)', () => {
  const line: LngLat[] = [
    [-115.2, 36.1],
    [-115.1, 36.1],
  ]; // due east

  it('offsetPolyline(+) shifts right of travel (south when heading east)', () => {
    const right = offsetPolyline(line, 10);
    const dyMeters = (right[0][1] - line[0][1]) * 111320;
    expect(dyMeters).toBeLessThan(-9);
    expect(dyMeters).toBeGreaterThan(-11);
  });

  it('offsetPolyline(−) shifts left of travel', () => {
    const left = offsetPolyline(line, -10);
    expect((left[0][1] - line[0][1]) * 111320).toBeGreaterThan(9);
  });

  it('offsetPolyline keeps the vertex count', () => {
    const bent: LngLat[] = [
      [-115.2, 36.1],
      [-115.15, 36.1],
      [-115.15, 36.15],
    ];
    const bentOff = offsetPolyline(bent, 5);
    expect(bentOff.length).toBe(bent.length);
  });

  // A wide offset toward the inside of a TIGHT curve (offset > radius) used to
  // fold back on itself — the "carriageway spike" where a wide road follows a
  // freeway ramp / tight junction. The de-loop drops the collapsed run so the
  // inner edge pinches straight across the corner instead of looping.
  it('offsetPolyline de-loops a wide offset on a tight curve (no inner-corner spike)', () => {
    const R = 10 / 111320; // ~10 m radius quarter turn
    const tightCurve: LngLat[] = [];
    for (let a = 0; a <= 90; a += 9) {
      const r = (a * Math.PI) / 180;
      tightCurve.push([-115.15 + R * Math.cos(r), 36.13 + R * Math.sin(r)]);
    }
    const innerEdge = offsetPolyline(tightCurve, -12); // inward by MORE than the radius
    let reversals = 0;
    for (let i = 2; i < innerEdge.length; i++) {
      const px = innerEdge[i - 1][0] - innerEdge[i - 2][0],
        py = innerEdge[i - 1][1] - innerEdge[i - 2][1];
      const dx = innerEdge[i][0] - innerEdge[i - 1][0],
        dy = innerEdge[i][1] - innerEdge[i - 1][1];
      const mag = Math.hypot(px, py) * Math.hypot(dx, dy);
      if (mag > 0 && (px * dx + py * dy) / mag < -0.3) reversals++;
    }
    expect(reversals).toBe(0);
  });
});

describe('v6 migration: capacity+class → profile; round-trips', () => {
  const v5ish = parseSystem({
    version: 5,
    id: 'm',
    name: 'm',
    viewport: { center: [-115, 36], zoom: 10 },
    createdAt: 1,
    updatedAt: 1,
    ways: [
      {
        id: 'r',
        typeId: 'road',
        points: [
          [-115.2, 36.1],
          [-115.1, 36.1],
        ],
        geometry: 'straight',
        grade: 'atGrade',
        capacity: 6,
        classId: 'arterial',
      },
      {
        id: 't',
        typeId: 'heavyRail',
        points: [
          [-115.2, 36.2],
          [-115.1, 36.2],
        ],
        geometry: 'straight',
        grade: 'atGrade',
        capacity: 2,
      },
    ],
    services: [],
    stations: [],
    facilities: [],
    groups: [],
  });

  it('v5 road capacity 6 migrates to a 6-lane profile', () => {
    expect(wayCapacity(v5ish.ways[0])).toBe(6);
  });

  it("migrated road keeps sidewalks from the type's default profile", () => {
    expect(v5ish.ways[0].profile.lanes.some((l) => l.kindId === 'sidewalk')).toBe(true);
  });

  it('v5 rail capacity 2 migrates to a 2-track profile', () => {
    expect(wayCapacity(v5ish.ways[1])).toBe(2);
    expect(v5ish.ways[1].profile.lanes.every((l) => l.kindId === 'track')).toBe(true);
  });

  it('migrated system lands on the current schema version', () => {
    expect(v5ish.version).toBe(createEmptySystem().version);
  });

  it('migrated system has an empty namedWays list', () => {
    expect(Array.isArray(v5ish.namedWays)).toBe(true);
    expect(v5ish.namedWays.length).toBe(0);
  });

  it('v6 profile round-trips exactly', () => {
    const round = parseSystem(JSON.parse(JSON.stringify(v5ish)));
    expect(round.ways[0].profile).toEqual(v5ish.ways[0].profile);
  });

  // Node control/connectors round-trip, with bad connectors dropped. Both ways
  // are roads here: a junction between a road and a rail line is one the
  // loader repairs away (see model/junctions.ts), so it could not carry a
  // control setting to assert about.
  describe('node control/connectors round-trip', () => {
    const laneA = v5ish.ways[0].profile.lanes[1].id;
    const laneB = v5ish.ways[1].profile.lanes[0].id;
    const withNode = {
      ...JSON.parse(JSON.stringify(v5ish)),
      ways: JSON.parse(JSON.stringify(v5ish.ways)).map((w: Way) => ({
        ...w,
        typeId: 'road',
        points: [
          [-115.2, 36.1],
          [-115.1, 36.1],
        ],
      })),
      nodes: [
        {
          id: 'n1',
          coord: [-115.2, 36.1],
          refs: [
            { wayId: 'r', pointIndex: 0 },
            { wayId: 't', pointIndex: 0 },
          ],
          control: 'signal',
          connectors: [
            { from: { wayId: 'r', laneId: laneA }, to: { wayId: 't', laneId: laneB } },
            { from: { wayId: 'r', laneId: 'nope' }, to: { wayId: 't', laneId: laneB } },
          ],
        },
      ],
    };
    const parsedNode = parseSystem(withNode).nodes[0];

    it('node control round-trips', () => {
      expect(parsedNode?.control).toBe('signal');
    });

    it('valid lane connectors round-trip', () => {
      expect(parsedNode?.connectors?.length).toBe(1);
    });

    it('connectors naming unknown lanes are dropped', () => {
      expect(parsedNode?.connectors?.some((c) => c.from.laneId === 'nope')).toBe(false);
    });
  });
});

describe('vehicle catalogs: serialize migration', () => {
  const legacy = parseSystem({
    version: 8,
    id: 'v8sys',
    name: 'V8',
    viewport: { center: [-115.17, 36.11], zoom: 12 },
    createdAt: 1,
    updatedAt: 1,
    ways: [],
    services: [],
    stations: [],
    facilities: [],
    groups: [],
    nodes: [],
    namedWays: [],
    palette: [],
    drivingSide: 'right',
    turnRestrictions: {},
    medians: {},
    approachControls: {},
  });

  it('a v8 system migrates with an empty vehicleKinds list', () => {
    expect(Array.isArray(legacy.vehicleKinds)).toBe(true);
    expect(legacy.vehicleKinds.length).toBe(0);
  });

  // Read the current version rather than restating it: a schema bump should
  // not need this file edited to keep passing.
  it('a v8 system migrates to the current version', () => {
    expect(legacy.version).toBe(createEmptySystem().version);
  });

  it('a well-formed vehicle kind round-trips', () => {
    const withKinds = parseSystem({
      ...legacy,
      vehicleKinds: [
        {
          id: 'vk1',
          modeId: 'bus',
          label: 'Articulated bus',
          widthM: 2.6,
          lengthM: 18,
          topSpeedKmh: 60,
        },
        { id: 'vk-bad', modeId: 'bus' }, // missing widthM/lengthM — dropped, not thrown
      ],
    });
    expect(withKinds.vehicleKinds.length).toBe(1);
    expect(withKinds.vehicleKinds[0].label).toBe('Articulated bus');
  });

  it('createEmptySystem starts with an empty vehicle-kind list', () => {
    expect(createEmptySystem().vehicleKinds.length).toBe(0);
  });
});

// v9 → v10: a bare way list becomes legs with directions. v9 and earlier
// stored a pattern as an ordered list of way ids and nothing else, so a
// migrated document has to have each leg's travel direction recovered from
// the geometry of the ways it ships with. What must not change is the line's
// rendered shape: a document that drew correctly under v9 has to draw
// identically after the migration, or every saved system moves.
describe('v9 → v10: a bare way list becomes legs with directions', () => {
  const A: LngLat = [-115.2, 36.1],
    B: LngLat = [-115.15, 36.1],
    C: LngLat = [-115.1, 36.1];
  const legacyWay = (id: string, points: LngLat[]) => ({
    id,
    typeId: 'road',
    points,
    geometry: 'straight',
    grade: 'atGrade',
    profile: { lanes: [{ id: `${id}-l`, kindId: 'drive', widthM: 3.3, direction: 'both' }] },
  });
  // wB is stored [C, B]: the pattern enters it at its LAST point, which is
  // exactly the case a v9 document had no way to record.
  const v9 = parseSystem({
    version: 9,
    id: 'sys-v9',
    name: 'v9',
    viewport: { center: [-115.17, 36.11], zoom: 12 },
    createdAt: 1,
    updatedAt: 1,
    ways: [legacyWay('wA', [A, B]), legacyWay('wB', [C, B])],
    services: [
      {
        id: 'sv',
        name: 'Line 1',
        modeId: 'bus',
        color: '#e4572e',
        patterns: [{ id: 'p1', wayIds: ['wA', 'wB'] }],
      },
    ],
    stations: [],
    facilities: [],
    groups: [],
    nodes: [],
    namedWays: [],
    palette: [],
    drivingSide: 'right',
    turnRestrictions: {},
    medians: {},
    approachControls: {},
  });
  const v9Legs = patternLegs(v9.services[0].patterns[0]);

  it('a v9 document parses to the current version', () => {
    expect(v9.version).toBe(createEmptySystem().version);
  });

  it('a v9 pattern migrates to one leg per way, in the same order', () => {
    expect(v9Legs.map((l) => l.wayId)).toEqual(['wA', 'wB']);
  });

  it('the migration recovers the direction v9 could not record', () => {
    expect(legRunsWithPoints(v9Legs[0])).toBe(true);
    expect(legRunsWithPoints(v9Legs[1])).toBe(false);
  });

  it('every migrated leg covers its whole way, since v9 could not say otherwise', () => {
    expect(v9Legs.every(legIsWhole)).toBe(true);
  });

  it("the migrated line's shape is the one v9 drew, end to end and unbroken", () => {
    expect(
      Math.abs(
        pathLengthMeters(patternPath(v9.ways, v9.services[0].patterns[0])) -
          (haversineMeters(A, B) + haversineMeters(B, C)),
      ),
    ).toBeLessThan(1e-6);
  });

  // And it stays put: re-parsing a v10 document must not re-derive anything.
  it('a v10 document keeps the directions it already stores', () => {
    const reparsed = parseSystem(JSON.parse(JSON.stringify(v9)));
    expect(patternLegs(reparsed.services[0].patterns[0]).map((l) => l.direction)).toEqual(
      v9Legs.map((l) => l.direction),
    );
  });
});
