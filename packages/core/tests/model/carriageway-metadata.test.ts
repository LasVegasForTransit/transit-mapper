import { describe, expect, it } from 'vitest';
import { combineCarriageways } from '../../src/model/carriageway-edits';
import { armRefKey, laneRefKey } from '../../src/model/components';
import { defaultProfileFor, makeOneWay } from '../../src/model/profile';
import { aRoad, aSystem } from '../support/fixtures.test';

describe('carriageway metadata', () => {
  it('refuses one-way pairs that run in the same physical direction', () => {
    const keeper = aRoad(
      'keeper',
      [
        [0, 0],
        [2, 0],
      ],
      { profile: makeOneWay(defaultProfileFor('road'), 'forward') },
    );
    const samePointOrder = aRoad(
      'same-order',
      [
        [0, 0.1],
        [2, 0.1],
      ],
      { profile: makeOneWay(defaultProfileFor('road'), 'forward') },
    );
    const oppositePointOrder = aRoad(
      'opposite-order',
      [
        [2, 0.1],
        [0, 0.1],
      ],
      { profile: makeOneWay(defaultProfileFor('road'), 'backward') },
    );

    for (const other of [samePointOrder, oppositePointOrder]) {
      const system = aSystem({
        updatedAt: 456,
        ways: [keeper, other],
        namedWays: [{ id: 'pair', name: 'Main Street', wayIds: [keeper.id, other.id] }],
      });

      expect(combineCarriageways(system, 'pair')).toBe(system);
    }
  });

  it('moves absorbed endpoint metadata and turn targets onto the keeper', () => {
    const keeper = aRoad(
      'keeper',
      [
        [0, 0],
        [2, 0],
      ],
      { profile: makeOneWay(defaultProfileFor('road'), 'forward') },
    );
    const other = aRoad(
      'other',
      [
        [0, 0.1],
        [2, 0.1],
      ],
      { profile: makeOneWay(defaultProfileFor('road'), 'backward') },
    );
    const feeder = aRoad('feeder', [
      [0, -1],
      [0, 0],
    ]);
    const target = aRoad('target', [
      [0, 0],
      [0, 1],
    ]);
    const absorbedLaneId = other.profile.lanes.find((lane) => lane.direction === 'backward')?.id;
    const feederLaneId = feeder.profile.lanes.find((lane) => lane.direction === 'forward')?.id;
    const targetLaneId = target.profile.lanes.find((lane) => lane.direction === 'forward')?.id;
    if (!absorbedLaneId || !feederLaneId || !targetLaneId) {
      throw new Error('The fixture needs directional lanes.');
    }
    const untouchedControl = { control: 'roundabout' as const };
    const untouchedRestriction = { allowedTargets: [target.id] };
    const system = aSystem({
      updatedAt: 123,
      ways: [keeper, other, feeder, target],
      namedWays: [{ id: 'pair', name: 'Main Street', wayIds: [keeper.id, other.id] }],
      approachControls: {
        [armRefKey(other.id, 'start')]: { control: 'stop' },
        [armRefKey(other.id, 'end')]: { control: 'signal' },
        [armRefKey(feeder.id, 'start')]: untouchedControl,
      },
      turnRestrictions: {
        [laneRefKey(other.id, absorbedLaneId)]: { allowedTargets: [feeder.id] },
        [laneRefKey(feeder.id, feederLaneId)]: {
          allowedTargets: [other.id, target.id, other.id],
        },
        [laneRefKey(target.id, targetLaneId)]: untouchedRestriction,
      },
    });

    const combined = combineCarriageways(system, 'pair');

    expect(combined.approachControls).toEqual({
      [armRefKey(keeper.id, 'start')]: { control: 'stop' },
      [armRefKey(keeper.id, 'end')]: { control: 'signal' },
      [armRefKey(feeder.id, 'start')]: untouchedControl,
    });
    expect(combined.turnRestrictions).toEqual({
      [laneRefKey(keeper.id, absorbedLaneId)]: { allowedTargets: [feeder.id] },
      [laneRefKey(feeder.id, feederLaneId)]: {
        allowedTargets: [keeper.id, target.id],
      },
      [laneRefKey(target.id, targetLaneId)]: untouchedRestriction,
    });
    expect(combined.approachControls[armRefKey(feeder.id, 'start')]).toBe(untouchedControl);
    expect(combined.turnRestrictions[laneRefKey(target.id, targetLaneId)]).toBe(
      untouchedRestriction,
    );
    expect(combined.updatedAt).toBe(123);
  });
});
