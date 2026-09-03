import type { LayerSpecification, Map as MapLibreMap } from 'maplibre-gl';
import type { TransitSystem } from '@transitmapper/core/model/system';
import type { ViewOptions } from '@transitmapper/core/render/buildFeatures';
import type { MapDefinition } from './map-driver';
import type { MapPresentationStateV1 } from '@transitmapper/core/presentation/map-presentation-state';
import type { AcceptedSceneUpdate } from '@transitmapper/renderer/runtime';
import type { SourceFeatureProjectionAccounting } from '@transitmapper/renderer/projection';
import type { DiagramLayoutWorkerClient } from '@transitmapper/renderer/projection';
import type { FeatureProjectionClient } from '@transitmapper/renderer/projection';
import type { LiveMapRenderer, SceneTargetResolver } from './live-map-renderer';
import type { RendererStatsCollector } from '@transitmapper/renderer/stats';
import type { MapSystemFeatureSourceId } from '@transitmapper/renderer/layers';
import type { SourceUploadTransition } from '@transitmapper/renderer/projection';

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
  /** Reinstalls the retained scene after the host changes the MapLibre style.
   * Hosts must call this for diff-applied styles because MapLibre does not emit
   * `style.load` for that path. */
  recoverStyle(): void;
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
