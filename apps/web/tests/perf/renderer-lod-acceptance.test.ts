import { describe, expect, it } from 'vitest';
import {
  RENDERER_LOD_ACCEPTANCE_ASSERTION_IDS,
  RENDERER_LOD_ACCEPTANCE_VISUAL_CASES,
  createRendererLodAcceptancePlan,
} from '../../src/perf/renderer-lod-acceptance';
import { createServedJunctionFixture } from '../../src/perf/renderer-specialized-fixtures';

describe('renderer LOD acceptance plan', () => {
  it('keeps the Phase 2 appendix at the exact independent 21-image contract', () => {
    const plan = createRendererLodAcceptancePlan();

    expect(plan.suiteId).toBe('phase-2-lod');
    expect(plan.phase).toBe('01-lod');
    expect(plan.visuals).toHaveLength(21);
    expect(plan.visuals.map((entry) => entry.id)).toEqual([
      'selected-wide-corridor-10-5',
      'tunnel-below-12',
      'tunnel-at-12',
      'served-junction-3-arm',
      'served-junction-4-arm',
      'served-junction-5-arm',
      'fast-pan-accepted',
      'fast-pan-edge-preload',
      'fast-pan-settled',
      'bank-old-accepted',
      'bank-hidden-preparation',
      'bank-new-promoted',
      'parity-overview-live',
      'parity-overview-static',
      'parity-overview-svg',
      'parity-district-live',
      'parity-district-static',
      'parity-district-svg',
      'parity-street-live',
      'parity-street-static',
      'parity-street-svg',
    ]);
    expect(plan.visuals.map((entry) => entry.file)).toEqual(
      plan.visuals.map((entry) => `images/${entry.id}.png`),
    );
    expect(new Set(plan.visuals.map((entry) => entry.file)).size).toBe(21);
  });

  it('defines the exact machine assertion set independently of visual frames', () => {
    expect(RENDERER_LOD_ACCEPTANCE_ASSERTION_IDS).toEqual([
      'hover-zero-committed-work',
      'selection-zero-committed-work',
      'filter-zero-committed-work',
      'retained-theme-zero-committed-work',
      'accepted-camera-reuses-scene',
      'invalidating-camera-reprojects',
      'bank-promotion-is-atomic',
    ]);
    expect(RENDERER_LOD_ACCEPTANCE_VISUAL_CASES).toHaveLength(21);
    expect(
      RENDERER_LOD_ACCEPTANCE_VISUAL_CASES.filter((entry) => entry.surface === 'live-maplibre'),
    ).toHaveLength(15);
    expect(
      RENDERER_LOD_ACCEPTANCE_VISUAL_CASES.filter((entry) => entry.surface === 'static-maplibre'),
    ).toHaveLength(3);
    expect(
      RENDERER_LOD_ACCEPTANCE_VISUAL_CASES.filter((entry) => entry.surface === 'svg'),
    ).toHaveLength(3);
  });

  it('records exact screen-space boundary cameras rather than guessed zoom labels', () => {
    const byId = new Map(RENDERER_LOD_ACCEPTANCE_VISUAL_CASES.map((entry) => [entry.id, entry]));

    expect(byId.get('selected-wide-corridor-10-5')?.camera.targetCorridorWidthPx).toBe(10.5);
    expect(byId.get('tunnel-below-12')?.camera.targetCorridorWidthPx).toBe(11.9);
    expect(byId.get('tunnel-at-12')?.camera.targetCorridorWidthPx).toBe(12);
    expect(byId.get('tunnel-below-12')?.camera.zoom).toBeLessThan(
      byId.get('tunnel-at-12')?.camera.zoom ?? 0,
    );
  });

  it('uses valid served fixtures whose patterns cover every 3, 4, and 5-arm junction', () => {
    const cases = [
      ['served-three-arm', [0, 120, 240]],
      ['served-four-arm', [0, 90, 180, 270]],
      ['served-five-arm', [5, 73, 145, 218, 292]],
    ] as const;

    for (const [id, angles] of cases) {
      const system = createServedJunctionFixture(id, angles);
      const coveredWayIds = new Set(
        system.services.flatMap((service) =>
          service.patterns.flatMap((pattern) =>
            pattern.sections.flatMap((section) =>
              section.kind === 'shared' ? section.legs.map((leg) => leg.wayId) : [],
            ),
          ),
        ),
      );

      expect(system.nodes).toHaveLength(1);
      expect(system.nodes[0]?.refs).toHaveLength(angles.length);
      expect(system.services).toHaveLength(angles.length - 1);
      expect([...coveredWayIds].sort()).toEqual(system.ways.map((way) => way.id).sort());
      expect(
        system.services.every((service) => {
          const section = service.patterns[0]?.sections[0];
          return (
            section?.kind === 'shared' &&
            section.legs[0]?.direction === 'withPoints' &&
            section.legs[1]?.direction === 'againstPoints'
          );
        }),
      ).toBe(true);
    }
  });
});
