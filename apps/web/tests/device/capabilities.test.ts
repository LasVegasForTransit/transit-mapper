import { afterEach, describe, expect, it, vi } from 'vitest';
import { compactLayoutSnapshot, hoverCapableSnapshot } from '../../src/device/capabilities';

interface MediaEnvironment {
  narrow?: boolean;
  /** Whether the viewport is short — a phone in landscape is wide AND short. */
  short?: boolean;
  coarse?: boolean;
  /** Whether the device reports `(hover: none)`. */
  noHover?: boolean;
}

/**
 * Evaluates one clause. Deliberately not a substring test over the whole
 * query: the layout query is a comma list carrying both `max-width` and
 * `max-height`, and a helper that stops at the first `includes('max-width')`
 * would answer for the width clause and never see the height one — which
 * would make the landscape-phone case below silently untestable.
 */
function clauseMatches(clause: string, environment: MediaEnvironment): boolean {
  if (clause.includes('max-width')) return environment.narrow === true;
  if (clause.includes('max-height')) return environment.short === true;
  if (clause.includes('pointer: coarse')) return environment.coarse === true;
  if (clause.includes('hover: none')) return environment.noHover === true;
  return false;
}

function installMedia(environment: MediaEnvironment) {
  vi.stubGlobal('window', {
    matchMedia(query: string) {
      // A comma list is OR, the way a real browser reads it.
      const matches = query.split(',').some((clause) => clauseMatches(clause, environment));
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
    installMedia({ narrow: true, short: false, coarse: false, noHover: false });

    expect(compactLayoutSnapshot()).toBe(true);
    expect(hoverCapableSnapshot()).toBe(true);
  });

  it('calls a phone in landscape compact, though it is not narrow', () => {
    // 844x390. Width alone said "desktop" and handed it a 280px workspace
    // card taking a third of the width and 96% of the height, with the tool
    // dock painted over it. Height is the half that catches this.
    installMedia({ narrow: false, short: true, coarse: true, noHover: true });

    expect(compactLayoutSnapshot()).toBe(true);
  });

  it('leaves a wide, tall window on the docked layout', () => {
    installMedia({ narrow: false, short: false, coarse: false, noHover: false });

    expect(compactLayoutSnapshot()).toBe(false);
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
