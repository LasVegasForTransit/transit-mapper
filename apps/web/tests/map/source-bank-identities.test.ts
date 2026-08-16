import { describe, expect, it } from 'vitest';
import { LAYER_SPECS, SRC_HANDLES, SRC_HIT_FEATURES, SRC_WAYS } from '../../src/map/layers';
import {
  logicalBankedLayerIds,
  logicalRenderLayerId,
  logicalRenderSourceId,
  physicalRenderLayerIds,
  physicalRenderSourceIds,
  sourceBankForPhysicalId,
} from '../../src/map/source-bank-layers';

describe('render source bank identities', () => {
  it('expands committed and hit sources while leaving editor sources unbanked', () => {
    expect(physicalRenderSourceIds([SRC_WAYS, SRC_HIT_FEATURES, SRC_HANDLES])).toEqual([
      `${SRC_WAYS}--bank-a`,
      `${SRC_WAYS}--bank-b`,
      `${SRC_HIT_FEATURES}--bank-a`,
      `${SRC_HIT_FEATURES}--bank-b`,
      SRC_HANDLES,
    ]);
  });

  it('round-trips physical layer and source ownership', () => {
    expect(logicalRenderSourceId(`${SRC_WAYS}--bank-b`)).toBe(SRC_WAYS);
    expect(logicalRenderLayerId('tm-ways-solid--bank-a')).toBe('tm-ways-solid');
    expect(sourceBankForPhysicalId(`${SRC_WAYS}--bank-b`)).toBe('b');
    expect(sourceBankForPhysicalId(SRC_HANDLES)).toBeNull();
  });

  it('resolves only the active physical layer while preserving editor IDs', () => {
    const banked = logicalBankedLayerIds(LAYER_SPECS);
    expect(physicalRenderLayerIds('tm-ways-solid', banked, 'b')).toEqual(['tm-ways-solid--bank-b']);
    expect(physicalRenderLayerIds('tm-handles', banked, 'b')).toEqual(['tm-handles']);
    expect(physicalRenderLayerIds('tm-ways-solid', banked, null)).toEqual([]);
  });
});
