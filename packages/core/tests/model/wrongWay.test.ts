// A line running against the traffic on a street it rides.
//
// The router refuses to draw one, so every case here starts from a line that
// was already legal and has the street changed underneath it — which is the
// only way to get one, and the reason a stored flag would be useless.

import { describe, expect, it } from 'vitest';
import { wrongWayLegs } from '../../src/model/geo';
import { makeOneWay, makeTwoWay } from '../../src/model/profile';
import { validateSystemQuick } from '../../src/model/validate';
import { aPattern, aRoad, aService, aSystem } from '../support/fixtures';
import { wayById } from '../../src/model/geo';
import type { LngLat, TransitSystem, Way } from '../../src/model/system';

const S: LngLat = [-115.2, 36.1];
const N: LngLat = [-115.2, 36.14];

/** A line drawn south→north along a street, while the street was two-way. */
function lineOnTwoWayStreet(): TransitSystem {
  return aSystem({
    ways: [aRoad('street', [S, N])],
    services: [aService('bus', [aPattern('p', [aRoad('street', [S, N])], ['street'])])],
  });
}

/** The same system with the street turned one-way in `direction`. */
function withStreetOneWay(sys: TransitSystem, direction: 'forward' | 'backward'): TransitSystem {
  return {
    ...sys,
    ways: sys.ways.map((w: Way) =>
      w.id === 'street' ? { ...w, profile: makeOneWay(w.profile, direction) } : w,
    ),
  };
}

const legsAgainst = (sys: TransitSystem) =>
  wrongWayLegs(wayById(sys.ways), sys.services[0].patterns[0], 'outbound');

describe('a line on a street that was two-way when it was drawn', () => {
  it('runs against nothing while the street stays two-way', () => {
    expect(legsAgainst(lineOnTwoWayStreet())).toEqual([]);
  });

  it('runs against traffic once the street is made one-way the other way', () => {
    // The line runs with the street's point order; making the street run
    // against that order strands it.
    const sys = withStreetOneWay(lineOnTwoWayStreet(), 'backward');
    expect(legsAgainst(sys).map((l) => l.wayId)).toEqual(['street']);
  });

  it('is fine when the street is made one-way the way it already ran', () => {
    expect(legsAgainst(withStreetOneWay(lineOnTwoWayStreet(), 'forward'))).toEqual([]);
  });

  it('is fine again once the street goes back to two-way', () => {
    const oneWay = withStreetOneWay(lineOnTwoWayStreet(), 'backward');
    const restored: TransitSystem = {
      ...oneWay,
      ways: oneWay.ways.map((w: Way) =>
        w.id === 'street' ? { ...w, profile: makeTwoWay(w.profile, 'right') } : w,
      ),
    };
    // Recomputed rather than stored, so it clears itself. A flag written when
    // the street changed would still be sitting there.
    expect(legsAgainst(restored)).toEqual([]);
  });
});

describe('what the planner is told', () => {
  it('reports nothing while every street permits the direction it is ridden', () => {
    const issues = validateSystemQuick(lineOnTwoWayStreet());
    expect(issues.filter((i) => i.id.startsWith('wrong-way-'))).toEqual([]);
  });

  it('reports the line, not the street, so clicking it selects the line', () => {
    const sys = withStreetOneWay(lineOnTwoWayStreet(), 'backward');
    const issue = validateSystemQuick(sys).find((i) => i.id.startsWith('wrong-way-'))!;
    expect(issue).toBeDefined();
    expect(issue.target).toEqual({ kind: 'service', id: 'bus' });
    expect(issue.message).toContain('against the traffic');
  });

  it('counts streets rather than legs, so one street is reported once', () => {
    const sys = withStreetOneWay(lineOnTwoWayStreet(), 'backward');
    const wrong = validateSystemQuick(sys).filter((i) => i.id.startsWith('wrong-way-'));
    expect(wrong).toHaveLength(1);
    expect(wrong[0].message).toContain('1 one-way street');
  });
});
