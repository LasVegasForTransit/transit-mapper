/**
 * The accepted CPU representation shared by the resumable scene draft and
 * editor feature-state updates.
 *
 * This module deliberately contains no projection or upload behavior. The
 * committed renderer has one drafting path; editor code only needs to resolve
 * the stable visual feature IDs that belong to a selected domain.
 */
import type {
  RenderDomainIdentity,
  RenderFeatureId,
  SystemFeatureSourceId,
} from '@transitmapper/core/render/render-identity';
import type { RenderScene } from '@transitmapper/core/render/render-scene';
import type { IncrementalSourceState } from './scene-source-state';

export interface IncrementalLiveSceneState {
  readonly sourceStates: ReadonlyMap<SystemFeatureSourceId, IncrementalSourceState>;
  readonly scene: RenderScene;
}

export interface IncrementalFeatureStateTarget {
  readonly sourceId: SystemFeatureSourceId;
  readonly featureId: RenderFeatureId;
}

/** Resolves only paintable features. Hit geometry remains query-only and must
 * never receive selection or hover state. */
export function visualTargetsForDomain(
  state: IncrementalLiveSceneState | null,
  domainIdentity: RenderDomainIdentity,
): readonly IncrementalFeatureStateTarget[] {
  if (!state) return [];
  const targets: IncrementalFeatureStateTarget[] = [];
  for (const sourceState of state.sourceStates.values()) {
    for (const featureId of sourceState.visualDomains.get(domainIdentity) ?? []) {
      targets.push({ sourceId: sourceState.sourceId, featureId });
    }
  }
  return targets;
}
