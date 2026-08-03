import { afterEach, describe, expect, it, vi } from 'vitest';
import { deviceCapabilitiesSnapshot } from '../../src/ui/device-capabilities';

interface FakeMediaQueryList {
  matches: boolean;
  media: string;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}

interface MediaEnvironment {
  narrow?: boolean;
  coarse?: boolean;
  /** Whether the device reports `(hover: none)`. */
  noHover?: boolean;
}

/** Records every query asked, so a test can assert which ones were consulted. */
function installMedia(environment: MediaEnvironment): { queries: string[] } {
  const queries: string[] = [];
  vi.stubGlobal('window', {
    matchMedia(query: string): FakeMediaQueryList {
      queries.push(query);
      const matches = query.includes('max-width')
        ? environment.narrow === true
        : query.includes('pointer: coarse')
          ? environment.coarse === true
          : query.includes('hover: none')
            ? environment.noHover === true
            : false;
      return {
        matches,
        media: query,
        addEventListener() {},
        removeEventListener() {},
      };
    },
  });
  return { queries };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('device capabilities', () => {
  it('reports width and pointer as independent answers', () => {
    installMedia({ narrow: false, coarse: true, noHover: true });

    // The case the old single-boolean model got wrong: a touchscreen laptop
    // is wide enough for the docked layout and still needs finger tolerances.
    expect(deviceCapabilitiesSnapshot()).toEqual({
      compactLayout: false,
      coarsePointer: true,
      hoverCapable: false,
    });
  });

  it('reports a narrow window with a mouse as compact but not coarse', () => {
    installMedia({ narrow: true, coarse: false, noHover: false });

    expect(deviceCapabilitiesSnapshot()).toEqual({
      compactLayout: true,
      coarsePointer: false,
      hoverCapable: true,
    });
  });

  it('asks a width query, a pointer query, and a hover query', () => {
    const { queries } = installMedia({});

    deviceCapabilitiesSnapshot();

    expect(queries.some((q) => q.includes('max-width'))).toBe(true);
    expect(queries.some((q) => q.includes('pointer: coarse'))).toBe(true);
    expect(queries.some((q) => q.includes('hover: none'))).toBe(true);
  });

  it('treats a browser without matchMedia as wide, fine, and hover-capable', () => {
    // Every capability defaults to its desktop answer when nothing can be
    // evaluated. This is why hover is asked as `hover: none` and negated:
    // under `hover: hover` this case would report "cannot hover" and hand an
    // old desktop browser the touch affordances.
    vi.stubGlobal('window', {});

    expect(deviceCapabilitiesSnapshot()).toEqual({
      compactLayout: false,
      coarsePointer: false,
      hoverCapable: true,
    });
  });
});
