import { describe, expect, it } from 'vitest';
import {
  conflatePatternOntoExisting,
  reconcileImportedSystem,
} from '../../src/model/corridor-edits';
import { offsetMeters, patternWayIds } from '../../src/model/geo';
import type { LngLat } from '../../src/model/system';
import { aPattern, aRoad, aService, aStop, aSystem } from '../support/fixtures.test';

describe('imported corridor reconciliation', () => {
  it('preserves the input system when a pattern has no compatible corridor to share', () => {
    const way = aRoad('solo', [
      [-115.2, 36.1],
      [-115.19, 36.1],
    ]);
    const service = aService('service', [aPattern('pattern', [way], [way.id])]);
    const system = aSystem({ ways: [way], services: [service] });

    const result = conflatePatternOntoExisting(system, service.id, service.path.id);

    expect(result).toBe(system);
  });

  it('preserves the input system when no imported pattern can be reconciled', () => {
    const system = aSystem();

    const result = reconcileImportedSystem(system, []);

    expect(result).toEqual({ system, reconciled: 0 });
    expect(result.system).toBe(system);
  });

  it('reuses an established corridor without a web-store dependency', () => {
    const origin: LngLat = [-115.2, 36.1];
    const trunk = aRoad('trunk', [offsetMeters(origin, 0, 0), offsetMeters(origin, 400, 0)]);
    const shuttle = aRoad('shuttle', [offsetMeters(origin, 100, 3), offsetMeters(origin, 300, 3)]);
    const trunkService = aService('trunk-service', [
      aPattern('trunk-pattern', [trunk], [trunk.id]),
    ]);
    const shuttleService = aService('shuttle-service', [
      aPattern('shuttle-pattern', [shuttle], [shuttle.id]),
    ]);
    const shuttleStop = aStop('shuttle-stop', offsetMeters(origin, 200, 3), {
      wayId: shuttle.id,
      t: 0.5,
    });
    const system = aSystem({
      ways: [trunk, shuttle],
      services: [trunkService, shuttleService],
      stops: [shuttleStop],
      groups: [{ id: 'group', memberIds: [shuttle.id, shuttleService.id] }],
      approachControls: { [`${shuttle.id}:start`]: { control: 'stop' } },
      turnRestrictions: {
        [`${shuttle.id}:lane`]: { allowedTargets: [trunk.id] },
        [`${trunk.id}:lane`]: { allowedTargets: [shuttle.id] },
      },
    });

    const result = reconcileImportedSystem(system, [trunkService.id, shuttleService.id]);

    expect(result.reconciled).toBe(1);
    expect(result.system).not.toBe(system);
    expect(result.system.ways.some((way) => way.id === shuttle.id)).toBe(false);
    const reconciledService = result.system.services.find(
      (service) => service.id === shuttleService.id,
    );
    if (!reconciledService) throw new Error('The reconciled shuttle service must remain.');
    expect(patternWayIds(reconciledService.path)).toEqual([trunk.id]);
    expect(result.system.stops).toHaveLength(1);
    expect(result.system.stops[0]).toMatchObject({
      id: shuttleStop.id,
      coord: shuttleStop.coord,
      anchors: [{ wayId: trunk.id }],
    });
    expect(result.system.stops[0].anchors[0].t).toBeCloseTo(0.5);
    expect(result.system.groups[0].memberIds).toEqual([shuttleService.id]);
    expect(result.system.approachControls).toEqual({});
    expect(result.system.turnRestrictions).toEqual({
      [`${trunk.id}:lane`]: { allowedTargets: [] },
    });
    expect(result.system.updatedAt).toBe(system.updatedAt);
  });
});
