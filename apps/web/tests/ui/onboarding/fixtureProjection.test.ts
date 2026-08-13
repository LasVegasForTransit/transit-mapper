import { nearestOnPath, resolveWayPath } from '@transitmapper/core/model/geo';
import { computeDiagramSystem } from '@transitmapper/core/model/diagramLayout';
import { describe, expect, it } from 'vitest';
import { ONBOARDING_FIXTURE_SYSTEM } from '../../../src/ui/onboarding/fixtureSystem';
describe('onboarding fixture projection', () => {
  it('keeps every fixture stop on each of its corridors in Diagram', () => {
    const diagram = computeDiagramSystem(ONBOARDING_FIXTURE_SYSTEM);

    for (const sourceStop of ONBOARDING_FIXTURE_SYSTEM.stops) {
      const projectedStop = diagram.stops.find((stop) => stop.id === sourceStop.id);
      expect(projectedStop, sourceStop.id).toBeDefined();

      for (const anchor of sourceStop.anchors) {
        const projectedWay = diagram.ways.find((way) => way.id === anchor.wayId);
        expect(projectedWay, anchor.wayId).toBeDefined();
        const nearest = nearestOnPath(resolveWayPath(projectedWay!), projectedStop!.coord);
        expect(nearest?.distMeters, `${sourceStop.name} on ${anchor.wayId}`).toBeLessThan(1);
      }
    }
  });
});
