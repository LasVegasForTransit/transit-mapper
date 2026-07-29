// Deliberately pure and DOM-free (takes its visibility source as an argument
// rather than reading `document` directly) so apps/web/tests/verify.test.ts can
// drive it — see share/singleFlight.ts for the same pattern.

export interface VisibilitySource {
  readonly hidden: boolean;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

export interface VisibilityAwareTimeout {
  /** Stop the countdown for good — `onTimeout` will never fire after this. */
  cancel: () => void;
}

/**
 * Calls `onTimeout` once `ms` of wall-clock time has elapsed while `visibility`
 * was NOT hidden, pausing the countdown for as long as it is hidden and
 * starting a fresh `ms` window (plus calling `onResume`, if given) each time
 * it becomes visible again.
 *
 * A browser fully suspends requestAnimationFrame — and with it MapLibre's
 * whole render/tile-load pipeline — while a page is hidden (backgrounded tab,
 * occluded or minimized window). A plain wall-clock timeout fires for that
 * dead time even though the work would complete fine once the page is visible
 * again; see map/export/exportRenderer.ts, this function's one caller.
 */
export function armVisibilityAwareTimeout(
  ms: number,
  onTimeout: () => void,
  visibility: VisibilitySource,
  onResume?: () => void,
): VisibilityAwareTimeout {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    timer = setTimeout(onTimeout, ms);
  };
  const disarm = () => clearTimeout(timer);

  function onVisibilityChange(): void {
    disarm();
    if (!visibility.hidden) {
      arm();
      onResume?.();
    }
  }

  visibility.addEventListener('visibilitychange', onVisibilityChange);
  if (!visibility.hidden) arm();

  return {
    cancel: () => {
      disarm();
      visibility.removeEventListener('visibilitychange', onVisibilityChange);
    },
  };
}
