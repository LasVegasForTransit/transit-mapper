import {
  advanceSimMs,
  DEFAULT_SIM_SPEED_ID,
  DEFAULT_SIM_START_MS,
  simSpeed,
} from '@transitmapper/core/sim/clock';

// The simulated clock: the one mutable value the simulator owns, and the only
// thing on screen that changes 30 times a second.
//
// It is an INSTANCE, created by SimProvider and handed to whoever needs it —
// not module-level state and not a singleton. The editor store is built the
// same way (createEditorStore + injection into the imperative map layer)
// rather than as an ambient global, and this follows it: an instance can be
// created per test, per provider, and per mounted map, and nothing can reach
// it without being given it.
//
// It deliberately isn't React state either. The animation loop is imperative
// and runs outside React entirely, and a value changing at 30 Hz has no
// business in a context that would re-render its consumers at that rate —
// which is also why it isn't in the zustand store: writing a ticking value
// into the immutable `system` would mint a new system reference every frame,
// and with it a full buildFeatures rebuild, every mounted selector, and an
// autosave. Camera position already taught this project that lesson once (see
// camera/liveCamera.ts), and a clock ticks whether or not anyone is dragging.
//
// So this holds the number; ui/SimProvider.tsx pushes the user's settings in
// on change (rare, a click); the rAF loop advances it and reads them back
// (constant); and the one component that displays the time subscribes and
// throttles itself.

export interface SimClockSettings {
  speedId: string;
  paused: boolean;
}

export type SimClockListener = (simMs: number) => void;

export interface SimClock {
  /** The current simulated instant, in ms since Monday 00:00. */
  now(): number;
  settings(): SimClockSettings;
  /**
   * Advance by real elapsed time, scaled by the current speed. Called once per
   * animation tick with the real delta since the previous one; returns the new
   * simulated instant so the caller doesn't need a second read.
   *
   * While paused the clock holds and no listener fires, so a paused tab costs
   * nothing and vehicles freeze exactly where they are rather than vanishing.
   */
  advance(realDeltaMs: number): number;
  /** Mirror the user's settings in from React. Cheap and rare — a click, not
   *  a frame. */
  setSettings(next: SimClockSettings): void;
  /** Jump the clock. Used by the DEV `__sim` handle today, and the seam any
   *  future time scrubber would go through — because vehicle position is a
   *  pure function of this number, a jump leaves nothing to reconcile. */
  setTime(nextMs: number): void;
  /** Fires on every advance (up to 30 Hz), so a listener that paints must
   *  throttle itself — see useSimClockText. */
  subscribe(listener: SimClockListener): () => void;
}

export interface CreateSimClockOptions {
  startMs?: number;
  speedId?: string;
  paused?: boolean;
}

export function createSimClock(options: CreateSimClockOptions = {}): SimClock {
  let simMs = options.startMs ?? DEFAULT_SIM_START_MS;
  let settings: SimClockSettings = {
    speedId: options.speedId ?? DEFAULT_SIM_SPEED_ID,
    paused: options.paused ?? false,
  };
  const listeners = new Set<SimClockListener>();

  const notify = () => {
    for (const listener of listeners) listener(simMs);
  };

  return {
    now: () => simMs,
    settings: () => ({ ...settings }),
    advance(realDeltaMs) {
      if (settings.paused) return simMs;
      const next = advanceSimMs(simMs, realDeltaMs, simSpeed(settings.speedId).simPerReal);
      if (next === simMs) return simMs;
      simMs = next;
      notify();
      return simMs;
    },
    setSettings(next) {
      settings = { ...next };
    },
    setTime(nextMs) {
      simMs = nextMs;
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
