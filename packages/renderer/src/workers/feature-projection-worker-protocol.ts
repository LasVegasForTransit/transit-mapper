/**
 * Messages for CPU-only feature projection.
 *
 * A request carries immutable model and camera facts, never a MapLibre object
 * or an editor store. The main thread remains the sole owner of source banks
 * and visible pixels; the worker only returns detached GeoJSON collections.
 */
import type { BuildFeaturesForSourcesOptions } from '../projection/source-feature-projection';
import type { SourceFeatureProjectionCounts } from '../projection/feature-projection-counts';
import type { RenderViewOptions } from '@transitmapper/core/render/buildFeatures';
import type { SystemFeatures } from '@transitmapper/core/render/buildFeatures';

/** Functions cannot cross a Worker boundary. Live hysteresis is recreated by
 * the worker for its own persistent projection lifetime. */
export type WorkerRenderView = Omit<RenderViewOptions, 'tierStateResolver'>;

export interface FeatureProjectionWorkerInput extends Omit<
  BuildFeaturesForSourcesOptions,
  'view' | 'counts'
> {
  readonly view: WorkerRenderView;
  /** Static maps need the same visual-only, stable-ID ordering as an accepted
   * live scene, but never its hit collection or source-bank state. */
  readonly normalizeVisualScene?: boolean;
  readonly sceneRevision?: string;
}

export interface FeatureProjectionWorkerRequest {
  readonly kind: 'project';
  readonly requestId: number;
  readonly input: FeatureProjectionWorkerInput;
}

export type FeatureProjectionWorkerEvent =
  | {
      readonly kind: 'done';
      readonly requestId: number;
      readonly features: SystemFeatures;
      readonly counts: SourceFeatureProjectionCounts | null;
    }
  | {
      readonly kind: 'error';
      readonly requestId: number;
      readonly message: string;
    };
