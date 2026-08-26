import type { StyleSpecification } from 'maplibre-gl';
import type { LngLat } from '@transitmapper/core/model/system';
import type {
  CorridorActionHit,
  ServiceActionHit,
} from '@transitmapper/core/model/selectionActions';
import type { MapRuntime, MapViewStore } from '@transitmapper/map';
import type { EditorMapAttachment } from '../editor/editor-map-attachment';
import type { InputTuning } from '../editor/input-tuning';
import type { PointerIntent } from '../editor/pointerIntent';
import type { EditorStore } from '../editor/store';
import type { VehicleAnimationGateController } from '../sim/vehicle-animation-gate';
import type { SimClock } from '../sim/simClock';
import type { ColorScheme } from '../theme/color-scheme';
import type { TerminusConnectionChoice } from './interactions';

export interface EditorMapStyleBridge {
  readonly runtime: MapRuntime<ColorScheme> | null;
  readonly activeTheme: ColorScheme;
  readonly attachment: EditorMapAttachment | null;
  carry(
    previous: StyleSpecification | undefined,
    next: StyleSpecification,
    theme: ColorScheme,
  ): StyleSpecification;
  retained(): boolean;
  themeApplied(theme: ColorScheme): void;
  recover(): void;
  interactionActive(): boolean;
  resized(): void;
}

export interface EditorMapDriverPorts {
  readonly store: EditorStore;
  readonly viewStore: MapViewStore;
  readonly style: { current: EditorMapStyleBridge };
  readonly simClock: SimClock;
  readonly vehicleGate: VehicleAnimationGateController;
  readonly tuning: InputTuning;
  readonly container: () => HTMLElement | null;
  framePadding(
    margin: number,
  ): number | { top: number; bottom: number; left: number; right: number };
  setRepresentation(mode: string): void;
  openShortcuts(): void;
  toggleUi(): void;
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
  reportError(error: unknown): void;
}
