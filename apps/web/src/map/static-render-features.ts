import type { TransitSystem } from '@transitmapper/core/model/system';
import type { SystemFeatures, ViewOptions } from '@transitmapper/core/render/buildFeatures';
import { ALL_SYSTEM_FEATURE_SOURCES } from './system-feature-sources';
import type { FeatureProjectionWorkerClient } from './feature-projection-worker';
import {
  renderPresentationForFittedMap,
  type FittedMapLike,
  type StaticDisplaySize,
} from './fitted-map-presentation';

export { renderPresentationForFittedMap, type FittedMapLike } from './fitted-map-presentation';

/**
 * Static maps use the same feature worker as the editor. The camera is still
 * read on the main thread after fitting, but core geometry and stable visual
 * ordering no longer make an export or onboarding preview compete with input.
 */
export interface FittedMapFeatureProjectionOptions extends StaticDisplaySize {
  readonly worker: Pick<FeatureProjectionWorkerClient, 'project'>;
  readonly system: TransitSystem;
  readonly view: ViewOptions;
  readonly map: FittedMapLike;
  readonly signal?: AbortSignal;
}

export async function projectFeaturesForFittedMap({
  worker,
  system,
  view,
  map,
  signal,
  ...display
}: FittedMapFeatureProjectionOptions): Promise<SystemFeatures> {
  const result = await worker.project(
    {
      system,
      selection: null,
      handleWayIds: [],
      view: { ...view, presentation: renderPresentationForFittedMap(map, display) },
      sourceIds: ALL_SYSTEM_FEATURE_SOURCES,
      normalizeVisualScene: true,
      sceneRevision: `static:${system.id}`,
    },
    signal,
  );
  return result.features;
}
