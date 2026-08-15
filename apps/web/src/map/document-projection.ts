/**
 * Projects one immutable document revision into a publishable scene update.
 *
 * This object owns preparation snapshots, dependency-scoped invalidation,
 * cooperative projection, cancellation, and generation-local accounting. It
 * deliberately stops at the scene boundary: `LiveMapRenderer` decides how the
 * resulting scene reaches MapLibre and becomes accepted.
 */
import type { RenderCandidateEnvelope } from '@transitmapper/core/render/render-candidate-envelope';
import type { RenderPreparedSnapshot } from '@transitmapper/core/render/render-preparation';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { createRenderPreparationCoordinator } from '@transitmapper/core/render/render-preparation-update';
import type { AcceptedSceneUpdate } from './accepted-scene-store';
import {
  createCommittedProjectionOwnership,
  submitPreparedCommittedFeatureProjection,
  type PreparedFeatureProjectionCommit,
  type PreparedFeatureProjectionTransition,
  type SourceFeatureProjectionAccounting,
} from './committed-feature-projection';
import type { CooperativeRenderJobScheduler } from './cooperative-render-job-scheduler';
import { createPreparedLiveInvalidationTracker } from './entity-render-update';
import type { PlanResumableGeographicFeatureProjectionOptions } from './resumable-feature-projection';
import type { ScenePublicationSubmission } from './scene-publication';
import type { SourceUploadTransition } from './sourceUploadPlan';
import type { MapSystemFeatureSourceId } from './system-feature-sources';
import type { FeatureProjectionClient } from './feature-projection-worker';

export type DiagramLayoutResolver = (
  system: TransitSystem,
  revision: string,
  signal: AbortSignal,
) => Promise<TransitSystem>;
import {
  createRendererProjectionMeasurement,
  type RendererProjectionMeasurement,
} from '../perf/renderer-projection-measurement';
import type { RendererStatsCollector } from '../perf/renderer-stats';

export interface DocumentProjectionRequest {
  readonly revision: string;
  readonly transition: PreparedFeatureProjectionTransition | null;
  readonly requestedSourceIds: readonly MapSystemFeatureSourceId[];
  readonly intent: 'incremental' | 'reset' | 'style-heal';
  readonly candidateEnvelope?: RenderCandidateEnvelope;
  readonly projection: Omit<
    PlanResumableGeographicFeatureProjectionOptions,
    'sourceIds' | 'preparedSnapshot' | 'projectionScope'
  >;
  onAccepted?(result: AcceptedDocumentProjection): void | Promise<void>;
}

interface AcceptedDocumentProjection {
  readonly update: AcceptedSceneUpdate;
  readonly preparedSnapshot: RenderPreparedSnapshot;
  readonly sourceIds: readonly MapSystemFeatureSourceId[];
  readonly settlementLatencyMs: number;
}

export interface DocumentProjectorOptions {
  readonly scheduler: CooperativeRenderJobScheduler;
  readonly accounting: SourceFeatureProjectionAccounting;
  readonly stats: RendererStatsCollector;
  readonly instrumentationEnabled: boolean;
  /** Persistent CPU owner for geographic feature construction. Browser-free
   * tests supply a fake; production never falls back to synchronous drawing. */
  readonly featureProjectionWorker: FeatureProjectionClient;
  layoutDiagram?: DiagramLayoutResolver;
  now(): number;
  publish(
    prepared: PreparedFeatureProjectionCommit,
    request: DocumentProjectionRequest,
    measurement: RendererProjectionMeasurement,
    onAccepted: (update: AcceptedSceneUpdate) => void | Promise<void>,
  ): ScenePublicationSubmission;
  requeue(
    sourceIds: readonly MapSystemFeatureSourceId[],
    transition: SourceUploadTransition | null,
  ): void;
}

export class DocumentProjector {
  private readonly coordinator = createRenderPreparationCoordinator({ maxUnitDurationMs: 4 });
  private readonly invalidation = createPreparedLiveInvalidationTracker();
  private readonly ownership;
  private lastAcceptedPreparation: RenderPreparedSnapshot | null = null;
  private preparationRevision = 0;

  constructor(private readonly options: DocumentProjectorOptions) {
    this.ownership = createCommittedProjectionOwnership({
      requeue: ({ sourceIds, transition }) => options.requeue(sourceIds, transition),
    });
  }

  project(request: DocumentProjectionRequest): Promise<void> {
    if (request.projection.view.viewMode === 'diagram') this.ownership.cancelAndRequeue();
    const countTransaction = this.options.accounting.begin();
    const measurement = createRendererProjectionMeasurement({
      counts: countTransaction.counts,
      collector: this.options.stats,
      enabled: this.options.instrumentationEnabled,
      now: () => this.options.now(),
    });
    let accepted = false;
    const submission = submitPreparedCommittedFeatureProjection({
      scheduler: this.options.scheduler,
      coordinator: this.coordinator,
      liveInvalidation: this.invalidation,
      preparationRevision: `${request.projection.system.id}:prepared:${++this.preparationRevision}`,
      previousLivePreparedSnapshot: this.lastAcceptedPreparation,
      transition: request.transition,
      requestedSourceIds: request.requestedSourceIds,
      intent: request.intent,
      diagramRevision: request.revision,
      ...(request.candidateEnvelope ? { candidateEnvelope: request.candidateEnvelope } : {}),
      projection: request.projection,
      projectionCounts: countTransaction.counts,
      now: () => this.options.now(),
      ...(this.options.layoutDiagram ? { layoutDiagram: this.options.layoutDiagram } : {}),
      featureProjectionWorker: this.options.featureProjectionWorker,
      ...(this.options.layoutDiagram ? { layoutDiagram: this.options.layoutDiagram } : {}),
      commit: (prepared) => {
        return this.options.publish(prepared, request, measurement, async (update) => {
          this.accept(prepared.preparedSnapshot);
          accepted = true;
          await request.onAccepted?.({
            update,
            preparedSnapshot: prepared.preparedSnapshot,
            sourceIds: prepared.sourceIds,
            settlementLatencyMs: measurement.markSettled(),
          });
        });
      },
      recordPreparation: (stats) => measurement.recordPreparation(stats),
      recordScheduling: (stats) => measurement.recordScheduling(stats),
    });
    this.ownership.activate(submission, {
      sourceIds: request.requestedSourceIds,
      transition: request.transition,
    });
    return submission.settled
      .then(() => {
        if (!accepted) return;
        countTransaction.accept();
        measurement.recordCommitted();
      })
      .finally(() => {
        countTransaction.discard();
        this.ownership.clear(submission);
      });
  }

  accept(prepared: RenderPreparedSnapshot): void {
    this.lastAcceptedPreparation = prepared;
    this.invalidation.accept(prepared);
  }

  cancelAndRequeue(): boolean {
    return this.ownership.cancelAndRequeue();
  }

  afterCurrentSettles(callback: () => void): void {
    this.ownership.afterCurrentSettles(callback);
  }

  hasActiveProjection(): boolean {
    return this.ownership.current() !== null;
  }

  dispose(): void {
    this.ownership.dispose();
  }
}
