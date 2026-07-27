import { useEffect, useRef, useState } from 'react';
import { useSimClock } from './SimProvider';

/** How often a React consumer of simulated time is allowed to re-render.
 *  The clock advances 30 times a second; a readout showing whole minutes
 *  gains nothing from more than a few updates a second, and every other
 *  consumer (the "running now" readouts) changes far more slowly still. */
const DEFAULT_INTERVAL_MS = 250;

/**
 * Subscribe to simulated time from React, throttled.
 *
 * The clock is deliberately outside React (see sim/simClock.ts) precisely so
 * a 30 Hz value can't re-render anything. This hook is the one sanctioned
 * bridge back: it accepts an update at most every `minIntervalMs`, so a
 * component using it re-renders about four times a second instead of thirty.
 *
 * Updates that arrive inside the window aren't dropped, they're deferred —
 * without that, a jump made while PAUSED (the DEV `__sim.setTime` handle, or
 * any future scrubber) could land in a quiet window and never be shown, since
 * no further tick would come along to carry it.
 */
export function useSimTime(minIntervalMs: number = DEFAULT_INTERVAL_MS): number {
  const clock = useSimClock();
  const [simMs, setSimMs] = useState(() => clock.now());
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    let lastAt = 0;
    setSimMs(clock.now());
    const unsubscribe = clock.subscribe((next) => {
      const elapsed = performance.now() - lastAt;
      if (elapsed >= minIntervalMs) {
        lastAt = performance.now();
        setSimMs(next);
        return;
      }
      if (timerRef.current !== undefined) return; // a trailing update is already queued
      timerRef.current = window.setTimeout(() => {
        timerRef.current = undefined;
        lastAt = performance.now();
        setSimMs(clock.now());
      }, minIntervalMs - elapsed);
    });
    return () => {
      unsubscribe();
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
    };
  }, [clock, minIntervalMs]);

  return simMs;
}
