import { laneRefKey } from '../../src/model/components';
import { oneSection, stretchLeg, wholeLeg } from '../../src/model/geo';
import { mergeLegs } from '../../src/model/patternEdits';
import type { LaneDirection, Way } from '../../src/model/system';
import { mergeWaysEndToEnd } from '../../src/model/way-merge-edits';
import { splitWayAtIndex } from '../../src/model/way-split-edits';
import { aRoad, aService, aStop, aSystem } from '../support/fixtures.test';
import { describe, expect, it, vi } from 'vitest';

function laneId(way: Way, direction: LaneDirection): string {
  const lane = way.profile.lanes.find((candidate) => candidate.direction === direction);
  if (!lane) throw new Error(`The fixture needs a ${direction} lane.`);
  return lane.id;
}

describe('way split and merge regressions', () => {
  it('keeps touching remapped legs separate when they pin different lanes', () => {
    const keepLeg = {
      ...wholeLeg('keep'),
      lane: { kind: 'pinned' as const, laneId: 'keep-lane' },
    };
    const otherLeg = {
      ...wholeLeg('other'),
      lane: { kind: 'pinned' as const, laneId: 'other-lane' },
    };

    const merged = mergeLegs([keepLeg, otherLeg], 'keep', 'other', {
      positionOf: (wayId, t) => (wayId === 'keep' ? t / 2 : (1 + t) / 2),
      reversed: () => false,
    });

    expect(merged).toEqual([
      stretchLeg(keepLeg, 0, 0.5),
      { ...stretchLeg(otherLeg, 0.5, 1), wayId: 'keep' },
    ]);
  });

  it('remaps neighboring turn targets to the split half at their shared endpoint', () => {
    const road = aRoad('road', [
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
    const westFeeder = aRoad('west-feeder', [
      [0, 1],
      [0, 0],
    ]);
    const eastFeeder = aRoad('east-feeder', [
      [2, 1],
      [2, 0],
    ]);
    const westLaneId = laneId(westFeeder, 'forward');
    const eastLaneId = laneId(eastFeeder, 'forward');
    const system = aSystem({
      ways: [road, westFeeder, eastFeeder],
      nodes: [
        {
          id: 'west-junction',
          coord: [0, 0],
          refs: [
            { wayId: road.id, pointIndex: 0 },
            { wayId: westFeeder.id, pointIndex: 1 },
          ],
        },
        {
          id: 'east-junction',
          coord: [2, 0],
          refs: [
            { wayId: road.id, pointIndex: 2 },
            { wayId: eastFeeder.id, pointIndex: 1 },
          ],
        },
      ],
      turnRestrictions: {
        [laneRefKey(westFeeder.id, westLaneId)]: { allowedTargets: [road.id] },
        [laneRefKey(eastFeeder.id, eastLaneId)]: { allowedTargets: [road.id] },
      },
    });
    const createId = vi
      .fn<() => string>()
      .mockReturnValueOnce('east-half')
      .mockReturnValueOnce('split-node');

    const split = splitWayAtIndex(system, road.id, 1, createId);

    expect(split.turnRestrictions[laneRefKey(westFeeder.id, westLaneId)]).toEqual({
      allowedTargets: [road.id],
    });
    expect(split.turnRestrictions[laneRefKey(eastFeeder.id, eastLaneId)]).toEqual({
      allowedTargets: ['east-half'],
    });
  });

  it('preserves untouched dependent collection references when splitting a way', () => {
    const road = aRoad('road', [
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
    const untouched = aRoad('untouched', [
      [3, 0],
      [4, 0],
    ]);
    const service = aService('service', [
      { id: 'service', sections: oneSection([wholeLeg(untouched.id)]) },
    ]);
    const stop = aStop('stop', [3.5, 0], { wayId: untouched.id, t: 0.5 });
    const system = aSystem({
      ways: [road, untouched],
      services: [service],
      stops: [stop],
      namedWays: [{ id: 'name', name: 'Untouched', wayIds: [untouched.id] }],
    });
    const createId = vi
      .fn<() => string>()
      .mockReturnValueOnce('east-half')
      .mockReturnValueOnce('split-node');

    const split = splitWayAtIndex(system, road.id, 1, createId);

    expect(split.services).toBe(system.services);
    expect(split.stops).toBe(system.stops);
    expect(split.namedWays).toBe(system.namedWays);
  });

  it('preserves compatible explicit connectors while merging their way identity', () => {
    const keep = aRoad('keep', [
      [0, 0],
      [1, 0],
    ]);
    const other = aRoad('other', [
      [1, 0],
      [2, 0],
    ]);
    const branch = aRoad('branch', [
      [2, 0],
      [2, 1],
    ]);
    const otherLaneId = laneId(other, 'forward');
    const keepLaneId = laneId(keep, 'forward');
    const branchLaneId = laneId(branch, 'forward');
    const system = aSystem({
      ways: [keep, other, branch],
      nodes: [
        {
          id: 'outer-junction',
          coord: [2, 0],
          refs: [
            { wayId: other.id, pointIndex: 1 },
            { wayId: branch.id, pointIndex: 0 },
          ],
          connectors: [
            {
              from: { wayId: other.id, laneId: otherLaneId },
              to: { wayId: branch.id, laneId: branchLaneId },
            },
            {
              from: { wayId: branch.id, laneId: branchLaneId },
              to: { wayId: other.id, laneId: otherLaneId },
            },
          ],
        },
      ],
    });

    const merged = mergeWaysEndToEnd(system, keep.id, other.id);

    expect(merged.nodes[0].connectors).toEqual([
      {
        from: { wayId: keep.id, laneId: keepLaneId },
        to: { wayId: branch.id, laneId: branchLaneId },
      },
      {
        from: { wayId: branch.id, laneId: branchLaneId },
        to: { wayId: keep.id, laneId: keepLaneId },
      },
    ]);
  });

  it('remaps a pinned service lane across compatible profiles with distinct lane identities', () => {
    const keep = aRoad('keep', [
      [0, 0],
      [1, 0],
    ]);
    const other = aRoad('other', [
      [1, 0],
      [2, 0],
    ]);
    const otherLaneId = laneId(other, 'forward');
    const service = aService('service', [
      {
        id: 'service',
        sections: oneSection([
          {
            ...wholeLeg(other.id),
            lane: { kind: 'pinned', laneId: otherLaneId },
          },
        ]),
      },
    ]);
    const system = aSystem({ ways: [keep, other], services: [service] });

    const merged = mergeWaysEndToEnd(system, keep.id, other.id);
    const mergedSection = merged.services[0].path.sections[0];
    if (mergedSection.kind !== 'shared') throw new Error('The fixture needs a shared section.');

    expect(mergedSection.legs[0]).toMatchObject({
      wayId: keep.id,
      lane: { kind: 'pinned', laneId: laneId(keep, 'forward') },
    });
  });

  it('refuses to merge profile-incompatible ways before invalidating pinned lanes', () => {
    const keep = aRoad('keep', [
      [0, 0],
      [1, 0],
    ]);
    const other = aRoad('other', [
      [1, 0],
      [2, 0],
    ]);
    const otherLaneId = laneId(other, 'forward');
    const incompatible = {
      ...other,
      profile: {
        lanes: other.profile.lanes.map((lane) =>
          lane.id === otherLaneId ? { ...lane, widthM: lane.widthM + 1 } : lane,
        ),
      },
    };
    const service = aService('service', [
      {
        id: 'service',
        sections: oneSection([
          {
            ...wholeLeg(incompatible.id),
            lane: { kind: 'pinned', laneId: otherLaneId },
          },
        ]),
      },
    ]);
    const system = aSystem({ ways: [keep, incompatible], services: [service] });

    expect(mergeWaysEndToEnd(system, keep.id, incompatible.id)).toBe(system);
  });
});
