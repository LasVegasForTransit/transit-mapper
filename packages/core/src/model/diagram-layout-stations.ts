/**
 * Diagram-specific passenger-place placement. A station is a container for
 * stops in the document, so its Diagram focus point follows those rendered
 * stops rather than preserving a geographic centroid from Infrastructure.
 */
import type { LngLat, Station, Stop } from './system';

const stationCache = new WeakMap<Station[], WeakMap<Stop[], Station[]>>();

export function diagramStationsFor(stations: Station[], stops: Stop[]): Station[] {
  if (stations.length === 0) return stations;
  let byStops = stationCache.get(stations);
  if (!byStops) {
    byStops = new WeakMap();
    stationCache.set(stations, byStops);
  }
  const cached = byStops.get(stops);
  if (cached) return cached;

  const stopsByStation = new Map<string, Stop[]>();
  for (const stop of stops) {
    if (!stop.stationId) continue;
    const members = stopsByStation.get(stop.stationId);
    if (members) members.push(stop);
    else stopsByStation.set(stop.stationId, [stop]);
  }
  const projected = stations.map((station) => {
    const members = stopsByStation.get(station.id);
    if (!members || members.length === 0) return station;
    const coord = stationAnchor(members);
    if (coord[0] === station.coord[0] && coord[1] === station.coord[1]) return station;
    return { ...station, coord };
  });
  const result = projected.some((station, index) => station !== stations[index])
    ? projected
    : stations;
  byStops.set(stops, result);
  return result;
}

function stationAnchor(stops: readonly Stop[]): LngLat {
  let longitude = 0;
  let latitude = 0;
  for (const stop of stops) {
    longitude += stop.coord[0];
    latitude += stop.coord[1];
  }
  return [longitude / stops.length, latitude / stops.length];
}
