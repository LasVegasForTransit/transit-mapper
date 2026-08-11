import type { TransitSystem } from '@transitmapper/core/model/system';
import { servicesAtStation } from '@transitmapper/core/sim/frequency';

/** Network view intentionally omits stops that no visible service reaches.
 * The offline edit proof must target the same served-station contract as the
 * production renderer or its pointer gesture can only hit empty map space. */
export function networkEditStationId(system: TransitSystem): string | null {
  const [centerLongitude, centerLatitude] = system.viewport.center;
  let closest: { id: string; distance: number } | null = null;
  for (const station of system.stations) {
    if (servicesAtStation(system.ways, system.services, station).length === 0) continue;
    const longitudeDistance = station.coord[0] - centerLongitude;
    const latitudeDistance = station.coord[1] - centerLatitude;
    const distance = longitudeDistance ** 2 + latitudeDistance ** 2;
    if (!closest || distance < closest.distance) closest = { id: station.id, distance };
  }
  return closest?.id ?? null;
}
