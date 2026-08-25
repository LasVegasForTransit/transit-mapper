import { useEffect, useRef } from 'react';
import type {
  MapDriver,
  MapDriverAttachment,
  MapRuntime,
  MapViewStore,
  SelectionController,
} from '@transitmapper/map';

export interface MapSurfaceRuntimeOptions<ThemeId extends string> {
  container: HTMLElement;
  viewStore: MapViewStore;
  initialTheme: ThemeId;
}

export type MapSurfaceRuntimeFactory<ThemeId extends string> = (
  options: MapSurfaceRuntimeOptions<ThemeId>,
) => MapRuntime<ThemeId>;

export interface MapSurfaceProps<ThemeId extends string> {
  driver: MapDriver;
  contentIdentity: string;
  viewStore: MapViewStore;
  selection: SelectionController;
  theme: ThemeId;
  createRuntime: MapSurfaceRuntimeFactory<ThemeId>;
  className?: string;
  onRuntimeChange?: (runtime: MapRuntime<ThemeId> | null) => void;
}

interface MountedRuntime<ThemeId extends string> {
  runtime: MapRuntime<ThemeId>;
  theme: ThemeId;
}

interface MapSurfaceMountOptions<ThemeId extends string> {
  container: HTMLElement;
  driver: MapDriver;
  viewStore: MapViewStore;
  selection: SelectionController;
  initialTheme: ThemeId;
  createRuntime: MapSurfaceRuntimeFactory<ThemeId>;
  mountedRuntimeRef: { current: MountedRuntime<ThemeId> | null };
  runtimeChangeRef: { current: MapSurfaceProps<ThemeId>['onRuntimeChange'] };
}

interface AttachmentSlot {
  current?: MapDriverAttachment;
}

interface DriverAttachmentOptions<ThemeId extends string> {
  surface: MapSurfaceMountOptions<ThemeId>;
  runtime: MapRuntime<ThemeId>;
  signal: AbortSignal;
  attachment: AttachmentSlot;
  isDisposed(): boolean;
}

function reportRuntimeError<ThemeId extends string>(
  runtime: MapRuntime<ThemeId>,
  error: unknown,
): void {
  try {
    runtime.host.reportError(error);
  } catch {
    // Error reporting is diagnostic. It cannot take ownership of the surface lifecycle.
  }
}

function publishRuntimeChange<ThemeId extends string>(
  runtime: MapRuntime<ThemeId>,
  listener: MapSurfaceProps<ThemeId>['onRuntimeChange'],
  next: MapRuntime<ThemeId> | null,
): void {
  try {
    listener?.(next);
  } catch (error) {
    reportRuntimeError(runtime, error);
  }
}

function disposeAttachment<ThemeId extends string>(
  runtime: MapRuntime<ThemeId>,
  attachment: MapDriverAttachment | undefined,
): void {
  try {
    attachment?.dispose();
  } catch (error) {
    reportRuntimeError(runtime, error);
  }
}

function startDriverAttachment<ThemeId extends string>(
  options: DriverAttachmentOptions<ThemeId>,
): void {
  let attachmentPromise: Promise<MapDriverAttachment> | undefined;
  try {
    attachmentPromise = options.surface.driver.attach({
      host: options.runtime.host,
      viewStore: options.surface.viewStore,
      selection: options.surface.selection,
      milestones: options.runtime.milestones,
      signal: options.signal,
    });
  } catch (error) {
    reportRuntimeError(options.runtime, error);
  }
  void attachmentPromise?.then(
    (nextAttachment) => {
      if (
        options.isDisposed() ||
        options.signal.aborted ||
        options.surface.mountedRuntimeRef.current?.runtime !== options.runtime
      ) {
        disposeAttachment(options.runtime, nextAttachment);
        return;
      }
      options.attachment.current = nextAttachment;
    },
    (error: unknown) => {
      if (
        !options.isDisposed() &&
        !options.signal.aborted &&
        options.surface.mountedRuntimeRef.current?.runtime === options.runtime
      ) {
        reportRuntimeError(options.runtime, error);
      }
    },
  );
}

function mountMapSurfaceRuntime<ThemeId extends string>(
  options: MapSurfaceMountOptions<ThemeId>,
): () => void {
  const abortController = new AbortController();
  const runtime = options.createRuntime({
    container: options.container,
    viewStore: options.viewStore,
    initialTheme: options.initialTheme,
  });
  const attachment: AttachmentSlot = {};
  let disposed = false;
  options.mountedRuntimeRef.current = { runtime, theme: options.initialTheme };
  publishRuntimeChange(runtime, options.runtimeChangeRef.current, runtime);
  startDriverAttachment({
    surface: options,
    runtime,
    signal: abortController.signal,
    attachment,
    isDisposed: () => disposed,
  });

  return () => {
    if (disposed) return;
    disposed = true;
    try {
      abortController.abort();
    } catch (error) {
      reportRuntimeError(runtime, error);
    }
    disposeAttachment(runtime, attachment.current);
    if (options.mountedRuntimeRef.current?.runtime === runtime) {
      options.mountedRuntimeRef.current = null;
    }
    publishRuntimeChange(runtime, options.runtimeChangeRef.current, null);
    try {
      runtime.dispose();
    } catch (error) {
      reportRuntimeError(runtime, error);
    }
  };
}

function requestRuntimeTheme<ThemeId extends string>(
  mountedRuntimeRef: { current: MountedRuntime<ThemeId> | null },
  theme: ThemeId,
): void {
  const mountedRuntime = mountedRuntimeRef.current;
  if (mountedRuntime === null || mountedRuntime.theme === theme) return;
  mountedRuntime.theme = theme;
  let themeRequest: Promise<void> | undefined;
  try {
    themeRequest = mountedRuntime.runtime.requestTheme(theme);
  } catch (error) {
    reportRuntimeError(mountedRuntime.runtime, error);
  }
  void themeRequest?.catch((error: unknown) => {
    if (mountedRuntimeRef.current?.runtime === mountedRuntime.runtime) {
      reportRuntimeError(mountedRuntime.runtime, error);
    }
  });
}

function surfaceClassName(className: string | undefined): string {
  return className === undefined || className.length === 0
    ? 'workspace-map-surface'
    : `workspace-map-surface ${className}`;
}

export function MapSurface<ThemeId extends string>({
  driver,
  contentIdentity,
  viewStore,
  selection,
  theme,
  createRuntime,
  className,
  onRuntimeChange,
}: MapSurfaceProps<ThemeId>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRuntimeRef = useRef<MountedRuntime<ThemeId> | null>(null);
  const themeRef = useRef(theme);
  const onRuntimeChangeRef = useRef(onRuntimeChange);
  themeRef.current = theme;
  onRuntimeChangeRef.current = onRuntimeChange;

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    return mountMapSurfaceRuntime({
      container,
      driver,
      viewStore,
      selection,
      initialTheme: themeRef.current,
      createRuntime,
      mountedRuntimeRef,
      runtimeChangeRef: onRuntimeChangeRef,
    });
  }, [contentIdentity, createRuntime, driver, selection, viewStore]);

  useEffect(() => {
    requestRuntimeTheme(mountedRuntimeRef, theme);
  }, [theme]);

  return <div ref={containerRef} className={surfaceClassName(className)} />;
}
