import { describe, expect, it } from 'vitest';
import {
  lineForService,
  lineModes,
  serviceDisplayLabel,
  servicesForLine,
  validateLineServiceMembership,
} from '../../src/model/line-service';
import { createEmptySystem, parseSystem } from '../../src/model/serialize';
import type { Service } from '../../src/model/system';

const soleServiceWithoutDuplicatePublicFields: Service = {
  id: 'blue-only',
  modeId: 'bus',
  path: { id: 'blue-only', sections: [] },
};

describe('Line and Service document boundary', () => {
  it('stores public lines separately from operating services', () => {
    const system = createEmptySystem(0);

    expect(system.version).toBe(16);
    expect(Object.hasOwn(system, 'lines')).toBe(true);
    expect(system.services).toEqual([]);
  });

  it('resolves ordered services through one authoritative membership direction', () => {
    const local = {
      id: 'red-local',
      name: 'Downtown local',
      modeId: 'bus',
      path: { id: 'red-local', sections: [] },
    };
    const express = { ...local, id: 'red-express', name: 'Airport express' };
    const system = {
      ...createEmptySystem(0),
      lines: [
        {
          id: 'red',
          name: 'Red Line',
          color: '#e5252a',
          serviceIds: ['red-local', 'red-express'],
        },
      ],
      services: [express, local],
    };

    expect(servicesForLine(system, 'red').map((service: { id: string }) => service.id)).toEqual([
      'red-local',
      'red-express',
    ]);
    expect(lineForService(system, 'red-express')?.id).toBe('red');
  });

  it('derives beginner-facing labels and modes without assigning a mode to the line', () => {
    const unnamed = {
      id: 'blue-only',
      name: '',
      modeId: 'bus',
      path: { id: 'blue-only', sections: [] },
    };
    const system = {
      ...createEmptySystem(0),
      lines: [
        { id: 'blue', name: 'Blue Line', color: '#246bce', serviceIds: ['blue-only'] },
        {
          id: 'yellow',
          name: 'Yellow Line',
          color: '#f4bf16',
          serviceIds: ['yellow-main', 'yellow-shuttle'],
        },
      ],
      services: [
        unnamed,
        { ...unnamed, id: 'yellow-main', modeId: 'subway' },
        { ...unnamed, id: 'yellow-shuttle', modeId: 'bus' },
      ],
    };

    expect(serviceDisplayLabel(system, 'blue-only')).toBe('Blue Line');
    expect(serviceDisplayLabel(system, 'yellow-shuttle')).toBe('Service 2');
    expect(lineModes(system, 'yellow')).toEqual(['subway', 'bus']);
  });

  it('lets a sole service use its line name without storing a duplicate name', () => {
    const system = {
      ...createEmptySystem(0),
      lines: [{ id: 'blue', name: 'Blue Line', color: '#246bce', serviceIds: ['blue-only'] }],
      services: [
        JSON.parse(
          JSON.stringify({
            id: 'blue-only',
            modeId: 'bus',
            path: { id: 'blue-only', sections: [] },
          }),
        ),
      ],
    };

    expect(() => serviceDisplayLabel(system, 'blue-only')).not.toThrow();
    expect(serviceDisplayLabel(system, 'blue-only')).toBe('Blue Line');
    expect(soleServiceWithoutDuplicatePublicFields.id).toBe('blue-only');
  });

  it('reports missing, duplicated, orphaned, and empty membership', () => {
    const service = {
      id: 'orphan',
      name: 'Orphan',
      modeId: 'bus',
      path: { id: 'orphan', sections: [] },
    };
    const system = {
      ...createEmptySystem(0),
      lines: [
        { id: 'empty', name: 'Empty', color: '#111111', serviceIds: [] },
        { id: 'a', name: 'A', color: '#222222', serviceIds: ['shared', 'missing'] },
        { id: 'b', name: 'B', color: '#333333', serviceIds: ['shared'] },
      ],
      services: [{ ...service, id: 'shared' }, service],
    };

    expect(validateLineServiceMembership(system)).toEqual([
      { kind: 'empty-line', lineId: 'empty' },
      { kind: 'missing-service', lineId: 'a', serviceId: 'missing' },
      { kind: 'duplicate-membership', serviceId: 'shared', lineIds: ['a', 'b'] },
      { kind: 'orphaned-service', serviceId: 'orphan' },
    ]);
  });

  it('migrates each v14 pattern into one mode-specific service beneath its public line', () => {
    const loaded = parseSystem({
      version: 14,
      id: 'system',
      name: 'Legacy network',
      ways: [],
      stops: [],
      services: [
        {
          id: 'red',
          name: 'Red Line',
          color: '#e5252a',
          modeId: 'bus',
          patterns: [
            { id: 'local', name: 'Local', sections: [] },
            { id: 'express', name: 'Express', sections: [] },
          ],
        },
      ],
    });

    expect(loaded.lines).toEqual([
      {
        id: 'red',
        name: 'Red Line',
        color: '#e5252a',
        serviceIds: ['local', 'express'],
      },
    ]);
    expect(loaded.services).toHaveLength(2);
    expect(loaded.services[0]).toMatchObject({
      id: 'local',
      name: 'Local',
      modeId: 'bus',
      path: { id: 'local', sections: [] },
    });
    expect(loaded.services[1]).toMatchObject({
      id: 'express',
      name: 'Express',
      modeId: 'bus',
      path: { id: 'express', sections: [] },
    });
    expect(loaded.services.every((service) => !Object.hasOwn(service, 'patterns'))).toBe(true);
  });

  it('parses native v15 lines and service paths without recreating public fields on services', () => {
    const loaded = parseSystem({
      version: 15,
      id: 'system',
      name: 'Current network',
      ways: [],
      stops: [],
      lines: [{ id: 'blue', name: 'Blue Line', color: '#246bce', serviceIds: ['blue-local'] }],
      services: [
        {
          id: 'blue-local',
          modeId: 'bus',
          path: { sections: [], skippedStops: { outbound: ['missing-stop'] } },
        },
      ],
    });

    expect(loaded.lines[0]).toEqual({
      id: 'blue',
      name: 'Blue Line',
      color: '#246bce',
      serviceIds: ['blue-local'],
    });
    expect(loaded.services[0]).toMatchObject({
      id: 'blue-local',
      modeId: 'bus',
      path: { sections: [] },
    });
    expect(loaded.services[0].name).toBeUndefined();
    expect(loaded.services[0].path.skippedStops).toBeUndefined();
  });

  it('rejects contradictory Line membership at the document boundary', () => {
    expect(() =>
      parseSystem({
        version: 15,
        ways: [],
        stops: [],
        lines: [
          { id: 'red', name: 'Red', color: '#ff0000', serviceIds: ['shared'] },
          { id: 'blue', name: 'Blue', color: '#0000ff', serviceIds: ['shared'] },
        ],
        services: [{ id: 'shared', modeId: 'bus', path: { sections: [] } }],
      }),
    ).toThrow('Invalid Line/Service membership: duplicate-membership');
  });

  it.each([
    {
      entity: 'Line',
      lines: [
        { id: 'red', name: 'Red', color: '#ff0000', serviceIds: ['red-local'] },
        { id: 'red', name: 'Red duplicate', color: '#cc0000', serviceIds: ['red-express'] },
      ],
      services: [
        { id: 'red-local', modeId: 'bus', path: { sections: [] } },
        { id: 'red-express', modeId: 'bus', path: { sections: [] } },
      ],
    },
    {
      entity: 'Service',
      lines: [{ id: 'red', name: 'Red', color: '#ff0000', serviceIds: ['red-service'] }],
      services: [
        { id: 'red-service', modeId: 'bus', path: { sections: [] } },
        { id: 'red-service', modeId: 'tram', path: { sections: [] } },
      ],
    },
  ])('rejects duplicate $entity ids at the document boundary', ({ entity, lines, services }) => {
    expect(() => parseSystem({ version: 15, ways: [], stops: [], lines, services })).toThrow(
      `Invalid Line/Service membership: duplicate-${entity.toLocaleLowerCase()}-id`,
    );
  });
});
