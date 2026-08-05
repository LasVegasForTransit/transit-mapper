/**
 * How much imprecision the map's pointer handling tolerates, declared once.
 *
 * These five numbers used to be scattered literals in map/interactions.ts,
 * each tuned for a mouse. A mouse cursor is a single pixel and a fingertip is
 * not: the contact patch of an adult index finger measures 9-11mm, which at
 * the ~160 CSS px/inch a phone reports works out to roughly 24 CSS px across.
 * A 9px hit radius asks someone to place a 24px-wide finger inside it.
 *
 * Collected here because ROADMAP.md names the scatter as a defect, and states
 * the reason: pointer precision varies enormously between a trackpad, a
 * mouse, and a hand that shakes, and a fixed 4-pixel drag threshold is an
 * accessibility decision made on someone else's behalf. Declaring the table
 * is the step that makes those values something a person could later be given
 * control of; this module deliberately stops short of that setting.
 *
 * It lives under editor/ rather than in packages/core because pointer
 * precision is interaction state, which architecture.md assigns to the web
 * app, not a rule about what a transit system is. It stays a plain table of
 * numbers so the test suite reaches it without a browser.
 */
export interface InputTuning {
  /** Pixel tolerance for hit-testing features under the pointer. */
  hitPx: number;
  /** Stations and way endpoints within this screen distance snap. */
  snapPx: number;
  /** Movement beyond this counts as a drag, not a click. */
  dragPx: number;
  /** Spacing between points sampled while freehand-drawing. */
  freehandSamplePx: number;
  /**
   * How far off a way's existing heading the pointer may sit and still be
   * snapped into continuing straight. A screen distance, not an angle — see
   * continueStraight in map/interactions.ts for why an angle was the wrong
   * unit — so it scales with the pointer like the rest of this table.
   */
  straightSnapPx: number;
}

/** A mouse, trackpad, or stylus. The values the editor shipped with. */
export const FINE_POINTER_TUNING: InputTuning = {
  hitPx: 9,
  snapPx: 18,
  dragPx: 4,
  freehandSamplePx: 16,
  straightSnapPx: 10,
};

/**
 * A finger.
 *
 * `hitPx` is the fingertip contact patch (24 CSS px, above). `snapPx` keeps
 * its proportional lead over `hitPx` so that snapping still reaches further
 * than plain hit-testing, which is the whole point of having both. `dragPx`
 * rises to 10 because finger-down jitter routinely exceeds 4px, at which
 * every tap registers as a drag and nothing can be selected.
 *
 * `freehandSamplePx` deliberately does NOT change. Sample spacing decides how
 * faithfully a drawn curve follows the gesture, which is a question about the
 * geometry someone wants, not about how precisely they can point.
 */
export const COARSE_POINTER_TUNING: InputTuning = {
  hitPx: 24,
  snapPx: 32,
  dragPx: 10,
  freehandSamplePx: 16,
  straightSnapPx: 20,
};

export function inputTuningFor(coarsePointer: boolean): InputTuning {
  return coarsePointer ? COARSE_POINTER_TUNING : FINE_POINTER_TUNING;
}
