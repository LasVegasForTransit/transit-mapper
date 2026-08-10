import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_DRAW_PATH,
  ONBOARDING_VEHICLE_RUNS,
} from '../../../src/ui/onboarding/fixtureSystem';
import { pathPrefix, vehicleFeaturesAt } from '../../../src/ui/onboarding/scene-geometry';

describe('onboarding scene geometry', () => {
  it('reveals a route along its real path and settles on the exact geometry', () => {
    expect(pathPrefix(ONBOARDING_DRAW_PATH, 0)).toEqual([ONBOARDING_DRAW_PATH[0]]);
    expect(pathPrefix(ONBOARDING_DRAW_PATH, 1)).toEqual(ONBOARDING_DRAW_PATH);

    const halfway = pathPrefix(ONBOARDING_DRAW_PATH, 0.5);
    expect(halfway.length).toBeGreaterThan(1);
    expect(halfway[0]).toEqual(ONBOARDING_DRAW_PATH[0]);
    expect(halfway.at(-1)).not.toEqual(ONBOARDING_DRAW_PATH.at(-1));
  });

  it('clamps route progress instead of drawing past either terminus', () => {
    expect(pathPrefix(ONBOARDING_DRAW_PATH, -1)).toEqual([ONBOARDING_DRAW_PATH[0]]);
    expect(pathPrefix(ONBOARDING_DRAW_PATH, 2)).toEqual(ONBOARDING_DRAW_PATH);
  });

  it('positions one vehicle per proposed pattern with the real simulation kernel', () => {
    const start = vehicleFeaturesAt(0);
    const later = vehicleFeaturesAt(60_000);

    expect(start.features).toHaveLength(ONBOARDING_VEHICLE_RUNS.length);
    expect(start.features.map((feature) => feature.properties.color)).toEqual([
      ONBOARDING_VEHICLE_RUNS[0].color,
      ONBOARDING_VEHICLE_RUNS[1].color,
      ONBOARDING_VEHICLE_RUNS[2].color,
    ]);
    expect(later.features.map((feature) => feature.geometry)).not.toEqual(
      start.features.map((feature) => feature.geometry),
    );
  });
});
