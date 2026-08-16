import type { TransitSystem } from '@transitmapper/core/model/system';
import { servicesAtStop } from '@transitmapper/core/sim/frequency';

/** Network view intentionally omits stops that no visible service reaches.
 * The offline edit proof uses this ordered set to choose one that MapLibre
 * also confirms as rendered after an offline reload. */
export function networkEditStopCandidates(
  system: TransitSystem,
): readonly TransitSystem['stops'][number][] {
  const [centerLongitude, centerLatitude] = system.viewport.center;
  return system.stops
    .filter((stop) => servicesAtStop(system.ways, system.services, stop).length > 0)
    .toSorted((left, right) => {
      const leftLongitudeDistance = left.coord[0] - centerLongitude;
      const leftLatitudeDistance = left.coord[1] - centerLatitude;
      const rightLongitudeDistance = right.coord[0] - centerLongitude;
      const rightLatitudeDistance = right.coord[1] - centerLatitude;
      return (
        leftLongitudeDistance ** 2 +
        leftLatitudeDistance ** 2 -
        (rightLongitudeDistance ** 2 + rightLatitudeDistance ** 2)
      );
    });
}

/** Preserves the primary target for callers that do not inspect the live
 * MapLibre scene. Browser acceptance uses the complete candidate set above. */
export function networkEditStopId(system: TransitSystem): string | null {
  return networkEditStopCandidates(system)[0]?.id ?? null;
}
