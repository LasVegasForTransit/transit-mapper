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
}

function renderWorkbench(environment: boolean | MediaEnvironment): string {
  const { narrow, coarse } =
    typeof environment === 'boolean' ? { narrow: environment, coarse: environment } : environment;
  vi.stubGlobal('window', {
    matchMedia: matchMedia((query) => {
      if (query.includes('max-width')) return narrow;
      if (query.includes('pointer: coarse')) return coarse;
      if (query.includes('hover: none')) return coarse;
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
    expect(markup).toContain('grid-column:2 / 3;grid-row:2');
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

  it('a wide coarse-pointer device keeps the docked layout', () => {
    // A touchscreen laptop or a tablet in landscape. Layout follows width
    // alone; the coarse pointer changes hit tolerance on the map (see
    // editor/input-tuning.ts) and nothing about which tree mounts.
    const markup = renderWorkbench({ narrow: false, coarse: true });

    expect(occurrences(markup, 'data-slot="desktop-sim"')).toBe(1);
    expect(occurrences(markup, 'data-slot="mobile-sim"')).toBe(0);
    expect(markup).not.toContain('aria-label="Expand panel"');
  });

  it('a narrow fine-pointer window takes the sheet layout', () => {
    // A small desktop window with a mouse: the mirror of the case above.
    const markup = renderWorkbench({ narrow: true, coarse: false });

    expect(occurrences(markup, 'data-slot="mobile-sim"')).toBe(1);
    expect(occurrences(markup, 'data-slot="desktop-sim"')).toBe(0);
    expect(occurrences(markup, 'aria-label="Expand panel"')).toBe(1);
  });
});
