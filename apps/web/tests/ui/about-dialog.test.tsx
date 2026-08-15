// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BuildInfo } from '../../src/build-info';
import { AboutDialog } from '../../src/ui/about-dialog';

const releaseBuild: BuildInfo = {
  version: '1.4.0',
  repositoryUrl: 'https://github.com/LasVegasForTransit/transit-mapper',
  commitSha: '0123456789abcdef0123456789abcdef01234567',
  commitUrl:
    'https://github.com/LasVegasForTransit/transit-mapper/commit/0123456789abcdef0123456789abcdef01234567',
  builtAt: '2026-08-01T19:20:21.000Z',
  dirty: false,
  copyrightNotice: 'Copyright (c) 2026 Las Vegans for Better Transit',
  releaseTag: 'v1.4.0',
  releaseUrl: 'https://github.com/LasVegasForTransit/transit-mapper/releases/tag/v1.4.0',
  attestationsUrl: 'https://github.com/LasVegasForTransit/transit-mapper/attestations',
  performanceSampling: {
    enabled: true,
    ordinaryBasisPoints: 100,
    releaseBasisPoints: 500,
    boostUntil: '2026-08-02T19:20:21.000Z',
  },
};

let container: HTMLDivElement;
let root: Root;

function link(label: string): HTMLAnchorElement {
  const match = [...document.querySelectorAll('a')].find((anchor) => anchor.textContent === label);
  if (!(match instanceof HTMLAnchorElement)) throw new Error(`Expected link: ${label}`);
  return match;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('About dialog', () => {
  it('connects the shipped build to its developer, release, source, and attestation', () => {
    act(() => root.render(<AboutDialog buildInfo={releaseBuild} onClose={() => undefined} />));

    expect(document.body.textContent).toContain('About TransitMapper');
    expect(document.body.textContent).toContain('Developer');
    expect(document.body.textContent).toContain('Core contributors');
    expect(document.body.textContent).toContain('Willie Chalmers III');
    expect(document.body.textContent).toContain('Lead, LVBT president');
    expect(document.body.textContent).toContain('Version');
    expect(document.body.textContent).toContain('1.4.0');
    expect(document.body.textContent).toContain('Last updated');
    expect(document.querySelector('time')?.getAttribute('datetime')).toBe(
      '2026-08-01T19:20:21.000Z',
    );

    expect(link('Las Vegans for Better Transit').href).toBe('https://lasvegasfortransit.org/');
    expect(link('0123456').href).toBe(releaseBuild.commitUrl);
    expect(link('v1.4.0 release').href).toBe(releaseBuild.releaseUrl);
    expect(link('Build attestations').href).toBe(releaseBuild.attestationsUrl);
    expect(link('MIT License').href).toBe(
      'https://github.com/LasVegasForTransit/transit-mapper/blob/0123456789abcdef0123456789abcdef01234567/LICENSE',
    );
    expect(link('Privacy').href).toBe('http://localhost:3000/privacy');

    for (const label of [
      'Las Vegans for Better Transit',
      '0123456',
      'v1.4.0 release',
      'Build attestations',
      'MapLibre GL JS',
      'OpenFreeMap',
      'OpenStreetMap contributors',
      'Public Sans',
      'MIT License',
    ]) {
      expect(link(label).target).toBe('_blank');
      expect(link(label).rel).toBe('noopener noreferrer');
    }
    expect(document.body.textContent).toContain('Copyright (c) 2026 Las Vegans for Better Transit');
  });

  it('labels a local build without pretending it has release provenance', () => {
    act(() =>
      root.render(
        <AboutDialog
          buildInfo={{
            ...releaseBuild,
            commitSha: null,
            commitUrl: null,
            dirty: true,
            releaseTag: null,
            releaseUrl: null,
          }}
          onClose={() => undefined}
        />,
      ),
    );

    expect(document.body.textContent).toContain('Revision unavailable');
    expect(document.body.textContent).toContain('Local changes included');
    expect(document.body.textContent).not.toContain('Build attestations');
    expect(
      [...document.querySelectorAll('a')].some((anchor) => anchor.textContent.endsWith(' release')),
    ).toBe(false);
  });
});
