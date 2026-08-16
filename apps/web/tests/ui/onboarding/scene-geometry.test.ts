import { describe, expect, it } from 'vitest';
import { buildFeatures } from '@transitmapper/core/render/buildFeatures';
import {
  ONBOARDING_AUTHORED_CONNECTOR_ID,
  ONBOARDING_DRAW_PATH,
  ONBOARDING_DRAW_SYSTEM,
  ONBOARDING_VEHICLE_RUNS,
  onboardingViewOptions,
} from '../../../src/ui/onboarding/fixtureSystem';
import { SRC_PREVIEW } from '../../../src/map/layers';
import {
  onboardingDrawnServiceFeatures,
  onboardingScenePresentation,
  pathPrefix,
  vehicleFeaturesAt,
} from '../../../src/ui/onboarding/scene-geometry';
import { ONBOARDING_TEST_PRESENTATION } from '../../support/onboarding-presentation.test';

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

  it('renders the growing route with the production service feature', () => {
    const completeFeatures = buildFeatures(ONBOARDING_DRAW_SYSTEM, null, [], {
      ...onboardingViewOptions('network'),
      presentation: ONBOARDING_TEST_PRESENTATION,
    });
    const path = pathPrefix(ONBOARDING_DRAW_PATH, 0.5);
    const drawn = onboardingDrawnServiceFeatures(completeFeatures, path);

    expect(drawn.features).toHaveLength(1);
    expect(drawn.features[0]?.properties).toMatchObject({
      serviceId: 'las-vegas-charleston-downtown',
      color: ONBOARDING_DRAW_SYSTEM.lines[0]?.color,
    });
    expect(drawn.features[0]?.geometry).toEqual({ type: 'LineString', coordinates: path });
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

  it('uses production preview and selection state for the two editor demonstrations', () => {
    expect(onboardingScenePresentation('draw')).toEqual({
      previewSource: SRC_PREVIEW,
      selectedWayId: null,
    });
    expect(onboardingScenePresentation('infrastructure')).toEqual({
      previewSource: null,
      selectedWayId: ONBOARDING_AUTHORED_CONNECTOR_ID,
    });
    for (const scene of ['welcome', 'operations', 'simulate'] as const) {
      expect(onboardingScenePresentation(scene)).toEqual({
        previewSource: null,
        selectedWayId: null,
      });
    }
  });
});
