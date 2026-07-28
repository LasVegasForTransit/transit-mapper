// Deciding which of a route's shapes are the two directions of one line.
//
// GTFS never says. Getting it wrong in either direction is bad in its own way:
// pair two branches and one of them vanishes into the other's return trip;
// pair nothing and every two-direction route imports as two unlabelled
// branches whose fleet is counted twice.

import { describe, expect, it } from 'vitest';
import { pairRouteShapes } from './gtfsImport';
import type { LngLat } from './system';

/** A north-south line and its mirror image, plus the pieces that must NOT be
 *  mistaken for one. Coordinates are Vegas-ish so the metre thresholds mean
 *  what they mean in the real feed. */
const S: LngLat = [-115.2, 36.1];
const N: LngLat = [-115.2, 36.2];
const Sb: LngLat = [-115.199, 36.1];
const Nb: LngLat = [-115.199, 36.2];
/** Half the line — a short-turn, sharing the southern terminal. */
const Mid: LngLat = [-115.199, 36.15];

const paths = new Map<string, LngLat[]>([
  ['out', [S, N]],
  ['back', [Nb, Sb]],
  ['shortBack', [Mid, Sb]],
  [
    'elsewhere',
    [
      [-115.05, 36.05],
      [-115.05, 36.09],
    ],
  ],
]);

const dirs = (entries: [string, string][]) => new Map(entries);
const trips = (entries: [string, number][]) => new Map(entries);

describe('a route with one shape each way', () => {
  it('imports as one line that runs both ways', () => {
    const res = pairRouteShapes(
      ['out', 'back'],
      paths,
      dirs([
        ['out', '0'],
        ['back', '1'],
      ]),
      trips([
        ['out', 40],
        ['back', 40],
      ]),
    );
    expect(res.couplets).toEqual([{ outbound: 'out', inbound: 'back' }]);
    expect(res.singles).toEqual([]);
  });
});

describe('a feed that never says which direction anything runs', () => {
  it('pairs nothing, exactly as it did before', () => {
    const res = pairRouteShapes(
      ['out', 'back'],
      paths,
      dirs([
        ['out', ''],
        ['back', ''],
      ]),
      trips([
        ['out', 40],
        ['back', 40],
      ]),
    );
    expect(res.couplets).toEqual([]);
    expect(res.singles).toEqual(['out', 'back']);
  });
});

describe('a route with a short-turn', () => {
  it('pairs the full run with the full run, not with the short-turn', () => {
    const res = pairRouteShapes(
      ['out', 'back', 'shortBack'],
      paths,
      dirs([
        ['out', '0'],
        ['back', '1'],
        ['shortBack', '1'],
      ]),
      // The short-turn runs fewer trips, so the busiest-first order offers the
      // full return first.
      trips([
        ['out', 40],
        ['back', 30],
        ['shortBack', 6],
      ]),
    );
    expect(res.couplets).toEqual([{ outbound: 'out', inbound: 'back' }]);
    expect(res.singles).toEqual(['shortBack']);
  });

  it('leaves a short-turn as its own path rather than dropping it', () => {
    const res = pairRouteShapes(
      ['out', 'shortBack'],
      paths,
      dirs([
        ['out', '0'],
        ['shortBack', '1'],
      ]),
      trips([
        ['out', 40],
        ['shortBack', 6],
      ]),
    );
    // Half the length, so it is not this line's return trip.
    expect(res.couplets).toEqual([]);
    expect(res.singles).toEqual(['out', 'shortBack']);
  });
});

describe('two shapes that are nowhere near each other', () => {
  it('are not paired just because the feed calls them opposite directions', () => {
    const res = pairRouteShapes(
      ['out', 'elsewhere'],
      paths,
      dirs([
        ['out', '0'],
        ['elsewhere', '1'],
      ]),
      trips([
        ['out', 40],
        ['elsewhere', 40],
      ]),
    );
    expect(res.couplets).toEqual([]);
    expect(res.singles).toEqual(['out', 'elsewhere']);
  });
});

describe('how far apart two terminals may be', () => {
  // The same absolute gap means different things on different routes, which is
  // why the tolerance scales with the shapes rather than being a fixed block.
  const line = (a: LngLat, b: LngLat): LngLat[] => [a, b];
  const pairOf = (paths: Map<string, LngLat[]>) =>
    pairRouteShapes(
      ['o', 'i'],
      paths,
      new Map([
        ['o', '0'],
        ['i', '1'],
      ]),
      new Map([
        ['o', 10],
        ['i', 10],
      ]),
    );

  it('accepts a 300 m gap between the ends of a long route', () => {
    // ~11 km each way; 300 m at the top is two halves of a couplet meeting.
    const paths = new Map<string, LngLat[]>([
      ['o', line([-115.2, 36.1], [-115.2, 36.2])],
      ['i', line([-115.2033, 36.2], [-115.2033, 36.1])],
    ]);
    expect(pairOf(paths).couplets).toEqual([{ outbound: 'o', inbound: 'i' }]);
  });

  it('refuses the same 300 m gap between the ends of a short circulator', () => {
    // ~600 m each way. The same 300 m is half the route — these are not the
    // two ends of one line.
    const paths = new Map<string, LngLat[]>([
      ['o', line([-115.2, 36.1], [-115.2, 36.1054])],
      ['i', line([-115.2033, 36.1054], [-115.2033, 36.1])],
    ]);
    expect(pairOf(paths).couplets).toEqual([]);
    expect(pairOf(paths).singles).toEqual(['o', 'i']);
  });

  it('refuses a pair that meets at one end and misses badly at the other', () => {
    // A sum-based test would let the perfect end pay for the broken one.
    const paths = new Map<string, LngLat[]>([
      ['o', line([-115.2, 36.1], [-115.2, 36.2])],
      ['i', line([-115.2, 36.2], [-115.22, 36.1])],
    ]);
    expect(pairOf(paths).couplets).toEqual([]);
  });
});
