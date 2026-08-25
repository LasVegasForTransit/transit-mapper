// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MapWorkspace } from '../src/map-workspace';
import type { WorkspaceSlots } from '../src/workspace-slots';
import { matchMediaFor } from './support/media-environment.test';

const WORKBENCH_CSS = readFileSync(resolve(process.cwd(), 'src/workbench.css'), 'utf8');
const THEME_TOKENS = `
  :root {
    --md-sys-color-surface: rgb(20, 20, 20);
    --md-sys-color-on-surface: rgb(240, 240, 240);
    --md-sys-color-on-surface-variant: rgb(190, 190, 190);
    --md-sys-color-surface-container: rgb(35, 35, 35);
    --md-sys-color-surface-container-highest: rgb(60, 60, 60);
    --md-sys-color-outline-variant: rgb(80, 80, 80);
    --md-sys-elevation-level2: 0 2px 6px rgb(0 0 0 / 40%);
    --md-sys-elevation-level3: 0 4px 10px rgb(0 0 0 / 45%);
    --md-sys-typescale-title-small-size: 14px;
    --md-sys-typescale-label-small-size: 11px;
  }
`;

function slot(name: string) {
  return <span data-slot={name}>{name}</span>;
}

function element(selector: string): HTMLElement {
  const match = document.querySelector<HTMLElement>(selector);
  expect(match).not.toBeNull();
  if (!match) throw new Error(`Expected ${selector}`);
  return match;
}

function workspaceSlots(placement: 'centered' | 'panel-aligned' = 'centered'): WorkspaceSlots {
  return {
    brand: slot('brand'),
    primaryActions: slot('primary-actions'),
    representationControls: slot('representation-controls'),
    compactRepresentationControls: slot('compact-representation-controls'),
    simulationControls: slot('simulation-controls'),
    compactSimulationControls: slot('compact-simulation-controls'),
    mainPanel: slot('main-panel'),
    supplementalPanel: slot('supplemental-panel'),
    toolDock: slot('tool-dock'),
    applicationNotices: {
      content:
        placement === 'centered' ? (
          <button type="button" data-slot="application-notices">
            Notice action
          </button>
        ) : (
          slot('application-notices')
        ),
      placement,
    },
  };
}

function mountWorkspace(placement: 'centered' | 'panel-aligned' = 'centered') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: matchMediaFor({ narrow: false }),
  });
  document.head.innerHTML = `<style>${THEME_TOKENS}\n${WORKBENCH_CSS}</style>`;
  document.body.innerHTML = renderToStaticMarkup(
    <MapWorkspace
      mapSurface={<canvas data-slot="map" />}
      slots={workspaceSlots(placement)}
      state={{
        representationLabel: 'Network',
        hasSupplementalContent: true,
        initialSupplementalDetent: 'half',
        chromeHidden: false,
        contentStatus: 'ready',
      }}
      actions={{ onToggleInterface: () => {}, onDismissSupplemental: () => {} }}
    />,
  );
}

afterEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('standalone Workbench CSS', () => {
  it('provides its overlay, MenuCard, toggle, and layout variables without host CSS', () => {
    mountWorkspace();

    const root = element('.workspace-root');
    const overlay = element('.workspace-overlay');
    const menuCard = element('.workspace-menu-card');
    const toggle = element('.workspace-interface-toggle');

    expect(getComputedStyle(root).position).toBe('relative');
    expect(getComputedStyle(root).overflow).toBe('hidden');
    expect(getComputedStyle(overlay).position).toBe('absolute');
    expect(getComputedStyle(overlay).display).toBe('grid');
    expect(getComputedStyle(menuCard).width).toBe('var(--panel-w)');
    expect(getComputedStyle(menuCard).display).toBe('flex');
    expect(getComputedStyle(toggle).width).toBe('34px');
    expect(getComputedStyle(toggle).height).toBe('34px');
    expect(getComputedStyle(root).getPropertyValue('--panel-w').trim()).toBe('280px');
    expect(getComputedStyle(root).getPropertyValue('--overlay-gap').trim()).toBe('8px');
    expect(getComputedStyle(root).getPropertyValue('--controls-clearance').trim()).not.toBe('');
    expect(getComputedStyle(root).getPropertyValue('--map-pad-left').trim()).not.toBe('');
  });

  it('places a panel-aligned notice above supplemental content in separate rows', () => {
    mountWorkspace('panel-aligned');

    const notice = element('.workspace-application-notice.is-panel-aligned');
    const supplemental = element('.workspace-supplemental');

    expect(getComputedStyle(notice).gridRow).toBe('2');
    expect(getComputedStyle(supplemental).gridRow).toBe('3');
  });

  it('centers a centered notice independently of the panel column', () => {
    mountWorkspace('centered');

    const notice = element('.workspace-application-notice.is-centered');

    expect(getComputedStyle(notice).position).toBe('absolute');
    expect(getComputedStyle(notice).justifyContent).toBe('center');
    expect(getComputedStyle(notice).pointerEvents).toBe('none');
    const content = element('.workspace-application-notice-content');
    expect(getComputedStyle(content).pointerEvents).toBe('auto');
    expect(getComputedStyle(element('[data-slot="application-notices"]')).pointerEvents).toBe(
      'auto',
    );
  });
});
