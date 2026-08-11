import type { Feature } from 'geojson';
import { describe, expect, it } from 'vitest';
import { wholeLeg } from '../../src/model/geo';
import { buildFeatures, type SystemFeatures } from '../../src/render/buildFeatures';
import { aRoad, aService, aSystem } from '../support/fixtures.test';
import { OVERVIEW_TEST_PRESENTATION } from '../support/render-presentation.test';

function featureProperty(feature: Feature, name: string): unknown {
  return feature.properties?.[name];
}

function paintedServiceFeatures(features: SystemFeatures): Feature[] {
  return features.services.features.filter(
    (feature) => featureProperty(feature, 'hitTarget') !== true,
  );
}

function wayTypePairs(features: readonly Feature[]): string[] {
  return [
    ...new Set(
      features.map(
        (feature) =>
          `${String(featureProperty(feature, 'wayId'))}:${String(featureProperty(feature, 'typeId'))}`,
      ),
    ),
  ].sort();
}

describe('style-deferred renderer visibility properties', () => {
  it('stamps service paint, hit, and direction arrows with each way type', () => {
    const road = aRoad('road', [
      [-115.2, 36.14],
      [-115.18, 36.14],
    ]);
    const guideway = aRoad(
      'guideway',
      [
        [-115.18, 36.14],
        [-115.16, 36.14],
      ],
      { typeId: 'busway' },
    );
    const service = aService('service', [
      {
        id: 'pattern',
        sections: [
          { kind: 'shared', legs: [wholeLeg(road.id)] },
          { kind: 'turnaround', legs: [wholeLeg(guideway.id)] },
        ],
      },
    ]);
    const features = buildFeatures(
      aSystem({ ways: [road, guideway], services: [service] }),
      null,
      [],
      {
        viewMode: 'network',
        visibleModes: new Set(),
        visibleWayTypes: new Set(),
        styleDeferredVisibility: true,
        presentation: OVERVIEW_TEST_PRESENTATION,
      },
    );

    expect(wayTypePairs(paintedServiceFeatures(features))).toEqual([
      'guideway:busway',
      'road:road',
    ]);
    expect(
      wayTypePairs(
        features.services.features.filter(
          (feature) => featureProperty(feature, 'hitTarget') === true,
        ),
      ),
    ).toEqual(['guideway:busway', 'road:road']);
    expect(wayTypePairs(features.serviceArrows.features)).toEqual(['guideway:busway']);
  });
});
