import { armRefKey, laneRefKey } from '../../src/model/components';
import { flipProfile } from '../../src/model/profile';
import type { LaneDirection, LngLat, Way } from '../../src/model/system';
import { mergeWaysEndToEnd } from '../../src/model/way-merge-edits';
import { splitWayAtIndex } from '../../src/model/way-split-edits';
import { aRoad, aSystem } from '../support/fixtures.test';
import { describe, expect, it, vi } from 'vitest';

function laneId(way: Way, direction: LaneDirection): string {
  const lane = way.profile.lanes.find((candidate) => candidate.direction === direction);
  if (!lane) throw new Error(`The fixture needs a ${direction} lane.`);
  return lane.id;
}

describe('way split and merge integrity', () => {
  it('moves outer endpoint metadata to the second split half without decorating the seam', () => {
    const road = aRoad('road', [
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
    const forwardLaneId = laneId(road, 'forward');
    const backwardLaneId = laneId(road, 'backward');
    const untouchedControl = { control: 'roundabout' as const };
    const untouchedRestriction = { allowedTargets: ['road'] };
    const system = aSystem({
      updatedAt: 123,
      ways: [road],
      approachControls: {
        [armRefKey(road.id, 'start')]: { control: 'stop' },
        [armRefKey(road.id, 'end')]: { control: 'signal' },
        [armRefKey('untouched', 'start')]: untouchedControl,
      },
      turnRestrictions: {
        [laneRefKey(road.id, forwardLaneId)]: { allowedTargets: ['east'] },
        [laneRefKey(road.id, backwardLaneId)]: { allowedTargets: ['west'] },
        [laneRefKey('untouched', 'lane')]: untouchedRestriction,
      },
    });
    const createId = vi
      .fn<() => string>()
      .mockReturnValueOnce('east-half')
      .mockReturnValueOnce('split-node');

    const split = splitWayAtIndex(system, road.id, 1, createId);

    expect(split.approachControls).toEqual({
      [armRefKey(road.id, 'start')]: { control: 'stop' },
      [armRefKey('east-half', 'end')]: { control: 'signal' },
      [armRefKey('untouched', 'start')]: untouchedControl,
    });
    expect(split.approachControls[armRefKey('untouched', 'start')]).toBe(untouchedControl);
    expect(split.turnRestrictions).toEqual({
      [laneRefKey('east-half', forwardLaneId)]: { allowedTargets: ['east'] },
      [laneRefKey(road.id, backwardLaneId)]: { allowedTargets: ['west'] },
      [laneRefKey('untouched', 'lane')]: untouchedRestriction,
    });
    expect(split.turnRestrictions[laneRefKey('untouched', 'lane')]).toBe(untouchedRestriction);
    expect(split.updatedAt).toBe(123);
  });

  const orientations: {
    name: string;
    keepPoints: LngLat[];
    otherPoints: LngLat[];
    reversedOther: boolean;
    startControl: 'stop' | 'signal' | 'yield' | 'roundabout' | 'levelCrossing';
    endControl: 'stop' | 'signal' | 'yield' | 'roundabout' | 'levelCrossing';
    restrictionsFrom: 'outside-keep-start' | 'outside-keep-end';
  }[] = [
    {
      name: 'keep end to other start',
      keepPoints: [
        [0, 0],
        [1, 0],
      ],
      otherPoints: [
        [1, 0],
        [2, 0],
      ],
      reversedOther: false,
      startControl: 'stop',
      endControl: 'levelCrossing',
      restrictionsFrom: 'outside-keep-start',
    },
    {
      name: 'keep end to other end',
      keepPoints: [
        [0, 0],
        [1, 0],
      ],
      otherPoints: [
        [2, 0],
        [1, 0],
      ],
      reversedOther: true,
      startControl: 'stop',
      endControl: 'roundabout',
      restrictionsFrom: 'outside-keep-start',
    },
    {
      name: 'keep start to other end',
      keepPoints: [
        [1, 0],
        [2, 0],
      ],
      otherPoints: [
        [0, 0],
        [1, 0],
      ],
      reversedOther: false,
      startControl: 'roundabout',
      endControl: 'signal',
      restrictionsFrom: 'outside-keep-end',
    },
    {
      name: 'keep start to other start',
      keepPoints: [
        [1, 0],
        [2, 0],
      ],
      otherPoints: [
        [1, 0],
        [0, 0],
      ],
      reversedOther: true,
      startControl: 'levelCrossing',
      endControl: 'signal',
      restrictionsFrom: 'outside-keep-end',
    },
  ];

  for (const orientation of orientations) {
    it(`maps outer endpoint controls and drops seam controls for ${orientation.name}`, () => {
      const keep = aRoad('keep', orientation.keepPoints);
      const other = aRoad('other', orientation.otherPoints, {
        profile: orientation.reversedOther ? flipProfile(keep.profile) : keep.profile,
      });
      const system = aSystem({
        updatedAt: 456,
        ways: [keep, other],
        approachControls: {
          [armRefKey(keep.id, 'start')]: { control: 'stop' },
          [armRefKey(keep.id, 'end')]: { control: 'signal' },
          [armRefKey(other.id, 'start')]: { control: 'roundabout' },
          [armRefKey(other.id, 'end')]: { control: 'levelCrossing' },
        },
      });

      const merged = mergeWaysEndToEnd(system, keep.id, other.id);

      expect(merged.approachControls).toEqual({
        [armRefKey(keep.id, 'start')]: { control: orientation.startControl },
        [armRefKey(keep.id, 'end')]: { control: orientation.endControl },
      });
      expect(merged.updatedAt).toBe(456);
    });

    it(`keeps only outer lane restrictions for ${orientation.name}`, () => {
      const keep = aRoad('keep', orientation.keepPoints);
      const other = aRoad('other', orientation.otherPoints, {
        profile: orientation.reversedOther ? flipProfile(keep.profile) : keep.profile,
      });
      const target = aRoad('target', [
        [3, 0],
        [4, 0],
      ]);
      const feeder = aRoad('feeder', [
        [4, 0],
        [5, 0],
      ]);
      const forwardLaneId = laneId(keep, 'forward');
      const backwardLaneId = laneId(keep, 'backward');
      const feederLaneId = laneId(feeder, 'forward');
      const outsideKeepStart = orientation.restrictionsFrom === 'outside-keep-start';
      const system = aSystem({
        ways: [keep, other, target, feeder],
        turnRestrictions: {
          [laneRefKey(keep.id, forwardLaneId)]: { allowedTargets: ['keep-forward'] },
          [laneRefKey(keep.id, backwardLaneId)]: { allowedTargets: ['keep-backward'] },
          [laneRefKey(other.id, forwardLaneId)]: { allowedTargets: ['other-forward'] },
          [laneRefKey(other.id, backwardLaneId)]: { allowedTargets: ['other-backward'] },
          [laneRefKey(feeder.id, feederLaneId)]: {
            allowedTargets: [other.id, keep.id, target.id, other.id],
          },
        },
      });

      const merged = mergeWaysEndToEnd(system, keep.id, other.id);

      expect(merged.turnRestrictions).toEqual({
        [laneRefKey(keep.id, forwardLaneId)]: {
          allowedTargets: [outsideKeepStart ? 'other-forward' : 'keep-forward'],
        },
        [laneRefKey(keep.id, backwardLaneId)]: {
          allowedTargets: [outsideKeepStart ? 'keep-backward' : 'other-backward'],
        },
        [laneRefKey(feeder.id, feederLaneId)]: {
          allowedTargets: [keep.id, target.id],
        },
      });
    });
  }

  it('prunes the removed way and deleted named-way identities from dependent records', () => {
    const keep = aRoad('keep', [
      [0, 0],
      [1, 0],
    ]);
    const other = aRoad('other', [
      [1, 0],
      [2, 0],
    ]);
    const untouched = aRoad('untouched', [
      [3, 0],
      [4, 0],
    ]);
    const keptMedian = { kindId: 'median', widthM: 3 };
    const untouchedMedian = { kindId: 'median', widthM: 5 };
    const system = aSystem({
      updatedAt: 789,
      ways: [keep, other, untouched],
      namedWays: [
        { id: 'shared-name', name: 'Shared', wayIds: [keep.id, other.id] },
        { id: 'removed-name', name: 'Removed', wayIds: [other.id] },
        { id: 'untouched-name', name: 'Untouched', wayIds: [untouched.id] },
      ],
      medians: {
        'shared-name': keptMedian,
        'removed-name': { kindId: 'median', widthM: 4 },
        'untouched-name': untouchedMedian,
      },
      groups: [
        {
          id: 'group',
          memberIds: [keep.id, other.id, 'shared-name', 'removed-name', 'untouched-name'],
        },
      ],
    });

    const merged = mergeWaysEndToEnd(system, keep.id, other.id);

    expect(merged.namedWays).toEqual([
      { id: 'shared-name', name: 'Shared', wayIds: [keep.id] },
      { id: 'untouched-name', name: 'Untouched', wayIds: [untouched.id] },
    ]);
    expect(merged.medians).toEqual({
      'shared-name': keptMedian,
      'untouched-name': untouchedMedian,
    });
    expect(merged.medians['shared-name']).toBe(keptMedian);
    expect(merged.medians['untouched-name']).toBe(untouchedMedian);
    expect(merged.groups[0].memberIds).toEqual([keep.id, 'shared-name', 'untouched-name']);
    expect(merged.updatedAt).toBe(789);
  });
});
