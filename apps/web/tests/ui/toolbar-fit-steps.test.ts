import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TOOLBAR_FITS } from '../../src/ui/Workbench';

/**
 * The step ladder lives in two places by necessity: Workbench names the steps
 * and measures them, app.css decides what each one gives up. Nothing else ties
 * the two together — WorkbenchToolbarFit.test.tsx stubs the widths, because
 * jsdom has no layout to measure — so a step renamed or dropped on one side
 * goes unnoticed on the other. A `[data-fit]` value with no rule behind it
 * simply measures the same width as the step above it, and the bar silently
 * stops stepping down.
 */
const CSS = readFileSync(fileURLToPath(new URL('../../src/ui/app.css', import.meta.url)), 'utf8');

const STEPS_IN_CSS = new Set(
  [...CSS.matchAll(/\.actions-full\[data-fit='([a-z]+)'\]/g)].map((match) => match[1]),
);

describe('the action bar step ladder', () => {
  it('starts at the step that gives up nothing', () => {
    expect(TOOLBAR_FITS[0]).toBe('full');
    expect(STEPS_IN_CSS.has('full')).toBe(false);
  });

  it('gives every step below the first something to hide in app.css', () => {
    for (const step of TOOLBAR_FITS.slice(1)) {
      expect(STEPS_IN_CSS, `no .actions-full[data-fit='${step}'] rule`).toContain(step);
    }
  });

  it('measures every step app.css defines', () => {
    for (const step of STEPS_IN_CSS) {
      expect(TOOLBAR_FITS, `app.css styles a step Workbench never picks`).toContain(step);
    }
  });

  it('ends at the step that hands the secondary actions to the overflow menu', () => {
    const last = TOOLBAR_FITS[TOOLBAR_FITS.length - 1];
    expect(CSS).toContain(`.actions-full[data-fit='${last}'] .act-secondary`);
    expect(CSS).toContain(`.actions-full[data-fit='${last}'] .act-overflow`);
  });

  /**
   * The ladder's real invariant, and the one that actually broke: hiding a
   * button is only safe while the ⋯ menu is showing, because that menu is the
   * only other place `.act-tertiary` and `.act-secondary` live. `tertiary`
   * used to hide the two help actions while the menu was still `display:none`
   * — Settings has exactly one call site and it is inside that menu, so it
   * was unreachable at 1280x800. Dropping label TEXT (`.btn-label`) does not
   * count: the buttons themselves stay on the bar.
   */
  it('shows the overflow menu at every step that hides an action', () => {
    const hidesAnAction = (step: string) =>
      CSS.includes(`.actions-full[data-fit='${step}'] .act-tertiary`) ||
      CSS.includes(`.actions-full[data-fit='${step}'] .act-secondary`);

    for (const step of TOOLBAR_FITS) {
      if (!hidesAnAction(step)) continue;
      expect(
        CSS,
        `[data-fit='${step}'] hides an action but never reveals .act-overflow, ` +
          `so whatever it hid has no remaining path`,
      ).toContain(`.actions-full[data-fit='${step}'] .act-overflow`);
    }
  });
});
