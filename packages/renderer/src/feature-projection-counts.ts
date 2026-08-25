/**
 * Operation counts shared by main-thread publication and the feature worker.
 *
 * The counter values are plain structured-clone data. Keeping their merge
 * rule separate from feature construction lets the editor account for a
 * worker result without importing the core projector into its own bundle.
 */
import type { DiagramLayoutOperationCounts } from '@transitmapper/core/model/diagramLayout';
import {
  createFeatureBuildOperationCounts,
  type FeatureBuildOperationCounts,
} from '@transitmapper/core/render/feature-build-operation-counts';

export interface SourceFeatureProjectionCounts
  extends FeatureBuildOperationCounts, DiagramLayoutOperationCounts {
  rendererCandidateFeatureCount: number;
  rendererGeneratedFeatureCount: number;
  rendererGeneratedVertexCount: number;
}

export function createSourceFeatureProjectionCounts(): SourceFeatureProjectionCounts {
  return {
    ...createFeatureBuildOperationCounts(),
    diagramTopologyBuildCount: 0,
    diagramTopologyCacheHitCount: 0,
    diagramStopBuildCount: 0,
    diagramStopCacheHitCount: 0,
    rendererCandidateFeatureCount: 0,
    rendererGeneratedFeatureCount: 0,
    rendererGeneratedVertexCount: 0,
  };
}

const COUNT_KEYS = Object.keys(createSourceFeatureProjectionCounts()) as Array<
  keyof SourceFeatureProjectionCounts
>;

/** Failed and canceled worker replies never call this helper. A caller merges
 * exactly the detached result that is about to enter scene publication. */
export function mergeSourceFeatureProjectionCounts(
  target: SourceFeatureProjectionCounts,
  source: SourceFeatureProjectionCounts,
): void {
  for (const key of COUNT_KEYS) target[key] += source[key];
}
