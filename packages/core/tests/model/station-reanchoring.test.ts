import { describe, expect, it } from 'vitest';
import { nearestOnPath, resolveWayPath } from '../../src/model/geo';
import {
  reanchorStationsOnWay,
  reanchorStationsToReplacementWays,
  replacedStationAnchors,
} from '../../src/model/station-reanchoring';
import { aRoad, aStation, aSystem } from '../support/fixtures.test';

describe('station reanchoring', () => {
  it('replaces one way attachment without duplicating the destination way', () => {
    const station = aStation('station', [0, 0], undefined, {
      anchors: [
        { wayId: 'removed', t: 0.2 },
        { wayId: 'kept', t: 0.8 },
        { wayId: 'unrelated', t: 0.5 },
      ],
    });

    expect(replacedStationAnchors(station, 'removed', { wayId: 'kept', t: 0.3 })).toEqual([
      { wayId: 'kept', t: 0.3 },
      { wayId: 'unrelated', t: 0.5 },
    ]);
  });

  it('preserves the stations reference when reprojection changes nothing', () => {
    const way = aRoad('way', [
      [-115.2, 36.1],
      [-115.18, 36.1],
    ]);
    const station = aStation('station', [-115.19, 36.1], { wayId: way.id, t: 0.5 });
    const system = aSystem({ ways: [way], stations: [station] });

    const result = reanchorStationsOnWay(system, way.id);

    expect(result).toBe(system.stations);
    expect(result[0]).toBe(station);
  });

  it('reprojects an anchored station while preserving its other anchors', () => {
    const way = aRoad('way', [
      [-115.2, 36.1],
      [-115.18, 36.12],
    ]);
    const station = aStation(
      'station',
      [-115.19, 36.1],
      { wayId: way.id, t: 0.5 },
      {
        anchors: [
          { wayId: way.id, t: 0.5 },
          { wayId: 'other', t: 0.8 },
        ],
      },
    );
    const system = aSystem({ ways: [way], stations: [station] });
    const projected = nearestOnPath(resolveWayPath(way), station.coord);
    if (!projected) throw new Error('The station fixture must project onto its way.');

    const result = reanchorStationsOnWay(system, way.id);

    expect(result).not.toBe(system.stations);
    expect(result[0].coord).toEqual(projected.coord);
    expect(result[0].anchors).toEqual([{ wayId: way.id, t: projected.t }, station.anchors[1]]);
  });

  it('preserves unaffected stations while detaching removed ways without a nearby replacement', () => {
    const removed = aRoad('removed', [
      [-115.2, 36.1],
      [-115.18, 36.1],
    ]);
    const distant = aRoad('distant', [
      [-114.2, 35.1],
      [-114.18, 35.1],
    ]);
    const affected = aStation('affected', [-115.19, 36.1], undefined, {
      anchors: [
        { wayId: removed.id, t: 0.5 },
        { wayId: 'unrelated', t: 0.8 },
      ],
    });
    const unaffected = aStation('unaffected', [-115.17, 36.1]);
    const system = aSystem({ ways: [removed, distant], stations: [affected, unaffected] });

    const result = reanchorStationsToReplacementWays(system, {
      replacedWayIds: new Set([removed.id]),
      replacementWayIds: new Set([distant.id]),
      maxDistanceM: 300,
    });

    expect(result).not.toBe(system.stations);
    expect(result[0].anchors).toEqual([{ wayId: 'unrelated', t: 0.8 }]);
    expect(result[1]).toBe(unaffected);
    expect(
      reanchorStationsToReplacementWays(system, {
        replacedWayIds: new Set(['missing']),
        replacementWayIds: new Set([distant.id]),
        maxDistanceM: 300,
      }),
    ).toBe(system.stations);
  });
});
