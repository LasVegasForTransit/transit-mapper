import { describe, expect, it } from 'vitest';
import {
  createRendererCapturePlan,
  createRendererContextPlan,
  createRendererFilmstripPlan,
  rendererCaptureComparisons,
  selectRendererCaptureCases,
} from '../../src/perf/renderer-capture';

describe('renderer capture planning', () => {
  it('builds the complete deterministic editor matrix', () => {
    const plan = createRendererCapturePlan('00-baseline');

    expect(plan).toHaveLength(60);
    expect(new Set(plan.map((capture) => capture.id)).size).toBe(plan.length);
    expect(plan[0]).toMatchObject({
      id: '00-baseline-desktop-light-infrastructure-overview',
      profile: 'desktop',
      theme: 'light',
      viewMode: 'infrastructure',
      detail: 'overview',
      zoom: 11,
    });
    expect(plan.at(-1)).toMatchObject({
      id: '00-baseline-mobile-dark-diagram-street',
      profile: 'mobile',
      theme: 'dark',
      viewMode: 'diagram',
      detail: 'street',
      zoom: 18,
    });
  });

  it('covers every in-context surface at both profiles and themes', () => {
    const contexts = createRendererContextPlan('00-baseline');

    expect(contexts).toHaveLength(16);
    expect(contexts[0]).toEqual({
      id: '00-baseline-context-desktop-light-editor',
      phase: '00-baseline',
      profile: 'desktop',
      theme: 'light',
      surface: 'editor',
    });
    expect(contexts.at(-1)).toEqual({
      id: '00-baseline-context-mobile-dark-embed',
      phase: '00-baseline',
      profile: 'mobile',
      theme: 'dark',
      surface: 'embed',
    });
  });

  it('builds fractional-zoom filmstrips around both transition boundaries', () => {
    const filmstrip = createRendererFilmstripPlan('00-baseline');

    expect(filmstrip).toHaveLength(30);
    expect(filmstrip[0]).toMatchObject({
      id: '00-baseline-filmstrip-infrastructure-overview-district-0',
      viewMode: 'infrastructure',
      boundary: 'overview-district',
      frame: 0,
      zoom: 13.25,
    });
    expect(filmstrip.at(-1)).toMatchObject({
      id: '00-baseline-filmstrip-diagram-district-street-4',
      viewMode: 'diagram',
      boundary: 'district-street',
      frame: 4,
      zoom: 17,
    });
  });

  it('keeps contact-sheet evidence in baseline, previous, current, difference order', () => {
    expect(
      rendererCaptureComparisons({
        baselinePath: '/artifacts/00-baseline/image.png',
        previousPath: '/artifacts/01-lod/image.png',
        currentPath: '/artifacts/02-geometry/image.png',
        differencePath: '/artifacts/02-geometry/image-diff.png',
      }),
    ).toEqual([
      { label: 'Baseline', path: '/artifacts/00-baseline/image.png' },
      { label: 'Previous', path: '/artifacts/01-lod/image.png' },
      { label: 'Current', path: '/artifacts/02-geometry/image.png' },
      { label: 'Difference', path: '/artifacts/02-geometry/image-diff.png' },
    ]);
  });

  it('selects a stable profile and theme subset without changing matrix order', () => {
    const selected = selectRendererCaptureCases(createRendererCapturePlan('03-junctions'), {
      profile: 'mobile',
      theme: 'dark',
    });

    expect(selected).toHaveLength(15);
    expect(selected[0].id).toBe('03-junctions-mobile-dark-infrastructure-overview');
    expect(selected.at(-1)?.id).toBe('03-junctions-mobile-dark-diagram-street');
  });
});
