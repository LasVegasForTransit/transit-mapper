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

/** Fetch the RTC feed and yield its pure archive transform in small batches. */
export async function* streamRtcGtfsBatches(batchSize = 2): AsyncGenerator<GtfsImportBatch> {
  const response = await fetch('/api/gtfs/rtc');
  if (!response.ok) throw new Error(`GTFS import failed (${response.status}).`);
  const batches = gtfsArchiveToBatches(new Uint8Array(await response.arrayBuffer()), batchSize);
  for (const batch of batches) {
    yield batch;
    // Timers keep an import moving in background tabs where animation frames pause.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
