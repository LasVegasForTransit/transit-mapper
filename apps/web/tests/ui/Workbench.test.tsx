import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual, useLayoutEffect: actual.useEffect };
});

import { EditorProvider } from '../../src/editor/EditorProvider';
import { UiProvider } from '../../src/ui/UiProvider';
import { ViewProvider } from '../../src/ui/ViewProvider';
import { detentFor, step, Workbench, type SupplementalKind } from '../../src/ui/Workbench';

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
  /** Whether the viewport is short. A phone in landscape is wide AND short. */
  short?: boolean;
  coarse: boolean;
  /**
   * Whether the top row is wide enough for the segmented view switch and the
   * full simulation ladder (ROOMY_TOP_ROW_QUERY). A separate axis from
   * `narrow`: a 900px window is not narrow and is not roomy either. Defaults
   * to the opposite of `narrow`, which is what a plain wide/narrow case
   * means.
   */
  roomy?: boolean;
  /** Whether the device reports `(hover: none)`. Independent of `coarse`. */
  hoverless?: boolean;
}

interface WorkbenchOverrides {
  supplemental?: SupplementalKind;
}

function renderWorkbench(
  environment: boolean | MediaEnvironment,
  overrides: WorkbenchOverrides = {},
): string {
  const { narrow, short, coarse, roomy, hoverless } =
    typeof environment === 'boolean'
      ? {
          narrow: environment,
          short: environment,
          coarse: environment,
          roomy: !environment,
          hoverless: environment,
        }
      : {
          short: environment.narrow,
          roomy: !environment.narrow,
          hoverless: environment.coarse,
          ...environment,
        };
  vi.stubGlobal('window', {
    matchMedia: matchMedia((query) =>
      // Split first: the layout query is a comma list carrying `max-width` AND
      // `max-height`, and a chain that tests the whole string would answer for
      // whichever clause it named first and never reach the other one.
      query.split(',').some((clause) => {
        if (clause.includes('max-width')) return narrow;
        if (clause.includes('max-height')) return short;
        if (clause.includes('min-width')) return roomy;
        if (clause.includes('pointer: coarse')) return coarse;
        // Hover is answered independently of pointer precision on purpose. A
        // touchscreen laptop reports a coarse pointer AND hover, and hardcoding
        // them equal here would hide exactly the conflation the capability
        // module exists to prevent the moment Workbench reads hover.
        if (clause.includes('hover: none')) return hoverless;
        return false;
      }),
    ),
  });
  const slot = (name: string) => <span data-slot={name}>{name}</span>;
  return renderToStaticMarkup(
    <EditorProvider>
      <ViewProvider>
        <UiProvider>
          <Workbench
            brand={slot('brand')}
            menuPanel={slot('menu')}
            supplementalPanel={slot('supplemental')}
            supplemental={overrides.supplemental ?? 'none'}
            primaryToolbar={slot('primary')}
            viewSwitcher={slot('view')}
            viewSwitcherCompact={slot('view-compact')}
            simControls={slot('desktop-sim')}
            simControlsCompact={slot('mobile-sim')}
            modeToolbar={slot('mode')}
            installBanner={slot('install')}
          />
        </UiProvider>
      </ViewProvider>
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
    expect(occurrences(markup, 'data-slot="view-compact"')).toBe(0);
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

  it('keeps the sidebar toggle in the document header without a second outline heading', () => {
    const markup = renderWorkbench(false);
    const brandRow = markup.slice(markup.indexOf('class="panel-brand-row"'));

    expect(brandRow.indexOf('aria-label="Hide outline"')).toBeGreaterThan(-1);
    expect(markup).not.toContain('class="panel-head"');
    expect(markup).not.toContain('>Network outline<');
  });

  it('mobile mounts each subscribed slot once and exposes one sheet control', () => {
    const markup = renderWorkbench(true);

    expect(occurrences(markup, 'data-slot="brand"')).toBe(1);
    expect(occurrences(markup, 'data-slot="menu"')).toBe(1);
    expect(occurrences(markup, 'data-slot="primary"')).toBe(1);
    expect(occurrences(markup, 'data-slot="view"')).toBe(0);
    expect(occurrences(markup, 'data-slot="view-compact"')).toBe(1);
    expect(occurrences(markup, 'data-slot="desktop-sim"')).toBe(0);
    expect(occurrences(markup, 'data-slot="mobile-sim"')).toBe(1);
    expect(occurrences(markup, 'data-slot="install"')).toBe(0);
    expect(occurrences(markup, 'aria-label="Expand panel"')).toBe(1);
    expect(markup).toContain('aria-expanded="false"');
  });

  it('shows the details panel whatever put it there', () => {
    for (const supplemental of ['tool-draft', 'selection'] as const) {
      const markup = renderWorkbench(true, { supplemental });
      expect(markup, supplemental).toContain('data-slot="supplemental"');
      expect(markup, supplemental).not.toContain('data-slot="menu"');
    }
  });

  it('keeps the tool rail inside the workbench, not over the map', () => {
    // The rail used to float over the map and fade out whenever the sheet
    // expanded — which arming a tool does, because a tool has options to
    // show. That took every tool, both zoom buttons and the attribution off
    // the screen at once. Inside the workbench it cannot be covered by the
    // panel above it: it comes after that panel rather than under it.
    const markup = renderWorkbench(true);
    const workbench = markup.slice(markup.indexOf('compact-workbench'));

    expect(workbench).toContain('data-slot="mode"');
    expect(workbench.indexOf('workbench-rail')).toBeGreaterThan(
      workbench.indexOf('workbench-panel'),
    );
    // The simulation moved in here with it, off the top bar.
    expect(workbench).toContain('data-slot="mobile-sim"');
    // View state belongs with the other canvas controls, leaving the anchored
    // identity row enough room to show the system name.
    expect(workbench.indexOf('data-slot="view-compact"')).toBeGreaterThan(
      workbench.indexOf('workbench-rail'),
    );
    const topBar = markup.slice(
      markup.indexOf('class="compact-top-bar'),
      markup.indexOf('class="compact-workbench'),
    );
    expect(topBar).not.toContain('data-slot="view-compact"');
    // And nothing in the compact tree still fades the dock away.
    expect(markup).not.toContain('opacity-0');
  });

  it('keeps the docked layout but narrows the top row between the two widths', () => {
    // 768-1088: too wide for the sheet, too narrow for three view labels
    // beside a full simulation ladder. This is the band where the segmented
    // switch used to overflow its bar in silence — "Diagram" rendered 0 of
    // its 63px and the clock 0 of its 100px, with no scrollbar to say so.
    const markup = renderWorkbench({ narrow: false, roomy: false, coarse: false });

    // Still the docked tree: no sheet.
    expect(markup).not.toContain('aria-label="Expand panel"');
    // But the narrow rendering of both bars.
    expect(occurrences(markup, 'data-slot="view"')).toBe(0);
    expect(occurrences(markup, 'data-slot="view-compact"')).toBe(1);
    expect(occurrences(markup, 'data-slot="desktop-sim"')).toBe(0);
    expect(occurrences(markup, 'data-slot="mobile-sim"')).toBe(1);
  });

  it('mounts by viewport size alone, whatever the pointer', () => {
    // A touchscreen laptop: wide, tall and coarse. Layout follows the
    // viewport; the coarse pointer changes hit tolerance on the map (see
    // editor/input-tuning.ts) and nothing about which tree mounts. That the
    // two axes ANSWER independently is device/capabilities' own test; this is
    // only that Workbench reads the size one.
    const markup = renderWorkbench({ narrow: false, short: false, coarse: true });

    expect(occurrences(markup, 'data-slot="desktop-sim"')).toBe(1);
    expect(markup).not.toContain('aria-label="Expand panel"');
  });

  it('gives a phone in landscape the sheet, though it is not narrow', () => {
    // 844x390. On width alone this took the desktop branch and got a 280px
    // workspace card holding a third of the width and 96% of the height.
    const markup = renderWorkbench({ narrow: false, short: true, coarse: true });

    expect(occurrences(markup, 'data-slot="mobile-sim"')).toBe(1);
    expect(occurrences(markup, 'data-slot="desktop-sim"')).toBe(0);
    expect(occurrences(markup, 'aria-label="Expand panel"')).toBe(1);
  });
});

/**
 * How far the workbench opens is a plain function of what it is showing, so
 * it is tested as one — the same shape editor/pointerIntent.ts and
 * Inspector's supplementalContentFor use, and testable without a renderer
 * (effects do not run in a static render, so the component test above can
 * only ever observe the initial stop).
 */
describe('how far the workbench opens', () => {
  it('leaves the map alone for an armed tool', () => {
    // You armed a tool in order to work ON the map. Its options name
    // themselves in the handle and wait there. One boolean used to serve
    // this and a selection alike, jumping straight to 62dvh: at 390x844
    // that left 155px of map — 18% — with the line you were about to draw
    // underneath the panel.
    expect(detentFor('tool-draft')).toBe('closed');
  });

  it('opens halfway for a selection, so the object stays visible', () => {
    expect(detentFor('selection')).toBe('half');
  });

  it('does not move on its own when there is nothing to show', () => {
    // Null, not 'closed': clearing a selection must not slam a workbench the
    // user opened deliberately.
    expect(detentFor('none')).toBeNull();
  });
});

describe('dragging the workbench handle', () => {
  it('moves one stop per drag, in the direction of the drag', () => {
    expect(step('closed', 1)).toBe('half');
    expect(step('half', 1)).toBe('full');
    expect(step('full', -1)).toBe('half');
    expect(step('half', -1)).toBe('closed');
  });

  it('clamps at both ends rather than wrapping', () => {
    // Wrapping would send a downward drag at the bottom stop straight to
    // full-screen, which is the opposite of what the hand just asked for.
    expect(step('closed', -1)).toBe('closed');
    expect(step('full', 1)).toBe('full');
  });
});
