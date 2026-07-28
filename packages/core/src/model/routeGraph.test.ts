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
