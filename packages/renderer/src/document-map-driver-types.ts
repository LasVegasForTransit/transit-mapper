import type { LayerSpecification, Map as MapLibreMap } from 'maplibre-gl';
import type { TransitSystem } from '@transitmapper/core/model/system';
import type { ViewOptions } from '@transitmapper/core/render/buildFeatures';
import type { MapDefinition } from '@transitmapper/map';
import type { MapPresentationStateV1 } from '@transitmapper/views';
import type { AcceptedSceneUpdate } from './accepted-scene-store';
import type { SourceFeatureProjectionAccounting } from './committed-feature-projection';
import type { DiagramLayoutWorkerClient } from './diagram-layout-worker';
import type { FeatureProjectionClient } from './feature-projection-worker';
import type { LiveMapRenderer, SceneTargetResolver } from './live-map-renderer';
import type { RendererStatsCollector } from './renderer-stats';
import type { MapSystemFeatureSourceId } from './system-feature-sources';
import type { SourceUploadTransition } from './sourceUploadPlan';

export type DocumentMapStatus = 'loading' | 'ready' | 'error';

export interface DocumentMapSnapshot {
  readonly status: DocumentMapStatus;
  readonly system: TransitSystem;
}

export type DocumentMapSnapshotListener = (snapshot: DocumentMapSnapshot) => void;

export interface DocumentMapSnapshotSource {
  getSnapshot(): DocumentMapSnapshot;
  subscribe(listener: DocumentMapSnapshotListener): () => void;
}

export interface DocumentMapPresentation {
  readonly viewMode: ViewOptions['viewMode'];
  readonly visibleModes: Set<string>;
  readonly visibleWayTypes: Set<string>;
}

export interface DocumentMapScheduler {
  now(): number;
  scheduleFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
  scheduleTimer(callback: () => void, delayMs: number): number;
  cancelTimer(handle: number): void;
  scheduleTask?(callback: () => void): number;
  cancelTask?(handle: number): void;
  dispose?(): void;
}

export interface DocumentMapSceneAccepted {
  readonly snapshot: DocumentMapSnapshot;
  readonly update: AcceptedSceneUpdate;
}

export interface DocumentMapProjectionRequest {
  readonly sourceIds?: readonly MapSystemFeatureSourceId[];
  readonly transition?: SourceUploadTransition;
  readonly replaceActive?: boolean;
}

export interface DocumentMapSession {
  readonly map: MapLibreMap;
  readonly renderer: LiveMapRenderer;
  getSnapshot(): DocumentMapSnapshot;
  scheduleProjection(request?: DocumentMapProjectionRequest): void;
  subscribeAcceptedScene(listener: (event: DocumentMapSceneAccepted) => void): () => void;
}

export interface DocumentMapSessionAttachment {
  synchronizeInteractionState?(targets?: SceneTargetResolver): void;
  refreshInteractionPreviews?(): void;
  restoreAfterStyle?(): void;
  dispose(): void;
}

export interface DocumentMapDriverOptions {
  readonly definition: MapDefinition;
  readonly source: DocumentMapSnapshotSource;
  layerSpecs(): readonly LayerSpecification[];
  layerSpecsForPresentation?(
    catalog: readonly LayerSpecification[],
    presentation: DocumentMapPresentation,
  ): readonly LayerSpecification[];
  /** Composes renderer-owned layers with extensions that share the same
   * MapLibre style. The renderer still receives only
   * `layerSpecsForPresentation`; this hook changes installation, not scene
   * ownership. */
  surfaceLayerSpecsForPresentation?(
    catalog: readonly LayerSpecification[],
    presentation: DocumentMapPresentation,
  ): readonly LayerSpecification[];
  resolvePresentation(state: MapPresentationStateV1): DocumentMapPresentation;
  setupStaticSources?(map: MapLibreMap): void;
  createFeatureProjectionWorker?(): FeatureProjectionClient;
  createDiagramLayoutWorker?(): DiagramLayoutWorkerClient;
  readonly projectionAccounting?: SourceFeatureProjectionAccounting;
  readonly rendererStats?: RendererStatsCollector;
  readonly instrumentationEnabled?: boolean;
  readonly scheduler?: DocumentMapScheduler;
  attachSession?(
    session: DocumentMapSession,
    signal: AbortSignal,
  ): DocumentMapSessionAttachment | undefined;
}
