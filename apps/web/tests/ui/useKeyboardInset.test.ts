import { describe, expect, it } from 'vitest';
import { keyboardInsetFrom } from '../../src/ui/useKeyboardInset';

// A phone keyboard does not resize the layout viewport, so a bottom-anchored
// surface stays where it was and the keyboard opens on top of it. These are
// the numbers a 390x844 phone actually reports.
describe('keyboard inset', () => {
  it('reports nothing while no keyboard is open', () => {
    expect(keyboardInsetFrom(844, 844, 0)).toBe(0);
  });

  it('reports the covered height once a keyboard opens', () => {
    expect(keyboardInsetFrom(844, 508, 0)).toBe(336);
  });

  it('ignores a retracting URL bar, which is not a keyboard', () => {
    // The regression this guards: browser chrome changes the visual viewport
    // by roughly 40-60px and looks exactly like a very short keyboard.
    // Reacting to it lifts the sheet off the bottom edge whenever the page
    // scrolls.
    expect(keyboardInsetFrom(844, 800, 0)).toBe(0);
  });

  it('discounts how far the visual viewport is scrolled within the layout one', () => {
    // Both a keyboard and a scroll shrink the visible remainder; only the
    // keyboard covers the bottom edge. Counting the scroll too would
    // over-lift the sheet by exactly the scroll distance.
    expect(keyboardInsetFrom(844, 508, 100)).toBe(236);
  });

  it('never reports a negative inset', () => {
    // The visual viewport can exceed the layout one mid-pinch.
    expect(keyboardInsetFrom(844, 900, 0)).toBe(0);
  });
});
