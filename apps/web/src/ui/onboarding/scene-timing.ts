import { simSpeed } from '@transitmapper/core/sim/clock';
import type { OnboardingSceneId } from './slides';

const DRAW_DURATION_MS = 3_200;
const SERVICE_START_MS = 6 * 60 * 60_000;
const SERVICE_SPAN_MS = 17 * 60 * 60_000;
const REDUCED_MOTION_TIME_MS = 8.5 * 60 * 60_000;
const SIMULATED_MS_PER_REAL_MS = simSpeed('4x').simPerReal;

export interface OnboardingSceneFrame {
  routeProgress: number;
  cursorVisible: boolean;
  simMs: number;
  animateVehicles: boolean;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Turns elapsed wall time into the complete passive scene state. Keeping this
 * outside React and MapLibre makes reduced motion and settled frames facts the
 * tests can prove instead of branches hidden inside an animation effect. */
export function onboardingSceneFrame(
  scene: OnboardingSceneId,
  elapsedMs: number,
  reducedMotion: boolean,
): OnboardingSceneFrame {
  if (reducedMotion) {
    return {
      routeProgress: 1,
      cursorVisible: false,
      simMs: REDUCED_MOTION_TIME_MS,
      animateVehicles: false,
    };
  }

  const routeProgress = scene === 'draw' ? clamp01(elapsedMs / DRAW_DURATION_MS) : 1;
  const simElapsed = scene === 'simulate' ? elapsedMs * SIMULATED_MS_PER_REAL_MS : 0;

  return {
    routeProgress,
    cursorVisible: scene === 'draw' && routeProgress < 1,
    simMs: SERVICE_START_MS + (simElapsed % SERVICE_SPAN_MS),
    animateVehicles: scene === 'simulate',
  };
}
