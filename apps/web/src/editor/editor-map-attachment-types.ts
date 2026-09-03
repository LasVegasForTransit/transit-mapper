import type { LayerSpecification } from 'maplibre-gl';
import type { LngLat } from '@transitmapper/core/model/system';
import type {
  CorridorActionHit,
  ServiceActionHit,
} from '@transitmapper/core/model/selectionActions';
import type {
  DocumentMapSession,
  DocumentMapSessionAttachment,
} from '@transitmapper/renderer/driver';
import type {
  FeatureProjectionClient,
  PatternOverlayProjectionClient,
} from '@transitmapper/renderer/projection';
import type { AcceptedSceneUpdate } from '@transitmapper/renderer/runtime';
import type { SceneTargetResolver } from '../map/editor-feature-state';
import type { ProjectionOperationCounts } from '../map/gestureProjection';
import type { EditorKeyboardContext, TerminusConnectionChoice } from '../map/interactions';
import type { EditorDocumentMapSource } from './document-map-source';
import type { EditorMapViewOptions } from './editor-map-view';
import type { EditorProjectionAccounting } from './editor-map-projection';
import type { EditorStore } from './store';
import type { InputTuning } from './input-tuning';
import type { PointerIntent } from './pointerIntent';

interface EditorMapDocumentOptions {
  readonly store: EditorStore;
  readonly source: EditorDocumentMapSource;
}

interface EditorMapLayerOptions {
  catalog(): readonly LayerSpecification[];
}

interface EditorMapProjectionOptions {
  createWorker(): FeatureProjectionClient & PatternOverlayProjectionClient;
  readonly gestureCounts: ProjectionOperationCounts;
  overlayNeedsHealing(): boolean;
  beginAccounting(): EditorProjectionAccounting;
  recordUpdate(update: AcceptedSceneUpdate | null): void;
  recordSourceUpload(): void;
}

interface EditorMapInteractionOptions {
  readonly tuning: InputTuning;
  openShortcuts(): void;
  toggleUi(): void;
  attachKeyboard(context: EditorKeyboardContext): () => void;
  openContextMenu(
    x: number,
    y: number,
    at: LngLat,
    serviceHit?: ServiceActionHit,
    corridorHit?: CorridorActionHit,
  ): void;
  closeContextMenu(): void;
  isContextMenuOpen(): boolean;
  onPointerIntent(intent: PointerIntent | null, x: number, y: number): void;
  registerPointerIntentRefresh(refresh: () => void): () => void;
  openTerminusConnectionChoice(choice: TerminusConnectionChoice): void;
}

interface EditorMapSimulationOptions {
  attach(
    session: DocumentMapSession,
    store: EditorStore,
    isDirectManipulationActive: () => boolean,
  ): () => void;
  notify(): void;
}

interface EditorMapInstrumentationAttachment {
  dispose(): void;
}

interface EditorMapInstrumentationOptions {
  attach(session: DocumentMapSession): EditorMapInstrumentationAttachment | undefined;
}

export interface AttachEditorMapOptions {
  readonly document: EditorMapDocumentOptions;
  readonly layers: EditorMapLayerOptions;
  readonly view: EditorMapViewOptions;
  readonly interactions: EditorMapInteractionOptions;
  readonly simulation: EditorMapSimulationOptions;
  readonly projection: EditorMapProjectionOptions;
  readonly instrumentation?: EditorMapInstrumentationOptions;
  flushTheme(): void | Promise<void>;
  reportError(error: unknown): void;
}

export interface EditorMapAttachment extends DocumentMapSessionAttachment {
  applySelection(resolveTargets?: SceneTargetResolver): void;
  restoreAfterStyle(): void;
  restoreGesturePreview(): void;
  selectedSourceIds(): string[];
  isInteractionActive(): boolean;
  isGestureActive(): boolean;
}
