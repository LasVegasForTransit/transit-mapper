import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { GeoJSONSource, PaddingOptions, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  createMapRuntime,
  INITIAL_STYLE_FALLBACK_TIMEOUT_MS,
  createDeferredMapDriver,
  type MapDriver,
  type MapRuntime,
  type MapViewStore,
  type SelectionController,
} from '@transitmapper/map';
import {
  MapSurface,
  scheduleMapAttachmentAfterFirstPaint,
  type MapSurfaceAttachmentScheduler,
  type MapSurfaceRuntimeFactory,
} from '@transitmapper/workspace';
import { SRC_ACTION_ANCHOR } from '@transitmapper/renderer/layers';
import { useEditorStore } from '../editor/EditorProvider';
import { createEditorSelectionController } from '../editor/editor-selection';
import { DOCUMENT_MAP_DEFINITION } from '../editor/document-map-definition';
import { initializeDocumentCamera } from '../editor/document-view-adapter';
import { inputTuningFor } from '../editor/input-tuning';
import type { PointerIntent } from '../editor/pointerIntent';
import { useCoarsePointer } from '../device/capabilities';
import { useSim, useSimClock } from '../ui/SimProvider';
import { useContextMenu, useUi } from '../ui/UiProvider';
import { useMapViewStore, useView } from '../ui/ViewProvider';
import { useSystemColorScheme, type ColorScheme } from '../theme/systemColorScheme';
import { createVehicleAnimationGateController } from '../sim/vehicle-animation-gate';
import type { TerminusConnectionChoice } from './interactions';
import { PointerBadge } from './PointerBadge';
import { getMap, setMap } from './mapRef';
import { basemapStyleForScheme, localBlankStyleForScheme } from './mapTheme';
import type { EditorMapDriverPorts, EditorMapStyleBridge } from './editor-map-ports';

export interface EditorMapSurfaceFrameProps {
  readonly driver: MapDriver;
  readonly contentIdentity: string;
  readonly viewStore: MapViewStore;
  readonly selection: SelectionController;
  readonly theme: ColorScheme;
  readonly createRuntime: MapSurfaceRuntimeFactory<ColorScheme>;
  readonly scheduleAttachment?: MapSurfaceAttachmentScheduler;
  readonly onRuntimeChange?: (runtime: MapRuntime<ColorScheme> | null) => void;
  readonly children?: ReactNode;
}

/**
 * The web editor owns its overlays, while the workspace owns the stable map
 * container and runtime lifecycle. The driver attaches after the runtime is
 * published, so document preparation cannot withhold MapLibre's camera.
 */
export function EditorMapSurfaceFrame({
  driver,
  contentIdentity,
  viewStore,
  selection,
  theme,
  createRuntime,
  scheduleAttachment,
  onRuntimeChange,
  children,
}: EditorMapSurfaceFrameProps) {
  return (
    <>
      <MapSurface
        driver={driver}
        contentIdentity={contentIdentity}
        viewStore={viewStore}
        selection={selection}
        theme={theme}
        createRuntime={createRuntime}
        scheduleAttachment={scheduleAttachment}
        onRuntimeChange={onRuntimeChange}
      />
      {children}
    </>
  );
}

export interface EditorMapSurfaceProps {
  onBasemapUnavailable?: () => void;
  vehiclePaintingSuspended?: boolean;
}

function chromePadding(container: HTMLElement): PaddingOptions {
  const style = getComputedStyle(container);
  const side = (name: string) => Number.parseFloat(style.getPropertyValue(name)) || 0;
  return {
    top: side('--map-pad-top'),
    bottom: side('--map-pad-bottom'),
    left: side('--map-pad-left'),
    right: side('--map-pad-right'),
  };
}

function framePadding(container: HTMLElement | null, margin: number): PaddingOptions | number {
  if (!container) return margin;
  const chrome = chromePadding(container);
  return {
    top: chrome.top + margin,
    bottom: chrome.bottom + margin,
    left: chrome.left + margin,
    right: chrome.right + margin,
  };
}

function clearActionAnchor(): void {
  getMap()
    ?.getSource<GeoJSONSource>(SRC_ACTION_ANCHOR)
    ?.setData({ type: 'FeatureCollection', features: [] });
}

function createInitialStyleBridge(
  runtime: { current: MapRuntime<ColorScheme> | null },
  theme: { current: ColorScheme },
): EditorMapStyleBridge {
  return {
    get runtime() {
      return runtime.current;
    },
    get activeTheme() {
      return theme.current;
    },
    attachment: null,
    carry: (_previous: StyleSpecification | undefined, next: StyleSpecification) => next,
    retained: () => false,
    themeApplied: (nextTheme) => {
      theme.current = nextTheme;
    },
    interactionActive: () => false,
    resized() {},
  };
}

/**
 * The editor mounts MapLibre as soon as React commits the workspace. Its
 * renderer and editor adapters load behind the first painted frame, then
 * attach to that same runtime without replacing the camera or canvas.
 */
// eslint-disable-next-line max-lines-per-function -- One React owner keeps the deferred driver, runtime, and editor overlays stable across document loads.
export function EditorMapSurface({
  onBasemapUnavailable,
  vehiclePaintingSuspended = false,
}: EditorMapSurfaceProps) {
  const store = useEditorStore();
  const viewStore = useMapViewStore();
  const colorScheme = useSystemColorScheme();
  const { viewMode, setViewMode } = useView();
  const { openShortcuts, toggleUi } = useUi();
  const { contextMenuAt, openContextMenu, closeContextMenu } = useContextMenu();
  const simClock = useSimClock();
  const { pinnedPeriod } = useSim();
  const coarsePointer = useCoarsePointer();
  const [pointerBadge, setPointerBadge] = useState<{
    intent: PointerIntent | null;
    x: number;
    y: number;
  }>({ intent: null, x: 0, y: 0 });
  const [terminusConnectionChoice, setTerminusConnectionChoice] =
    useState<TerminusConnectionChoice | null>(null);
  const contextMenuOpenRef = useRef(false);
  contextMenuOpenRef.current = contextMenuAt !== null || terminusConnectionChoice !== null;
  const pointerRefreshRef = useRef<(() => void) | null>(null);
  const basemapFailureRef = useRef(onBasemapUnavailable);
  basemapFailureRef.current = onBasemapUnavailable;
  const tuningRef = useRef(inputTuningFor(coarsePointer));
  tuningRef.current = inputTuningFor(coarsePointer);
  const runtimeRef = useRef<MapRuntime<ColorScheme> | null>(null);
  const activeThemeRef = useRef(colorScheme);
  const styleRef = useRef<EditorMapStyleBridge>(
    createInitialStyleBridge(runtimeRef, activeThemeRef),
  );
  const [selection] = useState(() => createEditorSelectionController(store));
  const [vehicleGate] = useState(() =>
    createVehicleAnimationGateController(() => {
      const state = viewStore.getSnapshot();
      return {
        viewMode: state.representationId as ReturnType<typeof useView>['viewMode'],
        visibleModes: new Set(state.filters.modes as string[]),
        visibleWayTypes: new Set(state.filters['way-types'] as string[]),
      };
    }),
  );
  vehicleGate.update(pinnedPeriod, vehiclePaintingSuspended);

  const [driver] = useState(() => {
    initializeDocumentCamera(viewStore, store.getState().system.viewport);
    const ports: EditorMapDriverPorts = {
      store,
      viewStore,
      style: styleRef,
      simClock,
      vehicleGate,
      get tuning() {
        return tuningRef.current;
      },
      container: () => runtimeRef.current?.map.getContainer() ?? null,
      framePadding: (margin) =>
        framePadding(runtimeRef.current?.map.getContainer() ?? null, margin),
      setRepresentation: (mode) => {
        if (mode === 'network' || mode === 'infrastructure' || mode === 'diagram') {
          setViewMode(mode);
        }
      },
      openShortcuts,
      toggleUi,
      openContextMenu,
      closeContextMenu,
      isContextMenuOpen: () => contextMenuOpenRef.current,
      onPointerIntent: (intent, x, y) => setPointerBadge({ intent, x, y }),
      registerPointerIntentRefresh: (refresh) => {
        pointerRefreshRef.current = refresh;
        return () => {
          if (pointerRefreshRef.current === refresh) pointerRefreshRef.current = null;
        };
      },
      openTerminusConnectionChoice: setTerminusConnectionChoice,
      reportError: (error) => console.error('[transitmapper] editor map', error),
    };
    return createDeferredMapDriver({
      definition: DOCUMENT_MAP_DEFINITION,
      load: async () => {
        const { createEditorMapDriver } = await import('./editor-map-driver');
        return createEditorMapDriver(ports);
      },
    });
  });

  const [createRuntime] = useState<MapSurfaceRuntimeFactory<ColorScheme>>(() => {
    const factory: MapSurfaceRuntimeFactory<ColorScheme> = ({
      container,
      viewStore: runtimeViewStore,
      initialTheme,
    }) =>
      createMapRuntime<ColorScheme>({
        container,
        viewStore: runtimeViewStore,
        initialTheme,
        style: {
          local: localBlankStyleForScheme,
          remoteUrl: basemapStyleForScheme,
          carry: (previous, next, theme) => styleRef.current.carry(previous, next, theme),
          isDocumentStateRetained: () => styleRef.current.retained(),
          onThemeApplied: (theme) => styleRef.current.themeApplied(theme),
          recoverDocumentLayers: () => {},
          timeoutMs: INITIAL_STYLE_FALLBACK_TIMEOUT_MS,
          isInteractionActive: () => styleRef.current.interactionActive(),
          onBaseStyleUnavailable: () => basemapFailureRef.current?.(),
        },
        interaction: {
          dragPan: true,
          dragRotate: false,
          doubleClickZoom: true,
          keyboard: true,
          boxZoom: true,
          touchZoomRotate: true,
          touchPitch: false,
          disableTouchRotation: true,
        },
        controls: {
          navigation: { position: 'bottom-right', showCompass: false },
          attribution: { position: 'bottom-right', compact: true },
        },
        mapOptions: { fadeDuration: 0, refreshExpiredTiles: false },
        padding: chromePadding,
        reportError: (error) => console.error('[transitmapper] map runtime', error),
        onResize: () => styleRef.current.resized(),
      });
    return factory;
  });

  useEffect(() => vehicleGate.notify(), [pinnedPeriod, vehiclePaintingSuspended, vehicleGate]);
  useEffect(() => {
    if (contextMenuAt !== null || terminusConnectionChoice !== null) return;
    clearActionAnchor();
    pointerRefreshRef.current?.();
  }, [contextMenuAt, terminusConnectionChoice]);
  useEffect(() => {
    clearActionAnchor();
    setTerminusConnectionChoice((choice) => {
      choice?.dismiss();
      return null;
    });
  }, [viewMode, store]);
  useEffect(() => {
    if (!terminusConnectionChoice) return;
    const dismiss = () => {
      terminusConnectionChoice.dismiss();
      setTerminusConnectionChoice(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [terminusConnectionChoice]);
  useEffect(
    () =>
      store.subscribe((state, previous) => {
        if (state.tool === previous.tool) return;
        setTerminusConnectionChoice((choice) => {
          choice?.dismiss();
          return null;
        });
      }),
    [store],
  );

  return (
    <EditorMapSurfaceFrame
      driver={driver}
      contentIdentity="editor-document"
      viewStore={viewStore}
      selection={selection}
      theme={colorScheme}
      createRuntime={createRuntime}
      scheduleAttachment={scheduleMapAttachmentAfterFirstPaint}
      onRuntimeChange={(runtime) => {
        runtimeRef.current = runtime;
        setMap(runtime?.map ?? null);
      }}
    >
      <PointerBadge intent={pointerBadge.intent} x={pointerBadge.x} y={pointerBadge.y} />
      {terminusConnectionChoice ? (
        <>
          <button
            type="button"
            aria-label="Dismiss connection choices"
            style={{ position: 'fixed', inset: 0, zIndex: 49, cursor: 'default', opacity: 0 }}
            onClick={() => {
              terminusConnectionChoice.dismiss();
              setTerminusConnectionChoice(null);
            }}
          />
          <div
            role="menu"
            aria-label="Choose how to connect these paths"
            style={{
              position: 'fixed',
              left: terminusConnectionChoice.x,
              top: terminusConnectionChoice.y,
              zIndex: 50,
              display: 'grid',
              minWidth: 240,
              padding: 6,
              gap: 2,
              border: '1px solid var(--md-sys-color-outline-variant)',
              borderRadius: 8,
              background: 'var(--md-sys-color-surface-container)',
              boxShadow: 'var(--md-sys-elevation-level2)',
            }}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                terminusConnectionChoice.connectPaths();
                setTerminusConnectionChoice(null);
              }}
            >
              Connect paths
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                terminusConnectionChoice.joinThroughService();
                setTerminusConnectionChoice(null);
              }}
            >
              Join into a through-service
            </button>
            <button
              type="button"
              onClick={() => {
                terminusConnectionChoice.dismiss();
                setTerminusConnectionChoice(null);
              }}
            >
              Cancel
            </button>
          </div>
        </>
      ) : null}
    </EditorMapSurfaceFrame>
  );
}
