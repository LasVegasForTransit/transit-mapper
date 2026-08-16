import { describe, expect, it } from 'vitest';
import {
  classifyGtfsRouteType,
  gtfsFilesToBatchedPieces,
  gtfsFilesToSystemPieces,
  parseGtfsCsv,
} from '@transitmapper/core/model/gtfsImport';
import { isOneWay, laneCapacity } from '@transitmapper/core/model/profile';
import { patternWayIds, primaryAnchor } from '@transitmapper/core/model/geo';
import { activeSchedule } from '@transitmapper/core/sim/clock';
import { planService } from '@transitmapper/core/sim/fleet';

describe('parseGtfsCsv: comma-separated + quoted-field GTFS text', () => {
  const rows = parseGtfsCsv('a,b,c\n1,"hello, world",3\n4,5,6\n');

  it('reads the header as keys', () => {
    expect(Object.keys(rows[0])).toEqual(['a', 'b', 'c']);
  });

  it('splits plain rows', () => {
    expect(rows).toHaveLength(2);
    expect(rows[1].a).toBe('4');
  });

  it('keeps a comma inside quotes as one field', () => {
    expect(rows[0].b).toBe('hello, world');
  });
});

describe('classifyGtfsRouteType: GTFS route_type → catalog mode/way type', () => {
  it('route_type 3 (bus) maps to bus/road', () => {
    expect(classifyGtfsRouteType(3)).toMatchObject({ modeId: 'bus', wayTypeId: 'road' });
  });

  it('route_type 1 (subway) maps to subway/heavyRail', () => {
    expect(classifyGtfsRouteType(1)).toMatchObject({ modeId: 'subway', wayTypeId: 'heavyRail' });
  });

  it('an unrecognized route_type falls back to bus/road', () => {
    expect(classifyGtfsRouteType(999).modeId).toBe('bus');
  });
});

describe('gtfsFilesToSystemPieces: a minimal fixture feed end to end', () => {
  const routes = 'route_id,route_short_name,route_type,route_color\nR1,101,3,E4572E\n';
  const trips = 'route_id,trip_id,shape_id\nR1,T1,S1\n';
  const shapes =
    'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n' +
    'S1,36.10,-115.20,1\nS1,36.10,-115.17,2\nS1,36.10,-115.14,3\n';
  const stops =
    'stop_id,stop_name,stop_lat,stop_lon\nST1,Downtown,36.10,-115.195\nST2,Midtown,36.10,-115.145\n';
  const stopTimes = 'trip_id,stop_id,stop_sequence\nT1,ST1,1\nT1,ST2,2\n';

  const pieces = gtfsFilesToSystemPieces({ routes, trips, shapes, stops, stopTimes });

  it('one shape becomes one way', () => {
    expect(pieces.ways).toHaveLength(1);
  });

  it('the way carries a GTFS source marker', () => {
    expect(pieces.ways[0].source).toBe('gtfs:S1');
  });

  it('the way is typed road (bus route)', () => {
    expect(pieces.ways[0].typeId).toBe('road');
  });

  // A GTFS shape is one direction of travel, so the bus way is a lean one-way carriageway.
  it('the imported bus way is a one-way carriageway', () => {
    expect(isOneWay(pieces.ways[0].profile)).toBe(true);
    expect(laneCapacity(pieces.ways[0].profile)).toBe(2);
  });

  it('one route becomes one service', () => {
    expect(pieces.services).toHaveLength(1);
  });

  it('the service takes its short name and mode', () => {
    expect(pieces.services[0]).toMatchObject({ name: '101', modeId: 'bus' });
  });

  it("the service has one pattern riding the shape's way", () => {
    expect(pieces.services[0].patterns).toHaveLength(1);
    expect(patternWayIds(pieces.services[0].patterns[0])[0]).toBe(pieces.ways[0].id);
  });

  it('the route color round-trips as a hex color', () => {
    expect(pieces.services[0].color).toBe('#E4572E');
  });

  it("both stops become stations, anchored onto the shape's way", () => {
    expect(pieces.stations).toHaveLength(2);
    expect(pieces.stations.map((s) => primaryAnchor(s)?.wayId)).toEqual([
      pieces.ways[0].id,
      pieces.ways[0].id,
    ]);
  });

  it('stations keep their GTFS stop names', () => {
    expect(pieces.stations.map((s) => s.name).sort()).toEqual(['Downtown', 'Midtown']);
  });

  // A stop shared by two routes/shapes stays exactly one station.
  it('a stop reachable from two shapes still becomes one station', () => {
    const trips2 = 'route_id,trip_id,shape_id\nR1,T1,S1\nR1,T2,S2\n';
    const shapes2 = shapes + 'S2,36.11,-115.20,1\nS2,36.11,-115.17,2\n';
    const stopTimes2 = stopTimes + 'T2,ST1,1\n';
    const shared = gtfsFilesToSystemPieces({
      routes,
      trips: trips2,
      shapes: shapes2,
      stops,
      stopTimes: stopTimes2,
    });
    expect(shared.stations.filter((s) => s.name === 'Downtown')).toHaveLength(1);
  });

  it('two shapes on the same route become two patterns', () => {
    const trips2 = 'route_id,trip_id,shape_id\nR1,T1,S1\nR1,T2,S2\n';
    const shapes2 = shapes + 'S2,36.11,-115.20,1\nS2,36.11,-115.17,2\n';
    const stopTimes2 = stopTimes + 'T2,ST1,1\n';
    const shared = gtfsFilesToSystemPieces({
      routes,
      trips: trips2,
      shapes: shapes2,
      stops,
      stopTimes: stopTimes2,
    });
    expect(shared.services[0].patterns).toHaveLength(2);
  });

  // Import brings in no timing at all, which is what keeps an agency-scale
  // feed cheap to animate: with no headway, every pattern plans exactly one
  // vehicle. This pins that relationship, because the day someone derives
  // headways from stop_times is the day fleet counts across hundreds of
  // patterns stop being one apiece — and that needs measuring first.
  //
  // This fixture's stop_times carry no departure_time, so there is nothing to
  // measure and the route imports untimed — the behavior every feed had before
  // service levels were derived at all. A feed that DOES publish times is
  // covered by the gtfsSchedule suite.
  it('a feed with no departure times imports no headway or span', () => {
    const imported = pieces.services[0];
    expect(imported.frequencyMinutes).toBeUndefined();
    expect(imported.spanStart).toBeUndefined();
    expect(imported.schedule).toBeUndefined();
  });

  it('an untimed service is always running, since it has no span to be outside of', () => {
    const imported = pieces.services[0];
    expect(activeSchedule(imported, 3 * 60, 'weekday')).not.toBeNull();
  });

  it('an untimed service plans a single vehicle per pattern', () => {
    const imported = pieces.services[0];
    expect(
      planService(2 * 600_000, activeSchedule(imported, 3 * 60, 'weekday')?.headwayMinutes).fleet,
    ).toBe(1);
  });
});

describe('gtfsFilesToBatchedPieces: batching sums to the same result, even a stop shared across batches', () => {
  const routes =
    'route_id,route_short_name,route_type,route_color\nR1,101,3,E4572E\nR2,102,3,00AEEF\nR3,103,3,2ECC71\n';
  const trips = 'route_id,trip_id,shape_id\nR1,T1,S1\nR2,T2,S2\nR3,T3,S3\n';
  const shapes =
    'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n' +
    'S1,36.10,-115.20,1\nS1,36.10,-115.17,2\n' +
    'S2,36.11,-115.20,1\nS2,36.11,-115.17,2\n' +
    'S3,36.12,-115.20,1\nS3,36.12,-115.17,2\n';
  // ST-shared is served by both R1 (batch 1) and R3 (batch 2, since batchSize
  // defaults to 2 — R1+R2 land in the first batch, R3 alone in the second).
  const stops =
    'stop_id,stop_name,stop_lat,stop_lon\nST-shared,Shared Stop,36.10,-115.185\nST-r2,R2 Stop,36.11,-115.185\n';
  const stopTimes = 'trip_id,stop_id,stop_sequence\nT1,ST-shared,1\nT2,ST-r2,1\nT3,ST-shared,1\n';

  const files = { routes, trips, stops, stopTimes, shapes };
  const batches = gtfsFilesToBatchedPieces(files, 2);
  const batchedTotal = {
    ways: batches.flatMap((b) => b.ways),
    services: batches.flatMap((b) => b.services),
    stations: batches.flatMap((b) => b.stations),
  };
  const unbatched = gtfsFilesToSystemPieces(files);

  it('3 routes at batch size 2 makes 2 batches', () => {
    expect(batches).toHaveLength(2);
  });

  it("the first batch carries 2 routes' worth of ways", () => {
    expect(batches[0].ways).toHaveLength(2);
  });

  it('the second batch carries the remaining route', () => {
    expect(batches[1].ways).toHaveLength(1);
  });

  it('batched ways total matches the unbatched pass', () => {
    expect(batchedTotal.ways.length).toBe(unbatched.ways.length);
  });

  it('batched services total matches the unbatched pass', () => {
    expect(batchedTotal.services.length).toBe(unbatched.services.length);
  });

  it('a stop shared across two different batches still becomes exactly one station, not two', () => {
    expect(batchedTotal.stations.filter((s) => s.name === 'Shared Stop')).toHaveLength(1);
    expect(unbatched.stations.filter((s) => s.name === 'Shared Stop')).toHaveLength(1);
  });

  it('batched stations total matches the unbatched pass', () => {
    expect(batchedTotal.stations.length).toBe(unbatched.stations.length);
  });
});
