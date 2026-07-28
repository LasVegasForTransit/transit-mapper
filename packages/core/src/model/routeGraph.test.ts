// Routing over one-way streets.
//
// The graph used to push both edges for every segment and never look at a
// way's profile, so a bus line drawn down a one-way street routed against
// traffic and nothing said so. These pin the three rules that replaced that:
// a one-way way is enterable from one end only, two points on it are still
// connected by going round the block, and a caller that would rather have a
// flawed line than a swallowed click can ask for one.

import { describe, expect, it } from 'vitest';
import { makeOneWay } from './profile';
import { anchorOnWay, routeBetween } from './routeGraph';
import { createEmptySystem } from './serialize';
import { preferredLaneKinds, serviceLaneOnWay } from './geo/serviceLane';
import { oneSection, wholeLeg, wayById } from './geo';
import { defaultLaneFor } from './profile';
import type { Pattern } from './system';
import { aRoad } from '../testing/fixtures';
import type { LngLat, Node, TransitSystem, Way } from './system';

const ROADS = { allowedTypeIds: new Set(['road']) };

// A one-block couplet: two parallel north-south streets joined at both ends.
// `fourth` runs northbound only, `third` southbound only, which is what a real
// downtown pair looks like and what a line has to be able to follow.
const SW: LngLat = [-115.2, 36.1];
const SE: LngLat = [-115.19, 36.1];
const NW: LngLat = [-115.2, 36.12];
const NE: LngLat = [-115.19, 36.12];

const oneWay = (way: Way, direction: 'forward' | 'backward'): Way => ({
  ...way,
  profile: makeOneWay(way.profile, direction),
});

/** Points are stored south→north, so `forward` is northbound on both. */
const fourth = oneWay(aRoad('fourth', [SW, NW]), 'forward');
const third = oneWay(aRoad('third', [SE, NE]), 'backward');
const southCross = aRoad('southCross', [SW, SE]);
const northCross = aRoad('northCross', [NW, NE]);

const junction = (id: string, coord: LngLat, ways: Way[]): Node => ({
  id,
  coord,
  refs: ways.flatMap((w) =>
    w.points
      .map((p, i) => ({ wayId: w.id, pointIndex: i, p }))
      .filter((r) => r.p[0] === coord[0] && r.p[1] === coord[1])
      .map(({ wayId, pointIndex }) => ({ wayId, pointIndex })),
  ),
});

function couplet(): TransitSystem {
  const ways = [fourth, third, southCross, northCross];
  return {
    ...createEmptySystem(),
    ways,
    nodes: [
      junction('sw', SW, ways),
      junction('se', SE, ways),
      junction('nw', NW, ways),
      junction('ne', NE, ways),
    ],
  };
}

const anchor = (sys: TransitSystem, wayId: string, coord: LngLat) =>
  anchorOnWay(
    sys.ways.find((w) => w.id === wayId)!,
    coord,
  )!;

describe('routing along a one-way street', () => {
  it('routes a line up the street the street runs', () => {
    const sys = couplet();
    const res = routeBetween(sys, anchor(sys, 'fourth', SW), anchor(sys, 'fourth', NW), ROADS);
    expect(res).not.toBeNull();
    expect(res!.spans.map((s) => s.wayId)).toEqual(['fourth']);
  });

  it('sends a line the other way round the block rather than back down it', () => {
    const sys = couplet();
    // Mid-block on both ends, which is the real gesture and avoids the
    // zero-length span an anchor sitting exactly on a junction produces.
    const high: LngLat = [-115.2, 36.115];
    const low: LngLat = [-115.2, 36.105];
    const res = routeBetween(sys, anchor(sys, 'fourth', high), anchor(sys, 'fourth', low), ROADS);
    expect(res).not.toBeNull();
    expect(res!.spans.map((s) => s.wayId)).toContain('third');
    // Every stretch of `fourth` it uses is still travelled northbound.
    for (const s of res!.spans.filter((s) => s.wayId === 'fourth')) {
      expect(s.fromPoint).toBeLessThanOrEqual(s.toPoint);
    }
  });

  it('lets a route use two disjoint stretches of one street', () => {
    // The old ban rejected any route naming a way twice. Going round the block
    // and back up the far half of `fourth` names it twice, disjointly, and is
    // exactly what a couplet routing has to be able to produce.
    const sys = couplet();
    const high: LngLat = [-115.2, 36.115];
    const low: LngLat = [-115.2, 36.105];
    const res = routeBetween(sys, anchor(sys, 'fourth', high), anchor(sys, 'fourth', low), ROADS);
    expect(res!.spans.filter((s) => s.wayId === 'fourth').length).toBe(2);
  });

  it('runs a line down the street that runs that way', () => {
    const sys = couplet();
    const res = routeBetween(sys, anchor(sys, 'third', NE), anchor(sys, 'third', SE), ROADS);
    expect(res).not.toBeNull();
    expect(res!.spans.map((s) => s.wayId)).toEqual(['third']);
  });

  it('refuses to enter a one-way street from its far end when there is no way round', () => {
    const sys = { ...createEmptySystem(), ways: [fourth], nodes: [] };
    expect(
      routeBetween(sys, anchor(sys, 'fourth', NW), anchor(sys, 'fourth', SW), ROADS),
    ).toBeNull();
  });

  it('still routes against traffic when asked to ignore the profile', () => {
    const sys = { ...createEmptySystem(), ways: [fourth], nodes: [] };
    const res = routeBetween(sys, anchor(sys, 'fourth', NW), anchor(sys, 'fourth', SW), {
      ...ROADS,
      travel: 'ignore',
    });
    expect(res).not.toBeNull();
    expect(res!.spans.map((s) => s.wayId)).toEqual(['fourth']);
  });
});

describe('when nothing legal exists', () => {
  it('gives preferLegal a wrong-way line rather than nothing at all', () => {
    const sys = { ...createEmptySystem(), ways: [fourth], nodes: [] };
    const res = routeBetween(sys, anchor(sys, 'fourth', NW), anchor(sys, 'fourth', SW), {
      ...ROADS,
      travel: 'preferLegal',
    });
    expect(res).not.toBeNull();
    expect(res!.spans.every((s) => s.wrongWay)).toBe(true);
  });

  it('leaves preferLegal unmarked when the legal route was found first', () => {
    const sys = couplet();
    const res = routeBetween(sys, anchor(sys, 'fourth', SW), anchor(sys, 'fourth', NW), {
      ...ROADS,
      travel: 'preferLegal',
    });
    expect(res!.spans.some((s) => s.wrongWay)).toBe(false);
  });
});

describe('a two-way system is unaffected', () => {
  it('routes both ways along a street with no one-way profile', () => {
    const plain = aRoad('plain', [SW, NW]);
    const sys = { ...createEmptySystem(), ways: [plain], nodes: [] };
    const up = routeBetween(sys, anchor(sys, 'plain', SW), anchor(sys, 'plain', NW), ROADS);
    const down = routeBetween(sys, anchor(sys, 'plain', NW), anchor(sys, 'plain', SW), ROADS);
    expect(up).not.toBeNull();
    expect(down).not.toBeNull();
    expect(up!.lengthM).toBeCloseTo(down!.lengthM, 5);
  });
});

describe('turn restrictions at a junction', () => {
  // A crossroads: one north-south street meeting one east-west street, all
  // two-way, so nothing but the turn rule can change the answer.
  const C: LngLat = [-115.2, 36.12];
  const S: LngLat = [-115.2, 36.1];
  const N: LngLat = [-115.2, 36.14];
  const W: LngLat = [-115.22, 36.12];
  const E: LngLat = [-115.18, 36.12];

  const crossroads = (
    turnRestrictions: TransitSystem['turnRestrictions'] = {},
    connectors?: Node['connectors'],
  ): TransitSystem => {
    const ways = [
      aRoad('southArm', [S, C]),
      aRoad('northArm', [C, N]),
      aRoad('westArm', [W, C]),
      aRoad('eastArm', [C, E]),
    ];
    const refs = ways.flatMap((w) =>
      w.points
        .map((pt, i) => ({ wayId: w.id, pointIndex: i, pt }))
        .filter((r) => r.pt[0] === C[0] && r.pt[1] === C[1])
        .map(({ wayId, pointIndex }) => ({ wayId, pointIndex })),
    );
    return {
      ...createEmptySystem(),
      ways,
      nodes: [{ id: 'x', coord: C, refs, ...(connectors ? { connectors } : {}) }],
      turnRestrictions,
    };
  };

  // Mid-block on both ends. An anchor sitting exactly ON the junction makes
  // every hop zero-length, so the route never travels along anything and there
  // is no arriving way for a turn rule to be about — a degenerate case, and
  // not the gesture anyone makes.
  const midSouth: LngLat = [-115.2, 36.11];
  const midEast: LngLat = [-115.19, 36.12];
  const routeThrough = (sys: TransitSystem) =>
    routeBetween(
      sys,
      anchorOnWay(
        sys.ways.find((w) => w.id === 'southArm')!,
        midSouth,
      )!,
      anchorOnWay(
        sys.ways.find((w) => w.id === 'eastArm')!,
        midEast,
      )!,
      ROADS,
    );

  it('lets a line turn where nothing forbids it', () => {
    const res = routeThrough(crossroads());
    expect(res).not.toBeNull();
    expect(res!.spans.map((s) => s.wayId)).toContain('eastArm');
  });

  it('refuses a turn every lane of the arriving street forbids', () => {
    const sys = crossroads();
    // Every lane of the south arm may continue north, and nothing else.
    const restrictions = Object.fromEntries(
      sys.ways
        .find((w) => w.id === 'southArm')!
        .profile.lanes.filter((l) => l.kindId === 'drive')
        .map((l) => [`southArm:${l.id}`, { allowedTargets: ['northArm'] }]),
    );
    const restricted = routeThrough({ ...sys, turnRestrictions: restrictions })!;
    const free = routeThrough(sys)!;
    // It still gets there, the long way: straight on, turn round, and come
    // back to the junction on a street that may turn east. Refusing outright
    // would be wrong — the two points ARE connected, just not by that turn.
    expect(restricted).not.toBeNull();
    expect(restricted.lengthM).toBeGreaterThan(free.lengthM);
    // The detour is visible as a there-and-back on the north arm.
    const north = restricted.spans.filter((s) => s.wayId === 'northArm');
    expect(north.length).toBe(2);
    expect(Math.sign(north[0].toPoint - north[0].fromPoint)).toBe(
      -Math.sign(north[1].toPoint - north[1].fromPoint),
    );
  });

  it('allows the turn when one lane still permits it', () => {
    const sys = crossroads();
    const drive = sys.ways
      .find((w) => w.id === 'southArm')!
      .profile.lanes.filter((l) => l.kindId === 'drive');
    expect(drive.length).toBeGreaterThan(1);
    // All but one traffic lane forbid the turn. A right-turn pocket is the
    // real shape of this, and refusing on the strength of the others would
    // send the line the long way round a junction it may cross.
    const restrictions = Object.fromEntries(
      drive.slice(1).map((l) => [`southArm:${l.id}`, { allowedTargets: ['northArm'] }]),
    );
    const res = routeThrough({ ...sys, turnRestrictions: restrictions })!;
    // The DIRECT route, not the detour — asserting only that eastArm appears
    // would pass either way, since the detour reaches it too.
    expect(res.lengthM).toBeCloseTo(routeThrough(sys)!.lengthM, 6);
  });

  it('is not vetoed by a sidewalk, which can never hold a restriction', () => {
    // Restricting the lanes a UI would actually offer — the ones that carry
    // traffic. Asking every lane instead lets a sidewalk answer "unrestricted"
    // and the restriction does nothing at all.
    const sys = crossroads();
    const drive = sys.ways
      .find((w) => w.id === 'southArm')!
      .profile.lanes.filter((l) => l.kindId === 'drive');
    expect(drive.length).toBeGreaterThan(0);
    const restrictions = Object.fromEntries(
      drive.map((l) => [`southArm:${l.id}`, { allowedTargets: ['northArm'] }]),
    );
    const restricted = routeThrough({ ...sys, turnRestrictions: restrictions })!;
    expect(restricted.lengthM).toBeGreaterThan(routeThrough(sys)!.lengthM);
  });

  it('treats a lane restricted to nothing as fully blocked', () => {
    const sys = crossroads();
    const restrictions = Object.fromEntries(
      sys.ways
        .find((w) => w.id === 'southArm')!
        .profile.lanes.filter((l) => l.kindId === 'drive')
        .map((l) => [`southArm:${l.id}`, { allowedTargets: [] }]),
    );
    expect(routeThrough({ ...sys, turnRestrictions: restrictions })).toBeNull();
  });

  it('honours an explicit connector graph', () => {
    const sys = crossroads();
    const south = sys.ways.find((w) => w.id === 'southArm')!;
    const north = sys.ways.find((w) => w.id === 'northArm')!;
    // The junction has been customized to send the south arm only north.
    const connectors = [
      {
        from: { wayId: 'southArm', laneId: south.profile.lanes[0].id },
        to: { wayId: 'northArm', laneId: north.profile.lanes[0].id },
      },
    ];
    expect(routeThrough(crossroads({}, connectors))).toBeNull();
  });

  it('ignores an absent connector graph rather than enforcing a guess', () => {
    // Connectors are derived by heuristic when unset, and enforcing our own
    // guess would refuse turns nobody ever forbade.
    expect(routeThrough(crossroads({}, undefined))).not.toBeNull();
  });
});

describe('the lane a service is put in at a restricted junction', () => {
  // Routing refuses a turn a lane cannot make; drawing the vehicle in that
  // lane anyway would show the line doing exactly what the router just ruled
  // out. The lane choice honours the same records.
  const C: LngLat = [-115.2, 36.12];
  const S: LngLat = [-115.2, 36.1];
  const E: LngLat = [-115.18, 36.12];

  const southArm = aRoad('southArm', [S, C]);
  const eastArm = aRoad('eastArm', [C, E]);
  const drive = southArm.profile.lanes.filter((l) => l.kindId === 'drive');
  const forwardDrive = drive.filter((l) => l.direction === 'forward');

  const pattern: Pattern = {
    id: 'p',
    sections: oneSection([wholeLeg('southArm'), wholeLeg('eastArm')]),
  };
  const ways = wayById([southArm, eastArm]);

  it('picks its usual lane when nothing restricts the turn', () => {
    const lane = serviceLaneOnWay(pattern, 0, ways, 'bus');
    expect(lane).toBe(defaultLaneFor(southArm.profile, 'forward', preferredLaneKinds('bus')));
  });

  it('avoids a lane that may not make the turn it is about to make', () => {
    expect(forwardDrive.length).toBeGreaterThan(1);
    // The curb lane — the one it would otherwise take — may only continue
    // straight on, so the line has to be drawn in another.
    const usual = defaultLaneFor(southArm.profile, 'forward', preferredLaneKinds('bus'))!;
    const restrictions = { [`southArm:${usual}`]: { allowedTargets: ['northArm'] } };
    const lane = serviceLaneOnWay(pattern, 0, ways, 'bus', undefined, {
      nextWayId: 'eastArm',
      turnRestrictions: restrictions,
    });
    expect(lane).not.toBe(usual);
    expect(lane).not.toBeNull();
  });

  it('still puts the line somewhere when no lane may make the turn', () => {
    // A line already drawn through the junction has to be drawn in some lane.
    const restrictions = Object.fromEntries(
      southArm.profile.lanes.map((l) => [`southArm:${l.id}`, { allowedTargets: [] }]),
    );
    const lane = serviceLaneOnWay(pattern, 0, ways, 'bus', undefined, {
      nextWayId: 'eastArm',
      turnRestrictions: restrictions,
    });
    expect(lane).toBe(defaultLaneFor(southArm.profile, 'forward', preferredLaneKinds('bus')));
  });
});
