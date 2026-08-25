import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Workbench, type WorkbenchDetent } from '../src/index';
import { matchMediaFor, type MediaEnvironment } from './support/media-environment.test';

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual, useLayoutEffect: actual.useEffect };
});

interface WorkbenchOverrides {
  hasSupplementalContent?: boolean;
  initialSupplementalDetent?: WorkbenchDetent | null;
  chromeHidden?: boolean;
}

function renderWorkbench(
  environment: MediaEnvironment,
  overrides: WorkbenchOverrides = {},
): string {
  vi.stubGlobal('window', { matchMedia: matchMediaFor(environment) });
  const slot = (name: string) => <span data-slot={name}>{name}</span>;
  return renderToStaticMarkup(
    <Workbench
      slots={{
        brand: slot('brand'),
        primaryActions: slot('primary-actions'),
        representationControls: slot('representation-controls'),
        compactRepresentationControls: slot('compact-representation-controls'),
        simulationControls: slot('simulation-controls'),
        compactSimulationControls: slot('compact-simulation-controls'),
        mainPanel: slot('main-panel'),
        supplementalPanel: slot('supplemental-panel'),
        toolDock: slot('tool-dock'),
        importStatus: slot('import-status'),
      }}
      state={{
        representationLabel: 'Network',
        hasSupplementalContent: overrides.hasSupplementalContent ?? false,
        initialSupplementalDetent: overrides.initialSupplementalDetent ?? null,
        chromeHidden: overrides.chromeHidden ?? false,
        contentStatus: 'ready',
      }}
      actions={{ onToggleInterface: () => {}, onDismissSupplemental: () => {} }}
    />,
  );
}

function occurrences(markup: string, value: string): number {
  return markup.split(value).length - 1;
}

afterEach(() => vi.unstubAllGlobals());

describe('Workbench responsive mounting', () => {
  it('mounts each desktop slot once without mounting the compact sheet', () => {
    const markup = renderWorkbench({ narrow: false });

    expect(occurrences(markup, 'data-slot="brand"')).toBe(1);
    expect(occurrences(markup, 'data-slot="main-panel"')).toBe(1);
    expect(occurrences(markup, 'data-slot="primary-actions"')).toBe(1);
    expect(occurrences(markup, 'data-slot="representation-controls"')).toBe(1);
    expect(occurrences(markup, 'data-slot="compact-representation-controls"')).toBe(0);
    expect(occurrences(markup, 'data-slot="simulation-controls"')).toBe(1);
    expect(occurrences(markup, 'data-slot="compact-simulation-controls"')).toBe(0);
    expect(occurrences(markup, 'data-slot="tool-dock"')).toBe(1);
    expect(markup).not.toContain('aria-label="Expand panel"');
  });

  it('mounts each compact slot once and keeps the tool dock inside the sheet', () => {
    const markup = renderWorkbench({ narrow: true });
    const sheet = markup.slice(markup.indexOf('compact-workbench'));

    expect(occurrences(markup, 'data-slot="brand"')).toBe(1);
    expect(occurrences(markup, 'data-slot="main-panel"')).toBe(1);
    expect(occurrences(markup, 'data-slot="primary-actions"')).toBe(1);
    expect(occurrences(markup, 'data-slot="representation-controls"')).toBe(0);
    expect(occurrences(markup, 'data-slot="compact-representation-controls"')).toBe(1);
    expect(occurrences(markup, 'data-slot="simulation-controls"')).toBe(0);
    expect(occurrences(markup, 'data-slot="compact-simulation-controls"')).toBe(1);
    expect(occurrences(markup, 'data-slot="tool-dock"')).toBe(1);
    expect(sheet.indexOf('data-slot="tool-dock"')).toBeGreaterThan(
      sheet.indexOf('workbench-panel'),
    );
    expect(occurrences(markup, 'aria-label="Expand panel"')).toBe(1);
  });

  it('uses compact controls in the docked layout when the top row is tight', () => {
    const markup = renderWorkbench({ narrow: false, roomy: false });

    expect(markup).not.toContain('aria-label="Expand panel"');
    expect(occurrences(markup, 'data-slot="representation-controls"')).toBe(0);
    expect(occurrences(markup, 'data-slot="compact-representation-controls"')).toBe(1);
    expect(occurrences(markup, 'data-slot="simulation-controls"')).toBe(0);
    expect(occurrences(markup, 'data-slot="compact-simulation-controls"')).toBe(1);
  });

  it('mounts the compact layout for a wide but short phone', () => {
    const markup = renderWorkbench({ narrow: false, short: true });

    expect(occurrences(markup, 'aria-label="Expand panel"')).toBe(1);
    expect(occurrences(markup, 'data-slot="compact-simulation-controls"')).toBe(1);
  });

  it('shows supplemental content without mounting the main panel', () => {
    const markup = renderWorkbench(
      { narrow: true },
      { hasSupplementalContent: true, initialSupplementalDetent: 'half' },
    );

    expect(occurrences(markup, 'data-slot="supplemental-panel"')).toBe(1);
    expect(occurrences(markup, 'data-slot="main-panel"')).toBe(0);
    expect(markup).toContain('class="sheet-back"');
  });

  it('renders a compact restore action outside hidden chrome', () => {
    const markup = renderWorkbench({ narrow: true }, { chromeHidden: true });

    expect(markup).toContain('class="zen-restore"');
    expect(markup).toContain('aria-label="Show UI (\\)"');
    expect(markup).toContain('compact-workbench is-hidden');
  });
});
