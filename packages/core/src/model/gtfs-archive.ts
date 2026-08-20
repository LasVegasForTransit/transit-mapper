import { strFromU8, unzipSync } from 'fflate';
import {
  gtfsFilesToBatchedPieces,
  parseGtfsCsv,
  type GtfsFiles,
  type GtfsImportBatch,
} from './gtfsImport';

function filesFromArchive(archive: Uint8Array): GtfsFiles {
  const zip = unzipSync(archive);
  const read = (name: string) => (Object.hasOwn(zip, name) ? strFromU8(zip[name]) : '');
  return {
    routes: read('routes.txt'),
    trips: read('trips.txt'),
    stops: read('stops.txt'),
    stopTimes: read('stop_times.txt'),
    frequencies: read('frequencies.txt'),
    shapes: read('shapes.txt'),
  };
}

function routeCount(files: GtfsFiles): number {
  return new Set(
    parseGtfsCsv(files.trips)
      .filter((trip) => trip.route_id && trip.shape_id)
      .map((trip) => trip.route_id),
  ).size;
}

/** Inflate, decode, index, and batch a GTFS ZIP without touching the network. */
export function gtfsArchiveToBatches(
  archive: Uint8Array,
  requestedBatchSize = 2,
): GtfsImportBatch[] {
  const files = filesFromArchive(archive);
  const routesTotal = routeCount(files);
  const batchSize = Math.max(1, Math.floor(requestedBatchSize));
  return gtfsFilesToBatchedPieces(files, batchSize).map((pieces, index) => ({
    pieces,
    routesDone: Math.min((index + 1) * batchSize, routesTotal),
    routesTotal,
  }));
}
