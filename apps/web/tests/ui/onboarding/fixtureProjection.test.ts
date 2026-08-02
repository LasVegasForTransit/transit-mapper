import { nearestOnPath, resolveWayPath } from '@transitmapper/core/model/geo';
import { computeDiagramSystem } from '@transitmapper/core/model/diagramLayout';
import { describe, expect, it } from 'vitest';
import { ONBOARDING_FIXTURE_SYSTEM } from '../../../src/ui/onboarding/fixtureSystem';

describe('onboarding fixture projection', () => {
  it('keeps every fixture stop on each of its corridors in Diagram', () => {
    const diagram = computeDiagramSystem(ONBOARDING_FIXTURE_SYSTEM);

    for (const sourceStation of ONBOARDING_FIXTURE_SYSTEM.stations) {
      const projectedStation = diagram.stations.find((station) => station.id === sourceStation.id);
      expect(projectedStation, sourceStation.id).toBeDefined();

      for (const anchor of sourceStation.anchors) {
        const projectedWay = diagram.ways.find((way) => way.id === anchor.wayId);
        expect(projectedWay, anchor.wayId).toBeDefined();
        const nearest = nearestOnPath(resolveWayPath(projectedWay!), projectedStation!.coord);
        expect(nearest?.distMeters, `${sourceStation.name} on ${anchor.wayId}`).toBeLessThan(1);
      }
    }
  });
});
