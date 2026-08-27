import type { FeatureCollection } from 'geojson';
import type {
  GeoJSONSource,
  LayerSpecification,
  Map as MapLibreMap,
  MapEventType,
} from 'maplibre-gl';
import {
  buildFeatures,
  type Highlight,
  type SystemFeatures,
  type ViewOptions,
} from '@transitmapper/core/render/buildFeatures';
import type { TransitSystem } from '@transitmapper/core/model/system';
import type {
  MapDefinition,
  MapDriver,
  MapDriverAttachment,
  MapDriverAttachOptions,
} from '@transitmapper/map';
import type { MapFeatureReferenceV1, MapPresentationStateV1 } from '@transitmapper/views';
import { documentMapFeatureDetails } from './document-map-feature-details';
import { renderPresentationFromMap } from './render-presentation';
import { applyRendererVisibilityFilters } from './render-visibility';
import {
  COMMITTED_SYSTEM_FEATURE_SOURCES,
  SYSTEM_FEATURE_NAME_BY_SOURCE,
  type MapSystemFeatureSourceId,
} from './system-feature-sources';

export interface SnapshotMapScheduler {
  scheduleFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
}

export interface SnapshotMapPresentation {
  readonly viewMode: ViewOptions['viewMode'];
  readonly visibleModes: Set<string>;
  readonly visibleWayTypes: Set<string>;
}

export interface SnapshotMapSession {
  readonly map: MapLibreMap;
  /** Reinstalls the retained snapshot after the host replaces the base style. */
  recoverStyle(): void;
}

export interface SnapshotMapSessionAttachment {
  restoreAfterStyle?(): void;
  dispose(): void;
}

export interface SnapshotMapDriverOptions {
  readonly definition: MapDefinition;
  readonly system: TransitSystem;
  layerSpecs(): readonly LayerSpecification[];
  layerSpecsForPresentation?(
    catalog: readonly LayerSpecification[],
    presentation: SnapshotMapPresentation,
  ): readonly LayerSpecification[];
  resolvePresentation(state: MapPresentationStateV1): SnapshotMapPresentation;
  setupStaticSources?(map: MapLibreMap): void;
  readonly scheduler?: SnapshotMapScheduler;
  attachSession?(
    session: SnapshotMapSession,
    signal: AbortSignal,
  ): SnapshotMapSessionAttachment | undefined;
}

function reportSafely(options: MapDriverAttachOptions, error: unknown): void {
  try {
    options.host.reportError(error);
  } catch {
    // A diagnostics callback cannot own the map driver's cleanup path.
  }
}

function cleanupSafely(options: MapDriverAttachOptions, cleanup: (() => void) | undefined): void {
  if (!cleanup) return;
  try {
    cleanup();
  } catch (error) {
    reportSafely(options, error);
  }
}

function browserScheduler(): SnapshotMapScheduler {
  return {
    scheduleFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (handle) => window.cancelAnimationFrame(handle),
  };
}

function presentationFromMap(map: MapLibreMap) {
  const canvas = map.getCanvas();
  const container = map.getContainer();
  return renderPresentationFromMap({
    bounds: map.getBounds(),
    zoom: map.getZoom(),
    viewportWidthPx: canvas.clientWidth,
    viewportHeightPx: canvas.clientHeight,
    displayedWidthPx: container.clientWidth,
    displayedHeightPx: container.clientHeight,
    pixelRatio: map.getPixelRatio(),
  });
}

function documentHighlight(reference: MapFeatureReferenceV1 | undefined): Highlight {
  return reference?.source === 'document' ? { kind: reference.kind, id: reference.id } : null;
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function presentationChange(
  before: SnapshotMapPresentation,
  after: SnapshotMapPresentation,
): { reproject: boolean; updateFilters: boolean } {
  const modeChanged = before.viewMode !== after.viewMode;
  const filtersChanged =
    !setsEqual(before.visibleModes, after.visibleModes) ||
    !setsEqual(before.visibleWayTypes, after.visibleWayTypes);
  return { reproject: modeChanged, updateFilters: modeChanged || filtersChanged };
}

function sourceData(
  features: SystemFeatures,
  sourceId: MapSystemFeatureSourceId,
): FeatureCollection {
  return features[SYSTEM_FEATURE_NAME_BY_SOURCE[sourceId]];
}

function installSnapshotSources(map: MapLibreMap, features: SystemFeatures): void {
  for (const sourceId of COMMITTED_SYSTEM_FEATURE_SOURCES) {
    const data = sourceData(features, sourceId);
    const source: GeoJSONSource | undefined = map.getSource(sourceId);
    if (source) {
      source.setData(data);
      continue;
    }
    const heavy = sourceId === 'tm-ways' || sourceId === 'tm-services';
    map.addSource(sourceId, { type: 'geojson', data, ...(heavy ? { tolerance: 1 } : {}) });
  }
}

function layerSource(spec: LayerSpecification): string | null {
  return 'source' in spec && typeof spec.source === 'string' ? spec.source : null;
}

function sameLayerOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

class SnapshotMapAttachment implements MapDriverAttachment {
  private readonly map: MapLibreMap;
  private readonly scheduler: SnapshotMapScheduler;
  private presentation: SnapshotMapPresentation;
  private retainedFeatures: SystemFeatures | null = null;
  private scheduledProjection: number | null = null;
  private projectionGeneration = 0;
  private disposed = false;
  private extension: SnapshotMapSessionAttachment | undefined;
  private readonly listenerCleanups: Array<() => void> = [];

  constructor(
    private readonly options: SnapshotMapDriverOptions,
    private readonly attachOptions: MapDriverAttachOptions,
  ) {
    this.map = attachOptions.host.map;
    this.scheduler = options.scheduler ?? browserScheduler();
    this.presentation = options.resolvePresentation(attachOptions.viewStore.getSnapshot());
  }

  async start(): Promise<void> {
    await this.projectAndCommit();
    if (!this.acceptsWork()) return;
    const session: SnapshotMapSession = { map: this.map, recoverStyle: this.recoverStyle };
    this.extension = this.options.attachSession?.(session, this.attachOptions.signal);
    this.listenerCleanups.push(this.attachOptions.viewStore.subscribe(this.onView));
    this.listenerCleanups.push(this.attachOptions.selection.subscribe(this.scheduleProjection));
    this.attachMapListener('moveend', this.scheduleProjection);
    this.attachMapListener('resize', this.scheduleProjection);
    this.map.on('style.load', this.recoverStyle);
    this.listenerCleanups.push(() => this.map.off('style.load', this.recoverStyle));
    this.attachOptions.signal.addEventListener('abort', this.dispose, { once: true });
    this.attachOptions.milestones.contentCommitted();
    if (this.acceptsWork()) this.attachOptions.milestones.interactive();
  }

  resolveFeature(
    reference: MapFeatureReferenceV1,
    signal: AbortSignal,
  ): Promise<ReturnType<typeof documentMapFeatureDetails>> {
    if (!this.acceptsWork() || signal.aborted) return Promise.resolve(null);
    return Promise.resolve(
      documentMapFeatureDetails({ status: 'ready', system: this.options.system }, reference),
    );
  }

  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    this.attachOptions.signal.removeEventListener('abort', this.dispose);
    if (this.scheduledProjection !== null) {
      this.scheduler.cancelFrame(this.scheduledProjection);
      this.scheduledProjection = null;
    }
    for (const cleanup of this.listenerCleanups.splice(0)) {
      cleanupSafely(this.attachOptions, cleanup);
    }
    const attachedExtension = this.extension;
    this.extension = undefined;
    cleanupSafely(
      this.attachOptions,
      attachedExtension ? () => attachedExtension.dispose() : undefined,
    );
  };

  private readonly acceptsWork = () => !this.disposed && !this.attachOptions.signal.aborted;

  private attachMapListener(event: keyof MapEventType, listener: () => void): void {
    this.map.on(event, listener);
    this.listenerCleanups.push(() => this.map.off(event, listener));
  }

  private selectedLayerSpecs(): readonly LayerSpecification[] {
    const catalog = this.options.layerSpecs();
    const selected =
      this.options.layerSpecsForPresentation?.(catalog, this.presentation) ?? catalog;
    return selected.filter((spec) => {
      const source = layerSource(spec);
      return source === null || this.map.getSource(source) !== undefined;
    });
  }

  private installLayers(): void {
    const catalogIds = new Set(this.options.layerSpecs().map((spec) => spec.id));
    const style = this.map.getStyle();
    const installedIds = style.layers
      .filter((layer) => catalogIds.has(layer.id))
      .map((layer) => layer.id);
    const selected = this.selectedLayerSpecs();
    const desiredIds = selected.map((spec) => spec.id);
    if (sameLayerOrder(installedIds, desiredIds)) return;
    this.map.setStyle(
      {
        ...style,
        layers: [...style.layers.filter((layer) => !catalogIds.has(layer.id)), ...selected],
      },
      { diff: true, validate: false },
    );
  }

  private applyVisibility(): void {
    applyRendererVisibilityFilters(
      this.map,
      this.selectedLayerSpecs(),
      this.presentation.visibleModes,
      this.presentation.visibleWayTypes,
    );
  }

  private async project(): Promise<SystemFeatures> {
    const presentation = this.presentation;
    const system =
      presentation.viewMode === 'diagram'
        ? (await import('@transitmapper/core/model/diagramLayout')).computeDiagramSystem(
            this.options.system,
          )
        : this.options.system;
    return buildFeatures(
      system,
      documentHighlight(this.attachOptions.selection.getSnapshot()),
      [],
      { ...presentation, presentation: presentationFromMap(this.map) },
    );
  }

  private commit(features: SystemFeatures): void {
    this.options.setupStaticSources?.(this.map);
    installSnapshotSources(this.map, features);
    this.installLayers();
    this.applyVisibility();
    this.retainedFeatures = features;
  }

  private async projectAndCommit(): Promise<void> {
    if (!this.acceptsWork()) return;
    const generation = ++this.projectionGeneration;
    const features = await this.project();
    if (this.acceptsWork() && generation === this.projectionGeneration) this.commit(features);
  }

  private readonly scheduleProjection = (): void => {
    if (!this.acceptsWork() || this.scheduledProjection !== null) return;
    this.scheduledProjection = this.scheduler.scheduleFrame(() => {
      this.scheduledProjection = null;
      void this.projectAndCommit().catch((error: unknown) =>
        reportSafely(this.attachOptions, error),
      );
    });
  };

  private readonly onView = (state: MapPresentationStateV1): void => {
    try {
      const next = this.options.resolvePresentation(state);
      const change = presentationChange(this.presentation, next);
      this.presentation = next;
      if (change.updateFilters) this.applyVisibility();
      if (change.reproject) this.scheduleProjection();
    } catch (error) {
      reportSafely(this.attachOptions, error);
    }
  };

  private readonly recoverStyle = (): void => {
    if (!this.acceptsWork()) return;
    try {
      this.options.setupStaticSources?.(this.map);
      if (this.retainedFeatures === null) {
        this.scheduleProjection();
        return;
      }
      installSnapshotSources(this.map, this.retainedFeatures);
      this.installLayers();
      this.applyVisibility();
      this.extension?.restoreAfterStyle?.();
    } catch (error) {
      reportSafely(this.attachOptions, error);
    }
  };
}

class SnapshotMapDriver implements MapDriver {
  readonly definition: MapDefinition;

  constructor(private readonly options: SnapshotMapDriverOptions) {
    this.definition = options.definition;
  }

  async attach(attachOptions: MapDriverAttachOptions): Promise<MapDriverAttachment> {
    if (attachOptions.signal.aborted) {
      return Promise.resolve({ resolveFeature: () => Promise.resolve(null), dispose() {} });
    }
    const attachment = new SnapshotMapAttachment(this.options, attachOptions);
    try {
      await attachment.start();
      return attachment;
    } catch (error) {
      attachment.dispose();
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
}

export function createSnapshotMapDriver(options: SnapshotMapDriverOptions): MapDriver {
  return new SnapshotMapDriver(options);
}
