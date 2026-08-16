// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { mediaQuery } from '../../src/device/media-query-store';

describe('the non-React media query store', () => {
  it('shares one browser listener store for repeated pure reads', () => {
    const changeListeners = new Set<() => void>();
    const matchMedia = vi.fn(() => ({
      matches: true,
      addEventListener: (_type: string, listener: () => void) => changeListeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) =>
        changeListeners.delete(listener),
      addListener: (listener: () => void) => changeListeners.add(listener),
      removeListener: (listener: () => void) => changeListeners.delete(listener),
    }));
    vi.stubGlobal('matchMedia', matchMedia);

    const first = mediaQuery('(prefers-color-scheme: dark)');
    const second = mediaQuery('(prefers-color-scheme: dark)');
    const listener = vi.fn();

    expect(first).toBe(second);
    expect(first.snapshot()).toBe(true);
    const unsubscribe = first.subscribe(listener);
    expect(matchMedia).toHaveBeenCalledTimes(2);
    [...changeListeners].forEach((notify) => notify());
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });
});
