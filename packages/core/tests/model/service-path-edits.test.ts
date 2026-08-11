import { describe, expect, it } from 'vitest';
import { oneSection, stretchLeg, wholeLeg } from '../../src/model/geo';
import {
  divideServicePath,
  replaceServicePath,
  servicePathOperatingMeters,
  setPatternStopSkipped,
  withPatternSections,
} from '../../src/model/service-path-edits';
import { aPattern, aRoad, aService, aSystem } from '../support/fixtures.test';

const SOUTH: [number, number] = [-115.2, 36.1];
const NORTH: [number, number] = [-115.2, 36.2];

describe('service path record edits', () => {
  it('preserves a pattern when replacement sections describe the same path', () => {
    const pattern = { id: 'service', sections: oneSection([wholeLeg('road')]) };
    const equivalent = oneSection([wholeLeg('road')]);

    expect(withPatternSections(pattern, pattern.sections)).toBe(pattern);
    expect(withPatternSections(pattern, equivalent)).toBe(pattern);
  });

  it('replaces only the service whose path changed', () => {
    const road = aRoad('road', [SOUTH, NORTH]);
    const source = aService('source', [aPattern('source-path', [road], ['road'])]);
    const untouched = aService('untouched', [aPattern('other-path', [road], ['road'])]);
    const system = aSystem({ ways: [road], services: [source, untouched] });
    const nextPath = {
      ...source.path,
      sections: oneSection([stretchLeg(wholeLeg('road'), 0, 0.5)]),
    };

    const next = replaceServicePath(system, source.id, source.path.id, nextPath);

    expect(next).not.toBe(system);
    expect(next.services[0].path.sections).toEqual(nextPath.sections);
    expect(next.services[1]).toBe(untouched);
    expect(next.updatedAt).toBe(system.updatedAt);
    expect(replaceServicePath(system, 'missing', source.path.id, nextPath)).toBe(system);
    expect(replaceServicePath(system, source.id, source.path.id, source.path)).toBe(system);
  });

  it('adds and removes skipped stops without retaining an empty record', () => {
    const pattern = { id: 'service', sections: oneSection([wholeLeg('road')]) };

    expect(setPatternStopSkipped(pattern, 'outbound', 'station', false)).toBe(pattern);
    const skipped = setPatternStopSkipped(pattern, 'outbound', 'station', true);
    expect(skipped.skippedStops).toEqual({ outbound: ['station'] });
    expect(setPatternStopSkipped(skipped, 'outbound', 'station', true)).toBe(skipped);
    const restored = setPatternStopSkipped(skipped, 'outbound', 'station', false);
    expect(restored).toEqual(pattern);
    expect(restored.skippedStops).toBeUndefined();
  });

  it('measures both operating directions of a service path', () => {
    const road = aRoad('road', [SOUTH, NORTH]);
    const pattern = aPattern('service', [road], ['road']);
    const system = aSystem({ ways: [road] });

    expect(servicePathOperatingMeters(system, pattern)).toBeGreaterThan(20_000);
  });
});

describe('service path division', () => {
  it('adds the divided path to the source public line', () => {
    const road = aRoad('road', [SOUTH, NORTH]);
    const source = aService('source', [aPattern('source', [road], ['road'])], {
      name: undefined,
    });
    const system = aSystem({ ways: [road], services: [source] });
    const remaining = {
      ...source.path,
      sections: oneSection([stretchLeg(wholeLeg('road'), 0, 0.5)]),
    };
    const divided = {
      ...source.path,
      sections: oneSection([stretchLeg(wholeLeg('road'), 0.5, 1)]),
    };

    const next = divideServicePath(system, {
      sourceServiceId: source.id,
      spawnedServiceId: 'spawned',
      remaining,
      divided,
      line: { kind: 'source' },
    });

    expect(next.services).toHaveLength(2);
    expect(next.services[0].path.sections).toEqual(remaining.sections);
    expect(next.services[1]).toMatchObject({
      id: 'spawned',
      name: 'Service 2',
      path: { id: 'spawned', sections: divided.sections },
    });
    expect(next.lines[0].serviceIds).toEqual(['source', 'spawned']);
    expect(next.ways).toBe(system.ways);
    expect(next.updatedAt).toBe(system.updatedAt);
  });

  it('adds a divided path to a supplied new public line', () => {
    const road = aRoad('road', [SOUTH, NORTH]);
    const source = aService('source', [aPattern('source', [road], ['road'])], {
      name: undefined,
    });
    const system = aSystem({ ways: [road], services: [source] });

    const next = divideServicePath(system, {
      sourceServiceId: source.id,
      spawnedServiceId: 'spawned',
      remaining: source.path,
      divided: source.path,
      line: { kind: 'new', id: 'new-line', name: 'Line 1 2', color: '#246bce' },
    });

    expect(next.lines).toEqual([
      system.lines[0],
      { id: 'new-line', name: 'Line 1 2', color: '#246bce', serviceIds: ['spawned'] },
    ]);
    expect(next.services[1].name).toBeUndefined();
  });

  it('preserves the system when division identities are invalid', () => {
    const source = aService('source', []);
    const system = aSystem({ services: [source] });
    const request = {
      sourceServiceId: source.id,
      spawnedServiceId: source.id,
      remaining: source.path,
      divided: source.path,
      line: { kind: 'source' as const },
    };

    expect(divideServicePath(system, request)).toBe(system);
    expect(divideServicePath(system, { ...request, sourceServiceId: 'missing' })).toBe(system);
  });
});
