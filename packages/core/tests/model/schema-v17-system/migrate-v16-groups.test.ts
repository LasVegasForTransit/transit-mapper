import { describe, expect, it } from 'vitest';
import { aPattern, aRoad, aService, aSystem } from '../../support/fixtures.test';
import { migrateSchemaV16System } from '../../../src/model/schema-v17-system/migrate-v16';

describe('schema-v16 Group migration', () => {
  it('keeps legacy Group member IDs unchanged', () => {
    const way = aRoad('transfer-guideway', [
      [-115.2, 36.14],
      [-115.16, 36.14],
    ]);
    const service = aService('transfer-service', [aPattern('transfer-pattern', [way], [way.id])]);
    const v16 = aSystem({
      ways: [way],
      services: [service],
      lines: [
        {
          id: 'transfer-line',
          name: 'Transfer Line',
          color: '#c62828',
          serviceIds: [service.id],
        },
      ],
      groups: [
        {
          id: 'transfer-complex',
          name: 'Transfer complex',
          memberIds: [way.id, service.id, way.id],
        },
      ],
    });

    const result = migrateSchemaV16System(v16);

    expect(result.kind).toBe('migrated');
    if (result.kind !== 'migrated') return;
    expect(result.system.groups).toEqual([
      {
        id: 'transfer-complex',
        name: 'Transfer complex',
        memberIds: [way.id, service.id, way.id],
      },
    ]);
  });

  it('keeps ambiguous Group member IDs unchanged', () => {
    const service = aService('shared-legacy-id', []);
    const v16 = aSystem({
      services: [service],
      groups: [{ id: 'ambiguous-group', memberIds: [service.id] }],
    });

    const result = migrateSchemaV16System(v16);

    expect(result.kind).toBe('migrated');
    if (result.kind !== 'migrated') return;
    expect(result.system.groups).toEqual([{ id: 'ambiguous-group', memberIds: [service.id] }]);
  });

  it('keeps stale Group member IDs unchanged', () => {
    const v16 = aSystem({
      groups: [{ id: 'stale-group', memberIds: ['removed-record'] }],
    });

    const result = migrateSchemaV16System(v16);

    expect(result.kind).toBe('migrated');
    if (result.kind !== 'migrated') return;
    expect(result.system.groups).toEqual([{ id: 'stale-group', memberIds: ['removed-record'] }]);
  });
});
