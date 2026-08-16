import { describe, expect, it } from 'vitest';
import { onboardingSceneFrame } from '../../../src/ui/onboarding/scene-timing';

describe('onboarding scene timing', () => {
  it('keeps the welcome overview complete and still', () => {
    expect(onboardingSceneFrame('welcome', 2_000, false)).toMatchObject({
      routeProgress: 1,
      cursorVisible: false,
      animateVehicles: false,
    });
  });

  it('settles the drawing gesture on the complete route', () => {
    expect(onboardingSceneFrame('draw', 0, false)).toMatchObject({
      routeProgress: 0,
      cursorVisible: true,
      animateVehicles: false,
    });
    expect(onboardingSceneFrame('draw', 1_600, false).routeProgress).toBe(0.5);
    expect(onboardingSceneFrame('draw', 4_000, false)).toMatchObject({
      routeProgress: 1,
      cursorVisible: false,
      animateVehicles: false,
    });
  });

  it('turns every scene into a meaningful still under reduced motion', () => {
    expect(onboardingSceneFrame('draw', 0, true)).toMatchObject({
      routeProgress: 1,
      cursorVisible: false,
      animateVehicles: false,
    });
    expect(onboardingSceneFrame('simulate', 1_000, true)).toMatchObject({
      simMs: 30_600_000,
      animateVehicles: false,
    });
  });

  it('advances the operating clock only for the simulation scene', () => {
    expect(onboardingSceneFrame('operations', 2_000, false).simMs).toBe(21_600_000);
    expect(onboardingSceneFrame('simulate', 2_000, false)).toMatchObject({
      simMs: 22_080_000,
      animateVehicles: true,
    });
  });
});
