// Typed builders for the records tests need.
//
// They exist so a test never writes `as unknown as Way`. A double cast turns
// the compiler off exactly where a test is asserting behaviour: a cast fixture
// keeps compiling after a record gains a required field, and silently
// describes something that cannot exist. These return real values, so a model
// change breaks the build here — once — instead of quietly weakening every
// test that builds one.

import { wayById, wholeLegs } from '../model/geo';
import { defaultProfileFor } from '../model/profile';
import { createEmptySystem } from '../model/serialize';
import type { LngLat, Pattern, Service, Station, TransitSystem, Way } from '../model/system';

/** A road with the way type's default cross-section. */
export function aRoad(id: string, points: LngLat[], overrides: Partial<Way> = {}): Way {
  return {
    id,
    typeId: 'road',
    points,
    geometry: 'straight',
    grade: 'atGrade',
    profile: defaultProfileFor('road'),
    ...overrides,
  };
}

/** A pattern running the whole of each way in `wayIds`, with leg directions
 *  derived by continuity — what materialization produces for a route drawn
 *  straight through. Pass a pattern built by hand when a test needs partial
 *  legs or a pinned lane. */
export function aPattern(
  id: string,
  ways: Way[],
  wayIds: string[],
  overrides: Partial<Pattern> = {},
): Pattern {
  return { id, legs: wholeLegs(wayById(ways), wayIds), ...overrides };
}

/** A bus line running the given patterns. */
export function aService(
  id: string,
  patterns: Pattern[],
  overrides: Partial<Service> = {},
): Service {
  return { id, name: id, modeId: 'bus', color: '#e4572e', patterns, ...overrides };
}

/** An otherwise-empty system holding exactly these records. Tests that care
 *  about junctions pass `nodes` themselves — nothing here infers them, since
 *  a node is what the store creates deliberately and half these tests exist
 *  to check what happens when one is absent. */
export function aSystem(parts: Partial<TransitSystem> = {}): TransitSystem {
  return { ...createEmptySystem(0), ...parts };
}

/** A station anchored partway along a way. `t` runs along the WAY's own point
 *  order, which is not the direction of travel when a line runs it backwards. */
export function aStation(
  id: string,
  coord: LngLat,
  anchor?: { wayId: string; t: number },
  overrides: Partial<Station> = {},
): Station {
  return { id, coord, ...(anchor ? { anchor } : {}), ...overrides };
}
