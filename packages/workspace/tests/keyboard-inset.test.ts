import { describe, expect, it } from 'vitest';
import { keyboardInsetFrom } from '../src/keyboard-inset';

describe('keyboard inset', () => {
  it('reports nothing while no keyboard is open', () => {
    expect(keyboardInsetFrom(844, 844, 0)).toBe(0);
  });

  it('reports the covered height once a keyboard opens', () => {
    expect(keyboardInsetFrom(844, 508, 0)).toBe(336);
  });

  it('ignores a retracting URL bar', () => {
    expect(keyboardInsetFrom(844, 800, 0)).toBe(0);
  });

  it('discounts visual viewport scrolling', () => {
    expect(keyboardInsetFrom(844, 508, 100)).toBe(236);
  });

  it('never reports a negative inset', () => {
    expect(keyboardInsetFrom(844, 900, 0)).toBe(0);
  });
});
