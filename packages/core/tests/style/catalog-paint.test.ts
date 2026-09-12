import { describe, expect, it } from 'vitest';
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
 * keyed by the same catalog IDs. Whether the two lists agree is no longer a
 * question a test answers: each table is typed `Record<WayTypeId, …>` and
 * friends, so a catalog entry with no paint fails to compile, and so does
 * paint for an entry no catalog defines.
 *
 * What only a test can check is the behaviour that made the drift invisible
 * for as long as it lasted. `pedestrian` was in `WAY_TYPES` with no entry in
 * `WAY_TYPE_RENDER`, and every pedestrian path drew as a grey heavy-rail
 * track, because the lookup fell back to `heavyRail` rather than saying it
 * did not know the ID.
 */
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
