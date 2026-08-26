import { useCallback, useMemo, useRef, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { PaddingOptions } from 'maplibre-gl';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { TransitSystem } from '@transitmapper/core/model/system';
import {
  createMapRuntime,
  INITIAL_STYLE_FALLBACK_TIMEOUT_MS,
  type MapRuntime,
  type MapViewStore,
  type SelectionController,
} from '@transitmapper/map';
import {
  COMMITTED_SYSTEM_FEATURE_SOURCES,
  SRC_HIT_FEATURES,
  physicalRenderSourceIds,
} from '@transitmapper/renderer/layers';
import type { DocumentMapSession } from '@transitmapper/renderer/driver';
import {
  MapSurface,
  type MapSurfaceAttachmentScheduler,
  type MapSurfaceRuntimeFactory,
} from '@transitmapper/workspace';
import { useSystemColorScheme, type ColorScheme } from '../theme/systemColorScheme';
import {
  carryDocumentStyle,
  documentLayersForScheme,
  documentOverlayIsRetained,
} from '../map/document-style-carry';
import { registerMapIcons } from '../map/layers';
import { basemapStyleForScheme, localBlankStyleForScheme } from '../map/mapTheme';
import { createViewerDocumentMap, type ViewerDocumentMapStyle } from './viewer-document-map';

declare global {
  interface Window {
    __viewerMap?: MapLibreMap;
  }
}

export interface ViewerMapSurfaceProps {
  readonly system: TransitSystem;
  readonly viewStore: MapViewStore;
  readonly selection: SelectionController;
  readonly onError: (error: unknown) => void;
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

interface ViewerRuntimePorts {
  readonly runtime: { current: MapRuntime<ColorScheme> | null };
  readonly session: { current: DocumentMapSession | null };
  readonly activeTheme: { current: ColorScheme };
  readonly reportError: (error: unknown) => void;
}

function viewerRuntimeFactory(ports: ViewerRuntimePorts): MapSurfaceRuntimeFactory<ColorScheme> {
  return ({ container, viewStore, initialTheme }) =>
    createMapRuntime<ColorScheme>({
      container,
      viewStore,
      initialTheme,
      style: {
        local: localBlankStyleForScheme,
        remoteUrl: basemapStyleForScheme,
        carry: (previous, next, theme) =>
          carryDocumentStyle(previous, next, documentLayersForScheme(theme)),
        isDocumentStateRetained: () => {
          const runtime = ports.runtime.current;
          return runtime
            ? documentOverlayIsRetained(
                runtime.map.getStyle(),
                physicalRenderSourceIds([...COMMITTED_SYSTEM_FEATURE_SOURCES, SRC_HIT_FEATURES]),
                documentLayersForScheme(ports.activeTheme.current),
              )
            : false;
        },
        onThemeApplied: (theme) => {
          ports.activeTheme.current = theme;
          const runtime = ports.runtime.current;
          if (runtime) registerMapIcons(runtime.map, theme);
        },
        recoverDocumentLayers: () => ports.session.current?.recoverStyle(),
        timeoutMs: INITIAL_STYLE_FALLBACK_TIMEOUT_MS,
        isInteractionActive: () => false,
        onBaseStyleUnavailable: (error) =>
          console.warn('[transitmapper] viewer basemap unavailable', error),
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
      baseStyleTiming: 'before-content',
      mapOptions: { fadeDuration: 0, refreshExpiredTiles: false },
      padding: chromePadding,
      reportError: (error) => {
        console.error('[transitmapper] viewer map', error);
        ports.reportError(error);
      },
    });
}

export function ViewerMapSurface({ system, viewStore, selection, onError }: ViewerMapSurfaceProps) {
  const colorScheme = useSystemColorScheme();
  const runtimeRef = useRef<MapRuntime<ColorScheme> | null>(null);
  const sessionRef = useRef<DocumentMapSession | null>(null);
  const activeThemeRef = useRef<ColorScheme>(colorScheme);
  const style = useRef<ViewerDocumentMapStyle>({
    get current() {
      return activeThemeRef.current;
    },
  });
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onSessionChange = useCallback((session: DocumentMapSession | null) => {
    sessionRef.current = session;
  }, []);
  const driver = useMemo(
    () =>
      createViewerDocumentMap({
        system,
        viewStore,
        selection,
        style: style.current,
        onSessionChange,
      }),
    [onSessionChange, selection, system, viewStore],
  );
  const [createRuntime] = useState<MapSurfaceRuntimeFactory<ColorScheme>>(() =>
    viewerRuntimeFactory({
      runtime: runtimeRef,
      session: sessionRef,
      activeTheme: activeThemeRef,
      reportError: (error) => onErrorRef.current(error),
    }),
  );
  const [scheduleAttachment] = useState<MapSurfaceAttachmentScheduler>(
    () => (start: () => void) => {
      let cancelled = false;
      const runtime = runtimeRef.current;
      if (runtime === null) {
        start();
        return () => {};
      }
      void runtime.flushTheme().then(
        () => {
          if (!cancelled) start();
        },
        (error: unknown) => {
          onErrorRef.current(error);
          if (!cancelled) start();
        },
      );
      return () => {
        cancelled = true;
      };
    },
  );

  return (
    <MapSurface
      driver={driver}
      contentIdentity={`shared-system:${system.id}`}
      viewStore={viewStore}
      selection={selection}
      theme={colorScheme}
      createRuntime={createRuntime}
      scheduleAttachment={scheduleAttachment}
      onRuntimeChange={(runtime) => {
        runtimeRef.current = runtime;
        if (import.meta.env.DEV) window.__viewerMap = runtime?.map;
      }}
    />
  );
}

export default ViewerMapSurface;
