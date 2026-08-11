import { patternLegs, patternWayIds } from '../../src/model/geo';
import {
  adoptExistingInfrastructure,
  withReturnPath,
  withRoutedService,
} from '../../src/model/routing-edits';
import type { Line, TransitSystem } from '../../src/model/system';
import { aPattern, aRoad, aService, aStation, aSystem } from '../support/fixtures.test';
import { describe, expect, it } from 'vitest';

describe('routed Service edits', () => {
  it('adds one routed Service under its public Line without touching existing records', () => {
    const existingWay = aRoad('existing', [
      [-115.2, 36.1],
      [-115.1, 36.1],
    ]);
    const system = aSystem({ ways: [existingWay] });
    const service = aService('service', []);
    const line: Line = {
      id: 'line',
      name: 'Line 1',
      color: '#123456',
      serviceIds: [service.id],
    };

    const next = withRoutedService(system, line, service);

    expect(next).not.toBe(system);
    expect(next.lines).toEqual([line]);
    expect(next.services).toEqual([service]);
    expect(next.ways).toBe(system.ways);
    expect(system.lines).toEqual([]);
    expect(system.services).toEqual([]);
  });

  it('attaches a materialized return path while preserving unrelated collections', () => {
    const ways = [
      aRoad('outward', [
        [-115.3, 36.1],
        [-115.3, 36.2],
      ]),
      aRoad('turn-east', [
        [-115.3, 36.2],
        [-115.2, 36.2],
      ]),
      aRoad('turn-south', [
        [-115.2, 36.2],
        [-115.2, 36.1],
      ]),
      aRoad('rejoin', [
        [-115.2, 36.1],
        [-115.3, 36.2],
      ]),
    ];
    const service = aService('service', [aPattern('service', ways, [ways[0].id])]);
    const system = aSystem({ ways, services: [service] });

    const next = withReturnPath(system, service.id, service.path.id, [
      { wayId: ways[1].id, fromPoint: 0, toPoint: 1 },
      { wayId: ways[2].id, fromPoint: 0, toPoint: 1 },
      { wayId: ways[3].id, fromPoint: 0, toPoint: 1 },
    ]);

    expect(next).not.toBe(system);
    expect(next.services[0]?.path.sections).toContainEqual(
      expect.objectContaining({ kind: 'turnaround' }),
    );
    expect(next.lines).toBe(system.lines);
    expect(next.ways).toBe(system.ways);
    expect(next.stations).toBe(system.stations);
    expect(service.path.sections).toHaveLength(1);
  });

  it('preserves the document reference when a return path cannot be applied', () => {
    const way = aRoad('way', [
      [-115.2, 36.1],
      [-115.1, 36.1],
    ]);
    const service = aService('service', [aPattern('service', [way], [way.id])]);
    const system = aSystem({ ways: [way], services: [service] });
    const validSpan = [{ wayId: way.id, fromPoint: 0, toPoint: 1 }];

    expect(withReturnPath(system, service.id, service.path.id, [])).toBe(system);
    expect(withReturnPath(system, service.id, 'wrong-pattern', validSpan)).toBe(system);
    expect(
      withReturnPath(system, service.id, service.path.id, [
        { wayId: 'missing', fromPoint: 0, toPoint: 1 },
      ]),
    ).toBe(system);
  });
});

describe('existing-infrastructure adoption', () => {
  function adoptionSystem(): TransitSystem {
    const built = aRoad('built', [
      [-115.28, 36.2],
      [-115.12, 36.2],
    ]);
    const sketch = aRoad('sketch', [
      [-115.28, 36.202],
      [-115.12, 36.202],
    ]);
    const service = aService('service', [aPattern('service', [sketch], [sketch.id])]);
    return aSystem({
      ways: [built, sketch],
      services: [service],
      stations: [aStation('station', [-115.25, 36.202], { wayId: sketch.id, t: 0.2 })],
    });
  }

  it('rebinds a sketch, moves its stations, and removes the unused sketch way', () => {
    const system = adoptionSystem();

    const result = adoptExistingInfrastructure(system, 'service');
    const adoptedService = result.system.services[0];

    expect(result.rebound).toBe(1);
    expect(result.system).not.toBe(system);
    expect(patternWayIds(adoptedService.path)).toEqual(['built']);
    expect(result.system.stations[0]?.anchors).toEqual([
      expect.objectContaining({ wayId: 'built' }),
    ]);
    expect(result.system.ways.map((way) => way.id)).toEqual(['built']);
    expect(system.ways.map((way) => way.id)).toEqual(['built', 'sketch']);
  });

  it('preserves the document reference when nothing can be adopted', () => {
    const system = adoptionSystem();
    const service = system.services[0];

    const missing = adoptExistingInfrastructure(system, 'missing');
    expect(missing.system).toBe(system);
    expect(missing.rebound).toBe(0);

    const splitService = {
      ...service,
      path: {
        id: 'service',
        sections: [
          {
            kind: 'split' as const,
            outbound: patternLegs(service.path),
            inbound: patternLegs(service.path),
          },
        ],
      },
    };
    const splitSystem = { ...system, services: [splitService] };
    const split = adoptExistingInfrastructure(splitSystem, splitService.id);
    expect(split.system).toBe(splitSystem);
    expect(split.rebound).toBe(0);
  });
});
