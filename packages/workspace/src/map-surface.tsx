import { useEffect, useRef } from 'react';
import type { MapViewStore } from '@transitmapper/core/presentation/map-presentation-state';

/**
 * The ports this surface is handed, rather than a map implementation it names.
 *
 * The workspace composes a map without depending on one: apps/web injects a
 * concrete driver and runtime from `@transitmapper/map`, which satisfy these
 * structurally. Only the members this component actually touches appear here,
 * so a host is free to supply something else. `Selection` stays a parameter
 * because the surface forwards it to `attach` without ever reading it.
 */
export interface MapSurfaceHostPort {
  reportError(error: unknown): void;
}

export interface MapSurfaceAttachmentPort {
  dispose(): void;
}

export interface MapSurfaceRuntimePort<ThemeId extends string> {
  readonly host: MapSurfaceHostPort;
  readonly milestones: unknown;
  requestTheme(theme: ThemeId): Promise<void>;
  dispose(): void;
}

export interface MapSurfaceAttachOptions<Selection> {
  host: MapSurfaceHostPort;
  viewStore: MapViewStore;
  selection: Selection;
  milestones: unknown;
  signal: AbortSignal;
}

export interface MapSurfaceDriverPort<Selection> {
  attach(options: MapSurfaceAttachOptions<Selection>): Promise<MapSurfaceAttachmentPort>;
}

export interface MapSurfaceRuntimeOptions<ThemeId extends string> {
  container: HTMLElement;
  viewStore: MapViewStore;
  initialTheme: ThemeId;
}

export type MapSurfaceRuntimeFactory<
  ThemeId extends string,
  Runtime extends MapSurfaceRuntimePort<ThemeId>,
> = (options: MapSurfaceRuntimeOptions<ThemeId>) => Runtime;

export type MapSurfaceAttachmentScheduler = (start: () => void) => () => void;

/** A hidden, occluded, or throttled tab produces no animation frames, and the
 * browser never promises a deadline for the next one. Attachment releases the
 * document overlay, the startup milestones, and the remote base style behind
 * it, so a frame that never arrives stalls the whole map indefinitely rather
 * than merely deferring it. This timer is the floor under that wait, not the
 * normal path: whenever frames flow, the two of them win the race. */
export const MAP_ATTACHMENT_FRAME_FALLBACK_MS = 500;

export function scheduleMapAttachmentAfterFirstPaint(start: () => void): () => void {
  let settled = false;
  let firstFrame: number | null = null;
  let secondFrame: number | null = null;
  let fallback: ReturnType<typeof setTimeout> | null = null;
  const cancelPending = () => {
    if (firstFrame !== null) cancelAnimationFrame(firstFrame);
    if (secondFrame !== null) cancelAnimationFrame(secondFrame);
    if (fallback !== null) clearTimeout(fallback);
    firstFrame = null;
    secondFrame = null;
    fallback = null;
  };
  // Both paths land here, so whichever arrives first attaches exactly once.
  const settle = () => {
    if (settled) return;
    settled = true;
    cancelPending();
    start();
  };
  firstFrame = requestAnimationFrame(() => {
    firstFrame = null;
    if (settled) return;
    secondFrame = requestAnimationFrame(() => {
      secondFrame = null;
      settle();
    });
  });
  fallback = setTimeout(settle, MAP_ATTACHMENT_FRAME_FALLBACK_MS);
  return () => {
    settled = true;
    cancelPending();
  };
}

export interface MapSurfaceProps<
  ThemeId extends string,
  Selection,
  Runtime extends MapSurfaceRuntimePort<ThemeId> = MapSurfaceRuntimePort<ThemeId>,
> {
  driver: MapSurfaceDriverPort<Selection>;
  contentIdentity: string;
  viewStore: MapViewStore;
  selection: Selection;
  theme: ThemeId;
  createRuntime: MapSurfaceRuntimeFactory<ThemeId, Runtime>;
  scheduleAttachment?: MapSurfaceAttachmentScheduler;
  className?: string;
  onRuntimeChange?: (runtime: Runtime | null) => void;
}

interface MountedRuntime<ThemeId extends string, Runtime extends MapSurfaceRuntimePort<ThemeId>> {
  runtime: Runtime;
  theme: ThemeId;
  themeRequestGeneration: number;
}

interface MapSurfaceMountOptions<
  ThemeId extends string,
  Selection,
  Runtime extends MapSurfaceRuntimePort<ThemeId>,
> {
  container: HTMLElement;
  driver: MapSurfaceDriverPort<Selection>;
  viewStore: MapViewStore;
  selection: Selection;
  initialTheme: ThemeId;
  createRuntime: MapSurfaceRuntimeFactory<ThemeId, Runtime>;
  scheduleAttachment: MapSurfaceAttachmentScheduler;
  mountedRuntimeRef: { current: MountedRuntime<ThemeId, Runtime> | null };
  runtimeChangeRef: { current: MapSurfaceProps<ThemeId, Selection, Runtime>['onRuntimeChange'] };
}

interface AttachmentSlot {
  current?: MapSurfaceAttachmentPort;
}

interface DriverAttachmentOptions<
  ThemeId extends string,
  Selection,
  Runtime extends MapSurfaceRuntimePort<ThemeId>,
> {
  surface: MapSurfaceMountOptions<ThemeId, Selection, Runtime>;
  runtime: Runtime;
  signal: AbortSignal;
  attachment: AttachmentSlot;
  isDisposed(): boolean;
}

const startAttachmentImmediately: MapSurfaceAttachmentScheduler = (start) => {
  start();
  return () => {};
};

function reportRuntimeError<ThemeId extends string>(
  runtime: MapSurfaceRuntimePort<ThemeId>,
  error: unknown,
): void {
  try {
    runtime.host.reportError(error);
  } catch {
    // Error reporting is diagnostic. It cannot take ownership of the surface lifecycle.
  }
}

function publishRuntimeChange<
  ThemeId extends string,
  Selection,
  Runtime extends MapSurfaceRuntimePort<ThemeId>,
>(
  runtime: Runtime,
  listener: MapSurfaceProps<ThemeId, Selection, Runtime>['onRuntimeChange'],
  next: Runtime | null,
): void {
  try {
    listener?.(next);
  } catch (error) {
    reportRuntimeError(runtime, error);
  }
}

function disposeAttachment<ThemeId extends string>(
  runtime: MapSurfaceRuntimePort<ThemeId>,
  attachment: MapSurfaceAttachmentPort | undefined,
): void {
  try {
    attachment?.dispose();
  } catch (error) {
    reportRuntimeError(runtime, error);
  }
}

function startDriverAttachment<
  ThemeId extends string,
  Selection,
  Runtime extends MapSurfaceRuntimePort<ThemeId>,
>(options: DriverAttachmentOptions<ThemeId, Selection, Runtime>): void {
  let attachmentPromise: Promise<MapSurfaceAttachmentPort> | undefined;
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

function mountMapSurfaceRuntime<
  ThemeId extends string,
  Selection,
  Runtime extends MapSurfaceRuntimePort<ThemeId>,
>(options: MapSurfaceMountOptions<ThemeId, Selection, Runtime>): () => void {
  const abortController = new AbortController();
  const runtime = options.createRuntime({
    container: options.container,
    viewStore: options.viewStore,
    initialTheme: options.initialTheme,
  });
  const attachment: AttachmentSlot = {};
  let disposed = false;
  options.mountedRuntimeRef.current = {
    runtime,
    theme: options.initialTheme,
    themeRequestGeneration: 0,
  };
  publishRuntimeChange(runtime, options.runtimeChangeRef.current, runtime);
  let attachmentStarted = false;
  let cancelAttachmentSchedule = () => {};
  try {
    cancelAttachmentSchedule = options.scheduleAttachment(() => {
      if (disposed || abortController.signal.aborted || attachmentStarted) return;
      attachmentStarted = true;
      startDriverAttachment({
        surface: options,
        runtime,
        signal: abortController.signal,
        attachment,
        isDisposed: () => disposed,
      });
    });
  } catch (error) {
    reportRuntimeError(runtime, error);
  }

  return () => {
    if (disposed) return;
    disposed = true;
    try {
      abortController.abort();
    } catch (error) {
      reportRuntimeError(runtime, error);
    }
    try {
      cancelAttachmentSchedule();
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

function requestRuntimeTheme<
  ThemeId extends string,
  Runtime extends MapSurfaceRuntimePort<ThemeId>,
>(mountedRuntimeRef: { current: MountedRuntime<ThemeId, Runtime> | null }, theme: ThemeId): void {
  const mountedRuntime = mountedRuntimeRef.current;
  if (mountedRuntime === null || mountedRuntime.theme === theme) return;
  mountedRuntime.theme = theme;
  mountedRuntime.themeRequestGeneration += 1;
  const requestGeneration = mountedRuntime.themeRequestGeneration;
  let themeRequest: Promise<void> | undefined;
  try {
    themeRequest = mountedRuntime.runtime.requestTheme(theme);
  } catch (error) {
    reportRuntimeError(mountedRuntime.runtime, error);
  }
  void themeRequest?.catch((error: unknown) => {
    if (
      mountedRuntimeRef.current?.runtime === mountedRuntime.runtime &&
      mountedRuntime.themeRequestGeneration === requestGeneration
    ) {
      reportRuntimeError(mountedRuntime.runtime, error);
    }
  });
}

function surfaceClassName(className: string | undefined): string {
  return className === undefined || className.length === 0
    ? 'workspace-map-surface'
    : `workspace-map-surface ${className}`;
}

function serializedCamera(viewStore: MapViewStore): string {
  const { center, zoom } = viewStore.getSnapshot().camera;
  return `${center[0]},${center[1]},${zoom}`;
}

export function MapSurface<
  ThemeId extends string,
  Selection,
  Runtime extends MapSurfaceRuntimePort<ThemeId>,
>({
  driver,
  contentIdentity,
  viewStore,
  selection,
  theme,
  createRuntime,
  scheduleAttachment = startAttachmentImmediately,
  className,
  onRuntimeChange,
}: MapSurfaceProps<ThemeId, Selection, Runtime>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRuntimeRef = useRef<MountedRuntime<ThemeId, Runtime> | null>(null);
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
      scheduleAttachment,
      mountedRuntimeRef,
      runtimeChangeRef: onRuntimeChangeRef,
    });
  }, [contentIdentity, createRuntime, driver, scheduleAttachment, selection, viewStore]);

  useEffect(() => {
    requestRuntimeTheme(mountedRuntimeRef, theme);
  }, [theme]);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    // A host can prove that a real pointer gesture changed the shared camera
    // without retaining MapLibre or enabling the development performance API.
    const publishCamera = () => {
      container.dataset.mapCamera = serializedCamera(viewStore);
    };
    publishCamera();
    return viewStore.subscribe(publishCamera);
  }, [viewStore]);

  return <div ref={containerRef} className={surfaceClassName(className)} />;
}
