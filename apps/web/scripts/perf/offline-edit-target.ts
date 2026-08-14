import type { TransitSystem } from '@transitmapper/core/model/system';
import { servicesAtStop } from '@transitmapper/core/sim/frequency';

/** Network view intentionally omits stops that no visible service reaches.
 * The offline edit proof must target the same served-station contract as the
 * production renderer or its pointer gesture can only hit empty map space. */
export function networkEditStopId(system: TransitSystem): string | null {
  const [centerLongitude, centerLatitude] = system.viewport.center;
  let closest: { id: string; distance: number } | null = null;
  for (const stop of system.stops) {
    if (servicesAtStop(system.ways, system.services, stop).length === 0) continue;
    const longitudeDistance = stop.coord[0] - centerLongitude;
    const latitudeDistance = stop.coord[1] - centerLatitude;
    const distance = longitudeDistance ** 2 + latitudeDistance ** 2;
    if (!closest || distance < closest.distance) closest = { id: stop.id, distance };
  }
  return closest?.id ?? null;
}
