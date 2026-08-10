import { validateSystem } from '@transitmapper/core/model/validate';
import { servicesAtStation } from '@transitmapper/core/sim/frequency';
import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_FIXTURE_SYSTEM,
  ONBOARDING_SERVICE_STATS,
  ONBOARDING_VEHICLE_RUNS,
} from '../../../src/ui/onboarding/fixtureSystem';
import {
  ONBOARDING_CONTEXT_FEATURES,
  ONBOARDING_STREET_FEATURES,
} from '../../../src/ui/onboarding/port-mason-context';

describe('onboarding fixture projection', () => {
  it('models a valid early Port Mason proposal instead of generic demo geometry', () => {
    expect(validateSystem(ONBOARDING_FIXTURE_SYSTEM)).toEqual([]);
    expect(ONBOARDING_FIXTURE_SYSTEM.name).toBe('Port Mason proposal');
    expect(ONBOARDING_FIXTURE_SYSTEM.services.map((service) => service.name)).toEqual([
      'Crosstown',
      'Harbor Line',
    ]);

    const crosstown = ONBOARDING_FIXTURE_SYSTEM.services[0];
    expect(crosstown.patterns.map((pattern) => pattern.name)).toEqual(['Eastgate', 'Airport']);
    expect(crosstown).toMatchObject({
      modeId: 'bus',
      frequencyMinutes: 10,
      spanStart: '06:00',
      spanEnd: '23:00',
    });

    const central = ONBOARDING_FIXTURE_SYSTEM.stations.find(
      (station) => station.name === 'Central Exchange',
    );
    expect(central).toBeDefined();
    expect(
      servicesAtStation(
        ONBOARDING_FIXTURE_SYSTEM.ways,
        ONBOARDING_FIXTURE_SYSTEM.services,
        central!,
      ).map((service) => service.name),
    ).toEqual(['Crosstown', 'Harbor Line']);
  });

  it('distinguishes imported reality from the missing rail link the proposal creates', () => {
    const importedRoads = ONBOARDING_FIXTURE_SYSTEM.ways.filter(
      (way) => way.typeId === 'road' && way.source === 'osm',
    );
    const importedFreightTrack = ONBOARDING_FIXTURE_SYSTEM.ways.filter(
      (way) => way.typeId === 'lightRail' && way.source === 'osm',
    );
    const downtownLink = ONBOARDING_FIXTURE_SYSTEM.ways.find(
      (way) => way.id === 'port-mason-rail-downtown-link',
    );

    expect(importedRoads.length).toBeGreaterThan(20);
    expect(importedFreightTrack).toHaveLength(2);
    expect(downtownLink?.typeId).toBe('lightRail');
    expect(downtownLink?.source).toBeUndefined();
  });

  it('projects irregular streets and recognizable place context instead of an abstract grid', () => {
    expect(ONBOARDING_STREET_FEATURES.features.length).toBeGreaterThan(20);
    expect(
      ONBOARDING_STREET_FEATURES.features.some(
        (feature) => feature.geometry.coordinates.length > 2,
      ),
    ).toBe(true);
    expect(
      new Set(ONBOARDING_CONTEXT_FEATURES.features.map((feature) => feature.properties.kind)),
    ).toEqual(new Set(['airport', 'district', 'park', 'river']));
  });

  it('produces measurable runs and a nonzero operating requirement', () => {
    expect(ONBOARDING_SERVICE_STATS.fleet).toBeGreaterThan(0);
    expect(ONBOARDING_VEHICLE_RUNS).toHaveLength(3);
    expect(ONBOARDING_VEHICLE_RUNS.every((run) => run.stats.plan !== null)).toBe(true);
  });
});
