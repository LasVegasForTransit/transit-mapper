import { afterEach, describe, expect, it, vi } from 'vitest';
import { compactLayoutSnapshot, hoverCapableSnapshot } from '../../src/device/capabilities';

interface MediaEnvironment {
  narrow?: boolean;
  coarse?: boolean;
  /** Whether the device reports `(hover: none)`. */
  noHover?: boolean;
}

function installMedia(environment: MediaEnvironment) {
  vi.stubGlobal('window', {
    matchMedia(query: string) {
      const matches = query.includes('max-width')
        ? environment.narrow === true
        : query.includes('pointer: coarse')
          ? environment.coarse === true
          : query.includes('hover: none')
            ? environment.noHover === true
            : false;
      return { matches, media: query, addEventListener() {}, removeEventListener() {} };
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('device capabilities', () => {
  it('answers width and hover independently', () => {
    // The case a single boolean gets wrong: a touchscreen laptop is wide
    // enough for the docked layout and cannot hover.
    installMedia({ narrow: false, coarse: true, noHover: true });

    expect(compactLayoutSnapshot()).toBe(false);
    expect(hoverCapableSnapshot()).toBe(false);
  });

  it('answers a narrow window with a mouse the other way round', () => {
    installMedia({ narrow: true, coarse: false, noHover: false });

    expect(compactLayoutSnapshot()).toBe(true);
    expect(hoverCapableSnapshot()).toBe(true);
  });

  it('treats a browser without matchMedia as wide and hover-capable', () => {
    // Every capability defaults to its desktop answer when nothing can be
    // evaluated. This is why hover is asked as `(hover: none)` and inverted:
    // under `(hover: hover)` this case would report "cannot hover" and hand an
    // old desktop browser the touch affordances.
    vi.stubGlobal('window', {});

    expect(compactLayoutSnapshot()).toBe(false);
    expect(hoverCapableSnapshot()).toBe(true);
  });
});
