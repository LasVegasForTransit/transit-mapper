/**
 * Messages for CPU-only feature projection.
 *
 * A request carries immutable model and camera facts, never a MapLibre object
 * or an editor store. The main thread remains the sole owner of source banks
 * and visible pixels; the worker only returns detached GeoJSON collections.
 */
import type { TransitSystem } from '@transitmapper/core/model/system';
import type { BuildFeaturesForSourcesOptions } from '../projection/source-feature-projection';
import type { SourceFeatureProjectionCounts } from '../projection/feature-projection-counts';
import type { RenderViewOptions } from '@transitmapper/core/render/buildFeatures';
import type { SystemFeatures } from '@transitmapper/core/render/buildFeatures';
import type {
  PatternOverlayFeatures,
  PatternOverlayProjectionInput,
} from '../projection/pattern-overlay-projection';

/** Functions cannot cross a Worker boundary. Live hysteresis is recreated by
 * the worker for its own persistent projection lifetime. */
export type WorkerRenderView = Omit<RenderViewOptions, 'tierStateResolver'>;

/** A System travelling with the request, because the worker does not hold it
 * yet. `structuredClone` of the RTC fixture costs 36-60 ms of main-thread time,
 * so this is the expensive half of a projection message. */
interface SentProjectionSystem {
  readonly kind: 'sent';
  readonly system: TransitSystem;
}

/** A System the worker already holds from an earlier request in this worker's
 * lifetime. A camera move changes no part of the document, so most requests
 * carry this instead of the document itself. */
interface RetainedProjectionSystem {
  readonly kind: 'retained';
}

/**
 * Whether this request carries a System or names the one the worker holds.
 *
 * The client is the only thing that creates workers, so it alone decides
 * which of the two a slot gets: it compares the TransitSystem by object
 * reference against what it last sent to the live worker, and forgets
 * everything whenever it replaces or disposes that worker. Retention is also
 * what lets the worker's own Line provider cache key on the object rather
 * than on `id`/`updatedAt`, which two edits in one millisecond can collide.
 */
export type ProjectionSystemCarriage = SentProjectionSystem | RetainedProjectionSystem;

/** Everything about a projection request except the two documents and the
 * camera, which the client and the wire describe differently. */
export interface FeatureProjectionRequestFacts extends Omit<
  BuildFeaturesForSourcesOptions,
  'view' | 'counts' | 'system' | 'diagramSystem'
> {
  /** Static maps need the same visual-only, stable-ID ordering as an accepted
   * live scene, but never its hit collection or source-bank state. */
  readonly normalizeVisualScene?: boolean;
  readonly sceneRevision?: string;
}

export interface FeatureProjectionWorkerInput extends FeatureProjectionRequestFacts {
  readonly view: WorkerRenderView;
  readonly system: ProjectionSystemCarriage;
  /** Null when this request paints authored geometry. A worker that holds a
   * schematic snapshot keeps holding it across such a request, so the next
   * Diagram frame still needs no document on the wire. */
  readonly diagramSystem: ProjectionSystemCarriage | null;
}

/** A transient editor-only result. This has its own request shape so no caller
 * can accidentally ask the committed Line scene to carry Pattern geometry. */
export interface PatternOverlayWorkerInput extends Omit<
  PatternOverlayProjectionInput,
  'view' | 'system'
> {
  readonly view: WorkerRenderView;
  /** The authored slot, shared with `project`. The editor issues both requests
   * from one store read, so the overlay usually rides a document the paired
   * projection has already sent. */
  readonly system: ProjectionSystemCarriage;
}

export type FeatureProjectionWorkerRequest =
  | {
      readonly kind: 'project';
      readonly requestId: number;
      readonly input: FeatureProjectionWorkerInput;
    }
  | {
      readonly kind: 'project-pattern-overlay';
      readonly requestId: number;
      readonly input: PatternOverlayWorkerInput;
    };

export type FeatureProjectionWorkerEvent =
  | {
      readonly kind: 'done';
      readonly requestId: number;
      readonly features: SystemFeatures;
      readonly counts: SourceFeatureProjectionCounts | null;
    }
  | {
      readonly kind: 'pattern-overlay-done';
      readonly requestId: number;
      readonly overlay: PatternOverlayFeatures;
    }
  | {
      readonly kind: 'error';
      readonly requestId: number;
      readonly message: string;
    };
