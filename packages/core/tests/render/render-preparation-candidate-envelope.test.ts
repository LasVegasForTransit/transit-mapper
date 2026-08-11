import { describe, expect, it } from 'vitest';
import {
  createRenderPreparationCoordinator,
  type RenderPreparationPlan,
} from '../../src/render/render-preparation';
import type { RenderPresentation } from '../../src/render/render-presentation';
import { aRoad, aSystem } from '../support/fixtures.test';

const WIDE_PRESENTATION: RenderPresentation = {
  bounds: { southwest: [-116, 35], northeast: [-114, 37] },
  zoom: 12,
  viewportWidthPx: 1_440,
  viewportHeightPx: 900,
  displayedWidthPx: 1_440,
  displayedHeightPx: 900,
  pixelRatio: 1,
};
const NARROW_PRESENTATION: RenderPresentation = {
  ...WIDE_PRESENTATION,
  bounds: { southwest: [-115.21, 36.09], northeast: [-115.19, 36.11] },
};

function complete(
  coordinator: ReturnType<typeof createRenderPreparationCoordinator>,
  plan: RenderPreparationPlan,
): void {
  for (const unit of plan.units) {
    coordinator.record(plan, { unitId: unit.id, result: unit.run(), durationMs: 0 });
  }
}

function rtcShapedSystem() {
  return aSystem({
    ways: Array.from({ length: 4_096 }, (_, index) => {
      const west = -115.5 + (index % 128) * 0.003;
      const south = 35.9 + Math.floor(index / 128) * 0.003;
      return aRoad(`way-${index}`, [
        [west, south],
        [west + 0.002, south],
      ]);
    }),
  });
}

describe('prepared candidate envelopes', () => {
  it('requeries unchanged candidates when an incremental edit changes the swept envelope', () => {
    const system = rtcShapedSystem();
    const coordinator = createRenderPreparationCoordinator();
    const cold = coordinator.plan({
      revision: 'narrow-before-edit',
      system,
      presentation: NARROW_PRESENTATION,
      categories: ['corridor'],
    });
    complete(coordinator, cold);
    const coldResult = coordinator.commit(cold);
    if (coldResult.kind !== 'committed') throw new Error('Expected cold preparation to commit');
    expect(coldResult.snapshot.candidates.wayIds?.length).toBeLessThan(system.ways.length);

    const editedWay = { ...system.ways[0], name: 'Edited during fast pan' };
    const next = { ...system, ways: [editedWay, ...system.ways.slice(1)] };
    const incremental = coordinator.plan({
      revision: 'wide-envelope-after-edit',
      system: next,
      presentation: NARROW_PRESENTATION,
      candidateEnvelope: { bounds: WIDE_PRESENTATION.bounds },
      categories: ['corridor'],
      patch: { ways: { upsert: [editedWay] } },
    });
    expect(incremental.kind).toBe('incremental');
    complete(coordinator, incremental);
    const result = coordinator.commit(incremental);
    if (result.kind !== 'committed') throw new Error('Expected incremental preparation to commit');

    expect(result.snapshot.candidateEnvelope).toEqual({ bounds: WIDE_PRESENTATION.bounds });
    expect(result.snapshot.candidates.wayIds).toHaveLength(system.ways.length);
  });
});
