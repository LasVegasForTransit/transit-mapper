import { describe, expect, it } from 'vitest';
import { nearestOnPath, resolveWayPath } from '../../src/model/geo';
import { reanchorStationsOnWay } from '../../src/model/station-reanchoring';
import { aRoad, aStation, aSystem } from '../support/fixtures.test';

describe('station reanchoring', () => {
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
});
