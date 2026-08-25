import { cumulativeLengths, pointAtDistance } from '@transitmapper/core/model/geo';
import type { LngLat } from '@transitmapper/core/model/system';
import type { SystemFeatures } from '@transitmapper/core/render/buildFeatures';
import { runStateAt } from '@transitmapper/core/sim/fleet';
import { SRC_PREVIEW } from '@transitmapper/renderer/layers';
import { ONBOARDING_AUTHORED_CONNECTOR_ID, ONBOARDING_VEHICLE_RUNS } from './fixtureSystem';
import type { OnboardingSceneId } from './slides';

export interface OnboardingScenePresentation {
  previewSource: typeof SRC_PREVIEW | null;
  selectedWayId: string | null;
}

/** Names only real editor presentation states. The controller consumes this
 * plan so onboarding cannot quietly grow a parallel draw or selection style. */
export function onboardingScenePresentation(scene: OnboardingSceneId): OnboardingScenePresentation {
  return {
    previewSource: scene === 'draw' ? SRC_PREVIEW : null,
    selectedWayId: scene === 'infrastructure' ? ONBOARDING_AUTHORED_CONNECTOR_ID : null,
  };
}

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

/** Reuses the production service feature and replaces only its geometry while
 * the draw demonstration is in progress. This keeps color, mode, line identity,
 * and hit-target behavior aligned with the editor's actual service rendering. */
export function onboardingDrawnServiceFeatures(
  completeFeatures: SystemFeatures,
  coordinates: LngLat[],
): SystemFeatures['services'] {
  if (coordinates.length < 2) return { type: 'FeatureCollection', features: [] };
  const template = completeFeatures.services.features.find(
    (feature) => feature.properties?.hitTarget !== true,
  );
  if (!template) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: [
      {
        ...template,
        geometry: { type: 'LineString', coordinates },
      },
    ],
  };
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
