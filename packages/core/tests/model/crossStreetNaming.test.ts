import { describe, expect, it } from 'vitest';
import { resyncAutoNamedStops, suggestStopName } from '../../src/model/geo/crossStreetNaming';
import { defaultProfileFor } from '../../src/model/profile';
import { aPattern, aRoad, aService, aStop, aSystem } from '../support/fixtures.test';
import type { NamedWay, Node, TransitSystem, Way, WayPointRef } from '../../src/model/system';

// Real-meter-scale coordinate helpers — CROSS_STREET_AT_JUNCTION_M (20),
// CROSS_STREET_SEARCH_RADIUS_M (90), and CROSS_STREET_WALK_MAX_M (400) are
// all genuine meter distances, so a fixture built from raw degree deltas
// (as most of this codebase's other tests are, at city-block-or-larger
// scale) silently lands outside every threshold. These keep every fixture
// coordinate expressed in the units the module actually reasons about.
const LAT0 = 36.1;
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180);
function east(lng: number, meters: number): number {
  return lng + meters / M_PER_DEG_LNG;
}
function north(lat: number, meters: number): number {
  return lat + meters / M_PER_DEG_LAT;
}

function railWay(id: string, points: [number, number][]): Way {
  return aRoad(id, points, { typeId: 'heavyRail', profile: defaultProfileFor('heavyRail') });
}

function namedWay(id: string, name: string, wayIds: string[]): NamedWay {
  return { id, name, wayIds };
}

function node(id: string, coord: [number, number], refs: WayPointRef[]): Node {
  return { id, coord, refs };
}

describe('suggestStopName', () => {
  it('names a stop at a clean 4-way intersection "Home St & Cross Ave"', () => {
    const home = railWay('home', [
      [-115.2, LAT0],
      [east(-115.2, 100), LAT0],
    ]);
    const cross = railWay('cross', [
      [east(-115.2, 100), north(LAT0, -50)],
      [east(-115.2, 100), north(LAT0, 50)],
    ]);
    const system: TransitSystem = aSystem({
      ways: [home, cross],
      namedWays: [
        namedWay('nw-home', 'Home St', ['home']),
        namedWay('nw-cross', 'Cross Ave', ['cross']),
      ],
      nodes: [
        node(
          'n1',
          [east(-115.2, 100), LAT0],
          [
            { wayId: 'home', pointIndex: 1 },
            { wayId: 'cross', pointIndex: 0 },
          ],
        ),
      ],
    });
    const result = suggestStopName({
      system,
      coord: [east(-115.2, 100), LAT0],
      anchors: [{ wayId: 'home', t: 1 }],
    });
    expect(result).toEqual({ style: 'intersection', name: 'Home St & Cross Ave' });
  });

  it('excludes a through-street continuation with the same name from the cross-street candidates', () => {
    // "Home St" continues straight through the junction under its own name on
    // a second way — that arm must not be reported as its own cross street.
    const homeA = railWay('homeA', [
      [-115.2, LAT0],
      [east(-115.2, 100), LAT0],
    ]);
    const homeB = railWay('homeB', [
      [east(-115.2, 100), LAT0],
      [east(-115.2, 200), LAT0],
    ]);
    const cross = railWay('cross', [
      [east(-115.2, 100), north(LAT0, -50)],
      [east(-115.2, 100), north(LAT0, 50)],
    ]);
    const system: TransitSystem = aSystem({
      ways: [homeA, homeB, cross],
      namedWays: [
        namedWay('nw-home', 'Home St', ['homeA', 'homeB']),
        namedWay('nw-cross', 'Cross Ave', ['cross']),
      ],
      nodes: [
        node(
          'n1',
          [east(-115.2, 100), LAT0],
          [
            { wayId: 'homeA', pointIndex: 1 },
            { wayId: 'homeB', pointIndex: 0 },
            { wayId: 'cross', pointIndex: 0 },
          ],
        ),
      ],
    });
    const result = suggestStopName({
      system,
      coord: [east(-115.2, 100), LAT0],
      anchors: [{ wayId: 'homeA', t: 1 }],
    });
    expect(result.name).toBe('Home St & Cross Ave');
  });

  it('picks the wider cross street when three differently-named arms meet at one node', () => {
    const junction: [number, number] = [east(-115.2, 100), LAT0];
    const home = railWay('home', [[-115.2, LAT0], junction]);
    const narrow = aRoad('narrow', [junction, [junction[0], north(LAT0, 100)]], {
      profile: { lanes: [{ id: 'l1', kindId: 'drive', direction: 'both', widthM: 3.3 }] },
    });
    const wide = aRoad('wide', [junction, [junction[0], north(LAT0, -100)]], {
      profile: {
        lanes: [
          { id: 'l1', kindId: 'drive', direction: 'forward', widthM: 3.3 },
          { id: 'l2', kindId: 'drive', direction: 'forward', widthM: 3.3 },
          { id: 'l3', kindId: 'drive', direction: 'backward', widthM: 3.3 },
          { id: 'l4', kindId: 'drive', direction: 'backward', widthM: 3.3 },
        ],
      },
    });
    const system: TransitSystem = aSystem({
      ways: [home, narrow, wide],
      namedWays: [
        namedWay('nw-home', 'Home St', ['home']),
        namedWay('nw-narrow', 'Narrow Ln', ['narrow']),
        namedWay('nw-wide', 'Wide Blvd', ['wide']),
      ],
      nodes: [
        node('n1', junction, [
          { wayId: 'home', pointIndex: 1 },
          { wayId: 'narrow', pointIndex: 0 },
          { wayId: 'wide', pointIndex: 0 },
        ]),
      ],
    });
    const result = suggestStopName({
      system,
      coord: junction,
      anchors: [{ wayId: 'home', t: 1 }],
    });
    expect(result.name).toBe('Home St & Wide Blvd');
  });

  it('walks past a same-named block-split way to find the next real cross street', () => {
    const mid: [number, number] = [east(-115.2, 60), LAT0];
    const end: [number, number] = [east(-115.2, 120), LAT0];
    const homeA = railWay('homeA', [[-115.2, LAT0], mid]);
    const homeB = railWay('homeB', [mid, end]);
    const realCross = aRoad('realCross', [
      [end[0], north(LAT0, -50)],
      [end[0], north(LAT0, 50)],
    ]);
    const system: TransitSystem = aSystem({
      ways: [homeA, homeB, realCross],
      namedWays: [
        namedWay('nw-home', 'Home St', ['homeA', 'homeB']),
        namedWay('nw-real', 'Real Ave', ['realCross']),
      ],
      nodes: [
        // 'mid' is a PURE same-name pass-through — both arms are "Home St",
        // nothing else meets here — so the walk must hop across it rather
        // than stopping (there's nothing here that counts as a cross street).
        node('mid', mid, [
          { wayId: 'homeA', pointIndex: 1 },
          { wayId: 'homeB', pointIndex: 0 },
        ]),
        node('end', end, [
          { wayId: 'homeB', pointIndex: 1 },
          { wayId: 'realCross', pointIndex: 0 },
        ]),
      ],
    });
    // Anchored well before the pass-through node, so the walk must hop from
    // homeA onto homeB before it can reach realCross.
    const result = suggestStopName({
      system,
      coord: [east(-115.2, 6), LAT0],
      anchors: [{ wayId: 'homeA', t: 0.1 }],
    });
    // Rail-style (railWay ⇒ 'intersection'): the walk's job here is finding
    // Real Ave at all, by hopping past the pass-through node — not the
    // before/after wording, which the mid-block bus test covers instead.
    expect(result.name).toBe('Home St & Real Ave');
  });

  it('names a mid-block bus stop "before" and "after" the nearer flanking cross street', () => {
    const westEnd: [number, number] = [-115.2, LAT0];
    const eastEnd: [number, number] = [east(-115.2, 200), LAT0];
    const home = aRoad('home', [westEnd, eastEnd]);
    const west = aRoad('west', [
      [westEnd[0], north(LAT0, -50)],
      [westEnd[0], north(LAT0, 50)],
    ]);
    const east_ = aRoad('east', [
      [eastEnd[0], north(LAT0, -50)],
      [eastEnd[0], north(LAT0, 50)],
    ]);
    const system: TransitSystem = aSystem({
      ways: [home, west, east_],
      namedWays: [
        namedWay('nw-home', 'Home St', ['home']),
        namedWay('nw-west', 'West Ave', ['west']),
        namedWay('nw-east', 'East Ave', ['east']),
      ],
      nodes: [
        node('w', westEnd, [
          { wayId: 'home', pointIndex: 0 },
          { wayId: 'west', pointIndex: 0 },
        ]),
        node('e', eastEnd, [
          { wayId: 'home', pointIndex: 1 },
          { wayId: 'east', pointIndex: 0 },
        ]),
      ],
    });
    // t=0.2 of a 200m way is 40m from the west node — comfortably past the
    // 20m at-junction radius, comfortably inside the 400m walk cap.
    const nearWest = suggestStopName({
      system,
      coord: [east(-115.2, 40), LAT0],
      anchors: [{ wayId: 'home', t: 0.2 }],
    });
    expect(nearWest).toEqual({ style: 'alongStreet', name: 'Home St after West Ave' });

    const nearEast = suggestStopName({
      system,
      coord: [east(-115.2, 160), LAT0],
      anchors: [{ wayId: 'home', t: 0.8 }],
    });
    expect(nearEast).toEqual({ style: 'alongStreet', name: 'Home St before East Ave' });
  });

  it('uses "@" instead of "before"/"after" for a bus stop within the at-junction tolerance', () => {
    const junction: [number, number] = [east(-115.2, 10), LAT0];
    const home = aRoad('home', [
      [-115.2, LAT0],
      [east(-115.2, 20), LAT0],
    ]);
    const cross = aRoad('cross', [
      [junction[0], north(LAT0, -50)],
      [junction[0], north(LAT0, 50)],
    ]);
    const system: TransitSystem = aSystem({
      ways: [home, cross],
      namedWays: [
        namedWay('nw-home', 'Home St', ['home']),
        namedWay('nw-cross', 'Cross Ave', ['cross']),
      ],
      nodes: [
        node('n1', junction, [
          { wayId: 'home', pointIndex: 0 },
          { wayId: 'cross', pointIndex: 0 },
        ]),
      ],
    });
    // t=0.5 of a 20m way sits exactly at the junction (well under the 20m
    // at-junction radius), not out at the walk distance.
    const result = suggestStopName({
      system,
      coord: junction,
      anchors: [{ wayId: 'home', t: 0.5 }],
    });
    expect(result).toEqual({ style: 'alongStreet', name: 'Home St @ Cross Ave' });
  });

  it('never emits "before"/"after" for a rail-style stop, even mid-block', () => {
    const westEnd: [number, number] = [-115.2, LAT0];
    const home = railWay('home', [westEnd, [east(-115.2, 200), LAT0]]);
    const west = railWay('west', [
      [westEnd[0], north(LAT0, -50)],
      [westEnd[0], north(LAT0, 50)],
    ]);
    const system: TransitSystem = aSystem({
      ways: [home, west],
      namedWays: [
        namedWay('nw-home', 'Home St', ['home']),
        namedWay('nw-west', 'West Ave', ['west']),
      ],
      nodes: [
        node('w', westEnd, [
          { wayId: 'home', pointIndex: 0 },
          { wayId: 'west', pointIndex: 0 },
        ]),
      ],
    });
    // t=0.5 of a 200m way is 100m from the node — well past the at-junction
    // radius, so this only finds West Ave by walking, not by proximity.
    const result = suggestStopName({
      system,
      coord: [east(-115.2, 100), LAT0],
      anchors: [{ wayId: 'home', t: 0.5 }],
    });
    expect(result).toEqual({ style: 'intersection', name: 'Home St & West Ave' });
  });

  it('falls back to the bare street name when no cross street is found within the walk bound', () => {
    const home = railWay('home', [
      [-115.2, LAT0],
      [east(-115.2, 1000), LAT0],
    ]); // 500m either way from the midpoint — past the 400m walk cap
    const system: TransitSystem = aSystem({
      ways: [home],
      namedWays: [namedWay('nw-home', 'Home St', ['home'])],
    });
    const result = suggestStopName({
      system,
      coord: [east(-115.2, 500), LAT0],
      anchors: [{ wayId: 'home', t: 0.5 }],
    });
    expect(result.name).toBe('Home St');
  });

  it("leaves the name unset when the stop's own way carries no NamedWay", () => {
    const home = railWay('home', [
      [-115.2, LAT0],
      [east(-115.2, 200), LAT0],
    ]);
    const system: TransitSystem = aSystem({ ways: [home], namedWays: [] });
    const result = suggestStopName({
      system,
      coord: [east(-115.2, 100), LAT0],
      anchors: [{ wayId: 'home', t: 0.5 }],
    });
    expect(result.name).toBeNull();
  });

  it('leaves the name unset for a free-floating stop with no named way nearby', () => {
    const system: TransitSystem = aSystem({ ways: [], namedWays: [] });
    const result = suggestStopName({ system, coord: [-115.15, LAT0], anchors: [] });
    expect(result.name).toBeNull();
  });

  it('names a free-floating stop at a real intersection of the two nearest streets', () => {
    const center: [number, number] = [-115.15, LAT0];
    const a = railWay('a', [
      [east(center[0], -20), center[1]],
      [east(center[0], 20), center[1]],
    ]);
    const b = railWay('b', [
      [center[0], north(center[1], -20)],
      [center[0], north(center[1], 20)],
    ]);
    const system: TransitSystem = aSystem({
      ways: [a, b],
      namedWays: [namedWay('nw-a', 'A St', ['a']), namedWay('nw-b', 'B Ave', ['b'])],
      nodes: [
        node('n1', center, [
          { wayId: 'a', pointIndex: 1 },
          { wayId: 'b', pointIndex: 1 },
        ]),
      ],
    });
    const result = suggestStopName({ system, coord: center, anchors: [] });
    expect(result.name).toBe('A St & B Ave');
  });

  it('does not claim an intersection for a free-floating stop between two streets that never cross', () => {
    // Two parallel streets a block apart — both are "nearest," but neither
    // meets the other anywhere, so this must not read as an intersection.
    const center: [number, number] = [-115.15, LAT0];
    const a = railWay('a', [
      [east(center[0], -20), north(center[1], -30)],
      [east(center[0], 20), north(center[1], -30)],
    ]);
    const b = railWay('b', [
      [east(center[0], -20), north(center[1], 30)],
      [east(center[0], 20), north(center[1], 30)],
    ]);
    const system: TransitSystem = aSystem({
      ways: [a, b],
      namedWays: [namedWay('nw-a', 'A St', ['a']), namedWay('nw-b', 'B Ave', ['b'])],
    });
    const result = suggestStopName({ system, coord: center, anchors: [] });
    expect(result.name).toBe('A St');
  });

  it('prefers intersection-style naming when both a rail and a bus service call at the same stop', () => {
    const junction: [number, number] = [east(-115.2, 100), LAT0];
    const home = railWay('home', [[-115.2, LAT0], junction]);
    const busRoad = aRoad('busRoad', [
      [east(junction[0], -20), junction[1]],
      [east(junction[0], 20), junction[1]],
    ]);
    const cross = railWay('cross', [
      [junction[0], north(LAT0, -50)],
      [junction[0], north(LAT0, 50)],
    ]);
    const system: TransitSystem = aSystem({
      ways: [home, busRoad, cross],
      namedWays: [
        namedWay('nw-home', 'Home St', ['home']),
        namedWay('nw-cross', 'Cross Ave', ['cross']),
      ],
      nodes: [
        node('n1', junction, [
          { wayId: 'home', pointIndex: 1 },
          { wayId: 'cross', pointIndex: 0 },
        ]),
      ],
      services: [
        aService('rail-svc', [aPattern('p1', [home], ['home'])], { modeId: 'subway' }),
        aService('bus-svc', [aPattern('p2', [busRoad], ['busRoad'])], { modeId: 'bus' }),
      ],
    });
    const result = suggestStopName({
      system,
      coord: junction,
      anchors: [{ wayId: 'home', t: 1 }],
    });
    expect(result.style).toBe('intersection');
  });

  it('defaults an unserved stop on a road-type way to along-street style', () => {
    const home = aRoad('home', [
      [-115.2, LAT0],
      [east(-115.2, 200), LAT0],
    ]);
    const system: TransitSystem = aSystem({
      ways: [home],
      namedWays: [namedWay('nw-home', 'Home St', ['home'])],
    });
    const result = suggestStopName({
      system,
      coord: [east(-115.2, 100), LAT0],
      anchors: [{ wayId: 'home', t: 0.5 }],
    });
    expect(result.style).toBe('alongStreet');
  });

  it('defaults an unserved stop on a rail-type way to intersection style', () => {
    const home = railWay('home', [
      [-115.2, LAT0],
      [east(-115.2, 200), LAT0],
    ]);
    const system: TransitSystem = aSystem({
      ways: [home],
      namedWays: [namedWay('nw-home', 'Home St', ['home'])],
    });
    const result = suggestStopName({
      system,
      coord: [east(-115.2, 100), LAT0],
      anchors: [{ wayId: 'home', t: 0.5 }],
    });
    expect(result.style).toBe('intersection');
  });
});

describe('resyncAutoNamedStops', () => {
  const junction: [number, number] = [east(-115.2, 100), LAT0];
  const home = aRoad('home', [[-115.2, LAT0], junction]);
  const cross = aRoad('cross', [
    [junction[0], north(LAT0, -50)],
    [junction[0], north(LAT0, 50)],
  ]);
  const baseSystem = (): TransitSystem =>
    aSystem({
      ways: [home, cross],
      namedWays: [
        namedWay('nw-home', 'Home St', ['home']),
        namedWay('nw-cross', 'Cross Ave', ['cross']),
      ],
      nodes: [
        node('n1', junction, [
          { wayId: 'home', pointIndex: 1 },
          { wayId: 'cross', pointIndex: 0 },
        ]),
      ],
    });

  it("corrects an auto-named stop's style once a service proves the unserved guess wrong", () => {
    // Named while unserved: 'home' is road-typed, so the fallback guesses
    // along-street style — "Home St @ Cross Ave" — before any service exists.
    const unserved = baseSystem();
    const preview = suggestStopName({
      system: unserved,
      coord: junction,
      anchors: [{ wayId: 'home', t: 1 }],
    });
    expect(preview).toEqual({ style: 'alongStreet', name: 'Home St @ Cross Ave' });

    // A tram — street-running, so 'home' is a legal alignment for it — now
    // rides that same way, which the services-based branch reads as
    // intersection style instead.
    const withTram: TransitSystem = {
      ...unserved,
      stops: [
        aStop('st1', junction, { wayId: 'home', t: 1 }, { name: preview.name!, autoNamed: true }),
      ],
      services: [aService('svc1', [aPattern('p1', [home], ['home'])], { modeId: 'tram' })],
    };
    const resynced = resyncAutoNamedStops(withTram);
    const stop = resynced.stops.find((s) => s.id === 'st1')!;
    expect(stop.name).toBe('Home St & Cross Ave');
    expect(stop.autoNamed, 'stays eligible for a further resync later').toBe(true);
  });

  it("never touches a stop's name once a user has typed their own", () => {
    const withTram: TransitSystem = {
      ...baseSystem(),
      stops: [
        aStop(
          'st1',
          junction,
          { wayId: 'home', t: 1 },
          { name: 'My Custom Stop Name', autoNamed: false },
        ),
      ],
      services: [aService('svc1', [aPattern('p1', [home], ['home'])], { modeId: 'tram' })],
    };
    const resynced = resyncAutoNamedStops(withTram);
    expect(resynced.stops[0].name).toBe('My Custom Stop Name');
  });

  it('returns the same system reference when no auto-named stop needs correcting', () => {
    // No service exists here, same as baseSystem() alone — the unserved
    // fallback's along-street guess is already what's stored, so recomputing
    // against this exact system must be a no-op.
    const system: TransitSystem = {
      ...baseSystem(),
      stops: [
        aStop(
          'st1',
          junction,
          { wayId: 'home', t: 1 },
          { name: 'Home St @ Cross Ave', autoNamed: true },
        ),
      ],
    };
    expect(resyncAutoNamedStops(system)).toBe(system);
  });
});
