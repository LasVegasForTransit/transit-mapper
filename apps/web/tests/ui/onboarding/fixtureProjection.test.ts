import { validateSystem } from '@transitmapper/core/model/validate';
import { servicesAtStation } from '@transitmapper/core/sim/frequency';
import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_FIXTURE_SYSTEM,
  ONBOARDING_SERVICE_STATS,
  ONBOARDING_VEHICLE_RUNS,
} from '../../../src/ui/onboarding/fixtureSystem';
import {
  ONBOARDING_CONTEXT_ATTRIBUTION,
  ONBOARDING_CONTEXT_BOUNDS,
  ONBOARDING_STREET_FEATURES,
} from '../../../src/ui/onboarding/las-vegas-context';

const LAS_VEGAS_BOUNDS = {
  west: -115.17,
  south: 36.15,
  east: -115.124,
  north: 36.177,
};

describe('onboarding fixture projection', () => {
  it('models a valid early central Las Vegas proposal on recognizable corridors', () => {
    expect(validateSystem(ONBOARDING_FIXTURE_SYSTEM)).toEqual([]);
    expect(ONBOARDING_FIXTURE_SYSTEM.name).toBe('Central Las Vegas proposal');
    expect(ONBOARDING_FIXTURE_SYSTEM.services.map((service) => service.name)).toEqual([
      'Charleston Crosstown',
      'Downtown Connector',
    ]);

    const crosstown = ONBOARDING_FIXTURE_SYSTEM.services[0];
    expect(crosstown.patterns.map((pattern) => pattern.name)).toEqual(['Downtown', 'Huntridge']);
    expect(crosstown).toMatchObject({
      modeId: 'bus',
      frequencyMinutes: 10,
      spanStart: '06:00',
      spanEnd: '23:00',
    });

    const central = ONBOARDING_FIXTURE_SYSTEM.stations.find(
      (station) => station.name === 'Downtown Transfer',
    );
    expect(central).toBeDefined();
    expect(
      servicesAtStation(
        ONBOARDING_FIXTURE_SYSTEM.ways,
        ONBOARDING_FIXTURE_SYSTEM.services,
        central!,
      ).map((service) => service.name),
    ).toEqual(['Charleston Crosstown', 'Downtown Connector']);
  });

  it('distinguishes imported reality from the missing rail link the proposal creates', () => {
    const importedRoads = ONBOARDING_FIXTURE_SYSTEM.ways.filter(
      (way) => way.typeId === 'road' && way.source === 'osm',
    );
    const importedFreightTrack = ONBOARDING_FIXTURE_SYSTEM.ways.filter(
      (way) => way.typeId === 'lightRail' && way.source === 'osm',
    );
    const downtownLink = ONBOARDING_FIXTURE_SYSTEM.ways.find(
      (way) => way.id === 'las-vegas-downtown-connector',
    );

    expect(importedRoads.length).toBeGreaterThanOrEqual(3);
    expect(importedFreightTrack).toHaveLength(2);
    expect(downtownLink?.typeId).toBe('lightRail');
    expect(downtownLink?.source).toBeUndefined();

    for (const way of [...importedRoads, ...importedFreightTrack]) {
      for (const [lng, lat] of way.points) {
        expect(lng).toBeGreaterThanOrEqual(LAS_VEGAS_BOUNDS.west);
        expect(lng).toBeLessThanOrEqual(LAS_VEGAS_BOUNDS.east);
        expect(lat).toBeGreaterThanOrEqual(LAS_VEGAS_BOUNDS.south);
        expect(lat).toBeLessThanOrEqual(LAS_VEGAS_BOUNDS.north);
      }
    }
  });

  it('projects a committed attributed snapshot of central Las Vegas', () => {
    expect(ONBOARDING_CONTEXT_ATTRIBUTION).toContain('OpenStreetMap contributors');
    expect(ONBOARDING_CONTEXT_BOUNDS).toEqual(LAS_VEGAS_BOUNDS);
    expect(ONBOARDING_STREET_FEATURES.features.length).toBeGreaterThan(60);
    expect(
      ONBOARDING_STREET_FEATURES.features.some(
        (feature) => feature.geometry.coordinates.length > 2,
      ),
    ).toBe(true);
    expect(
      ONBOARDING_STREET_FEATURES.features.some((feature) => feature.properties.kind === 'rail'),
    ).toBe(true);
    const names = new Set(
      ONBOARDING_STREET_FEATURES.features.map((feature) => feature.properties.name),
    );
    expect(names).toContain('Charleston Boulevard');
    expect(names).toContain('Las Vegas Boulevard');
    expect(names).toContain('Fremont Street');
  });

  it('produces measurable runs and a nonzero operating requirement', () => {
    expect(ONBOARDING_SERVICE_STATS.fleet).toBeGreaterThan(0);
    expect(ONBOARDING_VEHICLE_RUNS).toHaveLength(3);
    expect(ONBOARDING_VEHICLE_RUNS.every((run) => run.stats.plan !== null)).toBe(true);
  });
});
