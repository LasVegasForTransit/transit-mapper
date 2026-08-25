import { describe, expect, it } from 'vitest';
import type { RenderPresentation } from '@transitmapper/core/render/render-presentation';
import {
  candidateEnvelopeCoversViewport,
  createCameraRenderPreloadController,
} from '@transitmapper/renderer/driver';

function presentationAt(centerXPx: number, centerYPx = 0): RenderPresentation {
  const longitude = centerXPx / 1_000;
  const latitude = centerYPx / 1_000;
  return {
    bounds: {
      southwest: [longitude - 0.72, latitude - 0.45],
      northeast: [longitude + 0.72, latitude + 0.45],
    },
    zoom: 12,
    viewportWidthPx: 1_440,
    viewportHeightPx: 900,
    displayedWidthPx: 1_440,
    displayedHeightPx: 900,
    pixelRatio: 1,
  };
}

function span(southwest: number, northeast: number): number {
  return northeast - southwest;
}

describe('camera render preload', () => {
  it('keeps a fast pan beyond the fixed guard inside the retained directional scene', () => {
    const preload = createCameraRenderPreloadController();
    preload.observe(presentationAt(-100), 0);
    const committed = preload.prepare(presentationAt(0), 100);
    preload.accept(committed.token, 350);
    const fastPan = presentationAt(900);

    expect(
      candidateEnvelopeCoversViewport(
        presentationAt(0),
        { bounds: presentationAt(0).bounds },
        fastPan,
      ),
    ).toBe(false);
    expect(
      candidateEnvelopeCoversViewport(presentationAt(0), committed.candidateEnvelope, fastPan),
    ).toBe(true);
  });

  it('sweeps only the motion axis instead of inflating the orthogonal query span', () => {
    const preload = createCameraRenderPreloadController();
    preload.observe(presentationAt(0), 0);
    preload.observe(presentationAt(900), 100);

    const successor = preload.prepare(presentationAt(900), 100);
    const futureViewport = presentationAt(4_000);
    const envelope = successor.candidateEnvelope.bounds;

    expect(envelope.northeast[0]).toBeGreaterThan(5);
    expect(span(envelope.southwest[1], envelope.northeast[1])).toBeCloseTo(0.9);
    expect(
      candidateEnvelopeCoversViewport(
        presentationAt(900),
        successor.candidateEnvelope,
        futureViewport,
      ),
    ).toBe(true);
  });

  it('uses displacement rather than cumulative jitter for outstanding motion', () => {
    const preload = createCameraRenderPreloadController();
    const initial = preload.prepare(presentationAt(0), 0);
    preload.accept(initial.token, 300);
    for (let cycle = 1; cycle <= 20; cycle += 1) {
      preload.observe(presentationAt(400), cycle * 20 - 10);
      preload.observe(presentationAt(0), cycle * 20);
    }
    preload.observe(presentationAt(0), 410);

    const settled = preload.prepare(presentationAt(0), 410);

    expect(settled.outstandingDisplacementPx).toEqual({ x: 0, y: 0 });
    expect(settled.candidateEnvelope.bounds).toEqual(presentationAt(0).bounds);
  });
});
