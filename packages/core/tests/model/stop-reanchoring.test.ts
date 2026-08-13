import { describe, expect, it } from 'vitest';
import { nearestOnPath, resolveWayPath } from '../../src/model/geo';
import {
  reanchorStopsOnWay,
  reanchorStopsToReplacementWays,
  replacedStopAnchors,
} from '../../src/model/stop-reanchoring';
import { aRoad, aStop, aSystem } from '../support/fixtures.test';

describe('stop reanchoring', () => {
  it('replaces one way attachment without duplicating the destination way', () => {
    const stop = aStop('stop', [0, 0], undefined, {
      anchors: [
        { wayId: 'removed', t: 0.2 },
        { wayId: 'kept', t: 0.8 },
        { wayId: 'unrelated', t: 0.5 },
      ],
    });

    expect(replacedStopAnchors(stop, 'removed', { wayId: 'kept', t: 0.3 })).toEqual([
      { wayId: 'kept', t: 0.3 },
      { wayId: 'unrelated', t: 0.5 },
    ]);
  });

  it('preserves the stops reference when reprojection changes nothing', () => {
    const way = aRoad('way', [
      [-115.2, 36.1],
      [-115.18, 36.1],
    ]);
    const stop = aStop('stop', [-115.19, 36.1], { wayId: way.id, t: 0.5 });
    const system = aSystem({ ways: [way], stops: [stop] });

    const result = reanchorStopsOnWay(system, way.id);

    expect(result).toBe(system.stops);
    expect(result[0]).toBe(stop);
  });

  it('reprojects an anchored stop while preserving its other anchors', () => {
    const way = aRoad('way', [
      [-115.2, 36.1],
      [-115.18, 36.12],
    ]);
    const stop = aStop(
      'stop',
      [-115.19, 36.1],
      { wayId: way.id, t: 0.5 },
      {
        anchors: [
          { wayId: way.id, t: 0.5 },
          { wayId: 'other', t: 0.8 },
        ],
      },
    );
    const system = aSystem({ ways: [way], stops: [stop] });
    const projected = nearestOnPath(resolveWayPath(way), stop.coord);
    if (!projected) throw new Error('The stop fixture must project onto its way.');

    const result = reanchorStopsOnWay(system, way.id);

    expect(result).not.toBe(system.stops);
    expect(result[0].coord).toEqual(projected.coord);
    expect(result[0].anchors).toEqual([{ wayId: way.id, t: projected.t }, stop.anchors[1]]);
  });

  it('preserves unaffected stops while detaching removed ways without a nearby replacement', () => {
    const removed = aRoad('removed', [
      [-115.2, 36.1],
      [-115.18, 36.1],
    ]);
    const distant = aRoad('distant', [
      [-114.2, 35.1],
      [-114.18, 35.1],
    ]);
    const affected = aStop('affected', [-115.19, 36.1], undefined, {
      anchors: [
        { wayId: removed.id, t: 0.5 },
        { wayId: 'unrelated', t: 0.8 },
      ],
    });
    const unaffected = aStop('unaffected', [-115.17, 36.1]);
    const system = aSystem({ ways: [removed, distant], stops: [affected, unaffected] });

    const result = reanchorStopsToReplacementWays(system, {
      replacedWayIds: new Set([removed.id]),
      replacementWayIds: new Set([distant.id]),
      maxDistanceM: 300,
    });

    expect(result).not.toBe(system.stops);
    expect(result[0].anchors).toEqual([{ wayId: 'unrelated', t: 0.8 }]);
    expect(result[1]).toBe(unaffected);
    expect(
      reanchorStopsToReplacementWays(system, {
        replacedWayIds: new Set(['missing']),
        replacementWayIds: new Set([distant.id]),
        maxDistanceM: 300,
      }),
    ).toBe(system.stops);
  });
});
