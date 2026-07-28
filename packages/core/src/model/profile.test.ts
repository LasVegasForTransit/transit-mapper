// Which directions a profile permits, and the cases where getting it wrong
// would strand someone.
//
// profileTraversal is what makes the router refuse to send a service the wrong
// way up a one-way street, so its edge cases are the router's edge cases: a
// path with no directional lanes at all must stay walkable both ways, and a
// street with a single bidirectional lane must not read as one-way.

import { describe, expect, it } from 'vitest';
import { defaultProfileFor } from './profile';
import { isOneWay, makeOneWay, makeTwoWay, profileTraversal, wayTraversal } from './profile';
import { aRoad } from '../testing/fixtures';
import type { CrossSection } from './system';

const road = defaultProfileFor('road');

/** A profile whose only lanes are non-directional — a footpath is all
 *  sidewalk, and sidewalks never carry a direction. */
const nonDirectional: CrossSection = {
  lanes: road.lanes.filter((l) => l.kindId === 'sidewalk'),
};

describe('which directions a profile permits', () => {
  it('reads a default road as travelable both ways', () => {
    expect(profileTraversal(road)).toBe('both');
  });

  it('reads a one-way street as travelable only the way it runs', () => {
    expect(profileTraversal(makeOneWay(road, 'forward'))).toBe('forward');
    expect(profileTraversal(makeOneWay(road, 'backward'))).toBe('backward');
  });

  it('reads a converted-back street as travelable both ways again', () => {
    expect(profileTraversal(makeTwoWay(makeOneWay(road, 'forward'), 'right'))).toBe('both');
  });

  it('reads a profile with no directional lanes as travelable both ways', () => {
    expect(nonDirectional.lanes.length).toBeGreaterThan(0);
    expect(profileTraversal(nonDirectional)).toBe('both');
  });

  it('reads a lane-less profile as travelable both ways', () => {
    expect(profileTraversal({ lanes: [] })).toBe('both');
  });

  it('answers for a way from the way its profile describes', () => {
    const way = aRoad('w', [
      [-115.2, 36.14],
      [-115.2, 36.16],
    ]);
    expect(wayTraversal(way)).toBe(profileTraversal(way.profile));
  });
});

describe('one-way and traversal agree', () => {
  it('calls exactly the profiles with a single travel direction one-way', () => {
    for (const profile of [
      road,
      makeOneWay(road, 'forward'),
      makeOneWay(road, 'backward'),
      nonDirectional,
      { lanes: [] },
    ]) {
      expect(isOneWay(profile)).toBe(profileTraversal(profile) !== 'both');
    }
  });
});
