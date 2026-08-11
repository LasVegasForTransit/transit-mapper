import { describe, expect, it } from 'vitest';
import { setVehicleKinds } from '../../src/model/system';
import type { VehicleKind } from '../../src/model/system';
import { aService, aSystem } from '../support/fixtures.test';

describe('vehicle kind record edits', () => {
  it('preserves the document when the vehicle-kind collection is unchanged', () => {
    const system = aSystem();

    expect(setVehicleKinds(system, system.vehicleKinds)).toBe(system);
  });

  it('replaces only the vehicle-kind collection', () => {
    const system = aSystem();
    const kinds: VehicleKind[] = [
      {
        id: 'articulated-bus',
        modeId: 'bus',
        label: 'Articulated bus',
        widthM: 2.55,
        lengthM: 18,
      },
    ];

    const next = setVehicleKinds(system, kinds);

    expect(next.vehicleKinds).toBe(kinds);
    expect(next.services).toBe(system.services);
    expect(next.updatedAt).toBe(system.updatedAt);
  });

  it('preserves fresh equal definitions and clears assignments they make invalid', () => {
    const kind: VehicleKind = {
      id: 'local-bus',
      modeId: 'bus',
      label: 'Local bus',
      widthM: 2.5,
      lengthM: 12,
    };
    const service = aService('service', [], { modeId: 'bus', vehicleKindId: kind.id });
    const system = aSystem({ services: [service], vehicleKinds: [kind] });

    expect(setVehicleKinds(system, [{ ...kind }])).toBe(system);

    const next = setVehicleKinds(system, [{ ...kind, modeId: 'lightRail' }]);
    expect(next.vehicleKinds[0].modeId).toBe('lightRail');
    expect(next.services[0]).not.toHaveProperty('vehicleKindId');
  });
});
