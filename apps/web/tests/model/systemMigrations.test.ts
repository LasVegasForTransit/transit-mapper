// Converted from apps/web/tests/verify.test.ts lines 6494-7010 (8 sections).
// Split from profileMigrationsAndComponents.test.ts to stay under the
// max-lines cap; this half covers the v6, vehicle-catalog, and v9→v10
// serialize migrations. Profile/component-registry coverage lives in
// profileAndComponents.test.ts.
import { describe, expect, it } from 'vitest';
import { wayCapacity } from '@transitmapper/core/model/profile';
import {
  haversineMeters,
  legIsWhole,
  legRunsWithPoints,
  pathLengthMeters,
  patternLegs,
  patternPath,
} from '@transitmapper/core/model/geo';
import { createEmptySystem, parseSystem } from '@transitmapper/core/model/serialize';
import type { LngLat, TransitSystem, Way } from '@transitmapper/core/model/system';

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
    stops: [],
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
      ...(JSON.parse(JSON.stringify(v5ish)) as TransitSystem),
      ways: (JSON.parse(JSON.stringify(v5ish.ways)) as Way[]).map((w) => ({
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
      expect(parsedNode.control).toBe('signal');
    });

    it('valid lane connectors round-trip', () => {
      expect(parsedNode.connectors?.length).toBe(1);
    });

    it('connectors naming unknown lanes are dropped', () => {
      expect(parsedNode.connectors?.some((c) => c.from.laneId === 'nope')).toBe(false);
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
    stops: [],
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
    stops: [],
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
  const v9Legs = patternLegs(v9.services[0].path);

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
        pathLengthMeters(patternPath(v9.ways, v9.services[0].path)) -
          (haversineMeters(A, B) + haversineMeters(B, C)),
      ),
    ).toBeLessThan(1e-6);
  });

  // And it stays put: re-parsing a v10 document must not re-derive anything.
  it('a v10 document keeps the directions it already stores', () => {
    const reparsed = parseSystem(JSON.parse(JSON.stringify(v9)));
    expect(patternLegs(reparsed.services[0].path).map((l) => l.direction)).toEqual(
      v9Legs.map((l) => l.direction),
    );
  });
});
