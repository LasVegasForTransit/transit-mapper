import { describe, expect, it } from 'vitest';
import type { RenderPresentation } from '../../src/render/render-presentation';
import {
  createRenderPreparationCoordinator,
  MAX_PREPARED_VIEWPORT_SEGMENTS_PER_CATEGORY,
  type RenderPreparationPlan,
} from '../../src/render/render-preparation';
import { aRoad, aSystem } from '../support/fixtures.test';

const PRESENTATION: RenderPresentation = {
  bounds: { southwest: [-116, 35], northeast: [-114, 37] },
  zoom: 12,
  viewportWidthPx: 1_440,
  viewportHeightPx: 900,
  displayedWidthPx: 1_440,
  displayedHeightPx: 900,
  pixelRatio: 1,
};

function completePlan(
  coordinator: ReturnType<typeof createRenderPreparationCoordinator>,
  plan: RenderPreparationPlan,
): void {
  for (const unit of plan.units) {
    coordinator.record(plan, { unitId: unit.id, result: unit.run(), durationMs: 1 });
  }
}

describe('renderer preparation viewport compaction', () => {
  it('compacts persistent viewport overlays before a long edit session can grow without bound', () => {
    let way = aRoad('way', [
      [0, 0],
      [1, 0],
    ]);
    let system = aSystem({ ways: [way] });
    const coordinator = createRenderPreparationCoordinator();
    const cold = coordinator.plan({
      revision: 'edit-0',
      system,
      presentation: PRESENTATION,
      categories: ['corridor'],
    });
    completePlan(coordinator, cold);
    coordinator.commit(cold);
    let sawCompaction = false;
    let maximumSegmentQueries = 0;
    for (let edit = 1; edit <= MAX_PREPARED_VIEWPORT_SEGMENTS_PER_CATEGORY + 4; edit++) {
      way = { ...way, grade: edit % 2 === 0 ? 'atGrade' : 'elevated' };
      system = { ...system, ways: [way] };
      const plan = coordinator.plan({
        revision: `edit-${edit}`,
        system,
        presentation: PRESENTATION,
        categories: ['corridor'],
        patch: { ways: { upsert: [way] } },
      });
      if (plan.kind === 'cold') sawCompaction = true;
      maximumSegmentQueries = Math.max(
        maximumSegmentQueries,
        plan.plannedOperations.viewportSegmentQueries,
      );
      completePlan(coordinator, plan);
      expect(coordinator.commit(plan).kind).toBe('committed');
    }
    expect(sawCompaction).toBe(true);
    expect(maximumSegmentQueries).toBeLessThanOrEqual(
      2 + MAX_PREPARED_VIEWPORT_SEGMENTS_PER_CATEGORY * 2,
    );
  });
});
