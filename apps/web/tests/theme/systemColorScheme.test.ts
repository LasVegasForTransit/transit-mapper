import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getSystemColorScheme,
  subscribeSystemColorScheme,
} from '../../src/theme/systemColorScheme';

interface MatchMediaHarness {
  media: MediaQueryList;
  emit: (matches: boolean) => void;
  add: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

function matchMediaHarness(initial: boolean): MatchMediaHarness {
  let matches = initial;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const add = vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
    listeners.add(listener);
  });
  const remove = vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
    listeners.delete(listener);
  });
  const media = {
    get matches() {
      return matches;
    },
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: add,
    removeEventListener: remove,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList;
  return {
    media,
    add,
    remove,
    emit(next) {
      matches = next;
      for (const listener of listeners) {
        listener({ matches: next, media: media.media } as MediaQueryListEvent);
      }
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the system color scheme', () => {
  it('falls back to light without a browser media-query API', () => {
    vi.stubGlobal('window', {});

    expect(getSystemColorScheme()).toBe('light');
  });

  it('reads the current operating-system scheme', () => {
    const harness = matchMediaHarness(true);
    vi.stubGlobal('window', { matchMedia: () => harness.media });

    expect(getSystemColorScheme()).toBe('dark');
  });

  it('notifies subscribers when the operating-system scheme changes', () => {
    const harness = matchMediaHarness(false);
    vi.stubGlobal('window', { matchMedia: () => harness.media });
    const listener = vi.fn();

    const unsubscribe = subscribeSystemColorScheme(listener);
    harness.emit(true);

    expect(listener).toHaveBeenCalledOnce();
    expect(getSystemColorScheme()).toBe('dark');
    unsubscribe();
    expect(harness.remove).toHaveBeenCalledOnce();
    harness.emit(false);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('does not read or write browser storage', () => {
    const harness = matchMediaHarness(false);
    vi.stubGlobal('window', { matchMedia: () => harness.media });
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => {
        throw new Error('theme must not be persisted');
      }),
      setItem: vi.fn(() => {
        throw new Error('theme must not be persisted');
      }),
    });

    expect(getSystemColorScheme()).toBe('light');
    expect(() => subscribeSystemColorScheme(() => {})()).not.toThrow();
  });
});
