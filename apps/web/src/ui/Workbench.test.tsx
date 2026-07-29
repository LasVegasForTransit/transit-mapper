import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual, useLayoutEffect: actual.useEffect };
});

import { EditorProvider } from '../editor/EditorProvider';
import { UiProvider } from './UiProvider';
import { Workbench } from './Workbench';

function matchMedia(matches: boolean): typeof window.matchMedia {
  return (query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  });
}

function renderWorkbench(mobile: boolean): string {
  vi.stubGlobal('window', { matchMedia: matchMedia(mobile) });
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
    expect(occurrences(markup, 'data-slot="install"')).toBe(1);
    expect(markup.indexOf('data-slot="install"')).toBeGreaterThan(
      markup.indexOf('data-slot="mobile-sim"'),
    );
    expect(occurrences(markup, 'aria-label="Expand panel"')).toBe(1);
    expect(markup).toContain('aria-expanded="false"');
  });
});
