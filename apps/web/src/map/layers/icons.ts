import type { Map as MLMap } from 'maplibre-gl';
import { FACILITY_TYPE_ORDER } from '@transitmapper/core/model/catalog';
import { facilityRender } from '@transitmapper/core/style/catalogStyle';
import type { ColorScheme } from '../../theme/systemColorScheme';
import { ensureIcon } from '../icons';
import { MAP_THEMES } from '../mapTheme';
import { HANDLE_INK } from './constants';

const CATEGORICAL_FACILITY_TYPES = new Set(['bikeDock', 'busBay', 'platform']);

/** Registers every icon image the symbol layers above can reference — the
 *  handle square plus one pictogram per catalog facility type. Call once,
 *  after the map's style has loaded (map.addImage needs a ready style). */
export function registerMapIcons(map: MLMap, scheme: ColorScheme = 'light'): void {
  const theme = MAP_THEMES[scheme];
  ensureIcon(map, 'square', HANDLE_INK, { displayColor: theme.handle, fill: true });
  for (const typeId of FACILITY_TYPE_ORDER) {
    const r = facilityRender(typeId);
    ensureIcon(map, r.icon, r.color, {
      displayColor: CATEGORICAL_FACILITY_TYPES.has(typeId) ? r.color : theme.neutralFacility,
    });
  }
}
