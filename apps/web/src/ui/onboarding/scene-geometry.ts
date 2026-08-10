import { cumulativeLengths, pointAtDistance } from '@transitmapper/core/model/geo';
import type { LngLat } from '@transitmapper/core/model/system';
import { runStateAt } from '@transitmapper/core/sim/fleet';
import { ONBOARDING_VEHICLE_RUNS } from './fixtureSystem';

function samePoint(a: LngLat | undefined, b: LngLat): boolean {
  return a?.[0] === b[0] && a[1] === b[1];
}

/** Reveals a route by arc length, preserving every real source vertex already
 * reached and interpolating only the current endpoint. The animation therefore
 * follows bends in the street network instead of drawing a generic chord. */
export function pathPrefix(path: LngLat[], progress: number): LngLat[] {
  if (path.length === 0) return [];
  if (path.length === 1 || progress <= 0) return [path[0]];
  if (progress >= 1) return path;

  const lengths = cumulativeLengths(path);
  const target = lengths[lengths.length - 1] * progress;
  let endIndex = 1;
  while (endIndex < lengths.length && lengths[endIndex] < target) endIndex++;

  const prefix = path.slice(0, endIndex);
  const endpoint = pointAtDistance(path, lengths, target);
  if (!samePoint(prefix.at(-1), endpoint)) prefix.push(endpoint);
  return prefix;
}

interface OnboardingVehicleProperties {
  id: string;
  color: string;
}

/** Positions one representative vehicle on every proposal pattern. Plans,
 * paths, direction changes, dwells, and layovers all come from the same core
 * simulation objects the editor uses; only the number of dots is preview-sized. */
export function vehicleFeaturesAt(
  simMs: number,
): GeoJSON.FeatureCollection<GeoJSON.Point, OnboardingVehicleProperties> {
  return {
    type: 'FeatureCollection',
    features: ONBOARDING_VEHICLE_RUNS.flatMap((run) => {
      const { stats } = run;
      if (!stats.plan) return [];
      const state = runStateAt(simMs, stats.timetables, stats.plan, 0, run.profile);
      const coordinates =
        state.run === 'outbound'
          ? pointAtDistance(stats.path, stats.cumLengths, state.distMeters)
          : pointAtDistance(stats.inboundPath, run.inboundCumLengths, state.distMeters);
      return [
        {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates },
          properties: { id: run.id, color: run.color },
        },
      ];
    }),
  };
}
