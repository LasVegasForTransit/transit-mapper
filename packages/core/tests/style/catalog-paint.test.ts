import { describe, expect, it } from 'vitest';
import { FACILITY_TYPES, LANE_KINDS, MODES, WAY_TYPES } from '../../src/model/catalog';
import {
  FACILITY_RENDER,
  LANE_KIND_RENDER,
  MODE_RENDER,
  WAY_TYPE_RENDER,
  facilityRender,
  laneRender,
  modeRender,
  wayRender,
  UNKNOWN_FACILITY_RENDER,
  UNKNOWN_LANE_RENDER,
  UNKNOWN_MODE_RENDER,
  UNKNOWN_WAY_RENDER,
} from '../../src/style/catalogStyle';

/**
 * Rendering does not belong in `model/`, so paint lives in a second table
 * keyed by the same catalog IDs. These cases are what stops that second table
 * drifting: `pedestrian` was in `WAY_TYPES` with no entry in
 * `WAY_TYPE_RENDER`, and every pedestrian path drew as a grey heavy-rail
 * track because the lookup fell back to `heavyRail`.
 */
const families = [
  ['way type', WAY_TYPES, WAY_TYPE_RENDER],
  ['lane kind', LANE_KINDS, LANE_KIND_RENDER],
  ['mode', MODES, MODE_RENDER],
  ['facility type', FACILITY_TYPES, FACILITY_RENDER],
] as const;

describe('every catalog entry has paint', () => {
  for (const [label, catalog, paint] of families) {
    it(`paints every ${label} the catalog defines`, () => {
      const missing = Object.keys(catalog).filter((id) => !(id in paint));
      expect(missing).toEqual([]);
    });

    it(`paints no ${label} the catalog does not define`, () => {
      const orphans = Object.keys(paint).filter((id) => !(id in catalog));
      expect(orphans).toEqual([]);
    });
  }
});

describe('an unknown ID renders as unknown', () => {
  // A document from a newer build can name something this catalog has never
  // heard of. Borrowing another entry's paint would state something false
  // about it — a ferry drawn as a bus reads as a bus.
  it('does not borrow another entry for an unknown way type', () => {
    expect(wayRender('teleporter')).toEqual(UNKNOWN_WAY_RENDER);
    expect(wayRender('teleporter')).not.toEqual(WAY_TYPE_RENDER.heavyRail);
  });

  it('does not borrow another entry for an unknown lane kind', () => {
    expect(laneRender('hyperlane')).toEqual(UNKNOWN_LANE_RENDER);
    expect(laneRender('hyperlane')).not.toEqual(LANE_KIND_RENDER.drive);
  });

  it('does not borrow another entry for an unknown mode', () => {
    expect(modeRender('hyperloop')).toEqual(UNKNOWN_MODE_RENDER);
    expect(modeRender('hyperloop')).not.toEqual(MODE_RENDER.bus);
  });

  it('does not borrow another entry for an unknown facility type', () => {
    expect(facilityRender('teleport-pad')).toEqual(UNKNOWN_FACILITY_RENDER);
    expect(facilityRender('teleport-pad')).not.toEqual(FACILITY_RENDER.entrance);
  });

  it('still paints a known ID from its own entry', () => {
    expect(modeRender('bus')).toEqual(MODE_RENDER.bus);
    expect(wayRender('pedestrian')).toEqual(WAY_TYPE_RENDER.pedestrian);
  });
});
