import { describe, expect, it } from 'vitest';
import { createEmptySystem } from '../../src/model/serialize';
import { FEATURE_INPUT_ROLE, featureInputsChanged } from '../../src/render/featureInputs';

describe('render feature inputs', () => {
  it('treats Station and Stop collection changes as render changes', () => {
    const system = createEmptySystem();

    expect(FEATURE_INPUT_ROLE.stops).toBe('render');
    expect(FEATURE_INPUT_ROLE.stations).toBe('render');
    expect(featureInputsChanged(system, { ...system, stops: [...system.stops] })).toBe(true);
    expect(featureInputsChanged(system, { ...system, stations: [...system.stations] })).toBe(true);
  });

  it('ignores document metadata and identical system references', () => {
    const system = createEmptySystem();

    expect(featureInputsChanged(system, system)).toBe(false);
    expect(featureInputsChanged(system, { ...system, name: 'Renamed' })).toBe(false);
  });
});
