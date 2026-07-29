// How a pattern's two directions of service read back out of its sections.
//
// The rule is small and every part of it is load-bearing, so each clause is
// pinned separately: sections in order for outbound, reversed for inbound,
// each leg's travel direction flipped with them, and a split section's two
// halves each read in their own ride order.
//
// The case these exist to protect is a couplet in the MIDDLE of a line. Any
// scheme that tags legs in one flat array gets that one wrong unless the
// inbound-only leg sits at exactly the right index, and nothing about the
// types says it must.

import { describe, expect, it } from 'vitest';
import { haversineMeters, wayById } from '../../src/model/geo';
import {
  oneSection,
  patternHasSplit,
  patternLegs,
  patternRunLegs,
  patternRunPath,
  wholeLeg,
} from '../../src/model/geo/servicePaths';
import { aRoad } from '../support/fixtures';
import type { LngLat, Pattern, Way } from '../../src/model/system';

// A north-south trunk in two halves, with a one-block couplet between them:
// `up` carries the outward trip, `down` the return, a block to the east.
const P = {
  s: [-115.2, 36.1] as LngLat,
  mid1: [-115.2, 36.11] as LngLat,
  mid2: [-115.2, 36.13] as LngLat,
  n: [-115.2, 36.14] as LngLat,
  eMid1: [-115.19, 36.11] as LngLat,
  eMid2: [-115.19, 36.13] as LngLat,
};

const trunkSouth = aRoad('trunkSouth', [P.s, P.mid1]);
const up = aRoad('up', [P.mid1, P.mid2]);
const down = aRoad('down', [P.eMid2, P.eMid1]);
const trunkNorth = aRoad('trunkNorth', [P.mid2, P.n]);
const ways: Way[] = [trunkSouth, up, down, trunkNorth];

/** Trunk, couplet, trunk — the shape that breaks a flat tagged array. */
const couplet: Pattern = {
  id: 'couplet',
  sections: [
    { kind: 'shared', legs: [wholeLeg('trunkSouth')] },
    { kind: 'split', outbound: [wholeLeg('up')], inbound: [wholeLeg('down')] },
    { kind: 'shared', legs: [wholeLeg('trunkNorth')] },
  ],
};

const plain: Pattern = {
  id: 'plain',
  sections: oneSection([wholeLeg('trunkSouth'), wholeLeg('up')]),
};

const wayIdsOf = (p: Pattern, run: 'outbound' | 'inbound') =>
  patternRunLegs(p, run).map((r) => r.leg.wayId);

describe('a line with one undivided path', () => {
  it('reads the same legs whichever direction is asked for', () => {
    expect(new Set(wayIdsOf(plain, 'outbound'))).toEqual(new Set(wayIdsOf(plain, 'inbound')));
  });

  it('reads the return trip as the outward trip backwards', () => {
    expect(wayIdsOf(plain, 'inbound')).toEqual([...wayIdsOf(plain, 'outbound')].reverse());
  });

  it('travels each way the other way round on the return trip', () => {
    const out = patternRunLegs(plain, 'outbound');
    const back = patternRunLegs(plain, 'inbound');
    for (const leg of out) {
      const same = back.find((b) => b.leg === leg.leg)!;
      expect(same.forward).toBe(!leg.forward);
    }
  });

  it('is not reported as having two different paths', () => {
    expect(patternHasSplit(plain)).toBe(false);
  });

  it('drives the return path along exactly the outward path reversed', () => {
    const out = patternRunPath(ways, plain, 'outbound');
    const back = patternRunPath(ways, plain, 'inbound');
    expect(back.length).toBe(out.length);
    for (const [i, point] of back.entries()) {
      expect(haversineMeters(point, out[out.length - 1 - i])).toBeLessThan(0.01);
    }
  });
});

describe('a line whose two directions part company', () => {
  it('is reported as having two different paths', () => {
    expect(patternHasSplit(couplet)).toBe(true);
  });

  it('runs the outward trip up the street that carries it', () => {
    expect(wayIdsOf(couplet, 'outbound')).toEqual(['trunkSouth', 'up', 'trunkNorth']);
  });

  it('runs the return trip down the other half of the couplet', () => {
    expect(wayIdsOf(couplet, 'inbound')).toEqual(['trunkNorth', 'down', 'trunkSouth']);
  });

  it('never puts the outward-only street in the return trip', () => {
    expect(wayIdsOf(couplet, 'inbound')).not.toContain('up');
  });

  it('never puts the return-only street in the outward trip', () => {
    expect(wayIdsOf(couplet, 'outbound')).not.toContain('down');
  });

  it('drives two different polylines, not one path and its reverse', () => {
    const out = patternRunPath(ways, couplet, 'outbound');
    const back = patternRunPath(ways, couplet, 'inbound');
    const reversedOut = [...out].reverse();
    const identical = back.every(
      (point, i) => reversedOut[i] && haversineMeters(point, reversedOut[i]) < 0.01,
    );
    expect(identical).toBe(false);
  });

  it('resolves each direction to a drawable line of its own', () => {
    // Not a continuity assertion: this fixture has no cross-streets, so the
    // couplet genuinely has a block-sized gap at each end. validate.ts is what
    // checks continuity, and it now walks each direction separately.
    for (const run of ['outbound', 'inbound'] as const) {
      expect(patternRunPath(ways, couplet, run).length).toBeGreaterThan(1);
    }
  });

  it('starts the return trip where the outward trip ended', () => {
    const out = patternRunPath(ways, couplet, 'outbound');
    const back = patternRunPath(ways, couplet, 'inbound');
    expect(haversineMeters(out[out.length - 1], back[0])).toBeLessThan(0.01);
  });

  it('counts every leg once in the flat list, whichever direction rides it', () => {
    expect(
      patternLegs(couplet)
        .map((l) => l.wayId)
        .sort(),
    ).toEqual(['down', 'trunkNorth', 'trunkSouth', 'up'].sort());
  });
});

describe('a turnaround loop', () => {
  const loop: Pattern = {
    id: 'loop',
    sections: [
      { kind: 'shared', legs: [wholeLeg('trunkSouth')] },
      { kind: 'turnaround', legs: [wholeLeg('up')] },
    ],
  };

  it('is ridden on the way out and not again on the way back', () => {
    expect(wayIdsOf(loop, 'outbound')).toEqual(['trunkSouth', 'up']);
    expect(wayIdsOf(loop, 'inbound')).toEqual(['trunkSouth']);
  });
});

describe('the ways a pattern touches', () => {
  it('resolves every leg of a couplet against real geometry', () => {
    const byId = wayById(ways);
    for (const leg of patternLegs(couplet)) {
      expect(byId.get(leg.wayId)).toBeDefined();
    }
  });
});
