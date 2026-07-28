import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { gtfsArchiveToBatches } from './gtfsImport';

function rtcLikeArchive(): Uint8Array {
  return zipSync({
    'routes.txt': strToU8(
      'route_id,route_short_name,route_long_name,route_type\nR1,1,North,3\nR2,2,South,3\n',
    ),
    'trips.txt': strToU8(
      'route_id,service_id,trip_id,direction_id,shape_id\nR1,WK,T1,0,S1\nR2,WK,T2,0,S2\n',
    ),
    'stops.txt': strToU8(
      'stop_id,stop_name,stop_lat,stop_lon\nA,Alpha,36.10,-115.20\nB,Beta,36.11,-115.19\n',
    ),
    'stop_times.txt': strToU8(
      'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nT1,08:00:00,08:00:00,A,1\nT2,08:10:00,08:10:00,B,1\n',
    ),
    'shapes.txt': strToU8(
      'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\nS1,36.10,-115.20,1\nS1,36.11,-115.19,2\nS2,36.11,-115.19,1\nS2,36.12,-115.18,2\n',
    ),
  });
}

describe('GTFS archive batching', () => {
  it('inflates, decodes, indexes, and batches an archive without network access', () => {
    const batches = gtfsArchiveToBatches(rtcLikeArchive(), 1);

    expect(batches).toHaveLength(2);
    expect(batches.map((batch) => batch.routesDone)).toEqual([1, 2]);
    expect(batches.every((batch) => batch.routesTotal === 2)).toBe(true);
    expect(batches.flatMap((batch) => batch.pieces.services)).toHaveLength(2);
  });
});
