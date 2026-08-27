import type { MapRuntime } from '@transitmapper/map';
import type { MapSurfaceAttachmentScheduler } from '@transitmapper/workspace';

interface EditorMapStartupSchedulerOptions<ThemeId extends string> {
  runtime(): MapRuntime<ThemeId> | null;
  theme(): ThemeId;
  scheduler(): MapSurfaceAttachmentScheduler | undefined;
}

function reportStyleFailure<ThemeId extends string>(
  runtime: MapRuntime<ThemeId>,
  error: unknown,
): void {
  try {
    runtime.host.reportError(error);
  } catch {
    // A reporter cannot keep the local fallback map from attaching content.
  }
}

function startImmediately(start: () => void): () => void {
  start();
  return () => {};
}

export function createEditorMapStartupScheduler<ThemeId extends string>(
  options: EditorMapStartupSchedulerOptions<ThemeId>,
): MapSurfaceAttachmentScheduler {
  return (start) => {
    let cancelled = false;
    const startAfterTheme = () => {
      if (cancelled) return;
      const runtime = options.runtime();
      if (runtime === null) {
        start();
        return;
      }
      let request: Promise<void>;
      try {
        request = runtime.requestTheme(options.theme());
      } catch (error) {
        reportStyleFailure(runtime, error);
        start();
        return;
      }
      void request.then(
        () => {
          if (!cancelled) start();
        },
        (error: unknown) => {
          reportStyleFailure(runtime, error);
          if (!cancelled) start();
        },
      );
    };
    const schedule = options.scheduler() ?? startImmediately;
    const cancelScheduled = schedule(startAfterTheme);
    return () => {
      cancelled = true;
      cancelScheduled();
    };
  };
}
