import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual, useLayoutEffect: actual.useEffect };
});

import { EditorProvider } from '../../src/editor/EditorProvider';
import { UiProvider } from '../../src/ui/UiProvider';
import { Workbench } from '../../src/ui/Workbench';

/** Answers each query independently, so width and pointer can disagree. */
function matchMedia(matches: (query: string) => boolean): typeof window.matchMedia {
  return (query: string) => ({
    matches: matches(query),
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  });
}

interface MediaEnvironment {
  narrow: boolean;
  coarse: boolean;
  /** Whether the device reports `(hover: none)`. Independent of `coarse`. */
  hoverless?: boolean;
}

function renderWorkbench(environment: boolean | MediaEnvironment): string {
  const { narrow, coarse, hoverless } =
    typeof environment === 'boolean'
      ? { narrow: environment, coarse: environment, hoverless: environment }
      : { hoverless: environment.coarse, ...environment };
  vi.stubGlobal('window', {
    matchMedia: matchMedia((query) => {
      if (query.includes('max-width')) return narrow;
      if (query.includes('pointer: coarse')) return coarse;
      // Hover is answered independently of pointer precision on purpose. A
      // touchscreen laptop reports a coarse pointer AND hover, and hardcoding
      // them equal here would hide exactly the conflation the capability
      // module exists to prevent the moment Workbench reads hover.
      if (query.includes('hover: none')) return hoverless;
      return false;
    }),
  });
  const slot = (name: string) => <span data-slot={name}>{name}</span>;
  return renderToStaticMarkup(
    <EditorProvider>
      <UiProvider>
        <Workbench
          brand={slot('brand')}
          menuPanel={slot('menu')}
          supplementalPanel={slot('supplemental')}
          hasSupplementalContent={false}
          primaryToolbar={slot('primary')}
          viewSwitcher={slot('view')}
          simControls={slot('desktop-sim')}
          simControlsCompact={slot('mobile-sim')}
          modeToolbar={slot('mode')}
          installBanner={slot('install')}
        />
      </UiProvider>
    </EditorProvider>,
  );
}

function occurrences(markup: string, value: string): number {
  return markup.split(value).length - 1;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Workbench responsive mounting', () => {
  it('desktop mounts each subscribed slot once and excludes the mobile sheet', () => {
    const markup = renderWorkbench(false);

    expect(occurrences(markup, 'data-slot="brand"')).toBe(1);
    expect(occurrences(markup, 'data-slot="menu"')).toBe(1);
    expect(occurrences(markup, 'data-slot="primary"')).toBe(1);
    expect(occurrences(markup, 'data-slot="view"')).toBe(1);
    expect(occurrences(markup, 'data-slot="desktop-sim"')).toBe(1);
    expect(occurrences(markup, 'data-slot="mobile-sim"')).toBe(0);
    expect(occurrences(markup, 'data-slot="install"')).toBe(1);
    // Its own grid row below the top chrome, aligned to the same right edge
    // and width as the Inspector rather than floating over the canvas.
    expect(markup).toContain('grid-column:1 / -1;grid-row:2;width:var(--panel-w)');
    expect(markup).toContain('justify-self-end');
    expect(markup.indexOf('data-slot="install"')).toBeGreaterThan(
      markup.indexOf('data-slot="desktop-sim"'),
    );
    expect(markup).not.toContain('aria-label="Expand panel"');
  });

  it('mobile mounts each subscribed slot once and exposes one sheet control', () => {
    const markup = renderWorkbench(true);

    expect(occurrences(markup, 'data-slot="brand"')).toBe(1);
    expect(occurrences(markup, 'data-slot="menu"')).toBe(1);
    expect(occurrences(markup, 'data-slot="primary"')).toBe(1);
    expect(occurrences(markup, 'data-slot="view"')).toBe(1);
    expect(occurrences(markup, 'data-slot="desktop-sim"')).toBe(0);
    expect(occurrences(markup, 'data-slot="mobile-sim"')).toBe(1);
    expect(occurrences(markup, 'data-slot="install"')).toBe(0);
    expect(occurrences(markup, 'aria-label="Expand panel"')).toBe(1);
    expect(markup).toContain('aria-expanded="false"');
  });

  it('mounts by width alone, whatever the pointer', () => {
    // A touchscreen laptop: wide and coarse. Layout follows width; the coarse
    // pointer changes hit tolerance on the map (see editor/input-tuning.ts)
    // and nothing about which tree mounts. That the two axes ANSWER
    // independently is device/capabilities' own test; this is only that
    // Workbench reads the width one.
    const markup = renderWorkbench({ narrow: false, coarse: true });

    expect(occurrences(markup, 'data-slot="desktop-sim"')).toBe(1);
    expect(markup).not.toContain('aria-label="Expand panel"');
  });
});
