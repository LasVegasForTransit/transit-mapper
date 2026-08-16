import { describe, expect, it } from 'vitest';
import { rendererContactSheetHtml } from '../../scripts/renderer-capture/contact-sheet';
import {
  completeRendererEvidenceFiles,
  rendererCaptureDescription,
  rendererLodAcceptanceContactSheetAppendix,
} from '../../scripts/renderer-capture/capture-contact-sheet';
import { rendererLodAcceptanceManifest } from '../support/renderer-contact-sheet.test';

describe('renderer contact sheet layout', () => {
  it('keeps the stable base regression corpus at exactly 116 captures', () => {
    expect(completeRendererEvidenceFiles('01-lod')).toHaveLength(116);
  });

  it('groups captures in deterministic baseline, previous, current, difference order', () => {
    const appendix = rendererLodAcceptanceContactSheetAppendix(rendererLodAcceptanceManifest());
    const html = rendererContactSheetHtml({
      phase: '02-geometry',
      captures: [
        {
          id: 'desktop-light-infrastructure-overview',
          description: 'Port Mason · z13.409 · 3 px target · 1440×900 @1x',
          comparisons: [
            { label: 'Baseline', path: 'baseline.png' },
            { label: 'Previous', path: 'previous.png' },
            { label: 'Current', path: 'current.png' },
            { label: 'Difference', path: 'difference.png' },
          ],
        },
      ],
      appendix,
    });

    expect(html.indexOf('Baseline')).toBeLessThan(html.indexOf('Previous'));
    expect(html.indexOf('Previous')).toBeLessThan(html.indexOf('Current'));
    expect(html.indexOf('Current')).toBeLessThan(html.indexOf('Difference'));
    expect(html).toContain('Renderer evidence: 02-geometry');
    expect(html).toContain('Port Mason · z13.409 · 3 px target · 1440×900 @1x');
    expect(html.indexOf('LOD acceptance')).toBeGreaterThan(
      html.indexOf('desktop-light-infrastructure-overview'),
    );
    expect(html).toContain('acceptance/manifest.json');
    expect(html).toContain('acceptance/images/selected-wide-corridor-10-5.png');
    expect(html).toContain('selected-wide-corridor-10-5');
    expect(html).toContain('hover-zero-committed-work');
    expect(html).toContain('Passed');
  });

  it('describes the exact fixture, camera, target width, and display density', () => {
    expect(
      rendererCaptureDescription({
        id: '01-lod-filmstrip-infrastructure-district-street-2',
        file: 'images/frame.png',
        profile: 'filmstrip',
        theme: 'light',
        viewMode: 'infrastructure',
        detail: 'filmstrip',
        zoom: 15.216254,
        targetCorridorWidthPx: 10.5,
        fixtureId: 'port-mason',
        viewport: { width: 1_440, height: 900, pixelRatio: 1 },
        camera: { center: [-122.446, 37.758], zoom: 15.216254 },
        rendererStats: null,
      }),
    ).toBe(
      'Port Mason reference · filmstrip/light/infrastructure/filmstrip · z15.216 · 10.5 px target · 1440×900 @1x',
    );
  });
});
