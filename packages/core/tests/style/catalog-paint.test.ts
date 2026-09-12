import { describe, expect, it } from 'vitest';
import { FACILITY_TYPES, LANE_KINDS, MODES, WAY_TYPES } from '../../src/model/catalog';
import {
  FACILITY_RENDER,
  LANE_KIND_RENDER,
  MODE_RENDER,
  WAY_TYPE_RENDER,
  facilityRender,
  gradeFlags,
  laneRender,
  modeRender,
  showWayWhenServed,
  wayRender,
  UNKNOWN_FACILITY_RENDER,
  UNKNOWN_LANE_RENDER,
  UNKNOWN_MODE_RENDER,
  UNKNOWN_WAY_RENDER,
} from '../../src/style/catalogStyle';

/**
 * Rendering does not belong in `model/`, so paint lives in a second table
 * keyed by the same catalog IDs, and these cases are the only thing keeping
 * the two lists in step.
 *
 * A compile-time guarantee would be strictly better, and it works: annotate
 * the catalogs `satisfies Record<string, T>` instead of `: Record<string, T>`,
 * export `keyof typeof`, and key each paint table by that. Verified — a
 * missing entry and an orphan entry both fail `tsc`. It is not done because
 * `model/catalog.ts` is 643 lines against a 400-line limit and carries a
 * `max-lines` suppression, so the debt ratchet refuses to let it grow by the
 * dozen lines this needs. Splitting that catalog into per-family modules is
 * the change that unblocks it.
 *
 * What only these cases check is the behaviour that made the drift invisible.
 * `pedestrian` was in `WAY_TYPES` with no entry in `WAY_TYPE_RENDER`, and
 * every pedestrian path drew as a grey heavy-rail track, because the lookup
 * fell back to `heavyRail` instead of saying it did not know.
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

describe('a way type shows under the services riding it only when listed', () => {
  // The map is partial on purpose — only surfaces a service sits *on* show
  // through. A rail track is the coloured line, so a grey line under it would
  // be redundant. That partiality is why the lookup coerces rather than
  // returning the stored value.
  it('shows a road and a bike path under their services', () => {
    expect(showWayWhenServed('road')).toBe(true);
    expect(showWayWhenServed('bike')).toBe(true);
  });

  it('hides a way type the map does not list, including an unknown one', () => {
    expect(showWayWhenServed('heavyRail')).toBe(false);
    expect(showWayWhenServed('teleporter')).toBe(false);
  });
});

describe('grade flags', () => {
  it('reports exactly one flag per grade, and none for at-grade', () => {
    expect(gradeFlags('underground')).toEqual({ underground: true, elevated: false });
    expect(gradeFlags('elevated')).toEqual({ underground: false, elevated: true });
    expect(gradeFlags('atGrade')).toEqual({ underground: false, elevated: false });
  });
});

describe('a way class layers over its type', () => {
  it('overrides the base render for a class the type defines', () => {
    expect(wayRender('road', 'local')).toEqual({
      ...WAY_TYPE_RENDER.road,
      ...{ color: '#cbd0d8', width: 2 },
    });
  });

  it('keeps the base render for a way type that has no classes', () => {
    expect(wayRender('heavyRail', 'local')).toEqual(WAY_TYPE_RENDER.heavyRail);
  });
});
