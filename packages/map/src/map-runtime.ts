import maplibregl, {
  type AttributionControlOptions,
  type ControlPosition,
  type IControl,
  type Map as MapLibreMap,
  type MapOptions,
  type NavigationControlOptions,
  type PaddingOptions,
  type StyleSpecification,
} from 'maplibre-gl';
import type { MapRuntimeHost } from './map-driver';
import type { MapViewStore } from './map-view-store';
import { createBaseStyleController, type BaseStyleController } from './base-style-controller';
import {
  createMapStartupMilestones,
  type ObservableMapStartupMilestones,
} from './startup-milestones';

export const INITIAL_STYLE_FALLBACK_TIMEOUT_MS = 1_500;

export interface MapRuntimeResizeObserver {
  observe(target: Element): void;
  disconnect(): void;
}

export interface MapRuntimeNavigationControl extends NavigationControlOptions {
  position?: ControlPosition;
}

export interface MapRuntimeAttributionControl extends AttributionControlOptions {
  position?: ControlPosition;
}

export interface MapRuntimeControls {
  navigation?: false | MapRuntimeNavigationControl;
  attribution?: false | MapRuntimeAttributionControl;
}

export interface MapRuntimeInteractionOptions {
  dragPan?: MapOptions['dragPan'];
  dragRotate?: MapOptions['dragRotate'];
  doubleClickZoom?: MapOptions['doubleClickZoom'];
  keyboard?: MapOptions['keyboard'];
  boxZoom?: MapOptions['boxZoom'];
  touchZoomRotate?: MapOptions['touchZoomRotate'];
  touchPitch?: MapOptions['touchPitch'];
  disableTouchRotation?: boolean;
}

export interface MapRuntimeStyleOptions<ThemeId extends string> {
  local(theme: ThemeId): StyleSpecification;
  remoteUrl(theme: ThemeId): string;
  fetch?: (url: string, signal: AbortSignal) => Promise<StyleSpecification>;
  probe?: (url: string) => Promise<boolean>;
  carry?: (
    previous: StyleSpecification | undefined,
    next: StyleSpecification,
    theme: ThemeId,
  ) => StyleSpecification;
  isDocumentStateRetained?: () => boolean;
  onThemeApplied?: (theme: ThemeId) => void;
  recoverDocumentLayers?: (theme: ThemeId, fullRebuild: boolean) => void;
  timeoutMs: number;
  online?: () => boolean;
  isInteractionActive: () => boolean;
  onBaseStyleUnavailable(error: unknown): void;
  onBaseStyleAvailable?(): void;
}

export interface MapRuntimeOptions<ThemeId extends string> {
  container: HTMLElement;
  viewStore: MapViewStore;
  initialTheme: ThemeId;
  style: MapRuntimeStyleOptions<ThemeId>;
  interaction: MapRuntimeInteractionOptions;
  controls: MapRuntimeControls;
  baseStyleTiming?: 'before-content' | 'after-content';
  mapOptions?: Omit<
    MapOptions,
    | 'container'
    | 'style'
    | 'center'
    | 'zoom'
    | 'attributionControl'
    | keyof MapRuntimeInteractionOptions
  >;
  padding: (container: HTMLElement) => PaddingOptions;
  reportError(error: unknown): void;
  onResize?: () => void;
  createMap?: (options: MapOptions) => MapLibreMap;
  createNavigationControl?: (options: NavigationControlOptions) => IControl;
  createAttributionControl?: (options: AttributionControlOptions) => IControl;
  createResizeObserver?: (listener: () => void) => MapRuntimeResizeObserver;
}

export interface MapRuntime<ThemeId extends string = string> {
  readonly host: MapRuntimeHost;
  readonly map: MapLibreMap;
  readonly milestones: ObservableMapStartupMilestones;
  requestTheme(theme: ThemeId): Promise<void>;
  flushTheme(): Promise<void>;
  refreshPadding(): void;
  dispose(): void;
}

function camerasEqual(
  map: MapLibreMap,
  camera: ReturnType<MapViewStore['getSnapshot']>['camera'],
): boolean {
  const center = map.getCenter();
  return (
    center.lng === camera.center[0] &&
    center.lat === camera.center[1] &&
    map.getZoom() === camera.zoom
  );
}

function createOwnedMap<ThemeId extends string>(options: MapRuntimeOptions<ThemeId>): MapLibreMap {
  const initialCamera = options.viewStore.getSnapshot().camera;
  const { disableTouchRotation = true, ...interaction } = options.interaction;
  const createMap = options.createMap ?? ((mapOptions) => new maplibregl.Map(mapOptions));
  const map = createMap({
    ...options.mapOptions,
    ...interaction,
    container: options.container,
    style: options.style.local(options.initialTheme),
    center: initialCamera.center,
    zoom: initialCamera.zoom,
    attributionControl: false,
  });
  if (disableTouchRotation) map.touchZoomRotate.disableRotation();
  return map;
}

function addOwnedControls<ThemeId extends string>(
  map: MapLibreMap,
  options: MapRuntimeOptions<ThemeId>,
): void {
  const { navigation, attribution } = options.controls;
  if (navigation !== false && navigation !== undefined) {
    const { position, ...controlOptions } = navigation;
    const createNavigationControl =
      options.createNavigationControl ??
      ((currentOptions) => new maplibregl.NavigationControl(currentOptions));
    map.addControl(createNavigationControl(controlOptions), position);
  }
  if (attribution !== false && attribution !== undefined) {
    const { position, ...controlOptions } = attribution;
    const createAttributionControl =
      options.createAttributionControl ??
      ((currentOptions) => new maplibregl.AttributionControl(currentOptions));
    map.addControl(createAttributionControl(controlOptions), position);
  }
}

interface MapCameraAttachment {
  dispose(): void;
}

function attachMapCamera(map: MapLibreMap, viewStore: MapViewStore): MapCameraAttachment {
  let disposed = false;
  let applyingExternalCamera = false;
  const onMoveEnd = () => {
    if (disposed || applyingExternalCamera) return;
    const center = map.getCenter();
    viewStore.setCamera({ center: [center.lng, center.lat], zoom: map.getZoom() });
  };
  map.on('moveend', onMoveEnd);
  const unsubscribeView = viewStore.subscribe((state) => {
    if (disposed || camerasEqual(map, state.camera)) return;
    applyingExternalCamera = true;
    try {
      map.jumpTo({ center: state.camera.center, zoom: state.camera.zoom });
    } finally {
      applyingExternalCamera = false;
    }
  });
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeView();
      map.off('moveend', onMoveEnd);
    },
  };
}

interface MapResizeAttachment {
  refreshPadding(): void;
  dispose(): void;
}

function attachMapResize<ThemeId extends string>(
  map: MapLibreMap,
  options: MapRuntimeOptions<ThemeId>,
): MapResizeAttachment {
  let disposed = false;
  const refreshPadding = () => {
    if (!disposed) map.setPadding(options.padding(options.container), { duration: 0 });
  };
  const onMapResize = () => {
    refreshPadding();
    options.onResize?.();
  };
  map.on('resize', onMapResize);
  const createResizeObserver =
    options.createResizeObserver ?? ((listener) => new ResizeObserver(listener));
  const resizeObserver = createResizeObserver(() => map.resize());
  resizeObserver.observe(options.container);
  refreshPadding();
  return {
    refreshPadding,
    dispose() {
      if (disposed) return;
      disposed = true;
      resizeObserver.disconnect();
      map.off('resize', onMapResize);
    },
  };
}

interface ThemeCoordinator<ThemeId extends string> {
  requestTheme(theme: ThemeId): Promise<void>;
  contentCommitted(): void;
  settled(): Promise<void>;
}

/**
 * Owns when the remote base style may be asked for. The default order paints
 * document content on the local bootstrap style first; `before-content` asks
 * immediately, for a document that has nothing to paint ahead of the map.
 */
function createThemeCoordinator<ThemeId extends string>(
  styleController: BaseStyleController<ThemeId>,
  initialTheme: ThemeId,
  beforeContent: boolean,
): ThemeCoordinator<ThemeId> {
  let currentRequest: Promise<void> = beforeContent
    ? styleController.request(initialTheme)
    : Promise.resolve();
  // A host that asks for the initial theme again while the before-content
  // request is still in flight would cancel that fetch and start it over,
  // spending the head start this timing exists to buy. The dedupe lasts only
  // until the startup request settles, so a later request still retries.
  let pendingInitialRequest: Promise<void> | null = null;
  if (beforeContent) {
    pendingInitialRequest = currentRequest;
    const settleInitialRequest = () => {
      pendingInitialRequest = null;
    };
    void currentRequest.then(settleInitialRequest, settleInitialRequest);
  }
  let desiredTheme = initialTheme;
  let contentCommitted = false;
  const start = (theme: ThemeId) => {
    currentRequest = styleController.request(theme);
    return currentRequest;
  };
  return {
    requestTheme(theme) {
      desiredTheme = theme;
      if (pendingInitialRequest !== null && theme === initialTheme) return pendingInitialRequest;
      if (contentCommitted || beforeContent) return start(theme);
      return styleController.selectLocal(theme);
    },
    contentCommitted() {
      contentCommitted = true;
      if (!beforeContent) void start(desiredTheme);
    },
    settled: () => currentRequest,
  };
}

export function createMapRuntime<ThemeId extends string>(
  options: MapRuntimeOptions<ThemeId>,
): MapRuntime<ThemeId> {
  const map = createOwnedMap(options);
  addOwnedControls(map, options);
  const camera = attachMapCamera(map, options.viewStore);
  const resize = attachMapResize(map, options);

  const styleController = createBaseStyleController({
    ...options.style,
    map,
    initialTheme: options.initialTheme,
    initialStyle: 'local',
    reportError: (error) => options.reportError(error),
    onUnavailable: (error) => options.style.onBaseStyleUnavailable(error),
    onAvailable: () => options.style.onBaseStyleAvailable?.(),
  });
  const themes = createThemeCoordinator(
    styleController,
    options.initialTheme,
    options.baseStyleTiming === 'before-content',
  );
  let disposed = false;
  const requestTheme = (theme: ThemeId) =>
    disposed ? Promise.resolve() : themes.requestTheme(theme);
  const startupMilestones = createMapStartupMilestones({
    onContentCommitted: () => {
      if (!disposed) themes.contentCommitted();
    },
  });
  const milestones: ObservableMapStartupMilestones = {
    contentCommitted: () => {
      if (!disposed) startupMilestones.contentCommitted();
    },
    interactive: () => {
      if (!disposed) startupMilestones.interactive();
    },
    getSnapshot: () => startupMilestones.getSnapshot(),
    subscribe: (listener) => (disposed ? () => {} : startupMilestones.subscribe(listener)),
  };
  const host: MapRuntimeHost = {
    map,
    reportError: (error) => {
      if (!disposed) options.reportError(error);
    },
  };

  return {
    host,
    map,
    milestones,
    requestTheme,
    async flushTheme() {
      if (disposed) return;
      await themes.settled();
      await styleController.flush();
    },
    refreshPadding: () => {
      if (!disposed) resize.refreshPadding();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      styleController.dispose();
      resize.dispose();
      camera.dispose();
      map.remove();
    },
  };
}
