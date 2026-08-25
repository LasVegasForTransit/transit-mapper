import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FACILITY_TYPE_ORDER } from '@transitmapper/core/model/catalog';
import { facilityRender } from '@transitmapper/core/style/catalogStyle';
import { ensureIcon } from '../../../src/map/icons';
import { MAP_THEMES } from '../../../src/map/mapTheme';
import { HANDLE_INK } from '@transitmapper/renderer/layers';
import { registerMapIcons } from '../../../src/map/layers/icons';

vi.mock('../../../src/map/icons', () => ({
  ensureIcon: vi.fn(),
}));

describe('map icon registration', () => {
  beforeEach(() => {
    vi.mocked(ensureIcon).mockClear();
  });

  it('keeps canonical icon IDs while changing neutral display ink', () => {
    const map = {} as Parameters<typeof registerMapIcons>[0];
    registerMapIcons(map, 'dark');

    expect(ensureIcon).toHaveBeenCalledWith(map, 'square', HANDLE_INK, {
      displayColor: MAP_THEMES.dark.handle,
      fill: true,
    });

    for (const typeId of FACILITY_TYPE_ORDER) {
      const render = facilityRender(typeId);
      const displayColor = ['bikeDock', 'busBay', 'platform'].includes(typeId)
        ? render.color
        : MAP_THEMES.dark.neutralFacility;
      expect(ensureIcon).toHaveBeenCalledWith(map, render.icon, render.color, {
        displayColor,
      });
    }
  });
});
