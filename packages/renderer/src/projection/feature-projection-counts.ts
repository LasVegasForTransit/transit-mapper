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
  /** Passenger Line scenes resolved, and the wall time they took.
   *
   * The Line scene is built inside the worker entry rather than by the
   * source projector, so none of the counters above see it. On a 3,800-way
   * network it is the largest single cost of a cold projection, and its
   * absence from the stats meant a measured projection could get faster
   * while the thing dominating it stayed dark. */
  passengerLineSceneCount: number;
  passengerLineSceneDurationMs: number;
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
    passengerLineSceneCount: 0,
    passengerLineSceneDurationMs: 0,
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
