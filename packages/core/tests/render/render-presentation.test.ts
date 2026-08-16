import { describe, expect, it } from 'vitest';
import {
  createRenderTierStateResolver,
  displayedProjectedLengthPx,
  metricErrorForDisplayedPixels,
  renderPresentationForViewport,
  renderTierBlend,
  selectRenderTier,
  type RenderPresentation,
} from '../../src/render/render-presentation';
import { projector } from '../../src/render/project';

function presentation(pixelRatio: number): RenderPresentation {
  return {
    bounds: {
      southwest: [-115.25, 36.05],
      northeast: [-115.05, 36.25],
    },
    zoom: 12.5,
    viewportWidthPx: 1200,
    viewportHeightPx: 600,
    displayedWidthPx: 600,
    displayedHeightPx: 300,
    pixelRatio,
  };
}

describe('render presentation', () => {
  it('derives visible bounds and display facts from the final fitted viewport', () => {
    const viewport = {
      center: [-115.17, 36.17] as [number, number],
      zoom: 10.75,
      width: 800,
      height: 500,
    };

    const result = renderPresentationForViewport(viewport, {
      displayedWidthPx: 400,
      displayedHeightPx: 250,
      pixelRatio: 3,
    });
    const project = projector(viewport);
    const southwest = project(result.bounds.southwest);
    const northeast = project(result.bounds.northeast);

    expect(result).toMatchObject({
      zoom: 10.75,
      viewportWidthPx: 800,
      viewportHeightPx: 500,
      displayedWidthPx: 400,
      displayedHeightPx: 250,
      pixelRatio: 3,
    });
    expect(southwest.x).toBeCloseTo(0, 8);
    expect(southwest.y).toBeCloseTo(500, 8);
    expect(northeast.x).toBeCloseTo(800, 8);
    expect(northeast.y).toBeCloseTo(0, 8);
  });

  it('defaults a vector viewport to its authored CSS size and DPR 1', () => {
    const result = renderPresentationForViewport({
      center: [0, 0],
      zoom: 4,
      width: 1200,
      height: 630,
    });

    expect(result.displayedWidthPx).toBe(1200);
    expect(result.displayedHeightPx).toBe(630);
    expect(result.pixelRatio).toBe(1);
  });

  it('measures projected lengths in displayed CSS pixels independently of pixel ratio', () => {
    const projectedVector = { xPx: 6, yPx: 8 };

    expect(displayedProjectedLengthPx(projectedVector, presentation(1))).toBe(5);
    expect(displayedProjectedLengthPx(projectedVector, presentation(3))).toBe(5);
  });

  it('uses both display axes when a presentation is scaled non-uniformly', () => {
    const stretched: RenderPresentation = {
      ...presentation(2),
      displayedWidthPx: 600,
      displayedHeightPx: 150,
    };

    expect(displayedProjectedLengthPx({ xPx: 6, yPx: 8 }, stretched)).toBeCloseTo(Math.sqrt(13));
  });

  it('converts a displayed curve-error target into local physical meters', () => {
    const halfSize = metricErrorForDisplayedPixels(presentation(1), 0, 0.35);
    const fullSize = metricErrorForDisplayedPixels(
      { ...presentation(1), displayedWidthPx: 1200, displayedHeightPx: 600 },
      0,
      0.35,
    );
    const highLatitude = metricErrorForDisplayedPixels(presentation(1), 60, 0.35);

    expect(fullSize).toBeGreaterThan(0);
    expect(halfSize).toBeCloseTo(fullSize * 2, 9);
    expect(highLatitude).toBeCloseTo(halfSize / 2, 9);
  });

  it('selects deterministic static tiers at the exact entry thresholds', () => {
    expect(selectRenderTier(2.999)).toBe('overview');
    expect(selectRenderTier(3)).toBe('district');
    expect(selectRenderTier(11.999)).toBe('district');
    expect(selectRenderTier(12)).toBe('street');
  });

  it('retains District until its projected width falls below 2 px', () => {
    expect(selectRenderTier(3, 'overview')).toBe('district');
    expect(selectRenderTier(2, 'district')).toBe('district');
    expect(selectRenderTier(1.999, 'district')).toBe('overview');
  });

  it('retains Street until its projected width falls below 9 px', () => {
    expect(selectRenderTier(12, 'district')).toBe('street');
    expect(selectRenderTier(9, 'street')).toBe('street');
    expect(selectRenderTier(8.999, 'street')).toBe('district');
  });

  it('resolves per-corridor hysteresis and reports only logical tier transitions', () => {
    const resolver = createRenderTierStateResolver();

    expect(resolver.resolve('document-a', 'corridor', 12)).toMatchObject({
      logicalTier: 'street',
      transitioned: false,
    });
    expect(resolver.resolve('document-a', 'corridor', 9)).toMatchObject({
      logicalTier: 'street',
      retainedTiers: ['district'],
      transitioned: false,
    });
    expect(resolver.resolve('document-a', 'corridor', 8.999)).toMatchObject({
      logicalTier: 'district',
      transitioned: true,
    });
    expect(resolver.resolve('document-a', 'corridor', 2)).toMatchObject({
      logicalTier: 'district',
      retainedTiers: ['overview'],
      transitioned: false,
    });
    expect(resolver.resolve('document-a', 'corridor', 1.999)).toMatchObject({
      logicalTier: 'overview',
      transitioned: true,
    });
  });

  it('resets corridor history when the document changes or reset is explicit', () => {
    const resolver = createRenderTierStateResolver();
    resolver.resolve('document-a', 'corridor', 12);

    const changedDocument = resolver.resolve('document-b', 'corridor', 9);
    expect(changedDocument.logicalTier).toBe('district');
    expect(changedDocument.transitioned).toBe(false);
    expect(changedDocument.blend).toEqual(renderTierBlend(9));

    resolver.resolve('document-b', 'corridor', 12);
    resolver.reset('document-b');
    expect(resolver.resolve('document-b', 'corridor', 9)).toMatchObject({
      logicalTier: 'district',
      transitioned: false,
    });
  });

  it('settles directly on the appropriate tier after a large camera jump', () => {
    expect(selectRenderTier(20, 'overview')).toBe('street');
    expect(selectRenderTier(1, 'street')).toBe('overview');
  });

  it('cross-fades Overview and District over the 2-4 px band', () => {
    expect(renderTierBlend(2).weights).toEqual({ overview: 1, district: 0, street: 0 });
    expect(renderTierBlend(3).weights).toEqual({ overview: 0.5, district: 0.5, street: 0 });
    expect(renderTierBlend(4).weights).toEqual({ overview: 0, district: 1, street: 0 });
  });

  it('cross-fades District and Street over the 9-12 px band', () => {
    expect(renderTierBlend(9).weights).toEqual({ overview: 0, district: 1, street: 0 });
    expect(renderTierBlend(10.5).weights).toEqual({
      overview: 0,
      district: 0.5,
      street: 0.5,
    });
    expect(renderTierBlend(12).weights).toEqual({ overview: 0, district: 0, street: 1 });
  });

  it('excludes zero-weight tiers outside their overlap bands', () => {
    expect(renderTierBlend(1).activeTiers).toEqual(['overview']);
    expect(renderTierBlend(2).activeTiers).toEqual(['overview']);
    expect(renderTierBlend(2.5).activeTiers).toEqual(['overview', 'district']);
    expect(renderTierBlend(4).activeTiers).toEqual(['district']);
    expect(renderTierBlend(9).activeTiers).toEqual(['district']);
    expect(renderTierBlend(10).activeTiers).toEqual(['district', 'street']);
    expect(renderTierBlend(12).activeTiers).toEqual(['street']);
    expect(renderTierBlend(20).activeTiers).toEqual(['street']);
  });

  it('has no hidden camera or tier history for static rendering', () => {
    const firstTier = selectRenderTier(2.5);
    const firstBlend = renderTierBlend(2.5);

    selectRenderTier(14, 'district');
    renderTierBlend(14);

    expect(selectRenderTier(2.5)).toBe(firstTier);
    expect(renderTierBlend(2.5)).toEqual(firstBlend);
  });

  it('rejects widths that cannot represent a projected screen size', () => {
    expect(() => selectRenderTier(-1)).toThrow(RangeError);
    expect(() => selectRenderTier(Number.NaN)).toThrow(RangeError);
    expect(() => renderTierBlend(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
