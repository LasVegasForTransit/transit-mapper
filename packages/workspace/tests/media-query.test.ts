// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { compactLayoutSnapshot } from '../src/media-query';
import { mediaQuery } from '../src/media-query-store';

afterEach(() => vi.unstubAllGlobals());

describe('the workspace media-query store', () => {
  it('shares one store for repeated reads of the same query', () => {
    const listeners = new Set<() => void>();
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
      })),
    );

    const first = mediaQuery('(prefers-color-scheme: dark)');
    const second = mediaQuery('(prefers-color-scheme: dark)');

    expect(first).toBe(second);
    expect(first.snapshot()).toBe(true);
  });

  it('calls a wide but short viewport compact', () => {
    vi.stubGlobal('window', {
      matchMedia: (query: string) => ({
        matches: query.split(',').some((clause) => clause.includes('max-height')),
      }),
    });

    expect(compactLayoutSnapshot()).toBe(true);
  });
});
