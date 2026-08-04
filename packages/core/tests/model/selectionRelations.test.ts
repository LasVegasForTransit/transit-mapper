// What the app is allowed to offer about a pair of selected objects comes
// down to these predicates, so each case here is one rule the menu enforces.
// Where a predicate mirrors the guard of an operation, the case says which
// operation would otherwise refuse.

import { describe, expect, it } from 'vitest';
import {
  crossesAtDifferentGrades,
  crossingBetween,
  runsAlongside,
  servicesShareOrCross,
  sharedEndpointNode,
  terminiMeet,
} from '../../src/model/selectionRelations';
import { aPattern, aRoad, aService, aSystem } from '../support/fixtures.test';

/** Two ways meeting nose to tail at [-115.20, 36.15], joined by a node — what
 *  splitting one way in half leaves behind. */
function splitPair() {
  const west = aRoad('west', [
    [-115.21, 36.15],
    [-115.2, 36.15],
  ]);
  const east = aRoad('east', [
    [-115.2, 36.15],
    [-115.19, 36.15],
  ]);
  return {
    west,
    east,
    system: aSystem({
      ways: [west, east],
      nodes: [
        {
          id: 'n',
          coord: [-115.2, 36.15],
          refs: [
            { wayId: 'west', pointIndex: 1 },
            { wayId: 'east', pointIndex: 0 },
          ],
        },
      ],
    }),
  };
}

describe('two ways sharing an endpoint', () => {
  it('are joinable when a two-way node holds their open ends together', () => {
    const { system } = splitPair();
    expect(sharedEndpointNode(system, 'west', 'east')?.id).toBe('n');
  });

  it('are not joinable when a third way also meets at that node', () => {
    const { system } = splitPair();
    const spur = aRoad('spur', [
      [-115.2, 36.15],
      [-115.2, 36.16],
    ]);
    const withSpur = aSystem({
      ways: [...system.ways, spur],
      nodes: [
        { ...system.nodes[0], refs: [...system.nodes[0].refs, { wayId: 'spur', pointIndex: 0 }] },
      ],
    });
    expect(sharedEndpointNode(withSpur, 'west', 'east')).toBeNull();
  });

  it('are not joinable across different way types', () => {
    const { system } = splitPair();
    const retyped = aSystem({
      ...system,
      ways: system.ways.map((w) => (w.id === 'east' ? { ...w, typeId: 'rail' } : w)),
    });
    expect(sharedEndpointNode(retyped, 'west', 'east')).toBeNull();
  });
});

describe('two ways crossing mid-span', () => {
  const northSouth = aRoad('ns', [
    [-115.2, 36.14],
    [-115.2, 36.16],
  ]);
  const eastWest = aRoad('ew', [
    [-115.21, 36.15],
    [-115.19, 36.15],
  ]);

  it('report the crossing when both sit at the same grade', () => {
    const system = aSystem({ ways: [northSouth, eastWest] });
    const hit = crossingBetween(system, 'ns', 'ew');
    expect(hit?.coord[1]).toBeCloseTo(36.15, 5);
  });

  it('report no crossing at different grades, because that is an overpass', () => {
    const system = aSystem({
      ways: [northSouth, { ...eastWest, grade: 'elevated' }],
    });
    expect(crossingBetween(system, 'ns', 'ew')).toBeNull();
    expect(crossesAtDifferentGrades(system, 'ns', 'ew')).toBe(true);
  });

  it('report no crossing across different way types, which can share no lanes', () => {
    const system = aSystem({
      ways: [northSouth, { ...eastWest, typeId: 'heavyRail' }],
    });
    expect(crossingBetween(system, 'ns', 'ew')).toBeNull();
  });

  it('report no crossing when the ways only touch at an endpoint', () => {
    const { system } = splitPair();
    expect(crossingBetween(system, 'west', 'east')).toBeNull();
  });
});

describe('two ways running alongside each other', () => {
  const boulevard = aRoad('blvd', [
    [-115.2, 36.14],
    [-115.2, 36.16],
  ]);

  it('count as one corridor when one traces the other within tolerance', () => {
    // ~9 m east of the boulevard, well inside the 20 m conflation tolerance.
    const twin = aRoad('twin', [
      [-115.1999, 36.141],
      [-115.1999, 36.159],
    ]);
    const system = aSystem({ ways: [boulevard, twin] });
    expect(runsAlongside(system, 'twin', 'blvd')).toBe(true);
  });

  it('do not count when they merely cross', () => {
    const crossStreet = aRoad('cross', [
      [-115.21, 36.15],
      [-115.19, 36.15],
    ]);
    const system = aSystem({ ways: [boulevard, crossStreet] });
    expect(runsAlongside(system, 'cross', 'blvd')).toBe(false);
  });

  it('do not count when they are a block apart', () => {
    const nextStreet = aRoad('next', [
      [-115.198, 36.14],
      [-115.198, 36.16],
    ]);
    const system = aSystem({ ways: [boulevard, nextStreet] });
    expect(runsAlongside(system, 'next', 'blvd')).toBe(false);
  });
});

describe('two lines', () => {
  const west = aRoad('west', [
    [-115.21, 36.15],
    [-115.2, 36.15],
  ]);
  const east = aRoad('east', [
    [-115.2, 36.15],
    [-115.19, 36.15],
  ]);

  it('meet when one ends where the other begins', () => {
    const system = aSystem({
      ways: [west, east],
      services: [
        aService('a', [aPattern('pa', [west], ['west'])]),
        aService('b', [aPattern('pb', [east], ['east'])]),
      ],
    });
    const meeting = terminiMeet(system, 'a', 'b');
    expect(meeting).toMatchObject({ aEnd: 'end', bEnd: 'start' });
    expect(meeting?.distanceM).toBeLessThan(1);
  });

  it('do not meet when their nearest ends are a kilometre apart', () => {
    const far = aRoad('far', [
      [-115.15, 36.15],
      [-115.14, 36.15],
    ]);
    const system = aSystem({
      ways: [west, far],
      services: [
        aService('a', [aPattern('pa', [west], ['west'])]),
        aService('b', [aPattern('pb', [far], ['far'])]),
      ],
    });
    expect(terminiMeet(system, 'a', 'b')).toBeNull();
  });

  it('count as sharing when both ride the same way', () => {
    const system = aSystem({
      ways: [west],
      services: [
        aService('a', [aPattern('pa', [west], ['west'])]),
        aService('b', [aPattern('pb', [west], ['west'])]),
      ],
    });
    expect(servicesShareOrCross(system, 'a', 'b')).toBe(true);
  });

  it('count as crossing when their paths cross on separate infrastructure', () => {
    const northSouth = aRoad('ns', [
      [-115.205, 36.14],
      [-115.205, 36.16],
    ]);
    const system = aSystem({
      ways: [west, northSouth],
      services: [
        aService('a', [aPattern('pa', [west], ['west'])]),
        aService('b', [aPattern('pb', [northSouth], ['ns'])]),
      ],
    });
    expect(servicesShareOrCross(system, 'a', 'b')).toBe(true);
  });

  it('are unrelated when they neither share a way nor cross', () => {
    const far = aRoad('far', [
      [-115.15, 36.18],
      [-115.14, 36.18],
    ]);
    const system = aSystem({
      ways: [west, far],
      services: [
        aService('a', [aPattern('pa', [west], ['west'])]),
        aService('b', [aPattern('pb', [far], ['far'])]),
      ],
    });
    expect(servicesShareOrCross(system, 'a', 'b')).toBe(false);
  });
});
