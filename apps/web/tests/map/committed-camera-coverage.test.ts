import { describe, expect, it, vi } from 'vitest';
import type { RenderCandidateEnvelope } from '@transitmapper/core/render/render-candidate-envelope';
import type { RenderPresentation } from '@transitmapper/core/render/render-presentation';
import {
  canReuseCommittedCameraRefresh,
  canReuseCommittedCameraScene,
} from '@transitmapper/map/driver';

function presentation(
  southwest: [number, number] = [-115.2, 36.1],
  northeast: [number, number] = [-115.1, 36.2],
): RenderPresentation {
  return {
    bounds: { southwest, northeast },
    zoom: 14,
    viewportWidthPx: 1_000,
    viewportHeightPx: 800,
    displayedWidthPx: 1_000,
    displayedHeightPx: 800,
    pixelRatio: 2,
  };
}

const ENVELOPE: RenderCandidateEnvelope = {
  bounds: {
    southwest: [-115.25, 36.05],
    northeast: [-115.05, 36.25],
  },
};

describe('committed camera coverage', () => {
  it('reuses an accepted scene for a same-scale pan inside its candidate envelope', () => {
    expect(
      canReuseCommittedCameraScene(
        { presentation: presentation(), candidateEnvelope: ENVELOPE },
        presentation([-115.18, 36.11], [-115.08, 36.21]),
      ),
    ).toBe(true);
  });

  it('reprojects after leaving the accepted candidate envelope', () => {
    expect(
      canReuseCommittedCameraScene(
        { presentation: presentation(), candidateEnvelope: ENVELOPE },
        presentation([-115.02, 36.11], [-114.92, 36.21]),
      ),
    ).toBe(false);
  });

  it('reprojects for scale, viewport, display, or pixel-ratio changes', () => {
    const committed = { presentation: presentation(), candidateEnvelope: ENVELOPE };
    const changes: RenderPresentation[] = [
      { ...presentation(), zoom: 14.001 },
      { ...presentation(), viewportWidthPx: 999 },
      { ...presentation(), displayedHeightPx: 799 },
      { ...presentation(), pixelRatio: 3 },
    ];

    expect(changes.every((current) => !canReuseCommittedCameraScene(committed, current))).toBe(
      true,
    );
  });

  it('cannot reuse before the first accepted scene', () => {
    expect(canReuseCommittedCameraScene(null, presentation())).toBe(false);
  });

  it('does no projection work for a healthy covered pan', () => {
    const project = vi.fn();
    const reusable = canReuseCommittedCameraRefresh({
      committed: { presentation: presentation(), candidateEnvelope: ENVELOPE },
      current: presentation([-115.18, 36.11], [-115.08, 36.21]),
      renderedSystemId: 'port-mason',
      currentSystemId: 'port-mason',
      rendererHealthy: true,
      projectionActive: false,
    });

    if (!reusable) project();

    expect(reusable).toBe(true);
    expect(project).not.toHaveBeenCalled();
  });

  it('reprojects after document, health, or ownership invalidation', () => {
    const base = {
      committed: { presentation: presentation(), candidateEnvelope: ENVELOPE },
      current: presentation([-115.18, 36.11], [-115.08, 36.21]),
      renderedSystemId: 'port-mason',
      currentSystemId: 'port-mason',
      rendererHealthy: true,
      projectionActive: false,
    };

    expect(
      [
        { ...base, currentSystemId: 'new-system' },
        { ...base, rendererHealthy: false },
        { ...base, projectionActive: true },
      ].every((state) => !canReuseCommittedCameraRefresh(state)),
    ).toBe(true);
  });
});
