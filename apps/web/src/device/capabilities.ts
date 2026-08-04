import { mediaQuery, useMediaQuery } from './media-query';

/**
 * What this app needs to know about the device it is running on.
 *
 * Three independent questions, deliberately never bundled into one answer. A
 * device can be wide and coarse (a touchscreen laptop, a tablet in landscape)
 * or narrow and fine (a small window with a mouse), so deciding hit tolerance
 * from viewport width gives a finger the precision budget of a mouse, and
 * deciding layout from pointer type puts a phone's docked cards on a tablet.
 *
 * Each is exported on its own rather than as a record. Returning all three
 * together is the same bundling one level up, and it is what made reaching for
 * a convenient-but-wrong axis easy: the Select tool's modifier chips were once
 * gated on hover, which hid them from a finger on every touchscreen laptop.
 *
 * Only ask one of these where the DIFFERENCE IS BEHAVIOURAL. Anything that
 * merely looks different belongs in a CSS media query, where it sits beside
 * the rules it coordinates with and cannot drift from them — see
 * `.pointer-badge` and `.chip-key` in ui/app.css.
 */

/** Viewport width. Layout's question, and only layout's. */
const COMPACT_LAYOUT_QUERY = '(max-width: 767px)';

/**
 * The primary pointer cannot be precise. Decides hit tolerance — see
 * editor/input-tuning.ts.
 */
const COARSE_POINTER_QUERY = '(pointer: coarse)';

/**
 * Asked as the negative and inverted, so that every capability here defaults
 * to its desktop answer when the query cannot be evaluated. A browser too old
 * for `matchMedia` matches nothing; under `(hover: hover)` that would read as
 * "cannot hover" and hand a 2013 desktop browser the touch affordances.
 */
const NO_HOVER_QUERY = '(hover: none)';

export function useCompactLayout(): boolean {
  return useMediaQuery(COMPACT_LAYOUT_QUERY);
}

export function useCoarsePointer(): boolean {
  return useMediaQuery(COARSE_POINTER_QUERY);
}

export function useHoverCapable(): boolean {
  return !useMediaQuery(NO_HOVER_QUERY);
}

/**
 * The same answers outside React, for callers that run before or beside the
 * component tree. Snapshots, not subscriptions: a caller re-reads on an event
 * it already handles rather than having an answer change under a gesture in
 * progress.
 */
export function compactLayoutSnapshot(): boolean {
  return mediaQuery(COMPACT_LAYOUT_QUERY).snapshot();
}

export function hoverCapableSnapshot(): boolean {
  return !mediaQuery(NO_HOVER_QUERY).snapshot();
}
