import {
  dayOfWeek,
  formatSimClock,
  MS_PER_DAY,
  MS_PER_MINUTE,
  parseHhMm,
} from '@transitmapper/core/sim/clock';
import type { SimClock } from './simClock';

// A devtools handle for driving the simulated clock by hand, alongside the
// existing `__perf` / `__panBench` harness in ../perf.
//
// It exists because the simulation is a function of time, and the interesting
// questions are about specific times: does this line stop running at 23:00,
// does the 03:00 map look empty for the right reason, do two vehicles really
// pass this stop ten minutes apart. Waiting out a simulated day to find out —
// six real minutes at the fastest speed — is not a workable way to check.
//
// This is also the only way to verify any of that inside a headless browser,
// where requestAnimationFrame is parked and the clock never advances on its
// own.
//
// DEV only, and attached rather than ambient: the handle is installed with a
// clock instance handed to it, so it's a window-level view onto that instance
// for a human at a console — not a way for app code to reach the clock.

export interface SimDevState {
  simMs: number;
  clock: string;
  speedId: string;
  paused: boolean;
}

export interface SimDevHandle {
  /** Jump to a time of day, "HH:MM", keeping the current day of the week
   *  (or moving to `dayIndex`, 0 = Monday). Returns the new clock reading. */
  setTime: (hhmm: string, dayIndex?: number) => string;
  /** Move the clock by some simulated MINUTES — negative to go back. Works
   *  while paused, which is the point: step, look, step again. */
  step: (simMinutes: number) => string;
  state: () => SimDevState;
}

declare global {
  interface Window {
    __sim?: SimDevHandle;
  }
}

export function attachSimDevHandle(clock: SimClock): () => void {
  if (!import.meta.env.DEV) return () => {};
  window.__sim = {
    setTime(hhmm, dayIndex) {
      const minutes = parseHhMm(hhmm);
      if (minutes === null) throw new Error(`__sim.setTime: "${hhmm}" is not an HH:MM time`);
      const day = dayIndex ?? dayOfWeek(clock.now());
      clock.setTime(day * MS_PER_DAY + minutes * MS_PER_MINUTE);
      return formatSimClock(clock.now());
    },
    step(simMinutes) {
      clock.setTime(clock.now() + simMinutes * MS_PER_MINUTE);
      return formatSimClock(clock.now());
    },
    state: () => ({ simMs: clock.now(), clock: formatSimClock(clock.now()), ...clock.settings() }),
  };
  return () => {
    delete window.__sim;
  };
}
